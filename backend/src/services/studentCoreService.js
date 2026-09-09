const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');
const mongoose = require('mongoose');

const STUDENT_STATUSES = Object.freeze([
    'pending_admission', 'enrolled', 'temporarily_absent', 'withdrawn', 'transferred', 'graduated'
]);
const ACTIVE_CLASSROOM_STATUSES = new Set(['enrolled', 'temporarily_absent']);
const STATUS_TRANSITIONS = {
    pending_admission: new Set(['enrolled', 'withdrawn']),
    enrolled: new Set(['temporarily_absent', 'withdrawn', 'transferred', 'graduated']),
    temporarily_absent: new Set(['enrolled', 'withdrawn', 'transferred']),
    withdrawn: new Set(),
    transferred: new Set(),
    graduated: new Set()
};

const isClassroomCountedStatus = (status) => ACTIVE_CLASSROOM_STATUSES.has(status);
const canTransitionStudentStatus = (fromStatus, toStatus) => fromStatus === toStatus || STATUS_TRANSITIONS[fromStatus]?.has(toStatus);

const generateStudentCode = async (date = new Date(), session = null) => {
    const year = date.getFullYear();
    const counter = await StudentCodeCounter.findOneAndUpdate(
        { year },
        { $inc: { sequence: 1 }, $setOnInsert: { year } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session }
    );
    return `HS-${year}-${String(counter.sequence).padStart(6, '0')}`;
};

const runStudentTransaction = async (operation) => {
    const topology = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!topology.setName && topology.msg !== 'isdbgrid') {
        const error = new Error('MongoDB phải chạy Replica Set hoặc sharded cluster để cập nhật học sinh an toàn');
        error.statusCode = 503;
        throw error;
    }
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await operation(session); });
        return result;
    } finally { await session.endSession(); }
};

const serializeStudent = (student, role, mode = 'detail') => {
    const raw = typeof student.toObject === 'function' ? student.toObject() : student;
    const base = {
        _id: raw._id,
        studentCode: raw.studentCode || '',
        fullName: raw.fullName,
        birthDate: raw.birthDate,
        gender: raw.gender,
        classroomId: raw.classroomId,
        className: raw.className,
        currentClassroomId: raw.classroomId,
        currentClassName: raw.className,
        admissionDate: raw.admissionDate || raw.enrollmentDate,
        exitDate: raw.exitDate || null,
        status: raw.status,
        avatar: raw.avatar || '',
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt
    };
    if (mode === 'list') return base;
    if (role === 'parent') {
        return { ...base, address: raw.address || '', nationality: raw.nationality || '', birthPlace: raw.birthPlace || '', notes: raw.notes || '' };
    }
    if (role === 'teacher') {
        return { ...base, allergies: raw.allergies || [], disease: raw.disease || {}, emergencyContact: raw.emergencyContact || {}, notes: raw.notes || '' };
    }
    return {
        ...base,
        address: raw.address || '', nationality: raw.nationality || '', ethnicity: raw.ethnicity || '', birthPlace: raw.birthPlace || '',
        notes: raw.notes || '', parents: raw.parents || [], authorizedPickers: raw.authorizedPickers || [], allergies: raw.allergies || [],
        disease: raw.disease || {}, emergencyContact: raw.emergencyContact || {}, attendanceCardId: raw.attendanceCardId || '',
        faceProfileId: raw.faceProfileId || '', schoolYear: raw.schoolYear, statusHistory: raw.statusHistory || [],
        createdBy: raw.createdBy || null, updatedBy: raw.updatedBy || null
    };
};

module.exports = { STUDENT_STATUSES, isClassroomCountedStatus, canTransitionStudentStatus, generateStudentCode, runStudentTransaction, serializeStudent };
