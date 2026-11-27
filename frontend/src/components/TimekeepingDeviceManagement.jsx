import { useState, useEffect, useCallback } from 'react';
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
  getUnmappedDeviceEvents
} from '../api/timekeeping';
import { getEmployees } from '../api/hr';
import api from '../api/axiosConfig';
import { getStoredUser } from '../utils/storage';

export default function TimekeepingDeviceManagement() {
  const [devices, setDevices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('info'); // info, success, error

  // Modals
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [activeModal, setActiveModal] = useState(null); // 'mappings' | 'logs' | 'unmapped' | null

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

  // Device Form state
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
  const isAdmin = currentUser.role === 'admin';
  const canSync = ['admin', 'principal'].includes(currentUser.role);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [devRes, empRes] = await Promise.all([
        listTimekeepingDevices(),
        getEmployees().catch(() => ({ data: { data: [] } }))
      ]);
      setDevices(devRes.data.data || []);
      setEmployees(empRes.data.data || []);

      // Also try fetching students for mapping
      try {
        const stuRes = await api.get('/students');
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

  const handleTestConnection = async (device) => {
    setActionLoading((prev) => ({ ...prev, [device._id]: 'test' }));
    try {
      const res = await testTimekeepingDeviceConnection(device._id);
      if (res.data.success) {
        setNotice(`Kết nối thành công tới ${device.name}: Thiết bị ONLINE (${res.data.deviceInfo?.model || 'Hikvision'})`);
        setNoticeType('success');
      } else if (res.data.status === 'NOT_RUN_MISSING_SECRET') {
        setNotice('Chưa cấu hình thông tin kết nối trên máy chủ. Vui lòng cấu hình file .env.');
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
        setNotice('Chưa cấu hình thông tin kết nối trên máy chủ. Chưa thực hiện đồng bộ.');
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
      // Reload mappings
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
        <div className={`form-notice ${noticeType === 'error' ? 'form-error' : noticeType === 'success' ? 'form-success' : 'form-info'}`} style={{ marginBottom: 16 }}>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 12 }}>✕</button>
        </div>
      )}

      <div className="card-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <p className="card-kicker">PHẦN CỨNG & TÍCH HỢP BIOMETRIC</p>
          <h2 style={{ margin: 0 }}>Máy chấm công Hikvision (ISAPI)</h2>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
            Tích hợp nhận diện khuôn mặt DS-K1T320MX, xác thực Digest Auth 2 bước và đồng bộ tự động theo trường.
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
        <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center', background: '#fcfcfc', borderRadius: 8, border: '1px dashed #ddd' }}>
          <Icon name="clock" size={40} />
          <h3 style={{ margin: '12px 0 4px' }}>Chưa có máy chấm công nào được kết nối</h3>
          <p style={{ color: '#666', maxWidth: 450, margin: '0 auto 16px' }}>
            Đăng ký máy chấm công Hikvision DS-K1T320MX của trường để tự động ghi nhận lượt quẹt khuôn mặt của giáo viên và học sinh.
          </p>
          {isAdmin && (
            <button className="button button-primary" onClick={() => setShowDeviceModal(true)}>
              <Icon name="plus" size={16} /> Đăng ký máy chấm công đầu tiên
            </button>
          )}
        </div>
      ) : (
        <div className="table-responsive">
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
                    <div style={{ fontSize: 12, color: '#666' }}>Mã: {d.deviceCode}</div>
                  </td>
                  <td>
                    <span>{d.model || 'DS-K1T320MX'}</span>
                    <div style={{ fontSize: 12, color: '#666' }}>{d.host}:{d.httpsPort || 443}</div>
                    <div style={{ marginTop: 2 }}>
                      {d.credentialConfigured ? (
                        <span style={{ fontSize: 11, color: '#16a34a' }}>● Đã cấu hình thông tin kết nối</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#ca8a04' }}>○ Chưa cấu hình thông tin kết nối trên máy chủ</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info">{d.protocol || 'ISAPI'}</span>
                  </td>
                  <td>
                    {d.status === 'ONLINE' ? (
                      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} /> Online
                      </span>
                    ) : d.status === 'AUTH_FAILED' ? (
                      <span className="badge badge-warning">Lỗi xác thực</span>
                    ) : (
                      <span className="badge badge-secondary">Offline / Chưa test</span>
                    )}
                  </td>
                  <td>
                    <small>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('vi-VN') : 'Chưa ghi nhận'}</small>
                  </td>
                  <td>
                    {d.unmappedCount > 0 ? (
                      <button
                        type="button"
                        className="badge badge-warning"
                        style={{ cursor: 'pointer', border: 'none' }}
                        onClick={() => openUnmapped(d)}
                        title="Bấm để xem sự kiện chưa ánh xạ"
                      >
                        {d.unmappedCount} sự kiện
                      </button>
                    ) : (
                      <span style={{ color: '#999', fontSize: 13 }}>0</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {isAdmin && (
                        <button
                          type="button"
                          className="button button-secondary button-sm"
                          disabled={actionLoading[d._id] === 'test'}
                          onClick={() => handleTestConnection(d)}
                          title="Kiểm tra kết nối tới máy"
                        >
                          <Icon name="refresh" size={14} />
                          {actionLoading[d._id] === 'test' ? 'Đang test...' : 'Test'}
                        </button>
                      )}
                      {canSync && (
                        <button
                          type="button"
                          className="button button-primary button-sm"
                          disabled={actionLoading[d._id] === 'sync'}
                          onClick={() => handleManualSync(d)}
                          title="Đồng bộ sự kiện mới từ máy chấm công"
                        >
                          <Icon name="cloud" size={14} />
                          {actionLoading[d._id] === 'sync' ? 'Đang sync...' : 'Đồng bộ'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-secondary button-sm"
                        onClick={() => openMappings(d)}
                        title="Quản lý ánh xạ ID máy với nhân viên/học sinh"
                      >
                        <Icon name="users" size={14} /> Ánh xạ
                      </button>
                      <button
                        type="button"
                        className="button button-secondary button-sm"
                        onClick={() => openLogs(d)}
                        title="Xem lịch sử đồng bộ"
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

      {/* Modal: Thêm / Sửa Thiết bị */}
      {showDeviceModal && (
        <div className="modal-backdrop">
          <form className="content-card student-form hr-modal" onSubmit={handleCreateDevice} style={{ maxWidth: 540 }}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">THIẾT BỊ MỚI</p>
                <h2>Đăng ký máy chấm công</h2>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setShowDeviceModal(false)}>Đóng</button>
            </div>

            <div style={{ background: '#eef2ff', padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
              <strong>Lưu ý bảo mật:</strong> Chỉ hỗ trợ địa chỉ IP nội bộ LAN. Thiết bị DS-K1T320MX sử dụng giao thức ISAPI Digest Auth. Tuyệt đối không nhập địa chỉ ngoài phạm vi mạng trường.
            </div>

            <div className="student-form-grid">
              <label>
                Mã thiết bị (duy nhất trong trường)*
                <input
                  value={deviceForm.deviceCode}
                  onChange={(e) => setDeviceForm({ ...deviceForm, deviceCode: e.target.value.toUpperCase() })}
                  placeholder="VD: HIK-GATE-A1"
                  required
                />
              </label>

              <label>
                Tên vị trí lắp đặt*
                <input
                  value={deviceForm.name}
                  onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })}
                  placeholder="VD: Cổng chính mầm non Hoa Nắng"
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

              <label className="form-wide">
                Địa chỉ IP nội bộ (Host)*
                <input
                  value={deviceForm.host}
                  onChange={(e) => setDeviceForm({ ...deviceForm, host: e.target.value.trim() })}
                  placeholder="192.168.1.8"
                  required
                />
                <small style={{ color: '#b91c1c' }}>* Cấm truy cập IP 192.168.1.22</small>
              </label>

              <label>
                Cổng HTTPS
                <input
                  type="number"
                  value={deviceForm.httpsPort}
                  onChange={(e) => setDeviceForm({ ...deviceForm, httpsPort: Number(e.target.value) })}
                />
              </label>

              <div style={{ gridColumn: 'span 2', background: '#f8fafc', padding: '10px 12px', borderRadius: 6, fontSize: 12, color: '#64748b' }}>
                <Icon name="info" size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Thông tin xác thực (Username / Password) được hệ thống bảo mật tự động liên kết theo trường trên máy chủ (.env).
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="button button-secondary" onClick={() => setShowDeviceModal(false)}>Hủy</button>
              <button type="submit" className="button button-primary">Đăng ký thiết bị</button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Quản lý Ánh Xạ Người (Person Mappings) */}
      {activeModal === 'mappings' && selectedDevice && (
        <div className="modal-backdrop">
          <div className="content-card hr-modal" style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">ÁNH XẠ SINH TRẮC HỌC</p>
                <h2>Ánh xạ ID máy: {selectedDevice.name}</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                  Gán mã nhân viên trên máy chấm công ({selectedDevice.deviceCode}) với hồ sơ nhân sự hoặc học sinh.
                </p>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>

            {isAdmin && (
              <form onSubmit={handleSaveMapping} style={{ background: '#f8fafc', padding: 16, borderRadius: 8, marginBottom: 20 }}>
                <h4 style={{ margin: '0 0 12px' }}>Thêm / Cập nhật ánh xạ mới</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 10, alignItems: 'flex-end' }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>ID trên máy chấm công*</label>
                    <input
                      value={newMapping.externalPersonId}
                      onChange={(e) => setNewMapping({ ...newMapping, externalPersonId: e.target.value.trim() })}
                      placeholder="VD: 1 hoặc LOC01"
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Loại đối tượng</label>
                    <select
                      value={newMapping.subjectType}
                      onChange={(e) => setNewMapping({
                        ...newMapping,
                        subjectType: e.target.value,
                        subjectId: e.target.value === 'EMPLOYEE' ? (employees[0]?.userId?._id || employees[0]?.userId || '') : (students[0]?._id || '')
                      })}
                      style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc' }}
                    >
                      <option value="EMPLOYEE">Nhân viên / Giáo viên</option>
                      <option value="STUDENT">Học sinh</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      {newMapping.subjectType === 'EMPLOYEE' ? 'Chọn nhân sự*' : 'Chọn học sinh*'}
                    </label>
                    {newMapping.subjectType === 'EMPLOYEE' ? (
                      <select
                        value={newMapping.subjectId}
                        onChange={(e) => setNewMapping({ ...newMapping, subjectId: e.target.value })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc' }}
                        required
                      >
                        <option value="">-- Chọn nhân viên --</option>
                        {employees.map((emp) => {
                          const empUid = emp.userId?._id || emp.userId || '';
                          return (
                            <option key={emp._id} value={empUid} disabled={!empUid}>
                              {emp.fullName} ({emp.employeeCode}) - {emp.position}{!empUid ? ' (Chưa tạo tài khoản)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <select
                        value={newMapping.subjectId}
                        onChange={(e) => setNewMapping({ ...newMapping, subjectId: e.target.value })}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid #ccc' }}
                        required
                      >
                        <option value="">-- Chọn học sinh --</option>
                        {students.map((stu) => (
                          <option key={stu._id} value={stu._id}>
                            {stu.fullName} ({stu.studentCode}) - {stu.className || ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <button type="submit" className="button button-primary" style={{ height: 34 }}>
                    <Icon name="plus" size={14} /> Lưu ánh xạ
                  </button>
                </div>
              </form>
            )}

            {mappingLoading ? (
              <div className="inline-loader"><span className="loading-orb" /> Đang tải danh sách ánh xạ...</div>
            ) : mappings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#666' }}>
                Chưa có cấu hình ánh xạ nào cho thiết bị này.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID máy (ISAPI)</th>
                    <th>Loại</th>
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
                        <span className={`badge ${m.subjectType === 'EMPLOYEE' ? 'badge-info' : 'badge-success'}`}>
                          {m.subjectType === 'EMPLOYEE' ? 'Nhân sự' : 'Học sinh'}
                        </span>
                      </td>
                      <td>
                        {m.subjectType === 'EMPLOYEE' ? (
                          <div>
                            <strong>{m.userId?.profile?.fullName || m.metadata?.displayName || m.userId?.username || 'Nhân viên'}</strong>
                            <div style={{ fontSize: 12, color: '#666' }}>@{m.userId?.username} · {m.userId?.role}</div>
                          </div>
                        ) : (
                          <div>
                            <strong>{m.studentId?.fullName || m.metadata?.displayName || 'Học sinh'}</strong>
                            <div style={{ fontSize: 12, color: '#666' }}>{m.studentId?.studentCode} · {m.studentId?.className}</div>
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
                            className="button button-secondary button-sm"
                            onClick={() => handleDeleteMapping(m._id)}
                            style={{ color: '#dc2626' }}
                          >
                            <Icon name="trash" size={14} /> Xóa
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal: Sự kiện chưa ánh xạ (Unmapped Events) */}
      {activeModal === 'unmapped' && selectedDevice && (
        <div className="modal-backdrop">
          <div className="content-card hr-modal" style={{ maxWidth: 680, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">HÀNG ĐỢI XỬ LÝ</p>
                <h2>Sự kiện chưa ánh xạ ({unmappedEvents.length})</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                  Thiết bị: {selectedDevice.name} ({selectedDevice.deviceCode})
                </p>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>

            {unmappedLoading ? (
              <div className="inline-loader"><span className="loading-orb" /> Đang tải...</div>
            ) : unmappedEvents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#666' }}>
                Không có sự kiện chưa ánh xạ nào cần xử lý.
              </div>
            ) : (
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
                      <td>
                        <span className="badge badge-info">{ev.authenticationMethod || 'FACE'}</span>
                      </td>
                      <td>{ev.employeeName || '—'}</td>
                      {isAdmin && (
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="button button-primary button-sm"
                            onClick={() => mapQuickFromUnmapped(ev)}
                          >
                            Ánh xạ ngay
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal: Nhật ký đồng bộ (Sync Logs) */}
      {activeModal === 'logs' && selectedDevice && (
        <div className="modal-backdrop">
          <div className="content-card hr-modal" style={{ maxWidth: 740, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">NHẬT KÝ ĐỒNG BỘ</p>
                <h2>Lịch sử đồng bộ: {selectedDevice.name}</h2>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setActiveModal(null)}>Đóng</button>
            </div>

            {logsLoading ? (
              <div className="inline-loader"><span className="loading-orb" /> Đang tải nhật ký...</div>
            ) : syncLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#666' }}>
                Chưa có bản ghi đồng bộ nào cho thiết bị này.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Trạng thái</th>
                    <th>Đã lấy</th>
                    <th>Lưu mới</th>
                    <th>Trùng</th>
                    <th>Chưa map</th>
                    <th>Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log) => (
                    <tr key={log._id}>
                      <td>
                        <div>{new Date(log.startedAt).toLocaleString('vi-VN')}</div>
                        <small style={{ color: '#666' }}>{log.triggeredBy || 'MANUAL'}</small>
                      </td>
                      <td>
                        <span className={`badge ${log.status === 'SUCCESS' ? 'badge-success' : log.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td>{log.eventsFetched}</td>
                      <td><strong style={{ color: '#16a34a' }}>+{log.eventsIngested}</strong></td>
                      <td>{log.eventsDuplicate}</td>
                      <td>{log.eventsUnmapped}</td>
                      <td style={{ color: '#dc2626', fontSize: 12, maxWidth: 180 }}>
                        {log.errorMessage || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
