'use strict';

/**
 * @fileoverview Bộ điều khiển quản lý Danh sách & Cấu hình Phân hiệu / Cơ sở (Campuses)
 * trong phạm vi một trường (`tenantId`).
 *
 * Phân tách rõ ranh giới quyền hạn:
 * - **SuperAdmin (`PlatformAdmin`)**: Quản lý định danh cấp Trường (`name`, `code`, `organizationCode`, `status`,
 *   `enabledModules`, `quotas`) và Cấu hình chung toàn chuỗi.
 * - **Admin từng trường (`role: 'admin'`)**: Chỉ quản lý cấu hình vận hành của các Phân hiệu / Cơ sở trực thuộc
 *   trường mình (`address`, `phone`, `managerName`, `openTime`, `closeTime`, `maxClassrooms`, `notes`, `isActive`)
 *   trong phạm vi hạn mức `maxCampuses` được cấp.
 */

const Tenant = require('../models/zone1_system/Tenant');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const { buildTenantFilter } = require('../services/tenantFilterService');
const {
  ALL_ENABLED_MODULES,
  sanitizeEnabledModules,
  getSystemSettings
} = require('../services/superAdminControlService');
const { runSafeTransaction } = require('../utils/safeTransaction');

const CAMPUS_CODE_REGEX = /^[A-Z0-9_-]{2,20}$/;
const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const escapeRegex = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCampusCode = (rawCode, fallbackName = '') => {
  if (rawCode && String(rawCode).trim()) {
    const explicit = String(rawCode).trim().toUpperCase().replace(/\s+/g, '-');
    return explicit.length === 1 ? `CS-${explicit}` : explicit;
  }
  const slug = String(fallbackName || 'CS')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 16);
  if (!slug) return 'CS-CHINH';
  return slug.length < 2 ? `CS-${slug}` : slug;
};

const ensureMainCampusPresent = (campuses = [], defaults = {}) => {
  const list = Array.isArray(campuses) ? [...campuses] : [];
  const hasMain = list.some(
    (c) =>
      String(c.code || '').toUpperCase() === 'CS-CHINH' ||
      String(c.name || '').trim().toLowerCase() === 'cơ sở chính'
  );
  if (!hasMain) {
    list.unshift({
      code: 'CS-CHINH',
      name: 'Cơ sở chính',
      address: '',
      phone: '',
      managerName: '',
      openTime: defaults.openTime || '07:00',
      closeTime: defaults.closeTime || '17:00',
      maxClassrooms: 20,
      notes: '',
      isActive: true
    });
  }
  return list;
};

/**
 * Lấy thông tin định danh trường (chỉ đọc) + hạn mức + danh sách toàn bộ Phân hiệu / Cơ sở kèm thống kê lớp & học sinh.
 */
const listCampuses = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    const tenantFilter = buildTenantFilter(req);

    const [settings, tenant, classroomGroups] = await Promise.all([
      getSystemSettings(),
      tenantId ? Tenant.findById(tenantId).lean() : Promise.resolve(null),
      Classroom.aggregate([
        { $match: { ...tenantFilter, status: 'active' } },
        {
          $group: {
            _id: {
              $cond: [
                { $or: [{ $eq: ['$campus', null] }, { $eq: ['$campus', ''] }] },
                'Cơ sở chính',
                '$campus'
              ]
            },
            classroomIds: { $push: '$_id' },
            classCount: { $sum: 1 },
            totalCapacity: { $sum: { $ifNull: ['$capacity', 30] } }
          }
        }
      ])
    ]);

    const defaultOpen = settings.preschoolStandards?.standardCheckInTime || '07:00';
    const defaultClose = settings.preschoolStandards?.standardCheckOutTime || '16:30';

    const allClassIds = classroomGroups.flatMap((g) => g.classroomIds);
    const studentCountsByClass = allClassIds.length
      ? await Student.aggregate([
          {
            $match: {
              ...tenantFilter,
              classroomId: { $in: allClassIds },
              status: { $in: ['enrolled', 'temporarily_absent'] }
            }
          },
          { $group: { _id: '$classroomId', count: { $sum: 1 } } }
        ])
      : [];

    const studentMap = new Map(studentCountsByClass.map((s) => [String(s._id), s.count]));
    const statsByCampusName = new Map();
    for (const grp of classroomGroups) {
      const name = String(grp._id || 'Cơ sở chính').trim() || 'Cơ sở chính';
      const key = name.toLowerCase();
      const studentCount = grp.classroomIds.reduce((sum, cid) => sum + (studentMap.get(String(cid)) || 0), 0);
      const prev = statsByCampusName.get(key);
      if (prev) {
        prev.classCount += grp.classCount;
        prev.studentCount += studentCount;
        prev.totalCapacity += grp.totalCapacity || 0;
      } else {
        statsByCampusName.set(key, {
          name,
          classCount: grp.classCount,
          studentCount,
          totalCapacity: grp.totalCapacity || 0
        });
      }
    }

    const declaredCampuses = ensureMainCampusPresent(tenant?.campuses || [], {
      openTime: defaultOpen,
      closeTime: defaultClose
    });
    const usedCodes = new Set(declaredCampuses.map((c) => String(c.code || '').toUpperCase()));

    for (const [lowerName, stat] of statsByCampusName.entries()) {
      const exists = declaredCampuses.some((c) => String(c.name || '').trim().toLowerCase() === lowerName);
      if (!exists) {
        let generatedCode = normalizeCampusCode('', stat.name);
        let suffix = 2;
        while (usedCodes.has(generatedCode)) {
          generatedCode = `${generatedCode.slice(0, 16)}-${suffix}`;
          suffix += 1;
        }
        usedCodes.add(generatedCode);
        declaredCampuses.push({
          code: generatedCode,
          name: stat.name,
          address: '',
          phone: '',
          managerName: '',
          openTime: defaultOpen,
          closeTime: defaultClose,
          maxClassrooms: 20,
          notes: '',
          isActive: true
        });
      }
    }

    const mergedCampuses = declaredCampuses.map((c) => {
      const lowerName = String(c.name || '').trim().toLowerCase();
      const isMain = String(c.code || '').toUpperCase() === 'CS-CHINH';
      const stat = statsByCampusName.get(lowerName) || (isMain ? statsByCampusName.get('cơ sở chính') : null);
      return {
        code: c.code || normalizeCampusCode('', c.name),
        name: c.name,
        address: c.address || '',
        phone: c.phone || '',
        managerName: c.managerName || '',
        openTime: c.openTime || defaultOpen,
        closeTime: c.closeTime || defaultClose,
        maxClassrooms: c.maxClassrooms || 20,
        notes: c.notes || '',
        isActive: c.isActive !== false,
        classCount: stat?.classCount || 0,
        studentCount: stat?.studentCount || 0,
        totalCapacity: stat?.totalCapacity || 0
      };
    });

    const quotas = {
      maxCampuses: tenant?.quotas?.maxCampuses || settings.preschoolStandards?.defaultMaxCampusesPerSchool || 10,
      maxStudents: tenant?.quotas?.maxStudents || settings.preschoolStandards?.defaultMaxStudentsPerSchool || 800,
      maxStaff: tenant?.quotas?.maxStaff || 200
    };
    const enabledModules = tenant?.config?.moduleGateConfigured
      ? sanitizeEnabledModules(tenant.enabledModules)
      : [...ALL_ENABLED_MODULES];

    return res.json({
      success: true,
      data: {
        school: tenant
          ? {
              _id: tenant._id,
              code: tenant.code,
              name: tenant.name,
              organizationCode: tenant.organizationCode || '',
              contactEmail: tenant.contactEmail || '',
              status: tenant.status,
              enabledModules,
              quotas
            }
          : {
              _id: null,
              code: 'DEFAULT',
              name: 'Trường Mầm non Hoa Nắng',
              organizationCode: '',
              contactEmail: '',
              status: 'active',
              enabledModules: [...ALL_ENABLED_MODULES],
              quotas
            },
        systemStandards: settings.preschoolStandards,
        campuses: mergedCampuses
      }
    });
  } catch (err) {
    console.error('Lỗi tải danh sách phân hiệu:', err);
    return res.status(500).json({ success: false, message: 'Không thể tải thông tin trường và phân hiệu' });
  }
};

/**
 * Thêm mới một Phân hiệu / Cơ sở trực thuộc trường (kiểm tra hạn mức `maxCampuses` do SuperAdmin cấp).
 */
const createCampus = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Chức năng phân hiệu yêu cầu ngữ cảnh trường học xác định' });
    }

    const settings = await getSystemSettings();
    const defaultOpen = settings.preschoolStandards?.standardCheckInTime || '07:00';
    const defaultClose = settings.preschoolStandards?.standardCheckOutTime || '16:30';

    const name = String(req.body?.name || '').trim();
    const address = String(req.body?.address || '').trim().slice(0, 300);
    const phone = String(req.body?.phone || '').trim().slice(0, 20);
    const managerName = String(req.body?.managerName || '').trim().slice(0, 120);
    const openTime = req.body?.openTime ? String(req.body.openTime).trim() : defaultOpen;
    const closeTime = req.body?.closeTime ? String(req.body.closeTime).trim() : defaultClose;
    const maxClassrooms = req.body?.maxClassrooms != null ? Number(req.body.maxClassrooms) : 20;
    const notes = String(req.body?.notes || '').trim().slice(0, 500);

    if (!name || name.length > 120) {
      return res.status(422).json({ success: false, message: 'Vui lòng nhập tên phân hiệu / cơ sở (tối đa 120 ký tự)' });
    }
    if (!TIME_HHMM_REGEX.test(openTime) || !TIME_HHMM_REGEX.test(closeTime)) {
      return res.status(422).json({ success: false, message: 'Giờ mở/đóng cửa phân hiệu phải đúng định dạng HH:MM (VD: 07:00)' });
    }
    if (!Number.isInteger(maxClassrooms) || maxClassrooms < 1 || maxClassrooms > 200) {
      return res.status(422).json({ success: false, message: 'Số lớp tối đa dự kiến của phân hiệu phải từ 1 đến 200' });
    }

    let code = normalizeCampusCode(req.body?.code, name);
    if (!CAMPUS_CODE_REGEX.test(code)) {
      return res.status(422).json({ success: false, message: 'Mã phân hiệu chỉ gồm chữ in hoa, số, gạch nối/dưới (2–20 ký tự)' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin trường học' });

    tenant.campuses = ensureMainCampusPresent(tenant.campuses, { openTime: defaultOpen, closeTime: defaultClose });

    const maxAllowedCampuses = tenant.quotas?.maxCampuses || settings.preschoolStandards?.defaultMaxCampusesPerSchool || 10;
    if (tenant.campuses.length >= maxAllowedCampuses) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: `Trường đã đạt giới hạn tối đa ${maxAllowedCampuses} phân hiệu theo cấu hình hệ thống. Vui lòng liên hệ Quản trị Tổng để nâng hạn mức.`
      });
    }

    const nameDup = tenant.campuses.find(
      (c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (nameDup) {
      return res.status(409).json({ success: false, message: `Phân hiệu "${name}" đã tồn tại trong trường` });
    }

    if (!req.body?.code) {
      let suffix = 2;
      while (tenant.campuses.some((c) => String(c.code || '').toUpperCase() === code)) {
        code = `${normalizeCampusCode('', name).slice(0, 16)}-${suffix}`;
        suffix += 1;
      }
    } else if (tenant.campuses.some((c) => String(c.code || '').toUpperCase() === code)) {
      return res.status(409).json({ success: false, message: `Mã phân hiệu "${code}" đã tồn tại trong trường` });
    }

    const createdCampus = {
      code,
      name,
      address,
      phone,
      managerName,
      openTime,
      closeTime,
      maxClassrooms,
      notes,
      isActive: true
    };
    tenant.campuses.push(createdCampus);
    await tenant.save();

    return res.status(201).json({
      success: true,
      message: `Đã thêm phân hiệu "${name}" thành công`,
      data: createdCampus
    });
  } catch (err) {
    console.error('Lỗi thêm phân hiệu:', err);
    return res.status(500).json({ success: false, message: 'Không thể thêm phân hiệu mới' });
  }
};

/**
 * Cập nhật cấu hình vận hành của Phân hiệu (địa chỉ, SĐT, người phụ trách, giờ đón-trả, quy mô lớp, trạng thái).
 */
const updateCampus = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Thiếu ngữ cảnh trường học' });
    }

    const targetCode = String(req.params.campusCode || '').trim().toUpperCase();
    const nextName = String(req.body?.name || '').trim();
    const address = String(req.body?.address ?? '').trim().slice(0, 300);
    const phone = String(req.body?.phone ?? '').trim().slice(0, 20);
    const managerName = String(req.body?.managerName ?? '').trim().slice(0, 120);
    const openTime = req.body?.openTime !== undefined ? String(req.body.openTime).trim() : undefined;
    const closeTime = req.body?.closeTime !== undefined ? String(req.body.closeTime).trim() : undefined;
    const maxClassrooms = req.body?.maxClassrooms !== undefined ? Number(req.body.maxClassrooms) : undefined;
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim().slice(0, 500) : undefined;
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : undefined;

    if (!nextName || nextName.length > 120) {
      return res.status(422).json({ success: false, message: 'Tên phân hiệu không hợp lệ' });
    }
    if (openTime !== undefined && !TIME_HHMM_REGEX.test(openTime)) {
      return res.status(422).json({ success: false, message: 'Giờ mở cửa phân hiệu phải đúng định dạng HH:MM' });
    }
    if (closeTime !== undefined && !TIME_HHMM_REGEX.test(closeTime)) {
      return res.status(422).json({ success: false, message: 'Giờ đóng cửa phân hiệu phải đúng định dạng HH:MM' });
    }
    if (maxClassrooms !== undefined && (!Number.isInteger(maxClassrooms) || maxClassrooms < 1 || maxClassrooms > 200)) {
      return res.status(422).json({ success: false, message: 'Số lớp tối đa của phân hiệu phải từ 1 đến 200' });
    }

    const updatedCampus = await runSafeTransaction(async (session) => {
      const tenant = await Tenant.findById(tenantId).session(session);
      if (!tenant) throw Object.assign(new Error('Không tìm thấy trường học'), { statusCode: 404 });

      tenant.campuses = ensureMainCampusPresent(tenant.campuses);
      let idx = tenant.campuses.findIndex((c) => String(c.code || '').toUpperCase() === targetCode);

      if (idx === -1) {
        const distinctClassCampuses = await Classroom.distinct('campus', { tenantId }).session(session);
        const matchedClassCampus = distinctClassCampuses.find(
          (cName) => cName && normalizeCampusCode('', cName) === targetCode
        );
        if (!matchedClassCampus) {
          throw Object.assign(new Error('Không tìm thấy phân hiệu cần cập nhật'), { statusCode: 404 });
        }
        tenant.campuses.push({
          code: targetCode,
          name: String(matchedClassCampus).trim(),
          address: '',
          phone: '',
          managerName: '',
          openTime: '07:00',
          closeTime: '17:00',
          maxClassrooms: 20,
          notes: '',
          isActive: true
        });
        idx = tenant.campuses.length - 1;
      }

      const nameConflict = tenant.campuses.some(
        (c, i) => i !== idx && String(c.name || '').trim().toLowerCase() === nextName.toLowerCase()
      );
      if (nameConflict) {
        throw Object.assign(new Error(`Tên phân hiệu "${nextName}" đã tồn tại`), { statusCode: 409 });
      }

      const previousName = tenant.campuses[idx].name;
      const isMainCampus = String(tenant.campuses[idx].code || '').toUpperCase() === 'CS-CHINH';
      tenant.campuses[idx].name = nextName;
      tenant.campuses[idx].address = address;
      tenant.campuses[idx].phone = phone;
      tenant.campuses[idx].managerName = managerName;
      if (openTime !== undefined) tenant.campuses[idx].openTime = openTime;
      if (closeTime !== undefined) tenant.campuses[idx].closeTime = closeTime;
      if (maxClassrooms !== undefined) tenant.campuses[idx].maxClassrooms = maxClassrooms;
      if (notes !== undefined) tenant.campuses[idx].notes = notes;
      if (isActive !== undefined) tenant.campuses[idx].isActive = isActive;

      await tenant.save(session ? { session } : undefined);

      if (previousName && previousName.toLowerCase() !== nextName.toLowerCase()) {
        const campusMatchFilter = isMainCampus
          ? {
              tenantId,
              $or: [
                { campus: { $regex: `^${escapeRegex(previousName)}$`, $options: 'i' } },
                { campus: '' },
                { campus: null },
                { campus: { $exists: false } }
              ]
            }
          : {
              tenantId,
              campus: { $regex: `^${escapeRegex(previousName)}$`, $options: 'i' }
            };
        await Classroom.updateMany(
          campusMatchFilter,
          { $set: { campus: nextName } },
          session ? { session } : undefined
        );
      }

      return tenant.campuses[idx];
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật cấu hình phân hiệu thành công',
      data: updatedCampus
    });
  } catch (err) {
    console.error('Lỗi cập nhật phân hiệu:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể cập nhật phân hiệu' });
  }
};

/**
 * Khóa ranh giới quyền hạn: Định danh cấp Trường thuộc độc quyền của SuperAdmin;
 * Admin từng trường chỉ quản lý cấu hình các Phân hiệu trực thuộc trường mình.
 */
const updateCurrentSchoolInfo = async (req, res) => {
  return res.status(403).json({
    success: false,
    code: 'SCHOOL_IDENTITY_LOCKED',
    message: 'Thông tin định danh cấp Trường (Tên trường, Mã trường, Cụm trường, Gói chức năng) do Quản trị Tổng Hệ thống (SuperAdmin) quản lý. Admin trường chỉ quản lý cấu hình các Phân hiệu / Cơ sở trực thuộc.'
  });
};

/**
 * Xóa phân hiệu khi chưa có lớp học đang hoạt động trực thuộc.
 */
const deleteCampus = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Thiếu ngữ cảnh trường học' });

    const targetCode = String(req.params.campusCode || '').trim().toUpperCase();
    if (targetCode === 'CS-CHINH') {
      return res.status(422).json({ success: false, message: 'Không thể xóa Cơ sở chính mặc định của trường' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Không tìm thấy trường học' });

    const target = (tenant.campuses || []).find((c) => String(c.code || '').toUpperCase() === targetCode);
    let targetName = target?.name || '';

    if (!targetName) {
      const distinctClassCampuses = await Classroom.distinct('campus', { tenantId });
      targetName = distinctClassCampuses.find((cName) => cName && normalizeCampusCode('', cName) === targetCode) || '';
    }
    if (!targetName) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phân hiệu cần xóa' });
    }

    const activeClasses = await Classroom.countDocuments({
      tenantId,
      status: 'active',
      campus: { $regex: `^${escapeRegex(targetName)}$`, $options: 'i' }
    });
    if (activeClasses > 0) {
      return res.status(409).json({
        success: false,
        message: `Phân hiệu "${targetName}" đang có ${activeClasses} lớp hoạt động. Vui lòng chuyển các lớp sang cơ sở khác trước khi xóa.`
      });
    }

    if (target) {
      tenant.campuses = (tenant.campuses || []).filter((c) => String(c.code || '').toUpperCase() !== targetCode);
      await tenant.save();
    }

    return res.json({
      success: true,
      message: `Đã xóa phân hiệu "${targetName}"`
    });
  } catch (err) {
    console.error('Lỗi xóa phân hiệu:', err);
    return res.status(500).json({ success: false, message: 'Không thể xóa phân hiệu' });
  }
};

module.exports = {
  listCampuses,
  createCampus,
  updateCampus,
  updateCurrentSchoolInfo,
  deleteCampus
};
