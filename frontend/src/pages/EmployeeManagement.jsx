/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StaffingManagement from '../components/StaffingManagement';
import StudentTransferManagement from '../components/StudentTransferManagement';
import DailyTimekeeping from '../components/DailyTimekeeping';
import EmployeeLeaveManagement from '../components/EmployeeLeaveManagement';
import InternalCommunicationManagement from '../components/InternalCommunicationManagement';
import HrAuditJournal from '../components/HrAuditJournal';
import TimekeepingDeviceManagement from '../components/TimekeepingDeviceManagement';
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
import { getStoredUser } from '../utils/storage';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const LOW_MONTHLY_SALARY = 1000000;
const salaryInMonth = (form) => Number(form.baseSalary || 0) * (form.salaryUnit === 'daily' ? Number(form.standardWorkDays || 26) : 1);

const positionText = {
  principal: 'Hiệu trưởng',
  vice_principal: 'Phó hiệu trưởng',
  youth_leader: 'Tổng phụ trách',
  teacher: 'Giáo viên chủ nhiệm',
  head_teacher: 'Tổ trưởng chuyên môn',
  assistant_teacher: 'Giáo viên phụ lớp / Bảo mẫu',
  chief_accountant: 'Kế toán trưởng',
  accountant: 'Kế toán học phí',
  head_chef: 'Trưởng bếp bán trú',
  chef: 'Đầu bếp chính',
  kitchen_helper: 'Phụ bếp / Cấp dưỡng',
  hr: 'Nhân sự (HR)',
  office_admin: 'Hành chính - Văn thư',
  security: 'Bảo vệ & An ninh',
  nurse: 'Nhân viên Y tế',
  cleaner: 'Lao công / Tạp vụ',
  maintenance: 'Kỹ thuật / Bảo trì',
  driver: 'Tài xế đưa đón'
};

const roleText = {
  admin: 'Quản trị trường',
  principal: 'Hiệu trưởng',
  teacher: 'Giáo viên',
  accountant: 'Kế toán',
  chef: 'Nhân viên bếp',
  guard: 'Bảo vệ',
  hr: 'Nhân sự (HR)'
};

const payrollRoleText = {
  principal: 'Ban giám hiệu',
  teacher: 'Giáo viên',
  accountant: 'Kế toán',
  chef: 'Nhân viên bếp',
  guard: 'Bảo vệ',
  hr: 'Nhân sự (HR)'
};

const statusText = {
  active: 'Đang làm việc',
  on_leave: 'Đang nghỉ phép',
  resigned: 'Đã nghỉ việc'
};

const payrollRoleFromAccountRole = (role) => ({
  admin: 'principal',
  principal: 'principal',
  teacher: 'teacher',
  accountant: 'accountant',
  chef: 'chef',
  guard: 'guard',
  hr: 'hr'
}[role] || 'teacher');

const defaultPositionByAccountRole = (accountRole) => ({
  admin: 'principal',
  principal: 'principal',
  teacher: 'teacher',
  accountant: 'accountant',
  chef: 'chef',
  guard: 'security',
  hr: 'hr'
}[accountRole] || 'teacher');

const emptyEmployeeForm = {
  accountMode: 'create_new',
  accountUsername: '',
  accountPassword: '123456',
  accountRole: 'teacher',
  usernameTouched: false,
  userId: '',
  employeeCode: '',
  fullName: '',
  phone: '',
  email: '',
  address: '',
  position: 'teacher',
  payrollRole: 'teacher',
  baseSalary: '',
  salaryUnit: 'monthly',
  standardWorkDays: 26,
  lowMonthlySalaryConfirmed: false,
  startDate: '',
  contractType: '',
  contractNumber: '',
  contractSignedDate: '',
  contractStartDate: '',
  endDate: ''
};

const profileDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const contractTypeText = {
  probation: 'Thử việc',
  fixed_1_year: 'Xác định 1 năm',
  fixed_3_year: 'Xác định 3 năm',
  indefinite: 'Không xác định thời hạn'
};

const profileFieldText = {
  employeeCode: 'Mã nhân viên',
  fullName: 'Họ và tên',
  phone: 'Số điện thoại',
  email: 'Email',
  address: 'Địa chỉ',
  position: 'Chức danh',
  payrollRole: 'Nhóm tính lương',
  startDate: 'Ngày vào làm',
  contractType: 'Loại hợp đồng',
  contractNumber: 'Số hợp đồng',
  contractSignedDate: 'Ngày ký hợp đồng',
  contractStartDate: 'Ngày hiệu lực',
  endDate: 'Ngày hết hạn',
  status: 'Tình trạng làm việc',
  userId: 'Tài khoản liên kết',
  baseSalary: 'Lương cơ bản / tháng',
  standardWorkDays: 'Số ngày công chuẩn',
  lowMonthlySalaryConfirmed: 'Xác nhận lương tháng thấp'
};

/**
 * Việt hóa giá trị trong lịch sử thay đổi hồ sơ nhân sự để người dùng không nhìn thấy mã kỹ thuật thô.
 */
const formatHistoryFieldValue = (key, rawVal) => {
  if (rawVal === null || rawVal === undefined || rawVal === '') return 'Chưa thiết lập';
  if (key === 'position') return positionText[rawVal] || String(rawVal);
  if (key === 'payrollRole') return payrollRoleText[rawVal] || String(rawVal);
  if (key === 'contractType') return contractTypeText[rawVal] || String(rawVal);
  if (key === 'status') return statusText[rawVal] || String(rawVal);
  if (key === 'baseSalary') return money(Number(rawVal) || 0);
  if (key === 'lowMonthlySalaryConfirmed') return rawVal ? 'Đã xác nhận' : 'Chưa xác nhận';
  if (key === 'userId') return rawVal ? 'Đã gắn tài khoản' : 'Chưa gắn tài khoản';
  if (['startDate', 'contractSignedDate', 'contractStartDate', 'endDate'].includes(key)) {
    const parsed = new Date(rawVal);
    return Number.isNaN(parsed.getTime()) ? String(rawVal) : parsed.toLocaleDateString('vi-VN');
  }
  return String(rawVal);
};

export default function EmployeeManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialUser = getStoredUser();
  const userRole = initialUser.role || '';
  const initialTab = searchParams.get('tab') || 'employees';
  const validTabs = ['employees', 'staffing', 'transfers', 'timekeeping', 'devices', 'leave', 'internal', ...(userRole === 'admin' ? ['audit'] : [])];
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
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text: '' }
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [profileHistory, setProfileHistory] = useState(null);
  const [form, setForm] = useState(emptyEmployeeForm);

  // Bộ lọc tìm kiếm nhanh ngay trên bảng Nhân sự
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const role = getStoredUser().role;
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
      return true;
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể tải dữ liệu nhân sự.' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [canManageHr, canApproveTimekeeping]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const allowed = [
      'employees',
      'timekeeping',
      ...(role !== 'accountant' ? ['devices'] : []),
      ...(role === 'admin' ? ['audit'] : []),
      ...(canManageHr ? ['staffing', 'transfers', 'internal'] : []),
      ...(canReviewHr ? ['leave'] : [])
    ];
    setTab(allowed.includes(initialTab) ? initialTab : 'employees');
  }, [initialTab, canManageHr, canReviewHr, role]);

  const changeTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  const submitEmployee = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const monthlySalary = salaryInMonth(form);
      if (!Number.isSafeInteger(monthlySalary) || monthlySalary < 0) {
        setFormError('Mức lương phải là số nguyên VND hợp lệ.');
        return;
      }
      if (monthlySalary > 0 && monthlySalary < LOW_MONTHLY_SALARY && !form.lowMonthlySalaryConfirmed) {
        setFormError('Hãy xác nhận rõ đây là lương theo tháng, hoặc đổi sang nhập tiền một công.');
        return;
      }
      const isCreatingAccountInline = !editingEmployee && form.accountMode === 'create_new';
      if (isCreatingAccountInline) {
        if (String(form.accountUsername || '').trim().length < 3 || /\s/.test(String(form.accountUsername || '').trim())) {
          setFormError('Tên đăng nhập phải từ 3 ký tự trở lên và không chứa khoảng trắng.');
          return;
        }
        if (String(form.accountPassword || '').length < 6) {
          setFormError('Mật khẩu tài khoản khởi tạo phải từ 6 ký tự trở lên.');
          return;
        }
      }
      const payload = {
        ...form,
        userId: form.accountMode === 'link_existing' || editingEmployee ? (form.userId || '') : '',
        ...(isCreatingAccountInline
          ? {
              createAccount: true,
              accountUsername: String(form.accountUsername || '').trim(),
              accountPassword: String(form.accountPassword || '123456'),
              accountRole: form.accountRole || 'teacher'
            }
          : {}),
        salaryConfig: {
          ...(editingEmployee?.salaryConfig || {}),
          baseSalary: monthlySalary,
          standardWorkDays: Number(form.standardWorkDays),
          lowMonthlySalaryConfirmed: monthlySalary > 0 && monthlySalary < LOW_MONTHLY_SALARY ? form.lowMonthlySalaryConfirmed : false
        }
      };
      if (editingEmployee) await updateEmployee(editingEmployee._id, payload);
      else await createEmployee(payload);
      setShowForm(false);
      setFormError('');
      setEditingEmployee(null);
      setForm(emptyEmployeeForm);
      await load();
      setNotice({
        type: 'success',
        text: editingEmployee
          ? 'Đã cập nhật hồ sơ và liên kết tài khoản nhân sự.'
          : isCreatingAccountInline
            ? `Đã tạo đồng thời hồ sơ nhân sự và tài khoản đăng nhập @${String(form.accountUsername).trim()} thành công.`
            : 'Đã tạo hồ sơ nhân sự mới thành công.'
      });
    } catch (err) {
      setFormError(err.response?.data?.message || 'Không thể lưu hồ sơ nhân viên.');
    } finally {
      setSaving(false);
    }
  };

  const openEmployeeForm = (employee = null, account = null) => {
    setFormError('');
    const populatedAccount = employee?.userId && typeof employee.userId === 'object' ? employee.userId : null;
    const linkedAccount = account || staffAccounts.find((item) => String(item._id) === String(populatedAccount?._id || employee?.userId)) || populatedAccount;
    setEditingEmployee(employee);
    setForm({
      accountMode: employee || linkedAccount ? 'link_existing' : 'create_new',
      accountUsername: '',
      accountPassword: '123456',
      accountRole: 'teacher',
      usernameTouched: false,
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
      salaryUnit: 'monthly',
      standardWorkDays: employee?.salaryConfig?.standardWorkDays || 26,
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
      baseSalary: current.baseSalary || account?.employeeInfo?.baseSalary || '',
      lowMonthlySalaryConfirmed: false
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
      setNotice({
        type: 'success',
        text: `${response.data.message}.${needsSalary ? ` Có ${needsSalary} hồ sơ cần thiết lập mức lương trước khi tính lương.` : ''}`
      });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Không thể đồng bộ tài khoản nội bộ.' });
    }
  };

  const handleApproveCorrection = async (id) => {
    if (!window.confirm('Bạn có chắc chắn muốn duyệt đơn chấm công bù này?')) return;
    try {
      const request = pendingCorrections.find((item) => item._id === id);
      await approveCorrection(id, request?.version);
      await load();
      setNotice({ type: 'success', text: 'Đã duyệt đơn chấm công bù thành công.' });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Lỗi khi duyệt đơn chấm công.' });
    }
  };

  const handleRejectCorrection = async (id) => {
    const reason = window.prompt('Nhập lý do từ chối:');
    if (reason === null) return;
    try {
      const request = pendingCorrections.find((item) => item._id === id);
      await rejectCorrection(id, request?.version, reason);
      await load();
      setNotice({ type: 'success', text: 'Đã từ chối đơn chấm công bù.' });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Lỗi khi từ chối đơn chấm công.' });
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
      setNotice({ type: 'success', text: `Đã tính lại công ngày ${selectedRecalcDate} thành công.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.response?.data?.message || 'Lỗi khi tính lại chấm công.' });
    }
  };

  const openProfileHistory = async (employee) => {
    try {
      const response = await getEmployeeHistory(employee._id);
      setProfileHistory({ employee, records: response.data.data || [], createdAt: response.data.createdAt });
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải lịch sử hồ sơ.' });
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((item) => {
      const effectiveRole = item.userId?.role ? payrollRoleFromAccountRole(item.userId.role) : item.payrollRole;
      if (roleFilter !== 'all' && effectiveRole !== roleFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(item.fullName || '').toLowerCase().includes(q) ||
        String(item.employeeCode || '').toLowerCase().includes(q) ||
        String(item.phone || '').toLowerCase().includes(q) ||
        String(item.email || '').toLowerCase().includes(q) ||
        String(item.userId?.username || '').toLowerCase().includes(q)
      );
    });
  }, [employees, searchQuery, roleFilter, statusFilter]);

  const activeCount = employees.filter((item) => item.status === 'active').length;

  const resolveDisplayPosition = (item) => {
    if (item.userId?.role === 'admin') {
      return item.position === 'vice_principal' ? 'Phó hiệu trưởng (QT)' : 'Quản trị trường';
    }
    return positionText[item.position] || item.position || 'Nhân viên';
  };

  return (
    <AppShell
      title="Nhân sự"
      subtitle="Quản lý hồ sơ nhân viên, phân công công việc, chấm công và thông báo nội bộ."
      actions={(
        <div className="toolbar-buttons">
          <button type="button" className="button button-secondary" onClick={load} disabled={loading}>
            <Icon name="refresh" size={15} /> Làm mới
          </button>
          {canOperateHr && tab === 'employees' && (
            <button type="button" className="button button-primary" onClick={() => openEmployeeForm()}>
              <Icon name="plus" size={15} /> Thêm nhân viên
            </button>
          )}
        </div>
      )}
    >
      <section className="hr-workspace">
        {notice && (
          <div className={notice.type === 'error' ? 'form-error' : 'timekeeping-notice success'} role={notice.type === 'error' ? 'alert' : 'status'}>
            <Icon name={notice.type === 'error' ? 'alertCircle' : 'check'} size={16} />
            <span>{notice.text}</span>
          </div>
        )}

        <div className="hr-summary">
          <article>
            <span><Icon name="users" size={19} /></span>
            <div>
              <small>NHÂN SỰ ĐANG LÀM VIỆC</small>
              <strong>{activeCount} / {employees.length} hồ sơ</strong>
            </div>
          </article>
          <article>
            <span><Icon name="clock" size={19} /></span>
            <div>
              <small>ĐƠN CÔNG BÙ CHỜ DUYỆT</small>
              <strong>{pendingCorrections.length} đơn</strong>
            </div>
          </article>
          <article>
            <span><Icon name="shield" size={19} /></span>
            <div>
              <small>{canManageHr ? 'CHƯA LIÊN KẾT HỒ SƠ' : 'ĐÃ LIÊN KẾT TÀI KHOẢN'}</small>
              <strong>
                {canManageHr
                  ? `${unlinkedAccounts.length} tài khoản`
                  : `${employees.filter((e) => Boolean(e.userId)).length} nhân sự`}
              </strong>
            </div>
          </article>
        </div>

        <section className="content-card timekeeping-hub">
          <div className="timekeeping-hub-tabs">
            {[
              ['employees', 'Hồ sơ nhân sự', 'users'],
              ...(canManageHr ? [['staffing', 'Phân công công việc', 'classes']] : []),
              ...(canManageHr ? [['transfers', 'Chuyển lớp học sinh', 'students']] : []),
              ['timekeeping', canApproveTimekeeping ? 'Quản lý & duyệt chấm công' : 'Theo dõi chấm công', 'clock'],
              ['devices', 'Máy chấm công (ISAPI)', 'shield'],
              ...(canReviewHr ? [['leave', 'Nghỉ phép nhân viên', 'calendar']] : []),
              ...(canManageHr ? [['internal', 'Thông báo nội bộ', 'calendar']] : []),
              ...(role === 'admin' ? [['audit', 'Nhật ký & Quyền dữ liệu', 'clock']] : [])
            ].map(([key, label, icon]) => (
              <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => changeTab(key)}>
                <Icon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
        </section>

        {tab === 'employees' && (
          <section className="content-card student-list-card">
            <div className="list-toolbar">
              <div>
                <p className="card-kicker">DANH SÁCH NHÂN SỰ</p>
                <h2>Hồ sơ nhân viên & liên kết tài khoản</h2>
                <p>Hiển thị đầy đủ mã nhân sự, thông tin liên hệ, tài khoản đăng nhập, hợp đồng và mức lương cơ bản.</p>
              </div>
              <span className="history-count">{filteredEmployees.length} / {employees.length} hồ sơ</span>
            </div>

            <div className="student-filters" style={{ padding: '0 22px 16px' }}>
              <label className="search-box">
                <Icon name="search" size={16} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo họ tên, mã nhân viên, SĐT, email hoặc tài khoản..."
                />
              </label>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                <option value="all">Tất cả nhóm vai trò</option>
                <option value="principal">Ban giám hiệu / Quản trị</option>
                <option value="teacher">Giáo viên</option>
                <option value="accountant">Kế toán</option>
                <option value="chef">Nhân viên bếp</option>
                <option value="guard">Bảo vệ</option>
                <option value="hr">Nhân sự (HR)</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Tất cả trạng thái</option>
                <option value="active">Đang làm việc</option>
                <option value="on_leave">Đang nghỉ phép</option>
                <option value="resigned">Đã nghỉ việc</option>
              </select>
            </div>

            {loading ? (
              <div className="inline-loader">Đang tải danh sách nhân sự...</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>MÃ NV</th>
                      <th>HỌ TÊN & LIÊN HỆ</th>
                      <th>TÀI KHOẢN</th>
                      <th>CHỨC DANH / NHÓM LƯƠNG</th>
                      <th>HỢP ĐỒNG</th>
                      <th>LƯƠNG CƠ BẢN</th>
                      <th>TRẠNG THÁI</th>
                      {canOperateHr && <th>THAO TÁC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.length ? filteredEmployees.map((item) => {
                      const effectiveRole = item.userId?.role ? payrollRoleFromAccountRole(item.userId.role) : item.payrollRole;
                      const baseSalary = Number(item.salaryConfig?.baseSalary || 0);
                      return (
                        <tr key={item._id}>
                          <td><strong>{item.employeeCode || '—'}</strong></td>
                          <td>
                            <strong>{item.fullName || 'Chưa cập nhật tên'}</strong>
                            <small style={{ display: 'block', color: '#475569' }}>
                              {item.phone || 'Chưa có SĐT'}{item.email ? ` · ${item.email}` : ''}
                            </small>
                          </td>
                          <td>
                            {item.userId ? (
                              <>
                                <strong>@{item.userId.username}</strong>
                                <small style={{ display: 'block' }}>{roleText[item.userId.role] || item.userId.role}</small>
                              </>
                            ) : (
                              <span className="account-unlinked">Chưa liên kết</span>
                            )}
                          </td>
                          <td>
                            <strong>{resolveDisplayPosition(item)}</strong>
                            <small style={{ display: 'block', color: '#64748b' }}>
                              Nhóm lương: {payrollRoleText[effectiveRole] || payrollRoleText.teacher}
                            </small>
                          </td>
                          <td>
                            <div>{contractTypeText[item.contractType] || 'Chưa cập nhật'}</div>
                            {item.startDate && (
                              <small style={{ color: '#64748b' }}>
                                Vào làm: {new Date(item.startDate).toLocaleDateString('vi-VN')}
                              </small>
                            )}
                          </td>
                          <td>
                            {baseSalary > 0 ? (
                              <strong>{money(baseSalary)}</strong>
                            ) : (
                              <span style={{ color: '#b45309', fontSize: '12px', fontWeight: 600 }}>Chưa thiết lập</span>
                            )}
                          </td>
                          <td>
                            <span className={`student-status ${item.status === 'active' ? 'enrolled' : item.status === 'resigned' ? 'withdrawn' : 'temporarily_absent'}`}>
                              {statusText[item.status] || 'Đang làm việc'}
                            </span>
                          </td>
                          {canOperateHr && (
                            <td>
                              <div className="classroom-actions">
                                <button type="button" className="button button-secondary" onClick={() => openProfileHistory(item)}>
                                  Chi tiết
                                </button>
                                {item.status !== 'resigned' && (
                                  <button type="button" className="button button-secondary department-edit" onClick={() => openEmployeeForm(item)}>
                                    Sửa / Gán TK
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={canOperateHr ? '8' : '7'} className="history-empty">
                          Không tìm thấy hồ sơ nhân sự phù hợp.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {canOperateHr && (
              <section className="staff-account-panel">
                <div>
                  <p className="card-kicker">TÀI KHOẢN NỘI BỘ & BẢNG LƯƠNG</p>
                  <h3>
                    {unlinkedAccounts.length
                      ? `${unlinkedAccounts.length} tài khoản chưa có hồ sơ nhân sự`
                      : 'Tất cả tài khoản nội bộ đã được liên kết'}
                  </h3>
                  <p>
                    Lương được tổng hợp theo nhóm vai trò: Ban giám hiệu, Giáo viên, Kế toán, Bếp, Bảo vệ và Nhân sự. Phụ huynh luôn được tách biệt.
                  </p>
                  {unlinkedAccounts.length > 0 && (
                    <button type="button" className="button button-primary staff-sync-button" onClick={synchronizeStaffAccounts}>
                      <Icon name="users" size={15} /> Đồng bộ {unlinkedAccounts.length} tài khoản
                    </button>
                  )}
                </div>
                {unlinkedAccounts.length > 0 && (
                  <div className="staff-account-list">
                    {unlinkedAccounts.map((account) => (
                      <article key={account._id}>
                        <span className="staff-account-avatar">{(account.profile?.fullName || account.username).slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{account.profile?.fullName || account.username}</strong>
                          <small>
                            @{account.username} · {roleText[account.role] || account.role}
                            {account.employeeInfo?.baseSalary > 0 ? ' · Đã có mức lương' : ' · Chưa đặt lương'}
                          </small>
                        </div>
                        <button type="button" className="button button-secondary" onClick={() => openEmployeeForm(null, account)}>
                          Thiết lập riêng
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>
        )}

        {tab === 'staffing' && canManageHr && <StaffingManagement employees={employees} initialDate={staffingDate} />}
        {tab === 'transfers' && canManageHr && <StudentTransferManagement />}
        {tab === 'internal' && canManageHr && <InternalCommunicationManagement />}
        {tab === 'audit' && role === 'admin' && <HrAuditJournal />}
        {tab === 'leave' && canReviewHr && (
          <EmployeeLeaveManagement
            canApprove={canApproveTimekeeping}
            onOpenStaffing={(date) => { setStaffingDate(date); changeTab('staffing'); }}
          />
        )}

        {tab === 'timekeeping' && (
          <div className="timekeeping-management-container">
            {canManageHr && <DailyTimekeeping />}
            <section className="content-card student-list-card">
              <div className="card-heading">
                <div>
                  <p className="card-kicker">PHÊ DUYỆT CHẤM CÔNG</p>
                  <h2>Đơn chấm công bù chờ duyệt ({pendingCorrections.length})</h2>
                  <p>
                    {canApproveTimekeeping
                      ? 'Phê duyệt đơn giải trình / quên chấm công trước khi chốt dữ liệu tính lương.'
                      : 'Theo dõi đơn giải trình đang chờ Ban giám hiệu xử lý.'}
                  </p>
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
                          <td><span className="badge-time">{req.requestedTime || req.requestedCheckInTime || '—'}</span></td>
                          <td>{req.reason}</td>
                          {canApproveTimekeeping && (
                            <td>
                              <div className="leave-actions">
                                <button type="button" className="button button-primary" onClick={() => handleApproveCorrection(req._id)}>
                                  <Icon name="check" size={16} /> Duyệt
                                </button>
                                <button type="button" className="button button-secondary" onClick={() => handleRejectCorrection(req._id)}>
                                  <Icon name="x" size={16} /> Từ chối
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {canApproveTimekeeping && (
              <section className="content-card" style={{ marginTop: 20 }}>
                <div className="card-heading">
                  <div>
                    <p className="card-kicker">CÔNG CỤ ĐỒNG BỘ CÔNG</p>
                    <h2>Tính lại ngày chấm công đã chốt</h2>
                    <p>Hệ thống sẽ quét lại các sự kiện quẹt thẻ / chấm công bằng mã để cập nhật lại ngày công chính xác.</p>
                  </div>
                </div>
                <div style={{ padding: '0 23px 23px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={selectedRecalcDate}
                    onChange={(e) => setSelectedRecalcDate(e.target.value)}
                    style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6 }}
                  />
                  <button type="button" className="button button-primary" onClick={handleRecalculateAttendance}>
                    <Icon name="refresh" size={16} /> Tính lại công
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'devices' && (
          <section className="content-card">
            <TimekeepingDeviceManagement />
          </section>
        )}
      </section>

      {showForm && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
        >
          <form className="account-modal-card student-form hr-modal" style={{ width: 'min(740px, 100%)' }} onSubmit={submitEmployee}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">HỒ SƠ NHÂN SỰ</p>
                <h2>{editingEmployee ? 'Cập nhật hồ sơ nhân viên' : 'Thêm nhân viên mới'}</h2>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}
              >
                Đóng
              </button>
            </div>
            <p className="department-form-note">
              {editingEmployee
                ? 'Nhóm tính lương là trường bắt buộc để tổng hợp bảng lương. Khi liên kết tài khoản, vai trò lương tự động đồng bộ theo quyền đăng nhập của nhân viên.'
                : 'Tạo gọn trong 1 bước: Hệ thống khởi tạo đồng thời Hồ sơ nhân sự và Tài khoản đăng nhập để giáo viên/nhân viên vào làm việc được ngay.'}
            </p>
            <div className="student-form-grid">
              {!editingEmployee && (
                <label className="form-wide">
                  Phương thức cấp tài khoản đăng nhập
                  <select
                    value={form.accountMode}
                    onChange={(e) => {
                      const nextMode = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        accountMode: nextMode,
                        userId: nextMode === 'link_existing' ? prev.userId : '',
                        ...(nextMode === 'create_new'
                          ? {
                              payrollRole: payrollRoleFromAccountRole(prev.accountRole),
                              position: defaultPositionByAccountRole(prev.accountRole)
                            }
                          : {})
                      }));
                    }}
                  >
                    <option value="create_new">Tạo mới đồng thời Hồ sơ & Tài khoản đăng nhập (Khuyên dùng)</option>
                    <option value="link_existing">Gắn với tài khoản nội bộ đã tạo trước đó</option>
                    <option value="none">Chỉ lưu hồ sơ nhân sự (chưa cấp tài khoản đăng nhập)</option>
                  </select>
                </label>
              )}

              {!editingEmployee && form.accountMode === 'create_new' && (
                <>
                  <label>
                    Vai trò đăng nhập *
                    <select
                      value={form.accountRole}
                      onChange={(e) => {
                        const nextRole = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          accountRole: nextRole,
                          payrollRole: payrollRoleFromAccountRole(nextRole),
                          position: defaultPositionByAccountRole(nextRole)
                        }));
                      }}
                    >
                      <option value="teacher">Giáo viên</option>
                      <option value="accountant">Kế toán</option>
                      <option value="chef">Nhân viên bếp</option>
                      <option value="guard">Bảo vệ</option>
                      <option value="hr">Nhân sự (HR)</option>
                      {role === 'admin' && <option value="principal">Hiệu trưởng</option>}
                    </select>
                  </label>
                  <label>
                    Tên đăng nhập *
                    <input
                      value={form.accountUsername}
                      onChange={(e) => setForm({ ...form, accountUsername: e.target.value.trim(), usernameTouched: true })}
                      placeholder="Tự điền theo SĐT hoặc nhập VD: gv.hoa"
                      required
                    />
                    <small>Nhân viên dùng tên này để đăng nhập vào hệ thống.</small>
                  </label>
                  <label className="form-wide">
                    Mật khẩu khởi tạo *
                    <input
                      type="text"
                      value={form.accountPassword}
                      onChange={(e) => setForm({ ...form, accountPassword: e.target.value })}
                      placeholder="Mặc định: 123456"
                      required
                    />
                    <small>Mật khẩu mặc định là 123456 (nhân viên có thể tự đổi sau khi đăng nhập).</small>
                  </label>
                </>
              )}

              {(editingEmployee || form.accountMode === 'link_existing') && (
                <label className="form-wide">
                  Tài khoản đăng nhập
                  <select value={form.userId} onChange={(e) => chooseStaffAccount(e.target.value)}>
                    <option value="">Chưa liên kết tài khoản</option>
                    {staffAccounts.map((account) => {
                      const unavailable = Boolean(account.employeeProfile && String(account.employeeProfile._id) !== String(editingEmployee?._id));
                      return (
                        <option key={account._id} value={account._id} disabled={unavailable}>
                          {account.profile?.fullName || account.username} · @{account.username} · {roleText[account.role] || account.role}
                          {unavailable ? ' (đã gán)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  <small>Liên kết đúng tài khoản để đồng bộ chấm công và bảng lương. Mỗi tài khoản chỉ thuộc 1 hồ sơ.</small>
                </label>
              )}
              <label>
                Mã nhân viên / Mã chấm công
                <input
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                  placeholder="Để trống tự đánh số (1, 2, 3...) hoặc nhập mã riêng"
                />
              </label>
              <label>
                Họ và tên *
                <input
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  placeholder="Nhập họ và tên đầy đủ"
                  required
                />
              </label>
              <label>
                Số điện thoại *
                <input
                  value={form.phone}
                  onChange={(e) => {
                    const nextPhone = e.target.value;
                    const normalizedDigits = nextPhone.replace(/\D/g, '');
                    setForm((prev) => ({
                      ...prev,
                      phone: nextPhone,
                      ...(!editingEmployee && prev.accountMode === 'create_new' && !prev.usernameTouched
                        ? { accountUsername: normalizedDigits }
                        : {})
                    }));
                  }}
                  placeholder="VD: 0901 234 567"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@truong.edu.vn"
                />
              </label>
              <label>
                Nhóm tính lương
                <select
                  value={form.payrollRole}
                  onChange={(e) => setForm({ ...form, payrollRole: e.target.value })}
                  disabled={Boolean(form.userId) || (!editingEmployee && form.accountMode === 'create_new')}
                >
                  <option value="principal">Ban giám hiệu</option>
                  <option value="teacher">Giáo viên</option>
                  <option value="accountant">Kế toán</option>
                  <option value="chef">Nhân viên bếp</option>
                  <option value="guard">Bảo vệ</option>
                  <option value="hr">Nhân sự (HR)</option>
                </select>
                <small>{form.userId || (!editingEmployee && form.accountMode === 'create_new') ? 'Đồng bộ tự động theo vai trò đăng nhập.' : 'Chọn nhóm để tổng hợp lương.'}</small>
              </label>
              <label>
                Chức danh chi tiết
                <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                  <option value="principal">Hiệu trưởng / Quản lý</option>
                  <option value="vice_principal">Phó hiệu trưởng</option>
                  <option value="teacher">Giáo viên</option>
                  <option value="head_teacher">Tổ trưởng chuyên môn</option>
                  <option value="assistant_teacher">Trợ giảng</option>
                  <option value="accountant">Kế toán</option>
                  <option value="chef">Nhân viên bếp</option>
                  <option value="hr">Nhân sự (HR)</option>
                  <option value="security">Bảo vệ</option>
                </select>
              </label>
              <label className="form-wide">
                Địa chỉ liên hệ
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Địa chỉ hiện tại"
                />
              </label>
              <label>
                Ngày vào làm
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </label>
              <label>
                Tình trạng làm việc
                <input
                  value={statusText[editingEmployee?.status] || 'Đang làm việc'}
                  readOnly
                />
                <small>Thay đổi tự động theo quy trình nghỉ phép / thôi việc.</small>
              </label>
              <label>
                Loại hợp đồng
                <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>
                  <option value="">Chưa cập nhật</option>
                  <option value="probation">Thử việc</option>
                  <option value="fixed_1_year">Xác định 1 năm</option>
                  <option value="fixed_3_year">Xác định 3 năm</option>
                  <option value="indefinite">Không xác định thời hạn</option>
                </select>
              </label>
              <label>
                Số hợp đồng
                <input
                  value={form.contractNumber}
                  onChange={(e) => setForm({ ...form, contractNumber: e.target.value })}
                  placeholder="Số / ký hiệu hợp đồng"
                />
              </label>
              <label>
                Ngày ký hợp đồng
                <input
                  type="date"
                  value={form.contractSignedDate}
                  onChange={(e) => setForm({ ...form, contractSignedDate: e.target.value })}
                />
              </label>
              <label>
                Ngày hiệu lực
                <input
                  type="date"
                  value={form.contractStartDate}
                  onChange={(e) => setForm({ ...form, contractStartDate: e.target.value })}
                />
              </label>
              <label>
                Ngày hết hạn
                <input
                  type="date"
                  value={form.endDate}
                  disabled={form.contractType === 'indefinite'}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </label>
              <label>
                Đơn vị nhập lương
                <select
                  value={form.salaryUnit}
                  onChange={(e) => setForm({ ...form, salaryUnit: e.target.value, baseSalary: '', lowMonthlySalaryConfirmed: false })}
                >
                  <option value="monthly">Lương theo tháng</option>
                  <option value="daily">Tiền một công</option>
                </select>
              </label>
              <label>
                {form.salaryUnit === 'daily' ? 'Tiền một công (VNĐ) *' : 'Lương cơ bản / tháng (VNĐ) *'}
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.baseSalary}
                  onChange={(e) => setForm({ ...form, baseSalary: e.target.value, lowMonthlySalaryConfirmed: false })}
                  required
                />
                <small>
                  {form.salaryUnit === 'daily'
                    ? `Quy đổi: ${money(salaryInMonth(form))}/tháng = ${money(form.baseSalary)} × ${form.standardWorkDays} công.`
                    : `${money(form.baseSalary)}/tháng (~${money(Number(form.baseSalary || 0) / Number(form.standardWorkDays || 26))}/công).`}
                </small>
              </label>
              <label>
                Số công chuẩn mỗi tháng *
                <input
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  value={form.standardWorkDays}
                  onChange={(e) => setForm({ ...form, standardWorkDays: e.target.value, lowMonthlySalaryConfirmed: false })}
                  required
                />
              </label>
              {salaryInMonth(form) > 0 && salaryInMonth(form) < LOW_MONTHLY_SALARY && (
                <div className="form-wide salary-unit-warning">
                  <strong>Kiểm tra đơn vị lương</strong>
                  <p>
                    {money(salaryInMonth(form))}/tháng tương đương khoảng {money(salaryInMonth(form) / Number(form.standardWorkDays || 26))}/công. Nếu đây là tiền một công, hãy chọn “Tiền một công” ở trên.
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.lowMonthlySalaryConfirmed}
                      onChange={(e) => setForm({ ...form, lowMonthlySalaryConfirmed: e.target.checked })}
                    />
                    Tôi xác nhận đây thực sự là lương cả tháng.
                  </label>
                </div>
              )}
              {formError && <p className="form-error form-wide" role="alert">{formError}</p>}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => { setShowForm(false); setEditingEmployee(null); setForm(emptyEmployeeForm); }}
              >
                Hủy
              </button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? 'Đang lưu...' : (editingEmployee ? 'Lưu thay đổi' : 'Lưu hồ sơ')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {profileHistory && createPortal(
        <div
          className="account-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProfileHistory(null);
          }}
        >
          <section className="account-modal-card student-form hr-modal hr-profile-history" style={{ width: 'min(700px, 100%)' }}>
            <div className="account-modal-header">
              <div>
                <p className="card-kicker">HỒ SƠ CHI TIẾT & LỊCH SỬ</p>
                <h2>{profileHistory.employee.fullName}</h2>
                <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13px' }}>
                  Mã NV: <strong>{profileHistory.employee.employeeCode}</strong> ·{' '}
                  {profileHistory.employee.userId?.username ? `@${profileHistory.employee.userId.username}` : 'Chưa liên kết tài khoản'}
                </p>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setProfileHistory(null)}>
                Đóng
              </button>
            </div>
            <div className="hr-profile-facts">
              <span><b>Liên hệ:</b> {profileHistory.employee.phone || 'Chưa cập nhật'} · {profileHistory.employee.email || 'Chưa có email'}</span>
              <span><b>Địa chỉ:</b> {profileHistory.employee.address || 'Chưa cập nhật'}</span>
              <span><b>Chức danh:</b> {resolveDisplayPosition(profileHistory.employee)}</span>
              <span><b>Mức lương cơ bản:</b> {money(profileHistory.employee.salaryConfig?.baseSalary || 0)} / tháng ({profileHistory.employee.salaryConfig?.standardWorkDays || 26} công chuẩn)</span>
              <span><b>Ngày vào làm:</b> {profileHistory.employee.startDate ? new Date(profileHistory.employee.startDate).toLocaleDateString('vi-VN') : 'Chưa cập nhật'}</span>
              <span><b>Tình trạng:</b> {statusText[profileHistory.employee.status] || 'Đang làm việc'}</span>
              <span><b>Hợp đồng:</b> {contractTypeText[profileHistory.employee.contractType] || 'Chưa cập nhật'} {profileHistory.employee.contractNumber ? `(#${profileHistory.employee.contractNumber})` : ''}</span>
              <span>
                <b>Thời hạn HĐ:</b> Ký {profileHistory.employee.contractSignedDate ? new Date(profileHistory.employee.contractSignedDate).toLocaleDateString('vi-VN') : '—'} · Hiệu lực {profileHistory.employee.contractStartDate ? new Date(profileHistory.employee.contractStartDate).toLocaleDateString('vi-VN') : '—'} · Hết hạn {profileHistory.employee.endDate ? new Date(profileHistory.employee.endDate).toLocaleDateString('vi-VN') : 'Không xác định'}
              </span>
            </div>
            <h3 style={{ marginTop: '18px' }}>Lịch sử cập nhật hồ sơ</h3>
            {profileHistory.records.length ? (
              <div className="hr-profile-events">
                {profileHistory.records.map((record) => (
                  <article key={record._id}>
                    <strong>
                      {record.action === 'EMPLOYEE_CREATED'
                        ? 'Khởi tạo hồ sơ nhân sự'
                        : record.action === 'EMPLOYEE_RESIGNED'
                          ? 'Nghỉ việc / Thu hồi tài khoản'
                          : 'Cập nhật thông tin hồ sơ'}
                    </strong>
                    <small>{record.actorUsername} · {new Date(record.occurredAt).toLocaleString('vi-VN')}</small>
                    {record.reason && <p>Lý do: {record.reason}</p>}
                    {Object.entries(record.after || {}).map(([key, value]) => (
                      <p key={key}>
                        <b>{profileFieldText[key] || key}:</b> {formatHistoryFieldValue(key, record.before?.[key])} → {formatHistoryFieldValue(key, value)}
                      </p>
                    ))}
                  </article>
                ))}
              </div>
            ) : (
              <p style={{ color: '#64748b', fontSize: '13px' }}>
                Hồ sơ được tạo ngày {profileHistory.createdAt ? new Date(profileHistory.createdAt).toLocaleDateString('vi-VN') : '—'}; chưa có chỉnh sửa phát sinh.
              </p>
            )}
          </section>
        </div>,
        document.body
      )}
    </AppShell>
  );
}
