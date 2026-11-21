const fs = require('fs');

// 1. Update Classroom.js
let classroomModel = fs.readFileSync('backend/src/models/zone3_school/Classroom.js', 'utf8');
const oldClassroomIndex = `ClassroomSchema.index(
    { schoolYear: 1, homeroomTeacherId: 1 },
    { name: 'schoolYear_1_homeroomTeacherId_1', unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' } } }
);`;

const newClassroomIndex = `ClassroomSchema.index(
    { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 },
    {
        name: 'tenantId_1_schoolYear_1_homeroomTeacherId_1_unique',
        unique: true,
        partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: { $type: 'objectId' } }
    }
);
ClassroomSchema.index(
    { schoolYear: 1, homeroomTeacherId: 1 },
    {
        name: 'legacy_schoolYear_1_homeroomTeacherId_1_unique',
        unique: true,
        partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: null }
    }
);`;

classroomModel = classroomModel.replace(/\r\n/g, '\n');
const normalizedOld = oldClassroomIndex.replace(/\r\n/g, '\n');
if (classroomModel.includes(normalizedOld)) {
  classroomModel = classroomModel.replace(normalizedOld, newClassroomIndex);
  fs.writeFileSync('backend/src/models/zone3_school/Classroom.js', classroomModel, 'utf8');
  console.log('Classroom.js updated successfully');
} else {
  console.log('Could not find oldClassroomIndex in Classroom.js');
}

// 2. Update classroomController.js
let controllerContent = fs.readFileSync('backend/src/controllers/classroomController.js', 'utf8');
const oldEnsureFn = `const ensureHomeroomAssignmentIndex = () => {
  if (!homeroomIndexPromise) {
    homeroomIndexPromise = Classroom.collection.createIndex(
      { schoolYear: 1, homeroomTeacherId: 1 },
      { name: 'schoolYear_1_homeroomTeacherId_1', unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' } } }
    );
  }
  return homeroomIndexPromise;
};`;

const newEnsureFn = `const ensureHomeroomAssignmentIndex = (tenantId = null) => {
  if (!homeroomIndexPromise) {
    if (tenantId) {
      homeroomIndexPromise = Classroom.collection.createIndex(
        { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 },
        { name: 'tenantId_1_schoolYear_1_homeroomTeacherId_1_unique', unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: { $type: 'objectId' } } }
      );
    } else {
      homeroomIndexPromise = Classroom.collection.createIndex(
        { schoolYear: 1, homeroomTeacherId: 1 },
        { name: 'legacy_schoolYear_1_homeroomTeacherId_1_unique', unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: null } }
      );
    }
  }
  return homeroomIndexPromise;
};`;

controllerContent = controllerContent.replace(/\r\n/g, '\n');
const normalizedOldEnsure = oldEnsureFn.replace(/\r\n/g, '\n');
if (controllerContent.includes(normalizedOldEnsure)) {
  controllerContent = controllerContent.replace(normalizedOldEnsure, newEnsureFn);
  controllerContent = controllerContent.replace(
    'await ensureHomeroomAssignmentIndex();',
    'await ensureHomeroomAssignmentIndex(req.tenantId || req.user?.tenantId);'
  );
  fs.writeFileSync('backend/src/controllers/classroomController.js', controllerContent, 'utf8');
  console.log('classroomController.js updated successfully');
} else {
  console.log('Could not find oldEnsureFn in classroomController.js');
}
