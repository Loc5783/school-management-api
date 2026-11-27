'use strict';

/**
 * @fileoverview Cấu hình kết nối MongoDB đa môi trường cho dự án `school-management-api`.
 *
 * Giải quyết triệt để bài toán kết nối khi `MONGODB_URI=mongodb://127.0.0.1:27017/school_management`:
 * 1. Khi chạy bằng `docker compose up`: Tự động kết nối tới container `mongodb:27017` trong cùng mạng.
 * 2. Khi chỉ build & chạy lẻ 1 container `Dockerfile` (trên Docker Desktop, VPS Linux, Coolify, Portainer...):
 *    Trong container `127.0.0.1` là chính nó nên không thấy Mongo bên ngoài -> Hệ thống tự động dò lần lượt:
 *    - `mongodb:27017` / `mongo:27017` (nếu chung Docker network)
 *    - `host.docker.internal:<port>` (Docker Desktop Windows/Mac hoặc Linux có `host-gateway`)
 *    - `<IP Gateway thực tế đọc từ /proc/net/route>:<port>` (mọi mạng bridge của Docker trên Linux VPS)
 *    - `127.0.0.1:<port>` (nếu chạy `--network=host`)
 * 3. Tự động tương thích cả MongoDB Standalone lẫn Replica Set (`rs0`) mà không cần sửa tay chuỗi URI.
 */

const fs = require('fs');
const mongoose = require('mongoose');

const DEFAULT_LOCAL_URI = 'mongodb://127.0.0.1:27017/school_management';
const DEFAULT_DOCKER_HOST_PORT = '27019';
const MAX_CONNECT_ROUNDS = 6;
const RETRY_DELAY_MS = 2000;
const PER_CANDIDATE_TIMEOUT_MS = 2500;

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
 * Đọc địa chỉ IPv4 Default Gateway của container từ `/proc/net/route` trên Linux.
 * Đây chính là địa chỉ IP của máy chủ Docker Host trên mạng bridge hiện tại (VD: `172.17.0.1`, `172.18.0.1`...).
 *
 * @returns {string | null}
 */
const detectLinuxDockerGatewayIp = () => {
  try {
    if (!fs.existsSync('/proc/net/route')) return null;
    const lines = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].trim().split(/\s+/);
      // Cột 1 là Destination (00000000 = default route), cột 2 là Gateway ở hệ Hex little-endian
      if (cols.length >= 3 && cols[1] === '00000000' && /^[0-9A-Fa-f]{8}$/.test(cols[2])) {
        const hex = cols[2];
        const octets = [
          parseInt(hex.slice(6, 8), 16),
          parseInt(hex.slice(4, 6), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(0, 2), 16)
        ];
        const ip = octets.join('.');
        if (ip !== '0.0.0.0') return ip;
      }
    }
  } catch {
    // Bỏ qua nếu không phải môi trường Linux
  }
  return null;
};

/**
 * Tạo một URI ứng viên mới từ URL gốc đã parse nhưng giữ nguyên tên DB và thông tin xác thực (nếu có).
 *
 * @param {URL} baseParsed
 * @param {string} hostname
 * @param {string} port
 * @param {boolean} [forceDirect=false]
 * @returns {string}
 */
const formatCandidateUri = (baseParsed, hostname, port, forceDirect = false) => {
  const clone = new URL(baseParsed.toString());
  clone.hostname = hostname;
  clone.port = port;
  // Không ép replicaSet để kết nối được cả Mongo Standalone lẫn Replica Set
  clone.searchParams.delete('replicaSet');
  if (forceDirect) {
    clone.searchParams.set('directConnection', 'true');
  } else {
    clone.searchParams.delete('directConnection');
  }
  return clone.toString().replace(/^http:\/\//, 'mongodb://');
};

/**
 * Xây dựng danh sách theo thứ tự ưu tiên các địa chỉ MongoDB ứng viên dựa trên môi trường thực tế.
 *
 * @param {string | undefined} rawUri
 * @returns {string[]}
 */
const buildMongoCandidateUris = (rawUri) => {
  const baseUri = (rawUri && rawUri.trim()) ? rawUri.trim() : DEFAULT_LOCAL_URI;
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

  if (isTestEnv || baseUri.startsWith('mongodb+srv://')) {
    return [baseUri];
  }

  let parsed;
  try {
    parsed = new URL(baseUri.replace(/^mongodb:\/\//, 'http://'));
  } catch {
    return [baseUri];
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || '27017';
  const inDocker = isRunningInsideDocker();
  const candidates = [];

  const pushUnique = (uri) => {
    if (uri && !candidates.includes(uri)) {
      candidates.push(uri);
    }
  };

  if (inDocker) {
    const isLocalLoopback = hostname === '127.0.0.1' || hostname === 'localhost';
    if (!isLocalLoopback) {
      // Nếu người dùng cấu hình rõ tên host (VD: `mongodb`, `mongo`, IP nội bộ), ưu tiên thử chính nó trước
      pushUnique(baseUri);
      pushUnique(formatCandidateUri(parsed, hostname, port, true));
    }

    // Dò tự động các kênh Local Mongo phổ biến nhất trong Docker
    const preferredDockerService = process.env.DOCKER_MONGO_HOST || 'mongodb';
    pushUnique(formatCandidateUri(parsed, preferredDockerService, '27017', false));
    pushUnique(formatCandidateUri(parsed, 'host.docker.internal', port, true));

    const linuxGatewayIp = detectLinuxDockerGatewayIp();
    if (linuxGatewayIp) {
      pushUnique(formatCandidateUri(parsed, linuxGatewayIp, port, true));
    }
    pushUnique(formatCandidateUri(parsed, '172.17.0.1', port, true));
    pushUnique(formatCandidateUri(parsed, 'mongo', '27017', false));
    pushUnique(formatCandidateUri(parsed, 'school-mongodb', '27017', false));
    pushUnique(formatCandidateUri(parsed, '127.0.0.1', port, true));

    return candidates;
  }

  // Đang chạy NGOÀI Docker (trực tiếp bằng `node server.js` / `npm run dev` trên máy thật)
  const dockerHostPort = String(process.env.DOCKER_MONGO_HOST_PORT || DEFAULT_DOCKER_HOST_PORT).trim();
  if (hostname === 'mongodb' || hostname === 'mongo' || hostname === 'school-mongodb') {
    pushUnique(formatCandidateUri(parsed, '127.0.0.1', dockerHostPort, true));
    pushUnique(formatCandidateUri(parsed, '127.0.0.1', '27017', true));
    return candidates;
  }

  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    pushUnique(formatCandidateUri(parsed, '127.0.0.1', port, true));
    if (port !== dockerHostPort) {
      pushUnique(formatCandidateUri(parsed, '127.0.0.1', dockerHostPort, true));
    }
    return candidates;
  }

  return [baseUri];
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
      // Truyền `null` thay vì ClientSession sống vào callback trên MongoDB Standalone để tránh xung đột txnNumber
      session.withTransaction = async (fn) => fn(null);
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
 * Khởi tạo kết nối tới cơ sở dữ liệu MongoDB kèm tự động dò tìm Local Mongo và thử lại khi khởi động.
 *
 * @returns {Promise<import('mongoose').Connection>}
 */
const connectDB = async () => {
  const candidates = buildMongoCandidateUris(process.env.MONGODB_URI);
  const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  const maxRounds = isTestEnv ? 1 : Number(process.env.DB_CONNECT_MAX_RETRIES || MAX_CONNECT_ROUNDS);
  const timeoutMs = isTestEnv ? 5000 : PER_CANDIDATE_TIMEOUT_MS;

  let lastError = null;

  for (let round = 1; round <= maxRounds; round++) {
    for (const candidateUri of candidates) {
      try {
        await mongoose.connect(candidateUri, {
          serverSelectionTimeoutMS: timeoutMs,
          ...(isTestEnv
            ? {}
            : {
                maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 30),
                minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 2),
                socketTimeoutMS: 45000,
                heartbeatFrequencyMS: 10000
              })
        });

        if (!isTestEnv && !mongoose.connection._runtimeListenersAttached) {
          mongoose.connection._runtimeListenersAttached = true;
          mongoose.connection.on('error', (connErr) => {
            console.error('⚠️ [MongoDB Runtime Error]:', connErr.message);
          });
        }

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
        lastError = err;
        await mongoose.disconnect().catch(() => {});
      }
    }

    if (round < maxRounds) {
      console.warn(`⏳ [MongoDB] Đang chờ kết nối cơ sở dữ liệu (vòng ${round}/${maxRounds})...`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  console.error(`❌ Lỗi kết nối MongoDB sau khi thử các địa chỉ [${candidates.join(', ')}]: ${lastError ? lastError.message : 'Unknown error'}`);
  if (isRunningInsideDocker()) {
    console.error('💡 Gợi ý Docker: Nếu bạn chạy rời container Mongo trên VPS, hãy đảm bảo cả 2 cùng mạng Docker (`docker network connect ...`), hoặc Mongo mở cổng `-p 27017:27017`, hoặc chạy bằng `docker compose up -d`.');
  }
  process.exit(1);
};

module.exports = connectDB;
module.exports.buildMongoCandidateUris = buildMongoCandidateUris;
