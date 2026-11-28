import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PersistentAppShell } from './components/AppShell';
import Login from './pages/Login';
import { getStoredSuperAdminUser, getStoredUser } from './utils/storage';
import { getHomePathForUser, isNonSecuritySupportStaff } from './utils/roleWorkspaceConfig';

// Tách gói tải theo tuyến đường (Route-level Code Splitting) giúp giảm ~75% dung lượng JS tải lần đầu
const AccountManagement = lazy(() => import('./pages/AccountManagement'));
const StaffOperationalWorkspace = lazy(() => import('./pages/StaffOperationalWorkspace'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PrincipalOverview = lazy(() => import('./pages/PrincipalOverview'));
const AttendanceClassList = lazy(() => import('./pages/AttendanceClassList'));
const AttendanceDetail = lazy(() => import('./pages/AttendanceDetail'));
const AttendanceAbsenceReport = lazy(() => import('./pages/AttendanceAbsenceReport'));
const AttendanceLeaveManagement = lazy(() => import('./pages/AttendanceLeaveManagement'));
const TimekeepingHub = lazy(() => import('./pages/TimekeepingHub'));
const NutritionManagement = lazy(() => import('./pages/NutritionManagement'));
const ChefDashboard = lazy(() => import('./pages/ChefDashboard'));
const AccountantDashboard = lazy(() => import('./pages/AccountantDashboard'));
const AccountingExpenses = lazy(() => import('./pages/AccountingExpenses'));
const OperatingExpenses = lazy(() => import('./pages/OperatingExpenses'));
const AccountingCashbook = lazy(() => import('./pages/AccountingCashbook'));
const AccountingReport = lazy(() => import('./pages/AccountingReport'));
const StudentList = lazy(() => import('./pages/StudentList'));
const StudentDetail = lazy(() => import('./pages/StudentDetail'));
const StudentForm = lazy(() => import('./pages/StudentForm'));
const ClassroomManagement = lazy(() => import('./pages/ClassroomManagement'));
const SchoolCampusManagement = lazy(() => import('./pages/SchoolCampusManagement'));
const SchoolDeviceSettings = lazy(() => import('./pages/SchoolDeviceSettings'));
const SchoolAuditJournalPage = lazy(() => import('./pages/SchoolAuditJournalPage'));
const MultiSchoolManagement = lazy(() => import('./pages/MultiSchoolManagement'));
const ParentPortal = lazy(() => import('./pages/ParentPortal'));
const FinanceManagement = lazy(() => import('./pages/FinanceManagement'));
const Reports = lazy(() => import('./pages/Reports'));
const AssetManagement = lazy(() => import('./pages/AssetManagement'));
const EmployeeManagement = lazy(() => import('./pages/EmployeeManagement'));
const PayrollManagement = lazy(() => import('./pages/PayrollManagement'));
const Messages = lazy(() => import('./pages/Messages'));
const MyPayroll = lazy(() => import('./pages/MyPayroll'));
const DailyCare = lazy(() => import('./pages/DailyCare'));
const ParentCare = lazy(() => import('./pages/ParentCare'));
const PickupManagement = lazy(() => import('./pages/PickupManagement'));
const StudentProfileChangeRequests = lazy(() => import('./pages/StudentProfileChangeRequests'));
const ParentFeedbackManagement = lazy(() => import('./pages/ParentFeedbackManagement'));
const ParentSettings = lazy(() => import('./pages/ParentSettings'));
const GuardOperations = lazy(() => import('./pages/GuardOperations'));
const StaffSettings = lazy(() => import('./pages/StaffSettings'));
const MyStaffing = lazy(() => import('./pages/MyStaffing'));
const InternalNotices = lazy(() => import('./pages/InternalNotices'));
const StaffLeaveRequests = lazy(() => import('./pages/StaffLeaveRequests'));

/**
 * Xác định trang chủ chuẩn tương ứng với từng vai trò người dùng để chuyển hướng chính xác,
 * đảm bảo Admin trường vào thẳng Cài đặt Hệ thống Trường & Phân hiệu (/campuses) thay vì màn hình Giám đốc.
 */
function getRoleHomePath(roleOrUser) {
  if (roleOrUser && typeof roleOrUser === 'object') {
    return getHomePathForUser(roleOrUser);
  }
  return getHomePathForUser(getStoredUser()?.role === roleOrUser ? getStoredUser() : { role: roleOrUser });
}

function RouteLoadingFallback() {
  return (
    <div className="inline-loader" style={{ padding: '48px 0' }}>
      <span className="loading-orb" style={{ marginRight: '8px' }} />
      Đang tải phân hệ...
    </div>
  );
}

function ParentRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'parent' ? children : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function SuperAdminRoute({ children }) {
  const superToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
  const user = getStoredSuperAdminUser() || getStoredUser();
  if (!superToken) return <Navigate to="/login" replace />;
  if (user.role !== 'superadmin' && !localStorage.getItem('superadmin_token')) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }
  return children;
}

function DashboardRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (['principal', 'teacher'].includes(user.role)) {
    return children;
  }
  return <Navigate to={getRoleHomePath(user.role)} replace />;
}

function StudentManagementRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (['principal', 'teacher', 'hr', 'accountant'].includes(user.role)) {
    return children;
  }
  return <Navigate to={getRoleHomePath(user.role)} replace />;
}

function ChatRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['parent', 'teacher'].includes(user.role)
    ? children
    : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function PickupRoute({ children }) {
  const user = getStoredUser();
  const location = useLocation();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'guard') return <Navigate to="/guard" replace />;
  if (user.role === 'teacher') {
    const searchParams = new URLSearchParams(location.search);
    const classroomId = searchParams.get('classroomId');
    searchParams.set('tab', 'departure');
    if (classroomId) {
      searchParams.delete('classroomId');
      const search = searchParams.toString();
      return <Navigate to={`/attendance/class/${classroomId}${search ? `?${search}` : ''}`} replace />;
    }
    const search = searchParams.toString();
    return <Navigate to={`/attendance${search ? `?${search}` : ''}`} replace />;
  }
  return ['parent', 'principal'].includes(user.role)
    ? children
    : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function SalariedStaffRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'].includes(user.role)
    ? children
    : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function InternalAccountRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'].includes(user.role)
    ? children
    : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function ClassroomRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal'].includes(user.role)
    ? children
    : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function TeacherRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'teacher' ? children : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function RoleRoute({ roles, children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return roles.includes(user.role) ? children : <Navigate to={getRoleHomePath(user.role)} replace />;
}

function ProfileRequestsRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/accounts?tab=profile-requests" replace />;
  if (user.role === 'principal') return children;
  return <Navigate to={getRoleHomePath(user)} replace />;
}

/**
 * Ngăn nhân viên Y tế / Lao công / Kỹ thuật / Tài xế (cùng dùng nhóm role `guard` cho chấm công)
 * bị mở nhầm vào màn hình Trực cổng QR của Bảo vệ: tự động chuyển sang Không gian Nhân viên riêng.
 */
function GuardWorkspaceGate({ children }) {
  const user = getStoredUser();
  if (isNonSecuritySupportStaff(user)) {
    return <Navigate to="/staff-workspace" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/multi-school" element={<SuperAdminRoute><MultiSchoolManagement /></SuperAdminRoute>} />
          <Route element={<PersistentAppShell />}>
            {/* 1. Chức năng Hệ thống Trường, Phân hiệu, Tài khoản, Thiết bị & Nhật ký (Admin trường) */}
            <Route path="/parent-accounts" element={<RoleRoute roles={['admin']}><Navigate to="/accounts?tab=parents" replace /></RoleRoute>} />
            <Route path="/accounts" element={<RoleRoute roles={['admin', 'hr']}><AccountManagement /></RoleRoute>} />
            <Route path="/campuses" element={<ClassroomRoute><SchoolCampusManagement /></ClassroomRoute>} />
            <Route path="/classrooms" element={<ClassroomRoute><ClassroomManagement /></ClassroomRoute>} />
            <Route path="/devices" element={<RoleRoute roles={['admin', 'principal', 'hr']}><SchoolDeviceSettings /></RoleRoute>} />
            <Route path="/audit-logs" element={<RoleRoute roles={['admin', 'principal']}><SchoolAuditJournalPage /></RoleRoute>} />

            {/* 2. Điều hành Ban Giám đốc / Hiệu trưởng & Tổng quan Giáo viên */}
            <Route path="/principal" element={<RoleRoute roles={['principal']}><PrincipalOverview /></RoleRoute>} />
            <Route path="/dashboard" element={<DashboardRoute><Dashboard /></DashboardRoute>} />

            {/* 3. Học sinh, Điểm danh & Sổ chăm sóc (Ban Giám đốc & Giáo viên) */}
            <Route path="/attendance" element={<RoleRoute roles={['principal', 'teacher']}><AttendanceClassList /></RoleRoute>} />
            <Route path="/attendance/class/:classroomId" element={<RoleRoute roles={['principal', 'teacher']}><AttendanceDetail /></RoleRoute>} />
            <Route path="/attendance/reports" element={<RoleRoute roles={['principal', 'teacher']}><AttendanceAbsenceReport /></RoleRoute>} />
            <Route path="/attendance/leave-requests" element={<RoleRoute roles={['principal', 'teacher']}><AttendanceLeaveManagement /></RoleRoute>} />
            <Route path="/daily-care" element={<TeacherRoute><DailyCare /></TeacherRoute>} />
            <Route path="/students" element={<StudentManagementRoute><StudentList /></StudentManagementRoute>} />
            <Route path="/students/new" element={<RoleRoute roles={['principal', 'teacher']}><StudentForm /></RoleRoute>} />
            <Route path="/students/:id" element={<StudentManagementRoute><StudentDetail /></StudentManagementRoute>} />
            <Route path="/students/:id/edit" element={<RoleRoute roles={['principal', 'teacher']}><StudentForm /></RoleRoute>} />
            <Route path="/student-profile-change-requests" element={<ProfileRequestsRoute><StudentProfileChangeRequests /></ProfileRequestsRoute>} />
            <Route path="/parent-feedback" element={<RoleRoute roles={['principal']}><ParentFeedbackManagement /></RoleRoute>} />

            {/* 4. Bếp ăn Bán trú, Cơ sở vật chất & An ninh Cổng */}
            <Route path="/kitchen" element={<RoleRoute roles={['chef']}><ChefDashboard /></RoleRoute>} />
            <Route path="/nutrition" element={<RoleRoute roles={['principal', 'chef', 'teacher', 'parent']}><NutritionManagement /></RoleRoute>} />
            <Route path="/assets" element={<RoleRoute roles={['principal', 'teacher', 'chef', 'accountant']}><AssetManagement /></RoleRoute>} />
            <Route path="/pickups" element={<PickupRoute><PickupManagement /></PickupRoute>} />
            <Route
              path="/guard"
              element={
                <RoleRoute roles={['guard', 'principal']}>
                  <GuardWorkspaceGate>
                    <GuardOperations />
                  </GuardWorkspaceGate>
                </RoleRoute>
              }
            />
            <Route path="/staff-workspace" element={<SalariedStaffRoute><StaffOperationalWorkspace /></SalariedStaffRoute>} />

            {/* 5. Tài chính Học phí & Kế toán */}
            <Route path="/accounting" element={<RoleRoute roles={['accountant']}><AccountantDashboard /></RoleRoute>} />
            <Route path="/accounting/expenses" element={<RoleRoute roles={['principal', 'accountant']}><AccountingExpenses /></RoleRoute>} />
            <Route path="/accounting/operating-expenses" element={<RoleRoute roles={['principal', 'accountant']}><OperatingExpenses /></RoleRoute>} />
            <Route path="/accounting/cashbook" element={<RoleRoute roles={['principal', 'accountant']}><AccountingCashbook /></RoleRoute>} />
            <Route path="/accounting/report" element={<RoleRoute roles={['principal', 'accountant']}><AccountingReport /></RoleRoute>} />
            <Route path="/finance" element={<RoleRoute roles={['principal', 'accountant']}><FinanceManagement /></RoleRoute>} />
            <Route path="/reports" element={<RoleRoute roles={['principal', 'accountant']}><Reports /></RoleRoute>} />

            {/* 6. Nhân sự, Chấm công & Tiền lương */}
            <Route path="/hr" element={<RoleRoute roles={['principal', 'accountant', 'hr']}><EmployeeManagement /></RoleRoute>} />
            <Route path="/employees" element={<RoleRoute roles={['principal', 'accountant', 'hr']}><EmployeeManagement /></RoleRoute>} />
            <Route path="/payroll" element={<RoleRoute roles={['principal', 'accountant', 'hr']}><PayrollManagement /></RoleRoute>} />
            <Route path="/timekeeping-management" element={<Navigate to="/hr?tab=timekeeping" replace />} />
            <Route path="/smart-attendance" element={<Navigate to="/timekeeping?tab=kiosk" replace />} />
            <Route path="/timekeeping" element={<SalariedStaffRoute><TimekeepingHub /></SalariedStaffRoute>} />
            <Route path="/my-leave-requests" element={<SalariedStaffRoute><StaffLeaveRequests /></SalariedStaffRoute>} />
            <Route path="/my-payroll" element={<SalariedStaffRoute><MyPayroll /></SalariedStaffRoute>} />
            <Route path="/my-staffing" element={<SalariedStaffRoute><MyStaffing /></SalariedStaffRoute>} />

            {/* 7. Thông báo nội bộ & Cài đặt tài khoản */}
            <Route path="/internal-notices" element={<InternalAccountRoute><InternalNotices /></InternalAccountRoute>} />
            <Route path="/staff-settings" element={<InternalAccountRoute><StaffSettings /></InternalAccountRoute>} />
            <Route path="/my-handovers" element={<Navigate to="/dashboard" replace />} />
            <Route path="/my-requests" element={<Navigate to="/dashboard" replace />} />
            <Route path="/professional-reviews" element={<Navigate to="/dashboard" replace />} />

            {/* 8. Cổng thông tin Phụ huynh & Tin nhắn */}
            <Route path="/parent-dashboard" element={<ParentRoute><ParentPortal /></ParentRoute>} />
            <Route path="/parent-portal" element={<ParentRoute><ParentPortal /></ParentRoute>} />
            <Route path="/parent-settings" element={<ParentRoute><ParentSettings /></ParentRoute>} />
            <Route path="/parent-care" element={<ParentRoute><ParentCare /></ParentRoute>} />
            <Route path="/messages" element={<ChatRoute><Messages /></ChatRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
