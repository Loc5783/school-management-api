/**
 * Helper tính toán và xác thực số nguyên tiền VND an toàn (Safe Integer VND Arithmetic)
 * Tránh lỗi tràn số, mất độ chính xác vượt Number.MAX_SAFE_INTEGER,
 * số thực dấu phẩy động (float), NaN, Infinity hoặc số âm ngoài ý muốn.
 */

const MAX_SAFE_VND = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991 VND (~9 triệu tỷ đồng)

const assertSafeVnd = (val, label = 'Số tiền', allowNegative = false) => {
  if (val === null || val === undefined || val === '') {
    throw Object.assign(new Error(`${label} không được để trống.`), { statusCode: 422 });
  }

  const num = typeof val === 'number' ? val : (typeof val === 'string' && /^-?\d+$/.test(val.trim()) ? Number(val.trim()) : NaN);

  if (!Number.isFinite(num) || !Number.isSafeInteger(num)) {
    throw Object.assign(new Error(`${label} không phải số nguyên VND hợp lệ (nhận được: ${val}).`), { statusCode: 422 });
  }

  if (Math.abs(num) > MAX_SAFE_VND) {
    throw Object.assign(
      new Error(`${label} vượt quá giới hạn số nguyên an toàn của hệ thống (tối đa ${MAX_SAFE_VND.toLocaleString('vi-VN')} đ).`),
      { statusCode: 422 }
    );
  }

  if (!allowNegative && num < 0) {
    throw Object.assign(new Error(`${label} không được là số âm (nhận được: ${num}).`), { statusCode: 422 });
  }

  return num;
};

const safeAddVnd = (a, b, label = 'Tổng số tiền') => {
  const numA = assertSafeVnd(a, `${label} (số thứ nhất)`, false);
  const numB = assertSafeVnd(b, `${label} (số thứ hai)`, false);

  const sum = numA + numB;
  if (!Number.isSafeInteger(sum) || sum > MAX_SAFE_VND) {
    throw Object.assign(
      new Error(`${label} vượt quá giới hạn số nguyên an toàn của hệ thống (tối đa ${MAX_SAFE_VND.toLocaleString('vi-VN')} đ).`),
      { statusCode: 422 }
    );
  }

  return sum;
};

const safeSubtractVnd = (a, b, label = 'Số tiền sau giảm trừ') => {
  const numA = assertSafeVnd(a, `${label} (tổng khoản thu)`, false);
  const numB = assertSafeVnd(b, `${label} (khoản giảm trừ)`, false);

  if (numB > numA) {
    throw Object.assign(
      new Error(`Số tiền giảm trừ (${numB.toLocaleString('vi-VN')} đ) không được lớn hơn tổng các khoản thu (${numA.toLocaleString('vi-VN')} đ).`),
      { statusCode: 422 }
    );
  }

  const diff = numA - numB;
  if (!Number.isSafeInteger(diff) || diff < 0) {
    throw Object.assign(new Error(`${label} không hợp lệ sau khi trừ.`), { statusCode: 422 });
  }

  return diff;
};

const safeNetVnd = (inflow, outflow, label = 'Chênh lệch thu – chi') => {
  const numIn = assertSafeVnd(inflow, `${label} (thu vào)`, false);
  const numOut = assertSafeVnd(outflow, `${label} (chi ra)`, false);

  const net = numIn - numOut;
  return assertSafeVnd(net, label, true);
};

const safeSumArrayVnd = (items = [], getter = (x) => x, label = 'Tổng cộng') => {
  if (!Array.isArray(items)) return 0;
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const val = getter(items[i], i);
    total = safeAddVnd(total, val, `${label} (dòng ${i + 1})`);
  }
  return total;
};

module.exports = {
  MAX_SAFE_VND,
  assertSafeVnd,
  safeAddVnd,
  safeSubtractVnd,
  safeNetVnd,
  safeSumArrayVnd
};
