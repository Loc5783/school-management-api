const fs = require('fs');
let controller = fs.readFileSync('backend/src/controllers/nutritionController.js', 'utf8');

const marker = `const getDishes = async (req, res) => {
    try {
        const { category, search } = req.query;
        const query = { status: 'active', ...buildTenantFilter(req) };
        if (category) query.category = category;
        if (search) query.name = { $regex: search, $options: 'i' };

        const dishes = await Dish.find(query).sort({ category: 1, name: 1 });
        res.json({ success: true, count: dishes.length, data: dishes });
    } catch (err) {
        res.status(500).json({ message: 'Không thể lấy danh sách món ăn' });
    }
};`;

const addition = `

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

controller = controller.replace(/\r\n/g, '\n');
const normalizedMarker = marker.replace(/\r\n/g, '\n');
if (controller.includes(normalizedMarker)) {
  controller = controller.replace(normalizedMarker, normalizedMarker + addition);
  fs.writeFileSync('backend/src/controllers/nutritionController.js', controller, 'utf8');
  console.log('Successfully inserted getDishById into nutritionController.js');
} else {
  console.log('Marker not found');
}
