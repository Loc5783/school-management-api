const mongoose = require('mongoose');
const Employee = require('../models/zone2_hr/Employee');
const StaffHandover = require('../models/zone2_hr/StaffHandover');
const Department = require('../models/zone2_hr/Department');
const User = require('../models/zone1_system/User');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const Payroll = require('../models/zone2_hr/Payroll');
const PayrollEvent = require('../models/zone2_hr/PayrollEvent');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const OvertimeRequest = require('../models/zone2_hr/OvertimeRequest');
const OvertimeRate = require('../models/zone2_hr/OvertimeRate');
const Notification = require('../models/zone1_system/Notification');
const AuditLog = require('../models/zone1_system/AuditLog');
const { datesBetween, scheduledLeaveDates, leaveDatesInYear } = require('../services/staffLeaveService');
const { getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { getStaffingSnapshot } = require('../services/staffingService');
const { REVIEW_MONTHLY_SALARY_BELOW, isUnverifiedLowMonthlySalary } = require('../services/salaryPolicy');
const { lockOpenPeriod } = require('../services/accountingPeriodService');

// `admin` is retained as the legacy system-owner role and is treated as the principal
// for HR purposes. Parent accounts must never enter the employee/payroll workflow.
const STAFF_ACCOUNT_ROLES = ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'];
const ROLE_POSITIONS = {
    admin: new Set(['principal', 'vice_principal']),
    principal: new Set(['principal', 'vice_principal']),
    teacher: new Set(['teacher', 'head_teacher', 'assistant_teacher']),
    accountant: new Set(['accountant']),
    chef: new Set(['chef']),
    guard: new Set(['security']),
    hr: new Set(['hr'])
};
const DEFAULT_POSITION_BY_ROLE = { admin: 'principal', principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'security', hr: 'hr' };
const DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE = { admin: 'principal', principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'guard', hr: 'hr' };
const EMPLOYEE_CODE_PREFIX_BY_ROLE = { admin: 'HT', principal: 'HT', teacher: 'GV', accountant: 'KT', chef: 'BEP', guard: 'BV', hr: 'NS' };
const EMPLOYEE_FIELDS = ['employeeCode', 'fullName', 'phone', 'email', 'address', 'departmentId', 'position', 'payrollRole', 'salaryConfig', 'startDate', 'contractType', 'contractNumber', 'contractSignedDate', 'contractStartDate', 'endDate'];
const PROFILE_HISTORY_FIELDS = ['employeeCode', 'fullName', 'phone', 'email', 'address', 'position', 'payrollRole', 'startDate', 'contractType', 'contractNumber', 'contractSignedDate', 'contractStartDate', 'endDate', 'status'];
const profileSnapshot = (employee) => Object.fromEntries(PROFILE_HISTORY_FIELDS.map((key) => [key, employee?.[key] ?? null]).concat([
    ['userId', employee?.userId?._id || employee?.userId || null],
    ['baseSalary', employee?.salaryConfig?.baseSalary ?? null],
    ['standardWorkDays', employee?.salaryConfig?.standardWorkDays ?? 26],
    ['lowMonthlySalaryConfirmed', employee?.salaryConfig?.lowMonthlySalaryConfirmed === true]
]));
const changedSnapshot = (before, after) => {
    const keys = Object.keys(after).filter((key) => String(before[key] ?? '') !== String(after[key] ?? ''));
    return { before: Object.fromEntries(keys.map((key) => [key, before[key]])), after: Object.fromEntries(keys.map((key) => [key, after[key]])) };
};
const normalizeProfileDates = (data) => {
    for (const key of ['startDate', 'contractSignedDate', 'contractStartDate', 'endDate']) {
        if (!Object.hasOwn(data, key)) continue;
        if (!data[key]) { data[key] = null; continue; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data[key]))) throw httpError(`${key} phải có định dạng YYYY-MM-DD`, 422);
        const parsed = new Date(`${data[key]}T12:00:00.000Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== data[key]) throw httpError(`${key} không hợp lệ`, 422);
        data[key] = parsed;
    }
    if (data.contractType === '') data.contractType = null;
    if (data.contractType === 'indefinite') data.endDate = null;
};

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const isValidObjectId = (value) => mongoose.isValidObjectId(value);
const pickEmployeeFields = (body = {}) => Object.fromEntries(EMPLOYEE_FIELDS.filter((field) => Object.hasOwn(body, field)).map((field) => [field, body[field]]));
const PAYROLL_ROLES = new Set(['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']);
const payrollRoleFromPosition = (position) => ({
    principal: 'principal', vice_principal: 'principal', head_teacher: 'teacher', teacher: 'teacher', assistant_teacher: 'teacher',
    accountant: 'accountant', chef: 'chef', security: 'guard', hr: 'hr'
}[position] || 'teacher');

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
    if (data.contractStartDate && data.endDate && new Date(data.endDate) < new Date(data.contractStartDate)) throw httpError('Ngày hết hạn hợp đồng không được trước ngày hiệu lực', 422);
    if (data.contractSignedDate && data.contractStartDate && new Date(data.contractStartDate) < new Date(data.contractSignedDate)) throw httpError('Ngày hiệu lực hợp đồng không được trước ngày ký', 422);
    const salary = data.salaryConfig || {};
    if (salary.baseSalary !== undefined && (!Number.isSafeInteger(Number(salary.baseSalary)) || Number(salary.baseSalary) < 0 || Number(salary.baseSalary) > 1000000000)) throw httpError('Lương tháng phải là số nguyên từ 0 đến 1.000.000.000đ', 422);
    if (salary.lowMonthlySalaryConfirmed !== undefined && typeof salary.lowMonthlySalaryConfirmed !== 'boolean') throw httpError('Xác nhận mức lương tháng không hợp lệ', 422);
    if (salary.standardWorkDays !== undefined && (!Number.isInteger(Number(salary.standardWorkDays)) || Number(salary.standardWorkDays) < 1 || Number(salary.standardWorkDays) > 31)) throw httpError('Số ngày công chuẩn phải từ 1 đến 31', 422);
    if (['positionAllowance', 'lunchAllowance'].some((field) => salary[field] !== undefined && (!Number.isSafeInteger(Number(salary[field])) || Number(salary[field]) < 0 || Number(salary[field]) > 1000000000))) throw httpError('Phụ cấp phải là số nguyên không âm', 422);
    if (isUnverifiedLowMonthlySalary(salary)) throw httpError(`Mức lương ${Number(salary.baseSalary).toLocaleString('vi-VN')}đ/tháng dưới ${REVIEW_MONTHLY_SALARY_BELOW.toLocaleString('vi-VN')}đ, dễ nhầm với tiền một công. Hãy kiểm tra đơn vị và xác nhận rõ trước khi lưu.`, 422);
    if (linkedUser && !ROLE_POSITIONS[linkedUser.role]?.has(data.position)) {
        throw httpError(`Vị trí không phù hợp với vai trò tài khoản ${linkedUser.role}`, 422);
    }
    if (!PAYROLL_ROLES.has(data.payrollRole)) throw httpError('Vai trò tính lương không hợp lệ', 422);
    const accountPayrollRole = linkedUser && DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[linkedUser.role];
    if (accountPayrollRole && data.payrollRole !== accountPayrollRole) {
        throw httpError('Vai trò tính lương phải trùng với vai trò của tài khoản đã liên kết', 422);
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
            .select('userId employeeCode fullName departmentId departmentName position payrollRole status')
            .lean();
        const profileByUserId = new Map(linkedProfiles.map((profile) => [String(profile.userId), profile]));
        res.json({
            message: 'Lấy danh sách tài khoản nhân sự thành công',
            data: users.map((user) => ({
                ...user,
                suggestedPosition: DEFAULT_POSITION_BY_ROLE[user.role],
                suggestedPayrollRole: DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[user.role],
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
                    payrollRole: DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[account.role],
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

const employeeView = (employee, role) => {
    const item = employee.toObject ? employee.toObject() : employee;
    const linkedRole = DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[item.userId?.role];
    if (linkedRole) item.payrollRole = linkedRole;
    if (role !== 'accountant') return item;
    const result = Object.fromEntries(['_id', 'employeeCode', 'fullName', 'status', 'position', 'payrollRole', 'startDate', 'contractType', 'contractStartDate', 'endDate', 'salaryConfig', 'departmentId'].map((key) => [key, item[key]]));
    result.userId = item.userId ? Object.fromEntries(['_id', 'username', 'role', 'status'].map((key) => [key, item.userId[key]])) : null;
    return result;
};
const getEmployees = async (req, res) => {
    try {
        const { status, position, payrollRole, departmentId, search } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (position) filter.position = position;
        if (payrollRole) filter.payrollRole = payrollRole;
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
        // Với hồ sơ tạo trước khi có payrollRole, Mongoose có thể trả default
        // "teacher" dù chưa hề lưu xuống DB. Tài khoản liên kết là nguồn chuẩn.
        const data = employees.map((employee) => {
            const item = employee.toObject();
            const linkedRole = DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[item.userId?.role];
            if (linkedRole) item.payrollRole = linkedRole;
            return employeeView(item, req.user.role);
        });
        res.json({ message: 'Lấy danh sách nhân viên thành công', data });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getEmployeeById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhân viên không hợp lệ' });
        const employee = await Employee.findById(req.params.id).populate('departmentId', 'name code').populate('userId', 'username role status profile employeeInfo');
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        res.json({ message: 'Lấy thông tin nhân viên thành công', data: employeeView(employee, req.user.role) });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getEmployeeHistory = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhân viên không hợp lệ' });
        const employee = await Employee.findById(req.params.id).select('createdAt');
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        const history = await AuditLog.find({ targetType: 'Employee', targetId: employee._id,
            action: { $in: ['EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'EMPLOYEE_RESIGNED'] } })
            .select('action actorUsername before after reason occurredAt').sort({ occurredAt: -1 }).limit(100).lean();
        res.json({ data: history, createdAt: employee.createdAt });
    } catch (error) { res.status(500).json({ message: 'Không thể tải lịch sử hồ sơ' }); }
};

const createEmployee = async (req, res) => {
    try {
        const data = pickEmployeeFields(req.body);
        normalizeProfileDates(data);
        const requestedUserId = Object.hasOwn(req.body, 'userId') ? req.body.userId : null;
        const employee = await runHrTransaction(async (session) => {
            const linkedUser = await resolveStaffAccount(requestedUserId, null, session);
            data.employeeCode = String(data.employeeCode || linkedUser?.employeeInfo?.employeeId || '').trim().toUpperCase();
            data.fullName = String(data.fullName || linkedUser?.profile?.fullName || '').trim();
            data.phone = String(data.phone || linkedUser?.profile?.phone || '').trim();
            data.email = String(data.email || linkedUser?.profile?.email || '').trim().toLowerCase();
            data.position = data.position || linkedUser?.employeeInfo?.position || DEFAULT_POSITION_BY_ROLE[linkedUser?.role] || 'teacher';
            data.payrollRole = data.payrollRole || DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[linkedUser?.role] || payrollRoleFromPosition(data.position);
            data.salaryConfig = data.salaryConfig || { baseSalary: 0, positionAllowance: 0, lunchAllowance: 0 };
            validateEmployeeData(data, linkedUser);
            const existing = await Employee.exists({ employeeCode: data.employeeCode });
            if (existing) throw httpError('Mã nhân viên đã tồn tại', 409);
            const department = await resolveDepartment(data.departmentId, session);
            const created = (await Employee.create([{ ...data, ...department, userId: linkedUser?._id }], { session }))[0];
            await syncLinkedUser(linkedUser, created, session);
            await AuditLog.create([{ actorId: req.user._id, actorUsername: req.user.username,
                action: 'EMPLOYEE_CREATED', targetType: 'Employee', targetId: created._id,
                after: profileSnapshot(created) }], { session });
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
        normalizeProfileDates(fields);
        const userIdWasProvided = Object.hasOwn(req.body, 'userId');
        const employee = await runHrTransaction(async (session) => {
            const current = await Employee.findById(req.params.id).session(session);
            if (await StaffHandover.exists({ employeeId: req.params.id, status: 'scheduled' }).session(session)) throw httpError('Hồ sơ đang chờ bàn giao có hiệu lực. Hãy hủy lịch bàn giao trước khi sửa.', 409);
            if (!current) throw httpError('Không tìm thấy nhân viên', 404);
            const formerLinkedUser = current.userId ? await User.findById(current.userId).session(session) : null;
            const linkedUser = userIdWasProvided
                ? (req.body.userId ? await resolveStaffAccount(req.body.userId, current._id, session) : null)
                : formerLinkedUser;
            const next = { ...current.toObject(), ...fields };
            if (fields.salaryConfig && Number(fields.salaryConfig.baseSalary) !== Number(current.salaryConfig?.baseSalary) && fields.salaryConfig.lowMonthlySalaryConfirmed !== true) fields.salaryConfig.lowMonthlySalaryConfirmed = false;
            if (fields.salaryConfig) next.salaryConfig = { ...current.salaryConfig.toObject(), ...fields.salaryConfig };
            next.employeeCode = String(next.employeeCode || '').trim().toUpperCase();
            next.fullName = String(next.fullName || '').trim();
            next.phone = String(next.phone || '').trim();
            next.email = String(next.email || '').trim().toLowerCase();
            next.payrollRole = next.payrollRole || DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[linkedUser?.role] || payrollRoleFromPosition(next.position);
            if (next.contractType === 'indefinite') { fields.endDate = null; next.endDate = null; }
            // Hồ sơ legacy sẽ được migration backfill; dòng này bảo đảm lần sửa
            // hợp lệ đầu tiên cũng chuẩn hóa luôn, không chờ migration.
            if (!current.payrollRole) fields.payrollRole = next.payrollRole;
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
            const changes = changedSnapshot(profileSnapshot(current), profileSnapshot(updated));
            if (Object.keys(changes.after).length) await AuditLog.create([{ actorId: req.user._id, actorUsername: req.user.username,
                action: 'EMPLOYEE_UPDATED', targetType: 'Employee', targetId: updated._id,
                before: changes.before, after: changes.after }], { session });
            return updated;
        });
        res.json({ message: 'Cập nhật nhân viên thành công', data: employee });
    } catch (error) {
        res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ message: error.message || 'Không thể cập nhật hồ sơ nhân viên' });
    }
};

const deleteEmployee = async (req, res) => {
    return res.status(409).json({ message: 'Không thể cho nghỉ việc trực tiếp. Hãy hoàn tất quy trình Bàn giao / Nghỉ việc trong Nhân sự & Lương.' });
};

// ==================== LEAVE REQUESTS ====================

const createLeaveRequest = async (req, res) => {
    try {
        const { employeeId, leaveType, startDate, endDate, reason } = req.body;
        if (!employeeId || !leaveType || !startDate || !endDate || !reason) {
            return res.status(400).json({ message: 'Thiếu thông tin đơn xin nghỉ phép' });
        }
        if (!isValidObjectId(employeeId) || !isValidWorkDate(startDate) || !isValidWorkDate(endDate) || !datesBetween(startDate, endDate)) {
            return res.status(422).json({ message: 'Khoảng ngày nghỉ không hợp lệ hoặc dài quá 366 ngày' });
        }
        if (!['annual', 'sick', 'maternity', 'personal', 'unpaid', 'compensatory'].includes(leaveType)) return res.status(422).json({ message: 'Loại nghỉ không hợp lệ' });
        const cleanReason = String(reason).trim();
        if (cleanReason.length < 5 || cleanReason.length > 500) return res.status(422).json({ message: 'Lý do phải từ 5 đến 500 ký tự' });
        const employee = await Employee.findById(employeeId).populate('userId', 'role status');
        if (!employee || employee.status === 'resigned') return res.status(404).json({ message: 'Không tìm thấy nhân viên đang làm việc' });
        if (!['admin', 'principal'].includes(req.user.role) && String(employee.userId?._id) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Bạn chỉ có thể tạo đơn nghỉ cho hồ sơ nhân sự của mình' });
        }
        const existing = await LeaveRequest.exists({ employeeId, status: { $in: ['pending', 'approved'] }, startDate: { $lte: new Date(`${endDate}T23:59:59.999Z`) }, endDate: { $gte: new Date(`${startDate}T00:00:00.000Z`) } });
        if (existing) return res.status(409).json({ message: 'Nhân viên đã có đơn chờ duyệt hoặc đã duyệt trùng khoảng ngày này' });
        const workDates = await scheduledLeaveDates(employee, startDate, endDate);
        if (!workDates?.length) return res.status(422).json({ message: 'Khoảng nghỉ không có ngày làm việc theo phân công hiện tại' });
        const leaveRequest = await runHrTransaction(async (session) => {
        const [created] = await LeaveRequest.create([{
            employeeId,
            employeeCode: employee.employeeCode,
            employeeName: employee.fullName,
            departmentName: employee.departmentName || '',
            leaveType,
            startDate: new Date(`${startDate}T12:00:00.000Z`),
            endDate: new Date(`${endDate}T12:00:00.000Z`),
            totalDays: workDates.length,
            workDates,
            reason: cleanReason,
            requestedBy: req.user._id
        }], { session });
        await require('../services/credentialService').audit(req.user, 'EMPLOYEE_LEAVE_CREATED', 'LeaveRequest', created._id, {}, created.toObject(), session);
        return created;
        });

        try {
            const reviewers = await User.find({ role: { $in: ['admin', 'principal'] }, status: 'active', _id: { $ne: req.user._id } }).select('_id').lean();
            if (reviewers.length) await Notification.insertMany(reviewers.map((reviewer) => ({ recipientId: reviewer._id,
                title: 'Đơn nghỉ nhân viên chờ duyệt', message: `${employee.fullName} xin nghỉ ${workDates.length} ngày (${startDate} đến ${endDate}).`,
                type: 'leave_request', link: '/hr?tab=leave', createdBy: req.user._id })));
        } catch (notificationError) { console.error('Không gửi được thông báo đơn nghỉ:', notificationError); }

        res.status(201).json({ message: 'Tạo đơn xin nghỉ phép thành công', data: leaveRequest });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getLeaveRequests = async (req, res) => {
    try {
        const { employeeId, status, leaveType, year } = req.query;
        const filter = {};
        if (employeeId) filter.employeeId = employeeId;
        if (status) filter.status = status;
        if (leaveType) filter.leaveType = leaveType;
        if (year) {
            const selectedYear = Number(year);
            if (!Number.isInteger(selectedYear) || selectedYear < 2000 || selectedYear > 2100) return res.status(422).json({ message: 'Năm không hợp lệ' });
            filter.startDate = { $lte: new Date(`${selectedYear}-12-31T23:59:59.999Z`) };
            filter.endDate = { $gte: new Date(`${selectedYear}-01-01T00:00:00.000Z`) };
        }
        const requestedLimit = Number(req.query.limit);
        if (req.query.limit !== undefined) {
            const page = Number(req.query.page || 1);
            if (!Number.isInteger(page) || page < 1 || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) return res.status(422).json({ message: 'Phân trang không hợp lệ' });
            const [requests, total] = await Promise.all([
                LeaveRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * requestedLimit).limit(requestedLimit),
                LeaveRequest.countDocuments(filter)
            ]);
            return res.json({ message: 'Lấy danh sách đơn nghỉ phép thành công', data: requests, pagination: { page, limit: requestedLimit, total, totalPages: Math.ceil(total / requestedLimit) } });
        }
        const requests = await LeaveRequest.find(filter).sort({ createdAt: -1 });
        res.json({ message: 'Lấy danh sách đơn nghỉ phép thành công', data: requests });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const processLeaveRequest = async (req, res) => {
    try {
        const { approved, rejectionReason } = req.body;
        if (typeof approved !== 'boolean') return res.status(422).json({ message: 'Quyết định duyệt phải là đúng hoặc sai' });
        if (!approved && String(rejectionReason || '').trim().length < 5) return res.status(422).json({ message: 'Cần ghi lý do từ chối ít nhất 5 ký tự' });
        const leaveRequest = await LeaveRequest.findById(req.params.id);
        if (!leaveRequest) return res.status(404).json({ message: 'Không tìm thấy đơn nghỉ phép' });
        if (leaveRequest.status !== 'pending') {
            return res.status(409).json({ message: 'Đơn này đã được xử lý' });
        }
        const employee = await Employee.findById(leaveRequest.employeeId).select('userId status');
        if (!employee || employee.status === 'resigned') return res.status(409).json({ message: 'Nhân viên đã nghỉ việc, không thể duyệt đơn' });
        if (String(employee.userId) === String(req.user._id)) return res.status(403).json({ message: 'Không được tự duyệt đơn nghỉ của mình' });
        if (approved) {
            const overlap = await LeaveRequest.exists({ _id: { $ne: leaveRequest._id }, employeeId: leaveRequest.employeeId, status: 'approved', startDate: { $lte: leaveRequest.endDate }, endDate: { $gte: leaveRequest.startDate } });
            if (overlap) return res.status(409).json({ message: 'Đã có đơn nghỉ được duyệt trùng ngày' });
        }
        const updated = await runHrTransaction(async (session) => {
            const result = await LeaveRequest.findOneAndUpdate({ _id: leaveRequest._id, status: 'pending' }, { $set: {
                status: approved ? 'approved' : 'rejected', approvedBy: req.user._id,
                approvedByName: req.user.profile?.fullName || req.user.username || '', approvedAt: new Date(),
                rejectionReason: approved ? '' : String(rejectionReason).trim().slice(0, 500)
            } }, { new: true, session });
            if (!result) throw httpError('Đơn đã được người khác xử lý', 409);
            await AuditLog.create([{ actorId: req.user._id, actorUsername: req.user.username || 'staff',
                action: approved ? 'EMPLOYEE_LEAVE_APPROVED' : 'EMPLOYEE_LEAVE_REJECTED', targetType: 'LeaveRequest', targetId: result._id,
                before: { status: 'pending' }, after: { status: result.status, totalDays: result.totalDays, startDate: result.startDate, endDate: result.endDate },
                reason: approved ? 'Duyệt đơn nghỉ phép' : result.rejectionReason }], { session });
            return result;
        });
        if (employee?.userId) {
            await Notification.create({
                recipientId: employee.userId,
                title: approved ? 'Đơn nghỉ phép đã được duyệt' : 'Đơn nghỉ phép bị từ chối',
                message: approved ? `Đơn nghỉ ${updated.totalDays} ngày của bạn đã được duyệt.` : updated.rejectionReason,
                type: 'leave_request', link: '/timekeeping?tab=leave', createdBy: req.user._id
            }).catch((notificationError) => console.error('Không gửi được thông báo đơn nghỉ:', notificationError));
        }
        if (approved) {
            try {
                const hrUsers = await User.find({ role: 'hr', status: 'active', _id: { $ne: req.user._id } }).select('_id').lean();
                if (hrUsers.length) await Notification.insertMany(hrUsers.map((hrUser) => ({ recipientId: hrUser._id,
                    title: 'Cần kiểm tra phân công khi nhân viên nghỉ',
                    message: `${updated.employeeName} nghỉ ${updated.totalDays} ngày; kiểm tra lớp hoặc ca cần người thay.`,
                    type: 'leave_request', link: '/hr?tab=leave', createdBy: req.user._id })));
            } catch (notificationError) { console.error('Không gửi được thông báo sắp xếp người thay:', notificationError); }
        }
        res.json({ message: approved ? 'Đã duyệt đơn nghỉ phép; lịch phân công và cảnh báo thiếu người sẽ cập nhật theo ngày nghỉ' : 'Đã từ chối đơn nghỉ phép', data: updated });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể xử lý đơn nghỉ phép' });
    }
};

// ==================== PAYROLL ====================

const generateMonthlyPayroll = async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!Number.isInteger(Number(month)) || Number(month) < 1 || Number(month) > 12 || !Number.isInteger(Number(year)) || Number(year) < 2000 || Number(year) > 2100) return res.status(400).json({ message: 'Tháng và năm không hợp lệ' });

        // A linked employee whose salary is not configured is a valid HR profile,
        // but must not create a zero-value payroll record by accident.
        const employees = await Employee.find({ status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } })
            .populate('userId', 'role');
        if (employees.length === 0) return res.status(400).json({ message: 'Không có nhân viên đang hoạt động' });

        // Get approved leaves for this month
        const periodPrefix = `${year}-${String(month).padStart(2, '0')}-`;
        const monthStart = startOfWorkDate(`${periodPrefix}01`);
        const nextMonthLabel = new Date(Date.UTC(Number(year), Number(month), 1)).toISOString().slice(0, 10);
        const monthEndExclusive = startOfWorkDate(nextMonthLabel);

        const results = [];
        const errors = [];

        for (const employee of employees) {
            try {
                if (!Number.isSafeInteger(Number(employee.salaryConfig?.baseSalary)) || Number(employee.salaryConfig?.baseSalary) <= 0) throw new Error('Chưa thiết lập lương cơ bản theo tháng trong hồ sơ nhân sự');
                if (isUnverifiedLowMonthlySalary(employee.salaryConfig)) throw new Error(`Lương ${employee.salaryConfig.baseSalary.toLocaleString('vi-VN')}đ/tháng dễ nhầm với tiền một công. HR cần mở hồ sơ, chọn đúng đơn vị và xác nhận trước khi lập lương.`);
                // Accounting-reviewed payroll cannot be silently recalculated by HR.
                const existing = await Payroll.findOne({ employeeId: employee._id, month, year });
                if (existing && existing.status !== 'draft') {
                    errors.push({ employee: employee.fullName, reason: 'Bảng lương đã được kế toán đối soát, xác nhận hoặc chi trả' });
                    continue;
                }

                // Count actual work days from AttendanceRecord
                const attendanceRecords = await AttendanceRecord.find({
                    userId: employee.userId,
                    workDate: { $gte: monthStart, $lt: monthEndExclusive },
                    finalized: true,
                    status: 'present',
                    checkInTime: { $ne: null },
                    checkOutTime: { $ne: null }
                });
                const attendedDates = new Set(attendanceRecords.map((rec) => getWorkDate(rec.workDate)));
                const actualWorkDays = attendanceRecords.reduce((sum, rec) => sum + (rec.workday ?? 1), 0);

                // Count approved paid leave days
                const approvedLeaves = await LeaveRequest.find({
                    employeeId: employee._id,
                    status: 'approved',
                    leaveType: { $in: ['annual', 'sick', 'maternity'] },
                    startDate: { $lt: monthEndExclusive },
                    endDate: { $gte: monthStart }
                });
                const paidLeaveDates = new Set(approvedLeaves.flatMap((lr) => leaveDatesInYear(lr, Number(year)).filter((date) => date.startsWith(periodPrefix))));
                const paidLeaveDays = [...paidLeaveDates].filter((date) => !attendedDates.has(date)).length;

                // Count unpaid leave
                const unpaidLeaves = await LeaveRequest.find({
                    employeeId: employee._id,
                    status: 'approved',
                    leaveType: { $in: ['personal', 'unpaid'] },
                    startDate: { $lt: monthEndExclusive },
                    endDate: { $gte: monthStart }
                });
                const unpaidLeaveDates = new Set(unpaidLeaves.flatMap((lr) => leaveDatesInYear(lr, Number(year)).filter((date) => date.startsWith(periodPrefix))));
                const unpaidLeaveDays = [...unpaidLeaveDates].filter((date) => !attendedDates.has(date) && !paidLeaveDates.has(date)).length;

                const { baseSalary, positionAllowance, lunchAllowance } = employee.salaryConfig;
                const standardWorkDays = employee.salaryConfig.standardWorkDays || 26;

                const approvedOvertime = await OvertimeRequest.find({ employeeId: employee._id, status: 'approved', workDate: { $regex: `^${periodPrefix}` } }).lean();
                const overtimeMinutes = approvedOvertime.reduce((sum, request) => sum + request.approvedMinutes, 0);
                const overtimeRate = await OvertimeRate.findOne({ employeeId: employee._id, month, year }).lean();
                if (overtimeMinutes > 0 && !overtimeRate) throw new Error('Có giờ làm thêm đã duyệt nhưng HR chưa đặt đơn giá cho kỳ lương');
                const overtimeHourlyAmount = overtimeRate?.hourlyAmount || 0;
                const overtimePay = Math.round((overtimeMinutes / 60) * overtimeHourlyAmount);

                // Formula: (baseSalary / standardWorkDays) * (actualWorkDays + paidLeaveDays)
                const earnedBase = (baseSalary / standardWorkDays) * Math.min(actualWorkDays + paidLeaveDays, standardWorkDays);
                // A legacy 10.5% estimate is shown only as a draft. HR/accounting must
                // confirm the employee's actual contribution base and amount before approval.
                const insuranceDeduction = existing?.insuranceConfirmed
                    ? existing.deductions.insurance : Math.round(baseSalary * 0.105);
                const otherAllowance = existing?.allowances?.other || 0;
                const advancePayment = existing?.deductions?.advancePayment || 0;
                const otherDeduction = existing?.deductions?.other || 0;
                const grossSalary = Math.round(earnedBase + positionAllowance + lunchAllowance + overtimePay + otherAllowance);
                const deductionShortfall = Math.max(0, insuranceDeduction + advancePayment + otherDeduction - grossSalary);
                const netSalary = Math.max(0, grossSalary - insuranceDeduction - advancePayment - otherDeduction);

                const payrollRole = DEFAULT_PAYROLL_ROLE_BY_ACCOUNT_ROLE[employee.userId?.role]
                    || employee.payrollRole
                    || payrollRoleFromPosition(employee.position);
                const payrollData = {
                    employeeId: employee._id,
                    employeeCode: employee.employeeCode,
                    employeeName: employee.fullName,
                    departmentName: employee.departmentName || '',
                    position: employee.position,
                    payrollRole,
                    month,
                    year,
                    baseSalary,
                    standardWorkDays,
                    actualWorkDays,
                    paidLeaveDays,
                    unpaidLeaveDays,
                    overtimeMinutes,
                    overtimeHourlyAmount,
                    overtimePay,
                    allowances: {
                        position: positionAllowance,
                        lunch: lunchAllowance,
                        other: otherAllowance
                    },
                    deductions: {
                        insurance: insuranceDeduction,
                        advancePayment,
                        other: otherDeduction
                    },
                    grossSalary,
                    netSalary,
                    deductionShortfall,
                    insuranceConfirmed: existing?.insuranceConfirmed || false,
                    insuranceBasisNote: existing?.insuranceBasisNote || '',
                    status: 'draft',
                    note: existing?.note || ''
                };

                if (existing) {
                    await runHrTransaction(async (session) => {
                      await lockOpenPeriod(`${year}-${String(month).padStart(2, '0')}`, session);
                      const saved = await Payroll.findOneAndUpdate({ _id: existing._id, status: 'draft', updatedAt: existing.updatedAt }, { $set: payrollData }, { new: true, runValidators: true, session });
                      if (!saved) throw httpError('Bảng lương vừa thay đổi. Hãy tải lại.', 409);
                      await PayrollEvent.create([{ payrollId: saved._id, actorId: req.user._id, action: 'generated', before: existing.toObject ? existing.toObject() : existing, after: saved.toObject(), reason: 'Tính lại bảng lương nháp' }], { session });
                    });
                    results.push({ employee: employee.fullName, action: 'updated', netSalary });
                } else {
                    await runHrTransaction(async (session) => {
                      await lockOpenPeriod(`${year}-${String(month).padStart(2, '0')}`, session);
                      const [created] = await Payroll.create([payrollData], { session });
                      await PayrollEvent.create([{ payrollId: created._id, actorId: req.user._id, action: 'generated', after: created.toObject(), reason: 'Lập bảng lương nháp' }], { session });
                    });
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
        const payrolls = await Payroll.find({ month: Number(month), year: Number(year) }).sort({ payrollRole: 1, employeeName: 1 });
        const salaryReviewCount = payrolls.filter((payroll) => payroll.baseSalary > 0 && payroll.baseSalary < REVIEW_MONTHLY_SALARY_BELOW).length;
        const totalNet = payrolls.reduce((sum, p) => sum + p.netSalary, 0);
        const byRole = payrolls.reduce((summary, payroll) => {
            const role = payroll.payrollRole || payrollRoleFromPosition(payroll.position);
            if (!summary[role]) summary[role] = { role, employees: 0, grossSalary: 0, netSalary: 0 };
            summary[role].employees += 1;
            summary[role].grossSalary += payroll.grossSalary || 0;
            summary[role].netSalary += payroll.netSalary || 0;
            return summary;
        }, {});
        res.json({
            message: 'Lấy bảng lương thành công',
            data: { payrolls, summary: { totalEmployees: payrolls.length, totalNet, byRole: Object.values(byRole), salaryReviewCount } }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getLeaveOverview = async (req, res) => {
    try {
        const year = Number(req.query.year || new Date().getFullYear());
        const date = String(req.query.date || getWorkDate());
        if (!Number.isInteger(year) || year < 2000 || year > 2100 || !isValidWorkDate(date)) return res.status(422).json({ message: 'Năm hoặc ngày theo dõi không hợp lệ' });
        const [employees, requests, staffing] = await Promise.all([
            Employee.find().select('_id employeeCode fullName payrollRole status').lean(),
            LeaveRequest.find({ startDate: { $lte: new Date(`${year}-12-31T23:59:59.999Z`) }, endDate: { $gte: new Date(`${year}-01-01T00:00:00.000Z`) } }).select('employeeId employeeName leaveType startDate endDate totalDays workDates status approvedByName approvedAt').lean(),
            getStaffingSnapshot(date)
        ]);
        const byEmployee = new Map(employees.map((employee) => [String(employee._id), { ...employee, approvedDays: 0, pendingDays: 0, byType: {}, legacyDays: 0 }]));
        for (const request of requests) {
            const row = byEmployee.get(String(request.employeeId));
            if (!row || !['pending', 'approved'].includes(request.status)) continue;
            const days = leaveDatesInYear(request, year).length;
            if (request.status === 'approved') {
                row.approvedDays += days;
                row.byType[request.leaveType] = (row.byType[request.leaveType] || 0) + days;
                if (!request.workDates?.length) row.legacyDays += days;
            } else row.pendingDays += days;
        }
        return res.json({ data: { year, date, employees: [...byEmployee.values()],
            impact: { teacherShortages: staffing.teacherShortages, missingTeacherTotal: staffing.missingTeacherTotal,
                uncoveredShifts: staffing.duties.filter((shift) => shift.uncovered).map((shift) => ({ _id: shift._id, name: shift.name, employeeName: shift.employeeName })) } } });
    } catch (error) { return res.status(500).json({ message: 'Không thể tổng hợp nghỉ phép và phân công' }); }
};

const getMyLeaveRequests = async (req, res) => {
    try {
        const employee = await Employee.findOne({ userId: req.user._id }).select('_id employeeCode fullName position');
        if (!employee) return res.status(404).json({ message: 'Tài khoản chưa được liên kết với hồ sơ nhân sự. Vui lòng liên hệ bộ phận HR.' });
        const requests = await LeaveRequest.find({ employeeId: employee._id }).sort({ createdAt: -1 }).limit(50);
        return res.json({ success: true, data: { employee, requests } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Không thể tải đơn nghỉ phép cá nhân' });
    }
};

// Staff can inspect only their own payslip. Payroll administration remains
// restricted to HR/accounting roles in the endpoints above.
const getMyPayroll = async (req, res) => {
    try {
        const month = Number(req.query.month || (new Date().getMonth() + 1));
        const year = Number(req.query.year || new Date().getFullYear());
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
            return res.status(400).json({ message: 'Tháng hoặc năm không hợp lệ' });
        }
        const employee = await Employee.findOne({ userId: req.user._id }).select('_id employeeCode fullName position payrollRole status');
        if (!employee) return res.status(404).json({ message: 'Tài khoản chưa được liên kết với hồ sơ nhân sự. Vui lòng liên hệ bộ phận HR.' });
        const payroll = await Payroll.findOne({ employeeId: employee._id, month, year, status: { $in: ['confirmed', 'paid'] } }).lean();
        return res.json({ success: true, message: payroll ? 'Lấy phiếu lương thành công' : 'Chưa có phiếu lương cho kỳ này', data: { employee, payroll, month, year } });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Không thể lấy phiếu lương cá nhân' });
    }
};

const updatePayrollStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['reviewed', 'confirmed', 'paid'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái không hợp lệ (reviewed | confirmed | paid)' });
        }
        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) return res.status(404).json({ message: 'Không tìm thấy bảng lương' });
        if (payroll.status === 'paid') return res.status(400).json({ message: 'Bảng lương đã thanh toán, không thể thay đổi' });

        if (status === 'reviewed') {
            const profile = await Employee.findById(payroll.employeeId).select('salaryConfig');
            if (isUnverifiedLowMonthlySalary(profile?.salaryConfig) || (payroll.baseSalary > 0 && payroll.baseSalary < REVIEW_MONTHLY_SALARY_BELOW && Number(profile?.salaryConfig?.baseSalary) !== payroll.baseSalary)) return res.status(409).json({ message: 'Mức lương tháng trên phiếu dễ nhầm với tiền một công. HR cần xác minh hồ sơ và tính lại bản nháp trước khi kế toán đối soát.' });
            if (!['admin', 'accountant'].includes(req.user.role) || payroll.status !== 'draft') return res.status(403).json({ message: 'Chỉ kế toán được đối soát bảng lương nháp' });
            if (!payroll.insuranceConfirmed || !payroll.insuranceBasisNote?.trim()) return res.status(409).json({ message: 'Cần đối soát khoản bảo hiểm, ghi căn cứ và xác nhận trước khi duyệt lương.' });
            if (payroll.deductionShortfall > 0) return res.status(409).json({ message: 'Tổng khấu trừ vượt lương gộp. Hãy điều chỉnh bảng lương nháp trước khi xác nhận.' });
        }
        if (status === 'confirmed') {
            if (!['admin', 'principal'].includes(req.user.role) || payroll.status !== 'reviewed') return res.status(403).json({ message: 'Hiệu trưởng chỉ xác nhận bảng lương đã được kế toán đối soát' });
            const payrollEmployee = await Employee.findById(payroll.employeeId).select('userId');
            if (payrollEmployee?.userId && String(payrollEmployee.userId) === String(req.user._id)) return res.status(403).json({ message: 'Không được tự duyệt phiếu lương của mình. Cần người có quyền duyệt khác xử lý.' });
            const periodPrefix = `${payroll.year}-${String(payroll.month).padStart(2, '0')}-`;
            const approved = await OvertimeRequest.find({ employeeId: payroll.employeeId, status: 'approved', workDate: { $regex: `^${periodPrefix}` } }).lean();
            const minutes = approved.reduce((sum, request) => sum + request.approvedMinutes, 0);
            const rate = await OvertimeRate.findOne({ employeeId: payroll.employeeId, month: payroll.month, year: payroll.year }).lean();
            const amount = Math.round(minutes / 60 * (rate?.hourlyAmount || 0));
            if (minutes && !rate) return res.status(409).json({ message: 'HR chưa đặt đơn giá làm thêm cho kỳ lương' });
            if (payroll.overtimeMinutes !== minutes || payroll.overtimePay !== amount || (payroll.overtimeHourlyAmount || 0) !== (rate?.hourlyAmount || 0)) return res.status(409).json({ message: 'Giờ hoặc đơn giá làm thêm đã thay đổi. Hãy tính lại bảng lương nháp trước khi xác nhận.' });
        }
        if (status === 'paid' && (payroll.status !== 'confirmed' || !['admin', 'accountant'].includes(req.user.role))) return res.status(403).json({ message: 'Kế toán chỉ đánh dấu chi trả sau khi Ban giám hiệu xác nhận' });
        const paymentReference = String(req.body.paymentReference || '').trim();
        if (status === 'paid' && !paymentReference) return res.status(422).json({ message: 'Cần nhập số chứng từ hoặc mã giao dịch trước khi ghi nhận chi trả.' });
        if (status === 'paid' && paymentReference.length > 120) return res.status(422).json({ message: 'Số chứng từ tối đa 120 ký tự.' });
        const paymentMethod = String(req.body.paymentMethod || '');
        const paidDate = String(req.body.paidDate || '');
        if (status === 'paid' && !['cash', 'bank_transfer'].includes(paymentMethod)) return res.status(422).json({ message: 'Chọn hình thức chi trả lương.' });
        if (status === 'paid' && (!isValidWorkDate(paidDate) || paidDate > getWorkDate())) return res.status(422).json({ message: 'Ngày chi trả không hợp lệ hoặc ở tương lai.' });

        const before = { status: payroll.status };
        const fields = status === 'reviewed'
            ? { status, reviewedAt: new Date(), reviewedBy: req.user._id }
            : status === 'confirmed'
                ? { status, confirmedAt: new Date(), confirmedBy: req.user._id }
                : { status, paidAt: new Date(`${paidDate}T12:00:00+07:00`), paidBy: req.user._id, paymentMethod, paymentReference };
        const updated = await runHrTransaction(async (session) => {
          const months = [`${payroll.year}-${String(payroll.month).padStart(2, '0')}`];
          if (status === 'paid') months.push(paidDate.slice(0, 7));
          for (const month of [...new Set(months)].sort()) await lockOpenPeriod(month, session);
          const saved = await Payroll.findOneAndUpdate({ _id: payroll._id, status: payroll.status, updatedAt: payroll.updatedAt }, { $set: fields }, { new: true, session });
          if (!saved) throw httpError('Trạng thái bảng lương vừa thay đổi. Hãy tải lại trang.', 409);
          await PayrollEvent.create([{ payrollId: payroll._id, actorId: req.user._id, action: status, before, after: fields }], { session });
          return saved;
        });
        res.json({ message: 'Cập nhật trạng thái bảng lương thành công', data: updated });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể cập nhật trạng thái bảng lương' });
    }
};

const reopenConfirmedPayroll = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(422).json({ message: 'Mã phiếu lương không hợp lệ.' });
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 10 || reason.length > 500) return res.status(422).json({ message: 'Cần ghi lý do mở lại phiếu từ 10 đến 500 ký tự.' });
        const payroll = await runHrTransaction(async (session) => {
            const periodPayroll = await Payroll.findById(req.params.id).select('month year').session(session);
            if (periodPayroll) await lockOpenPeriod(`${periodPayroll.year}-${String(periodPayroll.month).padStart(2, '0')}`, session);
            const current = await Payroll.findOne({ _id: req.params.id, status: 'confirmed' }).session(session);
            if (!current) throw httpError('Chỉ mở lại được phiếu đã xác nhận nhưng chưa chi trả.', 409);
            const result = await Payroll.findOneAndUpdate({ _id: current._id, status: 'confirmed', updatedAt: current.updatedAt }, {
                $set: { status: 'draft', insuranceConfirmed: false, insuranceBasisNote: '' },
                $unset: { confirmedAt: 1, confirmedBy: 1, reviewedAt: 1, reviewedBy: 1 }
            }, { returnDocument: 'after', session });
            if (!result) throw httpError('Phiếu lương vừa thay đổi. Hãy tải lại.', 409);
            await PayrollEvent.create([{ payrollId: result._id, actorId: req.user._id,
                actorName: req.user.profile?.fullName || req.user.username, actorRole: req.user.role,
                action: 'reopened', before: { status: current.status, baseSalary: current.baseSalary, netSalary: current.netSalary },
                after: { status: result.status, baseSalary: result.baseSalary, netSalary: result.netSalary }, reason }], { session });
            return result;
        });
        return res.json({ message: 'Đã mở lại phiếu. HR cần tính lại; kế toán đối soát và hiệu trưởng xác nhận lại.', data: payroll });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể mở lại phiếu lương.' });
    }
};

const updatePayrollAdjustment = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id);
        if (!payroll) return res.status(404).json({ message: 'Không tìm thấy bảng lương' });
        if (payroll.status !== 'draft') return res.status(409).json({ message: 'Chỉ được điều chỉnh bảng lương nháp; bảng lương đã xác nhận hoặc chi trả không thể sửa trực tiếp' });

        const { allowances, deductions, note, insuranceConfirmed, insuranceBasisNote } = req.body;
        const allowedAllowanceFields = ['other'];
        const allowedDeductionFields = ['insurance', 'advancePayment', 'other'];
        const normalizeMoneyFields = (source, allowedFields) => Object.fromEntries(allowedFields
            .filter((field) => Object.hasOwn(source || {}, field))
            .map((field) => {
                const value = Number(source[field]);
                if (!Number.isFinite(value) || value < 0) throw Object.assign(new Error(`${field} phải là số không âm`), { statusCode: 422 });
                return [field, Math.round(value)];
            }));
        const before = { allowances: payroll.allowances.toObject(), deductions: payroll.deductions.toObject(), insuranceConfirmed: payroll.insuranceConfirmed, insuranceBasisNote: payroll.insuranceBasisNote, note: payroll.note, grossSalary: payroll.grossSalary, netSalary: payroll.netSalary, deductionShortfall: payroll.deductionShortfall };
        if (allowances) payroll.allowances = { ...payroll.allowances.toObject(), ...normalizeMoneyFields(allowances, allowedAllowanceFields) };
        if (deductions) payroll.deductions = { ...payroll.deductions.toObject(), ...normalizeMoneyFields(deductions, allowedDeductionFields) };
        if (note !== undefined) payroll.note = String(note).trim().slice(0, 1000);
        if (insuranceBasisNote !== undefined) payroll.insuranceBasisNote = String(insuranceBasisNote).trim().slice(0, 500);
        if (insuranceConfirmed !== undefined) {
            if (typeof insuranceConfirmed !== 'boolean') return res.status(422).json({ message: 'Xác nhận bảo hiểm không hợp lệ.' });
            payroll.insuranceConfirmed = insuranceConfirmed;
        }
        if (deductions && Object.hasOwn(deductions, 'insurance') && insuranceConfirmed !== true) payroll.insuranceConfirmed = false;
        if (payroll.insuranceConfirmed && !payroll.insuranceBasisNote) return res.status(422).json({ message: 'Cần ghi căn cứ đối soát bảo hiểm.' });

        // Recalculate
        const allowanceTotal = payroll.allowances.position + payroll.allowances.lunch + payroll.allowances.other;
        const deductionTotal = payroll.deductions.insurance + payroll.deductions.advancePayment + payroll.deductions.other;
        const earnedBase = (payroll.baseSalary / payroll.standardWorkDays) * Math.min(payroll.actualWorkDays + payroll.paidLeaveDays, payroll.standardWorkDays);
        payroll.grossSalary = Math.round(earnedBase + allowanceTotal + (payroll.overtimePay || 0));
        payroll.deductionShortfall = Math.max(0, deductionTotal - payroll.grossSalary);
        payroll.netSalary = Math.max(0, payroll.grossSalary - deductionTotal);

        const updated = await runHrTransaction(async (session) => {
          await lockOpenPeriod(`${payroll.year}-${String(payroll.month).padStart(2, '0')}`, session);
          const fields = Object.fromEntries(['allowances', 'deductions', 'insuranceConfirmed', 'insuranceBasisNote', 'note', 'grossSalary', 'netSalary', 'deductionShortfall'].map((key) => [key, payroll.toObject()[key]]));
          const saved = await Payroll.findOneAndUpdate({ _id: payroll._id, status: 'draft', updatedAt: payroll.updatedAt }, { $set: fields }, { new: true, runValidators: true, session });
          if (!saved) throw httpError('Bảng lương vừa thay đổi. Hãy tải lại.', 409);
          await PayrollEvent.create([{ payrollId: payroll._id, actorId: req.user._id, action: 'adjusted', before, after: fields, reason: payroll.note }], { session });
          return saved;
        });
        res.json({ message: 'Cập nhật bảng lương thành công', data: updated });
    } catch (error) {
        res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Lỗi máy chủ', error: error.message });
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
    getEmployeeHistory,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    createLeaveRequest,
    getLeaveRequests,
    getLeaveOverview,
    getMyLeaveRequests,
    processLeaveRequest,
    generateMonthlyPayroll,
    getPayrollByMonth,
    getMyPayroll,
    updatePayrollStatus,
    reopenConfirmedPayroll,
    updatePayrollAdjustment
};
