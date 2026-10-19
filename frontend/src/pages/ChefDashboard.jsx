import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import MealServingOperations from '../components/MealServingOperations';
import KitchenSafetyPanel from '../components/KitchenSafetyPanel';
import KitchenReconciliationPanel from '../components/KitchenReconciliationPanel';
import { checkMenuAllergies, getClassroomDietaryAlerts, getDailyServingPlan, getDishes, getInventory, getWeeklyMenus } from '../api/nutrition';
import { buildKitchenIngredientPlan, displayIngredientQuantity } from '../utils/kitchenIngredientPlan';
import { kitchenErrorMessage } from '../utils/kitchenErrorMessage';
import './ChefDashboard.css';

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const weekStart = (date) => {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};
const dayKey = (date) => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T00:00:00.000Z`).getUTCDay()];
const dishNames = (meal) => {
  const items = meal?.items?.map((item) => item.dishName).filter(Boolean) || [];
  return items.length ? items.join(', ') : meal?.dishName || 'Chưa có món';
};
const lunchNames = (meal, listKey, legacyKey) => {
  const items = meal?.[listKey]?.map((item) => item.dishName).filter(Boolean) || [];
  return items.length ? items.join(', ') : meal?.[legacyKey]?.dishName || 'Chưa có món';
};
const todayMeals = (day) => [
  ['Bữa sáng', dishNames(day.breakfast)],
  ['Phụ sáng', dishNames(day.morningSnack)],
  ['Món chính trưa', lunchNames(day.lunch, 'mainDishes', 'mainDish')],
  ['Rau / xào', lunchNames(day.lunch, 'stirFryDishes', 'stirFryDish')],
  ['Canh', lunchNames(day.lunch, 'soupDishes', 'soupDish')],
  ['Tráng miệng', lunchNames(day.lunch, 'desserts', 'dessert')],
  ['Bữa phụ chiều', dishNames(day.afternoonSnack)]
];

export default function ChefDashboard() {
  const [date, setDate] = useState(today);
  const [refreshKey, setRefreshKey] = useState(0);
  const [plan, setPlan] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [menus, setMenus] = useState([]);
  const [menuConflicts, setMenuConflicts] = useState({});
  const [dishes, setDishes] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [state, setState] = useState({ loading: true, error: '', updatedAt: '' });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const [response, menuResponse, dishResponse, inventoryResponse] = await Promise.all([
        getDailyServingPlan(date), getWeeklyMenus({ startDate: weekStart(date) }), getDishes(), getInventory()
      ]);
      const nextPlan = response.data.data;
      const weeklyMenus = menuResponse.data.data || [];
      const classes = nextPlan?.classBreakdown || [];
      const alerts = await Promise.all(classes.filter((item) => item.actualPresentStudents > 0).map(async (item) => {
        const alertResponse = await getClassroomDietaryAlerts(item.classroomId);
        const presentIds = new Set((item.presentStudentIds || []).map(String));
        return (alertResponse.data.data || [])
          .filter((student) => presentIds.has(String(student.studentId)))
          .map((student) => ({ ...student, className: item.className, classroomId: item.classroomId }));
      }));
      const conflictPairs = await Promise.all(weeklyMenus.filter((menu) => menu.status === 'published').map(async (menu) => {
        const selectedDay = menu.days?.find((entry) => entry.dayOfWeek === dayKey(date));
        if (!selectedDay) return [String(menu.classroomId), []];
        const result = await checkMenuAllergies({ classroomId: menu.classroomId, days: [selectedDay] });
        return [String(menu.classroomId), result.data.warnings || []];
      }));
      if (currentRequest !== requestId.current) return;
      setPlan(nextPlan);
      setWarnings(alerts.flat());
      setMenus(weeklyMenus);
      setMenuConflicts(Object.fromEntries(conflictPairs));
      setDishes(dishResponse.data.data || []);
      setInventory(inventoryResponse.data.data || []);
      setState({ loading: false, error: '', updatedAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) });
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setPlan(null);
      setWarnings([]);
      setMenus([]);
      setMenuConflicts({});
      setDishes([]);
      setInventory([]);
      setState({ loading: false, error: kitchenErrorMessage(error, 'Không tải được dữ liệu bếp. Hãy thử cập nhật lại.'), updatedAt: '' });
    }
  }, [date]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => { window.clearTimeout(timer); requestId.current += 1; };
  }, [load, refreshKey]);

  const changeDate = (nextDate) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || Number.isNaN(new Date(`${nextDate}T00:00:00.000Z`).getTime())) {
      setState((old) => ({ ...old, error: 'Ngày phục vụ không hợp lệ. Hãy chọn lại ngày.', loading: false }));
      return;
    }
    setState((old) => ({ ...old, loading: true, error: '' }));
    setDate(nextDate);
  };
  const refresh = () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    setRefreshKey((value) => value + 1);
  };
  const menuByClass = new Map();
  menus.forEach((menu) => {
    const key = String(menu.classroomId);
    if (!menuByClass.has(key) || (menu.status === 'published' && menuByClass.get(key).status !== 'published')) menuByClass.set(key, menu);
  });
  const ingredientPlan = plan ? buildKitchenIngredientPlan({
    classes: plan.classBreakdown || [], menus, dishes, inventory, date, dayOfWeek: dayKey(date)
  }) : null;

  return <AppShell title="Bếp hôm nay" subtitle="Suất ăn, điểm danh và lưu ý trước khi chế biến">
    <main className="chef-dashboard">
      <div className="chef-toolbar content-card">
        <div><p className="card-kicker">VẬN HÀNH BẾP</p><h2>Kế hoạch ngày {date.split('-').reverse().join('/')}</h2><p>Số suất thay đổi theo điểm danh. Kiểm tra lại trước khi chuẩn bị mỗi bữa.</p></div>
        <div className="chef-toolbar-actions"><label>Ngày phục vụ<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={refresh} disabled={state.loading}>Cập nhật số liệu</button></div>
      </div>

      {state.error && <div className="form-error" role="alert">{state.error}</div>}
      {state.loading && <div className="content-card chef-loading">Đang đối chiếu điểm danh và hồ sơ ăn uống...</div>}
      {!state.loading && plan && <>
        <div className="chef-metrics">
          <article className="chef-metric chef-metric-main"><small>TỔNG SUẤT CẦN NẤU</small><strong>{plan.totalRecommendedServings}</strong><span>Trẻ đã có mặt hoặc đi muộn</span></article>
          <article className="chef-metric"><small>CHƯA ĐIỂM DANH</small><strong>{plan.totalUnmarkedStudents}</strong><span>Có thể làm thay đổi số suất</span></article>
          <article className="chef-metric"><small>ĐÃ BÁO NGHỈ</small><strong>{plan.totalAbsentStudents}</strong><span>Không tính vào suất nấu</span></article>
          <article className="chef-metric chef-metric-alert"><small>TRẺ CÓ LƯU Ý ĂN UỐNG</small><strong>{warnings.length}</strong><span>Đang có mặt hôm nay</span></article>
        </div>

        {plan.totalUnmarkedStudents > 0 && <div className="chef-attendance-note" role="status"><strong>Điểm danh chưa hoàn tất.</strong> Số suất hiện chỉ tính trẻ đã xác nhận có mặt hoặc đi muộn. Cập nhật lại trước khi chốt lượng nấu.</div>}

        <section className="content-card chef-menus">
          <div className="chef-section-heading"><div><p className="card-kicker">THỰC ĐƠN NGÀY</p><h2>Món cần chuẩn bị theo lớp</h2></div><Link className="button button-secondary" to="/nutrition?tab=menus">Quản lý thực đơn tuần</Link></div>
          <div className="chef-menu-list">{plan.classBreakdown?.map((item) => {
            const menu = menuByClass.get(String(item.classroomId));
            const day = menu?.status === 'published' ? menu.days?.find((entry) => entry.dayOfWeek === dayKey(date)) : null;
            const conflicts = menu?.status === 'published' ? menuConflicts[String(item.classroomId)] || [] : [];
            return <article key={item.classroomId} className={day ? '' : 'chef-menu-missing'}>
              <div className="chef-menu-head"><strong>{item.className}</strong><span>{item.recommendedServings} suất</span></div>
              {!day ? <p className="chef-menu-status">{menu && menu.status !== 'published' ? 'Thực đơn tuần chưa được phê duyệt, không dùng bản nháp để nấu.' : 'Chưa có thực đơn đã công bố cho ngày này. Cần xác nhận với người phụ trách trước khi nấu.'}</p>
                : <><div className="chef-meal-list">{todayMeals(day).map(([label, dishes]) => <div key={label}><small>{label}</small><strong>{dishes}</strong></div>)}</div>{conflicts.length > 0 && <p className="chef-menu-conflict" role="alert">{conflicts.length} xung đột dị ứng theo hồ sơ hiện tại: {conflicts.map((warning) => `${warning.dishName} (${warning.allergenMatched || warning.studentName})`).join('; ')}. Không chế biến món liên quan cho lớp này; báo người phụ trách điều chỉnh thực đơn.</p>}</>}
            </article>;
          })}</div>
        </section>

        <section className="content-card chef-warnings">
          <div className="chef-section-heading"><div><p className="card-kicker">CẦN XEM TRƯỚC KHI NẤU</p><h2>Cảnh báo ăn uống hôm nay</h2></div><span>{warnings.length} trẻ cần lưu ý</span></div>
          {warnings.length ? <div className="chef-warning-list">{warnings.map((student) => <article key={`${student.classroomId}-${student.studentId}`}><div><strong>{student.studentName}</strong><small>{student.className}</small></div><div>{student.allergies?.length > 0 && <p><b>Dị ứng:</b> {student.allergies.map((allergy) => [allergy.allergen, allergy.severity, allergy.note].filter(Boolean).join(' · ')).join('; ')}</p>}{student.medicalReviewRequired && <p><b>Cần xác nhận với y tế trường:</b> {student.medicalNote}</p>}</div></article>)}</div>
            : <p className="chef-empty">Không có lưu ý ăn uống của trẻ đã điểm danh có mặt. Vẫn phải đối chiếu thực đơn được duyệt trước khi nấu.</p>}
          <p className="chef-safety-note">Không tự thay đổi chế độ ăn theo ghi chú bệnh lý; cần xác nhận với y tế trường và người phụ trách.</p>
        </section>

        <section className="content-card chef-ingredients">
          <div className="chef-section-heading"><div><p className="card-kicker">CHUẨN BỊ NGUYÊN LIỆU</p><h2>Định lượng và tồn kho</h2></div><Link className="button button-secondary" to="/nutrition?tab=inventory">Mở kho thực phẩm</Link></div>
          <p className="chef-ingredient-hint">Nhu cầu = định lượng của món cho một trẻ × số suất theo điểm danh. Tồn kho là số lượng hiện tại ở các lô còn hạn vào ngày phục vụ; số liệu chưa thay thế bước kiểm tra thực tế.</p>
          {(ingredientPlan.missingMenus.length > 0 || ingredientPlan.missingRecipes.length > 0 || ingredientPlan.incompatibleStockUnits.length > 0) && <div className="chef-ingredient-warning" role="status"><strong>Chưa thể đối chiếu đầy đủ nguyên liệu:</strong>{ingredientPlan.missingMenus.length > 0 && <p>Thiếu thực đơn đã công bố: {ingredientPlan.missingMenus.join(', ')}.</p>}{ingredientPlan.missingRecipes.length > 0 && <p>Món chưa có công thức/định lượng hợp lệ: {ingredientPlan.missingRecipes.join(', ')}. Cập nhật trong “Món ăn & Dinh dưỡng”.</p>}{ingredientPlan.incompatibleStockUnits.length > 0 && <p>Đơn vị công thức và kho không tương thích: {ingredientPlan.incompatibleStockUnits.join('; ')}. Cần đối chiếu thủ công.</p>}</div>}
          <div className="chef-ingredient-table-wrap"><table className="chef-ingredient-table"><thead><tr><th>Nguyên liệu</th><th>Cần chuẩn bị</th><th>Tồn khả dụng</th><th>Còn thiếu</th></tr></thead><tbody>{ingredientPlan.rows.map((row) => <tr key={`${row.ingredientId}:${row.unit}`}><td>{row.ingredientName}</td><td>{displayIngredientQuantity(row.required, row.unit)}</td><td>{displayIngredientQuantity(row.available, row.unit)}</td><td className={row.shortage > 0 ? 'is-short' : 'is-enough'}>{row.shortage > 0 ? displayIngredientQuantity(row.shortage, row.unit) : 'Đủ theo sổ kho'}</td></tr>)}</tbody></table>{!ingredientPlan.rows.length && <p className="chef-empty">Chưa có định lượng nguyên liệu để đối chiếu. Hãy thêm công thức cho món ăn trong thực đơn.</p>}</div>
        </section>

        <section className="content-card chef-classes">
          <div className="chef-section-heading"><div><p className="card-kicker">THEO TỪNG LỚP</p><h2>Suất cần chuẩn bị</h2></div><small>Cập nhật lúc {state.updatedAt}</small></div>
          <div className="chef-class-list">{plan.classBreakdown?.map((item) => <article key={item.classroomId}><div><strong>{item.className}</strong><small>{item.attendanceComplete ? 'Đã điểm danh đủ' : `Còn ${item.unmarkedCount} trẻ chưa điểm danh`}</small></div><div className="chef-class-count"><strong>{item.recommendedServings}</strong><span>/ {item.totalEnrolledStudents} trẻ</span></div></article>)}</div>
          {!plan.classBreakdown?.length && <p className="chef-empty">Chưa có lớp đang hoạt động.</p>}
        </section>

        <MealServingOperations key={`servings-${date}`} role={JSON.parse(localStorage.getItem('user') || '{}').role} date={date} classes={plan.classBreakdown || []} />
        <KitchenSafetyPanel key={`safety-${date}`} role={JSON.parse(localStorage.getItem('user') || '{}').role} date={date} />
        <KitchenReconciliationPanel key={`reconciliation-${date}`} role={JSON.parse(localStorage.getItem('user') || '{}').role} date={date} />

        <div className="chef-actions"><Link className="button button-primary" to="/nutrition?tab=menus">Xem thực đơn theo lớp</Link><Link className="button button-secondary" to="/nutrition?tab=dailyKitchenReport">Xem báo cáo suất ăn & kho</Link><Link className="button button-secondary" to="/nutrition?tab=inventory">Kiểm tra kho thực phẩm</Link></div>
      </>}
    </main>
  </AppShell>;
}
