const mongoose = require('mongoose');
const Training = require('../models/zone2_hr/TrainingEvent');
const Review = require('../models/zone2_hr/StaffReview');
const Employee = require('../models/zone2_hr/Employee');
const { fail, checkId, text, inTransaction, audit } = require('../services/credentialService');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    const conflict = error.code === 11000 || error.code === 112 || error instanceof mongoose.Error.VersionError;
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Dữ liệu vừa thay đổi hoặc đã tồn tại. Hãy tải lại.' : error.statusCode ? error.message : 'Không thể xử lý đào tạo và đánh giá.' });
  }
};
const versionOf = (record, value) => { if (!Number.isInteger(value) || value !== record.__v) throw fail('Dữ liệu đã thay đổi. Hãy tải lại.', 409); };
const isTeacher = (position) => ['teacher', 'head_teacher', 'assistant_teacher'].includes(position);
const requireEmployee = async (id, session) => {
  checkId(id);
  const employee = await Employee.findOne({ _id: id, status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).session(session);
  if (!employee) throw fail('Nhân viên cần có hồ sơ đang làm việc và tài khoản liên kết');
  return employee;
};
const eventDates = (body) => {
  const startsAt = new Date(body.startsAt); const endsAt = new Date(body.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || startsAt <= new Date()) throw fail('Thời gian tập huấn phải ở tương lai và kết thúc sau khi bắt đầu');
  return { startsAt, endsAt };
};

const overview = handle(async (req, res) => {
  const trainingPage = Math.max(1, Number(req.query.trainingPage) || 1);
  const reviewPage = Math.max(1, Number(req.query.reviewPage) || 1);
  if (!Number.isInteger(trainingPage) || !Number.isInteger(reviewPage)) throw fail('Số trang không hợp lệ');
  const [training, trainingCount, reviews, reviewCount, employees, pendingReview, openPlans] = await Promise.all([
    Training.find().sort({ startsAt: -1 }).skip((trainingPage - 1) * 10).limit(10).populate('participants.employeeId', 'fullName employeeCode position').lean(), Training.countDocuments(),
    Review.find().sort({ period: -1, createdAt: -1 }).skip((reviewPage - 1) * 10).limit(10).populate('employeeId', 'fullName employeeCode position').populate('professionalReviewerId', 'fullName employeeCode').lean(), Review.countDocuments(),
    Employee.find({ status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).select('fullName employeeCode position userId').sort({ fullName: 1 }).lean(),
    Review.countDocuments({ professionalStatus: 'pending' }), Review.countDocuments({ improvementStatus: 'open' })
  ]);
  res.json({ data: { training, reviews, employees, summary: { pendingReview, openPlans }, trainingPagination: { page: trainingPage, total: trainingCount, totalPages: Math.max(1, Math.ceil(trainingCount / 10)) }, reviewPagination: { page: reviewPage, total: reviewCount, totalPages: Math.max(1, Math.ceil(reviewCount / 10)) } } });
});

const saveTraining = handle(async (req, res) => {
  const { startsAt, endsAt } = eventDates(req.body);
  if (!['child_care', 'first_aid', 'food_safety', 'fire_safety', 'professional', 'other'].includes(req.body.category)) throw fail('Loại tập huấn không hợp lệ');
  if (!Array.isArray(req.body.employeeIds) || !req.body.employeeIds.length || req.body.employeeIds.length > 100) throw fail('Chọn từ 1 đến 100 nhân viên tham dự');
  const ids = [...new Set(req.body.employeeIds)];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw fail('Mã nhân viên tham dự không hợp lệ');
  const data = await inTransaction(async (session) => {
    const employees = await Employee.find({ _id: { $in: ids }, status: { $in: ['active', 'on_leave'] }, userId: { $ne: null } }).session(session);
    if (employees.length !== ids.length) throw fail('Danh sách nhân viên tham dự không hợp lệ');
    const fields = { title: text(req.body.title, 180, 'Tên tập huấn', true), category: req.body.category, startsAt, endsAt,
      location: text(req.body.location, 180, 'Địa điểm', true), instructor: text(req.body.instructor, 120, 'Người hướng dẫn', true), note: text(req.body.note || '', 1000, 'Ghi chú') };
    let training;
    if (req.params.id) {
      checkId(req.params.id); training = await Training.findById(req.params.id).session(session);
      if (!training) throw fail('Không tìm thấy buổi tập huấn', 404);
      versionOf(training, req.body.version);
      if (training.status !== 'scheduled' || training.startsAt <= new Date() || training.participants.some((p) => p.status !== 'invited')) throw fail('Buổi tập huấn đã diễn ra hoặc đã ghi nhận kết quả', 409);
      training.set(fields); training.participants = ids.map((employeeId) => ({ employeeId })); await training.save({ session });
    } else [training] = await Training.create([{ ...fields, participants: ids.map((employeeId) => ({ employeeId })), createdBy: req.user._id }], { session });
    await audit(req.user, 'TRAINING_UPDATED', 'TrainingEvent', training._id, {}, { ...fields, employeeIds: ids }, session);
    return training;
  });
  res.json({ message: 'Đã lưu lịch tập huấn', data });
});
const recordTraining = handle(async (req, res) => {
  checkId(req.params.id); checkId(req.params.employeeId);
  if (!['attended', 'absent'].includes(req.body.status) || !['passed', 'failed'].includes(req.body.result) || (req.body.status === 'absent' && req.body.result !== 'failed')) throw fail('Kết quả tham dự không hợp lệ');
  const note = text(req.body.note || '', 500, 'Ghi chú');
  const data = await inTransaction(async (session) => {
    const training = await Training.findById(req.params.id).session(session);
    if (!training) throw fail('Không tìm thấy buổi tập huấn', 404);
    versionOf(training, req.body.version);
    if (training.status !== 'scheduled' || training.endsAt > new Date()) throw fail('Chỉ ghi kết quả sau khi buổi tập huấn kết thúc');
    const participant = training.participants.find((item) => String(item.employeeId) === req.params.employeeId);
    if (!participant) throw fail('Nhân viên không thuộc danh sách tham dự');
    const before = { employeeId: participant.employeeId, status: participant.status, result: participant.result };
    participant.set({ status: req.body.status, result: req.body.result, note, recordedBy: req.user._id, recordedAt: new Date() });
    await training.save({ session });
    await audit(req.user, 'TRAINING_RESULT_UPDATED', 'TrainingEvent', training._id, before, { employeeId: participant.employeeId, status: participant.status, result: participant.result, note }, session);
    return training;
  });
  res.json({ message: 'Đã ghi nhận kết quả tập huấn', data });
});
const finishTraining = handle(async (req, res) => {
  checkId(req.params.id);
  const data = await inTransaction(async (session) => {
    const training = await Training.findById(req.params.id).session(session);
    if (!training) throw fail('Không tìm thấy buổi tập huấn', 404);
    versionOf(training, req.body.version);
    if (training.status !== 'scheduled' || training.endsAt > new Date() || training.participants.some((p) => p.result === 'pending')) throw fail('Cần ghi kết quả cho tất cả người tham dự trước khi hoàn tất');
    training.set({ status: 'completed', completedAt: new Date() }); await training.save({ session });
    await audit(req.user, 'TRAINING_COMPLETED', 'TrainingEvent', training._id, { status: 'scheduled' }, { status: 'completed' }, session);
    return training;
  });
  res.json({ message: 'Đã hoàn tất buổi tập huấn', data });
});
const cancelTraining = handle(async (req, res) => {
  checkId(req.params.id); const reason = text(req.body.reason, 500, 'Lý do hủy', true);
  const data = await inTransaction(async (session) => {
    const training = await Training.findById(req.params.id).session(session);
    if (!training) throw fail('Không tìm thấy buổi tập huấn', 404);
    versionOf(training, req.body.version);
    if (training.status !== 'scheduled' || training.startsAt <= new Date() || training.participants.some((p) => p.status !== 'invited')) throw fail('Không thể hủy buổi đã diễn ra hoặc đã ghi kết quả', 409);
    training.status = 'cancelled'; await training.save({ session });
    await audit(req.user, 'TRAINING_CANCELLED', 'TrainingEvent', training._id, { status: 'scheduled' }, { status: 'cancelled' }, session, reason);
    return training;
  });
  res.json({ message: 'Đã hủy lịch tập huấn', data });
});

const saveReview = handle(async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.period || '') || req.body.period > getWorkDate().slice(0, 7)) throw fail('Kỳ đánh giá phải là tháng hiện tại hoặc trước đó');
  const data = await inTransaction(async (session) => {
    const employee = await requireEmployee(req.body.employeeId, session);
    const teacher = isTeacher(employee.position);
    let reviewer = null;
    if (teacher) {
      reviewer = await requireEmployee(req.body.professionalReviewerId, session);
      if (!['head_teacher', 'principal', 'vice_principal'].includes(reviewer.position) || String(reviewer._id) === String(employee._id)) throw fail('Cần tổ trưởng chuyên môn hoặc ban giám hiệu khác chính người được đánh giá');
      const supervisorAccount = await require('../models/zone1_system/User').findOne({ _id: reviewer.userId, role: reviewer.position === 'head_teacher' ? 'teacher' : { $in: ['principal', 'admin'] }, status: 'active' }).session(session);
      if (!supervisorAccount) throw fail('Người xác nhận chuyên môn cần tài khoản đúng vai trò đang hoạt động');
    }
    const fields = { employeeId: employee._id, period: req.body.period, generalAssessment: text(req.body.generalAssessment, 2000, 'Đánh giá chung', true),
      professionalReviewerId: reviewer?._id || null, professionalStatus: teacher ? 'pending' : 'not_required',
      rating: req.body.rating, improvementPlan: text(req.body.improvementPlan || '', 2000, 'Kế hoạch cải thiện'), improvementDueOn: req.body.improvementDueOn || '' };
    if (!['excellent', 'good', 'needs_improvement', 'unsatisfactory'].includes(fields.rating)) throw fail('Mức đánh giá không hợp lệ');
    if (fields.improvementPlan && (!isValidWorkDate(fields.improvementDueOn) || fields.improvementDueOn <= getWorkDate())) throw fail('Hạn kế hoạch cải thiện phải sau hôm nay');
    if (!fields.improvementPlan && fields.improvementDueOn) throw fail('Cần nhập kế hoạch cải thiện khi đặt hạn');
    if (['needs_improvement', 'unsatisfactory'].includes(fields.rating) && !fields.improvementPlan) throw fail('Đánh giá cần cải thiện phải có kế hoạch và hạn hoàn thành');
    let review;
    if (req.params.id) {
      checkId(req.params.id); review = await Review.findById(req.params.id).session(session);
      if (!review) throw fail('Không tìm thấy kỳ đánh giá', 404);
      versionOf(review, req.body.version);
      if (review.status !== 'draft' || String(review.employeeId) !== String(employee._id) || review.period !== fields.period) throw fail('Không thể đổi nhân viên/kỳ hoặc sửa đánh giá đã chốt', 409);
      review.set({ ...fields, professionalAssessment: '', professionalReviewedAt: null, professionalReviewedBy: null }); await review.save({ session });
    } else [review] = await Review.create([{ ...fields, createdBy: req.user._id }], { session });
    await audit(req.user, 'STAFF_REVIEW_UPDATED', 'StaffReview', review._id, {}, { employeeId: employee._id, period: review.period, rating: review.rating, professionalReviewerId: reviewer?._id || null, status: review.status }, session);
    return review;
  });
  res.json({ message: 'Đã lưu đánh giá nhân sự', data });
});
const assignedReviews = handle(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw fail('Số trang không hợp lệ');
  const supervisor = await Employee.findOne({ userId: req.user._id, position: { $in: ['head_teacher', 'principal', 'vice_principal'] }, status: 'active' }).lean();
  if (!supervisor) return res.json({ data: [], pagination: { page, total: 0, totalPages: 1 } });
  const filter = { professionalReviewerId: supervisor._id, professionalStatus: { $in: ['pending', 'approved', 'changes_requested'] } };
  const [data, total] = await Promise.all([
    Review.find(filter).populate('employeeId', 'fullName employeeCode position').sort({ period: -1 }).skip((page - 1) * 10).limit(10).lean(),
    Review.countDocuments(filter)
  ]);
  res.json({ data, pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / 10)) } });
});
const reviewProfessional = handle(async (req, res) => {
  checkId(req.params.id);
  if (!['approved', 'changes_requested'].includes(req.body.decision)) throw fail('Quyết định chuyên môn không hợp lệ');
  const assessment = text(req.body.assessment, 2000, 'Nhận xét chuyên môn', true);
  const data = await inTransaction(async (session) => {
    const supervisor = await Employee.findOne({ userId: req.user._id, position: { $in: ['head_teacher', 'principal', 'vice_principal'] }, status: 'active' }).session(session);
    const review = await Review.findById(req.params.id).session(session);
    if (!supervisor || !review || String(review.professionalReviewerId) !== String(supervisor._id)) throw fail('Bạn không được phân công đánh giá hồ sơ này', 403);
    versionOf(review, req.body.version);
    if (review.status !== 'draft' || review.professionalStatus !== 'pending') throw fail('Đánh giá chuyên môn này đã được xử lý', 409);
    review.set({ professionalStatus: req.body.decision, professionalAssessment: assessment, professionalReviewedBy: req.user._id, professionalReviewedAt: new Date() });
    await review.save({ session });
    await audit(req.user, 'STAFF_REVIEW_PROFESSIONAL', 'StaffReview', review._id, { professionalStatus: 'pending' }, { professionalStatus: review.professionalStatus, assessment }, session);
    return review;
  });
  res.json({ message: 'Đã ghi nhận đánh giá chuyên môn', data });
});
const finalizeReview = handle(async (req, res) => {
  checkId(req.params.id);
  const data = await inTransaction(async (session) => {
    const review = await Review.findById(req.params.id).session(session);
    if (!review) throw fail('Không tìm thấy kỳ đánh giá', 404);
    versionOf(review, req.body.version);
    if (review.status !== 'draft' || review.professionalStatus === 'pending' || review.professionalStatus === 'changes_requested') throw fail('Cần người phụ trách chuyên môn xác nhận trước khi chốt');
    review.set({ status: 'finalized', finalizedBy: req.user._id, finalizedAt: new Date(), improvementStatus: review.improvementPlan ? 'open' : 'none' });
    await review.save({ session });
    await audit(req.user, 'STAFF_REVIEW_FINALIZED', 'StaffReview', review._id, { status: 'draft' }, { status: 'finalized', rating: review.rating, improvementStatus: review.improvementStatus }, session);
    return review;
  });
  res.json({ message: 'Đã chốt đánh giá', data });
});
const finishPlan = handle(async (req, res) => {
  checkId(req.params.id); const result = text(req.body.result, 1000, 'Kết quả cải thiện', true);
  const data = await inTransaction(async (session) => {
    const review = await Review.findById(req.params.id).session(session);
    if (!review) throw fail('Không tìm thấy kỳ đánh giá', 404);
    versionOf(review, req.body.version);
    if (review.status !== 'finalized' || review.improvementStatus !== 'open') throw fail('Kế hoạch không còn mở', 409);
    review.set({ improvementStatus: 'completed', improvementResult: result, improvementCompletedAt: new Date() }); await review.save({ session });
    await audit(req.user, 'STAFF_REVIEW_PLAN_COMPLETED', 'StaffReview', review._id, { improvementStatus: 'open' }, { improvementStatus: 'completed', result }, session);
    return review;
  });
  res.json({ message: 'Đã ghi kết quả kế hoạch cải thiện', data });
});
module.exports = { overview, saveTraining, recordTraining, finishTraining, cancelTraining, saveReview, assignedReviews, reviewProfessional, finalizeReview, finishPlan };
