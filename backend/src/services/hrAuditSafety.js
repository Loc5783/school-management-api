const mongoose = require('mongoose');

const hiddenKey = (key) => /password|passwordhash|token|secret|authorization|cookie|otp|(^|[._])pin$|rawpayload|payload|fingerprint|photo|image|biometric/i.test(key);
const maskedKey = (key) => /(^|[._])(idCard|accountNumber|bankAccountNumber)$/i.test(key);
const sanitizeAuditValue = (value, path = '', depth = 0) => {
  if (depth > 8) return '[Nội dung lồng sâu]';
  if (maskedKey(path)) return value == null || value === '' ? value : `***${String(value).slice(-4)}`;
  if (value == null || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 4000) : value;
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if (Buffer.isBuffer(value)) return '[Dữ liệu nhị phân]';
  if (typeof value.toObject === 'function') value = value.toObject();
  if (Array.isArray(value)) {
    const entries = value.slice(0, 1000).map((entry) => sanitizeAuditValue(entry, path, depth + 1));
    if (value.length > 1000) entries.push(`[Còn ${value.length - 1000} phần tử]`);
    return entries;
  }
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => !hiddenKey(key) || (typeof entry === 'boolean' && /changed$/i.test(key))).map(([key, entry]) => [key, sanitizeAuditValue(entry, path ? `${path}.${key}` : key, depth + 1)]));
};
const safeReason = (value) => String(value || '').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [đã ẩn]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[đã ẩn]').slice(0, 1000);
const stampActor = async (document, actorId, fallback = '') => {
  if (document.actorName && document.actorRole) return;
  if (!actorId) { document.actorName = document.actorName || 'Tác vụ hệ thống'; document.actorRole = document.actorRole || 'system'; return; }
  const User = mongoose.models.User || require('../models/zone1_system/User');
  const user = await User.findById(actorId).select('username profile.fullName role').session(document.$session() || null).lean();
  document.actorName = document.actorName || user?.profile?.fullName || fallback || String(actorId);
  document.actorRole = document.actorRole || user?.role || '';
};
const changeFields = (before, after) => {
  const flatten = (value, prefix = '', result = {}) => {
    for (const [key, entry] of Object.entries(value || {})) {
      if (['__v', '_id', 'createdAt', 'updatedAt'].includes(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && !(entry instanceof Date) && !(entry instanceof mongoose.Types.ObjectId)) flatten(entry, path, result);
      else result[path] = entry;
    }
    return result;
  };
  const left = flatten(sanitizeAuditValue(before)); const right = flatten(sanitizeAuditValue(after));
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null)).slice(0, 150)
    .map((field) => ({ field, before: left[field] ?? null, after: right[field] ?? null }));
};
module.exports = { sanitizeAuditValue, safeReason, stampActor, changeFields };
