const mongoose = require('mongoose');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const InvoiceAdjustment = require('../models/zone4_finance/InvoiceAdjustment');
const Notification = require('../models/zone1_system/Notification');
const User = require('../models/zone1_system/User');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const ProcurementRequest = require('../models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const FeeSchedule = require('../models/zone4_finance/FeeSchedule');
const { getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const { recordPayment } = require('../services/paymentTransactionService');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod, fromPeriod } = require('../services/accountingPeriodService');
const { assertTenantContext, buildTenantFilter, resolveTenantContext } = require('../services/tenantFilterService');

const PERIOD_PATTERN = /^(0[1-9]|1[0-2])-20\d{2}$/;
const escapeRegex = (raw) => String(raw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\const PERIOD_PATTERN = /^(0[1-9]|1[0-2])-\d{4}$/;
const parseMoney = (value, field) => {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
        const error = new Error(`${field} phải là số không âm`); error.statusCode = 400; throw error;
    }
    return amount;
};');
const parseMoney = (value, field) => {
    if (value !== null && value !== undefined && typeof value === 'object') {
        const error = new Error(`${field} không đúng định dạng số`); error.statusCode = 400; throw error;
    }
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount))) {
        const error = new Error(`${field} phải là số không âm hợp lệ`); error.statusCode = 400; throw error;
    }
    return Math.round(amount);
};
const validateAdditionalItems = (rawItems) => {
    if (rawItems === undefined || rawItems === null) return [];
    if (!Array.isArray(rawItems) || rawItems.length > 20) {
        const error = new Error('Danh sách khoản thu thêm không hợp lệ (tối đa 20 khoản)'); error.statusCode = 400; throw error;
    }
    return rawItems.map((item, index) => {
        const name = String(item?.name || '').trim();
        if (!name || name.length > 120) {
            const error = new Error(`Tên khoản thu thứ ${index + 1} phải có từ 1 đến 120 ký tự`); error.statusCode = 422; throw error;
        }
        const amount = Number(item?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            const error = new Error(`Số tiền của khoản “${name}” phải lớn hơn 0`); error.statusCode = 422; throw error;
        }
        return { name, amount };
    });
};
const validateInvoiceInput = ({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, additionalItems }) => {
    if (!PERIOD_PATTERN.test(String(period || ''))) { const error = new Error('Kỳ thu phải có dạng MM-YYYY'); error.statusCode = 400; throw error; }
    const amounts = { tuitionBase: parseMoney(tuitionBase, 'Học phí chính'), mealFee: parseMoney(mealFee, 'Tiền ăn'), busFee: parseMoney(busFee, 'Tiền xe'), extraFee: parseMoney(extraFee, 'Khoản thu khác'), discount: parseMoney(discount, 'Giảm trừ') };
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) { const error = new Error('Hạn thanh toán không hợp lệ'); error.statusCode = 400; throw error; }
    const normalizedAdditionalItems = validateAdditionalItems(additionalItems);
    const additionalTotal = normalizedAdditionalItems.reduce((sum, item) => sum + item.amount, 0);
    const totalAmount = amounts.tuitionBase + amounts.mealFee + amounts.busFee + amounts.extraFee + additionalTotal - amounts.discount;
    if (totalAmount < 0) { const error = new Error('Giảm trừ không được lớn hơn tổng khoản thu'); error.statusCode = 422; throw error; }
    return { ...amounts, additionalItems: normalizedAdditionalItems, totalAmount, dueDate: due };
};

const STANDARD_MEAL_DAYS_PER_MONTH = 22;

/**
 * Tính khấu trừ tiền ăn bán trú tự động từ số ngày nghỉ có phép (`absent_permission`) của tháng đối chiếu (mặc định tháng liền trước).
 * Hỗ trợ Kế toán cấu hình:
 * - `deductPriorMeal` (bật/tắt khấu trừ tự động, mặc định `true`)
 * - `creditPeriod` (`MM-YYYY`, mặc định tháng liền trước của kỳ thu)
 * - `dailyMealCreditRate` (đơn giá hoàn trả tiền ăn / ngày nghỉ có phép, mặc định `baseMealFee / 22`)
 */
const computePriorMonthMealCredits = async (studentIds, period, baseMealFee, tenantFilter, options = {}) => {
    const byStudentId = new Map();
    const { deductPriorMeal = true, creditPeriod = '', dailyMealCreditRate } = options || {};

    if (deductPriorMeal === false || !studentIds?.length || !(baseMealFee > 0) || !PERIOD_PATTERN.test(String(period || ''))) {
        return { prevPeriodLabel: '', dailyMealRate: 0, byStudentId };
    }

    let targetMonth;
    let targetYear;
    if (creditPeriod && PERIOD_PATTERN.test(String(creditPeriod).trim())) {
        const [cMm, cYyyy] = String(creditPeriod).trim().split('-');
        targetMonth = Number(cMm);
        targetYear = Number(cYyyy);
    } else {
        const [mmStr, yyyyStr] = String(period).split('-');
        const month = Number(mmStr);
        const year = Number(yyyyStr);
        targetMonth = month === 1 ? 12 : month - 1;
        targetYear = month === 1 ? year - 1 : year;
    }

    const prevPeriodLabel = `${String(targetMonth).padStart(2, '0')}-${targetYear}`;
    const nextOfTargetMonth = targetMonth === 12 ? 1 : targetMonth + 1;
    const nextOfTargetYear = targetMonth === 12 ? targetYear + 1 : targetYear;

    const prevStart = startOfWorkDate(`${targetYear}-${String(targetMonth).padStart(2, '0')}-01`);
    const prevEnd = startOfWorkDate(`${nextOfTargetYear}-${String(nextOfTargetMonth).padStart(2, '0')}-01`);

    const customRate = Number(dailyMealCreditRate);
    const dailyMealRate = Number.isFinite(customRate) && customRate > 0
        ? Math.round(customRate)
        : Math.round(baseMealFee / STANDARD_MEAL_DAYS_PER_MONTH);

    const rows = await StudentAttendance.aggregate([
        {
            $match: {
                ...tenantFilter,
                studentId: { $in: studentIds },
                status: 'absent_permission',
                attendDate: { $gte: prevStart, $lt: prevEnd }
            }
        },
        {
            $group: {
                _id: '$studentId',
                dates: { $addToSet: { $ifNull: ['$attendanceDateKey', { $dateToString: { format: '%Y-%m-%d', date: '$attendDate' } }] } }
            }
        }
    ]);

    for (const row of rows) {
        const absentDays = Array.isArray(row.dates) ? row.dates.length : 0;
        if (absentDays > 0) {
            const deduction = Math.min(baseMealFee, absentDays * dailyMealRate);
            byStudentId.set(String(row._id), { absentDays, deduction });
        }
    }

    return { prevPeriodLabel, dailyMealRate, byStudentId };
};

const resolveStudentCreditWithOverride = (studentId, creditMap, overrides = null, maxDeductionCap = Infinity) => {
    const sid = String(studentId);
    const autoCredit = creditMap.get(sid) || null;
    if (overrides && typeof overrides === 'object' && Object.hasOwn(overrides, sid)) {
        const rawOverride = Number(overrides[sid]);
        if (Number.isFinite(rawOverride) && rawOverride >= 0) {
            const applied = Math.min(maxDeductionCap, Math.round(rawOverride));
            return {
                absentDays: autoCredit?.absentDays || 0,
                deduction: applied,
                isOverridden: true
            };
        }
    }
    return autoCredit;
};

const applyStudentMealCreditToInput = (input, baseNote, creditInfo, prevPeriodLabel) => {
    const cleanBaseNote = String(baseNote || '').trim();
    if (!creditInfo || !(creditInfo.deduction > 0)) {
        return { ...input, note: cleanBaseNote };
    }
    const appliedDeduction = Math.min(Math.round(creditInfo.deduction), input.totalAmount);
    if (appliedDeduction <= 0) {
        return { ...input, note: cleanBaseNote };
    }
    const adjustedDiscount = input.discount + appliedDeduction;
    const adjustedTotal = Math.max(0, input.totalAmount - appliedDeduction);
    const creditNote = creditInfo.absentDays > 0
        ? `Khấu trừ ${creditInfo.absentDays} ngày ăn nghỉ có phép kỳ ${prevPeriodLabel} (-${appliedDeduction.toLocaleString('vi-VN')}đ)`
        : `Khấu trừ tiền ăn điều chỉnh kỳ ${prevPeriodLabel} (-${appliedDeduction.toLocaleString('vi-VN')}đ)`;
    return {
        ...input,
        discount: adjustedDiscount,
        totalAmount: adjustedTotal,
        note: cleanBaseNote ? `${cleanBaseNote} | ${creditNote}` : creditNote
    };
};
const invoiceScope = async (req, invoice) => {
    if (!invoice) return false;
    assertTenantContext(req);
    const resolved = resolveTenantContext(req);
    if (!resolved.isValid) return false;

    if (resolved.isSaaS) {
        if (!invoice.tenantId || String(invoice.tenantId) !== String(resolved.tenantId)) return false;
    } else {
        if (invoice.tenantId != null) return false;
    }

    if (!isParent(req.user)) return true;
    const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
    const student = await Student.findOne({ _id: invoice.studentId, ...tenantFilter }).select('_id tenantId');
    if (!student) return false;
    return canAccessStudent(req.user, student, req);
};

const getFinanceClassrooms = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const data = await Classroom.find({ status: 'active', ...tenantFilter }).select('_id name').sort({ name: 1 }).lean();
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải danh sách lớp cho kỳ thu' });
    }
};

const getFeeSchedules = async (req, res) => {
    const period = String(req.query.period || '');
    if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' });
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const data = await FeeSchedule.find({ period, ...tenantFilter }).sort({ classroomName: 1 }).lean();
        return res.json({ success: true, data });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải mức thu đã lưu' }); }
};

const saveFeeSchedule = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const { classroomId, period, note } = req.body;
        const input = validateInvoiceInput(req.body);
        if (classroomId && !isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        const classroom = classroomId ? await Classroom.findOne({ _id: classroomId, status: 'active', ...tenantFilter }).select('name') : null;
        if (classroomId && !classroom) return res.status(404).json({ message: 'Không tìm thấy lớp đang hoạt động' });
        const normalizedNote = String(note || '').trim();
        if (normalizedNote.length > 1000) return res.status(422).json({ message: 'Ghi chú tối đa 1000 ký tự' });
        const scope = { period, classroomId: classroom?._id || null, ...tenantFilter };
        const data = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền lưu mức thu hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            await lockOpenPeriod(fromPeriod(period), session, req);
            return FeeSchedule.findOneAndUpdate(scope, { $set: {
                ...input, period, classroomId: scope.classroomId, classroomName: classroom?.name || '',
                note: normalizedNote, updatedBy: actor._id
            }, $setOnInsert: {
                ...(tenantId ? { tenantId } : { tenantId: null })
            } }, { upsert: true, returnDocument: 'after', runValidators: true, session });
        });
        return res.json({ success: true, data, message: 'Đã lưu mức thu. Hóa đơn đã lập không thay đổi.' });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Mức thu kỳ/lớp này đã được lưu, vui lòng tải lại.' });
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể lưu mức thu' });
    }
};

const deleteFeeSchedule = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID mức thu không hợp lệ' });
        const deleted = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền xóa mức thu hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            const schedule = await FeeSchedule.findOne({ _id: req.params.id, ...tenantFilter }).session(session);
            if (!schedule) return null;
            await lockOpenPeriod(fromPeriod(schedule.period), session, req);
            return FeeSchedule.findOneAndDelete({ _id: schedule._id, ...tenantFilter }, { session });
        });
        if (!deleted) return res.status(404).json({ message: 'Không tìm thấy mức thu' });
        return res.json({ success: true, message: 'Đã xóa mức thu mẫu. Hóa đơn đã lập không thay đổi.' });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể xóa mức thu' }); }
};

const getAccountingProcurementOverview = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const period = String(req.query.period || '');
        if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ tra cứu phải có dạng MM-YYYY' });
        const [month, year] = period.split('-').map(Number);
        const start = startOfWorkDate(`${year}-${String(month).padStart(2, '0')}-01`);
        const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
        const end = startOfWorkDate(nextMonth);
        const [requests, orders] = await Promise.all([
            ProcurementRequest.find({ createdAt: { $gte: start, $lt: end }, status: { $in: ['pending', 'approved_l1'] }, ...tenantFilter })
                .select('requesterName category totalEstimatedCost status createdAt').sort({ createdAt: -1 }).lean(),
            PurchaseOrder.find({ orderDate: { $gte: start, $lt: end }, status: 'ordered', ...tenantFilter })
                .select('orderCode supplierName totalAmount status orderDate').sort({ orderDate: -1 }).lean()
        ]);
        return res.json({ success: true, data: {
            period, requests, orders,
            pendingEstimate: requests.reduce((sum, item) => sum + (Number(item.totalEstimatedCost) || 0), 0),
            orderedCommitment: orders.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0)
        } });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể tải đề xuất và đơn mua của kỳ này' });
    }
};

// ==============================
// 1. Tạo hóa đơn học phí
// ==============================
const createTuitionFee = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const { studentId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note, additionalItems } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, additionalItems });

        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        // Kiểm tra học sinh trong cùng tenant
        const student = await Student.findOne({ _id: studentId, status: 'enrolled', ...tenantFilter });
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh đang theo học' });
        }

        if (!student.classroomId) {
            return res.status(400).json({ message: 'Học sinh chưa được xếp lớp' });
        }

        const classroom = await Classroom.findOne({ _id: student.classroomId, status: 'active', ...tenantFilter });
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học của học sinh' });
        }

        // Kiểm tra đã có hóa đơn cho kỳ này chưa trong tenant
        const existing = await TuitionFee.findOne({ studentId, period, status: { $ne: 'cancelled' }, ...tenantFilter });
        if (existing) {
            return res.status(409).json({ message: 'Học sinh đã có hóa đơn cho kỳ này' });
        }

        // Tự động khấu trừ tiền ăn từ số ngày nghỉ có phép của tháng trước (nếu có)
        const { prevPeriodLabel, byStudentId: creditByStudent } = await computePriorMonthMealCredits([student._id], period, input.mealFee, tenantFilter);
        const resolvedInvoiceInput = applyStudentMealCreditToInput(input, note, creditByStudent.get(String(student._id)), prevPeriodLabel);

        // Tính tổng
        const fee = new TuitionFee({
            ...(tenantId ? { tenantId } : { tenantId: null }),
            studentId,
            studentName: student.fullName,
            classroomId: classroom._id,
            className: classroom.name,
            period,
            status: resolvedInvoiceInput.totalAmount === 0 ? 'paid' : 'unpaid',
            ...resolvedInvoiceInput
        });

        await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền tạo hóa đơn học phí hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            await lockOpenPeriod(fromPeriod(period), session, req);

            const existingInTx = await TuitionFee.findOne({ studentId, period, status: { $ne: 'cancelled' }, ...tenantFilter }).session(session);
            if (existingInTx) {
                const err = new Error('Học sinh đã có hóa đơn cho kỳ này');
                err.statusCode = 409;
                throw err;
            }

            await fee.save({ session });
        });

        res.status(201).json({
            message: 'Tạo hóa đơn học phí thành công',
            data: fee
        });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Học sinh đã có hóa đơn cho kỳ này' });
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' });
    }
};

// ==============================
// 2. Tạo nhiều hóa đơn cho cả lớp
// ==============================
const createBulkTuitionFees = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const {
            classroomId,
            applyToAll = false,
            period,
            tuitionBase,
            mealFee,
            busFee,
            extraFee,
            discount,
            dueDate,
            note,
            additionalItems,
            deductPriorMeal = true,
            creditPeriod = '',
            dailyMealCreditRate,
            studentCreditOverrides = null
        } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, additionalItems });

        if (!applyToAll && !isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        const classrooms = applyToAll
            ? await Classroom.find({ status: 'active', ...tenantFilter }).select('_id name')
            : [await Classroom.findOne({ _id: classroomId, status: 'active', ...tenantFilter }).select('_id name')];
        if (!classrooms.length || classrooms.some((classroom) => !classroom)) return res.status(404).json({ message: applyToAll ? 'Không có lớp đang hoạt động' : 'Không tìm thấy lớp học' });
        const classroomIds = classrooms.map((classroom) => classroom._id);
        const classroomNames = new Map(classrooms.map((classroom) => [String(classroom._id), classroom.name]));
        const students = await Student.find({ classroomId: { $in: classroomIds }, status: 'enrolled', ...tenantFilter });
        if (students.length === 0) {
            return res.status(404).json({ message: applyToAll ? 'Không có học sinh đang theo học trong các lớp hoạt động' : 'Không có học sinh nào trong lớp' });
        }

        const existed = await TuitionFee.find({
            studentId: { $in: students.map((student) => student._id) },
            period,
            status: { $ne: 'cancelled' },
            ...tenantFilter
        }).select('studentName className');
        if (existed.length) return res.status(409).json({ message: `${applyToAll ? 'Các lớp đã chọn' : 'Lớp'} đã có ${existed.length} hóa đơn kỳ ${period}. Không lập chồng hóa đơn.`, data: existed });

        // Tự động khấu trừ tiền ăn những ngày nghỉ có phép của kỳ đối chiếu cho toàn bộ danh sách học sinh (1 câu aggregate duy nhất)
        const { prevPeriodLabel, byStudentId: creditByStudent } = await computePriorMonthMealCredits(
            students.map((student) => student._id),
            period,
            input.mealFee,
            tenantFilter,
            { deductPriorMeal, creditPeriod, dailyMealCreditRate }
        );

        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền tạo hóa đơn hàng loạt hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            await lockOpenPeriod(fromPeriod(period), session, req);
            const existedInTx = await TuitionFee.find({
                studentId: { $in: students.map((student) => student._id) },
                period,
                status: { $ne: 'cancelled' },
                ...tenantFilter
            }).select('studentName className').session(session);
            if (existedInTx.length) {
                const dupErr = new Error(`${applyToAll ? 'Các lớp đã chọn' : 'Lớp'} đã có ${existedInTx.length} hóa đơn kỳ ${period}. Không lập chồng hóa đơn.`);
                dupErr.statusCode = 409;
                throw dupErr;
            }
            const fees = students.map((student) => {
                const effectiveCredit = resolveStudentCreditWithOverride(
                    student._id,
                    creditByStudent,
                    studentCreditOverrides,
                    input.totalAmount
                );
                const resolvedStudentInput = applyStudentMealCreditToInput(
                    input,
                    note,
                    effectiveCredit,
                    prevPeriodLabel || creditPeriod || period
                );
                return {
                    ...(tenantId ? { tenantId } : { tenantId: null }),
                    studentId: student._id,
                    studentName: student.fullName,
                    classroomId: student.classroomId,
                    className: classroomNames.get(String(student.classroomId)) || student.className || '',
                    period,
                    status: resolvedStudentInput.totalAmount === 0 ? 'paid' : 'unpaid',
                    ...resolvedStudentInput
                };
            });
            return TuitionFee.insertMany(fees, session ? { session } : undefined);
        });

        res.status(201).json({
            message: `Tạo hóa đơn thành công cho ${result.length} học sinh${applyToAll ? ` thuộc ${classrooms.length} lớp` : ''}`,
            data: result
        });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Một hoặc nhiều học sinh đã có hóa đơn cho kỳ này' });
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' });
    }
};

const previewBulkTuitionFees = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });

        const {
            classroomId,
            applyToAll = false,
            period,
            deductPriorMeal = true,
            creditPeriod = '',
            dailyMealCreditRate,
            studentCreditOverrides = null
        } = req.body;
        const input = validateInvoiceInput(req.body);
        if (!applyToAll && !isValidObjectId(classroomId)) return res.status(400).json({ message: 'Vui lòng chọn lớp hợp lệ' });
        const classrooms = applyToAll
            ? await Classroom.find({ status: 'active', ...tenantFilter }).select('_id name').lean()
            : [await Classroom.findOne({ _id: classroomId, status: 'active', ...tenantFilter }).select('_id name').lean()];
        if (!classrooms.length || classrooms.some((item) => !item)) return res.status(404).json({ message: 'Không tìm thấy lớp đang hoạt động' });
        const classIds = classrooms.map((item) => item._id);
        const classNameMap = new Map(classrooms.map((c) => [String(c._id), c.name]));
        const students = await Student.find({ classroomId: { $in: classIds }, status: 'enrolled', ...tenantFilter })
            .select('_id fullName className classroomId')
            .sort({ className: 1, fullName: 1 })
            .lean();
        const existing = await TuitionFee.find({
            studentId: { $in: students.map((item) => item._id) },
            period,
            status: { $ne: 'cancelled' },
            ...tenantFilter
        }).select('studentId').lean();
        const existingIds = new Set(existing.map((item) => String(item.studentId)));
        const { prevPeriodLabel, dailyMealRate, byStudentId: creditByStudent } = await computePriorMonthMealCredits(
            students.map((item) => item._id),
            period,
            input.mealFee,
            tenantFilter,
            { deductPriorMeal, creditPeriod, dailyMealCreditRate }
        );
        let netTotalAmount = 0;
        let totalMealCreditDeduction = 0;
        let mealCreditStudents = 0;
        const studentCredits = [];

        for (const student of students) {
            const autoCredit = creditByStudent.get(String(student._id));
            const effectiveCredit = resolveStudentCreditWithOverride(
                student._id,
                creditByStudent,
                studentCreditOverrides,
                input.totalAmount
            );
            const appliedDeduction = effectiveCredit?.deduction || 0;
            const studentTotal = Math.max(0, input.totalAmount - appliedDeduction);
            netTotalAmount += studentTotal;
            if (appliedDeduction > 0) {
                totalMealCreditDeduction += appliedDeduction;
                mealCreditStudents += 1;
            }
            studentCredits.push({
                studentId: student._id,
                fullName: student.fullName,
                className: classNameMap.get(String(student.classroomId)) || student.className || '',
                absentDays: autoCredit?.absentDays || 0,
                suggestedDeduction: autoCredit?.deduction || 0,
                appliedDeduction,
                finalTotal: studentTotal
            });
        }
        const byClass = classrooms.map((item) => {
            const classStudents = students.filter((student) => String(student.classroomId) === String(item._id));
            return {
                classroomId: item._id,
                name: item.name,
                studentCount: classStudents.length,
                existingCount: classStudents.filter((student) => existingIds.has(String(student._id))).length
            };
        });
        return res.json({
            success: true,
            data: {
                period,
                dueDate: input.dueDate,
                perStudent: input.totalAmount,
                studentCount: students.length,
                existingCount: existingIds.size,
                totalAmount: netTotalAmount,
                mealCreditPeriod: prevPeriodLabel,
                dailyMealCreditRate: dailyMealRate,
                mealCreditStudents,
                totalMealCreditDeduction,
                studentCredits,
                byClass,
                canCreate: students.length > 0 && existingIds.size === 0
            }
        });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể xem trước hóa đơn' }); }
};

// ==============================
// 3. Thanh toán học phí (transaction + idempotency)
// ==============================
const makePayment = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.txnRef;
        const { payment, invoice, replayed } = await recordPayment(req.body, req.user, idempotencyKey, req);
        if (!replayed) {
            // Thanh toán đã commit trong transaction riêng. Thông báo là tác vụ
            // phụ; không được để lỗi thông báo biến một khoản thu thành lỗi giả.
            try {
                const [parents, principals] = await Promise.all([
                    User.find({ role: 'parent', 'parentInfo.studentIds': invoice.studentId, status: 'active', ...tenantFilter }).select('_id'),
                    User.find({ role: 'principal', status: 'active', ...tenantFilter }).select('_id')
                ]);
                const collectedBy = req.user.profile?.fullName || req.user.username;
                const amountText = `${Number(payment.amount).toLocaleString('vi-VN')}đ`;
                const payNotifTenantId = req.tenantId || req.user?.tenantId || invoice.tenantId || null;
                const notifications = [
                    ...parents.map((parent) => ({
                        ...(payNotifTenantId ? { tenantId: payNotifTenantId } : {}),
                        recipientId: parent._id, title: 'Đã ghi nhận thanh toán học phí',
                        message: `Nhà trường đã ghi nhận ${amountText} cho học phí của ${invoice.studentName}.`,
                        type: 'finance', link: '/parent-portal', createdBy: req.user._id,
                        metadata: { invoiceId: invoice._id, paymentId: payment._id }
                    })),
                    ...principals.map((principal) => ({
                        ...(payNotifTenantId ? { tenantId: payNotifTenantId } : {}),
                        recipientId: principal._id, title: 'Kế toán đã ghi nhận khoản thu',
                        message: `${collectedBy} đã ghi nhận ${amountText} của ${invoice.studentName} (${invoice.className}, kỳ ${invoice.period}).`,
                        type: 'finance', link: '/finance', createdBy: req.user._id,
                        metadata: { invoiceId: invoice._id, paymentId: payment._id, collectorId: req.user._id }
                    }))
                ];
                if (notifications.length) await Notification.insertMany(notifications);
            } catch (notificationError) {
                console.error('Đã thu tiền nhưng không thể gửi thông báo:', notificationError);
            }
        }

        res.status(replayed ? 200 : 201).json({
            message: replayed ? 'Yêu cầu thanh toán đã được ghi nhận trước đó' : 'Thanh toán thành công',
            data: {
                payment,
                invoice: {
                    _id: invoice._id,
                    status: invoice.status,
                    paidAmount: invoice.paidAmount,
                    totalAmount: invoice.totalAmount
                }
            },
            replayed
        });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' });
    }
};

// ==============================
// 4. Lấy danh sách hóa đơn theo học sinh
// ==============================
const getTuitionByStudent = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { studentId } = req.params;
        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        const student = await Student.findOne({ _id: studentId, ...tenantFilter }).select('_id tenantId classroomId');
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        if (isParent(req.user) && !canAccessStudent(req.user, student, req)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem học phí của học sinh này' });
        }

        const fees = await TuitionFee.find({ studentId, ...tenantFilter }).sort({ period: -1 });
        return res.json({
            message: 'Lấy danh sách hóa đơn thành công',
            data: fees
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Lỗi server' });
    }
};

// ==============================
// 5. Lấy danh sách hóa đơn theo lớp
// ==============================
const getTuitionByClass = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { classroomId } = req.params;
        const { period } = req.query;
        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }
        const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter }).select('_id');
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }
        const filter = { classroomId, ...tenantFilter };
        if (period) {
            if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' });
            filter.period = period;
        }

        const fees = await TuitionFee.find(filter).sort({ studentName: 1 });
        return res.json({
            message: 'Lấy danh sách hóa đơn theo lớp thành công',
            data: fees
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Lỗi server' });
    }
};

// Danh sách nghiệp vụ cho kế toán: lọc, tìm và phân trang phía server.
const getInvoices = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { classroomId, period, status, search = '', page = 1, limit = 20 } = req.query;
        const safePage = Math.max(1, Number(page) || 1); const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        const filter = { ...tenantFilter };
        if (classroomId) {
            if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
            const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter }).select('_id');
            if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            filter.classroomId = new mongoose.Types.ObjectId(classroomId);
        }
        if (period) { if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' }); filter.period = period; }
        if (status) { if (!['unpaid', 'partial', 'paid', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Trạng thái hóa đơn không hợp lệ' }); filter.status = status; }
        if (search !== undefined && typeof search !== 'string') return res.status(400).json({ message: 'Từ khóa tìm kiếm hóa đơn không hợp lệ' });
        if (typeof search === 'string' && search.trim()) {
            const safeRegex = new RegExp(escapeRegex(search.trim().slice(0, 120)), 'i');
            filter.$or = [{ studentName: safeRegex }, { className: safeRegex }];
        }
        const [data, total] = await Promise.all([TuitionFee.find(filter).sort({ dueDate: 1, studentName: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit), TuitionFee.countDocuments(filter)]);
        return res.json({ success: true, data, pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) } });
    } catch (err) { return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể lấy danh sách hóa đơn' }); }
};

const getDebtReport = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { classroomId, period } = req.query;
        const filter = { status: { $in: ['unpaid', 'partial'] }, ...tenantFilter };
        if (classroomId) {
            if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
            const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter }).select('_id');
            if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            filter.classroomId = new mongoose.Types.ObjectId(classroomId);
        }
        if (period) { if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' }); filter.period = period; }
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 10);
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ message: 'Phân trang công nợ không hợp lệ' });
        const overdueBefore = new Date(`${getWorkDate()}T00:00:00.000Z`);
        const [data, totals] = await Promise.all([
            TuitionFee.find(filter).sort({ dueDate: 1, studentName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
            TuitionFee.aggregate([{ $match: filter }, { $project: {
                remaining: { $max: [0, { $subtract: ['$totalAmount', '$paidAmount'] }] }, dueDate: 1
            } }, { $group: { _id: null, invoices: { $sum: 1 }, totalDebt: { $sum: '$remaining' },
                overdueDebt: { $sum: { $cond: [{ $lt: ['$dueDate', overdueBefore] }, '$remaining', 0] } } } }])
        ]);
        const summary = totals[0] || { invoices: 0, totalDebt: 0, overdueDebt: 0 };
        const debts = data.map((invoice) => ({ ...invoice, remainingAmount: Math.max(0, invoice.totalAmount - invoice.paidAmount), overdue: invoice.dueDate < overdueBefore }));
        return res.json({ success: true, data: debts, summary: { invoices: summary.invoices, totalDebt: summary.totalDebt, overdueDebt: summary.overdueDebt },
            pagination: { page, limit, total: summary.invoices, totalPages: Math.max(1, Math.ceil(summary.invoices / limit)) } });
    } catch (err) { return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể lập báo cáo công nợ' }); }
};

// ==============================
// 6. Lấy lịch sử thanh toán của hóa đơn
// ==============================
const getPaymentsByInvoice = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { invoiceId } = req.params;
        if (!isValidObjectId(invoiceId)) {
            return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        }
        const invoice = await TuitionFee.findOne({ _id: invoiceId, ...tenantFilter }).select('studentId tenantId');
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem biên lai của học sinh này' });
        const payments = await Payment.find({ invoiceId, ...tenantFilter }).sort({ paidAt: -1 });
        return res.json({
            message: 'Lấy lịch sử thanh toán thành công',
            data: payments
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Lỗi server' });
    }
};

const getReceipt = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { paymentId } = req.params;
        if (!isValidObjectId(paymentId)) return res.status(400).json({ message: 'ID biên lai không hợp lệ' });
        const payment = await Payment.findOne({ _id: paymentId, ...tenantFilter });
        if (!payment) return res.status(404).json({ message: 'Không tìm thấy biên lai' });
        const invoice = await TuitionFee.findOne({ _id: payment.invoiceId, ...tenantFilter });
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn tương ứng' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem biên lai này' });
        return res.json({ success: true, data: { receiptNumber: payment.receiptNumber || `PT-LEGACY-${payment._id.toString().slice(-6).toUpperCase()}`, paidAt: payment.paidAt, amount: payment.amount, method: payment.method, txnRef: payment.txnRef || '', note: payment.note || '', studentName: invoice.studentName, className: invoice.className, period: invoice.period, invoiceId: invoice._id, totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, tuitionBase: invoice.tuitionBase, mealFee: invoice.mealFee, busFee: invoice.busFee, extraFee: invoice.extraFee, additionalItems: invoice.additionalItems || [], discount: invoice.discount } });
    } catch (err) { return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể lấy biên lai' }); }
};

// ==============================
// 7. Hủy hóa đơn (chỉ admin)
// ==============================
const cancelTuitionFee = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        }
        const reason = String(req.body.reason || '').trim();
        if (reason.length < 5) return res.status(422).json({ message: 'Vui lòng nhập lý do hủy hóa đơn (ít nhất 5 ký tự)' });
        const current = await TuitionFee.findOne({ _id: id, ...tenantFilter });
        if (!current) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (current.status === 'cancelled') return res.status(409).json({ message: 'Hóa đơn đã được hủy trước đó' });
        if (current.paidAmount > 0) return res.status(409).json({ message: 'Hóa đơn đã có giao dịch thu tiền, hãy dùng nghiệp vụ hoàn tiền hoặc điều chỉnh thay vì hủy' });
        // Conditional update prevents a concurrent payment from leaving us with
        // a paid invoice that was nevertheless cancelled.
        const fee = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || actor.role !== 'admin') {
                const err = new Error('Chỉ quản trị viên mới có quyền hủy hóa đơn');
                err.statusCode = 403;
                throw err;
            }
            await lockOpenPeriod(fromPeriod(current.period), session, req);
            return TuitionFee.findOneAndUpdate({ _id: id, paidAmount: 0, status: { $ne: 'cancelled' }, ...tenantFilter }, {
                status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor._id,
                cancelledByName: actor.profile?.fullName || actor.username, cancelReason: reason
            }, { returnDocument: 'after', session });
        });
        if (!fee) return res.status(409).json({ message: 'Hóa đơn vừa thay đổi trạng thái hoặc đã phát sinh thanh toán; vui lòng tải lại và kiểm tra lại' });
        return res.json({
            message: 'Hủy hóa đơn thành công',
            data: fee
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Lỗi server' });
    }
};

const sendDebtReminders = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const { period, classroomId, overdueOnly = false } = req.body;
        if (!PERIOD_PATTERN.test(String(period || ''))) return res.status(400).json({ message: 'Chọn kỳ thu trước khi nhắc công nợ' });
        const filter = { status: { $in: ['unpaid', 'partial'] }, ...tenantFilter };
        filter.period = period;
        if (classroomId) {
            if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
            const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter }).select('_id');
            if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
            filter.classroomId = classroomId;
        }
        const today = getWorkDate();
        if (overdueOnly) filter.dueDate = { $lt: new Date(`${today}T00:00:00.000Z`) };
        const invoices = await TuitionFee.find(filter).select('studentId studentName period totalAmount paidAmount dueDate');
        const studentIds = invoices.map((invoice) => invoice.studentId);
        const parentUsers = studentIds.length
            ? await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': { $in: studentIds }, ...tenantFilter }).select('_id parentInfo.studentIds')
            : [];
        const notificationDocs = [];
        const parentsByStudent = new Map();
        for (const parent of parentUsers) for (const studentId of parent.parentInfo?.studentIds || []) {
            const key = String(studentId);
            if (!parentsByStudent.has(key)) parentsByStudent.set(key, []);
            parentsByStudent.get(key).push(parent);
        }
        for (const invoice of invoices) {
            const parents = parentsByStudent.get(String(invoice.studentId)) || [];
            const remaining = invoice.totalAmount - invoice.paidAmount;
            parents.forEach((parent) => notificationDocs.push({
                ...(tenantId ? { tenantId } : {}),
                recipientId: parent._id, title: overdueOnly ? 'Nhắc học phí quá hạn' : 'Nhắc thanh toán học phí',
                message: `${invoice.studentName} còn ${remaining.toLocaleString('vi-VN')}đ học phí kỳ ${invoice.period}, hạn thanh toán ${invoice.dueDate.toLocaleDateString('vi-VN')}.`,
                type: 'finance', link: '/parent-portal', createdBy: req.user._id,
                deduplicationKey: `debt:${today}:${invoice._id}:${parent._id}`,
                metadata: { invoiceId: invoice._id, studentId: invoice.studentId }
            }));
        }
        const result = notificationDocs.length ? await Notification.bulkWrite(notificationDocs.map((document) => ({ updateOne: {
            filter: { ...tenantFilter, deduplicationKey: document.deduplicationKey }, update: { $setOnInsert: document }, upsert: true
        } })), { ordered: false }) : null;
        const created = result?.upsertedCount || 0;
        const skippedToday = notificationDocs.length - created;
        const unlinkedInvoices = invoices.filter((invoice) => !parentsByStudent.has(String(invoice.studentId))).length;
        const details = [];
        if (skippedToday > 0) details.push(`${skippedToday} thông báo đã gửi trong hôm nay nên không gửi lặp lại`);
        if (unlinkedInvoices > 0) details.push(`còn ${unlinkedInvoices}/${invoices.length} hóa đơn nợ chưa gửi được vì học sinh chưa liên kết tài khoản phụ huynh`);
        const message = invoices.length === 0
            ? 'Không có hóa đơn còn nợ nào trong kỳ đã chọn.'
            : `Đã tạo ${created} thông báo nhắc học phí mới${details.length ? ` (${details.join('; ')})` : ''}.`;
        return res.json({ success: true, message,
            data: { invoices: invoices.length, notifications: created, skippedToday, unlinkedInvoices } });
    } catch (err) { return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể gửi nhắc nợ' }); }
};

const adjustTuitionFee = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const { id } = req.params;
        const { type, amount, reason } = req.body;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        if (type === 'refund') return res.status(409).json({ message: 'Hoàn tiền phải qua yêu cầu phê duyệt trước khi ghi chi' });
        if (!['discount', 'surcharge'].includes(type)) return res.status(400).json({ message: 'Loại điều chỉnh không hợp lệ' });
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return res.status(422).json({ message: 'Số tiền điều chỉnh phải lớn hơn 0' });
        const normalizedReason = String(reason || '').trim();
        if (normalizedReason.length < 5) return res.status(422).json({ message: 'Vui lòng nhập lý do điều chỉnh (ít nhất 5 ký tự)' });
        if (normalizedReason.length > 1000) return res.status(422).json({ message: 'Lý do tối đa 1000 ký tự' });
        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền điều chỉnh hóa đơn hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            const invoice = await TuitionFee.findOne({ _id: id, ...tenantFilter }).session(session);
            if (!invoice) throw Object.assign(new Error('Không tìm thấy hóa đơn'), { statusCode: 404 });
            await lockOpenPeriod(fromPeriod(invoice.period), session, req);
            if (invoice.status === 'cancelled') throw Object.assign(new Error('Không thể điều chỉnh hóa đơn đã hủy'), { statusCode: 409 });
            const before = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
            if (type === 'discount') {
                if (value > invoice.totalAmount - invoice.paidAmount) throw Object.assign(new Error('Giảm trừ không được làm tổng hóa đơn thấp hơn số tiền đã thu'), { statusCode: 422 });
                invoice.discount += value;
                invoice.totalAmount -= value;
            }
            if (type === 'surcharge') {
                invoice.extraFee += value;
                invoice.totalAmount += value;
            }
            invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'unpaid');
            await invoice.save({ session });
            const after = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
            const adjustment = (await InvoiceAdjustment.create([{
                ...(tenantId ? { tenantId } : { tenantId: null }),
                invoiceId: invoice._id, type, amount: value, reason: normalizedReason,
                recordedBy: actor._id, recordedByName: actor.profile?.fullName || actor.username, before, after
            }], { session }))[0];
            return { invoice, adjustment };
        });
        return res.json({ success: true, message: 'Đã điều chỉnh hóa đơn và cập nhật công nợ', data: result });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Yêu cầu hoàn tiền đã được xử lý. Vui lòng tải lại hóa đơn.' });
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể điều chỉnh hóa đơn' });
    }
};

// Bổ sung một khoản có tên cho nhiều hóa đơn đã lập trong cùng kỳ.
// Dùng khi trường phát sinh khoản chung sau khi đã lập học phí ban đầu.
const addBulkInvoiceItem = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const resolvedTenant = resolveTenantContext(req);
        const tenantId = resolvedTenant.isValid && resolvedTenant.isSaaS ? resolvedTenant.tenantId : null;

        const { period, classroomId, name, amount, reason } = req.body;
        if (!PERIOD_PATTERN.test(String(period || ''))) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' });
        if (classroomId && !isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        if (classroomId) {
            const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter }).select('_id');
            if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }
        const [item] = validateAdditionalItems([{ name, amount }]);
        const normalizedReason = String(reason || `Bổ sung khoản thu: ${item.name}`).trim();
        if (normalizedReason.length < 5 || normalizedReason.length > 1000) return res.status(422).json({ message: 'Lý do bổ sung phải có từ 5 đến 1000 ký tự' });
        const filter = { period, status: { $ne: 'cancelled' }, ...tenantFilter };
        if (classroomId) filter.classroomId = classroomId;

        const result = await runStudentTransaction(async (session) => {
            const actor = await User.findOne({ _id: req.user._id, status: 'active', ...tenantFilter }).session(session);
            if (!actor || !['admin', 'accountant'].includes(actor.role)) {
                const err = new Error('Người dùng không có quyền bổ sung khoản thu hoặc tài khoản đã bị khóa');
                err.statusCode = 403;
                throw err;
            }
            await lockOpenPeriod(fromPeriod(period), session, req);
            const invoices = await TuitionFee.find(filter).session(session);
            if (!invoices.length) throw Object.assign(new Error('Không có hóa đơn đang hiệu lực phù hợp để bổ sung khoản thu'), { statusCode: 404 });
            const adjustments = [];
            for (const invoice of invoices) {
                const before = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
                invoice.additionalItems.push(item);
                invoice.totalAmount += item.amount;
                invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'unpaid');
                await invoice.save({ session });
                adjustments.push({
                    ...(tenantId ? { tenantId } : { tenantId: null }),
                    invoiceId: invoice._id, type: 'surcharge', amount: item.amount, reason: normalizedReason,
                    recordedBy: actor._id, recordedByName: actor.profile?.fullName || actor.username,
                    before, after: { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status }
                });
            }
            await InvoiceAdjustment.insertMany(adjustments, { session });
            return { invoiceCount: invoices.length, totalAdded: invoices.length * item.amount };
        });
        return res.json({ success: true, message: `Đã thêm “${item.name}” vào ${result.invoiceCount} hóa đơn`, data: result });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.message || 'Không thể bổ sung khoản thu hàng loạt' });
    }
};

const getInvoiceAdjustments = async (req, res) => {
    try {
        assertTenantContext(req);
        const tenantFilter = buildTenantFilter(req, { throwOnInvalid: true });
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        const invoice = await TuitionFee.findOne({ _id: id, ...tenantFilter }).select('studentId tenantId');
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem lịch sử điều chỉnh' });
        const fields = req.user.role === 'parent' ? 'type amount reason paidAt createdAt' : undefined;
        const data = await InvoiceAdjustment.find({ invoiceId: id, ...tenantFilter }).select(fields).sort({ createdAt: -1 });
        return res.json({ success: true, data });
    } catch (err) { return res.status(err.statusCode || 500).json({ message: 'Không thể lấy lịch sử điều chỉnh' }); }
};

module.exports = {
    getFeeSchedules,
    saveFeeSchedule,
    deleteFeeSchedule,
    createTuitionFee,
    createBulkTuitionFees,
    previewBulkTuitionFees,
    makePayment,
    getTuitionByStudent,
    getTuitionByClass,
    getInvoices,
    getDebtReport,
    sendDebtReminders,
    getPaymentsByInvoice,
    getReceipt,
    cancelTuitionFee,
    adjustTuitionFee,
    addBulkInvoiceItem,
    getInvoiceAdjustments,
    getFinanceClassrooms,
    getAccountingProcurementOverview
};
