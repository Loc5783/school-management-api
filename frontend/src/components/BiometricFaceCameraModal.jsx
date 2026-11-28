import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { compressFaceImageUnder200KB } from '../utils/facePhotoCompressor';

/**
 * Modal Chụp Ảnh Khuôn Mặt Chấm Công trực tiếp từ Webcam máy tính / Camera điện thoại (Trước/Sau)
 * hoặc chọn ảnh từ thiết bị, tự động cắt khung vuông & nén chuẩn Hikvision (< 200KB JPG).
 */
export default function BiometricFaceCameraModal({
  target,
  onClose,
  onConfirmSave
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [facingMode, setFacingMode] = useState('user');
  const [cameraError, setCameraError] = useState('');
  const [startingCamera, setStartingCamera] = useState(true);
  const [capturedInfo, setCapturedInfo] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCameraStream = useCallback(
    async (mode) => {
      stopCameraStream();
      setCameraError('');
      setStartingCamera(true);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStartingCamera(false);
        setCameraError(
          'Trình duyệt hiện tại không cho phép mở trực tiếp Webcam (hoặc đang chạy qua HTTP không có SSL). Bạn vẫn có thể bấm "Chọn Ảnh / Camera Điện Thoại" bên dưới để chụp và nén tự động < 200KB!'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 720 },
            height: { ideal: 720 }
          },
          audio: false
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setCameraError(
          `Không thể mở trực tiếp luồng Camera (${err?.message || 'Chưa cấp quyền Camera'}). Hãy bấm nút "Chọn Ảnh / Camera Điện Thoại" bên dưới.`
        );
      } finally {
        setStartingCamera(false);
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) {
        void startCameraStream('user');
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      stopCameraStream();
    };
  }, [startCameraStream, stopCameraStream]);

  const handleSwitchCamera = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    void startCameraStream(nextMode);
  };

  const processRawBlobOrFile = async (rawBlob, sourceType = 'CAMERA') => {
    setProcessing(true);
    setLocalError('');
    try {
      const compressed = await compressFaceImageUnder200KB(
        rawBlob,
        `${target?.personCode || 'person'}_${sourceType.toLowerCase()}.jpg`
      );
      setCapturedInfo({
        ...compressed,
        source: sourceType
      });
      stopCameraStream();
    } catch (err) {
      setLocalError(err?.message || 'Không thể xử lý và nén ảnh khuôn mặt.');
    } finally {
      setProcessing(false);
    }
  };

  const handleCaptureFromVideo = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setLocalError('Camera chưa sẵn sàng. Vui lòng chờ giây lát hoặc chọn file ảnh.');
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const size = Math.min(vw, vh);
    const sx = Math.round((vw - size) / 2);
    const sy = Math.round((vh - size) / 2);

    const canvas = document.createElement('canvas');
    const targetDim = Math.min(640, size);
    canvas.width = targetDim;
    canvas.height = targetDim;

    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') {
      ctx.translate(targetDim, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, size, size, 0, 0, targetDim, targetDim);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          void processRawBlobOrFile(blob, 'CAMERA');
        }
      },
      'image/jpeg',
      0.92
    );
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    void processRawBlobOrFile(file, 'UPLOAD');
  };

  const handleRetake = () => {
    setCapturedInfo(null);
    setLocalError('');
    void startCameraStream(facingMode);
  };

  const handleSave = async () => {
    if (!capturedInfo?.dataUrl || saving) return;
    setSaving(true);
    setLocalError('');
    try {
      await onConfirmSave(capturedInfo);
      onClose();
    } catch (err) {
      setLocalError(err?.response?.data?.message || err?.message || 'Lỗi khi lưu ảnh khuôn mặt chấm công');
    } finally {
      setSaving(false);
    }
  };

  if (!target) return null;

  return createPortal(
    <div className="hik-modal-backdrop" onClick={onClose} role="presentation">
      <div className="hik-camera-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hik-camera-header">
          <div className="hik-camera-title-wrap">
            <div className="hik-camera-icon-box">
              <Icon name="camera" size={20} />
            </div>
            <div>
              <h3>Chụp & Nén Ảnh Quét Mặt Chấm Công (&lt; 200KB)</h3>
              <p>
                {target.subjectType === 'STUDENT' ? 'Học sinh' : 'Nhân sự'}:{' '}
                <strong>{target.fullName}</strong> ({target.personCode} • {target.campus})
              </p>
            </div>
          </div>
          <button type="button" className="hik-icon-close" onClick={onClose} aria-label="Đóng">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="hik-camera-body">
          <div className="hik-camera-tip">
            <Icon name="shield" size={16} />
            <div>
              <strong>Tự động tối ưu chuẩn Hikvision (&lt; 200 KB):</strong> Ảnh chụp từ Camera hoặc tải lên dù nặng 5MB – 15MB đều được tự động cắt chân dung và nén xuống <strong>dưới 200 KB (JPG)</strong>, tách biệt hoàn toàn với Avatar hiển thị trên Web.
            </div>
          </div>

          {localError && (
            <div className="hik-alert hik-alert-error">
              <Icon name="alertTriangle" size={15} />
              <span>{localError}</span>
            </div>
          )}

          <div className="hik-camera-viewport">
            {capturedInfo ? (
              <>
                <img src={capturedInfo.dataUrl} alt="Ảnh khuôn mặt đã nén" className="hik-camera-preview-img" />
                <div className="hik-camera-size-bar">
                  <span>
                    Dung lượng sau nén: <strong>{capturedInfo.compressedSizeKB} KB</strong>
                    {capturedInfo.originalSizeKB > capturedInfo.compressedSizeKB
                      ? ` (Gốc: ${capturedInfo.originalSizeKB} KB)`
                      : ''}
                  </span>
                  <span className="hik-camera-pass-pill">Đạt chuẩn &lt; 200KB</span>
                </div>
              </>
            ) : cameraError ? (
              <div className="hik-camera-fallback">
                <Icon name="alertTriangle" size={32} />
                <p>{cameraError}</p>
                {target.faceDataUrl && (
                  <div className="hik-camera-existing">
                    <span>Ảnh quét mặt hiện tại:</span>
                    <img src={target.faceDataUrl} alt={target.fullName} />
                  </div>
                )}
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`hik-camera-video ${facingMode === 'user' ? 'mirrored' : ''}`}
                />
                <div className="hik-camera-oval-guide">
                  <div className="hik-oval-ring" />
                  <span>Đặt khuôn mặt nhìn thẳng vào trong khung oval</span>
                </div>
                {startingCamera && (
                  <div className="hik-camera-overlay">
                    <span className="loading-orb" />
                    <span>Đang khởi động Camera...</span>
                  </div>
                )}
              </>
            )}

            {processing && (
              <div className="hik-camera-overlay">
                <span className="loading-orb" />
                <span>Đang tự động nén ảnh xuống dưới 200KB...</span>
              </div>
            )}
          </div>

          {!capturedInfo ? (
            <div className="hik-camera-footer">
              <div className="hik-camera-left-btns">
                {!cameraError && (
                  <button type="button" className="hik-btn hik-btn-neutral" onClick={handleSwitchCamera}>
                    <Icon name="refresh" size={14} /> Đổi Cam Trước/Sau
                  </button>
                )}
                <label className="hik-btn hik-btn-soft-indigo">
                  <Icon name="upload" size={14} /> Chọn Ảnh / Camera ĐT
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    hidden
                    onChange={handleFileInputChange}
                  />
                </label>
              </div>

              {!cameraError && (
                <button
                  type="button"
                  className="hik-btn hik-btn-indigo"
                  disabled={startingCamera || processing}
                  onClick={handleCaptureFromVideo}
                >
                  <Icon name="camera" size={15} /> Chụp Ảnh Ngay
                </button>
              )}
            </div>
          ) : (
            <div className="hik-camera-footer">
              <button type="button" className="hik-btn hik-btn-neutral" disabled={saving} onClick={handleRetake}>
                <Icon name="refresh" size={14} /> Chụp lại / Chọn ảnh khác
              </button>
              <button type="button" className="hik-btn hik-btn-emerald" disabled={saving} onClick={handleSave}>
                <Icon name="check" size={15} />
                {saving ? 'Đang lưu ảnh chuẩn Hikvision...' : `Lưu Ảnh Mặt (${capturedInfo.compressedSizeKB} KB)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

