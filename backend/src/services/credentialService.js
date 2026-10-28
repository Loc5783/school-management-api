const mongoose = require('mongoose');
const Employee = require('../models/zone2_hr/Employee');
const Requirement = require('../models/zone2_hr/CredentialRequirement');
const Credential = require('../models/zone2_hr/EmployeeCredential');
const Policy = require('../models/zone2_hr/CredentialPolicy');
const AuditLog = require('../models/zone1_system/AuditLog');
const { getWorkDate, isValidWorkDate } = require('../utils/dateHelpers');

const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });
const checkId = (value) => { if (!mongoose.isValidObjectId(value)) throw fail('Mã hồ sơ không hợp lệ'); };
const text = (value, max, label, required = false) => {
  if (typeof value !== 'string') throw fail(`${label} không hợp lệ`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw fail(`${label} phải có từ ${required ? 1 : 0} đến ${max} ký tự`);
  return result;
};
const positions = new Set(['principal', 'vice_principal', 'head_teacher', 'teacher', 'assistant_teacher', 'accountant', 'chef', 'hr', 'nurse', 'security', 'cleaner']);
const normalizeRequirement = (body) => {
  if (!['degree', 'certificate', 'training', 'health', 'other'].includes(body.category)) throw fail('Loại giấy tờ không hợp lệ');
  if (!Array.isArray(body.positions) || !body.positions.length || body.positions.some((p) => !positions.has(p))) throw fail('Cần chọn ít nhất một vị trí áp dụng hợp lệ');
  for (const key of ['required', 'expiryRequired', 'active']) if (typeof body[key] !== 'boolean') throw fail('Cấu hình yêu cầu không hợp lệ');
  const warningDays = Number(body.warningDays);
  if (!Number.isInteger(warningDays) || warningDays < 1 || warningDays > 365) throw fail('Số ngày nhắc trước phải từ 1 đến 365');
  return { name: text(body.name, 150, 'Tên giấy tờ', true), category: body.category, positions: [...new Set(body.positions)],
    schoolType: text(body.schoolType || '', 100, 'Loại trường'), required: body.required, expiryRequired: body.expiryRequired,
    active: body.active, warningDays, note: text(body.note || '', 500, 'Ghi chú') };
};
const normalizeCredential = (body, requirement, file = null) => {
  const issuedOn = body.issuedOn;
  const expiresOn = body.expiresOn || '';
  if (!isValidWorkDate(issuedOn) || issuedOn > getWorkDate()) throw fail('Ngày cấp phải hợp lệ và không ở tương lai');
  if ((requirement.expiryRequired && !expiresOn) || (expiresOn && (!isValidWorkDate(expiresOn) || expiresOn < issuedOn))) throw fail('Ngày hết hạn phải hợp lệ và không trước ngày cấp');
  const evidenceUrl = text(body.evidenceUrl || '', 2000, 'Đường dẫn minh chứng');
  if (evidenceUrl) {
    let url;
    try { url = new URL(evidenceUrl); } catch { throw fail('Đường dẫn minh chứng không hợp lệ'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw fail('Minh chứng phải là đường dẫn HTTP/HTTPS không chứa mật khẩu');
  }
  const result = {
    number: text(body.number || '', 100, 'Số văn bằng'),
    issuer: text(body.issuer, 200, 'Nơi cấp', true),
    issuedOn,
    expiresOn,
    evidenceUrl,
    note: text(body.note || '', 1000, 'Ghi chú'),
    verification: 'pending',
    verifiedBy: null,
    verifiedAt: null,
    reviewNote: ''
  };
  if (file) {
    result.evidenceFile = {
      filename: file.filename,
      originalName: file.originalName || file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      uploadedAt: file.uploadedAt || new Date()
    };
  }
  return result;
};
const inTransaction = async (operation) => {
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') throw fail('MongoDB cần Replica Set để lưu thay đổi nhân sự cùng lịch sử thao tác', 503);
  const session = await mongoose.startSession();
  try { let result; await session.withTransaction(async () => { result = await operation(session); }); return result; }
  finally { await session.endSession(); }
};
const audit = async (user, action, targetType, targetId, before, after, session, reason = '') => AuditLog.create([{
  actorId: user._id, actorUsername: user.username || String(user._id), action, targetType, targetId, before, after, reason
}], { session });
const applies = (requirement, employee, schoolType) => requirement.positions.includes(employee.position)
  && (!requirement.schoolType || requirement.schoolType === schoolType);
const credentialState = (record, requirement, today = getWorkDate()) => {
  if (!record) return 'missing';
  if (record.expiresOn && record.expiresOn < today) return 'expired';
  if (record.verification !== 'verified') return record.verification;
  if (requirement.expiryRequired && !record.expiresOn) return 'missing_expiry';
  if (record.expiresOn) {
    const days = (Date.parse(`${record.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    if (days <= requirement.warningDays) return 'expiring';
  }
  return 'valid';
};
const getCompliance = async () => {
  const [policy, requirements, employees, credentials] = await Promise.all([
    Policy.findOne({ key: 'school' }).lean(), Requirement.find().sort({ name: 1 }).lean(),
    Employee.find({ status: { $in: ['active', 'on_leave'] } }).select('_id userId employeeCode fullName position status qualification').sort({ fullName: 1 }).lean(),
    Credential.find().lean()
  ]);
  const schoolType = policy?.schoolType || '';
  const today = getWorkDate();
  const records = new Map(credentials.map((r) => [`${r.employeeId}:${r.requirementId}`, r]));
  const rows = employees.map((employee) => {
    const documents = requirements.filter((requirement) => requirement.active && applies(requirement, employee, schoolType)).map((requirement) => {
      const record = records.get(`${employee._id}:${requirement._id}`) || null;
      return { requirement, record, state: credentialState(record, requirement, today) };
    });
    const archivedDocuments = requirements.filter((requirement) => !requirement.active || !applies(requirement, employee, schoolType)).flatMap((requirement) => {
      const record = records.get(`${employee._id}:${requirement._id}`);
      return record ? [{ requirement, record }] : [];
    });
    return { ...employee, documents, archivedDocuments, needsAttention: documents.some((d) => d.state === 'expired' || d.state === 'expiring' || (d.requirement.required && d.state !== 'valid')) };
  });
  const summary = { employees: rows.length, needsAttention: rows.filter((r) => r.needsAttention).length, missing: 0, pending: 0, expired: 0, expiring: 0 };
  for (const row of rows) for (const d of row.documents) {
    if (['missing', 'missing_expiry', 'rejected'].includes(d.state) && d.requirement.required) summary.missing++;
    if (d.state === 'pending') summary.pending++;
    if (d.state === 'expired') summary.expired++;
    if (d.state === 'expiring') summary.expiring++;
  }
  return { policy: policy || { schoolType: '', __v: 0 }, today, requirements: requirements.filter((r) => r.active && (!r.schoolType || r.schoolType === schoolType)), rows, summary };
};
module.exports = { fail, checkId, text, normalizeRequirement, normalizeCredential, inTransaction, audit, applies, getCompliance, credentialState };
