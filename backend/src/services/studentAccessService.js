const { isValidObjectId } = require('../utils/idValidation');

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

const canAccessStudent = (user, studentId) => {
    if (!isParent(user)) return true;

    return getLinkedStudentIds(user).includes(studentId.toString());
};

const applyStudentListScope = (user, filter) => {
    if (!isParent(user)) return filter;

    return {
        ...filter,
        _id: { $in: getLinkedStudentIds(user) }
    };
};

module.exports = {
    applyStudentListScope,
    canAccessStudent,
    getLinkedStudentIds,
    isParent,
    isValidStudentId
};
