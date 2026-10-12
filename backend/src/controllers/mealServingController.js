const mongoose = require('mongoose');
const MealServing = require('../models/zone5_nutrition/MealServing');
const KitchenDayClosing = require('../models/zone5_nutrition/KitchenDayClosing');
const Classroom = require('../models/zone3_school/Classroom');
const Menu = require('../models/zone5_nutrition/Menu');
const { calculateDailyServingPlan, checkAllergyAndDiseaseConflicts } = require('../services/nutritionService');
const { getTeacherClassroomIds } = require('../services/schoolDataAccessService');
const { getWorkDate, isValidWorkDate, startOfWorkDate, addWorkDays } = require('../utils/dateHelpers');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => {
    const conflict = error.name === 'VersionError' || error.code === 11000;
    res.status(error.status || (conflict ? 409 : 500)).json({ message: error.status ? error.message : conflict ? 'Dữ liệu suất ăn vừa thay đổi; vui lòng tải lại và thử lại' : 'Không thể xử lý suất ăn' });
};
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const readServingInput = (body) => {
    const count = body?.count;
    const note = body?.note ?? '';
    if (!validCount(count)) throw fail('Số suất phải là số nguyên không âm; không được bỏ trống');
    if (typeof note !== 'string' || note.trim().length > 500) throw fail('Ghi chú không hợp lệ hoặc vượt quá 500 ký tự');
    return { count, note: note.trim() };
};
const checkDate = (date) => {
    if (!isValidWorkDate(date)) throw fail('Ngày phục vụ không hợp lệ');
    return date;
};
const onlyToday = (date) => {
    if (date !== getWorkDate()) throw fail('Chỉ ghi nhận suất của ngày hiện tại', 409);
};
const ensureOpenDay = async (date) => {
    if (await KitchenDayClosing.exists({ dateKey: date })) throw fail('Ngày bếp đã chốt; không thể sửa suất ăn', 409);
};
const ensureClassroom = async (classroomId) => {
    if (!mongoose.isValidObjectId(classroomId)) throw fail('Lớp không hợp lệ');
    const classroom = await Classroom.findOne({ _id: classroomId, status: 'active' }).select('name').lean();
    if (!classroom) throw fail('Không tìm thấy lớp đang hoạt động', 404);
    return classroom;
};
const ensurePublishedSafeMenu = async (classroomId, date) => {
    const start = startOfWorkDate(date);
    const end = startOfWorkDate(addWorkDays(date, 1));
    const menu = await Menu.findOne({ classroomId, status: 'published', startDate: { $lt: end }, endDate: { $gte: start } }).lean();
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    const day = menu?.days?.find((item) => item.dayOfWeek === weekday);
    if (!day) throw fail('Lớp chưa có thực đơn được công bố cho ngày này', 409);
    const conflicts = await checkAllergyAndDiseaseConflicts(classroomId, [day]);
    if (conflicts.length) throw fail('Thực đơn lớp còn xung đột dị ứng; cần điều chỉnh và phê duyệt lại trước khi ghi nhận nấu', 409);
};

const getMealServings = async (req, res) => {
    try {
        const date = checkDate(req.query.date || getWorkDate());
        const query = { dateKey: date };
        if (req.user.role === 'teacher') query.classroomId = { $in: await getTeacherClassroomIds(req.user) };
        const data = await MealServing.find(query).sort({ classroomId: 1 }).lean();
        res.json({ success: true, data });
    } catch (error) { sendError(res, error); }
};

const recordCooked = async (req, res) => {
    try {
        const date = checkDate(req.body?.date);
        onlyToday(date);
        await ensureOpenDay(date);
        const classroom = await ensureClassroom(req.params.classroomId);
        const { count, note } = readServingInput(req.body);
        const plan = await calculateDailyServingPlan(date);
        const planned = plan.classBreakdown.find((item) => String(item.classroomId) === String(classroom._id))?.recommendedServings || 0;
        if (count !== planned && !note) throw fail('Số suất nấu khác điểm danh; cần nhập lý do', 409);
        await ensurePublishedSafeMenu(classroom._id, date);
        let record = await MealServing.findOne({ dateKey: date, classroomId: classroom._id });
        if (record?.deliveredAt) throw fail('Suất đã giao lớp; không thể sửa số suất nấu', 409);
        if (!record) record = new MealServing({ dateKey: date, classroomId: classroom._id, plannedAtCook: planned, cookedCount: count, cookedBy: req.user._id });
        record.plannedAtCook = planned;
        record.cookedCount = count;
        record.cookedBy = req.user._id;
        record.history.push({ action: 'cooked', count, note, userId: req.user._id });
        await record.save();
        res.json({ success: true, data: record });
    } catch (error) { sendError(res, error); }
};

const recordDelivered = async (req, res) => {
    try {
        const date = checkDate(req.body?.date);
        onlyToday(date);
        await ensureOpenDay(date);
        await ensureClassroom(req.params.classroomId);
        const { count, note } = readServingInput(req.body);
        const record = await MealServing.findOne({ dateKey: date, classroomId: req.params.classroomId });
        if (!record) throw fail('Cần ghi nhận số suất thực nấu trước khi giao lớp', 409);
        if (record.receivedAt) throw fail('Lớp đã xác nhận nhận suất; không thể sửa lần giao', 409);
        if (count > record.cookedCount) throw fail('Số suất giao không thể lớn hơn số suất đã nấu', 409);
        if (count !== record.cookedCount && !note) throw fail('Số suất giao khác số suất đã nấu; cần nhập lý do', 409);
        record.deliveredCount = count;
        record.deliveredBy = req.user._id;
        record.deliveredAt = new Date();
        record.history.push({ action: 'delivered', count, note, userId: req.user._id });
        await record.save();
        res.json({ success: true, data: record });
    } catch (error) { sendError(res, error); }
};

const confirmReceived = async (req, res) => {
    try {
        const date = checkDate(req.body?.date);
        onlyToday(date);
        await ensureOpenDay(date);
        await ensureClassroom(req.params.classroomId);
        const allowed = await getTeacherClassroomIds(req.user);
        if (!allowed.includes(String(req.params.classroomId))) throw fail('Bạn không phụ trách lớp này', 403);
        const { count, note } = readServingInput(req.body);
        const record = await MealServing.findOne({ dateKey: date, classroomId: req.params.classroomId });
        if (!record?.deliveredAt) throw fail('Bếp chưa ghi nhận giao suất cho lớp', 409);
        if (record.receivedAt) throw fail('Lớp đã xác nhận nhận suất', 409);
        if (count > record.deliveredCount) throw fail('Số suất nhận không thể lớn hơn số suất bếp đã giao', 409);
        if (count !== record.deliveredCount && !note) throw fail('Số suất nhận khác số suất bếp giao; cần nhập lý do', 409);
        record.receivedCount = count;
        record.receivedBy = req.user._id;
        record.receivedAt = new Date();
        record.history.push({ action: 'received', count, note, userId: req.user._id });
        await record.save();
        res.json({ success: true, data: record });
    } catch (error) { sendError(res, error); }
};

module.exports = { getMealServings, recordCooked, recordDelivered, confirmReceived };
