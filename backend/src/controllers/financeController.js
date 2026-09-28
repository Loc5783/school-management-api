const TuitionFee = require('../models/zone4_finance/TuitionFee');
const Payment = require('../models/zone4_finance/Payment');
const InvoiceAdjustment = require('../models/zone4_finance/InvoiceAdjustment');
const Notification = require('../models/zone1_system/Notification');
const User = require('../models/zone1_system/User');
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
const invoiceScope = async (req, invoice) => {
    if (!isParent(req.user)) return true;
    return canAccessStudent(req.user, invoice.studentId);
};

// ==============================
// 1. Tạo hóa đơn học phí
// ==============================
const createTuitionFee = async (req, res) => {
    try {
        const { studentId, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note, additionalItems } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, additionalItems });

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
        const { classroomId, applyToAll = false, period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, note, additionalItems } = req.body;
        const input = validateInvoiceInput({ period, tuitionBase, mealFee, busFee, extraFee, discount, dueDate, additionalItems });

        if (!applyToAll && !isValidObjectId(classroomId)) {
            return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        }

        const classrooms = applyToAll
            ? await Classroom.find({ status: 'active' }).select('_id name')
            : [await Classroom.findById(classroomId).select('_id name')];
        if (!classrooms.length || classrooms.some((classroom) => !classroom)) return res.status(404).json({ message: applyToAll ? 'Không có lớp đang hoạt động' : 'Không tìm thấy lớp học' });
        const classroomIds = classrooms.map((classroom) => classroom._id);
        const classroomNames = new Map(classrooms.map((classroom) => [String(classroom._id), classroom.name]));
        const students = await Student.find({ classroomId: { $in: classroomIds }, status: 'enrolled' });
        if (students.length === 0) {
            return res.status(404).json({ message: applyToAll ? 'Không có học sinh đang theo học trong các lớp hoạt động' : 'Không có học sinh nào trong lớp' });
        }

        const existed = await TuitionFee.find({ classroomId: { $in: classroomIds }, period }).select('studentName className');
        if (existed.length) return res.status(409).json({ message: `${applyToAll ? 'Các lớp đã chọn' : 'Lớp'} đã có ${existed.length} hóa đơn kỳ ${period}. Không lập chồng hóa đơn.`, data: existed });
        const result = await runStudentTransaction(async (session) => {
            const fees = students.map((student) => ({
                studentId: student._id,
                studentName: student.fullName,
                classroomId: student.classroomId,
                className: classroomNames.get(String(student.classroomId)) || student.className || '',
                period,
                ...input,
                note: String(note || '').trim()
            }));
            return TuitionFee.insertMany(fees, { session });
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

// ==============================
// 3. Thanh toán học phí (transaction + idempotency)
// ==============================
const makePayment = async (req, res) => {
    try {
        const idempotencyKey = req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.txnRef;
        const { payment, invoice, replayed } = await recordPayment(req.body, req.user, idempotencyKey);
        if (!replayed) {
            // Thanh toán đã commit trong transaction riêng. Thông báo là tác vụ
            // phụ; không được để lỗi thông báo biến một khoản thu thành lỗi giả.
            try {
                const [parents, principals] = await Promise.all([
                    User.find({ role: 'parent', 'parentInfo.studentIds': invoice.studentId, status: 'active' }).select('_id'),
                    User.find({ role: 'principal', status: 'active' }).select('_id')
                ]);
                const collectedBy = req.user.profile?.fullName || req.user.username;
                const amountText = `${Number(payment.amount).toLocaleString('vi-VN')}đ`;
                const notifications = [
                    ...parents.map((parent) => ({
                        recipientId: parent._id, title: 'Đã ghi nhận thanh toán học phí',
                        message: `Nhà trường đã ghi nhận ${amountText} cho học phí của ${invoice.studentName}.`,
                        type: 'finance', link: '/parent-portal', createdBy: req.user._id,
                        metadata: { invoiceId: invoice._id, paymentId: payment._id }
                    })),
                    ...principals.map((principal) => ({
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
        return res.json({ success: true, data: { receiptNumber: payment.receiptNumber || `PT-LEGACY-${payment._id.toString().slice(-6).toUpperCase()}`, paidAt: payment.paidAt, amount: payment.amount, method: payment.method, txnRef: payment.txnRef || '', note: payment.note || '', studentName: invoice.studentName, className: invoice.className, period: invoice.period, invoiceId: invoice._id, totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, tuitionBase: invoice.tuitionBase, mealFee: invoice.mealFee, busFee: invoice.busFee, extraFee: invoice.extraFee, additionalItems: invoice.additionalItems || [], discount: invoice.discount } });
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
        const reason = String(req.body.reason || '').trim();
        if (reason.length < 5) return res.status(422).json({ message: 'Vui lòng nhập lý do hủy hóa đơn (ít nhất 5 ký tự)' });
        const current = await TuitionFee.findById(id);
        if (!current) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (current.status === 'cancelled') return res.status(409).json({ message: 'Hóa đơn đã được hủy trước đó' });
        if (current.paidAmount > 0) return res.status(409).json({ message: 'Hóa đơn đã có giao dịch thu tiền, hãy dùng nghiệp vụ hoàn tiền hoặc điều chỉnh thay vì hủy' });
        // Conditional update prevents a concurrent payment from leaving us with
        // a paid invoice that was nevertheless cancelled.
        const fee = await TuitionFee.findOneAndUpdate({ _id: id, paidAmount: 0, status: { $ne: 'cancelled' } }, {
            status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user._id,
            cancelledByName: req.user.profile?.fullName || req.user.username, cancelReason: reason
        }, { returnDocument: 'after' });
        if (!fee) return res.status(409).json({ message: 'Hóa đơn vừa thay đổi trạng thái hoặc đã phát sinh thanh toán; vui lòng tải lại và kiểm tra lại' });
        res.json({
            message: 'Hủy hóa đơn thành công',
            data: fee
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const sendDebtReminders = async (req, res) => {
    try {
        const { period, classroomId, overdueOnly = false } = req.body;
        const filter = { status: { $in: ['unpaid', 'partial'] } };
        if (period) { if (!PERIOD_PATTERN.test(period)) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' }); filter.period = period; }
        if (classroomId) { if (!isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' }); filter.classroomId = classroomId; }
        if (overdueOnly) filter.dueDate = { $lt: new Date() };
        const invoices = await TuitionFee.find(filter).select('studentId studentName period totalAmount paidAmount dueDate');
        const studentIds = invoices.map((invoice) => invoice.studentId);
        const parentUsers = studentIds.length
            ? await User.find({ role: 'parent', status: 'active', 'parentInfo.studentIds': { $in: studentIds } }).select('_id parentInfo.studentIds')
            : [];
        const notificationDocs = [];
        for (const invoice of invoices) {
            const parents = parentUsers.filter((parent) => parent.parentInfo?.studentIds?.some((studentId) => String(studentId) === String(invoice.studentId)));
            const remaining = invoice.totalAmount - invoice.paidAmount;
            parents.forEach((parent) => notificationDocs.push({
                recipientId: parent._id, title: overdueOnly ? 'Nhắc học phí quá hạn' : 'Nhắc thanh toán học phí',
                message: `${invoice.studentName} còn ${remaining.toLocaleString('vi-VN')}đ học phí kỳ ${invoice.period}, hạn thanh toán ${invoice.dueDate.toLocaleDateString('vi-VN')}.`,
                type: 'finance', link: '/parent-portal', createdBy: req.user._id
            }));
        }
        if (notificationDocs.length) await Notification.insertMany(notificationDocs);
        res.json({ success: true, message: `Đã gửi ${notificationDocs.length} thông báo nhắc học phí`, data: { invoices: invoices.length, notifications: notificationDocs.length } });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Không thể gửi nhắc nợ' }); }
};

const adjustTuitionFee = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, amount, reason } = req.body;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        if (!['discount', 'surcharge', 'refund'].includes(type)) return res.status(400).json({ message: 'Loại điều chỉnh không hợp lệ' });
        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return res.status(422).json({ message: 'Số tiền điều chỉnh phải lớn hơn 0' });
        const normalizedReason = String(reason || '').trim();
        if (normalizedReason.length < 5) return res.status(422).json({ message: 'Vui lòng nhập lý do điều chỉnh (ít nhất 5 ký tự)' });

        const result = await runStudentTransaction(async (session) => {
            const invoice = await TuitionFee.findById(id).session(session);
            if (!invoice) throw Object.assign(new Error('Không tìm thấy hóa đơn'), { statusCode: 404 });
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
            if (type === 'refund') {
                if (value > invoice.paidAmount) throw Object.assign(new Error('Số tiền hoàn không được lớn hơn số đã thu'), { statusCode: 422 });
                invoice.paidAmount -= value;
            }
            invoice.status = invoice.paidAmount >= invoice.totalAmount ? 'paid' : (invoice.paidAmount > 0 ? 'partial' : 'unpaid');
            await invoice.save({ session });
            const after = { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status };
            const adjustment = (await InvoiceAdjustment.create([{
                invoiceId: invoice._id, type, amount: value, reason: normalizedReason,
                recordedBy: req.user._id, recordedByName: req.user.profile?.fullName || req.user.username, before, after
            }], { session }))[0];
            return { invoice, adjustment };
        });
        res.json({ success: true, message: 'Đã điều chỉnh hóa đơn và cập nhật công nợ', data: result });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể điều chỉnh hóa đơn' });
    }
};

// Bổ sung một khoản có tên cho nhiều hóa đơn đã lập trong cùng kỳ.
// Dùng khi trường phát sinh khoản chung sau khi đã lập học phí ban đầu.
const addBulkInvoiceItem = async (req, res) => {
    try {
        const { period, classroomId, name, amount, reason } = req.body;
        if (!PERIOD_PATTERN.test(String(period || ''))) return res.status(400).json({ message: 'Kỳ thu phải có dạng MM-YYYY' });
        if (classroomId && !isValidObjectId(classroomId)) return res.status(400).json({ message: 'ID lớp học không hợp lệ' });
        const [item] = validateAdditionalItems([{ name, amount }]);
        const normalizedReason = String(reason || `Bổ sung khoản thu: ${item.name}`).trim();
        if (normalizedReason.length < 5 || normalizedReason.length > 1000) return res.status(422).json({ message: 'Lý do bổ sung phải có từ 5 đến 1000 ký tự' });
        const filter = { period, status: { $ne: 'cancelled' } };
        if (classroomId) filter.classroomId = classroomId;

        const result = await runStudentTransaction(async (session) => {
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
                    invoiceId: invoice._id, type: 'surcharge', amount: item.amount, reason: normalizedReason,
                    recordedBy: req.user._id, recordedByName: req.user.profile?.fullName || req.user.username,
                    before, after: { totalAmount: invoice.totalAmount, paidAmount: invoice.paidAmount, status: invoice.status }
                });
            }
            await InvoiceAdjustment.insertMany(adjustments, { session });
            return { invoiceCount: invoices.length, totalAdded: invoices.length * item.amount };
        });
        res.json({ success: true, message: `Đã thêm “${item.name}” vào ${result.invoiceCount} hóa đơn`, data: result });
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể bổ sung khoản thu hàng loạt' });
    }
};

const getInvoiceAdjustments = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID hóa đơn không hợp lệ' });
        const invoice = await TuitionFee.findById(id).select('studentId');
        if (!invoice) return res.status(404).json({ message: 'Không tìm thấy hóa đơn' });
        if (!await invoiceScope(req, invoice)) return res.status(403).json({ message: 'Bạn không có quyền xem lịch sử điều chỉnh' });
        const data = await InvoiceAdjustment.find({ invoiceId: id }).sort({ createdAt: -1 });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ message: 'Không thể lấy lịch sử điều chỉnh' }); }
};

module.exports = {
    createTuitionFee,
    createBulkTuitionFees,
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
    getInvoiceAdjustments
};
