const AttendanceRecord = require('../models/zone2_hr/AttendanceRecord');
const TimekeepingCorrectionRequest = require('../models/zone2_hr/TimekeepingCorrectionRequest');

const startOfDay = (date = new Date()) => {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
};

const createDateTime = (workDate, time) => {
    const [hours, minutes] = time.split(':').map(Number);
    const value = startOfDay(workDate);
    value.setHours(hours, minutes, 0, 0);
    return value;
};

const employeeName = (user) => user.profile?.fullName || user.username;

// Chấm công trực tiếp cho ngày hiện tại.
const manualCheckIn = async (req, res) => {
    try {
        const workDate = startOfDay();
        const existing = await AttendanceRecord.findOne({ userId: req.user._id, workDate });
        if (existing) {
            return res.status(200).json({
                message: 'Bạn đã chấm công hôm nay',
                alreadyCheckedIn: true,
                data: existing
            });
        }

        const record = await AttendanceRecord.create({
            userId: req.user._id,
            employeeName: employeeName(req.user),
            workDate,
            checkInTime: new Date(),
            source: 'manual',
            note: req.body.note?.trim() || ''
        });

        return res.status(201).json({
            message: 'Chấm công thành công',
            alreadyCheckedIn: false,
            data: record
        });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(200).json({ message: 'Bạn đã chấm công hôm nay', alreadyCheckedIn: true });
        }
        console.error(err);
        return res.status(500).json({ message: 'Không thể chấm công lúc này' });
    }
};

// Tạo đơn bù cho ngày đã qua. Đơn được service đồng bộ sau 00:00.
const createCorrectionRequest = async (req, res) => {
    try {
        const { workDate, requestedCheckInTime, reason } = req.body;
        if (!workDate || !requestedCheckInTime || !reason?.trim()) {
            return res.status(400).json({ message: 'Vui lòng nhập ngày làm việc, giờ vào và lý do' });
        }
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedCheckInTime)) {
            return res.status(400).json({ message: 'Giờ vào phải theo định dạng HH:mm' });
        }

        const requestDate = startOfDay(`${workDate}T00:00:00`);
        const today = startOfDay();
        if (Number.isNaN(requestDate.getTime()) || requestDate >= today) {
            return res.status(400).json({ message: 'Đơn bù chỉ áp dụng cho ngày làm việc trước hôm nay' });
        }

        const existingAttendance = await AttendanceRecord.findOne({ userId: req.user._id, workDate: requestDate });
        if (existingAttendance) {
            return res.status(409).json({ message: 'Ngày này đã có bản ghi chấm công' });
        }
        const existingRequest = await TimekeepingCorrectionRequest.findOne({
            userId: req.user._id,
            workDate: requestDate,
            status: 'pending'
        });
        if (existingRequest) {
            return res.status(409).json({ message: 'Bạn đã gửi đơn chấm công bù cho ngày này' });
        }

        const request = await TimekeepingCorrectionRequest.create({
            userId: req.user._id,
            employeeName: employeeName(req.user),
            workDate: requestDate,
            requestedCheckInTime,
            reason: reason.trim()
        });
        return res.status(201).json({
            message: 'Đã gửi đơn chấm công bù. Hệ thống sẽ đồng bộ sau 00:00.',
            data: request
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Không thể tạo đơn chấm công bù' });
    }
};

const getMyTimekeeping = async (req, res) => {
    try {
        const [records, corrections] = await Promise.all([
            AttendanceRecord.find({ userId: req.user._id }).sort({ workDate: -1 }).limit(31),
            TimekeepingCorrectionRequest.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(31)
        ]);
        return res.json({ message: 'Lấy dữ liệu chấm công thành công', data: { records, corrections } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Không thể tải dữ liệu chấm công' });
    }
};

module.exports = { manualCheckIn, createCorrectionRequest, getMyTimekeeping, startOfDay, createDateTime };
