import { useCallback, useEffect, useState } from 'react';
import {
  confirmReceivedServings, getDailyServingPlan, getMealServingOperations,
  recordCookedServings, recordDeliveredServings
} from '../api/nutrition';
import './MealServingOperations.css';
import { kitchenErrorMessage } from '../utils/kitchenErrorMessage';

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

export default function MealServingOperations({ role, date: providedDate, classes: providedClasses }) {
  const [ownDate, setOwnDate] = useState(today);
  const date = providedDate || ownDate;
  const [classes, setClasses] = useState([]);
  const [records, setRecords] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const canEdit = date === today();

  const load = useCallback(async () => {
    const [operations, plan] = await Promise.all([
      getMealServingOperations(date),
      providedClasses ? Promise.resolve(null) : getDailyServingPlan(date)
    ]);
    setRecords(operations.data.data || []);
    setClasses(providedClasses || plan.data.data?.classBreakdown || []);
    setState((old) => ({ ...old, loading: false, error: '' }));
  }, [date, providedClasses]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((error) => setState((old) => ({ ...old, loading: false, error: kitchenErrorMessage(error, 'Không tải được sổ giao suất ăn.') })));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeDraft = (classroomId, patch) => setDrafts((old) => ({ ...old, [classroomId]: { ...old[classroomId], ...patch } }));
  const submit = async (classroomId, action, defaultCount) => {
    const draft = drafts[classroomId] || {};
    const count = draft.count === undefined ? defaultCount : Number(draft.count);
    if (draft.count === '' || !Number.isSafeInteger(count) || count < 0) {
      setState((old) => ({ ...old, error: 'Số suất phải là số nguyên không âm; không được để trống.', notice: '' }));
      return;
    }
    const payload = { date, count, note: String(draft.note || '').trim() };
    setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try {
      if (action === 'cooked') await recordCookedServings(classroomId, payload);
      if (action === 'delivered') await recordDeliveredServings(classroomId, payload);
      if (action === 'received') await confirmReceivedServings(classroomId, payload);
      setDrafts((old) => ({ ...old, [classroomId]: {} }));
      setState((old) => ({ ...old, loading: true, saving: false, notice: 'Đã lưu số suất. Đang tải lại sổ giao.' }));
      load().catch(() => setState((old) => ({ ...old, loading: false, error: 'Đã lưu số suất, nhưng chưa tải lại được sổ. Hãy mở lại trang trước khi thao tác tiếp.', notice: '' })));
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: kitchenErrorMessage(error, 'Không thể lưu số suất.'), notice: '' }));
    }
  };

  return <section className="content-card meal-serving-operations">
    <div className="meal-serving-heading"><div><p className="card-kicker">SỔ GIAO SUẤT ĂN</p><h2>{role === 'teacher' ? 'Xác nhận suất lớp đã nhận' : 'Nấu và giao suất theo lớp'}</h2><p>Đối chiếu điểm danh → số suất nấu → số suất giao → số lớp nhận. Mọi lần ghi nhận được lưu lịch sử.</p></div>{!providedDate && <label>Ngày phục vụ<input type="date" value={ownDate} onChange={(event) => { setOwnDate(event.target.value); setState((old) => ({ ...old, loading: true, error: '', notice: '' })); }} /></label>}</div>
    {state.error && <div className="form-error" role="alert">{state.error}</div>}
    {state.notice && <div className="timekeeping-notice success" role="status">{state.notice}</div>}
    {state.loading ? <p className="meal-serving-empty">Đang tải sổ giao suất...</p> : <div className="meal-serving-list">{classes.map((classroom) => {
      const id = String(classroom.classroomId);
      const record = records.find((item) => String(item.classroomId) === id);
      const action = role === 'chef' ? record?.deliveredAt ? '' : drafts[id]?.mode || (record ? 'delivered' : 'cooked') : role === 'teacher' && record?.deliveredAt && !record?.receivedAt ? 'received' : '';
      const suggested = action === 'cooked' ? classroom.recommendedServings : action === 'delivered' ? record.cookedCount : record?.deliveredCount;
      const draft = drafts[id] || {};
      return <article key={id}>
        <div className="meal-serving-class"><div><strong>{classroom.className}</strong><small>{classroom.unmarkedCount > 0 ? `Còn ${classroom.unmarkedCount} trẻ chưa điểm danh` : 'Đã điểm danh đủ'}</small></div><span>{record?.receivedAt ? 'Lớp đã xác nhận' : record?.deliveredAt ? 'Đợi lớp xác nhận' : record ? 'Đã nấu, chờ giao' : 'Chưa ghi nhận nấu'}</span></div>
        <div className="meal-serving-counts"><div><small>Điểm danh hiện tại</small><strong>{classroom.recommendedServings}</strong></div><div><small>Đã nấu</small><strong>{record?.cookedCount ?? '—'}</strong></div><div><small>Đã giao</small><strong>{record?.deliveredCount ?? '—'}</strong></div><div><small>Lớp đã nhận</small><strong>{record?.receivedCount ?? '—'}</strong></div></div>
        {record?.plannedAtCook !== undefined && record.plannedAtCook !== classroom.recommendedServings && <p className="meal-serving-change">Điểm danh đã thay đổi: khi bếp ghi nấu là {record.plannedAtCook} suất, hiện là {classroom.recommendedServings} suất. Cần đối chiếu trước khi giao.</p>}
        {record?.history?.length > 0 && <details><summary>Xem lịch sử ({record.history.length})</summary><ul>{record.history.map((entry, index) => <li key={index}>{new Date(entry.at).toLocaleString('vi-VN')} · {{ cooked: 'Bếp ghi nấu', delivered: 'Bếp giao lớp', received: 'Lớp xác nhận' }[entry.action]} {entry.count} suất{entry.note ? ` · ${entry.note}` : ''}</li>)}</ul></details>}
        {role === 'chef' && canEdit && record && !record.deliveredAt && <button type="button" className="meal-serving-mode" onClick={() => changeDraft(id, { mode: action === 'cooked' ? 'delivered' : 'cooked', count: '', note: '' })}>{action === 'cooked' ? 'Chuyển sang giao lớp' : 'Sửa số đã nấu trước khi giao'}</button>}
        {canEdit && action && <div className="meal-serving-form"><label>Số suất<input type="number" min="0" step="1" value={draft.count ?? suggested} onChange={(event) => changeDraft(id, { count: event.target.value })} /></label><label>Lý do nếu số suất lệch<input maxLength="500" value={draft.note || ''} onChange={(event) => changeDraft(id, { note: event.target.value })} placeholder="Ví dụ: trẻ đến sau giờ chốt suất" /></label><button type="button" className="button button-primary" disabled={state.saving} onClick={() => submit(id, action, suggested)}>{{ cooked: 'Ghi nhận đã nấu', delivered: 'Xác nhận đã giao lớp', received: 'Xác nhận lớp đã nhận' }[action]}</button></div>}
        {role === 'teacher' && !record?.deliveredAt && <p className="meal-serving-change">Bếp chưa ghi nhận giao suất cho lớp.</p>}
      </article>;
    })}{!classes.length && <p className="meal-serving-empty">Không có lớp cần theo dõi trong ngày này.</p>}</div>}
  </section>;
}
