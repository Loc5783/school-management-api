const { createHash } = require('crypto');
const Payment = require('../models/zone4_finance/Payment');
const InvoiceAdjustment = require('../models/zone4_finance/InvoiceAdjustment');
const TuitionFee = require('../models/zone4_finance/TuitionFee');
const PurchaseExpense = require('../models/zone4_finance/PurchaseExpense');
const OperatingExpense = require('../models/zone4_finance/OperatingExpense');
const Payroll = require('../models/zone2_hr/Payroll');
const DailyCashReconciliation = require('../models/zone4_finance/DailyCashReconciliation');
const { addWorkDays, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { runStudentTransaction } = require('../services/studentCoreService');
const { lockOpenPeriod } = require('../services/accountingPeriodService');

const keys = ['cashIn', 'cashOut', 'bankIn', 'bankOut', 'walletIn', 'walletOut'];
const emptyTotals = () => Object.fromEntries(keys.map((key) => [key, 0]));
const moneyValue = (value) => Number(value) || 0;
const bad = (message, statusCode = 422) => { const error = new Error(message); error.statusCode = statusCode; throw error; };

const validRange = (from, to) => isValidWorkDate(from) && isValidWorkDate(to) && from <= to
    && (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 <= 30;

const loadEntries = async (from, to, session = null) => {
    const range = { $gte: startOfWorkDate(from), $lt: startOfWorkDate(addWorkDays(to, 1)) };
    const sources = [
        () => Payment.find({ paidAt: range }).select('_id invoiceId amount paidAt method txnRef receiptNumber').session(session).lean(),
        () => InvoiceAdjustment.find({ type: 'refund', paidAt: range }).select('_id invoiceId amount paidAt method transactionRef documentNumber').session(session).lean(),
        () => PurchaseExpense.find({ paidAt: range }).select('_id orderCode supplierName amount paidAt method transactionRef documentNumber').session(session).lean(),
        () => OperatingExpense.find({ paidAt: range }).select('_id category payee description amount paidAt method transactionRef documentNumber approvalReference').session(session).lean(),
        () => Payroll.find({ status: 'paid', paidAt: range }).select('_id employeeName month year netSalary paidAt paymentMethod paymentReference').session(session).lean()
    ];
    const [payments, refunds, expenses, operatingExpenses, payrolls] = session
        ? await sources.reduce(async (previous, source) => [...await previous, await source()], Promise.resolve([]))
        : await Promise.all(sources.map((source) => source()));
    const invoiceIds = [...new Set([...payments, ...refunds].map((item) => String(item.invoiceId)))];
    const invoices = invoiceIds.length ? await TuitionFee.find({ _id: { $in: invoiceIds } }).select('_id studentName className period').session(session).lean() : [];
    const invoiceById = new Map(invoices.map((item) => [String(item._id), item]));
    const rows = [
        ...payments.map((item) => {
            const invoice = invoiceById.get(String(item.invoiceId));
            return { id: item._id, source: 'tuition', direction: 'in', paidAt: item.paidAt, amount: item.amount,
                method: item.method, reference: item.txnRef || '', documentNumber: item.receiptNumber || '',
                party: invoice ? `${invoice.studentName} · ${invoice.className}` : 'Hóa đơn không còn tồn tại',
                period: invoice?.period || '', issue: !invoice ? 'Thiếu hóa đơn nguồn' : item.method !== 'cash' && !item.txnRef ? 'Thiếu mã giao dịch' : '' };
        }),
        ...refunds.map((item) => {
            const invoice = invoiceById.get(String(item.invoiceId));
            return { id: item._id, source: 'tuition_refund', direction: 'out', paidAt: item.paidAt, amount: item.amount,
                method: item.method || 'unknown', reference: item.transactionRef || '', documentNumber: item.documentNumber || '',
                party: invoice ? `${invoice.studentName} · ${invoice.className}` : 'Hóa đơn không còn tồn tại',
                period: invoice?.period || '', issue: !invoice ? 'Thiếu hóa đơn nguồn' : !item.documentNumber ? 'Thiếu chứng từ hoàn tiền' : item.method === 'bank_transfer' && !item.transactionRef ? 'Thiếu mã giao dịch' : '' };
        }),
        ...expenses.map((item) => ({ id: item._id, source: 'purchase', direction: 'out', paidAt: item.paidAt,
            amount: item.amount, method: item.method, reference: item.transactionRef || '', documentNumber: item.documentNumber,
            party: `${item.orderCode} · ${item.supplierName}`, issue: item.method === 'bank_transfer' && !item.transactionRef ? 'Thiếu mã giao dịch' : '' })),
        ...operatingExpenses.map((item) => ({ id: item._id, source: 'operating', direction: 'out', paidAt: item.paidAt,
            amount: item.amount, method: item.method, reference: item.transactionRef || '', documentNumber: item.documentNumber,
            party: `${item.payee} · ${item.description}`, category: item.category,
            issue: !item.documentNumber || !item.approvalReference ? 'Thiếu chứng từ/căn cứ chi' : item.method === 'bank_transfer' && !item.transactionRef ? 'Thiếu mã giao dịch' : '' })),
        ...payrolls.map((item) => ({ id: item._id, source: 'payroll', direction: 'out', paidAt: item.paidAt,
            amount: item.netSalary, method: item.paymentMethod || 'unknown', reference: item.paymentReference || '',
            documentNumber: item.paymentReference || '', party: `${item.employeeName} · lương ${item.month}/${item.year}`,
            issue: !item.paymentMethod || !item.paymentReference ? 'Phiếu lương cũ thiếu thông tin chi trả' : '' }))
    ];
    rows.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt) || String(b.id).localeCompare(String(a.id)));
    const daily = new Map();
    for (const row of rows) {
        const day = getWorkDate(row.paidAt);
        if (!daily.has(day)) daily.set(day, { workDate: day, ...emptyTotals(), unknownAmount: 0, issues: 0, count: 0, sourceTokens: [] });
        const totals = daily.get(day);
        totals.sourceTokens.push(`${row.source}:${row.id}:${row.amount}:${row.method}:${row.reference}`);
        const methodPrefix = row.method === 'cash' ? 'cash' : row.method === 'bank_transfer' ? 'bank' : row.method === 'ewallet' ? 'wallet' : '';
        if (methodPrefix) totals[`${methodPrefix}${row.direction === 'in' ? 'In' : 'Out'}`] += moneyValue(row.amount);
        else totals.unknownAmount += moneyValue(row.amount);
        totals.count += 1;
        if (row.issue) totals.issues += 1;
    }
    for (const totals of daily.values()) {
        totals.sourceSignature = createHash('sha256').update(totals.sourceTokens.sort().join('|')).digest('hex');
        delete totals.sourceTokens;
    }
    const overall = { ...emptyTotals(), unknownAmount: 0, issues: 0, count: 0 };
    for (const item of daily.values()) for (const key of [...keys, 'unknownAmount', 'issues', 'count']) overall[key] += item[key];
    return { rows, daily: [...daily.values()].sort((a, b) => b.workDate.localeCompare(a.workDate)), overall };
};

const statusOf = (record, todayBook) => {
    if (!record) return 'not_recorded';
    if (record.sourceSignature !== todayBook.sourceSignature || keys.some((key) => moneyValue(record.bookSnapshot?.[key]) !== moneyValue(todayBook[key]))) return 'stale';
    if (todayBook.unknownAmount || todayBook.issues) return 'needs_review';
    return keys.every((key) => moneyValue(record.actual?.[key]) === moneyValue(todayBook[key])) ? 'matched' : 'difference';
};

const getCashbookData = async ({ from, to }) => {
    const validFrom = String(from || getWorkDate());
    const validTo = String(to || validFrom);
    if (!validRange(validFrom, validTo)) {
        bad('Chọn khoảng ngày hợp lệ, tối đa 31 ngày', 422);
    }
    const [{ rows, daily, overall }, records] = await Promise.all([
        loadEntries(validFrom, validTo),
        DailyCashReconciliation.find({ workDate: { $gte: validFrom, $lte: validTo } }).lean()
    ]);
    const byDate = new Map(records.map((item) => [item.workDate, item]));
    const dates = [];
    for (let day = validFrom; day <= validTo; day = addWorkDays(day, 1)) {
        const book = daily.find((item) => item.workDate === day) || {
            workDate: day, ...emptyTotals(), unknownAmount: 0, issues: 0, count: 0,
            sourceSignature: createHash('sha256').update('').digest('hex')
        };
        const record = byDate.get(day);
        dates.push({
            ...book,
            reconciliation: record ? {
                _id: record._id, actual: record.actual, bookSnapshot: record.bookSnapshot,
                evidenceReference: record.evidenceReference, note: record.note, revision: record.revision,
                recordedByName: record.recordedByName, updatedAt: record.updatedAt, history: record.history,
                status: statusOf(record, book)
            } : null
        });
    }
    return {
        rows,
        daily: dates.reverse(),
        overall,
        from: validFrom,
        to: validTo
    };
};

const getCashbook = async (req, res) => {
    const from = String(req.query.from || getWorkDate());
    const to = String(req.query.to || from);
    const page = Number(req.query.page || 1);
    if (!validRange(from, to)) return res.status(422).json({ message: 'Chọn khoảng ngày hợp lệ, tối đa 31 ngày' });
    if (!Number.isInteger(page) || page < 1) return res.status(422).json({ message: 'Trang không hợp lệ' });
    try {
        const { rows, daily, overall } = await getCashbookData({ from, to });
        return res.json({ success: true, data: rows.slice((page - 1) * 20, page * 20), daily, overall,
            pagination: { page, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / 20)) } });
    } catch (error) { return res.status(error.statusCode || 500).json({ message: error.message || 'Không thể tải sổ đối soát' }); }
};

const saveDailyReconciliation = async (req, res) => {
    try {
        const workDate = String(req.body.workDate || '');
        if (!isValidWorkDate(workDate) || workDate > getWorkDate()) bad('Ngày đối soát không hợp lệ hoặc ở tương lai');
        const evidenceReference = String(req.body.evidenceReference || '').trim();
        const note = String(req.body.note || '').trim();
        const changeReason = String(req.body.changeReason || '').trim();
        if (!evidenceReference || evidenceReference.length > 120) bad('Cần mã sao kê hoặc chứng từ đối chiếu (tối đa 120 ký tự)');
        if (note.length > 1000) bad('Ghi chú tối đa 1000 ký tự');
        const actual = {};
        for (const key of keys) {
            const amount = Number(req.body.actual?.[key]);
            if (!Number.isSafeInteger(amount) || amount < 0) bad(`Số đối chiếu ${key} phải là số nguyên không âm`);
            actual[key] = amount;
        }
        const expectedRevision = Number(req.body.expectedRevision || 0);
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) bad('Phiên bản đối soát không hợp lệ');
        if (expectedRevision > 0 && (changeReason.length < 5 || changeReason.length > 500)) bad('Sửa đối soát cần ghi lý do từ 5 đến 500 ký tự');
        const result = await runStudentTransaction(async (session) => {
            await lockOpenPeriod(workDate.slice(0, 7), session);
            const { daily } = await loadEntries(workDate, workDate, session);
            const book = daily[0] || { ...emptyTotals(), unknownAmount: 0, issues: 0,
                sourceSignature: createHash('sha256').update('').digest('hex') };
            const bookSnapshot = Object.fromEntries(keys.map((key) => [key, book[key]]));
            const actorName = req.user.profile?.fullName || req.user.username;
            const historyEntry = { revision: expectedRevision + 1, actual, bookSnapshot, sourceSignature: book.sourceSignature, evidenceReference, note,
                changedBy: req.user._id, changedByName: actorName, changedAt: new Date(), changeReason };
            let record;
            if (expectedRevision === 0) {
                [record] = await DailyCashReconciliation.create([{ workDate, actual, bookSnapshot, sourceSignature: book.sourceSignature, evidenceReference, note,
                    revision: 1, recordedBy: req.user._id, recordedByName: actorName, history: [historyEntry] }], { session });
            } else {
                record = await DailyCashReconciliation.findOneAndUpdate({ workDate, revision: expectedRevision }, {
                    $set: { actual, bookSnapshot, sourceSignature: book.sourceSignature, evidenceReference, note, revision: expectedRevision + 1,
                        recordedBy: req.user._id, recordedByName: actorName }, $push: { history: historyEntry }
                }, { returnDocument: 'after', runValidators: true, session });
                if (!record) bad('Bản đối soát đã thay đổi. Hãy tải lại trước khi sửa.', 409);
            }
            return { revision: record.revision, status: statusOf(record, book) };
        });
        return res.json({ success: true, data: result,
            message: 'Đã lưu số đối chiếu thủ công. Chưa xác minh tự động với ngân hàng.' });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Ngày này đã có bản đối soát. Hãy tải lại.' });
        return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : 'Không thể lưu đối soát' });
    }
};

module.exports = { getCashbook, saveDailyReconciliation, loadEntries, statusOf, getCashbookData };
