import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import ParentAccountManagement from './pages/ParentAccountManagement';
import Dashboard from './pages/Dashboard';
import AttendanceClassList from './pages/AttendanceClassList';
import AttendanceDetail from './pages/AttendanceDetail';
import SmartAttendance from './pages/SmartAttendance';
import ManualTimekeeping from './pages/ManualTimekeeping';
import TimekeepingManagement from './pages/TimekeepingManagement'; // THÊM DÒNG NÀY

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
          element={<ProtectedRoute><SmartAttendance /></ProtectedRoute>}
        />
        <Route
          path="/timekeeping"
          element={<ProtectedRoute><ManualTimekeeping /></ProtectedRoute>}
        />
        {/* THÊM ROUTE MỚI */}
        <Route
          path="/timekeeping-management"
          element={<ProtectedRoute><TimekeepingManagement /></ProtectedRoute>}
        />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
