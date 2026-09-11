process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens-123456789';
process.env.JWT_ISSUER = 'school-management-api';
process.env.JWT_AUDIENCE = 'school-management-web';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const createApp = require('../app');
const { generateToken } = require('../src/utils/jwt');

// Models
const User = require('../src/models/zone1_system/User');
const Classroom = require('../src/models/zone3_school/Classroom');
const Student = require('../src/models/zone3_school/Student');
const StudentAttendance = require('../src/models/zone3_school/StudentAttendance');
const Dish = require('../src/models/zone5_nutrition/Dish');
const IngredientMaster = require('../src/models/zone5_nutrition/IngredientMaster');
const Inventory = require('../src/models/zone5_nutrition/Inventory');
const InventoryTransaction = require('../src/models/zone5_nutrition/InventoryTransaction');
const InventoryReconciliation = require('../src/models/zone5_nutrition/InventoryReconciliation');
const Supplier = require('../src/models/zone5_nutrition/Supplier');
const Menu = require('../src/models/zone5_nutrition/Menu');
const FoodSample = require('../src/models/zone5_nutrition/FoodSample');
const FoodInspection = require('../src/models/zone5_nutrition/FoodInspection');
const KitchenEquipment = require('../src/models/zone5_nutrition/KitchenEquipment');
const KitchenStaff = require('../src/models/zone5_nutrition/KitchenStaff');
const KitchenRequest = require('../src/models/zone5_nutrition/KitchenRequest');
const TuitionFee = require('../src/models/zone4_finance/TuitionFee');
const Payment = require('../src/models/zone4_finance/Payment');
const { getWorkDate, DEFAULT_SCHOOL_TIMEZONE } = require('../src/utils/dateHelpers');

const app = createApp();

let mongoServer;
let adminUser;
let chefUser;
let teacherUser;
let classroom1;
let classroom2;
let studentAllergic;

const authHeader = (user) => ({ Authorization: `Bearer ${generateToken(user)}` });

beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

beforeEach(async () => {
    // Xóa dữ liệu cũ
    await Promise.all([
        User.deleteMany({}),
        Classroom.deleteMany({}),
        Student.deleteMany({}),
        StudentAttendance.deleteMany({}),
        Dish.deleteMany({}),
        IngredientMaster.deleteMany({}),
        Inventory.deleteMany({}),
        InventoryTransaction.deleteMany({}),
        InventoryReconciliation.deleteMany({}),
        Supplier.deleteMany({}),
        Menu.deleteMany({}),
        FoodSample.deleteMany({}),
        FoodInspection.deleteMany({}),
        KitchenEquipment.deleteMany({}),
        KitchenStaff.deleteMany({}),
        KitchenRequest.deleteMany({}),
        TuitionFee.deleteMany({}),
        Payment.deleteMany({})
    ]);

    // Tạo Users
    adminUser = await User.create({
        username: 'admin_test',
        passwordHash: 'hash',
        role: 'admin',
        profile: { fullName: 'Quản Trị Viên' },
        status: 'active'
    });

    chefUser = await User.create({
        username: 'chef_test',
        passwordHash: 'hash',
        role: 'chef',
        profile: { fullName: 'Bếp Trưởng Nguyễn Văn A' },
        status: 'active'
    });

    teacherUser = await User.create({
        username: 'teacher_test',
        passwordHash: 'hash',
        role: 'teacher',
        profile: { fullName: 'Cô Giáo B' },
        status: 'active'
    });

    // Tạo Lớp học
    classroom1 = await Classroom.create({
        name: 'Lớp Mầm 1',
        ageGroup: '3-4',
        schoolYear: '2025-2026',
        status: 'active'
    });

    classroom2 = await Classroom.create({
        name: 'Lớp Chồi 2',
        ageGroup: '4-5',
        schoolYear: '2025-2026',
        status: 'active'
    });

    // Tạo Học sinh có tiền sử dị ứng và bệnh lý
    studentAllergic = await Student.create({
        studentCode: 'HS-2026-009001',
        fullName: 'Bé Nguyễn Gia Bảo',
        birthDate: new Date('2022-05-10'),
        gender: 'male',
        classroomId: classroom1._id,
        className: classroom1.name,
        allergies: [
            { allergen: 'tôm', severity: 'severe', note: 'Dị ứng sưng phù khi ăn tôm' },
            { allergen: 'đậu phộng', severity: 'moderate' }
        ],
        disease: {
            name: 'Không dung nạp đường lactose / dị ứng sữa bò',
            description: 'Uống sữa bò bị đau bụng'
        },
        status: 'enrolled'
    });
});

describe('Module Quản lý Nhà ăn & Dinh dưỡng (Nutrition & Kitchen)', () => {
    describe('1. Quản lý Món ăn và Nguyên liệu', () => {
        it('Cho phép Bếp trưởng thêm nguyên liệu và món ăn với danh sách dị ứng', async () => {
            const generatedCodeRes = await request(app)
                .post('/api/nutrition/ingredients')
                .set(authHeader(chefUser))
                .send({
                    name: 'Cải thìa',
                    category: 'vegetable',
                    unit: 'kg',
                    minStockAlert: 3
                });

            expect(generatedCodeRes.status).toBe(201);
            expect(generatedCodeRes.body.data.code).toMatch(/^NL_CAI_THIA/);

            const updateIngredientRes = await request(app)
                .put(`/api/nutrition/ingredients/${generatedCodeRes.body.data._id}`)
                .set(authHeader(chefUser))
                .send({ name: 'Cải thìa hữu cơ', minStockAlert: 4 });
            expect(updateIngredientRes.status).toBe(200);
            expect(updateIngredientRes.body.data.name).toBe('Cải thìa hữu cơ');

            const deleteIngredientRes = await request(app)
                .delete(`/api/nutrition/ingredients/${generatedCodeRes.body.data._id}`)
                .set(authHeader(chefUser));
            expect(deleteIngredientRes.status).toBe(200);
            expect(deleteIngredientRes.body.action).toBe('deleted');

            // Thêm nguyên liệu
            const ingRes = await request(app)
                .post('/api/nutrition/ingredients')
                .set(authHeader(chefUser))
                .send({
                    name: 'Tôm sú tươi',
                    code: 'NL_TOM_SU',
                    category: 'seafood',
                    unit: 'kg',
                    standardPrice: 220000,
                    minStockAlert: 5,
                    allergens: ['seafood', 'tôm']
                });

            expect(ingRes.status).toBe(201);
            expect(ingRes.body.data.code).toBe('NL_TOM_SU');

            // Thêm món ăn
            const dishRes = await request(app)
                .post('/api/nutrition/dishes')
                .set(authHeader(chefUser))
                .send({
                    name: 'Canh bí đỏ nấu tôm sú',
                    category: 'soup',
                    calories: 145,
                    protein: 12,
                    allergens: ['tôm', 'seafood'],
                    ingredients: [{
                        ingredientId: ingRes.body.data._id,
                        ingredientName: 'Tôm sú tươi',
                        quantity: 0.05,
                        unit: 'kg'
                    }]
                });

            expect(dishRes.status).toBe(201);
            expect(dishRes.body.data.name).toBe('Canh bí đỏ nấu tôm sú');
            expect(dishRes.body.data.allergens).toContain('crustacean');

            const updateDishRes = await request(app)
                .put(`/api/nutrition/dishes/${dishRes.body.data._id}`)
                .set(authHeader(chefUser))
                .send({ name: 'Canh bí đỏ tôm sú', calories: 150, allergens: ['crustacean'] });
            expect(updateDishRes.status).toBe(200);
            expect(updateDishRes.body.data.calories).toBe(150);

            const deleteDishRes = await request(app)
                .delete(`/api/nutrition/dishes/${dishRes.body.data._id}`)
                .set(authHeader(chefUser));
            expect(deleteDishRes.status).toBe(200);
            expect(deleteDishRes.body.action).toBe('deleted');
        });
    });

    describe('2. Quản lý Thực đơn tuần theo lớp & Cảnh báo Dị ứng / Bệnh lý', () => {
        it('Tự động phát hiện cảnh báo nguy cơ dị ứng khi lên thực đơn có món chứa chất dị ứng của học sinh trong lớp', async () => {
            // Thêm món ăn có tôm
            const tomDish = await Dish.create({
                name: 'Tôm rim thịt',
                category: 'main_course',
                calories: 210,
                allergens: ['tôm', 'seafood']
            });

            // Thêm thực đơn tuần cho Lớp Mầm 1 (có bé Gia Bảo dị ứng tôm)
            const menuRes = await request(app)
                .post('/api/nutrition/menus')
                .set(authHeader(chefUser))
                .send({
                    classroomId: classroom1._id,
                    startDate: '2026-09-07',
                    dietaryType: 'standard',
                    days: [{
                        dayOfWeek: 'monday',
                        lunch: {
                            mainDish: { dishId: tomDish._id, dishName: 'Tôm rim thịt' }
                        }
                    }]
                });

            expect(menuRes.status).toBe(201);
            expect(menuRes.body.data.weekNumber).toBe(37);
            expect(menuRes.body.data.schoolYear).toBe('2026-2027');
            expect(getWorkDate(menuRes.body.data.endDate, DEFAULT_SCHOOL_TIMEZONE)).toBe('2026-09-11');
            expect(menuRes.body.allergyWarningsFound).toBeGreaterThan(0);
            expect(menuRes.body.data.allergyWarnings.length).toBeGreaterThan(0);

            const warning = menuRes.body.data.allergyWarnings[0];
            expect(warning.studentName).toBe('Bé Nguyễn Gia Bảo');
            expect(warning.allergenMatched).toBe('tôm');
            expect(warning.dishName).toBe('Tôm rim thịt');

            const deactivateDishRes = await request(app)
                .delete(`/api/nutrition/dishes/${tomDish._id}`)
                .set(authHeader(chefUser));
            expect(deactivateDishRes.status).toBe(200);
            expect(deactivateDishRes.body.action).toBe('deactivated');
        });

        it('Lưu được nhiều món trong mỗi bữa và trả về lưu ý dinh dưỡng của lớp cho bếp', async () => {
            const [chao, suaChua, com, thit, canh] = await Dish.create([
                { name: 'Cháo thịt bằm', category: 'main_course', calories: 180 },
                { name: 'Sữa chua', category: 'snack', calories: 80 },
                { name: 'Cơm trắng', category: 'main_course', calories: 160 },
                { name: 'Thịt kho', category: 'main_course', calories: 190 },
                { name: 'Canh rau ngót', category: 'soup', calories: 45 }
            ]);

            const alertsRes = await request(app)
                .get(`/api/nutrition/classrooms/${classroom1._id}/dietary-alerts`)
                .set(authHeader(chefUser));

            expect(alertsRes.status).toBe(200);
            expect(alertsRes.body.data).toEqual(expect.arrayContaining([
                expect.objectContaining({ studentName: 'Bé Nguyễn Gia Bảo' })
            ]));

            const menuRes = await request(app)
                .post('/api/nutrition/menus')
                .set(authHeader(chefUser))
                .send({
                    classroomId: classroom1._id,
                    startDate: '2026-09-14',
                    days: [{
                        dayOfWeek: 'monday',
                        breakfast: { items: [{ dishId: chao._id }, { dishId: suaChua._id }] },
                        lunch: {
                            mainDishes: [{ dishId: com._id }, { dishId: thit._id }],
                            soupDishes: [{ dishId: canh._id }]
                        },
                        afternoonSnack: { items: [{ dishId: suaChua._id }] }
                    }]
                });

            expect(menuRes.status).toBe(201);
            expect(menuRes.body.data.days[0].breakfast.items).toHaveLength(2);
            expect(menuRes.body.data.days[0].lunch.mainDishes).toHaveLength(2);
            expect(menuRes.body.data.days[0].totalCalories).toBe(735);
        });

        it('Cho phép clone thực đơn sang lớp khác hoặc tuần khác', async () => {
            const sourceMenu = await Menu.create({
                classroomId: classroom1._id,
                className: classroom1.name,
                schoolYear: '2025-2026',
                weekNumber: 38,
                startDate: new Date('2026-09-14'),
                endDate: new Date('2026-09-19'),
                days: [{ dayOfWeek: 'monday', lunch: { mainDish: { dishName: 'Thịt heo kho trứng' } } }],
                status: 'published'
            });

            const cloneRes = await request(app)
                .post('/api/nutrition/menus/clone')
                .set(authHeader(chefUser))
                .send({
                    sourceMenuId: sourceMenu._id,
                    targetClassroomId: classroom2._id,
                    targetWeekNumber: 38,
                    targetStartDate: '2026-09-14',
                    targetEndDate: '2026-09-19'
                });

            expect(cloneRes.status).toBe(201);
            expect(cloneRes.body.data.className).toBe('Lớp Chồi 2');
            expect(cloneRes.body.data.status).toBe('draft');
        });

        it('giới hạn thực đơn và dữ liệu dị ứng theo lớp của phụ huynh, giáo viên', async () => {
            const parentUser = await User.create({
                username: 'parent_nutrition_test',
                passwordHash: 'hash',
                role: 'parent',
                profile: { fullName: 'Phụ huynh Bảo' },
                parentInfo: { studentIds: [studentAllergic._id] },
                status: 'active'
            });
            classroom1.teachers = [{ teacherId: teacherUser._id, teacherName: 'Cô Giáo B', role: 'homeroom' }];
            await classroom1.save();

            const visibleMenu = await Menu.create({
                classroomId: classroom1._id,
                className: classroom1.name,
                schoolYear: '2026-2027',
                weekNumber: 37,
                startDate: new Date('2026-09-07'),
                endDate: new Date('2026-09-11'),
                status: 'published',
                medicalNotes: 'Chỉ dùng nội bộ bếp',
                allergensExcluded: ['milk'],
                allergyWarnings: [{ studentId: studentAllergic._id, studentName: studentAllergic.fullName, allergenMatched: 'tôm' }]
            });
            await Menu.create({
                classroomId: classroom2._id,
                className: classroom2.name,
                schoolYear: '2026-2027',
                weekNumber: 37,
                startDate: new Date('2026-09-07'),
                endDate: new Date('2026-09-11'),
                status: 'published'
            });
            await Menu.create({
                classroomId: classroom1._id,
                className: classroom1.name,
                schoolYear: '2026-2027',
                weekNumber: 38,
                startDate: new Date('2026-09-14'),
                endDate: new Date('2026-09-18'),
                status: 'draft'
            });

            const parentMenus = await request(app)
                .get('/api/nutrition/menus')
                .set(authHeader(parentUser))
                .expect(200);
            expect(parentMenus.body.data).toHaveLength(1);
            expect(parentMenus.body.data[0]._id).toBe(visibleMenu._id.toString());
            expect(parentMenus.body.data[0]).not.toHaveProperty('allergyWarnings');
            expect(parentMenus.body.data[0]).not.toHaveProperty('medicalNotes');
            expect(parentMenus.body.data[0]).not.toHaveProperty('allergensExcluded');

            await request(app)
                .get(`/api/nutrition/menus?classroomId=${classroom2._id}`)
                .set(authHeader(parentUser))
                .expect(403);
            await request(app)
                .get(`/api/nutrition/menus/${visibleMenu._id}`)
                .set(authHeader(parentUser))
                .expect(200);
            await request(app)
                .get(`/api/nutrition/classrooms/${classroom2._id}/dietary-alerts`)
                .set(authHeader(teacherUser))
                .expect(403);
            await request(app)
                .post('/api/nutrition/menus/check-allergies')
                .set(authHeader(teacherUser))
                .send({ classroomId: classroom2._id, days: [] })
                .expect(403);
            await request(app)
                .get('/api/nutrition/menus/not-an-object-id')
                .set(authHeader(parentUser))
                .expect(400);
        });

        it('chỉ công bố thực đơn qua quy trình gửi duyệt, duyệt và khóa bản công bố', async () => {
            const dish = await Dish.create({ name: 'Món kiểm thử quy trình', category: 'main_course', calories: 120 });
            const makeItems = () => ({ items: [{ dishId: dish._id }] });
            const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((dayOfWeek) => ({
                dayOfWeek,
                breakfast: makeItems(),
                morningSnack: makeItems(),
                lunch: { mainDishes: [{ dishId: dish._id }], soupDishes: [{ dishId: dish._id }] },
                afternoonSnack: makeItems()
            }));
            const menuResponse = await request(app)
                .post('/api/nutrition/menus')
                .set(authHeader(chefUser))
                .send({ classroomId: classroom1._id, startDate: '2026-09-07', days })
                .expect(201);
            const menuId = menuResponse.body.data._id;

            await request(app)
                .put(`/api/nutrition/menus/${menuId}`)
                .set(authHeader(chefUser))
                .send({ status: 'published' })
                .expect(400);

            const submitted = await request(app)
                .post(`/api/nutrition/menus/${menuId}/submit`)
                .set(authHeader(chefUser))
                .send({ note: 'Đã hoàn thiện thực đơn tuần' })
                .expect(200);
            expect(submitted.body.data.status).toBe('pending_approval');

            const approved = await request(app)
                .post(`/api/nutrition/menus/${menuId}/approve`)
                .set(authHeader(adminUser))
                .send({ note: 'Đạt yêu cầu dinh dưỡng' })
                .expect(200);
            expect(approved.body.data.status).toBe('published');
            expect(approved.body.data.auditTrail.map((entry) => entry.action))
                .toEqual(expect.arrayContaining(['created', 'submitted', 'approved']));

            await request(app)
                .put(`/api/nutrition/menus/${menuId}`)
                .set(authHeader(chefUser))
                .send({ medicalNotes: 'Không được ghi đè' })
                .expect(409);
        });
    });

    describe('3. Quản lý Nhà cung cấp và Kho thực phẩm', () => {
        it('Nhập kho nguyên liệu và xuất kho theo đúng quy trình FEFO', async () => {
            // Tạo nhà cung cấp
            const supRes = await request(app)
                .post('/api/nutrition/suppliers')
                .set(authHeader(chefUser))
                .send({
                    name: 'Công ty Thực Phẩm Sạch VinEco',
                    code: 'NCC_VINECO',
                    phone: '0901234567',
                    categories: ['vegetable', 'fruit'],
                    foodSafetyCert: {
                        certNumber: 'VSATTP-HN-2026-888',
                        isValid: true
                    }
                });

            expect(supRes.status).toBe(201);

            // Tạo nguyên liệu
            const ing = await IngredientMaster.create({
                name: 'Rau cải ngọt hữu cơ',
                code: 'NL_CAI_NGOT',
                category: 'vegetable',
                unit: 'kg',
                standardPrice: 25000,
                minStockAlert: 10
            });

            const invalidImportRes = await request(app)
                .post('/api/nutrition/inventory/import')
                .set(authHeader(chefUser))
                .send({
                    ingredientId: ing._id,
                    quantity: -1,
                    costPerUnit: 24000,
                    expiryDate: '2026-09-12',
                    supplierName: supRes.body.data.name
                });

            expect(invalidImportRes.status).toBe(400);
            expect(invalidImportRes.body.message).toMatch(/lớn hơn 0/);

            // Nhập kho
            const importRes = await request(app)
                .post('/api/nutrition/inventory/import')
                .set(authHeader(chefUser))
                .send({
                    ingredientId: ing._id,
                    quantity: 20,
                    costPerUnit: 24000,
                    expiryDate: '2026-09-12',
                    supplierId: supRes.body.data._id,
                    supplierName: supRes.body.data.name,
                    storageLocation: 'Kho lạnh 01'
                });

            expect(importRes.status).toBe(201);
            expect(importRes.body.data.quantity).toBe(20);
            expect(importRes.body.data.batchNumber).toMatch(/^LOT-/);

            // Xuất kho cho lớp nấu ăn
            const exportRes = await request(app)
                .post('/api/nutrition/inventory/export')
                .set(authHeader(chefUser))
                .send({
                    ingredientId: ing._id,
                    quantity: 5,
                    classroomId: classroom1._id,
                    className: classroom1.name,
                    mealDate: '2026-09-05',
                    mealType: 'lunch',
                    reason: 'Nấu canh trưa Lớp Mầm 1'
                });

            expect(exportRes.status).toBe(200);
            expect(exportRes.body.data.quantity).toBe(5);

            // Kiểm tra tồn kho còn lại: 20 - 5 = 15
            const invListRes = await request(app)
                .get('/api/nutrition/inventory')
                .set(authHeader(chefUser));

            const lot = invListRes.body.data.find(i => i.batchNumber === importRes.body.data.batchNumber);
            expect(lot.quantity).toBe(15);

            const returnRes = await request(app)
                .post(`/api/nutrition/inventory/${lot._id}/return`)
                .set(authHeader(chefUser))
                .send({
                    quantity: 2,
                    rawAndSafe: true,
                    sourceExportTransactionId: exportRes.body.data._id,
                    reason: 'Nguyên liệu chưa sơ chế còn nguyên trạng'
                });
            expect(returnRes.status).toBe(200);
            expect(returnRes.body.data.quantity).toBe(17);
            expect(returnRes.body.transaction.sourceExportTransactionId).toBe(exportRes.body.data._id);
            expect(exportRes.body.data.lotAllocations).toHaveLength(1);

            await request(app)
                .post(`/api/nutrition/inventory/${lot._id}/return`)
                .set(authHeader(chefUser))
                .send({ quantity: 4, rawAndSafe: true, sourceExportTransactionId: exportRes.body.data._id })
                .expect(422);

            const reconcileRes = await request(app)
                .post(`/api/nutrition/inventory/${lot._id}/reconcile`)
                .set(authHeader(adminUser))
                .send({ actualQuantity: 16, notes: 'Hao hụt khi cân thực tế' });
            expect(reconcileRes.status).toBe(200);
            expect(reconcileRes.body.data.difference).toBe(-1);

            const expiredLot = await Inventory.create({
                ingredientId: ing._id,
                ingredientName: ing.name,
                batchNumber: 'LOT_EXPIRED_TEST',
                quantity: 3,
                unit: 'kg',
                costPerUnit: 24000,
                expiryDate: new Date('2020-01-01'),
                status: 'expired'
            });
            const disposeRes = await request(app)
                .post(`/api/nutrition/inventory/${expiredLot._id}/dispose`)
                .set(authHeader(chefUser))
                .send({ reason: 'Hết hạn sử dụng' });
            expect(disposeRes.status).toBe(200);
            expect(disposeRes.body.data.status).toBe('disposed');
            expect(disposeRes.body.data.quantity).toBe(0);

            const deactivateIngredientRes = await request(app)
                .delete(`/api/nutrition/ingredients/${ing._id}`)
                .set(authHeader(chefUser));
            expect(deactivateIngredientRes.status).toBe(200);
            expect(deactivateIngredientRes.body.action).toBe('deactivated');
        });

        it('không cho xuất vượt tồn khi hai yêu cầu xuất chạy đồng thời và lưu vết lô FEFO', async () => {
            const today = new Date(`${getWorkDate(new Date())}T00:00:00.000Z`);
            const olderExpiry = new Date(today); olderExpiry.setUTCDate(olderExpiry.getUTCDate() + 1);
            const newerExpiry = new Date(today); newerExpiry.setUTCDate(newerExpiry.getUTCDate() + 3);
            const ingredient = await IngredientMaster.create({
                name: 'Bí đỏ kiểm thử đồng thời', code: 'NL_BI_DO_CONCURRENT', category: 'vegetable', unit: 'kg'
            });
            const [olderLot, newerLot] = await Inventory.create([
                {
                    ingredientId: ingredient._id, ingredientName: ingredient.name, batchNumber: 'LOT-FEFO-OLD',
                    quantity: 4, unit: 'kg', costPerUnit: 10000, expiryDate: olderExpiry, status: 'available'
                },
                {
                    ingredientId: ingredient._id, ingredientName: ingredient.name, batchNumber: 'LOT-FEFO-NEW',
                    quantity: 6, unit: 'kg', costPerUnit: 12000, expiryDate: newerExpiry, status: 'available'
                }
            ]);
            const payload = { ingredientId: ingredient._id, quantity: 7, mealType: 'lunch' };
            const responses = await Promise.all([
                request(app).post('/api/nutrition/inventory/export').set(authHeader(chefUser)).send(payload),
                request(app).post('/api/nutrition/inventory/export').set(authHeader(chefUser)).send(payload)
            ]);
            expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
            const successfulExport = responses.find((response) => response.status === 200).body.data;
            expect(successfulExport.lotAllocations.map((allocation) => allocation.batchNumber))
                .toEqual([olderLot.batchNumber, newerLot.batchNumber]);
            expect(successfulExport.lotAllocations.map((allocation) => allocation.quantity)).toEqual([4, 3]);
            const remaining = await Inventory.find({ ingredientId: ingredient._id });
            expect(remaining.reduce((sum, lot) => sum + lot.quantity, 0)).toBe(3);
            expect(await InventoryTransaction.countDocuments({ ingredientId: ingredient._id, type: 'export' })).toBe(1);
        });

        it('ghi nhận thanh toán nguyên tử, chống thu dư và idempotent khi request được gửi lại', async () => {
            const invoice = await TuitionFee.create({
                studentId: studentAllergic._id, studentName: studentAllergic.fullName,
                classroomId: classroom1._id, className: classroom1.name, period: '09-2026',
                tuitionBase: 100000, totalAmount: 100000, dueDate: new Date('2026-09-30')
            });
            const sameRequest = {
                invoiceId: invoice._id, amount: 60000, method: 'bank_transfer', txnRef: 'BANK-TEST-001'
            };
            const [first, retry] = await Promise.all([
                request(app).post('/api/finance/payment').set(authHeader(adminUser)).set('Idempotency-Key', 'payment-retry-001').send(sameRequest),
                request(app).post('/api/finance/payment').set(authHeader(adminUser)).set('Idempotency-Key', 'payment-retry-001').send(sameRequest)
            ]);
            expect([first.status, retry.status].sort()).toEqual([200, 201]);
            expect(await Payment.countDocuments({ invoiceId: invoice._id })).toBe(1);
            expect((await TuitionFee.findById(invoice._id)).paidAmount).toBe(60000);

            await request(app)
                .post('/api/finance/payment')
                .set(authHeader(adminUser))
                .set('Idempotency-Key', 'payment-overpay-001')
                .send({ invoiceId: invoice._id, amount: 50000, method: 'cash' })
                .expect(422);
            expect((await TuitionFee.findById(invoice._id)).paidAmount).toBe(60000);
        });
    });

    describe('4. An toàn thực phẩm: Lưu mẫu 24h & Kiểm thực 3 bước', () => {
        it('Lưu mẫu thức ăn 24h và ghi nhận hủy an toàn sau 24h', async () => {
            const sampleRes = await request(app)
                .post('/api/nutrition/food-samples')
                .set(authHeader(chefUser))
                .send({
                    sampleCode: 'MAU-20260905-LUNCH-01',
                    mealDate: '2026-09-05',
                    mealType: 'lunch',
                    dishName: 'Thịt bò xào rau củ',
                    sampleWeightGram: 120,
                    storageTemperature: 4,
                    storageFridge: 'Tủ lưu mẫu chuyên dụng 01'
                });

            expect(sampleRes.status).toBe(201);
            expect(sampleRes.body.data.sampleCode).toBe('MAU-20260905-LUNCH-01');
            expect(sampleRes.body.data.status).toBe('stored');

            // Hủy mẫu an toàn
            const disposeRes = await request(app)
                .put(`/api/nutrition/food-samples/${sampleRes.body.data._id}/dispose`)
                .set(authHeader(chefUser))
                .send({
                    status: 'disposed_normal',
                    notes: 'Hết 24h, mẫu bình thường không có dấu hiệu hư hỏng'
                });

            expect(disposeRes.status).toBe(200);
            expect(disposeRes.body.data.status).toBe('disposed_normal');
        });

        it('Ghi nhận sổ kiểm thực 3 bước theo QĐ 1246/QĐ-BYT', async () => {
            const inspectRes = await request(app)
                .post('/api/nutrition/food-inspections')
                .set(authHeader(chefUser))
                .send({
                    mealDate: '2026-09-05',
                    mealType: 'lunch',
                    step1_rawIngredients: [{
                        ingredientName: 'Thịt bò tươi',
                        quantity: 10,
                        unit: 'kg',
                        decision: 'accept'
                    }],
                    step2_processing: {
                        kitchenHygiene: 'Sạch sẽ',
                        staffHygiene: 'Bảo hộ đầy đủ',
                        cookingTemperaturePassed: true
                    },
                    step3_serving: {
                        foodSampleStored: true,
                        decision: 'approved_for_eating'
                    }
                });

            expect(inspectRes.status).toBe(201);
            expect(inspectRes.body.data.step3_serving.decision).toBe('approved_for_eating');
        });
    });

    describe('5. Thiết bị nhà bếp chung & Nhân viên bếp', () => {
        it('Quản lý thiết bị bếp và ghi nhận bảo dưỡng sửa chữa', async () => {
            const eqRes = await request(app)
                .post('/api/nutrition/equipment')
                .set(authHeader(chefUser))
                .send({
                    name: 'Tủ hấp cơm công nghiệp 24 khay',
                    code: 'TB_TU_COM_01',
                    category: 'cooking',
                    condition: 'good'
                });

            expect(eqRes.status).toBe(201);

            // Ghi nhận bảo trì
            const maintRes = await request(app)
                .post(`/api/nutrition/equipment/${eqRes.body.data._id}/maintenance`)
                .set(authHeader(chefUser))
                .send({
                    description: 'Thay roong cửa và kiểm tra van áp suất',
                    cost: 350000,
                    technician: 'Kỹ thuật viên điện lạnh Minh Phát',
                    newCondition: 'good'
                });

            expect(maintRes.status).toBe(200);
            expect(maintRes.body.data.maintenanceLogs.length).toBe(1);
        });

        it('Quản lý nhân viên bếp kèm hạn chứng chỉ VSATTP và khám sức khỏe', async () => {
            const staffRes = await request(app)
                .post('/api/nutrition/staff')
                .set(authHeader(chefUser))
                .send({
                    fullName: 'Lê Thị Thu',
                    staffCode: 'NV_BEP_001',
                    phone: '0987654321',
                    position: 'prep_cook',
                    foodSafetyCert: {
                        certNumber: 'CERT-2026-999',
                        isValid: true
                    },
                    healthCheck: {
                        result: 'Đạt sức khỏe loại 1',
                        hospital: 'Bệnh viện Quận 1'
                    }
                });

            expect(staffRes.status).toBe(201);
            expect(staffRes.body.data.staffCode).toBe('NV_BEP_001');
        });
    });

    describe('6. Tài chính nhà ăn & Đề xuất mua sắm', () => {
        it('Tính toán báo cáo chi phí suất ăn dựa trên số học sinh có mặt thực tế từ điểm danh', async () => {
            const dateKey = getWorkDate(new Date(), DEFAULT_SCHOOL_TIMEZONE);

            // Giả lập điểm danh 20 học sinh có mặt hôm nay
            await StudentAttendance.create({
                studentId: studentAllergic._id,
                studentName: studentAllergic.fullName,
                classroomId: classroom1._id,
                className: classroom1.name,
                attendDate: new Date(),
                attendanceDateKey: dateKey,
                status: 'present',
                recordedBy: adminUser._id,
                recordedByName: 'Quản trị viên'
            });

            const chefFinRes = await request(app)
                .get(`/api/nutrition/financials/daily?date=${new Date().toISOString()}`)
                .set(authHeader(chefUser));

            expect(chefFinRes.status).toBe(403);

            const finRes = await request(app)
                .get(`/api/nutrition/financials/daily?date=${new Date().toISOString()}`)
                .set(authHeader(adminUser));

            expect(finRes.status).toBe(200);
            expect(finRes.body.data.totalStudentsPresent).toBe(1);
            expect(finRes.body.data.totalMealRevenueBudget).toBe(35000);
            expect(finRes.body.data).toHaveProperty('budgetUtilizationPercent');
            expect(finRes.body.data).toHaveProperty('recentExpenseTransactions');
        });

        it('Tạo đề xuất mua sắm cho nhà bếp và Ban giám hiệu duyệt', async () => {
            const reqRes = await request(app)
                .post('/api/nutrition/requests')
                .set(authHeader(chefUser))
                .send({
                    requestCode: 'YC-20260905-01',
                    requestType: 'ingredient_purchase',
                    title: 'Mua thực phẩm tươi sống tuần 37',
                    items: [
                        { name: 'Thịt nạc heo', quantity: 20, unit: 'kg', estimatedCost: 2000000 }
                    ],
                    priority: 'high'
                });

            expect(reqRes.status).toBe(201);
            expect(reqRes.body.data.totalEstimatedCost).toBe(2000000);

            // Duyệt đề xuất
            const approveRes = await request(app)
                .put(`/api/nutrition/requests/${reqRes.body.data._id}/approve`)
                .set(authHeader(adminUser))
                .send({
                    status: 'approved',
                    approvalNotes: 'Đồng ý cho xuất quỹ bếp mua thực phẩm'
                });

            expect(approveRes.status).toBe(200);
            expect(approveRes.body.data.status).toBe('approved');
        });
    });
});
