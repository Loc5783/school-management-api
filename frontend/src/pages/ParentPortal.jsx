/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/axiosConfig";
import { createLeaveRequest, getLeaveRequests } from "../api/attendance";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";

const attendanceText = {
  present: "Có mặt",
  absent: "Vắng",
  late: "Đi muộn",
  absent_permission: "Có phép",
};
const leaveText = {
  pending: "Đang chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
  cancelled: "Đã hủy",
};
const dateText = (value) =>
  value ? new Date(value).toLocaleDateString("vi-VN") : "—";
const money = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value || 0);
const mealItems = (meal = {}) =>
  Array.isArray(meal)
    ? meal
    : Array.isArray(meal.items)
      ? meal.items
      : meal.dishName
        ? [meal]
        : [];
const dishes = (meal) =>
  mealItems(meal)
    .map((item) => item.dishName || item.name)
    .filter(Boolean)
    .join(", ");
const lunchDishes = (lunch = {}) =>
  [
    ...(lunch.mainDishes || (lunch.mainDish?.dishName ? [lunch.mainDish] : [])),
    ...(lunch.stirFryDishes ||
      (lunch.stirFryDish?.dishName ? [lunch.stirFryDish] : [])),
    ...(lunch.soupDishes || (lunch.soupDish?.dishName ? [lunch.soupDish] : [])),
    ...(lunch.desserts || (lunch.dessert?.dishName ? [lunch.dessert] : [])),
  ]
    .map((item) => item.dishName || item.name)
    .filter(Boolean)
    .join(", ");
const today = () => new Date().toISOString().slice(0, 10);
const parentAllergens = [
  ["gluten", "Gluten / lúa mì"], ["crustacean", "Tôm, cua / giáp xác"],
  ["fish", "Cá"], ["egg", "Trứng"], ["milk", "Sữa"],
  ["peanut", "Đậu phộng / lạc"], ["soy", "Đậu nành"],
  ["sesame", "Mè / vừng"], ["tree_nut", "Các loại hạt"], ["mollusc", "Nhuyễn thể"],
];
const dateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";

export default function ParentPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("profile");
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [data, setData] = useState({
    profile: null,
    attendance: [],
    invoices: [],
    menus: [],
    leaves: [],
    announcements: [],
    notifications: [],
    profileChangeRequests: [],
  });
  const [state, setState] = useState({ loading: true, error: "" });
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const [profileForm, setProfileForm] = useState({});
  const [onlinePaymentInvoice, setOnlinePaymentInvoice] = useState(null);
  const [leaveNotice, setLeaveNotice] = useState("");
  const [leaveForm, setLeaveForm] = useState({
    startDate: today(),
    endDate: today(),
    reason: "",
  });
  const selected = useMemo(
    () => students.find((item) => item._id === selectedId),
    [students, selectedId],
  );
  const isOverview = location.pathname === "/parent-dashboard";
  const openPortalTab = (tab) => {
    setActiveTab(tab);
    navigate("/parent-portal");
  };

  const loadChildren = useCallback(async () => {
    try {
      const res = await api.get("/students", {
        params: { status: "all", limit: 100, sortBy: "fullName" },
      });
      const list = res.data.data || [];
      setStudents(list);
      setSelectedId((current) => current || list[0]?._id || "");
    } catch (err) {
      setState({
        loading: false,
        error: err.response?.data?.message || "Không thể tải hồ sơ của con.",
      });
    }
  }, []);
  const loadChildData = useCallback(async () => {
    if (!selected) return;
    setState((old) => ({ ...old, loading: true, error: "" }));
    try {
      const end = today();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const [
        profileRes,
        attendanceRes,
        invoiceRes,
        menuRes,
        leaveRes,
        announcementRes,
        notificationRes,
        profileRequestRes,
      ] = await Promise.all([
        api.get(`/students/${selected._id}`),
        api.get(`/attendance/student/${selected._id}`, {
          params: {
            startDate: startDate.toISOString().slice(0, 10),
            endDate: end,
          },
        }),
        api.get(`/finance/tuition/student/${selected._id}`),
        api.get("/nutrition/menus", {
          params: { classroomId: selected.classroomId },
        }),
        getLeaveRequests(),
        api.get("/class-communication/announcements", {
          params: { classroomId: selected.classroomId },
        }),
        api.get("/notifications", { params: { limit: 8 } }),
        api.get("/student-profile-change-requests", { params: { studentId: selected._id, limit: 10 } }),
      ]);
      const leaves = (leaveRes.data.data || []).filter(
        (item) => String(item.studentId) === selected._id,
      );
      setData({
        profile: profileRes.data.data || selected,
        attendance: attendanceRes.data.data || [],
        invoices: invoiceRes.data.data || [],
        menus: menuRes.data.data || [],
        leaves,
        announcements: announcementRes.data.data || [],
        notifications: notificationRes.data.data || [],
        profileChangeRequests: profileRequestRes.data.data || [],
      });
      setState({ loading: false, error: "" });
    } catch (err) {
      setState({
        loading: false,
        error: err.response?.data?.message || "Không thể tải dữ liệu của con.",
      });
    }
  }, [selected]);
  useEffect(() => {
    loadChildren();
  }, [loadChildren]);
  useEffect(() => {
    loadChildData();
  }, [loadChildData]);
  const submitLeave = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setLeaveSaving(true);
    setLeaveNotice("");
    try {
      await createLeaveRequest({ studentId: selected._id, ...leaveForm });
      setLeaveNotice(
        "Đã gửi đơn xin nghỉ. Nhà trường sẽ phản hồi sau khi duyệt.",
      );
      setLeaveForm({ startDate: today(), endDate: today(), reason: "" });
      await loadChildData();
    } catch (err) {
      setLeaveNotice(
        err.response?.data?.message || "Không thể gửi đơn xin nghỉ.",
      );
    } finally {
      setLeaveSaving(false);
    }
  };
  const beginProfileEdit = () => {
    setProfileNotice("");
    setProfileForm({
      fullName: child.fullName || "", birthDate: dateInput(child.birthDate), gender: child.gender || "male",
      address: child.address || "", nationality: child.nationality || "Việt Nam", ethnicity: child.ethnicity || "",
      birthPlace: child.birthPlace || "", allergens: (child.allergies || []).map((item) => item.allergen).filter(Boolean),
      diseaseName: child.disease?.name || "", diseaseDescription: child.disease?.description || "",
      emergencyName: child.emergencyContact?.name || "", emergencyPhone: child.emergencyContact?.phone || "",
      emergencyRelationship: child.emergencyContact?.relationship || "",
    });
    setProfileEditing(true);
  };
  const toggleParentAllergen = (allergen) => setProfileForm((old) => ({
    ...old,
    allergens: old.allergens?.includes(allergen) ? old.allergens.filter((item) => item !== allergen) : [...(old.allergens || []), allergen],
  }));
  const saveProfile = async (event) => {
    event.preventDefault(); setProfileSaving(true); setProfileNotice("");
    try {
      await api.post("/student-profile-change-requests", {
        studentId: selected._id,
        changes: {
        fullName: profileForm.fullName, birthDate: profileForm.birthDate, gender: profileForm.gender,
        address: profileForm.address, nationality: profileForm.nationality, ethnicity: profileForm.ethnicity,
        birthPlace: profileForm.birthPlace,
        allergies: (profileForm.allergens || []).map((allergen) => ({ allergen, severity: "moderate" })),
        disease: { name: profileForm.diseaseName, description: profileForm.diseaseDescription },
        emergencyContact: { name: profileForm.emergencyName, phone: profileForm.emergencyPhone, relationship: profileForm.emergencyRelationship },
        },
      });
      await loadChildData();
      setProfileEditing(false); setProfileNotice("Đã gửi yêu cầu cập nhật hồ sơ. Nhà trường sẽ phê duyệt trước khi áp dụng.");
    } catch (err) { setProfileNotice(err.response?.data?.message || "Không thể gửi yêu cầu cập nhật hồ sơ."); }
    finally { setProfileSaving(false); }
  };
  const upcomingInvoices = data.invoices.filter(
    (item) => (item.totalAmount || 0) > (item.paidAmount || 0),
  );
  const latestMenu = data.menus[0];
  const child = data.profile || selected;
  const todayAttendance = data.attendance.find(
    (item) => String(item.attendDate || "").slice(0, 10) === today(),
  );
  const pendingLeaves = data.leaves.filter((item) => item.status === "pending");
  const overdueInvoices = upcomingInvoices.filter(
    (item) => item.dueDate && new Date(item.dueDate) < new Date(`${today()}T00:00:00`),
  );
  const unreadNotifications = data.notifications.filter((item) => !item.isRead);
  const menuForToday = latestMenu?.days?.find(
    (day) => String(day.date || "").slice(0, 10) === today(),
  );
  const actionItems = [
    ...(overdueInvoices.length ? [{ type: "finance", icon: "money", title: `${overdueInvoices.length} hóa đơn quá hạn`, detail: `Cần thanh toán ${money(overdueInvoices.reduce((sum, item) => sum + Math.max(0, (item.totalAmount || 0) - (item.paidAmount || 0)), 0))}.`, tab: "finance" }] : []),
    ...(pendingLeaves.length ? [{ type: "leave", icon: "calendar", title: `${pendingLeaves.length} đơn xin nghỉ đang chờ duyệt`, detail: "Nhà trường sẽ phản hồi sau khi xét duyệt.", tab: "leave" }] : []),
    ...(unreadNotifications.length ? [{ type: "notification", icon: "bell", title: `${unreadNotifications.length} thông báo chưa đọc`, detail: unreadNotifications[0]?.title || "Có thông tin mới từ nhà trường.", tab: "announcements" }] : []),
  ];
  return (
    <AppShell
      title={isOverview ? "Tổng quan phụ huynh" : "Cổng thông tin phụ huynh"}
      subtitle={isOverview ? "Theo dõi nhanh những việc cần xử lý và tình hình hôm nay của con." : "Theo dõi thông tin, điểm danh, thực đơn, học phí và gửi đơn xin nghỉ cho con."}
    >
      {state.error && <div className="form-error">{state.error}</div>}
      {students.length > 1 && (
        <section className="parent-child-switcher">
          {students.map((student) => (
            <button
              key={student._id}
              className={student._id === selectedId ? "active" : ""}
              onClick={() => setSelectedId(student._id)}
            >
              <span className="student-avatar">
                {student.fullName?.charAt(0) || "B"}
              </span>
              <span>
                <strong>{student.fullName}</strong>
                <small>{student.currentClassName || "Chưa xếp lớp"}</small>
              </span>
            </button>
          ))}
        </section>
      )}
      {state.loading && !selected ? (
        <div className="page-loader">
          <span className="loading-orb" />
          Đang tải thông tin...
        </div>
      ) : !selected ? (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="students" />
          </span>
          <strong>Chưa có hồ sơ học sinh được liên kết</strong>
          <p>
            Vui lòng liên hệ nhà trường để xác minh thông tin phụ huynh và học
            sinh.
          </p>
        </div>
      ) : (
        <>
          <section className="parent-child-hero">
            <span className="student-avatar large">
              {child.fullName?.charAt(0) || "B"}
            </span>
            <div>
              <p className="card-kicker">{child.studentCode}</p>
              <h2>{child.fullName}</h2>
              <p>
                {child.currentClassName || "Chưa xếp lớp"} ·{" "}
                {child.gender === "female" ? "Nữ" : "Nam"} · Sinh ngày{" "}
                {dateText(child.birthDate)}
              </p>
            </div>
            <div>
              <span className="student-status enrolled">
                {child.status === "enrolled" ? "Đang theo học" : child.status}
              </span>
            </div>
          </section>
          <section className="parent-summary-grid">
            <article>
              <span>
                <Icon name="attendance" />
              </span>
              <div>
                <small>Điểm danh 30 ngày</small>
                <strong>
                  {
                    data.attendance.filter((item) => item.status === "present")
                      .length
                  }{" "}
                  ngày có mặt
                </strong>
              </div>
            </article>
            <article>
              <span>
                <Icon name="money" />
              </span>
              <div>
                <small>Học phí cần theo dõi</small>
                <strong>
                  {money(
                    upcomingInvoices.reduce(
                      (sum, item) =>
                        sum +
                        Math.max(
                          0,
                          (item.totalAmount || 0) - (item.paidAmount || 0),
                        ),
                      0,
                    ),
                  )}
                </strong>
              </div>
            </article>
            <article>
              <span>
                <Icon name="utensils" />
              </span>
              <div>
                <small>Thực đơn</small>
                <strong>
                  {latestMenu
                    ? `Tuần ${latestMenu.weekNumber}`
                    : "Chưa công bố"}
                </strong>
              </div>
            </article>
          </section>
          {isOverview ? (
            <section className="parent-dashboard">
              <article className="content-card parent-action-card">
                <div className="card-heading">
                  <div>
                    <p className="card-kicker">ƯU TIÊN HÔM NAY</p>
                    <h2>Việc phụ huynh cần xử lý</h2>
                  </div>
                  <span className={`parent-action-count ${actionItems.length ? "has-actions" : ""}`}>{actionItems.length}</span>
                </div>
                {actionItems.length ? (
                  <div className="parent-action-list">
                    {actionItems.map((item) => <button type="button" key={item.type} className={`parent-action-item ${item.type}`} onClick={() => openPortalTab(item.tab)}>
                      <span><Icon name={item.icon} size={18} /></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><Icon name="chevronRight" size={17} />
                    </button>)}
                  </div>
                ) : <div className="parent-all-clear"><span><Icon name="check" size={20} /></span><div><strong>Hôm nay chưa có việc nào cần xử lý</strong><p>Bạn sẽ nhận thông báo tại đây khi có khoản cần thanh toán, đơn xin nghỉ hoặc thông tin mới.</p></div></div>}
              </article>
              <div className="parent-dashboard-side">
                <article className="content-card parent-today-card">
                  <div className="card-heading"><div><p className="card-kicker">TÌNH HÌNH HÔM NAY</p><h2>{child.fullName}</h2></div></div>
                  <div className="parent-today-list">
                    <div><span className={`parent-today-icon ${todayAttendance?.status === "present" ? "good" : ""}`}><Icon name="attendance" size={16} /></span><p><small>Điểm danh</small><strong>{todayAttendance ? (attendanceText[todayAttendance.status] || todayAttendance.status) : "Chưa có dữ liệu"}</strong></p></div>
                    <div><span className="parent-today-icon warm"><Icon name="utensils" size={16} /></span><p><small>Bữa trưa</small><strong>{menuForToday ? (lunchDishes(menuForToday.lunch) || "Đã có thực đơn") : "Chưa công bố"}</strong></p></div>
                    <div><span className="parent-today-icon purple"><Icon name="classes" size={16} /></span><p><small>Lớp học</small><strong>{child.currentClassName || "Chưa xếp lớp"}</strong></p></div>
                  </div>
                </article>
                <article className="content-card parent-quick-card">
                  <p className="card-kicker">TRUY CẬP NHANH</p>
                  <div><button type="button" onClick={() => openPortalTab("leave")}><Icon name="calendar" size={16} /> Xin nghỉ</button><button type="button" onClick={() => openPortalTab("menu")}><Icon name="utensils" size={16} /> Thực đơn</button><button type="button" onClick={() => openPortalTab("finance")}><Icon name="money" size={16} /> Học phí</button></div>
                </article>
              </div>
              <article className="content-card parent-notification-card">
                <div className="card-heading"><div><p className="card-kicker">THÔNG TIN MỚI</p><h2>Thông báo gần đây</h2></div><button type="button" className="button button-secondary" onClick={() => openPortalTab("announcements")}>Xem thông báo lớp</button></div>
                {data.notifications.length ? <div className="parent-dashboard-notifications">{data.notifications.slice(0, 4).map((item) => <button type="button" key={item._id} className={item.isRead ? "" : "unread"} onClick={() => openPortalTab("announcements")}><span><Icon name={item.type === "finance" ? "money" : item.type === "attendance" ? "attendance" : "bell"} size={16} /></span><div><strong>{item.title}</strong><small>{item.message}</small></div>{!item.isRead && <i aria-label="Chưa đọc" />}</button>)}</div> : <div className="empty-state compact">Chưa có thông báo mới từ nhà trường.</div>}
              </article>
            </section>
          ) : <>
          <nav className="parent-portal-tabs" aria-label="Chức năng dành cho phụ huynh">
            {[
              ["profile", "students", "Hồ sơ của con"],
              ["announcements", "bell", "Thông báo lớp"],
              ["attendance", "attendance", "Điểm danh"],
              ["leave", "calendar", "Xin nghỉ & phản hồi"],
              ["finance", "money", "Học phí"],
              ["menu", "utensils", "Thực đơn bán trú"],
            ].map(([key, icon, label]) => (
              <button
                key={key}
                type="button"
                className={activeTab === key ? "active" : ""}
                onClick={() => setActiveTab(key)}
                aria-current={activeTab === key ? "page" : undefined}
              >
                <Icon name={icon} size={16} />
                {label}
              </button>
            ))}
          </nav>
          {activeTab === "profile" && (
          <section className="content-card parent-profile-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">HỒ SƠ CỦA CON</p>
                <h2>Thông tin nhà trường đang lưu</h2>
              </div>
              <div className="parent-profile-actions">
                <span className="history-count">Năm học {child.schoolYear || "—"}</span>
                {!profileEditing && <button type="button" className="button button-primary" onClick={beginProfileEdit}><Icon name="settings" size={15} /> Gửi yêu cầu cập nhật</button>}
              </div>
            </div>
            {profileNotice && <div className={`timekeeping-notice ${profileNotice.startsWith("Đã ") ? "success" : "error"}`}>{profileNotice}</div>}
            {profileEditing ? (
            <form className="student-form-grid parent-profile-form" onSubmit={saveProfile}>
              <div className="parent-form-section-title form-wide"><span><Icon name="students" size={17} /></span><div><strong>Thông tin cơ bản</strong><small>Thông tin nhận diện và nơi ở hiện tại của bé</small></div></div>
              <label>Họ và tên<input required maxLength="120" value={profileForm.fullName || ""} onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })} /></label>
              <label>Ngày sinh<input required type="date" max={today()} value={profileForm.birthDate || ""} onChange={(e) => setProfileForm({ ...profileForm, birthDate: e.target.value })} /></label>
              <label>Giới tính<select value={profileForm.gender || "male"} onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}><option value="male">Nam</option><option value="female">Nữ</option></select></label>
              <label>Quốc tịch<input maxLength="80" value={profileForm.nationality || ""} onChange={(e) => setProfileForm({ ...profileForm, nationality: e.target.value })} /></label>
              <label>Dân tộc<input maxLength="80" value={profileForm.ethnicity || ""} onChange={(e) => setProfileForm({ ...profileForm, ethnicity: e.target.value })} /></label>
              <label>Nơi sinh<input maxLength="120" value={profileForm.birthPlace || ""} onChange={(e) => setProfileForm({ ...profileForm, birthPlace: e.target.value })} /></label>
              <label className="form-wide">Địa chỉ<input maxLength="500" value={profileForm.address || ""} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} /></label>
              <div className="parent-form-section-title form-wide"><span className="warm"><Icon name="utensils" size={17} /></span><div><strong>Dị ứng và dinh dưỡng</strong><small>Dữ liệu này sẽ được giáo viên và nhà bếp sử dụng khi chuẩn bị bữa ăn</small></div></div>
              <fieldset className="form-wide parent-allergy-field"><legend>Dị ứng / lưu ý ăn uống</legend><p>Chọn các nhóm thực phẩm bé bị dị ứng để giáo viên và nhà bếp nhận biết.</p><div>{parentAllergens.map(([value, label]) => <label key={value}><input type="checkbox" checked={profileForm.allergens?.includes(value) || false} onChange={() => toggleParentAllergen(value)} /> <span>{label}</span></label>)}</div></fieldset>
              <div className="parent-form-section-title form-wide"><span className="green"><Icon name="phone" size={17} /></span><div><strong>Sức khỏe và liên hệ khẩn cấp</strong><small>Cung cấp người có thể liên hệ ngay khi bé cần hỗ trợ</small></div></div>
              <label>Bệnh lý cần lưu ý<input maxLength="120" value={profileForm.diseaseName || ""} onChange={(e) => setProfileForm({ ...profileForm, diseaseName: e.target.value })} /></label>
              <label>Mô tả bệnh lý<input maxLength="500" value={profileForm.diseaseDescription || ""} onChange={(e) => setProfileForm({ ...profileForm, diseaseDescription: e.target.value })} /></label>
              <label>Người liên hệ khẩn cấp<input maxLength="120" value={profileForm.emergencyName || ""} onChange={(e) => setProfileForm({ ...profileForm, emergencyName: e.target.value })} /></label>
              <label>Số điện thoại<input maxLength="15" value={profileForm.emergencyPhone || ""} onChange={(e) => setProfileForm({ ...profileForm, emergencyPhone: e.target.value })} /></label>
              <label className="form-wide">Quan hệ với bé<input maxLength="80" value={profileForm.emergencyRelationship || ""} onChange={(e) => setProfileForm({ ...profileForm, emergencyRelationship: e.target.value })} /></label>
              <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={() => setProfileEditing(false)}>Hủy</button><button className="button button-primary" disabled={profileSaving}>{profileSaving ? "Đang lưu..." : "Lưu hồ sơ"}</button></div>
              <p className="form-wide parent-profile-policy">Mọi thay đổi đều được gửi nhà trường phê duyệt trước khi áp dụng. Mã học sinh, lớp, năm học và trạng thái học tập do nhà trường quản lý.</p>
            </form>
            ) : (
            <div className="parent-profile-grid">
              <div>
                <small>Ngày nhập học</small>
                <strong>{dateText(child.admissionDate)}</strong>
              </div>
              <div>
                <small>Nơi sinh</small>
                <strong>{child.birthPlace || "Chưa cập nhật"}</strong>
              </div>
              <div>
                <small>Quốc tịch / dân tộc</small>
                <strong>
                  {[child.nationality, child.ethnicity]
                    .filter(Boolean)
                    .join(" · ") || "Chưa cập nhật"}
                </strong>
              </div>
              <div>
                <small>Địa chỉ</small>
                <strong>{child.address || "Chưa cập nhật"}</strong>
              </div>
              <div className="is-wide">
                <small>Dị ứng / lưu ý ăn uống</small>
                <strong>
                  {child.allergies?.length
                    ? child.allergies
                        .map(
                          (item) =>
                            `${item.allergen}${item.note ? ` (${item.note})` : ""}`,
                        )
                        .join(", ")
                    : "Không có dữ liệu dị ứng"}
                </strong>
              </div>
              <div className="is-wide">
                <small>Bệnh lý cần lưu ý</small>
                <strong>
                  {child.disease?.name
                    ? [child.disease.name, child.disease.note]
                        .filter(Boolean)
                        .join(" · ")
                    : "Không có dữ liệu bệnh lý"}
                </strong>
              </div>
              <div>
                <small>Liên hệ khẩn cấp</small>
                <strong>
                  {child.emergencyContact?.name || "Chưa cập nhật"}
                </strong>
                <p>{child.emergencyContact?.phone || ""}</p>
              </div>
              <div>
                <small>Ghi chú nhà trường</small>
                <strong>{child.notes || "Không có ghi chú"}</strong>
              </div>
            </div>
            )}
            {data.profileChangeRequests.length > 0 && <div className="parent-profile-request-history"><strong>Yêu cầu cập nhật gần đây</strong>{data.profileChangeRequests.slice(0, 3).map((request) => <div key={request._id}><span className={`student-status ${request.status === 'approved' ? 'enrolled' : request.status === 'pending' ? 'temporarily_absent' : 'withdrawn'}`}>{request.status === 'pending' ? 'Chờ duyệt' : request.status === 'approved' ? 'Đã duyệt' : request.status === 'rejected' ? 'Từ chối' : 'Đã hủy'}</span><p>{new Date(request.createdAt).toLocaleDateString('vi-VN')} · {Object.keys(request.changes || {}).length} thông tin thay đổi{request.reviewNote ? ` · ${request.reviewNote}` : ''}</p></div>)}</div>}
          </section>
          )}
          {activeTab === "announcements" && (
          <section className="content-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">THÔNG BÁO LỚP</p>
                <h2>Thông tin từ giáo viên</h2>
              </div>
            </div>
            <div className="daily-care-history parent-care-history">
              {data.announcements.length ? (
                data.announcements.slice(0, 6).map((item) => (
                  <article key={item._id}>
                    <div>
                      <strong>{item.title}</strong>
                      <small>{dateText(item.publishedAt)}</small>
                    </div>
                    <p>{item.content}</p>
                    <p>
                      <b>Người gửi:</b> {item.createdByName}
                    </p>
                  </article>
                ))
              ) : (
                <div className="empty-state compact">
                  Chưa có thông báo mới từ lớp.
                </div>
              )}
            </div>
          </section>
          )}
          {activeTab === "attendance" && (
          <section className="parent-portal-grid parent-leave-grid">
            <article className="content-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">ĐIỂM DANH</p>
                  <h2>30 ngày gần đây</h2>
                </div>
              </div>
              {state.loading ? (
                <div className="inline-loader">
                  <span className="loading-orb" />
                  Đang tải...
                </div>
              ) : data.attendance.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Trạng thái</th>
                        <th>Giờ đến</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attendance.slice(0, 8).map((item) => (
                        <tr key={item._id}>
                          <td>{dateText(item.attendDate)}</td>
                          <td>
                            <span
                              className={`student-status ${item.status === "present" ? "enrolled" : "temporarily_absent"}`}
                            >
                              {attendanceText[item.status] || item.status}
                            </span>
                          </td>
                          <td>
                            {item.checkInTime
                              ? new Date(item.checkInTime).toLocaleTimeString(
                                  "vi-VN",
                                  { hour: "2-digit", minute: "2-digit" },
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state compact">
                  Chưa có bản ghi điểm danh.
                </div>
              )}
            </article>
          </section>
          )}
          {activeTab === "finance" && (
          <section className="parent-portal-grid parent-leave-grid">
            <article className="content-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">HỌC PHÍ</p>
                  <h2>Hóa đơn của con</h2>
                </div>
              </div>
              {upcomingInvoices.length ? (
                <div className="parent-invoice-list">
                  {upcomingInvoices.slice(0, 5).map((item) => (
                    <article key={item._id}>
                      <div>
                        <strong>Tháng {item.period}</strong>
                        <small>Hạn thanh toán: {dateText(item.dueDate)}</small>
                      </div>
                      <div className="parent-invoice-payment">
                        <span>{money(Math.max(0, (item.totalAmount || 0) - (item.paidAmount || 0)))}</span>
                        <button type="button" onClick={() => setOnlinePaymentInvoice(item)}>
                          <Icon name="money" size={14} /> Thanh toán online
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact">
                  Chưa có hóa đơn cần theo dõi.
                </div>
              )}
            </article>
          </section>
          )}
          {activeTab === "leave" && (
          <section className="parent-portal-grid parent-leave-grid">
            <article className="content-card student-form">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">XIN NGHỈ</p>
                  <h2>Gửi đơn cho {selected.fullName}</h2>
                </div>
              </div>
              {leaveNotice && (
                <div
                  className={`timekeeping-notice ${leaveNotice.startsWith("Đã ") ? "success" : "error"}`}
                >
                  {leaveNotice}
                </div>
              )}
              <form className="student-form-grid" onSubmit={submitLeave}>
                <label>
                  Từ ngày
                  <input
                    type="date"
                    min={today()}
                    value={leaveForm.startDate}
                    onChange={(e) =>
                      setLeaveForm({ ...leaveForm, startDate: e.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Đến ngày
                  <input
                    type="date"
                    min={leaveForm.startDate || today()}
                    value={leaveForm.endDate}
                    onChange={(e) =>
                      setLeaveForm({ ...leaveForm, endDate: e.target.value })
                    }
                    required
                  />
                </label>
                <label className="form-wide">
                  Lý do xin nghỉ
                  <textarea
                    value={leaveForm.reason}
                    onChange={(e) =>
                      setLeaveForm({ ...leaveForm, reason: e.target.value })
                    }
                    placeholder="Ví dụ: Bé bị sốt, cần nghỉ để theo dõi sức khỏe."
                    minLength="5"
                    maxLength="1000"
                    required
                  />
                </label>
                <div className="form-actions form-wide">
                  <button
                    className="button button-primary"
                    disabled={leaveSaving}
                  >
                    {leaveSaving ? "Đang gửi..." : "Gửi đơn xin nghỉ"}
                  </button>
                </div>
              </form>
              <div className="parent-leave-history"><strong>Lịch sử đơn xin nghỉ</strong>{data.leaves.length ? data.leaves.slice(0, 4).map((item) => <div key={item._id}><span>{dateText(item.startDate)} – {dateText(item.endDate)}</span><small>{leaveText[item.status]}</small></div>) : <p>Chưa có đơn xin nghỉ nào.</p>}</div>
            </article>
            <article className="content-card parent-leave-response-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">PHẢN HỒI ĐƠN XIN NGHỈ</p>
                  <h2>Nhà trường phản hồi</h2>
                </div>
              </div>
              <div className="parent-leave-responses">
                {data.leaves.length ? data.leaves.slice(0, 8).map((item) => (
                  <article key={item._id} className={`leave-response ${item.status}`}>
                    <div className="leave-response-head">
                      <div><strong>{dateText(item.startDate)} – {dateText(item.endDate)}</strong><small>{item.reason}</small></div>
                      <span className={`student-status ${item.status === "approved" ? "enrolled" : item.status === "pending" ? "temporarily_absent" : "withdrawn"}`}>{leaveText[item.status]}</span>
                    </div>
                    {item.status === "pending" ? <p>Đơn đang chờ nhà trường xét duyệt.</p> : <div className="leave-response-note"><b>{item.reviewerName || "Nhà trường"}</b><p>{item.reviewNote || (item.status === "approved" ? "Đơn xin nghỉ đã được duyệt và ghi nhận nghỉ có phép." : "Nhà trường chưa thể phê duyệt đơn xin nghỉ này.")}</p>{item.reviewedAt && <small>Phản hồi lúc {new Date(item.reviewedAt).toLocaleString("vi-VN")}</small>}</div>}
                  </article>
                )) : <div className="empty-state compact">Chưa có đơn xin nghỉ để nhà trường phản hồi.</div>}
              </div>
            </article>
          </section>
          )}
          {activeTab === "menu" && (
          <section className="content-card parent-menu-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">THỰC ĐƠN BÁN TRÚ</p>
                <h2>
                  {latestMenu
                    ? `Thực đơn lớp ${child.currentClassName || ""}`
                    : "Chưa có thực đơn được công bố"}
                </h2>
              </div>
              {latestMenu && (
                <span className="history-count">
                  Tuần {latestMenu.weekNumber}
                </span>
              )}
            </div>
            {latestMenu ? (
              <div className="parent-menu-days">
                {(latestMenu.days || []).slice(0, 5).map((day) => (
                  <article key={day.dayOfWeek}>
                    <strong>{dateText(day.date) || day.dayOfWeek}</strong>
                    <p>
                      <b>Sáng:</b> {dishes(day.breakfast) || "—"}
                    </p>
                    <p>
                      <b>Phụ sáng:</b> {dishes(day.morningSnack) || "—"}
                    </p>
                    <p>
                      <b>Trưa:</b> {lunchDishes(day.lunch) || "—"}
                    </p>
                    <p>
                      <b>Xế:</b> {dishes(day.afternoonSnack) || "—"}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                Nhà trường chưa công bố thực đơn cho lớp này.
              </div>
            )}
          </section>
          )}
          </>}
          {onlinePaymentInvoice && (
            <div className="modal-backdrop parent-payment-backdrop" role="dialog" aria-modal="true" aria-labelledby="online-payment-title">
              <section className="content-card parent-payment-coming-soon">
                <button type="button" className="parent-payment-close" onClick={() => setOnlinePaymentInvoice(null)} aria-label="Đóng">×</button>
                <span className="parent-payment-icon"><Icon name="money" size={27} /></span>
                <p className="card-kicker">THANH TOÁN HỌC PHÍ ONLINE</p>
                <h2 id="online-payment-title">Tính năng đang phát triển</h2>
                <p>Nhà trường đang hoàn thiện thanh toán bằng mã QR. Khi được kích hoạt, QR sẽ tự điền đúng số tiền và mã hóa đơn của bé.</p>
                <div className="parent-payment-summary"><span>Học phí kỳ {onlinePaymentInvoice.period}</span><strong>{money(Math.max(0, (onlinePaymentInvoice.totalAmount || 0) - (onlinePaymentInvoice.paidAmount || 0)))}</strong></div>
                <button type="button" className="button button-primary" onClick={() => setOnlinePaymentInvoice(null)}>Đã hiểu</button>
              </section>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
