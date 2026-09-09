import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { kioskCheckIn } from '../api/timekeeping';

export default function SmartAttendance({ embedded = false }) {
  const [mode, setMode] = useState('face');
  const [cameraReady, setCameraReady] = useState(false);
  const [message, setMessage] = useState(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);
  const [activity, setActivity] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const startCamera = async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      setMessage({ type: 'info', text: 'Camera đã sẵn sàng. Thiết bị nhận diện sẽ tự gửi kết quả check-in.' });
    } catch (error) {
      console.error(error);
      setMessage({ type: 'error', text: 'Không thể mở camera. Hãy cấp quyền camera hoặc kiểm tra thiết bị.' });
    }
  };

  useEffect(() => () => stopCamera(), []);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setMessage(null);
    if (nextMode !== 'face') stopCamera();
  };

  const submitEmployeeCode = async (event) => {
    event.preventDefault();
    if (!employeeCode.trim()) {
      setMessage({ type: 'error', text: 'Vui lòng nhập mã nhân viên.' });
      return;
    }
    setSubmittingCode(true);
    setMessage(null);
    try {
      const response = await kioskCheckIn(employeeCode.trim());
      const result = response.data.data;
      setMessage({
        type: result.alreadyCheckedIn ? 'info' : 'success',
        text: response.data.message
      });
      setActivity((current) => [{
        id: result.event._id,
        name: result.employee.name,
        employeeId: result.employee.employeeId,
        duplicate: result.alreadyCheckedIn,
        time: result.event.occurredAt
      }, ...current.filter((item) => item.id !== result.event._id)].slice(0, 6));
      if (!result.alreadyCheckedIn) setEmployeeCode('');
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Không thể ghi nhận chấm công bằng mã.'
      });
    } finally {
      setSubmittingCode(false);
    }
  };

  const content = <>
      <div className="smart-layout device-layout">
        <section className="smart-scanner-card">
          <div className="scanner-heading">
            <div>
              <p className="card-kicker">TRẠM CHECK-IN</p>
              <h2>Chọn phương thức xác thực</h2>
            </div>
            <span className="scanner-online"><i />Hệ thống sẵn sàng</span>
          </div>

          <div className="method-tabs method-tabs-three">
            <button className={mode === 'face' ? 'active' : ''} onClick={() => changeMode('face')}>
              <Icon name="camera" />Quét khuôn mặt
            </button>
            <button className={mode === 'card' ? 'active' : ''} onClick={() => changeMode('card')}>
              <Icon name="card" />Quẹt thẻ học sinh
            </button>
            <button className={mode === 'employee-code' ? 'active' : ''} onClick={() => changeMode('employee-code')}>
              <Icon name="clock" />Mã nhân viên
            </button>
          </div>

          {mode === 'face' && (
            <div className="face-mode">
              <div className={`camera-frame ${cameraReady ? 'is-live' : ''}`}>
                <video ref={videoRef} autoPlay muted playsInline />
                <div className="camera-overlay">
                  <span className="face-guide" />
                  <p>{cameraReady ? 'Đang chờ nhận diện khuôn mặt' : 'Camera chưa kết nối'}</p>
                </div>
                {!cameraReady && <button className="camera-start" onClick={startCamera}><Icon name="camera" size={19} />Bật camera</button>}
              </div>
              <div className="device-waiting">
                <span><Icon name="camera" size={19} /></span>
                <div><strong>Đang chờ thiết bị nhận diện</strong><p>Khi thiết bị xác thực thành công, hệ thống sẽ tự ghi nhận điểm danh.</p></div>
              </div>
              <p className="scanner-hint"><Icon name="shield" size={15} />Hệ thống chỉ lưu mã hồ sơ, không lưu ảnh khuôn mặt thô.</p>
            </div>
          )}

          {mode === 'card' && (
            <div className="card-mode">
              <div className="card-illustration"><Icon name="card" size={62} /><span className="scan-line" /></div>
              <h3>Sẵn sàng nhận tín hiệu quẹt thẻ</h3>
              <p>Đầu đọc RFID/NFC đã tích hợp sẽ gửi mã thẻ và ghi nhận điểm danh học sinh tự động.</p>
              <div className="device-waiting centered"><span><Icon name="card" size={19} /></span><div><strong>Đang chờ đầu đọc thẻ</strong><p>Không cần nhập mã thẻ trực tiếp trên màn hình này.</p></div></div>
            </div>
          )}

          {mode === 'employee-code' && (
            <div className="kiosk-mode">
              <span className="kiosk-icon"><Icon name="clock" size={30} /></span>
              <p className="card-kicker">DÀNH CHO NHÂN VIÊN</p>
              <h3>Nhập mã chấm công</h3>
              <p>Chỉ dùng khi quẹt thẻ hoặc nhận diện khuôn mặt không khả dụng. Mỗi nhân viên có một mã riêng.</p>
              <form onSubmit={submitEmployeeCode} className="kiosk-code-form">
                <label htmlFor="employee-code">Mã nhân viên</label>
                <div>
                  <input
                    id="employee-code"
                    value={employeeCode}
                    onChange={(event) => setEmployeeCode(event.target.value.toUpperCase())}
                    placeholder="Ví dụ: NV001"
                    autoComplete="off"
                    autoFocus
                    maxLength="50"
                  />
                  <button className="button button-primary" type="submit" disabled={submittingCode}>
                    <Icon name="check" size={17} />{submittingCode ? 'Đang ghi nhận...' : 'Xác nhận check-in'}
                  </button>
                </div>
              </form>
              <p className="scanner-hint"><Icon name="shield" size={15} />Mã được đối chiếu với hồ sơ nhân viên và lưu như một log chấm công bất biến.</p>
            </div>
          )}

          {message && <div className={`scan-message ${message.type}`}><Icon name={message.type === 'success' ? 'check' : 'attendance'} size={17} />{message.text}</div>}
        </section>

        <aside className="scan-activity content-card">
          <div className="activity-heading"><div><p className="card-kicker">PHIÊN LÀM VIỆC NÀY</p><h2>Check-in vừa ghi nhận</h2></div><span>{activity.length}</span></div>
          {activity.length ? <div className="scan-log">{activity.map((item) => <article key={item.id}><span className="student-avatar">{item.name.charAt(0)}</span><div><strong>{item.name}</strong><small>{item.employeeId} · {new Date(item.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small></div><span className={`log-status ${item.duplicate ? 'duplicate' : ''}`}>{item.duplicate ? 'Đã có' : 'Đã ghi'}</span></article>)}</div> : <div className="empty-state"><span className="empty-icon"><Icon name="attendance" /></span><strong>Chưa có lượt check-in</strong><p>Nhập mã nhân viên hoặc chờ thiết bị gửi dữ liệu.</p></div>}
        </aside>
      </div>
      <section className="setup-note"><Icon name="shield" size={19} /><div><strong>Ghi nhận thay thế có kiểm soát</strong><p>Thẻ và khuôn mặt vẫn là nguồn ưu tiên. Nhập mã nhân viên là phương án dự phòng, được lưu tách biệt với nguồn <code>MANUAL_CODE</code> để đối soát.</p></div></section>
  </>;
  return embedded ? content : <AppShell title="Điểm danh tự động" subtitle="Trạm ghi nhận học sinh và chấm công nhân viên bằng thiết bị hoặc mã định danh.">{content}</AppShell>;
}
