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
const KitchenRequest = require('../models/zone5_nutrition/KitchenRequest');
const Classroom = require('../models/zone3_school/Classroom');
const Student = require('../models/zone3_school/Student');
const {
    ALLERGEN_CODES,
    checkAllergyAndDiseaseConflicts,
    calculateDailyMealReport,
    cloneWeeklyMenu,
    getInventoryAlerts: fetchInventoryAlerts,
    normalizeAllergen
} = require('../services/nutritionService');
const { addWorkDays, getWorkDate, isValidWorkDate, startOfWorkDate } = require('../utils/dateHelpers');

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

/**
 * Server-side source of truth for a menu: the client only selects dish IDs.
 * Names, calories and service dates are derived here so a stale browser cannot
 * create a menu that no longer matches the dish catalogue.
 */
const prepareMenuDays = async (days, startDate) => {
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
    const dishes = dishConditions.length
        ? await Dish.find({ status: 'active', $or: dishConditions }).select('name calories')
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
        const query = {};
        if (classroomId) query.classroomId = classroomId;
        if (weekNumber) query.weekNumber = Number(weekNumber);
        if (schoolYear) query.schoolYear = schoolYear;
        if (status) query.status = status;
        if (startDate && isValidWorkDate(startDate)) {
            query.startDate = {
                $gte: startOfWorkDate(startDate),
                $lt: startOfWorkDate(addWorkDays(startDate, 1))
            };
        }

        const menus = await Menu.find(query).sort({ weekNumber: -1, classroomId: 1 });
        res.json({ success: true, count: menus.length, data: menus });
    } catch (err) {
        console.error('Lỗi getMenus:', err);
        res.status(500).json({ message: 'Không thể tải danh sách thực đơn' });
    }
};

const getMenuById = async (req, res) => {
    try {
        const menu = await Menu.findById(req.params.id);
        if (!menu) return res.status(404).json({ message: 'Không tìm thấy thực đơn' });
        res.json({ success: true, data: menu });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server khi lấy chi tiết thực đơn' });
    }
};

// Chỉ trả về các thông tin cần thiết cho bếp để chuẩn bị suất thay thế.
// Không dùng endpoint danh sách học sinh chung để tránh lộ thêm hồ sơ cá nhân.
const getClassroomDietaryAlerts = async (req, res) => {
    try {
        const classroom = await Classroom.findById(req.params.id).select('name');
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });

        const students = await Student.find({
            classroomId: classroom._id,
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

        res.json({ success: true, classroomName: classroom.name, count: alerts.length, data: alerts });
    } catch (err) {
        res.status(500).json({ message: 'Không thể tải cảnh báo dinh dưỡng của lớp' });
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

        const classroom = await Classroom.findById(classroomId);
        if (!classroom) return res.status(404).json({ message: 'Không tìm thấy lớp học' });

        const schoolYear = getSchoolYearForDate(startDate);
        const weekNumber = getIsoWeekNumber(startDate);
        const preparedDays = await prepareMenuDays(days, startDate);

        const existing = await Menu.findOne({ classroomId, schoolYear, weekNumber });
        if (existing) {
            return res.status(409).json({ message: `Lớp ${classroom.name} đã có thực đơn cho tuần ${weekNumber}` });
        }

        // Tự động kiểm tra cảnh báo dị ứng & bệnh lý của học sinh trong lớp
        const allergyWarnings = await checkAllergyAndDiseaseConflicts(classroomId, preparedDays);

        const menu = await Menu.create({
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
            allergyWarnings,
            status: 'draft',
            createdBy: req.user._id,
            createdByName: req.user.profile?.fullName || req.user.username
        });

        res.status(201).json({
            success: true,
            message: 'Đã tạo thực đơn tuần thành công',
            allergyWarningsFound: allergyWarnings.length,
            data: menu
        });
    } catch (err) {
        console.error('Lỗi createMenu:', err);
        res.status(500).json({ message: err.message || 'Không thể tạo thực đơn' });
    }
};

const updateMenu = async (req, res) => {
    try {
        const { days, dietaryType, medicalNotes, allergensExcluded, status } = req.body;
        const menu = await Menu.findById(req.params.id);
        if (!menu) return res.status(404).json({ message: 'Không tìm thấy thực đơn' });

        if (days) {
            const startDate = getWorkDate(menu.startDate);
            menu.days = await prepareMenuDays(days, startDate);
            // Tự động quét lại dị ứng/bệnh lý khi thay đổi món
            menu.allergyWarnings = await checkAllergyAndDiseaseConflicts(menu.classroomId, menu.days);
        }
        if (dietaryType) menu.dietaryType = dietaryType;
        if (medicalNotes !== undefined) menu.medicalNotes = medicalNotes;
        if (allergensExcluded) {
            menu.allergensExcluded = [...new Set(allergensExcluded.map(normalizeAllergen).filter((allergen) => ALLERGEN_CODES.includes(allergen)))];
        }
        if (status === 'published') {
            const requiredDays = Object.keys(MENU_DAY_OFFSETS);
            const hasCompletePlan = requiredDays.every((dayName) => {
                const day = menu.days.find((entry) => entry.dayOfWeek === dayName);
                return getMealItems(day?.breakfast).length && getMealItems(day?.morningSnack).length
                    && getLunchItems(day?.lunch, 'mainDishes', 'mainDish').length
                    && getLunchItems(day?.lunch, 'soupDishes', 'soupDish').length
                    && getMealItems(day?.afternoonSnack).length;
            });
            if (!hasCompletePlan) {
                return res.status(422).json({ message: 'Chỉ được công bố khi đã hoàn thiện đủ bữa phục vụ từ Thứ Hai đến Thứ Sáu' });
            }
            if (menu.allergyWarnings.some((warning) => !warning.resolved)) {
                return res.status(422).json({ message: 'Không thể công bố thực đơn khi còn cảnh báo dị ứng chưa được xử lý' });
            }
        }
        if (status) menu.status = status;

        await menu.save();

        res.json({
            success: true,
            message: 'Đã cập nhật thực đơn thành công',
            allergyWarningsFound: menu.allergyWarnings.length,
            data: menu
        });
    } catch (err) {
        console.error('Lỗi updateMenu:', err);
        const expectedDataError = err.name === 'ValidationError'
            || /món.*không còn hoạt động|ngày phục vụ|thực đơn phải chọn/i.test(err.message || '');
        res.status(expectedDataError ? 422 : 500).json({
            message: expectedDataError ? err.message : 'Không thể cập nhật thực đơn'
        });
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
            userName: req.user.profile?.fullName || req.user.username
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
        const warnings = await checkAllergyAndDiseaseConflicts(classroomId, days);
        res.json({ success: true, count: warnings.length, warnings });
    } catch (err) {
        res.status(500).json({ message: 'Không thể kiểm tra xung đột dị ứng' });
    }
};

// ==========================================
// 2. QUẢN LÝ MÓN ĂN & NGUYÊN LIỆU (FOOD)
// ==========================================

const getDishes = async (req, res) => {
    try {
        const { category, search } = req.query;
        const query = { status: 'active' };
        if (category) query.category = category;
        if (search) query.name = { $regex: search, $options: 'i' };

        const dishes = await Dish.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: dishes.length, data: dishes });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách món ăn' });
    }
};

const createDish = async (req, res) => {
    try {
        const allergens = [...new Set((req.body.allergens || []).map(normalizeAllergen))];
        const invalidAllergens = allergens.filter((allergen) => allergen && !ALLERGEN_CODES.includes(allergen));
        if (invalidAllergens.length) {
            return res.status(400).json({ message: `Dị nguyên không hợp lệ: ${invalidAllergens.join(', ')}` });
        }
        const dish = await Dish.create({ ...req.body, allergens: allergens.filter(Boolean) });
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
        const dish = await Dish.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after', runValidators: true });
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });
        res.json({ success: true, message: 'Cập nhật món ăn thành công', data: dish });
    } catch (err) {
        res.status(400).json({ message: 'Không thể cập nhật món ăn' });
    }
};

const deleteDish = async (req, res) => {
    try {
        const dish = await Dish.findById(req.params.id);
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });

        const id = dish._id;
        const hasMenuUsage = await Menu.exists({
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
        const query = { status: 'active' };
        if (category) query.category = category;
        const ingredients = await IngredientMaster.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: ingredients.length, data: ingredients });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nguyên liệu' });
    }
};

const createIngredientCode = async (name) => {
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

    while (await IngredientMaster.exists({ code })) {
        code = `${prefix}_${sequence}`;
        sequence += 1;
    }
    return code;
};

const createImportBatchNumber = (ingredientId) => {
    const datePart = getWorkDate(new Date()).replaceAll('-', '');
    return `LOT-${datePart}-${String(ingredientId).slice(-5).toUpperCase()}-${String(Date.now()).slice(-6)}`;
};

const createIngredient = async (req, res) => {
    try {
        const { name, category, unit, minStockAlert, description } = req.body;
        if (!name || !category || !unit) {
            return res.status(400).json({ message: 'Vui lòng nhập tên, nhóm và đơn vị nguyên liệu' });
        }
        const ingredient = await IngredientMaster.create({
            name,
            code: req.body.code?.trim().toUpperCase() || await createIngredientCode(name),
            category,
            unit,
            minStockAlert: Number(minStockAlert) || 0,
            description: description || ''
        });
        res.status(201).json({ success: true, message: 'Đã thêm nguyên liệu mới', data: ingredient });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo nguyên liệu' });
    }
};

const updateIngredient = async (req, res) => {
    try {
        const allowedFields = ['name', 'category', 'unit', 'minStockAlert', 'description'];
        const updates = Object.fromEntries(
            allowedFields
                .filter((field) => req.body[field] !== undefined)
                .map((field) => [field, field === 'minStockAlert' ? Number(req.body[field]) : req.body[field]])
        );

        if (updates.minStockAlert !== undefined && (!Number.isFinite(updates.minStockAlert) || updates.minStockAlert < 0)) {
            return res.status(400).json({ message: 'Ngưỡng cảnh báo tồn không được âm' });
        }

        const ingredient = await IngredientMaster.findByIdAndUpdate(
            req.params.id,
            updates,
            { returnDocument: 'after', runValidators: true }
        );
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });
        res.json({ success: true, message: 'Đã cập nhật nguyên liệu', data: ingredient });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể cập nhật nguyên liệu' });
    }
};

const deleteIngredient = async (req, res) => {
    try {
        const ingredient = await IngredientMaster.findById(req.params.id);
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });

        const hasInventoryHistory = await Inventory.exists({ ingredientId: ingredient._id })
            || await InventoryTransaction.exists({ ingredientId: ingredient._id });

        if (hasInventoryHistory) {
            ingredient.status = 'inactive';
            await ingredient.save();
            return res.json({
                success: true,
                action: 'deactivated',
                message: 'Nguyên liệu đã phát sinh lịch sử kho nên được ngừng sử dụng để bảo toàn dữ liệu truy xuất.'
            });
        }

        await ingredient.deleteOne();
        res.json({ success: true, action: 'deleted', message: 'Đã xóa nguyên liệu chưa phát sinh dữ liệu kho.' });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể xóa nguyên liệu' });
    }
};

// ==========================================
// 3. QUẢN LÝ KHO THỰC PHẨM & XUẤT NHẬP
// ==========================================

const getInventoryList = async (req, res) => {
    try {
        const todayStart = startOfWorkDate(getWorkDate(new Date()));
        const threeDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await Inventory.updateMany(
            { quantity: { $lte: 0 }, status: { $nin: ['disposed', 'depleted'] } },
            { $set: { status: 'depleted' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $lt: todayStart }, status: { $nin: ['disposed', 'depleted'] } },
            { $set: { status: 'expired' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $gte: todayStart, $lte: threeDaysLater }, status: 'available' },
            { $set: { status: 'near_expiry' } }
        );
        await Inventory.updateMany(
            { quantity: { $gt: 0 }, expiryDate: { $gt: threeDaysLater }, status: 'near_expiry' },
            { $set: { status: 'available' } }
        );
        const inventories = await Inventory.find()
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
        const lot = await Inventory.findById(req.params.id);
        if (!lot) return res.status(404).json({ message: 'Không tìm thấy lô hàng' });
        if (lot.quantity <= 0 || ['depleted', 'disposed'].includes(lot.status)) {
            return res.status(409).json({ message: 'Lô hàng này đã được xử lý hoặc không còn số lượng tồn' });
        }

        const disposedQuantity = lot.quantity;
        lot.quantity = 0;
        lot.status = 'disposed';
        await lot.save();
        await InventoryTransaction.create({
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
        const { quantity, reason, rawAndSafe } = req.body;
        const returnQuantity = Number(quantity);
        if (!Number.isFinite(returnQuantity) || returnQuantity <= 0) {
            return res.status(400).json({ message: 'Số lượng hoàn trả phải lớn hơn 0' });
        }
        if (rawAndSafe !== true) {
            return res.status(400).json({ message: 'Chỉ hoàn trả nguyên liệu chưa chế biến, còn nguyên trạng và bảo đảm an toàn' });
        }
        const lot = await Inventory.findById(req.params.id);
        if (!lot) return res.status(404).json({ message: 'Không tìm thấy lô hàng' });
        if (lot.expiryDate < getTodayStart()) {
            return res.status(422).json({ message: 'Không thể hoàn trả lô hàng đã hết hạn' });
        }
        if (lot.status === 'disposed') {
            return res.status(422).json({ message: 'Không thể hoàn trả lô hàng đã xử lý hủy' });
        }

        lot.quantity += returnQuantity;
        lot.status = 'available';
        await lot.save();
        await InventoryTransaction.create({
            type: 'return',
            ingredientId: lot.ingredientId,
            ingredientName: lot.ingredientName,
            batchNumber: lot.batchNumber,
            quantity: returnQuantity,
            unit: lot.unit,
            costPerUnit: lot.costPerUnit || 0,
            totalAmount: returnQuantity * (lot.costPerUnit || 0),
            reason: String(reason || 'Hoàn trả nguyên liệu chưa sử dụng').trim(),
            performedBy: req.user._id,
            performedByName: req.user.profile?.fullName || req.user.username
        });
        res.json({ success: true, message: 'Đã cộng lại lượng nguyên liệu chưa sử dụng vào tồn kho.', data: lot });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể hoàn trả nguyên liệu' });
    }
};

const reconcileInventoryLot = async (req, res) => {
    try {
        const actualQuantity = Number(req.body.actualQuantity);
        if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
            return res.status(400).json({ message: 'Số lượng kiểm kê thực tế phải là số không âm' });
        }
        const lot = await Inventory.findById(req.params.id);
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
        const records = await InventoryReconciliation.find().sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, count: records.length, data: records });
    } catch (err) {
        res.status(500).json({ message: 'Không thể tải lịch sử kiểm kê' });
    }
};

const importStock = async (req, res) => {
    try {
        const { ingredientId, batchNumber, quantity, unit, costPerUnit, expiryDate, supplierId, supplierName, storageLocation } = req.body;
        const importQuantity = Number(quantity);
        const unitCost = Number(costPerUnit || 0);
        if (!ingredientId || quantity === undefined || quantity === null || !expiryDate || !String(supplierName || '').trim()) {
            return res.status(400).json({ message: 'Thiếu thông tin nhập kho nguyên liệu' });
        }
        if (!Number.isFinite(importQuantity) || importQuantity <= 0) {
            return res.status(400).json({ message: 'Số lượng nhập phải là một số lớn hơn 0' });
        }
        if (!Number.isFinite(unitCost) || unitCost < 0) {
            return res.status(400).json({ message: 'Đơn giá nhập không được âm' });
        }
        if (!String(storageLocation || '').trim()) {
            return res.status(400).json({ message: 'Vui lòng chọn vị trí bảo quản cho lô hàng' });
        }

        const ingredient = await IngredientMaster.findById(ingredientId);
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });
        const resolvedBatchNumber = String(batchNumber || createImportBatchNumber(ingredientId)).trim();
        const resolvedSupplierName = String(supplierName).trim();
        const resolvedStorageLocation = String(storageLocation).trim();

        let inv = await Inventory.findOne({ ingredientId, batchNumber: resolvedBatchNumber });
        if (inv) {
            inv.quantity += importQuantity;
            inv.costPerUnit = unitCost || inv.costPerUnit;
            inv.supplierId = supplierId || inv.supplierId;
            inv.supplierName = resolvedSupplierName;
            inv.storageLocation = resolvedStorageLocation;
            inv.status = 'available';
            await inv.save();
        } else {
            inv = await Inventory.create({
                ingredientId,
                ingredientName: ingredient.name,
                batchNumber: resolvedBatchNumber,
                quantity: importQuantity,
                unit: unit || ingredient.unit,
                costPerUnit: unitCost,
                expiryDate: new Date(expiryDate),
                supplierId,
                supplierName: resolvedSupplierName,
                storageLocation: resolvedStorageLocation,
                status: 'available'
            });
        }

        const totalAmount = importQuantity * unitCost;

        // Tạo giao dịch kho
        await InventoryTransaction.create({
            type: 'import',
            ingredientId,
            ingredientName: ingredient.name,
            batchNumber: resolvedBatchNumber,
            quantity: importQuantity,
            unit: unit || ingredient.unit,
            costPerUnit: unitCost,
            totalAmount,
            supplierId,
            supplierName: resolvedSupplierName,
            storageLocation: resolvedStorageLocation,
            reason: 'Nhập kho từ nhà cung cấp',
            performedBy: req.user._id,
            performedByName: req.user.profile?.fullName || req.user.username
        });

        res.status(201).json({ success: true, message: 'Đã nhập kho thành công', data: inv });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Lỗi nhập kho' });
    }
};

const exportStock = async (req, res) => {
    try {
        const { ingredientId, quantity, classroomId, className, mealDate, mealType, reason } = req.body;
        if (!ingredientId || !quantity || quantity <= 0) {
            return res.status(400).json({ message: 'Cần gửi mã nguyên liệu và số lượng xuất dương' });
        }

        const ingredient = await IngredientMaster.findById(ingredientId);
        if (!ingredient) return res.status(404).json({ message: 'Không tìm thấy nguyên liệu' });

        // Tìm các lô còn hàng sắp xếp theo hạn sử dụng sớm nhất (FEFO)
        const availableLots = await Inventory.find({
            ingredientId,
            quantity: { $gt: 0 },
            status: { $in: ['available', 'near_expiry'] },
            expiryDate: { $gte: getTodayStart() }
        }).sort({ expiryDate: 1 });

        const totalAvailable = availableLots.reduce((sum, lot) => sum + lot.quantity, 0);
        if (totalAvailable < Number(quantity)) {
            return res.status(400).json({
                message: `Tồn kho không đủ để xuất! Hiện còn ${totalAvailable} ${ingredient.unit}, yêu cầu xuất ${quantity} ${ingredient.unit}`
            });
        }

        let remainingToExport = Number(quantity);
        let totalExportValue = 0;

        for (const lot of availableLots) {
            if (remainingToExport <= 0) break;
            const deduct = Math.min(lot.quantity, remainingToExport);
            lot.quantity -= deduct;
            if (lot.quantity === 0) lot.status = 'depleted';
            await lot.save();

            remainingToExport -= deduct;
            totalExportValue += deduct * (lot.costPerUnit || 0);
        }

        const transaction = await InventoryTransaction.create({
            type: 'export',
            ingredientId,
            ingredientName: ingredient.name,
            quantity: Number(quantity),
            unit: ingredient.unit,
            costPerUnit: totalExportValue / Number(quantity),
            totalAmount: totalExportValue,
            classroomId,
            className: className || '',
            mealDate: mealDate ? new Date(mealDate) : new Date(),
            mealType: mealType || 'lunch',
            reason: reason || 'Xuất chế biến bữa ăn học sinh',
            performedBy: req.user._id,
            performedByName: req.user.profile?.fullName || req.user.username
        });

        res.json({
            success: true,
            message: `Đã xuất kho ${quantity} ${ingredient.unit} ${ingredient.name}`,
            data: transaction
        });
    } catch (err) {
        res.status(500).json({ message: err.message || 'Lỗi xuất kho' });
    }
};

const getInventoryAlertsController = async (req, res) => {
    try {
        const alerts = await fetchInventoryAlerts();
        res.json({ success: true, data: alerts });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi tải cảnh báo tồn kho' });
    }
};

const getTransactions = async (req, res) => {
    try {
        const { type, startDate, endDate } = req.query;
        const query = {};
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
        const suppliers = await Supplier.find().sort({ name: 1 });
        res.json({ success: true, count: suppliers.length, data: suppliers });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nhà cung cấp' });
    }
};

const createSupplier = async (req, res) => {
    try {
        const supplier = await Supplier.create(req.body);
        res.status(201).json({ success: true, message: 'Đã thêm nhà cung cấp mới', data: supplier });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo nhà cung cấp' });
    }
};

const updateSupplier = async (req, res) => {
    try {
        const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
        const equipments = await KitchenEquipment.find().sort({ condition: 1, name: 1 });
        res.json({ success: true, count: equipments.length, data: equipments });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách thiết bị bếp' });
    }
};

const createEquipment = async (req, res) => {
    try {
        const eq = await KitchenEquipment.create(req.body);
        res.status(201).json({ success: true, message: 'Đã thêm thiết bị nhà bếp mới', data: eq });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo thiết bị bếp' });
    }
};

const logEquipmentMaintenance = async (req, res) => {
    try {
        const { description, cost, technician, notes, newCondition } = req.body;
        const eq = await KitchenEquipment.findById(req.params.id);
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
        const staffList = await KitchenStaff.find().sort({ position: 1, fullName: 1 });
        res.json({ success: true, count: staffList.length, data: staffList });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách nhân viên bếp' });
    }
};

const createKitchenStaff = async (req, res) => {
    try {
        const staff = await KitchenStaff.create(req.body);
        res.status(201).json({ success: true, message: 'Đã thêm nhân viên bếp mới', data: staff });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Không thể tạo nhân viên bếp' });
    }
};

const updateKitchenStaff = async (req, res) => {
    try {
        const staff = await KitchenStaff.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
        const samples = await FoodSample.find().sort({ mealDate: -1, createdAt: -1 }).limit(100);
        res.json({ success: true, count: samples.length, data: samples });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy sổ lưu mẫu thức ăn' });
    }
};

const createFoodSample = async (req, res) => {
    try {
        const { sampleCode, mealDate, mealType, dishName, dishCategory, sampleWeightGram, storageTemperature, storageFridge, sensoryEvaluation, notes } = req.body;
        if (!sampleCode || !mealDate || !dishName || !mealType) {
            return res.status(400).json({ message: 'Thiếu thông tin lưu mẫu thức ăn' });
        }

        const sample = await FoodSample.create({
            sampleCode: String(sampleCode).trim().toUpperCase(),
            mealDate: new Date(mealDate),
            mealType,
            dishName,
            dishCategory: dishCategory || 'Món chính',
            sampleWeightGram: Number(sampleWeightGram || 100),
            storageTemperature: Number(storageTemperature || 4),
            storageFridge: storageFridge || 'Tủ lưu mẫu chuyên dụng 01',
            storedBy: req.user._id,
            storedByName: req.user.profile?.fullName || req.user.username,
            sensoryEvaluation: sensoryEvaluation || { color: 'Đạt chuẩn', smell: 'Thơm tự nhiên', taste: 'Bình thường' },
            notes: notes || ''
        });

        res.status(201).json({ success: true, message: `Đã lưu mẫu ${dishName} an toàn 24h`, data: sample });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Lỗi lưu mẫu thức ăn' });
    }
};

const disposeFoodSample = async (req, res) => {
    try {
        const { status, notes } = req.body;
        const sample = await FoodSample.findById(req.params.id);
        if (!sample) return res.status(404).json({ message: 'Không tìm thấy mẫu lưu' });

        sample.status = status || 'disposed_normal';
        sample.disposedAt = new Date();
        sample.disposedBy = req.user._id;
        sample.disposedByName = req.user.profile?.fullName || req.user.username;
        if (notes) sample.notes = (sample.notes ? sample.notes + ' | ' : '') + notes;

        await sample.save();
        res.json({ success: true, message: 'Đã xử lý hủy mẫu lưu an toàn sau 24h', data: sample });
    } catch (err) {
        res.status(400).json({ message: 'Không thể hủy mẫu thức ăn' });
    }
};

const getFoodInspections = async (req, res) => {
    try {
        const inspections = await FoodInspection.find().sort({ mealDate: -1, createdAt: -1 }).limit(50);
        res.json({ success: true, count: inspections.length, data: inspections });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy sổ kiểm thực 3 bước' });
    }
};

const createFoodInspection = async (req, res) => {
    try {
        const { mealDate, mealType, step1_rawIngredients, step2_processing, step3_serving, notes } = req.body;
        if (!mealDate || !mealType) {
            return res.status(400).json({ message: 'Thiếu ngày và bữa ăn kiểm thực' });
        }

        const inspection = await FoodInspection.create({
            mealDate: new Date(mealDate),
            mealType,
            step1_rawIngredients: step1_rawIngredients || [],
            step2_processing: step2_processing || {},
            step3_serving: step3_serving || {},
            inspectorId: req.user._id,
            inspectorName: req.user.profile?.fullName || req.user.username,
            notes: notes || ''
        });

        res.status(201).json({
            success: true,
            message: 'Đã lưu sổ kiểm thực 3 bước theo chuẩn QĐ 1246/BYT',
            data: inspection
        });
    } catch (err) {
        res.status(400).json({ message: err.message || 'Lỗi ghi nhận kiểm thực 3 bước' });
    }
};

// ==========================================
// 8. TÀI CHÍNH NHÀ ĂN & ĐỀ XUẤT MUA SẮM (FINANCE)
// ==========================================

const getDailyFinancialReport = async (req, res) => {
    try {
        const { date } = req.query;
        const report = await calculateDailyMealReport(date);
        res.json({ success: true, data: report });
    } catch (err) {
        console.error('Lỗi tính toán báo cáo tài chính nhà ăn:', err);
        res.status(500).json({ message: 'Không thể tạo báo cáo tài chính suất ăn' });
    }
};

const getKitchenRequests = async (req, res) => {
    try {
        const { status } = req.query;
        const query = {};
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
        const { status, approvalNotes } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Trạng thái chỉ có thể là approved hoặc rejected' });
        }

        const request = await KitchenRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Không tìm thấy phiếu đề xuất' });

        request.status = status;
        request.approvedBy = req.user._id;
        request.approvedByName = req.user.profile?.fullName || req.user.username;
        request.approvalNotes = approvalNotes || '';
        await request.save();

        res.json({ success: true, message: `Đã ${status === 'approved' ? 'duyệt' : 'từ chối'} đề xuất`, data: request });
    } catch (err) {
        res.status(400).json({ message: 'Lỗi duyệt phiếu đề xuất' });
    }
};

module.exports = {
    // Menu
    getMenus,
    getMenuById,
    getClassroomDietaryAlerts,
    createMenu,
    updateMenu,
    cloneMenu,
    checkAllergiesDryRun,
    // Dishes & Ingredients
    getDishes,
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
    getKitchenRequests,
    createKitchenRequest,
    approveKitchenRequest
};
