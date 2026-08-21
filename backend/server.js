const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./src/config/database');

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

connectDB();

// Routes
const authRoutes = require('./src/routes/authRoutes');
const classroomRoutes = require('./src/routes/classroomRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const financeRoutes = require('./src/routes/financeRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const procurementRoutes = require('./src/routes/procurementRoutes');
const timekeepingRoutes = require('./src/routes/timekeepingRoutes');
const { startTimekeepingSync } = require('./src/services/timekeepingSyncService');

app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/timekeeping', timekeepingRoutes);

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server đang chạy!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    startTimekeepingSync();
});
