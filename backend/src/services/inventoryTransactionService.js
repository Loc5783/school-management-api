const mongoose = require('mongoose');
const Inventory = require('../models/zone5_nutrition/Inventory');
const InventoryTransaction = require('../models/zone5_nutrition/InventoryTransaction');
const IngredientMaster = require('../models/zone5_nutrition/IngredientMaster');
const { getWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { isValidObjectId } = require('../utils/idValidation');

const getTodayStart = () => startOfWorkDate(getWorkDate(new Date()));

const buildActor = (user) => ({
    performedBy: user._id,
    performedByName: user.profile?.fullName || user.username
});

const assertObjectId = (value, label) => {
    if (!isValidObjectId(value)) {
        const error = new Error(`${label} không hợp lệ`);
        error.statusCode = 400;
        throw error;
    }
};

const runInTransaction = async (operation) => {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') {
        const error = new Error('MongoDB phải chạy Replica Set hoặc sharded cluster để ghi nhận giao dịch kho an toàn');
        error.statusCode = 503;
        throw error;
    }
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await operation(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

const calculateLotStatus = (quantity, expiryDate) => {
    if (quantity <= 0) return 'depleted';
    if (new Date(expiryDate) < getTodayStart()) return 'expired';
    return 'available';
};

const importInventory = async (payload, user, createBatchNumber) => {
    const { ingredientId, batchNumber, quantity, unit, costPerUnit, expiryDate, supplierId, supplierName, storageLocation } = payload;
    const importQuantity = Number(quantity);
    const unitCost = Number(costPerUnit || 0);
    if (!ingredientId || quantity === undefined || quantity === null || !expiryDate || !String(supplierName || '').trim()) {
        const error = new Error('Thiếu thông tin nhập kho nguyên liệu'); error.statusCode = 400; throw error;
    }
    assertObjectId(ingredientId, 'ID nguyên liệu');
    if (supplierId) assertObjectId(supplierId, 'ID nhà cung cấp');
    if (!Number.isFinite(importQuantity) || importQuantity <= 0) {
        const error = new Error('Số lượng nhập phải là một số lớn hơn 0'); error.statusCode = 400; throw error;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
        const error = new Error('Đơn giá nhập không được âm'); error.statusCode = 400; throw error;
    }
    if (!String(storageLocation || '').trim()) {
        const error = new Error('Vui lòng chọn vị trí bảo quản cho lô hàng'); error.statusCode = 400; throw error;
    }
    const parsedExpiryDate = new Date(expiryDate);
    if (Number.isNaN(parsedExpiryDate.getTime())) {
        const error = new Error('Hạn sử dụng không hợp lệ'); error.statusCode = 400; throw error;
    }
    const ingredient = await IngredientMaster.findById(ingredientId).lean();
    if (!ingredient) {
        const error = new Error('Không tìm thấy nguyên liệu'); error.statusCode = 404; throw error;
    }
    const resolvedBatchNumber = String(batchNumber || createBatchNumber(ingredientId)).trim();
    const resolvedSupplierName = String(supplierName).trim();
    const resolvedStorageLocation = String(storageLocation).trim();

    return runInTransaction(async (session) => {
        const status = calculateLotStatus(importQuantity, parsedExpiryDate);
        const inventory = await Inventory.findOneAndUpdate(
            { ingredientId, batchNumber: resolvedBatchNumber },
            {
                $inc: { quantity: importQuantity },
                $set: {
                    costPerUnit: unitCost,
                    supplierId: supplierId || undefined,
                    supplierName: resolvedSupplierName,
                    storageLocation: resolvedStorageLocation,
                    status
                },
                $setOnInsert: {
                    ingredientName: ingredient.name,
                    unit: unit || ingredient.unit,
                    expiryDate: parsedExpiryDate
                }
            },
            { returnDocument: 'after', upsert: true, session, setDefaultsOnInsert: true }
        );
        const transaction = await InventoryTransaction.create([{
            type: 'import', ingredientId, ingredientName: ingredient.name, batchNumber: resolvedBatchNumber,
            quantity: importQuantity, unit: unit || ingredient.unit, costPerUnit: unitCost,
            totalAmount: importQuantity * unitCost, supplierId, supplierName: resolvedSupplierName,
            storageLocation: resolvedStorageLocation, reason: 'Nhập kho từ nhà cung cấp', ...buildActor(user),
            lotAllocations: [{ inventoryId: inventory._id, batchNumber: resolvedBatchNumber, quantity: importQuantity,
                unit: unit || ingredient.unit, costPerUnit: unitCost, totalAmount: importQuantity * unitCost,
                expiryDate: inventory.expiryDate, storageLocation: resolvedStorageLocation }]
        }], { session });
        return { inventory, transaction: transaction[0] };
    });
};

const exportInventoryFEFO = async (payload, user) => {
    const { ingredientId, quantity, classroomId, className, mealDate, mealType, reason } = payload;
    const exportQuantity = Number(quantity);
    if (!ingredientId || !Number.isFinite(exportQuantity) || exportQuantity <= 0) {
        const error = new Error('Cần gửi mã nguyên liệu và số lượng xuất dương'); error.statusCode = 400; throw error;
    }
    assertObjectId(ingredientId, 'ID nguyên liệu');
    if (classroomId) assertObjectId(classroomId, 'ID lớp học');

    return runInTransaction(async (session) => {
        const ingredient = await IngredientMaster.findById(ingredientId).session(session);
        if (!ingredient) {
            const error = new Error('Không tìm thấy nguyên liệu'); error.statusCode = 404; throw error;
        }
        const lots = await Inventory.find({
            ingredientId, quantity: { $gt: 0 }, status: { $in: ['available', 'near_expiry'] }, expiryDate: { $gte: getTodayStart() }
        }).sort({ expiryDate: 1, createdAt: 1, _id: 1 }).session(session);
        let remaining = exportQuantity;
        let totalAmount = 0;
        const lotAllocations = [];
        for (const lot of lots) {
            if (remaining <= 0) break;
            const deducted = Math.min(lot.quantity, remaining);
            lot.quantity -= deducted;
            lot.status = calculateLotStatus(lot.quantity, lot.expiryDate);
            await lot.save({ session });
            remaining -= deducted;
            const allocationAmount = deducted * (lot.costPerUnit || 0);
            totalAmount += allocationAmount;
            lotAllocations.push({ inventoryId: lot._id, batchNumber: lot.batchNumber, quantity: deducted, unit: lot.unit,
                costPerUnit: lot.costPerUnit || 0, totalAmount: allocationAmount, expiryDate: lot.expiryDate,
                storageLocation: lot.storageLocation || '' });
        }
        if (remaining > 0) {
            const error = new Error(`Tồn kho không đủ để xuất! Hiện còn ${exportQuantity - remaining} ${ingredient.unit}, yêu cầu xuất ${exportQuantity} ${ingredient.unit}`);
            error.statusCode = 409;
            throw error;
        }
        const transaction = await InventoryTransaction.create([{
            type: 'export', ingredientId, ingredientName: ingredient.name, quantity: exportQuantity, unit: ingredient.unit,
            costPerUnit: totalAmount / exportQuantity, totalAmount, classroomId, className: className || '',
            mealDate: mealDate ? new Date(mealDate) : new Date(), mealType: mealType || 'lunch',
            reason: reason || 'Xuất chế biến bữa ăn học sinh', lotAllocations, ...buildActor(user)
        }], { session });
        return transaction[0];
    });
};

const returnUnusedInventory = async (lotId, payload, user) => {
    const { quantity, reason, rawAndSafe, sourceExportTransactionId } = payload;
    const returnQuantity = Number(quantity);
    if (!Number.isFinite(returnQuantity) || returnQuantity <= 0) {
        const error = new Error('Số lượng hoàn trả phải lớn hơn 0'); error.statusCode = 400; throw error;
    }
    if (rawAndSafe !== true) {
        const error = new Error('Chỉ hoàn trả nguyên liệu chưa chế biến, còn nguyên trạng và bảo đảm an toàn'); error.statusCode = 400; throw error;
    }
    assertObjectId(lotId, 'ID lô hàng');
    assertObjectId(sourceExportTransactionId, 'ID phiếu xuất nguồn');

    return runInTransaction(async (session) => {
        // Không chạy truy vấn song song trong một MongoDB transaction: driver cần
        // tuần tự hóa transaction number trên cùng session.
        const lot = await Inventory.findById(lotId).session(session);
        const sourceExport = await InventoryTransaction.findOne({
            _id: sourceExportTransactionId,
            type: 'export'
        }).session(session);
        if (!lot) { const error = new Error('Không tìm thấy lô hàng'); error.statusCode = 404; throw error; }
        if (!sourceExport) { const error = new Error('Không tìm thấy phiếu xuất nguồn hợp lệ'); error.statusCode = 404; throw error; }
        if (lot.expiryDate < getTodayStart()) { const error = new Error('Không thể hoàn trả lô hàng đã hết hạn'); error.statusCode = 422; throw error; }
        if (lot.status === 'disposed') { const error = new Error('Không thể hoàn trả lô hàng đã xử lý hủy'); error.statusCode = 422; throw error; }
        const sourceAllocation = sourceExport.lotAllocations.find((allocation) => String(allocation.inventoryId) === String(lot._id));
        if (!sourceAllocation || String(sourceExport.ingredientId) !== String(lot.ingredientId)) {
            const error = new Error('Lô hàng không thuộc phiếu xuất nguồn đã chọn'); error.statusCode = 422; throw error;
        }
        const priorReturns = await InventoryTransaction.find({
            type: 'return', sourceExportTransactionId: sourceExport._id, sourceInventoryId: lot._id
        }).session(session).select('quantity');
        const returnedBefore = priorReturns.reduce((total, transaction) => total + transaction.quantity, 0);
        const stillReturnable = sourceAllocation.quantity - returnedBefore;
        if (returnQuantity > stillReturnable) {
            const error = new Error(`Số lượng hoàn trả vượt quá lượng chưa hoàn của phiếu xuất (còn ${stillReturnable} ${lot.unit})`);
            error.statusCode = 422;
            throw error;
        }
        lot.quantity += returnQuantity;
        lot.status = calculateLotStatus(lot.quantity, lot.expiryDate);
        await lot.save({ session });
        const transaction = await InventoryTransaction.create([{
            type: 'return', ingredientId: lot.ingredientId, ingredientName: lot.ingredientName, batchNumber: lot.batchNumber,
            quantity: returnQuantity, unit: lot.unit, costPerUnit: lot.costPerUnit || 0,
            totalAmount: returnQuantity * (lot.costPerUnit || 0), sourceExportTransactionId: sourceExport._id,
            sourceInventoryId: lot._id, classroomId: sourceExport.classroomId, className: sourceExport.className,
            mealDate: sourceExport.mealDate, mealType: sourceExport.mealType,
            reason: String(reason || 'Hoàn trả nguyên liệu chưa sử dụng').trim(), ...buildActor(user),
            lotAllocations: [{ inventoryId: lot._id, batchNumber: lot.batchNumber, quantity: returnQuantity, unit: lot.unit,
                costPerUnit: lot.costPerUnit || 0, totalAmount: returnQuantity * (lot.costPerUnit || 0),
                expiryDate: lot.expiryDate, storageLocation: lot.storageLocation || '' }]
        }], { session });
        return { inventory: lot, transaction: transaction[0] };
    });
};

module.exports = { importInventory, exportInventoryFEFO, returnUnusedInventory };
