const express = require('express');
const cors = require('cors');

const authRoutes = require('./src/routes/authRoutes');
const classroomRoutes = require('./src/routes/classroomRoutes');
const studentRoutes = require('./src/routes/studentRoutes');
const attendanceRoutes = require('./src/routes/attendanceRoutes');
const financeRoutes = require('./src/routes/financeRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const procurementRoutes = require('./src/routes/procurementRoutes');
const timekeepingRoutes = require('./src/routes/timekeepingRoutes');
const systemUserRoutes = require('./src/routes/systemUserRoutes');
const nutritionRoutes = require('./src/routes/nutritionRoutes');

const createApp = () => {
    const app = express();
    const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    app.use(cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error('Origin không được phép truy cập API'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Api-Key']
    }));
    app.use(express.json());

    app.use('/api/auth', authRoutes);
    app.use('/api/classrooms', classroomRoutes);
    app.use('/api/students', studentRoutes);
    app.use('/api/attendance', attendanceRoutes);
    app.use('/api/finance', financeRoutes);
    app.use('/api/reports', reportRoutes);
    app.use('/api/procurement', procurementRoutes);
    app.use('/api/timekeeping', timekeepingRoutes);
    app.use('/api/system', systemUserRoutes);
    app.use('/api/nutrition', nutritionRoutes);

    app.get('/api/health', (req, res) => {
        res.status(200).json({ status: 'OK', message: 'Server đang chạy!' });
    });

    return app;
};

module.exports = createApp;
