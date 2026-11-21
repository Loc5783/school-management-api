const AccountingPeriod = require('../models/zone4_finance/AccountingPeriod');
const { resolveTenantContext } = require('./tenantFilterService');

const monthPattern = /^20\d{2}-(0[1-9]|1[0-2])$/;
const fromPeriod = (period) => {
    const match = /^(0[1-9]|1[0-2])-(20\d{2})$/.exec(String(period || ''));
    return match ? `${match[2]}-${match[1]}` : null;
};
const closedError = () => Object.assign(new Error('Kỳ kế toán đã chốt. Cần hiệu trưởng hoặc admin mở lại và ghi lý do trước khi sửa.'), { statusCode: 409 });

const normalizeSessionAndContext = (sessionOrOptions, maybeContext) => {
    let session = null;
    let context = maybeContext || null;
    if (sessionOrOptions) {
        if (sessionOrOptions.constructor?.name === 'ClientSession' || typeof sessionOrOptions.startTransaction === 'function' || sessionOrOptions.id) {
            session = sessionOrOptions;
        } else if (typeof sessionOrOptions === 'object') {
            if ('session' in sessionOrOptions || 'context' in sessionOrOptions) {
                session = sessionOrOptions.session || null;
                context = sessionOrOptions.context || maybeContext || null;
            } else {
                context = sessionOrOptions;
            }
        }
    }
    return { session, context };
};

const resolvePeriodContext = (context, { requireContext = false } = {}) => {
    if (context === null || context === undefined) {
        if (requireContext) {
            throw Object.assign(new Error('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu'), {
                statusCode: 403,
                code: 'INVALID_TENANT_CONTEXT'
            });
        }
        return {
            isSaaS: false,
            isLegacy: true,
            tenantId: null,
            tenantFilter: { tenantId: null }
        };
    }

    const resolved = resolveTenantContext(context);
    if (!resolved.isValid) {
        throw Object.assign(new Error('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu'), {
            statusCode: 403,
            code: 'INVALID_TENANT_CONTEXT'
        });
    }

    if (resolved.isSaaS) {
        return {
            isSaaS: true,
            isLegacy: false,
            tenantId: resolved.tenantId,
            tenantFilter: { tenantId: resolved.tenantId }
        };
    }

    return {
        isSaaS: false,
        isLegacy: true,
        tenantId: null,
        tenantFilter: { tenantId: null }
    };
};

const assertOpen = async (month, sessionOrOptions, maybeContext) => {
    if (!monthPattern.test(String(month || ''))) return;
    const { session, context } = normalizeSessionAndContext(sessionOrOptions, maybeContext);
    const { tenantFilter } = resolvePeriodContext(context, { requireContext: false });
    const query = AccountingPeriod.exists({ ...tenantFilter, month, status: 'closed' });
    if (await (session ? query.session(session) : query)) throw closedError();
};

// Every posting and period close updates this same document within its transaction.
// MongoDB then aborts/retries a concurrent transaction instead of allowing a
// request that passed an earlier route guard to commit after the close.
const lockOpenPeriod = async (month, sessionOrOptions, maybeContext) => {
    if (!monthPattern.test(String(month || ''))) throw Object.assign(new Error('Kỳ kế toán không hợp lệ'), { statusCode: 422 });
    const { session, context } = normalizeSessionAndContext(sessionOrOptions, maybeContext);
    const { tenantId, tenantFilter } = resolvePeriodContext(context, { requireContext: false });

    try {
        const record = await AccountingPeriod.findOneAndUpdate(
            { ...tenantFilter, month, status: 'open' },
            {
                $inc: { writeVersion: 1 },
                $setOnInsert: {
                    tenantId,
                    revision: 0,
                    snapshot: {},
                    sourceHash: '',
                    history: []
                }
            },
            { upsert: true, returnDocument: 'after', session }
        );
        if (!record) throw closedError();
        return record;
    } catch (error) {
        if (error.code === 11000) {
            const current = await AccountingPeriod.findOne({ ...tenantFilter, month }).select('status').lean();
            if (current?.status === 'closed') throw closedError();
            throw Object.assign(new Error('Kỳ kế toán đang có giao dịch đồng thời hoặc xung đột hệ thống. Hãy thử lại.'), { statusCode: 409 });
        }
        throw error;
    }
};

module.exports = { monthPattern, fromPeriod, assertOpen, lockOpenPeriod, resolvePeriodContext };
