import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import ParentAccountManagement from './ParentAccountManagement';
import { createInternalAccount, deactivateInternalAccount, getInternalAccounts, updateInternalAccount } from '../api/systemUsers';

const roleOptions = [
  { value: 'principal', label: 'Hiệu trưởng' },
  { value: 'teacher', label: 'Giáo viên' },
  { value: 'accountant', label: 'Kế toán' },
  { value: 'chef', label: 'Nhân viên bếp' },
  { value: 'guard', label: 'Bảo vệ' },
  { value: 'hr', label: 'Nhân sự (HR)' }
];
const statusOptions = { active: 'Đang hoạt động', suspended: 'Tạm ngưng', inactive: 'Đã thu hồi' };
const emptyForm = { fullName: '', username: '', password: '', phone: '', email: '', role: 'teacher', status: 'active' };

export default function AccountManagement() {
  const currentRole = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canAssignPrincipal = currentRole === 'admin';
  const availableRoles = roleOptions.filter((item) => canAssignPrincipal || item.value !== 'principal');
  const [tab, setTab] = useState('internal');
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await getInternalAccounts({ page, limit: 10 });
      setAccounts(response.data.data || []);
      setPagination(response.data.pagination || { page: 1, limit: 10, total: 0, totalPages: 0 });
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải danh sách tài khoản.' });
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const resetForm = () => { setForm(emptyForm); setEditingId(''); };
  const openEdit = (account) => {
    setEditingId(account._id);
    setForm({ fullName: account.profile?.fullName || '', username: account.username, password: '', phone: account.profile?.phone || '', email: account.profile?.email || '', role: account.role, status: account.status });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setNotice(null);
    try {
      if (editingId) {
        const payload = { username: form.username, role: form.role, status: form.status, profile: { fullName: form.fullName, phone: form.phone, email: form.email } };
        if (form.password) payload.password = form.password;
        await updateInternalAccount(editingId, payload);
        setNotice({ type: 'success', text: 'Đã cập nhật tài khoản.' });
      } else {
        await createInternalAccount({ username: form.username, password: form.password, role: form.role, profile: { fullName: form.fullName, phone: form.phone, email: form.email } });
        setNotice({ type: 'success', text: 'Đã tạo tài khoản nội bộ. Bạn có thể gắn hồ sơ nhân sự ở mục Nhân sự & Lương.' });
      }
      resetForm();
      if (page !== 1) setPage(1); else await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể lưu tài khoản.' });
    } finally {
      setSaving(false);
    }
  };
  const deactivate = async (account) => {
    if (!window.confirm(`Thu hồi quyền truy cập của @${account.username}? Hồ sơ và lịch sử vẫn được giữ lại.`)) return;
    setSaving(true); setNotice(null);
    try {
      await deactivateInternalAccount(account._id, 'Thu hồi quyền từ quản trị tài khoản');
      setNotice({ type: 'success', text: `Đã thu hồi quyền truy cập của @${account.username}.` });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể thu hồi tài khoản.' });
    } finally {
      setSaving(false);
    }
  };
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const pendingStaffCount = accounts.filter((account) => !account.employeeId && account.status === 'active').length;

  return <AppShell title="Tài khoản & phân quyền" subtitle="Cấp tài khoản nội bộ, duyệt đăng ký phụ huynh và kiểm soát truy cập theo đúng vai trò.">
    {notice && <div className={`timekeeping-notice ${notice.type}`}><Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />{notice.text}</div>}
    <section className="account-hero"><div><p className="card-kicker">QUẢN TRỊ TRUY CẬP</p><h2>Quản lý tài khoản tập trung</h2><p>Mỗi tài khoản có một vai trò duy nhất. Tài khoản phụ huynh chỉ được kích hoạt sau khi đã liên kết hồ sơ học sinh.</p></div><div className="account-hero-metrics"><span><b>{activeCount}</b> tài khoản hoạt động</span><span><b>{pendingStaffCount}</b> chờ gắn hồ sơ nhân sự</span></div></section>
    <div className="account-tabs" role="tablist"><button className={tab === 'internal' ? 'active' : ''} onClick={() => setTab('internal')}><Icon name="shield" size={16} />Tài khoản nội bộ</button><button className={tab === 'parents' ? 'active' : ''} onClick={() => setTab('parents')}><Icon name="users" size={16} />Duyệt đăng ký phụ huynh</button></div>
    {tab === 'parents' ? <section className="account-parent-workspace"><div className="account-workspace-heading"><div><p className="card-kicker">YÊU CẦU TỪ BÊN NGOÀI</p><h2>Duyệt tài khoản phụ huynh</h2><p>Kiểm tra thông tin, liên kết con và kích hoạt quyền truy cập trong một luồng.</p></div></div><ParentAccountManagement embedded /></section> : <div className="account-management-layout">
      <form className="content-card account-create-card" onSubmit={submit}>
        <div className="card-heading"><div><p className="card-kicker">{editingId ? 'CẬP NHẬT TÀI KHOẢN' : 'CẤP TÀI KHOẢN NỘI BỘ'}</p><h2>{editingId ? 'Chỉnh sửa tài khoản' : 'Tạo tài khoản nhân sự'}</h2></div>{editingId && <button className="button button-secondary" type="button" onClick={resetForm}>Hủy sửa</button>}</div>
        <p className="account-form-note">Nhân viên được tạo tại đây. Phụ huynh không tạo ở đây mà dùng trang Đăng ký phụ huynh.</p>
        <div className="student-form-grid">
          <label>Họ và tên<input value={form.fullName} onChange={(event) => setField('fullName', event.target.value)} placeholder="Nhập họ và tên đầy đủ" required /></label>
          <label>Tên đăng nhập<input value={form.username} onChange={(event) => setField('username', event.target.value)} placeholder="Ví dụ: nguyenvana" minLength="3" maxLength="50" required /></label>
          <label>Số điện thoại<input value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="Không bắt buộc" /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="Không bắt buộc" /></label>
          <label>Vai trò<select value={form.role} onChange={(event) => setField('role', event.target.value)}>{availableRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select><small>Mỗi tài khoản chỉ được gán một vai trò.</small></label>
          <label>Trạng thái<select value={form.status} onChange={(event) => setField('status', event.target.value)}>{Object.entries(statusOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="form-wide">{editingId ? 'Đặt lại mật khẩu (để trống nếu giữ nguyên)' : 'Mật khẩu tạm thời'}<input type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} minLength={editingId ? undefined : '8'} maxLength="72" placeholder={editingId ? 'Để trống nếu không đổi mật khẩu' : 'Tối thiểu 8 ký tự'} required={!editingId} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button></div>
      </form>
      <section className="content-card account-list-card"><div className="card-heading"><div><p className="card-kicker">DANH SÁCH TÀI KHOẢN</p><h2>{pagination.total} tài khoản nội bộ</h2></div><span className="history-count">{activeCount} hoạt động trên trang này</span></div>{loading ? <div className="page-loader"><span className="loading-orb" />Đang tải tài khoản...</div> : <div className="table-wrap"><table className="data-table account-table"><thead><tr><th>Nhân sự</th><th>Tài khoản</th><th>Vai trò</th><th>Hồ sơ nhân sự</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{accounts.length ? accounts.map((account) => <tr key={account._id}><td><strong>{account.profile?.fullName || account.username}</strong><small>{account.profile?.phone || account.profile?.email || 'Chưa có liên hệ'}</small></td><td>@{account.username}</td><td><span className="account-role-badge">{account.role === 'admin' ? 'Quản trị hệ thống' : roleOptions.find((role) => role.value === account.role)?.label || account.role}</span></td><td>{account.employeeId || <span className="account-unlinked">Chưa liên kết</span>}</td><td><span className={`student-status ${account.status === 'active' ? 'enrolled' : 'temporarily_absent'}`}>{statusOptions[account.status] || account.status}</span></td><td><div className="account-row-actions"><button className="button button-secondary" onClick={() => openEdit(account)} disabled={Boolean(account.employeeId) || account.role === 'admin'}>Sửa</button><button className="button button-danger" onClick={() => deactivate(account)} disabled={saving || account.status === 'inactive' || account.role === 'admin'}>Thu hồi</button></div></td></tr>) : <tr><td colSpan="6" className="history-empty">Chưa có tài khoản nội bộ.</td></tr>}</tbody></table></div>}{pagination.totalPages > 1 && <div className="account-pagination"><span>Hiển thị {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} / {pagination.total}</span><div><button className="button button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>← Trang trước</button><strong>Trang {pagination.page}/{pagination.totalPages}</strong><button className="button button-secondary" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Trang sau →</button></div></div>}<p className="account-list-hint">Tài khoản đã liên kết hồ sơ nhân sự được chỉnh sửa tại mục <b>Nhân sự & Lương</b> để tránh sai lệch chức vụ và lương.</p></section>
    </div>}
  </AppShell>;
}
