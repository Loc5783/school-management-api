import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import {
  changeSuperAdminPassword,
  getSuperAdminAuditLogs
} from '../api/multiSchool';

const ACTION_LABELS = {
  CREATE_SCHOOL_WITH_ADMIN: 'Khởi tạo trường học mới & Account riêng',
  UPDATE_SCHOOL_CONFIG: 'Cập nhật cấu hình / Phân hệ trường học',
  ENTER_SCHOOL_WORKSPACE: 'Truy cập điều hành không gian trường',
  UPDATE_GLOBAL_SYSTEM_SETTINGS: 'Cập nhật Cấu hình Chung Hệ thống',
  UPDATE_SUPERADMIN_CREDENTIALS: 'Đổi thông tin bảo mật SuperAdmin',
  CREATE_TENANT: 'Tạo đơn vị trường (API Platform)',
  UPDATE_TENANT_STATUS: 'Đổi trạng thái hoạt động trường'
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

export default function SuperAdminAuditPanel({ superUser, onSuperUserUpdated }) {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(true);

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
      const res = await getSuperAdminAuditLogs({
        page: targetPage,
        limit: 20,
        action: actionFilter || undefined,
        search: search.trim() || undefined
      });
      setLogs(res.data?.data || []);
      setPagination(res.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 });
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [actionFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLogs(1);
    }, 180);
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
      void loadLogs(1);
    } catch (err) {
      setSecNotice({ type: 'error', text: err.response?.data?.message || 'Không thể đổi mật khẩu SuperAdmin.' });
    } finally {
      setSavingSec(false);
    }
  };

  return (
    <div>
      <section className="content-card" style={{ padding: '22px 24px', marginBottom: '20px' }}>
        <p className="card-kicker">BẢO MẬT TÀI KHOẢN QUẢN TRỊ TỔNG</p>
        <h2 style={{ margin: '4px 0 6px' }}>Thông tin đăng nhập SuperAdmin (@{superUser?.username || 'admin'})</h2>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '13.5px' }}>
          Khi đổi mật khẩu, hệ thống tự động nâng phiên bảo mật (`authVersion`) để thu hồi ngay các phiên đăng nhập cũ trên thiết bị khác.
        </p>

        {secNotice && (
          <div className={secNotice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} style={{ marginBottom: '14px' }}>
            <Icon name={secNotice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{secNotice.text}</span>
          </div>
        )}

        <form className="student-form" onSubmit={handleSaveSecurity}>
          <div className="student-form-grid">
            <label>
              Tên đăng nhập SuperAdmin *
              <input
                required
                value={secForm.newUsername}
                onChange={(e) => setSecForm({ ...secForm, newUsername: e.target.value })}
              />
            </label>
            <label>
              Mật khẩu hiện tại *
              <input
                type="password"
                required
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
                placeholder="Nhập lại mật khẩu mới"
                value={secForm.confirmPassword}
                onChange={(e) => setSecForm({ ...secForm, confirmPassword: e.target.value })}
              />
            </label>
          </div>
          <div className="form-actions" style={{ marginTop: '14px' }}>
            <button type="submit" className="button button-primary" disabled={savingSec}>
              {savingSec ? 'Đang cập nhật...' : 'Cập nhật bảo mật SuperAdmin'}
            </button>
          </div>
        </form>
      </section>

      <section className="content-card student-list-card">
        <div className="list-toolbar">
          <div>
            <p className="card-kicker">NHẬT KÝ KIỂM TOÁN HỆ THỐNG (AUDIT TRAIL)</p>
            <h2>Lịch sử thao tác cấp Hệ thống ({pagination.total})</h2>
          </div>
          <button type="button" className="button button-secondary" onClick={() => loadLogs(pagination.page)} disabled={loadingLogs}>
            <Icon name="refresh" size={15} /> Làm mới
          </button>
        </div>

        <div className="student-filters" style={{ padding: '0 22px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <label className="search-box" style={{ flex: '1 1 280px' }}>
            <Icon name="search" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tài khoản thực hiện, mã trường, hành động..."
            />
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={{ padding: '10px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#fff' }}
          >
            <option value="">Tất cả loại thao tác</option>
            <option value="CREATE_SCHOOL_WITH_ADMIN">Khởi tạo trường mới</option>
            <option value="UPDATE_SCHOOL_CONFIG">Cập nhật cấu hình / Phân hệ trường</option>
            <option value="ENTER_SCHOOL_WORKSPACE">Truy cập điều hành trường</option>
            <option value="UPDATE_GLOBAL_SYSTEM_SETTINGS">Cập nhật Cấu hình chung hệ thống</option>
            <option value="UPDATE_SUPERADMIN_CREDENTIALS">Đổi mật khẩu SuperAdmin</option>
          </select>
        </div>

        {loadingLogs ? (
          <div className="inline-loader">Đang tải nhật ký kiểm toán...</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Người thực hiện</th>
                  <th>Hành động</th>
                  <th>Chi tiết ghi nhận</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#64748b', padding: '28px 0' }}>
                      Chưa có bản ghi kiểm toán nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log._id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.createdAt || log.occurredAt)}</td>
                      <td><strong>@{log.actorUsername}</strong></td>
                      <td><strong>{ACTION_LABELS[log.action] || log.action}</strong></td>
                      <td style={{ fontSize: '12.5px', color: '#475569' }}>
                        {log.details?.code ? `Mã trường: ${log.details.code} · ` : ''}
                        {log.details?.name ? `${log.details.name} · ` : ''}
                        {log.details?.enabledModulesCount != null ? `Phân hệ: ${log.details.enabledModulesCount} · ` : ''}
                        {log.details?.asSchoolAdmin ? `Tài khoản trường: @${log.details.asSchoolAdmin}` : ''}
                        {!log.details?.code && !log.details?.asSchoolAdmin && log.targetId ? `Đối tượng: ${log.targetId}` : ''}
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
                Trang trước
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={pagination.page >= pagination.totalPages || loadingLogs}
                onClick={() => loadLogs(pagination.page + 1)}
              >
                Trang sau
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

