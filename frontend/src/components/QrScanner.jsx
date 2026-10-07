import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export default function QrScanner({ onResult, disabled = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState('');

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const submit = (value) => {
    const code = String(value || '').trim();
    if (!code || disabled) return;
    stopCamera(); setManualCode(''); setError(''); onResult(code);
  };

  const startCamera = async () => {
    setError('');
    if (!('BarcodeDetector' in window)) return setError('Trình duyệt chưa hỗ trợ quét QR trực tiếp. Bạn vẫn có thể nhập mã bên dưới.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      setCameraActive(true);
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) submit(codes[0].rawValue); } catch { /* camera frame not ready */ }
      }, 450);
    } catch { setError('Không mở được camera. Hãy cấp quyền camera hoặc nhập mã thủ công.'); stopCamera(); }
  };

  return <div className="guard-qr-scanner">
    <div className={`guard-camera-frame ${cameraActive ? 'active' : ''}`}><video ref={videoRef} muted playsInline /><span><Icon name="camera" size={26} />Đưa mã QR vào giữa khung</span></div>
    <div className="guard-qr-actions"><button type="button" className="button button-secondary" disabled={disabled} onClick={cameraActive ? stopCamera : startCamera}><Icon name="camera" size={16} />{cameraActive ? 'Dừng camera' : 'Mở camera quét QR'}</button></div>
    <form onSubmit={(event) => { event.preventDefault(); submit(manualCode); }}><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Hoặc nhập mã QR / mã thẻ" /><button className="button button-primary" disabled={disabled || !manualCode.trim()}>Kiểm tra mã</button></form>
    {error && <small className="guard-qr-error">{error}</small>}
  </div>;
}
