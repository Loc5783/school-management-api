import AppShell from '../components/AppShell';
import TimekeepingDeviceManagement from '../components/TimekeepingDeviceManagement';

/**
 * Trang chuyên biệt cấu hình Thiết bị Máy chấm công ISAPI & Đồng bộ Webhook
 * dành cho Quản trị viên Hệ thống của Trường (`admin`) mà không cần đi vào phân hệ lương HR.
 */
export default function SchoolDeviceSettings() {
  return (
    <AppShell
      title="Thiết bị Chấm công & Đồng bộ Webhook"
      subtitle="Cấu hình thiết bị nhận diện khuôn mặt/vân tay ISAPI, ánh xạ mã định danh và kiểm tra luồng đồng bộ Webhook riêng của trường."
    >
      <TimekeepingDeviceManagement />
    </AppShell>
  );
}

