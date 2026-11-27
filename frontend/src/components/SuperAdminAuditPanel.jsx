import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import {
  changeSuperAdminPassword,
  getSuperAdminAuditLogs,
  getSuperAdminSchoolLogs
} from '../api/multiSchool';

const PLATFORM_ACTION_LABELS = {
  CREATE_SCHOOL_WITH_ADMIN: 'Khởi tạo trường học mới & Account Admin riêng',
  UPDATE_SCHOOL_CONFIG: 'Cập nhật cấu hình / Phân hệ / Mật khẩu trường',
  ENTER_SCHOOL_WORKSPACE: 'Truy cập hỗ trợ kỹ thuật không gian trường',
  UPDATE_GLOBAL_SYSTEM_SETTINGS: 'Cập nhật Cấu hình Nền tảng SaaS',
  DISPATCH_SCHOOL_NOTIFICATION: 'Gửi thông báo hệ thống tới trường',
  UPDATE_SUPERADMIN_CREDENTIALS: 'Đổi thông tin bảo mật SuperAdmin',
  CREATE_TENANT: 'Tạo đơn vị trường (API Platform)',
  UPDATE_TENANT_STATUS: 'Đổi trạng thái cấp phép trường'
};

const SCHOOL_ACTION_LABELS = {
  SCHOOL_SYSTEM_SETTINGS_UPDATED: 'Cập nhật Cài đặt Hệ thống Trường & Phân hiệu',
  CAMPUS_CONFIG_UPDATED: 'Cập nhật Cấu hình Cơ sở / Phân hiệu',
  INTERNAL_ACCOUNT_CREATED: 'Tạo tài khoản nhân sự nội bộ (Giám đốc/GV/Bếp...)',
  INTERNAL_ACCOUNT_UPDATED: 'Cập nhật tài khoản nhân sự nội bộ',
  INTERNAL_ACCOUNT_ROLE_CHANGED: 'Đổi vai trò tài khoản nội bộ',
  INTERNAL_ACCOUNT_DEACTIVATED: 'Thu hồi tài khoản nhân sự',
  PARENT_ACCOUNT_CREATED: 'Kích hoạt tài khoản Phụ huynh',
  PARENT_STUDENTS_LINKED: 'Liên kết con cho Phụ huynh',
  EMPLOYEE_CREATED: 'Tạo hồ sơ nhân sự mới',
  EMPLOYEE_UPDATED: 'Cập nhật hồ sơ nhân sự',
  CLASSROOM_STAFF_ASSIGNED: 'Phân công giáo viên phụ trách lớp',
  STUDENT_CREATED: 'Tiếp nhận hồ sơ học sinh mới',
  STUDENT_UPDATED: 'Cập nhật hồ sơ học sinh',
  STUDENT_STATUS_CHANGED: 'Đổi trạng thái theo học của học sinh',
  TUITION_INVOICE_IMPORTED: 'Import / Phát hành hóa đơn học phí',
  FEE_SCHEDULE_IMPORTED: 'Cập nhật biểu phí năm học',
  RAW_ATTENDANCE_INGESTED: 'Tiếp nhận quẹt máy chấm công / điểm danh',
  ATTENDANCE_RECALCULATED: 'Tính công tự động trong ngày',
  MANUAL_CHECK_IN: 'Chấm công trực tiếp trên ứng dụng',
  PROCESSED: 'Đồng bộ chấm công / điểm danh thành công',
  RECEIVED_RAW: 'Đã nhận gói tin (Chờ ánh xạ mã người dùng)',
  FAILED: 'Lỗi xử lý gói tin Webhook'
};

const formatDateTime = (val) => {
  if (!val) return '—';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export default function SuperAdminAuditPanel({
  superUser,
  schools = [],
  initialSchoolId = 'all',
  initialLogType = 'school_audit',
  onSuperUserUpdated
}) {
  const [logType, setLogType] = useState(initialLogType || 'school_audit');
  const [selectedSchoolId, setSelectedSchoolId] = useState(initialSchoolId || 'all');
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [showSecForm, setShowSecForm] = useState(false);

  const [secForm, setSecForm] = useState({
    newUsername: superUser?.username || 'admin',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [savingSec, setSavingSec] = useState(false);
  const [secNotice, setSecNotice] = useState(null);

  const loadLogs = useCallback(async (targetPage = 1) => {
    setLoadingLogs(true);
    try {
      if (logType === 'platform') {
        const res = await getSuperAdminAuditLogs({
          page: targetPage,
          limit: 25,
          action: actionFilter || undefined,
          search: search.trim() || undefined
        });
        setLogs(res.data?.data || []);
        setPagination(res.data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      } else {
        const res = await getSuperAdminSchoolLogs({
          page: targetPage,
          limit: 25,
          logType,
          schoolId: selectedSchoolId !== 'all' ? selectedSchoolId : undefined,
          action: actionFilter || undefined,
          search: search.trim() || undefined
        });
        setLogs(res.data?.data || []);
        setPagination(res.data?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
      }
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [logType, selectedSchoolId, actionFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLogs(1);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [loadLogs]);

  const handleSaveSecurity = async (e) => {
    e.preventDefault();
    if (savingSec) return;
    if (secForm.newPassword.length < 6) {
      setSecNotice({ type: 'error', text: 'Mật khẩu mới phải từ 6 ký tự trở lên.' });
      return;
    }
    if (secForm.newPassword !== secForm.confirmPassword) {
      setSecNotice({ type: 'error', text: 'Mật khẩu xác nhận không trùng khớp.' });
      return;
    }

    setSavingSec(true);
    setSecNotice(null);
    try {
      const res = await changeSuperAdminPassword({
        newUsername: secForm.newUsername.trim(),
        currentPassword: secForm.currentPassword,
        newPassword: secForm.newPassword
      });
      if (res.data?.token && res.data?.user) {
        localStorage.setItem('superadmin_token', res.data.token);
        localStorage.setItem('superadmin_user', JSON.stringify(res.data.user));
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        onSuperUserUpdated?.(res.data.user);
      }
      setSecForm((prev) => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }));
      setSecNotice({ type: 'success', text: 'Đã cập nhật tài khoản & mật khẩu SuperAdmin thành công.' });
      if (logType === 'platform') void loadLogs(1);
    } catch (err) {
      setSecNotice({ type: 'error', text: err.response?.data?.message || 'Không thể đổi mật khẩu SuperAdmin.' });
    } finally {
      setSavingSec(false);
    }
  };

  return (
    <div>
      {/* KHỐI 1: TRÌNH XEM NHẬT KÝ HOẠT ĐỘNG TỪNG TRƯỜNG & WEBHOOK */}
      <section className="content-card student-list-card" style={{ marginBottom: 20 }}>
        <div className="list-toolbar">
          <div>
            <p className="card-kicker">TRUNG TÂM GIÁM SÁT NHẬT KÝ ĐA TẦNG (PER-SCHOOL & SYSTEM LOGS)</p>
            <h2>Nhật ký hoạt động từng trường, Webhook chấm công & Kiểm toán ({pagination.total})</h2>
            <p>
              Chọn từng trường cụ thể để tra cứu nhật ký cấp phát tài khoản nhân sự, thao tác nghiệp vụ hoặc lịch sử gói tin máy chấm công đẩy về.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowSecForm((v) => !v)}
            >
              <Icon name="lock" size={15} /> {showSecForm ? 'Ẩn đổi mật khẩu SuperAdmin' : 'Bảo mật TK SuperAdmin'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => loadLogs(pagination.page)}
              disabled={loadingLogs}
            >
              <Icon name="refresh" size={15} /> Làm mới
            </button>
          </div>
        </div>

        {/* BỘ CHUYỂN LOẠI NHẬT KÝ */}
        <div className="superadmin-report-tabs" style={{ padding: '0 22px 14px', margin: '0 0 14px' }}>
          <button
            type="button"
            className={`superadmin-report-tab ${logType === 'school_audit' ? 'active' : ''}`}
            onClick={() => { setLogType('school_audit'); setActionFilter(''); }}
          >
            Nhật ký Nghiệp vụ từng trường
          </button>
          <button
            type="button"
            className={`superadmin-report-tab ${logType === 'webhook' ? 'active' : ''}`}
            onClick={() => { setLogType('webhook'); setActionFilter(''); }}
          >
            Nhật ký Webhook Máy chấm công
          </button>
          <button
            type="button"
            className={`superadmin-report-tab ${logType === 'attendance_audit' ? 'active' : ''}`}
            onClick={() => { setLogType('attendance_audit'); setActionFilter(''); }}
          >
            Nhật ký Tính công & Ca làm
          </button>
          <button
            type="button"
            className={`superadmin-report-tab ${logType === 'platform' ? 'active' : ''}`}
            onClick={() => { setLogType('platform'); setActionFilter(''); }}
          >
            Nhật ký Cấp Hệ thống (SuperAdmin)
          </button>
        </div>

        {/* THANH BỘ LỌC THEO TRƯỜNG HỌC + TỪ KHÓA */}
        <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {logType !== 'platform' && (
            <select
              value={selectedSchoolId}
              onChange={(e) => setSelectedSchoolId(e.target.value)}
              style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #93c5fd', background: '#eff6ff', color: '#1e3a8a', fontWeight: 700, minWidth: 240 }}
            >
              <option value="all">Tất cả các trường trong chuỗi ({schools.length} trường)</option>
              {schools.map((s) => (
                <option key={s._id} value={s._id}>
                  [{s.code}] {s.name}
                </option>
              ))}
            </select>
          )}

          <label className="search-box" style={{ flex: '1 1 260px' }}>
            <Icon name="search" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                logType === 'webhook'
                  ? 'Tìm theo mã học sinh, mã nhân viên, tên thiết bị, ghi chú...'
                  : 'Tìm theo người thực hiện, mã trường, hành động...'
              }
            />
          </label>

          {logType === 'webhook' && (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' }}
            >
              <option value="">Mọi trạng thái xử lý</option>
              <option value="PROCESSED">Đã đồng bộ thành công (PROCESSED)</option>
              <option value="RECEIVED_RAW">Chưa ánh xạ mã ID (RECEIVED_RAW)</option>
              <option value="FAILED">Lỗi xử lý (FAILED)</option>
            </select>
          )}

          {logType === 'platform' && (
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' }}
            >
              <option value="">Tất cả thao tác SuperAdmin</option>
              <option value="CREATE_SCHOOL_WITH_ADMIN">Khởi tạo trường mới</option>
              <option value="UPDATE_SCHOOL_CONFIG">Cập nhật cấu hình / Mật khẩu trường</option>
              <option value="ENTER_SCHOOL_WORKSPACE">Truy cập điều hành trường</option>
              <option value="UPDATE_GLOBAL_SYSTEM_SETTINGS">Cập nhật Cấu hình chung</option>
            </select>
          )}
        </div>

        {loadingLogs ? (
          <div className="inline-loader">Đang tải dữ liệu nhật ký...</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table sa-clean-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  {logType !== 'platform' && <th>Trường học</th>}
                  <th>Nguồn / Người thực hiện</th>
                  <th>Sự kiện / Hành động</th>
                  <th>Chi tiết ghi nhận</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={logType === 'platform' ? 4 : 5} style={{ textAlign: 'center', color: '#64748b', padding: '30px 0' }}>
                      Chưa có bản ghi nhật ký nào khớp điều kiện lọc hiện tại.
                    </td>
                  </tr>
                ) : logType === 'platform' ? (
                  logs.map((log) => (
                    <tr key={log._id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.createdAt || log.occurredAt)}</td>
                      <td><strong>@{log.actorUsername}</strong></td>
                      <td><strong>{PLATFORM_ACTION_LABELS[log.action] || log.action}</strong></td>
                      <td style={{ fontSize: 12.5, color: '#475569' }}>
                        {log.details?.code ? `Mã trường: ${log.details.code} · ` : ''}
                        {log.details?.name ? `${log.details.name} · ` : ''}
                        {log.details?.adminUsername ? `Admin trường: @${log.details.adminUsername} · ` : ''}
                        {log.details?.asSchoolAdmin ? `Phiên hỗ trợ: @${log.details.asSchoolAdmin}` : ''}
                      </td>
                    </tr>
                  ))
                ) : (
                  logs.map((log) => (
                    <tr key={log._id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.occurredAt)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong style={{ color: '#1d4ed8' }}>{log.schoolCode}</strong>
                        {log.schoolName && <small>{log.schoolName}</small>}
                      </td>
                      <td>
                        <strong>{log.logType === 'webhook' ? log.actorUsername : `@${log.actorUsername}`}</strong>
                        {log.actorRole && <small>{log.actorRole}</small>}
                      </td>
                      <td>
                        <span
                          className={`student-status ${
                            log.action === 'FAILED'
                              ? 'withdrawn'
                              : log.action === 'RECEIVED_RAW'
                                ? 'temporarily_absent'
                                : 'enrolled'
                          }`}
                        >
                          {SCHOOL_ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td style={{ fontSize: 12.5, color: '#334155' }}>
                        {log.personCode && (
                          <div>
                            Mã quẹt: <strong>{log.personCode}</strong>
                            {log.personName ? ` (${log.personName})` : ''}
                            {log.verifyMode ? ` · ${log.verifyMode}` : ''}
                          </div>
                        )}
                        <div>{log.summary}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px' }}>
            <small style={{ color: '#64748b' }}>
              Trang {pagination.page} / {pagination.totalPages} ({pagination.total} bản ghi)
            </small>
            <div className="classroom-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={pagination.page <= 1 || loadingLogs}
                onClick={() => loadLogs(pagination.page - 1)}
              >
                ← Trang trước
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={pagination.page >= pagination.totalPages || loadingLogs}
                onClick={() => loadLogs(pagination.page + 1)}
              >
                Trang sau →
              </button>
            </div>
          </div>
        )}
      </section>

      {/* KHỐI 2: ĐỔI THÔNG TIN BẢO MẬT TÀI KHOẢN SUPERADMIN */}
      {showSecForm && (
        <section className="content-card" style={{ padding: '22px 24px' }}>
          <p className="card-kicker">BẢO MẬT TÀI KHOẢN QUẢN TRỊ TỔNG</p>
          <h2 style={{ margin: '4px 0 6px' }}>Cập nhật thông tin đăng nhập SuperAdmin (@{superUser?.username || 'admin'})</h2>
          <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 13.5 }}>
            Khi đổi mật khẩu, hệ thống tự động nâng phiên bảo mật (`authVersion`) để thu hồi ngay các phiên đăng nhập cũ trên thiết bị khác.
          </p>

          {secNotice && (
            <div className={secNotice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: 14 }}>
              <Icon name={secNotice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
              <span>{secNotice.text}</span>
            </div>
          )}

          <form className="student-form" autoComplete="off" onSubmit={handleSaveSecurity}>
            <div className="student-form-grid">
              <label>
                Tên đăng nhập SuperAdmin *
                <input
                  required
                  autoComplete="off"
                  value={secForm.newUsername}
                  onChange={(e) => setSecForm({ ...secForm, newUsername: e.target.value })}
                />
              </label>
              <label>
                Mật khẩu hiện tại *
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu hiện tại"
                  value={secForm.currentPassword}
                  onChange={(e) => setSecForm({ ...secForm, currentPassword: e.target.value })}
                />
              </label>
              <label>
                Mật khẩu mới *
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Tối thiểu 6 ký tự"
                  value={secForm.newPassword}
                  onChange={(e) => setSecForm({ ...secForm, newPassword: e.target.value })}
                />
              </label>
              <label>
                Xác nhận mật khẩu mới *
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Nhập lại mật khẩu mới"
                  value={secForm.confirmPassword}
                  onChange={(e) => setSecForm({ ...secForm, confirmPassword: e.target.value })}
                />
              </label>
            </div>
            <div className="form-actions" style={{ marginTop: 14 }}>
              <button type="submit" className="button button-primary" disabled={savingSec}>
                {savingSec ? 'Đang cập nhật...' : 'Cập nhật bảo mật SuperAdmin'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
