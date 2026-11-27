import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StudentExcelImportModal from '../components/StudentExcelImportModal';
import { listStudents } from '../api/students';
import api from '../api/axiosConfig';
import { getStoredUser } from '../utils/storage';

const DEFAULT_CAMPUS = 'Cơ sở chính';
const statusText = {
  pending_admission: 'Chờ nhập học',
  enrolled: 'Đang theo học',
  temporarily_absent: 'Tạm nghỉ',
  withdrawn: 'Đã thôi học',
  transferred: 'Đã chuyển trường',
  graduated: 'Đã tốt nghiệp'
};

export default function StudentList() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [classes, setClasses] = useState([]);
  const [campusFilter, setCampusFilter] = useState('all');
  const [filters, setFilters] = useState({
    search: '',
    classroomId: '',
    status: 'all',
    schoolYear: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    page: 1,
    limit: 10
  });
  const [pagination, setPagination] = useState({});
  const [state, setState] = useState({ loading: true, error: '' });
  const [showImportModal, setShowImportModal] = useState(false);
  const role = getStoredUser().role;

  const load = useCallback(async () => {
    setState({ loading: true, error: '' });
    try {
      const response = await listStudents(filters);
      setItems(response.data.data || []);
      setPagination(response.data.pagination || {});
    } catch (err) {
      setState({ loading: false, error: err.response?.data?.message || 'Không thể tải danh sách học sinh.' });
      return;
    }
    setState({ loading: false, error: '' });
  }, [filters]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    api.get('/classrooms').then((r) => setClasses(r.data.data || [])).catch(() => {});
  }, []);

  const campusOptions = useMemo(() => {
    const unique = new Set();
    classes.forEach((cls) => unique.add(cls.campus?.trim() || DEFAULT_CAMPUS));
    return [...unique];
  }, [classes]);

  const visibleClasses = useMemo(() => {
    if (campusFilter === 'all') return classes;
    return classes.filter((cls) => (cls.campus?.trim() || DEFAULT_CAMPUS) === campusFilter);
  }, [classes, campusFilter]);

  const change = (key, value) => setFilters((old) => ({ ...old, [key]: value, page: key === 'page' ? value : 1 }));
  const canWrite = ['admin', 'principal', 'teacher'].includes(role);
  const canCreateDirect = ['admin', 'teacher'].includes(role);

  const handleImportSuccess = (_createdStudents, targetClassId) => {
    // Nếu đẩy theo 1 lớp cụ thể -> lọc về lớp đó; nếu đẩy danh sách tổng nhiều lớp -> hiện toàn bộ
    setFilters((old) => ({
      ...old,
      classroomId: targetClassId || '',
      status: 'all',
      search: '',
      page: 1,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    }));
  };

  return (
    <AppShell
      title="Học sinh"
      subtitle="Tra cứu, nhập danh sách tổng / theo lớp và quản lý hồ sơ học sinh theo đúng phạm vi quyền."
      actions={canWrite && (
        <div className="toolbar-buttons student-list-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setShowImportModal(true)}
          >
            <Icon name="upload" size={17} />
            Nhập từ Excel
          </button>
          {canCreateDirect && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigate('/students/new')}
            >
              <Icon name="plus" size={17} />
              Thêm học sinh
            </button>
          )}
        </div>
      )}
    >
      <section className="content-card student-list-card">
        <div className="student-filter-grid">
          <label className="search-box">
            <Icon name="search" size={18} />
            <input value={filters.search} onChange={(e) => change('search', e.target.value)} placeholder="Tìm theo tên, mã HS hoặc mã định danh" />
          </label>
          {campusOptions.length > 1 && (
            <select
              value={campusFilter}
              onChange={(e) => {
                setCampusFilter(e.target.value);
                change('classroomId', '');
              }}
            >
              <option value="all">Tất cả phân hiệu</option>
              {campusOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select value={filters.classroomId} onChange={(e) => change('classroomId', e.target.value)}>
            <option value="">Tất cả lớp</option>
            {visibleClasses.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}{campusOptions.length > 1 ? ` (${item.campus || DEFAULT_CAMPUS})` : ''}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => change('status', e.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            {Object.entries(statusText).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input value={filters.schoolYear} onChange={(e) => change('schoolYear', e.target.value)} placeholder="Năm học (tất cả)" />
        </div>

        {state.loading ? (
          <div className="empty-state">Đang tải danh sách học sinh...</div>
        ) : state.error ? (
          <div className="empty-state error">
            <strong>{state.error}</strong>
            <button className="button button-secondary" onClick={load}>Thử lại</button>
          </div>
        ) : !items.length ? (
          <div className="empty-state">
            <strong>Chưa có học sinh phù hợp</strong>
            <span>Thử thay đổi bộ lọc hoặc thêm hồ sơ mới.</span>
          </div>
        ) : (
          <>
            <div className="student-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã ID HS</th>
                    <th>Học sinh</th>
                    <th>Mã định danh</th>
                    <th>Lớp</th>
                    <th>Ngày sinh</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((student) => (
                    <tr key={student._id}>
                      <td><strong>{student.studentCode}</strong></td>
                      <td>
                        <strong>{student.fullName}</strong>
                        <small>{student.gender === 'female' ? 'Nữ' : 'Nam'}</small>
                      </td>
                      <td>{student.identityCode || '—'}</td>
                      <td>{student.currentClassName || '—'}</td>
                      <td>{student.birthDate ? new Date(student.birthDate).toLocaleDateString('vi-VN') : '—'}</td>
                      <td><span className={`student-status ${student.status}`}>{statusText[student.status] || student.status}</span></td>
                      <td><Link className="button button-secondary" to={`/students/${student._id}`}>Xem</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="student-pagination">
              <span>Hiển thị {items.length} / {pagination.total || 0} học sinh · mới cập nhật trước</span>
              <div>
                <button className="button button-secondary" disabled={filters.page <= 1} onClick={() => change('page', filters.page - 1)}>Trước</button>
                <b>Trang {pagination.page || 1} / {pagination.totalPages || 1}</b>
                <button className="button button-secondary" disabled={filters.page >= (pagination.totalPages || 1)} onClick={() => change('page', filters.page + 1)}>Sau</button>
              </div>
            </div>
          </>
        )}
      </section>

      {canWrite && (
        <StudentExcelImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          defaultClassroomId={filters.classroomId}
          classrooms={classes}
          onSuccess={handleImportSuccess}
        />
      )}
    </AppShell>
  );
}
