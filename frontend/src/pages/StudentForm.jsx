import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { createStudent, getStudent, updateStudent } from '../api/students';
import api from '../api/axiosConfig';

const ALLERGEN_OPTIONS = [
  { value: 'gluten', label: 'Gluten / lúa mì' }, { value: 'crustacean', label: 'Giáp xác (tôm, cua)' },
  { value: 'fish', label: 'Cá' }, { value: 'egg', label: 'Trứng' }, { value: 'milk', label: 'Sữa' },
  { value: 'peanut', label: 'Đậu phộng / lạc' }, { value: 'soy', label: 'Đậu nành' },
  { value: 'sesame', label: 'Mè / vừng' }, { value: 'tree_nut', label: 'Hạt cây (hạnh nhân, điều...)' },
  { value: 'mollusc', label: 'Nhuyễn thể (nghêu, sò, mực...)' }
];
const ALLERGEN_ALIASES = {
  gluten: ['gluten', 'lúa mì', 'bột mì'], crustacean: ['giáp xác', 'tôm', 'cua', 'hải sản'], fish: ['cá'], egg: ['trứng'],
  milk: ['sữa', 'sữa bò'], peanut: ['đậu phộng', 'lạc'], soy: ['đậu nành'], sesame: ['mè', 'vừng'],
  tree_nut: ['hạt cây', 'hạnh nhân', 'hạt điều', 'óc chó'], mollusc: ['nhuyễn thể', 'nghêu', 'sò', 'ốc', 'mực']
};
const empty = { fullName: '', birthDate: '', gender: 'male', classroomId: '', admissionDate: '', schoolYear: '2026-2027', status: 'enrolled', address: '', nationality: 'Việt Nam', ethnicity: '', birthPlace: '', notes: '', allergens: [], allergyNote: '', diseaseName: '', diseaseDescription: '', emergencyName: '', emergencyPhone: '' };
const toDate = (value) => value ? new Date(value).toISOString().slice(0, 10) : '';
const normalizeAllergen = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.entries(ALLERGEN_ALIASES).find(([, aliases]) => aliases.some((alias) => normalized === alias || normalized.includes(alias)))?.[0] || '';
};
const labelAllergen = (value) => ALLERGEN_OPTIONS.find((item) => item.value === value)?.label || value;

export default function StudentForm() {
  const { id } = useParams(); const navigate = useNavigate();
  const [form, setForm] = useState(empty); const [classes, setClasses] = useState([]); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const editing = Boolean(id); const role = JSON.parse(localStorage.getItem('user') || '{}').role; const manager = ['admin', 'principal'].includes(role);

  useEffect(() => {
    Promise.all([api.get('/classrooms'), editing ? getStudent(id) : Promise.resolve(null)]).then(([classRes, studentRes]) => {
      setClasses(classRes.data.data || []); if (!studentRes) return;
      const data = studentRes.data.data;
      const normalized = (data.allergies || []).map((item) => ({ ...item, code: normalizeAllergen(item.allergen) }));
      const standardCodes = [...new Set(normalized.map((item) => item.code).filter(Boolean))];
      const otherNotes = normalized.filter((item) => !item.code).map((item) => [item.allergen, item.note].filter(Boolean).join(': ')).filter(Boolean);
      setForm((old) => ({ ...old, ...data, birthDate: toDate(data.birthDate), admissionDate: toDate(data.admissionDate), allergens: standardCodes, allergyNote: otherNotes.join('; '), diseaseName: data.disease?.name || '', diseaseDescription: data.disease?.description || '', emergencyName: data.emergencyContact?.name || '', emergencyPhone: data.emergencyContact?.phone || '' }));
    }).catch(() => setError('Không thể tải dữ liệu biểu mẫu.'));
  }, [id, editing]);

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const toggleAllergen = (code) => setForm((old) => ({ ...old, allergens: old.allergens.includes(code) ? old.allergens.filter((item) => item !== code) : [...old.allergens, code] }));
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const teacherFields = ['fullName', 'birthDate', 'gender', 'address', 'nationality', 'ethnicity', 'birthPlace', 'avatar', 'notes'];
      const managerFields = [...teacherFields, 'classroomId', 'admissionDate', 'schoolYear'];
      const data = Object.fromEntries((manager ? managerFields : teacherFields).map((key) => [key, form[key]]));
      if (manager) {
        if (!editing) data.status = form.status;
        data.allergies = form.allergens.map((allergen) => ({ allergen, severity: 'moderate' }));
        if (form.allergyNote.trim()) data.allergies.push({ allergen: 'Khác', severity: 'moderate', note: form.allergyNote.trim() });
        data.disease = { name: form.diseaseName.trim(), description: form.diseaseDescription.trim() };
        data.emergencyContact = { name: form.emergencyName.trim(), phone: form.emergencyPhone.trim() };
      }
      if (editing) await updateStudent(id, data); else await createStudent(data);
      navigate(editing ? `/students/${id}` : '/students');
    } catch (err) { setError(err.response?.data?.message || 'Không thể lưu hồ sơ học sinh.'); } finally { setSaving(false); }
  };

  return <AppShell title={editing ? 'Cập nhật học sinh' : 'Thêm học sinh'} subtitle="Thông tin hồ sơ được kiểm tra và phân quyền tại máy chủ."><form className="content-card student-form" onSubmit={submit}><div className="section-heading"><div><p className="card-kicker">HỒ SƠ HỌC SINH</p><h2>{editing ? 'Cập nhật thông tin' : 'Tạo hồ sơ mới'}</h2></div></div>{error && <p className="form-error">{error}</p>}<div className="student-form-grid"><label>Họ và tên<input required maxLength="120" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} /></label><label>Ngày sinh<input required type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label><label>Giới tính<select value={form.gender} onChange={(e) => set('gender', e.target.value)}><option value="male">Nam</option><option value="female">Nữ</option></select></label><label>Lớp học<select required value={form.classroomId} onChange={(e) => set('classroomId', e.target.value)} disabled={editing && !manager}><option value="">Chọn lớp học</option>{classes.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></label>{manager && <><label>Ngày nhập học<input type="date" value={form.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} /></label><label>Năm học<input value={form.schoolYear} onChange={(e) => set('schoolYear', e.target.value)} placeholder="Ví dụ: 2026-2027" /></label>{!editing && <label className="form-wide">Trạng thái khi tạo<select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="enrolled">Đang theo học — được tính vào sĩ số và Dashboard</option><option value="pending_admission">Chờ nhập học — lưu hồ sơ, chưa tính sĩ số</option></select><small>Với học sinh đã tạo, trạng thái được thay đổi tại trang chi tiết để lưu lịch sử và cập nhật sĩ số đúng quy trình.</small></label>}</>}<label className="form-wide">Địa chỉ<input maxLength="500" value={form.address || ''} onChange={(e) => set('address', e.target.value)} /></label>{manager && <><label>Quốc tịch<input value={form.nationality || ''} onChange={(e) => set('nationality', e.target.value)} /></label><label>Nơi sinh<input value={form.birthPlace || ''} onChange={(e) => set('birthPlace', e.target.value)} /></label><fieldset className="student-allergy-fieldset form-wide"><legend>Dị ứng / lưu ý ăn uống</legend><p>Chọn dị nguyên chuẩn để hệ thống đối chiếu trực tiếp với công thức món ăn.</p><div className="student-allergen-options">{ALLERGEN_OPTIONS.map((allergen) => <label key={allergen.value}><input type="checkbox" checked={form.allergens.includes(allergen.value)} onChange={() => toggleAllergen(allergen.value)} />{allergen.label}</label>)}</div><label className="student-allergy-note">Dị ứng khác hoặc lưu ý chế độ ăn<textarea value={form.allergyNote} onChange={(e) => set('allergyNote', e.target.value)} placeholder="Ví dụ: Không dùng mật ong; cần cắt nhỏ thức ăn. Nội dung này hiển thị cho bếp nhưng không thay thế cảnh báo tự động." maxLength="500" /></label>{form.allergens.length > 0 && <small className="student-allergy-selection">Đã chọn: {form.allergens.map(labelAllergen).join(', ')}</small>}</fieldset><label>Bệnh lý cần lưu ý<input value={form.diseaseName} onChange={(e) => set('diseaseName', e.target.value)} placeholder="Ví dụ: hen suyễn" /></label><label>Mô tả / hướng dẫn y tế<input value={form.diseaseDescription} onChange={(e) => set('diseaseDescription', e.target.value)} placeholder="Ví dụ: mang thuốc xịt theo chỉ định" /></label><label>Người liên hệ khẩn cấp<input value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} /></label><label>Số điện thoại khẩn cấp<input value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} /></label></>}<label className="form-wide">Ghi chú<textarea maxLength="2000" value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} /></label></div><div className="form-actions"><button type="button" className="button button-secondary" onClick={() => navigate(-1)}>Hủy</button><button className="button button-primary" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu hồ sơ'}</button></div></form></AppShell>;
}
