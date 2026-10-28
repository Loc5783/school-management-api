const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const mongoose = require('mongoose');
const Employee = require('../models/zone2_hr/Employee');
const Requirement = require('../models/zone2_hr/CredentialRequirement');
const Credential = require('../models/zone2_hr/EmployeeCredential');
const Policy = require('../models/zone2_hr/CredentialPolicy');
const AuditLog = require('../models/zone1_system/AuditLog');
const service = require('../services/credentialService');

const uploadDir = path.join(__dirname, '../../uploads/credentials');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Memory storage to inspect binary content before saving
const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 } // 10MB, max 1 file
});

const uploadEvidenceMiddleware = (req, res, next) => {
  uploadEvidence.single('evidenceFile')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Dung lượng tệp minh chứng không được vượt quá 10MB.' });
      }
      return res.status(err.statusCode || 400).json({ message: err.message || 'Lỗi khi tải tệp lên.' });
    }
    next();
  });
};

const detectAndValidateMagicBytes = (buffer) => {
  if (!buffer || buffer.length < 12) return false;
  // PDF: %PDF (25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { mimetype: 'application/pdf', ext: '.pdf' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return { mimetype: 'image/png', ext: '.png' };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mimetype: 'image/jpeg', ext: '.jpg' };
  }
  // WEBP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { mimetype: 'image/webp', ext: '.webp' };
  }
  return false;
};

const isContainedInDir = (parentDir, childPath) => {
  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(childPath);
  const isWindows = process.platform === 'win32';
  const pNorm = isWindows ? resolvedParent.toLowerCase() : resolvedParent;
  const cNorm = isWindows ? resolvedChild.toLowerCase() : resolvedChild;

  const rel = path.relative(pNorm, cNorm);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

const resolveEvidenceFilePath = (filename) => {
  if (!filename || typeof filename !== 'string') return null;
  const trimmed = filename.trim();
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return null;
  }
  const safeFilename = path.basename(trimmed);
  if (safeFilename !== trimmed) {
    return null;
  }

  const baseDir = path.resolve(uploadDir);
  const candidatePath = path.resolve(baseDir, safeFilename);

  // 1. Lexical containment
  if (!isContainedInDir(baseDir, candidatePath)) {
    return null;
  }

  // 2. If candidate exists on disk, verify symlink & canonical realpath containment
  if (fs.existsSync(candidatePath)) {
    try {
      const lstat = fs.lstatSync(candidatePath);
      if (lstat.isSymbolicLink()) {
        return null;
      }
      const realUploadDir = fs.realpathSync(baseDir);
      const realFilePath = fs.realpathSync(candidatePath);
      if (!isContainedInDir(realUploadDir, realFilePath)) {
        return null;
      }
      return realFilePath;
    } catch {
      return null;
    }
  }

  return candidatePath;
};

const verifyPhysicalEvidenceFile = (evidenceFile) => {
  if (!evidenceFile || !evidenceFile.filename) {
    throw service.fail('Không thể phê duyệt xác minh khi hồ sơ chưa có tệp minh chứng hợp lệ được tải lên.', 422);
  }

  const filePath = resolveEvidenceFilePath(evidenceFile.filename);
  if (!filePath) {
    throw service.fail('Tên tệp minh chứng không hợp lệ hoặc chứa đường dẫn không an toàn.', 422);
  }

  if (!fs.existsSync(filePath)) {
    throw service.fail('Tệp minh chứng không tồn tại trên hệ thống lưu trữ. Vui lòng yêu cầu nhân viên tải lại tệp minh chứng mới.', 422);
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw service.fail('Không thể đọc thông tin tệp minh chứng từ hệ thống lưu trữ.', 422);
  }

  if (!stat.isFile()) {
    throw service.fail('Tệp minh chứng trên hệ thống lưu trữ không phải là một tệp hợp lệ.', 422);
  }

  if (stat.size === 0) {
    throw service.fail('Tệp minh chứng trên hệ thống lưu trữ bị rỗng (0 bytes).', 422);
  }

  let headerBuffer;
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    headerBuffer = Buffer.alloc(16);
    fs.readSync(fd, headerBuffer, 0, 16, 0);
  } catch {
    throw service.fail('Không thể đọc nội dung tệp minh chứng để xác thực định dạng.', 422);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }

  const detected = detectAndValidateMagicBytes(headerBuffer);
  if (!detected) {
    throw service.fail('Tệp minh chứng bị hỏng hoặc có định dạng không được phép (chỉ chấp nhận PDF, PNG, JPG, WEBP).', 422);
  }

  if (evidenceFile.mimetype && evidenceFile.mimetype !== detected.mimetype) {
    throw service.fail(`Định dạng thực tế của tệp minh chứng (${detected.mimetype}) không khớp với định dạng khai báo (${evidenceFile.mimetype}).`, 422);
  }

  return filePath;
};

const handle = (operation) => async (req, res) => {
  try { await operation(req, res); }
  catch (error) {
    const conflict = error.code === 11000 || error instanceof mongoose.Error.VersionError;
    res.status(conflict ? 409 : error.statusCode || 500).json({
      message: conflict
        ? 'Hồ sơ vừa thay đổi. Hãy tải lại dữ liệu trước khi lưu.'
        : error.statusCode
          ? error.message
          : 'Không thể xử lý hồ sơ năng lực. Vui lòng thử lại.'
    });
  }
};

const checkVersion = (record, version) => {
  if (version !== undefined && version !== null && version !== '') {
    const numVersion = Number(version);
    if (!Number.isInteger(numVersion) || numVersion !== record.__v) {
      throw service.fail('Hồ sơ vừa thay đổi bởi thao tác khác. Hãy tải lại trước khi lưu.', 409);
    }
  }
};

const sanitizeCredential = (doc) => {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (obj.evidenceFile) {
    const { path: _p, ...cleanFile } = obj.evidenceFile;
    obj.evidenceFile = cleanFile;
  }
  return obj;
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
      if (req.body.version !== 0 && req.body.version !== null && req.body.version !== undefined && req.body.version !== '') throw service.fail('Cấu hình vừa thay đổi. Hãy tải lại.', 409);
      [policy] = await Policy.create([{ key: 'school', schoolType }], { session });
    }
    await service.audit(req.user, 'CREDENTIAL_POLICY_UPDATED', 'CredentialPolicy', policy._id, before, policy.toObject(), session);
    return policy;
  });
  res.json({ message: 'Đã cập nhật loại trường áp dụng', data });
});

const saveCredential = handle(async (req, res) => {
  service.checkId(req.body.employeeId);
  service.checkId(req.body.requirementId);

  let newFileInfo = null;
  let newFilePathOnDisk = null;
  let oldFilenameToClean = null;

  // Validate uploaded file binary content if present
  if (req.file) {
    const validated = detectAndValidateMagicBytes(req.file.buffer);
    if (!validated) {
      throw service.fail('Nội dung tệp không hợp lệ hoặc bị giả mạo định dạng. Chỉ chấp nhận tệp ảnh (PNG, JPEG, WEBP) hoặc PDF thực sự.', 422);
    }
    const cleanOriginalName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeUniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${validated.ext}`;
    newFilePathOnDisk = path.join(uploadDir, safeUniqueName);

    // Write file to storage
    fs.writeFileSync(newFilePathOnDisk, req.file.buffer);

    newFileInfo = {
      filename: safeUniqueName,
      originalName: cleanOriginalName,
      mimetype: validated.mimetype,
      size: req.file.size,
      uploadedAt: new Date()
    };
  }

  try {
    const data = await service.inTransaction(async (session) => {
      const employee = await Employee.findById(req.body.employeeId).session(session);
      const requirement = await Requirement.findOne({ _id: req.body.requirementId, active: true }).session(session);
      const policy = await Policy.findOne({ key: 'school' }).session(session);
      if (!employee || employee.status === 'resigned') throw service.fail('Không tìm thấy nhân viên đang làm việc', 404);
      if (!requirement || !service.applies(requirement, employee, policy?.schoolType || '')) throw service.fail('Giấy tờ không áp dụng cho vị trí hoặc loại trường hiện tại');

      const fields = service.normalizeCredential(req.body, requirement, newFileInfo);
      let record = await Credential.findOne({ employeeId: employee._id, requirementId: requirement._id }).session(session);
      const before = record?.toObject() || {};

      if (record) {
        checkVersion(record, req.body.version);
        if (newFileInfo && record.evidenceFile?.filename) {
          oldFilenameToClean = record.evidenceFile.filename;
        }
        record.set(fields);
        await record.save({ session });
      } else {
        [record] = await Credential.create([{ ...fields, employeeId: employee._id, requirementId: requirement._id }], { session });
      }
      await service.audit(req.user, 'EMPLOYEE_CREDENTIAL_UPDATED', 'EmployeeCredential', record._id, before, record.toObject(), session, fields.note.slice(0, 500));
      return sanitizeCredential(record);
    });

    // Transaction committed successfully -> clean up old file if replaced
    if (oldFilenameToClean && oldFilenameToClean !== newFileInfo?.filename) {
      const oldPath = path.join(uploadDir, oldFilenameToClean);
      try {
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (cleanErr) {
        console.error('Operational error: failed to delete superseded evidence file:', oldFilenameToClean, cleanErr);
      }
    }

    res.json({ message: 'Đã lưu giấy tờ và chuyển về trạng thái chờ xác minh', data });
  } catch (err) {
    // Transaction failed -> clean up newly written file so it does not become an orphan
    if (newFilePathOnDisk && fs.existsSync(newFilePathOnDisk)) {
      try { fs.unlinkSync(newFilePathOnDisk); } catch { /* ignore */ }
    }
    throw err;
  }
});

const reviewCredential = handle(async (req, res) => {
  service.checkId(req.params.id);
  if (!['verified', 'rejected'].includes(req.body.verification)) throw service.fail('Kết quả xác minh không hợp lệ');
  const reviewNote = service.text(req.body.reviewNote || '', 500, 'Ghi chú xác minh', req.body.verification === 'rejected');

  const data = await service.inTransaction(async (session) => {
    const record = await Credential.findById(req.params.id).session(session);
    if (!record) throw service.fail('Không tìm thấy giấy tờ', 404);
    checkVersion(record, req.body.version);
    if (record.verification !== 'pending') throw service.fail('Giấy tờ đã được xử lý. Muốn sửa nội dung hãy cập nhật hồ sơ.', 409);

    const employee = await Employee.findById(record.employeeId).session(session);
    const requirement = await Requirement.findOne({ _id: record.requirementId, active: true }).session(session);
    const policy = await Policy.findOne({ key: 'school' }).session(session);
    if (!employee || employee.status === 'resigned' || !requirement || !service.applies(requirement, employee, policy?.schoolType || '')) throw service.fail('Giấy tờ không còn áp dụng cho nhân viên này');

    // Rule 1: Employees (including HR staff) CANNOT self-verify their own credentials!
    if (employee.userId && String(employee.userId) === String(req.user._id)) {
      throw service.fail('Nhân viên không được phép tự xác minh hồ sơ năng lực của chính mình. Vui lòng chuyển quản trị viên hoặc cấp trên phê duyệt.', 403);
    }

    // Rule 2: Verification requires a valid physical uploaded evidence file
    if (req.body.verification === 'verified') {
      verifyPhysicalEvidenceFile(record.evidenceFile);
      service.normalizeCredential(record.toObject(), requirement);
    }

    const before = record.toObject();
    record.set({ verification: req.body.verification, reviewNote, verifiedBy: req.user._id, verifiedAt: new Date() });
    await record.save({ session });
    await service.audit(req.user, 'EMPLOYEE_CREDENTIAL_REVIEWED', 'EmployeeCredential', record._id, before, record.toObject(), session, reviewNote);
    return sanitizeCredential(record);
  });
  res.json({ message: 'Đã lưu kết quả xác minh', data });
});

const getEvidenceFile = handle(async (req, res) => {
  service.checkId(req.params.id);
  const record = await Credential.findById(req.params.id).populate('employeeId', 'userId fullName');
  if (!record || !record.evidenceFile?.filename) throw service.fail('Không tìm thấy tệp minh chứng', 404);

  // Strict access control: admin, principal, hr, or the employee himself
  const isOwner = record.employeeId?.userId && String(record.employeeId.userId) === String(req.user._id);
  const isStaffManager = ['admin', 'principal', 'hr'].includes(req.user.role);
  if (!isOwner && !isStaffManager) {
    throw service.fail('Bạn không có quyền truy cập tệp minh chứng này', 403);
  }

  const filePath = resolveEvidenceFilePath(record.evidenceFile.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    throw service.fail('Tệp minh chứng không tồn tại trên hệ thống lưu trữ', 404);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw service.fail('Tệp minh chứng không hợp lệ trên hệ thống lưu trữ', 404);
  }

  const downloadName = (record.evidenceFile.originalName || record.evidenceFile.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', record.evidenceFile.mimetype || 'application/octet-stream');
  res.download(filePath, downloadName);
});

const getHistory = handle(async (req, res) => {
  service.checkId(req.params.id);
  res.json({ data: await AuditLog.find({ targetType: 'EmployeeCredential', targetId: req.params.id }).sort({ occurredAt: -1 }).limit(100).lean() });
});

module.exports = {
  getOverview,
  getRequirements,
  saveRequirement,
  savePolicy,
  saveCredential,
  reviewCredential,
  getEvidenceFile,
  getHistory,
  uploadEvidenceMiddleware
};
