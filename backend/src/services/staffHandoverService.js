const cron = require('node-cron');
const Handover = require('../models/zone2_hr/StaffHandover');
const Employee = require('../models/zone2_hr/Employee');
const User = require('../models/zone1_system/User');
const Classroom = require('../models/zone3_school/Classroom');
const StaffShift = require('../models/zone2_hr/StaffShift');
const Asset = require('../models/zone6_procurement/Asset');
const { inTransaction, audit } = require('./credentialService');
const { DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');

let job;
let running = false;
const completeDueHandovers = async () => {
  if (running) return;
  running = true;
  try {
    const due = await Handover.find({ status: 'scheduled', effectiveAt: { $lte: new Date() } }).select('_id').limit(100).lean();
    for (const duePlan of due) {
      try {
        await inTransaction(async (session) => {
          const plan = await Handover.findById(duePlan._id).session(session);
          if (!plan || plan.status !== 'scheduled' || plan.effectiveAt > new Date()) return;
          if (plan.kind === 'resignation') {
            const employee = await Employee.findById(plan.employeeId).session(session);
            if (!employee?.userId) throw new Error('Không tìm thấy tài khoản liên kết của nhân viên cần kết thúc làm việc');
            const effectiveDay = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_SCHOOL_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(plan.effectiveAt);
            const [classroom, shift, asset] = await Promise.all([
              Classroom.exists({ status: 'active', $or: [{ homeroomTeacherId: employee.userId }, { 'teachers.teacherId': employee.userId }] }).session(session),
              StaffShift.exists({ employeeId: employee._id, status: 'active', validUntil: { $gte: effectiveDay } }).session(session),
              Asset.exists({ assignedTo: employee.userId, status: { $in: ['active', 'maintenance'] } }).session(session)
            ]);
            if (classroom || shift || asset) throw new Error('Phát sinh lại lớp, ca hoặc tài sản sau khi hẹn bàn giao; cần HR xử lý trước khi chốt');
            employee.status = 'resigned'; employee.endDate = plan.effectiveAt;
            await employee.save({ session });
            if (employee.userId) {
              const account = await User.findById(employee.userId).session(session);
              if (account) {
                account.status = 'inactive';
                account.accessEndsAt = plan.effectiveAt;
                account.authVersion = (account.authVersion || 0) + 1;
                await account.save({ session });
              }
            }
          }
          plan.set({ status: 'completed', completedAt: new Date(), processingError: '' }); await plan.save({ session });
          await audit({ _id: plan.scheduledBy, username: 'system:staff-handover' }, 'STAFF_HANDOVER_COMPLETED', 'StaffHandover', plan._id,
            { status: 'scheduled' }, { status: 'completed', kind: plan.kind, effectiveAt: plan.effectiveAt }, session);
        });
      } catch (error) {
        const message = String(error.message || 'Không thể chốt bàn giao').slice(0, 500);
        const changed = await Handover.findOneAndUpdate({ _id: duePlan._id, status: 'scheduled', processingError: { $ne: message } }, { $set: { processingError: message } });
        if (changed) console.error('Không thể hoàn tất bàn giao nhân sự:', String(duePlan._id), message);
      }
    }
  } finally { running = false; }
};
const startStaffHandoverScheduler = () => {
  if (job) return job;
  job = cron.schedule('* * * * *', () => { void completeDueHandovers().catch((error) => console.error('Không thể quét lịch bàn giao nhân sự:', error.message)); }, { timezone: DEFAULT_SCHOOL_TIMEZONE });
  void completeDueHandovers().catch((error) => console.error('Không thể quét lịch bàn giao nhân sự:', error.message));
  return job;
};
module.exports = { completeDueHandovers, startStaffHandoverScheduler };
