'use strict';

/**
 * @fileoverview Tiện ích điều phối giao dịch MongoDB an toàn đa môi trường (`safeTransaction.js`).
 *
 * Quy tắc hoạt động:
 * - Trên MongoDB Replica Set / Sharded Cluster (`mongos`): Khởi tạo `ClientSession`, chạy `session.withTransaction(...)`
 *   chuẩn ACID và luôn đóng `session.endSession()` trong khối `finally`.
 * - Trên MongoDB Standalone (môi trường máy cá nhân / container đơn lẻ chưa bật Replica Set):
 *   + Nếu `ALLOW_STANDALONE_MONGODB === 'false'`, từ chối rõ ràng với mã `503`.
 *   + Mặc định cho phép chạy fallback truyền `session = null` vào callback để Mongoose không gắn `txnNumber`
 *     (tránh lỗi `MongoServerError code 20: Transaction numbers are only allowed on a replica set member or mongos`).
 */

const mongoose = require('mongoose');

/**
 * Thực thi hàm nghiệp vụ trong MongoDB Transaction (hoặc chế độ fallback an toàn khi chạy Standalone).
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} operation
 * @param {string} [strictMessage='MongoDB phải chạy Replica Set để thực hiện giao dịch an toàn']
 * @returns {Promise<T>}
 */
const runSafeTransaction = async (
  operation,
  strictMessage = 'MongoDB phải chạy Replica Set để thực hiện giao dịch an toàn'
) => {
  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  const isReplicaOrMongos = Boolean(topology?.setName || topology?.msg === 'isdbgrid');

  if (!isReplicaOrMongos) {
    if (process.env.ALLOW_STANDALONE_MONGODB === 'false') {
      const error = new Error(strictMessage);
      error.statusCode = 503;
      error.status = 503;
      throw error;
    }
    return operation(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = { runSafeTransaction };

