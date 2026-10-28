import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import {
  downloadFeeScheduleTemplate,
  previewFeeScheduleImport,
  confirmFeeScheduleImport,
  downloadInvoiceTemplate,
  previewInvoiceImport,
  confirmInvoiceImport
} from '../api/finance';

const money = (val) => `${new Intl.NumberFormat('vi-VN').format(Number(val) || 0)} đ`;

export default function FinanceExcelImportModal({
  isOpen,
  onClose,
  type = 'invoice', // 'invoice' | 'fee_schedule'
  period = '',
  onSuccess
}) {
  const isInvoice = type === 'invoice';
  const modalTitle = isInvoice ? 'Nhập hóa đơn học phí từ Excel' : 'Nhập mức thu học phí từ Excel';
  const modalKicker = isInvoice ? 'HÓA ĐƠN HỌC PHÍ (CHƯA THU)' : 'THIẾT LẬP MỨC THU';

  const [selectedPeriod, setSelectedPeriod] = useState(period || '');
  const [file, setFile] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [filterView, setFilterView] = useState('all'); // 'all' | 'errors' | 'valid'
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

    const timer = setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else if (modalRef.current) {
        modalRef.current.focus();
      }
    }, 50);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      clearTimeout(timer);
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // 1. Tải mẫu Excel
  const handleDownloadTemplate = async () => {
    if (downloading) return;
    setDownloading(true);
    setError('');
    try {
      if (isInvoice) {
        await downloadInvoiceTemplate();
      } else {
        await downloadFeeScheduleTemplate();
      }
    } catch (err) {
      setError(err.message || 'Không thể tải file mẫu Excel. Vui lòng thử lại.');
    } finally {
      setDownloading(false);
    }
  };

  // 2. Chọn file
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith('.xlsx')) {
      setError('Vui lòng chọn tệp tin định dạng Excel (.xlsx).');
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setError('Dung lượng tệp tin vượt quá giới hạn cho phép (tối đa 5 MB).');
      return;
    }

    setFile(selected);
    setError('');
    setPreviewData(null);
    setSuccessResult(null);
    setPreviewPage(1);

    // Kích hoạt xem trước ngay khi chọn file
    handlePreview(selected);
  };

  // 3. Xem trước file
  const handlePreview = async (fileToPreview) => {
    const targetFile = fileToPreview || file;
    if (!targetFile) {
      setError('Vui lòng chọn file Excel.');
      return;
    }

    setPreviewing(true);
    setError('');
    setPreviewData(null);

    const formData = new FormData();
    formData.append('file', targetFile);
    if (selectedPeriod) formData.append('defaultPeriod', selectedPeriod);

    try {
      const res = isInvoice
        ? await previewInvoiceImport(formData)
        : await previewFeeScheduleImport(formData);

      setPreviewData(res.data);
      setPreviewPage(1);
      // Tạo một Idempotency-Key ổn định cho một lần xem trước thành công
      setImportKey(crypto.randomUUID());
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Không thể đọc và kiểm tra file Excel.');
    } finally {
      setPreviewing(false);
    }
  };

  // 4. Xác nhận import vào hệ thống
  const handleConfirm = async () => {
    if (!previewData || !previewData.canImport || confirming) return;

    setConfirming(true);
    setError('');

    const keyToSend = importKey || crypto.randomUUID();

    try {
      const payload = {
        rows: previewData.rows.map(r => ({
          ...r,
          dueDate: r.dueDate,
          dueDateStr: r.dueDateStr
        })),
        period: selectedPeriod,
        previewToken: previewData.previewToken
      };

      const res = isInvoice
        ? await confirmInvoiceImport(payload, keyToSend)
        : await confirmFeeScheduleImport(payload, keyToSend);

      setSuccessResult(res.data);
    } catch (err) {
      setError(err.response?.data?.message || (err.request ? 'Chưa nhận được phản hồi từ máy chủ. Giữ nguyên màn hình và bấm thử lại; hệ thống dùng cùng mã yêu cầu để tránh ghi lặp.' : 'Không thể lưu dữ liệu vào hệ thống. Vui lòng thử lại.'));
    } finally {
      setConfirming(false);
    }
  };

  // Lọc danh sách dòng xem trước
  const allRows = previewData?.rows || [];
  const filteredRows = allRows.filter((row) => {
    if (filterView === 'errors') return !row.isValid;
    if (filterView === 'valid') return row.isValid;
    return true;
  });

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE) || 1;
  const paginatedRows = filteredRows.slice((previewPage - 1) * PAGE_SIZE, previewPage * PAGE_SIZE);

  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!confirming && !previewing) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="content-card student-form modal-card modal-large student-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finance-excel-import-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '1000px', width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header Modal */}
        <div className="card-heading" style={{ borderBottom: '1px solid #E2E8F0', paddingBottom: '14px', marginBottom: '16px' }}>
          <div>
            <p className="card-kicker">{modalKicker}</p>
            <h2 id="finance-excel-import-title" style={{ fontSize: '1.25rem', margin: '4px 0' }}>{modalTitle}</h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748B' }}>
              {isInvoice
                ? 'Hóa đơn nhập từ Excel sẽ ở trạng thái CHƯA THU (unpaid). Hệ thống tự tính tổng tiền, đối chiếu học sinh đang học và chống ghi đè.'
                : 'Mức thu nhập từ Excel giúp cấu hình học phí theo lớp/kỳ. Không tự ý ghi đè các mức thu đã tồn tại.'}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={confirming || previewing}
            aria-label="Đóng cửa sổ"
          >
            Đóng
          </button>
        </div>

        {/* Thông báo lỗi */}
        {error && (
          <div className="form-error" role="alert" style={{ marginBottom: '16px' }}>
            <Icon name="alertTriangle" size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Bước 1: Nếu chưa có kết quả thành công, hiển thị form tải & xem trước */}
        {!successResult ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              {/* Chọn kỳ thu */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px' }}>
                  Kỳ thu mặc định (MM-YYYY)
                </label>
                <input
                  type="text"
                  value={selectedPeriod}
                  onChange={(e) => {
                    setSelectedPeriod(e.target.value);
                    setPreviewData(null);
                  }}
                  placeholder="Ví dụ: 10-2026"
                  disabled={confirming || previewing}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: '6px' }}
                />
              </div>

              {/* Tải file mẫu */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px' }}>
                  Tập tin mẫu chuẩn
                </label>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleDownloadTemplate}
                  disabled={downloading || confirming}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Icon name="download" size={16} />
                  <span>{downloading ? 'Đang tải mẫu...' : 'Tải file Excel mẫu (.xlsx)'}</span>
                </button>
              </div>

              {/* Chọn file upload */}
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px' }}>
                  Chọn file dữ liệu
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileChange}
                  disabled={confirming || previewing}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={confirming || previewing}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Icon name="upload" size={16} />
                  <span>{file ? file.name : 'Chọn file Excel (.xlsx)...'}</span>
                </button>
              </div>
            </div>

            {/* Trạng thái đang đọc file */}
            {previewing && (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <span className="loading-orb" />
                <p style={{ marginTop: '10px', color: '#64748B' }}>Đang giải nén an toàn và kiểm tra từng dòng dữ liệu...</p>
              </div>
            )}

            {/* Bảng xem trước dữ liệu */}
            {previewData && !previewing && (
              <div style={{ marginTop: '16px' }}>
                {/* Thanh thống kê tóm tắt */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '14px', background: '#F8FAFC', padding: '12px 16px', borderRadius: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Tổng số dòng: </span>
                    <strong>{previewData.totalRows}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.875rem', color: '#16A34A' }}>Hợp lệ: </span>
                    <strong style={{ color: '#16A34A' }}>{previewData.validRows}</strong>
                  </div>
                  {previewData.invalidRows > 0 && (
                    <div>
                      <span style={{ fontSize: '0.875rem', color: '#DC2626' }}>Lỗi dữ liệu: </span>
                      <strong style={{ color: '#DC2626' }}>{previewData.invalidRows}</strong>
                    </div>
                  )}
                  {previewData.conflictRows > 0 && (
                    <div>
                      <span style={{ fontSize: '0.875rem', color: '#D97706' }}>Xung đột / Đã có: </span>
                      <strong style={{ color: '#D97706' }}>{previewData.conflictRows}</strong>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto' }}>
                    <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Tổng dự kiến: </span>
                    <strong style={{ color: '#1E3A8A', fontSize: '1.05rem' }}>{money(previewData.totalEstimatedAmount)}</strong>
                  </div>
                </div>

                {/* Bộ lọc xem: Tất cả / Chỉ lỗi / Chỉ hợp lệ */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div className="timekeeping-hub-tabs" style={{ margin: 0, padding: 0 }}>
                    <button
                      type="button"
                      className={filterView === 'all' ? 'active' : ''}
                      onClick={() => { setFilterView('all'); setPreviewPage(1); }}
                    >
                      Tất cả ({allRows.length})
                    </button>
                    <button
                      type="button"
                      className={filterView === 'errors' ? 'active' : ''}
                      onClick={() => { setFilterView('errors'); setPreviewPage(1); }}
                    >
                      Dòng có lỗi ({previewData.invalidRows + previewData.conflictRows})
                    </button>
                    <button
                      type="button"
                      className={filterView === 'valid' ? 'active' : ''}
                      onClick={() => { setFilterView('valid'); setPreviewPage(1); }}
                    >
                      Hợp lệ ({previewData.validRows})
                    </button>
                  </div>
                  <span style={{ fontSize: '0.875rem', color: '#64748B' }}>
                    Trang {previewPage}/{totalPages}
                  </span>
                </div>

                {/* Bảng dữ liệu preview */}
                <div className="table-wrap" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px', textAlign: 'center' }}>Dòng</th>
                        {isInvoice ? (
                          <>
                            <th>Mã học sinh</th>
                            <th>Họ và tên</th>
                            <th>Lớp</th>
                          </>
                        ) : (
                          <th>Phạm vi áp dụng</th>
                        )}
                        <th>Kỳ thu</th>
                        <th>Học phí chính</th>
                        <th>Hạn TT</th>
                        <th>Tổng tiền</th>
                        <th>Trạng thái kiểm tra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRows.map((row) => (
                        <tr key={row.rowNumber} style={{ background: row.isValid ? 'inherit' : '#FEF2F2' }}>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.rowNumber}</td>
                          {isInvoice ? (
                            <>
                              <td><code>{row.studentCode}</code></td>
                              <td>{row.studentName || row.inputName || '—'}</td>
                              <td>{row.className || row.inputClass || '—'}</td>
                            </>
                          ) : (
                            <td><strong>{row.classroomName}</strong></td>
                          )}
                          <td style={{ textAlign: 'center' }}>{row.period}</td>
                          <td style={{ textAlign: 'right' }}>{money(row.tuitionBase)}</td>
                          <td style={{ textAlign: 'center' }}>{row.dueDateStr || row.dueDate || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {money(isInvoice ? row.totalAmount : row.estimatedTotal)}
                          </td>
                          <td>
                            {row.isValid ? (
                              <span style={{ color: '#16A34A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="check" size={14} /> Hợp lệ
                              </span>
                            ) : (
                              <div style={{ color: '#DC2626', fontSize: '0.8125rem' }}>
                                {row.errors.map((err, errIdx) => (
                                  <div key={errIdx}>• {err}</div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!paginatedRows.length && (
                        <tr>
                          <td colSpan={isInvoice ? 8 : 6} className="history-empty">
                            Không có dòng nào phù hợp bộ lọc.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Phân trang bảng preview */}
                {totalPages > 1 && (
                  <div style={{ marginTop: '10px' }}>
                    <StudentPagination
                      page={previewPage}
                      totalPages={totalPages}
                      onPageChange={setPreviewPage}
                      limit={PAGE_SIZE}
                      total={filteredRows.length}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Footer hành động */}
            <div className="form-actions" style={{ marginTop: '20px', borderTop: '1px solid #E2E8F0', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="button button-secondary"
                onClick={onClose}
                disabled={confirming || previewing}
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                className="button button-primary"
                onClick={handleConfirm}
                disabled={!previewData || !previewData.canImport || confirming || previewing}
                style={{ minWidth: '180px' }}
              >
                {confirming ? (
                  <span>
                    <span className="loading-orb" style={{ marginRight: '6px' }} />
                    Đang lưu vào hệ thống...
                  </span>
                ) : (
                  `Xác nhận nhập ${previewData ? previewData.validRows : 0} ${isInvoice ? 'hóa đơn' : 'mức thu'}`
                )}
              </button>
            </div>
          </>
        ) : (
          /* Bước 2: Hiển thị kết quả thành công */
          <div style={{ textAlign: 'center', padding: '30px 20px' }}>
            <div style={{ color: '#16A34A', marginBottom: '12px' }}>
              <Icon name="check" size={48} />
            </div>
            <h3 style={{ fontSize: '1.25rem', color: '#0F172A', marginBottom: '8px' }}>
              Nhập dữ liệu thành công!
            </h3>
            <p style={{ color: '#475569', marginBottom: '24px' }}>
              {successResult.message || `Đã lưu thành công dữ liệu ${isInvoice ? 'hóa đơn học phí' : 'mức thu'} vào hệ thống.`}
            </p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                onSuccess?.(successResult);
                onClose();
              }}
              style={{ minWidth: '160px' }}
            >
              Hoàn tất & Mở danh sách
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
