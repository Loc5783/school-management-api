import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';

const labels = {
  fullName: 'Họ và tên',
  birthDate: 'Ngày sinh',
  gender: 'Giới tính',
  address: 'Địa chỉ',
  nationality: 'Quốc tịch',
  ethnicity: 'Dân tộc',
  birthPlace: 'Nơi sinh',
  healthInsuranceCode: 'Mã thẻ BHYT',
  bloodType: 'Nhóm máu',
  allergies: 'Dị ứng thực phẩm',
  disease: 'Bệnh lý lưu ý',
  emergencyContact: 'Liên hệ khẩn cấp',
  authorizedPickers: 'Người được phép đón'
};

const statusMap = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  cancelled: 'Đã hủy'
};

const formatChangeValue = (key, value) => {
  if (value == null || value === '') return '—';
  if (key === 'gender') return value === 'male' ? 'Nam' : value === 'female' ? 'Nữ' : String(value);
  if (key === 'birthDate') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('vi-VN');
  }
  if (key === 'authorizedPickers' && Array.isArray(value)) {
    if (!value.length) return 'Xóa danh sách người đón phụ';
    return value
      .map((p) => `${p.fullName || '—'}${p.relationship ? ` (${p.relationship})` : ''}${p.phone ? ` · ${p.phone}` : ''}`)
      .join('; ');
  }
  if (key === 'allergies' && Array.isArray(value)) {
    if (!value.length) return 'Không có dị ứng';
    return value
      .map((a) => (typeof a === 'string' ? a : `${a.allergen || a.name || 'Dị ứng'}${a.reaction ? ` (${a.reaction})` : ''}`))
      .join(', ');
  }
  if (key === 'emergencyContact' && typeof value === 'object') {
    return [value.name, value.relationship, value.phone].filter(Boolean).join(' · ') || 'Cập nhật liên hệ';
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ') || 'Có cập nhật chi tiết';
  }
  return String(value);
};

export default function StudentProfileChangeRequests({ embedded = false }) {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [notes, setNotes] = useState({});
  const [state, setState] = useState({ loading: true, saving: '', error: '', success: '' });

  const load = useCallback(async () => {
    try {
      setState((old) => ({ ...old, loading: true, error: '' }));
      const response = await api.get('/student-profile-change-requests', { params: filter ? { status: filter } : {} });
      setRequests(response.data.data || []);
      setState((old) => ({ ...old, loading: false }));
    } catch (error) {
      setState({ loading: false, saving: '', success: '', error: error.response?.data?.message || 'Không thể tải yêu cầu cập nhật.' });
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const review = async (id, decision) => {
    try {
      setState((old) => ({ ...old, saving: id, error: '', success: '' }));
      await api.patch(`/student-profile-change-requests/${id}/review`, { decision, reviewNote: notes[id] || '' });
      await load();
      setState((old) => ({
        ...old,
        saving: '',
        success: decision === 'approved' ? 'Đã duyệt và áp dụng thay đổi vào hồ sơ học sinh.' : 'Đã từ chối yêu cầu cập nhật.'
      }));
    } catch (error) {
      setState((old) => ({ ...old, saving: '', error: error.response?.data?.message || 'Không thể xử lý yêu cầu.', success: '' }));
    }
  };

  const content = (
    <>
      {state.error && <div className="form-error">{state.error}</div>}
      {state.success && <div className="timekeeping-notice success">{state.success}</div>}
      <section className="content-card profile-request-page">
        <div className="card-heading">
          <div>
            <p className="card-kicker">QUY TRÌNH PHÊ DUYỆT</p>
            <h2>Yêu cầu cập nhật hồ sơ từ phụ huynh</h2>
          </div>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="rejected">Đã từ chối</option>
            <option value="">Tất cả</option>
          </select>
        </div>

        {state.loading ? (
          <div className="inline-loader"><span className="loading-orb" />Đang tải yêu cầu...</div>
        ) : requests.length ? (
          <div className="profile-request-list">
            {requests.map((request) => (
              <article key={request._id}>
                <header>
                  <div>
                    <span className="student-avatar">{request.studentName?.charAt(0) || 'B'}</span>
                    <div>
                      <strong>{request.studentName}</strong>
                      <small>{request.className || 'Chưa xếp lớp'} · Phụ huynh: {request.requesterName}</small>
                    </div>
                  </div>
                  <span className={`student-status ${request.status === 'approved' ? 'enrolled' : request.status === 'pending' ? 'temporarily_absent' : 'withdrawn'}`}>
                    {statusMap[request.status] || request.status}
                  </span>
                </header>

                <div className="profile-request-fields">
                  {Object.entries(request.changes || {}).map(([key, value]) => (
                    <p key={key}>
                      <strong>{labels[key] || key}</strong>
                      <span>{formatChangeValue(key, value)}</span>
                    </p>
                  ))}
                </div>

                {request.status === 'pending' ? (
                  <footer>
                    <textarea
                      value={notes[request._id] || ''}
                      onChange={(event) => setNotes({ ...notes, [request._id]: event.target.value })}
                      placeholder="Ghi lý do nếu từ chối (bắt buộc khi từ chối)"
                      maxLength={500}
                    />
                    <div>
                      <button
                        type="button"
                        className="button button-danger"
                        disabled={Boolean(state.saving)}
                        onClick={() => review(request._id, 'rejected')}
                      >
                        Từ chối
                      </button>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={Boolean(state.saving)}
                        onClick={() => review(request._id, 'approved')}
                      >
                        {state.saving === request._id ? 'Đang xử lý...' : 'Duyệt thay đổi'}
                      </button>
                    </div>
                  </footer>
                ) : (
                  <footer className="profile-request-review">
                    <Icon name={request.status === 'approved' ? 'check' : 'alertCircle'} size={15} />
                    <span>
                      {request.reviewerName || 'Nhà trường'} · {request.reviewedAt ? new Date(request.reviewedAt).toLocaleDateString('vi-VN') : '—'}
                      {request.reviewNote ? ` · ${request.reviewNote}` : ''}
                    </span>
                  </footer>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">Không có yêu cầu cập nhật nào phù hợp.</div>
        )}
      </section>
    </>
  );

  return embedded ? (
    content
  ) : (
    <AppShell title="Duyệt cập nhật hồ sơ" subtitle="Phụ huynh gửi yêu cầu thay đổi thông tin; dữ liệu hồ sơ chính thức chỉ áp dụng sau khi Ban Giám Hiệu phê duyệt.">
      {content}
    </AppShell>
  );
}
