'use strict';

/**
 * @fileoverview Cấu hình kết nối MongoDB thông minh cho dự án `school-management-api`.
 *
 * Hỗ trợ tự động nhận diện môi trường chạy (Trong container Docker vs Trên máy chủ Windows/Linux):
 * 1. Khi chạy TRONG container Docker (`/.dockerenv`):
 *    - Nếu `MONGODB_URI` đang để `127.0.0.1` / `localhost` (từ `.env.example`), tự động chuyển sang
 *      service `mongodb:27017` nội bộ của Docker Compose (`rs0`).
 * 2. Khi chạy NGOÀI máy thật (`npm run dev` / `npm start`) nhưng muốn trỏ vào Mongo của Docker:
 *    - Tự động ánh xạ host `mongodb:27017` sang `127.0.0.1:<DOCKER_MONGO_HOST_PORT>` (mặc định `27019`)
 *      kèm `directConnection=true` để không bị lỗi phân giải tên miền Replica Set `ENOTFOUND mongodb`.
 * 3. Tự động thử kết nối lại (Retry) khi container MongoDB vừa bật và đang bầu chọn `PRIMARY`.
 */

const fs = require('fs');
const mongoose = require('mongoose');

const DEFAULT_DOCKER_URI = 'mongodb://mongodb:27017/school_management?replicaSet=rs0';
const DEFAULT_DOCKER_HOST_PORT = '27019';
const MAX_CONNECT_RETRIES = 10;
const RETRY_DELAY_MS = 2500;

/**
 * Kiểm tra tiến trình hiện tại có đang chạy bên trong container Docker hay không.
 *
 * @returns {boolean}
 */
const isRunningInsideDocker = () => {
  if (process.env.RUNNING_IN_DOCKER === 'true') return true;
  return fs.existsSync('/.dockerenv');
};

/**
 * Chuẩn hóa chuỗi kết nối `MONGODB_URI` tương thích cho cả trong container Docker lẫn ngoài máy chủ.
 *
 * @param {string} rawUri
 * @returns {string}
 */
const resolveEffectiveMongoUri = (rawUri) => {
  const baseUri = (rawUri && rawUri.trim()) ? rawUri.trim() : DEFAULT_DOCKER_URI;
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

  if (isTestEnv || baseUri.startsWith('mongodb+srv://')) {
    return baseUri;
  }

  try {
    const parsed = new URL(baseUri.replace(/^mongodb:\/\//, 'http://'));
    const hostname = parsed.hostname.toLowerCase();
    const inDocker = isRunningInsideDocker();

    // Trường hợp 1: Đang chạy TRONG container Docker nhưng URI lại trỏ vào 127.0.0.1 / localhost
    if (inDocker && (hostname === '127.0.0.1' || hostname === 'localhost')) {
      const dockerMongoHost = process.env.DOCKER_MONGO_HOST || 'mongodb';
      parsed.hostname = dockerMongoHost;
      parsed.port = '27017';
      parsed.searchParams.delete('directConnection');
      if (!parsed.searchParams.has('replicaSet')) {
        parsed.searchParams.set('replicaSet', 'rs0');
      }
      return parsed.toString().replace(/^http:\/\//, 'mongodb://');
    }

    // Trường hợp 2: Đang chạy NGOÀI máy chủ (VS Code / Terminal) nhưng muốn kết nối vào Mongo của Docker
    if (!inDocker) {
      const dockerHostPort = String(process.env.DOCKER_MONGO_HOST_PORT || DEFAULT_DOCKER_HOST_PORT).trim();

      if (hostname === 'mongodb' || hostname === 'school-mongodb') {
        parsed.hostname = '127.0.0.1';
        parsed.port = dockerHostPort;
        parsed.searchParams.delete('replicaSet');
        parsed.searchParams.set('directConnection', 'true');
        return parsed.toString().replace(/^http:\/\//, 'mongodb://');
      }

      // Nếu người dùng tự gõ 127.0.0.1:27019 (cổng Mongo Docker) mà quên directConnection=true
      if ((hostname === '127.0.0.1' || hostname === 'localhost') && parsed.port === dockerHostPort) {
        parsed.searchParams.delete('replicaSet');
        if (!parsed.searchParams.has('directConnection')) {
          parsed.searchParams.set('directConnection', 'true');
        }
        return parsed.toString().replace(/^http:\/\//, 'mongodb://');
      }
    }
  } catch {
    return baseUri;
  }

  return baseUri;
};

/**
 * Bọc hàm tạo session của Mongoose để tương thích với MongoDB Standalone khi không bật Replica Set.
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Khởi tạo kết nối tới cơ sở dữ liệu MongoDB kèm cơ chế tự thử lại khi container DB đang khởi động.
 *
 * @returns {Promise<import('mongoose').Connection>}
 */
const connectDB = async () => {
  const effectiveUri = resolveEffectiveMongoUri(process.env.MONGODB_URI);
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  const maxAttempts = isTestEnv ? 1 : Number(process.env.DB_CONNECT_MAX_RETRIES || MAX_CONNECT_RETRIES);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await mongoose.connect(effectiveUri, {
        serverSelectionTimeoutMS: 5000
      });

      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      const isReplicaOrMongos = Boolean(hello.setName || hello.msg === 'isdbgrid');

      if (!isReplicaOrMongos && process.env.ALLOW_STANDALONE_MONGODB !== 'false') {
        enableStandaloneTransactionFallback(mongoose.connection);
        console.log(`✅ Đã kết nối MongoDB thành công (${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} - chế độ Standalone)!`);
      } else {
        console.log(`✅ Đã kết nối MongoDB thành công (${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name} - ReplicaSet: ${hello.setName || 'cluster'})!`);
      }

      return mongoose.connection;
    } catch (err) {
      if (attempt < maxAttempts) {
        console.warn(`⏳ [MongoDB] Đang chờ cơ sở dữ liệu sẵn sàng (lần thử ${attempt}/${maxAttempts}): ${err.message}`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      console.error(`❌ Lỗi kết nối MongoDB (${effectiveUri}): ${err.message}`);
      if (!isRunningInsideDocker() && effectiveUri.includes(':27019')) {
        console.error('💡 Gợi ý: Bạn đang cấu hình kết nối vào MongoDB của Docker (cổng 27019). Hãy bật Docker Desktop và chạy: docker compose up -d mongodb');
      }
      process.exit(1);
    }
  }
};

module.exports = connectDB;
module.exports.resolveEffectiveMongoUri = resolveEffectiveMongoUri;
