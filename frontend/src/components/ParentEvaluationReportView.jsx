/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import api from '../api/axiosConfig';
import Icon from './Icon';

export default function ParentEvaluationReportView() {
  const [data, setData] = useState({ items: [], summary: { totalCount: 0, avgOverall: 0, avgCare: 0, avgTeaching: 0, avgCommunication: 0 }, pagination: { page: 1, totalPages: 1 } });
  const [periods, setPeriods] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodNotice, setPeriodNotice] = useState('');
  const [periodError, setPeriodError] = useState('');
  const [periodSaving, setPeriodSaving] = useState(false);
  const [newPeriod, setNewPeriod] = useState({
    code: '',
    name: '',
    schoolYear: '2026-2027',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: ''
  });

  const userRole = JSON.parse(localStorage.getItem('user') || '{}').role;
  const canManagePeriods = ['admin', 'principal', 'hr'].includes(userRole);

  const handleTogglePeriodStatus = async (periodId, currentStatus) => {
    try {
      setPeriodError('');
      const nextStatus = currentStatus === 'open' ? 'closed' : 'open';
      const res = await api.patch(`/parent-teacher-evaluations/periods/${periodId}/status`, { status: nextStatus });
      setPeriodNotice(res.data?.message || 'Cập nhật trạng thái kỳ thành công.');
      loadFilters();
    } catch (err) {
      setPeriodError(err.response?.data?.message || 'Không thể cập nhật trạng thái kỳ.');
    }
  };

  const handleCreatePeriod = async (e) => {
    e.preventDefault();
    setPeriodSaving(true);
    setPeriodError('');
    setPeriodNotice('');
    try {
      const res = await api.post('/parent-teacher-evaluations/periods', newPeriod);
      setPeriodNotice(res.data?.message || 'Tạo kỳ đánh giá mới thành công.');
      setNewPeriod({
        code: '',
        name: '',
        schoolYear: '2026-2027',
        startDate: new Date().toISOString().slice(0, 10),
        endDate: ''
      });
      loadFilters();
    } catch (err) {
      setPeriodError(err.response?.data?.message || 'Không thể tạo kỳ đánh giá.');
    } finally {
      setPeriodSaving(false);
    }
  };

  const loadFilters = useCallback(async () => {
    try {
      const [periodsRes, classesRes] = await Promise.all([
        api.get('/parent-teacher-evaluations/periods'),
        api.get('/classrooms')
      ]);
      setPeriods(periodsRes.data.data || []);
      setClassrooms(classesRes.data.data || []);
    } catch {
      // ignore
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: 10 };
      if (selectedPeriod) params.period = selectedPeriod;
      if (selectedClass) params.classroomId = selectedClass;
      const res = await api.get('/parent-teacher-evaluations', { params });
      setData(res.data.data || { items: [], summary: { totalCount: 0, avgOverall: 0, avgCare: 0, avgTeaching: 0, avgCommunication: 0 }, pagination: { page: 1, totalPages: 1 } });
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể tải báo cáo đánh giá.');
    } finally {
      setLoading(false);
    }
  }, [page, selectedPeriod, selectedClass]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const summary = data?.summary || { totalCount: 0, avgOverall: 0, avgCare: 0, avgTeaching: 0, avgCommunication: 0 };
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1 };

  return (
    <section className="content-card student-list-card">
      <div className="card-heading">
        <div>
          <p className="card-kicker">Ý KIẾN PHỤ HUYNH</p>
          <h2>Báo cáo đánh giá giáo viên chủ nhiệm ({summary.totalCount} lượt)</h2>
          <p>Thống kê trung bình các tiêu chí từ phản hồi phụ huynh, hỗ trợ nâng cao chất lượng sư phạm.</p>
        </div>
      </div>

      {error && <div className="form-error" role="alert" style={{ margin: '0 20px 14px' }}>{error}</div>}

      {/* Aggregate Metrics Bar */}
      <div className="hr-summary" style={{ margin: '0 20px 20px' }}>
        <article>
          <span><Icon name="chart" size={19} /></span>
          <div>
            <small>ĐÁNH GIÁ CHUNG</small>
            <strong style={{ color: '#d97706' }}>★ {summary.avgOverall}/5.0</strong>
          </div>
        </article>
        <article>
          <span><Icon name="heart" size={19} /></span>
          <div>
            <small>CHĂM SÓC TRẺ</small>
            <strong>{summary.avgCare}/5.0</strong>
          </div>
        </article>
        <article>
          <span><Icon name="classes" size={19} /></span>
          <div>
            <small>PHƯƠNG PHÁP DẠY</small>
            <strong>{summary.avgTeaching}/5.0</strong>
          </div>
        </article>
        <article>
          <span><Icon name="chat" size={19} /></span>
          <div>
            <small>TƯƠNG TÁC PHỤ HUYNH</small>
            <strong>{summary.avgCommunication}/5.0</strong>
          </div>
        </article>
      </div>

      {/* Filter Bar */}
      <div className="list-toolbar" style={{ margin: '0 20px 16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Kỳ đánh giá:
          <select value={selectedPeriod} onChange={(e) => { setSelectedPeriod(e.target.value); setPage(1); }} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <option value="">Tất cả các kỳ</option>
            {periods.map((p) => (
              <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Lớp học:
          <select value={selectedClass} onChange={(e) => { setSelectedClass(e.target.value); setPage(1); }} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <option value="">Tất cả các lớp</option>
            {classrooms.map((c) => (
              <option key={c._id} value={c._id}>{c.name} ({c.schoolYear})</option>
            ))}
          </select>
        </label>
        </div>

        {canManagePeriods && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => { setPeriodNotice(''); setPeriodError(''); setShowPeriodModal(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Icon name="calendar" size={15} /> Quản lý kỳ đánh giá
          </button>
        )}
      </div>

      {/* Evaluations Table */}
      {loading ? (
        <div className="inline-loader" style={{ padding: '30px', textAlign: 'center' }}>
          Đang tải dữ liệu đánh giá...
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ padding: '30px' }}>
          Chưa có lượt đánh giá nào phù hợp với bộ lọc.
        </div>
      ) : (
        <div className="table-wrap" style={{ padding: '0 20px 20px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>HỌC SINH / LỚP</th>
                <th>GIÁO VIÊN ĐƯỢC ĐÁNH GIÁ</th>
                <th>KỲ / NĂM HỌC</th>
                <th>ĐIỂM TIÊU CHÍ</th>
                <th>ĐÁNH GIÁ CHUNG</th>
                <th>Ý KIẾN / GÓP Ý</th>
                <th>NGÀY GỬI</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td>
                    <strong>{item.studentName}</strong>
                    <small>Lớp: {item.className}</small>
                  </td>
                  <td>
                    <strong>{item.teacherName}</strong>
                  </td>
                  <td>
                    <span className="account-role-badge">{item.period}</span>
                    <small style={{ display: 'block' }}>{item.schoolYear}</small>
                  </td>
                  <td>
                    <div style={{ fontSize: '11px', display: 'grid', gap: '2px' }}>
                      <span>Chăm sóc: <b>{item.criteria?.care}/5</b></span>
                      <span>Giảng dạy: <b>{item.criteria?.teaching}/5</b></span>
                      <span>Kết nối: <b>{item.criteria?.communication}/5</b></span>
                    </div>
                  </td>
                  <td>
                    <strong style={{ color: '#d97706', fontSize: '14px' }}>
                      {'★'.repeat(item.overallRating || 5)} ({item.overallRating}/5)
                    </strong>
                  </td>
                  <td style={{ maxWidth: '300px' }}>
                    {item.feedback ? (
                      <span style={{ fontSize: '12px', color: '#334155' }}>{item.feedback}</span>
                    ) : (
                      <small style={{ color: '#94a3b8' }}>Không có phản hồi thêm</small>
                    )}
                  </td>
                  <td>
                    <small>{new Date(item.createdAt).toLocaleDateString('vi-VN')}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Trang trước
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Trang sau
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Period Management Modal */}
      {showPeriodModal && (
        <div className="modal-backdrop">
          <div className="content-card student-form hr-modal handover-modal" style={{ maxWidth: '780px', width: '95%' }}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">CẤU HÌNH ĐÁNH GIÁ</p>
                <h2>Quản lý các đợt đánh giá giáo viên chủ nhiệm</h2>
                <p>Mở/đóng kỳ đánh giá theo năm học. Phụ huynh chỉ có thể gửi phiếu khi kỳ đang trong trạng thái MỞ.</p>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setShowPeriodModal(false)}>Đóng</button>
            </div>

            {periodError && <div className="form-error" role="alert" style={{ margin: '0 0 12px' }}>{periodError}</div>}
            {periodNotice && <div className="timekeeping-notice success" role="status" style={{ margin: '0 0 12px' }}>{periodNotice}</div>}

            {/* Existing Periods Table */}
            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ margin: '0 0 10px', color: '#1e293b' }}>Danh sách các kỳ hiện có</h4>
              {periods.length === 0 ? (
                <div style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', padding: '12px 0' }}>
                  Chưa có kỳ đánh giá nào được tạo. Hãy tạo kỳ đánh giá đầu tiên bên dưới.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>MÃ KỲ</th>
                        <th>TÊN KỲ ĐÁNH GIÁ</th>
                        <th>NĂM HỌC</th>
                        <th>THỜI GIAN HIỆU LỰC</th>
                        <th>TRẠNG THÁI</th>
                        <th>THAO TÁC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => {
                        const isOpen = p.status === 'open';
                        return (
                          <tr key={p._id}>
                            <td><strong>{p.code}</strong></td>
                            <td>{p.name}</td>
                            <td><span className="account-role-badge">{p.schoolYear}</span></td>
                            <td><small>{p.startDate} → {p.endDate}</small></td>
                            <td>
                              <span style={{
                                padding: '3px 8px',
                                borderRadius: '99px',
                                fontSize: '11px',
                                fontWeight: 700,
                                background: isOpen ? '#dcfce7' : '#f1f5f9',
                                color: isOpen ? '#166534' : '#64748b'
                              }}>
                                {isOpen ? '● Đang mở' : '○ Đã đóng'}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button button-secondary"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                                onClick={() => handleTogglePeriodStatus(p._id, p.status)}
                              >
                                {isOpen ? 'Đóng kỳ' : 'Mở kỳ'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Create Period Form */}
            <form onSubmit={handleCreatePeriod} style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 12px', color: '#1e293b' }}>Tạo thêm đợt đánh giá mới</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '12px' }}>
                <label>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Mã kỳ (ví dụ: 2026-HK1) *</span>
                  <input
                    type="text"
                    required
                    placeholder="Mã kỳ..."
                    value={newPeriod.code}
                    onChange={(e) => setNewPeriod({ ...newPeriod, code: e.target.value.toUpperCase() })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Tên kỳ đánh giá *</span>
                  <input
                    type="text"
                    required
                    placeholder="Ví dụ: Đánh giá Học kỳ 1 Năm học 2026-2027"
                    value={newPeriod.name}
                    onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <label>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Năm học (YYYY-YYYY) *</span>
                  <input
                    type="text"
                    required
                    pattern="^\d{4}-\d{4}$"
                    placeholder="2026-2027"
                    value={newPeriod.schoolYear}
                    onChange={(e) => setNewPeriod({ ...newPeriod, schoolYear: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Ngày bắt đầu *</span>
                  <input
                    type="date"
                    required
                    value={newPeriod.startDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, startDate: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Ngày kết thúc *</span>
                  <input
                    type="date"
                    required
                    value={newPeriod.endDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, endDate: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={periodSaving}
                >
                  {periodSaving ? 'Đang tạo kỳ...' : 'Tạo kỳ đánh giá'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
