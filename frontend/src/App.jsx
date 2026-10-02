import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import ParentAccountManagement from './pages/ParentAccountManagement';
import AccountManagement from './pages/AccountManagement';
import Dashboard from './pages/Dashboard';
import AttendanceClassList from './pages/AttendanceClassList';
import AttendanceDetail from './pages/AttendanceDetail';
import AttendanceAbsenceReport from './pages/AttendanceAbsenceReport';
import AttendanceLeaveManagement from './pages/AttendanceLeaveManagement';
import TimekeepingHub from './pages/TimekeepingHub';
import NutritionManagement from './pages/NutritionManagement';
import StudentList from './pages/StudentList';
import StudentDetail from './pages/StudentDetail';
import StudentForm from './pages/StudentForm';
import ClassroomManagement from './pages/ClassroomManagement';
import ParentPortal from './pages/ParentPortal';
import FinanceManagement from './pages/FinanceManagement';
import Reports from './pages/Reports';
import AssetManagement from './pages/AssetManagement';
import EmployeeManagement from './pages/EmployeeManagement';
import Messages from './pages/Messages';
import MyPayroll from './pages/MyPayroll';
import DailyCare from './pages/DailyCare';
import ParentCare from './pages/ParentCare';
import PickupManagement from './pages/PickupManagement';
import StudentProfileChangeRequests from './pages/StudentProfileChangeRequests';
import ParentFeedbackManagement from './pages/ParentFeedbackManagement';
import ParentSettings from './pages/ParentSettings';

function ProtectedRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function ParentRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'parent' ? children : <Navigate to="/dashboard" replace />;
}

function StudentManagementRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  // Hồ sơ của con được hiển thị qua ParentPortal; không cho phụ huynh dùng
  // giao diện quản trị/danh sách học sinh dù họ tự nhập URL.
  return user.role === 'parent' ? <Navigate to="/parent-portal" replace /> : children;
}

function ChatRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['parent', 'teacher'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function PickupRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['parent', 'teacher', 'guard', 'admin', 'principal'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function StaffRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function ClassroomRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return ['admin', 'principal'].includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function TeacherRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'teacher' ? children : <Navigate to="/dashboard" replace />;
}

function RoleRoute({ roles, children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return roles.includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/parent-accounts" element={<RoleRoute roles={['admin', 'principal']}><ParentAccountManagement /></RoleRoute>} />
        <Route path="/accounts" element={<RoleRoute roles={['admin', 'principal', 'hr']}><AccountManagement /></RoleRoute>} />
        <Route
          path="/dashboard"
          element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
        />
        <Route
          path="/attendance"
          element={<ProtectedRoute><AttendanceClassList /></ProtectedRoute>}
        />
        <Route
          path="/attendance/class/:classroomId"
          element={<ProtectedRoute><AttendanceDetail /></ProtectedRoute>}
        />
        <Route
          path="/attendance/reports"
          element={<ProtectedRoute><AttendanceAbsenceReport /></ProtectedRoute>}
        />
        <Route
          path="/attendance/leave-requests"
          element={<ProtectedRoute><AttendanceLeaveManagement /></ProtectedRoute>}
        />
        <Route
          path="/smart-attendance"
          element={<Navigate to="/timekeeping?tab=kiosk" replace />}
        />
        <Route
          path="/timekeeping"
          element={<ProtectedRoute><TimekeepingHub /></ProtectedRoute>}
        />
        <Route path="/my-payroll" element={<StaffRoute><MyPayroll /></StaffRoute>} />
        <Route path="/daily-care" element={<TeacherRoute><DailyCare /></TeacherRoute>} />
        <Route
          path="/timekeeping-management"
          element={<Navigate to="/hr?tab=timekeeping" replace />}
        />
        <Route
          path="/nutrition"
          element={<ProtectedRoute><NutritionManagement /></ProtectedRoute>}
        />
        <Route path="/students" element={<StudentManagementRoute><StudentList /></StudentManagementRoute>} />
        <Route path="/students/new" element={<StudentManagementRoute><StudentForm /></StudentManagementRoute>} />
        <Route path="/students/:id" element={<StudentManagementRoute><StudentDetail /></StudentManagementRoute>} />
        <Route path="/students/:id/edit" element={<StudentManagementRoute><StudentForm /></StudentManagementRoute>} />
        <Route path="/classrooms" element={<ClassroomRoute><ClassroomManagement /></ClassroomRoute>} />
        <Route path="/finance" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><FinanceManagement /></RoleRoute>} />
        <Route path="/reports" element={<RoleRoute roles={['admin', 'principal', 'accountant']}><Reports /></RoleRoute>} />
        <Route path="/assets" element={<RoleRoute roles={['admin', 'principal', 'teacher']}><AssetManagement /></RoleRoute>} />
        <Route path="/hr" element={<RoleRoute roles={['admin', 'principal', 'accountant', 'hr']}><EmployeeManagement /></RoleRoute>} />
        <Route path="/parent-dashboard" element={<ParentRoute><ParentPortal /></ParentRoute>} />
        <Route path="/parent-portal" element={<ParentRoute><ParentPortal /></ParentRoute>} />
        <Route path="/parent-settings" element={<ParentRoute><ParentSettings /></ParentRoute>} />
        <Route path="/parent-care" element={<ParentRoute><ParentCare /></ParentRoute>} />
        <Route path="/pickups" element={<PickupRoute><PickupManagement /></PickupRoute>} />
        <Route path="/student-profile-change-requests" element={<RoleRoute roles={['admin', 'principal']}><StudentProfileChangeRequests /></RoleRoute>} />
        <Route path="/parent-feedback" element={<RoleRoute roles={['admin', 'principal']}><ParentFeedbackManagement /></RoleRoute>} />
        <Route path="/messages" element={<ChatRoute><Messages /></ChatRoute>} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
