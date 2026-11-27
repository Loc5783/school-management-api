const Notification = require('../models/zone1_system/Notification');
const User = require('../models/zone1_system/User');
const { isValidObjectId } = require('../utils/idValidation');
const { buildTenantFilter } = require('../services/tenantFilterService');
const { syncSchoolOperationalNotifications } = require('../services/schoolOperationalNotificationService');

const getMyNotifications = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 15));
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const tenantFilter = buildTenantFilter(req);

    // Tự động đồng bộ nhắc việc vận hành trong ngày của riêng trường này vào chuông thông báo người phụ trách
    if (page === 1) {
      await syncSchoolOperationalNotifications({ tenantId, user: req.user, req }).catch(() => {});
    }

    const filter = { recipientId: req.user._id, ...tenantFilter };
    if (req.query.unread === 'true') filter.isRead = false;
    const [data, total, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipientId: req.user._id, isRead: false, ...tenantFilter })
    ]);
    res.json({ success: true, data, unread, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) { console.error(error); res.status(500).json({ message: 'Không thể lấy thông báo' }); }
};

const markRead = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID thông báo không hợp lệ' });
    const tenantFilter = buildTenantFilter(req);
    const item = await Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.user._id, ...tenantFilter }, { isRead: true, readAt: new Date() }, { returnDocument: 'after' });
    if (!item) return res.status(404).json({ message: 'Không tìm thấy thông báo' });
    res.json({ success: true, data: item });
  } catch (error) { console.error(error); res.status(500).json({ message: 'Không thể cập nhật thông báo' }); }
};

const markAllRead = async (req, res) => {
  try {
    const tenantFilter = buildTenantFilter(req);
    await Notification.updateMany({ recipientId: req.user._id, isRead: false, ...tenantFilter }, { isRead: true, readAt: new Date() });
    res.json({ success: true });
  } catch (error) { console.error(error); res.status(500).json({ message: 'Không thể cập nhật thông báo' }); }
};

const createNotification = async (req, res) => {
  try {
    const { recipientId, title, message, type = 'info', link = '', metadata = {} } = req.body;
    if (!isValidObjectId(recipientId) || !String(title || '').trim() || !String(message || '').trim()) return res.status(400).json({ message: 'Người nhận, tiêu đề và nội dung là bắt buộc' });
    const tenantFilter = buildTenantFilter(req);
    if (!await User.exists({ _id: recipientId, status: 'active', ...tenantFilter })) return res.status(404).json({ message: 'Không tìm thấy người nhận đang hoạt động' });
    const item = await Notification.create({
      tenantId: req.tenantId || req.user?.tenantId,
      recipientId,
      title: title.trim(),
      message: message.trim(),
      type,
      link,
      metadata,
      createdBy: req.user._id
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) { console.error(error); res.status(500).json({ message: 'Không thể gửi thông báo' }); }
};

module.exports = { getMyNotifications, markRead, markAllRead, createNotification };
