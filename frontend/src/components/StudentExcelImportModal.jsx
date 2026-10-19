import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import { downloadExcelTemplate, previewExcelImport, confirmExcelImport } from '../api/students';

export default function StudentExcelImportModal({ isOpen, onClose, defaultClassroomId, classrooms = [], onSuccess }) {
  const [prevDefaultClassroomId, setPrevDefaultClassroomId] = useState(defaultClassroomId);
  const [selectedClassId, setSelectedClassId] = useState(
    () => defaultClassroomId || (classrooms.length === 1 ? classrooms[0]._id : '')
  );

  if (prevDefaultClassroomId !== defaultClassroomId) {
    setPrevDefaultClassroomId(defaultClassroomId);
    if (defaultClassroomId) {
      setSelectedClassId(defaultClassroomId);
    } else if (classrooms.length === 1) {
      setSelectedClassId(classrooms[0]._id);
    }
  }

  const [file, setFile] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [error, setError] = useState('');
  const [successResult, setSuccessResult] = useState(null);
  const [importKey, setImportKey] = useState('');

  const fileInputRef = useRef(null);
  const modalRef = useRef(null);
  const triggerRef = useRef(null);

  const onCloseRef = useRef(onClose);
  const confirmingRef = useRef(confirming);
  const previewingRef = useRef(previewing);

  useEffect(() => {
    onCloseRef.current = onClose;
    confirmingRef.current = confirming;
    previewingRef.current = previewing;
  });

  // Focus trap hoàn chỉnh và quản lý phím Escape
  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusableElements = () => {
      if (!modalRef.current) return [];
      return Array.from(
        modalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!confirmingRef.current && !previewingRef.current) {
          onCloseRef.current?.();
        }
        return;
      }

      if (e.key === 'Tab') {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl || !modalRef.current?.contains(document.activeElement)) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl || !modalRef.current?.contains(document.activeElement)) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Focus vào phần tử tương tác đầu tiên hoặc modal card
    const timer = setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        modalRef.current?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    };
  }, [isOpen]);

  const handleDownloadTemplate = async () => {
    try {
      setDownloading(true);
      setError('');
      const res = await downloadExcelTemplate();
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Mau_Nhap_Hoc_Sinh_Hoa_Nang.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Lỗi tải template:', err);
      setError(err.response?.data?.message || 'Không thể tải file mẫu. Vui lòng thử lại sau.');
    } finally {
      setDownloading(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.toLowerCase().endsWith('.xlsx')) {
      setError('Chỉ chấp nhận tập tin định dạng Excel (.xlsx).');
      setFile(null);
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setError('Kích thước tập tin vượt quá 5 MB.');
      setFile(null);
      return;
    }

    setFile(selected);
    setError('');
    setPreviewData(null);
    setSuccessResult(null);
  };

  const handleUploadAndPreview = async () => {
    if (!selectedClassId) {
      setError('Vui lòng chọn lớp học tiếp nhận dữ liệu trước khi tải lên.');
      return;
    }
    if (!file) {
      setError('Vui lòng chọn tập tin Excel (.xlsx) để tải lên.');
      return;
    }

    setPreviewing(true);
    setError('');
    setPreviewData(null);
    setPreviewPage(1);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('classroomId', selectedClassId);

      const res = await previewExcelImport(formData);
      setPreviewData(res.data.data);
      const stableKey = `import-${selectedClassId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setImportKey(stableKey);
    } catch (err) {
      console.error('Lỗi xem trước import:', err);
      setError(err.response?.data?.message || 'Không thể đọc và phân tích tập tin Excel.');
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!previewData || !previewData.canImport || previewData.capacityExceeded) {
      setError(previewData?.capacityWarning || 'Dữ liệu chưa sẵn sàng hoặc còn lỗi. Vui lòng kiểm tra lại.');
      return;
    }

    setConfirming(true);
    setError('');

    try {
      const activeKey = importKey || `import-${selectedClassId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (!importKey) {
        setImportKey(activeKey);
      }
      const payload = {
        classroomId: selectedClassId,
        students: previewData.rows
      };

      const res = await confirmExcelImport(payload, activeKey);
      setSuccessResult(res.data);
      if (typeof onSuccess === 'function') {
        onSuccess(res.data.data, selectedClassId);
      }
    } catch (err) {
      console.error('Lỗi xác nhận import:', err);
      setError(err.response?.data?.message || 'Không thể lưu học sinh vào hệ thống.');
    } finally {
      setConfirming(false);
    }
  };

  const resetImport = () => {
    setFile(null);
    setPreviewData(null);
    setSuccessResult(null);
    setImportKey('');
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  const currentClass = classrooms.find(c => String(c._id) === String(selectedClassId));
  const previewRows = previewData?.rows || [];
  const pageSize = 10;
  const currentPreviewRows = previewRows.slice((previewPage - 1) * pageSize, previewPage * pageSize);

  return createPortal(
    <div className="account-modal-backdrop" role="presentation" onClick={(e) => {
      if (e.target === e.currentTarget && !confirming && !previewing) onClose();
    }}>
      <div
        className="account-modal-card student-excel-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-excel-modal-title"
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="account-modal-header">
          <div>
            <p className="card-kicker">NHẬP DỮ LIỆU HÀNG LOẠT</p>
            <h2 id="import-excel-modal-title">Nhập danh sách học sinh từ Excel</h2>
          </div>
          <button
            type="button"
            className="mobile-nav-close"
            onClick={onClose}
            disabled={confirming || previewing}
            aria-label="Đóng cửa sổ"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="excel-import-modal-body">
          {error && (
            <div className="timekeeping-notice error" role="alert">
              <Icon name="alertCircle" size={17} />
              <span>{error}</span>
            </div>
          )}

          {successResult ? (
            <div className="excel-import-success-box">
              <div className="success-icon-wrap">
                <Icon name="check" size={32} />
              </div>
              <h3>{successResult.message}</h3>
              <p>
                Đã thêm <strong>{successResult.data?.length || 0}</strong> học sinh vào lớp{' '}
                <strong>{currentClass?.name || 'đã chọn'}</strong>.
              </p>
              <div className="success-students-list">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>STT</th>
                        <th>Mã học sinh</th>
                        <th>Họ và tên</th>
                        <th>Giới tính</th>
                        <th>Ngày sinh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {successResult.data?.map((s, idx) => (
                        <tr key={s._id || idx}>
                          <td>{idx + 1}</td>
                          <td><strong>{s.studentCode}</strong></td>
                          <td>{s.fullName}</td>
                          <td>{s.gender === 'female' ? 'Nữ' : 'Nam'}</td>
                          <td>{s.birthDate ? new Date(s.birthDate).toLocaleDateString('vi-VN') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={onClose}
                >
                  Xem danh sách học sinh
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={resetImport}
                >
                  Nhập thêm file khác
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Bước 1: Chọn lớp và tải file mẫu */}
              <section className="excel-import-step-card">
                <div className="step-title-row">
                  <span className="step-badge">Bước 1</span>
                  <h4>Chọn lớp học và tải file Excel mẫu</h4>
                </div>
                <div className="step-content-grid">
                  <label className="import-field">
                    <span>Lớp học tiếp nhận (*)</span>
                    <select
                      value={selectedClassId}
                      onChange={(e) => {
                        setSelectedClassId(e.target.value);
                        setPreviewData(null);
                        setError('');
                      }}
                      disabled={previewing || confirming}
                      required
                    >
                      <option value="">-- Chọn lớp tiếp nhận học sinh --</option>
                      {classrooms.map((cls) => (
                        <option key={cls._id} value={cls._id}>
                          {cls.name} {cls.fullName ? `(${cls.fullName})` : ''} - Hiện có {cls.statistics?.currentStudents || 0}/{cls.maxSize || 25} HS
                        </option>
                      ))}
                    </select>
                    {!classrooms.length && (
                      <small className="field-hint text-danger">
                        Bạn chưa được phân công lớp học nào đang hoạt động.
                      </small>
                    )}
                  </label>

                  <div className="import-field download-action">
                    <span>Mẫu Excel chuẩn</span>
                    <button
                      type="button"
                      className="button button-secondary download-template-btn"
                      onClick={handleDownloadTemplate}
                      disabled={downloading}
                    >
                      <Icon name="calendar" size={16} />
                      {downloading ? 'Đang tải mẫu...' : 'Tải file Excel mẫu (.xlsx)'}
                    </button>
                    <small className="field-hint">
                      File mẫu có sẵn dropdown giới tính và sheet hướng dẫn điền chi tiết.
                    </small>
                  </div>
                </div>
              </section>

              {/* Bước 2: Chọn file và xem trước */}
              <section className="excel-import-step-card">
                <div className="step-title-row">
                  <span className="step-badge">Bước 2</span>
                  <h4>Chọn file Excel đã điền và kiểm tra dữ liệu</h4>
                </div>
                <div className="step-upload-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    id="excel-file-upload-input"
                    disabled={previewing || confirming}
                  />
                  <label htmlFor="excel-file-upload-input" className="button button-secondary upload-btn">
                    <Icon name="search" size={16} />
                    {file ? 'Chọn file khác' : 'Chọn file Excel (.xlsx)'}
                  </label>
                  {file && (
                    <span className="selected-file-info">
                      <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  )}
                  <button
                    type="button"
                    className="button button-primary check-file-btn"
                    onClick={handleUploadAndPreview}
                    disabled={!file || !selectedClassId || previewing || confirming}
                  >
                    {previewing ? 'Đang kiểm tra...' : 'Kiểm tra & Xem trước'}
                  </button>
                </div>
              </section>

              {/* Bước 3: Bảng xem trước dữ liệu và đối chiếu lỗi */}
              {previewData && (
                <section className="excel-import-preview-section">
                  <div className="preview-summary-bar">
                    <div className="summary-tags">
                      <span className="summary-item total">
                        Tổng số: <strong>{previewData.totalRows}</strong> dòng
                      </span>
                      <span className="summary-item valid">
                        Hợp lệ: <strong>{previewData.totalValid}</strong>
                      </span>
                      {previewData.totalErrors > 0 && (
                        <span className="summary-item error">
                          Lỗi: <strong>{previewData.totalErrors}</strong>
                        </span>
                      )}
                    </div>
                    {previewData.capacityWarning && (
                      <div className={`preview-capacity-alert ${previewData.capacityExceeded ? 'capacity-exceeded' : ''}`}>
                        <Icon name="alertCircle" size={16} />
                        <span>{previewData.capacityWarning} {previewData.capacityExceeded ? '(Không thể nhập khi vượt quá sĩ số)' : ''}</span>
                      </div>
                    )}
                  </div>

                  <div className="preview-table-wrap">
                    <table className="data-table preview-table">
                      <thead>
                        <tr>
                          <th>Dòng</th>
                          <th>Họ và tên</th>
                          <th>Ngày sinh</th>
                          <th>Giới tính</th>
                          <th>Địa chỉ</th>
                          <th>Quốc tịch / Dân tộc</th>
                          <th>Trạng thái kiểm tra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentPreviewRows.map((row) => (
                          <tr key={row.rowNumber} className={row.isValid ? 'row-valid' : 'row-invalid'}>
                            <td><strong>{row.rowNumber}</strong></td>
                            <td><strong>{row.fullName || '—'}</strong></td>
                            <td>{row.birthDateFormatted || '—'}</td>
                            <td>{row.genderText || '—'}</td>
                            <td>{row.address || '—'}</td>
                            <td>{row.nationality || 'Việt Nam'} {row.ethnicity ? `· ${row.ethnicity}` : ''}</td>
                            <td>
                              {row.isValid ? (
                                <span className="badge badge-success">
                                  <Icon name="check" size={14} /> Hợp lệ
                                </span>
                              ) : (
                                <div className="row-error-list">
                                  {row.errors.map((err, errIdx) => (
                                    <span key={errIdx} className="badge badge-danger">
                                      ⚠ {err}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <StudentPagination
                    total={previewRows.length}
                    page={previewPage}
                    pageSize={pageSize}
                    onChange={setPreviewPage}
                  />

                  {/* Nút xác nhận lưu */}
                  <div className="preview-confirm-footer">
                    <div className="policy-notice">
                      <Icon name="shield" size={16} />
                      <span>
                        Chính sách nhập nguyên khối: Toàn bộ danh sách chỉ được lưu vào hệ thống khi tất cả dòng đều hợp lệ và không có nghi trùng.
                      </span>
                    </div>
                    <div className="footer-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={resetImport}
                        disabled={confirming}
                      >
                        Hủy / Chọn file khác
                      </button>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={handleConfirmImport}
                        disabled={!previewData.canImport || previewData.capacityExceeded || confirming}
                        title={
                          previewData.capacityExceeded
                            ? previewData.capacityWarning
                            : !previewData.canImport
                            ? 'Vui lòng sửa các dòng lỗi trong file Excel trước khi lưu'
                            : ''
                        }
                      >
                        {confirming ? 'Đang lưu vào hệ thống...' : `Xác nhận nhập ${previewData.totalValid} học sinh`}
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
