import AppShell from '../components/AppShell';
import MyLeaveRequests from './MyLeaveRequests';

export default function TeacherLeavePage() {
  return (
    <AppShell
      title="Nghỉ phép cá nhân"
      subtitle="Gửi đơn xin nghỉ phép của giáo viên và theo dõi trạng thái phê duyệt từ Ban giám hiệu."
    >
      <div className="teacher-leave-page">
        <MyLeaveRequests />
      </div>
    </AppShell>
  );
}
