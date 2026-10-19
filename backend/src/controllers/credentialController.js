const mongoose = require('mongoose');
const Employee = require('../models/zone2_hr/Employee');
const Requirement = require('../models/zone2_hr/CredentialRequirement');
const Credential = require('../models/zone2_hr/EmployeeCredential');
const Policy = require('../models/zone2_hr/CredentialPolicy');
const AuditLog = require('../models/zone1_system/AuditLog');
const service = require('../services/credentialService');

const handle = (operation) => async (req, res) => {
  try { await operation(req, res); }
  catch (error) {
    const conflict = error.code === 11000 || error instanceof mongoose.Error.VersionError;
    res.status(conflict ? 409 : error.statusCode || 500).json({ message: conflict ? 'Hồ sơ vừa thay đổi. Hãy tải lại dữ liệu trước khi lưu.' : error.statusCode ? error.message : 'Không thể xử lý hồ sơ năng lực. Vui lòng thử lại.' });
  }
};
const checkVersion = (record, version) => {
  if (!Number.isInteger(version) || version !== record.__v) throw service.fail('Hồ sơ vừa thay đổi. Hãy tải lại trước khi lưu.', 409);
};
const getOverview = handle(async (req, res) => {
  const data = await service.getCompliance();
  const search = String(req.query.search || '').trim().toLocaleLowerCase('vi');
  const page = Math.max(1, Number(req.query.page) || 1);
  if (!Number.isInteger(page)) throw service.fail('Trang không hợp lệ');
  let rows = data.rows.filter((row) => !search || `${row.fullName} ${row.employeeCode}`.toLocaleLowerCase('vi').includes(search));
  if (req.query.attention === 'true') rows = rows.filter((row) => row.needsAttention);
  if (req.query.employeeId) { service.checkId(req.query.employeeId); rows = rows.filter((row) => String(row._id) === req.query.employeeId); }
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / 10));
  const effectivePage = Math.min(page, totalPages);
  res.json({ data: { ...data, rows: rows.slice((effectivePage - 1) * 10, effectivePage * 10) }, pagination: { page: effectivePage, total, totalPages, limit: 10 } });
});
const getRequirements = handle(async (req, res) => {
  res.json({ data: await Requirement.find().sort({ active: -1, name: 1 }).lean() });
});
const saveRequirement = handle(async (req, res) => {
  const fields = service.normalizeRequirement(req.body);
  const data = await service.inTransaction(async (session) => {
    let record, before = {};
    if (req.params.id) {
      service.checkId(req.params.id);
      record = await Requirement.findById(req.params.id).session(session);
      if (!record) throw service.fail('Không tìm thấy yêu cầu giấy tờ', 404);
      checkVersion(record, req.body.version);
      before = record.toObject();
      record.set(fields);
      await record.save({ session });
    } else { [record] = await Requirement.create([fields], { session }); }
    await service.audit(req.user, 'CREDENTIAL_REQUIREMENT_UPDATED', 'CredentialRequirement', record._id, before, record.toObject(), session);
    return record;
  });
  res.json({ message: 'Đã lưu yêu cầu giấy tờ', data });
});
const savePolicy = handle(async (req, res) => {
  const schoolType = service.text(req.body.schoolType, 100, 'Loại trường');
  const data = await service.inTransaction(async (session) => {
    let policy = await Policy.findOne({ key: 'school' }).session(session);
    const before = policy?.toObject() || {};
    if (policy) { checkVersion(policy, req.body.version); policy.schoolType = schoolType; await policy.save({ session }); }
    else {
      if (req.body.version !== 0) throw service.fail('Cấu hình vừa thay đổi. Hãy tải lại.', 409);
      [policy] = await Policy.create([{ key: 'school', schoolType }], { session });
    }
    await service.audit(req.user, 'CREDENTIAL_POLICY_UPDATED', 'CredentialPolicy', policy._id, before, policy.toObject(), session);
    return policy;
  });
  res.json({ message: 'Đã cập nhật loại trường áp dụng', data });
});
const saveCredential = handle(async (req, res) => {
  service.checkId(req.body.employeeId); service.checkId(req.body.requirementId);
  const data = await service.inTransaction(async (session) => {
    const employee = await Employee.findById(req.body.employeeId).session(session);
    const requirement = await Requirement.findOne({ _id: req.body.requirementId, active: true }).session(session);
    const policy = await Policy.findOne({ key: 'school' }).session(session);
    if (!employee || employee.status === 'resigned') throw service.fail('Không tìm thấy nhân viên đang làm việc', 404);
    if (!requirement || !service.applies(requirement, employee, policy?.schoolType || '')) throw service.fail('Giấy tờ không áp dụng cho vị trí hoặc loại trường hiện tại');
    const fields = service.normalizeCredential(req.body, requirement);
    let record = await Credential.findOne({ employeeId: employee._id, requirementId: requirement._id }).session(session);
    const before = record?.toObject() || {};
    if (record) { checkVersion(record, req.body.version); record.set(fields); await record.save({ session }); }
    else {
      if (req.body.version !== null) throw service.fail('Hồ sơ giấy tờ vừa thay đổi. Hãy tải lại.', 409);
      [record] = await Credential.create([{ ...fields, employeeId: employee._id, requirementId: requirement._id }], { session });
    }
    await service.audit(req.user, 'EMPLOYEE_CREDENTIAL_UPDATED', 'EmployeeCredential', record._id, before, record.toObject(), session, fields.note.slice(0, 500));
    return record;
  });
  res.json({ message: 'Đã lưu giấy tờ và chuyển về chờ xác minh', data });
});
const reviewCredential = handle(async (req, res) => {
  service.checkId(req.params.id);
  if (!['verified', 'rejected'].includes(req.body.verification)) throw service.fail('Kết quả xác minh không hợp lệ');
  const reviewNote = service.text(req.body.reviewNote || '', 500, 'Ghi chú xác minh', true);
  const data = await service.inTransaction(async (session) => {
    const record = await Credential.findById(req.params.id).session(session);
    if (!record) throw service.fail('Không tìm thấy giấy tờ', 404);
    checkVersion(record, req.body.version);
    if (record.verification !== 'pending') throw service.fail('Giấy tờ đã được xử lý. Muốn sửa nội dung hãy cập nhật hồ sơ.', 409);
    const employee = await Employee.findById(record.employeeId).session(session);
    const requirement = await Requirement.findOne({ _id: record.requirementId, active: true }).session(session);
    const policy = await Policy.findOne({ key: 'school' }).session(session);
    if (!employee || employee.status === 'resigned' || !requirement || !service.applies(requirement, employee, policy?.schoolType || '')) throw service.fail('Giấy tờ không còn áp dụng cho nhân viên này');
    if (req.body.verification === 'verified') service.normalizeCredential(record.toObject(), requirement);
    const before = record.toObject();
    record.set({ verification: req.body.verification, reviewNote, verifiedBy: req.user._id, verifiedAt: new Date() });
    await record.save({ session });
    await service.audit(req.user, 'EMPLOYEE_CREDENTIAL_REVIEWED', 'EmployeeCredential', record._id, before, record.toObject(), session, reviewNote);
    return record;
  });
  res.json({ message: 'Đã lưu kết quả xác minh', data });
});
const getHistory = handle(async (req, res) => {
  service.checkId(req.params.id);
  res.json({ data: await AuditLog.find({ targetType: 'EmployeeCredential', targetId: req.params.id }).sort({ occurredAt: -1 }).limit(100).lean() });
});
module.exports = { getOverview, getRequirements, saveRequirement, savePolicy, saveCredential, reviewCredential, getHistory };
