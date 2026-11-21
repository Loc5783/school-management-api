const mongoose = require('mongoose');
const { isValidObjectId } = require('../utils/idValidation');
const {
    FAIL_CLOSED_FILTER,
    applyTenantFilter,
    buildTenantFilter,
    resolveTenantContext,
    resolveUserAndTenantContext
} = require('./tenantFilterService');

const SCHOOL_WIDE_READ_ROLES = new Set(['admin', 'principal']);
const hasSchoolWideReadAccess = (user) => SCHOOL_WIDE_READ_ROLES.has(user?.role);

const isParent = (user) => user?.role === 'parent';

const isValidStudentId = (studentId) => isValidObjectId(studentId);

const getLinkedStudentIds = (user) => {
    const uniqueIds = new Set();

    for (const studentId of user?.parentInfo?.studentIds || []) {
        if (isValidStudentId(studentId)) {
            uniqueIds.add(studentId.toString());
        }
    }

    return [...uniqueIds];
};

/**
 * Checks whether a user can access a student.
 *
 * Rules:
 * - SEC-1B2-01: Verifies that caller user and context are aligned to the exact same tenant.
 * - If studentOrId is a document/object with tenantId/student properties:
 *   Verifies that document tenant matches caller's trusted tenant context.
 *   If it belongs to another tenant or legacy/SaaS mismatch -> strictly returns false.
 *   - For parent: verifies that student ID is linked to parent.
 *   - For admin/principal: returns true within their verified tenant.
 *   - For non-parent non-admin: returns false (must use async check to verify classroom).
 * - SEC-1B2-02: If studentOrId is a raw ID (string or ObjectId):
 *   - For parent: verifies studentId is in parent's linked student IDs list.
 *   - For non-parent: CANNOT prove tenant or classroom synchronously with only raw ID.
 *     Strictly returns false to prevent fail-open assumption. Caller must use
 *     canAccessStudentAsync or pass verified document.
 *
 * @param {Object} user Current authenticated user
 * @param {string|Object} studentOrId Student ObjectId string or Student document
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {boolean}
 */
const canAccessStudent = (user, studentOrId, context) => {
    if (!user || !studentOrId) return false;

    // SEC-1B2-01: Verify user and context tenant alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) {
        return false;
    }

    // Distinguish document/object from raw ID/ObjectId
    const isDoc = typeof studentOrId === 'object' &&
        !(studentOrId instanceof mongoose.Types.ObjectId) &&
        studentOrId._bsontype !== 'ObjectID' &&
        (studentOrId.tenantId !== undefined || studentOrId.classroomId !== undefined || studentOrId.studentCode !== undefined);

    if (isDoc) {
        // Enforce tenant boundary on the document
        if (resolved.isSaaS) {
            if (!studentOrId.tenantId || String(studentOrId.tenantId) !== String(resolved.tenantId)) {
                return false;
            }
        } else if (resolved.isLegacy) {
            if (studentOrId.tenantId != null) {
                return false;
            }
        }

        const studentId = studentOrId._id ? String(studentOrId._id) : null;
        if (isParent(user)) {
            if (!studentId) return false;
            return getLinkedStudentIds(user).includes(studentId);
        }

        if (hasSchoolWideReadAccess(user)) {
            return true;
        }

        // For non-parent roles without school-wide access (e.g. teacher),
        // synchronous document check cannot verify classroom assignment without DB lookup.
        return false;
    }

    // Raw ID / ObjectId path
    const idStr = String(studentOrId);
    if (!isValidStudentId(idStr)) return false;

    // Parent linked ID check
    if (isParent(user)) {
        return getLinkedStudentIds(user).includes(idStr);
    }

    // SEC-1B2-02: canAccessStudent đồng bộ với raw ID/ObjectId không thể chứng minh quyền tenant cho non-parent.
    // Không được trả true như quyền cuối; caller thật cần dùng canAccessStudentAsync hoặc truyền document có tenantId.
    return false;
};

/**
 * Asynchronously verifies student access including full database lookup with tenant boundary check.
 *
 * @param {Object} user Current authenticated user
 * @param {string|Object} studentId Student ID
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {Promise<boolean>}
 */
const canAccessStudentAsync = async (user, studentId, context) => {
    if (!user || !studentId) return false;
    const idStr = String(studentId);
    if (!isValidStudentId(idStr)) return false;

    // SEC-1B2-01: Verify user and context tenant alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) return false;

    // Parent fast path: if user is parent, ID must be linked
    if (isParent(user) && !getLinkedStudentIds(user).includes(idStr)) {
        return false;
    }

    // Lazy load models and services to prevent circular dependency
    const Student = require('../models/zone3_school/Student');
    const tenantFilter = buildTenantFilter(context || user, { failClosed: true });

    const student = await Student.findOne({ _id: idStr, ...tenantFilter })
        .select('_id tenantId classroomId')
        .lean();

    if (!student) {
        // ID of another tenant or not found -> invisible (404/false)
        return false;
    }

    if (isParent(user)) {
        return true;
    }

    if (user.role === 'teacher') {
        const { canAccessClassroom } = require('./schoolDataAccessService');
        return await canAccessClassroom(user, student.classroomId, context || user);
    }

    if (hasSchoolWideReadAccess(user)) {
        return true;
    }

    return false;
};

/**
 * Scopes student list filter to the caller's tenant and role.
 *
 * Guarantees:
 * 1. Filter contains trusted tenantId (SaaS) or tenantId: null (legacy).
 * 2. Any client-provided tenantId in `filter` is stripped and cannot override the tenant boundary.
 * 3. Parent role is constrained to linked student IDs.
 * 4. Admin, teacher, parent roles cannot override or escape the tenant scope.
 * 5. Invalid context or cross-tenant mismatch produces a fail-closed filter matching zero documents.
 *
 * @param {Object} user Current user
 * @param {Object} filter Base MongoDB filter
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {Object} Scoped MongoDB filter
 */
const applyStudentListScope = (user, filter = {}, context) => {
    // SEC-1B2-01: Verify user and context alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) {
        return { ...FAIL_CLOSED_FILTER };
    }

    // 1. Enforce tenant boundary unconditionally (fail-closed if context/user invalid)
    let scoped = applyTenantFilter(filter, context || user, { failClosed: true });

    // 2. Enforce parent scope if role is parent
    if (isParent(user)) {
        const linkedIds = getLinkedStudentIds(user);
        if (scoped._id) {
            if (scoped._id.$in && Array.isArray(scoped._id.$in)) {
                const linkedSet = new Set(linkedIds.map(String));
                const intersected = scoped._id.$in.filter((id) => linkedSet.has(String(id)));
                scoped._id = { $in: intersected };
            } else {
                const singleId = String(scoped._id);
                scoped._id = linkedIds.includes(singleId) ? singleId : { $in: [] };
            }
        } else {
            scoped._id = { $in: linkedIds };
        }
    }

    return scoped;
};

module.exports = {
    applyStudentListScope,
    canAccessStudent,
    canAccessStudentAsync,
    getLinkedStudentIds,
    hasSchoolWideReadAccess,
    isParent,
    isValidStudentId
};
