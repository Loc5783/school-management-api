import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import api from '../api/axiosConfig';
import { getParentAccounts, linkParentStudents, updateParentStatus } from '../api/systemUsers';

const statusLabel = { inactive: 'Chờ kích hoạt', active: 'Đang hoạt động', suspended: 'Tạm ngưng' };

export default function ParentAccountManagement() {
  const [parents, setParents] = useState([]);
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [studentIds, setStudentIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const selectedParent = useMemo(() => parents.find((parent) => parent._id === selectedId), [parents, selectedId]);
  const load = useCallback(async (preferredId = '') => {
    try {
      const [parentResponse, studentResponse] = await Promise.all([getParentAccounts(), api.get('/students')]);
      const accountList = parentResponse.data.data || [];
      setParents(accountList);
      setStudents(studentResponse.data.data || []);
      const nextSelectedId = preferredId || accountList[0]?._id || '';
      const nextSelectedParent = accountList.find((parent) => parent._id === nextSelectedId);
      setSelectedId(nextSelectedId);
      setStudentIds(nextSelectedParent?.studentIds || []);
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể tải hồ sơ phụ huynh.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const toggleStudent = (id) => setStudentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const selectParent = (parent) => {
    setSelectedId(parent._id);
    setStudentIds(parent.studentIds || []);
  };
  const saveLinks = async () => {
    if (!selectedParent) return;
    setSaving(true); setNotice(null);
    try {
      await linkParentStudents(selectedParent._id, studentIds, 'Principal xác minh quan hệ phụ huynh và học sinh');
      await load(selectedParent._id);
      setNotice({ type: 'success', text: 'Đã lưu liên kết học sinh.' });
    } catch (error) { setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể lưu liên kết.' }); }
    finally { setSaving(false); }
  };
  const changeStatus = async (status) => {
    if (!selectedParent) return;
    setSaving(true); setNotice(null);
    try {
      if (status === 'active') await linkParentStudents(selectedParent._id, studentIds, 'Xác minh trước khi kích hoạt tài khoản');
      const response = await updateParentStatus(selectedParent._id, status, status === 'suspended' ? 'Tạm ngưng bởi Principal' : 'Principal phê duyệt tài khoản phụ huynh');
      await load(selectedParent._id);
      setNotice({ type: 'success', text: response.data.message });
    } catch (error) { setNotice({ type: 'error', text: error.response?.data?.message || 'Không thể cập nhật trạng thái.' }); }
    finally { setSaving(false); }
  };

  return <AppShell title="Duyệt tài khoản phụ huynh" subtitle="Xác minh phụ huynh, liên kết học sinh và kiểm soát trạng thái truy cập.">
    {notice && <div className={`timekeeping-notice ${notice.type}`}><Icon name={notice.type === 'success' ? 'check' : 'shield'} size={17} />{notice.text}</div>}
    {loading ? <div className="page-loader"><span className="loading-orb" />Đang tải tài khoản...</div> : <section className="parent-approval-layout">
      <article className="content-card parent-list-card"><div className="card-heading"><div><p className="card-kicker">TÀI KHOẢN PHỤ HUYNH</p><h2>{parents.length} hồ sơ</h2></div></div>
        <div className="parent-account-list">{parents.length ? parents.map((parent) => <button key={parent._id} className={parent._id === selectedId ? 'parent-account active' : 'parent-account'} onClick={() => selectParent(parent)}><span className="avatar">{parent.profile.fullName?.charAt(0) || 'P'}</span><span><strong>{parent.profile.fullName}</strong><small>{parent.username} · {parent.profile.phone || 'Chưa có SĐT'}</small></span><i className={`parent-status ${parent.status}`}>{statusLabel[parent.status]}</i></button>) : <p className="history-empty">Chưa có tài khoản phụ huynh.</p>}</div>
      </article>
      <article className="content-card parent-review-card">{selectedParent ? <><div className="card-heading"><div><p className="card-kicker">XÁC MINH HỒ SƠ</p><h2>{selectedParent.profile.fullName}</h2><p className="parent-contact">{selectedParent.profile.phone || 'Chưa có SĐT'} · {selectedParent.profile.email || 'Chưa có email'}</p></div><span className={`parent-status ${selectedParent.status}`}>{statusLabel[selectedParent.status]}</span></div>
        <div className="parent-review-body"><div><h3>Liên kết học sinh</h3><p>Chỉ những học sinh được chọn mới hiện với phụ huynh sau khi kích hoạt.</p><div className="parent-student-checklist">{students.map((student) => <label key={student._id}><input type="checkbox" checked={studentIds.includes(student._id)} onChange={() => toggleStudent(student._id)} /><span><strong>{student.fullName}</strong><small>{student.className || 'Chưa có lớp'}</small></span></label>)}</div></div><div className="parent-actions"><button className="button button-secondary" onClick={saveLinks} disabled={saving}>Lưu liên kết</button>{selectedParent.status !== 'active' && <button className="button button-primary" onClick={() => changeStatus('active')} disabled={saving || !studentIds.length}><Icon name="check" size={17} />Kích hoạt tài khoản</button>}{selectedParent.status === 'active' && <button className="button button-secondary" onClick={() => changeStatus('suspended')} disabled={saving}>Tạm ngưng tài khoản</button>}</div></div>
      </> : <div className="empty-state"><strong>Chọn một tài khoản để xử lý</strong></div>}</article>
    </section>}
  </AppShell>;
}
