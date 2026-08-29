const mongoose = require('mongoose');
const AuditLog = require('../models/zone1_system/AuditLog');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');

const manageableStatuses = ['active', 'inactive', 'suspended'];

const serializeParent = (user) => ({
  _id: user._id,
  username: user.username,
  profile: {
    fullName: user.profile?.fullName,
    phone: user.profile?.phone,
    email: user.profile?.email
  },
  status: user.status,
  studentIds: (user.parentInfo?.studentIds || []).map((id) => id.toString()),
  createdAt: user.createdAt,
  lastLogin: user.lastLogin
});

const writeAudit = (req, action, target, before, after, reason = '') => AuditLog.create({
  actorId: req.user._id,
  actorUsername: req.user.username,
  action,
  targetType: 'User',
  targetId: target._id,
  before,
  after,
  reason: reason.trim(),
  requestId: req.header('X-Request-Id') || undefined
});

const findParent = async (id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return User.findOne({ _id: id, role: 'parent' });
};

const listParents = async (req, res) => {
  try {
    const filter = { role: 'parent' };
    if (req.query.status) {
      if (!manageableStatuses.includes(req.query.status)) {
        return res.status(400).json({ message: 'Trạng thái lọc không hợp lệ' });
      }
      filter.status = req.query.status;
    }
    const parents = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    return res.json({ data: parents.map(serializeParent) });
  } catch (error) {
    console.error('List parent accounts failed:', error.message);
    return res.status(500).json({ message: 'Không thể tải danh sách tài khoản phụ huynh' });
  }
};

const linkParentStudents = async (req, res) => {
  try {
    const parent = await findParent(req.params.id);
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy tài khoản phụ huynh' });

    const suppliedIds = req.body.studentIds;
    if (!Array.isArray(suppliedIds) || suppliedIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'studentIds phải là danh sách mã học sinh hợp lệ' });
    }
    const uniqueIds = [...new Set(suppliedIds.map(String))];
    const studentCount = await Student.countDocuments({ _id: { $in: uniqueIds }, status: 'enrolled' });
    if (studentCount !== uniqueIds.length) {
      return res.status(400).json({ message: 'Có học sinh không tồn tại hoặc không còn đang theo học' });
    }

    const before = { studentIds: (parent.parentInfo?.studentIds || []).map(String) };
    parent.parentInfo = { ...parent.parentInfo?.toObject?.(), studentIds: uniqueIds };
    await parent.save();
    const after = { studentIds: uniqueIds };
    await writeAudit(req, 'PARENT_STUDENTS_LINKED', parent, before, after, req.body.reason || '');
    return res.json({ message: 'Đã liên kết hồ sơ học sinh với phụ huynh', data: serializeParent(parent) });
  } catch (error) {
    console.error('Link parent students failed:', error.message);
    return res.status(500).json({ message: 'Không thể liên kết học sinh cho phụ huynh' });
  }
};

const updateParentStatus = async (req, res) => {
  try {
    const { status, reason = '' } = req.body;
    if (!manageableStatuses.includes(status)) {
      return res.status(400).json({ message: 'Chỉ có thể đặt trạng thái hoạt động, chờ kích hoạt hoặc tạm ngưng' });
    }
    const parent = await findParent(req.params.id);
    if (!parent) return res.status(404).json({ message: 'Không tìm thấy tài khoản phụ huynh' });
    if (status === 'active' && !(parent.parentInfo?.studentIds || []).length) {
      return res.status(400).json({ message: 'Cần liên kết ít nhất một hồ sơ học sinh trước khi kích hoạt tài khoản' });
    }

    const before = { status: parent.status, authVersion: parent.authVersion || 0 };
    if (parent.status !== status) {
      parent.status = status;
      parent.authVersion = (parent.authVersion || 0) + 1;
      await parent.save();
      await writeAudit(req, 'USER_STATUS_CHANGED', parent, before, { status: parent.status, authVersion: parent.authVersion }, reason);
    }
    return res.json({ message: 'Đã cập nhật trạng thái tài khoản phụ huynh', data: serializeParent(parent) });
  } catch (error) {
    console.error('Update parent status failed:', error.message);
    return res.status(500).json({ message: 'Không thể cập nhật trạng thái tài khoản phụ huynh' });
  }
};

module.exports = { linkParentStudents, listParents, updateParentStatus };
