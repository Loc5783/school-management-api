import api from '../api/axiosConfig';

const storageKey = () => {
  try { const user = JSON.parse(localStorage.getItem('user') || '{}'); return `school_guard_offline_queue_v1_${user._id || user.id || user.username || 'anonymous'}`; }
  catch { return 'school_guard_offline_queue_v1_anonymous'; }
};
const endpoints = {
  gate: ['/guard/gate-events', 'post'],
  visitor: ['/guard/visitors', 'post'],
  incident: ['/guard/incidents', 'post'],
  delivery: ['/guard/deliveries', 'post']
};

export const readGuardQueue = () => {
  try { const data = JSON.parse(localStorage.getItem(storageKey()) || '[]'); return Array.isArray(data) ? data : []; }
  catch { return []; }
};

export const queueGuardOperation = (operation, payload) => {
  if (!endpoints[operation]) throw new Error('Thao tác ngoại tuyến không hợp lệ');
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const queue = [...readGuardQueue(), { id, operation, payload: { ...payload, clientEventId: id, occurredAt: new Date().toISOString() }, queuedAt: new Date().toISOString() }];
  localStorage.setItem(storageKey(), JSON.stringify(queue));
  return queue;
};

export const syncGuardQueue = async () => {
  const queue = readGuardQueue();
  const remaining = [];
  let synced = 0;
  for (const item of queue) {
    try { const [url, method] = endpoints[item.operation]; await api[method](url, item.payload); synced += 1; }
    catch (error) { remaining.push({ ...item, lastError: error.response?.data?.message || 'Chưa thể đồng bộ' }); if (!error.response) remaining.push(...queue.slice(queue.indexOf(item) + 1)); break; }
  }
  localStorage.setItem(storageKey(), JSON.stringify(remaining));
  return { synced, remaining };
};
