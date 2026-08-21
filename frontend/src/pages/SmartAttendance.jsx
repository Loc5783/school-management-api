import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

export default function SmartAttendance() {
  const [mode, setMode] = useState('face');
  const [cameraReady, setCameraReady] = useState(false);
  const [message, setMessage] = useState('');
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
      setMessage('Camera đã sẵn sàng. Thiết bị nhận diện sẽ tự gửi kết quả check-in.');
    } catch (error) {
      console.error(error);
      setMessage('Không thể mở camera. Hãy cấp quyền camera cho trình duyệt hoặc kiểm tra thiết bị.');
    }
  };
  useEffect(() => () => stopCamera(), []);
  const changeMode = (nextMode) => {
    setMode(nextMode);
    setMessage('');
    if (nextMode === 'card') stopCamera();
  };

  return <AppShell title="Điểm danh tự động" subtitle="Trạm nhận diện dành cho thiết bị quét khuôn mặt và đầu đọc thẻ đã tích hợp.">
    <div className="smart-layout device-layout">
      <section className="smart-scanner-card">
        <div className="scanner-heading"><div><p className="card-kicker">TRẠM CHECK-IN</p><h2>Chọn phương thức xác thực</h2></div><span className="scanner-online"><i />Thiết bị sẵn sàng</span></div>
        <div className="method-tabs"><button className={mode === 'face' ? 'active' : ''} onClick={() => changeMode('face')}><Icon name="camera" />Quét khuôn mặt</button><button className={mode === 'card' ? 'active' : ''} onClick={() => changeMode('card')}><Icon name="card" />Quẹt thẻ học sinh</button></div>
        {mode === 'face' ? <div className="face-mode"><div className={`camera-frame ${cameraReady ? 'is-live' : ''}`}><video ref={videoRef} autoPlay muted playsInline /><div className="camera-overlay"><span className="face-guide" /><p>{cameraReady ? 'Đang chờ nhận diện khuôn mặt' : 'Camera chưa kết nối'}</p></div>{!cameraReady && <button className="camera-start" onClick={startCamera}><Icon name="camera" size={19} />Bật camera</button>}</div><div className="device-waiting"><span><Icon name="camera" size={19} /></span><div><strong>Đang chờ thiết bị nhận diện</strong><p>Khi thiết bị xác thực thành công, hệ thống sẽ tự ghi nhận điểm danh.</p></div></div><p className="scanner-hint"><Icon name="shield" size={15} />Chỉ đối chiếu mã hồ sơ do thiết bị gửi về; hệ thống không lưu ảnh khuôn mặt thô.</p></div> : <div className="card-mode"><div className="card-illustration"><Icon name="card" size={62} /><span className="scan-line" /></div><h3>Sẵn sàng nhận tín hiệu quẹt thẻ</h3><p>Đưa thẻ RFID/NFC vào đầu đọc. Đầu đọc đã tích hợp sẽ tự gửi mã thẻ và ghi nhận check-in.</p><div className="device-waiting centered"><span><Icon name="card" size={19} /></span><div><strong>Đang chờ đầu đọc thẻ</strong><p>Không cần nhập mã thẻ bằng tay tại màn hình này.</p></div></div></div>}
        {message && <div className="scan-message info"><Icon name="attendance" size={17} />{message}</div>}
      </section>
      <aside className="scan-activity content-card"><div className="activity-heading"><div><p className="card-kicker">HOẠT ĐỘNG HÔM NAY</p><h2>Check-in vừa ghi nhận</h2></div><span>0</span></div><div className="empty-state"><span className="empty-icon"><Icon name="attendance" /></span><strong>Chờ thiết bị gửi dữ liệu</strong><p>Các lượt check-in từ thiết bị sẽ được lưu trực tiếp vào hệ thống.</p></div></aside>
    </div>
    <section className="setup-note"><Icon name="shield" size={19} /><div><strong>Tích hợp thiết bị</strong><p>Thiết bị cần gọi endpoint <code>POST /api/attendance/check-in</code> với mã định danh đã cấp cho học sinh. Chấm công thủ công của nhân sự được quản lý ở mục riêng trong thanh điều hướng.</p></div></section>
  </AppShell>;
}
