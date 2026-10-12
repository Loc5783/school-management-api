import { useCallback, useEffect, useState } from 'react';
import { createFoodSample, getKitchenSafetyDay, recordKitchenSafetyStep } from '../api/nutrition';
import './KitchenSafetyPanel.css';
import { kitchenErrorMessage } from '../utils/kitchenErrorMessage';

const meals = [
  ['breakfast', 'Bữa sáng'], ['morningSnack', 'Phụ sáng'],
  ['lunch', 'Bữa trưa'], ['afternoonSnack', 'Bữa phụ chiều']
];
const checklist = {
  1: [['sourceVerified', 'Đã kiểm tra nguồn gốc nguyên liệu'], ['packagingPassed', 'Bao bì, nhãn và hạn dùng đạt'], ['sensoryPassed', 'Cảm quan nguyên liệu đạt']],
  2: [['kitchenHygiene', 'Khu chế biến sạch'], ['equipmentHygiene', 'Dụng cụ sạch'], ['staffHygiene', 'Nhân viên đủ điều kiện vệ sinh'], ['rawCookedSeparated', 'Thực phẩm sống và chín tách biệt'], ['cookingVerified', 'Đã kiểm tra thức ăn chín đạt']],
  3: [['sensoryPassed', 'Cảm quan món trước phục vụ đạt'], ['utensilsHygiene', 'Dụng cụ chia suất sạch']]
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const currentStep = (inspection) => {
  if (inspection?.stage === 'ready') return 0;
  if (inspection?.stage === 'processing_checked') return 3;
  if (inspection?.stage === 'raw_checked') return 2;
  const last = inspection?.stageHistory?.at(-1)?.stage;
  return last === 'step3' ? 3 : last === 'step2' ? 2 : 1;
};

export default function KitchenSafetyPanel({ date, role }) {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [sampleDrafts, setSampleDrafts] = useState({});
  const [state, setState] = useState({ loading: true, saving: false, error: '', notice: '' });
  const canWrite = role === 'chef' && date === today();
  const load = useCallback(async () => {
    const response = await getKitchenSafetyDay(date);
    setData(response.data.data);
    setState((old) => ({ ...old, loading: false, error: '' }));
  }, [date]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load().catch((error) => { setData(null); setState((old) => ({ ...old, loading: false, error: kitchenErrorMessage(error, 'Không tải được sổ an toàn thực phẩm.') })); }); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const run = async (action, notice) => {
    setState((old) => ({ ...old, saving: true, error: '', notice: '' }));
    try { await action(); setState((old) => ({ ...old, loading: true, saving: false, notice })); load().catch(() => { setData(null); setState((old) => ({ ...old, loading: false, error: 'Đã lưu kết quả, nhưng chưa tải lại được sổ an toàn. Hãy mở lại trang trước khi thao tác tiếp.', notice: '' })); }); }
    catch (error) { setState((old) => ({ ...old, saving: false, error: kitchenErrorMessage(error, 'Không lưu được ghi nhận an toàn.'), notice: '' })); }
  };
  const saveStep = (mealType, step) => {
    const key = `${mealType}-${step}`;
    const draft = drafts[key] || {};
    const checks = Object.fromEntries(checklist[step].map(([field]) => [field, Boolean(draft[field])]));
    run(() => recordKitchenSafetyStep(mealType, step, { date, checks, note: draft.note || '' }), 'Đã lưu kết quả kiểm tra.');
  };
  const saveSample = (mealType, dishName) => {
    const key = `${mealType}:${dishName}`;
    const draft = sampleDrafts[key] || {};
    const amount = Number(draft.amount);
    const temperature = Number(draft.temperature);
    if (draft.amount === undefined || draft.amount === '' || !Number.isFinite(amount) || amount < (draft.unit === 'ml' ? 150 : 100)
      || draft.temperature === undefined || draft.temperature === '' || !Number.isFinite(temperature) || temperature < 2 || temperature > 8
      || !String(draft.fridge || '').trim()) {
      setState((old) => ({ ...old, error: 'Hãy nhập lượng mẫu đã cân (đặc ≥100 g, lỏng ≥150 ml), nhiệt độ đã đo 2–8°C và tên tủ lưu mẫu.', notice: '' }));
      return;
    }
    run(() => createFoodSample({ sampleCode: `SM-${date.replaceAll('-', '')}-${mealType.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      mealDate: date, mealType, dishName, sampleWeightGram: amount,
      sampleUnit: draft.unit || 'g', storageTemperature: temperature, storageFridge: draft.fridge.trim(), notes: draft.note || '' }), `Đã ghi mẫu lưu: ${dishName}.`);
  };

  return <section className="content-card kitchen-safety-panel">
    <div className="kitchen-safety-heading"><p className="card-kicker">AN TOÀN THỰC PHẨM</p><h2>Kiểm thực và lưu mẫu từng bữa</h2><p>Chỉ đánh dấu đạt sau khi đã kiểm tra thực tế. Mục không đạt phải ghi rõ để xử lý trước khi phục vụ.</p></div>
    {state.error && <div className="form-error" role="alert">{state.error}</div>}
    {state.notice && <div className="timekeeping-notice success" role="status">{state.notice}</div>}
    {state.loading ? <p className="kitchen-safety-empty">Đang tải tình trạng kiểm thực...</p> : <div className="kitchen-safety-meals">
      {data?.missingMenus > 0 && <p className="kitchen-safety-alert">Có {data.missingMenus} lớp đang có trẻ ăn nhưng thiếu thực đơn đã công bố. Chưa thể hoàn tất kiểm thực trước phục vụ.</p>}
      {meals.map(([mealType, label]) => {
        const inspection = data?.inspections?.find((item) => item.mealType === mealType && item.mealDateKey === date);
        const expected = data?.expected?.[mealType] || [];
        const samples = (data?.samples || []).filter((sample) => sample.mealType === mealType && sample.status === 'stored');
        const sampled = new Set(samples.map((sample) => sample.dishName.trim().toLocaleLowerCase('vi')));
        const step = currentStep(inspection);
        const key = `${mealType}-${step}`;
        const draft = drafts[key] || {};
        return <article key={mealType}><div className="kitchen-safety-meal-head"><strong>{label}</strong><span>{inspection?.stage === 'ready' ? 'Đã kiểm thực đủ' : inspection?.stage === 'held' && inspection?.stageHistory?.length ? 'Tạm giữ để xử lý' : step === 3 ? 'Chờ kiểm trước phục vụ' : step === 2 ? 'Chờ kiểm chế biến' : 'Chờ kiểm nguyên liệu'}</span></div>
          <p className="kitchen-safety-dishes"><b>Món cần lưu mẫu:</b> {expected.length ? expected.join(', ') : 'Chưa có món trong thực đơn của lớp đang ăn'}</p>
          {data?.allergyConflicts?.[mealType] > 0 && <p className="kitchen-safety-alert" role="alert">Bữa này có {data.allergyConflicts[mealType]} xung đột dị ứng theo hồ sơ hiện tại. Không xác nhận phục vụ cho đến khi thực đơn được xử lý.</p>}
          {expected.length > 0 && <div className="kitchen-safety-samples">{expected.map((dishName) => {
            const sampleKey = `${mealType}:${dishName}`;
            const sample = sampleDrafts[sampleKey] || {};
            const stored = sampled.has(dishName.toLocaleLowerCase('vi'));
            return <div key={dishName}><strong>{dishName}</strong>{stored ? <span className="is-stored">Đã lưu mẫu</span> : canWrite ? <div className="kitchen-safety-sample-form"><select value={sample.unit || 'g'} onChange={(event) => setSampleDrafts((old) => ({ ...old, [sampleKey]: { ...old[sampleKey], unit: event.target.value, amount: '' } }))}><option value="g">Thức ăn đặc (g)</option><option value="ml">Thức ăn lỏng (ml)</option></select><input type="number" min={sample.unit === 'ml' ? 150 : 100} step="1" value={sample.amount ?? ''} placeholder="Lượng đã cân" onChange={(event) => setSampleDrafts((old) => ({ ...old, [sampleKey]: { ...old[sampleKey], amount: event.target.value } }))} aria-label={`Lượng mẫu ${dishName}`} /><input type="number" min="2" max="8" step="0.1" value={sample.temperature ?? ''} placeholder="°C đã đo" onChange={(event) => setSampleDrafts((old) => ({ ...old, [sampleKey]: { ...old[sampleKey], temperature: event.target.value } }))} aria-label={`Nhiệt độ lưu mẫu ${dishName}`} /><input type="text" maxLength="100" value={sample.fridge ?? ''} placeholder="Tên tủ lưu mẫu" onChange={(event) => setSampleDrafts((old) => ({ ...old, [sampleKey]: { ...old[sampleKey], fridge: event.target.value } }))} aria-label={`Tủ lưu mẫu ${dishName}`} /><button className="button button-secondary" type="button" disabled={state.saving} onClick={() => saveSample(mealType, dishName)}>Lưu mẫu</button></div> : <span>Chưa lưu mẫu</span>}</div>;
          })}</div>}
          {inspection?.stageHistory?.length > 0 && <details><summary>Lịch sử kiểm tra ({inspection.stageHistory.length})</summary><ul>{inspection.stageHistory.map((entry, index) => <li key={index}>Bước {entry.stage?.slice(-1)} · {entry.passed ? 'Đạt' : 'Không đạt'} · {new Date(entry.at).toLocaleString('vi-VN')}{entry.note ? ` · ${entry.note}` : ''}</li>)}</ul></details>}
          {canWrite && expected.length > 0 && step > 0 && <div className="kitchen-safety-checks"><strong>Bước {step}: {['', 'Nguyên liệu đầu vào', 'Trong khi chế biến', 'Trước khi phục vụ'][step]}</strong>{checklist[step].map(([field, text]) => <label key={field}><input type="checkbox" checked={Boolean(draft[field])} onChange={(event) => setDrafts((old) => ({ ...old, [key]: { ...old[key], [field]: event.target.checked } }))} />{text}</label>)}<textarea maxLength="500" value={draft.note || ''} onChange={(event) => setDrafts((old) => ({ ...old, [key]: { ...old[key], note: event.target.value } }))} placeholder="Ghi rõ mục không đạt hoặc việc đã xử lý" /><button type="button" className="button button-primary" disabled={state.saving} onClick={() => saveStep(mealType, step)}>Lưu kết quả bước {step}</button></div>}
        </article>;
      })}
    </div>}
  </section>;
}
