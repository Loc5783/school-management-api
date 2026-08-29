require('dotenv').config();

const connectDB = require('./src/config/database');
const createApp = require('./app');
const { startTimekeepingSync } = require('./src/services/timekeepingSyncService');

const app = createApp();
const PORT = process.env.PORT || 5000;
const schedulerEnabled = process.env.TIMEKEEPING_SCHEDULER_ENABLED !== 'false';

const startServer = async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
        if (schedulerEnabled) startTimekeepingSync();
        else console.log('Attendance scheduler disabled by TIMEKEEPING_SCHEDULER_ENABLED=false');
    });
};

startServer();
