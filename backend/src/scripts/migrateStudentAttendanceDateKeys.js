require('dotenv').config();

const mongoose = require('mongoose');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const { DEFAULT_SCHOOL_TIMEZONE, getWorkDate } = require('../utils/dateHelpers');

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`🔄 Chuẩn hóa attendanceDateKey theo ${DEFAULT_SCHOOL_TIMEZONE}...`);

    const records = await StudentAttendance.find({ attendDate: { $exists: true } })
        .select('_id studentId attendDate attendanceDateKey')
        .lean();

    const groups = new Map();
    const invalidRecords = [];
    for (const record of records) {
        const workDate = record.attendDate ? getWorkDate(record.attendDate, DEFAULT_SCHOOL_TIMEZONE) : null;
        if (!workDate) {
            invalidRecords.push(record._id.toString());
            continue;
        }

        const groupKey = `${record.studentId}:${workDate}`;
        const group = groups.get(groupKey) || [];
        group.push({ ...record, workDate });
        groups.set(groupKey, group);
    }

    const conflicts = [...groups.values()].filter((group) => group.length > 1);
    const operations = [];

    for (const group of groups.values()) {
        const record = group[0];
        if (group.length === 1 && record.attendanceDateKey !== record.workDate) {
            operations.push({
                updateOne: {
                    filter: { _id: record._id },
                    update: { $set: { attendanceDateKey: record.workDate } }
                }
            });
        }
    }

    if (operations.length) {
        const result = await StudentAttendance.bulkWrite(operations, { ordered: false });
        console.log(`✅ Đã gán attendanceDateKey cho ${result.modifiedCount} bản ghi.`);
    } else {
        console.log('ℹ️ Không có bản ghi hợp lệ nào cần cập nhật.');
    }

    if (conflicts.length || invalidRecords.length) {
        console.error('⚠️ Migration hoàn tất một phần; không tạo/xóa dữ liệu cho các bản ghi xung đột.');
        if (conflicts.length) {
            console.error(`- ${conflicts.length} nhóm trùng học sinh/ngày:`, conflicts.map((group) => ({
                studentId: group[0].studentId.toString(),
                workDate: group[0].workDate,
                attendanceIds: group.map((record) => record._id.toString())
            })));
        }
        if (invalidRecords.length) {
            console.error(`- ${invalidRecords.length} bản ghi có attendDate không hợp lệ:`, invalidRecords);
        }
        process.exitCode = 1;
    }

    await mongoose.disconnect();
};

run().catch(async (error) => {
    console.error('❌ Migration attendanceDateKey thất bại:', error.message);
    await mongoose.disconnect();
    process.exit(1);
});
