'use strict';

/**
 * @fileoverview Bộ điều khiển quản lý Thông tin Trường học & Danh sách Phân hiệu / Cơ sở (Campuses)
 * trong phạm vi một trường (`tenantId`).
 *
 * Quy tắc nghiệp vụ:
 * - Cách ly nghiêm ngặt theo `tenantId` từ ngữ cảnh xác thực (`req.tenant` / `req.user.tenantId`).
 * - Đồng bộ tự động các tên phân hiệu đang được sử dụng trên bảng `Classroom` với danh mục `Tenant.campuses`
 *   để nhà trường luôn nhìn thấy đầy đủ Cơ sở chính & các Phân hiệu kèm sĩ số thực tế (không N+1 query).
 */

const mongoose = require('mongoose');
const Tenant = require('../models/zone1_system/Tenant');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const { buildTenantFilter } = require('../services/tenantFilterService');

const CAMPUS_CODE_REGEX = /^[A-Z0-9_-]{2,20}$/;

const normalizeCampusCode = (rawCode, fallbackName = '') => {
  if (rawCode && String(rawCode).trim()) {
    return String(rawCode).trim().toUpperCase().replace(/\s+/g, '-');
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
  return slug || 'CS-CHINH';
};

/**
 * Lấy thông tin trường hiện tại và danh sách toàn bộ Phân hiệu / Cơ sở kèm thống kê số lớp & học sinh.
 */
const listCampuses = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    const tenantFilter = buildTenantFilter(req);

    const [tenant, classroomGroups] = await Promise.all([
      tenantId ? Tenant.findById(tenantId).lean() : Promise.resolve(null),
      Classroom.aggregate([
        { $match: { status: 'active', ...tenantFilter } },
        {
          $group: {
            _id: { $ifNull: ['$campus', 'Cơ sở chính'] },
            classroomIds: { $push: '$_id' },
            classCount: { $sum: 1 }
          }
        }
      ])
    ]);

    // Gom toàn bộ classroomId để đếm học sinh đang theo học theo từng phân hiệu trong 1 truy vấn
    const allClassIds = classroomGroups.flatMap((g) => g.classroomIds);
    const studentCountsByClass = allClassIds.length
      ? await Student.aggregate([
          {
            $match: {
              classroomId: { $in: allClassIds },
              status: { $in: ['enrolled', 'temporarily_absent'] },
              ...tenantFilter
            }
          },
          { $group: { _id: '$classroomId', count: { $sum: 1 } } }
        ])
      : [];

    const studentMap = new Map(studentCountsByClass.map((s) => [String(s._id), s.count]));
    const statsByCampusName = new Map();
    for (const grp of classroomGroups) {
      const name = String(grp._id || 'Cơ sở chính').trim() || 'Cơ sở chính';
      const studentCount = grp.classroomIds.reduce((sum, cid) => sum + (studentMap.get(String(cid)) || 0), 0);
      statsByCampusName.set(name.toLowerCase(), {
        name,
        classCount: grp.classCount,
        studentCount
      });
    }

    const declaredCampuses = Array.isArray(tenant?.campuses) ? [...tenant.campuses] : [];
    if (!declaredCampuses.some((c) => String(c.name || '').trim().toLowerCase() === 'cơ sở chính')) {
      declaredCampuses.unshift({
        code: 'CS-CHINH',
        name: 'Cơ sở chính',
        address: '',
        phone: '',
        managerName: '',
        isActive: true
      });
    }

    // Bổ sung các phân hiệu đã phát sinh trên Lớp học nhưng chưa lưu trong danh mục Tenant.campuses
    for (const [lowerName, stat] of statsByCampusName.entries()) {
      const exists = declaredCampuses.some((c) => String(c.name || '').trim().toLowerCase() === lowerName);
      if (!exists) {
        declaredCampuses.push({
          code: normalizeCampusCode('', stat.name),
          name: stat.name,
          address: '',
          phone: '',
          managerName: '',
          isActive: true
        });
      }
    }

    const mergedCampuses = declaredCampuses.map((c) => {
      const stat = statsByCampusName.get(String(c.name || '').trim().toLowerCase());
      return {
        code: c.code || normalizeCampusCode('', c.name),
        name: c.name,
        address: c.address || '',
        phone: c.phone || '',
        managerName: c.managerName || '',
        isActive: c.isActive !== false,
        classCount: stat?.classCount || 0,
        studentCount: stat?.studentCount || 0
      };
    });

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
              status: tenant.status
            }
          : {
              _id: null,
              code: 'DEFAULT',
              name: 'Trường Mầm non Hoa Nắng',
              organizationCode: '',
              contactEmail: '',
              status: 'active'
            },
        campuses: mergedCampuses
      }
    });
  } catch (err) {
    console.error('Lỗi tải danh sách phân hiệu:', err);
    return res.status(500).json({ success: false, message: 'Không thể tải thông tin trường và phân hiệu' });
  }
};

/**
 * Thêm mới một Phân hiệu / Cơ sở trực thuộc trường.
 */
const createCampus = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Chức năng phân hiệu yêu cầu ngữ cảnh trường học xác định' });
    }

    const name = String(req.body?.name || '').trim();
    const code = normalizeCampusCode(req.body?.code, name);
    const address = String(req.body?.address || '').trim().slice(0, 300);
    const phone = String(req.body?.phone || '').trim().slice(0, 20);
    const managerName = String(req.body?.managerName || '').trim().slice(0, 120);

    if (!name || name.length > 120) {
      return res.status(422).json({ success: false, message: 'Vui lòng nhập tên phân hiệu / cơ sở (tối đa 120 ký tự)' });
    }
    if (!CAMPUS_CODE_REGEX.test(code)) {
      return res.status(422).json({ success: false, message: 'Mã phân hiệu chỉ gồm chữ in hoa, số, gạch nối/dưới (2–20 ký tự)' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin trường học' });

    tenant.campuses = Array.isArray(tenant.campuses) ? tenant.campuses : [];
    if (!tenant.campuses.some((c) => String(c.name || '').trim().toLowerCase() === 'cơ sở chính')) {
      tenant.campuses.unshift({
        code: 'CS-CHINH',
        name: 'Cơ sở chính',
        address: '',
        phone: '',
        managerName: '',
        isActive: true
      });
    }

    const duplicate = tenant.campuses.find(
      (c) =>
        String(c.code || '').toUpperCase() === code ||
        String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return res.status(409).json({ success: false, message: `Phân hiệu "${name}" hoặc mã "${code}" đã tồn tại trong trường` });
    }

    const createdCampus = { code, name, address, phone, managerName, isActive: true };
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
 * Cập nhật thông tin Phân hiệu (và đồng bộ tên phân hiệu trên các Lớp học thuộc phân hiệu đó trong Transaction).
 */
const updateCampus = async (req, res) => {
  const session = await mongoose.startSession();
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
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : undefined;

    if (!nextName || nextName.length > 120) {
      return res.status(422).json({ success: false, message: 'Tên phân hiệu không hợp lệ' });
    }

    let updatedCampus = null;
    await session.withTransaction(async () => {
      const tenant = await Tenant.findById(tenantId).session(session);
      if (!tenant) throw Object.assign(new Error('Không tìm thấy trường học'), { statusCode: 404 });

      tenant.campuses = Array.isArray(tenant.campuses) ? tenant.campuses : [];
      if (!tenant.campuses.some((c) => String(c.name || '').trim().toLowerCase() === 'cơ sở chính')) {
        tenant.campuses.unshift({
          code: 'CS-CHINH',
          name: 'Cơ sở chính',
          address: '',
          phone: '',
          managerName: '',
          isActive: true
        });
      }

      const idx = tenant.campuses.findIndex((c) => String(c.code || '').toUpperCase() === targetCode);
      if (idx === -1) {
        throw Object.assign(new Error('Không tìm thấy phân hiệu cần cập nhật'), { statusCode: 404 });
      }

      const nameConflict = tenant.campuses.some(
        (c, i) => i !== idx && String(c.name || '').trim().toLowerCase() === nextName.toLowerCase()
      );
      if (nameConflict) {
        throw Object.assign(new Error(`Tên phân hiệu "${nextName}" đã tồn tại`), { statusCode: 409 });
      }

      const previousName = tenant.campuses[idx].name;
      tenant.campuses[idx].name = nextName;
      tenant.campuses[idx].address = address;
      tenant.campuses[idx].phone = phone;
      tenant.campuses[idx].managerName = managerName;
      if (isActive !== undefined) tenant.campuses[idx].isActive = isActive;

      await tenant.save({ session });

      if (previousName && previousName !== nextName) {
        await Classroom.updateMany(
          { tenantId, campus: previousName },
          { $set: { campus: nextName } },
          { session }
        );
      }

      updatedCampus = tenant.campuses[idx];
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật thông tin phân hiệu',
      data: updatedCampus
    });
  } catch (err) {
    console.error('Lỗi cập nhật phân hiệu:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Không thể cập nhật phân hiệu' });
  } finally {
    await session.endSession();
  }
};

/**
 * Cập nhật thông tin chung của Trường hiện tại (Tên hiển thị, Email liên hệ, Mã cụm/chuỗi trường).
 */
const updateCurrentSchoolInfo = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ success: false, message: 'Thiếu ngữ cảnh trường học' });

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, message: 'Không tìm thấy trường học' });

    if (req.body?.name != null) {
      const cleanName = String(req.body.name).trim();
      if (cleanName.length < 2 || cleanName.length > 160) {
        return res.status(422).json({ success: false, message: 'Tên trường phải từ 2 đến 160 ký tự' });
      }
      tenant.name = cleanName;
    }
    if (req.body?.contactEmail != null) {
      tenant.contactEmail = String(req.body.contactEmail).trim().toLowerCase();
    }
    if (req.body?.organizationCode != null) {
      tenant.organizationCode = String(req.body.organizationCode).trim().toUpperCase().slice(0, 40);
    }

    await tenant.save();
    return res.json({
      success: true,
      message: 'Đã cập nhật thông tin trường học',
      data: {
        _id: tenant._id,
        code: tenant.code,
        name: tenant.name,
        organizationCode: tenant.organizationCode || '',
        contactEmail: tenant.contactEmail || '',
        status: tenant.status
      }
    });
  } catch (err) {
    console.error('Lỗi cập nhật thông tin trường:', err);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật thông tin trường học' });
  }
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
    if (!target) return res.status(404).json({ success: false, message: 'Không tìm thấy phân hiệu cần xóa' });

    const activeClasses = await Classroom.countDocuments({ tenantId, status: 'active', campus: target.name });
    if (activeClasses > 0) {
      return res.status(409).json({
        success: false,
        message: `Phân hiệu "${target.name}" đang có ${activeClasses} lớp hoạt động. Vui lòng chuyển các lớp sang cơ sở khác trước khi xóa.`
      });
    }

    tenant.campuses = (tenant.campuses || []).filter((c) => String(c.code || '').toUpperCase() !== targetCode);
    await tenant.save();

    return res.json({
      success: true,
      message: `Đã xóa phân hiệu "${target.name}"`
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

