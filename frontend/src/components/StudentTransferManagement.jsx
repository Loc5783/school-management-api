import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axiosConfig';
import { getStudent, transferStudentClassroom } from '../api/students';
import { getVietnamToday } from '../utils/dateHelpers';
import Icon from './Icon';

const isIndeterminateError = (err) => {
  if (!err) return false;
  if (!err.response) return true;
  if (err.code === 'ECONNABORTED') return true;
  if ([502, 503, 504].includes(err.response.status)) return true;
  const msg = String(err.response.data?.message || '');
  if (err.response.status === 409 && msg.includes('đang được xử lý')) {
    return true;
  }
  return false;
};

const getCanonicalTransferPayload = (data) => ({
  toClassroomId: String(data.toClassroomId || ''),
  reason: String(data.reason || '').trim(),
  effectiveDate: String(data.effectiveDate || '').slice(0, 10)
});

const isSameTransferPayload = (p1, p2) => {
  if (!p1 || !p2) return false;
  return (
    p1.toClassroomId === p2.toClassroomId &&
    p1.reason === p2.reason &&
    p1.effectiveDate === p2.effectiveDate
  );
};

export default function StudentTransferManagement() {
  const [students, setStudents] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [toClassroomId, setToClassroomId] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => getVietnamToday());
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [indeterminateOp, setIndeterminateOp] = useState(null);

  const savingRef = useRef(false);
  const refreshingRef = useRef(false);
  const activeRefreshOpIdRef = useRef(null);
  const indeterminateOpRef = useRef(null);
  const activeOpRef = useRef(null);
  const historySeqRef = useRef(0);
  const initialLoadSeqRef = useRef(0);
  const managementGenRef = useRef(0);
  const activeTransferOpIdRef = useRef(null);
  const lastSubmittedPayloadRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadInitialData = useCallback(async () => {
    const seq = ++initialLoadSeqRef.current;
    try {
      const [classRes, studentRes] = await Promise.all([
        api.get('/classrooms'),
        api.get('/students', { params: { status: 'enrolled', limit: 50, search } })
      ]);
      if (!isMountedRef.current || seq !== initialLoadSeqRef.current) {
        return { classrooms: [], students: [], cancelled: true };
      }
      const cData = classRes.data?.data || [];
      const sData = studentRes.data?.data || [];
      setClassrooms(cData);
      setStudents(sData);
      return { classrooms: cData, students: sData };
    } catch (err) {
      if (isMountedRef.current && seq === initialLoadSeqRef.current) {
        setError(err.response?.data?.message || 'Không thể tải dữ liệu lớp học.');
      }
      throw err;
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadInitialData().catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [loadInitialData]);

  const loadHistory = async (studentId) => {
    const seq = ++historySeqRef.current;
    setHistoryLoading(true);
    try {
      const res = await api.get(`/students/${studentId}/transfer-history`);
      if (!isMountedRef.current || seq !== historySeqRef.current) {
        return { history: [], cancelled: true };
      }
      const data = res.data?.data || [];
      setHistory(data);
      return { history: data };
    } catch (err) {
      if (isMountedRef.current && seq === historySeqRef.current) {
        setHistory([]);
      }
      throw err;
    } finally {
      if (isMountedRef.current && seq === historySeqRef.current) {
        setHistoryLoading(false);
      }
    }
  };

  const handleSelectStudent = (student) => {
    // Lock guard: do not allow switching student while saving, while refreshing or while an indeterminate operation is pending
    if (savingRef.current || saving || refreshingRef.current || refreshing || indeterminateOpRef.current || indeterminateOp) {
      return;
    }
    // No-op when clicking the already-selected student
    if (selectedStudent?._id && String(selectedStudent._id) === String(student?._id)) {
      return;
    }

    setSelectedStudent(student);
    setToClassroomId('');
    setReason('');
    setEffectiveDate(getVietnamToday());
    setTransferKey(crypto.randomUUID());
    setIndeterminateOp(null);
    indeterminateOpRef.current = null;
    lastSubmittedPayloadRef.current = null;
    setError('');
    setSuccess('');
    loadHistory(student._id).catch(() => {});
  };

  const handleResetIndeterminate = async () => {
    if (savingRef.current || saving || refreshingRef.current || refreshing) return;
    if (!indeterminateOpRef.current && !indeterminateOp) return;

    const confirmMsg =
      'CẢNH BÁO: Thao tác này chỉ bỏ theo dõi yêu cầu trên trình duyệt và KHÔNG hủy giao dịch trên máy chủ. ' +
      'Yêu cầu chuyển lớp trước đó có thể đã được máy chủ tiếp nhận và xử lý thành công. ' +
      'Nếu tiếp tục, bạn sẽ không thể thử lại bằng mã yêu cầu (idempotency key) ban đầu.\n\n' +
      'Bạn có chắc chắn muốn bỏ theo dõi yêu cầu cũ để nhập thông tin mới?';

    if (!window.confirm(confirmMsg)) {
      return;
    }

    const snapshotStudentId = indeterminateOpRef.current?.studentId || indeterminateOp?.studentId || selectedStudent?._id;
    const snapshotGen = managementGenRef.current;
    const snapshotOp = indeterminateOpRef.current || indeterminateOp;
    const refreshOpId = crypto.randomUUID();
    activeRefreshOpIdRef.current = refreshOpId;
    refreshingRef.current = true;
    setRefreshing(true);
    setError('');

    try {
      const [initialRes, historyRes, freshStudent] = await Promise.all([
        loadInitialData(),
        snapshotStudentId ? loadHistory(snapshotStudentId) : Promise.resolve(null),
        snapshotStudentId ? getStudent(snapshotStudentId).then((r) => r.data?.data) : Promise.resolve(null)
      ]);

      if (initialRes?.cancelled || historyRes?.cancelled) {
        return;
      }

      const isStillActive =
        isMountedRef.current &&
        managementGenRef.current === snapshotGen &&
        activeRefreshOpIdRef.current === refreshOpId &&
        (indeterminateOpRef.current?.key === snapshotOp?.key || indeterminateOp?.key === snapshotOp?.key);

      if (!isStillActive) {
        return;
      }

      if (freshStudent) {
        setSelectedStudent(freshStudent);
      }
      setIndeterminateOp(null);
      indeterminateOpRef.current = null;
      lastSubmittedPayloadRef.current = null;
      setTransferKey(crypto.randomUUID());
      setToClassroomId('');
      setReason('');
      setEffectiveDate(getVietnamToday());
      setError('');
    } catch {
      const isStillActive =
        isMountedRef.current &&
        managementGenRef.current === snapshotGen &&
        activeRefreshOpIdRef.current === refreshOpId;

      if (isStillActive) {
        setError('Không thể tải lại dữ liệu mới nhất từ máy chủ để làm mới giao diện. Vui lòng thử lại sau.');
      }
    } finally {
      if (activeRefreshOpIdRef.current === refreshOpId) {
        activeRefreshOpIdRef.current = null;
        refreshingRef.current = false;
        if (isMountedRef.current) {
          setRefreshing(false);
        }
      }
    }
  };

  const handleFieldChange = (field, value) => {
    let nextClassroomId = toClassroomId;
    let nextReason = reason;
    let nextEffectiveDate = effectiveDate;

    if (field === 'toClassroomId') {
      nextClassroomId = value;
      setToClassroomId(value);
    } else if (field === 'reason') {
      nextReason = value;
      setReason(value);
    } else if (field === 'effectiveDate') {
      nextEffectiveDate = value;
      setEffectiveDate(value);
    }

    const nextCanonical = getCanonicalTransferPayload({
      toClassroomId: nextClassroomId,
      reason: nextReason,
      effectiveDate: nextEffectiveDate
    });

    if (
      lastSubmittedPayloadRef.current &&
      !isSameTransferPayload(nextCanonical, lastSubmittedPayloadRef.current)
    ) {
      setTransferKey(crypto.randomUUID());
      lastSubmittedPayloadRef.current = null;
      setError('');
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (savingRef.current || saving || refreshingRef.current || refreshing) return;
    if (!selectedStudent || !toClassroomId) return;
    if (!reason.trim()) {
      setError('Vui lòng nhập lý do chuyển lớp.');
      return;
    }

    const activeStudentId = indeterminateOp?.studentId || selectedStudent._id;
    const opId = crypto.randomUUID();
    activeOpRef.current = { opId, studentId: activeStudentId };
    activeTransferOpIdRef.current = opId;

    let activeKey = indeterminateOp ? indeterminateOp.key : transferKey;
    const currentCanonical = getCanonicalTransferPayload({ toClassroomId, reason, effectiveDate });
    const activePayload = indeterminateOp ? indeterminateOp.form : currentCanonical;

    // If retrying after a deterministic error with changed payload, ensure a fresh key
    if (!indeterminateOp && lastSubmittedPayloadRef.current && !isSameTransferPayload(currentCanonical, lastSubmittedPayloadRef.current)) {
      activeKey = crypto.randomUUID();
      setTransferKey(activeKey);
      lastSubmittedPayloadRef.current = null;
    }

    savingRef.current = true;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await transferStudentClassroom(activeStudentId, activePayload, activeKey);

      // Verify this operation is still the active one before resetting state
      if (
        !isMountedRef.current ||
        activeOpRef.current?.opId !== opId ||
        activeOpRef.current?.studentId !== activeStudentId
      ) {
        return;
      }

      setSuccess(res.data?.message || 'Đã chuyển lớp thành công.');
      setSelectedStudent(res.data?.data?.student || null);
      setToClassroomId('');
      setReason('');
      setEffectiveDate(getVietnamToday());
      setTransferKey(crypto.randomUUID());
      setIndeterminateOp(null);
      indeterminateOpRef.current = null;
      lastSubmittedPayloadRef.current = null;
      loadHistory(activeStudentId).catch(() => {});
      loadInitialData().catch(() => {});
    } catch (err) {
      if (
        !isMountedRef.current ||
        activeOpRef.current?.opId !== opId ||
        activeOpRef.current?.studentId !== activeStudentId
      ) {
        return;
      }

      if (isIndeterminateError(err)) {
        const indet = { key: activeKey, form: activePayload, studentId: activeStudentId };
        setIndeterminateOp(indet);
        indeterminateOpRef.current = indet;
        setError('Yêu cầu đang được xử lý hoặc chưa rõ kết quả từ máy chủ do lỗi kết nối/timeout. Thao tác thử lại sẽ dùng cùng mã yêu cầu để bảo đảm an toàn dữ liệu.');
      } else {
        lastSubmittedPayloadRef.current = activePayload;
        setError(err.response?.data?.message || 'Không thể thực hiện chuyển lớp.');
      }
    } finally {
      if (activeTransferOpIdRef.current === opId) {
        activeTransferOpIdRef.current = null;
        savingRef.current = false;
        if (isMountedRef.current) {
          setSaving(false);
        }
      }
    }
  };

  const destinationOptions = classrooms.filter((c) => {
    if (!selectedStudent) return false;
    // Different classroom and same academic year
    const isDifferent = String(c._id) !== String(selectedStudent.classroomId);
    const sameYear = !selectedStudent.schoolYear || !c.schoolYear || selectedStudent.schoolYear === c.schoolYear;
    return isDifferent && sameYear && c.status === 'active';
  });

  return (
    <section className="content-card student-list-card">
      <div className="card-heading">
        <div>
          <p className="card-kicker">ĐIỀU CHUYỂN HỌC TẬP</p>
          <h2>Quy trình chuyển lớp học sinh</h2>
          <p>Chuyển lớp có hiệu lực ngay trong ngày làm việc hôm nay (Asia/Ho_Chi_Minh). Hệ thống tự động khóa và cập nhật sĩ số nguyên tử.</p>
        </div>
      </div>

      {error && <div className="form-error" role="alert" style={{ margin: '0 20px 14px' }}>{error}</div>}
      {success && <div className="timekeeping-notice success" role="status" style={{ margin: '0 20px 14px' }}>{success}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: '20px', padding: '0 20px 20px' }}>
        {/* Left: Search & Select Student */}
        <div style={{ borderRight: '1px solid #e2e8f0', paddingRight: '20px' }}>
          <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
            Tìm học sinh (đang học):
          </label>
          <input
            type="text"
            disabled={saving || refreshing || !!indeterminateOp}
            placeholder="Tìm theo tên hoặc mã HS..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              marginBottom: '12px',
              opacity: (saving || refreshing || !!indeterminateOp) ? 0.7 : 1,
              cursor: (saving || refreshing || !!indeterminateOp) ? 'not-allowed' : 'text'
            }}
          />

          <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'grid', gap: '6px' }}>
            {students.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', padding: '10px' }}>
                Không tìm thấy học sinh phù hợp.
              </div>
            ) : (
              students.map((s) => (
                <button
                  key={s._id}
                  type="button"
                  disabled={saving || refreshing || !!indeterminateOp}
                  onClick={() => handleSelectStudent(s)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: selectedStudent?._id === s._id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    background: selectedStudent?._id === s._id ? '#eff6ff' : '#fff',
                    cursor: (saving || refreshing || !!indeterminateOp) ? 'not-allowed' : 'pointer',
                    opacity: (saving || refreshing || !!indeterminateOp) ? 0.6 : 1
                  }}
                >
                  <strong style={{ display: 'block', color: '#1e293b', fontSize: '13px' }}>{s.fullName}</strong>
                  <small style={{ color: '#64748b' }}>{s.studentCode || 'Chưa có mã'} · Lớp: {s.className || 'Chưa xếp'}</small>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: Transfer Action & History */}
        <div>
          {!selectedStudent ? (
            <div className="empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Icon name="users" size={32} />
              <p style={{ marginTop: '10px', color: '#64748b' }}>Vui lòng chọn học sinh từ danh sách bên trái để thực hiện chuyển lớp.</p>
            </div>
          ) : (
            <div>
              {/* Selected Student Banner */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '14px 18px',
                marginBottom: '18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px'
              }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>
                    HỌC SINH ĐƯỢC CHỌN
                  </span>
                  <h3 style={{ margin: '2px 0', color: '#1e3a8a', fontSize: '17px' }}>{selectedStudent.fullName}</h3>
                  <small style={{ color: '#475569' }}>
                    Mã: <b>{selectedStudent.studentCode}</b> · Lớp hiện tại: <b>{selectedStudent.className || 'Chưa có'}</b> · Năm học: <b>{selectedStudent.schoolYear || '2026-2027'}</b>
                  </small>
                </div>
                <span className="account-role-badge">Hiệu lực ngay</span>
              </div>

              {/* Transfer Form */}
              <form onSubmit={handleTransfer} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 12px', color: '#1e293b' }}>Thực hiện chuyển sang lớp mới</h4>

                {indeterminateOp && (
                  <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
                    <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Thao tác trước đó chưa rõ kết quả phản hồi từ máy chủ.</p>
                    <p style={{ margin: '0 0 8px' }}>
                      Nhấn &quot;Thử lại yêu cầu&quot; để gửi lại an toàn với cùng mã định danh (Idempotency-Key). Nút &quot;Bỏ theo dõi yêu cầu cũ &amp; Làm mới&quot; chỉ xóa trạng thái trên trình duyệt (không hủy giao dịch máy chủ).
                    </p>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={saving || refreshing}
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={handleResetIndeterminate}
                    >
                      {refreshing ? 'Đang làm mới...' : 'Bỏ theo dõi yêu cầu cũ & Làm mới'}
                    </button>
                  </div>
                )}
                <div style={{ display: 'grid', gap: '14px' }}>
                  <label>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                      Chọn lớp chuyển đến <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                    <select
                      required
                      disabled={saving || refreshing || !!indeterminateOp}
                      value={toClassroomId}
                      onChange={(e) => handleFieldChange('toClassroomId', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: (saving || refreshing || !!indeterminateOp) ? '#f1f5f9' : '#fff' }}
                    >
                      <option value="">-- Chọn lớp tiếp nhận --</option>
                      {destinationOptions.map((c) => {
                        const currentCount = c.statistics?.currentStudents || 0;
                        const isFull = currentCount >= (c.maxSize || 25);
                        return (
                          <option key={c._id} value={c._id} disabled={isFull}>
                            {c.name} (Sĩ số: {currentCount}/{c.maxSize || 25}) {isFull ? '— [HẾT CHỖ]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  <label>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                      Ngày hiệu lực (giờ Việt Nam) <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                    <input
                      type="date"
                      required
                      disabled={saving || refreshing || !!indeterminateOp}
                      value={effectiveDate}
                      onChange={(e) => handleFieldChange('effectiveDate', e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: (saving || refreshing || !!indeterminateOp) ? '#f1f5f9' : '#fff' }}
                    />
                  </label>

                  <label>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                      Lý do chuyển lớp <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                    <textarea
                      required
                      rows={2}
                      disabled={saving || refreshing || !!indeterminateOp}
                      value={reason}
                      onChange={(e) => handleFieldChange('reason', e.target.value)}
                      placeholder="Nhập lý do chuyển lớp (ví dụ: Thay đổi độ tuổi, theo nguyện vọng phụ huynh, điều chỉnh sĩ số)..."
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: (saving || refreshing || !!indeterminateOp) ? '#f1f5f9' : '#fff' }}
                    />
                  </label>

                  <div>
                    <button
                      type="submit"
                      className="button button-primary"
                      disabled={saving || refreshing || !toClassroomId}
                      style={{ minWidth: '150px' }}
                    >
                      {saving ? 'Đang điều chuyển...' : refreshing ? 'Đang làm mới...' : indeterminateOp ? 'Thử lại yêu cầu' : 'Xác nhận chuyển lớp'}
                    </button>
                  </div>
                </div>
              </form>

              {/* Transfer History Table */}
              <div>
                <h4 style={{ margin: '0 0 10px', color: '#334155' }}>Lịch sử chuyển lớp của học sinh</h4>
                {historyLoading ? (
                  <div className="inline-loader">Đang tải lịch sử...</div>
                ) : history.length === 0 ? (
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                    Học sinh chưa từng chuyển lớp.
                  </div>
                ) : (
                  <table className="content-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Từ lớp</th>
                        <th>Đến lớp</th>
                        <th>Ngày hiệu lực</th>
                        <th>Lý do</th>
                        <th>Người thực hiện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h._id}>
                          <td><b>{h.fromClassName}</b></td>
                          <td><b style={{ color: '#1d4ed8' }}>{h.toClassName}</b></td>
                          <td>{new Date(h.effectiveDate).toLocaleDateString('vi-VN')}</td>
                          <td>{h.reason}</td>
                          <td><small>{h.transferredByName}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
