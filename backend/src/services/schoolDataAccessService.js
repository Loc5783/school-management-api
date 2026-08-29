const Classroom = require('../models/zone3_school/Classroom');

const SCHOOL_WIDE_READ_ROLES = new Set(['admin', 'principal']);

const hasSchoolWideReadAccess = (user) => SCHOOL_WIDE_READ_ROLES.has(user?.role);

const getTeacherClassroomIds = async (user) => {
    if (user?.role !== 'teacher') return [];

    const classrooms = await Classroom.find(
        { 'teachers.teacherId': user._id, status: 'active' },
        { _id: 1 }
    ).lean();

    return classrooms.map((classroom) => classroom._id.toString());
};

const canAccessClassroom = async (user, classroomId) => {
    if (hasSchoolWideReadAccess(user)) return true;
    if (user?.role !== 'teacher') return false;

    const classroom = await Classroom.exists({
        _id: classroomId,
        status: 'active',
        'teachers.teacherId': user._id
    });

    return Boolean(classroom);
};

module.exports = {
    canAccessClassroom,
    getTeacherClassroomIds,
    hasSchoolWideReadAccess
};
