/**
 * Trả về ngày hiện tại theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) dưới định dạng chuẩn YYYY-MM-DD.
 * Đảm bảo trong khung giờ 00:00 - 06:59 sáng vẫn lấy đúng ngày hôm nay của Việt Nam (thay vì ngày hôm qua của UTC).
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} YYYY-MM-DD
 */
export const getVietnamToday = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};
