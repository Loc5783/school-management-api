const mongoose = require('mongoose');
const ItemMaster = require('../models/zone6_procurement/ItemMaster');
const ProcurementRequest = require('../models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const Asset = require('../models/zone6_procurement/Asset');
const Supplier = require('../models/zone5_nutrition/Supplier'); // dùng chung từ Zone 5
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');

const startOfToday = () => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
};

const parseExpectedDelivery = (value) => {
    if (!value) return { error: 'Vui lòng chọn ngày dự kiến giao' };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { error: 'Ngày dự kiến giao không hợp lệ' };
    const today = startOfToday();
    const latest = new Date(today);
    latest.setFullYear(latest.getFullYear() + 2);
    if (date < today) return { error: 'Ngày dự kiến giao không được trước ngày hiện tại' };
    if (date > latest) return { error: 'Ngày dự kiến giao không được vượt quá 2 năm' };
    return { date };
};

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
        if (req.user.role === 'teacher') filter.requesterId = req.user._id;
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

        if (!['pending', 'approved_l1'].includes(request.status)) {
            return res.status(409).json({ message: 'Đề xuất này đã được xử lý, không thể duyệt hoặc từ chối lại' });
        }

        if (status === 'rejected') {
            if (!String(rejectionReason || '').trim()) return res.status(422).json({ message: 'Vui lòng nhập lý do từ chối' });
            request.status = 'rejected';
            request.rejectionReason = String(rejectionReason).trim().slice(0, 500);
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
            } else return res.status(400).json({ message: 'Cấp phê duyệt không hợp lệ' });
        }
        await request.save();
        await Notification.create({
            recipientId: request.requesterId,
            title: status === 'rejected' ? 'Đề xuất mua sắm bị từ chối' : 'Đề xuất mua sắm đã được duyệt',
            message: status === 'rejected' ? (rejectionReason || 'Đề xuất chưa được phê duyệt.') : 'Đề xuất của bạn đã được phê duyệt và chuyển sang bước mua sắm.',
            type: 'system', link: '/assets', createdBy: req.user._id
        });
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
        const { requestId, supplierId, supplierName: manualSupplierName, items, expectedDelivery, note } = req.body;
        if (!requestId || !mongoose.isValidObjectId(requestId) || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ message: 'Cần chọn đề xuất và ít nhất một hạng mục đặt hàng' });
        }

        // Kiểm tra đề xuất đã được duyệt chưa
        const request = await ProcurementRequest.findById(requestId);
        if (!request) return res.status(404).json({ message: 'Không tìm thấy đề xuất' });
        if (request.status !== 'approved_l2') {
            return res.status(409).json({ message: request.status === 'purchased' ? 'Đề xuất này đã có đơn đặt hàng' : 'Đề xuất chưa được phê duyệt để đặt hàng' });
        }
        if (await PurchaseOrder.exists({ requestId })) return res.status(409).json({ message: 'Đề xuất này đã có đơn đặt hàng' });

        // Kiểm tra supplier
        let supplier = null;
        let supplierName = String(manualSupplierName || '').trim();
        if (supplierId) {
            if (!mongoose.isValidObjectId(supplierId)) return res.status(400).json({ message: 'Nhà cung cấp không hợp lệ' });
            supplier = await Supplier.findById(supplierId);
            if (!supplier || supplier.status !== 'active') return res.status(422).json({ message: 'Nhà cung cấp không tồn tại hoặc đang ngừng hợp tác' });
            supplierName = supplier.name;
        }
        if (!supplierName || supplierName.length > 160) return res.status(422).json({ message: 'Vui lòng chọn hoặc nhập tên nhà cung cấp hợp lệ' });

        const deliveryResult = parseExpectedDelivery(expectedDelivery);
        if (deliveryResult.error) return res.status(422).json({ message: deliveryResult.error });

        // Tính tổng tiền
        let totalAmount = 0;
        const processedItems = items.map(item => {
            const itemId = String(item.itemId || '').trim();
            const quantity = Number(item.quantity);
            const unitPrice = Number(item.unitPrice);
            if (!String(item.itemName || '').trim() || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100000 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100000000000) {
                throw Object.assign(new Error('Mỗi hạng mục phải có tên, số lượng lớn hơn 0 và đơn giá hợp lệ'), { statusCode: 422 });
            }
            const total = unitPrice * quantity;
            totalAmount += total;
            return {
                ...item,
                // Đề xuất nhập tay không có mặt hàng danh mục, nên không gửi
                // chuỗi rỗng vào trường ObjectId của Mongoose.
                itemId: itemId || undefined,
                itemName: String(item.itemName).trim(),
                quantity,
                unitPrice,
                totalPrice: total
            };
        });
        const orderCode = `PO-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        const order = new PurchaseOrder({
            orderCode,
            requestId,
              supplierId: supplier?._id || null,
              supplierName,
            items: processedItems,
            totalAmount,
            expectedDelivery: deliveryResult.date,
            status: 'ordered',
            createdBy: req.user._id,
            note: String(note || '').trim().slice(0, 500)
        });
        await order.save();

        // Cập nhật trạng thái đề xuất
        request.status = 'purchased';
        await request.save();

        res.status(201).json({ message: 'Tạo đơn đặt hàng thành công', data: order });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Đề xuất này đã có đơn đặt hàng, vui lòng tải lại danh sách' });
        console.error(err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể tạo đơn đặt hàng' });
    }
};

const getPurchaseOrders = async (req, res) => {
    try {
        if (!['admin', 'principal'].includes(req.user.role)) return res.status(403).json({ message: 'Bạn không có quyền xem đơn đặt hàng' });
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
        if (!['delivered', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Chỉ có thể xác nhận đã giao hoặc hủy đơn' });
        const current = await PurchaseOrder.findById(id);
        if (!current) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        if (current.status !== 'ordered') return res.status(409).json({ message: 'Chỉ đơn đang đặt mới có thể xác nhận giao hoặc hủy' });
        const order = await PurchaseOrder.findByIdAndUpdate(id, { status }, { new: true });
        res.json({ message: 'Cập nhật đơn hàng thành công', data: order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const updatePurchaseOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ' });
        const deliveryResult = parseExpectedDelivery(req.body.expectedDelivery);
        if (deliveryResult.error) return res.status(422).json({ message: deliveryResult.error });
        const order = await PurchaseOrder.findById(id);
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        if (order.status !== 'ordered') return res.status(409).json({ message: 'Chỉ đơn đang đặt mới được sửa ngày giao' });
        order.expectedDelivery = deliveryResult.date;
        order.note = String(req.body.note ?? order.note ?? '').trim().slice(0, 500);
        await order.save();
        res.json({ message: 'Đã cập nhật thông tin giao hàng', data: order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Không thể cập nhật thông tin giao hàng' });
    }
};

const getProcurementSuppliers = async (req, res) => {
    try {
        const suppliers = await Supplier.find({ status: 'active' }).select('name code contactPerson phone categories rating').sort({ name: 1 });
        res.json({ success: true, data: suppliers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Không thể tải danh sách nhà cung cấp' });
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
        if (!['admin', 'principal'].includes(req.user.role)) return res.status(403).json({ message: 'Bạn không có quyền xem danh mục tài sản toàn trường' });
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
    updatePurchaseOrderDetails,
    getProcurementSuppliers,
    createAsset,
    getAssets,
    updateAsset,
    deleteAsset,
    addMaintenance,
    liquidateAsset
};
