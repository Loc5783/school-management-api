const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const { canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const { recordPayment } = require('../services/paymentTransactionService');
const { runStudentTransaction } = require('../services/studentCoreService');

const PERIOD_PATTERN = /^(0[1-9]|1[0-2])-\d{4}$/;
const parseMoney = (value, field) => {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
        const error = new Error(`${field} phải là số không âm`); error.statusCode = 400; throw error;
    }
    return amount;
};
const validateInvoiceInput = ({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate }) => {
    if (!PERIOD_PATTERN.test(String(period || ''))) { const error = new Error('Kỳ thu phải có dạng MM-YYYY'); error.statusCode = 400; throw error; }
    const amounts = { tuitionBase: parseMoney(tuitionBase, 'Học phí chính'), mealFee: parseMoney(mealFee, 'Tiền ăn'), busFee: parseMoney(busFee, 'Tiền xe'), extraFee: parseMoney(extraFee, 'Khoản thu khác'), discount: parseMoney(discount, 'Giảm trừ') };
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) { const error = new Error('Hạn thanh toán không hợp lệ'); error.statusCode = 400; throw error; }
    const totalAmount = amounts.tuitionBase + amounts.mealFee + amounts.busFee + amounts.extraFee - amounts.discount;
    if (totalAmount < 0) { const error = new Error('Giảm trừ không được lớn hơn tổng khoản thu'); error.statusCode = 422; throw error; }
    return { ...amounts, totalAmount, dueDate: due };
};
const invoiceScope = async (req, invoice) => {
    if (!isParent(req.user)) return true;
    return canAccessStudent(req.user, invoice.studentId);
};

// ==============================
// 1. Tạo hóa đơn học phí
// ==============================
const createTuitionFee = async (req, res) => {
    try {
        const { studentId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate });

        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        // Kiểm tra học sinh
        const student = await Student.findById(studentId);
        if (!student) {
            return res.status(404).json({ message: 'Không tìm thấy học sinh' });
        }

        // Kiểm tra đã có hóa đơn cho kỳ này chưa
        const existing = await TuitionFee.findOne({ studentId, period });
        if (existing) {
            return res.status(400).json({ message: 'Học sinh đã có hóa đơn cho kỳ này' });
        }

        const classroom = await Classroom.findById(student.classroomId);
        if (!classroom) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        }

        // Tính tổng
        const fee = new TuitionFee({
            studentId,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: classroom.name,
            period,
            ...input,
            note
        });

        await fee.save();

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
        const { classroomId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate });

        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });
        const students = await Student.find({ classroomId, status: 'enrolled' });
        if (students.length === 0) {
            return res.status(404).json({ message: 'Không có học sinh nào trong lớp' });
        }

        const existed = await TuitionFee.find({ classroomId, period }).select('studentName');
        if (existed.length) return res.status(409).json({ message: `Lớp đã có ${existed.length} hóa đơn kỳ ${period}. Không lập chồng hóa đơn.`, data: existed });
        const result = await runStudentTransaction(async (session) => {
            const fees = students.map((student) => ({
                studentId: student._id,
                studentName: student.fullName,
                classroomId,
                className: classroom.name,
                period,
                ...input,
                note: String(note || '').trim()
            }));
            return TuitionFee.insertMany(fees, { session });
        });

        res.status(201).json({
            message: `Tạo hóa đơn thành công cho ${result.length} học sinh`,
            data: result
        });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Một hoặc nhiều học sinh đã có hóa đơn cho kỳ này' });
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi server' });
    }
};

// ==============================
// 3. Thanh toán học phí (transaction + idempotency)
// ==============================
const makePayment = async (req, res) => {
    try {
        const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.txnRef;
        const { payment, invoice, replayed } = await recordPayment(req.body, req.user, idempotencyKey);

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
        const { studentId } = req.params;
        if (!isValidStudentId(studentId)) {
            return res.status(400).json({ message: 'ID học sinh không hợp lệ' });
        }

        if (isParent(req.user) && !canAccessStudent(req.user, studentId)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem học phí của học sinh này' });
        }

        const fees = await TuitionFee.find({ studentId }).sort({ period: -1 });
        res.json({
            message: 'Lấy danh sách hóa đơn thành công',
            data: fees
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 5. Lấy danh sách hóa đơn theo lớp
// ==============================
const getTuitionByClass = async (req, res) => {
    try {
        const { classroomId } = req.params;
        const { period } = req.query;
        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }
        const filter = { classroomId };
        if (period) filter.period = period;

        const fees = await TuitionFee.find(filter).sort({ studentName: 1 });
        res.json({
            message: 'Lấy danh sách hóa đơn theo lớp thành công',
            data: fees
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Danh sách nghiệp vụ cho kế toán: lọc, tìm và phân trang phía server.
const getInvoices = async (req, res) => {
    try {
        const { classroomId, period, status, search = '', page = 1, limit = 20 } = req.query;
        const safePage = Math.max(1, Number(page) || 1); const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        const filter = {};
        if (classroomId) { if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' }); filter.classroomId = classroomId; }
        if (period) { if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' }); filter.period = period; }
        if (status) { if (!['unpaid', 'partial', 'paid', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Trạng thái hóa đơn không hợp lệ' }); filter.status = status; }
        if (String(search).trim()) filter.$or = [{ studentName: new RegExp(String(search).trim(), 'i') }, { className: new RegExp(String(search).trim(), 'i') }];
        const [data, total] = await Promise.all([TuitionFee.find(filter).sort({ dueDate: 1, studentName: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit), TuitionFee.countDocuments(filter)]);
        return res.json({ success: true, data, pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) } });
    } catch (err) { console.error(err); return res.status(500).json({ message: 'Không thể lấy danh sách hóa đơn' }); }
};

const getDebtReport = async (req, res) => {
    try {
        const { classroomId, period } = req.query; const filter = { status: { $in: ['unpaid', 'partial'] } };
        if (classroomId) { if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' }); filter.classroomId = classroomId; }
        if (period) { if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' }); filter.period = period; }
        const data = await TuitionFee.find(filter).sort({ dueDate: 1, studentName: 1 }).lean();
        const debts = data.map((invoice) => ({ ...invoice, remainingAmount: Math.max(0, invoice.totalAmount - invoice.paidAmount), overdue: invoice.dueDate < new Date() }));
        return res.json({ success: true, data: debts, summary: { invoices: debts.length, totalDebt: debts.reduce((sum, item) => sum + item.remainingAmount, 0), overdueDebt: debts.filter((item) => item.overdue).reduce((sum, item) => sum + item.remainingAmount, 0) } });
    } catch (err) { console.error(err); return res.status(500).json({ message: 'Không thể lập báo cáo công nợ' }); }
};

// ==============================
// 6. Lấy lịch sử thanh toán của hóa đơn
// ==============================
const getPaymentsByInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        if (!isValidObjectId(invoiceId)) {
            return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        }
        const invoice = await TuitionFee.findById(invoiceId).select('studentId');
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem biên lai của học sinh này' });
        const payments = await Payment.find({ invoiceId }).sort({ paidAt: -1 });
        res.json({
            message: 'Lấy lịch sử thanh toán thành công',
            data: payments
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const getReceipt = async (req, res) => {
    try {
        const { paymentId } = req.params;
        if (!isValidObjectId(paymentId)) return res.status(400).json({ message: 'ID biên lai không hợp lệ' });
        const payment = await Payment.findById(paymentId);
        if (!payment) return res.status(404).json({ message: 'Không tìm thấy biên lai' });
        const invoice = await TuitionFee.findById(payment.invoiceId);
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn tương ứng' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem biên lai này' });
        return res.json({ success: true, data: { receiptNumber: payment.receiptNumber || `PT-LEGACY-${payment._id.toString().slice(-6).toUpperCase()}`, paidAt: payment.paidAt, amount: payment.amount, method: payment.method, txnRef: payment.txnRef || '', note: payment.note || '', studentName: invoice.studentName, className: invoice.className, period: invoice.period, invoiceId: invoice._id, totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount } });
    } catch (err) { console.error(err); return res.status(500).json({ message: 'Không thể lấy biên lai' }); }
};

// ==============================
// 7. Hủy hóa đơn (chỉ admin)
// ==============================
const cancelTuitionFee = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) {
            return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        }
        const fee = await TuitionFee.findByIdAndUpdate(
            id,
            { status: 'cancelled' },
            { returnDocument: 'after' }
        );
        if (!fee) {
            return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        }
        res.json({
            message: 'Hủy hóa đơn thành công',
            data: fee
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    createTuitionFee,
    createBulkTuitionFees,
    makePayment,
    getTuitionByStudent,
    getTuitionByClass,
    getInvoices,
    getDebtReport,
    getPaymentsByInvoice,
    getReceipt,
    cancelTuitionFee
};
