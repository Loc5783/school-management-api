/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StaffingManagement from '../components/StaffingManagement';
import StudentTransferManagement from '../components/StudentTransferManagement';
import ParentEvaluationReportView from '../components/ParentEvaluationReportView';
import DailyTimekeeping from '../components/DailyTimekeeping';
import OvertimeManagement from '../components/OvertimeManagement';
import EmployeeLeaveManagement from '../components/EmployeeLeaveManagement';
import CredentialManagement from '../components/CredentialManagement';
import StaffDevelopment from '../components/StaffDevelopment';
import StaffHandoverManagement from '../components/StaffHandoverManagement';
import InternalCommunicationManagement from '../components/InternalCommunicationManagement';
import HrReports from '../components/HrReports';
import HrAuditJournal from '../components/HrAuditJournal';
import StaffPersonalRequests from '../components/StaffPersonalRequests';
import {
  createEmployee,
  getEmployees,
  getEmployeeHistory,
  getStaffAccounts,
  syncStaffAccounts,
  updateEmployee
} from '../api/hr';
import {
  getPendingCorrections,
  approveCorrection,
  rejectCorrection,
  recalculateAttendance
} from '../api/timekeeping';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const LOW_MONTHLY_SALARY = 1000000;
const salaryInMonth = (form) => Number(form.baseSalary || 0) * (form.salaryUnit === 'daily' ? Number(form.standardWorkDays || 26) : 1);

const positionText = {
  principal: 'Hiệu trưởng', vice_principal: 'Phó hiệu trưởng', teacher: 'Giáo viên',
  head_teacher: 'Tổ trưởng chuyên môn', assistant_teacher: 'Trợ giảng',
  accountant: 'Kế toán', chef: 'Nhân viên bếp', hr: 'Nhân sự (HR)', security: 'Bảo vệ'
};
const roleText = { admin: 'Quản trị hệ thống', principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự (HR)' };
const payrollRoleText = { principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự (HR)' };
const payrollRoleFromAccountRole = (role) => ({
  admin: 'principal', principal: 'principal', teacher: 'teacher', accountant: 'accountant', chef: 'chef', guard: 'guard', hr: 'hr'
}[role] || 'teacher');
const emptyEmployeeForm = {
  userId: '', employeeCode: '', fullName: '', phone: '', email: '', address: '', position: 'teacher', payrollRole: 'teacher', baseSalary: '', salaryUnit: 'monthly', standardWorkDays: 26, lowMonthlySalaryConfirmed: false,
  startDate: '', contractType: '', contractNumber: '', contractSignedDate: '', contractStartDate: '', endDate: ''
};
const profileDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';
const contractTypeText = { probation: 'Thử việc', fixed_1_year: 'Xác định 1 năm', fixed_3_year: 'Xác định 3 năm', indefinite: 'Không xác định thời hạn' };
const profileFieldText = { employeeCode: 'Mã nhân viên', fullName: 'Họ và tên', phone: 'Số điện thoại', email: 'Email', address: 'Địa chỉ', position: 'Chức danh', payrollRole: 'Vai trò tính lương', startDate: 'Ngày vào làm', contractType: 'Loại hợp đồng', contractNumber: 'Số hợp đồng', contractSignedDate: 'Ngày ký', contractStartDate: 'Ngày hiệu lực', endDate: 'Ngày hết hạn', status: 'Tình trạng', userId: 'Tài khoản liên kết', baseSalary: 'Lương cơ bản theo tháng', standardWorkDays: 'Số ngày công chuẩn', lowMonthlySalaryConfirmed: 'Đã xác minh lương tháng thấp' };

export default function EmployeeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab = searchParams.get('tab') || 'employees';
  const validTabs = ['employees', 'staffing', 'transfers', 'timekeeping', 'leave', 'credentials', 'development', 'parent-evaluations', 'handover', 'internal', 'reports', 'requests', 'audit'];
  const [tab, setTab] = useState(validTabs.includes(initialTab) ? initialTab : 'employees');

  useEffect(() => {
    if (searchParams.get('tab') === 'payroll') {
      navigate('/payroll', { replace: true });
    }
  }, [searchParams, navigate]);
  const [staffingDate, setStaffingDate] = useState('');
  const [employees, setEmployees] = useState([]);
  const [staffAccounts, setStaffAccounts] = useState([]);
  const [pendingCorrections, setPendingCorrections] = useState([]);
  const [selectedRecalcDate, setSelectedRecalcDate] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [profileHistory, setProfileHistory] = useState(null);
  const [form, setForm] = useState(emptyEmployeeForm);
  const [handoverEmployee, setHandoverEmployee] = useState(null);

  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const currentUserId = JSON.parse(localStorage.getItem('user') || '{}')._id;
  const canOperateHr = ['admin', 'hr'].includes(role);
  const canManageHr = canOperateHr;
  const canReviewHr = canOperateHr || role === 'principal';
  const canApproveTimekeeping = ['admin', 'principal'].includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [employeeRes, correctionRes, staffAccountRes] = await Promise.all([
        getEmployees(),
        canApproveTimekeeping ? getPendingCorrections() : Promise.resolve({ data: { data: [] } }),
        canManageHr ? getStaffAccounts() : Promise.resolve({ data: { data: [] } })
      ]);
      setEmployees(employeeRes.data.data || []);
      setPendingCorrections(correctionRes.data.data || []);
      setStaffAccounts(staffAccountRes.data.data || []);
      setNotice('');
      return true;
    } catch (err) {
      setNotice(err.response?.data?.message || 'Không thể tải dữ liệu nhân sự.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [canManageHr, canApproveTimekeeping]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const allowed = ['employees', 'timekeeping', 'requests', ...(role === 'admin' ? ['audit'] : []), ...(canManageHr ? ['staffing', 'transfers', 'credentials', 'development', 'handover', 'internal'] : []), ...(canReviewHr ? ['leave', 'reports', 'parent-evaluations'] : [])];
    setTab(allowed.includes(initialTab) ? initialTab : 'employees');
  }, [initialTab, canManageHr, canReviewHr, role]);

  const changeTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  const submitEmployee = async (event) => {
    event.preventDefault();
    try {
      const monthlySalary = salaryInMonth(form);
      if (!Number.isSafeInteger(monthlySalary) || monthlySalary < 0) { setFormError('Mức lương phải là số nguyên VND hợp lệ.'); return; }
      if (monthlySalary > 0 && monthlySalary < LOW_MONTHLY_SALARY && !form.lowMonthlySalaryConfirmed) { setFormError('Hãy xác nhận rõ đây là lương theo tháng, hoặc đổi sang nhập tiền một công.'); return; }
      const payload = {
        ...form,
        userId: form.userId || '',
        salaryConfig: { ...(editingEmployee?.salaryConfig || {}), baseSalary: monthlySalary, standardWorkDays: Number(form.standardWorkDays), lowMonthlySalaryConfirmed: monthlySalary > 0 && monthlySalary < LOW_MONTHLY_SALARY ? form.lowMonthlySalaryConfirmed : false }
      };
      if (editingEmployee) await updateEmployee(editingEmployee._id, payload);
      else await createEmployee(payload);
      setShowForm(false);
      setFormError('');
      setEditingEmployee(null);
      setForm(emptyEmployeeForm);
      await load();
      setNotice(editingEmployee ? 'Đã cập nhật hồ sơ và liên kết tài khoản nhân sự.' : 'Đã tạo hồ sơ nhân sự.');
    } catch (err) {
      setFormError(err.response?.data?.message || 'Không thể lưu hồ sơ nhân viên.');
    }
  };

  const openEmployeeForm = (employee = null, account = null) => {
    setFormError('');
    const populatedAccount = employee?.userId && typeof employee.userId === 'object' ? employee.userId : null;
    const linkedAccount = account || staffAccounts.find((item) => String(item._id) === String(populatedAccount?._id || employee?.userId)) || populatedAccount;
    setEditingEmployee(employee);
    setForm({
      userId: String(linkedAccount?._id || employee?.userId?._id || employee?.userId || ''),
      employeeCode: employee?.employeeCode || linkedAccount?.employeeInfo?.employeeId || '',
      fullName: employee?.fullName || linkedAccount?.profile?.fullName || '',
      phone: employee?.phone || linkedAccount?.profile?.phone || '',
      email: employee?.email || linkedAccount?.profile?.email || '',
      address: employee?.address || '',
      startDate: profileDate(employee?.startDate),
      contractType: employee?.contractType || '',
      contractNumber: employee?.contractNumber || '',
      contractSignedDate: profileDate(employee?.contractSignedDate),
      contractStartDate: profileDate(employee?.contractStartDate),
      endDate: profileDate(employee?.endDate),
      position: employee?.position || linkedAccount?.employeeInfo?.position || linkedAccount?.suggestedPosition || 'teacher',
      payrollRole: linkedAccount?.role
        ? payrollRoleFromAccountRole(linkedAccount.role)
        : (employee?.payrollRole || linkedAccount?.suggestedPayrollRole || 'teacher'),
      baseSalary: employee?.salaryConfig?.baseSalary ?? linkedAccount?.employeeInfo?.baseSalary ?? '',
      salaryUnit: 'monthly', standardWorkDays: employee?.salaryConfig?.standardWorkDays || 26,
      lowMonthlySalaryConfirmed: employee?.salaryConfig?.lowMonthlySalaryConfirmed === true
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
      baseSalary: current.baseSalary || account?.employeeInfo?.baseSalary || '', lowMonthlySalaryConfirmed: false
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



  const openProfileHistory = async (employee) => {
    try {
      const response = await getEmployeeHistory(employee._id);
      setProfileHistory({ employee, records: response.data.data, createdAt: response.data.createdAt });
    } catch (error) { setNotice(error.response?.data?.message || 'Không thể tải lịch sử hồ sơ.'); }
  };

  return (
    <AppShell
      title="Nhân sự"
      subtitle="Quản lý hồ sơ nhân viên, phân công công việc, chấm công và đánh giá."
      actions={canOperateHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
    >
      <section className="hr-workspace">
        {notice && <div className="form-error">{notice}</div>}

        <div className="hr-summary">
          <article><span><Icon name="users" size={19} /></span><div><small>NHÂN SỰ ĐANG QUẢN LÝ</small><strong>{employees.length} hồ sơ</strong></div></article>
          <article><span><Icon name="clock" size={19} /></span><div><small>ĐƠN CÔNG BÙ CHỜ DUYỆT</small><strong>{pendingCorrections.length} đơn</strong></div></article>
          <article><span><Icon name="shield" size={19} /></span><div><small>CHƯA LIÊN KẾT HỒ SƠ</small><strong>{staffAccounts.filter((acc) => !acc.employeeProfile).length} tài khoản</strong></div></article>
        </div>

        <section className="content-card timekeeping-hub">
          <div className="timekeeping-hub-tabs">
            {[
              ['employees', 'Hồ sơ nhân sự', 'users'],
              ...(canManageHr ? [['staffing', 'Phân công công việc', 'classes']] : []),
              ...(canManageHr ? [['transfers', 'Chuyển lớp học sinh', 'students']] : []),
              ['timekeeping', canApproveTimekeeping ? 'Quản lý & duyệt chấm công' : 'Theo dõi chấm công', 'clock'],
              ...(canReviewHr ? [['leave', 'Nghỉ phép nhân viên', 'calendar']] : []),
              ...(canManageHr ? [['credentials', 'Năng lực & giấy tờ', 'shield']] : []),
              ...(canManageHr ? [['development', 'Đào tạo chuyên môn', 'users']] : []),
              ...(canReviewHr ? [['parent-evaluations', 'Đánh giá phụ huynh', 'chat']] : []),
              ...(canManageHr ? [['handover', 'Bàn giao & nghỉ việc', 'users']] : []),
              ...(canManageHr ? [['internal', 'Thông báo nội bộ', 'calendar']] : []),
              ...(canReviewHr ? [['reports', 'Báo cáo nhân sự', 'chart']] : []),
              ['requests', 'Yêu cầu nhân viên', 'card'],
              ...(role === 'admin' ? [['audit', 'Nhật ký & Quyền dữ liệu', 'clock']] : [])
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
              {canOperateHr && <button className="button button-primary" onClick={() => openEmployeeForm()}><Icon name="plus" size={15} /> Thêm nhân viên</button>}
            </div>
            {loading ? <div className="inline-loader">Đang tải danh sách nhân sự...</div> : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>MÃ</th><th>NHÂN VIÊN</th><th>TÀI KHOẢN</th><th>VAI TRÒ TÍNH LƯƠNG</th><th>CHỨC DANH</th><th>TRẠNG THÁI</th>{canOperateHr && <th>THAO TÁC</th>}</tr></thead>
                <tbody>{employees.length ? employees.map((item) => { const effectiveRole = item.userId?.role ? payrollRoleFromAccountRole(item.userId.role) : item.payrollRole; const canResign = canOperateHr && item.status !== 'resigned' && String(item.userId?._id || item.userId || '') !== String(currentUserId) && !(role === 'hr' && ['admin', 'principal'].includes(item.userId?.role)); return <tr key={item._id}><td><strong>{item.employeeCode}</strong></td><td><strong>{item.fullName}</strong><small>{item.phone || 'Chưa có số điện thoại'}</small></td><td>{item.userId ? <><strong>@{item.userId.username}</strong><small>{roleText[item.userId.role] || item.userId.role}</small></> : <span className="account-unlinked">Chưa liên kết</span>}</td><td><span className="account-role-badge">{payrollRoleText[effectiveRole] || payrollRoleText.teacher}</span></td><td>{positionText[item.position] || item.position}</td><td><span className={`student-status ${item.status === 'active' ? 'enrolled' : 'temporarily_absent'}`}>{item.status === 'active' ? 'Đang làm việc' : item.status === 'resigned' ? 'Đã nghỉ việc' : 'Đang nghỉ phép'}</span></td>{canOperateHr && <td><div className="classroom-actions"><button className="button button-secondary" onClick={() => openProfileHistory(item)}>Hồ sơ / Lịch sử</button>{item.status !== 'resigned' && <button className="button button-secondary department-edit" onClick={() => openEmployeeForm(item)}>Sửa / Gán TK</button>}{canResign && <button className="button button-danger" onClick={() => { setHandoverEmployee(item); changeTab('handover'); }}>Bàn giao / Nghỉ việc</button>}</div></td>}</tr>; }) : <tr><td colSpan={canOperateHr ? '7' : '6'} className="history-empty">Chưa có hồ sơ nhân viên.</td></tr>}</tbody>
              </table></div>
            )}
            {canOperateHr && <section className="staff-account-panel"><div><p className="card-kicker">TÀI KHOẢN NỘI BỘ & BẢNG LƯƠNG</p><h3>{unlinkedAccounts.length ? `${unlinkedAccounts.length} tài khoản chưa có hồ sơ nhân sự` : 'Tất cả tài khoản nội bộ đã được liên kết'}</h3><p>Lương được tổng hợp theo vai trò: Hiệu trưởng, Giáo viên, Kế toán, Bếp, Bảo vệ và Nhân sự. Phụ huynh luôn bị loại trừ.</p>{unlinkedAccounts.length > 0 && <button className="button button-primary staff-sync-button" onClick={synchronizeStaffAccounts}><Icon name="users" size={15} /> Đồng bộ {unlinkedAccounts.length} tài khoản</button>}</div>{unlinkedAccounts.length > 0 && <div className="staff-account-list">{unlinkedAccounts.map((account) => <article key={account._id}><span className="staff-account-avatar">{(account.profile?.fullName || account.username).slice(0, 1).toUpperCase()}</span><div><strong>{account.profile?.fullName || account.username}</strong><small>@{account.username} · {roleText[account.role] || account.role}{account.employeeInfo?.baseSalary > 0 ? ' · Đã có mức lương' : ' · Chưa đặt lương'}</small></div><button className="button button-secondary" onClick={() => openEmployeeForm(null, account)}>Thiết lập riêng</button></article>)}</div>}</section>}
          </section>
        )}

        {tab === 'staffing' && canManageHr && <StaffingManagement employees={employees} initialDate={staffingDate} />}
        {tab === 'transfers' && canManageHr && <StudentTransferManagement />}
        {tab === 'credentials' && canManageHr && <CredentialManagement />}

        {tab === 'development' && canManageHr && <StaffDevelopment />}
        {tab === 'parent-evaluations' && canReviewHr && <ParentEvaluationReportView />}
        {tab === 'handover' && canManageHr && <StaffHandoverManagement preselectedEmployee={handoverEmployee} />}
        {tab === 'internal' && canManageHr && <InternalCommunicationManagement />}
        {tab === 'reports' && canReviewHr && <HrReports />}
        {tab === 'audit' && role === 'admin' && <HrAuditJournal />}
        {tab === 'requests' && <StaffPersonalRequests mode="manage" />}
        {tab === 'leave' && canReviewHr && <EmployeeLeaveManagement canApprove={canApproveTimekeeping} onOpenStaffing={(date) => { setStaffingDate(date); changeTab('staffing'); }} />}

        {tab === 'timekeeping' && (
          <div className="timekeeping-management-container">
            {canManageHr && <DailyTimekeeping />}
            {canApproveTimekeeping && <OvertimeManagement employees={employees} canApprove={canApproveTimekeeping} />}
            <section className="content-card student-list-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">PHÊ DUYỆT CHẤM CÔNG</p>
                  <h2>Đơn chấm công bù chờ duyệt ({pendingCorrections.length})</h2>
                  <p>{canApproveTimekeeping ? 'Phê duyệt đơn giải trình / quên chấm công trước khi chốt dữ liệu tính lương.' : 'Theo dõi đơn giải trình đang chờ Ban giám hiệu xử lý.'}</p>
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
                          {canApproveTimekeeping && <th>THAO TÁC</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pendingCorrections.map((req) => (
                        <tr key={req._id}>
                          <td><strong>{req.employeeName}</strong></td>
                          <td>{new Date(req.workDate).toLocaleDateString('vi-VN')}</td>
                          <td><span className="badge-time">{req.requestedCheckInTime}</span></td>
                          <td>{req.reason}</td>
                          {canApproveTimekeeping && <td>
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
                          </td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {canApproveTimekeeping && <section className="content-card" style={{ marginTop: 20 }}>
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
            </section>}
          </div>
        )}

        
      </section>

{showForm && <div className="modal-backdrop"><form className="content-card student-form hr-modal" onSubmit={submitEmployee}><div className="card-heading"><div><p className="card-kicker">HỒ SƠ NHÂN SỰ</p><h2>{editingEmployee ? 'Cập nhật nhân viên' : 'Thêm nhân viên'}</h2></div><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Đóng</button></div><p className="department-form-note">Vai trò tính lương là trường bắt buộc để tổng hợp bảng lương. Khi liên kết tài khoản, vai trò này phải trùng với quyền đăng nhập của nhân viên.</p><div className="student-form-grid"><label className="form-wide">Tài khoản đăng nhập<select value={form.userId} onChange={(e) => chooseStaffAccount(e.target.value)}><option value="">Chưa liên kết tài khoản</option>{staffAccounts.map((account) => { const unavailable = Boolean(account.employeeProfile && String(account.employeeProfile._id) !== String(editingEmployee?._id)); return <option key={account._id} value={account._id} disabled={unavailable}>{account.profile?.fullName || account.username} · @{account.username} · {roleText[account.role] || account.role}{unavailable ? ' (đã gán)' : ''}</option>; })}</select><small>Liên kết đúng tài khoản để ngăn lệch vai trò, chấm công và bảng lương. Một tài khoản chỉ thuộc một hồ sơ.</small></label><label>Mã nhân viên<input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="VD: GV-2026-001" required /></label><label>Họ và tên<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Nhập họ và tên đầy đủ" required /></label><label>Số điện thoại<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="VD: 0901 234 567" required /></label><label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@truong.edu.vn" /></label><label>Vai trò tính lương<select value={form.payrollRole} onChange={(e) => setForm({ ...form, payrollRole: e.target.value })} disabled={Boolean(form.userId)}><option value="principal">Hiệu trưởng</option><option value="teacher">Giáo viên</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="guard">Bảo vệ</option><option value="hr">Nhân sự (HR)</option></select><small>{form.userId ? 'Được lấy theo vai trò của tài khoản đã liên kết.' : 'Chọn nhóm để tổng hợp lương.'}</small></label><label>Chức danh chi tiết<select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}><option value="principal">Hiệu trưởng</option><option value="vice_principal">Phó hiệu trưởng</option><option value="teacher">Giáo viên</option><option value="head_teacher">Tổ trưởng chuyên môn</option><option value="assistant_teacher">Trợ giảng</option><option value="accountant">Kế toán</option><option value="chef">Nhân viên bếp</option><option value="hr">Nhân sự (HR)</option><option value="security">Bảo vệ</option></select></label><label className="form-wide">Địa chỉ liên hệ<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Địa chỉ hiện tại" /></label><label>Ngày vào làm<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label><label>Tình trạng làm việc<input value={editingEmployee?.status === 'resigned' ? 'Đã nghỉ việc' : editingEmployee?.status === 'on_leave' ? 'Đang nghỉ phép' : 'Đang làm việc'} readOnly /><small>Thay đổi qua quy trình nghỉ phép/nghỉ việc, không sửa trực tiếp.</small></label><label>Loại hợp đồng<select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}><option value="">Chưa cập nhật</option><option value="probation">Thử việc</option><option value="fixed_1_year">Xác định 1 năm</option><option value="fixed_3_year">Xác định 3 năm</option><option value="indefinite">Không xác định thời hạn</option></select></label><label>Số hợp đồng<input value={form.contractNumber} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} placeholder="Số/ký hiệu hợp đồng" /></label><label>Ngày ký hợp đồng<input type="date" value={form.contractSignedDate} onChange={(e) => setForm({ ...form, contractSignedDate: e.target.value })} /></label><label>Ngày hiệu lực<input type="date" value={form.contractStartDate} onChange={(e) => setForm({ ...form, contractStartDate: e.target.value })} /></label><label>Ngày hết hạn<input type="date" value={form.endDate} disabled={form.contractType === 'indefinite'} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label><label className="form-wide">Đơn vị nhập lương<select value={form.salaryUnit} onChange={(e) => setForm({ ...form, salaryUnit: e.target.value, baseSalary: '', lowMonthlySalaryConfirmed: false })}><option value="monthly">Lương theo tháng</option><option value="daily">Tiền một công</option></select></label><label className="form-wide">{form.salaryUnit === 'daily' ? 'Tiền một công (VNĐ)' : 'Lương cơ bản theo tháng (VNĐ)'}<input type="number" min="0" step="1" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value, lowMonthlySalaryConfirmed: false })} required /><small>{form.salaryUnit === 'daily' ? `Hệ thống lưu ${money(salaryInMonth(form))}/tháng = ${money(form.baseSalary)} × ${form.standardWorkDays} công.` : `${money(form.baseSalary)} cho cả tháng; khoảng ${money(Number(form.baseSalary || 0) / Number(form.standardWorkDays || 26))} mỗi công.`}</small></label><label className="form-wide">Số công chuẩn mỗi tháng<input type="number" min="1" max="31" step="1" value={form.standardWorkDays} onChange={(e) => setForm({ ...form, standardWorkDays: e.target.value, lowMonthlySalaryConfirmed: false })} required /></label>{salaryInMonth(form) > 0 && salaryInMonth(form) < LOW_MONTHLY_SALARY && <div className="form-wide salary-unit-warning"><strong>Kiểm tra đơn vị lương</strong><p>{money(salaryInMonth(form))}/tháng tương đương khoảng {money(salaryInMonth(form) / Number(form.standardWorkDays || 26))}/công. Nếu đây là tiền một công, hãy chọn “Tiền một công” ở trên.</p><label><input type="checkbox" checked={form.lowMonthlySalaryConfirmed} onChange={(e) => setForm({ ...form, lowMonthlySalaryConfirmed: e.target.checked })} />Tôi xác nhận đây thực sự là lương cả tháng.</label></div>}{formError && <p className="form-error form-wide" role="alert">{formError}</p>}</div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}>Hủy</button><button className="button button-primary">{editingEmployee ? 'Lưu thay đổi' : 'Lưu hồ sơ'}</button></div></form></div>}
      {profileHistory && <div className="modal-backdrop"><section className="content-card student-form hr-modal hr-profile-history"><div className="card-heading"><div><p className="card-kicker">HỒ SƠ & LỊCH SỬ THAY ĐỔI</p><h2>{profileHistory.employee.fullName}</h2><p>{profileHistory.employee.employeeCode} · {profileHistory.employee.userId?.username ? `@${profileHistory.employee.userId.username}` : 'Chưa liên kết tài khoản'}</p></div><button type="button" className="button button-secondary" onClick={() => setProfileHistory(null)}>Đóng</button></div><div className="hr-profile-facts"><span>Liên hệ: {profileHistory.employee.phone || 'Chưa cập nhật'} · {profileHistory.employee.email || 'Chưa cập nhật'}</span><span>Địa chỉ: {profileHistory.employee.address || 'Chưa cập nhật'}</span><span>Vị trí: {positionText[profileHistory.employee.position] || profileHistory.employee.position}</span><span>Ngày vào làm: {profileHistory.employee.startDate ? new Date(profileHistory.employee.startDate).toLocaleDateString('vi-VN') : 'Chưa cập nhật'}</span><span>Tình trạng: {profileHistory.employee.status === 'resigned' ? 'Đã nghỉ việc' : profileHistory.employee.status === 'on_leave' ? 'Đang nghỉ phép' : 'Đang làm việc'}</span><span>Hợp đồng: {contractTypeText[profileHistory.employee.contractType] || 'Chưa cập nhật'} · {profileHistory.employee.contractNumber || 'Chưa có số hợp đồng'}</span><span>Ngày ký: {profileHistory.employee.contractSignedDate ? new Date(profileHistory.employee.contractSignedDate).toLocaleDateString('vi-VN') : '—'} · Hiệu lực: {profileHistory.employee.contractStartDate ? new Date(profileHistory.employee.contractStartDate).toLocaleDateString('vi-VN') : '—'} · Hết hạn: {profileHistory.employee.endDate ? new Date(profileHistory.employee.endDate).toLocaleDateString('vi-VN') : '—'}</span></div><h3>Lịch sử thay đổi</h3>{profileHistory.records.length ? <div className="hr-profile-events">{profileHistory.records.map((record) => <article key={record._id}><strong>{record.action === 'EMPLOYEE_CREATED' ? 'Tạo hồ sơ' : record.action === 'EMPLOYEE_RESIGNED' ? 'Nghỉ việc / khóa tài khoản' : 'Cập nhật hồ sơ'}</strong><small>{record.actorUsername} · {new Date(record.occurredAt).toLocaleString('vi-VN')}</small>{record.reason && <p>Lý do: {record.reason}</p>}{Object.entries(record.after || {}).map(([key, value]) => <p key={key}>{profileFieldText[key] || key}: {String(record.before?.[key] ?? '—')} → {String(value ?? '—')}</p>)}</article>)}</div> : <p>Hồ sơ có từ {new Date(profileHistory.createdAt).toLocaleDateString('vi-VN')}; chưa có lịch sử chỉnh sửa được ghi nhận kể từ khi bật tính năng này.</p>}</section></div>}
    </AppShell>
  );
}
