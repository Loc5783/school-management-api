/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { getMyInternalAnnouncements, getMyTimesheets, respondMonthlyTimesheet } from '../api/hr';
import api from '../api/axiosConfig';

const when = (value) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '—';
const formatDateVN = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export default function InternalNotices() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = ['announcements', 'timesheets', 'reminders'].includes(requestedTab) ? requestedTab : 'announcements';
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], pagination: { page: 1, totalPages: 1 } });
  const [reply, setReply] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);
  const abortCtrlRef = useRef(null);

  const load = useCallback(async () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    const currentAbortCtrl = new AbortController();
    abortCtrlRef.current = currentAbortCtrl;
    const seq = ++requestSeqRef.current;

    setLoading(true);
    setError('');
    try {
      const result = tab === 'announcements'
        ? await getMyInternalAnnouncements({ page }, currentAbortCtrl.signal)
        : tab === 'timesheets'
          ? await getMyTimesheets({ page }, currentAbortCtrl.signal)
          : await api.get('/notifications', { params: { page, limit: 10 }, signal: currentAbortCtrl.signal });

      if (seq !== requestSeqRef.current) return;
      setData(result?.data || { data: [], pagination: { page: 1, totalPages: 1 } });
    } catch (err) {
      if (currentAbortCtrl.signal.aborted || seq !== requestSeqRef.current) {
        return;
      }
      setData({ data: [], pagination: { page: 1, totalPages: 1 } });
      if (err.response?.status === 404 && tab === 'timesheets') {
        setError('Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên hoặc chưa có bảng công.');
      } else {
        setError(err.response?.data?.message || 'Không thể tải dữ liệu. Vui lòng thử lại.');
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [tab, page]);

  useEffect(() => {
    setData({ data: [], pagination: { page: 1, totalPages: 1 } });
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    return () => {
      if (abortCtrlRef.current) {
        abortCtrlRef.current.abort();
      }
    };
  }, []);

  const changeTab = (next) => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    setPage(1);
    setData({ data: [], pagination: { page: 1, totalPages: 1 } });
    setSearchParams({ tab: next });
  };

  const respond = async (event) => {
    event.preventDefault();
    if (busy || !reply?.sheet) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await respondMonthlyTimesheet(reply.sheet._id, { status: reply.status, note: reply.note, version: reply.sheet.__v });
      setReply(null);
      await load();
      setNotice('Đã gửi phản hồi bảng công thành công.');
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể gửi phản hồi.');
    } finally {
      setBusy(false);
    }
  };

  const items = Array.isArray(data?.data) ? data.data : [];

  return (
    <AppShell title="Thông báo nội bộ" subtitle="Lịch họp, ca trực, giấy tờ và bảng công chỉ dành cho nhân viên liên quan.">
      <section className="content-card internal-panel">
        <div className="timekeeping-hub-tabs">
          <button type="button" className={tab === 'announcements' ? 'active' : ''} onClick={() => changeTab('announcements')}>Thông báo</button>
          <button type="button" className={tab === 'timesheets' ? 'active' : ''} onClick={() => changeTab('timesheets')}>Bảng công của tôi</button>
          <button type="button" className={tab === 'reminders' ? 'active' : ''} onClick={() => changeTab('reminders')}>Nhắc việc & giấy tờ</button>
        </div>
      </section>

      {error && (
        <div className="form-error" role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button type="button" className="button button-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={load}>Thử lại</button>
        </div>
      )}
      {notice && <div className="timekeeping-notice success" role="status">{notice}</div>}

      <section className="content-card internal-panel">
        <div className="card-heading">
          <div>
            <p className="card-kicker">
              {tab === 'announcements' ? 'THÔNG BÁO DÀNH CHO BẠN' : tab === 'timesheets' ? 'ĐỐI CHIẾU CÔNG THÁNG' : 'LỜI NHẮC DÀNH CHO BẠN'}
            </p>
            <h2>
              {tab === 'announcements' ? 'Lịch và thông tin mới' : tab === 'timesheets' ? 'Xác nhận bảng công' : 'Nhắc việc & giấy tờ'}
            </h2>
          </div>
        </div>

        {loading ? (
          <div className="inline-loader" style={{ padding: '28px 0', textAlign: 'center' }}>
            <span className="loading-orb" /> Đang tải {tab === 'timesheets' ? 'bảng công' : 'thông tin'}...
          </div>
        ) : (
          <div className="internal-list">
            {tab === 'announcements' && (
              items.length > 0 ? (
                items.map((item) => (
                  <article key={item._id}>
                    <div>
                      <small>{when(item.createdAt)} · {item.category === 'meeting' ? 'Lịch họp' : item.category === 'shift' ? 'Ca trực' : 'Thông tin chung'}</small>
                      <strong>{item.title}</strong>
                      <p>{item.message}</p>
                      {item.eventAt && <small>Thời gian: {when(item.eventAt)} {item.location && `· ${item.location}`}</small>}
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-state">Chưa có thông báo nào dành cho bạn.</p>
              )
            )}

            {tab === 'reminders' && (
              items.length > 0 ? (
                items.map((item) => (
                  <article key={item._id}>
                    <div>
                      <small>{when(item.createdAt)}</small>
                      <strong>{item.title}</strong>
                      <p>{item.message}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-state">Chưa có lời nhắc hoặc thông báo giấy tờ.</p>
              )
            )}

            {tab === 'timesheets' && (
              items.length > 0 ? (
                items.filter((sheet) => sheet && typeof sheet === 'object' && sheet._id).map((sheet) => {
                  const days = Array.isArray(sheet?.days) ? sheet.days : [];
                  return (
                    <article key={sheet._id}>
                      <div className="internal-sheet">
                        <div>
                          <strong>Bảng công tháng {sheet.period}</strong>
                          <small>
                            {sheet.totalWorkdays ?? 0} công · Lần gửi {sheet.revision || 1} · {
                              sheet.status === 'confirmed' ? 'Đã xác nhận' : sheet.status === 'disputed' ? 'Đã phản hồi sai lệch' : 'Cần bạn xác nhận'
                            }
                          </small>
                        </div>
                        <div className="table-wrap">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>NGÀY</th>
                                <th>VÀO</th>
                                <th>RA</th>
                                <th>CÔNG</th>
                              </tr>
                            </thead>
                            <tbody>
                              {days.map((day, idx) => (
                                <tr key={day?.workDate || idx}>
                                  <td>{formatDateVN(day?.workDate)}</td>
                                  <td>{when(day?.checkInTime)}</td>
                                  <td>{when(day?.checkOutTime)}</td>
                                  <td>{day?.workday ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!days.length && <p>Không có ngày công nào được ghi nhận trong kỳ này.</p>}
                        {sheet.employeeNote && <p className="sheet-feedback"><b>Phản hồi của bạn:</b> {sheet.employeeNote}</p>}
                        {sheet.status === 'pending' && (
                          <div className="classroom-actions" style={{ marginTop: '12px' }}>
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={() => { setError(''); setReply({ sheet, status: 'confirmed', note: '' }); }}
                            >
                              Xác nhận đúng
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => { setError(''); setReply({ sheet, status: 'disputed', note: '' }); }}
                            >
                              Báo có sai lệch
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="empty-state">Chưa có bảng công nào được phát hành cho bạn trong kỳ này.</p>
              )
            )}
          </div>
        )}

        <div className="handover-pagination">
          <span>Trang {data.pagination?.page || 1}/{data.pagination?.totalPages || 1}</span>
          <div>
            <button
              type="button"
              className="button button-secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
            >
              Trước
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={page >= (data.pagination?.totalPages || 1) || loading}
              onClick={() => setPage(page + 1)}
            >
              Sau
            </button>
          </div>
        </div>

        {tab === 'timesheets' && (
          <div className="staff-request-quick-link">
            <p>Phản hồi sai lệch sẽ được chuyển trực tiếp tới phòng Nhân sự để đối soát. Bạn có thể theo dõi diễn biến tại mục Yêu cầu của tôi.</p>
            <Link className="button button-secondary" to="/my-requests">Theo dõi yêu cầu</Link>
          </div>
        )}
      </section>

      {reply && (
        <div className="modal-backdrop">
          <form className="content-card student-form hr-modal handover-modal" onSubmit={respond}>
            <div className="card-heading">
              <div>
                <p className="card-kicker">BẢNG CÔNG THÁNG {reply.sheet.period}</p>
                <h2>{reply.status === 'confirmed' ? 'Xác nhận công đúng' : 'Báo sai lệch cho HR'}</h2>
              </div>
              <button type="button" className="button button-secondary" onClick={() => setReply(null)}>Đóng</button>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <p>{reply.sheet.totalWorkdays} công · Lần gửi {reply.sheet.revision}. Sau khi xác nhận không thể tự hủy hoặc gửi lại.</p>
            {reply.status === 'disputed' && (
              <label>
                Ngày và chi tiết sai lệch
                <textarea
                  required
                  maxLength="1000"
                  value={reply.note}
                  onChange={(e) => setReply({ ...reply, note: e.target.value })}
                  placeholder="Ví dụ: Ngày 15/09 có đi làm từ 07:30 đến 17:00 nhưng trên bảng công hiển thị thiếu giờ ra."
                />
              </label>
            )}
            <div className="form-actions">
              <button type="button" className="button button-secondary" onClick={() => setReply(null)}>Hủy bỏ</button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Đang gửi...' : 'Gửi xác nhận'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}