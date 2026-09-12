const Employee = require('../models/zone2_hr/Employee');
const Department = require('../models/zone2_hr/Department');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const Payroll = require('../models/zone2_hr/Payroll');
const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const Notification = require('../models/zone1_system/Notification');

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
        const employees = await Employee.find(filter).populate('departmentId', 'name code').sort({ fullName: 1 });
        res.json({ message: 'Lấy danh sách nhân viên thành công', data: employees });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const getEmployeeById = async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id).populate('departmentId', 'name code');
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        res.json({ message: 'Lấy thông tin nhân viên thành công', data: employee });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const createEmployee = async (req, res) => {
    try {
        const { employeeCode, fullName, phone } = req.body;
        if (!employeeCode || !fullName || !phone) {
            return res.status(400).json({ message: 'Mã nhân viên, họ tên và số điện thoại là bắt buộc' });
        }
        const existing = await Employee.findOne({ employeeCode: employeeCode.toUpperCase() });
        if (existing) return res.status(400).json({ message: 'Mã nhân viên đã tồn tại' });

        // If departmentId given, resolve departmentName
        let departmentName = req.body.departmentName || '';
        if (req.body.departmentId && !departmentName) {
            const dept = await Department.findById(req.body.departmentId);
            if (dept) departmentName = dept.name;
        }

        const employee = await Employee.create({ ...req.body, departmentName });
        res.status(201).json({ message: 'Tạo nhân viên thành công', data: employee });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
    }
};

const updateEmployee = async (req, res) => {
    try {
        if (req.body.departmentId && !req.body.departmentName) {
            const dept = await Department.findById(req.body.departmentId);
            if (dept) req.body.departmentName = dept.name;
        }
        const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!employee) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
        res.json({ message: 'Cập nhật nhân viên thành công', data: employee });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi máy chủ', error: error.message });
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

        const employees = await Employee.find({ status: 'active' });
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
