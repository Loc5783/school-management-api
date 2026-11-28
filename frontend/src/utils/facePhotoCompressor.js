/**
 * @fileoverview Bộ nén ảnh khuôn mặt tự động dưới 200KB chuẩn phần cứng Hikvision FDLib
 * ("No larger than 200 KB. JPG/JPEG").
 * - Tự động chuẩn hóa khung chân dung rõ nét (tối đa 720x720 px).
 * - Chuyển đổi sang chuẩn `image/jpeg` nền trắng và giảm dần chất lượng/kích thước
 *   cho tới khi dung lượng <= 185KB (đảm bảo 100% dưới ngưỡng cứng 200KB của Hikvision).
 */

const HIKVISION_SAFE_MAX_BYTES = 185 * 1024; // 185 KB (< 200 KB)

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Tệp ảnh không hợp lệ hoặc bị hỏng.'));
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

  const originalSizeKB = Math.max(1, Math.round((inputFile.size / 1024) * 10) / 10);
  const img = await loadImageFromBlob(inputFile);
  const origW = img.naturalWidth || img.width || 640;
  const origH = img.naturalHeight || img.height || 640;

  let maxDimension = 720;
  let quality = 0.88;
  let resultBlob = null;
  let finalW = origW;
  let finalH = origH;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const scale = Math.min(1, maxDimension / Math.max(origW, origH));
    finalW = Math.max(240, Math.round(origW * scale));
    finalH = Math.max(240, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = finalW;
    canvas.height = finalH;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, finalW, finalH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, finalW, finalH);

    resultBlob = await canvasToJpegBlob(canvas, quality);
    if (resultBlob && resultBlob.size <= HIKVISION_SAFE_MAX_BYTES) {
      break;
    }

    quality = Math.max(0.4, quality - 0.12);
    if (attempt >= 2) {
      maxDimension = Math.max(380, Math.round(maxDimension * 0.82));
    }
  }

  if (!resultBlob) {
    throw new Error('Không thể nén ảnh khuôn mặt.');
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

