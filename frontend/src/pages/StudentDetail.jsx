import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import QRCodeImage from '../components/QRCodeImage';
import {
  changeStudentStatus,
  deleteStudent,
  getStudent,
  transferStudentClassroom,
  getStudentTransferHistory,
  saveGrowthRecord,
  deleteGrowthRecord,
  addVaccinationRecord,
  deleteVaccinationRecord
} from '../api/students';
import { getVietnamToday } from '../utils/dateHelpers';
import api from '../api/axiosConfig';
import { generateClientId, getStoredUser } from '../utils/storage';

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
  const [transferKey, setTransferKey] = useState(() => generateClientId());
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

  const role = getStoredUser().role;
  const manager = role === 'admin';
  const canTransfer = ['admin', 'hr', 'principal'].includes(role);
  const canUpdateHealth = ['admin', 'principal', 'teacher'].includes(role);

  const currentYearMonth = getVietnamToday().slice(0, 7);
  const [growthForm, setGrowthForm] = useState({ month: currentYearMonth, weightKg: '', heightCm: '', note: '' });
  const [savingGrowth, setSavingGrowth] = useState(false);
  const [vaxForm, setVaxForm] = useState({ vaccineName: '', doseNumber: 1, vaccinatedDate: getVietnamToday(), status: 'completed', facility: '', note: '' });
  const [savingVax, setSavingVax] = useState(false);

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
    setTransferKey(generateClientId());
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
        setTransferKey(generateClientId());
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
    const opId = generateClientId();
    activeTransferOpIdRef.current = opId;

    let activeKey = indeterminateOp ? indeterminateOp.key : transferKey;
    const currentCanonical = getCanonicalTransferPayload(transferForm);
    const activePayload = indeterminateOp ? indeterminateOp.form : currentCanonical;

    // If retrying after a deterministic error with changed payload, ensure a fresh key
    if (!indeterminateOp && lastSubmittedPayloadRef.current && !isSameTransferPayload(currentCanonical, lastSubmittedPayloadRef.current)) {
      activeKey = generateClientId();
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
        setTransferKey(generateClientId());
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
    const refreshOpId = generateClientId();
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
      setTransferKey(generateClientId());
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

  const handleSaveGrowth = async (e) => {
    e.preventDefault();
    if (savingGrowth) return;
    setSavingGrowth(true);
    setError('');
    try {
      const res = await saveGrowthRecord(id, {
        month: growthForm.month,
        weightKg: Number(growthForm.weightKg),
        heightCm: Number(growthForm.heightCm),
        note: growthForm.note
      });
      setStudent(res.data?.data || student);
      setNotice(res.data?.message || 'Đã cập nhật cân nặng – chiều cao theo tháng.');
      setGrowthForm((prev) => ({ ...prev, weightKg: '', heightCm: '', note: '' }));
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể lưu chỉ số cân nặng – chiều cao.');
    } finally {
      setSavingGrowth(false);
    }
  };

  const handleDeleteGrowth = async (recordId) => {
    if (!window.confirm('Xóa bản ghi cân nặng – chiều cao tháng này?')) return;
    try {
      const res = await deleteGrowthRecord(id, recordId);
      setStudent(res.data?.data || student);
      setNotice('Đã xóa bản ghi cân đo tháng.');
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể xóa bản ghi cân đo.');
    }
  };

  const handleAddVaccination = async (e) => {
    e.preventDefault();
    if (savingVax) return;
    setSavingVax(true);
    setError('');
    try {
      const res = await addVaccinationRecord(id, {
        vaccineName: vaxForm.vaccineName,
        doseNumber: Number(vaxForm.doseNumber || 1),
        vaccinatedDate: vaxForm.vaccinatedDate || undefined,
        status: vaxForm.status,
        facility: vaxForm.facility,
        note: vaxForm.note
      });
      setStudent(res.data?.data || student);
      setNotice(res.data?.message || 'Đã lưu thông tin mũi tiêm chủng.');
      setVaxForm({ vaccineName: '', doseNumber: 1, vaccinatedDate: getVietnamToday(), status: 'completed', facility: '', note: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể thêm mũi tiêm chủng.');
    } finally {
      setSavingVax(false);
    }
  };

  const handleDeleteVaccination = async (vaxId) => {
    if (!window.confirm('Xóa mũi tiêm chủng này khỏi hồ sơ?')) return;
    try {
      const res = await deleteVaccinationRecord(id, vaxId);
      setStudent(res.data?.data || student);
      setNotice('Đã xóa thông tin mũi tiêm.');
    } catch (err) {
      setError(err.response?.data?.message || 'Không thể xóa mũi tiêm.');
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
                  <dt>Mã ID học sinh</dt><dd><strong>{student.studentCode || '—'}</strong></dd>
                  <dt>Mã định danh</dt><dd>{student.identityCode || '—'}</dd>
                  <dt>Số thẻ BHYT</dt><dd><strong>{student.healthInsuranceCode || 'Chưa cập nhật'}</strong></dd>
                  <dt>Nhóm máu</dt><dd>{student.bloodType ? `Nhóm ${student.bloodType}` : 'Chưa xác định'}</dd>
                  <dt>Lớp học</dt><dd><strong>{student.currentClassName || '—'}</strong></dd>
                  <dt>Năm học</dt><dd>{student.schoolYear || '—'}</dd>
                  <dt>Ngày sinh</dt><dd>{new Date(student.birthDate).toLocaleDateString('vi-VN')}</dd>
                  <dt>Giới tính</dt><dd>{student.gender === 'female' ? 'Nữ' : 'Nam'}</dd>
                  <dt>Ngày nhập học</dt><dd>{student.admissionDate ? new Date(student.admissionDate).toLocaleDateString('vi-VN') : '—'}</dd>
                  <dt>Địa chỉ</dt><dd>{student.address || '—'}</dd>
                </dl>
              </article>

              <article>
                <h3>Y tế & Ghi chú chuyên môn</h3>
                <p><b>Bảo hiểm y tế:</b> {student.healthInsuranceCode || 'Chưa cập nhật'} · <b>Nhóm máu:</b> {student.bloodType || 'Chưa rõ'}</p>
                <p><b>Dị ứng:</b> {student.allergies?.map((item) => item.allergen).join(', ') || 'Không có dữ liệu'}</p>
                <p><b>Bệnh lý:</b> {student.disease?.name || 'Không có dữ liệu'}</p>
                <p><b>Ghi chú:</b> {student.notes || '—'}</p>
              </article>

              {role !== 'hr' && (
                <article>
                  <h3>Phụ huynh & Liên hệ khẩn cấp</h3>
                  {student.parents?.length ? (
                    <div className="student-picker-list" style={{ marginBottom: '10px' }}>
                      {student.parents.map((parent, idx) => {
                        const relLabel = { father: 'Bố', mother: 'Mẹ', guardian: 'Người giám hộ' }[parent.relationship] || 'Phụ huynh';
                        return (
                          <p key={`${parent.fullName}-${idx}`}>
                            <b>Phụ huynh {idx + 1} ({relLabel}):</b> {parent.fullName}
                            {parent.phone ? ` · ${parent.phone}` : ''}
                            {parent.email ? ` · ${parent.email}` : ''}
                          </p>
                        );
                      })}
                    </div>
                  ) : (
                    <p><b>Phụ huynh:</b> Chưa khai báo thông tin phụ huynh.</p>
                  )}
                  <p>
                    <b>Liên hệ khẩn cấp:</b> {student.emergencyContact?.name || 'Chưa cập nhật'}
                    {student.emergencyContact?.phone ? ` · ${student.emergencyContact.phone}` : ''}
                  </p>
                  {role === 'teacher' && (
                    <div className="student-picker-list" style={{ marginTop: '8px' }}>
                      {student.authorizedPickers?.length ? student.authorizedPickers.map((picker, index) => (
                        <p key={`${picker.fullName}-${index}`}>
                          <b>Người đón: {picker.fullName}</b> · {picker.relationship || 'Người được phép đón'}{picker.phone ? ` · ${picker.phone}` : ''}
                        </p>
                      )) : <p>Chưa khai báo người được phép đón.</p>}
                    </div>
                  )}
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

            {/* Khu vực theo dõi Thể chất theo tháng & Sổ tiêm chủng */}
            <div style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '18px' }}>
              <section style={{ border: '1px solid #dbe6f7', borderRadius: '16px', padding: '18px', background: '#fbfdff' }}>
                <div style={{ marginBottom: '12px' }}>
                  <p className="card-kicker">PHÁT TRIỂN THỂ CHẤT</p>
                  <h3 style={{ margin: '4px 0', color: '#1e3a8a', fontSize: '17px' }}>Cân nặng & Chiều cao theo tháng</h3>
                  <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b' }}>
                    Ghi nhận số đo định kỳ hàng tháng để theo dõi tốc độ tăng trưởng và thể trạng dinh dưỡng của trẻ.
                  </p>
                </div>

                {canUpdateHealth && (
                  <form onSubmit={handleSaveGrowth} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#f1f6ff', border: '1px solid #dce7fb' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Tháng đo *
                      <input
                        type="month"
                        required
                        value={growthForm.month}
                        onChange={(e) => setGrowthForm({ ...growthForm, month: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Cân nặng (kg) *
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="120"
                        required
                        placeholder="VD: 14.5"
                        value={growthForm.weightKg}
                        onChange={(e) => setGrowthForm({ ...growthForm, weightKg: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Chiều cao (cm) *
                      <input
                        type="number"
                        step="0.1"
                        min="30"
                        max="200"
                        required
                        placeholder="VD: 96.5"
                        value={growthForm.heightCm}
                        onChange={(e) => setGrowthForm({ ...growthForm, heightCm: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', gridColumn: '1 / -1' }}>
                      Nhận xét / Ghi chú tháng
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <input
                          placeholder="VD: Bé ăn ngon miệng, tăng 0.4kg"
                          value={growthForm.note}
                          onChange={(e) => setGrowthForm({ ...growthForm, note: e.target.value })}
                          style={{ flex: 1 }}
                        />
                        <button type="submit" className="button button-primary" disabled={savingGrowth}>
                          {savingGrowth ? 'Đang lưu...' : 'Lưu chỉ số'}
                        </button>
                      </div>
                    </label>
                  </form>
                )}

                {student.growthRecords?.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Tháng</th>
                          <th>Cân nặng</th>
                          <th>Chiều cao</th>
                          <th>BMI & Thể trạng</th>
                          {canUpdateHealth && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {student.growthRecords.map((rec, idx) => {
                          const prev = student.growthRecords[idx + 1];
                          const diffW = prev ? Number((rec.weightKg - prev.weightKg).toFixed(1)) : null;
                          const diffH = prev ? Number((rec.heightCm - prev.heightCm).toFixed(1)) : null;
                          return (
                            <tr key={rec._id || rec.month}>
                              <td><strong>{rec.month ? rec.month.split('-').reverse().join('/') : '—'}</strong></td>
                              <td>
                                <strong>{rec.weightKg} kg</strong>
                                {diffW !== null && (
                                  <small style={{ display: 'block', color: diffW >= 0 ? '#15803d' : '#b45309' }}>
                                    {diffW >= 0 ? `+${diffW}` : diffW} kg
                                  </small>
                                )}
                              </td>
                              <td>
                                <strong>{rec.heightCm} cm</strong>
                                {diffH !== null && (
                                  <small style={{ display: 'block', color: diffH >= 0 ? '#15803d' : '#64748b' }}>
                                    {diffH >= 0 ? `+${diffH}` : diffH} cm
                                  </small>
                                )}
                              </td>
                              <td>
                                <div>BMI: <b>{rec.bmi || '—'}</b> · {rec.nutritionStatus || 'Bình thường'}</div>
                                {rec.note && <small style={{ color: '#64748b' }}>{rec.note}</small>}
                              </td>
                              {canUpdateHealth && (
                                <td>
                                  {rec._id && (
                                    <button
                                      type="button"
                                      className="button button-secondary"
                                      style={{ minHeight: '28px', padding: '0 8px', fontSize: '11px' }}
                                      onClick={() => handleDeleteGrowth(rec._id)}
                                    >
                                      Xóa
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Chưa có bản ghi cân nặng – chiều cao theo tháng.</p>
                )}
              </section>

              <section style={{ border: '1px solid #dbe6f7', borderRadius: '16px', padding: '18px', background: '#fbfdff' }}>
                <div style={{ marginBottom: '12px' }}>
                  <p className="card-kicker">Y TẾ HỌC ĐƯỜNG</p>
                  <h3 style={{ margin: '4px 0', color: '#1e3a8a', fontSize: '17px' }}>Sổ theo dõi tiêm chủng</h3>
                  <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b' }}>
                    Lưu trữ các mũi vắc-xin đã tiêm hoặc lịch hẹn tiêm nhắc lại của bé.
                  </p>
                </div>

                {canUpdateHealth && (
                  <form onSubmit={handleAddVaccination} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '14px', padding: '12px', borderRadius: '12px', background: '#f1f6ff', border: '1px solid #dce7fb' }}>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', gridColumn: 'span 2' }}>
                      Tên vắc-xin *
                      <input
                        list="preschool-vaccine-presets"
                        required
                        placeholder="VD: Sởi - Rubella, Viêm não Nhật Bản..."
                        value={vaxForm.vaccineName}
                        onChange={(e) => setVaxForm({ ...vaxForm, vaccineName: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                      <datalist id="preschool-vaccine-presets">
                        <option value="Lao (BCG)" />
                        <option value="Viêm gan B" />
                        <option value="6 trong 1 (Bạch hầu - Ho gà - Uốn ván - Bại liệt - Hib - VGB)" />
                        <option value="Sởi - Quai bị - Rubella (MMR)" />
                        <option value="Viêm não Nhật Bản" />
                        <option value="Thủy đậu" />
                        <option value="Phế cầu" />
                        <option value="Tiêu chảy cấp Rota" />
                        <option value="Cúm mùa" />
                      </datalist>
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Mũi số *
                      <input
                        type="number"
                        min="1"
                        max="20"
                        required
                        value={vaxForm.doseNumber}
                        onChange={(e) => setVaxForm({ ...vaxForm, doseNumber: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Ngày tiêm
                      <input
                        type="date"
                        value={vaxForm.vaccinatedDate}
                        onChange={(e) => setVaxForm({ ...vaxForm, vaccinatedDate: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      />
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>
                      Trạng thái
                      <select
                        value={vaxForm.status}
                        onChange={(e) => setVaxForm({ ...vaxForm, status: e.target.value })}
                        style={{ width: '100%', marginTop: '4px' }}
                      >
                        <option value="completed">Đã tiêm</option>
                        <option value="scheduled">Lịch hẹn</option>
                        <option value="missed">Tạm hoãn / Chưa tiêm</option>
                      </select>
                    </label>
                    <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155', gridColumn: '1 / -1' }}>
                      Cơ sở tiêm / Ghi chú
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        <input
                          placeholder="VD: Trạm y tế phường / VNVC"
                          value={vaxForm.facility}
                          onChange={(e) => setVaxForm({ ...vaxForm, facility: e.target.value })}
                          style={{ flex: 1 }}
                        />
                        <button type="submit" className="button button-primary" disabled={savingVax}>
                          {savingVax ? 'Đang lưu...' : 'Thêm mũi tiêm'}
                        </button>
                      </div>
                    </label>
                  </form>
                )}

                {student.vaccinations?.length ? (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Vắc-xin</th>
                          <th>Mũi</th>
                          <th>Ngày tiêm</th>
                          <th>Trạng thái</th>
                          {canUpdateHealth && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {student.vaccinations.map((v, idx) => (
                          <tr key={v._id || idx}>
                            <td>
                              <strong>{v.vaccineName}</strong>
                              {(v.facility || v.note) && (
                                <small style={{ display: 'block', color: '#64748b' }}>
                                  {[v.facility, v.note].filter(Boolean).join(' · ')}
                                </small>
                              )}
                            </td>
                            <td>Mũi {v.doseNumber || 1}</td>
                            <td>{v.vaccinatedDate ? new Date(v.vaccinatedDate).toLocaleDateString('vi-VN') : '—'}</td>
                            <td>
                              <span className={`student-status ${v.status === 'completed' ? 'enrolled' : 'temporarily_absent'}`}>
                                {v.status === 'completed' ? 'Đã tiêm' : v.status === 'scheduled' ? 'Lịch hẹn' : 'Chưa tiêm'}
                              </span>
                            </td>
                            {canUpdateHealth && (
                              <td>
                                {v._id && (
                                  <button
                                    type="button"
                                    className="button button-secondary"
                                    style={{ minHeight: '28px', padding: '0 8px', fontSize: '11px' }}
                                    onClick={() => handleDeleteVaccination(v._id)}
                                  >
                                    Xóa
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Chưa có dữ liệu mũi tiêm chủng nào được khai báo.</p>
                )}
              </section>
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
            {showTransferModal && createPortal(
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
              </div>,
              document.body
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
