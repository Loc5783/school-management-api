import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AttendanceClassList from './pages/AttendanceClassList';
import AttendanceDetail from './pages/AttendanceDetail';
import SmartAttendance from './pages/SmartAttendance';
import ManualTimekeeping from './pages/ManualTimekeeping';

function App() {
  const isAuthenticated = !!localStorage.getItem('token');

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />}
        />
        <Route
          path="/attendance"
          element={isAuthenticated ? <AttendanceClassList /> : <Navigate to="/login" />}
        />
        <Route
          path="/attendance/class/:classroomId"
          element={isAuthenticated ? <AttendanceDetail /> : <Navigate to="/login" />}
        />
        <Route
          path="/smart-attendance"
          element={isAuthenticated ? <SmartAttendance /> : <Navigate to="/login" />}
        />
        <Route
          path="/timekeeping"
          element={isAuthenticated ? <ManualTimekeeping /> : <Navigate to="/login" />}
        />
        <Route path="*" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
