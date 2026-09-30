const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const User = require('../models/zone1_system/User');
const { canAccessClassroom, getTeacherClassroomIds, hasSchoolWideReadAccess } = require('../services/schoolDataAccessService');

const editableFields = ['name', 'fullName', 'subject', 'ageGroup', 'maxSize', 'schoolYear'];
const activeStudentStatuses = ['enrolled', 'temporarily_absent'];
let homeroomIndexPromise;
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const isId = (value) => mongoose.isValidObjectId(value);
const pick = (body = {}) => Object.fromEntries(editableFields.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
const validate = (data) => {
  if (!String(data.name || '').trim()) throw error('Tên lớp học là bắt buộc', 422);
  if (!['3-4', '4-5', '5-6'].includes(data.ageGroup)) throw error('Độ tuổi lớp không hợp lệ', 422);
  if (!Number.isInteger(Number(data.maxSize)) || Number(data.maxSize) < 1 || Number(data.maxSize) > 60) throw error('Sĩ số tối đa phải từ 1 đến 60', 422);
  if (!/^\d{4}-\d{4}$/.test(String(data.schoolYear || ''))) throw error('Năm học phải theo dạng YYYY-YYYY', 422);
  if (String(data.subject || '').trim().length > 120) throw error('Môn học không được vượt quá 120 ký tự', 422);
};
const respond = (res, err) => res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Lỗi server' });
const ensureHomeroomAssignmentIndex = () => {
  if (!homeroomIndexPromise) {
    homeroomIndexPromise = Classroom.collection.createIndex(
      { schoolYear: 1, homeroomTeacherId: 1 },
      { name: 'schoolYear_1_homeroomTeacherId_1', unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' } } }
    );
  }
  return homeroomIndexPromise;
};

const createClassroom = async (req, res) => {
  try {
    const data = pick(req.body); data.name = String(data.name || '').trim(); data.subject = String(data.subject || '').trim(); validate(data);
    if (await Classroom.exists({ name: data.name, schoolYear: data.schoolYear, status: 'active' })) throw error('Tên lớp đã tồn tại trong năm học này', 409);
    const classroom = await Classroom.create({ ...data, maxSize: Number(data.maxSize), statistics: { currentStudents: 0, male: 0, female: 0 } });
    res.status(201).json({ success: true, message: 'Tạo lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

const getAllClassrooms = async (req, res) => {
  try {
    const filter = req.query.includeArchived === 'true' ? {} : { status: 'active' };
    if (req.user.role === 'teacher') {
      // A teacher can only discover classrooms that they have been assigned to.
      // This protects attendance/student pages even if a user opens an API URL directly.
      filter._id = { $in: await getTeacherClassroomIds(req.user) };
    } else if (!hasSchoolWideReadAccess(req.user)) {
      throw error('Bạn không có quyền xem danh sách lớp học', 403);
    }
    const classrooms = await Classroom.find(filter).sort({ status: 1, schoolYear: -1, name: 1 });
    res.json({ success: true, message: 'Lấy danh sách lớp học thành công', data: classrooms });
  } catch (err) { console.error(err); respond(res, err); }
};

const getClassroomById = async (req, res) => {
  try {
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, req.params.id)) throw error('Bạn không có quyền xem lớp học này', 403);
    if (req.user.role !== 'teacher' && !hasSchoolWideReadAccess(req.user)) throw error('Bạn không có quyền xem lớp học', 403);
    const classroom = await Classroom.findById(req.params.id); if (!classroom) throw error('Không tìm thấy lớp học', 404);
    res.json({ success: true, message: 'Lấy chi tiết lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

const updateClassroom = async (req, res) => {
  try {
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    const current = await Classroom.findById(req.params.id); if (!current) throw error('Không tìm thấy lớp học', 404);
    const data = { ...pick(req.body), name: Object.hasOwn(req.body, 'name') ? String(req.body.name || '').trim() : current.name, subject: Object.hasOwn(req.body, 'subject') ? String(req.body.subject || '').trim() : current.subject || '', ageGroup: req.body.ageGroup || current.ageGroup, maxSize: Object.hasOwn(req.body, 'maxSize') ? Number(req.body.maxSize) : current.maxSize, schoolYear: req.body.schoolYear || current.schoolYear };
    validate(data);
    if (await Classroom.exists({ _id: { $ne: current._id }, name: data.name, schoolYear: data.schoolYear, status: 'active' })) throw error('Tên lớp đã tồn tại trong năm học này', 409);
    const classroom = await Classroom.findByIdAndUpdate(current._id, { $set: data }, { new: true, runValidators: true });
    res.json({ success: true, message: 'Cập nhật lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

// Kept separate from the general classroom update so a client cannot silently
// assign arbitrary accounts by posting a `teachers` array.
const assignHomeroomTeacher = async (req, res) => {
  try {
    await ensureHomeroomAssignmentIndex();
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) throw error('Không tìm thấy lớp học', 404);
    if (classroom.status !== 'active') throw error('Không thể phân công giáo viên cho lớp đã lưu trữ', 409);

    const teacherId = req.body?.teacherId;
    if (teacherId !== null && teacherId !== undefined && teacherId !== '') {
      if (!isId(teacherId)) throw error('ID giáo viên không hợp lệ', 400);
      const teacher = await User.findOne({ _id: teacherId, role: 'teacher', status: 'active' })
        .select('profile.fullName username');
      if (!teacher) throw error('Chỉ có thể chọn tài khoản giáo viên đang hoạt động', 422);

      const alreadyHomeroom = await Classroom.findOne({
        _id: { $ne: classroom._id },
        schoolYear: classroom.schoolYear,
        status: 'active',
        homeroomTeacherId: teacher._id
      }).select('name');
      if (alreadyHomeroom) throw error(`Giáo viên này đang là chủ nhiệm lớp ${alreadyHomeroom.name} trong năm học ${classroom.schoolYear}`, 409);

      classroom.teachers = (classroom.teachers || []).filter((assignment) =>
        assignment.role !== 'homeroom' && String(assignment.teacherId) !== String(teacher._id)
      );
      classroom.teachers.push({
        teacherId: teacher._id,
        teacherName: teacher.profile?.fullName || teacher.username,
        role: 'homeroom',
        assignedAt: new Date()
      });
      classroom.homeroomTeacherId = teacher._id;
    } else {
      classroom.teachers = (classroom.teachers || []).filter((assignment) => assignment.role !== 'homeroom');
      classroom.homeroomTeacherId = null;
    }

    await classroom.save();
    res.json({
      success: true,
      message: teacherId ? 'Đã phân công giáo viên chủ nhiệm.' : 'Đã bỏ phân công giáo viên chủ nhiệm.',
      data: classroom
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.homeroomTeacherId) return res.status(409).json({ success: false, message: 'Giáo viên này đã được phân công chủ nhiệm một lớp khác trong năm học này' });
    console.error(err); respond(res, err);
  }
};

const deleteClassroom = async (req, res) => {
  try {
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    const classroom = await Classroom.findById(req.params.id); if (!classroom) throw error('Không tìm thấy lớp học', 404);
    if (await Student.exists({ classroomId: classroom._id, status: { $in: activeStudentStatuses } })) throw error('Không thể lưu trữ lớp còn học sinh đang theo học hoặc tạm nghỉ', 409);
    classroom.status = 'archived'; await classroom.save();
    res.json({ success: true, message: 'Đã lưu trữ lớp học', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

module.exports = { createClassroom, getAllClassrooms, getClassroomById, updateClassroom, assignHomeroomTeacher, deleteClassroom };
