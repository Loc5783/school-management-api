import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QRCodeImage({ value, size = 150, label = 'Mã QR' }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let active = true;
    if (!value) { Promise.resolve().then(() => { if (active) setSrc(''); }); return () => { active = false; }; }
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setSrc(url); })
      .catch(() => { if (active) setSrc(''); });
    return () => { active = false; };
  }, [size, value]);

  return src ? <img className="qr-code-image" src={src} width={size} height={size} alt={label} /> : null;
}
