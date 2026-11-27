import AppShell from '../components/AppShell';
import HrAuditJournal from '../components/HrAuditJournal';

/**
 * Trang Nhật ký Hoạt động & Phân quyền Hệ thống trong phạm vi đơn vị trường (`tenantId`)
 * dành cho Quản trị viên Hệ thống của Trường (`admin`) và Ban Giám đốc (`principal`).
 */
export default function SchoolAuditJournalPage() {
  return (
    <AppShell
      title="Nhật ký Hệ thống & Phân quyền Trường"
      subtitle="Tra cứu lịch sử cấp phát tài khoản, thay đổi phân quyền và hoạt động hệ thống trong phạm vi trường học."
    >
      <HrAuditJournal />
    </AppShell>
  );
}

