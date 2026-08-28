const AttendanceAuditLog = require('../models/zone2_hr/AttendanceAuditLog');

async function logAttendanceAction(actorId, action, entity, entityId, oldValue, newValue, reason) {
  return AttendanceAuditLog.create({
    actor: actorId,
    action,
    entity,
    entityId,
    oldValue,
    newValue,
    reason,
    timestamp: new Date()
  });
}

module.exports = { logAttendanceAction };