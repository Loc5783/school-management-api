import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { closeKitchenReconciliation, getKitchenReconciliation } from '../api/nutrition';
import './KitchenReconciliationPanel.css';
import { kitchenErrorMessage } from '../utils/kitchenErrorMessage';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shown = (value) => value === null || value === undefined ? '—' : value;
const movementLabels = { export: 'Xuất chế biến', return: 'Hoàn nguyên liệu', spoilage: 'Hủy lô', adjustment: 'Điều chỉnh kiểm kê' };
const mealLabels = { breakfast: 'Bữa sáng', morningSnack: 'Phụ sáng', lunch: 'Bữa trưa', afternoonSnack: 'Phụ chiều' };

export default function KitchenReconciliationPanel({ date, role }) {
  const [report, setReport] = useState(null);
  const [note, setNote] = useState('');
  const [leftover, setLeftover] = useState(0);
  const [disposed, setDisposed] = useState(0);
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const load = useCallback(async () => {
    try {
      const response = await getKitchenReconciliation(date);
      setReport(response.data.data);
      setState((old) => ({ ...old, loading: false, error: '' }));
      return response.data.data;
    } catch (error) {
      setReport(null);
      setState((old) => ({ ...old, loading: false, error: kitchenErrorMessage(error, 'Không cập nhật được đối chiếu cuối ngày.'), notice: '' }));
      throw error;
    }
  }, [date]);

  useEffect(() => {
    let active = true;
    getKitchenReconciliation(date).then((response) => {
      if (active) { setReport(response.data.data); setState((old) => ({ ...old, loading: false, error: '' })); }
    }).catch((error) => {
      if (active) { setReport(null); setState((old) => ({ ...old, loading: false, error: kitchenErrorMessage(error, 'Không tải được đối chiếu cuối ngày.') })); }
    });
    return () => { active = false; };
  }, [date]);

  const close = async () => {
    if (!window.confirm(`Chốt báo cáo bếp ngày ${date}? Số liệu suất ăn sẽ không thể sửa sau khi chốt.`)) return;
    setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try {
      const response = await closeKitchenReconciliation({ date, note, leftoverCookedCount: Number(leftover), disposedCookedCount: Number(disposed) });
      setReport((old) => old ? { ...old, closing: response.data.data } : old);
      setState((old) => ({ ...old, saving: false, notice: 'Đã chốt đối chiếu cuối ngày.' }));
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: kitchenErrorMessage(error, 'Không thể chốt ngày. Vui lòng kiểm tra lại.'), notice: '' }));
    }
  };

  return <section className="content-card kitchen-reconciliation">
    <div className="chef-section-heading"><div><p className="card-kicker">ĐỐI CHIẾU CUỐI NGÀY</p><h2>Suất ăn &amp; sổ kho</h2></div><button type="button" className="button button-secondary" disabled={state.loading || state.saving} onClick={() => { setState((old) => ({ ...old, loading: true, error: '' })); load().catch(() => {}); }}>Làm mới</button></div>
    {state.loading && <p className="chef-empty">Đang tải đối chiếu...</p>}
    {state.error && <p className="kr-error" role="alert">{state.error}</p>}
    {state.notice && <p className="kr-success" role="status">{state.notice}</p>}
    {report && <>
      {report.closing && <div className="kr-closed"><strong>Đã chốt lúc {new Date(report.closing.closedAt).toLocaleString('vi-VN')}</strong><span>Suất nấu chưa giao còn lại: {report.closing.leftoverCookedCount} · Đã hủy: {report.closing.disposedCookedCount}</span><span>Ghi chú bàn giao: {report.closing.note || 'Không có'}</span></div>}
      <p className="kr-hint">Kế hoạch lấy từ điểm danh hiện tại; số đã nấu, giao và lớp nhận lấy từ sổ giao suất. {report.closing ? 'Bản chốt bên dưới lưu số liệu tại thời điểm chốt.' : 'Chỉ chốt khi các lớp đã hoàn tất xác nhận.'}</p>
      {!report.closing && report.safety?.length > 0 && <div className="kr-safety">{report.safety.map((meal) => <span key={meal.mealType} className={meal.ready && !meal.allergyConflicts ? 'is-ready' : 'is-pending'}>{mealLabels[meal.mealType] || meal.mealType}: {meal.allergyConflicts ? `${meal.allergyConflicts} xung đột dị ứng` : meal.ready ? 'đã kiểm thực' : 'chưa hoàn tất kiểm thực'}</span>)}</div>}
      <div className="kr-scroll"><table><thead><tr><th>Lớp</th><th>Theo điểm danh</th><th>Đã nấu</th><th>Đã giao</th><th>Lớp nhận</th><th>Ghi chú chênh lệch</th></tr></thead><tbody>{(report.closing?.rows || report.rows).map((row) => <tr key={row.classroomId} className={row.cooked !== null && row.cooked !== undefined && (row.planned !== row.cooked || row.cooked !== row.delivered || row.delivered !== row.received) ? 'kr-variance' : ''}><td>{row.className}</td><td>{row.planned}</td><td>{shown(row.cooked)}</td><td>{shown(row.delivered)}</td><td>{shown(row.received)}</td><td>{row.notes?.map((entry) => entry.note).join('; ') || (row.cooked === null && row.planned === 0 ? 'Không có suất' : '—')}</td></tr>)}</tbody></table></div>
      <div className="kr-stock">
        <div className="chef-section-heading"><div><p className="card-kicker">PHÁT SINH SỔ KHO</p><h3>Nguyên liệu ghi sổ trong ngày</h3></div><Link className="button button-secondary" to="/nutrition?tab=inventory">Xem phiếu kho</Link></div>
        <p className="kr-hint">Xuất, hoàn trả, hủy lô và điều chỉnh kiểm kê theo thời điểm ghi sổ; không phải số suất ăn thừa. Giá trị điều chỉnh có thể âm hoặc dương.</p>
        <div className="kr-scroll"><table><thead><tr><th>Nguyên liệu</th><th>Xuất</th><th>Hoàn trả</th><th>Hủy lô</th><th>Điều chỉnh</th></tr></thead><tbody>{(report.closing?.stockMovements || report.stockMovements).map((item) => <tr key={`${item.ingredientId}-${item.unit}`}><td>{item.ingredientName}</td><td>{item.exported} {item.unit}</td><td>{item.returned} {item.unit}</td><td>{item.spoiled} {item.unit}</td><td>{item.adjusted || 0} {item.unit}</td></tr>)}</tbody></table>{!(report.closing?.stockMovements || report.stockMovements).length && <p className="chef-empty">Chưa có phát sinh xuất, hoàn, hủy hoặc điều chỉnh nguyên liệu trong ngày.</p>}</div>
        {(report.closing?.stockTransactions || report.stockTransactions)?.length > 0 && <details className="kr-transactions"><summary>Đối chiếu từng phiếu và lô ({(report.closing?.stockTransactions || report.stockTransactions).length})</summary><div className="kr-scroll"><table><thead><tr><th>Thời điểm</th><th>Loại phiếu</th><th>Nguyên liệu</th><th>Số lượng</th><th>Lô / phiếu nguồn</th><th>Lý do</th></tr></thead><tbody>{(report.closing?.stockTransactions || report.stockTransactions).map((item) => <tr key={item.transactionId}><td>{new Date(item.createdAt).toLocaleString('vi-VN')}</td><td>{movementLabels[item.type] || item.type}</td><td>{item.ingredientName}</td><td>{item.quantity} {item.unit}</td><td>{item.lotAllocations?.map((lot) => `${lot.batchNumber}: ${lot.quantity} ${lot.unit}`).join('; ') || item.batchNumber || '—'}{item.sourceExportTransactionId && <small className="kr-source">Hoàn từ phiếu {item.sourceExportTransactionId}</small>}</td><td>{item.reason || '—'}</td></tr>)}</tbody></table></div></details>}
      </div>
      {!report.closing && <div className="kr-footer">{report.blockers.length > 0 && <div className="kr-blockers" role="status"><strong>Chưa thể chốt:</strong><ul>{report.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}<p className="kr-hint">Có {Math.max(0, report.totals.cooked - report.totals.delivered)} suất đã nấu nhưng chưa giao lớp. Ghi số suất còn lại và số suất thực tế đã hủy; đây không phải phiếu hoàn nguyên liệu.</p><div className="kr-counts"><label>Suất nấu còn lại<input type="number" min="0" step="1" value={leftover} onChange={(event) => setLeftover(event.target.value)} /></label><label>Suất nấu đã hủy<input type="number" min="0" step="1" value={disposed} onChange={(event) => setDisposed(event.target.value)} /></label></div>{(leftover === '' || disposed === '' || Number(leftover) + Number(disposed) !== report.totals.cooked - report.totals.delivered) && <p className="kr-error" role="status">Tổng suất còn lại và đã hủy phải đúng bằng số suất nấu chưa giao.</p>}<label htmlFor="kr-note">Ghi chú bàn giao {report.hasVariance || Number(disposed) > 0 ? '(bắt buộc vì có chênh lệch/hủy suất)' : '(nếu có)'}</label><textarea id="kr-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="Nêu nguyên nhân chênh lệch, suất còn lại và cách xử lý thực tế..." /><button type="button" className="button button-primary" disabled={role !== 'chef' || date !== today() || state.saving || report.blockers.length > 0 || ((report.hasVariance || Number(disposed) > 0) && !note.trim()) || leftover === '' || disposed === '' || !Number.isSafeInteger(Number(leftover)) || !Number.isSafeInteger(Number(disposed)) || Number(leftover) < 0 || Number(disposed) < 0 || Number(leftover) + Number(disposed) !== report.totals.cooked - report.totals.delivered} onClick={close}>{state.saving ? 'Đang chốt...' : 'Chốt & bàn giao ngày'}</button>{date !== today() && <small>Chỉ chốt được ngày phục vụ hiện tại.</small>}</div>}
    </>}
  </section>;
}
