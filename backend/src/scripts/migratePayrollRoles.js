require('dotenv').config();
const mongoose = require('mongoose');

const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify');
const validRoles = new Set(['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr']);
const roleFromPosition = (position) => ({
  principal: 'principal', vice_principal: 'principal', head_teacher: 'teacher', teacher: 'teacher', assistant_teacher: 'teacher',
  accountant: 'accountant', chef: 'chef', security: 'guard', hr: 'hr'
}[position] || 'teacher');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const [employees, payrolls] = await Promise.all([
    db.collection('employees').find({}, { projection: { position: 1, payrollRole: 1 } }).toArray(),
    db.collection('payrolls').find({}, { projection: { position: 1, payrollRole: 1 } }).toArray()
  ]);
  const missingEmployees = employees.filter((item) => !validRoles.has(item.payrollRole));
  const missingPayrolls = payrolls.filter((item) => !validRoles.has(item.payrollRole));
  const report = {
    dryRun,
    verifyOnly,
    employees: { total: employees.length, needsBackfill: missingEmployees.length },
    payrolls: { total: payrolls.length, needsBackfill: missingPayrolls.length }
  };
  console.log(JSON.stringify(report, null, 2));
  if (verifyOnly) {
    if (missingEmployees.length || missingPayrolls.length) throw new Error('Verify thất bại: còn hồ sơ chưa có vai trò tính lương hợp lệ.');
    console.log('Verify thành công: toàn bộ nhân sự và bảng lương đã có vai trò tính lương.');
    return;
  }
  if (!dryRun) {
    const now = new Date();
    if (missingEmployees.length) await db.collection('employees').bulkWrite(missingEmployees.map((item) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { payrollRole: roleFromPosition(item.position), updatedAt: now } } }
    })), { ordered: true });
    if (missingPayrolls.length) await db.collection('payrolls').bulkWrite(missingPayrolls.map((item) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { payrollRole: roleFromPosition(item.position), updatedAt: now } } }
    })), { ordered: true });
    await db.collection('employees').createIndex({ payrollRole: 1, status: 1 }, { name: 'payrollRole_1_status_1' });
    await db.collection('payrolls').createIndex({ month: 1, year: 1, payrollRole: 1 }, { name: 'month_1_year_1_payrollRole_1' });
    console.log('Đã backfill vai trò tính lương và tạo index. Rollback: chỉ unset payrollRole trên các collection employees/payrolls từ bản backup trước migration; không thay đổi lương hoặc dữ liệu tổ/bộ phận.');
  }
};

run().catch(async (error) => {
  console.error(error.message || error);
  process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect(); });
