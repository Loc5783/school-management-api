'use strict';

/**
 * @fileoverview Trung tâm phát sóng sự kiện thời gian thực (Server-Sent Events - SSE) cô lập tuyệt đối theo `tenantId`.
 *
 * Dùng để đẩy tức thời các thông báo tiếng Việt thân thiện khi:
 * - Học sinh hoặc nhân sự vừa quét khuôn mặt / thẻ từ tại máy chấm công Hikvision.
 * - Quá trình đồng bộ khuôn mặt, cập nhật địa chỉ Webhook hoặc kiểm tra thiết bị hoàn tất.
 *
 * Bảo mật Multi-Tenant:
 * - Mỗi kết nối SSE chỉ được đăng ký vào kênh của đúng `tenantId` xác thực từ JWT.
 * - Sự kiện của phân hiệu nào tuyệt đối chỉ phát tới trình duyệt đang mở của phân hiệu đó.
 */

const crypto = require('crypto');

const MAX_RECENT_EVENTS_PER_TENANT = 30;
const HEARTBEAT_INTERVAL_MS = 20000;

/** @type {Map<string, Set<import('express').Response>>} */
const tenantSseClients = new Map();

/** @type {Map<string, Array<Record<string, any>>>} */
const tenantRecentEvents = new Map();

/**
 * Đẩy một sự kiện tiếng Việt tự nhiên tới tất cả trình duyệt đang trực tuyến của đúng phân hiệu (`tenantId`).
 *
 * @param {string | import('mongoose').Types.ObjectId} tenantId
 * @param {{
 *   type: string,
 *   tone?: 'success' | 'warning' | 'info' | 'error',
 *   title: string,
 *   message: string,
 *   subjectType?: string,
 *   personCode?: string,
 *   fullName?: string,
 *   className?: string,
 *   deviceName?: string,
 *   occurredAt?: string | Date
 * }} payload
 */
function publishCampusRealtimeEvent(tenantId, payload) {
  if (!tenantId || !payload?.message) return null;
  const key = String(tenantId);

  const eventType = payload.type || payload.category || 'CAMPUS_EVENT';
  const eventRecord = {
    id: crypto.randomUUID(),
    type: eventType,
    category: payload.category || eventType,
    tone: payload.tone || 'info',
    title: payload.title || 'Thông báo từ máy chấm công',
    message: payload.message,
    subjectType: payload.subjectType || null,
    personCode: payload.personCode || null,
    fullName: payload.fullName || null,
    className: payload.className || null,
    deviceName: payload.deviceName || null,
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt).toISOString() : new Date().toISOString()
  };

  // Lưu vào bộ đệm 30 sự kiện gần nhất của riêng phân hiệu đó
  const history = tenantRecentEvents.get(key) || [];
  history.unshift(eventRecord);
  if (history.length > MAX_RECENT_EVENTS_PER_TENANT) {
    history.length = MAX_RECENT_EVENTS_PER_TENANT;
  }
  tenantRecentEvents.set(key, history);

  // Phát tức thời tới các kết nối SSE đang mở của đúng phân hiệu đó
  const clients = tenantSseClients.get(key);
  if (clients && clients.size > 0) {
    const wireData = `event: campus_event\ndata: ${JSON.stringify(eventRecord)}\n\n`;
    for (const res of clients) {
      try {
        res.write(wireData);
        if (typeof res.flush === 'function') {
          res.flush();
        }
      } catch {
        clients.delete(res);
      }
    }
  }

  return eventRecord;
}

/**
 * Lấy danh sách sự kiện thời gian thực gần nhất của phân hiệu (`tenantId`).
 *
 * @param {string | import('mongoose').Types.ObjectId} tenantId
 * @param {number} [limit=15]
 */
function getRecentCampusRealtimeEvents(tenantId, limit = 15) {
  if (!tenantId) return [];
  const list = tenantRecentEvents.get(String(tenantId)) || [];
  return list.slice(0, Math.max(1, Math.min(30, Number(limit) || 15)));
}

/**
 * Đăng ký kết nối HTTP Server-Sent Events (SSE) cho trình duyệt của một nhân sự thuộc phân hiệu (`tenantId`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string | import('mongoose').Types.ObjectId} tenantId
 */
function attachCampusSseStream(req, res, tenantId) {
  const key = String(tenantId);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Gửi ngay danh sách các sự kiện vừa diễn ra gần đây của phân hiệu để bảng trực tiếp hiển thị tức thì
  const snapshot = getRecentCampusRealtimeEvents(key, 12);
  res.write(`event: snapshot\ndata: ${JSON.stringify({ items: snapshot })}\n\n`);
  if (typeof res.flush === 'function') {
    res.flush();
  }

  let set = tenantSseClients.get(key);
  if (!set) {
    set = new Set();
    tenantSseClients.set(key, set);
  }
  set.add(res);

  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (typeof res.flush === 'function') {
        res.flush();
      }
    } catch {
      clearInterval(heartbeatTimer);
      set.delete(res);
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    const currentSet = tenantSseClients.get(key);
    if (currentSet) {
      currentSet.delete(res);
      if (currentSet.size === 0) {
        tenantSseClients.delete(key);
      }
    }
  });
}

module.exports = {
  publishCampusRealtimeEvent,
  getRecentCampusRealtimeEvents,
  attachCampusSseStream
};

