const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');
const mongoose = require('mongoose');
const { generateNextPersonCode } = require('./personCodeService');
const { runSafeTransaction } = require('../utils/safeTransaction');

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

/**
 * Sinh mã học sinh theo dãy số nguyên tăng dần dùng chung toàn trường (1, 2, 3...)
 * để đồng bộ trực tiếp với ID trên máy chấm công Hikvision và không đụng mã nhân sự.
 */
const generateStudentCode = async (date = new Date(), session = null, tenantId = null) => {
    const normalizedDate = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(normalizedDate.getTime())) {
        const error = new Error('Ngày nhập học không hợp lệ để tạo mã học sinh');
        error.statusCode = 422;
        throw error;
    }
    return generateNextPersonCode({ tenantId, session });
};

const runStudentTransaction = async (operation) =>
    runSafeTransaction(operation, 'MongoDB phải chạy Replica Set hoặc sharded cluster để cập nhật học sinh an toàn');

const serializeStudent = (student, role, mode = 'detail') => {
    const raw = typeof student.toObject === 'function' ? student.toObject() : student;
    const base = {
        _id: raw._id,
        studentCode: raw.studentCode || '',
        identityCode: raw.identityCode || '',
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
    if (role === 'hr') {
        return {
            ...base,
            schoolYear: raw.schoolYear || '',
            statusHistory: (raw.statusHistory || []).map((h) => ({
                toStatus: h.toStatus,
                effectiveDate: h.effectiveDate,
                reason: h.reason
            }))
        };
    }
    if (role === 'parent') {
        return {
            ...base,
            address: raw.address || '',
            nationality: raw.nationality || '',
            ethnicity: raw.ethnicity || '',
            birthPlace: raw.birthPlace || '',
            schoolYear: raw.schoolYear || '',
            healthInsuranceCode: raw.healthInsuranceCode || '',
            bloodType: raw.bloodType || '',
            vaccinations: raw.vaccinations || [],
            growthRecords: raw.growthRecords || [],
            allergies: raw.allergies || [],
            disease: raw.disease || {},
            emergencyContact: raw.emergencyContact || {},
            authorizedPickers: (raw.authorizedPickers || []).map((item) => ({
                _id: item._id,
                fullName: item.fullName || '', phone: item.phone || '', relationship: item.relationship || '',
                photoURL: item.photoURL || '', vehicleType: item.vehicleType || '', vehiclePlate: item.vehiclePlate || '', isActive: item.isActive !== false
            })),
            notes: raw.notes || ''
        };
    }
    if (role === 'teacher') {
        return {
            ...base,
            parents: raw.parents || [],
            healthInsuranceCode: raw.healthInsuranceCode || '',
            bloodType: raw.bloodType || '',
            vaccinations: raw.vaccinations || [],
            growthRecords: raw.growthRecords || [],
            allergies: raw.allergies || [], disease: raw.disease || {}, emergencyContact: raw.emergencyContact || {}, notes: raw.notes || '',
            authorizedPickers: (raw.authorizedPickers || []).filter((item) => item.isActive !== false).map((item) => ({
                fullName: item.fullName || '', phone: item.phone || '', relationship: item.relationship || '', photoURL: item.photoURL || '', vehicleType: item.vehicleType || '', vehiclePlate: item.vehiclePlate || ''
            }))
        };
    }
    return {
        ...base,
        address: raw.address || '', nationality: raw.nationality || '', ethnicity: raw.ethnicity || '', birthPlace: raw.birthPlace || '',
        healthInsuranceCode: raw.healthInsuranceCode || '', bloodType: raw.bloodType || '',
        vaccinations: raw.vaccinations || [], growthRecords: raw.growthRecords || [],
        notes: raw.notes || '', parents: raw.parents || [], authorizedPickers: raw.authorizedPickers || [], allergies: raw.allergies || [],
        disease: raw.disease || {}, emergencyContact: raw.emergencyContact || {}, attendanceCardId: raw.attendanceCardId || '',
        faceProfileId: raw.faceProfileId || '', schoolYear: raw.schoolYear, statusHistory: raw.statusHistory || [],
        createdBy: raw.createdBy || null, updatedBy: raw.updatedBy || null
    };
};

module.exports = { STUDENT_STATUSES, isClassroomCountedStatus, canTransitionStudentStatus, generateStudentCode, runStudentTransaction, serializeStudent };
