const mongoose = require('mongoose');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');

const editableFields = ['name', 'fullName', 'ageGroup', 'maxSize', 'schoolYear', 'teachers'];
const activeStudentStatuses = ['enrolled', 'temporarily_absent'];
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const isId = (value) => mongoose.isValidObjectId(value);
const pick = (body = {}) => Object.fromEntries(editableFields.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
const validate = (data) => {
  if (!String(data.name || '').trim()) throw error('Tên lớp học là bắt buộc', 422);
  if (!['3-4', '4-5', '5-6'].includes(data.ageGroup)) throw error('Độ tuổi lớp không hợp lệ', 422);
  if (!Number.isInteger(Number(data.maxSize)) || Number(data.maxSize) < 1 || Number(data.maxSize) > 60) throw error('Sĩ số tối đa phải từ 1 đến 60', 422);
  if (!/^\d{4}-\d{4}$/.test(String(data.schoolYear || ''))) throw error('Năm học phải theo dạng YYYY-YYYY', 422);
};
const respond = (res, err) => res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Lỗi server' });

const createClassroom = async (req, res) => {
  try {
    const data = pick(req.body); data.name = String(data.name || '').trim(); validate(data);
    if (await Classroom.exists({ name: data.name, schoolYear: data.schoolYear, status: 'active' })) throw error('Tên lớp đã tồn tại trong năm học này', 409);
    const classroom = await Classroom.create({ ...data, maxSize: Number(data.maxSize), statistics: { currentStudents: 0, male: 0, female: 0 } });
    res.status(201).json({ success: true, message: 'Tạo lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

const getAllClassrooms = async (req, res) => {
  try {
    const filter = req.query.includeArchived === 'true' ? {} : { status: 'active' };
    const classrooms = await Classroom.find(filter).sort({ status: 1, schoolYear: -1, name: 1 });
    res.json({ success: true, message: 'Lấy danh sách lớp học thành công', data: classrooms });
  } catch (err) { console.error(err); respond(res, err); }
};

const getClassroomById = async (req, res) => {
  try {
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    const classroom = await Classroom.findById(req.params.id); if (!classroom) throw error('Không tìm thấy lớp học', 404);
    res.json({ success: true, message: 'Lấy chi tiết lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
};

const updateClassroom = async (req, res) => {
  try {
    if (!isId(req.params.id)) throw error('ID lớp học không hợp lệ', 400);
    const current = await Classroom.findById(req.params.id); if (!current) throw error('Không tìm thấy lớp học', 404);
    const data = { ...pick(req.body), name: Object.hasOwn(req.body, 'name') ? String(req.body.name || '').trim() : current.name, ageGroup: req.body.ageGroup || current.ageGroup, maxSize: Object.hasOwn(req.body, 'maxSize') ? Number(req.body.maxSize) : current.maxSize, schoolYear: req.body.schoolYear || current.schoolYear };
    validate(data);
    if (await Classroom.exists({ _id: { $ne: current._id }, name: data.name, schoolYear: data.schoolYear, status: 'active' })) throw error('Tên lớp đã tồn tại trong năm học này', 409);
    const classroom = await Classroom.findByIdAndUpdate(current._id, { $set: data }, { new: true, runValidators: true });
    res.json({ success: true, message: 'Cập nhật lớp học thành công', data: classroom });
  } catch (err) { console.error(err); respond(res, err); }
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

module.exports = { createClassroom, getAllClassrooms, getClassroomById, updateClassroom, deleteClassroom };
