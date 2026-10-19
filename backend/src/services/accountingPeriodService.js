const AccountingPeriod = require('../models/zone4_finance/AccountingPeriod');

const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const fromPeriod = (period) => {
    const match = /^(0[1-9]|1[0-2])-(20\d{2})$/.exec(String(period || ''));
    return match ? `${match[2]}-${match[1]}` : null;
};
const closedError = () => Object.assign(new Error('Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.'), { statusCode: 409 });
const assertOpen = async (month, session) => {
    if (!monthPattern.test(String(month || ''))) return;
    const query = AccountingPeriod.exists({ month, status: 'closed' });
    if (await (session ? query.session(session) : query)) throw closedError();
};

// Every posting and period close updates this same document within its transaction.
// MongoDB then aborts/retries a concurrent transaction instead of allowing a
// request that passed an earlier route guard to commit after the close.
const lockOpenPeriod = async (month, session) => {
    if (!monthPattern.test(String(month || ''))) throw Object.assign(new Error('Kỳ kế toán không hợp lệ'), { statusCode: 422 });
    try {
        const record = await AccountingPeriod.findOneAndUpdate({ month, status: 'open' },
            { $inc: { writeVersion: 1 }, $setOnInsert: { revision: 0, snapshot: {}, sourceHash: '', history: [] } },
            { upsert: true, returnDocument: 'after', session });
        if (!record) throw closedError();
        return record;
    } catch (error) {
        if (error.code === 11000) {
            const current = await AccountingPeriod.findOne({ month }).select('status').lean();
            if (current?.status === 'closed') throw closedError();
            throw Object.assign(new Error('Kỳ đang có giao dịch đồng thời. Hãy thử lại.'), { statusCode: 409 });
        }
        throw error;
    }
};

module.exports = { monthPattern, fromPeriod, assertOpen, lockOpenPeriod };
