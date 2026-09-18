const mongoose = require('mongoose');
const Employee = require('../models/zone2_hr/Employee');
const Department = require('../models/zone2_hr/Department');
const User = require('../models/zone1_system/User');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const Payroll = require('../models/zone2_hr/Payroll');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const Notification = require('../models/zone1_system/Notification');

// `admin` is retained as the legacy system-owner role and is treated as the principal
// for HR purposes. Parent accounts must never enter the employee/payroll workflow.
const STAFF_ACCOUNT_ROLES = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard'];
const ROLE_POSITIONS = {
    admin: new Set(['principal', 'vice_principal']),
    principal: new Set(['principal', 'vice_principal']),
    teacher: new Set(['teacher', 'head_teacher', 'assistant_teacher']),
    accountant: new Set(['accountant']),
    chef: new Set(['chef']),
    guard: new Set(['security'])
};
const DEFAULT_POSITION_BY_ROLE = { admin: 'principal', principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'security' };
const EMPLOYEE_CODE_PREFIX_BY_ROLE = { admin: 'HT', principal: 'HT', teacher: 'GV', accountant: 'KT', chef: 'BEP', guard: 'BV' };
const EMPLOYEE_FIELDS = ['employeeCode', 'fullName', 'phone', 'email', 'departmentId', 'position', 'salaryConfig', 'status'];

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const isValidObjectId = (value) => mongoose.isValidObjectId(value);
const pickEmployeeFields = (body = {}) => Object.fromEntries(EMPLOYEE_FIELDS.filter((field) => Object.hasOwn(body, field)).map((field) => [field, body[field]]));

const runHrTransaction = async (operation) => {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') throw httpError('MongoDB phải chạy Replica Set để liên kết tài khoản và hồ sơ nhân sự an toàn', 503);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await operation(session); });
        return result;
    } finally { await session.endSession(); }
};

const resolveDepartment = async (departmentId, session) => {
    if (!departmentId) return { departmentId: undefined, departmentName: '' };
    if (!isValidObjectId(departmentId)) throw httpError('ID tổ/bộ phận không hợp lệ');
    const department = await Department.findOne({ _id: departmentId, status: 'active' }).session(session);
    if (!department) throw httpError('Không tìm thấy tổ/bộ phận đang hoạt động', 404);
    return { departmentId: department._id, departmentName: department.name };
};

const resolveStaffAccount = async (userId, employeeId, session) => {
    if (!userId) return null;
    if (!isValidObjectId(userId)) throw httpError('ID tài khoản nhân sự không hợp lệ');
    const user = await User.findById(userId).session(session);
    if (!user || !STAFF_ACCOUNT_ROLES.includes(user.role)) throw httpError('Tài khoản được chọn không phải tài khoản nhân sự hợp lệ', 422);
    if (user.status !== 'active') throw httpError('Chỉ có thể liên kết tài khoản nhân sự đang hoạt động', 422);
    const linked = await Employee.findOne({ userId: user._id, ...(employeeId ? { _id: { $ne: employeeId } } : {}) }).session(session);
    if (linked) throw httpError('Tài khoản này đã được liên kết với một hồ sơ nhân sự khác', 409);
    return user;
};

const validateEmployeeData = (data, linkedUser = null) => {
    if (!String(data.employeeCode || '').trim() || !String(data.fullName || '').trim()) {
        throw httpError('Mã nhân viên và họ tên là bắt buộc', 422);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) throw httpError('Email không hợp lệ', 422);
    if (data.phone && !/^[0-9+().\s-]{8,20}$/.test(String(data.phone))) throw httpError('Số điện thoại không hợp lệ', 422);
    if (linkedUser && !ROLE_POSITIONS[linkedUser.role]?.has(data.position)) {
        throw httpError(`Vị trí không phù hợp với vai trò tài khoản ${linkedUser.role}`, 422);
    }
};

const syncLinkedUser = async (user, employee, session) => {
    if (!user) return;
    const code = String(employee.employeeCode).trim().toUpperCase();
    const duplicateCode = await User.exists({ 'employeeInfo.employeeId': code, _id: { $ne: user._id } }).session(session);
    if (duplicateCode) throw httpError('Mã nhân viên đang được dùng bởi một tài khoản khác', 409);
    await User.updateOne({ _id: user._id }, {
        $set: {
            'profile.fullName': employee.fullName.trim(),
            'profile.phone': String(employee.phone).trim(),
            'profile.email': String(employee.email || '').trim().toLowerCase(),
            'employeeInfo.employeeId': code,
            'employeeInfo.baseSalary': Number(employee.salaryConfig?.baseSalary || 0),
            'employeeInfo.position': employee.position
        }
    }, { session });
};

const clearFormerLinkedUser = async (user, employeeCode, session) => {
    if (!user || String(user.employeeInfo?.employeeId || '').toUpperCase() !== String(employeeCode || '').toUpperCase()) return;
    await User.updateOne({ _id: user._id }, { $unset: { employeeInfo: 1 } }, { session });
};

const getAvailableEmployeeCode = async (user, session) => {
    const year = new Date().getFullYear();
    const fallback = `${EMPLOYEE_CODE_PREFIX_BY_ROLE[user.role] || 'NV'}-${year}-${String(user._id).slice(-6).toUpperCase()}`;
    const requested = String(user.employeeInfo?.employeeId || '').trim().toUpperCase();
    const candidates = [...new Set([requested, fallback].filter(Boolean))];
    for (const code of candidates) {
        const [usedByEmployee, usedByAnotherUser] = await Promise.all([
            Employee.exists({ employeeCode: code }).session(session),
            User.exists({ 'employeeInfo.employeeId': code, _id: { $ne: user._id } }).session(session)
        ]);
        if (!usedByEmployee && !usedByAnotherUser) return code;
    }
    throw httpError(`Không thể tự tạo mã nhân viên cho tài khoản ${user.username}`, 409);
};

// ==================== DEPARTMENTS ====================

const getDepartments = async (req, res) => {
    try {
        const departments = await Department.find().sort({ name: 1 });
        res.json({ message: 'Lấy danh sách tổ/bộ phận thành công', data: departments });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const createDepartment = async (req, res) => {
    try {
        const { code, name, description } = req.body;
        if (!code || !name) {
            return res.status(400).json({ message: 'Mã và tên tổ/bộ phận là bắt buộc' });
        }
        const existing = await Department.findOne({ code: code.toUpperCase() });
        if (existing) {
            return res.status(400).json({ message: 'Mã tổ/bộ phận đã tồn tại' });
        }
        const dept = await Department.create({ code, name, description });
        res.status(201).json({ message: 'Tạo tổ/bộ phận thành công', data: dept });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const updateDepartment = async (req, res) => {
    try {
        const dept = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!dept) return res.status(404).json({ message: 'Không tìm thấy tổ/bộ phận' });
        res.json({ message: 'Cập nhật tổ/bộ phận thành công', data: dept });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getStaffAccounts = async (req, res) => {
    try {
        const users = await User.find({ role: { $in: STAFF_ACCOUNT_ROLES } })
            .select('username role status profile employeeInfo')
            .sort({ 'profile.fullName': 1, username: 1 })
            .lean();
        const linkedProfiles = await Employee.find({ userId: { $in: users.map((user) => user._id) } })
            .select('userId employeeCode fullName departmentId departmentName position status')
            .lean();
        const profileByUserId = new Map(linkedProfiles.map((profile) => [String(profile.userId), profile]));
        res.json({
            message: 'Lấy danh sách tài khoản nhân sự thành công',
            data: users.map((user) => ({
                ...user,
                suggestedPosition: DEFAULT_POSITION_BY_ROLE[user.role],
                employeeProfile: profileByUserId.get(String(user._id)) || null
            }))
        });
    } catch (error) {
        res.status(500).json({ message: 'Không thể lấy danh sách tài khoản nhân sự' });
    }
};

const syncStaffAccounts = async (req, res) => {
    try {
        const result = await runHrTransaction(async (session) => {
            const accounts = await User.find({ role: { $in: STAFF_ACCOUNT_ROLES }, status: 'active' })
                .select('username role profile employeeInfo status')
                .session(session);
            const linkedUserIds = new Set((await Employee.find({ userId: { $in: accounts.map((account) => account._id) } }).select('userId').session(session))
                .map((employee) => String(employee.userId)));
            const created = [];

            for (const account of accounts) {
                if (linkedUserIds.has(String(account._id))) continue;
                const employeeCode = await getAvailableEmployeeCode(account, session);
                const employee = (await Employee.create([{
                    userId: account._id,
                    employeeCode,
                    fullName: String(account.profile?.fullName || account.username).trim(),
                    phone: String(account.profile?.phone || '').trim(),
                    email: String(account.profile?.email || '').trim().toLowerCase(),
                    position: account.employeeInfo?.position || DEFAULT_POSITION_BY_ROLE[account.role],
                    // A zero salary deliberately means “needs HR setup”; it is excluded from payroll.
                    salaryConfig: { baseSalary: Number(account.employeeInfo?.baseSalary) || 0, positionAllowance: 0, lunchAllowance: 0 },
                    status: 'active'
                }], { session }))[0];
                await syncLinkedUser(account, employee, session);
                created.push({ _id: employee._id, employeeCode: employee.employeeCode, fullName: employee.fullName, role: account.role, salaryConfigured: employee.salaryConfig.baseSalary > 0 });
            }
            return { created, existing: accounts.length - created.length };
        });
        res.json({ message: result.created.length ? `Đã liên kết ${result.created.length} tài khoản nội bộ với hồ sơ nhân sự` : 'Tất cả tài khoản nội bộ đang hoạt động đã có hồ sơ nhân sự', data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.message || 'Không thể đồng bộ tài khoản nhân sự' });
    }
};

// ==================== EMPLOYEES ====================

const getEmployees = async (req, res) => {
    try {
        const { status, position, departmentId, search } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (position) filter.position = position;
        if (departmentId) filter.departmentId = departmentId;
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { employeeCode: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        const employees = await Employee.find(filter)
            .populate('departmentId', 'name code')
            .populate('userId', 'username role status profile employeeInfo')
            .sort({ fullName: 1 });
        res.json({ message: 'Lấy danh sách nhân viên thành công', data: employees });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getEmployeeById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhân viên không hợp lệ' });
        const employee = await Employee.findById(req.params.id).populate('departmentId', 'name code').populate('userId', 'username role status profile employeeInfo');
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        res.json({ message: 'Lấy thông tin nhân viên thành công', data: employee });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const createEmployee = async (req, res) => {
    try {
        const data = pickEmployeeFields(req.body);
        const requestedUserId = Object.hasOwn(req.body, 'userId') ? req.body.userId : null;
        const employee = await runHrTransaction(async (session) => {
            const linkedUser = await resolveStaffAccount(requestedUserId, null, session);
            data.employeeCode = String(data.employeeCode || linkedUser?.employeeInfo?.employeeId || '').trim().toUpperCase();
            data.fullName = String(data.fullName || linkedUser?.profile?.fullName || '').trim();
            data.phone = String(data.phone || linkedUser?.profile?.phone || '').trim();
            data.email = String(data.email || linkedUser?.profile?.email || '').trim().toLowerCase();
            data.position = data.position || linkedUser?.employeeInfo?.position || DEFAULT_POSITION_BY_ROLE[linkedUser?.role] || 'teacher';
            data.salaryConfig = data.salaryConfig || { baseSalary: 7000000, positionAllowance: 0, lunchAllowance: 0 };
            validateEmployeeData(data, linkedUser);
            const existing = await Employee.exists({ employeeCode: data.employeeCode });
            if (existing) throw httpError('Mã nhân viên đã tồn tại', 409);
            const department = await resolveDepartment(data.departmentId, session);
            const created = (await Employee.create([{ ...data, ...department, userId: linkedUser?._id }], { session }))[0];
            await syncLinkedUser(linkedUser, created, session);
            return created;
        });
        res.status(201).json({ message: 'Tạo nhân viên thành công', data: employee });
    } catch (error) {
        res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ message: error.message || 'Không thể tạo hồ sơ nhân viên' });
    }
};

const updateEmployee = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhân viên không hợp lệ' });
        const fields = pickEmployeeFields(req.body);
        const userIdWasProvided = Object.hasOwn(req.body, 'userId');
        const employee = await runHrTransaction(async (session) => {
            const current = await Employee.findById(req.params.id).session(session);
            if (!current) throw httpError('Không tìm thấy nhân viên', 404);
            const formerLinkedUser = current.userId ? await User.findById(current.userId).session(session) : null;
            const linkedUser = userIdWasProvided
                ? (req.body.userId ? await resolveStaffAccount(req.body.userId, current._id, session) : null)
                : formerLinkedUser;
            const next = { ...current.toObject(), ...fields };
            next.employeeCode = String(next.employeeCode || '').trim().toUpperCase();
            next.fullName = String(next.fullName || '').trim();
            next.phone = String(next.phone || '').trim();
            next.email = String(next.email || '').trim().toLowerCase();
            validateEmployeeData(next, linkedUser);
            const department = Object.hasOwn(fields, 'departmentId') ? await resolveDepartment(fields.departmentId, session) : {};
            const update = { $set: { ...fields, ...department } };
            if (userIdWasProvided) {
                if (req.body.userId) update.$set.userId = linkedUser._id;
                else update.$unset = { userId: 1 };
            }
            const updated = await Employee.findByIdAndUpdate(current._id, update, { new: true, runValidators: true, session });
            if (userIdWasProvided && String(formerLinkedUser?._id || '') !== String(linkedUser?._id || '')) {
                await clearFormerLinkedUser(formerLinkedUser, current.employeeCode, session);
            }
            await syncLinkedUser(linkedUser, updated, session);
            return updated;
        });
        res.json({ message: 'Cập nhật nhân viên thành công', data: employee });
    } catch (error) {
        res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ message: error.message || 'Không thể cập nhật hồ sơ nhân viên' });
    }
};

const deleteEmployee = async (req, res) => {
    try {
        const employee = await Employee.findByIdAndUpdate(
            req.params.id,
            { status: 'resigned' },
            { new: true }
        );
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        res.json({ message: 'Đã đánh dấu nhân viên nghỉ việc', data: employee });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

// ==================== LEAVE REQUESTS ====================

const createLeaveRequest = async (req, res) => {
    try {
        const { employeeId, leaveType, startDate, endDate, reason, substituteTeacherId } = req.body;
        if (!employeeId || !leaveType || !startDate || !endDate || !reason) {
            return res.status(400).json({ message: 'Thiếu thông tin đơn xin nghỉ phép' });
        }

        const employee = await Employee.findById(employeeId);
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        if (!['admin', 'principal', 'accountant'].includes(req.user.role) && String(employee.userId) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Bạn chỉ có thể tạo đơn nghỉ cho hồ sơ nhân sự của mình' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (end < start) return res.status(400).json({ message: 'Ngày kết thúc phải sau ngày bắt đầu' });

        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        let substituteTeacherName = '';
        if (substituteTeacherId) {
            const sub = await Employee.findById(substituteTeacherId);
            if (sub) substituteTeacherName = sub.fullName;
        }

        const leaveRequest = await LeaveRequest.create({
            employeeId,
            employeeCode: employee.employeeCode,
            employeeName: employee.fullName,
            departmentName: employee.departmentName || '',
            leaveType,
            startDate: start,
            endDate: end,
            totalDays,
            reason,
            substituteTeacherId,
            substituteTeacherName
        });

        res.status(201).json({ message: 'Tạo đơn xin nghỉ phép thành công', data: leaveRequest });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getLeaveRequests = async (req, res) => {
    try {
        const { employeeId, status, leaveType } = req.query;
        const filter = {};
        if (employeeId) filter.employeeId = employeeId;
        if (status) filter.status = status;
        if (leaveType) filter.leaveType = leaveType;
        const requests = await LeaveRequest.find(filter).sort({ createdAt: -1 });
        res.json({ message: 'Lấy danh sách đơn nghỉ phép thành công', data: requests });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const processLeaveRequest = async (req, res) => {
    try {
        const { approved, rejectionReason } = req.body;
        const leaveRequest = await LeaveRequest.findById(req.params.id);
        if (!leaveRequest) return res.status(404).json({ message: 'Không tìm thấy đơn nghỉ phép' });
        if (leaveRequest.status !== 'pending') {
            return res.status(400).json({ message: 'Đơn này đã được xử lý' });
        }

        leaveRequest.status = approved ? 'approved' : 'rejected';
        leaveRequest.approvedBy = req.user._id;
        leaveRequest.approvedByName = req.user.profile?.fullName || req.user.username || '';
        leaveRequest.approvedAt = new Date();
        if (!approved && rejectionReason) leaveRequest.rejectionReason = rejectionReason;

        await leaveRequest.save();
        const employee = await Employee.findById(leaveRequest.employeeId).select('userId');
        if (employee?.userId) {
            await Notification.create({
                recipientId: employee.userId,
                title: approved ? 'Đơn nghỉ phép đã được duyệt' : 'Đơn nghỉ phép bị từ chối',
                message: approved ? `Đơn nghỉ ${leaveRequest.totalDays} ngày của bạn đã được duyệt.` : (leaveRequest.rejectionReason || 'Nhà trường chưa thể phê duyệt đơn nghỉ này.'),
                type: 'leave_request', link: '/hr', createdBy: req.user._id
            });
        }
        res.json({ message: approved ? 'Đã duyệt đơn nghỉ phép' : 'Đã từ chối đơn nghỉ phép', data: leaveRequest });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

// ==================== PAYROLL ====================

const generateMonthlyPayroll = async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ message: 'Tháng và năm là bắt buộc' });

        // A linked employee whose salary is not configured is a valid HR profile,
        // but must not create a zero-value payroll record by accident.
        const employees = await Employee.find({ status: 'active', 'salaryConfig.baseSalary': { $gt: 0 } });
        if (employees.length === 0) return res.status(400).json({ message: 'Không có nhân viên đang hoạt động' });

        // Get approved leaves for this month
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59);

        const results = [];
        const errors = [];

        for (const employee of employees) {
            try {
                // Skip if payroll already exists and is confirmed/paid
                const existing = await Payroll.findOne({ employeeId: employee._id, month, year });
                if (existing && existing.status !== 'draft') {
                    errors.push({ employee: employee.fullName, reason: 'Bảng lương đã được xác nhận hoặc thanh toán' });
                    continue;
                }

                // Count actual work days from AttendanceRecord
                const attendanceRecords = await AttendanceRecord.find({
                    userId: employee.userId,
                    workDate: { $gte: monthStart, $lte: monthEnd }
                });
                const actualWorkDays = attendanceRecords.reduce((sum, rec) => sum + (rec.workday || 1), 0);

                // Count approved paid leave days
                const approvedLeaves = await LeaveRequest.find({
                    employeeId: employee._id,
                    status: 'approved',
                    leaveType: { $in: ['annual', 'sick', 'maternity'] },
                    startDate: { $lte: monthEnd },
                    endDate: { $gte: monthStart }
                });
                const paidLeaveDays = approvedLeaves.reduce((sum, lr) => sum + lr.totalDays, 0);

                // Count unpaid leave
                const unpaidLeaves = await LeaveRequest.find({
                    employeeId: employee._id,
                    status: 'approved',
                    leaveType: { $in: ['personal', 'unpaid'] },
                    startDate: { $lte: monthEnd },
                    endDate: { $gte: monthStart }
                });
                const unpaidLeaveDays = unpaidLeaves.reduce((sum, lr) => sum + lr.totalDays, 0);

                const { baseSalary, positionAllowance, lunchAllowance } = employee.salaryConfig;
                const standardWorkDays = 26;

                // Formula: (baseSalary / standardWorkDays) * (actualWorkDays + paidLeaveDays)
                const earnedBase = (baseSalary / standardWorkDays) * Math.min(actualWorkDays + paidLeaveDays, standardWorkDays);
                const insuranceDeduction = Math.round(baseSalary * 0.105); // 10.5% BHXH+BHYT+BHTN cá nhân
                const grossSalary = Math.round(earnedBase + positionAllowance + lunchAllowance);
                const netSalary = Math.max(0, grossSalary - insuranceDeduction);

                const payrollData = {
                    employeeId: employee._id,
                    employeeCode: employee.employeeCode,
                    employeeName: employee.fullName,
                    departmentName: employee.departmentName || '',
                    position: employee.position,
                    month,
                    year,
                    baseSalary,
                    standardWorkDays,
                    actualWorkDays,
                    paidLeaveDays,
                    unpaidLeaveDays,
                    allowances: {
                        position: positionAllowance,
                        lunch: lunchAllowance,
                        other: 0
                    },
                    deductions: {
                        insurance: insuranceDeduction,
                        advancePayment: 0,
                        other: 0
                    },
                    grossSalary,
                    netSalary,
                    status: 'draft'
                };

                if (existing) {
                    await Payroll.findByIdAndUpdate(existing._id, payrollData, { new: true });
                    results.push({ employee: employee.fullName, action: 'updated', netSalary });
                } else {
                    await Payroll.create(payrollData);
                    results.push({ employee: employee.fullName, action: 'created', netSalary });
                }
            } catch (err) {
                errors.push({ employee: employee.fullName, reason: err.message });
            }
        }

        res.json({
            message: `Đã tính lương tháng ${month}/${year} cho ${results.length} nhân viên`,
            data: { results, errors }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getPayrollByMonth = async (req, res) => {
    try {
        const { month, year } = req.query;
        if (!month || !year) return res.status(400).json({ message: 'Tháng và năm là bắt buộc' });
        const payrolls = await Payroll.find({ month: Number(month), year: Number(year) }).sort({ employeeName: 1 });
        const totalNet = payrolls.reduce((sum, p) => sum + p.netSalary, 0);
        res.json({
            message: 'Lấy bảng lương thành công',
            data: { payrolls, summary: { totalEmployees: payrolls.length, totalNet } }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const updatePayrollStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['confirmed', 'paid'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ (confirmed | paid)' });
        }
        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) return res.status(404).json({ message: 'Không tìm thấy bảng lương' });
        if (payroll.status === 'paid') return res.status(400).json({ message: 'Bảng lương đã thanh toán, không thể thay đổi' });

        payroll.status = status;
        if (status === 'paid') payroll.paidAt = new Date();
        await payroll.save();
        res.json({ message: 'Cập nhật trạng thái bảng lương thành công', data: payroll });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const updatePayrollAdjustment = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) return res.status(404).json({ message: 'Không tìm thấy bảng lương' });
        if (payroll.status === 'paid') return res.status(400).json({ message: 'Bảng lương đã thanh toán' });

        const { allowances, deductions, note } = req.body;
        if (allowances) payroll.allowances = { ...payroll.allowances.toObject(), ...allowances };
        if (deductions) payroll.deductions = { ...payroll.deductions.toObject(), ...deductions };
        if (note !== undefined) payroll.note = note;

        // Recalculate
        const allowanceTotal = payroll.allowances.position + payroll.allowances.lunch + payroll.allowances.other;
        const deductionTotal = payroll.deductions.insurance + payroll.deductions.advancePayment + payroll.deductions.other;
        const earnedBase = (payroll.baseSalary / payroll.standardWorkDays) * Math.min(payroll.actualWorkDays + payroll.paidLeaveDays, payroll.standardWorkDays);
        payroll.grossSalary = Math.round(earnedBase + allowanceTotal);
        payroll.netSalary = Math.max(0, payroll.grossSalary - deductionTotal);

        await payroll.save();
        res.json({ message: 'Cập nhật bảng lương thành công', data: payroll });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

module.exports = {
    getDepartments,
    createDepartment,
    updateDepartment,
    getStaffAccounts,
    syncStaffAccounts,
    getEmployees,
    getEmployeeById,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    createLeaveRequest,
    getLeaveRequests,
    processLeaveRequest,
    generateMonthlyPayroll,
    getPayrollByMonth,
    updatePayrollStatus,
    updatePayrollAdjustment
};
