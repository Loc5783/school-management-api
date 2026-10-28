/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StaffPersonalRequests from '../components/StaffPersonalRequests';
import {
  generatePayroll,
  getPayroll,
  updatePayrollAdjustment,
  reopenConfirmedPayroll,
  updatePayrollStatus
} from '../api/hr';
import { exportPayroll } from '../api/finance';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(value || 0)} đ`;
const currentMonth = new Date().getMonth() + 1;
const currentYear = new Date().getFullYear();
const schoolToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const statusText = {
  draft: 'HR đã lập nháp',
  reviewed: 'Kế toán đã đối soát',
  confirmed: 'Hiệu trưởng đã duyệt',
  paid: 'Đã chi trả'
};
const positionText = {
  principal: 'Hiệu trưởng', vice_principal: 'Phó hiệu trưởng', teacher: 'Giáo viên',
  head_teacher: 'Tổ trưởng chuyên môn', assistant_teacher: 'Trợ giảng',
  accountant: 'Kế toán', chef: 'Nhân viên bếp', hr: 'Nhân sự (HR)', security: 'Bảo vệ'
};
const payrollRoleText = {
  principal: 'Hiệu trưởng', teacher: 'Giáo viên', accountant: 'Kế toán', chef: 'Nhân viên bếp', guard: 'Bảo vệ', hr: 'Nhân sự (HR)'
};

export default function PayrollManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'sheets';
  const [tab, setTab] = useState(['sheets', 'adjustments', 'approvals', 'payment', 'requests'].includes(initialTab) ? initialTab : 'sheets');

  const [payrolls, setPayrolls] = useState([]);
  const [payrollSummary, setPayrollSummary] = useState({ totalEmployees: 0, totalNet: 0, byRole: [] });
  const [period, setPeriod] = useState({ month: currentMonth, year: currentYear });
  const [successNotice, setSuccessNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const [adjustingPayroll, setAdjustingPayroll] = useState(null);
  const [reopeningPayroll, setReopeningPayroll] = useState(null);
  const [payingPayroll, setPayingPayroll] = useState(null);
  const [payForm, setPayForm] = useState({ paymentMethod: 'bank_transfer', paymentReference: '', paidDate: schoolToday() });
  const [payError, setPayError] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [adjustmentForm, setAdjustmentForm] = useState({ bonus: 0, advancePayment: 0, otherDeduction: 0, insurance: 0, insuranceBasisNote: '', insuranceConfirmed: false, note: '' });
  const [exportingPayroll, setExportingPayroll] = useState(false);

  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const role = currentUser.role || '';
  const canConfirm = ['admin', 'principal'].includes(role);
  const canReview = ['admin', 'accountant'].includes(role);
  const canOperateHr = ['admin', 'hr'].includes(role);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setSuccessNotice('');
    setErrorMessage('');
    try {
      const response = await getPayroll(period);
      setPayrolls(response.data.data.payrolls || []);
      setPayrollSummary(response.data.data.summary || { totalEmployees: 0, totalNet: 0, byRole: [] });
    } catch (err) {
      setErrorMessage(err.response?.data?.message || err.message || 'Không thể tải bảng lương.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  const changeTab = (next) => {
    setTab(next);
    setSearchParams({ tab: next });
  };

  const handleExportPayroll = async () => {
    if (exportingPayroll) return;
    setExportingPayroll(true);
    setSuccessNotice('');
    setErrorMessage('');
    try {
      await exportPayroll(period);
      setSuccessNotice(`Đã xuất file Excel bảng lương tháng ${period.month}/${period.year} thành công.`);
    } catch (err) {
      setErrorMessage(err.message || err.response?.data?.message || 'Không thể xuất file Excel bảng lương.');
    } finally {
      setExportingPayroll(false);
    }
  };

  const calculatePayroll = async () => {
    setSuccessNotice('');
    setErrorMessage('');
    try {
      await generatePayroll(period);
      await loadPayroll();
      setSuccessNotice(`Đã tổng hợp bảng lương tháng ${period.month}/${period.year}.`);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || err.message || 'Không thể tổng hợp bảng lương.');
    }
  };

  const handleUpdateStatus = async (payrollId, status) => {
    setSuccessNotice('');
    setErrorMessage('');
    try {
      await updatePayrollStatus(payrollId, { status });
      await loadPayroll();
      setSuccessNotice(`Đã chuyển trạng thái phiếu lương sang: ${statusText[status] || status}`);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || err.message || 'Không thể cập nhật trạng thái phiếu lương.');
    }
  };

  const submitPayPayroll = async (event) => {
    event.preventDefault();
    if (!payingPayroll) return;
    setPaySaving(true);
    setPayError('');
    setSuccessNotice('');
    setErrorMessage('');
    try {
      await updatePayrollStatus(payingPayroll._id, {
        status: 'paid',
        paymentMethod: payForm.paymentMethod,
        paymentReference: payForm.paymentReference.trim(),
        paidDate: payForm.paidDate
      });
      setPayingPayroll(null);
      await loadPayroll();
      setSuccessNotice('Đã ghi nhận chi trả lương thành công.');
    } catch (err) {
      setPayError(err.response?.data?.message || err.message || 'Không thể ghi nhận chi trả.');
    } finally {
      setPaySaving(false);
    }
  };

  const openPayrollAdjustment = (item) => {
    setAdjustingPayroll(item);
    setAdjustmentForm({
      bonus: item.allowances?.other || 0,
      advancePayment: item.deductions?.advancePayment || 0,
      otherDeduction: item.deductions?.other || 0,
      insurance: item.deductions?.insurance || 0,
      insuranceBasisNote: item.insuranceBasisNote || '',
      insuranceConfirmed: Boolean(item.insuranceConfirmed),
      note: item.note || ''
    });
  };

  const saveAdjustment = async (event) => {
    event.preventDefault();
    try {
      await updatePayrollAdjustment(adjustingPayroll._id, {
        allowances: { other: Number(adjustmentForm.bonus) || 0 },
        deductions: {
          insurance: Number(adjustmentForm.insurance) || 0,
          advancePayment: Number(adjustmentForm.advancePayment) || 0,
          other: Number(adjustmentForm.otherDeduction) || 0
        },
        insuranceBasisNote: adjustmentForm.insuranceBasisNote,
        insuranceConfirmed: adjustmentForm.insuranceConfirmed,
        note: adjustmentForm.note
      });
      setAdjustingPayroll(null);
      await loadPayroll();
      setSuccessNotice('Đã cập nhật điều chỉnh và tính lại thực lĩnh.');
    } catch (err) {
      setErrorMessage(err.response?.data?.message || err.message || 'Không thể điều chỉnh bảng lương.');
    }
  };

  const submitReopen = async (event) => {
    event.preventDefault();
    setSuccessNotice('');
    setErrorMessage('');
    try {
      const res = await reopenConfirmedPayroll(reopeningPayroll._id, { reason: reopenReason.trim() });
      setReopeningPayroll(null);
      setReopenReason('');
      setReopenError('');
      await loadPayroll();
      setSuccessNotice(res.data?.message || 'Đã mở lại phiếu lương thành công.');
    } catch (err) {
      setReopenError(err.response?.data?.message || err.message || 'Không thể mở lại phiếu lương.');
    }
  };

  return (
    <AppShell
      title="Quản lý Lương & Chi trả"
      subtitle="Bảng tính lương, điều chỉnh phụ cấp - khấu trừ, quy trình phê duyệt 3 bước và ghi nhận chi trả."
    >
      <section className="hr-workspace">
        {errorMessage && <div className="form-error" role="alert">{errorMessage}</div>}
        {successNotice && <div className="timekeeping-notice success" role="status">{successNotice}</div>}

        {/* Top Summary Bar */}
        <div className="hr-summary">
          <article>
            <span><Icon name="users" size={19} /></span>
            <div>
              <small>NHÂN VIÊN ĐƯỢC TÍNH LƯƠNG</small>
              <strong>{payrollSummary.totalEmployees || payrolls.length} người</strong>
            </div>
          </article>
          <article>
            <span><Icon name="money" size={19} /></span>
            <div>
              <small>TỔNG THỰC LĨNH THÁNG {period.month}/{period.year}</small>
              <strong style={{ color: '#166534' }}>{money(payrollSummary.totalNet)}</strong>
            </div>
          </article>
          <article>
            <span><Icon name="chart" size={19} /></span>
            <div>
              <small>TRẠNG THÁI TRÌNH DUYỆT</small>
              <strong>
                {payrolls.filter((p) => p.status === 'confirmed').length} duyệt · {payrolls.filter((p) => p.status === 'paid').length} đã chi
              </strong>
            </div>
          </article>
        </div>

        {/* Tab Navigation for Payroll */}
        <section className="content-card timekeeping-hub">
          <div className="timekeeping-hub-tabs">
            <button className={tab === 'sheets' ? 'active' : ''} onClick={() => changeTab('sheets')}>
              <Icon name="money" size={16} /> Bảng tính lương
            </button>
            <button className={tab === 'adjustments' ? 'active' : ''} onClick={() => changeTab('adjustments')}>
              <Icon name="settings" size={16} /> Khoản điều chỉnh & BHXH
            </button>
            <button className={tab === 'approvals' ? 'active' : ''} onClick={() => changeTab('approvals')}>
              <Icon name="check" size={16} /> Trình duyệt & Phê duyệt
            </button>
            <button className={tab === 'payment' ? 'active' : ''} onClick={() => changeTab('payment')}>
              <Icon name="card" size={16} /> Trạng thái chi trả
            </button>
            <button className={tab === 'requests' ? 'active' : ''} onClick={() => changeTab('requests')}>
              <Icon name="chat" size={16} /> Phản hồi phiếu lương
            </button>
          </div>
        </section>

        {/* Tab Content: Sheets */}
        {(tab === 'sheets' || tab === 'adjustments' || tab === 'approvals' || tab === 'payment') && (
          <section className="content-card student-list-card">
            <div className="list-toolbar" style={{ flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <p className="card-kicker">KỲ LƯƠNG NHÀ TRƯỜNG</p>
                <h2>
                  Bảng lương Tháng {period.month}/{period.year}
                </h2>
                <p>Quy trình: HR lập bảng lương nháp ➔ Kế toán đối soát ➔ Hiệu trưởng duyệt ➔ Kế toán chi trả.</p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={period.month}
                  onChange={(e) => setPeriod((p) => ({ ...p, month: Number(e.target.value) }))}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>Tháng {m}</option>
                  ))}
                </select>
                <select
                  value={period.year}
                  onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                    <option key={y} value={y}>Năm {y}</option>
                  ))}
                </select>

                {canOperateHr && (
                  <button className="button button-primary" onClick={calculatePayroll}>
                    <Icon name="clock" size={15} /> Tính lương tháng này
                  </button>
                )}

                <button
                  className="button button-secondary"
                  disabled={exportingPayroll || payrolls.length === 0}
                  onClick={handleExportPayroll}
                >
                  <Icon name="download" size={15} /> {exportingPayroll ? 'Đang xuất...' : 'Xuất Excel'}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="inline-loader" style={{ padding: '30px', textAlign: 'center' }}>
                Đang tải dữ liệu bảng lương...
              </div>
            ) : payrolls.length === 0 ? (
              <div className="empty-state" style={{ padding: '30px' }}>
                Chưa có dữ liệu bảng lương cho tháng {period.month}/{period.year}.
                {canOperateHr && (
                  <div style={{ marginTop: '12px' }}>
                    <button className="button button-primary" onClick={calculatePayroll}>
                      Khởi tạo bảng lương tháng {period.month}/{period.year}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>NHÂN VIÊN</th>
                      <th>VAI TRÒ / CHỨC DANH</th>
                      <th>CÔNG CHUẨN / THỰC</th>
                      <th>LƯƠNG CƠ BẢN</th>
                      <th>PHỤ CẤP / THƯỞNG</th>
                      <th>KHẤU TRỪ / BHXH</th>
                      <th>THỰC LĨNH</th>
                      <th>TRẠNG THÁI</th>
                      <th>THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrolls.map((p) => {
                      const totalAllowances = (p.allowances?.position || 0) + (p.allowances?.overtime || 0) + (p.allowances?.meal || 0) + (p.allowances?.other || 0);
                      const totalDeductions = (p.deductions?.insurance || 0) + (p.deductions?.advancePayment || 0) + (p.deductions?.other || 0);
                      return (
                        <tr key={p._id}>
                          <td>
                            <strong>{p.employeeId?.fullName || 'Nhân viên'}</strong>
                            <small>{p.employeeId?.employeeCode || '—'}</small>
                          </td>
                          <td>
                            <span className="account-role-badge">
                              {payrollRoleText[p.payrollRole] || p.payrollRole}
                            </span>
                            <small style={{ display: 'block' }}>{positionText[p.employeeId?.position] || p.employeeId?.position}</small>
                          </td>
                          <td>
                            <strong>{p.actualWorkDays || 0}</strong> / {p.standardWorkDays || 26} công
                          </td>
                          <td>
                            <strong>{money(p.baseSalary)}</strong>
                          </td>
                          <td>
                            <span style={{ color: '#166534', fontWeight: 600 }}>+{money(totalAllowances)}</span>
                          </td>
                          <td>
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>-{money(totalDeductions)}</span>
                          </td>
                          <td>
                            <strong style={{ color: '#1e3a8a', fontSize: '14px' }}>{money(p.netSalary)}</strong>
                          </td>
                          <td>
                            <span className={`student-status ${p.status === 'paid' ? 'enrolled' : p.status === 'confirmed' ? 'enrolled' : 'temporarily_absent'}`}>
                              {statusText[p.status] || p.status}
                            </span>
                          </td>
                          <td>
                            <div className="classroom-actions">
                              {/* Tab: adjustments allows editing */}
                              {tab === 'adjustments' && p.status !== 'confirmed' && p.status !== 'paid' && (
                                <button className="button button-secondary" onClick={() => openPayrollAdjustment(p)}>
                                  Điều chỉnh
                                </button>
                              )}

                              {/* Tab: approvals controls 3-step workflow */}
                              {tab === 'approvals' && (
                                <>
                                  {p.status === 'draft' && canReview && (
                                    <button className="button button-primary" onClick={() => handleUpdateStatus(p._id, 'reviewed')}>
                                      Đối soát OK
                                    </button>
                                  )}
                                  {p.status === 'reviewed' && canConfirm && (
                                    <button className="button button-primary" onClick={() => handleUpdateStatus(p._id, 'confirmed')}>
                                      Duyệt phiếu
                                    </button>
                                  )}
                                  {p.status === 'confirmed' && canConfirm && (
                                    <button className="button button-danger" onClick={() => setReopeningPayroll(p)}>
                                      Mở lại
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Tab: payment records payment */}
                              {tab === 'payment' && (
                                <>
                                  {p.status === 'confirmed' && canReview && (
                                    <button className="button button-primary" onClick={() => setPayingPayroll(p)}>
                                      Chi trả
                                    </button>
                                  )}
                                  {p.status === 'paid' && (
                                    <small style={{ color: '#166534', fontWeight: 700 }}>✓ Đã thanh toán</small>
                                  )}
                                </>
                              )}

                              {/* Default sheets view */}
                              {tab === 'sheets' && (
                                <button className="button button-secondary" onClick={() => openPayrollAdjustment(p)}>
                                  Xem chi tiết
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab Content: Requests */}
        {tab === 'requests' && <StaffPersonalRequests mode="manage" />}

        {/* Modal: Adjustments */}
        {adjustingPayroll && (
          <div className="modal-backdrop">
            <form className="content-card student-form hr-modal" onSubmit={saveAdjustment}>
              <div className="card-heading">
                <div>
                  <p className="card-kicker">ĐIỀU CHỈNH PHIẾU LƯƠNG</p>
                  <h2>{adjustingPayroll.employeeId?.fullName}</h2>
                  <p>Tháng {period.month}/{period.year} · Thực lĩnh dự kiến: {money(adjustingPayroll.netSalary)}</p>
                </div>
                <button type="button" className="button button-secondary" onClick={() => setAdjustingPayroll(null)}>Đóng</button>
              </div>

              <div className="student-form-grid">
                <label>
                  Thưởng / Phụ cấp khác (VND)
                  <input
                    type="number"
                    min="0"
                    step="10000"
                    value={adjustmentForm.bonus}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, bonus: e.target.value })}
                  />
                </label>

                <label>
                  Tạm ứng lương đã nhận (VND)
                  <input
                    type="number"
                    min="0"
                    step="10000"
                    value={adjustmentForm.advancePayment}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, advancePayment: e.target.value })}
                  />
                </label>

                <label>
                  Khấu trừ bảo hiểm (BHXH, BHYT) (VND)
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={adjustmentForm.insurance}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, insurance: e.target.value })}
                  />
                </label>

                <label>
                  Khấu trừ khác (VND)
                  <input
                    type="number"
                    min="0"
                    step="1000"
                    value={adjustmentForm.otherDeduction}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, otherDeduction: e.target.value })}
                  />
                </label>

                <label className="form-wide">
                  Ghi chú điều chỉnh
                  <textarea
                    rows={2}
                    maxLength={300}
                    value={adjustmentForm.note}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, note: e.target.value })}
                    placeholder="Giải thích lý do thưởng hoặc khấu trừ..."
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" className="button button-primary">Lưu điều chỉnh</button>
              </div>
            </form>
          </div>
        )}

        {/* Modal: Pay Salary */}
        {payingPayroll && (
          <div className="modal-backdrop">
            <form className="content-card student-form hr-modal" onSubmit={submitPayPayroll}>
              <div className="card-heading">
                <div>
                  <p className="card-kicker">GHI NHẬN CHI TRẢ LƯƠNG</p>
                  <h2>{payingPayroll.employeeId?.fullName}</h2>
                  <p>Số tiền thực chi: <strong>{money(payingPayroll.netSalary)}</strong></p>
                </div>
                <button type="button" className="button button-secondary" onClick={() => setPayingPayroll(null)}>Đóng</button>
              </div>

              {payError && <div className="form-error" role="alert">{payError}</div>}

              <div className="student-form-grid">
                <label>
                  Phương thức thanh toán
                  <select
                    value={payForm.paymentMethod}
                    onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
                  >
                    <option value="bank_transfer">Chuyển khoản ngân hàng</option>
                    <option value="cash">Tiền mặt</option>
                  </select>
                </label>

                <label>
                  Ngày chi trả
                  <input
                    type="date"
                    required
                    value={payForm.paidDate}
                    onChange={(e) => setPayForm({ ...payForm, paidDate: e.target.value })}
                  />
                </label>

                <label className="form-wide">
                  Mã giao dịch / Tham chiếu chuyển khoản
                  <input
                    type="text"
                    maxLength={100}
                    placeholder="VD: FT261023948293 hoặc Số phiếu chi tiền mặt..."
                    value={payForm.paymentReference}
                    onChange={(e) => setPayForm({ ...payForm, paymentReference: e.target.value })}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" className="button button-primary" disabled={paySaving}>
                  {paySaving ? 'Đang lưu...' : 'Xác nhận đã thanh toán'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Modal: Reopen Payroll */}
        {reopeningPayroll && (
          <div className="modal-backdrop">
            <form className="content-card student-form hr-modal" onSubmit={submitReopen}>
              <div className="card-heading">
                <div>
                  <p className="card-kicker">MỞ LẠI PHIẾU LƯƠNG</p>
                  <h2>Mở lại phiếu lương đã duyệt</h2>
                  <p>Nhân viên: {reopeningPayroll.employeeId?.fullName}</p>
                </div>
                <button type="button" className="button button-secondary" onClick={() => setReopeningPayroll(null)}>Đóng</button>
              </div>

              {reopenError && <div className="form-error" role="alert">{reopenError}</div>}

              <label className="form-wide" style={{ padding: '0 20px' }}>
                Lý do mở lại (bắt buộc)
                <textarea
                  required
                  rows={3}
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Nhập lý do cần mở lại để đối soát hoặc tính lại công..."
                />
              </label>

              <div className="form-actions">
                <button type="submit" className="button button-danger">Xác nhận mở lại</button>
              </div>
            </form>
          </div>
        )}
      </section>
    </AppShell>
  );
}
