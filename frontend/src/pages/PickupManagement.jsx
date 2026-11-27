import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import StudentPagination from '../components/StudentPagination';
import QrCodeImage from '../components/QrCodeImage';
import api from '../api/axiosConfig';
import { getStoredUser } from '../utils/storage';
import {
  cancelScheduledPickup,
  confirmScheduledPickup,
  createPickupRequest,
  directHandoverPickup,
  getClassroomPickupRoster,
  getPickupClassrooms,
  getPickups,
  requestGuardPickupOtp,
  searchGuardStudents,
  undoHandoverPickup,
  verifyGuardPickupOtp
} from '../api/pickups';

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const dateText = (value) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString('vi-VN') : '—');
const statusText = { scheduled: 'Chờ bàn giao', confirmed: 'Đã bàn giao', cancelled: 'Đã hủy' };
const attendanceBadgeText = {
  present: 'Có mặt',
  late: 'Đi muộn',
  absent: 'Vắng không phép',
  absent_permission: 'Nghỉ có phép',
  unmarked: 'Chưa điểm danh sáng'
};
const CUSTOM_PICKER_KEY = '__CUSTOM__';
const emptyPicker = { fullName: '', phone: '', relationship: '', photoURL: '', vehicleType: '', vehiclePlate: '', isActive: true };
const emptyOtpPicker = { studentId: '', fullName: '', phone: '', relationship: '', identityCardLast4: '', photoURL: '', vehicleType: '', vehiclePlate: '' };

export default function PickupManagement({ embedded = false, classroomId = '', filterDate = '' }) {
  const [searchParams] = useSearchParams();
  const role = getStoredUser().role;
  const isParent = role === 'parent';

  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [pickupDate, setPickupDate] = useState(filterDate || today());
  const [records, setRecords] = useState([]);
  const [recordPage, setRecordPage] = useState(1);
  const [pickers, setPickers] = useState([]);
  const [form, setForm] = useState({ pickerId: '', expectedPickupTime: '', note: '' });
  const [pickerForm, setPickerForm] = useState(emptyPicker);
  const [pickerToRemove, setPickerToRemove] = useState(null);
  const [confirmationRecord, setConfirmationRecord] = useState(null);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [confirmationNote, setConfirmationNote] = useState('');
  const [photoCompared, setPhotoCompared] = useState(false);
  const [vehicleCompared, setVehicleCompared] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpStudents, setOtpStudents] = useState([]);
  const [otpSearch, setOtpSearch] = useState('');
  const [otpForm, setOtpForm] = useState(emptyOtpPicker);
  const [otpChallenge, setOtpChallenge] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordStatus, setRecordStatus] = useState('');
  const [state, setState] = useState({ loading: true, saving: false, error: '', success: '' });

  // Luồng trả trẻ trực tiếp 1 chạm tại lớp cho Giáo viên / Bảo vệ / BGH
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(classroomId || '');
  const [rosterData, setRosterData] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [onlyPresentStudents, setOnlyPresentStudents] = useState(true);
  const [rosterSearch, setRosterSearch] = useState('');
  const [selectedPickerByStudent, setSelectedPickerByStudent] = useState({});
  const [customPickerByStudent, setCustomPickerByStudent] = useState({});
  const [handoverStudentId, setHandoverStudentId] = useState('');

  const selected = useMemo(() => students.find((item) => item._id === selectedId), [students, selectedId]);
  const activeClassId = classroomId || selectedClassId;
  const isTodaySelected = pickupDate === today();

  useEffect(() => {
    if (filterDate) {
      setPickupDate(filterDate);
    }
  }, [filterDate]);

  useEffect(() => {
    if (classroomId) {
      setSelectedClassId(classroomId);
    }
  }, [classroomId]);

  const loadClassroomsForStaff = useCallback(async () => {
    if (isParent || classroomId) return;
    try {
      const res = await getPickupClassrooms();
      const list = res.data?.data || [];
      setClassrooms(list);
      setSelectedClassId((prev) => prev || list[0]?._id || '');
    } catch {
      // Không chặn trang nếu nhân sự (như bảo vệ ở một số chế độ) không có danh sách lớp riêng
    }
  }, [isParent, classroomId]);

  const loadRoster = useCallback(async (targetClassroomId) => {
    if (isParent || !targetClassroomId) {
      setRosterData(null);
      return;
    }
    setRosterLoading(true);
    try {
      const res = await getClassroomPickupRoster(targetClassroomId, pickupDate);
      const data = res.data?.data || null;
      setRosterData(data);
      if (data?.roster) {
        setSelectedPickerByStudent((prev) => {
          const next = { ...prev };
          for (const item of data.roster) {
            const sid = String(item.studentId);
            if (next[sid]) continue;
            if (item.scheduledPickup?.picker?.pickerId) {
              const matched = item.pickerOptions.find((opt) => opt.pickerId === String(item.scheduledPickup.picker.pickerId));
              if (matched) {
                next[sid] = matched.key;
                continue;
              }
            }
            next[sid] = item.pickerOptions[0]?.key || CUSTOM_PICKER_KEY;
          }
          return next;
        });
      }
    } catch {
      setRosterData(null);
    } finally {
      setRosterLoading(false);
    }
  }, [isParent, pickupDate]);

  const loadStudents = useCallback(async () => {
    if (!isParent) return;
    const response = await api.get('/students', { params: { status: 'all', limit: 100, sortBy: 'fullName' } });
    const items = response.data.data || [];
    const details = await Promise.all(items.map((student) => api.get(`/students/${student._id}`)));
    const enriched = details.map((res, index) => res.data.data || items[index]);
    setStudents(enriched);
    setSelectedId((value) => value || enriched[0]?._id || '');
  }, [isParent]);

  const loadRecords = useCallback(async () => {
    const response = await getPickups({
      pickupDate,
      ...(activeClassId && !isParent ? { classroomId: activeClassId } : {}),
      ...(isParent && selectedId ? { studentId: selectedId } : {})
    });
    setRecords(response.data.data || []);
  }, [isParent, pickupDate, selectedId, activeClassId]);

  const load = useCallback(async () => {
    try {
      setState((old) => ({ ...old, loading: true, error: '' }));
      await Promise.all([loadStudents(), loadClassroomsForStaff(), loadRecords()]);
      if (!isParent && activeClassId) {
        await loadRoster(activeClassId);
      }
      setState((old) => ({ ...old, loading: false }));
    } catch (error) {
      setState({ loading: false, saving: false, success: '', error: error.response?.data?.message || 'Không thể tải lịch đón trẻ.' });
    }
  }, [loadRecords, loadStudents, loadClassroomsForStaff, loadRoster, isParent, activeClassId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (selected) setPickers(selected.authorizedPickers || []);
  }, [selected]);

  const handleDirectHandover = async (rosterItem) => {
    const sid = String(rosterItem.studentId);
    if (handoverStudentId) return;
    const optionsList = Array.isArray(rosterItem.pickerOptions) ? rosterItem.pickerOptions : [];
    const chosenKey = selectedPickerByStudent[sid] || optionsList[0]?.key || CUSTOM_PICKER_KEY;
    const chosenOption = optionsList.find((opt) => opt.key === chosenKey);
    const customInfo = customPickerByStudent[sid] || { fullName: '', relationship: 'Người thân', phone: '' };

    if (chosenKey === CUSTOM_PICKER_KEY && !String(customInfo.fullName || '').trim()) {
      setState((old) => ({ ...old, error: `Vui lòng nhập họ tên người đón cho bé ${rosterItem.fullName}.`, success: '' }));
      return;
    }

    // Cảnh báo an toàn nếu buổi sáng bé đang được ghi nhận Vắng mặt / Nghỉ có phép nhưng buổi chiều bấm Trả trẻ
    let confirmedAbsentOverride = false;
    if (rosterItem.attendanceStatus === 'absent' || rosterItem.attendanceStatus === 'absent_permission') {
      const ok = window.confirm(
        `Lưu ý: Bé ${rosterItem.fullName} sáng nay đang được ghi nhận "${attendanceBadgeText[rosterItem.attendanceStatus]}". Bạn có chắc chắn bé có mặt tại lớp và xác nhận trả trẻ không?`
      );
      if (!ok) return;
      confirmedAbsentOverride = true;
    }

    setHandoverStudentId(sid);
    setState((old) => ({ ...old, error: '', success: '' }));
    try {
      const payload = {
        studentId: rosterItem.studentId,
        pickupDate,
        ...(confirmedAbsentOverride ? { forceAbsentHandover: true } : {}),
        ...(chosenOption
          ? {
              pickerKey: chosenOption.key,
              pickerId: chosenOption.pickerId || undefined,
              pickerFullName: chosenOption.fullName,
              pickerPhone: chosenOption.phone,
              pickerRelationship: chosenOption.relationship
            }
          : {
              pickerFullName: String(customInfo.fullName || '').trim(),
              pickerPhone: String(customInfo.phone || '').trim(),
              pickerRelationship: String(customInfo.relationship || 'Người thân').trim()
            })
      };
      const res = await directHandoverPickup(payload);
      await Promise.all([loadRoster(activeClassId), loadRecords()]);
      setState((old) => ({ ...old, success: res.data?.message || `Đã xác nhận trả bé ${rosterItem.fullName}.` }));
    } catch (error) {
      setState((old) => ({
        ...old,
        error: error.response?.data?.message || 'Không thể xác nhận trả trẻ.',
        success: ''
      }));
    } finally {
      setHandoverStudentId('');
    }
  };

  const handleUndoHandover = async (rosterItem) => {
    if (!rosterItem.confirmedPickupId || handoverStudentId) return;
    const ok = window.confirm(
      `Hoàn tác trạng thái đã đón của bé ${rosterItem.fullName} (do bấm nhầm hoặc cần chọn lại người đón)?`
    );
    if (!ok) return;

    const sid = String(rosterItem.studentId);
    setHandoverStudentId(sid);
    setState((old) => ({ ...old, error: '', success: '' }));
    try {
      const res = await undoHandoverPickup(rosterItem.confirmedPickupId, 'Hoàn tác thao tác trả trẻ tại lớp');
      await Promise.all([loadRoster(activeClassId), loadRecords()]);
      setState((old) => ({ ...old, success: res.data?.message || `Đã hoàn tác trạng thái đón của bé ${rosterItem.fullName}.` }));
    } catch (error) {
      setState((old) => ({
        ...old,
        error: error.response?.data?.message || 'Không thể hoàn tác bàn giao.',
        success: ''
      }));
    } finally {
      setHandoverStudentId('');
    }
  };

  const savePickers = async () => {
    if (!selected) return;
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const authorizedPickers = pickers.map((picker) => {
        const { _id, ...rest } = picker;
        return String(_id || '').startsWith('new-') ? rest : { _id, ...rest };
      });
      await api.post('/student-profile-change-requests', { studentId: selected._id, changes: { authorizedPickers } });
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi thay đổi danh sách người đón để nhà trường phê duyệt.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể lưu người được ủy quyền.', success: '' }));
    }
  };

  const addPicker = () => {
    if (!pickerForm.fullName.trim()) {
      return setState((old) => ({ ...old, error: 'Vui lòng nhập họ tên người được ủy quyền.', success: '' }));
    }
    setPickers((items) => [...items, { ...pickerForm, fullName: pickerForm.fullName.trim(), _id: `new-${Date.now()}` }]);
    setPickerForm(emptyPicker);
    setState((old) => ({ ...old, error: '' }));
  };

  const removePicker = async () => {
    if (pickerToRemove == null) return;
    const remaining = pickers.filter((_, index) => index !== pickerToRemove);
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const authorizedPickers = remaining.map((picker) => {
        const { _id, ...rest } = picker;
        return String(_id || '').startsWith('new-') ? rest : { _id, ...rest };
      });
      setPickerToRemove(null);
      await api.post('/student-profile-change-requests', { studentId: selected._id, changes: { authorizedPickers } });
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi yêu cầu xóa người được ủy quyền để nhà trường phê duyệt.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xóa người được ủy quyền.', success: '' }));
    }
  };

  const submitPickup = async (event) => {
    event.preventDefault();
    if (!selected || !form.pickerId) return;
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      await createPickupRequest({ studentId: selected._id, pickupDate, ...form });
      setForm({ pickerId: '', expectedPickupTime: '', note: '' });
      await loadRecords();
      setState({ loading: false, saving: false, error: '', success: 'Đã gửi đăng ký đón trẻ. Vui lòng nhắc người đón mang giấy tờ tùy thân.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể đăng ký đón trẻ.', success: '' }));
    }
  };

  const confirm = async (id) => {
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      await confirmScheduledPickup(id, { identityVerified, confirmationNote, photoCompared, vehicleCompared });
      await Promise.all([loadRecords(), activeClassId ? loadRoster(activeClassId) : Promise.resolve()]);
      setConfirmationRecord(null);
      setState({ loading: false, saving: false, error: '', success: 'Đã xác nhận bàn giao trẻ và gửi thông báo cho phụ huynh.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xác nhận bàn giao.', success: '' }));
    }
  };

  const searchOtpStudents = async () => {
    try {
      const response = await searchGuardStudents({ search: otpSearch, page: 1 });
      setOtpStudents(response.data.data || []);
    } catch (error) {
      setState((old) => ({ ...old, error: error.response?.data?.message || 'Không thể tìm học sinh.' }));
    }
  };

  const requestOtp = async (event) => {
    event.preventDefault();
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      const response = await requestGuardPickupOtp(otpForm);
      setOtpChallenge(response.data.data);
      setState((old) => ({ ...old, saving: false, success: response.data.message }));
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể gửi OTP.' }));
    }
  };

  const verifyOtp = async () => {
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      await verifyGuardPickupOtp(otpChallenge.challengeId, otpCode);
      await Promise.all([loadRecords(), activeClassId ? loadRoster(activeClassId) : Promise.resolve()]);
      setShowOtpModal(false);
      setOtpChallenge(null);
      setOtpCode('');
      setOtpForm(emptyOtpPicker);
      setState((old) => ({ ...old, saving: false, success: 'OTP hợp lệ. Đã tạo lịch đón thay trong hôm nay.' }));
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể xác nhận OTP.' }));
    }
  };

  const cancel = async (id) => {
    try {
      setState((old) => ({ ...old, saving: true, error: '', success: '' }));
      await cancelScheduledPickup(id, {});
      await loadRecords();
      setState({ loading: false, saving: false, error: '', success: 'Đã hủy lịch đón trẻ.' });
    } catch (error) {
      setState((old) => ({ ...old, saving: false, error: error.response?.data?.message || 'Không thể hủy lịch đón trẻ.', success: '' }));
    }
  };

  const visibleRoster = useMemo(() => {
    const items = rosterData?.roster || [];
    const hasAnyMorningPresent = items.some((it) => it.isPresentToday);
    return items.filter((it) => {
      if (onlyPresentStudents && hasAnyMorningPresent && !it.isPresentToday && !it.departed) {
        return false;
      }
      if (rosterSearch.trim()) {
        const q = rosterSearch.trim().toLocaleLowerCase('vi');
        return `${it.fullName} ${it.studentCode || ''}`.toLocaleLowerCase('vi').includes(q);
      }
      return true;
    });
  }, [rosterData, onlyPresentStudents, rosterSearch]);

  const visibleRecords = records.filter(
    (record) =>
      (!searchParams.get('studentId') || String(record.studentId) === searchParams.get('studentId')) &&
      (!recordStatus || record.status === recordStatus) &&
      `${record.studentName} ${record.className} ${record.picker?.fullName}`.toLocaleLowerCase('vi').includes(recordSearch.toLocaleLowerCase('vi'))
  );
  const currentRecordPage = Math.min(recordPage, Math.max(1, Math.ceil(visibleRecords.length / 10)));

  const content = (
    <>
      {state.error && <div className="form-error">{state.error}</div>}
      {state.success && <div className="timekeeping-notice success">{state.success}</div>}

      {!embedded && (
        <section className="pickup-toolbar content-card">
          <label>
            Ngày đón
            <input
              type="date"
              value={pickupDate}
              onChange={(event) => {
                setPickupDate(event.target.value);
                setRecordPage(1);
              }}
            />
          </label>
          {!isParent && classrooms.length > 0 && (
            <label>
              Lớp trả trẻ nhanh
              <select
                value={selectedClassId}
                onChange={(event) => {
                  setSelectedClassId(event.target.value);
                  setRecordPage(1);
                }}
              >
                {classrooms.map((cls) => (
                  <option key={cls._id} value={cls._id}>
                    {cls.name} {cls.campus && cls.campus !== 'Cơ sở chính' ? `(${cls.campus})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isParent && students.length > 1 && (
            <label>
              Học sinh
              <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                {students.map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.fullName} · {student.currentClassName || 'Chưa xếp lớp'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isParent && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="button button-secondary" onClick={load} disabled={state.loading}>
                <Icon name="refresh" size={16} /> Làm mới
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setShowOtpModal(true);
                  setOtpChallenge(null);
                  void searchOtpStudents();
                }}
              >
                <Icon name="phone" size={16} /> Người đón lạ (OTP)
              </button>
            </div>
          )}
        </section>
      )}

      {/* BẢNG TRẢ TRẺ 1 CHẠM TẠI LỚP CHO GIÁO VIÊN / BẢO VỆ / BAN GIÁM HIỆU */}
      {!isParent && activeClassId && (
        <section className="content-card student-list-card" style={{ marginBottom: '18px' }}>
          <div className="list-toolbar" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <p className="card-kicker">TRẢ TRẺ TRỰC TIẾP TẠI LỚP</p>
              <h2>
                {rosterData?.classroom?.name ? `Lớp ${rosterData.classroom.name}` : 'Danh sách trả trẻ'} · Ngày {dateText(pickupDate)}
              </h2>
              <p>
                Chọn Bố/Mẹ hoặc người được ủy quyền trong hồ sơ rồi bấm <strong>Trả trẻ</strong> (không bắt buộc phụ huynh phải đặt lịch trước trên web).
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {rosterData?.summary && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
                  <span className="student-status enrolled">Có mặt: {rosterData.summary.presentCount}</span>
                  <span className="student-status temporarily_absent">Chờ đón: {rosterData.summary.waitingCount}</span>
                  <span className="student-status pickup-confirmed">Đã về: {rosterData.summary.departedCount}</span>
                </div>
              )}
              {embedded && (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    setShowOtpModal(true);
                    setOtpChallenge(null);
                    void searchOtpStudents();
                  }}
                >
                  <Icon name="phone" size={15} /> Người đón lạ (OTP)
                </button>
              )}
            </div>
          </div>

          <div className="student-filters" style={{ padding: '0 22px 14px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="search-box" style={{ minWidth: '240px' }}>
              <Icon name="search" size={16} />
              <input
                value={rosterSearch}
                onChange={(e) => setRosterSearch(e.target.value)}
                placeholder="Tìm tên bé hoặc mã học sinh..."
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={onlyPresentStudents}
                onChange={(e) => setOnlyPresentStudents(e.target.checked)}
              />
              Ưu tiên hiện trẻ có mặt hôm nay
            </label>
            {rosterData?.summary?.presentCount === 0 && rosterData?.summary?.totalStudents > 0 && (
              <small style={{ color: '#b45309', fontWeight: 600 }}>
                Lưu ý: Lớp chưa ghi nhận điểm danh buổi sáng nên đang hiển thị toàn bộ học sinh của lớp.
              </small>
            )}
          </div>

          {rosterLoading ? (
            <div className="inline-loader"><span className="loading-orb" />Đang tải danh sách lớp...</div>
          ) : visibleRoster.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Học sinh</th>
                    <th>Điểm danh sáng</th>
                    <th>Người đón (Bố / Mẹ / Ủy quyền)</th>
                    <th>Trạng thái / Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRoster.map((item) => {
                    const sid = String(item.studentId);
                    const selectedKey = selectedPickerByStudent[sid] || item.pickerOptions[0]?.key || CUSTOM_PICKER_KEY;
                    const isCustom = selectedKey === CUSTOM_PICKER_KEY;
                    const customVal = customPickerByStudent[sid] || { fullName: '', relationship: 'Người thân', phone: '' };
                    const isSubmittingThis = handoverStudentId === sid;

                    return (
                      <tr key={sid}>
                        <td>
                          <strong>{item.fullName}</strong>
                          <small style={{ display: 'block', color: '#64748b' }}>Mã HS: {item.studentCode}</small>
                          {item.scheduledPickup && !item.departed && (
                            <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '12px', color: '#0369a1', fontWeight: 600 }}>
                              PH hẹn đón: {item.scheduledPickup.picker?.fullName}
                              {item.scheduledPickup.expectedPickupTime ? ` (${item.scheduledPickup.expectedPickupTime})` : ''}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`status-badge ${item.attendanceStatus === 'unmarked' ? 'absent_permission' : item.attendanceStatus}`}>
                            <i />
                            {attendanceBadgeText[item.attendanceStatus] || item.attendanceStatus}
                          </span>
                        </td>
                        <td>
                          {item.departed ? (
                            <div>
                              <strong>{item.departedPickerName || 'Phụ huynh'}</strong>
                              {item.departedRelationship && <small> ({item.departedRelationship})</small>}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '340px' }}>
                              <select
                                value={selectedKey}
                                disabled={!isTodaySelected || isSubmittingThis}
                                onChange={(e) => setSelectedPickerByStudent((prev) => ({ ...prev, [sid]: e.target.value }))}
                                style={{ padding: '7px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                              >
                                {item.pickerOptions.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.relationship}: {opt.fullName}{opt.phone ? ` · ${opt.phone}` : ''}
                                  </option>
                                ))}
                                <option value={CUSTOM_PICKER_KEY}>+ Nhập người đón khác...</option>
                              </select>
                              {isCustom && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 1fr', gap: '6px' }}>
                                  <input
                                    placeholder="Họ tên người đón *"
                                    value={customVal.fullName}
                                    onChange={(e) =>
                                      setCustomPickerByStudent((prev) => ({
                                        ...prev,
                                        [sid]: { ...customVal, fullName: e.target.value }
                                      }))
                                    }
                                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                  />
                                  <input
                                    placeholder="Quan hệ (Ông/Bà...)"
                                    value={customVal.relationship}
                                    onChange={(e) =>
                                      setCustomPickerByStudent((prev) => ({
                                        ...prev,
                                        [sid]: { ...customVal, relationship: e.target.value }
                                      }))
                                    }
                                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                  />
                                  <input
                                    placeholder="SĐT người đón"
                                    value={customVal.phone || ''}
                                    onChange={(e) =>
                                      setCustomPickerByStudent((prev) => ({
                                        ...prev,
                                        [sid]: { ...customVal, phone: e.target.value }
                                      }))
                                    }
                                    style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          {item.departed ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <div>
                                <span className="student-status enrolled">
                                  ✓ Đã đón {item.departedAt ? new Date(item.departedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : ''}
                                </span>
                                {item.departedConfirmedBy && (
                                  <small style={{ display: 'block', color: '#64748b', marginTop: '3px' }}>
                                    GV: {item.departedConfirmedBy}
                                  </small>
                                )}
                              </div>
                              {isTodaySelected && item.confirmedPickupId && (
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  disabled={Boolean(handoverStudentId)}
                                  onClick={() => handleUndoHandover(item)}
                                  title="Hoàn tác nếu bấm nhầm học sinh hoặc chọn nhầm người đón"
                                  style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                  {isSubmittingThis ? 'Đang xử lý...' : 'Hoàn tác'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={!isTodaySelected || Boolean(handoverStudentId)}
                              onClick={() => handleDirectHandover(item)}
                            >
                              {isSubmittingThis ? 'Đang lưu...' : 'Trả trẻ'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact">Không có học sinh phù hợp trong danh sách trả trẻ.</div>
          )}
        </section>
      )}

      {isParent && selected && (
        <section className="pickup-parent-grid">
          <article className="content-card pickup-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">DANH SÁCH ỦY QUYỀN</p>
                <h2>Người được phép đón {selected.fullName}</h2>
              </div>
              <span className="history-count">{pickers.filter((item) => item.isActive !== false).length} người hoạt động</span>
            </div>
            <p className="pickup-help">Bố/Mẹ trong hồ sơ đã được thêm sẵn. Bạn có thể đăng ký thêm Ông/Bà hoặc người thân được phép đón bé.</p>
            <div className="pickup-picker-list">
              {pickers.length ? pickers.map((picker, index) => (
                <article key={picker._id || index}>
                  {picker.photoURL ? <img className="pickup-picker-avatar" src={picker.photoURL} alt={picker.fullName} /> : <span className="student-avatar">{picker.fullName?.charAt(0) || 'N'}</span>}
                  <div>
                    <strong>{picker.fullName}</strong>
                    <small>{picker.relationship || 'Người được ủy quyền'} {picker.phone ? `· ${picker.phone}` : ''}</small>
                    {(picker.vehicleType || picker.vehiclePlate) && <small>{picker.vehicleType || 'Phương tiện'} · {picker.vehiclePlate || 'Chưa có biển số'}</small>}
                  </div>
                  <label className="pickup-active">
                    <input
                      type="checkbox"
                      checked={picker.isActive !== false}
                      onChange={(event) => setPickers((items) => items.map((entry, current) => current === index ? { ...entry, isActive: event.target.checked } : entry))}
                    /> Hoạt động
                  </label>
                  <button type="button" aria-label={`Xóa ${picker.fullName}`} onClick={() => setPickerToRemove(index)}>×</button>
                </article>
              )) : <div className="empty-state compact">Chưa khai báo người được phép đón.</div>}
            </div>
            <div className="pickup-picker-form">
              <label>Họ và tên<input value={pickerForm.fullName} maxLength="120" onChange={(event) => setPickerForm({ ...pickerForm, fullName: event.target.value })} placeholder="Ví dụ: Nguyễn Văn B" /></label>
              <label>
                Quan hệ
                <select value={pickerForm.relationship} onChange={(event) => setPickerForm({ ...pickerForm, relationship: event.target.value })}>
                  <option value="">Chọn quan hệ</option>
                  <option value="Bố">Bố</option>
                  <option value="Mẹ">Mẹ</option>
                  <option value="Ông">Ông</option>
                  <option value="Bà">Bà</option>
                  <option value="Người giám hộ">Người giám hộ</option>
                  <option value="Khác">Khác</option>
                </select>
              </label>
              <label>Số điện thoại<input value={pickerForm.phone} maxLength="15" onChange={(event) => setPickerForm({ ...pickerForm, phone: event.target.value })} placeholder="0901 234 567" /></label>
              <label>URL ảnh nhận diện<input type="url" value={pickerForm.photoURL} maxLength="1000" onChange={(event) => setPickerForm({ ...pickerForm, photoURL: event.target.value })} placeholder="https://..." /></label>
              <label>Phương tiện<input value={pickerForm.vehicleType} maxLength="80" onChange={(event) => setPickerForm({ ...pickerForm, vehicleType: event.target.value })} placeholder="Xe máy, ô tô..." /></label>
              <label>Biển số xe<input value={pickerForm.vehiclePlate} maxLength="20" onChange={(event) => setPickerForm({ ...pickerForm, vehiclePlate: event.target.value.toUpperCase() })} /></label>
              <button type="button" className="button button-secondary" onClick={addPicker}><Icon name="plus" size={15} /> Thêm vào danh sách</button>
              <p className="pickup-add-help">Thay đổi này chỉ có hiệu lực sau khi nhà trường phê duyệt.</p>
            </div>
            <div className="form-actions">
              <button type="button" className="button button-primary" disabled={state.saving} onClick={savePickers}>Gửi nhà trường phê duyệt</button>
            </div>
          </article>

          <article className="content-card pickup-card">
            <div className="card-heading">
              <div>
                <p className="card-kicker">BÁO TRƯỚC NGƯỜI ĐÓN (TÙY CHỌN)</p>
                <h2>Ai sẽ đón bé hôm nay?</h2>
              </div>
            </div>
            <form className="student-form-grid pickup-request-form" onSubmit={submitPickup}>
              <label className="form-wide">
                Người đón
                <select value={form.pickerId} onChange={(event) => setForm({ ...form, pickerId: event.target.value })} required>
                  <option value="">Chọn người trong danh sách ủy quyền</option>
                  {pickers.filter((item) => item.isActive !== false && !String(item._id || '').startsWith('new-')).map((picker) => (
                    <option key={picker._id} value={picker._id}>{picker.fullName} · {picker.relationship || 'Người được ủy quyền'}</option>
                  ))}
                </select>
              </label>
              <label>
                Giờ dự kiến (24 giờ)
                <input type="time" lang="vi" step="60" value={form.expectedPickupTime} onChange={(event) => setForm({ ...form, expectedPickupTime: event.target.value })} />
                <small>Ví dụ: 17:00 (chỉ cần báo trước khi đổi người đón khác thường ngày).</small>
              </label>
              <label>Ngày đón<input value={dateText(pickupDate)} readOnly /></label>
              <label className="form-wide">Ghi chú cho giáo viên<textarea value={form.note} maxLength="500" onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Ví dụ: Hôm nay Ông ngoại đón bé sớm lúc 16h30." /></label>
              <div className="form-actions form-wide">
                <button className="button button-primary" disabled={state.saving || !pickers.some((item) => item.isActive !== false && !String(item._id || '').startsWith('new-'))}>
                  Gửi báo trước người đón
                </button>
              </div>
            </form>
          </article>
        </section>
      )}

      <section className="content-card pickup-history">
        <div className="card-heading" style={{ flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <p className="card-kicker">NHẬT KÝ BÀN GIAO & HẸN ĐÓN</p>
            <h2>{isParent ? 'Lịch sử đón của con' : `Nhật ký đón trả ngày ${dateText(pickupDate)}`}</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {!isParent && (
              <>
                <input
                  value={recordSearch}
                  onChange={(event) => {
                    setRecordSearch(event.target.value);
                    setRecordPage(1);
                  }}
                  placeholder="Lọc nhật ký..."
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                />
                <select
                  value={recordStatus}
                  onChange={(event) => {
                    setRecordStatus(event.target.value);
                    setRecordPage(1);
                  }}
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                >
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(statusText).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </>
            )}
            <span className="history-count">{visibleRecords.length} lượt</span>
          </div>
        </div>

        {state.loading ? (
          <div className="inline-loader"><span className="loading-orb" />Đang tải lịch đón...</div>
        ) : visibleRecords.length ? (
          <div className="pickup-record-list">
            {visibleRecords.slice((currentRecordPage - 1) * 10, currentRecordPage * 10).map((record) => (
              <article key={record._id}>
                <div className="pickup-record-main">
                  <span className="student-avatar">{record.studentName?.charAt(0) || 'B'}</span>
                  <div>
                    <strong>{record.studentName}</strong>
                    <small>
                      {record.className} · Người đón: <b>{record.picker?.fullName}</b>
                      {record.picker?.relationship ? ` (${record.picker.relationship})` : ''}
                    </small>
                    {record.note && <em>{record.note}</em>}
                    {isParent && record.status === 'scheduled' && record.pickupQrPayload && (
                      <div className="pickup-qr-ticket">
                        <QrCodeImage value={record.pickupQrPayload} size={112} label={`QR đón ${record.studentName}`} />
                        <span>
                          <strong>QR bàn giao hôm nay</strong>
                          <small>Người đón đưa mã này cho bảo vệ quét. Không gửi cho người không được ủy quyền.</small>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="pickup-record-time">
                  <small>{record.status === 'confirmed' ? 'Giờ đón' : 'Dự kiến'}</small>
                  <strong>
                    {record.status === 'confirmed' && record.confirmedAt
                      ? new Date(record.confirmedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                      : (record.expectedPickupTime || '—')}
                  </strong>
                </div>
                <span className={`student-status pickup-${record.status}`}>{statusText[record.status]}</span>
                <div className="pickup-record-actions">
                  {record.status === 'scheduled' && isParent && (
                    <button type="button" className="button button-secondary" disabled={state.saving} onClick={() => cancel(record._id)}>
                      Hủy
                    </button>
                  )}
                  {record.status === 'scheduled' && !isParent && (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={state.saving || !isTodaySelected}
                      onClick={() => {
                        setConfirmationRecord(record);
                        setIdentityVerified(false);
                        setPhotoCompared(false);
                        setVehicleCompared(false);
                        setConfirmationNote('');
                      }}
                    >
                      Xác nhận bàn giao
                    </button>
                  )}
                  {record.status === 'confirmed' && (
                    <small>{record.confirmedByName}</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">Chưa có nhật ký bàn giao trong ngày đã chọn.</div>
        )}
        <StudentPagination total={visibleRecords.length} page={currentRecordPage} onChange={setRecordPage} />
      </section>

      {confirmationRecord && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pickup-verification-title">
          <section className="content-card pickup-confirm-modal pickup-identity-modal">
            <h2 id="pickup-verification-title">Đối chiếu trước khi bàn giao</h2>
            <p>Học sinh: <strong>{confirmationRecord.studentName}</strong> · {confirmationRecord.className}</p>
            <div className="pickup-identity-grid">
              <div>
                {confirmationRecord.picker?.photoURL
                  ? <img src={confirmationRecord.picker.photoURL} alt={`Ảnh ${confirmationRecord.picker.fullName}`} />
                  : <span className="pickup-photo-placeholder"><Icon name="users" size={32} />Chưa lưu ảnh</span>}
              </div>
              <div>
                <p>Người đón: <strong>{confirmationRecord.picker?.fullName}</strong> · {confirmationRecord.picker?.relationship}</p>
                <p>Điện thoại: {confirmationRecord.picker?.phone || 'Chưa khai báo'}</p>
                <p>Giấy tờ (4 số cuối): {confirmationRecord.picker?.identityCardLast4 || 'Chưa khai báo'}</p>
                <p>Phương tiện: {confirmationRecord.picker?.vehicleType || 'Chưa khai báo'} · <strong>{confirmationRecord.picker?.vehiclePlate || 'Không có biển số'}</strong></p>
                <span className="student-status enrolled">
                  {confirmationRecord.authorizationMethod === 'otp' ? 'Đã được phụ huynh xác nhận OTP' : 'Người đón đã đăng ký'}
                </span>
              </div>
            </div>
            {state.error && <div className="form-error">{state.error}</div>}
            <label className="pickup-verify-check">
              <input type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> Tôi đã đối chiếu họ tên, số điện thoại và giấy tờ người đón.
            </label>
            {confirmationRecord.picker?.photoURL && (
              <label className="pickup-verify-check">
                <input type="checkbox" checked={photoCompared} onChange={(event) => setPhotoCompared(event.target.checked)} /> Tôi đã đối chiếu người thực tế với ảnh đã lưu.
              </label>
            )}
            {confirmationRecord.picker?.vehiclePlate && (
              <label className="pickup-verify-check">
                <input type="checkbox" checked={vehicleCompared} onChange={(event) => setVehicleCompared(event.target.checked)} /> Tôi đã đối chiếu phương tiện và biển số xe.
              </label>
            )}
            <label className="guard-resolution">
              Ghi chú bàn giao
              <textarea maxLength={500} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} />
            </label>
            <div className="form-actions">
              <button className="button button-secondary" disabled={state.saving} onClick={() => setConfirmationRecord(null)}>Quay lại</button>
              <button
                className="button button-primary"
                disabled={state.saving || !identityVerified || (confirmationRecord.picker?.photoURL && !photoCompared) || (confirmationRecord.picker?.vehiclePlate && !vehicleCompared)}
                onClick={() => confirm(confirmationRecord._id)}
              >
                Xác nhận đã bàn giao
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {showOtpModal && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="content-card pickup-confirm-modal pickup-otp-modal">
            <div className="card-heading">
              <div>
                <p className="card-kicker">NGƯỜI ĐÓN THAY MỘT LẦN</p>
                <h2>Xác nhận bằng OTP phụ huynh</h2>
              </div>
              <button className="button button-secondary" onClick={() => setShowOtpModal(false)}>Đóng</button>
            </div>
            {state.error && <div className="form-error guard-inline-message">{state.error}</div>}
            {!otpChallenge ? (
              <form className="student-form-grid" onSubmit={requestOtp}>
                <label className="form-wide">
                  Tìm học sinh
                  <div className="pickup-otp-search">
                    <input value={otpSearch} onChange={(event) => setOtpSearch(event.target.value)} placeholder="Tên hoặc mã học sinh" />
                    <button type="button" className="button button-secondary" onClick={searchOtpStudents}>Tìm</button>
                  </div>
                </label>
                <label className="form-wide">
                  Học sinh
                  <select value={otpForm.studentId} onChange={(event) => setOtpForm({ ...otpForm, studentId: event.target.value })} required>
                    <option value="">Chọn học sinh</option>
                    {otpStudents.map((student) => <option key={student._id} value={student._id}>{student.fullName} · {student.className}</option>)}
                  </select>
                </label>
                <label>Họ tên người đón<input value={otpForm.fullName} onChange={(event) => setOtpForm({ ...otpForm, fullName: event.target.value })} required /></label>
                <label>Số điện thoại<input value={otpForm.phone} onChange={(event) => setOtpForm({ ...otpForm, phone: event.target.value })} required /></label>
                <label>Quan hệ<input value={otpForm.relationship} onChange={(event) => setOtpForm({ ...otpForm, relationship: event.target.value })} /></label>
                <label>4 số cuối giấy tờ<input value={otpForm.identityCardLast4} maxLength="4" onChange={(event) => setOtpForm({ ...otpForm, identityCardLast4: event.target.value.replace(/\D/g, '') })} /></label>
                <label className="form-wide">URL ảnh người đón<input type="url" value={otpForm.photoURL} onChange={(event) => setOtpForm({ ...otpForm, photoURL: event.target.value })} placeholder="https://..." /></label>
                <label>Phương tiện<input value={otpForm.vehicleType} onChange={(event) => setOtpForm({ ...otpForm, vehicleType: event.target.value })} placeholder="Xe máy, ô tô..." /></label>
                <label>Biển số xe<input value={otpForm.vehiclePlate} onChange={(event) => setOtpForm({ ...otpForm, vehiclePlate: event.target.value.toUpperCase() })} /></label>
                <div className="form-actions form-wide"><button className="button button-primary" disabled={state.saving}>Gửi OTP cho phụ huynh</button></div>
              </form>
            ) : (
              <div className="pickup-otp-verify">
                <span className="parent-payment-icon"><Icon name="phone" size={26} /></span>
                <h3>OTP đã gửi trong thông báo phụ huynh</h3>
                <p>Mã có hiệu lực 10 phút. Chỉ tiếp tục khi phụ huynh chủ động cung cấp mã.</p>
                <label>Mã OTP 6 số<input inputMode="numeric" maxLength="6" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ''))} /></label>
                <button className="button button-primary" disabled={state.saving || otpCode.length !== 6} onClick={verifyOtp}>Xác nhận OTP và tạo lịch đón</button>
              </div>
            )}
          </section>
        </div>,
        document.body
      )}

      {pickerToRemove != null && createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="remove-picker-title">
          <section className="content-card pickup-confirm-modal">
            <span className="parent-payment-icon"><Icon name="alertCircle" size={26} /></span>
            <p className="card-kicker">XÁC NHẬN XÓA</p>
            <h2 id="remove-picker-title">Xóa người được ủy quyền?</h2>
            <p>{pickers[pickerToRemove]?.fullName} sẽ bị xóa khỏi danh sách ủy quyền ngay sau khi bạn xác nhận.</p>
            <div className="form-actions">
              <button type="button" className="button button-secondary" disabled={state.saving} onClick={() => setPickerToRemove(null)}>Giữ lại</button>
              <button type="button" className="button button-danger" disabled={state.saving} onClick={removePicker}>{state.saving ? 'Đang xóa...' : 'Xóa người này'}</button>
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );

  if (embedded) {
    return <div className="pickup-management-embedded">{content}</div>;
  }

  return (
    <AppShell
      title={isParent ? 'Đón trẻ & ủy quyền' : 'Đón trả trẻ hàng ngày'}
      subtitle={
        isParent
          ? 'Khai báo người được phép đón và theo dõi việc bàn giao con an toàn.'
          : 'Chọn nhanh Bố/Mẹ/Người được ủy quyền để trả trẻ 1 chạm tại lớp hoặc xác thực OTP khi có người lạ đón thay.'
      }
    >
      {content}
    </AppShell>
  );
}
