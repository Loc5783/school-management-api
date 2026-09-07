const mongoose = require('mongoose');
require('dotenv').config();

const Dish = require('../models/zone5_nutrition/Dish');

// Khẩu phần và dinh dưỡng là dữ liệu minh hoạ để kiểm thử giao diện/lập thực đơn.
// Cần được bộ phận dinh dưỡng rà soát trước khi áp dụng cho vận hành thực tế.
const SAMPLE_DISHES = [
    { name: 'Thịt gà kho gừng', category: 'main_course', servingSizeGram: 85, calories: 205, protein: 18, fat: 11, carbs: 7, allergens: [] },
    { name: 'Cá basa sốt cà chua', category: 'main_course', servingSizeGram: 90, calories: 190, protein: 17, fat: 9, carbs: 8, allergens: ['fish'] },
    { name: 'Thịt bò hầm khoai tây', category: 'main_course', servingSizeGram: 100, calories: 235, protein: 19, fat: 13, carbs: 12, allergens: [] },

    { name: 'Rau cải thìa xào tỏi', category: 'stir_fry', servingSizeGram: 65, calories: 55, protein: 2, fat: 3, carbs: 5, allergens: [] },
    { name: 'Đậu que xào thịt bằm', category: 'stir_fry', servingSizeGram: 75, calories: 115, protein: 7, fat: 7, carbs: 6, allergens: [] },
    { name: 'Bí đỏ xào tỏi', category: 'stir_fry', servingSizeGram: 70, calories: 68, protein: 1, fat: 3, carbs: 10, allergens: [] },

    { name: 'Canh bí đỏ thịt bằm', category: 'soup', servingSizeGram: 160, calories: 95, protein: 6, fat: 4, carbs: 9, allergens: [] },
    { name: 'Canh rau ngót nấu thịt', category: 'soup', servingSizeGram: 160, calories: 75, protein: 6, fat: 3, carbs: 7, allergens: [] },
    { name: 'Canh cải thảo nấu cá', category: 'soup', servingSizeGram: 160, calories: 85, protein: 7, fat: 3, carbs: 8, allergens: ['fish'] },

    { name: 'Bánh bao nhân thịt', category: 'snack', servingSizeGram: 75, calories: 180, protein: 7, fat: 5, carbs: 27, allergens: ['gluten'] },
    { name: 'Cháo gà nấm hương', category: 'snack', servingSizeGram: 180, calories: 165, protein: 9, fat: 5, carbs: 22, allergens: [] },
    { name: 'Súp bắp gà', category: 'snack', servingSizeGram: 150, calories: 140, protein: 8, fat: 4, carbs: 19, allergens: [] },

    { name: 'Dưa hấu', category: 'dessert', servingSizeGram: 100, calories: 30, protein: 1, fat: 0, carbs: 7, allergens: [] },
    { name: 'Thanh long đỏ', category: 'dessert', servingSizeGram: 100, calories: 55, protein: 1, fat: 0, carbs: 13, allergens: [] },
    { name: 'Chuối tiêu', category: 'dessert', servingSizeGram: 80, calories: 72, protein: 1, fat: 0, carbs: 18, allergens: [] },

    { name: 'Sữa đậu nành', category: 'beverage', servingSizeGram: 150, calories: 90, protein: 6, fat: 4, carbs: 8, allergens: ['soy'] },
    { name: 'Sữa tươi tiệt trùng', category: 'beverage', servingSizeGram: 110, calories: 70, protein: 4, fat: 4, carbs: 5, allergens: ['milk'] },
    { name: 'Nước cam tươi', category: 'beverage', servingSizeGram: 150, calories: 65, protein: 1, fat: 0, carbs: 15, allergens: [] },

    { name: 'Cơm trắng', category: 'side_dish', servingSizeGram: 100, calories: 130, protein: 3, fat: 0, carbs: 28, allergens: [] },
    { name: 'Trứng hấp thịt', category: 'side_dish', servingSizeGram: 55, calories: 95, protein: 8, fat: 6, carbs: 2, allergens: ['egg'] },
    { name: 'Đậu phụ sốt thịt bằm', category: 'side_dish', servingSizeGram: 70, calories: 120, protein: 9, fat: 7, carbs: 5, allergens: ['soy'] }
];

async function seedNutritionDishes() {
    if (!process.env.MONGODB_URI) throw new Error('Thiếu MONGODB_URI trong file .env');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Kết nối MongoDB thành công');

    let inserted = 0;
    let existing = 0;
    for (const dish of SAMPLE_DISHES) {
        const result = await Dish.updateOne(
            { name: dish.name },
            { $setOnInsert: { ...dish, ageGroup: ['all'], status: 'active' } },
            { upsert: true }
        );
        if (result.upsertedCount) inserted += 1;
        else existing += 1;
    }

    const totals = await Dish.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
    console.log(`✅ Đã thêm ${inserted} món mới; bỏ qua ${existing} món đã tồn tại.`);
    console.table(totals.map((item) => ({ phanLoai: item._id, soMonDangHoatDong: item.count })));
}

seedNutritionDishes()
    .catch((error) => {
        console.error('❌ Seed danh mục món ăn thất bại:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
