import AppShell from '../components/AppShell';
import TimekeepingDeviceManagement from '../components/TimekeepingDeviceManagement';

/**
 * Trang chuyên biệt Quản lý Cụm Máy Chấm Công Hikvision ISAPI, Phân bổ 500 Slot theo Phân hiệu
 * và Đồng bộ Ảnh Khuôn Mặt Chấm Công (<200KB) dành cho Quản trị viên Hệ thống Trường (`admin`).
 */
export default function SchoolDeviceSettings() {
  return (
    <AppShell
      title="Đồng bộ Máy Chấm Công & Khuôn Mặt Theo Phân Hiệu"
      subtitle="Quét tự động máy Hikvision trong mạng LAN, quản lý dung lượng 500 slot/máy theo từng cơ sở, chụp/nén ảnh khuôn mặt <200KB và đồng bộ 1 chiều an toàn."
    >
      <TimekeepingDeviceManagement />
    </AppShell>
  );
}
