import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import SmartAttendance from './SmartAttendance';
import ManualTimekeeping from './ManualTimekeeping';
import TimekeepingManagement from './TimekeepingManagement';

const tabs = [
  { id: 'kiosk', label: 'Chấm công bằng mã', icon: 'clock', roles: null, Component: SmartAttendance },
  { id: 'corrections', label: 'Đơn chấm công bù', icon: 'attendance', roles: null, Component: ManualTimekeeping },
  { id: 'management', label: 'Quản lý & phê duyệt', icon: 'users', roles: ['admin', 'principal'], Component: TimekeepingManagement }
];

export default function TimekeepingHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const visibleTabs = tabs.filter((tab) => !tab.roles || tab.roles.includes(role));
  const requested = searchParams.get('tab');
  const active = visibleTabs.some((tab) => tab.id === requested) ? requested : visibleTabs[0]?.id;
  const activeTab = visibleTabs.find((tab) => tab.id === active);
  const Content = activeTab?.Component;

  return <AppShell title="Chấm công nhân sự" subtitle="Ghi nhận check-in, làm đơn công bù và phê duyệt trên một không gian thống nhất.">
    <section className="timekeeping-hub content-card">
      <div className="timekeeping-hub-tabs" role="tablist" aria-label="Chức năng chấm công">
        {visibleTabs.map((tab) => <button type="button" key={tab.id} role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => setSearchParams({ tab: tab.id })}><Icon name={tab.icon} size={18} />{tab.label}</button>)}
      </div>
    </section>
    <div className="timekeeping-hub-content">{Content && <Content embedded />}</div>
  </AppShell>;
}
