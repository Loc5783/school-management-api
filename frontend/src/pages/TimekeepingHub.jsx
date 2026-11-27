import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import KioskAttendancePanel from '../components/KioskAttendancePanel';
import ManualTimekeepingPanel from '../components/ManualTimekeepingPanel';
import StaffLeaveRequestPanel from '../components/StaffLeaveRequestPanel';
import { getStoredUser } from '../utils/storage';

const tabs = [
  { id: 'kiosk', label: 'Chấm công bằng mã', icon: 'clock', roles: ['admin', 'principal', 'teacher', 'guard', 'accountant', 'chef', 'hr'], Component: KioskAttendancePanel },
  { id: 'corrections', label: 'Đơn chấm công bù', icon: 'attendance', roles: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'hr'], Component: ManualTimekeepingPanel },
  { id: 'leave', label: 'Nghỉ phép cá nhân', icon: 'calendar', roles: null, Component: StaffLeaveRequestPanel }
];

export default function TimekeepingHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = getStoredUser().role;

  const visibleTabs = tabs.filter(
    (tab) => (role !== 'guard' || tab.id !== 'corrections') && (!tab.roles || tab.roles.includes(role))
  );
  const requested = searchParams.get('tab');
  const active = visibleTabs.some((tab) => tab.id === requested) ? requested : visibleTabs[0]?.id;
  const activeTab = visibleTabs.find((tab) => tab.id === active);
  const Content = activeTab?.Component;

  const subtitleText = role === 'guard'
    ? 'Chấm công ca trực và gửi đơn xin nghỉ phép cá nhân.'
    : 'Ghi nhận chấm công hàng ngày, lập đơn chấm công bổ sung và gửi đơn xin nghỉ phép cá nhân.';

  return (
    <AppShell title="Chấm công nhân sự" subtitle={subtitleText}>
      <section className="timekeeping-hub content-card">
        <div className="timekeeping-hub-tabs" role="tablist" aria-label="Chức năng chấm công">
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              role="tab"
              aria-selected={active === tab.id}
              className={active === tab.id ? 'active' : ''}
              onClick={() => setSearchParams({ tab: tab.id })}
            >
              <Icon name={tab.icon} size={17} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="timekeeping-hub-body">
          {Content && <Content embedded />}
        </div>
      </section>
    </AppShell>
  );
}
