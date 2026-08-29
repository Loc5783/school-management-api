const dotenv = require('dotenv');
const connectDB = require('./src/config/database');
const createApp = require('./app');
const { startTimekeepingSync } = require('./src/services/timekeepingSyncService');

dotenv.config();
const app = createApp();

connectDB();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    startTimekeepingSync();
});
