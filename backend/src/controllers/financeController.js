const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const mongoose = require('mongoose');

// ==============================
// 1. Tạo hóa đơn học phí
// ==============================
const createTuitionFee = async (req, res) => {
    try {
        const { studentId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note } = req.body;

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
// 3. Thanh toán học phí (KHÔNG TRANSACTION)
// ==============================
const makePayment = async (req, res) => {
    try {
        const { invoiceId, amount, method, txnRef, note } = req.body;

        // Tìm hóa đơn
        const invoice = await TuitionFee.findById(invoiceId);
        if (!invoice) {
            return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({ message: 'Hóa đơn đã được thanh toán đầy đủ' });
        }

        if (invoice.status === 'cancelled') {
            return res.status(400).json({ message: 'Hóa đơn đã bị hủy' });
        }

        // Số tiền còn lại
        const remaining = invoice.totalAmount - invoice.paidAmount;
        if (amount > remaining) {
            return res.status(400).json({ message: `Số tiền thanh toán vượt quá số tiền còn lại (${remaining})` });
        }

        // Tạo bản ghi thanh toán
        const payment = new Payment({
            invoiceId,
            amount,
            method,
            txnRef,
            note,
            recordedBy: req.user._id
        });
        await payment.save();

        // Cập nhật hóa đơn
        invoice.paidAmount += amount;
        if (invoice.paidAmount >= invoice.totalAmount) {
            invoice.status = 'paid';
        } else if (invoice.paidAmount > 0) {
            invoice.status = 'partial';
        }
        await invoice.save();

        res.status(201).json({
            message: 'Thanh toán thành công',
            data: {
                payment,
                invoice: {
                    _id: invoice._id,
                    status: invoice.status,
                    paidAmount: invoice.paidAmount,
                    totalAmount: invoice.totalAmount
                }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 4. Lấy danh sách hóa đơn theo học sinh
// ==============================
const getTuitionByStudent = async (req, res) => {
    try {
        const { studentId } = req.params;
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
        const fee = await TuitionFee.findByIdAndUpdate(
            id,
            { status: 'cancelled' },
            { new: true }
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