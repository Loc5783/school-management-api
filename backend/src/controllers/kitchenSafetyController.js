const Menu = require('../models/zone5_nutrition/Menu');
const FoodSample = require('../models/zone5_nutrition/FoodSample');
const FoodInspection = require('../models/zone5_nutrition/FoodInspection');
const MealServing = require('../models/zone5_nutrition/MealServing');
const { calculateDailyServingPlan, checkAllergyAndDiseaseConflicts } = require('../services/nutritionService');
const { addWorkDays, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

const MEALS = ['breakfast', 'morningSnack', 'lunch', 'afternoonSnack'];
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : error.code === 11000 ? 'Bữa ăn vừa được cập nhật; tải lại trang' : 'Không thể ghi nhận an toàn thực phẩm' });
const dateRange = (date) => ({ $gte: startOfWorkDate(date), $lt: startOfWorkDate(addWorkDays(date, 1)) });
const getMealItems = (day, mealType) => {
    const simple = (meal) => meal?.items?.length ? meal.items : meal?.dishId ? [meal] : [];
    const lunch = (list, legacy) => day.lunch?.[list]?.length ? day.lunch[list] : day.lunch?.[legacy]?.dishId ? [day.lunch[legacy]] : [];
    if (mealType !== 'lunch') return simple(day[mealType]);
    return [...lunch('mainDishes', 'mainDish'), ...lunch('stirFryDishes', 'stirFryDish'), ...lunch('soupDishes', 'soupDish'), ...lunch('desserts', 'dessert')];
};
const expectedDishes = async (date) => {
    const plan = await calculateDailyServingPlan(date);
    const cooked = await MealServing.find({ dateKey: date, cookedCount: { $gt: 0 } }).select('classroomId').lean();
    const activeClassIds = [...new Set([...plan.classBreakdown.filter((item) => item.recommendedServings > 0).map((item) => String(item.classroomId)), ...cooked.map((item) => String(item.classroomId))])];
    const menus = await Menu.find({ classroomId: { $in: activeClassIds }, status: 'published', startDate: { $lt: dateRange(date).$lt }, endDate: { $gte: dateRange(date).$gte } }).lean();
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    const missingMenus = activeClassIds.filter((id) => !menus.some((menu) => String(menu.classroomId) === String(id) && menu.days?.some((day) => day.dayOfWeek === weekday)));
    const names = Object.fromEntries(MEALS.map((meal) => [meal, new Set()]));
    menus.forEach((menu) => {
        const day = menu.days?.find((item) => item.dayOfWeek === weekday);
        if (!day) return;
        MEALS.forEach((meal) => getMealItems(day, meal).forEach((item) => {
            if (item.dishName?.trim()) names[meal].add(item.dishName.trim());
        }));
    });
    const conflicts = await Promise.all(menus.map(async (menu) => {
        const day = menu.days?.find((item) => item.dayOfWeek === weekday);
        return day ? checkAllergyAndDiseaseConflicts(menu.classroomId, [day]) : [];
    }));
    return { expected: Object.fromEntries(MEALS.map((meal) => [meal, [...names[meal]].sort((a, b) => a.localeCompare(b, 'vi'))])), missingMenus: missingMenus.length,
        allergyConflicts: Object.fromEntries(MEALS.map((meal) => [meal, conflicts.flat().filter((item) => item.mealType?.split('.')[0] === meal).length])) };
};

const getKitchenSafetyDay = async (req, res) => {
    try {
        const date = req.query.date || getWorkDate();
        if (!isValidWorkDate(date)) throw fail('Ngày không hợp lệ');
        const [inspections, samples, dishes] = await Promise.all([
            FoodInspection.find({ mealDate: dateRange(date) }).sort({ mealType: 1 }).lean(),
            FoodSample.find({ mealDate: dateRange(date) }).sort({ mealType: 1, dishName: 1 }).lean(),
            expectedDishes(date)
        ]);
        res.json({ success: true, data: { date, inspections, samples, ...dishes } });
    } catch (error) { sendError(res, error); }
};

const recordKitchenSafetyStep = async (req, res) => {
    try {
        const date = req.body?.date;
        const mealType = req.params.mealType;
        const step = Number(req.params.step);
        if (!isValidWorkDate(date) || date !== getWorkDate()) throw fail('Chỉ ghi kiểm thực của ngày hiện tại');
        if (!MEALS.includes(mealType) || ![1, 2, 3].includes(step)) throw fail('Bữa hoặc bước kiểm thực không hợp lệ');
        const checks = req.body?.checks;
        if (!checks || typeof checks !== 'object' || Array.isArray(checks)) throw fail('Danh sách mục kiểm tra không hợp lệ');
        const required = step === 1 ? ['sourceVerified', 'packagingPassed', 'sensoryPassed']
            : step === 2 ? ['kitchenHygiene', 'equipmentHygiene', 'staffHygiene', 'rawCookedSeparated', 'cookingVerified']
                : ['sensoryPassed', 'utensilsHygiene'];
        if (required.some((field) => typeof checks[field] !== 'boolean')) throw fail('Cần xác nhận từng mục kiểm tra');
        const passed = required.every((field) => checks[field]);
        const noteInput = req.body?.note ?? '';
        if (typeof noteInput !== 'string') throw fail('Ghi chú kiểm thực không hợp lệ');
        const note = noteInput.trim();
        if (note.length > 500 || (!passed && !note)) throw fail('Mục không đạt phải có ghi chú xử lý, tối đa 500 ký tự');
        let inspection = await FoodInspection.findOne({ mealDateKey: date, mealType });
        if (!inspection) {
            if (step !== 1) throw fail('Cần kiểm tra nguyên liệu đầu vào trước', 409);
            inspection = new FoodInspection({ mealDateKey: date, mealDate: startOfWorkDate(date), mealType, inspectorId: req.user._id, inspectorName: req.user.profile?.fullName || req.user.username });
        }
        if (inspection.stage === 'ready') throw fail('Bữa đã hoàn tất kiểm thực; không thể ghi đè', 409);
        if (step === 1 && inspection.step2Check?.checkTime) throw fail('Đã sang bước chế biến; không thể sửa lại bước nguyên liệu', 409);
        if (step === 2 && inspection.stage !== 'raw_checked' && !(inspection.stage === 'held' && inspection.step2Check?.checkTime)) throw fail('Cần hoàn tất bước kiểm tra nguyên liệu trước', 409);
        if (step === 3 && inspection.stage !== 'processing_checked' && !(inspection.stage === 'held' && inspection.step3Check?.checkTime)) throw fail('Cần hoàn tất bước kiểm tra chế biến trước', 409);
        if (step === 3 && passed) {
            const dishes = await expectedDishes(date);
            if (dishes.missingMenus || !dishes.expected[mealType].length) throw fail('Thiếu thực đơn đã công bố hoặc chưa có món cho bữa này', 409);
            if (dishes.allergyConflicts[mealType]) throw fail('Thực đơn bữa này còn xung đột dị ứng theo hồ sơ hiện tại; chưa thể xác nhận phục vụ', 409);
            const samples = await FoodSample.find({ mealDate: dateRange(date), mealType, status: 'stored' }).select('dishName').lean();
            const sampled = new Set(samples.map((item) => item.dishName.trim().toLocaleLowerCase('vi')));
            const missing = dishes.expected[mealType].filter((name) => !sampled.has(name.toLocaleLowerCase('vi')));
            if (missing.length) throw fail(`Chưa lưu mẫu các món: ${missing.join(', ')}`, 409);
        }
        if (step === 1) inspection.step1Check = { ...checks, note, checkTime: new Date() };
        if (step === 2) inspection.step2Check = { ...checks, note, checkTime: new Date() };
        if (step === 3) inspection.step3Check = { ...checks, note, checkTime: new Date() };
        inspection.stage = passed ? ['raw_checked', 'processing_checked', 'ready'][step - 1] : 'held';
        inspection.stageHistory.push({ stage: `step${step}`, passed, note, userId: req.user._id });
        inspection.inspectorId = req.user._id;
        inspection.inspectorName = req.user.profile?.fullName || req.user.username;
        await inspection.save();
        res.json({ success: true, data: inspection });
    } catch (error) { sendError(res, error); }
};

module.exports = { getKitchenSafetyDay, recordKitchenSafetyStep, expectedDishes };
