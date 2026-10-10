import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHrAudit, getHrAuditOptions, getHrAuditEntry } from '../api/hr';
import './HrAuditJournal.css';

const operations = { read: 'Xem dữ liệu', change: 'Thay đổi', export: 'Xuất báo cáo', blocked: 'Bị giới hạn' };
const time = (value) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
const valueText = (value) => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export default function HrAuditJournal() {
  const [options, setOptions] = useState({ categories: [], permissions: [] });
  const [draft, setDraft] = useState({ fromDate: '', toDate: '', category: '', operation: '' });
  const [query, setQuery] = useState({ page: 1 });
  const [data, setData] = useState({ rows: [], total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null);
  useEffect(() => { let alive = true; getHrAuditOptions().then((res) => { if (alive) setOptions(res.data.data); }).catch(() => { if (alive) setError('Không thể tải quyền dữ liệu.'); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    getHrAudit(query, controller.signal).then((res) => { setData(res.data.data); setError(''); }).catch((err) => { if (!controller.signal.aborted) setError(err.response?.data?.message || 'Không thể tải nhật ký.'); });
    return () => controller.abort();
  }, [query]);
  useEffect(() => {
    if (!entry) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = (event) => { if (event.key === 'Escape') setEntry(null); };
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); };
  }, [entry]);
  const detail = async (row) => {
    setBusy(true);
    try { const res = await getHrAuditEntry(row.source, row._id); setEntry(res.data.data); }
    catch (err) { setError(err.response?.data?.message || 'Không thể tải chi tiết.'); }
    finally { setBusy(false); }
  };
  return <section className="hr-journal">
    <header><small>KIỂM SOÁT DỮ LIỆU NHÂN SỰ</small><h2>Nhật ký thao tác & quyền dữ liệu</h2><p>Lượt xem được ghi từ khi triển khai chức năng. Lịch sử thay đổi có sẵn được tổng hợp từ các quy trình HR, công và lương.</p></header>
    <form className="hr-journal-filters" onSubmit={(event) => { event.preventDefault(); setQuery({ ...draft, page: 1 }); }}>
      {['fromDate', 'toDate'].map((key) => <label key={key}>{key === 'fromDate' ? 'Từ ngày' : 'Đến ngày'}<input type="date" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
      <label>Nhóm dữ liệu<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option value="">Tất cả nhóm được phép</option>{options.categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Thao tác<select value={draft.operation} onChange={(event) => setDraft({ ...draft, operation: event.target.value })}><option value="">Tất cả thao tác</option>{Object.entries(operations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="btn-primary" type="submit">Tra cứu</button>
    </form>
    {error && <p role="alert" className="hr-journal-error">{error}</p>}
    <div className="hr-journal-table"><table><thead><tr><th>Thời điểm</th><th>Người thao tác</th><th>Thao tác / dữ liệu</th><th>Nội dung</th><th>Chi tiết</th></tr></thead><tbody>
      {data.rows.map((row) => <tr key={`${row.source}-${row._id}`}><td>{time(row.occurredAt)}</td><td><strong>{row.actorName}</strong><small>{row.actorRole}</small></td><td>{operations[row.operation]}<small>{options.categories.find((item) => item.value === row.category)?.label || row.category}</small></td><td>{row.targetLabel || row.targetType}<small>{row.action || row.route}</small><small>{row.changes.join(', ') || (row.operation === 'blocked' ? 'Không cung cấp dữ liệu' : `${row.recordIds?.length || 0} mã bản ghi liên quan`)}</small></td><td><button type="button" className="btn-secondary" disabled={busy} onClick={() => detail(row)}>Xem</button></td></tr>)}
      {!data.rows.length && <tr><td colSpan={5}>Không có nhật ký trong bộ lọc này.</td></tr>}
    </tbody></table></div>
    <footer><span>{data.total} bản ghi · Trang {query.page}/{Math.max(1, Math.ceil(data.total / 10))}</span><button className="btn-secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Trang trước</button><button className="btn-secondary" disabled={query.page * 10 >= data.total} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Trang sau</button></footer>
    <details><summary>Phạm vi quyền xem dữ liệu</summary>{options.permissions.map((item) => <p key={item.role}><strong>{item.role}: </strong>{item.scope}</p>)}<p>Nhật ký chỉ cho tra cứu, không có nút sửa / xóa. Mật khẩu, token và dữ liệu sinh trắc không xuất hiện; số định danh và tài khoản ngân hàng được che trong nội dung thay đổi.</p></details>
    {entry && createPortal(<div className="hr-journal-overlay" onClick={() => setEntry(null)}><section role="dialog" aria-modal="true" aria-labelledby="hr-journal-title" onClick={(event) => event.stopPropagation()}><header><h2 id="hr-journal-title">Chi tiết nhật ký</h2><button className="btn-secondary" autoFocus onClick={() => setEntry(null)}>Đóng</button></header><p><strong>{entry.actorName}</strong> · {entry.actorRole} · {time(entry.occurredAt)}</p><p>{operations[entry.operation]} · {entry.action || entry.route}</p><p>{entry.reason || entry.targetLabel}</p>{entry.targetId && <p>Mã đối tượng: {String(entry.targetId)}</p>}
      {entry.changes.length ? <div className="hr-journal-table"><table><thead><tr><th>Trường thay đổi</th><th>Trước</th><th>Sau</th></tr></thead><tbody>{entry.changes.map((item) => <tr key={item.field}><td>{item.field}</td><td>{valueText(item.before)}</td><td>{valueText(item.after)}</td></tr>)}</tbody></table></div> : <><p>Kết quả: {entry.result} · Phạm vi: {entry.scope || 'Quy trình được phân quyền'}</p><p>Mã bản ghi liên quan: {(entry.recordIds || []).join(', ') || 'Không có'}</p><p>Bộ lọc: {valueText(entry.filters || {})}</p></>}
    </section></div>, document.body)}
  </section>;
}
