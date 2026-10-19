const mongoose = require('mongoose');
const Need = require('../models/zone2_hr/HiringNeed');
const Applicant = require('../models/zone2_hr/JobApplicant');
const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const Classroom = require('../models/zone3_school/Classroom');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Notification = require('../models/zone1_system/Notification');
const { getWorkDate, addWorkDays, isValidWorkDate, isValidTime } = require('../utils/dateHelpers');
const { fail, checkId, text, inTransaction, audit } = require('../services/credentialService');

const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    const conflict = error.code === 11000 || error instanceof mongoose.Error.VersionError || error.code === 112;
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Thông tin vừa thay đổi hoặc đã tồn tại. Hãy tải lại trước khi lưu.' : error.statusCode ? error.message : 'Không thể xử lý tuyển dụng. Vui lòng thử lại.' });
  }
};
const teacherPositions = new Set(['teacher', 'head_teacher', 'assistant_teacher']);
const positions = new Set(['principal', 'vice_principal', ...teacherPositions, 'accountant', 'chef', 'security', 'hr']);
const expectedAccountRole = (position) => teacherPositions.has(position) ? 'teacher' : ({ principal: 'principal', vice_principal: 'principal', chef: 'chef', security: 'guard', accountant: 'accountant', hr: 'hr' })[position];
const versionOf = (record, value) => {
  if (!Number.isInteger(value) || value !== record.__v) throw fail('Thông tin vừa thay đổi. Hãy tải lại trước khi lưu.', 409);
};
const normalizeNeed = async (body, session, existing = null) => {
  if (!positions.has(body.position)) throw fail('Vị trí tuyển không hợp lệ');
  const headcount = Number(body.headcount);
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 20 || headcount < (existing?.approvedCount || 0)) throw fail('Số người cần tuyển phải từ 1 đến 20 và không ít hơn số đã duyệt');
  if (!isValidWorkDate(body.targetStartDate) || (!existing && body.targetStartDate <= getWorkDate())) throw fail('Ngày dự kiến bắt đầu phải sau hôm nay');
  const result = { title: text(body.title, 140, 'Tên nhu cầu', true), position: body.position, headcount, targetStartDate: body.targetStartDate,
    reason: text(body.reason, 1000, 'Lý do tuyển', true), classroomId: null, classroomName: '', shift: null };
  if (teacherPositions.has(body.position)) {
    checkId(body.classroomId);
    const classroom = await Classroom.findOne({ _id: body.classroomId, status: 'active' }).session(session);
    if (!classroom) throw fail('Cần chọn lớp đang hoạt động cho vị trí giáo viên');
    result.classroomId = classroom._id; result.classroomName = classroom.name;
  } else if (['chef', 'security'].includes(body.position)) {
    const shift = body.shift || {};
    if (!isValidTime(shift.startTime) || !isValidTime(shift.endTime) || shift.startTime === shift.endTime ||
      !Array.isArray(shift.weekdays) || !shift.weekdays.length || shift.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw fail('Cần nhập giờ và ngày làm của ca cần tuyển');
    result.shift = { name: text(shift.name, 80, 'Tên ca', true), startTime: shift.startTime, endTime: shift.endTime, weekdays: [...new Set(shift.weekdays)] };
  }
  return result;
};
const getDashboard = handle(async (req, res) => {
  const needPage = Math.max(1, Number(req.query.needPage) || 1);
  const applicantPage = Math.max(1, Number(req.query.applicantPage) || 1);
  if (!Number.isInteger(needPage) || !Number.isInteger(applicantPage)) throw fail('Số trang không hợp lệ');
  const needFilter = req.query.needStatus && ['open', 'filled', 'closed'].includes(req.query.needStatus) ? { status: req.query.needStatus } : {};
  const applicantFilter = {};
  if (req.query.needId) { checkId(req.query.needId); applicantFilter.needId = req.query.needId; }
  if (req.query.applicantStatus && ['applied', 'interviewing', 'recommended', 'approved', 'rejected', 'declined'].includes(req.query.applicantStatus)) applicantFilter.status = req.query.applicantStatus;
  const [needs, needCount, applicants, applicantCount, openNeeds, classrooms, allNeeds, recommendedCount, approved] = await Promise.all([
    Need.find(needFilter).sort({ createdAt: -1 }).skip((needPage - 1) * 10).limit(10).lean(), Need.countDocuments(needFilter),
    Applicant.find(applicantFilter).populate('needId', 'title position classroomName shift status targetStartDate').sort({ createdAt: -1 }).skip((applicantPage - 1) * 10).limit(10).lean(), Applicant.countDocuments(applicantFilter),
    Need.find({ status: 'open' }).select('title position classroomName headcount approvedCount').sort({ createdAt: -1 }).lean(),
    Classroom.find({ status: 'active' }).select('name schoolYear requiredTeachers').sort({ name: 1 }).lean(),
    Need.countDocuments({ status: 'open' }), Applicant.countDocuments({ status: 'recommended' }),
    Applicant.find({ status: 'approved', employeeId: null }).select('onboardingTasks proposedStartDate').lean()
  ]);
  const outstandingTasks = approved.reduce((sum, item) => sum + item.onboardingTasks.filter((task) => task.mandatory && !task.completedAt).length, 0);
  res.json({ data: { needs, applicants, openNeeds, classrooms,
    summary: { openNeeds: allNeeds, vacancies: openNeeds.reduce((sum, item) => sum + item.headcount - item.approvedCount, 0), recommended: recommendedCount, awaitingOnboarding: approved.length, outstandingTasks },
    needPagination: { page: needPage, total: needCount, totalPages: Math.max(1, Math.ceil(needCount / 10)) },
    applicantPagination: { page: applicantPage, total: applicantCount, totalPages: Math.max(1, Math.ceil(applicantCount / 10)) } } });
});
const saveNeed = handle(async (req, res) => {
  const data = await inTransaction(async (session) => {
    let need, before = {};
    if (req.params.id) {
      checkId(req.params.id); need = await Need.findById(req.params.id).session(session);
      if (!need) throw fail('Không tìm thấy nhu cầu tuyển', 404);
      versionOf(need, req.body.version);
      if (need.status === 'closed') throw fail('Nhu cầu đã đóng. Hãy tạo nhu cầu mới.', 409);
      const hasApplicants = await Applicant.exists({ needId: need._id }).session(session);
      if (hasApplicants && (need.position !== req.body.position || String(need.classroomId || '') !== String(req.body.classroomId || '') ||
        JSON.stringify(need.shift ? { name: need.shift.name, startTime: need.shift.startTime, endTime: need.shift.endTime, weekdays: [...need.shift.weekdays].sort() } : null) !==
        JSON.stringify(['chef', 'security'].includes(req.body.position) ? { name: req.body.shift?.name, startTime: req.body.shift?.startTime, endTime: req.body.shift?.endTime, weekdays: [...(req.body.shift?.weekdays || [])].sort() } : null))) {
        throw fail('Đã có ứng viên; không thể đổi vị trí, lớp hoặc ca của nhu cầu tuyển', 409);
      }
      before = { title: need.title, position: need.position, headcount: need.headcount, targetStartDate: need.targetStartDate, reason: need.reason, classroomId: need.classroomId, shift: need.shift, status: need.status };
      need.set(await normalizeNeed(req.body, session, need));
      need.status = need.approvedCount >= need.headcount ? 'filled' : 'open';
      await need.save({ session });
    } else {
      const fields = await normalizeNeed(req.body, session);
      [need] = await Need.create([{ ...fields, createdBy: req.user._id }], { session });
    }
    await audit(req.user, req.params.id ? 'HIRING_NEED_UPDATED' : 'HIRING_NEED_CREATED', 'HiringNeed', need._id, before, { title: need.title, position: need.position, headcount: need.headcount, classroomId: need.classroomId, shift: need.shift, status: need.status }, session);
    return need;
  });
  res.json({ message: 'Đã lưu nhu cầu tuyển dụng', data });
});
const closeNeed = handle(async (req, res) => {
  checkId(req.params.id);
  const reason = text(req.body.reason, 500, 'Lý do đóng', true);
  const data = await inTransaction(async (session) => {
    const need = await Need.findById(req.params.id).session(session);
    if (!need) throw fail('Không tìm thấy nhu cầu tuyển', 404);
    versionOf(need, req.body.version);
    if (need.status === 'closed') throw fail('Nhu cầu đã đóng', 409);
    const before = { status: need.status };
    need.set({ status: 'closed', closedReason: reason }); await need.save({ session });
    await audit(req.user, 'HIRING_NEED_UPDATED', 'HiringNeed', need._id, before, { status: 'closed', closedReason: reason }, session, reason);
    return need;
  });
  res.json({ message: 'Đã đóng nhu cầu tuyển', data });
});
const saveApplicant = handle(async (req, res) => {
  checkId(req.body.needId);
  const fullName = text(req.body.fullName, 120, 'Tên ứng viên', true);
  const phone = text(req.body.phone, 20, 'Số điện thoại', true);
  const phoneKey = phone.replace(/\D/g, '');
  if (phoneKey.length < 9 || phoneKey.length > 12) throw fail('Số điện thoại ứng viên không hợp lệ');
  const email = text(req.body.email || '', 200, 'Email').toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Email không hợp lệ');
  const note = text(req.body.note || '', 1000, 'Ghi chú');
  const data = await inTransaction(async (session) => {
    const need = await Need.findById(req.body.needId).session(session);
    if (!need || (!req.params.id && need.status !== 'open')) throw fail('Chỉ tiếp nhận ứng viên vào nhu cầu tuyển đang mở');
    let applicant, before = {};
    if (req.params.id) {
      checkId(req.params.id); applicant = await Applicant.findById(req.params.id).session(session);
      if (!applicant || String(applicant.needId) !== String(need._id)) throw fail('Không tìm thấy ứng viên của nhu cầu này', 404);
      versionOf(applicant, req.body.version);
      if (!['applied', 'interviewing'].includes(applicant.status)) throw fail('Ứng viên đã vào bước quyết định; không thể sửa hồ sơ trực tiếp', 409);
      before = { fullName: applicant.fullName, phone: applicant.phone, email: applicant.email, note: applicant.note };
      applicant.set({ fullName, phone, phoneKey, email, note }); await applicant.save({ session });
    } else [applicant] = await Applicant.create([{ needId: need._id, fullName, phone, phoneKey, email, note, createdBy: req.user._id }], { session });
    await audit(req.user, req.params.id ? 'APPLICANT_UPDATED' : 'APPLICANT_CREATED', 'JobApplicant', applicant._id, before, { fullName, phone, email, note, needId: need._id }, session);
    return applicant;
  });
  res.json({ message: 'Đã lưu hồ sơ ứng viên', data });
});
const scheduleInterview = handle(async (req, res) => {
  checkId(req.params.id);
  const scheduledAt = new Date(req.body.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) throw fail('Lịch phỏng vấn phải ở tương lai');
  const interviewerName = text(req.body.interviewerName, 120, 'Người phỏng vấn', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (!['applied', 'interviewing'].includes(applicant.status)) throw fail('Ứng viên không còn ở bước phỏng vấn');
    applicant.interviews.push({ scheduledAt, interviewerName }); applicant.status = 'interviewing';
    await applicant.save({ session });
    const interview = applicant.interviews.at(-1);
    await audit(req.user, 'APPLICANT_INTERVIEW_UPDATED', 'JobApplicant', applicant._id, {}, { interviewId: interview._id, scheduledAt, interviewerName }, session);
    return applicant;
  });
  res.json({ message: 'Đã lên lịch phỏng vấn', data });
});
const evaluateInterview = handle(async (req, res) => {
  checkId(req.params.id); checkId(req.params.interviewId);
  if (!['passed', 'failed'].includes(req.body.outcome)) throw fail('Kết quả phỏng vấn không hợp lệ');
  const feedback = text(req.body.feedback, 1000, 'Nhận xét phỏng vấn', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    const interview = applicant.interviews.id(req.params.interviewId);
    if (!interview || interview.outcome !== 'pending' || !['applied', 'interviewing'].includes(applicant.status)) throw fail('Buổi phỏng vấn đã xử lý hoặc ứng viên không còn trong quy trình');
    if (interview.scheduledAt > new Date()) throw fail('Chưa đến giờ phỏng vấn');
    interview.set({ outcome: req.body.outcome, feedback, evaluatedAt: new Date(), evaluatedBy: req.user._id });
    await applicant.save({ session });
    await audit(req.user, 'APPLICANT_INTERVIEW_UPDATED', 'JobApplicant', applicant._id, { interviewId: interview._id, outcome: 'pending' }, { outcome: req.body.outcome, feedback }, session, feedback.slice(0, 500));
    return applicant;
  });
  res.json({ message: 'Đã lưu kết quả phỏng vấn', data });
});
const recommendApplicant = handle(async (req, res) => {
  checkId(req.params.id);
  const startDate = req.body.proposedStartDate;
  if (!isValidWorkDate(startDate) || startDate <= getWorkDate()) throw fail('Ngày dự kiến đi làm phải sau hôm nay');
  const reason = text(req.body.reason, 1000, 'Đề xuất nhận việc', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    const need = await Need.findOne({ _id: applicant.needId, status: 'open' }).session(session);
    if (!need) throw fail('Nhu cầu tuyển đã hết chỗ hoặc đã đóng', 409);
    if (!['applied', 'interviewing', 'recommended'].includes(applicant.status) || !applicant.interviews.some((i) => i.outcome === 'passed')) throw fail('Chỉ đề xuất ứng viên có ít nhất một buổi phỏng vấn đạt');
    const previous = { status: applicant.status, proposedStartDate: applicant.proposedStartDate, decisionReason: applicant.decisionReason };
    applicant.set({ status: 'recommended', proposedStartDate: startDate, decisionReason: reason }); await applicant.save({ session });
    await audit(req.user, 'APPLICANT_RECOMMENDED', 'JobApplicant', applicant._id, previous, { status: 'recommended', proposedStartDate: startDate, reason: reason.slice(0, 500) }, session);
    const managers = await User.find({ role: { $in: ['admin', 'principal'] }, status: 'active' }).select('_id').session(session).lean();
    if (managers.length) await Notification.insertMany(managers.map((manager) => ({ recipientId: manager._id, title: 'Ứng viên chờ quyết định nhận việc', message: `${applicant.fullName} · ${need.title}`, type: 'info', link: '/hr?tab=recruitment', createdBy: req.user._id, metadata: { applicantId: applicant._id } })), { session });
    return applicant;
  });
  res.json({ message: 'Đã chuyển đề xuất cho hiệu trưởng', data });
});
const defaultTasks = (need, startDate) => {
  const dueOn = addWorkDays(startDate, -1);
  const titles = ['Đối chiếu hồ sơ nhân thân và thông tin liên hệ', 'Ký và lưu hợp đồng lao động', 'Tạo tài khoản nhân viên đúng vai trò',
    ...(teacherPositions.has(need.position) ? ['Phân công giáo viên vào lớp đã tuyển', 'Hướng dẫn an toàn và quy trình chăm sóc trẻ'] : []),
    ...(['chef', 'security'].includes(need.position) ? ['Phân ca làm việc', 'Hướng dẫn an toàn tại vị trí làm việc'] : [])];
  return titles.map((title) => ({ title, dueOn, mandatory: true }));
};
const decideApplicant = handle(async (req, res) => {
  checkId(req.params.id);
  if (!['approved', 'rejected'].includes(req.body.decision)) throw fail('Quyết định không hợp lệ');
  const reason = text(req.body.reason, 1000, 'Lý do quyết định', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (applicant.status !== 'recommended') throw fail('Chỉ quyết định ứng viên đã được HR đề xuất');
    const need = await Need.findById(applicant.needId).session(session);
    if (!need) throw fail('Không tìm thấy nhu cầu tuyển', 404);
    if (req.body.decision === 'approved') {
      if (need.status !== 'open' || need.approvedCount >= need.headcount) throw fail('Nhu cầu tuyển đã đủ người hoặc đã đóng', 409);
      if (applicant.proposedStartDate <= getWorkDate()) throw fail('Ngày dự kiến đi làm đã qua; HR cần cập nhật lại đề xuất', 409);
      need.approvedCount += 1; if (need.approvedCount === need.headcount) need.status = 'filled';
      await need.save({ session });
      applicant.onboardingTasks = defaultTasks(need, applicant.proposedStartDate);
    }
    applicant.set({ status: req.body.decision, decisionReason: reason, decidedBy: req.user._id, decidedAt: new Date() });
    await applicant.save({ session });
    await audit(req.user, 'APPLICANT_DECIDED', 'JobApplicant', applicant._id, { status: 'recommended' }, { status: applicant.status, reason: reason.slice(0, 500), proposedStartDate: applicant.proposedStartDate }, session);
    return applicant;
  });
  res.json({ message: req.body.decision === 'approved' ? 'Đã duyệt nhận việc và tạo danh sách tiếp nhận' : 'Đã từ chối ứng viên', data });
});
const stopApplicant = handle(async (req, res) => {
  checkId(req.params.id);
  const reason = text(req.body.reason, 500, 'Lý do dừng tuyển', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (!['applied', 'interviewing', 'recommended'].includes(applicant.status)) throw fail('Ứng viên đã được quyết định hoặc đang tiếp nhận', 409);
    const before = { status: applicant.status };
    applicant.set({ status: 'rejected', decisionReason: reason, decidedAt: new Date(), decidedBy: req.user._id });
    await applicant.save({ session });
    await audit(req.user, 'APPLICANT_DECIDED', 'JobApplicant', applicant._id, before, { status: 'rejected', reason }, session, reason);
    return applicant;
  });
  res.json({ message: 'Đã dừng xử lý ứng viên', data });
});
const declineApplicant = handle(async (req, res) => {
  checkId(req.params.id);
  const reason = text(req.body.reason, 500, 'Lý do ứng viên không nhận việc', true);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (applicant.status !== 'approved' || applicant.employeeId) throw fail('Ứng viên đã được tiếp nhận hoặc không còn ở trạng thái đã duyệt');
    const need = await Need.findById(applicant.needId).session(session);
    if (!need || need.approvedCount < 1) throw fail('Số người đã duyệt không hợp lệ', 409);
    need.approvedCount -= 1; if (need.status === 'filled') need.status = 'open';
    await need.save({ session });
    applicant.set({ status: 'declined', decisionReason: reason }); await applicant.save({ session });
    await audit(req.user, 'APPLICANT_DECIDED', 'JobApplicant', applicant._id, { status: 'approved' }, { status: 'declined', reason }, session, reason);
    return applicant;
  });
  res.json({ message: 'Đã ghi nhận ứng viên không nhận việc', data });
});
const addTask = handle(async (req, res) => {
  checkId(req.params.id);
  const title = text(req.body.title, 150, 'Việc cần hoàn tất', true);
  if (!isValidWorkDate(req.body.dueOn)) throw fail('Hạn hoàn tất không hợp lệ');
  if (typeof req.body.mandatory !== 'boolean') throw fail('Trạng thái bắt buộc không hợp lệ');
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (applicant.status !== 'approved' || applicant.employeeId) throw fail('Chỉ bổ sung việc tiếp nhận trước khi liên kết nhân viên');
    if (req.body.dueOn >= applicant.proposedStartDate) throw fail('Hạn việc tiếp nhận phải trước ngày đi làm');
    applicant.onboardingTasks.push({ title, dueOn: req.body.dueOn, mandatory: req.body.mandatory });
    await applicant.save({ session });
    await audit(req.user, 'APPLICANT_ONBOARDING_UPDATED', 'JobApplicant', applicant._id, {}, { task: title, dueOn: req.body.dueOn, mandatory: req.body.mandatory }, session);
    return applicant;
  });
  res.json({ message: 'Đã thêm việc cần hoàn tất', data });
});
const completeTask = handle(async (req, res) => {
  checkId(req.params.id); checkId(req.params.taskId);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (applicant.status !== 'approved' || applicant.employeeId) throw fail('Hồ sơ đã kết thúc tiếp nhận', 409);
    const task = applicant.onboardingTasks.id(req.params.taskId);
    if (!task || task.completedAt) throw fail('Việc này đã hoàn tất hoặc không còn tồn tại', 409);
    task.set({ completedAt: new Date(), completedBy: req.user._id }); await applicant.save({ session });
    await audit(req.user, 'APPLICANT_ONBOARDING_UPDATED', 'JobApplicant', applicant._id, { task: task.title, completed: false }, { completed: true, completedBy: req.user._id }, session);
    return applicant;
  });
  res.json({ message: 'Đã ghi nhận hoàn thành việc tiếp nhận', data });
});
const linkEmployee = handle(async (req, res) => {
  checkId(req.params.id); checkId(req.body.employeeId);
  const data = await inTransaction(async (session) => {
    const applicant = await Applicant.findById(req.params.id).session(session);
    if (!applicant) throw fail('Không tìm thấy ứng viên', 404);
    versionOf(applicant, req.body.version);
    if (applicant.status !== 'approved' || applicant.employeeId) throw fail('Ứng viên chưa được duyệt hoặc đã liên kết nhân viên');
    if (applicant.onboardingTasks.some((task) => task.mandatory && !task.completedAt)) throw fail('Còn việc tiếp nhận bắt buộc chưa hoàn thành');
    const need = await Need.findById(applicant.needId).session(session);
    const employee = await Employee.findById(req.body.employeeId).populate('userId', 'role status').session(session);
    if (!need || !employee || employee.status !== 'active' || employee.userId?.status !== 'active') throw fail('Cần hồ sơ nhân viên và tài khoản đang hoạt động');
    const role = expectedAccountRole(need.position);
    if (employee.position !== need.position || ![role, ...(role === 'principal' ? ['admin'] : [])].includes(employee.userId?.role)) throw fail('Chức danh hoặc vai trò tài khoản không khớp với nhu cầu tuyển');
    if (employee.fullName.trim().toLocaleLowerCase('vi') !== applicant.fullName.trim().toLocaleLowerCase('vi') ||
      (employee.phone && employee.phone.replace(/\D/g, '') !== applicant.phoneKey)) throw fail('Họ tên hoặc số điện thoại hồ sơ nhân viên không khớp ứng viên');
    if (teacherPositions.has(need.position)) {
      const classroom = await Classroom.findOne({ _id: need.classroomId, status: 'active', $or: [
        { homeroomTeacherId: employee.userId._id }, { teachers: { $elemMatch: { teacherId: employee.userId._id, role: { $in: ['homeroom', 'support'] } } } }
      ] }).session(session);
      if (!classroom) throw fail('Cần phân công giáo viên vào đúng lớp tuyển trước khi hoàn tất tiếp nhận');
    } else if (need.shift) {
      const shift = await StaffShift.findOne({ employeeId: employee._id, status: 'active', validFrom: { $lte: applicant.proposedStartDate }, validUntil: { $gte: applicant.proposedStartDate },
        startTime: need.shift.startTime, endTime: need.shift.endTime }).session(session);
      if (!shift || !need.shift.weekdays.every((day) => shift.weekdays.includes(day))) throw fail('Cần phân ca đúng giờ và ngày làm đã tuyển trước khi hoàn tất tiếp nhận');
    }
    applicant.set({ employeeId: employee._id, onboardedAt: new Date() }); await applicant.save({ session });
    await audit(req.user, 'APPLICANT_LINKED_TO_EMPLOYEE', 'JobApplicant', applicant._id, {}, { employeeId: employee._id, onboardedAt: applicant.onboardedAt }, session);
    return applicant;
  });
  res.json({ message: 'Đã hoàn tất tiếp nhận và liên kết hồ sơ nhân viên', data });
});
const getHistory = handle(async (req, res) => {
  checkId(req.params.id);
  const AuditLog = require('../models/zone1_system/AuditLog');
  res.json({ data: await AuditLog.find({ targetType: 'JobApplicant', targetId: req.params.id }).sort({ occurredAt: -1 }).limit(100).lean() });
});
module.exports = { getDashboard, saveNeed, closeNeed, saveApplicant, scheduleInterview, evaluateInterview, recommendApplicant, decideApplicant, stopApplicant, declineApplicant, addTask, completeTask, linkEmployee, getHistory };
