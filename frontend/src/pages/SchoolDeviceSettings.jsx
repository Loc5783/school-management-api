import AppShell from '../components/AppShell';
import TimekeepingDeviceManagement from '../components/TimekeepingDeviceManagement';

/**
 * Trang Quản lý Máy Chấm Công Khuôn Mặt, Cầu nối nội bộ `127.0.0.1:18686` và Điểm danh tự động của Phân hiệu.
 */
export default function SchoolDeviceSettings() {
  return (
    <AppShell
      title="Máy Chấm Công Khuôn Mặt & Cầu Nối Nội Bộ"
      subtitle="Quét tìm máy chấm công ngay trong mạng trường, kéo/đẩy ảnh khuôn mặt học sinh & nhân sự an toàn theo đúng phân hiệu và nhận thông báo điểm danh trực tiếp."
    >
      <TimekeepingDeviceManagement />
    </AppShell>
  );
}
