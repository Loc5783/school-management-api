/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  createEmployee,
  generatePayroll,
  getEmployees,
  getStaffAccounts,
  getPayroll,
  syncStaffAccounts,
  updateEmployee,
  updatePayrollStatus
} from '../api/hr';
import {
  getPendingCorrections,
  approveCorrection,
  rejectCorrection,
  recalculateAttendance
} from '../api/timekeeping';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const currentMonth = new Date().getMonth() + 1;
const currentYear = new Date().getFullYear();
const statusText = { draft: 'Bản nháp', confirmed: 'Đã xác nhận', paid: 'Đã chi trả' };
const positionText = {
  principal: 'Hiệu trưởng', vice_principal: 'Phó hiệu trưởng', teacher: 'Giáo viên',
  head_teacher: 'Tổ trưởng chuyên môn', assistant_teacher: 'Trợ giảng',
  accountant: 'Kế toán', chef: 'Nhân viên bếp', hr: 'Nhân sự (HR)', security: 'Bảo vệ'
};
const roleText = { admin: 'Hiệu trưởng / Quản trị hệ thống', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự (HR)' };
const payrollRoleText = { principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự (HR)' };
const payrollRoleFromAccountRole = (role) => ({
  admin: 'principal', principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'guard', hr: 'hr'
}[role] || 'teacher');
const emptyEmployeeForm = {
  userId: '', employeeCode: '', fullName: '', phone: '', email: '', position: 'teacher', payrollRole: 'teacher', baseSalary: 7000000
};

export default function EmployeeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'employees';
  const [tab, setTab] = useState(['employees', 'timekeeping', 'payroll'].includes(initialTab) ? initialTab : 'employees');
  const [employees, setEmployees] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [pendingCorrections, setPendingCorrections] = useState([]);
  const [selectedRecalcDate, setSelectedRecalcDate] = useState('');
  const [payrolls, setPayrolls] = useState([]);
  const [payrollSummary, setPayrollSummary] = useState({ totalEmployees: 0, totalNet: 0, byRole: [] });
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [period, setPeriod] = useState({ month: currentMonth, year: currentYear });
  const [form, setForm] = useState(emptyEmployeeForm);
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canManageHr = ['admin', 'principal', 'hr'].includes(role);
  const canManagePayroll = ['admin', 'principal', 'accountant'].includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [employeeRes, correctionRes, payrollRes, staffAccountRes] = await Promise.all([
        getEmployees(),
        canManageHr ? getPendingCorrections() : Promise.resolve({ data: { data: [] } }),
        getPayroll(period),
        canManageHr ? getStaffAccounts() : Promise.resolve({ data: { data: [] } })
      ]);
      setEmployees(employeeRes.data.data || []);
      setPendingCorrections(correctionRes.data.data || []);
      setPayrolls(payrollRes.data.data?.payrolls || []);
      setPayrollSummary(payrollRes.data.data?.summary || { totalEmployees: 0, totalNet: 0, byRole: [] });
      setStaffAccounts(staffAccountRes.data.data || []);
      setNotice('');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể tải dữ liệu nhân sự.');
    } finally {
      setLoading(false);
    }
  }, [canManageHr, period]);

  useEffect(() => { load(); }, [load]);

  const changeTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  const submitEmployee = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        ...form,
        userId: form.userId || '',
        salaryConfig: { baseSalary: Number(form.baseSalary), positionAllowance: 0, lunchAllowance: 0 }
      };
      if (editingEmployee) await updateEmployee(editingEmployee._id, payload);
      else await createEmployee(payload);
      setShowForm(false);
      setEditingEmployee(null);
      setForm(emptyEmployeeForm);
      await load();
      setNotice(editingEmployee ? 'Đã cập nhật hồ sơ và liên kết tài khoản nhân sự.' : 'Đã tạo hồ sơ nhân sự.');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể lưu hồ sơ nhân viên.');
    }
  };

  const openEmployeeForm = (employee = null, account = null) => {
    const populatedAccount = employee?.userId && typeof employee.userId === 'object' ? employee.userId : null;
    const linkedAccount = account || staffAccounts.find((item) => String(item._id) === String(populatedAccount?._id || employee?.userId)) || populatedAccount;
    setEditingEmployee(employee);
    setForm({
      userId: String(linkedAccount?._id || employee?.userId?._id || employee?.userId || ''),
      employeeCode: employee?.employeeCode || linkedAccount?.employeeInfo?.employeeId || '',
      fullName: employee?.fullName || linkedAccount?.profile?.fullName || '',
      phone: employee?.phone || linkedAccount?.profile?.phone || '',
      email: employee?.email || linkedAccount?.profile?.email || '',
      position: employee?.position || linkedAccount?.employeeInfo?.position || linkedAccount?.suggestedPosition || 'teacher',
      payrollRole: linkedAccount?.role
        ? payrollRoleFromAccountRole(linkedAccount.role)
        : (employee?.payrollRole || linkedAccount?.suggestedPayrollRole || 'teacher'),
      baseSalary: employee?.salaryConfig?.baseSalary ?? linkedAccount?.employeeInfo?.baseSalary ?? 7000000
    });
    setShowForm(true);
  };

  const chooseStaffAccount = (userId) => {
    const account = staffAccounts.find((item) => String(item._id) === String(userId));
    setForm((current) => ({
      ...current,
      userId,
      employeeCode: current.employeeCode || account?.employeeInfo?.employeeId || '',
      fullName: account?.profile?.fullName || current.fullName,
      phone: account?.profile?.phone || current.phone,
      email: account?.profile?.email || current.email,
      position: account?.employeeInfo?.position || account?.suggestedPosition || current.position,
      payrollRole: account?.suggestedPayrollRole || payrollRoleFromAccountRole(account?.role),
      baseSalary: current.baseSalary || account?.employeeInfo?.baseSalary || 7000000
    }));
  };

  const unlinkedAccounts = staffAccounts.filter((account) => !account.employeeProfile);

  const synchronizeStaffAccounts = async () => {
    if (!unlinkedAccounts.length) return;
    if (!window.confirm(`Tạo và liên kết hồ sơ nhân sự cho ${unlinkedAccounts.length} tài khoản nội bộ đang hoạt động? Phụ huynh không bao giờ được đưa vào bảng lương.`)) return;
    try {
      const response = await syncStaffAccounts();
      await load();
      const needsSalary = (response.data.data?.created || []).filter((item) => !item.salaryConfigured).length;
      setNotice(`${response.data.message}.${needsSalary ? ` ${needsSalary} hồ sơ cần thiết lập mức lương trước khi tính lương.` : ''}`);
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể đồng bộ tài khoản nội bộ.');
    }
  };

  const handleApproveCorrection = async (id) => {
    if (!window.confirm('Bạn có chắc chắn muốn duyệt đơn chấm công bù này?')) return;
    try {
      const request = pendingCorrections.find((item) => item._id === id);
      await approveCorrection(id, request?.version);
      await load();
      setNotice('Đã duyệt đơn chấm công bù thành công.');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi khi duyệt đơn chấm công.');
    }
  };

  const handleRejectCorrection = async (id) => {
    const reason = window.prompt('Nhập lý do từ chối:');
    if (reason === null) return;
    try {
      const request = pendingCorrections.find((item) => item._id === id);
      await rejectCorrection(id, request?.version, reason);
      await load();
      setNotice('Đã từ chối đơn chấm công.');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi khi từ chối đơn chấm công.');
    }
  };

  const handleRecalculateAttendance = async () => {
    if (!selectedRecalcDate) {
      window.alert('Vui lòng chọn ngày cần tính lại chấm công.');
      return;
    }
    if (!window.confirm(`Bạn có chắc chắn muốn tính lại dữ liệu chấm công ngày ${selectedRecalcDate}?`)) return;
    try {
      await recalculateAttendance(selectedRecalcDate);
      await load();
      setNotice(`Đã tính lại công ngày ${selectedRecalcDate} thành công.`);
    } catch (err) {
      setNotice(err.response?.data?.message || 'Lỗi khi tính lại chấm công.');
    }
  };

  const buildPayroll = async () => {
    try {
      await generatePayroll(period);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể tính lương.');
    }
  };

  return (
    <AppShell
      title="Nhân sự & Bảng lương"
      subtitle="Quản lý hồ sơ nhân viên, phê duyệt chấm công và tính lương theo vai trò."
      actions={canManageHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
    >
      <section className="hr-workspace">
        {notice && <div className="form-error">{notice}</div>}

        <div className="hr-summary">
          <article><span><Icon name="users" size={19} /></span><div><small>NHÂN SỰ ĐANG QUẢN LÝ</small><strong>{employees.length} hồ sơ</strong></div></article>
          <article><span><Icon name="clock" size={19} /></span><div><small>ĐƠN CÔNG BÙ CHỜ DUYỆT</small><strong>{pendingCorrections.length} đơn</strong></div></article>
          <article><span><Icon name="money" size={19} /></span><div><small>BẢNG LƯƠNG THÁNG {period.month}/{period.year}</small><strong>{payrolls.length} nhân viên</strong></div></article>
        </div>

        <section className="content-card timekeeping-hub">
          <div className="timekeeping-hub-tabs">
            {[
              ['employees', 'Hồ sơ nhân sự', 'users'],
              ['timekeeping', 'Quản lý & duyệt chấm công', 'clock'],
              ['payroll', 'Bảng lương', 'money']
            ].map(([key, label, icon]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>
                <Icon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'employees' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar">
              <div><p className="card-kicker">DANH SÁCH NHÂN SỰ</p><h2>Hồ sơ nhân viên theo vai trò</h2><p>Vai trò là căn cứ phân loại và tổng hợp lương; tổ/bộ phận không tác động đến lương.</p></div>
              {canManageHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
            </div>
            {loading ? <div className="inline-loader">Đang tải danh sách nhân sự...</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>MÃ</th><th>NHÂN VIÊN</th><th>TÀI KHOẢN</th><th>VAI TRÒ TÍNH LƯƠNG</th><th>CHỨC DANH</th><th>TRẠNG THÁI</th>{canManageHr && <th>THAO TÁC</th>}</tr></thead>
                <tbody>{employees.length ? employees.map((item) => { const effectiveRole = item.userId?.role ? payrollRoleFromAccountRole(item.userId.role) : item.payrollRole; return <tr key={item._id}><td><strong>{item.employeeCode}</strong></td><td><strong>{item.fullName}</strong><small>{item.phone || 'Chưa có số điện thoại'}</small></td><td>{item.userId ? <><strong>@{item.userId.username}</strong><small>{roleText[item.userId.role] || item.userId.role}</small></> : <span className="account-unlinked">Chưa liên kết</span>}</td><td><span className="account-role-badge">{payrollRoleText[effectiveRole] || payrollRoleText.teacher}</span></td><td>{positionText[item.position] || item.position}</td><td><span className={`student-status ${item.status === 'active' ? 'enrolled' : 'temporarily_absent'}`}>{item.status === 'active' ? 'Đang làm việc' : 'Đã nghỉ việc'}</span></td>{canManageHr && <td><button className="button button-secondary department-edit" onClick={() => openEmployeeForm(item)}>Sửa / Gán TK</button></td>}</tr>; }) : <tr><td colSpan={canManageHr ? '7' : '6'} className="history-empty">Chưa có hồ sơ nhân viên.</td></tr>}</tbody>
              </table></div>
            )}
            {canManageHr && <section className="staff-account-panel"><div><p className="card-kicker">TÀI KHOẢN NỘI BỘ & BẢNG LƯƠNG</p><h3>{unlinkedAccounts.length ? `${unlinkedAccounts.length} tài khoản chưa có hồ sơ nhân sự` : 'Tất cả tài khoản nội bộ đã được liên kết'}</h3><p>Lương được tổng hợp theo vai trò: Hiệu trưởng, Giáo viên, Kế toán, Bếp, Bảo vệ và Nhân sự. Phụ huynh luôn bị loại trừ.</p>{unlinkedAccounts.length > 0 && <button className="button button-primary staff-sync-button" onClick={synchronizeStaffAccounts}><Icon name="users" size={15} /> Đồng bộ {unlinkedAccounts.length} tài khoản</button>}</div>{unlinkedAccounts.length > 0 && <div className="staff-account-list">{unlinkedAccounts.map((account) => <article key={account._id}><span className="staff-account-avatar">{(account.profile?.fullName || account.username).slice(0, 1).toUpperCase()}</span><div><strong>{account.profile?.fullName || account.username}</strong><small>@{account.username} · {roleText[account.role] || account.role}{account.employeeInfo?.baseSalary > 0 ? ' · Đã có mức lương' : ' · Chưa đặt lương'}</small></div><button className="button button-secondary" onClick={() => openEmployeeForm(null, account)}>Thiết lập riêng</button></article>)}</div>}</section>}
          </section>
        )}

        {tab === 'timekeeping' && (
          <div className="timekeeping-management-container">
            <section className="content-card student-list-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">PHÊ DUYỆT CHẤM CÔNG</p>
                  <h2>Đơn chấm công bù chờ duyệt ({pendingCorrections.length})</h2>
                  <p>Phê duyệt đơn giải trình / quên chấm công trước khi chốt dữ liệu tính lương.</p>
                </div>
              </div>
              {pendingCorrections.length === 0 ? (
                <div className="empty-state"><strong>Không có đơn chấm công bù chờ duyệt</strong></div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>NHÂN VIÊN</th>
                        <th>NGÀY CẦN BÙ</th>
                        <th>GIỜ ĐỀ NGHỊ</th>
                        <th>LÝ DO</th>
                        <th>THAO TÁC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingCorrections.map((req) => (
                        <tr key={req._id}>
                          <td><strong>{req.employeeName}</strong></td>
                          <td>{new Date(req.workDate).toLocaleDateString('vi-VN')}</td>
                          <td><span className="badge-time">{req.requestedCheckInTime}</span></td>
                          <td>{req.reason}</td>
                          <td>
                            <div className="leave-actions">
                              <button
                                className="button button-primary"
                                onClick={() => handleApproveCorrection(req._id)}
                              >
                                <Icon name="check" size={16} /> Duyệt
                              </button>
                              <button
                                className="button button-secondary"
                                onClick={() => handleRejectCorrection(req._id)}
                              >
                                <Icon name="x" size={16} /> Từ chối
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

            <section className="content-card" style={{ marginTop: 20 }}>
              <div className="card-heading">
                <div>
                  <p className="card-kicker">CÔNG CỤ ĐỒNG BỘ CÔNG</p>
                  <h2>Tính lại ngày chấm công đã chốt</h2>
                  <p>Hệ thống sẽ quét lại các sự kiện quẹt thẻ / điểm danh sinh trắc học để cập nhật lại ngày công chính xác.</p>
                </div>
              </div>
              <div style={{ padding: '0 23px 23px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  type="date"
                  value={selectedRecalcDate}
                  onChange={(e) => setSelectedRecalcDate(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}
                />
                <button className="button button-primary" onClick={handleRecalculateAttendance}>
                  <Icon name="refresh" size={16} /> Tính lại công
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === 'payroll' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar"><div><p className="card-kicker">BẢNG LƯƠNG THEO VAI TRÒ</p><h2>Kỳ lương {period.month}/{period.year}</h2><p>Chấm công quyết định ngày công; vai trò quyết định nhóm tổng hợp. Tổ/bộ phận không tham gia tính lương.</p></div><div className="toolbar-buttons"><label>THÁNG<input type="number" min="1" max="12" value={period.month} onChange={(e) => setPeriod({ ...period, month: Number(e.target.value) })} /></label><label>NĂM<input type="number" value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} /></label>{canManagePayroll && <button className="button button-primary" onClick={buildPayroll}>Tính lương</button>}</div></div>
            {payrollSummary.byRole?.length > 0 && <div className="hr-summary payroll-role-summary">{payrollSummary.byRole.map((item) => <article key={item.role}><span><Icon name="money" size={19} /></span><div><small>{payrollRoleText[item.role] || item.role}</small><strong>{item.employees} người</strong><small>Thực lĩnh: {money(item.netSalary)}</small></div></article>)}</div>}
            <div className="table-wrap"><table className="data-table"><thead><tr><th>NHÂN VIÊN</th><th>VAI TRÒ</th><th>NGÀY CÔNG</th><th>LƯƠNG GỘP</th><th>THỰC LĨNH</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>
              {payrolls.length ? payrolls.map((item) => <tr key={item._id}><td><strong>{item.employeeName}</strong><small>{item.employeeCode}</small></td><td><span className="account-role-badge">{payrollRoleText[item.payrollRole] || payrollRoleText.teacher}</span></td><td>{item.actualWorkDays} công + {item.paidLeaveDays} phép</td><td>{money(item.grossSalary)}</td><td><strong>{money(item.netSalary)}</strong></td><td><span className={`student-status status-${item.status}`}>{statusText[item.status] || item.status}</span></td><td>{canManagePayroll && item.status === 'draft' && <button className="button button-secondary" onClick={async () => { await updatePayrollStatus(item._id, { status: 'confirmed' }); load(); }}>Xác nhận</button>}</td></tr>) : <tr><td colSpan="7" className="history-empty">Chưa có bảng lương cho kỳ này.</td></tr>}
            </tbody></table></div>
          </section>
        )}
      </section>

      {showForm && <div className="modal-backdrop"><form className="content-card student-form hr-modal" onSubmit={submitEmployee}><div className="card-heading"><div><p className="card-kicker">HỒ SƠ NHÂN SỰ</p><h2>{editingEmployee ? 'Cập nhật nhân viên' : 'Thêm nhân viên'}</h2></div><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Đóng</button></div><p className="department-form-note">Vai trò tính lương là trường bắt buộc để tổng hợp bảng lương. Khi liên kết tài khoản, vai trò này phải trùng với quyền đăng nhập của nhân viên.</p><div className="student-form-grid"><label className="form-wide">Tài khoản đăng nhập<select value={form.userId} onChange={(e) => chooseStaffAccount(e.target.value)}><option value="">Chưa liên kết tài khoản</option>{staffAccounts.map((account) => { const unavailable = Boolean(account.employeeProfile && String(account.employeeProfile._id) !== String(editingEmployee?._id)); return <option key={account._id} value={account._id} disabled={unavailable}>{account.profile?.fullName || account.username} · @{account.username} · {roleText[account.role] || account.role}{unavailable ? ' (đã gán)' : ''}</option>; })}</select><small>Liên kết đúng tài khoản để ngăn lệch vai trò, chấm công và bảng lương. Một tài khoản chỉ thuộc một hồ sơ.</small></label><label>Mã nhân viên<input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="VD: GV-2026-001" required /></label><label>Họ và tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nhập họ và tên đầy đủ" required /></label><label>Số điện thoại<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="VD: 0901 234 567" required /></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@truong.edu.vn" /></label><label>Vai trò tính lương<select value={form.payrollRole} onChange={(e) => setForm({ ...form, payrollRole: e.target.value })} disabled={Boolean(form.userId)}><option value="principal">Hiệu trưởng</option><option value="teacher">Giáo viên</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="guard">Bảo vệ</option><option value="hr">Nhân sự (HR)</option></select><small>{form.userId ? 'Được lấy theo vai trò của tài khoản đã liên kết.' : 'Chọn nhóm để tổng hợp lương.'}</small></label><label>Chức danh chi tiết<select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="principal">Hiệu trưởng</option><option value="vice_principal">Phó hiệu trưởng</option><option value="teacher">Giáo viên</option><option value="head_teacher">Tổ trưởng chuyên môn</option><option value="assistant_teacher">Trợ giảng</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="hr">Nhân sự (HR)</option><option value="security">Bảo vệ</option></select></label><label className="form-wide">Lương cơ bản (VNĐ)<input type="number" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} required /></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Hủy</button><button className="button button-primary">{editingEmployee ? 'Lưu thay đổi' : 'Lưu hồ sơ'}</button></div></form></div>}
    </AppShell>
  );
}
