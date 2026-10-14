const mongoose = require('mongoose');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const PurchaseExpense = require('../models/zone4_finance/PurchaseExpense');
const { getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { lockOpenPeriod } = require('../services/accountingPeriodService');

const periodPattern = /^(0[1-9]|1[0-2])-\d{4}$/;
const fail = (message, statusCode) => { const error = new Error(message); error.statusCode = statusCode; throw error; };

const getExpenseOrders = async (req, res) => {
    try {
        const data = await PurchaseOrder.find({ status: 'delivered', $expr: { $lt: [{ $ifNull: ['$paidAmount', 0] }, '$totalAmount'] } })
            .select('_id orderCode supplierName totalAmount paidAmount orderDate status').sort({ orderDate: -1 }).lean();
        return res.json({ success: true, data });
    } catch (error) { return res.status(500).json({ message: 'Không thể tải đơn đã giao chưa thanh toán' }); }
};

const getPurchaseExpenses = async (req, res) => {
    const period = String(req.query.period || '');
    if (!periodPattern.test(period)) return res.status(400).json({ message: 'Kỳ tra cứu phải có dạng MM-YYYY' });
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ message: 'Trang không hợp lệ' });
    try {
        const [month, year] = period.split('-').map(Number);
        const start = startOfWorkDate(`${year}-${String(month).padStart(2, '0')}-01`);
        const end = startOfWorkDate(new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
        const match = { paidAt: { $gte: start, $lt: end } };
        const [data, summary] = await Promise.all([
            PurchaseExpense.find(match).sort({ paidAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).lean(),
            PurchaseExpense.aggregate([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }])
        ]);
        const totals = summary[0] || { count: 0, total: 0 };
        return res.json({ success: true, data, summary: { count: totals.count, total: totals.total },
            pagination: { page, totalPages: Math.max(1, Math.ceil(totals.count / 20)) } });
    } catch (error) { return res.status(500).json({ message: 'Không thể tải sổ chi mua sắm' }); }
};

const recordPurchaseExpense = async (req, res) => {
    try {
        const { orderId, amount, paidAt, method, transactionRef, documentNumber, note } = req.body;
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (!mongoose.isValidObjectId(orderId)) fail('Đơn đặt hàng không hợp lệ', 400);
        const paidAmount = Number(amount);
        if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0) fail('Số tiền chi phải là số nguyên dương (VNĐ)', 422);
        if (!isValidWorkDate(paidAt) || paidAt > getWorkDate()) fail('Ngày chi không hợp lệ hoặc ở tương lai', 422);
        if (!['cash', 'bank_transfer'].includes(method)) fail('Phương thức chi không hợp lệ', 422);
        const ref = method === 'cash' ? '' : String(transactionRef || '').trim();
        if (method === 'bank_transfer' && !ref) fail('Chuyển khoản cần mã giao dịch để đối soát', 422);
        if (ref.length > 120) fail('Mã giao dịch tối đa 120 ký tự', 422);
        const document = String(documentNumber || '').trim();
        if (!document || document.length > 120) fail('Cần số chứng từ hợp lệ (tối đa 120 ký tự)', 422);
        const normalizedNote = String(note || '').trim();
        if (normalizedNote.length > 500) fail('Ghi chú tối đa 500 ký tự', 422);
        if (!idempotencyKey || idempotencyKey.length > 120) fail('Thiếu mã yêu cầu chống ghi trùng', 400);

        const topology = await mongoose.connection.db.admin().command({ hello: 1 });
        if (!topology.setName && topology.msg !== 'isdbgrid') fail('Cần MongoDB Replica Set hoặc sharded cluster để ghi nhận chi an toàn', 503);
        const session = await mongoose.startSession();
        let result;
        try {
            await session.withTransaction(async () => {
                const previous = await PurchaseExpense.findOne({ orderId, idempotencyKey }).session(session);
                if (previous) {
                    if (previous.amount !== paidAmount || previous.method !== method || previous.transactionRef !== (ref || undefined) || previous.documentNumber !== document || previous.note !== normalizedNote || previous.paidAt.toISOString().slice(0, 10) !== paidAt) fail('Mã yêu cầu này đã dùng cho khoản chi khác', 409);
                    result = { expense: previous, replayed: true };
                    return;
                }
                await lockOpenPeriod(paidAt.slice(0, 7), session);
                const order = await PurchaseOrder.findById(orderId).session(session);
                if (!order) fail('Không tìm thấy đơn đặt hàng', 404);
                if (order.status !== 'delivered') fail('Chỉ được ghi chi cho đơn đã xác nhận giao', 409);
                const remaining = order.totalAmount - (order.paidAmount || 0);
                if (paidAmount > remaining) fail(`Số tiền chi vượt phần còn lại (${remaining}đ)`, 422);
                const expense = (await PurchaseExpense.create([{
                    orderId: order._id, orderCode: order.orderCode, supplierName: order.supplierName,
                    amount: paidAmount, paidAt: new Date(`${paidAt}T12:00:00+07:00`), method,
                    transactionRef: ref || undefined, documentNumber: document, note: normalizedNote,
                    recordedBy: req.user._id, recordedByName: req.user.profile?.fullName || req.user.username, idempotencyKey
                }], { session }))[0];
                order.paidAmount = (order.paidAmount || 0) + paidAmount;
                await order.save({ session });
                result = { expense, replayed: false };
            });
        } finally { await session.endSession(); }
        return res.status(result.replayed ? 200 : 201).json({ success: true,
            message: result.replayed ? 'Khoản chi này đã được ghi nhận trước đó' : 'Đã ghi nhận khoản chi mua sắm', data: result.expense });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Mã giao dịch hoặc mã yêu cầu đã được ghi nhận; hãy tải lại sổ chi' });
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể ghi nhận khoản chi' });
    }
};

module.exports = { getExpenseOrders, getPurchaseExpenses, recordPurchaseExpense };
