const Classroom = require('../models/zone3_school/Classroom');
const Employee = require('../models/zone2_hr/Employee');
const StaffReplacement = require('../models/zone2_hr/StaffReplacement');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const { getWorkDate } = require('../utils/dateHelpers');
const { leaveOn } = require('./staffingService');
const {
    FAIL_CLOSED_FILTER,
    applyTenantFilter,
    buildTenantFilter,
    resolveTenantContext,
    resolveUserAndTenantContext
} = require('./tenantFilterService');

const SCHOOL_WIDE_READ_ROLES = new Set(['admin', 'principal']);

const hasSchoolWideReadAccess = (user) => SCHOOL_WIDE_READ_ROLES.has(user?.role);

/**
 * Returns classroom IDs accessible to a teacher within their tenant.
 *
 * @param {Object} user Current authenticated user (role = teacher)
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {Promise<string[]>}
 */
const getTeacherClassroomIds = async (user, context) => {
    if (user?.role !== 'teacher') return [];

    // SEC-1B2-01: Verify user and context tenant alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) return [];

    const tenantFilter = buildTenantFilter(context || user, { failClosed: true });

    const classrooms = await Classroom.find(
        { ...tenantFilter, status: 'active', $or: [{ homeroomTeacherId: user._id }, { 'teachers.teacherId': user._id }] },
        { _id: 1 }
    ).lean();

    const assigned = new Set(classrooms.map((classroom) => classroom._id.toString()));
    const employee = await Employee.findOne({ userId: user._id, status: 'active', ...tenantFilter }).select('_id').lean();

    if (employee) {
        const date = getWorkDate();
        const replacements = await StaffReplacement.find({
            kind: 'classroom',
            replacementEmployeeId: employee._id,
            date,
            status: 'active',
            ...tenantFilter
        }).select('classroomId absentEmployeeId').lean();

        const leaves = replacements.length ? await LeaveRequest.find({
            employeeId: { $in: replacements.map((item) => item.absentEmployeeId) },
            status: 'approved',
            ...tenantFilter
        }).select('employeeId startDate endDate workDates status').lean() : [];

        const absentProfiles = replacements.length ? await Employee.find({
            _id: { $in: replacements.map((item) => item.absentEmployeeId) },
            ...tenantFilter
        }).select('_id userId').lean() : [];

        const absentById = new Map(absentProfiles.map((item) => [String(item._id), item]));

        for (const item of replacements) {
            const absentUserId = absentById.get(String(item.absentEmployeeId))?.userId;
            if (absentUserId && leaves.some((leave) => String(leave.employeeId) === String(item.absentEmployeeId) && leaveOn(leave, date))) {
                const replacedClassExists = await Classroom.exists({
                    ...tenantFilter,
                    _id: item.classroomId,
                    status: 'active',
                    $or: [{ homeroomTeacherId: absentUserId }, { 'teachers.teacherId': absentUserId }]
                });
                if (replacedClassExists) {
                    assigned.add(String(item.classroomId));
                }
            }
        }
    }

    return [...assigned];
};

/**
 * Checks whether a user can access a specific classroom.
 *
 * Strict Rules:
 * 1. Checks that classroom belongs to caller's tenant (or legacy) via tenantFilter.
 *    If classroom belongs to a foreign tenant or is not found, returns false (invisible / 404).
 * 2. Admin / Principal role grant school-wide read access ONLY WITHIN their own tenant.
 *    They can NEVER access a classroom in another tenant or legacy.
 * 3. Teachers can only access assigned / replaced classrooms within their own tenant.
 * 4. Other roles without read access return false.
 *
 * @param {Object} user Current authenticated user
 * @param {string|Object} classroomId Classroom ObjectId or string
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {Promise<boolean>}
 */
const canAccessClassroom = async (user, classroomId, context) => {
    if (!user || !classroomId) return false;

    // SEC-1B2-01: Verify user and context tenant alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) return false;

    const tenantFilter = buildTenantFilter(context || user, { failClosed: true });

    // Verify classroom belongs to this tenant
    const classroom = await Classroom.findOne({ _id: classroomId, ...tenantFilter })
        .select('_id status tenantId')
        .lean();

    if (!classroom) {
        // Foreign tenant classroom or non-existent -> strictly invisible
        return false;
    }

    // Role check within the verified tenant
    if (hasSchoolWideReadAccess(user)) return true;
    if (user?.role !== 'teacher') return false;

    const teacherClassroomIds = await getTeacherClassroomIds(user, context || user);
    return teacherClassroomIds.includes(String(classroomId));
};

/**
 * Scopes classroom list filter to caller's tenant and role.
 *
 * @param {Object} user Current authenticated user
 * @param {Object} filter Base filter
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {Promise<Object>} Scoped filter
 */
const applyClassroomListScope = async (user, filter = {}, context) => {
    // SEC-1B2-01: Verify user and context tenant alignment
    const resolved = resolveUserAndTenantContext(user, context);
    if (!resolved.isValid) {
        return { ...FAIL_CLOSED_FILTER };
    }

    let scoped = applyTenantFilter(filter, context || user, { failClosed: true });

    if (user?.role === 'teacher') {
        const allowedIds = await getTeacherClassroomIds(user, context || user);
        scoped._id = { $in: allowedIds };
    } else if (!hasSchoolWideReadAccess(user) && user?.role !== 'hr') {
        scoped._id = { $in: [] }; // fail-closed for unauthorized roles
    }

    return scoped;
};

module.exports = {
    applyClassroomListScope,
    canAccessClassroom,
    getTeacherClassroomIds,
    hasSchoolWideReadAccess
};
