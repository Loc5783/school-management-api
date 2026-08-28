import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { createCorrectionRequest, getMyTimekeeping } from '../api/timekeeping';

const formatDate = (value) => new Date(value).toLocaleDateString('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric'
});

const formatTime = (value) => value ? new Date(value).toLocaleTimeString('vi-VN', {
  hour: '2-digit', minute: '2-digit'
}) : '—';

const statusLabel = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
  REVOKED: 'Đã thu hồi'
};

const sourceLabel = {
  merged: 'Đã tổng hợp',
  manual: 'Nhập thủ công',
  correction: 'Điều chỉnh'
};

const today = () => new Date().toISOString().slice(0, 10);

export default function ManualTimekeeping() {
  const [data, setData] = useState({ records: [], corrections: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState({
    workDate: '',
    adjustmentType: 'MISSING_CHECK_IN',
    requestedTime: '08:30',
    reason: ''
  });

  const load = async () => {
    try {
      const response = await getMyTimekeeping();
      setData(response.data.data);
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải dữ liệu chấm công.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await createCorrectionRequest(form);
      setNotice({ type: 'success', text: response.data.message });
      setForm({ workDate: '', adjustmentType: 'MISSING_CHECK_IN', requestedTime: '08:30', reason: '' });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể gửi đơn chấm công bù.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Làm đơn chấm công bù"
      subtitle="Khai báo thời gian bị thiếu để Admin hoặc Ban giám hiệu kiểm tra và phê duyệt."
    >
      {notice && <div className={`timekeeping-notice ${notice.type}`}><Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />{notice.text}</div>}

      <section className="adjustment-hero">
        <div>
          <p className="card-kicker">QUY TRÌNH MINH BẠCH</p>
          <h2>Chỉ bổ sung khi thiếu dữ liệu chấm công</h2>
          <p>Phiếu chỉ được dùng để bổ sung giờ vào hoặc giờ ra còn thiếu. Dữ liệu máy chấm công gốc luôn được giữ nguyên để đối soát.</p>
        </div>
        <div className="adjustment-steps" aria-label="Quy trình xử lý phiếu">
          <span><b>1</b>Gửi phiếu</span><i /><span><b>2</b>Admin duyệt</span><i /><span><b>3</b>Tính lại công</span>
        </div>
      </section>

      <section className="adjustment-workspace">
        <form className="adjustment-form-card content-card" onSubmit={submit}>
          <div className="card-heading compact-heading"><div><p className="card-kicker">TẠO PHIẾU</p><h2>Bổ sung công bị thiếu</h2></div><span className="form-security"><Icon name="shield" size={15} />Có lưu lịch sử</span></div>
          <div className="adjustment-form-body">
            <label>
              Ngày làm việc
              <input type="date" max={today()} value={form.workDate} onChange={(event) => setForm({ ...form, workDate: event.target.value })} required />
            </label>
            <label>
              Loại điều chỉnh
              <select value={form.adjustmentType} onChange={(event) => setForm({ ...form, adjustmentType: event.target.value })}>
                <option value="MISSING_CHECK_IN">Thiếu giờ vào</option>
                <option value="MISSING_CHECK_OUT">Thiếu giờ ra</option>
              </select>
            </label>
            <label>
              {form.adjustmentType === 'MISSING_CHECK_IN' ? 'Giờ vào đề nghị' : 'Giờ ra đề nghị'}
              <input type="time" value={form.requestedTime} onChange={(event) => setForm({ ...form, requestedTime: event.target.value })} required />
            </label>
            <label className="adjustment-full-width">
              Lý do bổ sung
              <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Ví dụ: Quên chấm công khi đến trường lúc 08:00." maxLength="500" required />
              <small>{form.reason.length}/500 ký tự</small>
            </label>
            <button className="button button-primary adjustment-submit" type="submit" disabled={submitting}><Icon name="plus" size={17} />{submitting ? 'Đang gửi phiếu...' : 'Gửi phiếu chờ duyệt'}</button>
          </div>
        </form>

        <aside className="adjustment-policy-card">
          <span className="policy-icon"><Icon name="shield" size={23} /></span>
          <p className="card-kicker">LƯU Ý</p>
          <h3>Điều kiện xử lý</h3>
          <ul>
            <li>Chỉ khai báo thời gian thực tế đã làm việc.</li>
            <li>Phiếu chờ duyệt chưa ảnh hưởng bảng công.</li>
            <li>Admin phải ghi lý do khi từ chối phiếu.</li>
          </ul>
          <p>Chấm công hằng ngày bằng mã nhân viên được thực hiện tại mục <strong>Điểm danh tự động</strong>.</p>
        </aside>
      </section>

      <section className="content-card adjustment-history">
        <div className="card-heading"><div><p className="card-kicker">THEO DÕI & ĐỐI SOÁT</p><h2>Lịch sử công và phiếu điều chỉnh</h2></div><span className="history-count">{data.corrections.length} phiếu</span></div>
        {loading ? <div className="inline-loader"><span className="loading-orb" />Đang tải lịch sử...</div> : <div className="adjustment-history-grid">
          <div className="history-panel">
            <h3><Icon name="attendance" size={16} />Bản ghi công gần đây</h3>
            {data.records.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày công</th><th>Giờ vào</th><th>Giờ ra</th><th>Nguồn</th><th>Trạng thái</th></tr></thead><tbody>{data.records.slice(0, 8).map((record) => <tr key={record._id}><td>{formatDate(record.workDate)}</td><td>{formatTime(record.checkInTime)}</td><td>{formatTime(record.checkOutTime)}</td><td>{sourceLabel[record.source] || 'Thiết bị'}</td><td><span className={`record-status ${record.status}`}>{record.status === 'present' ? 'Đủ dữ liệu' : 'Thiếu dữ liệu'}</span></td></tr>)}</tbody></table></div> : <p className="history-empty">Chưa có bản ghi công.</p>}
          </div>
          <div className="history-panel">
            <h3><Icon name="clock" size={16} />Phiếu chấm công bù</h3>
            {data.corrections.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Ngày</th><th>Loại</th><th>Giờ đề nghị</th><th>Trạng thái</th></tr></thead><tbody>{data.corrections.slice(0, 8).map((request) => <tr key={request._id}><td>{formatDate(request.workDate)}</td><td>{request.adjustmentType === 'MISSING_CHECK_OUT' ? 'Thiếu giờ ra' : 'Thiếu giờ vào'}</td><td>{request.requestedTime || request.requestedCheckInTime || request.requestedCheckOutTime}</td><td><span className={`adjustment-status ${request.status}`}>{statusLabel[request.status] || request.status}</span></td></tr>)}</tbody></table></div> : <p className="history-empty">Chưa có phiếu điều chỉnh.</p>}
          </div>
        </div>}
      </section>
    </AppShell>
  );
}
