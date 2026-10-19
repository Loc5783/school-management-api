const mongoose = require('mongoose');
const PrincipalTask = require('../models/zone1_system/PrincipalTask');
const Notification = require('../models/zone1_system/Notification');
const User = require('../models/zone1_system/User');

const getActorName = (user) => user.profile?.fullName || user.username || 'Người dùng';

// Tạo công việc giao việc
const createTask = async (req, res) => {
  try {
    const {
      title,
      description = '',
      department,
      sourceType = 'general',
      sourceId = null,
      deduplicationKey = null,
      assignedTo = null,
      dueDate = null,
      priority = 'normal'
    } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(422).json({ message: 'Tiêu đề công việc không được để trống.' });
    }

    const validDepartments = ['hr', 'accountant', 'chef', 'guard', 'teacher'];
    if (!validDepartments.includes(department)) {
      return res.status(422).json({ message: 'Bộ phận phụ trách không hợp lệ.' });
    }

    // Chống tạo trùng việc khi người dùng bấm duyệt nhiều lần hoặc tải lại trang
    if (deduplicationKey) {
      const existing = await PrincipalTask.findOne({ deduplicationKey }).lean();
      if (existing) {
        return res.status(200).json({
          message: 'Công việc này đã được tạo trước đó.',
          data: existing,
          alreadyExists: true
        });
      }
    }

    let assignedUser = null;
    if (assignedTo) {
      if (!mongoose.isValidObjectId(assignedTo)) {
        return res.status(422).json({ message: 'ID người phụ trách không hợp lệ.' });
      }
      assignedUser = await User.findById(assignedTo).select('username profile role').lean();
      if (!assignedUser) {
        return res.status(404).json({ message: 'Không tìm thấy người được phân công.' });
      }
    }

    const actorName = getActorName(req.user);
    const parsedDueDate = dueDate ? new Date(dueDate) : null;

    const task = new PrincipalTask({
      title: title.trim(),
      description: description.trim(),
      department,
      sourceType,
      sourceId,
      deduplicationKey: deduplicationKey || undefined,
      assignedTo: assignedUser ? assignedUser._id : null,
      assignedToName: assignedUser ? getActorName(assignedUser) : '',
      assignedBy: req.user._id,
      assignedByName: actorName,
      dueDate: parsedDueDate,
      priority,
      status: 'pending_acceptance',
      history: [{
        action: 'created',
        actorId: req.user._id,
        actorName,
        actorRole: req.user.role,
        note: `Hiệu trưởng đã giao việc cho bộ phận ${department.toUpperCase()}`,
        at: new Date()
      }]
    });

    await task.save();

    // Gửi thông báo cho người nhận (nếu có chỉ định) hoặc toàn bộ user có role tương ứng
    try {
      let recipientUserIds = [];
      if (assignedUser) {
        recipientUserIds.push(assignedUser._id);
      } else {
        const deptRoleMap = {
          hr: 'hr',
          accountant: 'accountant',
          chef: 'chef',
          guard: 'guard',
          teacher: 'teacher'
        };
        const targetRole = deptRoleMap[department];
        if (targetRole) {
          const deptUsers = await User.find({ role: targetRole, status: 'active' }).select('_id').lean();
          recipientUserIds = deptUsers.map((u) => u._id);
        }
      }

      if (recipientUserIds.length > 0) {
        const notifications = recipientUserIds.map((recipientId) => ({
          recipientId,
          title: `Nhiệm vụ mới từ Hiệu trưởng: ${task.title}`,
          message: `${task.description ? task.description.slice(0, 150) : task.title} · Hạn xử lý: ${parsedDueDate ? parsedDueDate.toLocaleDateString('vi-VN') : 'Không có'}`,
          type: 'info',
          link: '/principal',
          createdBy: req.user._id,
          metadata: { taskId: task._id, department }
        }));
        await Notification.insertMany(notifications);
      }
    } catch (notifErr) {
      console.error('Lỗi gửi thông báo giao việc:', notifErr);
    }

    return res.status(201).json({
      message: 'Giao việc thành công.',
      data: task
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PrincipalTask.findOne({ deduplicationKey: req.body.deduplicationKey }).lean();
      return res.status(200).json({
        message: 'Công việc đã tồn tại trong hệ thống.',
        data: existing,
        alreadyExists: true
      });
    }
    console.error('Lỗi tạo công việc giao việc:', error);
    return res.status(500).json({ message: 'Không thể tạo công việc giao việc.' });
  }
};

// Lấy danh sách công việc có phân quyền và bộ lọc
const getTasks = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const { department, status, priority, overdue } = req.query;

    const filter = {};

    // Phân quyền dữ liệu theo vai trò
    const isExecutive = ['admin', 'principal'].includes(req.user.role);
    if (!isExecutive) {
      // Người phụ trách chỉ xem việc thuộc phạm vi của mình
      const roleDeptMap = {
        hr: 'hr',
        accountant: 'accountant',
        chef: 'chef',
        guard: 'guard',
        teacher: 'teacher'
      };
      const userDept = roleDeptMap[req.user.role];
      if (!userDept) {
        return res.status(403).json({ message: 'Bạn không có quyền truy cập danh sách nhiệm vụ này.' });
      }
      filter.$or = [
        { department: userDept },
        { assignedTo: req.user._id }
      ];
    } else if (department && ['hr', 'accountant', 'chef', 'guard', 'teacher'].includes(department)) {
      filter.department = department;
    }

    if (status && ['pending_acceptance', 'in_progress', 'completed', 'needs_review'].includes(status)) {
      filter.status = status;
    }

    if (priority && ['normal', 'high', 'urgent'].includes(priority)) {
      filter.priority = priority;
    }

    const now = new Date();
    if (overdue === 'true') {
      filter.dueDate = { $lt: now };
      filter.status = { $ne: 'completed' };
    }

    const [tasks, total] = await Promise.all([
      PrincipalTask.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PrincipalTask.countDocuments(filter)
    ]);

    // Thêm cờ tính toán isOverdue
    const enrichedTasks = tasks.map((task) => ({
      ...task,
      isOverdue: task.dueDate && new Date(task.dueDate) < now && task.status !== 'completed'
    }));

    return res.json({
      data: enrichedTasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách công việc:', error);
    return res.status(500).json({ message: 'Không thể tải danh sách công việc.' });
  }
};

// Cập nhật trạng thái công việc (tiếp nhận, hoàn tất, yêu cầu xem lại)
const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(422).json({ message: 'ID công việc không hợp lệ.' });
    }

    const task = await PrincipalTask.findById(id);
    if (!task) {
      return res.status(404).json({ message: 'Không tìm thấy công việc.' });
    }

    const { status, note = '', resultNote = '' } = req.body || {};
    const validStatuses = ['pending_acceptance', 'in_progress', 'completed', 'needs_review'];
    if (!validStatuses.includes(status)) {
      return res.status(422).json({ message: 'Trạng thái công việc không hợp lệ.' });
    }

    const isExecutive = ['admin', 'principal'].includes(req.user.role);
    const roleDeptMap = {
      hr: 'hr',
      accountant: 'accountant',
      chef: 'chef',
      guard: 'guard',
      teacher: 'teacher'
    };
    const userDept = roleDeptMap[req.user.role];
    const isAssignedPerson = task.assignedTo && String(task.assignedTo) === String(req.user._id);
    const isDeptStaff = userDept && userDept === task.department;

    // Kiểm tra quyền chuyển trạng thái:
    // 1. Nhân viên bộ phận có thể:
    //    - Tiếp nhận (pending_acceptance -> in_progress)
    //    - Hoàn tất (in_progress / needs_review -> completed, có ghi kết quả)
    // 2. Hiệu trưởng / Admin:
    //    - Không tự làm thay bộ phận (không tự ghi hoàn tất thay nhân viên nếu chưa có báo cáo)
    //    - Có thể yêu cầu làm lại (needs_review) hoặc mở lại (in_progress) kèm ý kiến chỉ đạo
    let actionType = 'progress_updated';

    if (status === 'in_progress') {
      if (!isExecutive && !isDeptStaff && !isAssignedPerson) {
        return res.status(403).json({ message: 'Bạn không thuộc bộ phận phụ trách công việc này.' });
      }
      actionType = task.status === 'pending_acceptance' ? 'accepted' : 'reopened';
      if (!task.assignedTo && !isExecutive) {
        task.assignedTo = req.user._id;
        task.assignedToName = getActorName(req.user);
      }
    } else if (status === 'completed') {
      if (!isExecutive && !isDeptStaff && !isAssignedPerson) {
        return res.status(403).json({ message: 'Chỉ người phụ trách hoặc bộ phận mới có quyền báo cáo hoàn tất.' });
      }
      if (!resultNote && !note) {
        return res.status(422).json({ message: 'Vui lòng ghi tóm tắt kết quả thực hiện trước khi hoàn tất.' });
      }
      actionType = 'completed';
      task.resultNote = (resultNote || note).trim();
    } else if (status === 'needs_review') {
      if (!isExecutive) {
        return res.status(403).json({ message: 'Chỉ hiệu trưởng hoặc quản trị viên mới có thể yêu cầu xem lại.' });
      }
      actionType = 'reviewed';
    }

    const actorName = getActorName(req.user);
    task.status = status;
    task.history.push({
      action: actionType,
      actorId: req.user._id,
      actorName,
      actorRole: req.user.role,
      note: (note || resultNote || `Đã chuyển sang trạng thái ${status}`).trim(),
      at: new Date()
    });

    await task.save();

    // Gửi thông báo cho người liên quan
    try {
      const notifyTarget = isExecutive ? task.assignedTo : task.assignedBy;
      if (notifyTarget && String(notifyTarget) !== String(req.user._id)) {
        await Notification.create({
          recipientId: notifyTarget,
          title: `Cập nhật nhiệm vụ: ${task.title}`,
          message: `${actorName} đã cập nhật trạng thái thành "${status}": ${(note || resultNote || '').slice(0, 100)}`,
          type: 'info',
          link: '/principal',
          createdBy: req.user._id
        });
      }
    } catch (e) {
      console.error('Lỗi gửi thông báo tiến độ:', e);
    }

    return res.json({
      message: 'Cập nhật tiến độ thành công.',
      data: task
    });
  } catch (error) {
    console.error('Lỗi cập nhật tiến độ công việc:', error);
    return res.status(500).json({ message: 'Không thể cập nhật tiến độ công việc.' });
  }
};

const getDepartmentStaff = async (req, res) => {
  try {
    const { department } = req.query;
    const deptRoleMap = {
      hr: 'hr',
      accountant: 'accountant',
      chef: 'chef',
      guard: 'guard',
      teacher: 'teacher'
    };
    const filter = { status: 'active' };
    if (department && deptRoleMap[department]) {
      filter.role = deptRoleMap[department];
    } else {
      filter.role = { $in: ['hr', 'accountant', 'chef', 'guard', 'teacher'] };
    }
    const users = await User.find(filter)
      .select('_id username profile.fullName role')
      .sort({ 'profile.fullName': 1 })
      .lean();
    return res.json({
      data: users.map((u) => ({
        _id: u._id,
        name: u.profile?.fullName || u.username,
        role: u.role
      }))
    });
  } catch (error) {
    console.error('Lỗi lấy danh sách nhân viên bộ phận:', error);
    return res.status(500).json({ message: 'Không thể tải danh sách nhân viên.' });
  }
};

module.exports = {
  createTask,
  getTasks,
  updateTaskStatus,
  getDepartmentStaff
};
