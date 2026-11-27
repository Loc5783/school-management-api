const mongoose = require('mongoose');
const ItemMaster = require('../models/zone6_procurement/ItemMaster');
const ProcurementRequest = require('../models/zone6_procurement/ProcurementRequest');
const PurchaseOrder = require('../models/zone6_procurement/PurchaseOrder');
const Asset = require('../models/zone6_procurement/Asset');
const Supplier = require('../models/zone5_nutrition/Supplier'); // dùng chung từ Zone 5
const User = require('../models/zone1_system/User');
const Notification = require('../models/zone1_system/Notification');
const Classroom = require('../models/zone3_school/Classroom');
const { buildTenantFilter } = require('../services/tenantFilterService');
const { isValidObjectId } = require('../utils/idValidation');
const { sendControllerError } = require('../utils/controllerError');
const { runSafeTransaction } = require('../utils/safeTransaction');

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

const ITEM_EDITABLE_FIELDS = ['code', 'name', 'category', 'unit', 'referencePrice', 'description', 'status'];
const ASSET_EDITABLE_FIELDS = [
    'itemId', 'assetCode', 'name', 'category', 'qrCode', 'serialNumber',
    'originalCost', 'residualValue', 'purchaseDate', 'purchaseValue', 'currentValue',
    'purchaseOrderId', 'classroomId', 'location', 'assignedTo', 'status', 'warrantyExpiry', 'note'
];
const MAINTENANCE_FIELDS = ['maintenanceDate', 'description', 'cost', 'contractor', 'nextMaintenanceDate', 'note'];
const pickAllowed = (body = {}, keys = []) => Object.fromEntries(keys.filter((k) => Object.hasOwn(body || {}, k)).map((k) => [k, body[k]]));

// ==============================
// 1. Quản lý mặt hàng (Item Master)
// ==============================
const createItem = async (req, res) => {
    try {
        const tenantId = req.tenantId || req.user?.tenantId;
        const allowed = pickAllowed(req.body, ITEM_EDITABLE_FIELDS);
        if (allowed.referencePrice != null && (!Number.isFinite(Number(allowed.referencePrice)) || Number(allowed.referencePrice) < 0)) {
            return res.status(422).json({ message: 'Đơn giá tham khảo phải là số không âm' });
        }
        const item = new ItemMaster({ ...allowed, ...(tenantId ? { tenantId } : {}) });
        await item.save();
        res.status(201).json({ message: 'Tạo mặt hàng thành công', data: item });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể tạo mặt hàng');
    }
};

const getItems = async (req, res) => {
    try {
        const { category, status } = req.query;
        const filter = {};
        if (category && typeof category === 'string') filter.category = category;
        if (status && typeof status === 'string') filter.status = status;
        const tenantFilter = buildTenantFilter(req);
        const items = await ItemMaster.find({ ...filter, ...tenantFilter }).sort({ name: 1 });
        res.json({ message: 'Lấy danh sách mặt hàng thành công', data: items });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể lấy danh sách mặt hàng');
    }
};

const updateItem = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID mặt hàng không hợp lệ' });
        const allowed = pickAllowed(req.body, ITEM_EDITABLE_FIELDS);
        if (allowed.referencePrice != null && (!Number.isFinite(Number(allowed.referencePrice)) || Number(allowed.referencePrice) < 0)) {
            return res.status(422).json({ message: 'Đơn giá tham khảo phải là số không âm' });
        }
        const tenantFilter = buildTenantFilter(req);
        const item = await ItemMaster.findOneAndUpdate({ _id: req.params.id, ...tenantFilter }, { $set: allowed }, { new: true, runValidators: true });
        if (!item) return res.status(404).json({ message: 'Không tìm thấy mặt hàng' });
        res.json({ message: 'Cập nhật mặt hàng thành công', data: item });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể cập nhật mặt hàng');
    }
};

const deleteItem = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID mặt hàng không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const item = await ItemMaster.findOneAndDelete({ _id: req.params.id, ...tenantFilter });
        if (!item) return res.status(404).json({ message: 'Không tìm thấy mặt hàng' });
        res.json({ message: 'Xóa mặt hàng thành công' });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể xóa mặt hàng');
    }
};

// ==============================
// 2. Đề xuất mua sắm
// ==============================
const createProcurementRequest = async (req, res) => {
    try {
        const { items, category, requesterDepartment, department, urgency, reason, attachment } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Đề xuất mua sắm phải có ít nhất một hạng mục' });
        }
        let totalEstimatedCost = 0;
        const processedItems = items.map((item, idx) => {
            const qty = Number(item?.quantity);
            const estPrice = Number(item?.estimatedPrice ?? 0);
            const itemName = String(item?.itemName || '').trim();
            if (!itemName || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(estPrice) || estPrice < 0) {
                const invalidErr = new Error(`Hạng mục thứ ${idx + 1} cần có tên, số lượng > 0 và đơn giá dự kiến không âm`);
                invalidErr.statusCode = 422;
                throw invalidErr;
            }
            const cleanItemId = item?.itemId && isValidObjectId(item.itemId) ? item.itemId : undefined;
            const total = estPrice * qty;
            totalEstimatedCost += total;
            return {
                ...(cleanItemId ? { itemId: cleanItemId } : {}),
                itemName,
                unit: String(item?.unit || 'cái').trim(),
                quantity: qty,
                estimatedPrice: estPrice,
                totalEstimated: total,
                note: String(item?.note || '').trim().slice(0, 300)
            };
        });

        const tenantId = req.tenantId || req.user?.tenantId;
        const requesterName = req.user.profile?.fullName || req.user.username || 'Quản trị viên';
        const request = new ProcurementRequest({
            ...(tenantId ? { tenantId } : {}),
            ...(category ? { category: String(category).trim() } : {}),
            ...(requesterDepartment || department ? { requesterDepartment: String(requesterDepartment || department).trim().slice(0, 120) } : {}),
            ...(urgency ? { urgency } : {}),
            ...(reason ? { reason: String(reason).trim().slice(0, 1000) } : {}),
            ...(attachment ? { attachment: String(attachment).trim().slice(0, 1000) } : {}),
            status: 'pending',
            items: processedItems,
            totalEstimatedCost,
            requesterId: req.user._id,
            requesterName
        });
        await request.save();
        res.status(201).json({ message: 'Tạo đề xuất mua sắm thành công', data: request });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể tạo đề xuất mua sắm lúc này');
    }
};

const getProcurementRequests = async (req, res) => {
    try {
        const { status, urgency } = req.query;
        const filter = {};
        if (['teacher', 'chef'].includes(req.user.role)) filter.requesterId = req.user._id;
        if (status) filter.status = status;
        if (urgency) filter.urgency = urgency;
        const tenantFilter = buildTenantFilter(req);
        const requests = await ProcurementRequest.find({ ...filter, ...tenantFilter }).sort({ createdAt: -1 }).lean();
        res.json({ message: 'Lấy danh sách đề xuất thành công', data: requests });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Không thể tải danh sách đề xuất mua sắm' });
    }
};

// Duyệt đề xuất (Level 1 hoặc Level 2; Admin có thẩm quyền duyệt trọn quy trình)
const approveProcurementRequest = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID đề xuất mua sắm không hợp lệ' });
        const { level, status, rejectionReason } = req.body || {}; // level: 1 hoặc 2

        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId;
        const request = await ProcurementRequest.findOne({ _id: id, ...tenantFilter });
        if (!request) return res.status(404).json({ message: 'Không tìm thấy đề xuất' });

        if (!['pending', 'approved_l1'].includes(request.status)) {
            return res.status(409).json({ message: 'Đề xuất này đã được xử lý, không thể duyệt hoặc từ chối lại' });
        }

        const approverName = req.user.profile?.fullName || req.user.username || 'Quản trị viên';

        if (status === 'rejected') {
            if (!String(rejectionReason || '').trim()) return res.status(422).json({ message: 'Vui lòng nhập lý do từ chối' });
            request.status = 'rejected';
            request.rejectionReason = String(rejectionReason).trim().slice(0, 500);
        } else {
            // Ép kiểu số nếu client gửi chuỗi "1"/"2"; nếu bỏ trống, Admin hoặc đơn đã qua bước 1 sẽ tự động duyệt bước 2
            const parsedLevel = (level !== undefined && level !== null && level !== '')
                ? Number(level)
                : (request.status === 'approved_l1' || ['admin', 'principal'].includes(req.user.role) ? 2 : 1);

            if (parsedLevel === 1) {
                request.approverLevel1 = req.user._id;
                request.approverLevel1Name = approverName;
                request.approverLevel1At = new Date();
                request.status = 'approved_l1';
            } else if (parsedLevel === 2) {
                // Nếu Admin duyệt thẳng lên cấp 2 từ trạng thái chờ duyệt, đồng bộ cả thông tin cấp 1 để đủ hồ sơ lập đơn hàng
                if (!request.approverLevel1) {
                    request.approverLevel1 = req.user._id;
                    request.approverLevel1Name = approverName;
                    request.approverLevel1At = new Date();
                }
                request.approverLevel2 = req.user._id;
                request.approverLevel2Name = approverName;
                request.approverLevel2At = new Date();
                request.status = 'approved_l2';
            } else {
                return res.status(400).json({ message: 'Cấp phê duyệt không hợp lệ (chỉ nhận cấp 1 hoặc 2)' });
            }
        }
        await request.save();
        await Notification.create({
            ...(tenantId ? { tenantId } : {}),
            recipientId: request.requesterId,
            title: status === 'rejected' ? 'Đề xuất mua sắm bị từ chối' : 'Đề xuất mua sắm đã được duyệt',
            message: status === 'rejected' ? (rejectionReason || 'Đề xuất chưa được phê duyệt.') : 'Đề xuất của bạn đã được phê duyệt và chuyển sang bước mua sắm.',
            type: 'system', link: '/assets', createdBy: req.user._id
        });
        res.json({ message: 'Duyệt đề xuất thành công', data: request });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Không thể xử lý phê duyệt đề xuất mua sắm' });
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
        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId;
        const request = await ProcurementRequest.findOne({ _id: requestId, ...tenantFilter });
        if (!request) return res.status(404).json({ message: 'Không tìm thấy đề xuất' });
        if (request.status !== 'approved_l2') {
            return res.status(409).json({ message: request.status === 'purchased' ? 'Đề xuất này đã có đơn đặt hàng' : 'Đề xuất chưa được phê duyệt để đặt hàng' });
        }
        if (await PurchaseOrder.exists({ requestId, status: { $ne: 'cancelled' }, ...tenantFilter })) return res.status(409).json({ message: 'Đề xuất này đã có đơn đặt hàng' });

        // Kiểm tra supplier
        let supplier = null;
        let supplierName = String(manualSupplierName || '').trim();
        if (supplierId) {
            if (!mongoose.isValidObjectId(supplierId)) return res.status(400).json({ message: 'Nhà cung cấp không hợp lệ' });
            supplier = await Supplier.findOne({ _id: supplierId, ...tenantFilter });
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
            ...(tenantId ? { tenantId } : {}),
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
        const tenantFilter = buildTenantFilter(req);
        const orders = await PurchaseOrder.find({ ...filter, ...tenantFilter }).sort({ orderDate: -1 });
        res.json({ message: 'Lấy danh sách đơn hàng thành công', data: orders });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const updatePurchaseOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ' });
        const { status } = req.body || {};
        if (!['delivered', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Chỉ có thể xác nhận đã giao hoặc hủy đơn' });
        const tenantFilter = buildTenantFilter(req);
        const current = await PurchaseOrder.findOne({ _id: id, ...tenantFilter });
        if (!current) return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
        if (current.status !== 'ordered') return res.status(409).json({ message: 'Chỉ đơn đang đặt mới có thể xác nhận giao hoặc hủy' });
        if (status === 'cancelled' && Number(current.paidAmount || 0) > 0) {
            return res.status(409).json({ message: 'Đơn hàng đã phát sinh thanh toán nên không thể hủy' });
        }
        const order = await runSafeTransaction(async (session) => {
            const sessionOpt = session ? { session } : {};
            const updatedOrder = await PurchaseOrder.findOneAndUpdate({ _id: id, ...tenantFilter }, { status }, { new: true, ...sessionOpt });
            if (status === 'cancelled' && current.requestId) {
                await ProcurementRequest.updateOne(
                    { _id: current.requestId, status: 'purchased', ...tenantFilter },
                    { $set: { status: 'approved_l2' } },
                    sessionOpt
                );
            }
            return updatedOrder;
        });
        res.json({ message: 'Cập nhật đơn hàng thành công', data: order });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể cập nhật trạng thái đơn hàng');
    }
};

const updatePurchaseOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Mã đơn hàng không hợp lệ' });
        const deliveryResult = parseExpectedDelivery(req.body.expectedDelivery);
        if (deliveryResult.error) return res.status(422).json({ message: deliveryResult.error });
        const tenantFilter = buildTenantFilter(req);
        const order = await PurchaseOrder.findOne({ _id: id, ...tenantFilter });
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
        const tenantFilter = buildTenantFilter(req);
        const suppliers = await Supplier.find({ status: 'active', ...tenantFilter }).select('name code contactPerson phone categories rating').sort({ name: 1 });
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
        const tenantFilter = buildTenantFilter(req);
        const tenantId = req.tenantId || req.user?.tenantId;
        const allowed = pickAllowed(req.body, ASSET_EDITABLE_FIELDS);
        const resolvedOriginalCost = Number(allowed.originalCost ?? allowed.purchaseValue ?? 0);
        if (!Number.isFinite(resolvedOriginalCost) || resolvedOriginalCost < 0) {
            return res.status(422).json({ message: 'Nguyên giá mua sắm phải là số không âm' });
        }
        allowed.originalCost = resolvedOriginalCost;
        if (allowed.residualValue == null && allowed.currentValue != null) {
            const curVal = Number(allowed.currentValue);
            if (Number.isFinite(curVal) && curVal >= 0) allowed.residualValue = curVal;
        }
        delete allowed.purchaseValue;
        delete allowed.currentValue;
        if (allowed.itemId) {
            if (!isValidObjectId(allowed.itemId)) return res.status(422).json({ message: 'Mã danh mục vật tư không hợp lệ' });
        } else {
            delete allowed.itemId;
        }
        if (allowed.purchaseOrderId) {
            if (!isValidObjectId(allowed.purchaseOrderId)) return res.status(422).json({ message: 'Mã đơn đặt hàng không hợp lệ' });
        } else {
            delete allowed.purchaseOrderId;
        }
        if (allowed.assignedTo) {
            const targetUser = isValidObjectId(allowed.assignedTo)
                ? await User.findOne({ _id: allowed.assignedTo, ...tenantFilter }).select('_id profile username').lean()
                : null;
            if (!targetUser) {
                return res.status(422).json({ message: 'Người được giao quản lý tài sản không hợp lệ' });
            }
            allowed.assignedToName = targetUser.profile?.fullName || targetUser.username;
        } else {
            delete allowed.assignedTo;
        }
        if (allowed.classroomId) {
            const targetClassroom = isValidObjectId(allowed.classroomId)
                ? await Classroom.findOne({ _id: allowed.classroomId, ...tenantFilter }).select('_id name').lean()
                : null;
            if (!targetClassroom) {
                return res.status(422).json({ message: 'Lớp học sử dụng tài sản không hợp lệ' });
            }
            if (!allowed.location) allowed.location = targetClassroom.name;
        } else {
            delete allowed.classroomId;
        }
        const asset = new Asset({ ...allowed, ...(tenantId ? { tenantId } : {}) });
        await asset.save();
        res.status(201).json({ message: 'Tạo tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể tạo tài sản');
    }
};

const getAssets = async (req, res) => {
    try {
        if (!['admin', 'principal', 'teacher'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem danh mục tài sản' });
        }
        const { status, category, assignedTo } = req.query;
        const filter = {};
        if (status && typeof status === 'string') filter.status = status;
        if (category && typeof category === 'string') filter.category = category;
        if (assignedTo) {
            if (!isValidObjectId(assignedTo)) return res.status(400).json({ message: 'ID người quản lý tài sản không hợp lệ' });
            filter.assignedTo = assignedTo;
        }
        const tenantFilter = buildTenantFilter(req);
        if (req.user.role === 'teacher') {
            const teacherClassrooms = await Classroom.find({
                ...tenantFilter,
                $or: [{ homeroomTeacherId: req.user._id }, { 'teachers.teacherId': req.user._id }]
            }).select('_id name').lean();
            const classIds = teacherClassrooms.map((c) => c._id);
            const classNames = teacherClassrooms.map((c) => c.name).filter(Boolean);
            filter.$or = [
                { assignedTo: req.user._id },
                ...(classIds.length ? [{ classroomId: { $in: classIds } }] : []),
                ...(classNames.length ? [{ location: { $in: classNames } }] : [])
            ];
        }
        const assets = await Asset.find({ ...filter, ...tenantFilter }).sort({ createdAt: -1 }).lean();
        res.json({ message: 'Lấy danh sách tài sản thành công', data: assets });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể tải danh sách tài sản');
    }
};

const updateAsset = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID tài sản không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const allowed = pickAllowed(req.body, ASSET_EDITABLE_FIELDS);
        if (allowed.originalCost == null && allowed.purchaseValue != null) {
            allowed.originalCost = Number(allowed.purchaseValue);
        }
        if (allowed.originalCost != null && (!Number.isFinite(Number(allowed.originalCost)) || Number(allowed.originalCost) < 0)) {
            return res.status(422).json({ message: 'Nguyên giá tài sản phải là số không âm' });
        }
        if (allowed.residualValue == null && allowed.currentValue != null) {
            allowed.residualValue = Number(allowed.currentValue);
        }
        delete allowed.purchaseValue;
        delete allowed.currentValue;
        if (allowed.assignedTo) {
            const targetUser = isValidObjectId(allowed.assignedTo)
                ? await User.findOne({ _id: allowed.assignedTo, ...tenantFilter }).select('_id profile username').lean()
                : null;
            if (!targetUser) {
                return res.status(422).json({ message: 'Người quản lý tài sản không hợp lệ' });
            }
            allowed.assignedToName = targetUser.profile?.fullName || targetUser.username;
        }
        if (allowed.classroomId) {
            if (!isValidObjectId(allowed.classroomId) || !(await Classroom.exists({ _id: allowed.classroomId, ...tenantFilter }))) {
                return res.status(422).json({ message: 'Lớp học sử dụng tài sản không hợp lệ' });
            }
        }
        const asset = await Asset.findOneAndUpdate({ _id: id, ...tenantFilter }, { $set: allowed }, { new: true, runValidators: true });
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Cập nhật tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể cập nhật tài sản');
    }
};

const deleteAsset = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID tài sản không hợp lệ' });
        const tenantFilter = buildTenantFilter(req);
        const asset = await Asset.findOneAndDelete({ _id: req.params.id, ...tenantFilter });
        if (!asset) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        res.json({ message: 'Xóa tài sản thành công' });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể xóa tài sản');
    }
};

// Thêm bảo trì tài sản
const addMaintenance = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID tài sản không hợp lệ' });
        const cost = Number(req.body?.cost ?? 0);
        if (!Number.isFinite(cost) || cost < 0) {
            return res.status(422).json({ message: 'Chi phí bảo trì phải là số không âm' });
        }
        const tenantFilter = buildTenantFilter(req);
        const current = await Asset.findOne({ _id: id, ...tenantFilter }).select('status');
        if (!current) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        if (current.status === 'liquidated') {
            return res.status(409).json({ message: 'Tài sản đã thanh lý, không thể ghi nhận bảo trì mới' });
        }
        const safeMaint = pickAllowed(req.body, MAINTENANCE_FIELDS);
        const maintenanceRecord = {
            maintenanceDate: safeMaint.maintenanceDate || new Date(),
            description: String(safeMaint.description || '').trim().slice(0, 500),
            contractor: String(safeMaint.contractor || '').trim().slice(0, 160),
            ...(safeMaint.nextMaintenanceDate ? { nextMaintenanceDate: safeMaint.nextMaintenanceDate } : {}),
            note: String(safeMaint.note || '').trim().slice(0, 500),
            cost,
            recordedBy: req.user._id
        };
        const asset = await Asset.findOneAndUpdate(
            { _id: id, ...tenantFilter },
            {
                $push: { maintenanceHistory: maintenanceRecord },
                status: 'maintenance'
            },
            { new: true, runValidators: true }
        );
        res.json({ message: 'Thêm bảo trì thành công', data: asset });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể ghi nhận bảo trì tài sản');
    }
};

// Thanh lý tài sản
const liquidateAsset = async (req, res) => {
    try {
        const { id } = req.params;
        if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID tài sản không hợp lệ' });
        const { liquidationDate, liquidationValue = 0, reason, note } = req.body || {};
        const numericValue = Number(liquidationValue ?? 0);
        if (!Number.isFinite(numericValue) || numericValue < 0) {
            return res.status(422).json({ message: 'Giá trị thanh lý phải là số không âm' });
        }
        const tenantFilter = buildTenantFilter(req);
        const current = await Asset.findOne({ _id: id, ...tenantFilter }).select('status');
        if (!current) return res.status(404).json({ message: 'Không tìm thấy tài sản' });
        if (current.status === 'liquidated') {
            return res.status(409).json({ message: 'Tài sản này đã được thanh lý trước đó' });
        }
        const asset = await Asset.findOneAndUpdate(
            { _id: id, ...tenantFilter },
            {
                liquidation: {
                    liquidationDate: liquidationDate || new Date(),
                    liquidationValue: numericValue,
                    reason: String(reason || '').trim(),
                    approvedBy: req.user._id,
                    approvedByName: req.user.profile?.fullName || req.user.username || 'Quản trị viên',
                    note: String(note || '').trim()
                },
                status: 'liquidated'
            },
            { new: true, runValidators: true }
        );
        res.json({ message: 'Thanh lý tài sản thành công', data: asset });
    } catch (err) {
        console.error(err);
        return sendControllerError(res, err, 'Không thể thanh lý tài sản');
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
