import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import QrScanner from '../components/QrScanner';
import StudentPagination from '../components/StudentPagination';
import { GuardDeliveryPanel, GuardEmergencyPanel, GuardReportPanel } from '../components/GuardAdvancedPanels';
import GuardDevicePanel from '../components/GuardDevicePanel';
import { queueGuardOperation, syncGuardQueue, safeReadGuardQueue } from '../utils/guardOfflineQueue';

const localDate = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
const timeText = (value) => value ? new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
const dateTimeText = (value) => value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
const incidentCategory = { unauthorized_person: 'Người lạ', invalid_picker: 'Người đón không hợp lệ', child_safety: 'An toàn trẻ', accident: 'Tai nạn', lost_property: 'Mất tài sản', equipment: 'Thiết bị', fire: 'Cháy / khói', traffic: 'Giao thông', other: 'Khác' };
const incidentStatus = { open: 'Mới ghi nhận', in_progress: 'Đang xử lý', handed_over: 'Đã bàn giao', closed: 'Đã đóng' };
const shiftText = { morning: 'Ca sáng', afternoon: 'Ca chiều', evening: 'Ca tối' };

const initialVisitor = { fullName: '', phone: '', organization: '', purpose: '', hostName: '', allowedArea: '', identityLast4: '', vehiclePlate: '', badgeNumber: '', note: '' };
const initialIncident = { category: 'unauthorized_person', severity: 'normal', location: 'Cổng chính', description: '', actionTaken: '', studentId: '' };
const initialHandover = { shiftName: 'morning', receiverId: '', keysAndEquipment: '', notes: '' };

export default function GuardOperations() {
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const isManager = ['admin', 'principal'].includes(role);
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabParam = searchParams.get('tab');

  const allowedTabs = useMemo(() => [
    'overview',
    ...(isManager ? ['gate'] : []),
    'visitors',
    'incidents',
    'handover',
    'emergency',
    'devices',
    ...(isManager ? ['deliveries', 'reports'] : [])
  ], [isManager]);

  const activeTab = allowedTabs.includes(currentTabParam) ? currentTabParam : 'overview';

  const setActiveTab = useCallback((nextTab) => {
    const tabToSet = allowedTabs.includes(nextTab) ? nextTab : 'overview';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabToSet === 'overview') {
        next.delete('tab');
      } else {
        next.set('tab', tabToSet);
      }
      return next;
    }, { replace: true });
  }, [allowedTabs, setSearchParams]);

  // Clean legacy/removed tabs (e.g. ?tab=gate for guard) safely without reload or loop
  useEffect(() => {
    if (currentTabParam && !allowedTabs.includes(currentTabParam)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('tab');
        return next;
      }, { replace: true });
    }
  }, [currentTabParam, allowedTabs, setSearchParams]);

  const [date, setDate] = useState(localDate());
  const [dashboard, setDashboard] = useState(null);
  const [visitors, setVisitors] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [handovers, setHandovers] = useState([]);
  const [receivers, setReceivers] = useState([]);
  const [emergencyMode, setEmergencyMode] = useState(null);
  const [acceptanceNotes, setAcceptanceNotes] = useState({});
  const [incidentNotes, setIncidentNotes] = useState({});
  const [visitorForm, setVisitorForm] = useState(initialVisitor);
  const [incidentForm, setIncidentForm] = useState(initialIncident);
  const [handoverForm, setHandoverForm] = useState(initialHandover);
  const [queueState, setQueueState] = useState(() => {
    const inspect = safeReadGuardQueue();
    return { count: inspect.queue.length, error: inspect.error };
  });
  const [state, setState] = useState({ loading: true, saving: false, error: '', success: '' });

  // Admin-only gate state
  const [gateEvents, setGateEvents] = useState([]);
  const [gatePage, setGatePage] = useState(1);
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [studentPagination, setStudentPagination] = useState({ total: 0, totalPages: 1 });
  const [qrResult, setQrResult] = useState(null);

  const load = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const calls = [
        api.get('/guard/dashboard', { params: { date } }),
        api.get('/guard/visitors', { params: { date } }),
        api.get('/guard/incidents'),
        api.get('/guard/handovers', { params: { date } }),
        api.get('/guard/receivers'),
        api.get('/guard/emergency-mode')
      ];
      if (isManager) {
        calls.push(api.get('/guard/gate-events', { params: { date } }));
      }
      const results = await Promise.all(calls);
      const [dashboardRes, visitorRes, incidentRes, handoverRes, receiverRes, emergencyRes] = results;
      setDashboard(dashboardRes.data.data);
      setVisitors(visitorRes.data.data || []);
      setIncidents(incidentRes.data.data || []);
      setHandovers(handoverRes.data.data || []);
      setReceivers(receiverRes.data.data || []);
      setEmergencyMode(emergencyRes.data.data || null);
      if (isManager && results[6]) {
        setGateEvents(results[6].data.data || []);
      }
      setState((old) => ({ ...old, loading: false }));
      return true;
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải dữ liệu trực cổng.' }));
      return false;
    }
  }, [date, isManager]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => clearInterval(timer);
  }, [load]);

  // Admin-only student search
  useEffect(() => {
    if (!isManager || activeTab !== 'gate') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await api.get('/guard/students', { params: { search, page: searchPage } });
        if (!cancelled) {
          setStudents(response.data.data || []);
          setStudentPagination(response.data.pagination || { total: 0, totalPages: 1 });
        }
      } catch (error) {
        if (!cancelled) {
          setStudents([]);
          setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể tìm học sinh.' }));
        }
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, searchPage, isManager, activeTab]);

  const runAction = async (action, success, offlineFallback = null) => {
    if (date !== localDate()) { setState((old) => ({ ...old, error: 'Ngày đã chọn chỉ dùng xem lịch sử. Chọn hôm nay để ghi nhận ca trực.' })); return false; }
    setState((old) => ({ ...old, saving: true, error: '', success: '' }));
    try { await action(); const refreshed = await load(); setState((old) => ({ ...old, loading: false, saving: false, success: refreshed ? success : `${success} Chưa tải lại được dữ liệu, hãy bấm Làm mới.` })); return true; }
    catch (error) {
      if (!error.response && offlineFallback) {
        try {
          const queue = await queueGuardOperation(offlineFallback.operation, offlineFallback.payload);
          setQueueState({ count: queue.length, error: null });
          setState((old) => ({ ...old, loading: false, saving: false, error: '', success: 'Mất kết nối: thao tác đã được lưu trên thiết bị và sẽ đồng bộ khi có mạng.' }));
          return true;
        } catch (storageErr) {
          const inspect = safeReadGuardQueue();
          setQueueState({ count: inspect.queue.length, error: inspect.error || storageErr });
          setState((old) => ({ ...old, loading: false, saving: false, success: '', error: storageErr.message || 'Không thể lưu thao tác vào bộ nhớ cục bộ.' }));
          return false;
        }
      }
      setState((old) => ({ ...old, loading: false, saving: false, success: '', error: error.response?.data?.message || 'Không thể thực hiện thao tác.' })); return false;
    }
  };

  const recordGate = (student, method = 'manual') => {
    const clientEventId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const occurredAt = new Date().toISOString();
    const payload = { studentId: student._id, direction: 'arrival', method, clientEventId, occurredAt };
    return runAction(
      () => api.post('/guard/gate-events', payload),
      `Đã ghi nhận ${student.fullName} vào trường.`,
      { operation: 'gate', payload }
    );
  };
  const resolveQr = async (code) => {
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const response = await api.post('/guard/qr/resolve', { code });
      setQrResult(response.data.data);
      setState((old) => ({ ...old, saving: false }));
    } catch (error) {
      setQrResult(null);
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể kiểm tra mã QR.' }));
    }
  };

  const submitVisitor = async (event) => {
    event.preventDefault();
    const clientEventId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const occurredAt = new Date().toISOString();
    const payload = { ...visitorForm, clientEventId, occurredAt };
    if (await runAction(() => api.post('/guard/visitors', payload), 'Đã ghi nhận khách vào trường.', { operation: 'visitor', payload })) {
      setVisitorForm(initialVisitor);
    }
  };
  const checkoutVisitor = (id) => runAction(() => api.patch(`/guard/visitors/${id}/check-out`), 'Đã ghi nhận khách rời trường.');
  const submitIncident = async (event) => {
    event.preventDefault();
    const clientEventId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const occurredAt = new Date().toISOString();
    const payload = { ...incidentForm, studentId: incidentForm.studentId || null, clientEventId, occurredAt };
    if (await runAction(() => api.post('/guard/incidents', payload), 'Đã ghi nhận sự cố.', { operation: 'incident', payload })) {
      setIncidentForm(initialIncident);
    }
  };
  const changeIncident = (id, status) => runAction(() => api.patch(`/guard/incidents/${id}`, { status, resolutionNote: incidentNotes[id] || '' }), 'Đã cập nhật sự cố.');
  const acknowledgeIncident = (id) => runAction(() => api.patch(`/guard/incidents/${id}/acknowledge`), 'Đã tiếp nhận cảnh báo.');
  const submitHandover = async (event) => { event.preventDefault(); if (await runAction(() => api.post('/guard/handovers', handoverForm), 'Đã lưu bàn giao ca trực.')) setHandoverForm(initialHandover); };
  const acceptHandover = (id) => runAction(() => api.patch(`/guard/handovers/${id}/accept`, { acceptanceNote: acceptanceNotes[id] || '' }), 'Đã xác nhận nhận ca trực.');
  const syncOffline = useCallback(async () => {
    if (!navigator.onLine) return;
    const inspect = safeReadGuardQueue();
    if (!inspect.success) {
      setQueueState({ count: 0, error: inspect.error });
      setState((old) => ({ ...old, error: inspect.error.message }));
      return;
    }
    setQueueState({ count: inspect.queue.length, error: null });
    if (!inspect.queue.length) return;
    try {
      const result = await syncGuardQueue();
      const afterInspect = safeReadGuardQueue();
      setQueueState({ count: afterInspect.queue.length, error: afterInspect.error || (result.corrupted ? new Error(result.error) : null) });
      if (result.error && !result.inProgress) {
        setState((old) => ({ ...old, error: result.error }));
      } else if (result.synced) {
        await load();
        setState((old) => ({
          ...old,
          success: `Đã đồng bộ ${result.synced} thao tác lưu khi mất mạng.`,
          error: result.remaining?.length ? `${result.remaining.length} thao tác chưa thể đồng bộ.` : (result.storageError || '')
        }));
      }
    } catch (err) {
      setState((old) => ({ ...old, error: err.message || 'Không thể đồng bộ hàng đợi.' }));
    }
  }, [load]);
  useEffect(() => {
    const handleOnline = () => { void syncOffline(); };
    const handleStorage = (event) => {
      if (event.key && event.key.startsWith('school_guard_offline_queue_v1_')) {
        const inspect = safeReadGuardQueue();
        setQueueState({ count: inspect.queue.length, error: inspect.error });
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('storage', handleStorage);
    void syncOffline();
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('storage', handleStorage);
    };
  }, [syncOffline]);

  const summary = dashboard?.summary || {};
  const tabs = useMemo(() => [
    ['overview', 'Tổng quan ca trực', 'grid'],
    ...(isManager ? [['gate', 'Học sinh & QR', 'attendance']] : []),
    ['visitors', 'Khách ra vào', 'users'],
    ['incidents', 'Sự cố an ninh', 'alertCircle'],
    ['handover', 'Bàn giao ca', 'clock'],
    ['emergency', 'Khẩn cấp', 'shield'],
    ['devices', 'Thiết bị cổng', 'settings'],
    ...(isManager ? [
      ['deliveries', 'Giao hàng', 'card'],
      ['reports', 'Báo cáo cổng', 'chart']
    ] : [])
  ], [isManager]);

  return <AppShell title="Trực cổng trường" subtitle="Kiểm soát khách ra vào, sự cố an ninh, xử lý khẩn cấp và bàn giao ca an toàn." actions={<label className="guard-date-filter">Ngày trực<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}>
    {state.error && <div className="form-error guard-notice">{state.error}</div>}
    {state.success && <div className="timekeeping-notice success guard-notice">{state.success}</div>}
    <div className="guard-live-toolbar"><span>{navigator.onLine ? (date === localDate() ? 'Dữ liệu tự cập nhật mỗi 30 giây' : 'Đang xem lịch sử — các thao tác ghi nhận chỉ áp dụng hôm nay') : 'Đang mất mạng — thao tác hợp lệ sẽ được lưu tạm trên thiết bị'}{queueState.error ? <b className="guard-offline-count error">Lỗi hàng đợi: {queueState.error.message}</b> : (queueState.count > 0 && <b className="guard-offline-count">{queueState.count} thao tác chờ đồng bộ</b>)}</span>{queueState.count > 0 && !queueState.error && <button className="button button-secondary" disabled={!navigator.onLine || state.saving} onClick={syncOffline}>Đồng bộ ngay</button>}<button className="button button-secondary" disabled={state.loading || !navigator.onLine} onClick={load}>Làm mới dữ liệu</button></div>
    {emergencyMode && <button type="button" className="guard-global-emergency" onClick={() => setActiveTab('emergency')}><span><Icon name="alertCircle" size={20} /></span><strong>KHẨN CẤP: {emergencyMode.title}</strong><small>{emergencyMode.instructions}</small><b>Mở hướng dẫn xử lý</b></button>}
    <nav className="guard-tabs" aria-label="Nghiệp vụ trực cổng">{tabs.map(([key, label, icon]) => <button type="button" key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}><Icon name={icon} size={17} />{label}</button>)}</nav>

    {state.loading && !dashboard ? <div className="page-loader"><span className="loading-orb" />Đang tải ca trực...</div> : <>
      {activeTab === 'overview' && <div className="guard-overview">
        <section className="content-card guard-priority-panel"><div className="card-heading"><div><p className="card-kicker">CẢNH BÁO ƯU TIÊN</p><h2>{dashboard?.priorityIncidents?.length || 0} sự cố cần quản lý tiếp nhận</h2></div><button className="button button-secondary" onClick={() => setActiveTab('incidents')}>Xem sự cố</button></div><div className="guard-priority-list">{dashboard?.priorityIncidents?.length ? dashboard.priorityIncidents.map((item) => <article key={item._id} className={item.severity}><div><strong>{item.severity === 'emergency' ? 'KHẨN CẤP' : 'NGHIÊM TRỌNG'} · {item.location}</strong><p>{item.description}</p><small>{dateTimeText(item.createdAt)} · {item.reminderCount || 0} lần nhắc</small></div>{isManager && <button className="button button-primary" disabled={state.saving} onClick={() => acknowledgeIncident(item._id)}>Tôi đã tiếp nhận</button>}</article>) : <p>Không có cảnh báo đang chờ tiếp nhận.</p>}</div></section>
        <section className="guard-metrics">
          <article><span className="purple"><Icon name="users" /></span><div><small>KHÁCH TRONG TRƯỜNG</small><strong>{summary.visitorsInside || 0}</strong><em>đang lưu trú</em></div></article>
          <article><span className="red"><Icon name="alertCircle" /></span><div><small>SỰ CỐ CHƯA ĐÓNG</small><strong>{summary.openIncidents || 0}</strong><em>cần xử lý / bàn giao</em></div></article>
          <article><span className="orange"><Icon name="clock" /></span><div><small>BÀN GIAO CA HÔM NAY</small><strong>{handovers.length || 0}</strong><em>biên bản ghi nhận</em></div></article>
          <article><span className="green"><Icon name="shield" /></span><div><small>AN NINH CỔNG</small><strong>{emergencyMode ? 'CẢNH BÁO KHẨN CẤP' : 'Bình thường'}</strong><em>{emergencyMode ? emergencyMode.level.toUpperCase() : 'Hệ thống an toàn'}</em></div></article>
        </section>
        <section className="guard-quick-actions content-card"><div className="card-heading"><div><p className="card-kicker">THAO TÁC NHANH</p><h2>Nhiệm vụ trực cổng</h2></div></div><div>{isManager && <button onClick={() => setActiveTab('gate')}><Icon name="attendance" />Học sinh & QR</button>}<button onClick={() => setActiveTab('visitors')}><Icon name="users" />Đăng ký khách</button><button onClick={() => setActiveTab('incidents')}><Icon name="alertCircle" />Báo sự cố</button><button onClick={() => setActiveTab('handover')}><Icon name="clock" />Bàn giao ca</button><button onClick={() => setActiveTab('emergency')}><Icon name="shield" />Xử lý khẩn cấp</button><button onClick={() => setActiveTab('devices')}><Icon name="settings" />Thiết bị cổng</button><Link to="/timekeeping"><Icon name="check" />Chấm công</Link></div></section>
        <div className="guard-overview-grid">
          <section className="content-card"><div className="card-heading"><div><p className="card-kicker">VIỆC CẦN XỬ LÝ</p><h2>Cảnh báo sự cố trong ca</h2></div><button className="button button-secondary" onClick={() => setActiveTab('incidents')}>Xem chi tiết</button></div><div className="guard-alert-list">{dashboard?.incidents?.slice(0, 5).map((item) => <button key={item._id} onClick={() => setActiveTab('incidents')}><Icon name="alertCircle" /><span><strong>{incidentCategory[item.category]}</strong><small>{item.location} · {incidentStatus[item.status]}</small></span></button>)}{!dashboard?.incidents?.length && <div className="empty-state compact">Không có sự cố nào cần xử lý.</div>}</div></section>
          <section className="content-card">
            <div className="card-heading">
              <div><p className="card-kicker">KHÁCH ĐANG Ở TRƯỜNG</p><h2>Lưu trú hiện tại</h2></div>
              <button className="button button-secondary" onClick={() => setActiveTab('visitors')}>Sổ khách</button>
            </div>
            <div className="guard-visitor-list">
              {visitors.filter((item) => item.status === 'inside').slice(0, 4).map((item) => (
                <article key={item._id} className={item.status}>
                  <div>
                    <strong>{item.fullName}</strong>
                    <small>{item.organization || 'Khách cá nhân'} · gặp {item.hostName}</small>
                  </div>
                  <div>
                    <small>Vào {timeText(item.checkInAt)}</small>
                    <button className="button button-secondary" disabled={state.saving} onClick={() => checkoutVisitor(item._id)}>Xác nhận ra</button>
                  </div>
                </article>
              ))}
              {!visitors.some((item) => item.status === 'inside') && <div className="empty-state compact">Hiện không có khách nào trong trường.</div>}
            </div>
          </section>
        </div>
      </div>}

      {activeTab === 'gate' && isManager && (
        <section className="guard-workspace guard-gate-workspace">
          <article className="content-card guard-qr-panel">
            <div className="card-heading">
              <div><p className="card-kicker">QUÉT NHANH TẠI CỔNG</p><h2>QR học sinh hoặc người đón</h2></div>
              <span className="history-count">Mã được kiểm tra trên máy chủ</span>
            </div>
            <div className="guard-qr-layout">
              <QrScanner onResult={resolveQr} disabled={state.saving || date !== localDate()} />
              <div className="guard-qr-result">
                {qrResult?.type === 'student' && <article>
                  <span className="student-avatar large">{qrResult.student.fullName?.charAt(0)}</span>
                  <div>
                    <p className="card-kicker">HỌC SINH</p>
                    <h3>{qrResult.student.fullName}</h3>
                    <small>{qrResult.student.studentCode} · {qrResult.student.className}</small>
                    <span className={`student-status ${qrResult.student.gateStatus === 'arrival' ? 'enrolled' : 'temporarily_absent'}`}>{qrResult.student.gateStatus === 'arrival' ? 'Đang ở trường' : qrResult.student.gateStatus === 'departure' ? 'Đã rời trường' : 'Chưa ghi nhận'}</span>
                  </div>
                  {qrResult.student.gateStatus === 'not_recorded' && <button className="button button-primary" onClick={() => recordGate(qrResult.student, 'qr')}>Ghi nhận vào trường</button>}
                  {qrResult.student.gateStatus === 'arrival' && <Link className="button button-secondary" to={`/pickups?studentId=${qrResult.student._id}`}>Kiểm tra người đón</Link>}
                </article>}
                {qrResult?.type === 'pickup' && <article>
                  <span className="student-avatar large">{qrResult.pickup.picker?.fullName?.charAt(0)}</span>
                  <div>
                    <p className="card-kicker">NGƯỜI ĐÓN TRẺ</p>
                    <h3>{qrResult.pickup.picker?.fullName}</h3>
                    <small>Đón {qrResult.pickup.studentName} · {qrResult.pickup.className}</small>
                    <span className="student-status enrolled">QR hợp lệ hôm nay</span>
                  </div>
                  <Link className="button button-primary" to={`/pickups?studentId=${qrResult.pickup.studentId}`}>Mở đối chiếu bàn giao</Link>
                </article>}
                {!qrResult && <div className="empty-state compact"><span className="empty-icon"><Icon name="camera" /></span><strong>Chưa có kết quả quét</strong><p>Quét QR hoặc nhập mã để đối chiếu dữ liệu.</p></div>}
              </div>
            </div>
          </article>
          <article className="content-card guard-search-panel">
            <div className="card-heading"><div><p className="card-kicker">KIỂM SOÁT CỔNG</p><h2>Tìm học sinh</h2></div></div>
            <label className="guard-search"><Icon name="search" /><input value={search} onChange={(event) => { setSearch(event.target.value); setSearchPage(1); }} placeholder="Nhập tên, mã học sinh hoặc mã thẻ..." /></label>
            <div className="guard-student-results">
              {students.map((student) => <article key={student._id}>
                <span className="student-avatar large">{student.fullName.charAt(0)}</span>
                <div><strong>{student.fullName}</strong><small>{student.studentCode} · {student.className || 'Chưa xếp lớp'}</small></div>
                <div><button className="button button-primary" disabled={state.saving || date !== localDate()} onClick={() => recordGate(student)}>Ghi nhận vào trường</button></div>
              </article>)}
            </div>
            <div className="guard-live-toolbar">
              <span>{studentPagination.total} học sinh · Trang {searchPage}/{studentPagination.totalPages}</span>
              <button className="button button-secondary" disabled={searchPage <= 1} onClick={() => setSearchPage(searchPage - 1)}>Trang trước</button>
              <button className="button button-secondary" disabled={searchPage >= studentPagination.totalPages} onClick={() => setSearchPage(searchPage + 1)}>Trang sau</button>
            </div>
          </article>
          <article className="content-card">
            <div className="card-heading"><div><p className="card-kicker">NHẬT KÝ CỔNG</p><h2>{gateEvents.length} lượt ngày {new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')}</h2></div></div>
            <div className="guard-log-list">
              {gateEvents.length ? gateEvents.slice((gatePage - 1) * 10, gatePage * 10).map((item) => <article key={item._id}>
                <span className={`guard-event-icon ${item.direction}`}><Icon name={item.direction === 'arrival' ? 'arrowRight' : 'logout'} /></span>
                <div><strong>{item.studentName}</strong><small>{item.className} · {item.recordedByName}</small></div>
                <span><b>{item.direction === 'arrival' ? 'Vào trường' : 'Rời trường'}</b><small>{timeText(item.occurredAt)}</small></span>
              </article>) : <div className="empty-state compact">Chưa có sự kiện qua cổng.</div>}
            </div>
            <StudentPagination total={gateEvents.length} page={gatePage} onChange={setGatePage} label="lượt qua cổng" />
          </article>
        </section>
      )}

      {activeTab === 'visitors' && <section className="guard-workspace">
        <form className="content-card student-form guard-form" onSubmit={submitVisitor}><div className="card-heading"><div><p className="card-kicker">KHÁCH VÀO TRƯỜNG</p><h2>Đăng ký lượt khách</h2></div></div><div className="student-form-grid"><label>Họ và tên<input value={visitorForm.fullName} onChange={(event) => setVisitorForm({ ...visitorForm, fullName: event.target.value })} maxLength="120" required /></label><label>Số điện thoại<input value={visitorForm.phone} onChange={(event) => setVisitorForm({ ...visitorForm, phone: event.target.value })} /></label><label>Đơn vị<input value={visitorForm.organization} onChange={(event) => setVisitorForm({ ...visitorForm, organization: event.target.value })} /></label><label>Người cần gặp<input value={visitorForm.hostName} onChange={(event) => setVisitorForm({ ...visitorForm, hostName: event.target.value })} required /></label><label className="form-wide">Mục đích<input value={visitorForm.purpose} onChange={(event) => setVisitorForm({ ...visitorForm, purpose: event.target.value })} required /></label><label>Khu vực được phép đến<input value={visitorForm.allowedArea} onChange={(event) => setVisitorForm({ ...visitorForm, allowedArea: event.target.value })} /></label><label>Số thẻ khách<input value={visitorForm.badgeNumber} onChange={(event) => setVisitorForm({ ...visitorForm, badgeNumber: event.target.value })} /></label><label>4 số cuối giấy tờ<input value={visitorForm.identityLast4} maxLength="4" onChange={(event) => setVisitorForm({ ...visitorForm, identityLast4: event.target.value.replace(/\D/g, '') })} /></label><label>Biển số xe<input value={visitorForm.vehiclePlate} onChange={(event) => setVisitorForm({ ...visitorForm, vehiclePlate: event.target.value })} /></label></div><div className="form-actions"><button className="button button-primary" disabled={state.saving}>Ghi nhận khách vào</button></div></form>
        <article className="content-card"><div className="card-heading"><div><p className="card-kicker">SỔ KHÁCH HÔM NAY</p><h2>{visitors.filter((item) => item.status === 'inside').length} khách đang ở trường</h2></div></div><div className="guard-visitor-list">{visitors.length ? visitors.map((item) => <article key={item._id} className={item.status}><div><strong>{item.fullName}</strong><small>{item.organization || 'Khách cá nhân'} · gặp {item.hostName}</small><p>{item.purpose}</p></div><div><span className={`student-status ${item.status === 'inside' ? 'temporarily_absent' : 'enrolled'}`}>{item.status === 'inside' ? 'Đang ở trường' : 'Đã rời trường'}</span><small>Vào {timeText(item.checkInAt)}{item.checkOutAt ? ` · Ra ${timeText(item.checkOutAt)}` : ''}</small>{item.status === 'inside' && <button className="button button-secondary" disabled={state.saving} onClick={() => checkoutVisitor(item._id)}>Xác nhận rời trường</button>}</div></article>) : <div className="empty-state compact">Chưa có khách trong ngày.</div>}</div></article>
      </section>}

      {activeTab === 'deliveries' && isManager && <GuardDeliveryPanel date={date} onOfflineQueued={() => { const ins = safeReadGuardQueue(); setQueueState({ count: ins.queue.length, error: ins.error }); }} />}

      {activeTab === 'emergency' && <GuardEmergencyPanel />}
      {activeTab === 'devices' && <GuardDevicePanel isManager={isManager} />}

      {activeTab === 'reports' && isManager && <GuardReportPanel />}

      {activeTab === 'incidents' && <section className="guard-workspace guard-incident-workspace">
        <div className="guard-workspace-column">
          <article className="content-card guard-priority-panel">
            <div className="card-heading"><div><p className="card-kicker">ƯU TIÊN XỬ LÝ</p><h2>Cảnh báo chưa tiếp nhận</h2></div></div>
            <div className="guard-priority-list">
              {incidents.filter((item) => ['serious', 'emergency'].includes(item.severity) && item.status !== 'closed' && !item.acknowledgedAt).map((item) => <article key={item._id} className={item.severity}><div><strong>{item.severity === 'emergency' ? 'KHẨN CẤP' : 'NGHIÊM TRỌNG'} · {item.location}</strong><p>{item.description}</p><small>Đã nhắc {item.reminderCount || 0} lần</small></div>{isManager && <button className="button button-primary" disabled={state.saving} onClick={() => acknowledgeIncident(item._id)}>Tôi đã tiếp nhận</button>}</article>)}
              {!incidents.some((item) => ['serious', 'emergency'].includes(item.severity) && item.status !== 'closed' && !item.acknowledgedAt) && <div className="guard-empty-note"><Icon name="check" size={18} /><span><strong>Không có cảnh báo ưu tiên</strong><small>Hiện không có sự cố nghiêm trọng hoặc khẩn cấp đang chờ tiếp nhận.</small></span></div>}
            </div>
          </article>

          <form className="content-card student-form guard-form" onSubmit={submitIncident}>
            <div className="card-heading"><div><p className="card-kicker">AN NINH TRƯỜNG HỌC</p><h2>Ghi nhận sự cố mới</h2></div></div>
            <div className="student-form-grid"><label>Loại sự cố<select value={incidentForm.category} onChange={(event) => setIncidentForm({ ...incidentForm, category: event.target.value })}>{Object.entries(incidentCategory).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Mức độ<select value={incidentForm.severity} onChange={(event) => setIncidentForm({ ...incidentForm, severity: event.target.value })}><option value="normal">Thông thường</option><option value="serious">Nghiêm trọng</option><option value="emergency">Khẩn cấp</option></select></label><label className="form-wide">Vị trí<input value={incidentForm.location} onChange={(event) => setIncidentForm({ ...incidentForm, location: event.target.value })} required /></label><label className="form-wide">Nội dung<textarea value={incidentForm.description} onChange={(event) => setIncidentForm({ ...incidentForm, description: event.target.value })} maxLength="2000" required /></label><label className="form-wide">Biện pháp đã thực hiện<textarea value={incidentForm.actionTaken} onChange={(event) => setIncidentForm({ ...incidentForm, actionTaken: event.target.value })} maxLength="1000" /></label></div>
            <div className="form-actions"><button className={`button ${incidentForm.severity === 'emergency' ? 'button-danger' : 'button-primary'}`} disabled={state.saving}>Gửi báo cáo sự cố</button></div>
          </form>
        </div>

        <div className="guard-workspace-column">
          <article className="content-card guard-form">
            <div className="card-heading"><div><p className="card-kicker">KẾT QUẢ XỬ LÝ</p><h2>Cập nhật và bàn giao sự cố</h2></div></div>
            {incidents.filter((item) => item.status !== 'closed').map((item) => <div className="guard-resolution" key={item._id}><strong>{incidentCategory[item.category]} · {item.location}</strong><p>{item.description}</p>{item.actionTaken && <p>Đã thực hiện: {item.actionTaken}</p>}<label>Ghi chú xử lý / bàn giao<textarea maxLength={1000} value={incidentNotes[item._id] ?? item.resolutionNote ?? ''} onChange={(event) => setIncidentNotes((old) => ({ ...old, [item._id]: event.target.value }))} /></label><div className="form-actions">{item.status !== 'handed_over' && <button className="button button-secondary" disabled={state.saving} onClick={() => changeIncident(item._id, 'handed_over')}>Bàn giao quản lý</button>}{isManager && <button className="button button-primary" disabled={state.saving || (['serious', 'emergency'].includes(item.severity) && !item.acknowledgedAt)} onClick={() => changeIncident(item._id, 'closed')}>Đóng sự cố</button>}</div>{item.acknowledgedAt && <small>Quản lý {item.acknowledgedByName} đã tiếp nhận lúc {dateTimeText(item.acknowledgedAt)}</small>}</div>)}
            {!incidents.some((item) => item.status !== 'closed') && <div className="guard-empty-note spacious"><Icon name="shield" size={20} /><span><strong>Không có sự cố đang xử lý</strong><small>Các sự cố mới sẽ xuất hiện tại đây để cập nhật và bàn giao.</small></span></div>}
          </article>

          <article className="content-card">
            <div className="card-heading"><div><p className="card-kicker">THEO DÕI XỬ LÝ</p><h2>{incidents.filter((item) => item.status !== 'closed').length} sự cố chưa đóng</h2></div></div>
            <div className="guard-incident-list">{incidents.length ? incidents.map((item) => <article key={item._id} className={item.severity}><header><div><span>{incidentCategory[item.category]}</span><strong>{item.location}</strong></div><span className={`guard-severity ${item.severity}`}>{item.severity === 'normal' ? 'Thông thường' : item.severity === 'serious' ? 'Nghiêm trọng' : 'Khẩn cấp'}</span></header><p>{item.description}</p><footer><small>{dateTimeText(item.createdAt)} · {item.reportedByName}</small><span>{incidentStatus[item.status]}</span>{item.status === 'open' && <button onClick={() => changeIncident(item._id, 'in_progress')}>Nhận xử lý</button>}{['open', 'in_progress'].includes(item.status) && <button onClick={() => changeIncident(item._id, 'handed_over')}>Bàn giao quản lý</button>}</footer></article>) : <div className="empty-state compact">Chưa có sự cố được ghi nhận.</div>}</div>
          </article>
        </div>
      </section>}

      {activeTab === 'handover' && <section className="guard-workspace">
        <form className="content-card student-form guard-form" onSubmit={submitHandover}><div className="card-heading"><div><p className="card-kicker">KẾT THÚC CA TRỰC</p><h2>Lập biên bản bàn giao</h2></div></div><div className="guard-handover-snapshot"><span><small>Khách còn trong trường</small><strong>{summary.visitorsInside || 0}</strong></span><span><small>Sự cố chưa đóng</small><strong>{summary.openIncidents || 0}</strong></span></div><div className="student-form-grid"><label>Ca trực<select value={handoverForm.shiftName} onChange={(event) => setHandoverForm({ ...handoverForm, shiftName: event.target.value })}><option value="morning">Ca sáng</option><option value="afternoon">Ca chiều</option><option value="evening">Ca tối</option></select></label><label>Người nhận bàn giao<select value={handoverForm.receiverId} onChange={(event) => setHandoverForm({ ...handoverForm, receiverId: event.target.value })} required><option value="">Chọn bảo vệ hoặc quản lý</option>{receivers.map((receiver) => <option key={receiver._id} value={receiver._id}>{receiver.name} · {receiver.role === 'guard' ? 'Bảo vệ' : receiver.role === 'principal' ? 'Hiệu trưởng' : 'Admin'}</option>)}</select><small>Quản lý có thể nhận bàn giao khi chưa có bảo vệ ca sau.</small></label><label className="form-wide">Chìa khóa và thiết bị<textarea value={handoverForm.keysAndEquipment} onChange={(event) => setHandoverForm({ ...handoverForm, keysAndEquipment: event.target.value })} /></label><label className="form-wide">Ghi chú cần tiếp tục xử lý<textarea value={handoverForm.notes} onChange={(event) => setHandoverForm({ ...handoverForm, notes: event.target.value })} /></label></div><div className="form-actions"><button className="button button-primary" disabled={state.saving || !receivers.length}>Gửi bàn giao ca</button></div></form>
        <article className="content-card"><div className="card-heading"><div><p className="card-kicker">LỊCH SỬ BÀN GIAO</p><h2>{handovers.length} biên bản trong ngày</h2></div></div><div className="guard-handover-list">{handovers.length ? handovers.map((item) => <article key={item._id}><header><strong>{shiftText[item.shiftName]}</strong><span>{item.status === 'accepted' ? `Đã nhận ${dateTimeText(item.acceptedAt)}` : item.receiverId ? 'Chờ nhận ca' : 'Biên bản cũ'} · {timeText(item.handedOverAt)}</span></header><p><b>{item.handedOverByName}</b> bàn giao cho <b>{item.receiverName}</b></p><div><span>{item.visitorsRemaining} khách</span><span>{item.openIncidents} sự cố</span></div><details><summary>Chi tiết tại thời điểm bàn giao</summary><p>Chìa khóa / thiết bị: {item.keysAndEquipment || 'Chưa ghi chú'}</p>{item.visitorsSnapshot?.map((visitor) => <p key={visitor.visitorId}>Khách: {visitor.fullName} · gặp {visitor.hostName}</p>)}{item.incidentsSnapshot?.map((incident) => <p key={incident.incidentId}>Sự cố: {incident.location} · {incident.description}</p>)}</details>{item.acceptanceNote && <small>Người nhận ghi chú: {item.acceptanceNote}</small>}{item.status === 'pending' && String(item.receiverId) === String(JSON.parse(localStorage.getItem('user') || '{}')._id || JSON.parse(localStorage.getItem('user') || '{}').id) && <div className="guard-acceptance"><label>Ghi chú khi nhận ca<textarea maxLength={500} value={acceptanceNotes[item._id] || ''} onChange={(event) => setAcceptanceNotes((old) => ({ ...old, [item._id]: event.target.value }))} /></label><button className="button button-primary" disabled={state.saving} onClick={() => acceptHandover(item._id)}>Xác nhận đã nhận ca</button></div>}{item.notes && <small>{item.notes}</small>}</article>) : <div className="empty-state compact">Chưa có biên bản bàn giao trong ngày.</div>}</div></article>
      </section>}
    </>}
  </AppShell>;
}
