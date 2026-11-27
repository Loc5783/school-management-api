const Menu = require('../models/zone5_nutrition/Menu');
const Dish = require('../models/zone5_nutrition/Dish');
const IngredientMaster = require('../models/zone5_nutrition/IngredientMaster');
const Inventory = require('../models/zone5_nutrition/Inventory');
const InventoryTransaction = require('../models/zone5_nutrition/InventoryTransaction');
const InventoryReconciliation = require('../models/zone5_nutrition/InventoryReconciliation');
const Supplier = require('../models/zone5_nutrition/Supplier');
const KitchenStaff = require('../models/zone5_nutrition/KitchenStaff');
const KitchenEquipment = require('../models/zone5_nutrition/KitchenEquipment');
const FoodSample = require('../models/zone5_nutrition/FoodSample');
const FoodInspection = require('../models/zone5_nutrition/FoodInspection');
const { expectedDishes } = require('./kitchenSafetyController');
const KitchenRequest = require('../models/zone5_nutrition/KitchenRequest');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const {
    ALLERGEN_CODES,
    checkAllergyAndDiseaseConflicts,
    calculateDailyMealReport,
    calculateDailyServingPlan,
    cloneWeeklyMenu,
    getInventoryAlerts: fetchInventoryAlerts,
    normalizeAllergen
} = require('../services/nutritionService');
const { addWorkDays, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');
const { isValidObjectId } = require('../utils/idValidation');
const { canAccessClassroom, getTeacherClassroomIds } = require('../services/schoolDataAccessService');
const { getLinkedStudentIds } = require('../services/studentAccessService');
const {
    importInventory,
    exportInventoryFEFO,
    returnUnusedInventory
} = require('../services/inventoryTransactionService');
const { buildTenantFilter } = require('../services/tenantFilterService');

const MENU_DAY_OFFSETS = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4
};

const getIsoWeekNumber = (workDate) => {
    const [year, month, day] = workDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

const getSchoolYearForDate = (workDate) => {
    const [year, month] = workDate.split('-').map(Number);
    return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const isMonday = (workDate) => new Date(`${workDate}T00:00:00.000Z`).getUTCDay() === 1;

const getDishReference = (dish, existing = {}) => ({
    dishId: dish._id,
    dishName: dish.name,
    calories: Number(dish.calories) || 0,
    notes: existing.notes || ''
});

const getMealItems = (meal = {}) => (
    Array.isArray(meal.items) && meal.items.length ? meal.items : (meal.dishId ? [meal] : [])
);

const getLunchItems = (lunch = {}, collectionKey, legacyKey) => (
    Array.isArray(lunch[collectionKey]) && lunch[collectionKey].length
        ? lunch[collectionKey]
        : (lunch[legacyKey]?.dishId ? [lunch[legacyKey]] : [])
);

const isSchoolWideNutritionReader = (user) => ['admin', 'principal', 'chef'].includes(user?.role);

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getParentClassroomIds = async (user, req = null) => {
    const studentIds = getLinkedStudentIds(user);
    if (!studentIds.length) return [];
    const tenantFilter = req ? buildTenantFilter(req) : (user?.tenantId ? { tenantId: user.tenantId } : {});
    const classroomIds = await Student.distinct('classroomId', {
        ...tenantFilter,
        _id: { $in: studentIds },
        status: 'enrolled',
        classroomId: { $ne: null }
    });
    return classroomIds.map(String);
};

const getReadableClassroomIds = async (user, req = null) => {
    if (isSchoolWideNutritionReader(user)) return null;
    if (user?.role === 'teacher') return getTeacherClassroomIds(user, req);
    if (user?.role === 'parent') return getParentClassroomIds(user, req);
    return [];
};

const assertValidObjectId = (value, label) => {
    if (!isValidObjectId(value)) {
        const error = new Error(`${label} không hợp lệ`);
        error.statusCode = 400;
        throw error;
    }
};

const assertReadableMenu = async (user, menu, req = null) => {
    if (isSchoolWideNutritionReader(user)) return;
    const readableClassroomIds = await getReadableClassroomIds(user, req);
    if (!readableClassroomIds.includes(String(menu.classroomId))) {
        const error = new Error('Bạn không có quyền xem thực đơn của lớp này');
        error.statusCode = 403;
        throw error;
    }
    if (user?.role === 'parent' && menu.status !== 'published') {
        const error = new Error('Phụ huynh chỉ có thể xem thực đơn đã công bố');
        error.statusCode = 403;
        throw error;
    }
};

const serializeMenuForParent = (menu) => {
    const raw = typeof menu.toObject === 'function' ? menu.toObject() : menu;
    const {
        allergyWarnings,
        medicalNotes,
        allergensExcluded,
        auditTrail,
        approvedBy,
        approvedByName,
        approvalNote,
        createdBy,
        createdByName,
        ...safeMenu
    } = raw;
    return safeMenu;
};

const getActorName = (user) => user?.profile?.fullName || user?.username || 'Người dùng';
const appendMenuAudit = (menu, user, action, fromStatus, toStatus, reason = '') => {
    menu.auditTrail.push({
        action,
        actorId: user._id,
        actorName: getActorName(user),
        fromStatus,
        toStatus,
        reason
    });
};

const validatePublishReadiness = (menu) => {
    const requiredDays = Object.keys(MENU_DAY_OFFSETS);
    const hasCompletePlan = requiredDays.every((dayName) => {
        const day = menu.days.find((entry) => entry.dayOfWeek === dayName);
        return getMealItems(day?.breakfast).length && getMealItems(day?.morningSnack).length
            && getLunchItems(day?.lunch, 'mainDishes', 'mainDish').length
            && getLunchItems(day?.lunch, 'soupDishes', 'soupDish').length
            && getMealItems(day?.afternoonSnack).length;
    });
    if (!hasCompletePlan) {
        const error = new Error('Chỉ được gửi duyệt khi đã hoàn thiện đủ bữa phục vụ từ Thứ Hai đến Thứ Sáu');
        error.statusCode = 422;
        throw error;
    }
    if (menu.allergyWarnings.some((warning) => !warning.resolved)) {
        const error = new Error('Không thể gửi duyệt thực đơn khi còn cảnh báo dị ứng chưa được xử lý');
        error.statusCode = 422;
        throw error;
    }
};

// Chính sách thực đơn chung theo lớp: khi một bé đang theo học có dị ứng đã
// khai báo, món chứa dị nguyên đó không được phục vụ cho cả lớp. Không dùng
// cờ "đã xử lý" để lách chính sách này; suất thay thế là một thực đơn/lớp
// riêng, không phải cùng thực đơn chung.
const assertClassroomMenuIsAllergenSafe = async (classroomId, days, req = null) => {
    const tenantId = req?.tenantId || req?.user?.tenantId || null;
    const conflicts = await checkAllergyAndDiseaseConflicts(classroomId, days, tenantId);
    if (!conflicts.length) return;

    const dishes = [...new Set(conflicts.map((conflict) => conflict.dishName).filter(Boolean))];
    const allergens = [...new Set(conflicts.map((conflict) => conflict.allergenMatched).filter(Boolean))];
    const error = new Error(`Không thể lưu thực đơn chung của lớp vì có học sinh dị ứng ${allergens.join(', ')}. Hãy thay các món: ${dishes.join(', ')}.`);
    error.statusCode = 422;
    error.code = 'CLASSROOM_ALLERGEN_CONFLICT';
    error.conflicts = conflicts;
    throw error;
};

/**
 * Server-side source of truth for a menu: the client only selects dish IDs.
 * Names, calories and service dates are derived here so a stale browser cannot
 * create a menu that no longer matches the dish catalogue.
 */
const prepareMenuDays = async (days, startDate, req = null) => {
    if (!Array.isArray(days) || !days.length) return [];

    const seenDays = new Set();
    const dishIds = new Set();
    const dishNames = new Set();
    const collectDishId = (item) => {
        if (item?.dishId) dishIds.add(String(item.dishId));
        if (item?.dishName) dishNames.add(String(item.dishName).trim());
    };

    days.forEach((day) => {
        if (!Object.hasOwn(MENU_DAY_OFFSETS, day.dayOfWeek) || seenDays.has(day.dayOfWeek)) {
            throw new Error('Ngày phục vụ trong thực đơn không hợp lệ hoặc bị trùng');
        }
        seenDays.add(day.dayOfWeek);
        getMealItems(day.breakfast).forEach(collectDishId);
        getMealItems(day.morningSnack).forEach(collectDishId);
        getMealItems(day.afternoonSnack).forEach(collectDishId);
        [
            ['mainDishes', 'mainDish'],
            ['stirFryDishes', 'stirFryDish'],
            ['soupDishes', 'soupDish'],
            ['desserts', 'dessert']
        ].forEach(([collectionKey, legacyKey]) => getLunchItems(day.lunch, collectionKey, legacyKey).forEach(collectDishId));
    });

    const dishConditions = [];
    if (dishIds.size) dishConditions.push({ _id: { $in: [...dishIds] } });
    if (dishNames.size) dishConditions.push({ name: { $in: [...dishNames] } });
    const tenantFilter = req ? buildTenantFilter(req) : {};
    const dishes = dishConditions.length
        ? await Dish.find({ status: 'active', ...tenantFilter, $or: dishConditions }).select('name calories')
        : [];
    const dishesById = new Map(dishes.map((dish) => [String(dish._id), dish]));
    const dishesByName = new Map(dishes.map((dish) => [dish.name.trim().toLocaleLowerCase('vi-VN'), dish]));
    const hydrateItems = (items) => items.map((item) => {
        const nameKey = String(item.dishName || '').trim().toLocaleLowerCase('vi-VN');
        const dish = dishesById.get(String(item.dishId)) || dishesByName.get(nameKey);
        if (!dish) {
            throw new Error(`Món “${item.dishName || 'không xác định'}” không còn hoạt động trong danh mục. Hãy chọn món thay thế trước khi lưu.`);
        }
        return getDishReference(dish, item);
    });
    const summarizeMeal = (items, notes = '') => ({
        ...(items[0] || { dishName: '', calories: 0 }),
        items,
        calories: items.reduce((total, item) => total + item.calories, 0),
        notes
    });
    const summarizeLunchGroup = (items) => ({
        ...(items[0] || { dishName: '' }),
        items
    });

    return days
        .map((day) => {
            const breakfast = summarizeMeal(hydrateItems(getMealItems(day.breakfast)), day.breakfast?.notes);
            const morningSnack = summarizeMeal(hydrateItems(getMealItems(day.morningSnack)), day.morningSnack?.notes);
            const afternoonSnack = summarizeMeal(hydrateItems(getMealItems(day.afternoonSnack)), day.afternoonSnack?.notes);
            const mainDishes = hydrateItems(getLunchItems(day.lunch, 'mainDishes', 'mainDish'));
            const stirFryDishes = hydrateItems(getLunchItems(day.lunch, 'stirFryDishes', 'stirFryDish'));
            const soupDishes = hydrateItems(getLunchItems(day.lunch, 'soupDishes', 'soupDish'));
            const desserts = hydrateItems(getLunchItems(day.lunch, 'desserts', 'dessert'));
            const lunchCalories = [...mainDishes, ...stirFryDishes, ...soupDishes, ...desserts]
                .reduce((total, item) => total + item.calories, 0);

            return {
                dayOfWeek: day.dayOfWeek,
                date: startOfWorkDate(addWorkDays(startDate, MENU_DAY_OFFSETS[day.dayOfWeek])),
                breakfast,
                morningSnack,
                lunch: {
                    mainDish: summarizeLunchGroup(mainDishes),
                    stirFryDish: summarizeLunchGroup(stirFryDishes),
                    soupDish: summarizeLunchGroup(soupDishes),
                    dessert: summarizeLunchGroup(desserts),
                    mainDishes,
                    stirFryDishes,
                    soupDishes,
                    desserts,
                    calories: lunchCalories,
                    notes: day.lunch?.notes || ''
                },
                afternoonSnack,
                totalCalories: breakfast.calories + morningSnack.calories + lunchCalories + afternoonSnack.calories
            };
        })
        .sort((left, right) => MENU_DAY_OFFSETS[left.dayOfWeek] - MENU_DAY_OFFSETS[right.dayOfWeek]);
};

// ==========================================
// 1. QUẢN LÝ THỰC ĐƠN TUẦN THEO LỚP & DỊ ỨNG
// ==========================================

const getMenus = async (req, res) => {
    try {
        const { classroomId, weekNumber, schoolYear, status, startDate } = req.query;
        const query = { ...buildTenantFilter(req) };
        if (classroomId) assertValidObjectId(classroomId, 'ID lớp học');
        const readableClassroomIds = await getReadableClassroomIds(req.user);
        if (classroomId && readableClassroomIds && !readableClassroomIds.includes(String(classroomId))) {
            return res.status(403).json({ message: 'Bạn không có quyền xem thực đơn của lớp này' });
        }
        if (classroomId) query.classroomId = classroomId;
        else if (readableClassroomIds) query.classroomId = { $in: readableClassroomIds };
        if (weekNumber) query.weekNumber = Number(weekNumber);
        if (schoolYear) query.schoolYear = schoolYear;
        if (status && req.user.role !== 'parent') query.status = status;
        if (req.user.role === 'parent') query.status = 'published';
        if (startDate && isValidWorkDate(startDate)) {
            query.startDate = {
                $gte: startOfWorkDate(startDate),
                $lt: startOfWorkDate(addWorkDays(startDate, 1))
            };
        }

        const menus = await Menu.find(query).sort({ weekNumber: -1, classroomId: 1 });
        const data = req.user.role === 'parent' ? menus.map(serializeMenuForParent) : menus;
        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error('Lỗi getMenus:', err);
        res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể tải danh sách thực đơn' });
    }
};

const getMenuById = async (req, res) => {
    try {
        assertValidObjectId(req.params.id, 'ID thực đơn');
        const menu = await Menu.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!menu) return res.status(404).json({ message: 'Không tìm thấy thực đơn' });
        await assertReadableMenu(req.user, menu, req);
        res.json({ success: true, data: req.user.role === 'parent' ? serializeMenuForParent(menu) : menu });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Lỗi server khi lấy chi tiết thực đơn' });
    }
};

// Chỉ trả về các thông tin cần thiết cho bếp để chuẩn bị suất thay thế.
// Không dùng endpoint danh sách học sinh chung để tránh lộ thêm hồ sơ cá nhân.
const getClassroomDietaryAlerts = async (req, res) => {
    try {
        assertValidObjectId(req.params.id, 'ID lớp học');
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, req.params.id, req)) {
            return res.status(403).json({ message: 'Bạn không có quyền xem cảnh báo dinh dưỡng của lớp này' });
        }
        const classroom = await Classroom.findOne({ _id: req.params.id, ...buildTenantFilter(req) }).select('name');
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });

        const students = await Student.find({
            classroomId: classroom._id,
            ...buildTenantFilter(req),
            status: 'enrolled',
            $or: [
                { 'allergies.0': { $exists: true } },
                { 'disease.name': { $exists: true, $ne: '' } }
            ]
        }).select('fullName allergies disease');

        const alerts = students.map((student) => ({
            studentId: student._id,
            studentName: student.fullName,
            allergies: (student.allergies || []).map((allergy) => ({
                allergen: allergy.allergen,
                severity: allergy.severity,
                note: allergy.note || ''
            })),
            medicalReviewRequired: Boolean(student.disease?.name),
            medicalNote: student.disease?.name || ''
        }));
        const blockedAllergens = [...new Set(
            students.flatMap((student) => (student.allergies || [])
                .map((allergy) => normalizeAllergen(allergy.allergen))
                .filter((allergen) => ALLERGEN_CODES.includes(allergen)))
        )];

        res.json({ success: true, classroomName: classroom.name, count: alerts.length, blockedAllergens, data: alerts });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể tải cảnh báo dinh dưỡng của lớp' });
    }
};

const createMenu = async (req, res) => {
    try {
        const { classroomId, startDate, dietaryType, medicalNotes, allergensExcluded, days } = req.body;
        if (!classroomId || !startDate) {
            return res.status(400).json({ message: 'Vui lòng chọn lớp học và ngày Thứ Hai bắt đầu tuần thực đơn' });
        }
        if (!isValidWorkDate(startDate) || !isMonday(startDate)) {
            return res.status(400).json({ message: 'Ngày hiệu lực phải là Thứ Hai theo lịch của trường' });
        }

        assertValidObjectId(classroomId, 'ID lớp học');
        const classroom = await Classroom.findOne({ _id: classroomId, ...buildTenantFilter(req) });
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });

        const schoolYear = getSchoolYearForDate(startDate);
        const weekNumber = getIsoWeekNumber(startDate);
        const preparedDays = await prepareMenuDays(days, startDate, req);

        const existing = await Menu.findOne({ classroomId, schoolYear, weekNumber, ...buildTenantFilter(req) });
        if (existing) {
            return res.status(409).json({ message: `Lớp ${classroom.name} đã có thực đơn cho tuần ${weekNumber}` });
        }

        await assertClassroomMenuIsAllergenSafe(classroomId, preparedDays, req);

        const menu = await Menu.create({
            tenantId: req.tenantId || req.user?.tenantId,
            classroomId,
            className: classroom.name,
            schoolYear,
            weekNumber,
            startDate: startOfWorkDate(startDate),
            endDate: startOfWorkDate(addWorkDays(startDate, 4)),
            dietaryType: dietaryType || 'standard',
            medicalNotes: medicalNotes || '',
            allergensExcluded: [...new Set((allergensExcluded || []).map(normalizeAllergen).filter((allergen) => ALLERGEN_CODES.includes(allergen)))],
            days: preparedDays,
            allergyWarnings: [],
            status: 'draft',
            createdBy: req.user._id,
            createdByName: req.user.profile?.fullName || req.user.username,
            auditTrail: [{
                action: 'created',
                actorId: req.user._id,
                actorName: getActorName(req.user),
                toStatus: 'draft'
            }]
        });

        res.status(201).json({
            success: true,
            message: 'Đã tạo thực đơn tuần thành công',
            allergyWarningsFound: 0,
            data: menu
        });
    } catch (err) {
        if (!err.statusCode || err.statusCode >= 500) console.error('Lỗi createMenu:', err);
        res.status(err.statusCode || 500).json({
            message: err.message || 'Không thể tạo thực đơn',
            code: err.code,
            conflicts: err.conflicts
        });
    }
};

const updateMenu = async (req, res) => {
    try {
        const { days, dietaryType, medicalNotes, allergensExcluded, status } = req.body;
        assertValidObjectId(req.params.id, 'ID thực đơn');
        const menu = await Menu.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!menu) return res.status(404).json({ message: 'Không tìm thấy thực đơn' });
        if (menu.status === 'published') {
            return res.status(409).json({ message: 'Thực đơn đã công bố là bản ghi bất biến. Hãy tạo thực đơn mới hoặc lưu trữ thực đơn này.' });
        }
        if (menu.status !== 'draft') {
            return res.status(409).json({ message: 'Chỉ được chỉnh sửa thực đơn ở trạng thái bản nháp' });
        }
        if (status !== undefined) {
            return res.status(400).json({ message: 'Không được đổi trạng thái bằng API cập nhật. Hãy dùng quy trình gửi duyệt hoặc duyệt thực đơn.' });
        }

        if (days) {
            const startDate = getWorkDate(menu.startDate);
            const preparedDays = await prepareMenuDays(days, startDate, req);
            await assertClassroomMenuIsAllergenSafe(menu.classroomId, preparedDays, req);
            menu.days = preparedDays;
            menu.allergyWarnings = [];
        }
        if (dietaryType) menu.dietaryType = dietaryType;
        if (medicalNotes !== undefined) menu.medicalNotes = medicalNotes;
        if (allergensExcluded) {
            menu.allergensExcluded = [...new Set(allergensExcluded.map(normalizeAllergen).filter((allergen) => ALLERGEN_CODES.includes(allergen)))];
        }
        appendMenuAudit(menu, req.user, 'updated', 'draft', 'draft');

        await menu.save();

        res.json({
            success: true,
            message: 'Đã cập nhật thực đơn thành công',
            allergyWarningsFound: menu.allergyWarnings.length,
            data: menu
        });
    } catch (err) {
        console.error('Lỗi updateMenu:', err);
        const expectedDataError = err.statusCode === 422 || err.name === 'ValidationError'
            || /món.*không còn hoạt động|ngày phục vụ|thực đơn phải chọn/i.test(err.message || '');
        res.status(expectedDataError ? 422 : 500).json({
            message: expectedDataError ? err.message : 'Không thể cập nhật thực đơn',
            code: err.code,
            conflicts: err.conflicts
        });
    }
};

const getMenuForWorkflow = async (id, req = null) => {
    assertValidObjectId(id, 'ID thực đơn');
    const filter = { _id: id, ...(req ? buildTenantFilter(req) : {}) };
    const menu = await Menu.findOne(filter);
    if (!menu) {
        const error = new Error('Không tìm thấy thực đơn');
        error.statusCode = 404;
        throw error;
    }
    return menu;
};

const submitMenuForApproval = async (req, res) => {
    try {
        const menu = await getMenuForWorkflow(req.params.id, req);
        if (menu.status !== 'draft') return res.status(409).json({ message: 'Chỉ bản nháp mới có thể gửi duyệt' });
        const freshWarnings = await checkAllergyAndDiseaseConflicts(menu.classroomId, menu.days, req.tenantId || req.user?.tenantId);
        menu.allergyWarnings = freshWarnings;
        validatePublishReadiness(menu);
        menu.status = 'pending_approval';
        menu.approvalNote = '';
        appendMenuAudit(menu, req.user, 'submitted', 'draft', 'pending_approval', req.body?.note || '');
        await menu.save();
        res.json({ success: true, message: 'Đã gửi thực đơn chờ phê duyệt', data: menu });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể gửi duyệt thực đơn' });
    }
};

const approveMenu = async (req, res) => {
    try {
        const menu = await getMenuForWorkflow(req.params.id, req);
        if (menu.status !== 'pending_approval') return res.status(409).json({ message: 'Chỉ thực đơn đang chờ duyệt mới có thể được công bố' });
        if (req.user.role !== 'admin' && String(menu.createdBy) === String(req.user._id)) {
            return res.status(403).json({ message: 'Người lập thực đơn không thể tự phê duyệt thực đơn của mình' });
        }
        const freshWarnings = await checkAllergyAndDiseaseConflicts(menu.classroomId, menu.days, req.tenantId || req.user?.tenantId);
        menu.allergyWarnings = freshWarnings;
        validatePublishReadiness(menu);
        menu.status = 'published';
        menu.approvedBy = req.user._id;
        menu.approvedByName = getActorName(req.user);
        menu.approvalNote = String(req.body?.note || '').trim();
        appendMenuAudit(menu, req.user, 'approved', 'pending_approval', 'published', menu.approvalNote);
        await menu.save();
        res.json({ success: true, message: 'Đã phê duyệt và công bố thực đơn', data: menu });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể phê duyệt thực đơn' });
    }
};

const returnMenuForRevision = async (req, res) => {
    try {
        const reason = String(req.body?.reason || '').trim();
        if (!reason) return res.status(400).json({ message: 'Vui lòng nêu lý do trả thực đơn để chỉnh sửa' });
        const menu = await getMenuForWorkflow(req.params.id, req);
        if (menu.status !== 'pending_approval') return res.status(409).json({ message: 'Chỉ thực đơn đang chờ duyệt mới có thể trả lại' });
        menu.status = 'draft';
        menu.approvalNote = reason;
        appendMenuAudit(menu, req.user, 'returned', 'pending_approval', 'draft', reason);
        await menu.save();
        res.json({ success: true, message: 'Đã trả thực đơn về bản nháp để chỉnh sửa', data: menu });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể trả thực đơn' });
    }
};

const archiveMenu = async (req, res) => {
    try {
        const menu = await getMenuForWorkflow(req.params.id, req);
        if (menu.status === 'archived') return res.status(409).json({ message: 'Thực đơn này đã được lưu trữ' });
        const fromStatus = menu.status;
        menu.status = 'archived';
        appendMenuAudit(menu, req.user, 'archived', fromStatus, 'archived', req.body?.reason || '');
        await menu.save();
        res.json({ success: true, message: 'Đã lưu trữ thực đơn', data: menu });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Không thể lưu trữ thực đơn' });
    }
};

const cloneMenu = async (req, res) => {
    try {
        const { sourceMenuId, targetClassroomId, targetWeekNumber, targetSchoolYear, targetStartDate, targetEndDate } = req.body;
        if (!sourceMenuId || !targetClassroomId || !targetWeekNumber) {
            return res.status(400).json({ message: 'Thiếu thông tin sao chép thực đơn' });
        }

        const newMenu = await cloneWeeklyMenu(sourceMenuId, {
            targetClassroomId,
            targetSchoolYear,
            targetWeekNumber,
            targetStartDate,
            targetEndDate,
            userId: req.user._id,
            userName: req.user.profile?.fullName || req.user.username,
            tenantId: req.tenantId || req.user?.tenantId
        });

        res.status(201).json({
            success: true,
            message: 'Đã sao chép thực đơn thành công',
            allergyWarningsFound: newMenu.allergyWarnings.length,
            data: newMenu
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

const checkAllergiesDryRun = async (req, res) => {
    try {
        const { classroomId, days } = req.body;
        assertValidObjectId(classroomId, 'ID lớp học');
        const tenantFilter = buildTenantFilter(req);
        const classroomExists = await Classroom.exists({ _id: classroomId, ...tenantFilter });
        if (!classroomExists) {
            return res.status(404).json({ message: 'Không tìm thấy lớp học trong phạm vi trường hiện tại' });
        }
        if (req.user.role === 'teacher' && !await canAccessClassroom(req.user, classroomId, req)) {
            return res.status(403).json({ message: 'Bạn không có quyền kiểm tra dị ứng của lớp này' });
        }
        const warnings = await checkAllergyAndDiseaseConflicts(classroomId, days, req.tenantId || req.user?.tenantId || null);
        res.json({ success: true, count: warnings.length, warnings });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Không thể kiểm tra xung đột dị ứng' });
    }
};

// ==========================================
// 2. QUẢN LÝ MÓN ĂN & NGUYÊN LIỆU (FOOD)
// ==========================================

const getDishes = async (req, res) => {
    try {
        const { category, search } = req.query;
        if (search !== undefined && typeof search !== 'string') {
            return res.status(400).json({ message: 'Từ khóa tìm kiếm món ăn không hợp lệ' });
        }
        const query = { status: 'active', ...buildTenantFilter(req) };
        if (category && typeof category === 'string') query.category = category;
        if (typeof search === 'string' && search.trim()) {
            query.name = { $regex: escapeRegex(search.trim().slice(0, 120)), $options: 'i' };
        }

        const dishes = await Dish.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: dishes.length, data: dishes });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách món ăn' });
    }
};

const getDishById = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'ID món ăn không hợp lệ' });
        }
        const dish = await Dish.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });
        res.json({ success: true, data: dish });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};

const validateDishIngredients = async (items, req = null) => {
    if (!Array.isArray(items)) throw new Error('Danh sách nguyên liệu không hợp lệ');
    const ids = items.map((item) => String(item?.ingredientId || ''));
    if (ids.some((value) => !isValidObjectId(value)) || new Set(ids).size !== ids.length) {
        throw new Error('Nguyên liệu phải thuộc danh mục và không được lặp lại');
    }
    const masters = await IngredientMaster.find({ _id: { $in: ids }, status: 'active', ...(req ? buildTenantFilter(req) : {}) }).select('name unit').lean();
    const byId = new Map(masters.map((item) => [String(item._id), item]));
    return items.map((item, index) => {
        const master = byId.get(ids[index]);
        if (!master || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || item.unit !== master.unit) {
            throw new Error('Định lượng hoặc đơn vị nguyên liệu trên một suất không hợp lệ');
        }
        return { ingredientId: master._id, ingredientName: master.name, quantity: Number(item.quantity), unit: master.unit };
    });
};

const createDish = async (req, res) => {
    try {
        const allergens = [...new Set((req.body.allergens || []).map(normalizeAllergen))];
        const invalidAllergens = allergens.filter((allergen) => allergen && !ALLERGEN_CODES.includes(allergen));
        if (invalidAllergens.length) {
            return res.status(400).json({ message: `Dị nguyên không hợp lệ: ${invalidAllergens.join(', ')}` });
        }
        const ingredients = await validateDishIngredients(req.body.ingredients || [], req);
        const dish = await Dish.create({
            ...req.body,
            tenantId: req.tenantId || req.user?.tenantId,
            allergens: allergens.filter(Boolean),
            ingredients
        });
        res.status(201).json({ success: true, message: 'Đã thêm món ăn mới', data: dish });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo món ăn' });
    }
};

const updateDish = async (req, res) => {
    try {
        const allowedFields = ['name', 'category', 'ageGroup', 'calories', 'servingSizeGram', 'protein', 'fat', 'carbs', 'allergens', 'ingredients', 'recipe'];
        const updates = Object.fromEntries(
            allowedFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]])
        );
        if (updates.allergens) {
            const allergens = [...new Set(updates.allergens.map(normalizeAllergen).filter(Boolean))];
            const invalidAllergens = allergens.filter((allergen) => !ALLERGEN_CODES.includes(allergen));
            if (invalidAllergens.length) {
                return res.status(400).json({ message: `Dị nguyên không hợp lệ: ${invalidAllergens.join(', ')}` });
            }
            updates.allergens = allergens;
        }
        if (updates.ingredients !== undefined) updates.ingredients = await validateDishIngredients(updates.ingredients, req);
        const dish = await Dish.findOneAndUpdate(
            { _id: req.params.id, ...buildTenantFilter(req) },
            updates,
            { returnDocument: 'after', runValidators: true }
        );
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });
        res.json({ success: true, message: 'Cập nhật món ăn thành công', data: dish });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể cập nhật món ăn' });
    }
};

const deleteDish = async (req, res) => {
    try {
        const dish = await Dish.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

        const id = dish._id;
        const hasMenuUsage = await Menu.exists({
            ...buildTenantFilter(req),
            $or: [
                { 'days.breakfast.dishId': id }, { 'days.morningSnack.dishId': id }, { 'days.afternoonSnack.dishId': id },
                { 'days.breakfast.items.dishId': id }, { 'days.morningSnack.items.dishId': id }, { 'days.afternoonSnack.items.dishId': id },
                { 'days.lunch.mainDish.dishId': id }, { 'days.lunch.stirFryDish.dishId': id }, { 'days.lunch.soupDish.dishId': id }, { 'days.lunch.dessert.dishId': id },
                { 'days.lunch.mainDishes.dishId': id }, { 'days.lunch.stirFryDishes.dishId': id }, { 'days.lunch.soupDishes.dishId': id }, { 'days.lunch.desserts.dishId': id }
            ]
        });

        if (hasMenuUsage) {
            dish.status = 'inactive';
            await dish.save();
            return res.json({
                success: true,
                action: 'deactivated',
                message: 'Món đã được dùng trong thực đơn nên được ngừng sử dụng để giữ lịch sử và cảnh báo dị ứng.'
            });
        }

        await dish.deleteOne();
        res.json({ success: true, action: 'deleted', message: 'Đã xóa món ăn chưa được sử dụng.' });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể xóa món ăn' });
    }
};

const getIngredients = async (req, res) => {
    try {
        const { category } = req.query;
        const query = { status: 'active', ...buildTenantFilter(req) };
        if (category) query.category = category;
        const ingredients = await IngredientMaster.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: ingredients.length, data: ingredients });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nguyên liệu' });
    }
};

const createIngredientCode = async (name, req = null) => {
    const normalizedName = String(name || 'NGUYEN_LIEU')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/Đ/g, 'D')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'NGUYEN_LIEU';
    const prefix = `NL_${normalizedName}`;
    let code = prefix;
    let sequence = 2;
    const filter = req ? buildTenantFilter(req) : {};

    while (await IngredientMaster.exists({ code, ...filter })) {
        code = `${prefix}_${sequence}`;
        sequence += 1;
    }
    return code;
};

const createImportBatchNumber = (ingredientId) => {
    const datePart = getWorkDate(new Date()).replaceAll('-', '');
    return `LOT-${datePart}-${String(ingredientId).slice(-5).toUpperCase()}-${String(Date.now()).slice(-6)}`;
};

const VALID_INGREDIENT_CATEGORIES = new Set(['meat', 'seafood', 'vegetable', 'fruit', 'dry_grain', 'dairy', 'spice', 'other']);
const VALID_INGREDIENT_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'box', 'can', 'pack']);
const INGREDIENT_UNIT_ALIASES = {
    'kg': 'kg', 'gam': 'g', 'gram': 'g', 'g': 'g',
    'lit': 'l', 'lít': 'l', 'l': 'l', 'ml': 'ml',
    'cai': 'piece', 'cái': 'piece', 'qua': 'piece', 'quả': 'piece', 'piece': 'piece',
    'hop': 'box', 'hộp': 'box', 'box': 'box',
    'lon': 'can', 'can': 'can',
    'goi': 'pack', 'gói': 'pack', 'pack': 'pack'
};

const createIngredient = async (req, res) => {
    try {
        const { name, category, unit, minStockAlert, description } = req.body;
        const cleanName = String(name || '').trim();
        const cleanCategory = String(category || '').trim();
        const rawUnit = String(unit || '').trim().toLowerCase();
        const cleanUnit = INGREDIENT_UNIT_ALIASES[rawUnit] || rawUnit;

        if (!cleanName || !cleanCategory || !cleanUnit) {
            return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tên, nhóm và đơn vị tính của nguyên liệu' });
        }
        if (!VALID_INGREDIENT_CATEGORIES.has(cleanCategory)) {
            return res.status(422).json({ message: 'Nhóm nguyên liệu không hợp lệ (chọn: thịt, thủy hải sản, rau củ, trái cây, lương thực khô, sữa, gia vị, khác)' });
        }
        if (!VALID_INGREDIENT_UNITS.has(cleanUnit)) {
            return res.status(422).json({ message: 'Đơn vị tính không hợp lệ (chọn: kg, g, l, ml, cái/quả, hộp, lon, gói)' });
        }
        const parsedAlert = minStockAlert !== undefined && minStockAlert !== '' ? Number(minStockAlert) : 0;
        if (!Number.isFinite(parsedAlert) || parsedAlert < 0) {
            return res.status(422).json({ message: 'Ngưỡng cảnh báo tồn kho không được âm' });
        }

        const ingredient = await IngredientMaster.create({
            tenantId: req.tenantId || req.user?.tenantId,
            name: cleanName,
            code: req.body.code?.trim().toUpperCase() || await createIngredientCode(cleanName, req),
            category: cleanCategory,
            unit: cleanUnit,
            minStockAlert: parsedAlert,
            description: String(description || '').trim()
        });
        res.status(201).json({ success: true, message: 'Đã thêm nguyên liệu mới', data: ingredient });
    } catch (err) {
        if (err?.code === 11000) {
            return res.status(409).json({ message: 'Mã nguyên liệu này đã tồn tại trong kho' });
        }
        res.status(400).json({ message: 'Dữ liệu nguyên liệu không hợp lệ, vui lòng kiểm tra lại thông tin' });
    }
};

const updateIngredient = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'ID nguyên liệu không hợp lệ' });
        }
        const allowedFields = ['name', 'category', 'unit', 'minStockAlert', 'description'];
        const updates = Object.fromEntries(
            allowedFields
                .filter((field) => req.body[field] !== undefined)
                .map((field) => [field, field === 'minStockAlert' ? Number(req.body[field]) : req.body[field]])
        );

        if (updates.name !== undefined) {
            updates.name = String(updates.name).trim();
            if (!updates.name) return res.status(422).json({ message: 'Tên nguyên liệu không được để trống' });
        }
        if (updates.category !== undefined && !VALID_INGREDIENT_CATEGORIES.has(String(updates.category))) {
            return res.status(422).json({ message: 'Nhóm nguyên liệu không hợp lệ' });
        }
        if (updates.unit !== undefined) {
            const rawUnit = String(updates.unit).trim().toLowerCase();
            updates.unit = INGREDIENT_UNIT_ALIASES[rawUnit] || rawUnit;
            if (!VALID_INGREDIENT_UNITS.has(updates.unit)) {
                return res.status(422).json({ message: 'Đơn vị tính nguyên liệu không hợp lệ' });
            }
        }
        if (updates.minStockAlert !== undefined && (!Number.isFinite(updates.minStockAlert) || updates.minStockAlert < 0)) {
            return res.status(400).json({ message: 'Ngưỡng cảnh báo tồn không được âm' });
        }

        const ingredient = await IngredientMaster.findOneAndUpdate(
            { _id: req.params.id, ...buildTenantFilter(req) },
            updates,
            { returnDocument: 'after', runValidators: true }
        );
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });
        res.json({ success: true, message: 'Đã cập nhật nguyên liệu', data: ingredient });
    } catch (err) {
        if (err?.code === 11000) {
            return res.status(409).json({ message: 'Mã nguyên liệu bị trùng lặp' });
        }
        res.status(400).json({ message: 'Không thể cập nhật nguyên liệu, vui lòng kiểm tra lại dữ liệu' });
    }
};

const deleteIngredient = async (req, res) => {
    try {
        assertValidObjectId(req.params.id, 'ID nguyên liệu');
        const tenantFilter = buildTenantFilter(req);
        const ingredient = await IngredientMaster.findOne({ _id: req.params.id, ...tenantFilter });
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });

        const hasInventoryOrRecipeHistory = await Inventory.exists({ ingredientId: ingredient._id, ...tenantFilter })
            || await InventoryTransaction.exists({ ingredientId: ingredient._id, ...tenantFilter })
            || await Dish.exists({ 'ingredients.ingredientId': ingredient._id, ...tenantFilter });

        if (hasInventoryOrRecipeHistory) {
            ingredient.status = 'inactive';
            await ingredient.save();
            return res.json({
                success: true,
                action: 'deactivated',
                message: 'Nguyên liệu đang gắn với món ăn hoặc lịch sử kho nên được ngừng sử dụng để bảo toàn dữ liệu truy xuất.'
            });
        }

        await ingredient.deleteOne();
        res.json({ success: true, action: 'deleted', message: 'Đã xóa nguyên liệu chưa phát sinh dữ liệu kho.' });
    } catch (err) {
        res.status(err.statusCode || 400).json({ message: err.message || 'Không thể xóa nguyên liệu' });
    }
};

// ==========================================
// 3. QUẢN LÝ KHO THỰC PHẨM & XUẤT NHẬP
// ==========================================

const getInventoryList = async (req, res) => {
    try {
        const tenantFilter = buildTenantFilter(req);
        const todayStart = startOfWorkDate(getWorkDate(new Date()));
        const threeDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await Inventory.updateMany(
            { quantity: { $lte: 0 }, status: { $nin: ['disposed', 'depleted'] }, ...tenantFilter },
            { $set: { status: 'depleted' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $lt: todayStart }, status: { $nin: ['disposed', 'depleted'] }, ...tenantFilter },
            { $set: { status: 'expired' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $gte: todayStart, $lte: threeDaysLater }, status: 'available', ...tenantFilter },
            { $set: { status: 'near_expiry' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $gt: threeDaysLater }, status: 'near_expiry', ...tenantFilter },
            { $set: { status: 'available' } }
        );
        const inventories = await Inventory.find(tenantFilter)
            .populate('ingredientId', 'category minStockAlert standardPrice')
            .sort({ createdAt: -1, _id: -1 });
        res.json({ success: true, count: inventories.length, data: inventories });
    } catch (err) {
        res.status(500).json({ message: 'Không thể tải tồn kho' });
    }
};

const getTodayStart = () => startOfWorkDate(getWorkDate(new Date()));

const disposeInventoryLot = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!String(reason || '').trim()) return res.status(400).json({ message: 'Vui lòng ghi lý do xử lý hàng hết hạn/hư hỏng' });
        const lot = await Inventory.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!lot) return res.status(404).json({ message: 'Không tìm thấy lô hàng' });
        if (lot.quantity <= 0 || ['depleted', 'disposed'].includes(lot.status)) {
            return res.status(409).json({ message: 'Lô hàng này đã được xử lý hoặc không còn số lượng tồn' });
        }

        const disposedQuantity = lot.quantity;
        lot.quantity = 0;
        lot.status = 'disposed';
        await lot.save();
        await InventoryTransaction.create({
            tenantId: req.tenantId || req.user?.tenantId,
            type: 'spoilage',
            ingredientId: lot.ingredientId,
            ingredientName: lot.ingredientName,
            batchNumber: lot.batchNumber,
            quantity: -disposedQuantity,
            unit: lot.unit,
            costPerUnit: lot.costPerUnit || 0,
            totalAmount: -(disposedQuantity * (lot.costPerUnit || 0)),
            supplierId: lot.supplierId,
            supplierName: lot.supplierName,
            storageLocation: lot.storageLocation,
            reason: String(reason).trim(),
            performedBy: req.user._id,
            performedByName: req.user.profile?.fullName || req.user.username
        });
        res.json({ success: true, message: 'Đã lập biên bản xử lý lô hàng và trừ khỏi tồn kho.', data: lot });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể xử lý lô hàng' });
    }
};

const returnUnusedFood = async (req, res) => {
    try {
        const result = await returnUnusedInventory(req.params.id, req.body, req.user);
        res.json({ success: true, message: 'Đã cộng lại lượng nguyên liệu chưa sử dụng vào tồn kho.', data: result.inventory, transaction: result.transaction });
    } catch (err) {
        res.status(err.statusCode || 400).json({ message: err.message || 'Không thể hoàn trả nguyên liệu' });
    }
};

const reconcileInventoryLot = async (req, res) => {
    try {
        const actualQuantity = Number(req.body.actualQuantity);
        if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
            return res.status(400).json({ message: 'Số lượng kiểm kê thực tế phải là số không âm' });
        }
        const lot = await Inventory.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!lot) return res.status(404).json({ message: 'Không tìm thấy lô hàng' });
        if (lot.status === 'disposed') return res.status(422).json({ message: 'Lô hàng đã xử lý hủy, không thể kiểm kê lại' });
        if (actualQuantity > 0 && lot.expiryDate < getTodayStart()) {
            return res.status(422).json({ message: 'Lô hàng đã hết hạn không được ghi nhận tồn khả dụng; hãy xử lý hủy.' });
        }

        const systemQuantity = lot.quantity;
        const difference = actualQuantity - systemQuantity;
        lot.quantity = actualQuantity;
        lot.status = actualQuantity === 0 ? 'depleted' : 'available';
        await lot.save();
        const reconciliation = await InventoryReconciliation.create({
            tenantId: req.tenantId || req.user?.tenantId,
            inventoryId: lot._id,
            ingredientId: lot.ingredientId,
            ingredientName: lot.ingredientName,
            batchNumber: lot.batchNumber,
            systemQuantity,
            actualQuantity,
            difference,
            unit: lot.unit,
            notes: String(req.body.notes || '').trim(),
            countedBy: req.user._id,
            countedByName: req.user.profile?.fullName || req.user.username
        });
        if (difference !== 0) {
            await InventoryTransaction.create({
                tenantId: req.tenantId || req.user?.tenantId,
                type: 'adjustment', ingredientId: lot.ingredientId, ingredientName: lot.ingredientName,
                batchNumber: lot.batchNumber, quantity: difference, unit: lot.unit,
                costPerUnit: lot.costPerUnit || 0, totalAmount: difference * (lot.costPerUnit || 0),
                reason: `Kiểm kê: ${String(req.body.notes || 'Điều chỉnh theo số thực tế').trim()}`,
                performedBy: req.user._id, performedByName: req.user.profile?.fullName || req.user.username
            });
        }
        res.json({ success: true, message: 'Đã ghi nhận kiểm kê và điều chỉnh tồn kho.', data: reconciliation });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể kiểm kê lô hàng' });
    }
};

const getInventoryReconciliations = async (req, res) => {
    try {
        const records = await InventoryReconciliation.find(buildTenantFilter(req)).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, count: records.length, data: records });
    } catch (err) {
        res.status(500).json({ message: 'Không thể tải lịch sử kiểm kê' });
    }
};

const importStock = async (req, res) => {
    try {
        const result = await importInventory(req.body, req.user, createImportBatchNumber);
        res.status(201).json({ success: true, message: 'Đã nhập kho thành công', data: result.inventory, transaction: result.transaction });
    } catch (err) {
        res.status(err.statusCode || 400).json({ message: err.message || 'Lỗi nhập kho' });
    }
};

const exportStock = async (req, res) => {
    try {
        const transaction = await exportInventoryFEFO(req.body, req.user);

        res.json({
            success: true,
            message: `Đã xuất kho ${transaction.quantity} ${transaction.unit} ${transaction.ingredientName}`,
            data: transaction
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Lỗi xuất kho' });
    }
};

const getInventoryAlertsController = async (req, res) => {
    try {
        const alerts = await fetchInventoryAlerts(req.tenantId || req.user?.tenantId);
        res.json({ success: true, data: alerts });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi tải cảnh báo tồn kho' });
    }
};

const getTransactions = async (req, res) => {
    try {
        const { type, startDate, endDate } = req.query;
        const query = { ...buildTenantFilter(req) };
        if (type) query.type = type;
        if (startDate || endDate) {
            const rangeStart = startDate || endDate;
            const rangeEnd = endDate || startDate;
            if (!isValidWorkDate(rangeStart) || !isValidWorkDate(rangeEnd) || rangeStart > rangeEnd) {
                return res.status(400).json({ message: 'Khoảng ngày tra cứu không hợp lệ' });
            }
            query.createdAt = {
                $gte: startOfWorkDate(rangeStart),
                $lt: startOfWorkDate(addWorkDays(rangeEnd, 1))
            };
        }
        const transactions = await InventoryTransaction.find(query).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, count: transactions.length, data: transactions, range: { startDate: startDate || null, endDate: endDate || null } });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy lịch sử kho' });
    }
};

// ==========================================
// 4. NHÀ CUNG CẤP (SUPPLIERS)
// ==========================================

const getSuppliers = async (req, res) => {
    try {
        const suppliers = await Supplier.find(buildTenantFilter(req)).sort({ name: 1 });
        res.json({ success: true, count: suppliers.length, data: suppliers });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nhà cung cấp' });
    }
};

const createSupplier = async (req, res) => {
    try {
        const { tenantId: _ignoredTenant, _id: _ignoredId, ...safeBody } = req.body || {};
        const supplier = await Supplier.create({
            ...safeBody,
            tenantId: req.tenantId || req.user?.tenantId
        });
        res.status(201).json({ success: true, message: 'Đã thêm nhà cung cấp mới', data: supplier });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo nhà cung cấp' });
    }
};

const updateSupplier = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhà cung cấp không hợp lệ' });
        const { tenantId: _ignoredTenant, _id: _ignoredId, ...safeBody } = req.body || {};
        const supplier = await Supplier.findOneAndUpdate(
            { _id: req.params.id, ...buildTenantFilter(req) },
            { $set: safeBody },
            { new: true, runValidators: true }
        );
        if (!supplier) return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp' });
        res.json({ success: true, message: 'Cập nhật nhà cung cấp thành công', data: supplier });
    } catch (err) {
        res.status(400).json({ message: 'Không thể cập nhật nhà cung cấp' });
    }
};

// ==========================================
// 5. THIẾT BỊ CHUNG NHÀ BẾP (EQUIPMENT)
// ==========================================

const getEquipments = async (req, res) => {
    try {
        const equipments = await KitchenEquipment.find(buildTenantFilter(req)).sort({ condition: 1, name: 1 });
        res.json({ success: true, count: equipments.length, data: equipments });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách thiết bị bếp' });
    }
};

const createEquipment = async (req, res) => {
    try {
        const eq = await KitchenEquipment.create({
            ...req.body,
            tenantId: req.tenantId || req.user?.tenantId
        });
        res.status(201).json({ success: true, message: 'Đã thêm thiết bị nhà bếp mới', data: eq });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo thiết bị bếp' });
    }
};

const logEquipmentMaintenance = async (req, res) => {
    try {
        const { description, cost, technician, notes, newCondition } = req.body;
        const eq = await KitchenEquipment.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!eq) return res.status(404).json({ message: 'Không tìm thấy thiết bị' });

        eq.maintenanceLogs.push({
            maintenanceDate: new Date(),
            description,
            cost: Number(cost || 0),
            technician: technician || '',
            notes: notes || ''
        });

        if (newCondition) eq.condition = newCondition;
        await eq.save();

        res.json({ success: true, message: 'Đã ghi nhận bảo dưỡng thiết bị', data: eq });
    } catch (err) {
        res.status(400).json({ message: 'Lỗi ghi nhận bảo dưỡng thiết bị' });
    }
};

// ==========================================
// 6. NHÂN VIÊN NHÀ BẾP & VSATTP (STAFF)
// ==========================================

const getKitchenStaffList = async (req, res) => {
    try {
        const staffList = await KitchenStaff.find(buildTenantFilter(req)).sort({ position: 1, fullName: 1 });
        res.json({ success: true, count: staffList.length, data: staffList });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nhân viên bếp' });
    }
};

const createKitchenStaff = async (req, res) => {
    try {
        const { tenantId: _ignoredTenant, _id: _ignoredId, ...safeBody } = req.body || {};
        const staff = await KitchenStaff.create({
            ...safeBody,
            tenantId: req.tenantId || req.user?.tenantId
        });
        res.status(201).json({ success: true, message: 'Đã thêm nhân viên bếp mới', data: staff });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo nhân viên bếp' });
    }
};

const updateKitchenStaff = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID nhân viên bếp không hợp lệ' });
        const { tenantId: _ignoredTenant, _id: _ignoredId, ...safeBody } = req.body || {};
        const staff = await KitchenStaff.findOneAndUpdate(
            { _id: req.params.id, ...buildTenantFilter(req) },
            { $set: safeBody },
            { new: true, runValidators: true }
        );
        if (!staff) return res.status(404).json({ message: 'Không tìm thấy nhân viên bếp' });
        res.json({ success: true, message: 'Cập nhật nhân viên bếp thành công', data: staff });
    } catch (err) {
        res.status(400).json({ message: 'Không thể cập nhật nhân viên bếp' });
    }
};

// ==========================================
// 7. LƯU MẪU THỨC ĂN 24H & KIỂM THỰC 3 BƯỚC
// ==========================================

const getFoodSamples = async (req, res) => {
    try {
        const samples = await FoodSample.find(buildTenantFilter(req)).sort({ mealDate: -1, createdAt: -1 }).limit(100);
        res.json({ success: true, count: samples.length, data: samples });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy sổ lưu mẫu thức ăn' });
    }
};

const createFoodSample = async (req, res) => {
    try {
        const { sampleCode, mealDate, mealType, dishName, dishCategory, sampleWeightGram, sampleUnit = 'g', storageTemperature, storageFridge, sensoryEvaluation, notes } = req.body || {};
        if (typeof sampleCode !== 'string' || typeof dishName !== 'string' || !sampleCode.trim() || !dishName.trim() || !mealDate || !mealType) {
            return res.status(400).json({ message: 'Thiếu thông tin lưu mẫu thức ăn' });
        }
        if (typeof storageFridge !== 'string' || !storageFridge.trim() || storageFridge.trim().length > 100) {
            return res.status(400).json({ message: 'Cần nhập đúng tên tủ thực tế đang lưu mẫu' });
        }
        if (!isValidWorkDate(mealDate) || mealDate !== getWorkDate() || !['breakfast', 'morningSnack', 'lunch', 'afternoonSnack'].includes(mealType)) {
            return res.status(400).json({ message: 'Chỉ ghi mẫu cho bữa ăn trong ngày hiện tại' });
        }
        const amount = Number(sampleWeightGram);
        const temperature = Number(storageTemperature);
        if (!['g', 'ml'].includes(sampleUnit) || !Number.isFinite(amount) || amount < (sampleUnit === 'ml' ? 150 : 100)
            || !Number.isFinite(temperature) || temperature < 2 || temperature > 8) {
            return res.status(400).json({ message: 'Mẫu đặc tối thiểu 100 g, mẫu lỏng tối thiểu 150 ml; nhiệt độ bảo quản 2–8°C' });
        }
        const dishes = await expectedDishes(mealDate, req);
        if (!dishes.expected[mealType].some((name) => name.toLocaleLowerCase('vi') === dishName.trim().toLocaleLowerCase('vi'))) {
            return res.status(409).json({ message: 'Món này không còn trong thực đơn đã công bố của bữa ăn. Hãy tải lại trang bếp.' });
        }
        const existing = await FoodSample.exists({ mealDate: { $gte: startOfWorkDate(mealDate), $lt: startOfWorkDate(addWorkDays(mealDate, 1)) }, mealType, dishName: String(dishName).trim(), ...buildTenantFilter(req) });
        if (existing) return res.status(409).json({ message: 'Món này đã có mẫu lưu trong bữa hôm nay' });

        const sample = await FoodSample.create({
            tenantId: req.tenantId || req.user?.tenantId,
            sampleCode: String(sampleCode).trim().toUpperCase(),
            mealDate: new Date(mealDate),
            mealType,
            dishName: dishName.trim(),
            dishCategory: dishCategory || 'Món chính',
            sampleWeightGram: amount,
            sampleUnit,
            storageTemperature: temperature,
            storageFridge: storageFridge.trim(),
            storedBy: req.user._id,
            storedByName: req.user.profile?.fullName || req.user.username,
            sensoryEvaluation: sensoryEvaluation || { color: 'Chưa ghi nhận', smell: 'Chưa ghi nhận', taste: 'Chưa ghi nhận' },
            notes: notes || ''
        });

        res.status(201).json({ success: true, message: `Đã lưu mẫu ${dishName} an toàn 24h`, data: sample });
    } catch (err) {
        res.status(err.code === 11000 ? 409 : 500).json({ message: err.code === 11000 ? 'Mã mẫu vừa được sử dụng. Hãy tải lại trang rồi lưu mẫu.' : 'Không thể lưu mẫu lúc này. Vui lòng thử lại.' });
    }
};

const disposeFoodSample = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'ID mẫu lưu không hợp lệ' });
        const { status = 'disposed_normal', notes } = req.body || {};
        const sample = await FoodSample.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!sample) return res.status(404).json({ message: 'Không tìm thấy mẫu lưu' });

        if (!['stored', 'investigating'].includes(sample.status)) {
            return res.status(409).json({ message: 'Mẫu này không còn ở trạng thái đang lưu hoặc đang niêm phong kiểm tra' });
        }
        if (!['disposed_normal', 'sent_to_lab', 'investigating'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái xử lý mẫu không hợp lệ' });
        }
        // Quy định VSATTP Mầm non: Hủy mẫu thường bắt buộc đủ >= 24h; nhưng khi nghi ngờ sự cố ATTP được niêm phong gửi xét nghiệm ngay
        if (status === 'disposed_normal' && Date.now() - new Date(sample.storedAt).getTime() < 24 * 60 * 60 * 1000) {
            return res.status(409).json({ message: 'Chỉ được hủy mẫu bình thường sau ít nhất 24 giờ kể từ lúc lưu' });
        }
        sample.status = status;
        if (status === 'disposed_normal' || status === 'sent_to_lab') {
            sample.disposedAt = new Date();
            sample.disposedBy = req.user._id;
            sample.disposedByName = req.user.profile?.fullName || req.user.username;
        }
        if (notes) sample.notes = (sample.notes ? sample.notes + ' | ' : '') + String(notes).trim();

        await sample.save();
        const statusMsg = status === 'sent_to_lab'
            ? 'Đã ghi nhận bàn giao mẫu đi kiểm nghiệm VSATTP'
            : status === 'investigating'
                ? 'Đã niêm phong mẫu lưu để phục vụ kiểm tra sự cố'
                : 'Đã xử lý hủy mẫu lưu an toàn sau 24h';
        res.json({ success: true, message: statusMsg, data: sample });
    } catch (err) {
        res.status(400).json({ message: 'Không thể cập nhật trạng thái mẫu thức ăn' });
    }
};

const getFoodInspections = async (req, res) => {
    try {
        const inspections = await FoodInspection.find(buildTenantFilter(req)).sort({ mealDate: -1, createdAt: -1 }).limit(50);
        res.json({ success: true, count: inspections.length, data: inspections });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy sổ kiểm thực 3 bước' });
    }
};

const createFoodInspection = async (req, res) => {
    res.status(410).json({ message: 'Vui lòng ghi kiểm thực lần lượt từng bước trên trang Bếp hôm nay' });
};

// ==========================================
// 8. TÀI CHÍNH NHÀ ĂN & ĐỀ XUẤT MUA SẮM (FINANCE)
// ==========================================

const getDailyFinancialReport = async (req, res) => {
    try {
        const { date } = req.query;
        const report = await calculateDailyMealReport(date, req.tenantId || req.user?.tenantId);
        res.json({ success: true, data: report });
    } catch (err) {
        console.error('Lỗi tính toán báo cáo tài chính nhà ăn:', err);
        res.status(500).json({ message: 'Không thể tạo báo cáo tài chính suất ăn' });
    }
};

const getDailyServingPlan = async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString();
        const classroomIds = req.user.role === 'teacher'
            ? await getTeacherClassroomIds(req.user)
            : null;
        const report = await calculateDailyServingPlan(date, classroomIds, req.tenantId || req.user?.tenantId);
        res.json({ success: true, data: report });
    } catch (err) {
        console.error('Lỗi getDailyServingPlan:', err);
        res.status(500).json({ success: false, message: 'Không thể lập kế hoạch suất ăn theo lớp' });
    }
};

const getKitchenRequests = async (req, res) => {
    try {
        const { status } = req.query;
        const query = { ...buildTenantFilter(req) };
        if (status) query.status = status;
        const requests = await KitchenRequest.find(query).sort({ createdAt: -1 });
        res.json({ success: true, count: requests.length, data: requests });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách đề xuất nhà bếp' });
    }
};

const createKitchenRequest = async (req, res) => {
    try {
        const { requestCode, requestType, title, items, priority, neededByDate } = req.body;
        if (!requestCode || !title || !items || !items.length) {
            return res.status(400).json({ message: 'Thiếu thông tin đề xuất mua sắm' });
        }

        const totalEstimatedCost = items.reduce((sum, it) => sum + (Number(it.estimatedCost) || 0), 0);

        const request = await KitchenRequest.create({
            tenantId: req.tenantId || req.user?.tenantId,
            requestCode: String(requestCode).trim().toUpperCase(),
            requestType: requestType || 'ingredient_purchase',
            title,
            requestedBy: req.user._id,
            requestedByName: req.user.profile?.fullName || req.user.username,
            items,
            totalEstimatedCost,
            priority: priority || 'medium',
            neededByDate: neededByDate ? new Date(neededByDate) : null,
            status: 'pending'
        });

        res.status(201).json({ success: true, message: 'Đã gửi đề xuất mua sắm cho nhà bếp', data: request });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Lỗi gửi đề xuất' });
    }
};

const approveKitchenRequest = async (req, res) => {
    try {
        assertValidObjectId(req.params.id, 'ID phiếu đề xuất');
        const { status, approvalNotes } = req.body || {};
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái chỉ có thể là approved hoặc rejected' });
        }

        const request = await KitchenRequest.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!request) return res.status(404).json({ message: 'Không tìm thấy phiếu đề xuất' });
        if (request.status !== 'pending') {
            return res.status(409).json({ message: 'Phiếu đề xuất này đã được xử lý trước đó' });
        }

        request.status = status;
        request.approvedBy = req.user._id;
        request.approvedByName = req.user.profile?.fullName || req.user.username;
        request.approvalNotes = String(approvalNotes || '').trim().slice(0, 500);
        await request.save();

        res.json({ success: true, message: `Đã ${status === 'approved' ? 'duyệt' : 'từ chối'} đề xuất`, data: request });
    } catch (err) {
        res.status(err.statusCode || 400).json({ message: err.statusCode ? err.message : 'Lỗi duyệt phiếu đề xuất' });
    }
};

const getKitchenClassrooms = async (req, res) => {
    try {
        const tenantFilter = buildTenantFilter(req);
        const filter = { status: 'active', ...tenantFilter };
        if (typeof req.query.schoolYear === 'string' && req.query.schoolYear.trim()) {
            filter.schoolYear = req.query.schoolYear.trim();
        }
        const classrooms = await Classroom.find(filter)
            .select('_id name ageGroup schoolYear status')
            .sort({ schoolYear: -1, name: 1 })
            .lean();
        return res.json({ success: true, data: classrooms, count: classrooms.length });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Lỗi lấy danh sách lớp cho nhà bếp' });
    }
};

module.exports = {
    // Menu
    getMenus,
    getMenuById,
    getClassroomDietaryAlerts,
    getKitchenClassrooms,
    createMenu,
    updateMenu,
    submitMenuForApproval,
    approveMenu,
    returnMenuForRevision,
    archiveMenu,
    cloneMenu,
    checkAllergiesDryRun,
    // Dishes & Ingredients
    getDishes,
    getDishById,
    createDish,
    updateDish,
    deleteDish,
    getIngredients,
    createIngredient,
    updateIngredient,
    deleteIngredient,
    // Inventory
    getInventoryList,
    importStock,
    exportStock,
    disposeInventoryLot,
    returnUnusedFood,
    reconcileInventoryLot,
    getInventoryReconciliations,
    getInventoryAlertsController,
    getTransactions,
    // Suppliers
    getSuppliers,
    createSupplier,
    updateSupplier,
    // Equipment
    getEquipments,
    createEquipment,
    logEquipmentMaintenance,
    // Staff
    getKitchenStaffList,
    createKitchenStaff,
    updateKitchenStaff,
    // Safety & Samples
    getFoodSamples,
    createFoodSample,
    disposeFoodSample,
    getFoodInspections,
    createFoodInspection,
    // Finance & Requests
    getDailyFinancialReport,
    getDailyServingPlan,
    getKitchenRequests,
    createKitchenRequest,
    approveKitchenRequest
};
