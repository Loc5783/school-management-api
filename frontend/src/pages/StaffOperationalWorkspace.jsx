import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';
import { getStoredTenant, getStoredUser } from '../utils/storage';
import {
  getEffectivePosition,
  getUserRoleBadgeLabel,
  isGeneralSupervisorTeacher
} from '../utils/roleWorkspaceConfig';

const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const POSITION_THEME_META = {
  youth_leader: {
    kicker: 'ĐIỀU PHỐI NỀ NẾP & HOẠT ĐỘNG ĐOÀN THỂ',
    heading: 'Bàn làm việc Tổng Phụ Trách',
    subtitle: 'Theo dõi chuyên cần học sinh các lớp, tổ chức sự kiện ngoại khóa và truyền thông nội bộ nhà trường.',
    checklistTitle: 'Trọng tâm công việc Tổng phụ trách trong ngày',
    checklist: [
      'Kiểm tra sĩ số & học sinh vắng không phép tại các lớp đầu giờ sáng.',
      'Rà soát thông báo hoạt động ngoại khóa, sinh hoạt tập thể tuần này.',
      'Đề xuất học cụ, âm thanh hoặc vật tư phục vụ sự kiện nhà trường khi cần.'
    ]
  },
  head_teacher: {
    kicker: 'CHUYÊN MÔN KHỐI LỚP',
    heading: 'Bàn làm việc Tổ Trưởng Chuyên Môn',
    subtitle: 'Giám sát chuyên cần, hỗ trợ giáo viên đứng lớp, phân công dạy thay và đề xuất học cụ.',
    checklistTitle: 'Trọng tâm điều phối chuyên môn hôm nay',
    checklist: [
      'Theo dõi tình hình giáo viên đứng lớp và hỗ trợ các lớp có giáo viên xin nghỉ.',
      'Kiểm tra báo cáo điểm danh và nề nếp đón trả trẻ đầu giờ.',
      'Tổng hợp đề xuất đồ dùng dạy học cho các lớp trong khối.'
    ]
  },
  nurse: {
    kicker: 'Y TẾ HỌC ĐƯỜNG & SỨC KHỎE',
    heading: 'Không gian Nhân viên Y tế Học đường',
    subtitle: 'Theo dõi ca trực phòng y tế, thông báo sức khỏe nội bộ, chấm công và chế độ lương cá nhân.',
    checklistTitle: 'Nhắc việc phòng Y tế hằng ngày',
    checklist: [
      'Kiểm tra tủ thuốc sơ cứu, nhiệt kế và vật tư y tế đầu ca sáng.',
      'Theo dõi thông báo từ Ban Giám hiệu và phối hợp giáo viên khi trẻ có biểu hiện sốt/dị ứng.',
      'Chấm công đầu giờ và cuối giờ đầy đủ để hệ thống tính công tự động.'
    ]
  },
  cleaner: {
    kicker: 'VỆ SINH & MÔI TRƯỜNG SƯ PHẠM',
    heading: 'Không gian làm việc Nhân viên Tạp vụ',
    subtitle: 'Giao diện tinh gọn, dễ thao tác: Chấm công ca làm, xem lịch trực khu vực, xin nghỉ phép và xem phiếu lương.',
    checklistTitle: 'Nhắc việc vệ sinh khu vực trong ngày',
    checklist: [
      'Vệ sinh khử khuẩn hành lang, khu vui chơi và nhà vệ sinh trước giờ đón trẻ.',
      'Thu gom rác & lau dọn sạch sẽ sau giờ ăn trưa của các lớp.',
      'Bấm kiểm tra Chấm công đầu ca / cuối ca hoặc quét khuôn mặt tại máy chấm công cổng.'
    ]
  },
  maintenance: {
    kicker: 'KỸ THUẬT & CƠ SỞ VẬT CHẤT',
    heading: 'Không gian Nhân viên Kỹ thuật & Bảo trì',
    subtitle: 'Quản lý lịch ca trực điện nước - thiết bị, thông báo nhà trường, chấm công và phiếu lương cá nhân.',
    checklistTitle: 'Nhắc việc kiểm tra an toàn kỹ thuật',
    checklist: [
      'Kiểm tra hệ thống điện, chiếu sáng, quạt/điều hòa và nguồn nước đầu ngày.',
      'Theo dõi thông báo nội bộ từ Ban Giám hiệu để xử lý kịp thời yêu cầu sửa chữa tại lớp.',
      'Ghi nhận chấm công ca trực và bàn giao thiết bị cuối ngày.'
    ]
  },
  driver: {
    kicker: 'VẬN HÀNH ĐƯA ĐÓN HỌC SINH',
    heading: 'Không gian Tài xế Đưa đón',
    subtitle: 'Xem lịch ca chạy trong ngày, thông báo điều hành từ nhà trường, chấm công và xem phiếu lương.',
    checklistTitle: 'Quy tắc an toàn trước & sau mỗi chuyến xe',
    checklist: [
      'Kiểm tra kỹ thuật xe, ghế ngồi và dây an toàn trước giờ xuất phát.',
      'Đối chiếu kỹ toàn bộ hàng ghế cuối xe tuyệt đối không để sót trẻ sau mỗi lượt đón/trả.',
      'Chấm công đầy đủ và cập nhật thông báo mới từ nhà trường.'
    ]
  }
};

export default function StaffOperationalWorkspace() {
  const user = getStoredUser();
  const tenant = getStoredTenant();
  const position = getEffectivePosition(user);
  const isSupervisor = isGeneralSupervisorTeacher(user);
  const roleBadge = getUserRoleBadgeLabel(user);
  const today = useMemo(() => todayIso(), []);

  const [staffing, setStaffing] = useState({ classrooms: [], duties: [] });
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.get('/hr/my-staffing', { params: { date: today } }),
      api.get('/notifications', { params: { limit: 5 } })
    ]).then(([staffingRes, noticeRes]) => {
      if (!alive) return;
      if (staffingRes.status === 'fulfilled') {
        const d = staffingRes.value.data?.data || staffingRes.value.data || {};
        setStaffing({
          classrooms: Array.isArray(d.classrooms) ? d.classrooms : [],
          duties: Array.isArray(d.duties) ? d.duties : []
        });
      }
      if (noticeRes.status === 'fulfilled') {
        setNotices(noticeRes.value.data?.data || []);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [today]);

  const meta = POSITION_THEME_META[position] || POSITION_THEME_META.cleaner;
  const fullName = user?.profile?.fullName || user?.username || 'Nhân viên';
  const empCode = user?.employeeInfo?.employeeId || '';
  const campusName = user?.employeeInfo?.campus || tenant?.name || 'Cơ sở chính';

  const quickActions = isSupervisor
    ? [
        {
          to: '/attendance',
          icon: 'attendance',
          tone: '#2563eb',
          bg: '#eff6ff',
          title: 'Điểm danh & Sĩ số các lớp',
          desc: 'Kiểm tra tình hình học sinh đến lớp và trả trẻ theo thời gian thực'
        },
        {
          to: '/attendance/reports',
          icon: 'chart',
          tone: '#4f46e5',
          bg: '#eef2ff',
          title: 'Báo cáo Chuyên cần & Vắng mặt',
          desc: 'Tổng hợp danh sách trẻ nghỉ có phép, không phép và đi muộn'
        },
        {
          to: '/students',
          icon: 'students',
          tone: '#0284c7',
          bg: '#f0f9ff',
          title: 'Tra cứu Hồ sơ Học sinh',
          desc: 'Xem thông tin lớp học, liên hệ phụ huynh và ghi chú sức khỏe'
        },
        {
          to: '/internal-notices',
          icon: 'bell',
          tone: '#d97706',
          bg: '#fffbeb',
          title: 'Thông báo & Hoạt động trường',
          desc: 'Theo dõi kế hoạch sự kiện, lễ hội và thông báo toàn phân hiệu'
        },
        {
          to: '/assets',
          icon: 'settings',
          tone: '#059669',
          bg: '#ecfdf5',
          title: 'Đề xuất Vật tư & Học cụ',
          desc: 'Gửi phiếu đề xuất trang thiết bị phục vụ hoạt động ngoại khóa & lớp học'
        },
        {
          to: '/my-payroll',
          icon: 'money',
          tone: '#7c3aed',
          bg: '#f5f3ff',
          title: 'Chấm công & Phiếu lương cá nhân',
          desc: 'Xem bảng lương tháng của tôi, lịch phân công và gửi đơn xin nghỉ phép'
        }
      ]
    : [
        {
          to: '/timekeeping',
          icon: 'clock',
          tone: '#2563eb',
          bg: '#eff6ff',
          title: 'Chấm công Vào / Ra ca',
          desc: 'Ghi nhận giờ đến làm việc và giờ tan ca hằng ngày nhanh chóng'
        },
        {
          to: '/my-staffing',
          icon: 'calendar',
          tone: '#059669',
          bg: '#ecfdf5',
          title: 'Lịch phân công của tôi hôm nay',
          desc: 'Xem ca làm việc, khu vực phụ trách hoặc lịch trực thay trong tuần'
        },
        {
          to: '/my-leave-requests',
          icon: 'fileText',
          tone: '#d97706',
          bg: '#fffbeb',
          title: 'Gửi đơn xin nghỉ phép',
          desc: 'Đăng ký nghỉ phép trực tuyến và theo dõi kết quả duyệt trên điện thoại'
        },
        {
          to: '/my-payroll',
          icon: 'money',
          tone: '#7c3aed',
          bg: '#f5f3ff',
          title: 'Xem phiếu lương tháng của tôi',
          desc: 'Tra cứu chi tiết số ngày công, phụ cấp và thực lĩnh từng tháng'
        }
      ];

  return (
    <AppShell title={meta.heading} subtitle={meta.subtitle}>
      <div style={{ display: 'grid', gap: 18 }}>
        {/* Thẻ Hồ sơ Nhân sự & Trạng thái ca làm hôm nay */}
        <section
          className="content-card"
          style={{
            padding: '22px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            borderLeft: '4px solid #3b82f6'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <span
              className="avatar"
              style={{
                width: 52,
                height: 52,
                fontSize: 20,
                background: '#dbeafe',
                color: '#1d4ed8'
              }}
            >
              {fullName.charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="card-kicker" style={{ margin: 0 }}>{meta.kicker}</p>
              <h2 style={{ margin: '4px 0', fontSize: 20, color: '#0f172a' }}>
                Xin chào, {fullName}
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13, color: '#475569' }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    fontWeight: 700,
                    fontSize: 12
                  }}
                >
                  {roleBadge}
                </span>
                {empCode && <span>Mã nhân sự: <strong>{empCode}</strong></span>}
                <span>· Đơn vị: <strong>{campusName}</strong></span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/timekeeping" className="button button-primary">
              <Icon name="clock" size={16} /> Chấm công hôm nay
            </Link>
            <Link to="/internal-notices" className="button button-secondary">
              <Icon name="bell" size={16} /> Bảng tin nhà trường
            </Link>
          </div>
        </section>

        {/* Lưới Thao tác Chính to rõ, nhìn vào dùng ngay */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 14
          }}
        >
          {quickActions.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="content-card"
              style={{
                padding: '20px 22px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                textDecoration: 'none',
                border: '1px solid #e2e8f0',
                transition: 'transform 0.16s ease, box-shadow 0.16s ease'
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: item.bg,
                  color: item.tone,
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0
                }}
              >
                <Icon name={item.icon} size={21} />
              </span>
              <div>
                <strong style={{ display: 'block', fontSize: 15, color: '#0f172a', marginBottom: 4 }}>
                  {item.title}
                </strong>
                <span style={{ fontSize: 13, color: '#64748b', lineHeight: 1.45 }}>
                  {item.desc}
                </span>
              </div>
            </Link>
          ))}
        </section>

        {/* Hai cột gọn gàng: Ca phân công hôm nay & Thông báo / Nhắc việc */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16
          }}
        >
          <section className="content-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <p className="card-kicker" style={{ margin: 0 }}>LỊCH LÀM VIỆC HÔM NAY ({today.split('-').reverse().join('/')})</p>
                <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>Ca trực & Phân công của bạn</h3>
              </div>
              <Link to="/my-staffing" className="button button-secondary" style={{ minHeight: 34, padding: '0 12px' }}>
                Xem theo ngày
              </Link>
            </div>

            {loading ? (
              <p style={{ color: '#64748b', fontSize: 13 }}>Đang tải lịch làm việc hôm nay...</p>
            ) : staffing.duties.length > 0 || staffing.classrooms.length > 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {staffing.duties.map((duty) => (
                  <div
                    key={duty._id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <strong style={{ color: '#0f172a', fontSize: 14 }}>{duty.name}</strong>
                    <div style={{ fontSize: 12.5, color: '#475569', marginTop: 3 }}>
                      Khung giờ: <strong>{duty.startTime} – {duty.endTime}</strong>
                    </div>
                  </div>
                ))}
                {staffing.classrooms.map((cls) => (
                  <div
                    key={cls._id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: '#f0f9ff',
                      border: '1px solid #bae6fd'
                    }}
                  >
                    <strong style={{ color: '#0369a1', fontSize: 14 }}>Phụ trách: {cls.name}</strong>
                    <div style={{ fontSize: 12.5, color: '#475569', marginTop: 3 }}>
                      Giáo viên có mặt: {cls.presentTeachers}/{cls.requiredTeachers}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 10,
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  fontSize: 13,
                  color: '#475569'
                }}
              >
                Hôm nay bạn làm việc theo khung giờ hành chính tiêu chuẩn của phân hiệu. Nếu có thay đổi ca đột xuất, bộ phận Nhân sự sẽ cập nhật tại đây.
              </div>
            )}

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #eef2f7' }}>
              <strong style={{ display: 'block', fontSize: 13, color: '#1e293b', marginBottom: 8 }}>
                {meta.checklistTitle}
              </strong>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13, color: '#475569' }}>
                {meta.checklist.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="content-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <p className="card-kicker" style={{ margin: 0 }}>BẢNG TIN NỘI BỘ</p>
                <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>Thông báo mới từ Nhà trường</h3>
              </div>
              <Link to="/internal-notices" className="button button-secondary" style={{ minHeight: 34, padding: '0 12px' }}>
                Tất cả
              </Link>
            </div>

            {loading ? (
              <p style={{ color: '#64748b', fontSize: 13 }}>Đang tải thông báo...</p>
            ) : notices.length > 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                {notices.map((n) => (
                  <div
                    key={n._id}
                    style={{
                      padding: '11px 14px',
                      borderRadius: 10,
                      background: n.isRead ? '#f8fafc' : '#eff6ff',
                      border: `1px solid ${n.isRead ? '#e2e8f0' : '#bfdbfe'}`
                    }}
                  >
                    <strong style={{ display: 'block', fontSize: 13.5, color: '#0f172a' }}>{n.title}</strong>
                    <span style={{ fontSize: 12.5, color: '#475569' }}>{n.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '18px 16px',
                  borderRadius: 10,
                  background: '#f8fafc',
                  border: '1px dashed #cbd5e1',
                  fontSize: 13,
                  color: '#64748b',
                  textAlign: 'center'
                }}
              >
                Hiện chưa có thông báo mới. Khi Ban Giám hiệu hoặc Nhân sự gửi thông báo, bạn sẽ nhận được ngay tại đây.
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

