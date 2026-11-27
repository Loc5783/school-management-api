import AppShell from '../components/AppShell';
import StaffLeaveRequestPanel from '../components/StaffLeaveRequestPanel';

export default function StaffLeaveRequests() {
  return (
    <AppShell
      title="Nghỉ phép cá nhân"
      subtitle="Gửi đơn xin nghỉ phép cá nhân và theo dõi trạng thái phê duyệt từ Ban Giám Hiệu."
    >
      <div className="teacher-leave-page">
        <StaffLeaveRequestPanel />
      </div>
    </AppShell>
  );
}
