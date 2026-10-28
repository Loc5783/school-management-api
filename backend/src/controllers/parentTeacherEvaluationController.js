const mongoose = require('mongoose');
const ParentTeacherEvaluation = require('../models/zone3_school/ParentTeacherEvaluation');
const EvaluationPeriod = require('../models/zone3_school/EvaluationPeriod');
const Student = require('../models/zone3_school/Student');
const Classroom = require('../models/zone3_school/Classroom');
const User = require('../models/zone1_system/User');
const { getLinkedStudentIds, isParent } = require('../services/studentAccessService');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');

const getContext = async (req, res) => {
  try {
    if (!isParent(req.user)) {
      return res.status(403).json({ message: 'Chức năng chỉ dành cho tài khoản phụ huynh.' });
    }

    const linkedStudentIds = await getLinkedStudentIds(req.user);
    if (!linkedStudentIds.length) {
      return res.json({ data: { currentPeriod: '', eligibleTargets: [], evaluations: [], activePeriods: [] } });
    }

    const students = await Student.find({
      _id: { $in: linkedStudentIds },
      status: { $in: ['enrolled', 'temporarily_absent'] }
    }).select('fullName classroomId className schoolYear').lean();

    const classroomIds = [...new Set(students.map((s) => String(s.classroomId)).filter(Boolean))];
    const classrooms = await Classroom.find({
      _id: { $in: classroomIds },
      status: 'active'
    }).populate('homeroomTeacherId', 'username profile').lean();

    const classMap = new Map(classrooms.map((c) => [String(c._id), c]));

    // Collect all applicable school years from students and classrooms
    const applicableSchoolYears = [...new Set([
      ...students.map((s) => s.schoolYear).filter(Boolean),
      ...classrooms.map((c) => c.schoolYear).filter(Boolean)
    ])];

    const today = getWorkDate();
    const periodQuery = {
      status: 'open',
      startDate: { $lte: today },
      endDate: { $gte: today }
    };
    if (applicableSchoolYears.length > 0) {
      periodQuery.schoolYear = { $in: applicableSchoolYears };
    }

    const activePeriods = await EvaluationPeriod.find(periodQuery).sort({ endDate: -1 }).lean();

    const selectedPeriodCode = req.query.period
      ? String(req.query.period).trim().toUpperCase()
      : activePeriods[0]?.code || '';

    // ONLY fetch evaluations submitted by current parent to prevent data leakage
    const myEvals = await ParentTeacherEvaluation.find({
      studentId: { $in: linkedStudentIds },
      parentId: req.user._id
    }).sort({ createdAt: -1 }).lean();

    // To check if child was evaluated by ANY family member, project ONLY minimal identifiers
    const familyEvals = await ParentTeacherEvaluation.find({
      studentId: { $in: linkedStudentIds }
    }).select('studentId teacherId period').lean();

    const familyEvaluatedSet = new Set(familyEvals.map((e) => `${e.studentId}:${e.teacherId}:${e.period}`));

    const eligibleTargets = [];
    for (const student of students) {
      const cls = classMap.get(String(student.classroomId));
      if (!cls || !cls.homeroomTeacherId) continue;
      const teacher = cls.homeroomTeacherId;
      const teacherName = teacher.profile?.fullName || teacher.username || 'Giáo viên';
      const studentSchoolYear = cls.schoolYear || student.schoolYear;

      // Filter applicable active periods for this child's school year
      const applicablePeriods = activePeriods.filter(
        (p) => !p.schoolYear || !studentSchoolYear || p.schoolYear === studentSchoolYear
      );

      // Determine the target's current period
      let targetPeriodCode = '';
      if (req.query.studentId && String(student._id) === String(req.query.studentId) && req.query.period) {
        if (applicablePeriods.some((p) => p.code === selectedPeriodCode)) {
          targetPeriodCode = selectedPeriodCode;
        } else if (applicablePeriods.length > 0) {
          targetPeriodCode = applicablePeriods[0].code;
        }
      } else if (req.query.period && applicablePeriods.some((p) => p.code === selectedPeriodCode)) {
        targetPeriodCode = selectedPeriodCode;
      } else if (applicablePeriods.length > 0) {
        targetPeriodCode = applicablePeriods[0].code;
      }

      const key = `${student._id}:${teacher._id}:${targetPeriodCode}`;

      eligibleTargets.push({
        studentId: student._id,
        studentName: student.fullName,
        classroomId: cls._id,
        className: cls.name,
        schoolYear: studentSchoolYear,
        teacherId: teacher._id,
        teacherName,
        applicablePeriods,
        currentPeriod: targetPeriodCode,
        alreadyEvaluated: targetPeriodCode ? familyEvaluatedSet.has(key) : false
      });
    }

    res.json({
      data: {
        currentPeriod: selectedPeriodCode,
        activePeriods,
        eligibleTargets,
        evaluations: myEvals
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Lỗi hệ thống' });
  }
};

const createEvaluation = async (req, res) => {
  try {
    if (!isParent(req.user)) {
      return res.status(403).json({ message: 'Chỉ phụ huynh mới có quyền gửi đánh giá giáo viên chủ nhiệm.' });
    }

    const { studentId, teacherId, period, criteria, overallRating, feedback = '' } = req.body || {};
    if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(teacherId)) {
      return res.status(422).json({ message: 'Học sinh hoặc giáo viên không hợp lệ' });
    }

    const cleanPeriod = String(period || '').trim().toUpperCase();
    if (!cleanPeriod) {
      return res.status(422).json({ message: 'Kỳ đánh giá không được để trống' });
    }

    // Backend validation of period: must exist, open, and within valid window
    const today = getWorkDate();
    const periodDoc = await EvaluationPeriod.findOne({ code: cleanPeriod });
    if (!periodDoc) {
      return res.status(404).json({ message: `Không tìm thấy kỳ đánh giá: ${cleanPeriod}` });
    }
    if (periodDoc.status !== 'open') {
      return res.status(422).json({ message: 'Kỳ đánh giá hiện đã đóng, không tiếp nhận thêm phiếu.' });
    }
    if (periodDoc.startDate > today || periodDoc.endDate < today) {
      return res.status(422).json({
        message: `Thời điểm hiện tại nằm ngoài thời gian mở của kỳ đánh giá (${periodDoc.startDate} đến ${periodDoc.endDate}).`
      });
    }

    // Verify parent links to student
    const linkedStudentIds = await getLinkedStudentIds(req.user);
    const isLinked = linkedStudentIds.some((id) => String(id) === String(studentId));
    if (!isLinked) {
      return res.status(403).json({ message: 'Bạn không có quyền đánh giá cho học sinh này' });
    }

    const student = await Student.findById(studentId);
    if (!student || !['enrolled', 'temporarily_absent'].includes(student.status)) {
      return res.status(422).json({ message: 'Học sinh hiện không theo học tại trường' });
    }

    // Verify classroom is active
    const classroom = await Classroom.findOne({ _id: student.classroomId, status: 'active' });
    if (!classroom) {
      return res.status(422).json({ message: 'Lớp học của học sinh không tồn tại hoặc đã ngưng hoạt động' });
    }

    // Verify teacher is homeroom teacher of this classroom
    if (!classroom.homeroomTeacherId || String(classroom.homeroomTeacherId) !== String(teacherId)) {
      return res.status(422).json({ message: 'Giáo viên được chọn không phải giáo viên chủ nhiệm hiện tại của lớp học sinh đang theo học.' });
    }

    // Strict school year match between Period and Classroom/Student
    if (periodDoc.schoolYear !== classroom.schoolYear) {
      return res.status(422).json({
        message: `Năm học của kỳ đánh giá (${periodDoc.schoolYear}) không khớp với năm học của lớp (${classroom.schoolYear}).`
      });
    }
    if (student.schoolYear && student.schoolYear !== periodDoc.schoolYear) {
      return res.status(422).json({
        message: `Năm học của kỳ đánh giá (${periodDoc.schoolYear}) không khớp với năm học của học sinh (${student.schoolYear}).`
      });
    }

    // Validate criteria ratings (1 to 5 integers)
    const { care, teaching, communication } = criteria || {};
    const validScore = (s) => Number.isInteger(s) && s >= 1 && s <= 5;
    if (!validScore(care) || !validScore(teaching) || !validScore(communication) || !validScore(overallRating)) {
      return res.status(422).json({ message: 'Điểm đánh giá các tiêu chí và điểm chung phải từ 1 đến 5 sao' });
    }

    const cleanFeedback = String(feedback || '').trim();
    if (cleanFeedback.length > 2000) {
      return res.status(422).json({ message: 'Góp ý không được vượt quá 2000 ký tự' });
    }

    const teacher = await User.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin giáo viên' });
    }

    // Check if an evaluation already exists for this student + teacher + period (one per family/student)
    const existing = await ParentTeacherEvaluation.findOne({
      studentId: student._id,
      teacherId: teacher._id,
      period: cleanPeriod
    });
    if (existing) {
      return res.status(409).json({ message: 'Học sinh này đã được gửi đánh giá cho giáo viên trong kỳ này.' });
    }

    const parentName = req.user.profile?.fullName || req.user.username;
    const teacherName = teacher.profile?.fullName || teacher.username;

    const evaluation = await ParentTeacherEvaluation.create({
      parentId: req.user._id,
      parentName,
      studentId: student._id,
      studentName: student.fullName,
      teacherId: teacher._id,
      teacherName,
      classroomId: classroom._id,
      className: classroom.name,
      schoolYear: classroom.schoolYear,
      period: cleanPeriod,
      criteria: { care, teaching, communication },
      overallRating,
      feedback: cleanFeedback
    });

    res.status(201).json({
      message: 'Gửi đánh giá giáo viên chủ nhiệm thành công. Cảm ơn sự phối hợp của phụ huynh!',
      data: evaluation
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Học sinh này đã được gửi đánh giá cho giáo viên trong kỳ này.' });
    }
    res.status(500).json({ message: err.message || 'Lỗi gửi đánh giá' });
  }
};

const getMyEvaluations = async (req, res) => {
  try {
    if (!isParent(req.user)) {
      return res.status(403).json({ message: 'Chức năng chỉ dành cho phụ huynh.' });
    }
    const evaluations = await ParentTeacherEvaluation.find({ parentId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ data: evaluations });
  } catch (err) {
    res.status(500).json({ message: 'Không thể tải danh sách đánh giá.' });
  }
};

const listEvaluations = async (req, res) => {
  try {
    if (!['admin', 'principal', 'hr'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền xem tổng hợp đánh giá của phụ huynh.' });
    }

    const { schoolYear, teacherId, classroomId, period, page = 1, limit = 20 } = req.query;
    const match = {};
    if (schoolYear) match.schoolYear = schoolYear;
    if (teacherId && mongoose.isValidObjectId(teacherId)) match.teacherId = new mongoose.Types.ObjectId(teacherId);
    if (classroomId && mongoose.isValidObjectId(classroomId)) match.classroomId = new mongoose.Types.ObjectId(classroomId);
    if (period) match.period = String(period).trim().toUpperCase();

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [result] = await ParentTeacherEvaluation.aggregate([
      { $match: match },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalCount: { $sum: 1 },
                avgOverall: { $avg: '$overallRating' },
                avgCare: { $avg: '$criteria.care' },
                avgTeaching: { $avg: '$criteria.teaching' },
                avgCommunication: { $avg: '$criteria.communication' }
              }
            }
          ],
          items: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 1,
                parentName: 1,
                studentName: 1,
                className: 1,
                teacherName: 1,
                schoolYear: 1,
                period: 1,
                criteria: 1,
                overallRating: 1,
                feedback: 1,
                createdAt: 1
              }
            }
          ]
        }
      }
    ]);

    const stats = result?.summary?.[0] || {
      totalCount: 0,
      avgOverall: 0,
      avgCare: 0,
      avgTeaching: 0,
      avgCommunication: 0
    };

    const totalCount = stats.totalCount || 0;
    const totalPages = Math.ceil(totalCount / limitNum) || 1;

    res.json({
      data: {
        items: result?.items || [],
        summary: {
          totalCount,
          avgOverall: Number((stats.avgOverall || 0).toFixed(1)),
          avgCare: Number((stats.avgCare || 0).toFixed(1)),
          avgTeaching: Number((stats.avgTeaching || 0).toFixed(1)),
          avgCommunication: Number((stats.avgCommunication || 0).toFixed(1))
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount,
          totalPages
        }
      }
    });
  } catch (err) {
    console.error('Lỗi lấy báo cáo đánh giá phụ huynh:', err);
    res.status(500).json({ message: 'Không thể tải báo cáo đánh giá.' });
  }
};

const runEvaluationTransaction = async (operation) => {
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') {
    const error = new Error('Hệ thống cơ sở dữ liệu yêu cầu Replica Set để thực hiện giao dịch an toàn');
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

const getEvaluationPeriods = async (req, res) => {
  try {
    const periods = await EvaluationPeriod.find().sort({ schoolYear: -1, startDate: -1 }).lean();
    res.json({ data: periods });
  } catch (err) {
    res.status(500).json({ message: 'Không thể tải danh sách kỳ đánh giá.' });
  }
};

const createEvaluationPeriod = async (req, res) => {
  try {
    if (!['admin', 'hr', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền quản lý kỳ đánh giá.' });
    }
    const { code, name, schoolYear, startDate, endDate, status = 'open' } = req.body || {};
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    const cleanYear = String(schoolYear || '').trim();
    if (!cleanCode || !cleanName) return res.status(422).json({ message: 'Mã và tên kỳ đánh giá là bắt buộc' });
    if (!cleanYear || !/^\d{4}-\d{4}$/.test(cleanYear)) {
      return res.status(422).json({ message: 'Năm học không hợp lệ (định dạng YYYY-YYYY, ví dụ: 2026-2027)' });
    }
    if (!isValidWorkDate(startDate) || !isValidWorkDate(endDate) || endDate < startDate) {
      return res.status(422).json({ message: 'Thời gian bắt đầu và kết thúc kỳ không hợp lệ' });
    }

    const AuditLog = require('../models/zone1_system/AuditLog');

    const createdPeriod = await runEvaluationTransaction(async (session) => {
      const existing = await EvaluationPeriod.findOne({ code: cleanCode }).session(session);
      if (existing) {
        const err = new Error('Mã kỳ đánh giá đã tồn tại');
        err.statusCode = 409;
        throw err;
      }

      const [period] = await EvaluationPeriod.create([{
        code: cleanCode,
        name: cleanName,
        schoolYear: cleanYear,
        startDate,
        endDate,
        status: ['open', 'closed'].includes(status) ? status : 'open',
        createdBy: req.user._id
      }], { session });

      await AuditLog.create([{
        actorId: req.user._id,
        actorUsername: req.user.username || req.user.profile?.fullName || 'system',
        action: 'CREATE_EVALUATION_PERIOD',
        targetType: 'EvaluationPeriod',
        targetId: period._id,
        after: period.toObject()
      }], { session });

      return period;
    });

    res.status(201).json({ message: 'Tạo kỳ đánh giá thành công', data: createdPeriod });
  } catch (err) {
    if (err.code === 11000) {
      const keyPattern = Object.keys(err.keyPattern || {})[0];
      if (keyPattern === 'code') {
        return res.status(409).json({ message: 'Mã kỳ đánh giá đã tồn tại' });
      }
      return res.status(409).json({ message: 'Dữ liệu bị trùng lặp' });
    }
    res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi tạo kỳ đánh giá' });
  }
};

const togglePeriodStatus = async (req, res) => {
  try {
    if (!['admin', 'hr', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền cập nhật trạng thái kỳ đánh giá.' });
    }
    const { id } = req.params;
    const { status } = req.body || {};
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'ID kỳ đánh giá không hợp lệ' });
    }
    if (!['open', 'closed'].includes(status)) {
      return res.status(422).json({ message: 'Trạng thái chỉ có thể là "open" hoặc "closed"' });
    }

    const AuditLog = require('../models/zone1_system/AuditLog');

    const result = await runEvaluationTransaction(async (session) => {
      const existing = await EvaluationPeriod.findById(id).session(session);
      if (!existing) {
        const err = new Error('Không tìm thấy kỳ đánh giá');
        err.statusCode = 404;
        throw err;
      }
      if (existing.status === status) {
        return { unchanged: true, period: existing };
      }

      const updated = await EvaluationPeriod.findOneAndUpdate(
        { _id: id, status: existing.status },
        { $set: { status } },
        { session, new: true }
      );
      if (!updated) {
        const current = await EvaluationPeriod.findById(id).session(session);
        return { unchanged: true, period: current };
      }

      await AuditLog.create([{
        actorId: req.user._id,
        actorUsername: req.user.username || req.user.profile?.fullName || 'system',
        action: status === 'open' ? 'OPEN_EVALUATION_PERIOD' : 'CLOSE_EVALUATION_PERIOD',
        targetType: 'EvaluationPeriod',
        targetId: updated._id,
        before: existing.toObject(),
        after: updated.toObject()
      }], { session });

      return { unchanged: false, period: updated };
    });

    if (result.unchanged) {
      return res.json({
        message: `Kỳ đánh giá đã ở trạng thái ${status === 'open' ? 'mở' : 'đóng'}`,
        data: result.period
      });
    }

    res.json({
      message: `Đã ${status === 'open' ? 'mở' : 'đóng'} kỳ đánh giá thành công`,
      data: result.period
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi cập nhật trạng thái kỳ đánh giá' });
  }
};

module.exports = {
  getContext,
  createEvaluation,
  getMyEvaluations,
  listEvaluations,
  getEvaluationPeriods,
  createEvaluationPeriod,
  togglePeriodStatus
};
