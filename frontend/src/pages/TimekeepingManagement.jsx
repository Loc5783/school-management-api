import { useEffect, useState, useCallback } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  getPendingCorrections,
  approveCorrection,
  rejectCorrection,
  recalculateAttendance
} from '../api/timekeeping';

export default function TimekeepingManagement({ embedded = false }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await getPendingCorrections();
      setPendingRequests(res.data.data || []);
    } catch (error) {
      console.error('Lỗi khi tải danh sách đơn:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const res = await getPendingCorrections();
        if (isMounted) {
          setPendingRequests(res.data.data || []);
        }
      } catch (error) {
        if (isMounted) console.error('Lỗi khi tải dữ liệu:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleApprove = async (id) => {
    if (!confirm('Bạn có chắc muốn duyệt đơn này?')) return;
    try {
      const request = pendingRequests.find((item) => item._id === id);
      await approveCorrection(id, request?.version);
      alert('Đã duyệt thành công');
      fetchData();
    } catch (error) {
      console.error('Lỗi khi duyệt đơn:', error);
      alert('Lỗi khi duyệt đơn');
    }
  };

  const handleReject = async (id) => {
    const reason = prompt('Nhập lý do từ chối:');
    if (reason === null) return;
    try {
      const request = pendingRequests.find((item) => item._id === id);
      await rejectCorrection(id, request?.version, reason);
      alert('Đã từ chối');
      fetchData();
    } catch (error) {
      console.error('Lỗi khi từ chối đơn:', error);
      alert('Lỗi khi từ chối đơn');
    }
  };

  const handleRecalculate = async () => {
    if (!selectedDate) {
      alert('Vui lòng chọn ngày cần tính lại');
      return;
    }
    if (!confirm(`Bạn có chắc muốn tính lại ngày ${selectedDate}?`)) return;
    try {
      await recalculateAttendance(selectedDate);
      alert('Tính lại thành công');
      fetchData();
    } catch (error) {
      console.error('Lỗi khi tính lại:', error);
      alert('Lỗi khi tính lại');
    }
  };

  if (loading) return embedded ? <div className="inline-loader"><span className="loading-orb" />Đang tải...</div> : <div className="page-loader"><span className="loading-orb" />Đang tải...</div>;

  const content = <>
      <section className="content-card">
        <div className="card-heading">
          <div>
            <p className="card-kicker">CHỜ DUYỆT</p>
            <h2>Đơn chấm công bù ({pendingRequests.length})</h2>
          </div>
        </div>
        {pendingRequests.length === 0 ? (
          <div className="empty-state"><strong>Không có đơn chờ duyệt</strong></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nhân viên</th>
                  <th>Ngày</th>
                  <th>Giờ đề nghị</th>
                  <th>Lý do</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => (
                  <tr key={req._id}>
                    <td>{req.employeeName}</td>
                    <td>{new Date(req.workDate).toLocaleDateString('vi-VN')}</td>
                    <td>{req.requestedCheckInTime}</td>
                    <td>{req.reason}</td>
                    <td>
                      <button
                        className="button button-primary"
                        onClick={() => handleApprove(req._id)}
                        style={{ marginRight: 8 }}
                      >
                        <Icon name="check" size={16} /> Duyệt
                      </button>
                      <button
                        className="button button-secondary"
                        onClick={() => handleReject(req._id)}
                      >
                        <Icon name="x" size={16} /> Từ chối
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="content-card" style={{ marginTop: 20 }}>
        <div className="card-heading">
          <div>
            <p className="card-kicker">CÔNG CỤ</p>
            <h2>Tính lại ngày đã chốt</h2>
          </div>
        </div>
        <div style={{ padding: '0 23px 23px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
          <button className="button button-primary" onClick={handleRecalculate}>
            <Icon name="refresh" size={16} /> Tính lại
          </button>
        </div>
      </section>
  </>;
  return embedded ? content : <AppShell title="Quản lý chấm công" subtitle="Phê duyệt đơn và theo dõi công nhân viên">{content}</AppShell>;
}
