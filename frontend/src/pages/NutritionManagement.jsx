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
  disposeInventoryLot,
  returnUnusedFood,
  reconcileInventoryLot,
  getInventoryReconciliations,
  getInventoryAlerts,
  getInventoryTransactions,
  getEquipments,
  createFoodSample,
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

const MEAL_TYPE_LABELS = {
  breakfast: 'Bữa sáng',
  morningSnack: 'Bữa phụ sáng',
  lunch: 'Bữa trưa',
  afternoonSnack: 'Bữa xế',
  dinner: 'Bữa tối',
  general: 'Chi phí chung'
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

const getSessionRole = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role || '';
  } catch {
    return '';
  }
};

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
  .filter((lot) => Number(lot.quantity) > 0 && ['available', 'near_expiry'].includes(lot.status))
  .reduce((summary, lot) => {
    const ingredientId = typeof lot.ingredientId === 'object'
      ? lot.ingredientId?._id
      : lot.ingredientId;
    const key = String(ingredientId || lot.ingredientName);
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

const PAGE_SIZE = 10;

const paginate = (items, requestedPage) => {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  return { page, totalPages, rows: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
};

function PaginationControls({ pagination, total, onPageChange }) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="nutrition-pagination">
      <span>Hiển thị {(pagination.page - 1) * PAGE_SIZE + 1}–{Math.min(pagination.page * PAGE_SIZE, total)} / {total} dòng</span>
      <div>
        <button type="button" disabled={pagination.page === 1} onClick={() => onPageChange(pagination.page - 1)}>‹ Trước</button>
        <span>Trang {pagination.page}/{pagination.totalPages}</span>
        <button type="button" disabled={pagination.page === pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Sau ›</button>
      </div>
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState('menus'); // menus | dishes | inventory | equipment | dailyKitchenReport | finance
  const canReconcileInventory = ['admin', 'principal'].includes(getSessionRole());
  const canApproveKitchenRequest = ['admin', 'principal', 'accountant'].includes(getSessionRole());
  const canViewFinance = ['admin', 'principal'].includes(getSessionRole());
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
  const [reconciliations, setReconciliations] = useState([]);
  const [inventoryTransactions, setInventoryTransactions] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [financialReport, setFinancialReport] = useState(null);
  const [kitchenRequests, setKitchenRequests] = useState([]);
  const [classroomDietaryAlerts, setClassroomDietaryAlerts] = useState([]);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [auditLotPage, setAuditLotPage] = useState(1);
  const [reconciliationPage, setReconciliationPage] = useState(1);
  const [disposalPage, setDisposalPage] = useState(1);
  const [dailyTransactionPage, setDailyTransactionPage] = useState(1);
  const [dailyStockPage, setDailyStockPage] = useState(1);
  const [stockSummaryPage, setStockSummaryPage] = useState(1);
  const [dishPage, setDishPage] = useState(1);
  const [equipmentPage, setEquipmentPage] = useState(1);
  const [equipmentRequestPage, setEquipmentRequestPage] = useState(1);
  const [dailyReportRange, setDailyReportRange] = useState(() => {
    const today = dateToInput(new Date());
    return { startDate: today, endDate: today };
  });
  const availableStockItems = summarizeAvailableInventory(inventories);
  const visibleInventoryLots = inventories.filter((lot) => Number(lot.quantity) > 0 && lot.status !== 'disposed');
  const inventoryPagination = paginate(visibleInventoryLots, inventoryPage);
  const auditLots = visibleInventoryLots;
  const auditLotPagination = paginate(auditLots, auditLotPage);
  const reconciliationPagination = paginate(reconciliations, reconciliationPage);
  const disposalTransactions = inventoryTransactions.filter((item) => item.type === 'spoilage');
  const disposalPagination = paginate(disposalTransactions, disposalPage);
  const reportTransactions = inventoryTransactions;
  const dailyTransactionPagination = paginate(reportTransactions, dailyTransactionPage);
  const dailyStockPagination = paginate(availableStockItems, dailyStockPage);
  const stockSummaryPagination = paginate(availableStockItems, stockSummaryPage);
  const dishPagination = paginate(dishes, dishPage);
  const equipmentPagination = paginate(equipments, equipmentPage);
  const equipmentRequests = kitchenRequests.filter((request) => ['equipment_new', 'equipment_repair'].includes(request.requestType));
  const equipmentRequestPagination = paginate(equipmentRequests, equipmentRequestPage);

  // Modals / Form toggles
  const [showNewMenuModal, setShowNewMenuModal] = useState(false);
  const [showNewDishModal, setShowNewDishModal] = useState(false);
  const [showImportStockModal, setShowImportStockModal] = useState(false);
  const [showNewIngredientModal, setShowNewIngredientModal] = useState(false);
  const [showIngredientManager, setShowIngredientManager] = useState(false);
  const [showExportStockModal, setShowExportStockModal] = useState(false);
  const [showDisposeLotModal, setShowDisposeLotModal] = useState(false);
  const [showReturnLotModal, setShowReturnLotModal] = useState(false);
  const [showReconcileLotModal, setShowReconcileLotModal] = useState(false);
  const [showNewSampleModal, setShowNewSampleModal] = useState(false);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [requestApproval, setRequestApproval] = useState(null);
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
    storageLocation: '',
    customStorageLocation: ''
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
  const [selectedInventoryLot, setSelectedInventoryLot] = useState(null);
  const [disposeReason, setDisposeReason] = useState('Hàng hết hạn');
  const [returnFoodForm, setReturnFoodForm] = useState({ inventoryId: '', quantity: '', reason: 'Nguyên liệu chưa dùng sau khi chuẩn bị bếp', rawAndSafe: false });
  const [reconcileForm, setReconcileForm] = useState({ actualQuantity: '', notes: '' });

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
    items: [{ name: '', quantity: 1, unit: 'kg', estimatedCost: 0 }]
  }));

  const showFeedback = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  };

  const changeDailyReportRange = (nextRange) => {
    setDailyTransactionPage(1);
    setDailyReportRange(nextRange);
  };

  const showLastThreeDays = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 2);
    changeDailyReportRange({ startDate: dateToInput(start), endDate: dateToInput(end) });
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
      } else if (activeTab === 'inventory' || activeTab === 'inventoryAudit') {
        const requests = [
          getInventory(),
          getInventoryAlerts(),
          getIngredients(),
          canReconcileInventory ? getInventoryReconciliations() : Promise.resolve({ data: { data: [] } }),
          canReconcileInventory ? getInventoryTransactions() : Promise.resolve({ data: { data: [] } })
        ];
        const [invRes, alertRes, ingRes, reconciliationRes, transactionRes] = await Promise.all(requests);
        setInventories(invRes.data.data || []);
        setInventoryAlerts(alertRes.data.data || { expiredItems: [], expiringItems: [], lowStockAlerts: [] });
        setIngredients(ingRes.data.data || []);
        setReconciliations(reconciliationRes.data.data || []);
        setInventoryTransactions(transactionRes.data.data || []);
      } else if (activeTab === 'equipment') {
        const [eqRes, reqRes] = await Promise.all([getEquipments(), getKitchenRequests()]);
        setEquipments(eqRes.data.data || []);
        setKitchenRequests(reqRes.data.data || []);
      } else if (activeTab === 'dailyKitchenReport') {
        const [invRes, transactionRes, reconciliationRes] = await Promise.all([
          getInventory(),
          getInventoryTransactions(dailyReportRange),
          canReconcileInventory ? getInventoryReconciliations() : Promise.resolve({ data: { data: [] } })
        ]);
        setInventories(invRes.data.data || []);
        setInventoryTransactions(transactionRes.data.data || []);
        setReconciliations(reconciliationRes.data.data || []);
      } else if (activeTab === 'finance') {
        const finRes = await getDailyMealFinancials(new Date().toISOString());
        setFinancialReport(finRes.data.data || null);
      }
    } catch (err) {
      console.error('Lỗi tải dữ liệu tab:', err);
      showFeedback('error', 'Không thể tải dữ liệu từ máy chủ');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedClassId, selectedWeekStart, canReconcileInventory, dailyReportRange]);

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
    const storageLocation = importStockForm.storageLocation === 'other'
      ? importStockForm.customStorageLocation.trim()
      : importStockForm.storageLocation;
    if (!storageLocation) {
      showFeedback('error', 'Vui lòng chọn hoặc nhập vị trí bảo quản cho lô hàng.');
      return;
    }
    try {
      await importInventoryStock({ ...importStockForm, storageLocation, quantity });
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

  const handleDisposeLot = async (e) => {
    e.preventDefault();
    if (!selectedInventoryLot) return;
    try {
      await disposeInventoryLot(selectedInventoryLot._id, { reason: disposeReason });
      showFeedback('success', 'Đã xử lý lô hàng và ghi nhận hao hụt/hủy kho.');
      setShowDisposeLotModal(false);
      setSelectedInventoryLot(null);
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể xử lý lô hàng');
    }
  };

  const handleReturnUnusedFood = async (e) => {
    e.preventDefault();
    const lot = inventories.find((item) => item._id === returnFoodForm.inventoryId);
    if (!lot) return showFeedback('error', 'Vui lòng chọn lô nguyên liệu cần hoàn trả.');
    try {
      await returnUnusedFood(lot._id, {
        quantity: Number(returnFoodForm.quantity),
        reason: returnFoodForm.reason,
        rawAndSafe: returnFoodForm.rawAndSafe
      });
      showFeedback('success', 'Đã cộng lại nguyên liệu chưa dùng vào tồn kho.');
      setShowReturnLotModal(false);
      setReturnFoodForm({ inventoryId: '', quantity: '', reason: 'Nguyên liệu chưa dùng sau khi chuẩn bị bếp', rawAndSafe: false });
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể hoàn trả nguyên liệu');
    }
  };

  const handleReconcileLot = async (e) => {
    e.preventDefault();
    if (!selectedInventoryLot) return;
    try {
      await reconcileInventoryLot(selectedInventoryLot._id, {
        actualQuantity: Number(reconcileForm.actualQuantity),
        notes: reconcileForm.notes
      });
      showFeedback('success', 'Đã ghi nhận kiểm kê và điều chỉnh tồn kho.');
      setShowReconcileLotModal(false);
      setSelectedInventoryLot(null);
      setReconcileForm({ actualQuantity: '', notes: '' });
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Không thể kiểm kê lô hàng');
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

  const resetRequestForm = (requestType = 'ingredient_purchase') => {
    const isEquipment = ['equipment_new', 'equipment_repair'].includes(requestType);
    setNewRequestForm({
      requestCode: `YC-${Date.now().toString().slice(-6)}`,
      requestType,
      title: '',
      items: [{ name: '', quantity: 1, unit: isEquipment ? 'cái' : 'kg', estimatedCost: 0 }]
    });
  };

  const openNewRequestModal = (requestType = 'ingredient_purchase') => {
    resetRequestForm(requestType);
    setShowNewRequestModal(true);
  };

  const openRequestApproval = (request, status) => {
    setRequestApproval({ request, status, approvalNotes: '' });
  };

  // Handler duyệt/từ chối đề xuất nhà bếp
  const handleApproveRequest = async (e) => {
    e.preventDefault();
    if (!requestApproval) return;

    const { request, status, approvalNotes } = requestApproval;
    if (status === 'rejected' && !approvalNotes.trim()) {
      showFeedback('error', 'Vui lòng nhập lý do từ chối đề xuất.');
      return;
    }

    try {
      await approveKitchenRequest(request._id, { status, approvalNotes: approvalNotes.trim() });
      showFeedback('success', `Đã ${status === 'approved' ? 'duyệt' : 'từ chối'} đề xuất!`);
      setRequestApproval(null);
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
      resetRequestForm();
      loadTabData();
    } catch (err) {
      showFeedback('error', err.response?.data?.message || 'Lỗi gửi đề xuất');
    }
  };

  return (
    <AppShell
      title="Bếp Ăn & Dinh Dưỡng Bán Trú"
      subtitle="Quản lý thực đơn theo lớp, cảnh báo dị ứng/bệnh lý học sinh, kho thực phẩm, thiết bị bếp và tài chính suất ăn"
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
              <button className="btn-secondary" onClick={() => setShowReturnLotModal(true)}>
                Báo Cáo Chưa Dùng
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="nutrition-module">
      {/* Alert Banner */}
      {message.text && (
        <div
          className={`nutrition-feedback p-3 rounded-lg flex items-center justify-between text-sm ${
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
          ...(canReconcileInventory ? [{ key: 'inventoryAudit', label: 'Kiểm Kê Kho', icon: 'grid' }] : []),
          { key: 'equipment', label: 'Thiết Bị & Đề Xuất Mua Sắm', icon: 'settings' },
          { key: 'dailyKitchenReport', label: 'Báo Cáo Kho Hằng Ngày', icon: 'chart' },
          ...(canViewFinance ? [{ key: 'finance', label: 'Tài Chính & Suất Ăn', icon: 'money' }] : [])
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
                  {dishPagination.rows.map((dish) => (
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
            <PaginationControls pagination={dishPagination} total={dishes.length} onPageChange={setDishPage} />
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 3: KHO THỰC PHẨM & TỒN KHO */}
      {/* ========================================== */}
      {activeTab === 'inventory' && !loading && (
        <div className="space-y-6">
          {/* Thẻ Cảnh báo Hạn dùng & Hết hàng */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
              <h4 className="font-bold text-rose-900 text-sm mb-1">Hàng Đã Hết Hạn — Cần Xử Lý</h4>
              <p className="text-xs text-rose-700 mb-2">
                Có <strong>{inventoryAlerts.expiredItems?.length || 0}</strong> lô phải hủy hoặc lập biên bản hao hụt:
              </p>
              <ul className="text-xs space-y-1 text-rose-800">
                {inventoryAlerts.expiredItems?.slice(0, 3).map((it) => (
                  <li key={it._id}>• {it.ingredientName} — HSD: {new Date(it.expiryDate).toLocaleDateString('vi-VN')}</li>
                ))}
                {!inventoryAlerts.expiredItems?.length && <li>• Không có lô hàng hết hạn cần xử lý.</li>}
              </ul>
            </div>
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
                  {stockSummaryPagination.rows.map((item) => (
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
            <PaginationControls pagination={stockSummaryPagination} total={availableStockItems.length} onPageChange={setStockSummaryPage} />
          </div>

          {/* Bảng chi tiết theo từng lô */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Chi Tiết Lô Hàng Trong Kho ({visibleInventoryLots.length})</h3>
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
                    <th className="p-3">Nhà Cung Cấp</th>
                    <th className="p-3">Vị Trí Bảo Quản</th>
                    <th className="p-3">Trạng Thái</th>
                    <th className="p-3">Xử Lý</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventoryPagination.rows.map((inv) => (
                    <tr key={inv._id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-gray-800">{inv.ingredientName}</td>
                      <td className="p-3 font-mono text-xs">{inv.batchNumber}</td>
                      <td className="p-3 font-bold text-indigo-700">{inv.quantity} {inv.unit}</td>
                      <td className="p-3 text-xs">{inv.costPerUnit?.toLocaleString('vi-VN')} đ</td>
                      <td className="p-3 text-xs font-medium">
                        {new Date(inv.expiryDate).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="p-3 text-xs text-gray-600">{inv.supplierName || 'Chưa ghi nhận'}</td>
                      <td className="p-3 text-xs text-gray-500">{inv.storageLocation}</td>
                      <td className="p-3">
                        {inv.status === 'disposed' ? (
                          <span className="nutrition-disposed-badge">✓ Đã hủy</span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              inv.status === 'available'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {inv.status === 'available' ? 'Sẵn sàng'
                              : inv.status === 'near_expiry' ? 'Cận hạn'
                              : inv.status === 'expired' ? 'Hết hạn'
                              : 'Đã hết tồn'}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          {inv.status === 'expired' && inv.quantity > 0 && (
                            <button type="button" className="text-xs font-semibold text-rose-600 hover:text-rose-800" onClick={() => { setSelectedInventoryLot(inv); setDisposeReason('Hàng hết hạn'); setShowDisposeLotModal(true); }}>Xử lý hủy</button>
                          )}
                          {canReconcileInventory && inv.status !== 'disposed' && (
                            <button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => { setSelectedInventoryLot(inv); setReconcileForm({ actualQuantity: inv.quantity, notes: '' }); setShowReconcileLotModal(true); }}>Kiểm kê</button>
                          )}
                          {!canReconcileInventory && inv.status !== 'expired' && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!visibleInventoryLots.length && (
                    <tr><td colSpan="9" className="p-4 text-center text-xs text-gray-500">Chưa có lô hàng nào được nhập kho.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={inventoryPagination} total={visibleInventoryLots.length} onPageChange={setInventoryPage} />
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB: KIỂM KÊ KHO (ADMIN / PRINCIPAL) */}
      {/* ========================================== */}
      {activeTab === 'inventoryAudit' && !loading && canReconcileInventory && (
        <div className="space-y-6">
          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4">
            <h3 className="font-bold text-indigo-900 text-sm">Kiểm Kê Kho Thực Phẩm</h3>
            <p className="text-xs text-indigo-800 mt-1">Nhập số lượng thực tế theo từng lô. Mọi chênh lệch được lưu thành biên bản và giao dịch điều chỉnh; không sửa trực tiếp số tồn.</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-800 text-sm">Danh Sách Lô Cần Đối Chiếu</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase"><tr><th className="p-3">Nguyên Liệu</th><th className="p-3">Lô</th><th className="p-3">Số Sổ Kho</th><th className="p-3">Hạn Dùng</th><th className="p-3">Thao Tác</th></tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {auditLotPagination.rows.map((lot) => (
                    <tr key={lot._id} className="hover:bg-gray-50/50">
                      <td className="p-3 font-semibold text-gray-800">{lot.ingredientName}</td>
                      <td className="p-3 text-xs font-mono">{lot.batchNumber}</td>
                      <td className="p-3 font-bold text-indigo-700">{lot.quantity} {lot.unit}</td>
                      <td className="p-3 text-xs">{new Date(lot.expiryDate).toLocaleDateString('vi-VN')}</td>
                      <td className="p-3"><button type="button" className="text-xs font-semibold text-indigo-600 hover:text-indigo-800" onClick={() => { setSelectedInventoryLot(lot); setReconcileForm({ actualQuantity: lot.quantity, notes: '' }); setShowReconcileLotModal(true); }}>Ghi kiểm kê</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={auditLotPagination} total={auditLots.length} onPageChange={setAuditLotPage} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200"><h3 className="font-bold text-gray-800 text-sm">Biên Bản Kiểm Kê Gần Đây</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase"><tr><th className="p-3">Thời Gian</th><th className="p-3">Nguyên Liệu / Lô</th><th className="p-3">Sổ Kho</th><th className="p-3">Thực Tế</th><th className="p-3">Chênh Lệch</th><th className="p-3">Người Kiểm</th></tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {reconciliationPagination.rows.map((record) => (
                    <tr key={record._id} className="hover:bg-gray-50/50">
                      <td className="p-3 text-xs">{new Date(record.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-xs"><strong>{record.ingredientName}</strong><br />{record.batchNumber}</td>
                      <td className="p-3 text-xs">{record.systemQuantity} {record.unit}</td>
                      <td className="p-3 text-xs">{record.actualQuantity} {record.unit}</td>
                      <td className={`p-3 text-xs font-bold ${record.difference === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{record.difference > 0 ? '+' : ''}{record.difference} {record.unit}</td>
                      <td className="p-3 text-xs">{record.countedByName}</td>
                    </tr>
                  ))}
                  {!reconciliations.length && <tr><td colSpan="6" className="p-4 text-center text-xs text-gray-500">Chưa có biên bản kiểm kê.</td></tr>}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={reconciliationPagination} total={reconciliations.length} onPageChange={setReconciliationPage} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-800 text-sm">Lịch Sử Hủy / Hao Hụt Kho</h3>
              <p className="text-xs text-gray-500 mt-1">Mỗi lần xử lý lô hết hạn hoặc hư hỏng được lưu tại đây, kèm số lượng, lý do và người thực hiện.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase"><tr><th className="p-3">Thời Gian</th><th className="p-3">Nguyên Liệu / Lô</th><th className="p-3">Số Lượng Hủy</th><th className="p-3">Nhà Cung Cấp</th><th className="p-3">Vị Trí</th><th className="p-3">Lý Do</th><th className="p-3">Người Xử Lý</th></tr></thead>
                <tbody className="divide-y divide-gray-200">
                  {disposalPagination.rows.map((record) => (
                    <tr key={record._id} className="hover:bg-gray-50/50">
                      <td className="p-3 text-xs">{new Date(record.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-xs"><strong>{record.ingredientName}</strong><br />{record.batchNumber}</td>
                      <td className="p-3 text-xs font-bold text-rose-700">{Math.abs(record.quantity)} {record.unit}</td>
                      <td className="p-3 text-xs">{record.supplierName || 'Chưa ghi nhận'}</td>
                      <td className="p-3 text-xs">{record.storageLocation || 'Chưa ghi nhận'}</td>
                      <td className="p-3 text-xs text-gray-600">{record.reason}</td>
                      <td className="p-3 text-xs">{record.performedByName}</td>
                    </tr>
                  ))}
                  {!disposalTransactions.length && <tr><td colSpan="7" className="p-4 text-center text-xs text-gray-500">Chưa có lịch sử hủy hoặc hao hụt.</td></tr>}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={disposalPagination} total={disposalTransactions.length} onPageChange={setDisposalPage} />
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 4: THIẾT BỊ BẾP & ĐỀ XUẤT MUA SẮM */}
      {/* ========================================== */}
      {activeTab === 'equipment' && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Thiết bị bếp */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-sm">Thiết Bị Chung Nhà Bếp ({equipments.length})</h3>
            </div>
            <div className="divide-y divide-gray-200">
              {equipmentPagination.rows.map((eq) => (
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
              {!equipments.length && (
                <div className="p-6 text-center">
                  <p className="text-sm font-medium text-gray-600">Chưa có thiết bị được ghi nhận.</p>
                  <p className="text-xs text-gray-500 mt-1">Khi cần mua mới hoặc sửa chữa, hãy lập đề xuất ở khối bên phải.</p>
                </div>
              )}
            </div>
            <PaginationControls pagination={equipmentPagination} total={equipments.length} onPageChange={setEquipmentPage} />
          </div>

          {/* Đề xuất mua dụng cụ và thiết bị */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">Đề Xuất Mua Sắm Dụng Cụ & Thiết Bị</h3>
                <p className="text-xs text-gray-500 mt-1">Theo dõi duyệt mua mới hoặc sửa chữa thiết bị bếp.</p>
              </div>
              <button className="btn-primary text-xs" onClick={() => openNewRequestModal('equipment_new')}>
                <Icon name="plus" size={14} /> Tạo đề xuất
              </button>
            </div>
            <div className="divide-y divide-gray-200">
              {equipmentRequestPagination.rows.map((request) => (
                <div key={request._id} className="p-4">
                  <div className="flex flex-wrap justify-between items-start gap-3">
                    <div>
                      <h5 className="font-bold text-gray-800 text-sm">{request.title}</h5>
                      <p className="text-xs text-gray-500 mt-1">
                        {request.requestType === 'equipment_new' ? 'Mua mới' : 'Sửa chữa'} · {request.requestCode} · {request.requestedByName}
                      </p>
                      <p className="text-xs text-indigo-700 font-semibold mt-1">
                        {request.items?.map((item) => `${item.name} (${item.quantity} ${item.unit})`).join(', ') || 'Chưa có hạng mục'} · Ước tính {request.totalEstimatedCost?.toLocaleString('vi-VN')} đ
                      </p>
                      {request.status !== 'pending' && (
                        <p className="text-xs text-gray-600 mt-2">
                          <strong>{request.status === 'approved' ? 'Lý do duyệt' : 'Lý do từ chối'}:</strong> {request.approvalNotes || 'Không ghi chú'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded font-semibold ${request.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : request.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>
                        {request.status === 'approved' ? 'Đã duyệt' : request.status === 'rejected' ? 'Từ chối' : request.status === 'completed' ? 'Đã hoàn tất' : 'Chờ duyệt'}
                      </span>
                      {canApproveKitchenRequest && request.status === 'pending' && (
                        <div className="flex gap-1">
                          <button onClick={() => openRequestApproval(request, 'approved')} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700">Duyệt</button>
                          <button onClick={() => openRequestApproval(request, 'rejected')} className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300">Từ chối</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {!equipmentRequests.length && (
                <div className="p-6 text-center text-sm text-gray-500">Chưa có đề xuất mua dụng cụ hoặc thiết bị.</div>
              )}
            </div>
            <PaginationControls pagination={equipmentRequestPagination} total={equipmentRequests.length} onPageChange={setEquipmentRequestPage} />
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 5: BÁO CÁO KHO HẰNG NGÀY */}
      {/* ========================================== */}
      {activeTab === 'dailyKitchenReport' && !loading && (
        <div className="space-y-6">
          <div className="nutrition-report-filter">
            <div>
              <strong>Tra cứu nhật ký kho</strong>
              <span>Chọn ngày để xem chính xác đã nhập, xuất, hoàn trả, hủy hoặc điều chỉnh những gì.</span>
            </div>
            <label>Từ ngày<input type="date" value={dailyReportRange.startDate} onChange={(e) => changeDailyReportRange({ ...dailyReportRange, startDate: e.target.value })} /></label>
            <label>Đến ngày<input type="date" value={dailyReportRange.endDate} min={dailyReportRange.startDate} onChange={(e) => changeDailyReportRange({ ...dailyReportRange, endDate: e.target.value })} /></label>
            <button type="button" onClick={() => { const today = dateToInput(new Date()); changeDailyReportRange({ startDate: today, endDate: today }); }}>Hôm nay</button>
            <button type="button" onClick={showLastThreeDays}>3 ngày gần nhất</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
              <span className="text-xs text-gray-500 font-semibold block mb-1">MẶT HÀNG CÒN KHẢ DỤNG</span>
              <span className="text-2xl font-bold text-emerald-700">{summarizeAvailableInventory(inventories).length}</span>
              <p className="text-xs text-gray-400 mt-1">Không tính lô hết hạn, đã hủy hoặc hết tồn</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
              <span className="text-xs text-gray-500 font-semibold block mb-1">PHIẾU NHẬP TRONG KHOẢNG CHỌN</span>
              <span className="text-2xl font-bold text-emerald-700">{reportTransactions.filter((item) => item.type === 'import').length}</span>
              <p className="text-xs text-gray-400 mt-1">Bao gồm từng lần nhập theo lô</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
              <span className="text-xs text-gray-500 font-semibold block mb-1">TỔNG GIAO DỊCH TRONG KHOẢNG CHỌN</span>
              <span className="text-2xl font-bold text-amber-700">{reportTransactions.length}</span>
              <p className="text-xs text-gray-400 mt-1">Bao gồm nhập, xuất, hoàn trả, hủy và điều chỉnh</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">Nhật Ký Nhập Xuất Kho</h3>
                <p className="text-xs text-gray-500">Từ {new Date(`${dailyReportRange.startDate}T00:00:00`).toLocaleDateString('vi-VN')} đến {new Date(`${dailyReportRange.endDate}T00:00:00`).toLocaleDateString('vi-VN')}.</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                  <tr>
                    <th className="p-3">Thời Gian</th><th className="p-3">Nghiệp Vụ</th><th className="p-3">Nguyên Liệu / Lô</th><th className="p-3">Số Lượng</th><th className="p-3">Người Ghi Nhận</th><th className="p-3">Ghi Chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {dailyTransactionPagination.rows.map((item) => (
                    <tr key={item._id} className="hover:bg-gray-50/50">
                      <td className="p-3 text-xs">{new Date(item.createdAt).toLocaleString('vi-VN')}</td>
                      <td className="p-3 text-xs font-semibold">{{ import: 'Nhập kho', export: 'Xuất cho bếp', return: 'Hoàn trả chưa dùng', spoilage: 'Hủy / hao hụt', adjustment: 'Điều chỉnh kiểm kê' }[item.type] || item.type}</td>
                      <td className="p-3 text-xs"><strong>{item.ingredientName}</strong><br />{item.batchNumber || '—'}</td>
                      <td className={`p-3 text-xs font-bold ${item.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{item.quantity > 0 ? '+' : ''}{item.quantity} {item.unit}</td>
                      <td className="p-3 text-xs">{item.performedByName}</td>
                      <td className="p-3 text-xs text-gray-500">{item.reason || '—'}</td>
                    </tr>
                  ))}
                  {!reportTransactions.length && <tr><td colSpan="6" className="p-4 text-center text-xs text-gray-500">Không có giao dịch kho trong khoảng ngày đã chọn.</td></tr>}
                </tbody>
              </table>
            </div>
            <PaginationControls pagination={dailyTransactionPagination} total={reportTransactions.length} onPageChange={setDailyTransactionPage} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-800 text-sm">Tổng Số Lượng Mặt Hàng Hiện Có Trong Kho</h3>
              <p className="text-xs text-gray-500">Tổng hợp theo nguyên liệu, chỉ tính lô còn hạn và khả dụng.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-600 text-xs uppercase"><tr><th className="p-3">Nguyên Liệu</th><th className="p-3">Tổng Tồn</th><th className="p-3">Số Lô</th><th className="p-3">Hạn Gần Nhất</th><th className="p-3">Vị Trí</th></tr></thead><tbody className="divide-y divide-gray-200">
                {dailyStockPagination.rows.map((item) => <tr key={item.key}><td className="p-3 font-semibold text-gray-800">{item.ingredientName}</td><td className="p-3 font-bold text-emerald-700">{item.quantity} {item.unit}</td><td className="p-3 text-xs">{item.lots}</td><td className="p-3 text-xs">{new Date(item.nearestExpiryDate).toLocaleDateString('vi-VN')}</td><td className="p-3 text-xs text-gray-500">{item.locations}</td></tr>)}
                {!summarizeAvailableInventory(inventories).length && <tr><td colSpan="5" className="p-4 text-center text-xs text-gray-500">Chưa có hàng tồn khả dụng.</td></tr>}
              </tbody></table>
            </div>
            <PaginationControls pagination={dailyStockPagination} total={availableStockItems.length} onPageChange={setDailyStockPage} />
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* TAB 6: TÀI CHÍNH & SUẤT ĂN — CHỈ ADMIN/HIỆU TRƯỞNG */}
      {/* ========================================== */}
      {activeTab === 'finance' && !loading && canViewFinance && financialReport && (
        <div className="nutrition-finance-dashboard">
          <section className="nutrition-finance-hero">
            <div>
              <p>TRUNG TÂM ĐIỀU HÀNH SUẤT ĂN</p>
              <h3>Tổng quan tài chính ngày {new Date(financialReport.date).toLocaleDateString('vi-VN')}</h3>
              <span>Chỉ dành cho Admin và Hiệu trưởng · Số liệu chi phí lấy từ phiếu xuất kho đã ghi nhận.</span>
            </div>
            <div className={financialReport.balance >= 0 ? 'nutrition-finance-health is-positive' : 'nutrition-finance-health is-negative'}>
              <small>TRẠNG THÁI NGÂN SÁCH</small>
              <strong>{financialReport.balance >= 0 ? 'Đang trong định mức' : 'Vượt định mức'}</strong>
            </div>
          </section>

          <section className="nutrition-finance-kpis">
            <article><span>HỌC SINH CÓ MẶT</span><strong>{financialReport.totalStudentsPresent}</strong><small>Từ điểm danh thực tế</small></article>
            <article><span>NGÂN SÁCH SUẤT ĂN</span><strong>{financialReport.totalMealRevenueBudget?.toLocaleString('vi-VN')} đ</strong><small>{financialReport.standardMealRatePerStudent?.toLocaleString('vi-VN')} đ / trẻ / ngày</small></article>
            <article className="is-expense"><span>CHI PHÍ ĐÃ XUẤT KHO</span><strong>{financialReport.totalIngredientCost?.toLocaleString('vi-VN')} đ</strong><small>{financialReport.exportTransactionsCount} phiếu xuất nguyên liệu</small></article>
            <article className={financialReport.balance >= 0 ? 'is-positive' : 'is-negative'}><span>CÒN LẠI / CHÊNH LỆCH</span><strong>{financialReport.balance?.toLocaleString('vi-VN')} đ</strong><small>{financialReport.balance >= 0 ? 'Còn trong ngân sách' : 'Cần rà soát ngay'}</small></article>
          </section>

          <section className="nutrition-finance-grid">
            <article className="nutrition-finance-panel">
              <h4>Hiệu quả sử dụng ngân sách</h4>
              <p className="nutrition-finance-muted">Chi phí nguyên liệu thực tế trên mỗi học sinh có mặt.</p>
              <div className="nutrition-finance-cost-row"><span>Chi phí / học sinh</span><strong>{financialReport.actualCostPerStudent?.toLocaleString('vi-VN')} đ</strong></div>
              <div className="nutrition-finance-cost-row"><span>Tỷ lệ đã sử dụng</span><strong>{financialReport.budgetUtilizationPercent || 0}%</strong></div>
              <div className="nutrition-finance-progress"><span style={{ width: `${Math.min(financialReport.budgetUtilizationPercent || 0, 100)}%` }} /></div>
              <p className={financialReport.budgetUtilizationPercent > 100 ? 'nutrition-finance-warning' : 'nutrition-finance-ok'}>
                {financialReport.budgetUtilizationPercent > 100 ? 'Chi phí xuất kho đã vượt ngân sách suất ăn.' : 'Chi phí đang nằm trong hạn mức thu suất ăn.'}
              </p>
            </article>

            <article className="nutrition-finance-panel">
              <h4>Chi phí theo bữa ăn</h4>
              <p className="nutrition-finance-muted">Tổng hợp từ các phiếu xuất kho trong ngày.</p>
              <div className="nutrition-finance-breakdown">
                {(financialReport.mealCostBreakdown || []).map((item) => (
                  <div key={item.mealType}><span>{MEAL_TYPE_LABELS[item.mealType] || item.mealType} <small>{item.transactions} phiếu</small></span><strong>{item.cost.toLocaleString('vi-VN')} đ</strong></div>
                ))}
                {!financialReport.mealCostBreakdown?.length && <p className="nutrition-finance-empty">Chưa có phiếu xuất kho trong ngày.</p>}
              </div>
            </article>
          </section>

          <section className="nutrition-finance-grid">
            <article className="nutrition-finance-panel nutrition-finance-table-panel">
              <h4>Dự toán suất ăn theo lớp</h4>
              <p className="nutrition-finance-muted">Phân bổ ngân sách dựa trên số học sinh có mặt thực tế.</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Lớp</th><th>Có mặt</th><th>Ngân sách dự kiến</th></tr></thead><tbody>
                {(financialReport.classBreakdown || []).map((item) => <tr key={item.classroomId}><td>{item.className}</td><td className="nutrition-finance-number">{item.actualPresentStudents}</td><td className="nutrition-finance-number">{(item.actualPresentStudents * financialReport.standardMealRatePerStudent).toLocaleString('vi-VN')} đ</td></tr>)}
                {!financialReport.classBreakdown?.length && <tr><td colSpan="3" className="nutrition-finance-empty">Chưa có học sinh được điểm danh có mặt hôm nay.</td></tr>}
              </tbody></table></div>
            </article>

            <article className="nutrition-finance-panel nutrition-finance-table-panel">
              <h4>Phiếu xuất kho gần đây</h4>
              <p className="nutrition-finance-muted">10 giao dịch mới nhất ảnh hưởng đến chi phí suất ăn.</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Nguyên liệu</th><th>Bữa</th><th>Chi phí</th></tr></thead><tbody>
                {(financialReport.recentExpenseTransactions || []).map((item) => <tr key={item._id}><td><strong>{item.ingredientName}</strong><small>{item.quantity} {item.unit} · {item.performedByName || '—'}</small></td><td>{MEAL_TYPE_LABELS[item.mealType] || item.mealType}</td><td className="nutrition-finance-number is-expense">{item.totalAmount?.toLocaleString('vi-VN')} đ</td></tr>)}
                {!financialReport.recentExpenseTransactions?.length && <tr><td colSpan="3" className="nutrition-finance-empty">Chưa phát sinh chi phí xuất kho trong ngày.</td></tr>}
              </tbody></table></div>
            </article>
          </section>
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

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">VỊ TRÍ BẢO QUẢN</label>
                <select
                  value={importStockForm.storageLocation}
                  onChange={(e) => setImportStockForm({ ...importStockForm, storageLocation: e.target.value, customStorageLocation: e.target.value === 'other' ? importStockForm.customStorageLocation : '' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                >
                  <option value="">-- Chọn vị trí đặt lô hàng --</option>
                  <option value="Kho lạnh 01">Kho lạnh 01</option>
                  <option value="Kho lạnh 02">Kho lạnh 02</option>
                  <option value="Kho mát">Kho mát</option>
                  <option value="Kho khô">Kho khô</option>
                  <option value="Khu sơ chế">Khu sơ chế</option>
                  <option value="other">Vị trí khác…</option>
                </select>
                {importStockForm.storageLocation === 'other' && (
                  <input
                    type="text"
                    value={importStockForm.customStorageLocation}
                    onChange={(e) => setImportStockForm({ ...importStockForm, customStorageLocation: e.target.value })}
                    placeholder="Ví dụ: Giá kệ B2, tầng 3"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg mt-2"
                    required
                  />
                )}
                <p className="text-[11px] text-gray-400 mt-1">Mỗi lô bắt buộc có vị trí riêng để tìm, kiểm kê và truy xuất chính xác.</p>
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
      {/* MODAL: BÁO CÁO NGUYÊN LIỆU CHƯA DÙNG */}
      {/* ========================================== */}
      {showReturnLotModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Báo Cáo Nguyên Liệu Chưa Dùng</h3>
            <p className="nutrition-modal-note">Chỉ hoàn trả nguyên liệu còn nguyên trạng, chưa chế biến và còn hạn sử dụng. Thức ăn đã nấu không được cộng lại kho.</p>
            <form onSubmit={handleReturnUnusedFood} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">LÔ NGUYÊN LIỆU HOÀN TRẢ</label>
                <select value={returnFoodForm.inventoryId} onChange={(e) => setReturnFoodForm({ ...returnFoodForm, inventoryId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                  <option value="">-- Chọn lô còn hạn --</option>
                  {inventories.filter((lot) => ['available', 'near_expiry', 'depleted'].includes(lot.status)).map((lot) => (
                    <option key={lot._id} value={lot._id}>{lot.ingredientName} — {lot.batchNumber} (đang có {lot.quantity} {lot.unit})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">SỐ LƯỢNG CÒN LẠI</label>
                <input type="number" min="0.001" step="0.001" value={returnFoodForm.quantity} onChange={(e) => setReturnFoodForm({ ...returnFoodForm, quantity: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">GHI CHÚ</label>
                <textarea rows="2" value={returnFoodForm.reason} onChange={(e) => setReturnFoodForm({ ...returnFoodForm, reason: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              </div>
              <label className="flex items-start gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={returnFoodForm.rawAndSafe} onChange={(e) => setReturnFoodForm({ ...returnFoodForm, rawAndSafe: e.target.checked })} />
                Tôi xác nhận nguyên liệu chưa chế biến, còn nguyên trạng, bảo quản đúng quy định và còn hạn sử dụng.
              </label>
              <div className="flex justify-end gap-2 pt-4 border-t"><button type="button" onClick={() => setShowReturnLotModal(false)} className="btn-secondary">Hủy</button><button type="submit" className="btn-primary">Cộng Lại Kho</button></div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: XỬ LÝ HÀNG HẾT HẠN */}
      {/* ========================================== */}
      {showDisposeLotModal && selectedInventoryLot && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Xử Lý Lô Hàng</h3>
            <p className="nutrition-modal-note"><strong>{selectedInventoryLot.ingredientName}</strong> — {selectedInventoryLot.quantity} {selectedInventoryLot.unit}. Thao tác này lập biên bản hao hụt/hủy và đưa số lượng lô về 0.</p>
            <form onSubmit={handleDisposeLot} className="space-y-4 text-sm">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">LÝ DO XỬ LÝ</label><textarea rows="3" value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required /></div>
              <div className="flex justify-end gap-2 pt-4 border-t"><button type="button" onClick={() => { setShowDisposeLotModal(false); setSelectedInventoryLot(null); }} className="btn-secondary">Hủy</button><button type="submit" className="btn-primary">Xác Nhận Xử Lý</button></div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* MODAL: KIỂM KÊ LÔ HÀNG */}
      {/* ========================================== */}
      {showReconcileLotModal && selectedInventoryLot && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="font-bold text-gray-900 text-lg mb-2">Kiểm Kê Lô Hàng</h3>
            <p className="nutrition-modal-note"><strong>{selectedInventoryLot.ingredientName}</strong> — lô {selectedInventoryLot.batchNumber}. Sổ kho hiện có: <strong>{selectedInventoryLot.quantity} {selectedInventoryLot.unit}</strong>.</p>
            <form onSubmit={handleReconcileLot} className="space-y-4 text-sm">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">SỐ LƯỢNG THỰC TẾ</label><input type="number" min="0" step="0.001" value={reconcileForm.actualQuantity} onChange={(e) => setReconcileForm({ ...reconcileForm, actualQuantity: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">GHI CHÚ KIỂM KÊ</label><textarea rows="3" value={reconcileForm.notes} onChange={(e) => setReconcileForm({ ...reconcileForm, notes: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Ví dụ: chênh lệch do hao hụt sơ chế" /></div>
              <div className="flex justify-end gap-2 pt-4 border-t"><button type="button" onClick={() => { setShowReconcileLotModal(false); setSelectedInventoryLot(null); }} className="btn-secondary">Hủy</button><button type="submit" className="btn-primary">Lưu Biên Bản</button></div>
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
                      items: [...newRequestForm.items, {
                        name: '',
                        quantity: 1,
                        unit: ['equipment_new', 'equipment_repair'].includes(newRequestForm.requestType) ? 'cái' : 'kg',
                        estimatedCost: 0
                      }]
                    })}
                  >
                    + Thêm dòng
                  </button>
                </div>
                <div className="space-y-2">
                  {newRequestForm.items.map((item, index) => (
                    <div key={`request-item-${index}`} className="nutrition-request-item">
                      <div className="nutrition-request-field nutrition-request-name">
                        <label htmlFor={`request-name-${index}`}>Tên dụng cụ / mặt hàng</label>
                        <input
                          id={`request-name-${index}`}
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
                      </div>
                      <div className="nutrition-request-field">
                        <label htmlFor={`request-quantity-${index}`}>Số lượng</label>
                        <input
                          id={`request-quantity-${index}`}
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, quantity: e.target.value } : current)
                        })}
                        placeholder="SL"
                        className="px-2 py-2 border border-gray-300 rounded-lg"
                        required={index === 0}
                        />
                      </div>
                      <div className="nutrition-request-field">
                        <label htmlFor={`request-unit-${index}`}>Đơn vị tính</label>
                        <input
                          id={`request-unit-${index}`}
                        type="text"
                        value={item.unit}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, unit: e.target.value } : current)
                        })}
                        placeholder="ĐVT"
                        className="px-2 py-2 border border-gray-300 rounded-lg"
                        required={index === 0}
                        />
                      </div>
                      <div className="nutrition-request-field">
                        <label htmlFor={`request-cost-${index}`}>Giá dự kiến (VNĐ)</label>
                        <input
                          id={`request-cost-${index}`}
                        type="number"
                        min="0"
                        value={item.estimatedCost}
                        onChange={(e) => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.map((current, itemIndex) => itemIndex === index ? { ...current, estimatedCost: e.target.value } : current)
                        })}
                        placeholder="Giá dự kiến"
                        className="px-2 py-2 border border-gray-300 rounded-lg"
                        aria-label="Chi phí dự kiến"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewRequestForm({
                          ...newRequestForm,
                          items: newRequestForm.items.length > 1 ? newRequestForm.items.filter((_, itemIndex) => itemIndex !== index) : newRequestForm.items
                        })}
                        className="nutrition-request-remove text-gray-400 hover:text-rose-600 text-lg"
                        aria-label="Xóa dòng"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-2">Nhập số lượng, đơn vị và giá dự kiến cho từng hạng mục để người duyệt có cơ sở xem xét.</p>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setShowNewRequestModal(false)} className="btn-secondary">Hủy</button>
                <button type="submit" className="btn-primary">Gửi đề xuất</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DUYỆT / TỪ CHỐI ĐỀ XUẤT */}
      {requestApproval && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <p className="text-xs font-semibold tracking-wide text-indigo-600 uppercase">Phê duyệt nội bộ</p>
            <h3 className="font-bold text-gray-900 text-lg mt-1">
              {requestApproval.status === 'approved' ? 'Duyệt đề xuất mua sắm' : 'Từ chối đề xuất mua sắm'}
            </h3>
            <p className="text-sm text-gray-600 mt-2">{requestApproval.request.title} · {requestApproval.request.requestCode}</p>
            <form onSubmit={handleApproveRequest} className="space-y-4 mt-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {requestApproval.status === 'approved' ? 'GHI CHÚ DUYỆT (NẾU CÓ)' : 'LÝ DO TỪ CHỐI'}
                </label>
                <textarea
                  value={requestApproval.approvalNotes}
                  onChange={(e) => setRequestApproval({ ...requestApproval, approvalNotes: e.target.value })}
                  placeholder={requestApproval.status === 'approved' ? 'Ví dụ: Duyệt theo ngân sách tháng này.' : 'Nêu rõ lý do để bộ phận bếp có thể xử lý tiếp.'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-24"
                  required={requestApproval.status === 'rejected'}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <button type="button" onClick={() => setRequestApproval(null)} className="btn-secondary">Hủy</button>
                <button type="submit" className={requestApproval.status === 'approved' ? 'btn-primary' : 'px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700'}>
                  {requestApproval.status === 'approved' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
