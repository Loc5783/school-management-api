const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const { canAccessStudent, isParent, isValidStudentId } = require('../services/studentAccessService');
const { isValidObjectId } = require('../utils/idValidation');
const { recordPayment } = require('../services/paymentTransactionService');

// ==============================
// 1. Tạo hóa đơn học phí
// ==============================
const createTuitionFee = async (req, res) => {
    try {
        const { studentId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note } = req.body;

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
        const totalAmount = (tuitionBase || 0) + (mealFee || 0) + (busFee || 0) + (extraFee || 0) - (discount || 0);

        const fee = new TuitionFee({
            studentId,
            studentName: student.fullName,
            classroomId: student.classroomId,
            className: classroom.name,
            period,
            tuitionBase: tuitionBase || 0,
            mealFee: mealFee || 0,
            busFee: busFee || 0,
            extraFee: extraFee || 0,
            discount: discount || 0,
            totalAmount,
            dueDate,
            note
        });

        await fee.save();

        res.status(201).json({
            message: 'Tạo hóa đơn học phí thành công',
            data: fee
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 2. Tạo nhiều hóa đơn cho cả lớp
// ==============================
const createBulkTuitionFees = async (req, res) => {
    try {
        const { classroomId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate } = req.body;

        if (!isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        const students = await Student.find({ classroomId, status: 'enrolled' });
        if (students.length === 0) {
            return res.status(404).json({ message: 'Không có học sinh nào trong lớp' });
        }

        const fees = [];
        for (const student of students) {
            const total = (tuitionBase || 0) + (mealFee || 0) + (busFee || 0) + (extraFee || 0) - (discount || 0);
            fees.push({
                studentId: student._id,
                studentName: student.fullName,
                classroomId,
                className: student.className,
                period,
                tuitionBase: tuitionBase || 0,
                mealFee: mealFee || 0,
                busFee: busFee || 0,
                extraFee: extraFee || 0,
                discount: discount || 0,
                totalAmount: total,
                dueDate
            });
        }

        const result = await TuitionFee.insertMany(fees);

        res.status(201).json({
            message: `Tạo hóa đơn thành công cho ${result.length} học sinh`,
            data: result
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
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

// ==============================
// 6. Lấy lịch sử thanh toán của hóa đơn
// ==============================
const getPaymentsByInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        if (!isValidObjectId(invoiceId)) {
            return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        }
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
    getPaymentsByInvoice,
    cancelTuitionFee
};
