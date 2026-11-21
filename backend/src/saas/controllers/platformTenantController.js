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

const createTenant = async (req, res) => {
  const session = await Tenant.db.startSession();
  session.startTransaction();

  let cleanCode = '';
  try {
    const { code, name, contactEmail, enabledModules, config } = req.body || {};

    if (!code || typeof code !== 'string' || !name || typeof name !== 'string') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Mã trường và tên trường là bắt buộc'
      });
    }

    cleanCode = code.trim().toUpperCase();
    if (!TENANT_CODE_REGEX.test(cleanCode)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Mã trường chỉ được chứa chữ in hoa, số, dấu gạch nối và gạch dưới (3-20 ký tự)'
      });
    }

    const cleanName = name.trim();
    if (cleanName.length < 2) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Tên trường phải có ít nhất 2 ký tự'
      });
    }

    const existing = await Tenant.findOne({ code: cleanCode }).session(session);
    if (existing) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        code: 'TENANT_CODE_EXISTS',
        message: 'Mã trường đã tồn tại trên nền tảng'
      });
    }

    const [tenant] = await Tenant.create(
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
      { session }
    );

    // Record platform audit trail in the same transaction (Lỗi 4)
    await PlatformAuditLog.create(
      [
        {
          actorId: req.platformAdmin._id,
          actorUsername: req.platformAdmin.username,
          action: 'CREATE_TENANT',
          targetType: 'tenant',
          targetId: tenant._id.toString(),
          details: {
            code: tenant.code,
            name: tenant.name,
            contactEmail: tenant.contactEmail
          }
        }
      ],
      { session }
    );

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: 'Tạo trường học thành công',
      data: tenant
    });
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    const codeExists = err?.code === 11000 || (cleanCode && await Tenant.exists({ code: cleanCode }));
    if (codeExists) {
      return res.status(409).json({
        success: false,
        code: 'TENANT_CODE_EXISTS',
        message: 'Mã trường đã tồn tại trên nền tảng'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Lỗi tạo trường học'
    });
  } finally {
    session.endSession();
  }
};

const updateTenantStatus = async (req, res) => {
  const session = await Tenant.db.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        code: 'INVALID_TENANT_ID',
        message: 'ID trường học không hợp lệ'
      });
    }

    const allowedStatuses = ['active', 'suspended', 'terminated'];
    if (!status || !allowedStatuses.includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Trạng thái không hợp lệ'
      });
    }

    // Only allow updating status, disallow tampering with other fields (Lỗi 4, req 11)
    const extraKeys = Object.keys(req.body || {}).filter((k) => k !== 'status');
    if (extraKeys.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Không được phép chỉnh sửa các trường ngoài status: ${extraKeys.join(', ')}`
      });
    }

    const tenant = await Tenant.findById(id).session(session);
    if (!tenant) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy trường học'
      });
    }

    const previousStatus = tenant.status;

    // No-op status contract (Lỗi 4, req 9): no change -> no version increment, no duplicate audit
    if (status === previousStatus) {
      await session.commitTransaction();
      return res.status(200).json({
        success: true,
        changed: false,
        message: 'Trạng thái không đổi',
        data: tenant
      });
    }

    tenant.status = status;
    // Atomic version increment
    tenant.authVersion = (tenant.authVersion || 0) + 1;
    await tenant.save({ session });

    // Audit log in same transaction (Lỗi 4)
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
      { session }
    );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      changed: true,
      message: 'Cập nhật trạng thái trường học thành công',
      data: tenant
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({
      success: false,
      message: 'Lỗi cập nhật trạng thái trường học'
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  listTenants,
  createTenant,
  updateTenantStatus
};
