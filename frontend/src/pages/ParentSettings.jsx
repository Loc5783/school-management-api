import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api/axiosConfig';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

const statusText = {
  pending: 'Đang chờ xử lý',
  in_progress: 'Đang xử lý',
  responded: 'Đã phản hồi',
  closed: 'Đã đóng'
};

export default function ParentSettings() {
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [feedbacks, setFeedbacks] = useState([]);
  const [state, setState] = useState({ loading: true, error: '', notice: '' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ category: 'general', subject: '', message: '' });

  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdState, setPwdState] = useState({ error: '', notice: '' });

  const selected = useMemo(
    () => students.find((student) => student._id === selectedId),
    [students, selectedId]
  );

  const loadStudents = useCallback(async () => {
    try {
      const response = await api.get('/students', { params: { status: 'all', limit: 100, sortBy: 'fullName' } });
      const data = response.data.data || [];
      setStudents(data);
      setSelectedId((current) => current || data[0]?._id || '');
      setState((old) => ({ ...old, loading: false, error: '' }));
    } catch (error) {
      setState({ loading: false, error: error.response?.data?.message || 'Không thể tải hồ sơ của con.', notice: '' });
    }
  }, []);

  const loadFeedbacks = useCallback(async () => {
    if (!selectedId) return;
    setState((old) => ({ ...old, loading: true, error: '' }));
    try {
      const response = await api.get('/parent-feedback', { params: { studentId: selectedId } });
      setFeedbacks(response.data.data || []);
      setState((old) => ({ ...old, loading: false, error: '' }));
    } catch (error) {
      setState((old) => ({ ...old, loading: false, error: error.response?.data?.message || 'Không thể tải các góp ý đã gửi.' }));
    }
  }, [selectedId]);

  useEffect(() => { void loadStudents(); }, [loadStudents]);
  useEffect(() => { void loadFeedbacks(); }, [loadFeedbacks]);

  const submitFeedback = async (event) => {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setState((old) => ({ ...old, error: '', notice: '' }));
    try {
      await api.post('/parent-feedback', { studentId: selected._id, ...form });
      setForm({ category: 'general', subject: '', message: '' });
      setState((old) => ({ ...old, notice: 'Đã gửi ý kiến riêng tới ban quản lý nhà trường.' }));
      await loadFeedbacks();
    } catch (error) {
      setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể gửi ý kiến.' }));
    } finally {
      setSaving(false);
    }
  };

  const submitPasswordChange = async (event) => {
    event.preventDefault();
    if (pwdSaving) return;
    if (pwdForm.newPassword.length < 6) {
      setPwdState({ error: 'Mật khẩu mới cần có ít nhất 6 ký tự.', notice: '' });
      return;
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      setPwdState({ error: 'Mật khẩu xác nhận không trùng khớp.', notice: '' });
      return;
    }

    setPwdSaving(true);
    setPwdState({ error: '', notice: '' });
    try {
      await api.post('/auth/me/password', {
        currentPassword: pwdForm.currentPassword,
        newPassword: pwdForm.newPassword
      });
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwdState({ error: '', notice: 'Đã đổi mật khẩu tài khoản Phụ huynh thành công.' });
    } catch (error) {
      setPwdState({
        error: error.response?.data?.message || 'Không thể đổi mật khẩu. Vui lòng kiểm tra mật khẩu hiện tại.',
        notice: ''
      });
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <AppShell title="Cài đặt & Góp ý Phụ huynh" subtitle="Đổi mật khẩu tài khoản gia đình và gửi ý kiến trao đổi trực tiếp với nhà trường.">
      {state.error && <div className="form-error">{state.error}</div>}
      {state.notice && <div className="timekeeping-notice success">{state.notice}</div>}

      <section className="content-card" style={{ marginBottom: '20px', padding: '22px' }}>
        <div className="card-heading">
          <div>
            <p className="card-kicker">BẢO MẬT TÀI KHOẢN GIA ĐÌNH</p>
            <h2>Đổi mật khẩu đăng nhập</h2>
            <p>Khuyến nghị đổi mật khẩu mặc định (`123456`) ngay sau lần đăng nhập đầu tiên để bảo vệ thông tin đón trả bé.</p>
          </div>
        </div>
        {pwdState.error && <div className="form-error" style={{ marginBottom: '12px' }}>{pwdState.error}</div>}
        {pwdState.notice && <div className="timekeeping-notice success" style={{ marginBottom: '12px' }}>{pwdState.notice}</div>}
        <form className="student-form-grid" onSubmit={submitPasswordChange}>
          <label>
            Mật khẩu hiện tại *
            <input
              type="password"
              required
              value={pwdForm.currentPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              placeholder="Nhập mật khẩu hiện tại"
            />
          </label>
          <label>
            Mật khẩu mới *
            <input
              type="password"
              required
              minLength={6}
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              placeholder="Tối thiểu 6 ký tự"
            />
          </label>
          <label>
            Nhập lại mật khẩu mới *
            <input
              type="password"
              required
              minLength={6}
              value={pwdForm.confirmPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              placeholder="Xác nhận mật khẩu mới"
            />
          </label>
          <div className="form-actions" style={{ alignItems: 'flex-end' }}>
            <button type="submit" className="button button-primary" disabled={pwdSaving}>
              {pwdSaving ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
            </button>
          </div>
        </form>
      </section>

      <section className="parent-settings-grid">
        <article className="content-card parent-settings-card">
          <div className="card-heading"><div><p className="card-kicker">GÓP Ý RIÊNG</p><h2>Gửi ý kiến tới nhà trường</h2></div></div>
          <form className="student-form-grid parent-feedback-form" onSubmit={submitFeedback}>
            <label className="form-wide">
              Liên quan đến bé
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={state.loading || !students.length}>
                {students.length
                  ? students.map((student) => (
                      <option key={student._id} value={student._id}>
                        {student.fullName} · {student.currentClassName || student.className || 'Chưa xếp lớp'}
                      </option>
                    ))
                  : <option>Chưa có hồ sơ liên kết</option>}
              </select>
            </label>
            <label>
              Nhóm ý kiến
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                <option value="general">Góp ý chung</option>
                <option value="health">Sức khỏe & Dinh dưỡng</option>
                <option value="tuition">Học phí</option>
                <option value="service">Dịch vụ nhà trường</option>
                <option value="complaint">Phản ánh / Khiếu nại</option>
              </select>
            </label>
            <label>
              Tiêu đề
              <input value={form.subject} minLength={3} maxLength={160} required placeholder="Ví dụ: Cần hỗ trợ về giờ đón bé" onChange={(event) => setForm({ ...form, subject: event.target.value })} />
            </label>
            <label className="form-wide">
              Nội dung
              <textarea value={form.message} minLength={10} maxLength={3000} required placeholder="Nêu rõ nội dung để ban quản lý có thể hỗ trợ." onChange={(event) => setForm({ ...form, message: event.target.value })} />
            </label>
            <p className="form-wide parent-feedback-note"><Icon name="shield" size={15} /> Ý kiến này chỉ phụ huynh và ban quản lý nhà trường xem được.</p>
            <div className="form-actions form-wide"><button className="button button-primary" disabled={saving || !selected}>{saving ? 'Đang gửi...' : 'Gửi ý kiến'}</button></div>
          </form>
        </article>
        <article className="content-card parent-settings-card">
          <div className="card-heading"><div><p className="card-kicker">LỊCH SỬ PHẢN HỒI</p><h2>Nhà trường đã tiếp nhận</h2></div></div>
          <div className="parent-feedback-history">
            {state.loading
              ? <div className="inline-loader"><span className="loading-orb" />Đang tải...</div>
              : feedbacks.length
                ? feedbacks.map((item) => (
                    <article key={item._id}>
                      <div>
                        <b>{item.subject}</b>
                        <small>{item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '—'} · {statusText[item.status] || item.status}</small>
                      </div>
                      <p>{item.message}</p>
                      {item.response && <p><b>Nhà trường:</b> {item.response}</p>}
                    </article>
                  ))
                : <p>Chưa có ý kiến riêng nào được gửi.</p>}
          </div>
        </article>
      </section>
    </AppShell>
  );
}
