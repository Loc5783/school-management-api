import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import {
  listTimekeepingDevices,
  createTimekeepingDevice,
  testTimekeepingDeviceConnection,
  syncTimekeepingDevice,
  listPersonMappings,
  upsertPersonMapping,
  deletePersonMapping,
  getTimekeepingDeviceSyncLogs,
  getUnmappedDeviceEvents,
  simulateSchoolTimekeepingWebhook,
  getSchoolWebhookLogs
} from '../api/timekeeping';
import { getEmployees } from '../api/hr';
import api from '../api/axiosConfig';
import { getStoredTenant, getStoredUser } from '../utils/storage';

export default function TimekeepingDeviceManagement() {
  const [devices, setDevices] = useState([]);
  const [webhookMeta, setWebhookMeta] = useState({ schoolCode: '', endpointPath: '' });
  const [employees, setEmployees] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Modals: 'device' | 'mappings' | 'logs' | 'unmapped' | 'webhook_logs' | 'simulate_webhook' | null
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [activeModal, setActiveModal] = useState(null);

  // Mapping state
  const [mappings, setMappings] = useState([]);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [newMapping, setNewMapping] = useState({
    externalPersonId: '',
    subjectType: 'EMPLOYEE',
    subjectId: '',
    displayName: ''
  });

  // Sync logs state
  const [syncLogs, setSyncLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Unmapped events state
  const [unmappedEvents, setUnmappedEvents] = useState([]);
  const [unmappedLoading, setUnmappedLoading] = useState(false);

  // School Webhook Logs & Simulator state
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [webhookLogsLoading, setWebhookLogsLoading] = useState(false);
  const [simForm, setSimForm] = useState({
    targetMode: 'STUDENT',
    externalPersonId: '',
    personName: '',
    verifyMode: 'FACE'
  });
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState(null);

  const initialDeviceForm = {
    deviceCode: '',
    name: '',
    vendor: 'HIKVISION',
    model: 'DS-K1T320MX',
    host: '192.168.1.8',
    httpsPort: 443,
    httpPort: 80,
    protocol: 'ISAPI',
    allowSelfSigned: true
  };
  const [deviceForm, setDeviceForm] = useState(initialDeviceForm);
  const [actionLoading, setActionLoading] = useState({});

  const currentUser = getStoredUser();
  const storedTenant = getStoredTenant();
  const isAdmin = currentUser.role === 'admin';
  const canSync = ['admin', 'principal'].includes(currentUser.role);

  const resolvedSchoolCode = webhookMeta.schoolCode || storedTenant?.code || currentUser?.schoolCode || '';
  const fullWebhookUrl = resolvedSchoolCode
    ? `${window.location.origin}/api/attendance/webhook/${resolvedSchoolCode}`
    : `${window.location.origin}/api/attendance/webhook/<MA_TRUONG>`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [devRes, empRes] = await Promise.all([
        listTimekeepingDevices(),
        getEmployees().catch(() => ({ data: { data: [] } }))
      ]);
      setDevices(devRes.data.data || []);
      if (devRes.data.webhookMeta) {
        setWebhookMeta(devRes.data.webhookMeta);
      }
      setEmployees(empRes.data.data || []);

      try {
        const stuRes = await api.get('/students', { params: { limit: 500, status: 'enrolled' } });
        setStudents(stuRes.data.data || []);
      } catch {
        setStudents([]);
      }
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi khi tải danh sách thiết bị');
      setNoticeType('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (!showDeviceModal && !activeModal) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowDeviceModal(false);
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showDeviceModal, activeModal]);

  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullWebhookUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2200);
    } catch {
      // Bỏ qua nếu trình duyệt chặn clipboard
    }
  };

  const openWebhookLogsModal = async () => {
    setActiveModal('webhook_logs');
    setWebhookLogsLoading(true);
    try {
      const res = await getSchoolWebhookLogs({ page: 1, limit: 30 });
      setWebhookLogs(res.data?.data || []);
    } catch {
      setWebhookLogs([]);
    } finally {
      setWebhookLogsLoading(false);
    }
  };

  const openSimulatorModal = () => {
    const firstStu = students[0];
    const firstEmp = employees[0];
    setSimResult(null);
    setSimForm({
      targetMode: firstStu ? 'STUDENT' : 'EMPLOYEE',
      externalPersonId: firstStu?.studentCode || firstEmp?.employeeCode || '',
      personName: firstStu?.fullName || firstEmp?.fullName || '',
      verifyMode: 'FACE'
    });
    setActiveModal('simulate_webhook');
  };

  const handleRunWebhookSimulation = async (e) => {
    e.preventDefault();
    if (!simForm.externalPersonId.trim() || simulating) return;
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await simulateSchoolTimekeepingWebhook({
        externalPersonId: simForm.externalPersonId.trim(),
        personName: simForm.personName.trim(),
        verifyMode: simForm.verifyMode
      });
      setSimResult(res.data?.data || null);
      setNotice(res.data?.message || 'Đã đồng bộ sự kiện Webhook thành công!');
      setNoticeType('success');
      void loadData();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi khi gửi thử gói tin Webhook');
      setNoticeType('error');
    } finally {
      setSimulating(false);
    }
  };

  const handleTestConnection = async (device) => {
    setActionLoading((prev) => ({ ...prev, [device._id]: 'test' }));
    try {
      const res = await testTimekeepingDeviceConnection(device._id);
      if (res.data.success) {
        setNotice(`Kết nối thành công tới ${device.name}: Thiết bị ONLINE (${res.data.deviceInfo?.model || 'Hikvision'})`);
        setNoticeType('success');
      } else if (res.data.status === 'NOT_RUN_MISSING_SECRET') {
        setNotice('Chưa cấu hình thông tin kết nối trên máy chủ. Bạn vẫn có thể dùng đẩy sự kiện tự động qua URL Webhook theo mã trường ở bên trên.');
        setNoticeType('info');
      } else {
        setNotice(`Không thể kết nối tới thiết bị (${res.data.status}): ${res.data.message}`);
        setNoticeType('error');
      }
      loadData();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi kiểm tra kết nối thiết bị');
      setNoticeType('error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [device._id]: null }));
    }
  };

  const handleManualSync = async (device) => {
    if (!window.confirm(`Bạn có chắc muốn đồng bộ dữ liệu chấm công từ "${device.name}"?`)) return;
    setActionLoading((prev) => ({ ...prev, [device._id]: 'sync' }));
    try {
      const res = await syncTimekeepingDevice(device._id);
      if (res.data.success) {
        setNotice(`Đồng bộ thành công: Lấy ${res.data.eventsFetched || 0} sự kiện, Lưu ${res.data.eventsIngested || 0} mới, ${res.data.eventsDuplicate || 0} trùng.`);
        setNoticeType('success');
      } else if (res.data.status === 'NOT_RUN_MISSING_SECRET') {
        setNotice('Chưa cấu hình thông tin kết nối trên máy chủ. Hãy cấu hình máy đẩy trực tiếp vào URL Webhook của trường.');
        setNoticeType('info');
      } else {
        setNotice(`Đồng bộ thất bại: ${res.data.message}`);
        setNoticeType('error');
      }
      loadData();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi đồng bộ dữ liệu');
      setNoticeType('error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [device._id]: null }));
    }
  };

  const openMappings = async (device) => {
    setSelectedDevice(device);
    setActiveModal('mappings');
    setMappingLoading(true);
    try {
      const res = await listPersonMappings(device._id);
      setMappings(res.data.data || []);
      const firstEmpUid = employees[0]?.userId?._id || employees[0]?.userId || '';
      setNewMapping({
        externalPersonId: '',
        subjectType: 'EMPLOYEE',
        subjectId: firstEmpUid,
        displayName: ''
      });
    } catch {
      setNotice('Lỗi tải danh sách ánh xạ người');
      setNoticeType('error');
    } finally {
      setMappingLoading(false);
    }
  };

  const handleSaveMapping = async (e) => {
    e.preventDefault();
    if (!newMapping.externalPersonId || !newMapping.subjectId) {
      alert('Vui lòng nhập ID máy và chọn đối tượng');
      return;
    }
    try {
      await upsertPersonMapping(selectedDevice._id, newMapping);
      setNotice(`Đã lưu ánh xạ ID ${newMapping.externalPersonId}`);
      setNoticeType('success');
      const res = await listPersonMappings(selectedDevice._id);
      setMappings(res.data.data || []);
      setNewMapping({
        externalPersonId: '',
        subjectType: newMapping.subjectType,
        subjectId: '',
        displayName: ''
      });
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi lưu ánh xạ người');
    }
  };

  const handleDeleteMapping = async (mappingId) => {
    if (!window.confirm('Bạn có chắc muốn xóa ánh xạ này?')) return;
    try {
      await deletePersonMapping(selectedDevice._id, mappingId);
      setMappings((prev) => prev.filter((m) => m._id !== mappingId));
      setNotice('Đã xóa ánh xạ');
      setNoticeType('success');
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi xóa ánh xạ');
    }
  };

  const openLogs = async (device) => {
    setSelectedDevice(device);
    setActiveModal('logs');
    setLogsLoading(true);
    try {
      const res = await getTimekeepingDeviceSyncLogs(device._id);
      setSyncLogs(res.data.data || []);
    } catch {
      setNotice('Lỗi tải nhật ký đồng bộ');
      setNoticeType('error');
    } finally {
      setLogsLoading(false);
    }
  };

  const openUnmapped = async (device) => {
    setSelectedDevice(device);
    setActiveModal('unmapped');
    setUnmappedLoading(true);
    try {
      const res = await getUnmappedDeviceEvents(device.deviceCode);
      setUnmappedEvents(res.data.data || []);
    } catch {
      setNotice('Lỗi tải sự kiện chưa ánh xạ');
      setNoticeType('error');
    } finally {
      setUnmappedLoading(false);
    }
  };

  const handleCreateDevice = async (e) => {
    e.preventDefault();
    if (deviceForm.host.trim() === '192.168.1.22') {
      alert('CẢNH BÁO: Thiết bị 192.168.1.22 bị cấm theo quy định an toàn của dự án!');
      return;
    }
    try {
      await createTimekeepingDevice(deviceForm);
      setNotice(`Đã đăng ký máy chấm công ${deviceForm.deviceCode} thành công`);
      setNoticeType('success');
      setShowDeviceModal(false);
      setDeviceForm(initialDeviceForm);
      loadData();
    } catch (err) {
      alert(err.response?.data?.message || 'Lỗi đăng ký thiết bị');
    }
  };

  const mapQuickFromUnmapped = (event) => {
    setActiveModal('mappings');
    const firstEmpUid = employees[0]?.userId?._id || employees[0]?.userId || '';
    setNewMapping({
      externalPersonId: event.externalPersonId || '',
      subjectType: 'EMPLOYEE',
      subjectId: firstEmpUid,
      displayName: event.employeeName && event.employeeName !== 'Chưa ánh xạ' ? event.employeeName : ''
    });
  };

  return (
    <div className="timekeeping-device-management">
      {notice && (
        <div
          className={`form-notice ${noticeType === 'error' ? 'form-error' : noticeType === 'success' ? 'form-success' : 'form-info'}`}
          style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* KHỐI CẤU HÌNH ĐƯỜNG DẪN WEBHOOK ĐỒNG BỘ THEO MÃ TRƯỜNG */}
      <section
        style={{
          padding: '18px 20px',
          marginBottom: 20,
          borderRadius: 14,
          border: '1px solid #bfdbfe',
          background: 'linear-gradient(135deg, #eff6ff, #f8fafc)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px' }}>
            <p className="card-kicker" style={{ color: '#1d4ed8', marginBottom: 4 }}>
              ĐỒNG BỘ TỰ ĐỘNG QUA WEBHOOK THEO MÃ TRƯỜNG ({resolvedSchoolCode || 'TRƯỜNG HIỆN TẠI'})
            </p>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#0f172a' }}>
              Đường dẫn Webhook Máy chấm công Nhân sự & Điểm danh Học sinh
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.55 }}>
              Khai báo địa chỉ HTTP Listening / Webhook dưới đây trên máy chấm công khuôn mặt/vân tay/thẻ từ.
              Hệ thống tự động nhận diện theo đuôi <strong>/{resolvedSchoolCode || '<MÃ_TRƯỜNG>'}</strong> để đồng bộ
              đồng thời <strong>Điểm danh Học sinh</strong> (theo <code>studentCode</code> hoặc Ánh xạ ID) và <strong>Chấm công Nhân viên</strong> (theo <code>employeeCode</code> / <code>username</code>).
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canSync && (
              <button type="button" className="button button-primary" onClick={openSimulatorModal}>
                <Icon name="send" size={15} /> Gửi thử chấm công / điểm danh
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={openWebhookLogsModal}>
              <Icon name="fileText" size={15} /> Nhật ký Webhook
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            padding: '10px 14px',
            borderRadius: 10,
            background: '#ffffff',
            border: '1px solid #cbd5e1'
          }}
        >
          <Icon name="link" size={16} />
          <code style={{ flex: '1 1 280px', fontSize: 13, fontWeight: 700, color: '#1e3a8a', wordBreak: 'break-all' }}>
            POST {fullWebhookUrl}
          </code>
          <button type="button" className="button button-secondary" onClick={handleCopyWebhookUrl}>
            <Icon name="copy" size={14} /> {copiedUrl ? 'Đã sao chép URL!' : 'Sao chép URL'}
          </button>
        </div>
      </section>

      <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <p className="card-kicker">PHẦN CỨNG & TÍCH HỢP BIOMETRIC</p>
          <h2 style={{ margin: 0 }}>Máy chấm công Hikvision (ISAPI & Webhook)</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Quản lý thiết bị nhận diện khuôn mặt DS-K1T320MX, ánh xạ mã người dùng trên máy với Học sinh & Giáo viên.
          </p>
        </div>
        {isAdmin && (
          <button className="button button-primary" onClick={() => { setDeviceForm(initialDeviceForm); setShowDeviceModal(true); }}>
            <Icon name="plus" size={16} /> Thêm máy chấm công
          </button>
        )}
      </div>

      {loading ? (
        <div className="inline-loader"><span className="loading-orb" /> Đang tải danh sách thiết bị...</div>
      ) : devices.length === 0 ? (
        <div className="empty-state" style={{ padding: '36px 20px', textAlign: 'center', background: '#fcfcfc', borderRadius: 12, border: '1px dashed #cbd5e1' }}>
          <Icon name="clock" size={38} />
          <h3 style={{ margin: '12px 0 6px' }}>Chưa khai báo thiết bị LAN (Webhook vẫn hoạt động sẵn sàng)</h3>
          <p style={{ color: '#64748b', maxWidth: 520, margin: '0 auto 16px', fontSize: 13.5 }}>
            Máy chấm công từ xa có thể đẩy thẳng sự kiện về đường dẫn <strong>/api/attendance/webhook/{resolvedSchoolCode || 'MA_TRUONG'}</strong> ở trên mà không cần mở port LAN, hoặc bạn có thể thêm thiết bị nội bộ để cấu hình bảng Ánh xạ ID chi tiết.
          </p>
          <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {isAdmin && (
              <button className="button button-primary" onClick={() => setShowDeviceModal(true)}>
                <Icon name="plus" size={16} /> Đăng ký máy chấm công đầu tiên
              </button>
            )}
            {canSync && (
              <button className="button button-secondary" onClick={openSimulatorModal}>
                <Icon name="send" size={15} /> Kiểm tra đồng bộ Webhook ngay
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã & Tên máy</th>
                <th>Model & IP</th>
                <th>Giao thức</th>
                <th>Trạng thái</th>
                <th>Lần thấy cuối</th>
                <th>Chưa map</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d._id}>
                  <td>
                    <strong>{d.name}</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Mã: {d.deviceCode}</div>
                  </td>
                  <td>
                    <span>{d.model || 'DS-K1T320MX'}</span>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{d.host}:{d.httpsPort || 443}</div>
                    <div style={{ marginTop: 2 }}>
                      {d.credentialConfigured ? (
                        <span style={{ fontSize: 11, color: '#16a34a' }}>● Đã cấu hình ISAPI LAN</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#2563eb' }}>● Đồng bộ qua Webhook /{resolvedSchoolCode}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info">{d.protocol || 'ISAPI'}</span>
                  </td>
                  <td>
                    {d.status === 'ONLINE' ? (
                      <span className="student-status enrolled">Online</span>
                    ) : d.status === 'AUTH_FAILED' ? (
                      <span className="student-status withdrawn">Lỗi xác thực</span>
                    ) : (
                      <span className="student-status temporarily_absent">Chờ tín hiệu</span>
                    )}
                  </td>
                  <td>
                    <small>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('vi-VN') : 'Chưa ghi nhận'}</small>
                  </td>
                  <td>
                    {d.unmappedCount > 0 ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        style={{ padding: '4px 10px', fontSize: 12, color: '#b45309', borderColor: '#fcd34d', background: '#fffbeb' }}
                        onClick={() => openUnmapped(d)}
                      >
                        {d.unmappedCount} sự kiện
                      </button>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>0</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {isAdmin && (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={actionLoading[d._id] === 'test'}
                          onClick={() => handleTestConnection(d)}
                        >
                          <Icon name="refresh" size={14} />
                          {actionLoading[d._id] === 'test' ? 'Đang test...' : 'Test LAN'}
                        </button>
                      )}
                      {canSync && (
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={actionLoading[d._id] === 'sync'}
                          onClick={() => handleManualSync(d)}
                        >
                          <Icon name="cloud" size={14} />
                          {actionLoading[d._id] === 'sync' ? 'Đang sync...' : 'Đồng bộ'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => openMappings(d)}
                      >
                        <Icon name="users" size={14} /> Ánh xạ HS/NV
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => openLogs(d)}
                      >
                        <Icon name="clock" size={14} /> Nhật ký
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: GIẢ LẬP KIỂM TRA ĐỒNG BỘ WEBHOOK CHẤM CÔNG & ĐIỂM DANH HỌC SINH */}
      {activeModal === 'simulate_webhook' && createPortal(
        <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(640px, 96vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleRunWebhookSimulation}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">KIỂM TRA ĐỒNG BỘ THỰC TẾ QUA WEBHOOK</p>
                <h2>Giả lập quẹt Khuôn mặt / Thẻ từ ({resolvedSchoolCode})</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#475569', lineHeight: 1.55 }}>
              Hệ thống sẽ gửi một gói tin chuẩn máy chấm công vào đúng endpoint <code>/api/attendance/webhook/{resolvedSchoolCode}</code> để xác minh tự động ghi nhận vào bảng <strong>Điểm danh Học sinh</strong> hoặc <strong>Chấm công Nhân viên</strong>.
            </p>

            <div className="student-form-grid">
              <label>
                Đối tượng kiểm tra đồng bộ
                <select
                  value={simForm.targetMode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === 'STUDENT' && students[0]) {
                      setSimForm({
                        ...simForm,
                        targetMode: mode,
                        externalPersonId: students[0].studentCode || '',
                        personName: students[0].fullName || ''
                      });
                    } else if (mode === 'EMPLOYEE' && employees[0]) {
                      setSimForm({
                        ...simForm,
                        targetMode: mode,
                        externalPersonId: employees[0].employeeCode || '',
                        personName: employees[0].fullName || ''
                      });
                    } else {
                      setSimForm({ ...simForm, targetMode: mode, externalPersonId: '', personName: '' });
                    }
                  }}
                >
                  <option value="STUDENT">Điểm danh Học sinh (theo Mã học sinh)</option>
                  <option value="EMPLOYEE">Chấm công Nhân viên / Giáo viên (theo Mã NV)</option>
                  <option value="CUSTOM">Nhập mã ID bất kỳ trên máy chấm công</option>
                </select>
              </label>

              <label>
                Phương thức xác thực trên máy
                <select
                  value={simForm.verifyMode}
                  onChange={(e) => setSimForm({ ...simForm, verifyMode: e.target.value })}
                >
                  <option value="FACE">Nhận diện Khuôn mặt (FACE)</option>
                  <option value="CARD">Thẻ từ (CARD)</option>
                  <option value="FINGERPRINT">Vân tay (FINGERPRINT)</option>
                </select>
              </label>

              {simForm.targetMode === 'STUDENT' && students.length > 0 && (
                <label className="form-wide">
                  Chọn nhanh Học sinh đang theo học tại trường
                  <select
                    value={simForm.externalPersonId}
                    onChange={(e) => {
                      const found = students.find((s) => s.studentCode === e.target.value);
                      setSimForm({
                        ...simForm,
                        externalPersonId: e.target.value,
                        personName: found?.fullName || ''
                      });
                    }}
                  >
                    {students.map((s) => (
                      <option key={s._id} value={s.studentCode}>
                        {s.studentCode} — {s.fullName} ({s.className || 'Chưa xếp lớp'})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {simForm.targetMode === 'EMPLOYEE' && employees.length > 0 && (
                <label className="form-wide">
                  Chọn nhanh Cán bộ / Giáo viên / Nhân viên trong trường
                  <select
                    value={simForm.externalPersonId}
                    onChange={(e) => {
                      const found = employees.find((emp) => emp.employeeCode === e.target.value);
                      setSimForm({
                        ...simForm,
                        externalPersonId: e.target.value,
                        personName: found?.fullName || ''
                      });
                    }}
                  >
                    {employees.map((emp) => (
                      <option key={emp._id} value={emp.employeeCode}>
                        {emp.employeeCode} — {emp.fullName} ({emp.position || 'Nhân sự'})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                Mã gửi từ máy (employeeNo / studentCode) *
                <input
                  required
                  value={simForm.externalPersonId}
                  onChange={(e) => setSimForm({ ...simForm, externalPersonId: e.target.value })}
                  placeholder="VD: HS-2026-000001 hoặc EMP-0001"
                />
              </label>

              <label>
                Tên hiển thị trên thiết bị
                <input
                  value={simForm.personName}
                  onChange={(e) => setSimForm({ ...simForm, personName: e.target.value })}
                  placeholder="Tự động điền hoặc để trống"
                />
              </label>
            </div>

            {simResult && (
              <div
                style={{
                  marginTop: 16,
                  padding: '12px 16px',
                  borderRadius: 12,
                  border: '1px solid #86efac',
                  background: '#f0fdf4',
                  fontSize: 13,
                  color: '#14532d'
                }}
              >
                <strong>✓ Kết quả xử lý tại {simResult.endpointPath}:</strong>
                <div style={{ marginTop: 4 }}>{simResult.processingNote}</div>
              </div>
            )}

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>
                Đóng
              </button>
              <button type="submit" className="button button-primary" disabled={simulating}>
                <Icon name="send" size={15} /> {simulating ? 'Đang gửi gói tin...' : 'Gửi sự kiện Webhook ngay'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* MODAL 2: XEM NHẬT KÝ GÓI TIN WEBHOOK CỦA TRƯỜNG */}
      {activeModal === 'webhook_logs' && createPortal(
        <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <div
            className="account-modal-card"
            style={{ width: 'min(900px, 96vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">NHẬT KÝ TÍN HIỆU TỪ MÁY CHẤM CÔNG</p>
                <h2>Lịch sử đồng bộ Webhook trường {resolvedSchoolCode}</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            {webhookLogsLoading ? (
              <div className="inline-loader">Đang tải nhật ký gói tin Webhook...</div>
            ) : webhookLogs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b' }}>
                Chưa có gói tin Webhook nào được gửi về mã trường {resolvedSchoolCode}.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Thiết bị</th>
                      <th>Mã người quẹt</th>
                      <th>Xác thực</th>
                      <th>Trạng thái</th>
                      <th>Kết quả đồng bộ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookLogs.map((item) => (
                      <tr key={item._id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{new Date(item.createdAt).toLocaleString('vi-VN')}</td>
                        <td><strong>{item.deviceCode || 'WEBHOOK'}</strong></td>
                        <td>
                          <strong>{item.hikvisionSummary?.employeeNoString || '—'}</strong>
                          {item.hikvisionSummary?.personName && (
                            <small>{item.hikvisionSummary.personName}</small>
                          )}
                        </td>
                        <td>{item.hikvisionSummary?.currentVerifyMode || 'FACE'}</td>
                        <td>
                          <span className={`student-status ${item.processingStatus === 'PROCESSED' ? 'enrolled' : 'temporarily_absent'}`}>
                            {item.processingStatus}
                          </span>
                        </td>
                        <td style={{ fontSize: 12.5 }}>{item.processingNote || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={openWebhookLogsModal}>
                <Icon name="refresh" size={14} /> Làm mới
              </button>
              <button type="button" className="button button-primary" onClick={() => setActiveModal(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 3: ĐĂNG KÝ THIẾT BỊ MỚI */}
      {showDeviceModal && createPortal(
        <div className="account-modal-backdrop" onClick={() => setShowDeviceModal(false)} role="presentation">
          <form
            className="account-modal-card student-form"
            style={{ width: 'min(620px, 96vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateDevice}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">THIẾT BỊ MỚI</p>
                <h2>Đăng ký máy chấm công của trường</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setShowDeviceModal(false)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            <div style={{ background: '#eff6ff', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, color: '#1e3a8a' }}>
              <strong>Mẹo triển khai nhanh:</strong> Sau khi tạo thiết bị, bạn có thể ánh xạ ID trên máy chấm công với từng Học sinh hoặc Giáo viên, và trỏ máy đẩy sự kiện về <code>/api/attendance/webhook/{resolvedSchoolCode}</code>.
            </div>

            <div className="student-form-grid">
              <label>
                Mã thiết bị (duy nhất trong trường) *
                <input
                  value={deviceForm.deviceCode}
                  onChange={(e) => setDeviceForm({ ...deviceForm, deviceCode: e.target.value.toUpperCase() })}
                  placeholder="VD: HIK-GATE-A1"
                  required
                />
              </label>

              <label>
                Tên vị trí lắp đặt *
                <input
                  value={deviceForm.name}
                  onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                  placeholder="VD: Cổng chính đón trả trẻ"
                  required
                />
              </label>

              <label>
                Hãng sản xuất
                <input value="HIKVISION" readOnly />
              </label>

              <label>
                Model thiết bị
                <input
                  value={deviceForm.model}
                  onChange={(e) => setDeviceForm({ ...deviceForm, model: e.target.value })}
                  placeholder="DS-K1T320MX"
                  required
                />
              </label>

              <label>
                Địa chỉ IP nội bộ (Host) *
                <input
                  value={deviceForm.host}
                  onChange={(e) => setDeviceForm({ ...deviceForm, host: e.target.value.trim() })}
                  placeholder="192.168.1.8"
                  required
                />
              </label>

              <label>
                Cổng HTTPS
                <input
                  type="number"
                  value={deviceForm.httpsPort}
                  onChange={(e) => setDeviceForm({ ...deviceForm, httpsPort: Number(e.target.value) })}
                />
              </label>
            </div>

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowDeviceModal(false)}>Hủy</button>
              <button type="submit" className="button button-primary">Đăng ký thiết bị</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* MODAL 4: QUẢN LÝ ÁNH XẠ NGƯỜI (NHÂN SỰ & HỌC SINH) */}
      {activeModal === 'mappings' && selectedDevice && createPortal(
        <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <div
            className="account-modal-card"
            style={{ width: 'min(820px, 96vw)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">ÁNH XẠ SINH TRẮC HỌC HỌC SINH & NHÂN SỰ</p>
                <h2>Ánh xạ ID trên máy: {selectedDevice.name} ({selectedDevice.deviceCode})</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            {isAdmin && (
              <form className="student-form" onSubmit={handleSaveMapping} style={{ background: '#f8fafc', padding: 16, borderRadius: 12, marginBottom: 18, border: '1px solid #e2e8f0' }}>
                <div className="student-form-grid">
                  <label>
                    ID người dùng trên máy chấm công *
                    <input
                      value={newMapping.externalPersonId}
                      onChange={(e) => setNewMapping({ ...newMapping, externalPersonId: e.target.value.trim() })}
                      placeholder="VD: 101 hoặc HS01"
                      required
                    />
                  </label>

                  <label>
                    Phân loại đối tượng
                    <select
                      value={newMapping.subjectType}
                      onChange={(e) => setNewMapping({
                        ...newMapping,
                        subjectType: e.target.value,
                        subjectId: e.target.value === 'EMPLOYEE' ? (employees[0]?.userId?._id || employees[0]?.userId || '') : (students[0]?._id || '')
                      })}
                    >
                      <option value="EMPLOYEE">Nhân viên / Giáo viên / Đầu bếp</option>
                      <option value="STUDENT">Học sinh</option>
                    </select>
                  </label>

                  <label className="form-wide">
                    {newMapping.subjectType === 'EMPLOYEE' ? 'Chọn hồ sơ Nhân sự *' : 'Chọn hồ sơ Học sinh *'}
                    {newMapping.subjectType === 'EMPLOYEE' ? (
                      <select
                        value={newMapping.subjectId}
                        onChange={(e) => setNewMapping({ ...newMapping, subjectId: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn nhân viên --</option>
                        {employees.map((emp) => {
                          const empUid = emp.userId?._id || emp.userId || '';
                          return (
                            <option key={emp._id} value={empUid} disabled={!empUid}>
                              {emp.fullName} ({emp.employeeCode}) - {emp.position}{!empUid ? ' (Chưa cấp tài khoản)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <select
                        value={newMapping.subjectId}
                        onChange={(e) => setNewMapping({ ...newMapping, subjectId: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn học sinh --</option>
                        {students.map((stu) => (
                          <option key={stu._id} value={stu._id}>
                            {stu.fullName} ({stu.studentCode}) - {stu.className || 'Chưa xếp lớp'}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="submit" className="button button-primary">
                    <Icon name="plus" size={14} /> Lưu ánh xạ ID
                  </button>
                </div>
              </form>
            )}

            {mappingLoading ? (
              <div className="inline-loader">Đang tải danh sách ánh xạ...</div>
            ) : mappings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b' }}>
                Chưa có ánh xạ thủ công nào (Hệ thống vẫn tự động khớp nếu ID máy trùng với Mã học sinh hoặc Mã nhân viên).
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID trên máy</th>
                      <th>Đối tượng</th>
                      <th>Hồ sơ hệ thống</th>
                      <th>Khớp gần nhất</th>
                      {isAdmin && <th style={{ textAlign: 'right' }}>Xóa</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m._id}>
                        <td><strong>{m.externalPersonId}</strong></td>
                        <td>
                          <span className={`student-status ${m.subjectType === 'STUDENT' ? 'enrolled' : 'temporarily_absent'}`}>
                            {m.subjectType === 'EMPLOYEE' ? 'Nhân sự' : 'Học sinh'}
                          </span>
                        </td>
                        <td>
                          {m.subjectType === 'EMPLOYEE' ? (
                            <div>
                              <strong>{m.userId?.profile?.fullName || m.metadata?.displayName || m.userId?.username || 'Nhân viên'}</strong>
                              <small>@{m.userId?.username} · {m.userId?.role}</small>
                            </div>
                          ) : (
                            <div>
                              <strong>{m.studentId?.fullName || m.metadata?.displayName || 'Học sinh'}</strong>
                              <small>{m.studentId?.studentCode} · {m.studentId?.className}</small>
                            </div>
                          )}
                        </td>
                        <td>
                          <small>{m.lastMatchedAt ? new Date(m.lastMatchedAt).toLocaleString('vi-VN') : 'Chưa có lượt quẹt'}</small>
                        </td>
                        {isAdmin && (
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="button button-danger"
                              onClick={() => handleDeleteMapping(m._id)}
                            >
                              <Icon name="trash" size={14} /> Xóa
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 5: SỰ KIỆN CHƯA ÁNH XẠ */}
      {activeModal === 'unmapped' && selectedDevice && createPortal(
        <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <div className="account-modal-card" style={{ width: 'min(740px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">HÀNG ĐỢI XỬ LÝ</p>
                <h2>Sự kiện chưa ánh xạ ({unmappedEvents.length})</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            {unmappedLoading ? (
              <div className="inline-loader">Đang tải...</div>
            ) : unmappedEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                Không có sự kiện chưa ánh xạ nào cần xử lý.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID máy</th>
                      <th>Thời gian quẹt</th>
                      <th>Phương thức</th>
                      <th>Tên trên máy</th>
                      {isAdmin && <th style={{ textAlign: 'right' }}>Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {unmappedEvents.map((ev) => (
                      <tr key={ev._id}>
                        <td><strong>{ev.externalPersonId || 'Không rõ'}</strong></td>
                        <td>{new Date(ev.occurredAt).toLocaleString('vi-VN')}</td>
                        <td>{ev.authenticationMethod || 'FACE'}</td>
                        <td>{ev.employeeName || '—'}</td>
                        {isAdmin && (
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="button button-primary" onClick={() => mapQuickFromUnmapped(ev)}>
                              Ánh xạ ngay
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 6: NHẬT KÝ ĐỒNG BỘ ISAPI */}
      {activeModal === 'logs' && selectedDevice && createPortal(
        <div className="account-modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <div className="account-modal-card" style={{ width: 'min(760px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">NHẬT KÝ ĐỒNG BỘ THIẾT BỊ</p>
                <h2>Lịch sử đồng bộ: {selectedDevice.name}</h2>
              </div>
              <button type="button" className="button button-secondary modal-close-btn" onClick={() => setActiveModal(null)}>
                <Icon name="close" size={18} />
              </button>
            </div>

            {logsLoading ? (
              <div className="inline-loader">Đang tải nhật ký...</div>
            ) : syncLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>
                Chưa có bản ghi đồng bộ kéo (pull) nào cho thiết bị này.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Trạng thái</th>
                      <th>Đã lấy</th>
                      <th>Lưu mới</th>
                      <th>Trùng</th>
                      <th>Chưa map</th>
                      <th>Ghi chú / Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLogs.map((log) => (
                      <tr key={log._id}>
                        <td>{new Date(log.startedAt).toLocaleString('vi-VN')}</td>
                        <td>{log.status}</td>
                        <td>{log.eventsFetched}</td>
                        <td><strong style={{ color: '#16a34a' }}>+{log.eventsIngested}</strong></td>
                        <td>{log.eventsDuplicate}</td>
                        <td>{log.eventsUnmapped}</td>
                        <td style={{ color: '#dc2626', fontSize: 12 }}>{log.errorMessage || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="account-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
