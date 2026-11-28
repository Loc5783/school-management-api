/**
 * @fileoverview Bộ chuyển đổi thông báo Máy chấm công & Mạng nội bộ sang 100% Tiếng Việt tự nhiên trên Trình duyệt.
 *
 * Tuyệt đối không để lộ bất kỳ thuật ngữ kỹ thuật thô nào (CORS, Digest 401, ETIMEDOUT, Failed to fetch,
 * Network Error, subnet, regex...) ra màn hình của Admin trường hoặc Giáo viên/Bảo vệ.
 */

const RAW_TECH_TOKENS = [
  /\bCORS\b/gi,
  /\bDigest\b/gi,
  /\bETIMEDOUT\b/gi,
  /\bECONNREFUSED\b/gi,
  /\bEHOSTUNREACH\b/gi,
  /\bENETUNREACH\b/gi,
  /\bECONNRESET\b/gi,
  /\bENOENT\b:?/gi,
  /\bEACCES\b:?/gi,
  /\bEPERM\b:?/gi,
  /no such file or directory,?\s*(open\s*'[^']*')?/gi,
  /\bERR_[A-Z0-9_]+\b/gi,
  /\bHTTP\s*\d{3}\b/gi,
  /\bstatus\s*code\s*\d{3}\b/gi,
  /\bSSRF_BLOCKED\b/gi,
  /\bISAPI\b/gi,
  /\bAES-256-GCM\b/gi,
  /\bregex\b/gi,
  /\bsubnet\b/gi,
  /\bNetwork Error\b/gi,
  /\bFailed to fetch\b/gi,
  /\bLoad failed\b/gi,
  /\bTypeError:\s*/gi,
  /\b401\b/g,
  /\b403\b/g,
  /\b502\b/g,
  /\b503\b/g,
  /\b504\b/g
];

export function scrubRawTechTerms(input = '') {
  let clean = String(input || '').trim();
  if (!clean) {
    return 'Hệ thống chưa thực hiện được thao tác này. Bạn vui lòng kiểm tra lại kết nối máy chấm công rồi thử lại nhé.';
  }

  let matchedJargon = false;
  for (const reg of RAW_TECH_TOKENS) {
    if (reg.test(clean)) {
      matchedJargon = true;
      clean = clean.replace(reg, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  clean = clean
    .replace(/\(\s*[:,-]?\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/^[:,-]\s*/, '')
    .trim();

  if (!clean || (matchedJargon && clean.length < 16)) {
    return 'Chưa liên lạc được với máy chấm công tại trường. Bạn hãy kiểm tra dây mạng, nguồn điện của máy và đảm bảo đã bật Bộ kết nối nội bộ trên máy tính nhé.';
  }
  return clean;
}

/**
 * Chuyển đổi mọi đối tượng lỗi Axios / Fetch / Connector sang lời nhắn tiếng Việt tự nhiên, thân thiện.
 */
export function toFriendlyVietnameseNotice(err, fallbackText = '') {
  if (!err) {
    return fallbackText || 'Thao tác chưa hoàn tất, bạn vui lòng bấm thử lại nhé.';
  }

  if (typeof err === 'string') {
    return scrubRawTechTerms(err);
  }

  const apiCode = String(err.response?.data?.code || err.code || '').toUpperCase();
  const apiMessage = err.response?.data?.message || '';
  const rawMessage = String(apiMessage || err.message || '');
  const lower = rawMessage.toLowerCase();

  if (
    apiCode === 'CONNECTOR_NOT_RUNNING' ||
    apiCode === 'LOCAL_CONNECTOR_UNREACHABLE' ||
    (err.isLocalConnectorError && (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('load failed')))
  ) {
    return 'Máy tính này chưa bật "Bộ kết nối máy chấm công nội bộ". Bạn hãy mở phần mềm Kết nối Hoa Nắng trên máy tính (hoặc bấm nút "Tải bộ kết nối 1 chạm" ngay bên trên nếu cài lần đầu), sau đó bấm thử lại nhé.';
  }

  if (apiCode === 'SERIAL_LOCKED_OTHER_CAMPUS') {
    return (
      apiMessage ||
      'Chiếc máy chấm công này đang được gắn bảo mật cho một phân hiệu trường khác. Để không kéo/đẩy nhầm dữ liệu học sinh, bạn vui lòng liên hệ Kỹ thuật viên Nhà cung cấp phần mềm nếu cần chuyển máy sang phân hiệu của mình nhé.'
    );
  }

  if (apiCode === 'HARDWARE_SERIAL_MISMATCH') {
    return (
      apiMessage ||
      'Chiếc máy đang cắm tại địa chỉ mạng này khác mã phần cứng với máy đã đăng ký cho phân hiệu của bạn. Hệ thống đã tự động khóa an toàn — bạn hãy bấm "Quét tìm máy trong mạng trường" để cập nhật lại địa chỉ đúng nhé.'
    );
  }

  if (apiCode === 'DEVICE_AUTH_FAILED' || lower.includes('sai mật khẩu') || lower.includes('sai username')) {
    return (
      scrubRawTechTerms(apiMessage) ||
      'Mật khẩu đăng nhập vào máy chấm công chưa đúng. Bạn hãy bấm biểu tượng Sửa trên thẻ máy và nhập lại mật khẩu quản trị của thiết bị Hikvision nhé.'
    );
  }

  if (
    apiCode === 'DEVICE_OFFLINE' ||
    apiCode === 'DEVICE_TIMEOUT' ||
    lower.includes('offline') ||
    lower.includes('timeout')
  ) {
    return (
      scrubRawTechTerms(apiMessage) ||
      'Chưa liên lạc được với máy chấm công. Bạn hãy kiểm tra xem máy chấm công ở cổng có đang bật điện và cắm cùng mạng Wi-Fi/dây mạng với máy tính này không nhé.'
    );
  }

  if (lower.includes('network error') || lower.includes('failed to fetch')) {
    return 'Đường truyền mạng trên máy tính vừa bị gián đoạn tạm thời. Bạn hãy kiểm tra kết nối Internet rồi bấm thử lại nhé.';
  }

  if (apiMessage) {
    return scrubRawTechTerms(apiMessage);
  }

  return scrubRawTechTerms(rawMessage || fallbackText);
}

/**
 * Phát âm báo chuông nhẹ nhàng (Web Audio API thuần túy, không cần tải file âm thanh ngoài) khi có trẻ quét mặt điểm danh.
 */
export function playGentleAttendanceChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now); // E5
    osc1.frequency.setValueAtTime(880, now + 0.11); // A5
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.4);
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 550);
  } catch {
    // Bỏ qua nếu trình duyệt chưa cho phép phát âm thanh tự động
  }
}

