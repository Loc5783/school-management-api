import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import ParentAccountManagement from './pages/ParentAccountManagement';
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

function ProtectedRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function ParentRoute({ children }) {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!localStorage.getItem('token')) return <Navigate to="/login" replace />;
  return user.role === 'parent' ? children : <Navigate to="/dashboard" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/parent-accounts" element={<ProtectedRoute><ParentAccountManagement /></ProtectedRoute>} />
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
        <Route
          path="/timekeeping-management"
          element={<Navigate to="/timekeeping?tab=management" replace />}
        />
        <Route
          path="/nutrition"
          element={<ProtectedRoute><NutritionManagement /></ProtectedRoute>}
        />
        <Route path="/students" element={<ProtectedRoute><StudentList /></ProtectedRoute>} />
        <Route path="/students/new" element={<ProtectedRoute><StudentForm /></ProtectedRoute>} />
        <Route path="/students/:id" element={<ProtectedRoute><StudentDetail /></ProtectedRoute>} />
        <Route path="/students/:id/edit" element={<ProtectedRoute><StudentForm /></ProtectedRoute>} />
        <Route path="/classrooms" element={<ProtectedRoute><ClassroomManagement /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><FinanceManagement /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
        <Route path="/assets" element={<ProtectedRoute><AssetManagement /></ProtectedRoute>} />
        <Route path="/hr" element={<ProtectedRoute><EmployeeManagement /></ProtectedRoute>} />
        <Route path="/parent-portal" element={<ParentRoute><ParentPortal /></ParentRoute>} />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
