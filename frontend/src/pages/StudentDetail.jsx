import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import QRCodeImage from '../components/QRCodeImage';
import { changeStudentStatus, deleteStudent, getStudent, transferStudentClassroom, getStudentTransferHistory } from '../api/students';
import { getVietnamToday } from '../utils/dateHelpers';
import api from '../api/axiosConfig';

const labels = { pending_admission: 'Chờ nhập học', enrolled: 'Đang theo học', temporarily_absent: 'Tạm nghỉ', withdrawn: 'Đã thôi học', transferred: 'Đã chuyển trường', graduated: 'Đã tốt nghiệp' };
const transitions = { pending_admission: ['enrolled', 'withdrawn'], enrolled: ['temporarily_absent', 'withdrawn', 'transferred', 'graduated'], temporarily_absent: ['enrolled', 'withdrawn', 'transferred'], withdrawn: [], transferred: [], graduated: [] };

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

export default function StudentDetail() {
  const { id } = useParams();
  const [student, setStudent] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const [classes, setClasses] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const [transferForm, setTransferForm] = useState(() => ({
    toClassroomId: '',
    reason: '',
    effectiveDate: getVietnamToday()
  }));
  const [transferring, setTransferring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [indeterminateOp, setIndeterminateOp] = useState(null);

  // Lifecycle, operation identity, and route tracking refs
  const transferringRef = useRef(false);
  const refreshingRef = useRef(false);
  const activeRefreshOpIdRef = useRef(null);
  const indeterminateOpRef = useRef(null);
  const loadSeqRef = useRef(0);
  const routeGenRef = useRef(0);
  const activeRouteIdRef = useRef(id);
  const activeTransferOpIdRef = useRef(null);
  const isMountedRef = useRef(true);
  const lastSubmittedPayloadRef = useRef(null);

  const role = JSON.parse(localStorage.getItem('user') || '{}').role;
  const manager = role === 'admin';
  const canTransfer = ['admin', 'hr', 'principal'].includes(role);

  // Synchronize route generation and active route id
  useEffect(() => {
    isMountedRef.current = true;
    routeGenRef.current += 1;
    activeRouteIdRef.current = id;
    indeterminateOpRef.current = null;
    activeRefreshOpIdRef.current = null;
    refreshingRef.current = false;
    lastSubmittedPayloadRef.current = null;
    return () => {
      isMountedRef.current = false;
      routeGenRef.current += 1;
    };
  }, [id]);

  // Reset transfer modal state and indeterminate operation whenever route id changes
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setShowTransferModal(false);
    setTransferError('');
    setIndeterminateOp(null);
    setRefreshing(false);
    setTransferKey(crypto.randomUUID());
    setTransferForm({
      toClassroomId: '',
      reason: '',
      effectiveDate: getVietnamToday()
    });
  }

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const requestedId = id;
    const requestedGen = routeGenRef.current;

    try {
      const [studentRes, historyRes, classRes] = await Promise.all([
        getStudent(requestedId),
        getStudentTransferHistory(requestedId),
        canTransfer ? api.get('/classrooms') : Promise.resolve({ data: { data: [] } })
      ]);

      const isCurrent =
        isMountedRef.current &&
        seq === loadSeqRef.current &&
        routeGenRef.current === requestedGen &&
        activeRouteIdRef.current === requestedId;

      if (!isCurrent) {
        return { student: null, transferHistory: [], classes: [], cancelled: true };
      }

      const data = studentRes.data?.data;
      setStudent(data);
      if (data?.status) {
        setStatus(transitions[data.status]?.[0] || data.status);
      }
      setTransferHistory(historyRes.data?.data || []);
      if (canTransfer && classRes.data?.data) {
        setClasses(classRes.data.data);
      }

      return {
        student: data,
        transferHistory: historyRes.data?.data || [],
        classes: classRes.data?.data || []
      };
    } catch (err) {
      const isCurrent =
        isMountedRef.current &&
        seq === loadSeqRef.current &&
        routeGenRef.current === requestedGen &&
        activeRouteIdRef.current === requestedId;

      if (isCurrent) {
        setError(err.response?.data?.message || 'Không thể tải hồ sơ học sinh.');
      }
      throw err;
    }
  }, [id, canTransfer]);

  useEffect(() => {
    const timer = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const saveStatus = async () => {
    try {
      await changeStudentStatus(id, { status, effectiveDate: new Date().toISOString() });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Không thể đổi trạng thái.');
    }
  };

  const handleFieldChange = (field, value) => {
    setTransferForm((prev) => {
      const next = { ...prev, [field]: value };
      const nextCanonical = getCanonicalTransferPayload(next);
      if (
        lastSubmittedPayloadRef.current &&
        !isSameTransferPayload(nextCanonical, lastSubmittedPayloadRef.current)
      ) {
        setTransferKey(crypto.randomUUID());
        lastSubmittedPayloadRef.current = null;
        setTransferError('');
      }
      return next;
    });
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    if (transferringRef.current || transferring || refreshingRef.current || refreshing) return;
    if (!transferForm.toClassroomId) {
      setTransferError('Vui lòng chọn lớp chuyển đến');
      return;
    }
    if (!transferForm.reason.trim()) {
      setTransferError('Vui lòng nhập lý do chuyển lớp');
      return;
    }

    const opStudentId = id;
    const opRouteGen = routeGenRef.current;
    const opId = crypto.randomUUID();
    activeTransferOpIdRef.current = opId;

    let activeKey = indeterminateOp ? indeterminateOp.key : transferKey;
    const currentCanonical = getCanonicalTransferPayload(transferForm);
    const activePayload = indeterminateOp ? indeterminateOp.form : currentCanonical;

    // If retrying after a deterministic error with changed payload, ensure a fresh key
    if (!indeterminateOp && lastSubmittedPayloadRef.current && !isSameTransferPayload(currentCanonical, lastSubmittedPayloadRef.current)) {
      activeKey = crypto.randomUUID();
      setTransferKey(activeKey);
      lastSubmittedPayloadRef.current = null;
    }

    transferringRef.current = true;
    setTransferring(true);
    setTransferError('');

    try {
      const res = await transferStudentClassroom(opStudentId, activePayload, activeKey);

      // Verify route/generation is still active before touching UI state
      const isStillActiveRoute =
        isMountedRef.current &&
        routeGenRef.current === opRouteGen &&
        activeRouteIdRef.current === opStudentId;

      if (isStillActiveRoute) {
        setShowTransferModal(false);
        setIndeterminateOp(null);
        indeterminateOpRef.current = null;
        lastSubmittedPayloadRef.current = null;
        setTransferKey(crypto.randomUUID());
        setTransferForm({ toClassroomId: '', reason: '', effectiveDate: getVietnamToday() });
        setNotice(res.data?.message || 'Đã chuyển lớp học sinh thành công.');
        load().catch(() => {});
      }
    } catch (err) {
      const isStillActiveRoute =
        isMountedRef.current &&
        routeGenRef.current === opRouteGen &&
        activeRouteIdRef.current === opStudentId;

      if (isStillActiveRoute) {
        if (isIndeterminateError(err)) {
          const indet = { key: activeKey, form: activePayload };
          setIndeterminateOp(indet);
          indeterminateOpRef.current = indet;
          setTransferError('Yêu cầu đang được xử lý hoặc chưa rõ kết quả từ máy chủ do lỗi kết nối/timeout. Thao tác thử lại sẽ dùng cùng mã yêu cầu để bảo đảm an toàn dữ liệu.');
        } else {
          lastSubmittedPayloadRef.current = activePayload;
          setTransferError(err.response?.data?.message || 'Không thể chuyển lớp.');
        }
      }
    } finally {
      if (activeTransferOpIdRef.current === opId) {
        activeTransferOpIdRef.current = null;
        transferringRef.current = false;
        if (isMountedRef.current) {
          setTransferring(false);
        }
      }
    }
  };

  const handleResetIndeterminate = async () => {
    if (transferringRef.current || transferring || refreshingRef.current || refreshing) return;
    if (!indeterminateOpRef.current && !indeterminateOp) return;

    const confirmMsg =
      'CẢNH BÁO: Thao tác này chỉ bỏ theo dõi yêu cầu trên trình duyệt và KHÔNG hủy giao dịch trên máy chủ. ' +
      'Yêu cầu chuyển lớp trước đó có thể đã được máy chủ tiếp nhận và xử lý thành công. ' +
      'Nếu tiếp tục, bạn sẽ không thể thử lại bằng mã yêu cầu (idempotency key) ban đầu.\n\n' +
      'Bạn có chắc chắn muốn bỏ theo dõi yêu cầu cũ để nhập thông tin mới?';

    if (!window.confirm(confirmMsg)) {
      return;
    }

    const snapshotStudentId = id;
    const snapshotGen = routeGenRef.current;
    const snapshotOp = indeterminateOpRef.current || indeterminateOp;
    const refreshOpId = crypto.randomUUID();
    activeRefreshOpIdRef.current = refreshOpId;
    refreshingRef.current = true;
    setRefreshing(true);
    setTransferError('');

    try {
      const loadRes = await load();
      if (loadRes?.cancelled) {
        return;
      }

      const isStillActive =
        isMountedRef.current &&
        routeGenRef.current === snapshotGen &&
        activeRouteIdRef.current === snapshotStudentId &&
        activeRefreshOpIdRef.current === refreshOpId &&
        (indeterminateOpRef.current?.key === snapshotOp?.key || indeterminateOp?.key === snapshotOp?.key);

      if (!isStillActive) {
        return;
      }

      setIndeterminateOp(null);
      indeterminateOpRef.current = null;
      lastSubmittedPayloadRef.current = null;
      setTransferKey(crypto.randomUUID());
      setTransferForm({ toClassroomId: '', reason: '', effectiveDate: getVietnamToday() });
      setTransferError('');
    } catch {
      const isStillActive =
        isMountedRef.current &&
        routeGenRef.current === snapshotGen &&
        activeRouteIdRef.current === snapshotStudentId &&
        activeRefreshOpIdRef.current === refreshOpId;

      if (isStillActive) {
        setTransferError('Không thể tải lại dữ liệu mới nhất từ máy chủ để làm mới giao diện. Vui lòng thử lại sau.');
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

  const remove = async () => {
    if (!window.confirm('Chuyển học sinh này sang trạng thái đã thôi học?')) return;
    try {
      await deleteStudent(id, 'Quản trị viên xóa hồ sơ học sinh');
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Không thể xóa hồ sơ.');
    }
  };

  const nextStatuses = transitions[student?.status] || [];

  // Filter eligible target classrooms (same schoolYear, active, not current classroom)
  const eligibleClasses = classes.filter((c) => {
    const isSameYear = !student?.schoolYear || !c.schoolYear || c.schoolYear === student.schoolYear;
    const isDifferentClass = String(c._id) !== String(student?.classroomId);
    const isActive = c.status === 'active';
    return isSameYear && isDifferentClass && isActive;
  });

  return (
    <AppShell title="Hồ sơ học sinh" subtitle="Tổng quan hồ sơ, điều chuyển lớp và lịch sử trạng thái.">
      <section className="content-card student-detail">
        {error && <div className="form-error" role="alert">{error}</div>}
        {notice && <div className="timekeeping-notice success" role="status">{notice}</div>}
        {!student && !error && <div className="inline-loader">Đang tải hồ sơ...</div>}
        {student && (
          <>
            <div className="student-profile-head">
              <div className="student-avatar large">{student.fullName.charAt(0)}</div>
              <div>
                <p className="card-kicker">{student.studentCode}</p>
                <h2>{student.fullName}</h2>
                <p>{student.currentClassName || 'Chưa xếp lớp'} · {labels[student.status]}</p>
              </div>
              <div className="student-head-actions">
                <Link className="button button-secondary" to="/students">Quay lại</Link>
                {canTransfer && ['enrolled', 'temporarily_absent'].includes(student.status) && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => { setTransferError(''); setShowTransferModal(true); }}
                  >
                    Chuyển lớp
                  </button>
                )}
                {['admin', 'teacher'].includes(role) && (
                  <Link className="button button-primary" to={`/students/${id}/edit`}>Chỉnh sửa</Link>
                )}
              </div>
            </div>

            <div className="student-detail-grid">
              <article className="student-qr-card">
                <QRCodeImage value={`STUDENT:${student.studentCode}`} size={126} label={`QR học sinh ${student.fullName}`} />
                <div>
                  <h3>QR qua cổng</h3>
                  <p>Bảo vệ quét mã này để tìm đúng hồ sơ và ghi nhận học sinh vào trường.</p>
                  <small>{student.studentCode}</small>
                </div>
              </article>

              <article>
                <h3>Thông tin tổng quan</h3>
                <dl>
                  <dt>Lớp học</dt><dd><strong>{student.currentClassName || '—'}</strong></dd>
                  <dt>Năm học</dt><dd>{student.schoolYear || '—'}</dd>
                  <dt>Ngày sinh</dt><dd>{new Date(student.birthDate).toLocaleDateString('vi-VN')}</dd>
                  <dt>Giới tính</dt><dd>{student.gender === 'female' ? 'Nữ' : 'Nam'}</dd>
                  <dt>Ngày nhập học</dt><dd>{student.admissionDate ? new Date(student.admissionDate).toLocaleDateString('vi-VN') : '—'}</dd>
                  <dt>Địa chỉ</dt><dd>{student.address || '—'}</dd>
                </dl>
              </article>

              <article>
                <h3>Ghi chú chuyên môn</h3>
                <p><b>Dị ứng:</b> {student.allergies?.map((item) => item.allergen).join(', ') || 'Không có dữ liệu'}</p>
                <p><b>Bệnh lý:</b> {student.disease?.name || 'Không có dữ liệu'}</p>
                <p><b>Ghi chú:</b> {student.notes || '—'}</p>
              </article>

              {role === 'teacher' && (
                <article>
                  <h3>Liên hệ và đón trẻ</h3>
                  <p><b>Liên hệ khẩn cấp:</b> {student.emergencyContact?.name || 'Chưa cập nhật'}{student.emergencyContact?.phone ? ` · ${student.emergencyContact.phone}` : ''}</p>
                  <div className="student-picker-list">
                    {student.authorizedPickers?.length ? student.authorizedPickers.map((picker, index) => (
                      <p key={`${picker.fullName}-${index}`}>
                        <b>{picker.fullName}</b> · {picker.relationship || 'Người được phép đón'}{picker.phone ? ` · ${picker.phone}` : ''}
                      </p>
                    )) : <p>Chưa khai báo người được phép đón.</p>}
                  </div>
                </article>
              )}

              {manager && (
                <article className="status-change">
                  <h3>Thay đổi trạng thái</h3>
                  {nextStatuses.length ? (
                    <>
                      <select value={status} onChange={(event) => setStatus(event.target.value)}>
                        {nextStatuses.map((key) => <option key={key} value={key}>{labels[key]}</option>)}
                      </select>
                      <button type="button" className="button button-primary" onClick={saveStatus}>Lưu trạng thái</button>
                    </>
                  ) : (
                    <p>Trạng thái này đã kết thúc. Muốn tiếp nhận lại, cần tạo quy trình/hồ sơ mới để lưu đúng lịch sử.</p>
                  )}
                </article>
              )}

              {manager && (
                <article className="student-danger-zone">
                  <h3>Xóa hồ sơ</h3>
                  <p>Xóa mềm: hồ sơ, điểm danh và học phí vẫn được lưu để đối soát; học sinh chỉ không còn trong danh sách đang theo học.</p>
                  <button type="button" className="button button-danger" onClick={remove}>Xóa hồ sơ</button>
                </article>
              )}
            </div>

            {/* Transfer History Section */}
            {transferHistory.length > 0 && (
              <div style={{ marginTop: '24px', padding: '0 4px' }}>
                <h3 style={{ margin: '0 0 12px', color: '#1e3a8a', fontSize: '17px' }}>Lịch sử chuyển lớp</h3>
                <div style={{ display: 'grid', gap: '10px' }}>
                  {transferHistory.map((item) => (
                    <article key={item._id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <strong style={{ color: '#1e293b' }}>
                          Lớp {item.fromClassName} → Lớp {item.toClassName}
                        </strong>
                        <small style={{ color: '#64748b' }}>
                          Hiệu lực: {new Date(item.effectiveDate).toLocaleDateString('vi-VN')}
                        </small>
                      </div>
                      <p style={{ margin: '4px 0', fontSize: '13px', color: '#475569' }}>
                        <b>Lý do:</b> {item.reason}
                      </p>
                      <small style={{ color: '#94a3b8' }}>
                        Người thực hiện: {item.transferredByName} · Năm học: {item.schoolYear}
                      </small>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {/* Transfer Modal */}
            {showTransferModal && (
              <div className="modal-backdrop">
                <form className="content-card student-form hr-modal handover-modal" onSubmit={handleTransfer}>
                  <div className="card-heading">
                    <div>
                      <p className="card-kicker">ĐIỀU CHUYỂN HỌC SINH</p>
                      <h2>Chuyển lớp cho học sinh {student.fullName}</h2>
                    </div>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={transferring || refreshing}
                      onClick={() => setShowTransferModal(false)}
                    >
                      Đóng
                    </button>
                  </div>

                  {transferError && <div className="form-error" role="alert">{transferError}</div>}

                  {indeterminateOp && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
                      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Thao tác trước đó chưa rõ kết quả phản hồi.</p>
                      <p style={{ margin: '0 0 8px' }}>
                        Nhấn &quot;Thử lại yêu cầu&quot; để gửi lại an toàn với cùng mã định danh (Idempotency-Key). Nút &quot;Bỏ theo dõi yêu cầu cũ &amp; Làm mới&quot; chỉ xóa trạng thái trên trình duyệt (không hủy giao dịch máy chủ).
                      </p>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={transferring || refreshing}
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={handleResetIndeterminate}
                      >
                        {refreshing ? 'Đang làm mới...' : 'Bỏ theo dõi yêu cầu cũ & Làm mới'}
                      </button>
                    </div>
                  )}

                  <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b' }}>
                    Lớp hiện tại: <b>{student.currentClassName || 'Chưa rõ'}</b> (Năm học {student.schoolYear || '2025-2026'}). Dữ liệu điểm danh, chăm sóc, học phí cũ của học sinh vẫn được bảo toàn.
                  </p>

                  <div className="student-form-grid">
                    <label className="form-wide">
                      Chọn lớp chuyển đến (cùng năm học {student.schoolYear})
                      <select
                        required
                        disabled={transferring || refreshing || !!indeterminateOp}
                        value={transferForm.toClassroomId}
                        onChange={(e) => handleFieldChange('toClassroomId', e.target.value)}
                      >
                        <option value="">-- Chọn lớp tiếp nhận --</option>
                        {eligibleClasses.map((c) => {
                          const currentCount = c.statistics?.currentStudents || 0;
                          const max = c.maxSize || 25;
                          const isFull = currentCount >= max;
                          return (
                            <option key={c._id} value={c._id} disabled={isFull}>
                              {c.name} ({currentCount}/{max} học sinh) {isFull ? '— [Đã đầy sĩ số]' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label className="form-wide">
                      Ngày hiệu lực chuyển lớp
                      <input
                        type="date"
                        required
                        disabled={transferring || refreshing || !!indeterminateOp}
                        value={transferForm.effectiveDate}
                        onChange={(e) => handleFieldChange('effectiveDate', e.target.value)}
                      />
                    </label>

                    <label className="form-wide">
                      Lý do chuyển lớp (bắt buộc)
                      <textarea
                        required
                        maxLength="1000"
                        rows="3"
                        disabled={transferring || refreshing || !!indeterminateOp}
                        value={transferForm.reason}
                        onChange={(e) => handleFieldChange('reason', e.target.value)}
                        placeholder="Ví dụ: Phụ huynh có đơn đề nghị chuyển lớp phù hợp với độ tuổi phát triển / chuyển sang lớp có bạn cùng khu vực..."
                      />
                    </label>
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={transferring || refreshing}
                      onClick={() => setShowTransferModal(false)}
                    >
                      Hủy bỏ
                    </button>
                    <button type="submit" className="button button-primary" disabled={transferring || refreshing}>
                      {transferring ? 'Đang chuyển...' : refreshing ? 'Đang làm mới...' : indeterminateOp ? 'Thử lại yêu cầu' : 'Xác nhận chuyển lớp'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
