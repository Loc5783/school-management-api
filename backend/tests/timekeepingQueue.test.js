process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../src/models/zone1_system/User');
const AttendanceRecord = require('../src/models/zone2_hr/AttendanceRecord');
const AttendanceRecalculationQueue = require('../src/models/zone2_hr/AttendanceRecalculationQueue');
const RawAttendanceEvent = require('../src/models/zone2_hr/RawAttendanceEvent');
const AttendanceAuditLog = require('../src/models/zone2_hr/AttendanceAuditLog');
const OutboxEvent = require('../src/models/zone1_system/OutboxEvent');
const { ingestDeviceEvent } = require('../src/services/attendanceDeviceService');
const { processQueuedRecalculations } = require('../src/services/attendanceCalculationService');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    AttendanceRecord.deleteMany({}),
    AttendanceRecalculationQueue.deleteMany({}),
    RawAttendanceEvent.deleteMany({}),
    AttendanceAuditLog.deleteMany({}),
    OutboxEvent.deleteMany({})
  ]);
});

test('turns a valid kiosk check-in event into an attendance record without failing the transaction worker', async () => {
  const guard = await User.create({
    username: 'guard-queue', passwordHash: 'x', role: 'guard', status: 'active',
    profile: { fullName: 'Chú Bảo vệ' }
  });
  const occurredAt = new Date('2026-09-16T01:30:00.000Z');

  await ingestDeviceEvent({
    deviceId: 'WEB_KIOSK', externalEventId: 'guard-queue-2026-09-16-in', userId: guard._id,
    eventType: 'CHECK_IN', source: 'MANUAL_CODE', occurredAt
  });
  const processed = await processQueuedRecalculations({ workerId: 'queue-test', maxItems: 5 });

  expect(processed).toHaveLength(1);
  const record = await AttendanceRecord.findOne({ userId: guard._id });
  expect(record).toMatchObject({ userId: guard._id, checkInTime: occurredAt, source: 'merged', status: 'incomplete' });
  expect(await AttendanceRecalculationQueue.findOne({ userId: guard._id, status: 'DONE' })).not.toBeNull();
});
