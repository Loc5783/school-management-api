const fs = require('fs');

// 1. Update nutritionController.js
let controller = fs.readFileSync('backend/src/controllers/nutritionController.js', 'utf8');

const targetAfterGetDishes = `        const dishes = await Dish.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: dishes.length, data: dishes });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách món ăn' });
    }
};`;

const newGetDishById = `        const dishes = await Dish.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: dishes.length, data: dishes });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách món ăn' });
    }
};

const getDishById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'ID món ăn không hợp lệ' });
        }
        const dish = await Dish.findOne({ _id: req.params.id, ...buildTenantFilter(req) });
        if (!dish) return res.status(404).json({ message: 'Không tìm thấy món ăn' });
        res.json({ success: true, data: dish });
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server' });
    }
};`;

controller = controller.replace(targetAfterGetDishes, newGetDishById);
controller = controller.replace('    getDishes,\n    createDish,', '    getDishes,\n    getDishById,\n    createDish,');
controller = controller.replace('    getDishes,\r\n    createDish,', '    getDishes,\r\n    getDishById,\r\n    createDish,');
fs.writeFileSync('backend/src/controllers/nutritionController.js', controller, 'utf8');
console.log('nutritionController.js updated with getDishById');

// 2. Update schoolNutritionRoutes.js
let saasRoutes = fs.readFileSync('backend/src/saas/routes/schoolNutritionRoutes.js', 'utf8');
saasRoutes = saasRoutes.replace('    getDishes,\n    createDish,', '    getDishes,\n    getDishById,\n    createDish,');
saasRoutes = saasRoutes.replace('    getDishes,\r\n    createDish,', '    getDishes,\r\n    getDishById,\r\n    createDish,');

const oldDishMount = `router.get('/dishes', roleCheck(['admin', 'principal', 'chef', 'teacher']), getDishes);
router.post('/dishes', roleCheck(['admin', 'chef']), createDish);`;

const newDishMount = `router.get('/dishes', roleCheck(['admin', 'principal', 'chef', 'teacher']), getDishes);
router.get('/dishes/:id', roleCheck(['admin', 'principal', 'chef', 'teacher']), getDishById);
router.post('/dishes', roleCheck(['admin', 'chef']), createDish);`;

saasRoutes = saasRoutes.replace(oldDishMount, newDishMount);
fs.writeFileSync('backend/src/saas/routes/schoolNutritionRoutes.js', saasRoutes, 'utf8');
console.log('schoolNutritionRoutes.js updated with getDishById route');

// 3. Update legacy nutritionRoutes.js as well
let legacyRoutes = fs.readFileSync('backend/src/routes/nutritionRoutes.js', 'utf8');
legacyRoutes = legacyRoutes.replace('    getDishes,\n    createDish,', '    getDishes,\n    getDishById,\n    createDish,');
legacyRoutes = legacyRoutes.replace('    getDishes,\r\n    createDish,', '    getDishes,\r\n    getDishById,\r\n    createDish,');
legacyRoutes = legacyRoutes.replace(oldDishMount, newDishMount);
fs.writeFileSync('backend/src/routes/nutritionRoutes.js', legacyRoutes, 'utf8');
console.log('nutritionRoutes.js updated with getDishById route');
