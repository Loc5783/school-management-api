const ItemMaster = require('../models/zone6_procurement/ItemMaster');
const ProcurementRequest = require('../models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const Asset = require('../models/zone6_procurement/Asset');
const Supplier = require('../models/zone5_nutrition/Supplier'); // dùng chung từ Zone 5
const User = require('../models/zone1_system/User');

// ==============================
// 1. Quản lý mặt hàng (Item Master)
// ==============================
const createItem = async (req, res) => {
    try {
        const item = new ItemMaster(req.body);
        await item.save();
        res.status(201).json({ message: 'Tạo mặt hàng thành công', data: item });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const getItems = async (req, res) => {
    try {
        const { category, status } = req.query;
        const filter = {};
        if (category) filter.category = category;
        if (status) filter.status = status;
        const items = await ItemMaster.find(filter).sort({ name: 1 });
        res.json({ message: 'Lấy danh sách mặt hàng thành công', data: items });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const updateItem = async (req, res) => {
    try {
        const item = await ItemMaster.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!item) return res.status(404).json({ message: 'Không tìm thấy mặt hàng' });
        res.json({ message: 'Cập nhật mặt hàng thành công', data: item });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const deleteItem = async (req, res) => {
    try {
        const item = await ItemMaster.findByIdAndDelete(req.params.id);
        if (!item) return res.status(404).json({ message: 'Không tìm thấy mặt hàng' });
        res.json({ message: 'Xóa mặt hàng thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 2. Đề xuất mua sắm
// ==============================
const createProcurementRequest = async (req, res) => {
    try {
        const { items, ...rest } = req.body;
        // Tính tổng ước tính
        let totalEstimatedCost = 0;
        const processedItems = items.map(item => {
            const total = (item.estimatedPrice || 0) * (item.quantity || 0);
            totalEstimatedCost += total;
            return { ...item, totalEstimated: total };
        });

        const request = new ProcurementRequest({
            ...rest,
            items: processedItems,
            totalEstimatedCost,
            requesterId: req.user._id,
            requesterName: req.user.profile.fullName
        });
        await request.save();
        res.status(201).json({ message: 'Tạo đề xuất mua sắm thành công', data: request });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const getProcurementRequests = async (req, res) => {
    try {
        const { status, urgency } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (urgency) filter.urgency = urgency;
        const requests = await ProcurementRequest.find(filter).sort({ createdAt: -1 });
        res.json({ message: 'Lấy danh sách đề xuất thành công', data: requests });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Duyệt đề xuất (Level 1 hoặc Level 2)
const approveProcurementRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { level, status, rejectionReason } = req.body; // level: 1 hoặc 2

        const request = await ProcurementRequest.findById(id);
        if (!request) return res.status(404).json({ message: 'Không tìm thấy đề xuất' });

        if (status === 'rejected') {
            request.status = 'rejected';
            request.rejectionReason = rejectionReason;
        } else {
            if (level === 1) {
                request.approverLevel1 = req.user._id;
                request.approverLevel1Name = req.user.profile.fullName;
                request.approverLevel1At = new Date();
                request.status = 'approved_l1';
            } else if (level === 2) {
                request.approverLevel2 = req.user._id;
                request.approverLevel2Name = req.user.profile.fullName;
                request.approverLevel2At = new Date();
                request.status = 'approved_l2';
            }
        }
        await request.save();
        res.json({ message: 'Duyệt đề xuất thành công', data: request });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 3. Đơn đặt hàng
// ==============================
const createPurchaseOrder = async (req, res) => {
    try {
        const { requestId, supplierId, items, expectedDelivery, note } = req.body;

        // Kiểm tra đề xuất đã được duyệt chưa
        const request = await ProcurementRequest.findById(requestId);
        if (!request) return res.status(404).json({ message: 'Không tìm thấy đề xuất' });
        if (request.status !== 'approved_l2') {
            return res.status(400).json({ message: 'Đề xuất chưa được duyệt cấp 2' });
        }

        // Kiểm tra supplier
        const supplier = await Supplier.findById(supplierId);
        if (!supplier) return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp' });

        // Tính tổng tiền
        let totalAmount = 0;
        const processedItems = items.map(item => {
            const total = (item.unitPrice || 0) * (item.quantity || 0);
            totalAmount += total;
            return { ...item, totalPrice: total };
        });

        const order = new PurchaseOrder({
            requestId,
            supplierId,
            supplierName: supplier.name,
            items: processedItems,
            totalAmount,
            expectedDelivery,
            createdBy: req.user._id,
            note
        });
        await order.save();

        // Cập nhật trạng thái đề xuất
        request.status = 'purchased';
        await request.save();

        res.status(201).json({ message: 'Tạo đơn đặt hàng thành công', data: order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const getPurchaseOrders = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (status) filter.status = status;
        const orders = await PurchaseOrder.find(filter).sort({ orderDate: -1 });
        res.json({ message: 'Lấy danh sách đơn hàng thành công', data: orders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const updatePurchaseOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const order = await PurchaseOrder.findByIdAndUpdate(id, { status }, { new: true });
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        res.json({ message: 'Cập nhật đơn hàng thành công', data: order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ==============================
// 4. Quản lý tài sản
// ==============================
const createAsset = async (req, res) => {
    try {
        const asset = new Asset(req.body);
        await asset.save();
        res.status(201).json({ message: 'Tạo tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const getAssets = async (req, res) => {
    try {
        const { status, category, assignedTo } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (assignedTo) filter.assignedTo = assignedTo;
        const assets = await Asset.find(filter).sort({ createdAt: -1 });
        res.json({ message: 'Lấy danh sách tài sản thành công', data: assets });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const updateAsset = async (req, res) => {
    try {
        const { id } = req.params;
        const asset = await Asset.findByIdAndUpdate(id, req.body, { new: true });
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Cập nhật tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const deleteAsset = async (req, res) => {
    try {
        const asset = await Asset.findByIdAndDelete(req.params.id);
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Xóa tài sản thành công' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Thêm bảo trì tài sản
const addMaintenance = async (req, res) => {
    try {
        const { id } = req.params;
        const maintenanceRecord = {
            ...req.body,
            recordedBy: req.user._id
        };
        const asset = await Asset.findByIdAndUpdate(
            id,
            { 
                $push: { maintenanceHistory: maintenanceRecord },
                status: 'maintenance'
            },
            { new: true }
        );
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Thêm bảo trì thành công', data: asset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// Thanh lý tài sản
const liquidateAsset = async (req, res) => {
    try {
        const { id } = req.params;
        const { liquidationDate, liquidationValue, reason, note } = req.body;
        const asset = await Asset.findByIdAndUpdate(
            id,
            {
                liquidation: {
                    liquidationDate,
                    liquidationValue,
                    reason,
                    approvedBy: req.user._id,
                    approvedByName: req.user.profile.fullName,
                    note
                },
                status: 'liquidated'
            },
            { new: true }
        );
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Thanh lý tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    createItem,
    getItems,
    updateItem,
    deleteItem,
    createProcurementRequest,
    getProcurementRequests,
    approveProcurementRequest,
    createPurchaseOrder,
    getPurchaseOrders,
    updatePurchaseOrderStatus,
    createAsset,
    getAssets,
    updateAsset,
    deleteAsset,
    addMaintenance,
    liquidateAsset
};