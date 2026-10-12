const MealServing = require('../models/zone5_nutrition/MealServing');
const KitchenDayClosing = require('../models/zone5_nutrition/KitchenDayClosing');
const InventoryTransaction = require('../models/zone5_nutrition/InventoryTransaction');
const Classroom = require('../models/zone3_school/Classroom');
const FoodInspection = require('../models/zone5_nutrition/FoodInspection');
const { expectedDishes } = require('./kitchenSafetyController');
const { calculateDailyServingPlan } = require('../services/nutritionService');
const { getWorkDate, isValidWorkDate, startOfWorkDate, addWorkDays } = require('../utils/dateHelpers');

const loadReport = async (dateKey) => {
    const start = startOfWorkDate(dateKey);
    const end = startOfWorkDate(addWorkDays(dateKey, 1));
    const [plan, servings, movements, closing, safetyDishes, inspections] = await Promise.all([
        calculateDailyServingPlan(dateKey),
        MealServing.find({ dateKey }).lean(),
        InventoryTransaction.find({ type: { $in: ['export', 'return', 'spoilage', 'adjustment'] }, createdAt: { $gte: start, $lt: end } }).sort({ createdAt: 1 }).lean(),
        KitchenDayClosing.findOne({ dateKey }).lean(),
        expectedDishes(dateKey),
        FoodInspection.find({ mealDateKey: dateKey }).select('mealType stage').lean()
    ]);
    const servingByClass = new Map(servings.map((item) => [String(item.classroomId), item]));
    const planByClass = new Map(plan.classBreakdown.map((item) => [String(item.classroomId), item]));
    const missingIds = servings.map((item) => item.classroomId).filter((id) => !planByClass.has(String(id)));
    const oldClasses = missingIds.length ? await Classroom.find({ _id: { $in: missingIds } }).select('name fullName').lean() : [];
    const oldClassNames = new Map(oldClasses.map((item) => [String(item._id), item.name || item.fullName]));
    const ids = new Set([...planByClass.keys(), ...servingByClass.keys()]);
    const rows = [...ids].map((id) => {
        const planned = planByClass.get(id);
        const serving = servingByClass.get(id);
        return {
            classroomId: id,
            className: planned?.className || oldClassNames.get(id) || 'Lớp đã lưu trữ',
            planned: planned?.recommendedServings || 0,
            unmarked: planned?.unmarkedCount || 0,
            cooked: serving?.cookedCount ?? null,
            delivered: serving?.deliveredCount ?? null,
            received: serving?.receivedCount ?? null,
            cookedAt: serving?.createdAt || null,
            deliveredAt: serving?.deliveredAt || null,
            receivedAt: serving?.receivedAt || null,
            notes: (serving?.history || []).filter((item) => item.note).map((item) => ({ action: item.action, note: item.note }))
        };
    }).sort((a, b) => a.className.localeCompare(b.className, 'vi'));
    const stockMap = new Map();
    for (const item of movements) {
        const key = `${item.ingredientId}:${item.unit}`;
        if (!stockMap.has(key)) stockMap.set(key, { ingredientId: item.ingredientId, ingredientName: item.ingredientName, unit: item.unit, exported: 0, returned: 0, spoiled: 0, adjusted: 0 });
        const column = { export: 'exported', return: 'returned', spoilage: 'spoiled', adjustment: 'adjusted' }[item.type];
        const quantity = Number(item.quantity) || 0;
        stockMap.get(key)[column] += item.type === 'spoilage' ? Math.abs(quantity) : quantity;
    }
    const stockMovements = [...stockMap.values()].sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, 'vi'));
    const stockTransactions = movements.map((item) => ({
        transactionId: item._id, type: item.type, ingredientName: item.ingredientName,
        quantity: item.quantity, unit: item.unit, batchNumber: item.batchNumber || '',
        sourceExportTransactionId: item.sourceExportTransactionId || null,
        lotAllocations: (item.lotAllocations || []).map((lot) => ({ batchNumber: lot.batchNumber, quantity: lot.quantity, unit: lot.unit })),
        reason: item.reason || '', createdAt: item.createdAt
    }));
    const blockers = [];
    if (!rows.some((row) => row.planned > 0 || row.cooked !== null)) blockers.push('Chưa có suất ăn để đối chiếu.');
    if (rows.some((row) => row.unmarked > 0)) blockers.push('Còn học sinh chưa được điểm danh.');
    if (rows.some((row) => row.planned > 0 && row.cooked === null)) blockers.push('Có lớp chưa ghi nhận nấu suất.');
    if (rows.some((row) => row.cooked !== null && (row.delivered === null || row.received === null))) blockers.push('Có lớp chưa hoàn tất giao hoặc xác nhận nhận suất.');
    if (safetyDishes.missingMenus) blockers.push('Có lớp thiếu thực đơn đã công bố.');
    const safety = Object.entries(safetyDishes.expected).filter(([, dishes]) => dishes.length).map(([mealType, dishes]) => ({
        mealType, dishes: dishes.length,
        ready: inspections.some((item) => item.mealType === mealType && item.stage === 'ready'),
        allergyConflicts: safetyDishes.allergyConflicts[mealType] || 0
    }));
    if (safety.some((item) => !item.ready)) blockers.push('Còn bữa ăn chưa hoàn tất kiểm thực và lưu mẫu.');
    if (safety.some((item) => item.allergyConflicts > 0)) blockers.push('Thực đơn còn xung đột dị ứng.');
    const hasVariance = rows.some((row) => row.cooked !== null && (row.planned !== row.cooked || row.cooked !== row.delivered || row.delivered !== row.received));
    const totals = rows.reduce((sum, row) => ({
        planned: sum.planned + row.planned,
        cooked: sum.cooked + (row.cooked || 0),
        delivered: sum.delivered + (row.delivered || 0),
        received: sum.received + (row.received || 0)
    }), { planned: 0, cooked: 0, delivered: 0, received: 0 });
    return { dateKey, rows, stockMovements, stockTransactions, safety, blockers, hasVariance, totals, closing };
};

const getReconciliation = async (req, res) => {
    const dateKey = req.query.date || getWorkDate();
    if (!isValidWorkDate(dateKey)) return res.status(400).json({ message: 'Ngày đối chiếu không hợp lệ' });
    try {
        res.json({ success: true, data: await loadReport(dateKey) });
    } catch (error) {
        res.status(500).json({ message: 'Không thể tải đối chiếu cuối ngày' });
    }
};

const closeReconciliation = async (req, res) => {
    const dateKey = req.body?.date;
    const noteInput = req.body?.note ?? '';
    const note = typeof noteInput === 'string' ? noteInput.trim() : '';
    const leftoverCookedCount = req.body?.leftoverCookedCount;
    const disposedCookedCount = req.body?.disposedCookedCount;
    if (!isValidWorkDate(dateKey) || dateKey !== getWorkDate()) return res.status(409).json({ message: 'Chỉ được chốt ngày phục vụ hiện tại' });
    if (typeof noteInput !== 'string' || note.length > 2000) return res.status(400).json({ message: 'Ghi chú không hợp lệ hoặc quá dài' });
    if (![leftoverCookedCount, disposedCookedCount].every((value) => Number.isInteger(value) && value >= 0)) return res.status(400).json({ message: 'Số suất còn lại/hủy phải là số nguyên không âm' });
    try {
        const report = await loadReport(dateKey);
        if (report.closing) return res.status(409).json({ message: 'Ngày này đã được chốt' });
        if (report.blockers.length) return res.status(409).json({ message: report.blockers.join(' ') });
        if (report.hasVariance && !note) return res.status(409).json({ message: 'Có chênh lệch suất; cần ghi rõ lý do trước khi chốt' });
        if (leftoverCookedCount + disposedCookedCount !== report.totals.cooked - report.totals.delivered) return res.status(409).json({ message: 'Suất nấu chưa giao phải được ghi đủ là suất còn lại hoặc đã hủy' });
        if (disposedCookedCount > 0 && !note) return res.status(409).json({ message: 'Có suất đã hủy; cần ghi rõ nguyên nhân' });
        const closing = await KitchenDayClosing.create({
            dateKey, note, closedBy: req.user._id, leftoverCookedCount, disposedCookedCount,
            rows: report.rows.map((row) => ({ classroomId: row.classroomId, className: row.className, planned: row.planned, cooked: row.cooked, delivered: row.delivered, received: row.received, notes: row.notes })),
            stockMovements: report.stockMovements, stockTransactions: report.stockTransactions
        });
        res.status(201).json({ success: true, data: closing });
    } catch (error) {
        res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'Ngày này vừa được chốt ở phiên khác' : 'Không thể chốt đối chiếu cuối ngày' });
    }
};

module.exports = { getReconciliation, closeReconciliation };
