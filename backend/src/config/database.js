'use strict';

/**
 * @fileoverview Cấu hình kết nối MongoDB cho dự án `school-management-api`.
 *
 * Hỗ trợ linh hoạt cả 2 chế độ:
 * 1. Production / Replica Set (`rs0`): Giữ nguyên cơ chế ACID Transaction gốc của MongoDB.
 * 2. Development Standalone (`127.0.0.1:27017` mặc định trên Windows khi bật `ALLOW_STANDALONE_MONGODB=true`):
 *    Tự động bọc `session.withTransaction` sang thực thi tuần tự không gọi `startTransaction()`,
 *    giúp lập trình viên chạy toàn bộ nghiệp vụ trên máy cá nhân mà không bị lỗi
 *    `Transaction numbers are only allowed on a replica set member`.
 */

const mongoose = require('mongoose');

const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/school_management';

/**
 * Bọc hàm tạo session của Mongoose để tương thích với MongoDB Standalone ở môi trường phát triển.
 *
 * @param {import('mongoose').Connection} conn
 */
const enableStandaloneTransactionFallback = (conn) => {
  if (conn._standaloneTxPatched) return;
  conn._standaloneTxPatched = true;

  const wrapSession = (session) => {
    if (session && typeof session === 'object' && !session._standalonePatched) {
      session._standalonePatched = true;
      session.withTransaction = async (fn) => fn(session);
    }
    return session;
  };

  const origConnStartSession = conn.startSession.bind(conn);
  conn.startSession = async (...args) => {
    const session = await origConnStartSession(...args);
    return wrapSession(session);
  };

  if (!mongoose._standaloneRootSessionPatched) {
    mongoose._standaloneRootSessionPatched = true;
    const origRootStartSession = mongoose.startSession.bind(mongoose);
    mongoose.startSession = async (...args) => {
      const session = await origRootStartSession(...args);
      return wrapSession(session);
    };
  }
};

/**
 * Khởi tạo kết nối tới cơ sở dữ liệu MongoDB.
 *
 * @returns {Promise<import('mongoose').Connection>}
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || DEFAULT_LOCAL_URI;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    const isReplicaOrMongos = Boolean(hello.setName || hello.msg === 'isdbgrid');

    if (!isReplicaOrMongos && process.env.ALLOW_STANDALONE_MONGODB === 'true') {
      enableStandaloneTransactionFallback(mongoose.connection);
      console.log(`✅ Đã kết nối MongoDB thành công (${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} - chế độ Standalone Dev)!`);
    } else {
      console.log(`✅ Đã kết nối MongoDB thành công (${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} - ReplicaSet: ${hello.setName || 'cluster'})!`);
    }

    return mongoose.connection;
  } catch (err) {
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
