import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

export default function AttendanceClassList() {
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/classrooms').then((res) => setClassrooms(res.data.data || [])).catch(console.error).finally(() => setLoading(false));
  }, []);
  const visibleClasses = classrooms.filter((item) => `${item.name} ${item.fullName || ''}`.toLowerCase().includes(query.toLowerCase()));

  return <AppShell title="Điểm danh" subtitle="Chọn lớp để bắt đầu ghi nhận tình hình đến lớp hôm nay.">
    <section className="content-card class-list-card">
      <div className="list-toolbar"><div><p className="card-kicker">DANH SÁCH LỚP</p><h2>{loading ? 'Đang tải lớp học...' : `${visibleClasses.length} lớp đang hoạt động`}</h2></div><label className="search-box"><Icon name="search" size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm lớp học..." /></label></div>
      {loading ? <div className="inline-loader"><span className="loading-orb" />Đang lấy danh sách lớp...</div> : visibleClasses.length ? <div className="class-grid">
        {visibleClasses.map((cls, index) => <Link key={cls._id} to={`/attendance/class/${cls._id}`} className="class-card"><span className={`class-symbol symbol-${index % 4}`}>{cls.name?.charAt(0) || 'L'}</span><div className="class-info"><h3>{cls.name}</h3><p>{cls.fullName || `Lớp độ tuổi ${cls.ageGroup || '—'}`}</p><span><Icon name="students" size={15} />{cls.statistics?.currentStudents || 0} / {cls.maxSize || 25} học sinh</span></div><span className="round-arrow"><Icon name="chevronRight" size={18} /></span></Link>)}
      </div> : <div className="empty-state"><span className="empty-icon"><Icon name="classes" /></span><strong>Không tìm thấy lớp học</strong><p>Thử tìm bằng tên lớp khác hoặc kiểm tra dữ liệu lớp.</p></div>}
    </section>
  </AppShell>;
}
