require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('../models/zone3_school/Student');
const StudentCodeCounter = require('../models/zone3_school/StudentCodeCounter');

const dryRun = process.argv.includes('--dry-run');
const legacyStatusMap = { suspended: 'temporarily_absent' };

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const students = await Student.find().sort({ createdAt: 1, _id: 1 }).lean();
    const years = new Map();
    let mappedLegacyStatus = 0;
    const operations = students.map((student) => {
        const admissionDate = student.admissionDate || student.enrollmentDate || student.createdAt || new Date();
        const year = new Date(admissionDate).getFullYear();
        const sequence = (years.get(year) || 0) + 1;
        years.set(year, sequence);
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
    console.log(JSON.stringify({ dryRun, total: students.length, legacyStatusMapped: mappedLegacyStatus, codeYears: Object.fromEntries(years) }, null, 2));
    if (!dryRun && operations.length) {
        await Student.bulkWrite(operations, { ordered: true });
        await Promise.all([...years.entries()].map(([year, sequence]) => StudentCodeCounter.findOneAndUpdate({ year }, { $max: { sequence } }, { upsert: true })));
        await Student.syncIndexes();
        console.log('Đã migrate Student Core và đồng bộ indexes.');
    }
    await mongoose.disconnect();
};
run().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exit(1); });
