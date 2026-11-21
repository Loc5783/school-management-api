const tenantFeatureGate = (req, res, next) => {
  // If explicitly enabled via config (default false in Phase 1A)
  const isReady = process.env.TENANT_FEATURE_READINESS === 'true';
  if (isReady) {
    return next();
  }

  return res.status(501).json({
    success: false,
    code: 'MODULE_NOT_IMPLEMENTED_IN_PHASE_1A',
    message: 'Phân hệ nghiệp vụ chưa sẵn sàng trong Giai đoạn 1A (Backend Feature Gate Fail-Closed)'
  });
};

// Handshake verification for WebSockets / TCP socket upgrades
const verifySocketHandshake = (req, socket) => {
  const isReady = process.env.TENANT_FEATURE_READINESS === 'true';
  if (!isReady) {
    if (socket && typeof socket.write === 'function') {
      socket.write('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
    return false;
  }
  return true;
};

module.exports = {
  tenantFeatureGate,
  verifySocketHandshake
};
