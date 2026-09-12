/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  createEmployee,
  generatePayroll,
  getDepartments,
  getEmployeeLeaves,
  getEmployees,
  getPayroll,
  reviewEmployeeLeave,
  updatePayrollStatus
} from '../api/hr';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const currentMonth = new Date().getMonth() + 1;
const currentYear = new Date().getFullYear();
const statusText = { draft: 'Bản nháp', confirmed: 'Đã xác nhận', paid: 'Đã chi trả' };

export default function EmployeeManagement() {
  const [tab, setTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [payrolls, setPayrolls] = useState([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [period, setPeriod] = useState({ month: currentMonth, year: currentYear });
  const [form, setForm] = useState({
    employeeCode: '', fullName: '', phone: '', email: '', departmentId: '', position: 'teacher', baseSalary: 7000000
  });

  const load = async () => {
    setLoading(true);
    try {
      const [employeeRes, departmentRes, leaveRes, payrollRes] = await Promise.all([
        getEmployees(), getDepartments(), getEmployeeLeaves({ status: 'pending' }), getPayroll(period)
      ]);
      setEmployees(employeeRes.data.data || []);
      setDepartments(departmentRes.data.data || []);
      setLeaves(leaveRes.data.data || []);
      setPayrolls(payrollRes.data.data?.payrolls || []);
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
      await createEmployee({
        ...form,
        salaryConfig: { baseSalary: Number(form.baseSalary), positionAllowance: 0, lunchAllowance: 0 }
      });
      setShowForm(false);
      setForm({ employeeCode: '', fullName: '', phone: '', email: '', departmentId: '', position: 'teacher', baseSalary: 7000000 });
      await load();
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể tạo hồ sơ nhân viên.');
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
      actions={<button className="button button-primary" onClick={() => setShowForm(true)}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
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
              <button className="button button-primary" onClick={() => setShowForm(true)}><Icon name="plus" size={15} /> Thêm nhân viên</button>
            </div>
            {loading ? <div className="inline-loader">Đang tải danh sách nhân sự...</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>MÃ</th><th>NHÂN VIÊN</th><th>VỊ TRÍ</th><th>TỔ/BỘ PHẬN</th><th>TRẠNG THÁI</th></tr></thead>
                <tbody>{employees.length ? employees.map((item) => <tr key={item._id}><td><strong>{item.employeeCode}</strong></td><td><strong>{item.fullName}</strong><small>{item.phone || 'Chưa có số điện thoại'}</small></td><td>{item.position}</td><td>{item.departmentName || 'Chưa phân công'}</td><td><span className="student-status enrolled">{item.status === 'active' ? 'Đang làm việc' : item.status}</span></td></tr>) : <tr><td colSpan="5" className="history-empty">Chưa có hồ sơ nhân viên.</td></tr>}</tbody>
              </table></div>
            )}
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

      {showForm && <div className="modal-backdrop"><form className="content-card student-form hr-modal" onSubmit={submitEmployee}><div className="card-heading"><div><p className="card-kicker">HỒ SƠ NHÂN SỰ</p><h2>Thêm nhân viên</h2></div><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Đóng</button></div><div className="student-form-grid"><label>Mã nhân viên<input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="VD: GV-2026-001" required /></label><label>Họ và tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nhập họ và tên đầy đủ" required /></label><label>Số điện thoại<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="VD: 0901 234 567" required /></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@truong.edu.vn" /></label><label>Tổ/bộ phận<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">Chưa phân công</option>{departments.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label><label>Vị trí<select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="teacher">Giáo viên</option><option value="assistant_teacher">Trợ giảng</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="security">Bảo vệ</option></select></label><label className="form-wide">Lương cơ bản (VNĐ)<input type="number" min="0" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} required /></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Hủy</button><button className="button button-primary">Lưu hồ sơ</button></div></form></div>}
    </AppShell>
  );
}
