/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  createDepartment,
  createEmployee,
  generatePayroll,
  getDepartments,
  getEmployeeLeaves,
  getEmployees,
  getStaffAccounts,
  getPayroll,
  reviewEmployeeLeave,
  syncStaffAccounts,
  updateDepartment,
  updateEmployee,
  updatePayrollStatus
} from '../api/hr';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const currentMonth = new Date().getMonth() + 1;
const currentYear = new Date().getFullYear();
const statusText = { draft: 'Bản nháp', confirmed: 'Đã xác nhận', paid: 'Đã chi trả' };
const positionText = {
  principal: 'Hiệu trưởng', vice_principal: 'Phó hiệu trưởng', teacher: 'Giáo viên',
  head_teacher: 'Tổ trưởng chuyên môn', assistant_teacher: 'Trợ giảng',
  accountant: 'Kế toán', chef: 'Nhân viên bếp', security: 'Bảo vệ'
};
const roleText = { admin: 'Hiệu trưởng / Quản trị hệ thống', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ' };
const emptyEmployeeForm = {
  userId: '', employeeCode: '', fullName: '', phone: '', email: '', departmentId: '', position: 'teacher', baseSalary: 7000000
};

export default function EmployeeManagement() {
  const [tab, setTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [payrolls, setPayrolls] = useState([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showDepartmentForm, setShowDepartmentForm] = useState(false);
  const [departmentForm, setDepartmentForm] = useState({ id: '', code: '', name: '', description: '' });
  const [period, setPeriod] = useState({ month: currentMonth, year: currentYear });
  const [form, setForm] = useState(emptyEmployeeForm);
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canManageHr = ['admin', 'principal'].includes(role);

  const load = async () => {
    setLoading(true);
    try {
      const [employeeRes, departmentRes, leaveRes, payrollRes, staffAccountRes] = await Promise.all([
        getEmployees(), getDepartments(), getEmployeeLeaves({ status: 'pending' }), getPayroll(period),
        canManageHr ? getStaffAccounts() : Promise.resolve({ data: { data: [] } })
      ]);
      setEmployees(employeeRes.data.data || []);
      setDepartments(departmentRes.data.data || []);
      setLeaves(leaveRes.data.data || []);
      setPayrolls(payrollRes.data.data?.payrolls || []);
      setStaffAccounts(staffAccountRes.data.data || []);
      setNotice('');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể tải dữ liệu nhân sự.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    const linkedAccount = account || (employee?.userId && typeof employee.userId === 'object' ? employee.userId : null);
    setEditingEmployee(employee);
    setForm({
      userId: String(linkedAccount?._id || employee?.userId?._id || employee?.userId || ''),
      employeeCode: employee?.employeeCode || linkedAccount?.employeeInfo?.employeeId || '',
      fullName: employee?.fullName || linkedAccount?.profile?.fullName || '',
      phone: employee?.phone || linkedAccount?.profile?.phone || '',
      email: employee?.email || linkedAccount?.profile?.email || '',
      departmentId: String(employee?.departmentId?._id || employee?.departmentId || ''),
      position: employee?.position || linkedAccount?.employeeInfo?.position || linkedAccount?.suggestedPosition || 'teacher',
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

  const openDepartmentForm = (department = null) => {
    setDepartmentForm(department ? { id: department._id, code: department.code || '', name: department.name || '', description: department.description || '' } : { id: '', code: '', name: '', description: '' });
    setShowDepartmentForm(true);
  };

  const submitDepartment = async (event) => {
    event.preventDefault();
    try {
      const payload = { code: departmentForm.code.trim(), name: departmentForm.name.trim(), description: departmentForm.description.trim() };
      if (departmentForm.id) await updateDepartment(departmentForm.id, payload);
      else await createDepartment(payload);
      setShowDepartmentForm(false);
      setDepartmentForm({ id: '', code: '', name: '', description: '' });
      await load();
      setNotice(departmentForm.id ? 'Đã cập nhật tổ/bộ phận.' : 'Đã tạo tổ/bộ phận. Bạn có thể chọn ngay khi thêm nhân viên.');
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể lưu tổ/bộ phận.');
    }
  };

  const processLeave = async (id, approved) => {
    try {
      await reviewEmployeeLeave(id, {
        approved,
        rejectionReason: approved ? '' : 'Chưa thể phê duyệt theo kế hoạch nhân sự hiện tại.'
      });
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể xử lý đơn nghỉ.');
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
      subtitle="Quản lý hồ sơ nhân viên, đơn nghỉ phép và tính lương từ dữ liệu chấm công."
      actions={canManageHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
    >
      <section className="hr-workspace">
        {notice && <div className="form-error">{notice}</div>}

        <div className="hr-summary">
          <article><span><Icon name="users" size={19} /></span><div><small>NHÂN SỰ ĐANG QUẢN LÝ</small><strong>{employees.length} hồ sơ</strong></div></article>
          <article><span><Icon name="clock" size={19} /></span><div><small>ĐƠN CHỜ XỬ LÝ</small><strong>{leaves.length} đơn</strong></div></article>
          <article><span><Icon name="money" size={19} /></span><div><small>BẢNG LƯƠNG THÁNG {period.month}/{period.year}</small><strong>{payrolls.length} nhân viên</strong></div></article>
        </div>

        <section className="content-card timekeeping-hub">
          <div className="timekeeping-hub-tabs">
            {[
              ['employees', 'Hồ sơ nhân sự', 'users'],
              ['departments', 'Tổ & Bộ phận', 'grid'],
              ['leaves', 'Duyệt nghỉ phép', 'clock'],
              ['payroll', 'Bảng lương', 'money']
            ].map(([key, label, icon]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                <Icon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'employees' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar">
              <div><p className="card-kicker">DANH SÁCH NHÂN SỰ</p><h2>Hồ sơ nhân viên</h2><p>Thông tin vị trí, tổ chuyên môn và trạng thái làm việc.</p></div>
              {canManageHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
            </div>
            {loading ? <div className="inline-loader">Đang tải danh sách nhân sự...</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>MÃ</th><th>NHÂN VIÊN</th><th>TÀI KHOẢN</th><th>VỊ TRÍ</th><th>TỔ/BỘ PHẬN</th><th>TRẠNG THÁI</th>{canManageHr && <th>THAO TÁC</th>}</tr></thead>
                <tbody>{employees.length ? employees.map((item) => <tr key={item._id}><td><strong>{item.employeeCode}</strong></td><td><strong>{item.fullName}</strong><small>{item.phone || 'Chưa có số điện thoại'}</small></td><td>{item.userId ? <><strong>@{item.userId.username}</strong><small>{roleText[item.userId.role] || item.userId.role}</small></> : <span className="account-unlinked">Chưa liên kết</span>}</td><td>{positionText[item.position] || item.position}</td><td>{item.departmentName || 'Chưa phân công'}</td><td><span className={`student-status ${item.status === 'active' ? 'enrolled' : 'temporarily_absent'}`}>{item.status === 'active' ? 'Đang làm việc' : 'Đã nghỉ việc'}</span></td>{canManageHr && <td><button className="button button-secondary department-edit" onClick={() => openEmployeeForm(item)}>Sửa / Gán TK</button></td>}</tr>) : <tr><td colSpan={canManageHr ? '7' : '6'} className="history-empty">Chưa có hồ sơ nhân viên.</td></tr>}</tbody>
              </table></div>
            )}
            {canManageHr && <section className="staff-account-panel"><div><p className="card-kicker">TÀI KHOẢN NỘI BỘ & BẢNG LƯƠNG</p><h3>{unlinkedAccounts.length ? `${unlinkedAccounts.length} tài khoản chưa có hồ sơ nhân sự` : 'Tất cả tài khoản nội bộ đã được liên kết'}</h3><p>Các vai trò được tính lương gồm Hiệu trưởng, Giáo viên, Kế toán, Bếp và Bảo vệ. Phụ huynh luôn bị loại trừ.</p>{unlinkedAccounts.length > 0 && <button className="button button-primary staff-sync-button" onClick={synchronizeStaffAccounts}><Icon name="users" size={15} /> Đồng bộ {unlinkedAccounts.length} tài khoản</button>}</div>{unlinkedAccounts.length > 0 && <div className="staff-account-list">{unlinkedAccounts.map((account) => <article key={account._id}><span className="staff-account-avatar">{(account.profile?.fullName || account.username).slice(0, 1).toUpperCase()}</span><div><strong>{account.profile?.fullName || account.username}</strong><small>@{account.username} · {roleText[account.role] || account.role}{account.employeeInfo?.baseSalary > 0 ? ' · Đã có mức lương' : ' · Chưa đặt lương'}</small></div><button className="button button-secondary" onClick={() => openEmployeeForm(null, account)}>Thiết lập riêng</button></article>)}</div>}</section>}
          </section>
        )}

        {tab === 'departments' && (
          <section className="content-card student-list-card department-list-card">
            <div className="list-toolbar">
              <div><p className="card-kicker">CƠ CẤU NHÂN SỰ</p><h2>Tổ & Bộ phận</h2><p>Thiết lập các đơn vị để phân công nhân viên và tổng hợp dữ liệu nhân sự.</p></div>
              {canManageHr && <button className="button button-primary" onClick={() => openDepartmentForm()}><Icon name="plus" size={15} /> Thêm tổ/bộ phận</button>}
            </div>
            {loading ? <div className="inline-loader">Đang tải tổ/bộ phận...</div> : <>
              {departments.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>MÃ</th><th>TÊN TỔ/BỘ PHẬN</th><th>MÔ TẢ</th><th>NHÂN SỰ</th><th>TRẠNG THÁI</th>{canManageHr && <th>THAO TÁC</th>}</tr></thead><tbody>{departments.map((item) => { const members = employees.filter((employee) => String(employee.departmentId?._id || employee.departmentId || '') === String(item._id)); return <tr key={item._id}><td><strong>{item.code}</strong></td><td><strong>{item.name}</strong></td><td>{item.description || 'Chưa có mô tả'}</td><td><strong>{members.length} người</strong><small>{members.length ? members.map((member) => member.fullName).join(', ') : 'Chưa phân công nhân sự'}</small></td><td><span className={`student-status ${item.status === 'inactive' ? 'temporarily_absent' : 'enrolled'}`}>{item.status === 'inactive' ? 'Tạm ngưng' : 'Đang hoạt động'}</span></td>{canManageHr && <td><button className="button button-secondary department-edit" onClick={() => openDepartmentForm(item)}>Sửa</button></td>}</tr>; })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Icon name="grid" /></span><strong>Chưa có tổ hoặc bộ phận</strong><p>Tạo đơn vị đầu tiên để bắt đầu phân công nhân viên.</p>{canManageHr && <button className="button button-primary" onClick={() => openDepartmentForm()}>Tạo tổ/bộ phận</button>}</div>}
            </>}
          </section>
        )}

        {tab === 'leaves' && (
          <section className="content-card student-list-card">
            <div className="card-heading"><div><p className="card-kicker">ĐƠN NGHỈ PHÉP</p><h2>Chờ phê duyệt</h2><p>{leaves.length} đơn cần được xem xét trước khi chốt công.</p></div></div>
            <div className="table-wrap"><table className="data-table"><thead><tr><th>NHÂN VIÊN</th><th>LOẠI NGHỈ</th><th>THỜI GIAN</th><th>LÝ DO</th><th>THAO TÁC</th></tr></thead><tbody>
              {leaves.length ? leaves.map((item) => <tr key={item._id}><td><strong>{item.employeeName}</strong><small>{item.departmentName || 'Chưa phân tổ'}</small></td><td>{item.leaveType}</td><td>{new Date(item.startDate).toLocaleDateString('vi-VN')} – {new Date(item.endDate).toLocaleDateString('vi-VN')}</td><td>{item.reason}</td><td><div className="leave-actions"><button className="button button-primary" onClick={() => processLeave(item._id, true)}>Duyệt</button><button className="button button-secondary" onClick={() => processLeave(item._id, false)}>Từ chối</button></div></td></tr>) : <tr><td colSpan="5" className="history-empty">Không có đơn nghỉ phép chờ duyệt.</td></tr>}
            </tbody></table></div>
          </section>
        )}

        {tab === 'payroll' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar"><div><p className="card-kicker">BẢNG LƯƠNG</p><h2>Kỳ lương {period.month}/{period.year}</h2><p>Tổng hợp từ dữ liệu chấm công đã chốt.</p></div><div className="toolbar-buttons"><label>THÁNG<input type="number" min="1" max="12" value={period.month} onChange={(e) => setPeriod({ ...period, month: Number(e.target.value) })} /></label><label>NĂM<input type="number" value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} /></label><button className="button button-primary" onClick={buildPayroll}>Tính lương</button></div></div>
            <div className="table-wrap"><table className="data-table"><thead><tr><th>NHÂN VIÊN</th><th>NGÀY CÔNG</th><th>LƯƠNG GỘP</th><th>THỰC LĨNH</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>
              {payrolls.length ? payrolls.map((item) => <tr key={item._id}><td><strong>{item.employeeName}</strong><small>{item.employeeCode}</small></td><td>{item.actualWorkDays} công + {item.paidLeaveDays} phép</td><td>{money(item.grossSalary)}</td><td><strong>{money(item.netSalary)}</strong></td><td><span className={`student-status status-${item.status}`}>{statusText[item.status] || item.status}</span></td><td>{item.status === 'draft' && <button className="button button-secondary" onClick={async () => { await updatePayrollStatus(item._id, { status: 'confirmed' }); load(); }}>Xác nhận</button>}</td></tr>) : <tr><td colSpan="6" className="history-empty">Chưa có bảng lương cho kỳ này.</td></tr>}
            </tbody></table></div>
          </section>
        )}
      </section>

      {showForm && <div className="modal-backdrop"><form className="content-card student-form hr-modal" onSubmit={submitEmployee}><div className="card-heading"><div><p className="card-kicker">HỒ SƠ NHÂN SỰ</p><h2>{editingEmployee ? 'Cập nhật nhân viên' : 'Thêm nhân viên'}</h2></div><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Đóng</button></div><p className="department-form-note">Liên kết tài khoản để người này đăng nhập đúng vai trò và hồ sơ được dùng cho phân công, nghỉ phép, chấm công và bảng lương.</p><div className="student-form-grid"><label className="form-wide">Tài khoản đăng nhập<select value={form.userId} onChange={(e) => chooseStaffAccount(e.target.value)}><option value="">Chưa liên kết tài khoản</option>{staffAccounts.map((account) => { const unavailable = Boolean(account.employeeProfile && String(account.employeeProfile._id) !== String(editingEmployee?._id)); return <option key={account._id} value={account._id} disabled={unavailable}>{account.profile?.fullName || account.username} · @{account.username} · {roleText[account.role] || account.role}{unavailable ? ' (đã gán)' : ''}</option>; })}</select><small>Chỉ có thể liên kết tài khoản Hiệu trưởng, Giáo viên, Kế toán, Bếp hoặc Bảo vệ. Một tài khoản chỉ thuộc một hồ sơ.</small></label><label>Mã nhân viên<input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="VD: GV-2026-001" required /></label><label>Họ và tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nhập họ và tên đầy đủ" required /></label><label>Số điện thoại<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="VD: 0901 234 567" required /></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@truong.edu.vn" /></label><label>Tổ/bộ phận<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">Chưa phân công</option>{departments.filter((item) => item.status !== 'inactive').map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Vị trí<select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="principal">Hiệu trưởng</option><option value="vice_principal">Phó hiệu trưởng</option><option value="teacher">Giáo viên</option><option value="head_teacher">Tổ trưởng chuyên môn</option><option value="assistant_teacher">Trợ giảng</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="security">Bảo vệ</option></select></label><label className="form-wide">Lương cơ bản (VNĐ)<input type="number" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} required /></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Hủy</button><button className="button button-primary">{editingEmployee ? 'Lưu thay đổi' : 'Lưu hồ sơ'}</button></div></form></div>}
      {showDepartmentForm && <div className="modal-backdrop"><form className="content-card student-form hr-modal department-modal" onSubmit={submitDepartment}><div className="card-heading"><div><p className="card-kicker">CƠ CẤU NHÂN SỰ</p><h2>{departmentForm.id ? 'Cập nhật tổ/bộ phận' : 'Thêm tổ/bộ phận'}</h2></div><button type="button" className="button button-secondary" onClick={() => setShowDepartmentForm(false)}>Đóng</button></div><p className="department-form-note">Dùng tổ/bộ phận để phân công nhân sự, ví dụ: Tổ chuyên môn, Hành chính – kế toán hoặc Bếp ăn.</p><div className="student-form-grid"><label>Mã tổ/bộ phận<input value={departmentForm.code} onChange={(e) => setDepartmentForm({ ...departmentForm, code: e.target.value.toUpperCase() })} placeholder="Ví dụ: TO_CHUYEN_MON" maxLength="30" required /><small>Mã viết hoa, không trùng với đơn vị khác.</small></label><label>Tên tổ/bộ phận<input value={departmentForm.name} onChange={(e) => setDepartmentForm({ ...departmentForm, name: e.target.value })} placeholder="Ví dụ: Tổ chuyên môn" maxLength="100" required /><small>Tên sẽ hiển thị khi phân công nhân viên.</small></label><label className="form-wide">Mô tả<textarea value={departmentForm.description} onChange={(e) => setDepartmentForm({ ...departmentForm, description: e.target.value })} placeholder="Ví dụ: Phụ trách chuyên môn các khối mẫu giáo." maxLength="500" /><small>Không bắt buộc, giúp làm rõ nhiệm vụ của đơn vị.</small></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowDepartmentForm(false)}>Hủy</button><button className="button button-primary">{departmentForm.id ? 'Lưu thay đổi' : 'Tạo tổ/bộ phận'}</button></div></form></div>}
    </AppShell>
  );
}
