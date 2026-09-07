const Student = require('../models/zone3_school/Student');
const StudentAttendance = require('../models/zone3_school/StudentAttendance');
const Classroom = require('../models/zone3_school/Classroom');
const Dish = require('../models/zone5_nutrition/Dish');
const Menu = require('../models/zone5_nutrition/Menu');
const Inventory = require('../models/zone5_nutrition/Inventory');
const IngredientMaster = require('../models/zone5_nutrition/IngredientMaster');
const InventoryTransaction = require('../models/zone5_nutrition/InventoryTransaction');
const { getWorkDate, startOfWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../utils/dateHelpers');

// Danh mục dị nguyên chuẩn hoá để dữ liệu món ăn và hồ sơ học sinh có thể
// đối chiếu chính xác. Không dùng ghi chú tự do làm căn cứ cảnh báo an toàn.
const ALLERGEN_CODES = [
    'gluten', 'crustacean', 'fish', 'egg', 'milk',
    'peanut', 'soy', 'sesame', 'tree_nut', 'mollusc'
];

const ALLERGEN_ALIASES = {
    gluten: ['gluten', 'lúa mì', 'bot mi', 'bột mì'],
    crustacean: ['crustacean', 'seafood', 'hải sản', 'tôm', 'cua', 'giáp xác'],
    fish: ['fish', 'cá'],
    egg: ['egg', 'trứng'],
    milk: ['milk', 'dairy', 'lactose', 'sữa', 'sữa bò'],
    peanut: ['peanut', 'đậu phộng', 'lạc'],
    soy: ['soy', 'đậu nành'],
    sesame: ['sesame', 'mè', 'vừng'],
    tree_nut: ['tree_nut', 'hạt cây', 'hạnh nhân', 'hạt điều', 'óc chó'],
    mollusc: ['mollusc', 'nhuyễn thể', 'nghêu', 'sò', 'ốc', 'mực']
};

/**
 * Chuẩn hóa chuỗi tìm kiếm dị ứng / bệnh lý
 */
const normalizeText = (text) => {
    if (!text) return '';
    return String(text).toLowerCase().trim();
};

const normalizeAllergen = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) return '';

    const matched = Object.entries(ALLERGEN_ALIASES).find(([, aliases]) => (
        aliases.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized))
    ));

    return matched ? matched[0] : normalized;
};

const toMealItems = (meal = {}) => (
    Array.isArray(meal.items) && meal.items.length ? meal.items : (meal.dishId ? [meal] : [])
);

const toLunchItems = (lunch = {}, collectionKey, legacyKey) => (
    Array.isArray(lunch[collectionKey]) && lunch[collectionKey].length
        ? lunch[collectionKey]
        : (lunch[legacyKey]?.dishId ? [lunch[legacyKey]] : [])
);

/**
 * Kiểm tra cảnh báo dị ứng và bệnh lý giữa thực đơn của lớp với hồ sơ học sinh trong lớp
 * @param {string|ObjectId} classroomId
 * @param {Array} days - Mảng các ngày trong thực đơn tuần
 */
const checkAllergyAndDiseaseConflicts = async (classroomId, days = []) => {
    if (!classroomId || !days || !days.length) return [];

    // 1. Lấy danh sách học sinh đang học trong lớp có ghi nhận dị ứng hoặc bệnh lý
    const students = await Student.find({
        classroomId,
        status: 'enrolled'
    }).select('fullName allergies disease');

    if (!students.length) return [];

    // 2. Thu thập danh sách dishId cần tra cứu thông tin dị ứng
    const dishIdSet = new Set();
    const dishLookupMap = {};

    days.forEach(day => {
        ['breakfast', 'morningSnack', 'afternoonSnack'].forEach(meal => {
            toMealItems(day[meal]).forEach((item) => {
                if (item.dishId) dishIdSet.add(String(item.dishId));
            });
        });
        [
            ['mainDishes', 'mainDish'],
            ['stirFryDishes', 'stirFryDish'],
            ['soupDishes', 'soupDish'],
            ['desserts', 'dessert']
        ].forEach(([collectionKey, legacyKey]) => {
            toLunchItems(day.lunch, collectionKey, legacyKey).forEach((item) => {
                if (item.dishId) dishIdSet.add(String(item.dishId));
            });
        });
    });

    if (dishIdSet.size > 0) {
        const dishes = await Dish.find({ _id: { $in: Array.from(dishIdSet) } }).select('name allergens ingredients');
        dishes.forEach(d => {
            dishLookupMap[String(d._id)] = d;
        });
    }

    const warnings = [];

    // 3. Quét từng ngày, từng bữa và đối chiếu với từng học sinh
    days.forEach(day => {
        const mealItems = [
            ...toMealItems(day.breakfast).map((item) => ({ type: 'breakfast', item })),
            ...toMealItems(day.morningSnack).map((item) => ({ type: 'morningSnack', item })),
            ...toLunchItems(day.lunch, 'mainDishes', 'mainDish').map((item) => ({ type: 'lunch.mainDish', item })),
            ...toLunchItems(day.lunch, 'stirFryDishes', 'stirFryDish').map((item) => ({ type: 'lunch.stirFryDish', item })),
            ...toLunchItems(day.lunch, 'soupDishes', 'soupDish').map((item) => ({ type: 'lunch.soupDish', item })),
            ...toLunchItems(day.lunch, 'desserts', 'dessert').map((item) => ({ type: 'lunch.dessert', item })),
            ...toMealItems(day.afternoonSnack).map((item) => ({ type: 'afternoonSnack', item }))
        ];

        mealItems.forEach(({ type: mealType, item }) => {
            if (!item || (!item.dishName && !item.dishId)) return;

            const dishDoc = item.dishId ? dishLookupMap[String(item.dishId)] : null;
            const dishName = item.dishName || dishDoc?.name || '';
            const dishAllergens = [...new Set((dishDoc?.allergens || []).map(normalizeAllergen).filter(Boolean))];

            students.forEach(student => {
                // Kiểm tra dị ứng thực phẩm của học sinh
                if (student.allergies && student.allergies.length > 0) {
                    student.allergies.forEach(allergy => {
                        const allergenTerm = normalizeAllergen(allergy.allergen);
                        if (!allergenTerm) return;

                        const matchesAllergenList = dishAllergens.includes(allergenTerm);

                        if (matchesAllergenList) {
                            warnings.push({
                                studentId: student._id,
                                studentName: student.fullName,
                                allergenMatched: allergy.allergen,
                                severity: allergy.severity || 'moderate',
                                diseaseMatched: null,
                                dishName,
                                dayOfWeek: day.dayOfWeek,
                                mealType,
                                resolved: false
                            });
                        }
                    });
                }

                // Bệnh lý chỉ được xử lý khi hồ sơ có chỉ định dinh dưỡng có
                // cấu trúc và được chuyên môn xác nhận. Suy luận từ tên bệnh
                // hoặc ghi chú tự do có thể gây khuyến nghị sai và không an toàn.
            });
        });
    });

    return warnings;
};

/**
 * Tính toán số suất ăn thực tế dựa vào điểm danh học sinh & chi phí nguyên liệu xuất kho
 */
const calculateDailyMealReport = async (date) => {
    const targetDate = date ? new Date(date) : new Date();
    const dateKey = getWorkDate(targetDate, DEFAULT_SCHOOL_TIMEZONE);

    // 1. Lấy danh sách điểm danh học sinh có mặt trong ngày
    const attendances = await StudentAttendance.find({
        attendanceDateKey: dateKey,
        status: 'present'
    }).select('studentId classroomId className');

    // Thống kê theo lớp
    const classServingMap = {};
    attendances.forEach(att => {
        const cId = String(att.classroomId);
        if (!classServingMap[cId]) {
            classServingMap[cId] = {
                classroomId: att.classroomId,
                className: att.className || 'Chưa rõ',
                actualPresentStudents: 0
            };
        }
        classServingMap[cId].actualPresentStudents += 1;
    });

    const totalStudentsPresent = attendances.length;

    // 2. Lấy chi phí nguyên liệu đã xuất kho trong ngày
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const exportTransactions = await InventoryTransaction.find({
        type: 'export',
        createdAt: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ createdAt: -1 });

    const totalIngredientCost = exportTransactions.reduce((sum, item) => sum + (item.totalAmount || 0), 0);

    // Giả định định mức thu tiền ăn tiêu chuẩn: 35.000 VNĐ / học sinh / ngày
    const standardMealRatePerStudent = 35000;
    const totalMealRevenueBudget = totalStudentsPresent * standardMealRatePerStudent;
    const actualCostPerStudent = totalStudentsPresent > 0 ? Math.round(totalIngredientCost / totalStudentsPresent) : 0;
    const balance = totalMealRevenueBudget - totalIngredientCost;
    const budgetUtilizationPercent = totalMealRevenueBudget > 0
        ? Math.round((totalIngredientCost / totalMealRevenueBudget) * 1000) / 10
        : 0;
    const mealCostBreakdown = Object.values(exportTransactions.reduce((summary, transaction) => {
        const key = transaction.mealType || 'general';
        if (!summary[key]) summary[key] = { mealType: key, cost: 0, transactions: 0 };
        summary[key].cost += Number(transaction.totalAmount) || 0;
        summary[key].transactions += 1;
        return summary;
    }, {}));

    return {
        dateKey,
        date: targetDate,
        totalStudentsPresent,
        classBreakdown: Object.values(classServingMap),
        standardMealRatePerStudent,
        totalMealRevenueBudget,
        totalIngredientCost,
        actualCostPerStudent,
        balance,
        budgetUtilizationPercent,
        exportTransactionsCount: exportTransactions.length,
        mealCostBreakdown,
        recentExpenseTransactions: exportTransactions.slice(0, 10).map((transaction) => ({
            _id: transaction._id,
            ingredientName: transaction.ingredientName,
            batchNumber: transaction.batchNumber || '',
            quantity: transaction.quantity,
            unit: transaction.unit,
            totalAmount: transaction.totalAmount,
            mealType: transaction.mealType,
            className: transaction.className || '',
            reason: transaction.reason || '',
            createdAt: transaction.createdAt,
            performedByName: transaction.performedByName || ''
        }))
    };
};

/**
 * Sao chép thực đơn tuần sang lớp khác hoặc tuần khác
 */
const cloneWeeklyMenu = async (sourceMenuId, {
    targetClassroomId,
    targetSchoolYear,
    targetWeekNumber,
    targetStartDate,
    targetEndDate,
    userId,
    userName
}) => {
    const source = await Menu.findById(sourceMenuId);
    if (!source) throw new Error('Không tìm thấy thực đơn nguồn');

    const targetClassroom = await Classroom.findById(targetClassroomId);
    if (!targetClassroom) throw new Error('Không tìm thấy lớp học đích');

    // Kiểm tra trùng lặp
    const existing = await Menu.findOne({
        classroomId: targetClassroomId,
        schoolYear: targetSchoolYear || source.schoolYear,
        weekNumber: targetWeekNumber
    });
    if (existing) {
        throw new Error(`Đã tồn tại thực đơn tuần ${targetWeekNumber} cho lớp ${targetClassroom.name}`);
    }

    // Tự động quét cảnh báo dị ứng cho lớp mới
    const allergyWarnings = await checkAllergyAndDiseaseConflicts(targetClassroomId, source.days);

    const newMenu = await Menu.create({
        classroomId: targetClassroomId,
        className: targetClassroom.name,
        schoolYear: targetSchoolYear || source.schoolYear,
        weekNumber: targetWeekNumber,
        startDate: new Date(targetStartDate),
        endDate: new Date(targetEndDate),
        dietaryType: source.dietaryType,
        medicalNotes: source.medicalNotes || '',
        allergensExcluded: source.allergensExcluded || [],
        days: source.days,
        allergyWarnings,
        status: 'draft',
        createdBy: userId,
        createdByName: userName
    });

    return newMenu;
};

/**
 * Lấy danh sách cảnh báo tồn kho và cận hạn sử dụng
 */
const getInventoryAlerts = async () => {
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const todayStart = startOfWorkDate(getWorkDate(now, DEFAULT_SCHOOL_TIMEZONE));

    const expiredItems = await Inventory.find({
        quantity: { $gt: 0 },
        status: { $nin: ['disposed', 'depleted'] },
        expiryDate: { $lt: todayStart }
    }).populate('ingredientId', 'name unit minStockAlert');

    // Còn hạn nhưng cận date trong 3 ngày tới
    const expiringItems = await Inventory.find({
        quantity: { $gt: 0 },
        status: { $nin: ['disposed', 'depleted'] },
        expiryDate: { $gte: todayStart, $lte: threeDaysLater }
    }).populate('ingredientId', 'name unit minStockAlert');

    // Tồn kho thấp so với minStockAlert
    const masterIngredients = await IngredientMaster.find({ status: 'active' });
    const lowStockAlerts = [];

    for (const master of masterIngredients) {
        const inventories = await Inventory.find({
            ingredientId: master._id,
            status: { $in: ['available', 'near_expiry'] }
        });
        const totalStock = inventories.reduce((sum, inv) => sum + inv.quantity, 0);

        // Hàng đã hết sạch không còn là lô tồn để vận hành. Lịch sử nhập/xuất/hủy
        // vẫn được bảo toàn trong sổ kho; màn cảnh báo chỉ phục vụ các mặt hàng còn tồn.
        if (totalStock > 0 && totalStock <= master.minStockAlert) {
            lowStockAlerts.push({
                ingredientId: master._id,
                name: master.name,
                code: master.code,
                unit: master.unit,
                currentStock: totalStock,
                minStockAlert: master.minStockAlert
            });
        }
    }

    return {
        expiredItems,
        expiringItems,
        lowStockAlerts
    };
};

module.exports = {
    ALLERGEN_CODES,
    checkAllergyAndDiseaseConflicts,
    calculateDailyMealReport,
    cloneWeeklyMenu,
    getInventoryAlerts,
    normalizeAllergen
};
