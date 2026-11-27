const mongoose = require('mongoose');
const Tenant = require('../../models/zone1_system/Tenant');
const PlatformAuditLog = require('../../models/zone1_system/PlatformAuditLog');

const TENANT_CODE_REGEX = /^[A-Z0-9_-]{3,20}$/;

const listTenants = async (req, res) => {
  try {
    const isSupport = req.platformAdmin?.role === 'platform_support';

    let query = Tenant.find().sort({ createdAt: -1 });

    // Role-based projection: platform_support cannot view sensitive configs
    if (isSupport) {
      query = query.select('_id code name status contactEmail enabledModules createdAt updatedAt');
    }

    const tenants = await query.exec();
    return res.status(200).json({
      success: true,
      data: tenants
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Lỗi tải danh sách trường học'
    });
  }
};

const { runSafeTransaction } = require('../../utils/safeTransaction');

const createTenant = async (req, res) => {
  let cleanCode = '';
  try {
    const { code, name, contactEmail, enabledModules, config } = req.body || {};

    if (!code || typeof code !== 'string' || !name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Mã trường và tên trường là bắt buộc'
      });
    }

    cleanCode = code.trim().toUpperCase();
    if (!TENANT_CODE_REGEX.test(cleanCode)) {
      return res.status(400).json({
        success: false,
        message: 'Mã trường chỉ được chứa chữ in hoa, số, dấu gạch nối và gạch dưới (3-20 ký tự)'
      });
    }

    const cleanName = name.trim();
    if (cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Tên trường phải có ít nhất 2 ký tự'
      });
    }

    const tenant = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const existing = await Tenant.findOne({ code: cleanCode }).session(session);
      if (existing) {
        const err = new Error('Mã trường đã tồn tại trên nền tảng');
        err.statusCode = 409;
        err.codeName = 'TENANT_CODE_EXISTS';
        throw err;
      }

      const [created] = await Tenant.create(
        [
          {
            code: cleanCode,
            name: cleanName,
            contactEmail: contactEmail ? String(contactEmail).trim().toLowerCase() : '',
            enabledModules: Array.isArray(enabledModules) ? enabledModules : ['students', 'classrooms'],
            status: 'active',
            authVersion: 0,
            config: config || {}
          }
        ],
        sessionOpt
      );

      await PlatformAuditLog.create(
        [
          {
            actorId: req.platformAdmin._id,
            actorUsername: req.platformAdmin.username,
            action: 'CREATE_TENANT',
            targetType: 'tenant',
            targetId: created._id.toString(),
            details: {
              code: created.code,
              name: created.name,
              contactEmail: created.contactEmail
            }
          }
        ],
        sessionOpt
      );

      return created;
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo trường học thành công',
      data: tenant
    });
  } catch (err) {
    const codeExists = err?.codeName === 'TENANT_CODE_EXISTS' || err?.code === 11000 || (cleanCode && await Tenant.exists({ code: cleanCode }));
    if (codeExists) {
      return res.status(409).json({
        success: false,
        code: 'TENANT_CODE_EXISTS',
        message: 'Mã trường đã tồn tại trên nền tảng'
      });
    }
    return res.status(err?.statusCode || 500).json({
      success: false,
      message: err?.statusCode ? err.message : 'Lỗi tạo trường học'
    });
  }
};

const updateTenantStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TENANT_ID',
        message: 'ID trường học không hợp lệ'
      });
    }

    const allowedStatuses = ['active', 'suspended', 'terminated'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ'
      });
    }

    const extraKeys = Object.keys(req.body || {}).filter((k) => k !== 'status');
    if (extraKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Không được phép chỉnh sửa các trường ngoài status: ${extraKeys.join(', ')}`
      });
    }

    const result = await runSafeTransaction(async (session) => {
      const sessionOpt = session ? { session } : undefined;
      const tenant = await Tenant.findById(id).session(session);
      if (!tenant) {
        const notFound = new Error('Không tìm thấy trường học');
        notFound.statusCode = 404;
        throw notFound;
      }

      const previousStatus = tenant.status;
      if (status === previousStatus) {
        return { changed: false, tenant };
      }

      tenant.status = status;
      tenant.authVersion = (tenant.authVersion || 0) + 1;
      await tenant.save(sessionOpt);

      await PlatformAuditLog.create(
        [
          {
            actorId: req.platformAdmin._id,
            actorUsername: req.platformAdmin.username,
            action: 'UPDATE_TENANT_STATUS',
            targetType: 'tenant',
            targetId: tenant._id.toString(),
            details: {
              previousStatus,
              newStatus: status,
              authVersion: tenant.authVersion
            }
          }
        ],
        sessionOpt
      );

      return { changed: true, tenant };
    });

    return res.status(200).json({
      success: true,
      changed: result.changed,
      message: result.changed ? 'Cập nhật trạng thái trường học thành công' : 'Trạng thái không đổi',
      data: result.tenant
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({
      success: false,
      message: err?.statusCode ? err.message : 'Lỗi cập nhật trạng thái trường học'
    });
  }
};

module.exports = {
  listTenants,
  createTenant,
  updateTenantStatus
};
