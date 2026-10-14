import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import './PrincipalOverview.css';

const workTypes = [
  ['payroll', 'Bảng lương chờ duyệt', '/hr?tab=payroll'],
  ['leave', 'Đơn nghỉ nhân sự', '/hr?tab=leave'],
  ['recruitment', 'Ứng viên chờ quyết định', '/hr?tab=recruitment'],
  ['refunds', 'Hoàn học phí', '/finance?tab=refunds'],
  ['operatingExpenses', 'Đề nghị chi vận hành', '/accounting/operating-expenses'],
  ['profileChanges', 'Hồ sơ học sinh', '/student-profile-change-requests'],
  ['parentFeedback', 'Góp ý phụ huynh', '/parent-feedback'],
];

const formatDate = (value) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const formatDateOnly = (value) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

export default function PrincipalOverview() {
  const [activeTab, setActiveTab] = useState('overview');

  // Dữ liệu điều hành & cảnh báo
  const [alerts, setAlerts] = useState(null);
  const [work, setWork] = useState(null);
  const [decisions, setDecisions] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [alertsError, setAlertsError] = useState('');
  const [decisionsLimit, setDecisionsLimit] = useState(20);

  // Modal chi tiết cảnh báo
  const [activeModal, setActiveModal] = useState(null); // 'teachers' | 'pickups' | 'security' | 'kitchen' | 'overdue'

  // Dữ liệu Giao việc & Theo dõi
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [taskFilterDept, setTaskFilterDept] = useState('');
  const [taskFilterStatus, setTaskFilterStatus] = useState('');
  const [taskFilterOverdue, setTaskFilterOverdue] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const [taskPagination, setTaskPagination] = useState({ totalPages: 1, total: 0 });
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [selectedTaskHistory, setSelectedTaskHistory] = useState(null);
  const [reviewTaskTarget, setReviewTaskTarget] = useState(null);
  const [reviewNote, setReviewNote] = useState('');

  // Form giao việc mới
  const [newTaskForm, setNewTaskForm] = useState({
    title: '',
    department: 'hr',
    assignedTo: '',
    description: '',
    dueDate: '',
    priority: 'normal',
    sourceType: 'general',
    sourceId: null,
    deduplicationKey: ''
  });
  const [departmentStaff, setDepartmentStaff] = useState([]);
  const [loadingDeptStaff, setLoadingDeptStaff] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);

  // Báo cáo chất lượng theo lớp
  const [classQualityData, setClassQualityData] = useState(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');
  const [qualityClassId, setQualityClassId] = useState('');
  const [qualityStartDate, setQualityStartDate] = useState('');
  const [qualityEndDate, setQualityEndDate] = useState('');
  const [classList, setClassList] = useState([]);

  // Giám sát an ninh & an toàn
  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsError, setIncidentsError] = useState('');
  const [incidentFilterStatus, setIncidentFilterStatus] = useState('');
  const [instructionIncident, setInstructionIncident] = useState(null);
  const [instructionText, setInstructionText] = useState('');
  const [savingInstruction, setSavingInstruction] = useState(false);

  // Chỉ đạo nội bộ
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [announcementsError, setAnnouncementsError] = useState('');
  const [receiptModalData, setReceiptModalData] = useState(null);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [showNewDirectiveModal, setShowNewDirectiveModal] = useState(false);
  const [directiveForm, setDirectiveForm] = useState({
    title: '',
    message: '',
    priority: 'normal',
    roles: ['teacher', 'hr', 'accountant', 'chef', 'guard']
  });
  const [sendingDirective, setSendingDirective] = useState(false);

  // 1. Tải dữ liệu Dashboard cảnh báo & Điều hành
  const loadOverview = useCallback(async () => {
    setLoadingAlerts(true);
    setAlertsError('');
    try {
      const [alertsRes, workRes, decisionsRes] = await Promise.all([
        api.get('/reports/principal-alerts'),
        api.get('/reports/principal-work'),
        api.get('/reports/principal-decisions', { params: { limit: decisionsLimit } })
      ]);
      setAlerts(alertsRes.data.data);
      setWork(workRes.data.data);
      setDecisions(decisionsRes.data.data || []);
    } catch (err) {
      setAlertsError(err.response?.data?.message || 'Không thể tải báo cáo điều hành. Vui lòng thử lại.');
    } finally {
      setLoadingAlerts(false);
    }
  }, [decisionsLimit]);

  // 2. Tải danh sách giao việc
  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError('');
    try {
      const params = {
        page: taskPage,
        limit: 10,
        ...(taskFilterDept ? { department: taskFilterDept } : {}),
        ...(taskFilterStatus ? { status: taskFilterStatus } : {}),
        ...(taskFilterOverdue ? { overdue: 'true' } : {})
      };
      const res = await api.get('/reports/principal-tasks', { params });
      setTasks(res.data.data || []);
      setTaskPagination(res.data.pagination || { totalPages: 1, total: 0 });
    } catch (err) {
      setTasksError(err.response?.data?.message || 'Không thể tải danh sách công việc giao.');
    } finally {
      setTasksLoading(false);
    }
  }, [taskPage, taskFilterDept, taskFilterStatus, taskFilterOverdue]);

  // 3. Tải danh sách lớp học
  const loadClassrooms = useCallback(async () => {
    try {
      const res = await api.get('/classrooms');
      setClassList(res.data.data || res.data || []);
    } catch (e) {
      console.error('Lỗi tải danh sách lớp:', e);
    }
  }, []);

  // 4. Tải Báo cáo chất lượng theo lớp
  const loadClassQuality = useCallback(async () => {
    setQualityLoading(true);
    setQualityError('');
    try {
      const params = {
        ...(qualityClassId ? { classroomId: qualityClassId } : {}),
        ...(qualityStartDate ? { startDate: qualityStartDate } : {}),
        ...(qualityEndDate ? { endDate: qualityEndDate } : {})
      };
      const res = await api.get('/reports/class-quality', { params });
      setClassQualityData(res.data.data);
    } catch (err) {
      setQualityError(err.response?.data?.message || 'Không thể tải báo cáo chất lượng lớp học.');
    } finally {
      setQualityLoading(false);
    }
  }, [qualityClassId, qualityStartDate, qualityEndDate]);

  // 5. Tải sự cố an ninh
  const loadIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    setIncidentsError('');
    try {
      const params = incidentFilterStatus ? { status: incidentFilterStatus } : {};
      const res = await api.get('/guard/incidents', { params });
      setIncidents(res.data.data || []);
    } catch (err) {
      setIncidentsError(err.response?.data?.message || 'Không thể tải danh sách sự cố an ninh.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [incidentFilterStatus]);

  // 6. Tải chỉ đạo nội bộ
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true);
    setAnnouncementsError('');
    try {
      const res = await api.get('/hr/internal');
      setAnnouncements(res.data.data?.announcements || []);
    } catch (err) {
      setAnnouncementsError(err.response?.data?.message || 'Không thể tải danh sách thông báo chỉ đạo.');
    } finally {
      setAnnouncementsLoading(false);
    }
  }, []);

  // Init loads
  useEffect(() => {
    loadOverview();
    loadClassrooms();
  }, [loadOverview, loadClassrooms]);

  useEffect(() => {
    if (activeTab === 'tasks') loadTasks();
    else if (activeTab === 'class-quality') loadClassQuality();
    else if (activeTab === 'safety') loadIncidents();
    else if (activeTab === 'directives') loadAnnouncements();
  }, [activeTab, loadTasks, loadClassQuality, loadIncidents, loadAnnouncements]);

  // Tải danh sách nhân sự thuộc bộ phận khi mở form giao việc
  useEffect(() => {
    if (!showNewTaskModal) return;
    let active = true;
    setLoadingDeptStaff(true);
    api.get(`/reports/principal-tasks/staff?department=${newTaskForm.department}`)
      .then((res) => {
        if (active) setDepartmentStaff(res.data.data || []);
      })
      .catch(() => {
        if (active) setDepartmentStaff([]);
      })
      .finally(() => {
        if (active) setLoadingDeptStaff(false);
      });
    return () => { active = false; };
  }, [showNewTaskModal, newTaskForm.department]);

  // Thao tác giao việc từ quyết định đã duyệt
  const handleDelegateFromDecision = (item) => {
    const deptMap = {
      refund: 'accountant',
      expense: 'accountant',
      payroll: 'accountant',
      leave: 'hr',
      recruitment: 'hr',
      profile: 'teacher'
    };
    const dept = deptMap[item.type] || 'hr';
    setNewTaskForm({
      title: `Thực hiện sau phê duyệt: ${item.title} (${item.subject})`,
      department: dept,
      assignedTo: '',
      description: `Hồ sơ đã được Hiệu trưởng phê duyệt ngày ${formatDateOnly(item.at)}. Đề nghị bộ phận ${dept.toUpperCase()} tiếp nhận và thực hiện theo đúng thẩm quyền.`,
      dueDate: '',
      priority: 'normal',
      sourceType: item.type,
      sourceId: String(item.id),
      deduplicationKey: `decision_${item.type}_${item.id}`
    });
    setShowNewTaskModal(true);
  };

  // Thao tác giao việc mới
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTaskForm.title.trim()) return;
    setSubmittingTask(true);
    try {
      const deduplicationKey = newTaskForm.deduplicationKey || `manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await api.post('/reports/principal-tasks', {
        ...newTaskForm,
        assignedTo: newTaskForm.assignedTo || null,
        deduplicationKey
      });
      if (res.data?.alreadyExists) {
        alert(res.data.message || 'Công việc này đã được tạo trước đó.');
      }
      setShowNewTaskModal(false);
      setNewTaskForm({
        title: '',
        department: 'hr',
        assignedTo: '',
        description: '',
        dueDate: '',
        priority: 'normal',
        sourceType: 'general',
        sourceId: null,
        deduplicationKey: ''
      });
      loadTasks();
      if (activeTab !== 'tasks') {
        setActiveTab('tasks');
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể tạo công việc giao việc.');
    } finally {
      setSubmittingTask(false);
    }
  };

  // Thao tác yêu cầu xem lại / chỉ đạo tiến độ
  const handleReviewTask = async () => {
    if (!reviewTaskTarget || !reviewNote.trim()) return;
    try {
      await api.patch(`/reports/principal-tasks/${reviewTaskTarget._id}/status`, {
        status: 'needs_review',
        note: reviewNote.trim()
      });
      setReviewTaskTarget(null);
      setReviewNote('');
      loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể gửi yêu cầu xem lại.');
    }
  };

  // Tiếp nhận cảnh báo an ninh
  const handleAcknowledgeIncident = async (id) => {
    try {
      await api.patch(`/guard/incidents/${id}/acknowledge`);
      loadIncidents();
      loadOverview();
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể tiếp nhận cảnh báo.');
    }
  };

  // Thêm chỉ đạo an ninh
  const handleSaveInstruction = async () => {
    if (!instructionIncident || !instructionText.trim()) return;
    setSavingInstruction(true);
    try {
      await api.patch(`/guard/incidents/${instructionIncident._id}/management-instruction`, {
        note: instructionText.trim()
      });
      setInstructionIncident(null);
      setInstructionText('');
      loadIncidents();
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể ghi chỉ đạo.');
    } finally {
      setSavingInstruction(false);
    }
  };

  // Xem biên nhận đọc
  const handleViewReceipts = async (announcementId) => {
    setLoadingReceipts(true);
    try {
      const res = await api.get(`/hr/internal/announcements/${announcementId}/receipts`);
      setReceiptModalData(res.data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể tải biên nhận đã đọc.');
    } finally {
      setLoadingReceipts(false);
    }
  };

  // Gửi chỉ đạo nội bộ
  const handleSendDirective = async (e) => {
    e.preventDefault();
    if (!directiveForm.title.trim() || !directiveForm.message.trim() || !directiveForm.roles.length) {
      alert('Vui lòng điền đầy đủ tiêu đề, nội dung và chọn ít nhất một bộ phận nhận.');
      return;
    }
    setSendingDirective(true);
    try {
      const requestId = `dir_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await api.post('/hr/internal/announcements', {
        category: 'directive',
        title: directiveForm.title.trim(),
        message: directiveForm.message.trim(),
        priority: directiveForm.priority,
        roles: directiveForm.roles,
        requestId
      });
      setShowNewDirectiveModal(false);
      setDirectiveForm({
        title: '',
        message: '',
        priority: 'normal',
        roles: ['teacher', 'hr', 'accountant', 'chef', 'guard']
      });
      loadAnnouncements();
    } catch (err) {
      alert(err.response?.data?.message || 'Không thể gửi chỉ đạo.');
    } finally {
      setSendingDirective(false);
    }
  };

  // Tính tổng số lượng cảnh báo hôm nay
  const totalAlertItems = alerts ? (
    (alerts.teacherAlerts?.shortageCount || 0) +
    (alerts.securityAlerts?.emergencyCount || 0) +
    (alerts.kitchenAlerts?.nearExpiryCount || 0) +
    (alerts.kitchenAlerts?.mealDiscrepanciesCount || 0) +
    (alerts.overdueAlerts?.totalOverdue || 0)
  ) : 0;

  return (
    <AppShell
      title="Sổ điều hành"
      subtitle="Hệ thống giám sát, cảnh báo điều hành, phê duyệt và giao việc của Hiệu trưởng."
      actions={
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            if (activeTab === 'overview') loadOverview();
            else if (activeTab === 'tasks') loadTasks();
            else if (activeTab === 'class-quality') loadClassQuality();
            else if (activeTab === 'safety') loadIncidents();
            else if (activeTab === 'directives') loadAnnouncements();
          }}
          disabled={loadingAlerts || tasksLoading || qualityLoading || incidentsLoading || announcementsLoading}
        >
          <Icon name="refresh" size={17} /> Làm mới
        </button>
      }
    >
      <div className="principal-container">
        {/* Navigation Tabs */}
        <nav className="principal-tabs" aria-label="Các phân hệ điều hành của hiệu trưởng">
          <button
            type="button"
            className={`principal-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Icon name="chart" size={16} />
            Tổng quan & Cảnh báo
            {totalAlertItems > 0 && <span className="principal-tab-badge">{totalAlertItems}</span>}
          </button>
          <button
            type="button"
            className={`principal-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            <Icon name="calendar" size={16} />
            Giao việc & Tiến độ
            {taskPagination.total > 0 && <span className="principal-tab-badge badge-neutral">{taskPagination.total}</span>}
          </button>
          <button
            type="button"
            className={`principal-tab-btn ${activeTab === 'class-quality' ? 'active' : ''}`}
            onClick={() => setActiveTab('class-quality')}
          >
            <Icon name="students" size={16} />
            Chất lượng theo lớp
          </button>
          <button
            type="button"
            className={`principal-tab-btn ${activeTab === 'safety' ? 'active' : ''}`}
            onClick={() => setActiveTab('safety')}
          >
            <Icon name="shield" size={16} />
            Giám sát an ninh
            {(alerts?.securityAlerts?.openCount || 0) > 0 && (
              <span className="principal-tab-badge">{alerts.securityAlerts.openCount}</span>
            )}
          </button>
          <button
            type="button"
            className={`principal-tab-btn ${activeTab === 'directives' ? 'active' : ''}`}
            onClick={() => setActiveTab('directives')}
          >
            <Icon name="chat" size={16} />
            Chỉ đạo nội bộ
          </button>
        </nav>

        {/* TAB 1: OVERVIEW & ALERTS */}
        {activeTab === 'overview' && (
          <>
            {alertsError && (
              <div className="principal-error-banner" role="alert">
                <span>{alertsError}</span>
                <button type="button" onClick={loadOverview}>Thử lại</button>
              </div>
            )}

            {/* BƯỚC 2: CẦN HIỆU TRƯỞNG CHÚ Ý HÔM NAY */}
            <section className="content-card principal-overview-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">CẢNH BÁO ĐIỀU HÀNH THỜI GIAN THỰC</p>
                  <h2>Cần hiệu trưởng chú ý hôm nay</h2>
                  <p>Dữ liệu tổng hợp từ các hoạt động thực tế trong ngày; bấm từng thẻ để xem chi tiết.</p>
                </div>
              </div>

              {loadingAlerts ? (
                <div className="inline-loader" style={{ padding: '30px' }}>
                  <span className="loading-orb" /> Đang cập nhật cảnh báo toàn trường...
                </div>
              ) : alerts ? (
                <div className="principal-alerts-grid">
                  {/* Cảnh báo 1: Thiếu giáo viên */}
                  <div
                    className={`alert-card ${alerts.teacherAlerts?.shortageCount > 0 ? 'alert-danger' : 'alert-success'}`}
                    onClick={() => setActiveModal('teachers')}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="alert-card-header">
                        <span className="alert-card-title">Lớp thiếu giáo viên</span>
                        <Icon name="users" size={20} />
                      </div>
                      <div className="alert-card-count">
                        {alerts.teacherAlerts?.shortageCount || 0}
                        <small style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px' }}>lớp</small>
                      </div>
                      <div className="alert-card-body">
                        {alerts.teacherAlerts?.shortageCount > 0
                          ? `Thiếu tổng cộng ${alerts.teacherAlerts.missingTeacherTotal} giáo viên đứng lớp hôm nay.`
                          : 'Đủ giáo viên phân công cho tất cả các lớp học.'}
                      </div>
                    </div>
                    <div className="alert-card-footer">
                      <span>Xem danh sách lớp thiếu</span>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  </div>

                  {/* Cảnh báo 2: Trẻ chưa đón */}
                  <div
                    className="alert-card alert-info"
                    onClick={() => setActiveModal('pickups')}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="alert-card-header">
                        <span className="alert-card-title">Trẻ đang ở trường / chờ đón</span>
                        <Icon name="students" size={20} />
                      </div>
                      <div className="alert-card-count">
                        {alerts.pickupAlerts?.totalAtSchool ?? '—'}
                        <small style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px' }}>trẻ</small>
                      </div>
                      <div className="alert-card-body">
                        Đã bàn giao: <strong>{alerts.pickupAlerts?.totalPickedUp || 0}</strong> · Nghỉ học: <strong>{alerts.pickupAlerts?.totalAbsent || 0}</strong> · Chưa đến: <strong>{alerts.pickupAlerts?.totalNotArrived || 0}</strong>
                      </div>
                    </div>
                    <div className="alert-card-footer">
                      <span>Xem chi tiết theo lớp</span>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  </div>

                  {/* Cảnh báo 3: Sự cố an ninh */}
                  <div
                    className={`alert-card ${alerts.securityAlerts?.emergencyCount > 0 ? 'alert-danger' : alerts.securityAlerts?.openCount > 0 ? 'alert-warning' : 'alert-success'}`}
                    onClick={() => setActiveModal('security')}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="alert-card-header">
                        <span className="alert-card-title">Sự cố an ninh & an toàn</span>
                        <Icon name="shield" size={20} />
                      </div>
                      <div className="alert-card-count">
                        {alerts.securityAlerts?.openCount || 0}
                        <small style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px' }}>vụ việc</small>
                      </div>
                      <div className="alert-card-body">
                        {alerts.securityAlerts?.emergencyCount > 0
                          ? `Có ${alerts.securityAlerts.emergencyCount} sự cố khẩn cấp/nghiêm trọng cần xử lý ngay!`
                          : alerts.securityAlerts?.openCount > 0
                          ? `Có ${alerts.securityAlerts.openCount} sự cố đang mở hoặc xử lý.`
                          : 'Cổng trường và an ninh đang trong trạng thái bình thường.'}
                      </div>
                    </div>
                    <div className="alert-card-footer">
                      <span>Xem diễn biến sự cố</span>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  </div>

                  {/* Cảnh báo 4: Bếp ăn & an toàn thực phẩm */}
                  <div
                    className={`alert-card ${(alerts.kitchenAlerts?.nearExpiryCount > 0 || alerts.kitchenAlerts?.mealDiscrepanciesCount > 0) ? 'alert-warning' : 'alert-info'}`}
                    onClick={() => setActiveModal('kitchen')}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="alert-card-header">
                        <span className="alert-card-title">Cảnh báo bếp ăn & dinh dưỡng</span>
                        <Icon name="utensils" size={20} />
                      </div>
                      <div className="alert-card-count">
                        {(alerts.kitchenAlerts?.nearExpiryCount || 0) + (alerts.kitchenAlerts?.mealDiscrepanciesCount || 0)}
                        <small style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px' }}>lưu ý</small>
                      </div>
                      <div className="alert-card-body">
                        Kho cận/quá hạn: <strong>{alerts.kitchenAlerts?.nearExpiryCount || 0}</strong> · Lệch suất: <strong>{alerts.kitchenAlerts?.mealDiscrepanciesCount || 0}</strong> · Dị ứng: <strong>{alerts.kitchenAlerts?.allergyCount || 0}</strong> trẻ.
                      </div>
                    </div>
                    <div className="alert-card-footer">
                      <span>Xem kiểm soát bếp ăn</span>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  </div>

                  {/* Cảnh báo 5: Quá hạn */}
                  <div
                    className={`alert-card ${alerts.overdueAlerts?.totalOverdue > 0 ? 'alert-purple' : 'alert-success'}`}
                    onClick={() => setActiveModal('overdue')}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="alert-card-header">
                        <span className="alert-card-title">Công việc & Phê duyệt quá hạn</span>
                        <Icon name="clock" size={20} />
                      </div>
                      <div className="alert-card-count">
                        {alerts.overdueAlerts?.totalOverdue || 0}
                        <small style={{ fontSize: '14px', fontWeight: 500, marginLeft: '6px' }}>hồ sơ</small>
                      </div>
                      <div className="alert-card-body">
                        {alerts.overdueAlerts?.totalOverdue > 0
                          ? `Có ${alerts.overdueAlerts.totalOverdue} yêu cầu hoặc nhiệm vụ đã vượt quá hạn SLA.`
                          : 'Tất cả các hồ sơ và nhiệm vụ đều đang đúng tiến độ.'}
                      </div>
                    </div>
                    <div className="alert-card-footer">
                      <span>Xem danh sách quá hạn</span>
                      <Icon name="chevronRight" size={15} />
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            {/* HÀNG ĐỢI ĐIỀU HÀNH */}
            <section className="content-card principal-overview-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">CÔNG VIỆC CẦN XỬ LÝ</p>
                  <h2>Hàng đợi điều hành & Phê duyệt</h2>
                  <p>Số lượng hồ sơ đang chờ Hiệu trưởng xem xét và quyết định.</p>
                </div>
              </div>
              <div className="principal-overview-work">
                {workTypes.map(([key, label, path]) => (
                  <Link key={key} to={path} className="principal-overview-work-item">
                    <span>{label}</span>
                    <strong>{work && !alertsError ? (work[key] ?? 0) : '—'}</strong>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                ))}
              </div>
            </section>

            {/* LỊCH SỬ QUYẾT ĐỊNH */}
            <section className="content-card principal-overview-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">LỊCH SỬ GẦN ĐÂY</p>
                  <h2>Quyết định đã ghi nhận</h2>
                  <p>Nhật ký quyết định điều hành của nhà trường. Bấm để xem hồ sơ gốc.</p>
                </div>
              </div>
              {loadingAlerts && (
                <div className="inline-loader" style={{ padding: '20px' }}>
                  <span className="loading-orb" /> Đang tải lịch sử...
                </div>
              )}
              {!loadingAlerts && !alertsError && (
                decisions.length ? (
                  <div className="principal-decision-list">
                    {decisions.map((item) => (
                      <div key={`${item.type}-${item.id}`} className="principal-decision-row">
                        <span className="principal-decision-dot" />
                        <Link to={item.path} style={{ display: 'grid', gap: '4px', flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
                          <strong>{item.title}</strong>
                          <small>{item.subject} · {item.actor || 'Chưa rõ người xử lý'}</small>
                        </Link>
                        <time dateTime={item.at}>{formatDate(item.at)}</time>
                        {['approved', 'confirmed'].includes(item.status) && (
                          <button
                            type="button"
                            className="button button-secondary"
                            style={{ padding: '3px 8px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
                            onClick={() => handleDelegateFromDecision(item)}
                            title="Giao việc thực hiện sau khi phê duyệt"
                          >
                            Giao việc bộ phận
                          </button>
                        )}
                        <Link to={item.path} title="Xem hồ sơ gốc" style={{ color: '#64748b' }}>
                          <Icon name="chevronRight" size={16} />
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="principal-empty">Chưa có quyết định nào trong các quy trình đang theo dõi.</p>
                )
              )}
              {!loadingAlerts && !alertsError && decisions.length >= decisionsLimit && decisionsLimit < 50 && (
                <div className="principal-more">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setDecisionsLimit((prev) => Math.min(50, prev + 20))}
                  >
                    Xem thêm quyết định
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {/* TAB 2: TASKS & DELEGATION (BƯỚC 3) */}
        {activeTab === 'tasks' && (
          <section className="content-card principal-overview-card">
            <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="card-kicker">QUY TRÌNH HẬU PHÊ DUYỆT</p>
                <h2>Giao việc & Theo dõi tiến độ</h2>
                <p>Hiệu trưởng giao việc cho các bộ phận chuyên trách (HR, Kế toán, Bếp, Bảo vệ, Giáo viên) và giám sát kết quả thực hiện.</p>
              </div>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowNewTaskModal(true)}
              >
                <Icon name="plus" size={16} /> Giao việc mới
              </button>
            </div>

            {/* Bộ lọc công việc */}
            <div className="principal-filter-bar">
              <div className="principal-filter-item">
                <span>Bộ phận:</span>
                <select
                  value={taskFilterDept}
                  onChange={(e) => { setTaskFilterDept(e.target.value); setTaskPage(1); }}
                >
                  <option value="">Tất cả bộ phận</option>
                  <option value="hr">Nhân sự (HR)</option>
                  <option value="accountant">Kế toán</option>
                  <option value="chef">Bếp ăn</option>
                  <option value="guard">Bảo vệ</option>
                  <option value="teacher">Giáo viên</option>
                </select>
              </div>

              <div className="principal-filter-item">
                <span>Trạng thái:</span>
                <select
                  value={taskFilterStatus}
                  onChange={(e) => { setTaskFilterStatus(e.target.value); setTaskPage(1); }}
                >
                  <option value="">Tất cả trạng thái</option>
                  <option value="pending_acceptance">Chờ tiếp nhận</option>
                  <option value="in_progress">Đang thực hiện</option>
                  <option value="needs_review">Cần xem lại</option>
                  <option value="completed">Đã hoàn tất</option>
                </select>
              </div>

              <div className="principal-filter-item">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={taskFilterOverdue}
                    onChange={(e) => { setTaskFilterOverdue(e.target.checked); setTaskPage(1); }}
                  />
                  <span>Chỉ việc quá hạn</span>
                </label>
              </div>
            </div>

            {tasksError && (
              <div className="principal-error-banner">
                <span>{tasksError}</span>
                <button type="button" onClick={loadTasks}>Thử lại</button>
              </div>
            )}

            {tasksLoading ? (
              <div className="inline-loader" style={{ padding: '30px' }}>
                <span className="loading-orb" /> Đang tải danh sách nhiệm vụ...
              </div>
            ) : tasks.length === 0 ? (
              <div className="principal-empty-state">
                <p>Không có công việc nào phù hợp với bộ lọc hiện tại.</p>
              </div>
            ) : (
              <>
                <div className="principal-table-wrapper">
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Tiêu đề nhiệm vụ</th>
                        <th>Bộ phận</th>
                        <th>Người phụ trách</th>
                        <th>Hạn xử lý</th>
                        <th>Trạng thái</th>
                        <th>Kết quả / Báo cáo</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr key={task._id}>
                          <td>
                            <strong>{task.title}</strong>
                            {task.description && (
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                {task.description.slice(0, 80)}{task.description.length > 80 ? '...' : ''}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="status-pill status-normal">
                              {task.department === 'hr' ? 'Nhân sự' : task.department === 'accountant' ? 'Kế toán' : task.department === 'chef' ? 'Bếp ăn' : task.department === 'guard' ? 'Bảo vệ' : 'Giáo viên'}
                            </span>
                          </td>
                          <td>{task.assignedToName || 'Chờ phân công'}</td>
                          <td>
                            {task.dueDate ? (
                              <span style={{ color: task.isOverdue ? '#dc2626' : 'inherit', fontWeight: task.isOverdue ? 700 : 400 }}>
                                {formatDateOnly(task.dueDate)}
                                {task.isOverdue && ' (Quá hạn)'}
                              </span>
                            ) : 'Không có'}
                          </td>
                          <td>
                            {task.isOverdue ? (
                              <span className="status-pill status-overdue">Quá hạn</span>
                            ) : task.status === 'completed' ? (
                              <span className="status-pill status-completed">Hoàn tất</span>
                            ) : task.status === 'in_progress' ? (
                              <span className="status-pill status-progress">Đang thực hiện</span>
                            ) : task.status === 'needs_review' ? (
                              <span className="status-pill status-review">Cần xem lại</span>
                            ) : (
                              <span className="status-pill status-pending">Chờ tiếp nhận</span>
                            )}
                          </td>
                          <td>
                            {task.resultNote ? (
                              <span style={{ fontSize: '12.5px', color: '#047857' }}>{task.resultNote}</span>
                            ) : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                className="button button-secondary"
                                style={{ padding: '4px 8px', fontSize: '12px' }}
                                onClick={() => setSelectedTaskHistory(task)}
                                title="Xem nhật ký xử lý"
                              >
                                Lịch sử
                              </button>
                              {task.status !== 'completed' && (
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  style={{ padding: '4px 8px', fontSize: '12px' }}
                                  onClick={() => setReviewTaskTarget(task)}
                                  title="Chỉ đạo thêm hoặc yêu cầu làm lại"
                                >
                                  Chỉ đạo
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phân trang */}
                <div className="principal-pagination">
                  <span>Tổng số: <strong>{taskPagination.total}</strong> công việc</span>
                  <div className="principal-pagination-controls">
                    <button
                      type="button"
                      className="principal-page-btn"
                      disabled={taskPage <= 1}
                      onClick={() => setTaskPage((p) => Math.max(1, p - 1))}
                    >
                      Trước
                    </button>
                    <span style={{ padding: '5px 8px' }}>Trang {taskPage} / {taskPagination.totalPages || 1}</span>
                    <button
                      type="button"
                      className="principal-page-btn"
                      disabled={taskPage >= taskPagination.totalPages}
                      onClick={() => setTaskPage((p) => p + 1)}
                    >
                      Sau
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* TAB 3: BÁO CÁO CHẤT LƯỢNG THEO LỚP (BƯỚC 4) */}
        {activeTab === 'class-quality' && (
          <section className="content-card principal-overview-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">CHỈ SỐ VẬN HÀNH & CHUYÊN CẦN</p>
                <h2>Báo cáo chất lượng theo lớp</h2>
                <p>Góc nhìn quản lý của Hiệu trưởng: tỷ lệ chuyên cần (mẫu số rõ ràng), nhận xét chăm sóc, phản hồi phụ huynh và đánh giá chuyên môn giáo viên.</p>
              </div>
            </div>

            {/* Bộ lọc báo cáo */}
            <div className="principal-filter-bar">
              <div className="principal-filter-item">
                <span>Chọn lớp:</span>
                <select
                  value={qualityClassId}
                  onChange={(e) => setQualityClassId(e.target.value)}
                >
                  <option value="">Tất cả các lớp</option>
                  {classList.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="principal-filter-item">
                <span>Từ ngày:</span>
                <input
                  type="date"
                  value={qualityStartDate}
                  onChange={(e) => setQualityStartDate(e.target.value)}
                />
              </div>

              <div className="principal-filter-item">
                <span>Đến ngày:</span>
                <input
                  type="date"
                  value={qualityEndDate}
                  onChange={(e) => setQualityEndDate(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="button button-primary"
                onClick={loadClassQuality}
                disabled={qualityLoading}
              >
                Tra cứu
              </button>
            </div>

            {qualityError && (
              <div className="principal-error-banner">
                <span>{qualityError}</span>
                <button type="button" onClick={loadClassQuality}>Thử lại</button>
              </div>
            )}

            {qualityLoading ? (
              <div className="inline-loader" style={{ padding: '30px' }}>
                <span className="loading-orb" /> Đang tổng hợp số liệu chất lượng...
              </div>
            ) : !classQualityData || !classQualityData.classes?.length ? (
              <div className="principal-empty-state">
                <p>Không có dữ liệu lớp học trong khoảng thời gian đã chọn.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {classQualityData.classes.map((cls) => (
                  <div key={cls.classroomId} style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '18px', background: '#fafbfc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ margin: 0, fontSize: '17px', color: '#1e3a8a' }}>{cls.className} · Niên khóa: {cls.schoolYear}</h3>
                      <span className="status-pill status-progress" style={{ fontSize: '13px' }}>
                        Sĩ số: <strong>{cls.totalEnrolled}</strong> trẻ
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                      {/* Thẻ Chuyên cần */}
                      <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Tỷ lệ chuyên cần</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb', margin: '4px 0' }}>
                          {cls.attendance.attendanceRate}
                        </div>
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          Hiện diện: <strong>{cls.attendance.presentCount}</strong> · Muộn: <strong>{cls.attendance.lateCount}</strong> · Vắng: <strong>{cls.attendance.totalAbsent}</strong>
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
                          {cls.attendance.formulaNote}
                        </div>
                      </div>

                      {/* Thẻ Chăm sóc */}
                      <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Nhận xét chăm sóc</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669', margin: '4px 0' }}>
                          {cls.careSummary.totalCareReports}
                          <small style={{ fontSize: '13px', fontWeight: 500, marginLeft: '4px' }}>phiếu</small>
                        </div>
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          Sức khỏe cần lưu ý: <strong>{cls.careSummary.totalHealthNoted}</strong> · Ăn uống: <strong>{cls.careSummary.totalMealsNoted}</strong>
                        </div>
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
                          {cls.careSummary.flaggedNotesCount} ghi chú riêng về từng trẻ
                        </div>
                      </div>

                      {/* Thẻ Phụ huynh */}
                      <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Ý kiến phụ huynh</div>
                        <div style={{ fontSize: '24px', fontWeight: 800, color: '#d97706', margin: '4px 0' }}>
                          {cls.parentFeedback.total}
                          <small style={{ fontSize: '13px', fontWeight: 500, marginLeft: '4px' }}>phản hồi</small>
                        </div>
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          Chờ xử lý: <strong style={{ color: '#dc2626' }}>{cls.parentFeedback.pending}</strong> · Đã xử lý: <strong>{cls.parentFeedback.resolved}</strong>
                        </div>
                      </div>

                      {/* Thẻ Đánh giá giáo viên */}
                      <div style={{ background: '#fff', padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Đánh giá giáo viên</div>
                        <div style={{ marginTop: '6px', fontSize: '12.5px', color: '#334155' }}>
                          {cls.teacherEvaluations.map((te, idx) => (
                            <div key={idx} style={{ marginBottom: '6px', borderBottom: idx < cls.teacherEvaluations.length - 1 ? '1px dashed #e2e8f0' : 'none', paddingBottom: '4px' }}>
                              {te.evaluationStatus === 'chưa đủ dữ liệu' ? (
                                <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Chưa có đánh giá chuyên môn kỳ này</span>
                              ) : (
                                <div>
                                  <strong>{te.employeeName}</strong> ({te.role}): <span className="status-pill status-progress" style={{ padding: '1px 6px', fontSize: '11px' }}>{te.rating}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Danh sách ghi chú đáng chú ý về học sinh */}
                    {cls.careSummary.flaggedNotes?.length > 0 && (
                      <div style={{ background: '#fff', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                        <strong style={{ color: '#334155' }}>Trường hợp cần lưu ý gần đây:</strong>
                        <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                          {cls.careSummary.flaggedNotes.map((fn, idx) => (
                            <li key={idx} style={{ marginBottom: '4px', color: '#475569' }}>
                              <span style={{ fontWeight: 600, color: '#1e293b' }}>{fn.studentName}</span> ({fn.dateKey}): {fn.note} <span style={{ color: '#94a3b8' }}>({fn.recordedBy})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 4: GIÁM SÁT AN NINH (BƯỚC 5) */}
        {activeTab === 'safety' && (
          <section className="content-card principal-overview-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">AN TOÀN & AN NINH TRƯỜNG HỌC</p>
                <h2>Giám sát sự cố an ninh toàn trường</h2>
                <p>Hiệu trưởng theo dõi diễn biến sự cố do bảo vệ và nhân sự ghi nhận. Có thể tiếp nhận cảnh báo hoặc ghi chỉ đạo điều hành.</p>
              </div>
            </div>

            {/* Bộ lọc trạng thái sự cố */}
            <div className="principal-filter-bar">
              <div className="principal-filter-item">
                <span>Trạng thái:</span>
                <select
                  value={incidentFilterStatus}
                  onChange={(e) => setIncidentFilterStatus(e.target.value)}
                >
                  <option value="">Tất cả sự cố</option>
                  <option value="open">Mới (Chưa đóng)</option>
                  <option value="in_progress">Đang xử lý</option>
                  <option value="handed_over">Đã bàn giao</option>
                  <option value="closed">Đã giải quyết & đóng</option>
                </select>
              </div>
            </div>

            {incidentsError && (
              <div className="principal-error-banner">
                <span>{incidentsError}</span>
                <button type="button" onClick={loadIncidents}>Thử lại</button>
              </div>
            )}

            {incidentsLoading ? (
              <div className="inline-loader" style={{ padding: '30px' }}>
                <span className="loading-orb" /> Đang tải dữ liệu sự cố...
              </div>
            ) : incidents.length === 0 ? (
              <div className="principal-empty-state">
                <p>Không có sự cố nào trong danh sách đang theo dõi.</p>
              </div>
            ) : (
              <div className="principal-table-wrapper">
                <table className="principal-data-table">
                  <thead>
                    <tr>
                      <th>Thời gian / Ngày</th>
                      <th>Mức độ</th>
                      <th>Vị trí</th>
                      <th>Nội dung sự cố</th>
                      <th>Người báo / Tiếp nhận</th>
                      <th>Trạng thái</th>
                      <th>Chỉ đạo của Hiệu trưởng</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((inc) => (
                      <tr key={inc._id}>
                        <td>
                          <strong>{inc.incidentDate}</strong>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{formatDate(inc.createdAt)}</div>
                        </td>
                        <td>
                          {inc.severity === 'emergency' ? (
                            <span className="status-pill status-emergency">Khẩn cấp</span>
                          ) : inc.severity === 'serious' ? (
                            <span className="status-pill status-serious">Nghiêm trọng</span>
                          ) : (
                            <span className="status-pill status-normal">Bình thường</span>
                          )}
                        </td>
                        <td><strong>{inc.location}</strong></td>
                        <td style={{ maxWidth: '240px' }}>
                          <div>{inc.description}</div>
                          {inc.actionTaken && (
                            <div style={{ fontSize: '12px', color: '#047857', marginTop: '3px' }}>
                              Đã xử lý tại chỗ: {inc.actionTaken}
                            </div>
                          )}
                        </td>
                        <td>
                          <div>Báo bởi: <strong>{inc.reportedByName}</strong></div>
                          {inc.acknowledgedByName && (
                            <div style={{ fontSize: '11px', color: '#2563eb' }}>
                              Tiếp nhận: {inc.acknowledgedByName} ({formatDate(inc.acknowledgedAt)})
                            </div>
                          )}
                        </td>
                        <td>
                          {inc.status === 'closed' ? (
                            <span className="status-pill status-completed">Đã đóng</span>
                          ) : inc.status === 'in_progress' ? (
                            <span className="status-pill status-progress">Đang xử lý</span>
                          ) : inc.status === 'handed_over' ? (
                            <span className="status-pill status-review">Đã bàn giao</span>
                          ) : (
                            <span className="status-pill status-pending">Mới mở</span>
                          )}
                        </td>
                        <td style={{ maxWidth: '200px' }}>
                          {inc.managementNotes && inc.managementNotes.length > 0 ? (
                            <div style={{ fontSize: '12px' }}>
                              {inc.managementNotes.map((mn, idx) => (
                                <div key={idx} style={{ marginBottom: '4px', background: '#eff6ff', padding: '4px 6px', borderRadius: '4px' }}>
                                  <strong>{mn.authorName}:</strong> {mn.note}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '12px' }}>Chưa có chỉ đạo</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {['serious', 'emergency'].includes(inc.severity) && !inc.acknowledgedAt && (
                              <button
                                type="button"
                                className="button button-primary"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                                onClick={() => handleAcknowledgeIncident(inc._id)}
                              >
                                Xác nhận tiếp nhận
                              </button>
                            )}
                            <button
                              type="button"
                              className="button button-secondary"
                              style={{ padding: '3px 8px', fontSize: '11px' }}
                              onClick={() => {
                                setInstructionIncident(inc);
                                setInstructionText('');
                              }}
                            >
                              Ghi chỉ đạo
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* TAB 5: CHỈ ĐẠO NỘI BỘ (BƯỚC 6) */}
        {activeTab === 'directives' && (
          <section className="content-card principal-overview-card">
            <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p className="card-kicker">CHỈ ĐẠO CẤP TRƯỜNG</p>
                <h2>Thông báo & Chỉ đạo điều hành</h2>
                <p>Hiệu trưởng gửi thông báo chỉ đạo đến đúng nhóm đối tượng (Toàn trường, Giáo viên, HR, Kế toán, Bếp, Bảo vệ) và theo dõi biên nhận đã đọc.</p>
              </div>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setShowNewDirectiveModal(true)}
              >
                <Icon name="plus" size={16} /> Soạn chỉ đạo mới
              </button>
            </div>

            {announcementsError && (
              <div className="principal-error-banner">
                <span>{announcementsError}</span>
                <button type="button" onClick={loadAnnouncements}>Thử lại</button>
              </div>
            )}

            {announcementsLoading ? (
              <div className="inline-loader" style={{ padding: '30px' }}>
                <span className="loading-orb" /> Đang tải danh sách chỉ đạo...
              </div>
            ) : announcements.length === 0 ? (
              <div className="principal-empty-state">
                <p>Chưa có thông báo chỉ đạo nào được ghi nhận.</p>
              </div>
            ) : (
              <div className="principal-table-wrapper">
                <table className="principal-data-table">
                  <thead>
                    <tr>
                      <th>Ngày gửi</th>
                      <th>Tiêu đề chỉ đạo</th>
                      <th>Mức độ</th>
                      <th>Đối tượng nhận</th>
                      <th>Số người nhận</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map((item) => (
                      <tr key={item._id}>
                        <td>{formatDate(item.createdAt)}</td>
                        <td>
                          <strong>{item.title}</strong>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                            {item.message?.slice(0, 90)}{item.message?.length > 90 ? '...' : ''}
                          </div>
                        </td>
                        <td>
                          {item.priority === 'urgent' ? (
                            <span className="status-pill status-emergency">Khẩn cấp</span>
                          ) : item.priority === 'high' ? (
                            <span className="status-pill status-serious">Quan trọng</span>
                          ) : (
                            <span className="status-pill status-normal">Bình thường</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: '12.5px' }}>
                            {item.targetRoles?.length
                              ? item.targetRoles.map((r) => ({
                                teacher: 'Giáo viên',
                                hr: 'Nhân sự',
                                accountant: 'Kế toán',
                                chef: 'Bếp ăn',
                                guard: 'Bảo vệ'
                              }[r] || r)).join(', ')
                              : 'Toàn bộ nhân viên'}
                          </span>
                        </td>
                        <td>
                          <strong>{item.recipientIds?.length || 0}</strong> nhân sự
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button button-secondary"
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() => handleViewReceipts(item._id)}
                            disabled={loadingReceipts}
                          >
                            Xem biên nhận đọc
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {/* MODAL 1: CHI TIẾT THIẾU GIÁO VIÊN */}
      {activeModal === 'teachers' && alerts && (
        <div className="principal-modal-overlay" onClick={() => setActiveModal(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Chi tiết thiếu giáo viên hôm nay ({alerts.date})</h3>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              {alerts.teacherAlerts?.shortages?.length > 0 ? (
                <div className="principal-table-wrapper">
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Tên lớp</th>
                        <th>Cần</th>
                        <th>Đã phân công</th>
                        <th>Thiếu</th>
                        <th>Giáo viên hiện diện / Vắng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.teacherAlerts.shortages.map((c) => (
                        <tr key={c.classroomId}>
                          <td><strong>{c.className}</strong> ({c.schoolYear})</td>
                          <td>{c.requiredTeachers}</td>
                          <td>{c.presentTeachers}</td>
                          <td><strong style={{ color: '#dc2626' }}>{c.missingTeachers}</strong></td>
                          <td>
                            <div style={{ fontSize: '12px' }}>
                              {(c.assigned || []).map((a, idx) => (
                                <span key={idx} style={{ color: a.absent ? '#dc2626' : '#047857', marginRight: '8px' }}>
                                  {a.name} {a.absent ? '(Vắng)' : '(Có mặt)'}
                                </span>
                              ))}
                              {(c.replacements || []).map((r, idx) => (
                                <span key={idx} style={{ color: '#2563eb', marginRight: '8px' }}>
                                  {r.name} (Tăng cường)
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Không có lớp nào thiếu giáo viên hôm nay.</p>
              )}

              {alerts.teacherAlerts?.uncoveredDuties?.length > 0 && (
                <div style={{ marginTop: '18px' }}>
                  <h4 style={{ color: '#dc2626', margin: '0 0 8px' }}>Ca trực chưa có người thay thế ({alerts.teacherAlerts.uncoveredDuties.length} ca)</h4>
                  <div className="principal-table-wrapper">
                    <table className="principal-data-table">
                      <thead>
                        <tr>
                          <th>Loại ca trực</th>
                          <th>Nhân sự vắng</th>
                          <th>Khung giờ ca</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alerts.teacherAlerts.uncoveredDuties.map((d) => (
                          <tr key={d.shiftId}>
                            <td><strong>{d.shiftType}</strong></td>
                            <td><span style={{ color: '#dc2626', fontWeight: 600 }}>{d.employeeName} (Vắng không người thay)</span></td>
                            <td>{d.time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CHI TIẾT TRẺ CHƯA ĐÓN */}
      {activeModal === 'pickups' && alerts && (
        <div className="principal-modal-overlay" onClick={() => setActiveModal(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Chi tiết học sinh hiện diện & đón trẻ hôm nay ({alerts.date})</h3>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              <p style={{ margin: 0, fontSize: '13.5px', color: '#475569' }}>
                Phân biệt rõ: Trẻ chưa đến trường (chưa check-in), Trẻ nghỉ học (có/không phép), Trẻ đã bàn giao cho phụ huynh, và Trẻ đang ở trường chờ đón.
              </p>
              <div className="principal-table-wrapper">
                <table className="principal-data-table">
                  <thead>
                    <tr>
                      <th>Lớp</th>
                      <th>Sĩ số</th>
                      <th>Đang ở trường (Chưa đón)</th>
                      <th>Đã bàn giao</th>
                      <th>Nghỉ học</th>
                      <th>Chưa đến</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(alerts.pickupAlerts?.classes || []).map((cls) => (
                      <tr key={cls.classroomId}>
                        <td><strong>{cls.className}</strong></td>
                        <td>{cls.totalEnrolled}</td>
                        <td>
                          <strong style={{ color: cls.atSchool > 0 ? '#2563eb' : '#64748b' }}>
                            {cls.atSchool}
                          </strong>
                        </td>
                        <td>{cls.pickedUp}</td>
                        <td>{cls.absent}</td>
                        <td>{cls.notArrived}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {alerts.pickupAlerts?.classes?.some((c) => c.waitingStudents?.length > 0) && (
                <div style={{ marginTop: '18px' }}>
                  <h4 style={{ margin: '0 0 8px', color: '#1e3a8a' }}>
                    Danh sách trẻ đang ở trường chờ đón ({alerts.pickupAlerts.totalAtSchool} trẻ)
                  </h4>
                  <div className="principal-table-wrapper" style={{ maxHeight: '220px' }}>
                    <table className="principal-data-table">
                      <thead>
                        <tr>
                          <th>Học sinh</th>
                          <th>Lớp</th>
                          <th>Thời điểm check-in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alerts.pickupAlerts.classes.flatMap((cls) =>
                          (cls.waitingStudents || []).map((st) => ({ ...st, className: cls.className }))
                        ).map((st, idx) => (
                          <tr key={idx}>
                            <td><strong>{st.studentName}</strong></td>
                            <td>{st.className}</td>
                            <td>{st.checkInTime ? formatDate(st.checkInTime) : 'Đã điểm danh'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: SỰ CỐ AN NINH CHƯA ĐÓNG */}
      {activeModal === 'security' && alerts && (
        <div className="principal-modal-overlay" onClick={() => setActiveModal(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Sự cố an ninh & an toàn cần lưu ý</h3>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              {alerts.securityAlerts?.incidents?.length > 0 ? (
                <div className="principal-table-wrapper">
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Mức độ</th>
                        <th>Vị trí</th>
                        <th>Nội dung sự cố</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.securityAlerts.incidents.map((inc) => (
                        <tr key={inc._id}>
                          <td>{inc.incidentDate}</td>
                          <td>
                            <span className={`status-pill status-${inc.severity}`}>
                              {inc.severity === 'emergency' ? 'Khẩn cấp' : inc.severity === 'serious' ? 'Nghiêm trọng' : 'Bình thường'}
                            </span>
                          </td>
                          <td>{inc.location}</td>
                          <td>{inc.description}</td>
                          <td>{inc.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Không có sự cố nào cần xử lý khẩn cấp.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CẢNH BÁO BẾP ĂN */}
      {activeModal === 'kitchen' && alerts && (
        <div className="principal-modal-overlay" onClick={() => setActiveModal(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Chi tiết cảnh báo an toàn thực phẩm & bếp ăn</h3>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              {/* Lệch suất */}
              <h4>Sai lệch & Thiếu suất ăn</h4>
              {alerts.kitchenAlerts?.mealDiscrepancies?.length > 0 ? (
                <ul>
                  {alerts.kitchenAlerts.mealDiscrepancies.map((d, i) => (
                    <li key={i} style={{ color: '#dc2626', marginBottom: '4px' }}>
                      <strong>{d.className}:</strong> {d.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: '#047857' }}>Không có sai lệch suất ăn nào hôm nay.</p>
              )}

              {/* Kho thực phẩm */}
              <h4>Thực phẩm cận hạn / Hết hạn</h4>
              {alerts.kitchenAlerts?.nearExpiryItems?.length > 0 ? (
                <div className="principal-table-wrapper">
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Tên thực phẩm</th>
                        <th>Lô</th>
                        <th>Hạn dùng</th>
                        <th>Số lượng</th>
                        <th>Tình trạng</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.kitchenAlerts.nearExpiryItems.map((item) => (
                        <tr key={item._id}>
                          <td><strong>{item.ingredientName}</strong></td>
                          <td>{item.lotNumber}</td>
                          <td>{formatDateOnly(item.expiryDate)}</td>
                          <td>{item.quantity} {item.unit}</td>
                          <td>
                            <span className={`status-pill ${item.status === 'expired' ? 'status-overdue' : 'status-pending'}`}>
                              {item.status === 'expired' ? 'Hết hạn' : 'Cận hạn'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: '#047857' }}>Kho thực phẩm đạt tiêu chuẩn hạn sử dụng.</p>
              )}

              {/* Dị ứng thực phẩm */}
              <h4>Học sinh có tiền sử dị ứng ({alerts.kitchenAlerts?.allergyCount || 0} trẻ)</h4>
              {alerts.kitchenAlerts?.studentsWithAllergies?.length > 0 ? (
                <div className="principal-table-wrapper" style={{ maxHeight: '200px' }}>
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Học sinh</th>
                        <th>Dị nguyên cần tránh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.kitchenAlerts.studentsWithAllergies.map((st) => (
                        <tr key={st.studentId}>
                          <td><strong>{st.studentName}</strong></td>
                          <td><span style={{ color: '#dc2626', fontWeight: 600 }}>{st.allergens.join(', ')}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: '#047857' }}>Không có học sinh nào có cảnh báo dị ứng.</p>
              )}

              {/* Kiểm thực bị giữ */}
              {alerts.kitchenAlerts?.heldInspections?.length > 0 && (
                <>
                  <h4 style={{ color: '#dc2626' }}>Kiểm thực 3 bước bị lưu giữ ({alerts.kitchenAlerts.heldInspections.length} đợt)</h4>
                  <div className="principal-table-wrapper">
                    <table className="principal-data-table">
                      <thead>
                        <tr>
                          <th>Bữa ăn</th>
                          <th>Giai đoạn</th>
                          <th>Tình trạng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alerts.kitchenAlerts.heldInspections.map((ins) => (
                          <tr key={ins._id}>
                            <td><strong>{ins.mealType}</strong> ({ins.mealDateKey})</td>
                            <td>{ins.stage}</td>
                            <td><span className="status-pill status-emergency">Bị lưu giữ kiểm tra</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: CÔNG VIỆC QUÁ HẠN */}
      {activeModal === 'overdue' && alerts && (
        <div className="principal-modal-overlay" onClick={() => setActiveModal(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Danh sách phê duyệt & công việc quá hạn</h3>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              {alerts.overdueAlerts?.items?.length > 0 ? (
                <div className="principal-table-wrapper">
                  <table className="principal-data-table">
                    <thead>
                      <tr>
                        <th>Loại việc</th>
                        <th>Tiêu đề / Nội dung</th>
                        <th>Ngày tạo</th>
                        <th>Quá hạn (ngày)</th>
                        <th>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.overdueAlerts.items.map((item) => (
                        <tr key={`${item.type}-${item.id}`}>
                          <td><span className="status-pill status-normal">{item.typeLabel}</span></td>
                          <td><strong>{item.title}</strong></td>
                          <td>{formatDateOnly(item.createdAt)}</td>
                          <td><strong style={{ color: '#dc2626' }}>{item.daysOverdue} ngày</strong></td>
                          <td>
                            <Link to={item.link} className="button button-secondary" style={{ padding: '3px 8px', fontSize: '12px' }}>
                              Xử lý
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Không có công việc nào bị quá hạn.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: TẠO GIAO VIỆC MỚI */}
      {showNewTaskModal && (
        <div className="principal-modal-overlay" onClick={() => setShowNewTaskModal(false)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Giao việc cho bộ phận</h3>
              <button type="button" className="button button-secondary" onClick={() => setShowNewTaskModal(false)}>Đóng</button>
            </div>
            <form onSubmit={handleCreateTask}>
              <div className="principal-modal-body">
                <div className="principal-form-group">
                  <label>Tiêu đề công việc *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Kiểm tra và hoàn tất hoàn học phí cho học sinh..."
                    value={newTaskForm.title}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, title: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="principal-form-group">
                    <label>Bộ phận phụ trách *</label>
                    <select
                      value={newTaskForm.department}
                      onChange={(e) => setNewTaskForm({ ...newTaskForm, department: e.target.value })}
                    >
                      <option value="hr">Nhân sự (HR)</option>
                      <option value="accountant">Kế toán</option>
                      <option value="chef">Bếp ăn</option>
                      <option value="guard">Bảo vệ</option>
                      <option value="teacher">Giáo viên</option>
                    </select>
                  </div>

                  <div className="principal-form-group">
                    <label>Mức độ ưu tiên</label>
                    <select
                      value={newTaskForm.priority}
                      onChange={(e) => setNewTaskForm({ ...newTaskForm, priority: e.target.value })}
                    >
                      <option value="normal">Bình thường</option>
                      <option value="high">Quan trọng</option>
                      <option value="urgent">Khẩn cấp</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="principal-form-group">
                    <label>Hạn xử lý</label>
                    <input
                      type="date"
                      value={newTaskForm.dueDate}
                      onChange={(e) => setNewTaskForm({ ...newTaskForm, dueDate: e.target.value })}
                    />
                  </div>

                  <div className="principal-form-group">
                    <label>Người phụ trách cụ thể</label>
                    <select
                      value={newTaskForm.assignedTo || ''}
                      onChange={(e) => setNewTaskForm({ ...newTaskForm, assignedTo: e.target.value })}
                    >
                      <option value="">Phân công toàn bộ phận</option>
                      {departmentStaff.map((u) => (
                        <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="principal-form-group">
                  <label>Chi tiết yêu cầu / Chỉ đạo của Hiệu trưởng</label>
                  <textarea
                    rows={3}
                    placeholder="Ghi rõ nội dung chỉ đạo, yêu cầu hồ sơ hoặc biện pháp cần thực hiện..."
                    value={newTaskForm.description}
                    onChange={(e) => setNewTaskForm({ ...newTaskForm, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="principal-modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setShowNewTaskModal(false)}>Hủy</button>
                <button type="submit" className="button button-primary" disabled={submittingTask}>
                  {submittingTask ? 'Đang lưu...' : 'Giao việc'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LỊCH SỬ THAO TÁC CÔNG VIỆC */}
      {selectedTaskHistory && (
        <div className="principal-modal-overlay" onClick={() => setSelectedTaskHistory(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Nhật ký thực hiện: {selectedTaskHistory.title}</h3>
              <button type="button" className="button button-secondary" onClick={() => setSelectedTaskHistory(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(selectedTaskHistory.history || []).map((h, idx) => (
                  <div key={idx} style={{ padding: '12px', borderRadius: '8px', background: '#f8fafc', borderLeft: '3px solid #2563eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <strong>{h.actorName} ({h.actorRole?.toUpperCase()})</strong>
                      <span style={{ color: '#64748b' }}>{formatDate(h.at)}</span>
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '13.5px', color: '#1e293b' }}>
                      {h.note || `Hành động: ${h.action}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: YÊU CẦU XEM LẠI / CHỈ ĐẠO CÔNG VIỆC */}
      {reviewTaskTarget && (
        <div className="principal-modal-overlay" onClick={() => setReviewTaskTarget(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Chỉ đạo tiến độ: {reviewTaskTarget.title}</h3>
              <button type="button" className="button button-secondary" onClick={() => setReviewTaskTarget(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              <div className="principal-form-group">
                <label>Ý kiến chỉ đạo / Yêu cầu bổ sung của Hiệu trưởng *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Ghi rõ ý kiến chỉ đạo hoặc yêu cầu bộ phận xem lại/bổ sung..."
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
              </div>
            </div>
            <div className="principal-modal-footer">
              <button type="button" className="button button-secondary" onClick={() => setReviewTaskTarget(null)}>Hủy</button>
              <button type="button" className="button button-primary" onClick={handleReviewTask} disabled={!reviewNote.trim()}>
                Gửi chỉ đạo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GHI CHỈ ĐẠO SỰ CỐ AN NINH */}
      {instructionIncident && (
        <div className="principal-modal-overlay" onClick={() => setInstructionIncident(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Ghi chỉ đạo sự cố an ninh</h3>
              <button type="button" className="button button-secondary" onClick={() => setInstructionIncident(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '13px' }}>
                <div><strong>Vị trí:</strong> {instructionIncident.location}</div>
                <div><strong>Nội dung:</strong> {instructionIncident.description}</div>
              </div>
              <div className="principal-form-group">
                <label>Ý kiến chỉ đạo quản lý của Hiệu trưởng *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="VD: Yêu cầu tăng cường tuần tra cổng phụ, phối hợp công an khu vực..."
                  value={instructionText}
                  onChange={(e) => setInstructionText(e.target.value)}
                />
              </div>
            </div>
            <div className="principal-modal-footer">
              <button type="button" className="button button-secondary" onClick={() => setInstructionIncident(null)}>Hủy</button>
              <button type="button" className="button button-primary" onClick={handleSaveInstruction} disabled={savingInstruction || !instructionText.trim()}>
                {savingInstruction ? 'Đang lưu...' : 'Lưu chỉ đạo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SOẠN THÔNG BÁO CHỈ ĐẠO MỚI */}
      {showNewDirectiveModal && (
        <div className="principal-modal-overlay" onClick={() => setShowNewDirectiveModal(false)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Soạn thông báo chỉ đạo nội bộ</h3>
              <button type="button" className="button button-secondary" onClick={() => setShowNewDirectiveModal(false)}>Đóng</button>
            </div>
            <form onSubmit={handleSendDirective}>
              <div className="principal-modal-body">
                <div className="principal-form-group">
                  <label>Tiêu đề chỉ đạo *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Chỉ đạo về tăng cường an toàn vệ sinh thực phẩm và đón trả trẻ..."
                    value={directiveForm.title}
                    onChange={(e) => setDirectiveForm({ ...directiveForm, title: e.target.value })}
                  />
                </div>

                <div className="principal-form-group">
                  <label>Mức độ ưu tiên *</label>
                  <select
                    value={directiveForm.priority}
                    onChange={(e) => setDirectiveForm({ ...directiveForm, priority: e.target.value })}
                  >
                    <option value="normal">Bình thường</option>
                    <option value="high">Quan trọng</option>
                    <option value="urgent">Khẩn cấp</option>
                  </select>
                </div>

                <div className="principal-form-group">
                  <label>Nhóm nhận chỉ đạo (Tuyệt đối không gửi nhầm phụ huynh) *</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px' }}>
                    {[
                      ['teacher', 'Giáo viên'],
                      ['hr', 'Nhân sự'],
                      ['accountant', 'Kế toán'],
                      ['chef', 'Bếp ăn'],
                      ['guard', 'Bảo vệ']
                    ].map(([roleKey, roleLabel]) => (
                      <label key={roleKey} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={directiveForm.roles.includes(roleKey)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDirectiveForm({ ...directiveForm, roles: [...directiveForm.roles, roleKey] });
                            } else {
                              setDirectiveForm({ ...directiveForm, roles: directiveForm.roles.filter((r) => r !== roleKey) });
                            }
                          }}
                        />
                        {roleLabel}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="principal-form-group">
                  <label>Nội dung chỉ đạo *</label>
                  <textarea
                    rows={5}
                    required
                    placeholder="Nhập toàn văn chỉ đạo của Hiệu trưởng gửi đến cán bộ, giáo viên và nhân viên..."
                    value={directiveForm.message}
                    onChange={(e) => setDirectiveForm({ ...directiveForm, message: e.target.value })}
                  />
                </div>
              </div>
              <div className="principal-modal-footer">
                <button type="button" className="button button-secondary" onClick={() => setShowNewDirectiveModal(false)}>Hủy</button>
                <button type="submit" className="button button-primary" disabled={sendingDirective}>
                  {sendingDirective ? 'Đang gửi...' : 'Phát lệnh chỉ đạo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: XEM BIÊN NHẬN ĐỌC THÔNG BÁO */}
      {receiptModalData && (
        <div className="principal-modal-overlay" onClick={() => setReceiptModalData(null)} role="presentation">
          <div className="principal-modal" onClick={(e) => e.stopPropagation()}>
            <div className="principal-modal-header">
              <h3>Biên nhận đã đọc: {receiptModalData.announcement?.title}</h3>
              <button type="button" className="button button-secondary" onClick={() => setReceiptModalData(null)}>Đóng</button>
            </div>
            <div className="principal-modal-body">
              <div className="receipt-stats">
                <span>Tổng nhận: <strong>{receiptModalData.total}</strong></span>
                <span style={{ color: '#047857' }}>Đã đọc: <strong>{receiptModalData.readCount}</strong> ({receiptModalData.readPercent}%)</span>
                <span style={{ color: '#dc2626' }}>Chưa đọc: <strong>{receiptModalData.unreadCount}</strong></span>
              </div>
              <div className="receipt-progress-bar">
                <div className="receipt-progress-fill" style={{ width: `${receiptModalData.readPercent}%` }} />
              </div>

              <div className="principal-table-wrapper" style={{ maxHeight: '350px' }}>
                <table className="principal-data-table">
                  <thead>
                    <tr>
                      <th>Nhân sự</th>
                      <th>Vai trò</th>
                      <th>Trạng thái</th>
                      <th>Thời gian đọc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(receiptModalData.recipients || []).map((r, idx) => (
                      <tr key={idx}>
                        <td><strong>{r.fullName}</strong></td>
                        <td>
                          {{
                            teacher: 'Giáo viên',
                            hr: 'Nhân sự',
                            accountant: 'Kế toán',
                            chef: 'Bếp ăn',
                            guard: 'Bảo vệ',
                            admin: 'Quản trị viên',
                            principal: 'Hiệu trưởng'
                          }[r.role] || r.role}
                        </td>
                        <td>
                          {r.isRead ? (
                            <span className="status-pill status-completed">Đã xem</span>
                          ) : (
                            <span className="status-pill status-pending">Chưa xem</span>
                          )}
                        </td>
                        <td>{r.readAt ? formatDate(r.readAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
