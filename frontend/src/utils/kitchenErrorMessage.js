export function kitchenErrorMessage(error, fallback) {
  const message = error?.response?.data?.message;
  if (typeof message === 'string' && message.trim()) return message;
  if (!error?.response) return 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại; dữ liệu chưa được lưu.';
  if (error.response.status === 403) return 'Tài khoản này không có quyền thực hiện thao tác.';
  if (error.response.status === 409) return 'Dữ liệu vừa thay đổi. Tải lại số liệu trước khi thao tác tiếp.';
  if (error.response.status >= 500) return 'Máy chủ đang gặp lỗi. Dữ liệu có thể chưa được lưu; hãy tải lại trước khi thử lại.';
  return fallback;
}
