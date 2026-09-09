require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('../models/zone3_school/Student');
const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');
const { STUDENT_STATUSES } = require('../services/studentCoreService');

const dryRun = process.argv.includes('--dry-run');
const verifyOnly = process.argv.includes('--verify');
const legacyStatusMap = { suspended: 'temporarily_absent' };
const codePattern = /^HS-(\d{4})-(\d{6})$/;

const printRollbackGuide = () => console.log('Rollback: khôi phục collection students và studentcodecounters từ bản backup trước migration. Migration này không tự xóa hay ghi đè backup.');

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const students = await Student.find().sort({ createdAt: 1, _id: 1 }).lean();
    const years = new Map();
    const seenCodes = new Set();
    const duplicates = new Set();
    const invalidCodes = [];
    for (const student of students) {
        if (!student.studentCode) continue;
        const match = codePattern.exec(student.studentCode);
        if (!match) invalidCodes.push({ id: String(student._id), studentCode: student.studentCode });
        else {
            const year = Number(match[1]); const sequence = Number(match[2]);
            years.set(year, Math.max(years.get(year) || 0, sequence));
        }
        if (seenCodes.has(student.studentCode)) duplicates.add(student.studentCode);
        seenCodes.add(student.studentCode);
    }
    if (duplicates.size || invalidCodes.length) {
        console.error(JSON.stringify({ duplicates: [...duplicates], invalidCodes }, null, 2));
        throw new Error('Dừng migration: cần xử lý mã học sinh trùng hoặc sai định dạng trước khi chạy.');
    }
    let mappedLegacyStatus = 0;
    let assignedCodes = 0;
    const operations = students.map((student) => {
        const admissionDate = student.admissionDate || student.enrollmentDate || student.createdAt || new Date();
        const year = new Date(admissionDate).getFullYear();
        const sequence = student.studentCode ? null : (years.get(year) || 0) + 1;
        if (sequence) { years.set(year, sequence); assignedCodes += 1; }
        const status = legacyStatusMap[student.status] || student.status || 'enrolled';
        if (status !== student.status) mappedLegacyStatus += 1;
        return {
            updateOne: {
                filter: { _id: student._id },
                update: { $set: {
                    studentCode: student.studentCode || `HS-${year}-${String(sequence).padStart(6, '0')}`,
                    admissionDate,
                    status,
                    updatedAt: new Date()
                } }
            }
        };
    });
    console.log(JSON.stringify({ dryRun, verifyOnly, total: students.length, assignedCodes, legacyStatusMapped: mappedLegacyStatus, codeYears: Object.fromEntries(years) }, null, 2));
    if (verifyOnly) {
        const incomplete = students.filter((student) => !student.studentCode || !STUDENT_STATUSES?.includes?.(student.status));
        if (incomplete.length) throw new Error(`Verify thất bại: ${incomplete.length} hồ sơ chưa chuẩn hóa.`);
        console.log('Verify thành công: mã học sinh và trạng thái hiện có hợp lệ.');
        return;
    }
    if (!dryRun && operations.length) {
        await Student.bulkWrite(operations, { ordered: true });
        await Promise.all([...years.entries()].map(([year, sequence]) => StudentCodeCounter.findOneAndUpdate({ year }, { $max: { sequence } }, { upsert: true })));
        await Student.collection.createIndex({ studentCode: 1 }, { unique: true, name: 'studentCode_1' });
        console.log('Đã migrate Student Core và tạo unique index studentCode_1.');
        printRollbackGuide();
    }
    await mongoose.disconnect();
};
run().catch(async (error) => { console.error(error.message || error); printRollbackGuide(); await mongoose.disconnect(); process.exit(1); });
