import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PersistentAppShell } from './components/AppShell';
import Login from './pages/Login';
import { getStoredSuperAdminUser, getStoredUser } from './utils/storage';

// Tách gói tải theo tuyến đường (Route-level Code Splitting) giúp giảm ~75% dung lượng JS tải lần đầu
const AccountManagement = lazy(() => import('./pages/AccountManagement'));
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
  return user.role === 'parent' ? children : <Navigate to="/dashboard" replace />;
}

function SuperAdminRoute({ children }) {
  const superToken = localStorage.getItem('superadmin_token') || localStorage.getItem('token');
  const user = getStoredSuperAdminUser() || getStoredUser();
  if (!superToken) return <Navigate to="/login" replace />;
  if (user.role !== 'superadmin' && !localStorage.getItem('superadmin_token')) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function DashboardRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return <Navigate to="/multi-school" replace />;
  if (user.role === 'guard') return <Navigate to="/guard" replace />;
  if (user.role === 'parent') return <Navigate to="/parent-dashboard" replace />;
  if (user.role === 'chef') return <Navigate to="/kitchen" replace />;
  if (user.role === 'accountant') return <Navigate to="/accounting" replace />;
  if (user.role === 'hr') return <Navigate to="/hr" replace />;
  return children;
}

function StudentManagementRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return <Navigate to="/multi-school" replace />;
  if (user.role === 'parent') return <Navigate to="/parent-portal" replace />;
  if (user.role === 'guard') return <Navigate to="/guard" replace />;
  return children;
}

function ChatRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['parent', 'teacher'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
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
  return ['parent', 'admin', 'principal'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function StaffRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function ClassroomRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function TeacherRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'teacher' ? children : <Navigate to="/dashboard" replace />;
}

function RoleRoute({ roles, children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'guard' && !roles.includes('guard')) return <Navigate to="/guard" replace />;
  return roles.includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function ProfileRequestsRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/accounts?tab=profile-requests" replace />;
  if (user.role === 'principal') return children;
  return <Navigate to="/dashboard" replace />;
}

function ParentFeedbackRoute({ children }) {
  const user = getStoredUser();
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/staff-settings?tab=parent-feedback" replace />;
  if (user.role === 'principal') return children;
  return <Navigate to="/dashboard" replace />;
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
            <Route path="/parent-accounts" element={<RoleRoute roles={['admin']}><Navigate to="/accounts?tab=parents" replace /></RoleRoute>} />
            <Route path="/accounts" element={<RoleRoute roles={['admin', 'hr']}><AccountManagement /></RoleRoute>} />
            <Route path="/principal" element={<RoleRoute roles={['admin', 'principal']}><PrincipalOverview /></RoleRoute>} />
            <Route
              path="/dashboard"
              element={<DashboardRoute><Dashboard /></DashboardRoute>}
            />
            <Route
              path="/attendance"
              element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AttendanceClassList /></RoleRoute>}
            />
            <Route
              path="/attendance/class/:classroomId"
              element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AttendanceDetail /></RoleRoute>}
            />
            <Route
              path="/attendance/reports"
              element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AttendanceAbsenceReport /></RoleRoute>}
            />
            <Route
              path="/attendance/leave-requests"
              element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AttendanceLeaveManagement /></RoleRoute>}
            />
            <Route
              path="/smart-attendance"
              element={<Navigate to="/timekeeping?tab=kiosk" replace />}
            />
            <Route
              path="/timekeeping"
              element={<StaffRoute><TimekeepingHub /></StaffRoute>}
            />
            <Route path="/my-leave-requests" element={<StaffRoute><StaffLeaveRequests /></StaffRoute>} />
            <Route path="/my-payroll" element={<StaffRoute><MyPayroll /></StaffRoute>} />
            <Route path="/staff-settings" element={<StaffRoute><StaffSettings /></StaffRoute>} />
            <Route path="/my-staffing" element={<StaffRoute><MyStaffing /></StaffRoute>} />
            <Route path="/my-handovers" element={<Navigate to="/dashboard" replace />} />
            <Route path="/internal-notices" element={<StaffRoute><InternalNotices /></StaffRoute>} />
            <Route path="/my-requests" element={<Navigate to="/dashboard" replace />} />
            <Route path="/professional-reviews" element={<Navigate to="/dashboard" replace />} />
            <Route path="/daily-care" element={<TeacherRoute><DailyCare /></TeacherRoute>} />
            <Route
              path="/timekeeping-management"
              element={<Navigate to="/hr?tab=timekeeping" replace />}
            />
            <Route
              path="/nutrition"
              element={<RoleRoute roles={['admin', 'principal', 'chef', 'teacher', 'parent']}><NutritionManagement /></RoleRoute>}
            />
            <Route path="/kitchen" element={<RoleRoute roles={['chef', 'admin']}><ChefDashboard /></RoleRoute>} />
            <Route path="/accounting" element={<RoleRoute roles={['accountant']}><AccountantDashboard /></RoleRoute>} />
            <Route path="/accounting/expenses" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><AccountingExpenses /></RoleRoute>} />
            <Route path="/accounting/operating-expenses" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><OperatingExpenses /></RoleRoute>} />
            <Route path="/accounting/cashbook" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><AccountingCashbook /></RoleRoute>} />
            <Route path="/accounting/report" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><AccountingReport /></RoleRoute>} />
            <Route path="/students" element={<StudentManagementRoute><StudentList /></StudentManagementRoute>} />
            <Route path="/students/new" element={<RoleRoute roles={['admin', 'teacher']}><StudentForm /></RoleRoute>} />
            <Route path="/students/:id" element={<StudentManagementRoute><StudentDetail /></StudentManagementRoute>} />
            <Route path="/students/:id/edit" element={<RoleRoute roles={['admin', 'teacher']}><StudentForm /></RoleRoute>} />
            <Route path="/classrooms" element={<ClassroomRoute><ClassroomManagement /></ClassroomRoute>} />
            <Route path="/campuses" element={<ClassroomRoute><SchoolCampusManagement /></ClassroomRoute>} />
            <Route path="/finance" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><FinanceManagement /></RoleRoute>} />
            <Route path="/reports" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><Reports /></RoleRoute>} />
            <Route path="/assets" element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AssetManagement /></RoleRoute>} />
            <Route path="/hr" element={<RoleRoute roles={['admin', 'principal', 'accountant', 'hr']}><EmployeeManagement /></RoleRoute>} />
            <Route path="/employees" element={<RoleRoute roles={['admin', 'principal', 'accountant', 'hr']}><EmployeeManagement /></RoleRoute>} />
            <Route path="/payroll" element={<RoleRoute roles={['admin', 'principal', 'accountant', 'hr']}><PayrollManagement /></RoleRoute>} />
            <Route path="/parent-dashboard" element={<ParentRoute><ParentPortal /></ParentRoute>} />
            <Route path="/parent-portal" element={<ParentRoute><ParentPortal /></ParentRoute>} />
            <Route path="/parent-settings" element={<ParentRoute><ParentSettings /></ParentRoute>} />
            <Route path="/parent-care" element={<ParentRoute><ParentCare /></ParentRoute>} />
            <Route path="/pickups" element={<PickupRoute><PickupManagement /></PickupRoute>} />
            <Route path="/guard" element={<RoleRoute roles={['guard', 'admin']}><GuardOperations /></RoleRoute>} />
            <Route path="/student-profile-change-requests" element={<ProfileRequestsRoute><StudentProfileChangeRequests /></ProfileRequestsRoute>} />
            <Route path="/parent-feedback" element={<ParentFeedbackRoute><ParentFeedbackManagement /></ParentFeedbackRoute>} />
            <Route path="/messages" element={<ChatRoute><Messages /></ChatRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
