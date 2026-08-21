const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');
const { startOfDay, createDateTime } = require('../controllers/timekeepingController');

const syncPendingCorrections = async () => {
    const today = startOfDay();
    const requests = await TimekeepingCorrectionRequest.find({
        status: 'pending',
        workDate: { $lt: today }
    });

    for (const request of requests) {
        const existing = await AttendanceRecord.findOne({ userId: request.userId, workDate: request.workDate });
        const record = existing || await AttendanceRecord.create({
            userId: request.userId,
            employeeName: request.employeeName,
            workDate: request.workDate,
            checkInTime: createDateTime(request.workDate, request.requestedCheckInTime),
            source: 'correction',
            correctionRequestId: request._id,
            note: `Chấm công bù: ${request.reason}`
        });

        request.status = 'synced';
        request.syncedAt = new Date();
        request.attendanceRecordId = record._id;
        await request.save();
    }
    return requests.length;
};

const startTimekeepingSync = () => {
    const run = async () => {
        try {
            const count = await syncPendingCorrections();
            if (count) console.log(`✅ Đã đồng bộ ${count} đơn chấm công bù`);
        } catch (err) {
            console.error('❌ Lỗi đồng bộ đơn chấm công bù:', err);
        }
    };

    // Chạy ngay khi server khởi động và sau đó mỗi phút. Đơn của ngày trước
    // được xử lý ngay sau 00:00, kể cả khi server vừa khởi động lại.
    run();
    setInterval(run, 60 * 1000);
};

module.exports = { startTimekeepingSync, syncPendingCorrections };
