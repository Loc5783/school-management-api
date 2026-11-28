/**
 * @fileoverview Bộ nén ảnh khuôn mặt tự động dưới 200KB chuẩn phần cứng Hikvision FDLib
 * ("No larger than 200 KB. JPG/JPEG").
 * - Chặn sớm tệp rỗng (0 byte), tệp quá lớn (> 25MB) hoặc sai định dạng không phải ảnh.
 * - Tích hợp timeout giải mã ảnh 12 giây chống treo giao diện khi gặp tệp ảnh hỏng / HEIC không hỗ trợ.
 * - Tự động chuẩn hóa khung chân dung rõ nét (tối đa 720x720 px) và nén xuống <= 185KB JPG.
 */

const HIKVISION_SAFE_MAX_BYTES = 185 * 1024; // 185 KB (< 200 KB)
const MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const IMAGE_DECODE_TIMEOUT_MS = 12000;

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    let settled = false;

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        URL.revokeObjectURL(url);
        reject(new Error('Quá thời gian đọc tệp ảnh. Vui lòng chọn ảnh định dạng JPG hoặc PNG chuẩn.'));
      }
    }, IMAGE_DECODE_TIMEOUT_MS);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(
        new Error(
          'Trình duyệt không thể đọc tệp ảnh này (tệp bị hỏng hoặc định dạng HEIC chưa hỗ trợ). Vui lòng chọn ảnh JPG/PNG hoặc chụp trực tiếp.'
        )
      );
    };

    img.src = url;
  });
}

function canvasToJpegBlob(canvas, quality = 0.86) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh sau khi nén.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Nén 1 File hoặc Blob ảnh bất kỳ xuống chuẩn JPEG < 185KB kèm chuỗi DataURL để gửi API.
 * @param {File|Blob} inputFile
 * @param {string} [customFileName]
 */
export async function compressFaceImageUnder200KB(inputFile, customFileName = 'hikvision_face.jpg') {
  if (!inputFile) {
    throw new Error('Không tìm thấy tệp ảnh để xử lý.');
  }
  if (!inputFile.size || inputFile.size < 64) {
    throw new Error('Tệp ảnh bị rỗng (0 byte), vui lòng chọn ảnh khác.');
  }
  if (inputFile.size > MAX_RAW_UPLOAD_BYTES) {
    throw new Error('Tệp ảnh gốc vượt quá 25MB, vui lòng chọn ảnh dung lượng nhỏ hơn.');
  }
  if (inputFile.type && !String(inputFile.type).toLowerCase().startsWith('image/')) {
    throw new Error('Tệp đã chọn không phải là hình ảnh hợp lệ (chỉ chấp nhận JPG, PNG, WEBP).');
  }

  const originalSizeKB = Math.max(1, Math.round((inputFile.size / 1024) * 10) / 10);
  const img = await loadImageFromBlob(inputFile);
  const origW = img.naturalWidth || img.width || 640;
  const origH = img.naturalHeight || img.height || 640;

  let maxDimension = 720;
  let quality = 0.88;
  let resultBlob = null;
  let finalW = origW;
  let finalH = origH;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(origW, origH));
    finalW = Math.max(220, Math.round(origW * scale));
    finalH = Math.max(220, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = finalW;
    canvas.height = finalH;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý khung vẽ ảnh (Canvas 2D).');
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, finalW, finalH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, finalW, finalH);

    resultBlob = await canvasToJpegBlob(canvas, quality);
    if (resultBlob && resultBlob.size <= HIKVISION_SAFE_MAX_BYTES) {
      break;
    }

    quality = Math.max(0.36, quality - 0.11);
    if (attempt >= 2) {
      maxDimension = Math.max(320, Math.round(maxDimension * 0.8));
    }
  }

  if (!resultBlob || resultBlob.size > 200 * 1024) {
    throw new Error('Không thể nén ảnh xuống dưới 200KB, vui lòng chọn ảnh chân dung khác rõ nét hơn.');
  }

  const baseName = String(customFileName || inputFile.name || 'face')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const finalFile = new File([resultBlob], `${baseName}_hik200kb.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now()
  });
  const dataUrl = await blobToDataUrl(finalFile);
  const compressedSizeKB = Math.max(1, Math.round((finalFile.size / 1024) * 10) / 10);

  return {
    file: finalFile,
    dataUrl,
    originalSizeKB,
    compressedSizeKB,
    width: finalW,
    height: finalH
  };
}
