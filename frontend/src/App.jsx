import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import ParentAccountManagement from './pages/ParentAccountManagement';
import Dashboard from './pages/Dashboard';
import AttendanceClassList from './pages/AttendanceClassList';
import AttendanceDetail from './pages/AttendanceDetail';
import TimekeepingHub from './pages/TimekeepingHub';
import NutritionManagement from './pages/NutritionManagement';
import StudentList from './pages/StudentList';
import StudentDetail from './pages/StudentDetail';
import StudentForm from './pages/StudentForm';

function ProtectedRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
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
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
