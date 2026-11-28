'use strict';

/**
 * @fileoverview Trình đóng gói tệp nén chuẩn `.zip` thuần Node.js (`zlib`), không cần thư viện ngoài.
 * Dùng để xuất bộ cài đặt 1 chạm `Local LAN Connector (127.0.0.1:18686)` cho máy tính tại Phân hiệu.
 */

const zlib = require('zlib');

// Bảng tra CRC32 IEEE 802.3 khởi tạo 1 lần duy nhất
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Tạo Buffer `.zip` hợp lệ từ mảng tệp `{ name: string, content: string | Buffer }`.
 *
 * @param {Array<{ name: string, content: string | Buffer }>} files
 * @returns {Buffer}
 */
function buildZipBuffer(files = []) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
    const rawBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(String(file.content ?? ''), 'utf8');

    const crc = computeCrc32(rawBuf);
    const compressedBuf = zlib.deflateRawSync(rawBuf, { level: 6 });

    // Cờ bit 11 (0x0800) bật UTF-8 cho tên file tiếng Việt / có dấu gạch
    const generalPurposeFlag = 0x0800;
    const compressionMethod = 8; // Deflate

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(generalPurposeFlag, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0x5421, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(generalPurposeFlag, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, compressedBuf);
    centralParts.push(centralHeader);
    offset += localHeader.length + compressedBuf.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0); // End of central dir signature
  endOfCentral.writeUInt16LE(0, 4);
  endOfCentral.writeUInt16LE(0, 6);
  endOfCentral.writeUInt16LE(files.length, 8);
  endOfCentral.writeUInt16LE(files.length, 10);
  endOfCentral.writeUInt32LE(centralBuffer.length, 12);
  endOfCentral.writeUInt32LE(offset, 16);
  endOfCentral.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, endOfCentral]);
}

module.exports = {
  buildZipBuffer,
  computeCrc32
};

