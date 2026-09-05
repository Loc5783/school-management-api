import { useEffect, useState, useCallback } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';
import './NutritionManagement.css';
import {
  getWeeklyMenus,
  createMenu,
  updateMenu,
  getClassroomDietaryAlerts,
  getDishes,
  createDish,
  updateDish,
  deleteDish,
  getIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  getInventory,
  importInventoryStock,
  exportInventoryStock,
  getInventoryAlerts,
  getSuppliers,
  getEquipments,
  getFoodSamples,
  createFoodSample,
  disposeFoodSample,
  getFoodInspections,
  getDailyMealFinancials,
  getKitchenRequests,
  createKitchenRequest,
  approveKitchenRequest
} from '../api/nutrition';

const MENU_DAYS = [
  { key: 'monday', label: 'Thứ Hai' },
  { key: 'tuesday', label: 'Thứ Ba' },
  { key: 'wednesday', label: 'Thứ Tư' },
  { key: 'thursday', label: 'Thứ Năm' },
  { key: 'friday', label: 'Thứ Sáu' }
];

const ALLERGEN_OPTIONS = [
  { value: 'gluten', label: 'Gluten / lúa mì' },
  { value: 'crustacean', label: 'Giáp xác (tôm, cua)' },
  { value: 'fish', label: 'Cá' },
  { value: 'egg', label: 'Trứng' },
  { value: 'milk', label: 'Sữa' },
  { value: 'peanut', label: 'Đậu phộng' },
  { value: 'soy', label: 'Đậu nành' },
  { value: 'sesame', label: 'Mè / vừng' },
  { value: 'tree_nut', label: 'Hạt cây' },
  { value: 'mollusc', label: 'Nhuyễn thể' }
];

const DISH_CATEGORY_LABELS = {
  main_course: 'Món chính',
  stir_fry: 'Món rau / món xào',
  soup: 'Canh / súp',
  snack: 'Bữa phụ',
  dessert: 'Tráng miệng',
  beverage: 'Đồ uống',
  side_dish: 'Món kèm'
};

const createEmptyDishForm = () => ({
  name: '',
  category: 'main_course',
  calories: 180,
  protein: 15,
  fat: 6,
  carbs: 10,
  servingSizeGram: 100,
  allergens: []
});

const dateToInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonday = (value) => {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateToInput(date);
};

const addCalendarDays = (workDate, amount) => {
  const date = new Date(`${workDate}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return dateToInput(date);
};

const getIsoWeekNumber = (workDate) => {
  const date = new Date(`${workDate}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

const emptyMeal = () => ({ items: [] });
const createBlankMenu = (classroomId, startDate) => ({
  classroomId,
  startDate,
  dietaryType: 'standard',
  days: MENU_DAYS.map(({ key }) => ({
    dayOfWeek: key,
    breakfast: emptyMeal(),
    morningSnack: emptyMeal(),
    lunch: {
      mainDishes: [],
      stirFryDishes: [],
      soupDishes: [],
      desserts: []
    },
    afternoonSnack: emptyMeal()
  }))
});

const getMealCalories = (meal) => (
  Array.isArray(meal?.items) && meal.items.length
    ? meal.items.reduce((total, item) => total + Number(item.calories || 0), 0)
    : Number(meal?.calories || 0)
);

const getLunchCalories = (lunch) => {
  const groups = [
    lunch?.mainDishes || (lunch?.mainDish?.dishId ? [lunch.mainDish] : []),
    lunch?.stirFryDishes || (lunch?.stirFryDish?.dishId ? [lunch.stirFryDish] : []),
    lunch?.soupDishes || (lunch?.soupDish?.dishId ? [lunch.soupDish] : []),
    lunch?.desserts || (lunch?.dessert?.dishId ? [lunch.dessert] : [])
  ];
  return groups.flat().reduce((total, item) => total + Number(item.calories || 0), 0) || Number(lunch?.calories || 0);
};

const getDayCalories = (day) => (
  Number(day.totalCalories)
  || getMealCalories(day.breakfast)
    + getMealCalories(day.morningSnack)
    + getLunchCalories(day.lunch)
    + getMealCalories(day.afternoonSnack)
);

const getDishNames = (meal) => {
  const items = Array.isArray(meal?.items) && meal.items.length ? meal.items : (meal?.dishName ? [meal] : []);
  return items.map((item) => item.dishName).filter(Boolean).join(', ') || 'Chưa xếp';
};

const getLunchDishNames = (lunch, collectionKey, legacyKey) => {
  const items = Array.isArray(lunch?.[collectionKey]) && lunch[collectionKey].length
    ? lunch[collectionKey]
    : (lunch?.[legacyKey]?.dishName ? [lunch[legacyKey]] : []);
  return items.map((item) => item.dishName).filter(Boolean).join(', ') || '---';
};

const summarizeAvailableInventory = (inventoryLots = []) => Object.values(inventoryLots
  .filter((lot) => Number(lot.quantity) > 0)
  .reduce((summary, lot) => {
    const key = String(lot.ingredientId || lot.ingredientName);
    if (!summary[key]) {
      summary[key] = {
        key,
        ingredientName: lot.ingredientName,
        unit: lot.unit,
        quantity: 0,
        lots: 0,
        locations: new Set(),
        nearestExpiryDate: lot.expiryDate
      };
    }
    summary[key].quantity += Number(lot.quantity) || 0;
    summary[key].lots += 1;
    if (lot.storageLocation) summary[key].locations.add(lot.storageLocation);
    if (lot.expiryDate && (!summary[key].nearestExpiryDate || new Date(lot.expiryDate) < new Date(summary[key].nearestExpiryDate))) {
      summary[key].nearestExpiryDate = lot.expiryDate;
    }
    return summary;
  }, {}))
  .map((item) => ({ ...item, locations: [...item.locations].join(', ') }))
  .sort((left, right) => left.ingredientName.localeCompare(right.ingredientName, 'vi'));

const getSelectedMealDishIds = (meal) => (
  Array.isArray(meal?.items) && meal.items.length
    ? meal.items.map((item) => String(item.dishId))
    : (meal?.dishId ? [String(meal.dishId)] : [])
);

const getSelectedLunchDishIds = (lunch, collectionKey, legacyKey) => {
  const items = Array.isArray(lunch?.[collectionKey]) && lunch[collectionKey].length
    ? lunch[collectionKey]
    : (lunch?.[legacyKey]?.dishId ? [lunch[legacyKey]] : []);
  return items.map((item) => String(item.dishId));
};

const selectedValues = (event) => Array.from(event.target.selectedOptions, (option) => option.value);

function MealPlanFields({ day, onChange, getDishOptions }) {
  const field = (label, mealKey, categories, required = false) => (
    <label>
      {label}
      <select
        multiple
        size="3"
        value={mealKey.startsWith('lunch.')
          ? getSelectedLunchDishIds(day.lunch, mealKey.split('.')[1], {
            'lunch.mainDishes': 'mainDish',
            'lunch.stirFryDishes': 'stirFryDish',
            'lunch.soupDishes': 'soupDish',
            'lunch.desserts': 'dessert'
          }[mealKey])
          : getSelectedMealDishIds(day[mealKey])}
        onChange={(event) => onChange(mealKey, selectedValues(event))}
        required={required}
      >
        {getDishOptions(categories).map((dish) => (
          <option key={dish._id} value={dish._id}>{dish.name}</option>
        ))}
      </select>
      <small className="nutrition-multiselect-hint">Giữ Ctrl để chọn nhiều món</small>
    </label>
  );

  return (
    <div className="nutrition-menu-fields">
      {field('Bữa sáng', 'breakfast', ['main_course', 'snack', 'beverage', 'side_dish'], true)}
      {field('Phụ sáng', 'morningSnack', ['snack', 'beverage', 'dessert'], true)}
      {field('Món chính trưa', 'lunch.mainDishes', ['main_course'], true)}
      {field('Món rau / món xào', 'lunch.stirFryDishes', ['stir_fry', 'side_dish'])}
      {field('Canh / súp', 'lunch.soupDishes', ['soup'], true)}
      {field('Tráng miệng', 'lunch.desserts', ['dessert'])}
      {field('Bữa phụ chiều', 'afternoonSnack', ['snack', 'beverage', 'dessert'], true)}
    </div>
  );
}

function ClassroomDietaryAlertPanel({ alerts }) {
  if (!alerts.length) {
    return <div className="nutrition-class-alerts nutrition-class-alerts--clear">Không có hồ sơ dị ứng hoặc ghi chú y tế cần bếp lưu ý ở lớp này.</div>;
  }

  return (
    <section className="nutrition-class-alerts">
      <h4>Học sinh cần bếp lưu ý</h4>
      <p>Chuẩn bị suất thay thế hoặc xác nhận lại với y tế trường trước khi phục vụ.</p>
      <div>
        {alerts.map((student) => (
          <article key={student.studentId}>
            <strong>{student.studentName}</strong>
            {student.allergies?.length > 0 && (
              <span>Dị ứng: {student.allergies.map((allergy) => [allergy.allergen, allergy.severity, allergy.note].filter(Boolean).join(' - ')).join('; ')}</span>
            )}
            {student.medicalReviewRequired && <span>Y tế cần xem xét: {student.medicalNote}</span>}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function NutritionManagement() {
  const [activeTab, setActiveTab] = useState('menus'); // menus | dishes | inventory | equipment | safety | finance
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Data states
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedWeekStart] = useState(() => getMonday());
  const [currentMenu, setCurrentMenu] = useState(null);

  const [dishes, setDishes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [inventories, setInventories] = useState([]);
  const [inventoryAlerts, setInventoryAlerts] = useState({ expiringItems: [], lowStockAlerts: [] });
  const [suppliers, setSuppliers] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [foodSamples, setFoodSamples] = useState([]);
  const [foodInspections, setFoodInspections] = useState([]);
  const [financialReport, setFinancialReport] = useState(null);
  const [kitchenRequests, setKitchenRequests] = useState([]);
  const [classroomDietaryAlerts, setClassroomDietaryAlerts] = useState([]);
  const availableStockItems = summarizeAvailableInventory(inventories);

  // Modals / Form toggles
  const [showNewMenuModal, setShowNewMenuModal] = useState(false);
  const [showNewDishModal, setShowNewDishModal] = useState(false);
  const [showImportStockModal, setShowImportStockModal] = useState(false);
  const [showNewIngredientModal, setShowNewIngredientModal] = useState(false);
  const [showIngredientManager, setShowIngredientManager] = useState(false);
  const [showExportStockModal, setShowExportStockModal] = useState(false);
  const [showNewSampleModal, setShowNewSampleModal] = useState(false);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showEditDayModal, setShowEditDayModal] = useState(false);
  const [editingDayIndex, setEditingDayIndex] = useState(null);
  const [dailyMenuForm, setDailyMenuForm] = useState(null);

  // Form states
  const [newMenuForm, setNewMenuForm] = useState(() => createBlankMenu('', getMonday()));

  const [newDishForm, setNewDishForm] = useState(createEmptyDishForm);
  const [editingDishId, setEditingDishId] = useState(null);

  const [importStockForm, setImportStockForm] = useState({
    ingredientId: '',
    supplierName: '',
    quantity: '',
    costPerUnit: '',
    expiryDate: '',
    storageLocation: 'Kho lạnh 01'
  });

  const [newIngredientForm, setNewIngredientForm] = useState({
    name: '',
    category: 'vegetable',
    unit: 'kg',
    minStockAlert: 5,
    description: ''
  });
  const [editingIngredient, setEditingIngredient] = useState(null);

  const [exportStockForm, setExportStockForm] = useState({
    ingredientId: '',
    quantity: '',
    mealType: 'lunch',
    reason: 'Nấu ăn bán trú trưa'
  });

  const [newSampleForm, setNewSampleForm] = useState(() => ({
    sampleCode: `MAU-${Date.now().toString().slice(-6)}`,
    mealDate: new Date().toISOString().split('T')[0],
    mealType: 'lunch',
    dishName: '',
    sampleWeightGram: 100,
    storageTemperature: 4
  }));

  const [newRequestForm, setNewRequestForm] = useState(() => ({
    requestCode: `YC-${Date.now().toString().slice(-6)}`,
    requestType: 'ingredient_purchase',
    title: '',
    priority: 'medium',
    items: [{ name: '', quantity: 1, unit: 'kg', estimatedCost: 0 }]
  }));

  const showFeedback = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  };

  // 1. Tải danh sách lớp học
  useEffect(() => {
    const fetchClassrooms = async () => {
      try {
        const res = await api.get('/classrooms');
        const list = res.data.data || res.data || [];
        setClassrooms(list);
        if (list.length > 0 && !selectedClassId) {
          setSelectedClassId(list[0]._id);
          setNewMenuForm(createBlankMenu(list[0]._id, selectedWeekStart));
        }
      } catch (err) {
        console.error('Lỗi lấy lớp học:', err);
      }
    };
    fetchClassrooms();
  }, [selectedClassId, selectedWeekStart]);

  // 2. Tải dữ liệu tương ứng theo Tab
  const loadTabData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'menus') {
        const params = {};
        if (selectedClassId) params.classroomId = selectedClassId;
        if (selectedWeekStart) params.startDate = selectedWeekStart;
        const res = await getWeeklyMenus(params);
        const data = res.data.data || [];
        setCurrentMenu(data[0] || null);
      } else if (activeTab === 'dishes') {
        const [dRes, iRes] = await Promise.all([getDishes(), getIngredients()]);
        setDishes(dRes.data.data || []);
        setIngredients(iRes.data.data || []);
      } else if (activeTab === 'inventory') {
        const [invRes, alertRes, ingRes] = await Promise.all([
          getInventory(),
          getInventoryAlerts(),
          getIngredients()
        ]);
        setInventories(invRes.data.data || []);
        setInventoryAlerts(alertRes.data.data || { expiringItems: [], lowStockAlerts: [] });
        setIngredients(ingRes.data.data || []);
      } else if (activeTab === 'equipment') {
        const [eqRes, supRes] = await Promise.all([getEquipments(), getSuppliers()]);
        setEquipments(eqRes.data.data || []);
        setSuppliers(supRes.data.data || []);
      } else if (activeTab === 'safety') {
        const [sampleRes, inspRes] = await Promise.all([
          getFoodSamples(),
          getFoodInspections()
        ]);
        setFoodSamples(sampleRes.data.data || []);
        setFoodInspections(inspRes.data.data || []);
      } else if (activeTab === 'finance') {
        const [finRes, reqRes] = await Promise.all([
          getDailyMealFinancials(new Date().toISOString()),
          getKitchenRequests()
        ]);
        setFinancialReport(finRes.data.data || null);
        setKitchenRequests(reqRes.data.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải dữ liệu tab:', err);
      showFeedback('error', 'Không thể tải dữ liệu từ máy chủ');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedClassId, selectedWeekStart]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadTabData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTabData]);

  const openNewMenuModal = async () => {
    try {
      const [dishResponse, alertsResponse] = await Promise.all([
        getDishes(),
        selectedClassId ? getClassroomDietaryAlerts(selectedClassId) : Promise.resolve({ data: { data: [] } })
      ]);
      setDishes(dishResponse.data.data || []);
      setClassroomDietaryAlerts(alertsResponse.data.data || []);
      setNewMenuForm(createBlankMenu(selectedClassId, selectedWeekStart));
      setShowNewMenuModal(true);
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể tải danh mục món ăn');
    }
  };

  const changeMenuClassroom = async (classroomId) => {
    setNewMenuForm((previous) => ({ ...previous, classroomId }));
    try {
      const response = classroomId
        ? await getClassroomDietaryAlerts(classroomId)
        : { data: { data: [] } };
      setClassroomDietaryAlerts(response.data.data || []);
    } catch (err) {
      setClassroomDietaryAlerts([]);
      showFeedback('error', err.response?.data?.message || 'Không thể tải lưu ý dinh dưỡng của lớp');
    }
  };

  const updateMenuMeal = (dayIndex, mealKey, dishIds) => {
    setNewMenuForm((previous) => ({
      ...previous,
      days: previous.days.map((day, index) => {
        if (index !== dayIndex) return day;
        if (mealKey.startsWith('lunch.')) {
          const lunchKey = mealKey.split('.')[1];
          return {
            ...day,
            lunch: { ...day.lunch, [lunchKey]: dishIds.map((dishId) => ({ dishId })) }
          };
        }
        return { ...day, [mealKey]: { items: dishIds.map((dishId) => ({ dishId })) } };
      })
    }));
  };

  const updateDailyMenuMeal = (mealKey, dishIds) => {
    setDailyMenuForm((day) => {
      if (!day) return day;
      if (mealKey.startsWith('lunch.')) {
        const lunchKey = mealKey.split('.')[1];
        return { ...day, lunch: { ...day.lunch, [lunchKey]: dishIds.map((dishId) => ({ dishId })) } };
      }
      return { ...day, [mealKey]: { items: dishIds.map((dishId) => ({ dishId })) } };
    });
  };

  const getDishOptions = (categories) => dishes.filter((dish) => categories.includes(dish.category));

  const openDailyMenuEditor = async (dayIndex) => {
    if (!currentMenu?.days?.[dayIndex]) return;
    try {
      const [dishResponse, alertsResponse] = await Promise.all([
        getDishes(),
        getClassroomDietaryAlerts(currentMenu.classroomId)
      ]);
      setDishes(dishResponse.data.data || []);
      setClassroomDietaryAlerts(alertsResponse.data.data || []);
      setEditingDayIndex(dayIndex);
      setDailyMenuForm(currentMenu.days[dayIndex]);
      setShowEditDayModal(true);
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể tải dữ liệu chỉnh sửa thực đơn ngày');
    }
  };

  const handleSaveDailyMenu = async (e) => {
    e.preventDefault();
    if (!currentMenu || editingDayIndex === null || !dailyMenuForm) return;
    try {
      const days = currentMenu.days.map((day, index) => index === editingDayIndex ? dailyMenuForm : day);
      const response = await updateMenu(currentMenu._id, { days });
      setCurrentMenu(response.data.data);
      setShowEditDayModal(false);
      setDailyMenuForm(null);
      showFeedback('success', 'Đã cập nhật thực đơn của ngày được chọn và quét lại cảnh báo dị ứng.');
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể cập nhật thực đơn ngày');
    }
  };

  // Handler tạo thực đơn mới
  const handleCreateMenu = async (e) => {
    e.preventDefault();
    try {
      const requiredMealFields = [
        ['breakfast', 'bữa sáng'],
        ['morningSnack', 'bữa phụ sáng'],
        ['lunch.mainDishes', 'món chính buổi trưa'],
        ['lunch.soupDishes', 'canh / súp buổi trưa'],
        ['afternoonSnack', 'bữa phụ chiều']
      ];
      const incompleteDays = newMenuForm.days
        .filter((day) => requiredMealFields.some(([field]) => {
          const value = field.startsWith('lunch.')
            ? day.lunch?.[field.split('.')[1]]
            : day[field]?.items;
          return !value?.length;
        }))
        .map((day) => MENU_DAYS.find((entry) => entry.key === day.dayOfWeek)?.label || day.dayOfWeek);

      if (incompleteDays.length) {
        showFeedback('error', `Chưa đủ các bữa bắt buộc của: ${incompleteDays.join(', ')}`);
        return;
      }

      const res = await createMenu(newMenuForm);
      showFeedback(
        'success',
        res.data.allergyWarningsFound
          ? `Đã lưu bản nháp. Có ${res.data.allergyWarningsFound} cảnh báo dị ứng cần xử lý trước khi công bố.`
          : 'Đã lưu bản nháp thực đơn. Có thể gửi người phụ trách kiểm tra trước khi công bố.'
      );
      setShowNewMenuModal(false);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi khi tạo thực đơn');
    }
  };

  // Handler tạo món ăn mới
  const handleCreateDish = async (e) => {
    e.preventDefault();
    try {
      if (editingDishId) {
        await updateDish(editingDishId, newDishForm);
        showFeedback('success', 'Đã cập nhật món ăn.');
      } else {
        await createDish(newDishForm);
        showFeedback('success', 'Đã thêm món ăn mới vào danh mục!');
      }
      setShowNewDishModal(false);
      setEditingDishId(null);
      setNewDishForm(createEmptyDishForm());
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi khi tạo món ăn');
    }
  };

  const openEditDishModal = (dish) => {
    setEditingDishId(dish._id);
    setNewDishForm({
      name: dish.name || '',
      category: dish.category || 'main_course',
      calories: Number(dish.calories) || 0,
      protein: Number(dish.protein) || 0,
      fat: Number(dish.fat) || 0,
      carbs: Number(dish.carbs) || 0,
      servingSizeGram: Number(dish.servingSizeGram) || 100,
      allergens: dish.allergens || []
    });
    setShowNewDishModal(true);
  };

  const handleDeleteDish = async (dish) => {
    if (!window.confirm(`Xóa món “${dish.name}”?`)) return;
    try {
      const response = await deleteDish(dish._id);
      showFeedback('success', response.data.message);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể xóa món ăn');
    }
  };

  // Handler nhập kho
  const handleImportStock = async (e) => {
    e.preventDefault();
    const quantity = Number(importStockForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showFeedback('error', 'Số lượng nhập phải lớn hơn 0.');
      return;
    }
    try {
      await importInventoryStock({ ...importStockForm, quantity });
      showFeedback('success', 'Nhập kho thực phẩm thành công!');
      setShowImportStockModal(false);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi nhập kho');
    }
  };

  const handleCreateIngredient = async (e) => {
    e.preventDefault();
    try {
      const response = await createIngredient({
        ...newIngredientForm,
        minStockAlert: Number(newIngredientForm.minStockAlert) || 0
      });
      const ingredient = response.data.data;
      setIngredients((current) => [...current, ingredient].sort((left, right) => left.name.localeCompare(right.name, 'vi')));
      setImportStockForm((current) => ({ ...current, ingredientId: ingredient._id }));
      setNewIngredientForm({
        name: '', category: 'vegetable', unit: 'kg', minStockAlert: 5, description: ''
      });
      setShowNewIngredientModal(false);
      showFeedback('success', `Đã tạo danh mục nguyên liệu “${ingredient.name}”. Bạn có thể tiếp tục nhập lô hàng.`);
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể tạo nguyên liệu');
    }
  };

  const handleUpdateIngredient = async (e) => {
    e.preventDefault();
    if (!editingIngredient) return;
    try {
      await updateIngredient(editingIngredient._id, {
        name: editingIngredient.name,
        category: editingIngredient.category,
        unit: editingIngredient.unit,
        minStockAlert: Number(editingIngredient.minStockAlert),
        description: editingIngredient.description || ''
      });
      setEditingIngredient(null);
      showFeedback('success', 'Đã cập nhật nguyên liệu.');
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể cập nhật nguyên liệu');
    }
  };

  const handleDeleteIngredient = async (ingredient) => {
    if (!window.confirm(`Xóa nguyên liệu “${ingredient.name}”?`)) return;
    try {
      const response = await deleteIngredient(ingredient._id);
      showFeedback('success', response.data.message);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể xóa nguyên liệu');
    }
  };

  // Handler xuất kho
  const handleExportStock = async (e) => {
    e.preventDefault();
    try {
      await exportInventoryStock({
        ...exportStockForm,
        classroomId: selectedClassId
      });
      showFeedback('success', 'Xuất kho cho bếp nấu thành công!');
      setShowExportStockModal(false);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi xuất kho');
    }
  };

  // Handler lưu mẫu thức ăn
  const handleCreateSample = async (e) => {
    e.preventDefault();
    try {
      await createFoodSample(newSampleForm);
      showFeedback('success', `Đã lưu mẫu thức ăn 24h: ${newSampleForm.dishName}`);
      setShowNewSampleModal(false);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi lưu mẫu thức ăn');
    }
  };

  // Handler hủy mẫu thức ăn
  const handleDisposeSample = async (sampleId) => {
    if (!confirm('Xác nhận đã qua 24h lưu trữ an toàn và tiến hành hủy mẫu?')) return;
    try {
      await disposeFoodSample(sampleId, { status: 'disposed_normal', notes: 'Hủy mẫu định kỳ an toàn' });
      showFeedback('success', 'Đã ghi nhận hủy mẫu an toàn!');
      loadTabData();
    } catch {
      showFeedback('error', 'Lỗi hủy mẫu thức ăn');
    }
  };

  // Handler duyệt đề xuất nhà bếp
  const handleApproveRequest = async (requestId, status) => {
    try {
      await approveKitchenRequest(requestId, { status, approvalNotes: 'Đã xem xét và duyệt chi' });
      showFeedback('success', `Đã ${status === 'approved' ? 'duyệt' : 'từ chối'} đề xuất!`);
      loadTabData();
    } catch {
      showFeedback('error', 'Lỗi cập nhật phiếu đề xuất');
    }
  };

  // Handler tạo đề xuất mua sắm / sửa chữa cho bếp
  const handleCreateRequest = async (e) => {
    e.preventDefault();
    try {
      const items = newRequestForm.items
        .filter((item) => item.name.trim())
        .map((item) => ({
          ...item,
          name: item.name.trim(),
          quantity: Number(item.quantity) || 0,
          estimatedCost: Number(item.estimatedCost) || 0
        }));

      if (!items.length) {
        showFeedback('error', 'Vui lòng nhập ít nhất một hạng mục cần đề xuất');
        return;
      }

      await createKitchenRequest({ ...newRequestForm, items });
      showFeedback('success', 'Đã gửi đề xuất cho bộ phận phê duyệt!');
      setShowNewRequestModal(false);
      setNewRequestForm({
        requestCode: `YC-${Date.now().toString().slice(-6)}`,
        requestType: 'ingredient_purchase',
        title: '',
        priority: 'medium',
        items: [{ name: '', quantity: 1, unit: 'kg', estimatedCost: 0 }]
      });
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi gửi đề xuất');
    }
  };

  return (
    <AppShell
      title="Bếp Ăn & Dinh Dưỡng Bán Trú"
      subtitle="Quản lý thực đơn theo lớp, cảnh báo dị ứng/bệnh lý học sinh, kho thực phẩm, sổ kiểm thực 3 bước và tài chính suất ăn"
      actions={
        <div className="flex gap-2">
          {activeTab === 'menus' && (
            <button className="btn-primary" onClick={openNewMenuModal}>
              <Icon name="plus" size={16} /> Lập Thực Đơn Tuần
            </button>
          )}
          {activeTab === 'dishes' && (
            <button className="btn-primary" onClick={() => { setEditingDishId(null); setNewDishForm(createEmptyDishForm()); setShowNewDishModal(true); }}>
              <Icon name="plus" size={16} /> Thêm Món Ăn Mới
            </button>
          )}
          {activeTab === 'inventory' && (
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => { setEditingIngredient(null); setShowIngredientManager(true); }}>
                <Icon name="plus" size={16} /> Danh Mục Nguyên Liệu
              </button>
              <button className="btn-primary" onClick={() => setShowImportStockModal(true)}>
                <Icon name="plus" size={16} /> Nhập Kho
              </button>
              <button className="btn-secondary" onClick={() => setShowExportStockModal(true)}>
                Xuất Cho Bếp
              </button>
            </div>
          )}
          {activeTab === 'safety' && (
            <button className="btn-primary" onClick={() => setShowNewSampleModal(true)}>
              <Icon name="shield" size={16} /> Lưu Mẫu Thức Ăn 24h
            </button>
          )}
        </div>
      }
    >
      <div className="nutrition-module">
      {/* Alert Banner */}
      {message.text && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center justify-between text-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage({ type: '', text: '' })} className="font-bold ml-2">✕</button>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {[
          { key: 'menus', label: 'Thực Đơn Theo Lớp', icon: 'menu' },
          { key: 'dishes', label: 'Món Ăn & Dinh Dưỡng', icon: 'utensils' },
          { key: 'inventory', label: 'Kho Thực Phẩm & Date', icon: 'grid' },
          { key: 'equipment', label: 'Thiết Bị & Nhà Cung Cấp', icon: 'settings' },
          { key: 'safety', label: 'An Toàn & Kiểm Thực 3 Bước', icon: 'shield' },
          { key: 'finance', label: 'Tài Chính & Suất Ăn', icon: 'money' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 font-medium text-sm transition-all border-b-2 whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40 rounded-t-lg'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-10 text-gray-500 text-sm">
          <span className="inline-block animate-spin mr-2">⟳</span> Đang tải dữ liệu...
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 1: THỰC ĐƠN TUẦN THEO LỚP & DỊ ỨNG */}
      {/* ========================================== */}
      {activeTab === 'menus' && !loading && (
        <div>
          {/* Lọc Lớp & Tuần */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">CHỌN LỚP HỌC</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {classrooms.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name} ({c.ageGroup} tuổi)
                    </option>
                  ))}
                </select>
              </div>

            </div>
          </div>

          {/* CẢNH BÁO DỊ ỨNG & BỆNH LÝ CỦA HỌC SINH TRONG LỚP */}
          {currentMenu?.allergyWarnings && currentMenu.allergyWarnings.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-300 shadow-sm">
              <div className="flex items-center gap-2 text-amber-800 font-bold mb-2">
                <Icon name="alertCircle" size={18} className="text-amber-600" />
                <span>CẢNH BÁO NGUY CƠ DỊ ỨNG / BỆNH LÝ THEO THỰC ĐƠN LỚP ({currentMenu.allergyWarnings.length})</span>
              </div>
              <p className="text-xs text-amber-700 mb-3">
                Thực đơn của lớp đang chứa món ăn có thành phần trùng với tiền sử dị ứng hoặc bệnh lý của học sinh trong lớp này.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {currentMenu.allergyWarnings.map((w, idx) => (
                  <div key={idx} className="bg-white p-3 rounded-lg border border-amber-200 text-xs shadow-xs">
                    <p className="font-bold text-gray-800 text-sm">{w.studentName}</p>
                    <p className="text-rose-600 font-semibold mt-1">
                      Món xung đột: <span className="underline">{w.dishName}</span>
                    </p>
                    {w.allergenMatched && (
                      <p className="text-amber-800">
                        Chất dị ứng: <strong>{w.allergenMatched}</strong> ({w.severity || 'trung bình'})
                      </p>
                    )}
                    {w.diseaseMatched && (
                      <p className="text-amber-800">
                        Bệnh lý kiêng: <strong>{w.diseaseMatched}</strong>
                      </p>
                    )}
                    <p className="text-gray-500 mt-1">
                      Bữa: {w.mealType} - Thứ: {w.dayOfWeek}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chi tiết thực đơn tuần */}
          {currentMenu ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currentMenu.days.map((day, index) => (
                <div key={day.dayOfWeek} className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
                  <div className="bg-indigo-50/70 px-4 py-2.5 border-b border-indigo-100 flex justify-between items-center">
                    <span className="font-bold text-sm text-indigo-900 uppercase">
                      {day.dayOfWeek === 'monday'
                        ? 'Thứ Hai'
                        : day.dayOfWeek === 'tuesday'
                        ? 'Thứ Ba'
                        : day.dayOfWeek === 'wednesday'
                        ? 'Thứ Tư'
                        : day.dayOfWeek === 'thursday'
                        ? 'Thứ Năm'
                        : day.dayOfWeek === 'friday'
                        ? 'Thứ Sáu'
                        : 'Thứ Bảy'}
                    </span>
                    <span className="text-xs bg-indigo-200/60 text-indigo-800 px-2 py-0.5 rounded-full font-medium">
                      {getDayCalories(day)} Kcal
                    </span>
                  </div>

                  <div className="p-4 space-y-3 text-xs">
                    <div>
                      <span className="font-semibold text-gray-500 block mb-0.5">BỮA SÁNG (07:30)</span>
                      <p className="font-medium text-gray-800">{getDishNames(day.breakfast)}</p>
                    </div>

                    <div>
                      <span className="font-semibold text-gray-500 block mb-0.5">PHỤ SÁNG (09:00)</span>
                      <p className="font-medium text-gray-800">{getDishNames(day.morningSnack)}</p>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                      <span className="font-semibold text-indigo-700 block mb-1">BỮA TRƯA CHÍNH (10:45)</span>
                      <ul className="space-y-1 text-gray-700">
                        <li>• Món mặn: <strong>{getLunchDishNames(day.lunch, 'mainDishes', 'mainDish')}</strong></li>
                        <li>• Món rau / xào: <strong>{getLunchDishNames(day.lunch, 'stirFryDishes', 'stirFryDish')}</strong></li>
                        <li>• Món canh: <strong>{getLunchDishNames(day.lunch, 'soupDishes', 'soupDish')}</strong></li>
                        <li>• Tráng miệng: <strong>{getLunchDishNames(day.lunch, 'desserts', 'dessert')}</strong></li>
                      </ul>
                    </div>

                    <div>
                      <span className="font-semibold text-gray-500 block mb-0.5">XẾ CHIỀU (14:30)</span>
                      <p className="font-medium text-gray-800">{getDishNames(day.afternoonSnack)}</p>
                    </div>
                    <button type="button" className="nutrition-day-edit" onClick={() => openDailyMenuEditor(index)}>Cập nhật thực đơn ngày</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-12 text-center rounded-xl border border-gray-200">
              <p className="text-gray-500 mb-4">Lớp này chưa có thực đơn cho tuần đã chọn.</p>
              <button className="btn-primary inline-flex items-center gap-1 text-sm" onClick={openNewMenuModal}>
                <Icon name="plus" size={16} /> Lập Bản Nháp Thực Đơn
              </button>
            </div>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 2: MÓN ĂN & NGUYÊN LIỆU (DISHES) */}
      {/* ========================================== */}
      {activeTab === 'dishes' && !loading && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Danh Mục Món Ăn Bán Trú ({dishes.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="p-3">Tên Món Ăn</th>
                    <th className="p-3">Phân Loại</th>
                    <th className="p-3">Khẩu Phần</th>
                    <th className="p-3">Năng Lượng</th>
                    <th className="p-3">Đạm / Béo / Carb</th>
                    <th className="p-3">Dị Nguyên Khai Báo</th>
                    <th className="p-3">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {dishes.map((dish) => (
                    <tr key={dish._id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-gray-800">{dish.name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700">
                          {DISH_CATEGORY_LABELS[dish.category] || dish.category}
                        </span>
                      </td>
                      <td className="p-3 text-xs text-gray-500">{dish.servingSizeGram || 100} g / trẻ</td>
                      <td className="p-3 font-medium text-indigo-600">{dish.calories} kcal / khẩu phần</td>
                      <td className="p-3 text-xs text-gray-500">
                        {dish.protein}g / {dish.fat}g / {dish.carbs}g
                      </td>
                      <td className="p-3">
                        {dish.allergens && dish.allergens.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {dish.allergens.map((a, i) => (
                              <span key={i} className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full text-xs font-medium">
                                {a}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">Chưa khai báo</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => openEditDishModal(dish)}>Sửa</button>
                          <button type="button" className="text-xs font-semibold text-rose-600 hover:text-rose-800" onClick={() => handleDeleteDish(dish)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: KHO THỰC PHẨM & TỒN KHO */}
      {/* ========================================== */}
      {activeTab === 'inventory' && !loading && (
        <div className="space-y-6">
          {/* Thẻ Cảnh báo Hạn dùng & Hết hàng */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
              <h4 className="font-bold text-rose-900 text-sm mb-1">Cảnh Báo Cận Hạn Sử Dụng (≤ 3 ngày)</h4>
              <p className="text-xs text-rose-700 mb-2">
                Có <strong>{inventoryAlerts.expiringItems?.length || 0}</strong> lô hàng cần ưu tiên xuất chế biến hoặc hủy:
              </p>
              <ul className="text-xs space-y-1 text-rose-800">
                {inventoryAlerts.expiringItems?.slice(0, 3).map((it, idx) => (
                  <li key={idx}>• {it.ingredientName} (Lô: {it.batchNumber}) - HSD: {new Date(it.expiryDate).toLocaleDateString('vi-VN')}</li>
                ))}
                {!inventoryAlerts.expiringItems?.length && <li>• Không có lô nào cận hạn trong 3 ngày tới.</li>}
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <h4 className="font-bold text-amber-900 text-sm mb-1">Cảnh Báo Tồn Kho Thấp</h4>
              <p className="text-xs text-amber-700 mb-2">
                Có <strong>{inventoryAlerts.lowStockAlerts?.length || 0}</strong> nguyên liệu dưới ngưỡng an toàn:
              </p>
              <ul className="text-xs space-y-1 text-amber-800">
                {inventoryAlerts.lowStockAlerts?.slice(0, 3).map((it, idx) => (
                  <li key={idx}>• {it.name}: Còn {it.currentStock} {it.unit} (Ngưỡng tối thiểu: {it.minStockAlert})</li>
                ))}
                {!inventoryAlerts.lowStockAlerts?.length && <li>• Tất cả nguyên liệu đang đạt ngưỡng tồn tối thiểu.</li>}
              </ul>
            </div>
          </div>

          {/* Bảng tổng hợp toàn bộ mặt hàng còn tồn */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">Tất Cả Mặt Hàng Đang Có Trong Kho ({availableStockItems.length})</h3>
                <p className="text-xs text-gray-500 mt-1">Tổng hợp theo nguyên liệu; một mặt hàng có thể có nhiều lô và hạn dùng khác nhau.</p>
              </div>
              <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => setShowNewIngredientModal(true)}>
                + Thêm nguyên liệu
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="p-3">Nguyên Liệu</th>
                    <th className="p-3">Tổng Tồn</th>
                    <th className="p-3">Số Lô Còn Tồn</th>
                    <th className="p-3">Hạn Gần Nhất</th>
                    <th className="p-3">Vị Trí Bảo Quản</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {availableStockItems.map((item) => (
                    <tr key={item.key} className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-gray-800">{item.ingredientName}</td>
                      <td className="p-3 font-bold text-indigo-700">{item.quantity} {item.unit}</td>
                      <td className="p-3 text-xs">{item.lots} lô</td>
                      <td className="p-3 text-xs">{item.nearestExpiryDate ? new Date(item.nearestExpiryDate).toLocaleDateString('vi-VN') : 'Chưa có'}</td>
                      <td className="p-3 text-xs text-gray-500">{item.locations || 'Chưa khai báo'}</td>
                    </tr>
                  ))}
                  {!availableStockItems.length && (
                    <tr><td colSpan="5" className="p-4 text-center text-xs text-gray-500">Chưa có mặt hàng nào còn tồn trong kho.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bảng chi tiết theo từng lô */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Chi Tiết Lô Hàng Trong Kho ({inventories.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="p-3">Nguyên Liệu</th>
                    <th className="p-3">Số Lô</th>
                    <th className="p-3">Số Lượng Tồn</th>
                    <th className="p-3">Đơn Giá Nhập</th>
                    <th className="p-3">Hạn Sử Dụng</th>
                    <th className="p-3">Vị Trí Bảo Quản</th>
                    <th className="p-3">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventories.map((inv) => (
                    <tr key={inv._id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-gray-800">{inv.ingredientName}</td>
                      <td className="p-3 font-mono text-xs">{inv.batchNumber}</td>
                      <td className="p-3 font-bold text-indigo-700">{inv.quantity} {inv.unit}</td>
                      <td className="p-3 text-xs">{inv.costPerUnit?.toLocaleString('vi-VN')} đ</td>
                      <td className="p-3 text-xs font-medium">
                        {new Date(inv.expiryDate).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="p-3 text-xs text-gray-500">{inv.storageLocation}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            inv.status === 'available'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {inv.status === 'available' ? 'Sẵn sàng' : 'Cận hạn / Hết'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!inventories.length && (
                    <tr><td colSpan="7" className="p-4 text-center text-xs text-gray-500">Chưa có lô hàng nào được nhập kho.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 4: THIẾT BỊ BẾP & NHÀ CUNG CẤP */}
      {/* ========================================== */}
      {activeTab === 'equipment' && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Thiết bị bếp */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Thiết Bị Chung Nhà Bếp ({equipments.length})</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {equipments.map((eq) => (
                <div key={eq._id} className="p-4 flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-gray-800 text-sm">{eq.name}</h5>
                    <p className="text-xs text-gray-500">Mã: {eq.code} | Vị trí: {eq.location}</p>
                    <p className="text-xs text-indigo-600 mt-1">
                      Bảo trì gần nhất: {eq.maintenanceLogs?.length ? eq.maintenanceLogs[eq.maintenanceLogs.length - 1].description : 'Chưa có'}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      eq.condition === 'good'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {eq.condition === 'good' ? 'Hoạt động tốt' : 'Cần bảo dưỡng'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Nhà cung cấp thực phẩm */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Nhà Cung Cấp Thực Phẩm & VSATTP ({suppliers.length})</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {suppliers.map((sup) => (
                <div key={sup._id} className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h5 className="font-bold text-gray-800 text-sm">{sup.name}</h5>
                      <p className="text-xs text-gray-500">Mã: {sup.code} | SĐT: {sup.phone}</p>
                      <p className="text-xs text-emerald-700 font-medium mt-1">
                        Chứng nhận ATTP: {sup.foodSafetyCert?.certNumber || 'Đang cập nhật'}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 font-semibold rounded">
                      ⭐ {sup.rating}/5
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 5: AN TOÀN THỰC PHẨM & KIỂM THỰC 3 BƯỚC */}
      {/* ========================================== */}
      {activeTab === 'safety' && !loading && (
        <div className="space-y-6">
          {/* Sổ lưu mẫu thức ăn 24h */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">Sổ Lưu Mẫu Thức Ăn 24 Giờ (Quy chuẩn Bộ Y tế)</h3>
                <p className="text-xs text-gray-500">Nhiệt độ lưu trữ: 2-8°C | Định lượng: ≥100g thức ăn đặc, ≥150ml chất lỏng</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="p-3">Mã Mẫu</th>
                    <th className="p-3">Món Ăn</th>
                    <th className="p-3">Bữa Ăn</th>
                    <th className="p-3">Khối Lượng</th>
                    <th className="p-3">Nhiệt Độ Lưu</th>
                    <th className="p-3">Người Lưu</th>
                    <th className="p-3">Trạng Thái</th>
                    <th className="p-3">Hành Động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {foodSamples.map((s) => (
                    <tr key={s._id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-mono text-xs">{s.sampleCode}</td>
                      <td className="p-3 font-semibold text-gray-800">{s.dishName}</td>
                      <td className="p-3 text-xs">{s.mealType}</td>
                      <td className="p-3 text-xs">{s.sampleWeightGram}g</td>
                      <td className="p-3 text-xs font-semibold text-indigo-600">{s.storageTemperature}°C</td>
                      <td className="p-3 text-xs text-gray-500">{s.storedByName}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            s.status === 'stored'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {s.status === 'stored' ? 'Đang lưu 24h' : 'Đã hủy an toàn'}
                        </span>
                      </td>
                      <td className="p-3">
                        {s.status === 'stored' && (
                          <button
                            onClick={() => handleDisposeSample(s._id)}
                            className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
                          >
                            Hủy mẫu (Hết 24h)
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sổ kiểm thực 3 bước */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-800 text-sm">Sổ Kiểm Thực 3 Bước (QĐ 1246/QĐ-BYT)</h3>
              <p className="text-xs text-gray-500">Bước 1: Nhập nguyên liệu | Bước 2: Chế biến | Bước 3: Trước khi ăn</p>
            </div>
            <div className="divide-y divide-gray-200">
              {foodInspections.map((insp) => (
                <div key={insp._id} className="p-4 text-xs space-y-2">
                  <div className="flex justify-between font-bold text-sm text-gray-800">
                    <span>Ngày kiểm tra: {new Date(insp.mealDate).toLocaleDateString('vi-VN')} ({insp.mealType})</span>
                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Người kiểm tra: {insp.inspectorName}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                    <div className="bg-gray-50 p-2 rounded">
                      <strong className="block text-gray-700 mb-1">Bước 1: Nguyên Liệu Đầu Vào</strong>
                      <p>Số mặt hàng: {insp.step1_rawIngredients?.length || 0}</p>
                      <p className="text-emerald-600 font-medium">Đạt cảm quan & nguồn gốc</p>
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <strong className="block text-gray-700 mb-1">Bước 2: Trong Chế Biến</strong>
                      <p>Vệ sinh bếp: {insp.step2_processing?.kitchenHygiene}</p>
                      <p>Bảo hộ nhân viên: {insp.step2_processing?.staffHygiene}</p>
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <strong className="block text-gray-700 mb-1">Bước 3: Trước Khi Ăn</strong>
                      <p>Lưu mẫu: {insp.step3_serving?.foodSampleStored ? 'Đã lưu mẫu' : 'Chưa lưu'}</p>
                      <p className="font-bold text-indigo-700">Quyết định: Cho phép ăn</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 6: TÀI CHÍNH NHÀ ĂN & ĐỀ XUẤT MUA SẮM */}
      {/* ========================================== */}
      {activeTab === 'finance' && !loading && (
        <div className="space-y-6">
          {/* Báo cáo tài chính hôm nay */}
          {financialReport && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
                <span className="text-xs text-gray-500 font-semibold block mb-1">HỌC SINH CÓ MẶT THỰC TẾ</span>
                <span className="text-2xl font-bold text-indigo-700">{financialReport.totalStudentsPresent}</span>
                <p className="text-xs text-gray-400 mt-1">Từ dữ liệu điểm danh hôm nay</p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
                <span className="text-xs text-gray-500 font-semibold block mb-1">ĐỊNH MỨC THU TIỀN ĂN</span>
                <span className="text-2xl font-bold text-gray-800">
                  {financialReport.standardMealRatePerStudent?.toLocaleString('vi-VN')} đ
                </span>
                <p className="text-xs text-gray-400 mt-1">35.000 đ / học sinh / ngày</p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
                <span className="text-xs text-gray-500 font-semibold block mb-1">CHI PHÍ NGUYÊN LIỆU THỰC TẾ</span>
                <span className="text-2xl font-bold text-rose-600">
                  {financialReport.totalIngredientCost?.toLocaleString('vi-VN')} đ
                </span>
                <p className="text-xs text-gray-400 mt-1">{financialReport.exportTransactionsCount} lần xuất kho</p>
              </div>

              <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
                <span className="text-xs text-gray-500 font-semibold block mb-1">CHÊNH LỆCH NGÂN SÁCH</span>
                <span
                  className={`text-2xl font-bold ${
                    financialReport.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {financialReport.balance?.toLocaleString('vi-VN')} đ
                </span>
                <p className="text-xs text-gray-400 mt-1">Doanh thu suất ăn - Chi phí mua</p>
              </div>
            </div>
          )}

          {/* Đề xuất mua sắm & Duyệt kinh phí */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Đề Xuất Mua Sắm & Dự Trù Chi Phí Bếp</h3>
              <button className="btn-primary text-xs" onClick={() => setShowNewRequestModal(true)}>
                <Icon name="plus" size={14} /> Tạo Đề Xuất Mới
              </button>
            </div>
            <div className="divide-y divide-gray-200">
              {kitchenRequests.map((req) => (
                <div key={req._id} className="p-4 flex flex-wrap justify-between items-center gap-2 text-sm">
                  <div>
                    <h5 className="font-bold text-gray-800">{req.title}</h5>
                    <p className="text-xs text-gray-500">
                      Mã: {req.requestCode} | Người đề xuất: {req.requestedByName} | Ước tính:{' '}
                      <span className="font-bold text-indigo-600">
                        {req.totalEstimatedCost?.toLocaleString('vi-VN')} đ
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        req.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'rejected'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {req.status === 'approved' ? 'Đã duyệt' : req.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}
                    </span>
                    {req.status === 'pending' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleApproveRequest(req._id, 'approved')}
                          className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700"
                        >
                          Duyệt
                        </button>
                        <button
                          onClick={() => handleApproveRequest(req._id, 'rejected')}
                          className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300"
                        >
                          Từ chối
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: THÊM THỰC ĐƠN TUẦN */}
      {/* ========================================== */}
      {showNewMenuModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl nutrition-menu-modal w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <p className="card-kicker mb-1">BẢN NHÁP VẬN HÀNH BẾP</p>
            <h3 className="font-bold text-gray-900 text-lg">Lập Thực Đơn Tuần Theo Danh Mục Món</h3>
            <p className="nutrition-modal-note">Món ăn phải được chọn từ danh mục đã phê duyệt. Hệ thống tính lại năng lượng và quét dị nguyên theo hồ sơ học sinh khi lưu.</p>
            <form onSubmit={handleCreateMenu} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">LỚP ÁP DỤNG</label>
                  <select
                    value={newMenuForm.classroomId}
                    onChange={(e) => changeMenuClassroom(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">-- Chọn lớp --</option>
                    {classrooms.map((c) => (
                      <option key={c._id} value={c._id}>{c.name} ({c.ageGroup} tuổi)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">THỨ HAI BẮT ĐẦU TUẦN</label>
                  <input
                    type="date"
                    value={newMenuForm.startDate}
                    onChange={(e) => setNewMenuForm({ ...newMenuForm, startDate: getMonday(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Hệ thống tự xác định tuần {getIsoWeekNumber(newMenuForm.startDate)} và niên học.</p>
                </div>
              </div>

              {dishes.length === 0 ? (
                <div className="nutrition-empty-catalog">
                  Chưa có món ăn hoạt động trong danh mục. Hãy tạo và phê duyệt món ăn trước khi lập thực đơn.
                </div>
              ) : (
                <div className="nutrition-menu-builder">
                  {newMenuForm.days.map((day, index) => {
                    const dayInfo = MENU_DAYS.find((entry) => entry.key === day.dayOfWeek);
                    return (
                      <section key={day.dayOfWeek} className="nutrition-menu-day">
                        <header>
                          <strong>{dayInfo?.label}</strong>
                          <span>{addCalendarDays(newMenuForm.startDate, index)}</span>
                        </header>
                        <MealPlanFields
                          day={day}
                          getDishOptions={getDishOptions}
                          onChange={(mealKey, dishIds) => updateMenuMeal(index, mealKey, dishIds)}
                        />
                      </section>
                    );
                  })}
                </div>
              )}

              <div className="nutrition-safety-note">
                Không nhập dị ứng bằng ghi chú theo lớp. Cảnh báo chỉ lấy từ hồ sơ học sinh và dị nguyên đã chuẩn hóa của món ăn; hồ sơ bệnh lý cần chỉ định dinh dưỡng được phê duyệt riêng.
              </div>
              <ClassroomDietaryAlertPanel alerts={classroomDietaryAlerts} />

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowNewMenuModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary" disabled={!dishes.length}>Lưu Bản Nháp & Quét Dị Nguyên</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: CẬP NHẬT THỰC ĐƠN THEO NGÀY */}
      {/* ========================================== */}
      {showEditDayModal && dailyMenuForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl nutrition-menu-modal w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <p className="card-kicker mb-1">CẬP NHẬT VẬN HÀNH THEO NGÀY</p>
            <h3 className="font-bold text-gray-900 text-lg">{MENU_DAYS.find((entry) => entry.key === dailyMenuForm.dayOfWeek)?.label} — Thực Đơn Phục Vụ</h3>
            <p className="nutrition-modal-note">Thay đổi chỉ áp dụng cho ngày này. Năng lượng và cảnh báo dị ứng sẽ được tính lại trước khi lưu.</p>
            <form onSubmit={handleSaveDailyMenu} className="space-y-4 text-sm">
              <section className="nutrition-menu-day">
                <header>
                  <strong>{MENU_DAYS.find((entry) => entry.key === dailyMenuForm.dayOfWeek)?.label}</strong>
                  <span>{dailyMenuForm.date ? dateToInput(new Date(dailyMenuForm.date)) : ''}</span>
                </header>
                <MealPlanFields day={dailyMenuForm} getDishOptions={getDishOptions} onChange={updateDailyMenuMeal} />
              </section>
              <ClassroomDietaryAlertPanel alerts={classroomDietaryAlerts} />
              <div className="nutrition-safety-note">
                Nếu có cảnh báo, bếp phải bố trí suất thay thế và đánh dấu đã xử lý trước khi công bố thực đơn.
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => { setShowEditDayModal(false); setDailyMenuForm(null); }} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Lưu Thực Đơn Ngày</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: THÊM MÓN ĂN MỚI */}
      {/* ========================================== */}
      {showNewDishModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-4">{editingDishId ? 'Cập Nhật Món Ăn' : 'Thêm Món Ăn Mới'}</h3>
            <form onSubmit={handleCreateDish} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">TÊN MÓN ĂN</label>
                <input
                  type="text"
                  value={newDishForm.name}
                  onChange={(e) => setNewDishForm({ ...newDishForm, name: e.target.value })}
                  placeholder="Ví dụ: Canh chua cá lóc"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">PHÂN LOẠI</label>
                <select
                  value={newDishForm.category}
                  onChange={(e) => setNewDishForm({ ...newDishForm, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="main_course">Món mặn chính</option>
                  <option value="stir_fry">Món xào</option>
                  <option value="soup">Món canh</option>
                  <option value="dessert">Tráng miệng</option>
                  <option value="snack">Bữa phụ</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">KHẨU PHẦN THAM CHIẾU (G / TRẺ)</label>
                  <input
                    type="number"
                    min="1"
                    value={newDishForm.servingSizeGram}
                    onChange={(e) => setNewDishForm({ ...newDishForm, servingSizeGram: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">NĂNG LƯỢNG (KCAL / KHẨU PHẦN)</label>
                  <input
                    type="number"
                    min="0"
                    value={newDishForm.calories}
                    onChange={(e) => setNewDishForm({ ...newDishForm, calories: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-gray-600">ĐẠM (G / KHẨU PHẦN)
                  <input type="number" min="0" value={newDishForm.protein} onChange={(e) => setNewDishForm({ ...newDishForm, protein: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg mt-1" />
                </label>
                <label className="block text-xs font-semibold text-gray-600">CHẤT BÉO (G / KHẨU PHẦN)
                  <input type="number" min="0" value={newDishForm.fat} onChange={(e) => setNewDishForm({ ...newDishForm, fat: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg mt-1" />
                </label>
                <label className="block text-xs font-semibold text-gray-600">CARBOHYDRATE (G / KHẨU PHẦN)
                  <input type="number" min="0" value={newDishForm.carbs} onChange={(e) => setNewDishForm({ ...newDishForm, carbs: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg mt-1" />
                </label>
              </div>

              <fieldset className="nutrition-allergen-fieldset">
                <legend>DỊ NGUYÊN CÓ TRONG MÓN (THEO CÔNG THỨC)</legend>
                <p>Chỉ tích khi công thức thực sự có thành phần này. Không nhập nguyên liệu thông thường như sườn, rau hoặc cơm.</p>
                <div className="nutrition-allergen-options">
                  {ALLERGEN_OPTIONS.map((allergen) => (
                    <label key={allergen.value}>
                      <input
                        type="checkbox"
                        checked={newDishForm.allergens.includes(allergen.value)}
                        onChange={(e) => setNewDishForm({
                          ...newDishForm,
                          allergens: e.target.checked
                            ? [...newDishForm.allergens, allergen.value]
                            : newDishForm.allergens.filter((value) => value !== allergen.value)
                        })}
                      />
                      {allergen.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => { setShowNewDishModal(false); setEditingDishId(null); setNewDishForm(createEmptyDishForm()); }} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">{editingDishId ? 'Lưu thay đổi' : 'Lưu Món Ăn'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: QUẢN LÝ DANH MỤC NGUYÊN LIỆU */}
      {/* ========================================== */}
      {showIngredientManager && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl nutrition-menu-modal w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="card-kicker mb-1">DANH MỤC DÙNG CHUNG</p>
                <h3 className="font-bold text-gray-900 text-lg">Quản Lý Nguyên Liệu ({ingredients.length})</h3>
              </div>
              {!editingIngredient && (
                <button type="button" className="btn-primary" onClick={() => { setShowIngredientManager(false); setShowNewIngredientModal(true); }}>
                  <Icon name="plus" size={16} /> Thêm nguyên liệu
                </button>
              )}
            </div>

            {editingIngredient ? (
              <form onSubmit={handleUpdateIngredient} className="space-y-4 text-sm">
                <p className="nutrition-modal-note">Chỉnh sửa thông tin danh mục. Mã nội bộ không thay đổi để bảo toàn liên kết dữ liệu kho.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">TÊN NGUYÊN LIỆU</label>
                    <input type="text" value={editingIngredient.name} onChange={(e) => setEditingIngredient({ ...editingIngredient, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">NGƯỠNG CẢNH BÁO TỒN</label>
                    <input type="number" min="0" value={editingIngredient.minStockAlert} onChange={(e) => setEditingIngredient({ ...editingIngredient, minStockAlert: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">NHÓM NGUYÊN LIỆU</label>
                    <select value={editingIngredient.category} onChange={(e) => setEditingIngredient({ ...editingIngredient, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                      <option value="meat">Thịt</option><option value="seafood">Thủy hải sản</option><option value="vegetable">Rau củ</option><option value="fruit">Trái cây</option><option value="dry_grain">Gạo / ngũ cốc</option><option value="dairy">Sữa</option><option value="spice">Gia vị</option><option value="other">Khác</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">ĐƠN VỊ QUẢN LÝ KHO</label>
                    <select value={editingIngredient.unit} onChange={(e) => setEditingIngredient({ ...editingIngredient, unit: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                      <option value="kg">kg</option><option value="g">g</option><option value="l">lít</option><option value="ml">ml</option><option value="piece">cái / quả</option><option value="box">hộp</option><option value="can">lon</option><option value="pack">gói</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">GHI CHÚ</label>
                  <textarea rows="3" value={editingIngredient.description || ''} onChange={(e) => setEditingIngredient({ ...editingIngredient, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <button type="button" onClick={() => setEditingIngredient(null)} className="btn-secondary">Quay lại</button>
                  <button type="submit" className="btn-primary">Lưu thay đổi</button>
                </div>
              </form>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <tr><th className="p-3">Nguyên Liệu</th><th className="p-3">Nhóm</th><th className="p-3">Đơn Vị</th><th className="p-3">Ngưỡng Tồn</th><th className="p-3">Thao Tác</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {ingredients.map((ingredient) => (
                      <tr key={ingredient._id} className="hover:bg-gray-50/50">
                        <td className="p-3 font-semibold text-gray-800">{ingredient.name}</td>
                        <td className="p-3 text-xs">{ingredient.category}</td>
                        <td className="p-3 text-xs">{ingredient.unit}</td>
                        <td className="p-3 text-xs">{ingredient.minStockAlert}</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => setEditingIngredient({ ...ingredient })}>Sửa</button>
                            <button type="button" className="text-xs font-semibold text-rose-600 hover:text-rose-800" onClick={() => handleDeleteIngredient(ingredient)}>Xóa</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!ingredients.length && <tr><td colSpan="5" className="p-4 text-center text-xs text-gray-500">Chưa có nguyên liệu đang hoạt động.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            {!editingIngredient && (
              <div className="flex justify-end pt-4 border-t mt-4">
                <button type="button" onClick={() => setShowIngredientManager(false)} className="btn-secondary">Đóng</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: TẠO DANH MỤC NGUYÊN LIỆU */}
      {/* ========================================== */}
      {showNewIngredientModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <p className="card-kicker mb-1">DANH MỤC DÙNG CHUNG</p>
            <h3 className="font-bold text-gray-900 text-lg mb-2">Thêm Nguyên Liệu Chuẩn</h3>
            <p className="nutrition-modal-note">Tạo một lần, sau đó các phiếu nhập kho chỉ chọn nguyên liệu và ghi nhận từng lô, hạn dùng, giá nhập.</p>
            <form onSubmit={handleCreateIngredient} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">TÊN NGUYÊN LIỆU</label>
                <input type="text" value={newIngredientForm.name} onChange={(e) => setNewIngredientForm({ ...newIngredientForm, name: e.target.value })} placeholder="Ví dụ: Cải ngọt" className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                <p className="nutrition-modal-note">Mã danh mục được hệ thống tự tạo để phục vụ quản lý nội bộ.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">NHÓM NGUYÊN LIỆU</label>
                  <select value={newIngredientForm.category} onChange={(e) => setNewIngredientForm({ ...newIngredientForm, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="meat">Thịt</option><option value="seafood">Thủy hải sản</option><option value="vegetable">Rau củ</option><option value="fruit">Trái cây</option><option value="dry_grain">Gạo / ngũ cốc</option><option value="dairy">Sữa</option><option value="spice">Gia vị</option><option value="other">Khác</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ĐƠN VỊ QUẢN LÝ KHO</label>
                  <select value={newIngredientForm.unit} onChange={(e) => setNewIngredientForm({ ...newIngredientForm, unit: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="kg">kg</option><option value="g">g</option><option value="l">lít</option><option value="ml">ml</option><option value="piece">cái / quả</option><option value="box">hộp</option><option value="can">lon</option><option value="pack">gói</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">NGƯỠNG CẢNH BÁO TỒN</label>
                <input type="number" min="0" value={newIngredientForm.minStockAlert} onChange={(e) => setNewIngredientForm({ ...newIngredientForm, minStockAlert: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowNewIngredientModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Lưu Danh Mục</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: NHẬP KHO THỰC PHẨM */}
      {/* ========================================== */}
      {showImportStockModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-4">Nhập Kho Nguyên Liệu</h3>
            <form onSubmit={handleImportStock} className="space-y-4 text-sm">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-semibold text-gray-600">NGUYÊN LIỆU</label>
                  <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => setShowNewIngredientModal(true)}>
                    + Tạo nguyên liệu mới
                  </button>
                </div>
                <select
                  value={importStockForm.ingredientId}
                  onChange={(e) => setImportStockForm({ ...importStockForm, ingredientId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">-- Chọn nguyên liệu --</option>
                  {ingredients.map((ing) => (
                    <option key={ing._id} value={ing._id}>{ing.name} ({ing.unit})</option>
                  ))}
                </select>
                {!ingredients.length && <p className="text-xs text-amber-700 mt-1">Chưa có danh mục nguyên liệu. Hãy tạo nguyên liệu trước khi nhập lô hàng.</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">NHÀ CUNG CẤP</label>
                  <input
                    type="text"
                    value={importStockForm.supplierName}
                    onChange={(e) => setImportStockForm({ ...importStockForm, supplierName: e.target.value })}
                    placeholder="Ví dụ: Công ty Thực phẩm sạch"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">SỐ LƯỢNG NHẬP</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={importStockForm.quantity}
                    onChange={(e) => setImportStockForm({ ...importStockForm, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ĐƠN GIÁ (VNĐ)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={importStockForm.costPerUnit}
                    onChange={(e) => setImportStockForm({ ...importStockForm, costPerUnit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">HẠN SỬ DỤNG</label>
                  <input
                    type="date"
                    value={importStockForm.expiryDate}
                    onChange={(e) => setImportStockForm({ ...importStockForm, expiryDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowImportStockModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Nhập Kho</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: XUẤT KHO THỰC PHẨM */}
      {/* ========================================== */}
      {showExportStockModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-4">Xuất Kho Cho Bếp Chế Biến</h3>
            <form onSubmit={handleExportStock} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">NGUYÊN LIỆU CẦN XUẤT</label>
                <select
                  value={exportStockForm.ingredientId}
                  onChange={(e) => setExportStockForm({ ...exportStockForm, ingredientId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">-- Chọn nguyên liệu --</option>
                  {ingredients.map((ing) => (
                    <option key={ing._id} value={ing._id}>{ing.name} ({ing.unit})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SỐ LƯỢNG XUẤT</label>
                <input
                  type="number"
                  value={exportStockForm.quantity}
                  onChange={(e) => setExportStockForm({ ...exportStockForm, quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowExportStockModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Xuất Kho</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: LƯU MẪU THỨC ĂN 24H */}
      {/* ========================================== */}
      {showNewSampleModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-4">Ghi Nhận Lưu Mẫu Thức Ăn 24H</h3>
            <form onSubmit={handleCreateSample} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">MÃ MẪU LƯU</label>
                <input
                  type="text"
                  value={newSampleForm.sampleCode}
                  onChange={(e) => setNewSampleForm({ ...newSampleForm, sampleCode: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">TÊN MÓN ĂN LƯU MẪU</label>
                <input
                  type="text"
                  value={newSampleForm.dishName}
                  onChange={(e) => setNewSampleForm({ ...newSampleForm, dishName: e.target.value })}
                  placeholder="Ví dụ: Thịt kho trứng cút"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">BỮA ĂN</label>
                  <select
                    value={newSampleForm.mealType}
                    onChange={(e) => setNewSampleForm({ ...newSampleForm, mealType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="breakfast">Bữa sáng</option>
                    <option value="lunch">Bữa trưa</option>
                    <option value="afternoonSnack">Xế chiều</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">TRỌNG LƯỢNG (GRAM)</label>
                  <input
                    type="number"
                    value={newSampleForm.sampleWeightGram}
                    onChange={(e) => setNewSampleForm({ ...newSampleForm, sampleWeightGram: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowNewSampleModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Niêm Phong & Lưu Mẫu</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: TẠO ĐỀ XUẤT NHÀ BẾP */}
      {/* ========================================== */}
      {showNewRequestModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-semibold tracking-wide text-indigo-600 uppercase">Phiếu nội bộ</p>
                <h3 className="font-bold text-gray-900 text-lg">Tạo đề xuất cho bếp</h3>
              </div>
              <button type="button" onClick={() => setShowNewRequestModal(false)} className="text-gray-400 hover:text-gray-700 text-xl" aria-label="Đóng">×</button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">LOẠI ĐỀ XUẤT</label>
                  <select
                    value={newRequestForm.requestType}
                    onChange={(e) => setNewRequestForm({ ...newRequestForm, requestType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="ingredient_purchase">Mua nguyên liệu</option>
                    <option value="equipment_repair">Sửa thiết bị</option>
                    <option value="equipment_new">Mua thiết bị mới</option>
                    <option value="special_diet">Suất ăn đặc biệt</option>
                    <option value="cleaning_supplies">Vật tư vệ sinh</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">MỨC ĐỘ ƯU TIÊN</label>
                  <select
                    value={newRequestForm.priority}
                    onChange={(e) => setNewRequestForm({ ...newRequestForm, priority: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="low">Thấp</option>
                    <option value="medium">Trung bình</option>
                    <option value="high">Cao</option>
                    <option value="urgent">Khẩn cấp</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">TIÊU ĐỀ ĐỀ XUẤT</label>
                <input
                  type="text"
                  value={newRequestForm.title}
                  onChange={(e) => setNewRequestForm({ ...newRequestForm, title: e.target.value })}
                  placeholder="Ví dụ: Bổ sung rau củ cho tuần 37"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold text-gray-600">HẠNG MỤC CẦN ĐỀ XUẤT</label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    onClick={() => setNewRequestForm({
                      ...newRequestForm,
                      items: [...newRequestForm.items, { name: '', quantity: 1, unit: 'kg', estimatedCost: 0 }]
                    })}
                  >
                    + Thêm dòng
                  </button>
                </div>
                <div className="space-y-2">
                  {newRequestForm.items.map((item, index) => (
                    <div key={`request-item-${index}`} className="grid grid-cols-[1fr_72px_72px_32px] gap-2">
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, name: e.target.value } : current)
                        })}
                        placeholder="Tên mặt hàng"
                        className="px-3 py-2 border border-gray-300 rounded-lg"
                        required={index === 0}
                      />
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: e.target.value } : current)
                        })}
                        placeholder="SL"
                        className="px-2 py-2 border border-gray-300 rounded-lg"
                      />
                      <input
                        type="text"
                        value={item.unit}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, unit: e.target.value } : current)
                        })}
                        placeholder="ĐVT"
                        className="px-2 py-2 border border-gray-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.length > 1 ? newRequestForm.items.filter((_, itemIndex) => itemIndex !== index) : newRequestForm.items
                        })}
                        className="text-gray-400 hover:text-rose-600 text-lg"
                        aria-label="Xóa dòng"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Nhập số lượng và đơn vị; chi phí có thể bổ sung khi duyệt.</p>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowNewRequestModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Gửi đề xuất</button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
