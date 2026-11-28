'use strict';

/**
 * @fileoverview Bộ dịch thông báo thiết bị chấm công & mạng nội bộ sang 100% Tiếng Việt tự nhiên, thân thiện.
 *
 * Nguyên tắc bắt buộc:
 * - Tuyệt đối KHÔNG để lộ thuật ngữ kỹ thuật thô (CORS, Digest 401, ETIMEDOUT, ECONNREFUSED, SSRF,
 *   subnet regex, JSON, XML, statusCode, faceQualityLow, E11000...) ra giao diện người dùng.
 * - Mọi thông báo phải giải thích rõ nguyên nhân đời thường và hướng dẫn bước bấm tiếp theo.
 */

const TECHNICAL_JARGON_PATTERNS = [
  /\bCORS\b/gi,
  /\bDigest\b/gi,
  /\bETIMEDOUT\b/gi,
  /\bECONNREFUSED\b/gi,
  /\bEHOSTUNREACH\b/gi,
  /\bENETUNREACH\b/gi,
  /\bECONNRESET\b/gi,
  /\bEPIPE\b/gi,
  /\bERR_[A-Z0-9_]+\b/gi,
  /\bHTTP\s*\d{3}\b/gi,
  /\bstatus\s*code\s*\d{3}\b/gi,
  /\bSSRF_BLOCKED\b/gi,
  /\bregex\b/gi,
  /\bsubnet\b/gi,
  /\bJSON\.parse\b/gi,
  /\bUnexpected token\b/gi,
  /\bNetwork Error\b/gi,
  /\bFailed to fetch\b/gi,
  /\bLoad failed\b/gi,
  /\b401\b/g,
  /\b403\b/g,
  /\b502\b/g,
  /\b503\b/g,
  /\b504\b/g
];

/**
 * Làm sạch chuỗi dự phòng nếu không khớp mã lỗi đã định nghĩa để đảm bảo không sót từ khóa kỹ thuật.
 *
 * @param {string} rawText
 * @returns {string}
 */
function scrubTechnicalJargon(rawText = '') {
  let text = String(rawText || '').trim();
  if (!text) {
    return 'Hệ thống chưa thực hiện được thao tác này. Bạn vui lòng kiểm tra lại kết nối máy chấm công rồi bấm thử lại nhé.';
  }

  let hadJargon = false;
  for (const pattern of TECHNICAL_JARGON_PATTERNS) {
    if (pattern.test(text)) {
      hadJargon = true;
      text = text.replace(pattern, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // Loại bỏ dấu ngoặc rỗng còn sót lại sau khi lọc mã lỗi kỹ thuật
  text = text
    .replace(/\(\s*[:,-]?\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/^[:,-]\s*/, '')
    .trim();

  if (!text || (hadJargon && text.length < 15)) {
    return 'Chưa kết nối được với máy chấm công tại trường. Bạn hãy kiểm tra dây mạng, nguồn điện của máy rồi bấm thử lại nhé.';
  }

  return text;
}

/**
 * Dịch lỗi từ thiết bị Hikvision, mạng LAN hoặc Cầu nối nội bộ sang câu hướng dẫn tiếng Việt tự nhiên.
 *
 * @param {Error | Record<string, any> | string} errOrInput
 * @param {{ deviceName?: string, host?: string, campus?: string, personName?: string }} [context]
 * @returns {{ friendlyMessage: string, nextStepHint: string, category: string }}
 */
function translateHardwareErrorToVietnamese(errOrInput, context = {}) {
  const errObj = typeof errOrInput === 'object' && errOrInput !== null ? errOrInput : {};
  const code = String(errObj.code || errObj.errorCode || '').toUpperCase();
  const rawMsg = String(
    typeof errOrInput === 'string'
      ? errOrInput
      : errObj.friendlyMessage || errObj.message || errObj.subStatusCode || ''
  );
  const lower = rawMsg.toLowerCase();
  const deviceLabel = context.deviceName
    ? `máy "${context.deviceName}"`
    : context.host
      ? `máy chấm công tại địa chỉ ${context.host}`
      : 'máy chấm công';

  // 1. Chưa bật hoặc trình duyệt chặn Cầu nối nội bộ 127.0.0.1:18686
  if (
    code === 'CONNECTOR_NOT_RUNNING' ||
    code === 'LOCAL_CONNECTOR_UNREACHABLE' ||
    lower.includes('127.0.0.1:18686') ||
    lower.includes('connector offline')
  ) {
    return {
      category: 'CONNECTOR_OFFLINE',
      friendlyMessage:
        'Máy tính này chưa bật "Bộ kết nối máy chấm công nội bộ" nên trình duyệt chưa nhìn thấy các máy chấm công trong mạng của trường.',
      nextStepHint:
        'Bạn hãy mở biểu tượng "Kết nối Máy chấm công Hoa Nắng" trên màn hình máy tính (hoặc bấm nút "Tải bộ kết nối 1 chạm" ngay trên trang này nếu máy tính mới cài lần đầu), sau đó bấm thử lại nhé.'
    };
  }

  if (code === 'CONNECTOR_TOKEN_EXPIRED' || code === 'CONNECTOR_AUTH_INVALID') {
    return {
      category: 'CONNECTOR_TOKEN',
      friendlyMessage:
        'Phiên kết nối an toàn giữa trình duyệt và máy tính tại trường vừa hết hạn để bảo vệ dữ liệu.',
      nextStepHint:
        'Bạn chỉ cần bấm lại nút vừa thao tác một lần nữa để hệ thống tự cấp khóa kết nối mới nhé.'
    };
  }

  // 2. Khóa cứng mã phần cứng deviceSerial gắn chặt với phân hiệu (Chống kéo/đẩy nhầm trường)
  if (
    code === 'SERIAL_LOCKED_OTHER_CAMPUS' ||
    code === 'CROSS_CAMPUS_SERIAL_BLOCKED' ||
    lower.includes('phân hiệu khác')
  ) {
    return {
      category: 'SERIAL_LOCKED_OTHER_CAMPUS',
      friendlyMessage:
        'Chiếc máy chấm công này hiện đang được khóa bảo mật cho một phân hiệu trường khác trên hệ thống.',
      nextStepHint:
        'Để tránh kéo hoặc đẩy nhầm danh sách học sinh giữa các trường, hệ thống đã tự động chặn thao tác. Nếu nhà trường vừa điều chuyển máy này về cơ sở mình, bạn vui lòng nhờ Kỹ thuật viên Nhà cung cấp phần mềm mở khóa chuyển phân hiệu giúp nhé.'
    };
  }

  if (code === 'HARDWARE_SERIAL_MISMATCH' || code === 'SERIAL_MISMATCH_CAMPUS_LOCK') {
    return {
      category: 'SERIAL_MISMATCH',
      friendlyMessage: `Chiếc máy đang cắm ở địa chỉ mạng này không khớp mã phần cứng với ${deviceLabel} đã đăng ký cho phân hiệu của bạn (có thể bộ phát Wi-Fi vừa đổi địa chỉ IP giữa các máy).`,
      nextStepHint:
        'Hệ thống đã tự động dừng đồng bộ để bảo vệ an toàn dữ liệu học sinh. Bạn hãy bấm "Quét tìm máy trong mạng trường" để cập nhật lại đúng địa chỉ mạng hiện tại của máy nhé.'
    };
  }

  if (code === 'SERIAL_UNLOCK_VENDOR_ONLY') {
    return {
      category: 'PERMISSION',
      friendlyMessage:
        'Mã phần cứng của máy chấm công đã được khóa cố định với phân hiệu trường để đảm bảo an toàn dữ liệu.',
      nextStepHint:
        'Khi cần thay thế máy chấm công mới hoặc chuyển máy sang cơ sở khác, bạn vui lòng liên hệ Kỹ thuật viên Nhà cung cấp phần mềm để gỡ khóa phần cứng nhé.'
    };
  }

  // 3. Sai mật khẩu quản trị máy chấm công Hikvision
  if (
    code === 'DEVICE_AUTH_FAILED' ||
    code === 'AUTH_FAILED' ||
    lower.includes('sai username') ||
    lower.includes('sai mật khẩu') ||
    lower.includes('401') ||
    lower.includes('digest') ||
    lower.includes('unauthorized')
  ) {
    return {
      category: 'AUTH_FAILED',
      friendlyMessage: `Mật khẩu quản trị của ${deviceLabel} chưa đúng nên máy chưa cho phép kết nối.`,
      nextStepHint:
        'Bạn hãy bấm biểu tượng "Cập nhật thông tin máy" (hình cây bút trên thẻ máy), nhập lại đúng mật khẩu quản trị của thiết bị Hikvision rồi bấm Lưu nhé.'
    };
  }

  if (code === 'DEVICE_CREDENTIALS_MISSING' || code === 'DEVICE_AUTH_CONFIG_MISSING' || code === 'NOT_RUN_MISSING_SECRET') {
    return {
      category: 'MISSING_PASSWORD',
      friendlyMessage: `${deviceLabel.charAt(0).toUpperCase() + deviceLabel.slice(1)} chưa được lưu mật khẩu quản trị nên chưa thể đồng bộ khuôn mặt.`,
      nextStepHint:
        'Bạn hãy bấm biểu tượng "Cập nhật thông tin máy" (hình cây bút), nhập mật khẩu của máy chấm công rồi bấm Lưu và thử lại nhé.'
    };
  }

  // 4. Máy chấm công tắt nguồn, tuột dây mạng hoặc khác mạng Wi-Fi/LAN
  if (
    code === 'DEVICE_OFFLINE' ||
    code === 'DEVICE_TIMEOUT' ||
    code === 'DEVICE_CONN_RESET' ||
    code === 'DEVICE_CONNECTION_ERROR' ||
    lower.includes('offline') ||
    lower.includes('hết thời gian kết nối') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach')
  ) {
    return {
      category: 'DEVICE_OFFLINE',
      friendlyMessage: `Chưa liên lạc được với ${deviceLabel}. Có thể máy chấm công đang tắt điện, tuột dây mạng hoặc máy tính bạn đang ngồi không dùng chung mạng Wi-Fi/dây mạng với trường.`,
      nextStepHint:
        'Bạn hãy kiểm tra xem màn hình máy chấm công ở cổng có đang sáng và cắm dây mạng ổn định không; nếu mới khởi động lại cục mạng của trường, hãy bấm "Quét tìm máy trong mạng trường" để tìm địa chỉ mới của máy nhé.'
    };
  }

  // 5. Ảnh thẻ học sinh / nhân sự không nhận diện được khuôn mặt hoặc vượt 200KB
  if (
    code === 'FACE_QUALITY_LOW' ||
    code === 'NO_FACE_DETECTED' ||
    lower.includes('facequality') ||
    lower.includes('nofacedetected') ||
    lower.includes('facepond') ||
    lower.includes('fdlib') ||
    lower.includes('không nhận diện được khuôn mặt')
  ) {
    const who = context.personName ? `của "${context.personName}"` : 'này';
    return {
      category: 'FACE_UNRECOGNIZED',
      friendlyMessage: `Máy chấm công báo ảnh chân dung ${who} chưa nhìn rõ khuôn mặt (ảnh có thể hơi tối, chụp nghiêng, quá xa hoặc bị tóc/khẩu trang che).`,
      nextStepHint:
        'Bạn hãy bấm nút "Chụp Camera" hoặc "Đổi ảnh khác" chọn tấm ảnh chụp chính diện, rõ mặt, đủ ánh sáng rồi bấm "Đẩy xuống máy" lại nhé.'
    };
  }

  if (code === 'FACE_IMAGE_TOO_LARGE' || code === 'INVALID_FACE_IMAGE' || code === 'CORRUPT_FACE_IMAGE' || code === 'UNSUPPORTED_FACE_FORMAT') {
    return {
      category: 'FACE_FILE_INVALID',
      friendlyMessage:
        'Tệp ảnh vừa chọn bị lỗi định dạng hoặc dung lượng quá nặng so với bộ nhớ máy chấm công.',
      nextStepHint:
        'Bạn hãy chọn ảnh chân dung thông thường (đuôi .JPG hoặc .PNG) hoặc bấm nút "Chụp Camera" để hệ thống tự căn chỉnh kích thước chuẩn cho máy chấm công nhé.'
    };
  }

  // 6. Nhập sai địa chỉ mạng khi quét tìm máy hoặc địa chỉ cấm
  if (code === 'FORBIDDEN_DEVICE_IP') {
    return {
      category: 'FORBIDDEN_IP',
      friendlyMessage:
        'Địa chỉ mạng này đang được khóa bảo vệ riêng cho thiết bị khác ngoài phạm vi trường học.',
      nextStepHint:
        'Bạn vui lòng nhập đúng địa chỉ mạng của máy chấm công lắp tại phân hiệu mình (hoặc để trống ô địa chỉ rồi bấm "Quét tìm máy trong mạng trường") nhé.'
    };
  }

  if (code === 'INVALID_SUBNET_PREFIX' || code === 'SSRF_BLOCKED' || code === 'DEVICE_INVALID_HOST') {
    return {
      category: 'INVALID_NETWORK_ADDRESS',
      friendlyMessage:
        'Địa chỉ mạng bạn vừa nhập chưa đúng dạng địa chỉ nội bộ trong trường học (ví dụ đúng: 192.168.1.8 hoặc 192.168.1).',
      nextStepHint:
        'Nếu không nhớ số địa chỉ của máy chấm công, bạn chỉ cần xóa trắng ô nhập rồi bấm nút "Quét tìm máy trong mạng trường" để hệ thống tự tìm giúp bạn nhé.'
    };
  }

  // 7. Thiết bị đang bận xử lý lệnh đồng bộ trước đó
  if (code === 'DEVICE_BUSY') {
    return {
      category: 'DEVICE_BUSY',
      friendlyMessage: `${deviceLabel.charAt(0).toUpperCase() + deviceLabel.slice(1)} đang bận nạp danh sách khuôn mặt của thao tác vừa bấm trước đó.`,
      nextStepHint:
        'Bạn vui lòng chờ khoảng 5 – 10 giây cho máy lưu xong đợt hiện tại rồi bấm lại nhé.'
    };
  }

  // 8. Chưa có máy nào hoặc chưa cấp mã học sinh/nhân sự
  if (code === 'NO_ACTIVE_DEVICES' || code === 'NO_CAMPUS_DEVICES') {
    return {
      category: 'NO_DEVICES',
      friendlyMessage:
        'Phân hiệu hiện tại chưa có máy chấm công nào đang bật trong danh sách kết nối.',
      nextStepHint:
        'Bạn hãy bấm nút "Quét tìm máy trong mạng trường" trên đầu trang để tìm và lưu máy chấm công của phân hiệu mình trước nhé.'
    };
  }

  if (code === 'MISSING_PERSON_CODE') {
    return {
      category: 'MISSING_PERSON_CODE',
      friendlyMessage:
        'Hồ sơ này chưa được cấp Mã học sinh hoặc Mã nhân sự nên máy chấm công chưa có mã số để lưu khuôn mặt.',
      nextStepHint:
        'Bạn hãy kiểm tra lại Mã định danh trong mục Hồ sơ Học sinh / Nhân sự rồi quay lại gắn ảnh khuôn mặt nhé.'
    };
  }

  // Fallback: làm sạch hoàn toàn mọi ký tự kỹ thuật nếu có
  const cleanText = scrubTechnicalJargon(rawMsg);
  return {
    category: 'GENERAL',
    friendlyMessage: cleanText,
    nextStepHint: 'Bạn hãy kiểm tra lại thông tin vừa nhập hoặc bấm Làm mới trang rồi thử lại nhé.'
  };
}

/**
 * Ghép thông báo tiếng Việt thân thiện đầy đủ (gồm câu giải thích + hướng dẫn bước tiếp theo).
 *
 * @param {Error | Record<string, any> | string} errOrInput
 * @param {{ deviceName?: string, host?: string, campus?: string, personName?: string }} [context]
 * @returns {string}
 */
function formatFriendlyVietnameseHardwareNotice(errOrInput, context = {}) {
  const { friendlyMessage, nextStepHint } = translateHardwareErrorToVietnamese(errOrInput, context);
  if (!nextStepHint) return friendlyMessage;
  if (friendlyMessage.includes(nextStepHint)) return friendlyMessage;
  return `${friendlyMessage} ${nextStepHint}`;
}

/**
 * Tạo câu thông báo tiếng Việt tự nhiên theo thời gian thực khi trẻ hoặc nhân sự quét khuôn mặt / thẻ tại máy chấm công.
 *
 * @param {{
 *   subjectType?: 'STUDENT' | 'EMPLOYEE' | 'UNMAPPED',
 *   fullName?: string,
 *   className?: string,
 *   attendanceAction?: string,
 *   isLate?: boolean,
 *   verifyMode?: string,
 *   occurredAt?: Date | string,
 *   deviceName?: string,
 *   externalPersonId?: string
 * }} eventInfo
 * @returns {{ title: string, message: string, tone: 'success' | 'warning' | 'info' }}
 */
function buildNaturalRealtimeAttendanceMessage(eventInfo = {}) {
  const dt = eventInfo.occurredAt ? new Date(eventInfo.occurredAt) : new Date();
  const safeDate = Number.isNaN(dt.getTime()) ? new Date() : dt;
  const timeStr = safeDate.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  const modeRaw = String(eventInfo.verifyMode || 'FACE').toUpperCase();
  const modeLabel =
    modeRaw === 'FACE'
      ? 'quét khuôn mặt'
      : modeRaw === 'CARD'
        ? 'quẹt thẻ từ'
        : modeRaw === 'FINGERPRINT'
          ? 'đặt vân tay'
          : 'xác thực tại cổng';

  const gateText = eventInfo.deviceName ? ` tại ${eventInfo.deviceName}` : ' tại cổng trường';

  if (eventInfo.subjectType === 'STUDENT') {
    const rawChildName = String(eventInfo.fullName || 'Học sinh').trim();
    const childDisplayName = /^bé\s+/i.test(rawChildName) ? rawChildName : `Bé ${rawChildName}`;
    const classLabel = eventInfo.className ? ` (${eventInfo.className})` : '';
    const actionUpper = String(eventInfo.attendanceAction || 'CHECK_IN').toUpperCase();

    if (actionUpper.includes('OUT')) {
      return {
        tone: 'success',
        title: `${childDisplayName} vừa ra về`,
        message: `${childDisplayName}${classLabel} vừa ${modeLabel} ra về lúc ${timeStr}${gateText}.`
      };
    }

    if (actionUpper.includes('DEBOUNCE') || actionUpper.includes('DUPLICATE')) {
      return {
        tone: 'info',
        title: `${childDisplayName} vừa quét lại tại cổng`,
        message: `${childDisplayName}${classLabel} đã được ghi nhận điểm danh lúc ${timeStr} nên hệ thống tự động giữ nguyên lượt đến lớp ban đầu.`
      };
    }

    const punctuality = eventInfo.isLate ? ' (đến muộn hơn giờ chuẩn)' : ' (đúng giờ)';
    return {
      tone: eventInfo.isLate ? 'warning' : 'success',
      title: `${childDisplayName} vừa đến lớp`,
      message: `${childDisplayName}${classLabel} vừa ${modeLabel} điểm danh đến trường lúc ${timeStr}${punctuality}${gateText}.`
    };
  }

  if (eventInfo.subjectType === 'EMPLOYEE') {
    const staffName = eventInfo.fullName || 'Nhân sự';
    const actionUpper = String(eventInfo.attendanceAction || 'CHECK_IN').toUpperCase();
    if (actionUpper.includes('OUT')) {
      return {
        tone: 'success',
        title: `${staffName} vừa chấm công tan ca`,
        message: `${staffName} vừa ${modeLabel} ghi nhận giờ ra về lúc ${timeStr}${gateText}.`
      };
    }
    return {
      tone: 'success',
      title: `${staffName} vừa chấm công vào ca`,
      message: `${staffName} vừa ${modeLabel} chấm công đến trường lúc ${timeStr}${gateText}.`
    };
  }

  const extCode = eventInfo.externalPersonId || '?';
  const rawName = eventInfo.fullName ? ` (${eventInfo.fullName})` : '';
  return {
    tone: 'warning',
    title: 'Có lượt quét mới chưa ghép tên trên Web',
    message: `Vừa có người ${modeLabel} lúc ${timeStr} với mã số máy "${extCode}"${rawName} nhưng chưa được ghép vào danh sách Học sinh/Nhân sự. Bạn hãy mở trang Máy chấm công để ghép tên 1 chạm nhé.`
  };
}

module.exports = {
  scrubTechnicalJargon,
  translateHardwareErrorToVietnamese,
  formatFriendlyVietnameseHardwareNotice,
  buildNaturalRealtimeAttendanceMessage
};

