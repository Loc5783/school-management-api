const Classroom = require('../models/zone3_school/Classroom');
const Employee = require('../models/zone2_hr/Employee');
const StaffReplacement = require('../models/zone2_hr/StaffReplacement');
const LeaveRequest = require('../models/zone2_hr/LeaveRequest');
const { getWorkDate } = require('../utils/dateHelpers');
const { leaveOn } = require('./staffingService');

const SCHOOL_WIDE_READ_ROLES = new Set(['admin', 'principal']);

const hasSchoolWideReadAccess = (user) => SCHOOL_WIDE_READ_ROLES.has(user?.role);

const getTeacherClassroomIds = async (user) => {
    if (user?.role !== 'teacher') return [];

    const classrooms = await Classroom.find(
        { status: 'active', $or: [{ homeroomTeacherId: user._id }, { 'teachers.teacherId': user._id }] },
        { _id: 1 }
    ).lean();
    const assigned = new Set(classrooms.map((classroom) => classroom._id.toString()));
    const employee = await Employee.findOne({ userId: user._id, status: 'active' }).select('_id').lean();
    if (employee) {
        const date = getWorkDate();
        const replacements = await StaffReplacement.find({ kind: 'classroom', replacementEmployeeId: employee._id, date, status: 'active' }).select('classroomId absentEmployeeId').lean();
        const leaves = replacements.length ? await LeaveRequest.find({ employeeId: { $in: replacements.map((item) => item.absentEmployeeId) }, status: 'approved' }).select('employeeId startDate endDate workDates status').lean() : [];
        const absentProfiles = replacements.length ? await Employee.find({ _id: { $in: replacements.map((item) => item.absentEmployeeId) } }).select('_id userId').lean() : [];
        const absentById = new Map(absentProfiles.map((item) => [String(item._id), item]));
        for (const item of replacements) {
            const absentUserId = absentById.get(String(item.absentEmployeeId))?.userId;
            if (absentUserId && leaves.some((leave) => String(leave.employeeId) === String(item.absentEmployeeId) && leaveOn(leave, date)) &&
                await Classroom.exists({ _id: item.classroomId, status: 'active', $or: [{ homeroomTeacherId: absentUserId }, { 'teachers.teacherId': absentUserId }] })) assigned.add(String(item.classroomId));
        }
    }
    return [...assigned];
};

const canAccessClassroom = async (user, classroomId) => {
    if (hasSchoolWideReadAccess(user)) return true;
    if (user?.role !== 'teacher') return false;

    return (await getTeacherClassroomIds(user)).includes(String(classroomId));
};

module.exports = {
    canAccessClassroom,
    getTeacherClassroomIds,
    hasSchoolWideReadAccess
};
