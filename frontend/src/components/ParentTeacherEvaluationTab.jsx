/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axiosConfig';

export default function ParentTeacherEvaluationTab({ child }) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');

  // Unselected by default: require explicit parent action
  const [scores, setScores] = useState({
    care: 0,
    teaching: 0,
    communication: 0,
    overallRating: 0
  });
  const [feedback, setFeedback] = useState('');
  const childId = child?._id;

  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef(null);
  const submittingRef = useRef(false);

  // Identity and lifecycle tracking refs to prevent stale closure leaks
  const contextGenRef = useRef(0);
  const activeContextRef = useRef({
    childId: null,
    teacherId: null,
    period: '',
    generation: 0
  });
  const activeSubmitOpRef = useRef(null);
  const isMountedRef = useRef(true);

  const loadData = useCallback((targetChildId, targetPeriod) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError('');

    const params = {};
    if (targetChildId) params.studentId = targetChildId;
    if (targetPeriod) params.period = targetPeriod;

    api.get('/parent-teacher-evaluations/context', {
      params,
      signal: controller.signal
    }).then((res) => {
      if (!isMountedRef.current || seq !== requestSeqRef.current) return;
      setContext(res.data?.data || null);
    }).catch((err) => {
      if (controller.signal.aborted || err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      if (!isMountedRef.current || seq !== requestSeqRef.current) return;
      setError(err.response?.data?.message || 'Không thể tải thông tin đánh giá giáo viên.');
    }).finally(() => {
      if (isMountedRef.current && seq === requestSeqRef.current) {
        setLoading(false);
      }
    });
  }, []);

  // When child changes: advance generation, update activeContextRef, reset form, load data
  useEffect(() => {
    isMountedRef.current = true;
    contextGenRef.current += 1;
    activeContextRef.current = {
      childId,
      teacherId: null,
      period: '',
      generation: contextGenRef.current
    };

    setScores({ care: 0, teaching: 0, communication: 0, overallRating: 0 });
    activeSubmitOpRef.current = null;
    submittingRef.current = false;
    setSubmitting(false);
    setFeedback('');
    setError('');
    setSuccess('');
    setSelectedPeriod('');
    setContext(null);

    if (childId) {
      loadData(childId, '');
    } else {
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
      contextGenRef.current += 1;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [childId, loadData]);

  const target = (context?.eligibleTargets || []).find((t) => String(t.studentId) === String(childId));
  const isContextForCurrentChild = Boolean(context && target && String(target.studentId) === String(childId));
  const childEvals = (context?.evaluations || []).filter((e) => String(e.studentId) === String(childId));

  const currentPeriodCode = selectedPeriod || target?.currentPeriod || '';

  // Synchronize target and period into activeContextRef in effect
  useEffect(() => {
    activeContextRef.current.teacherId = target?.teacherId || null;
    activeContextRef.current.period = currentPeriodCode;
  }, [target?.teacherId, currentPeriodCode]);

  const handlePeriodChange = (newPeriod) => {
    if (submittingRef.current) return;
    contextGenRef.current += 1;
    activeContextRef.current = {
      childId,
      teacherId: target?.teacherId || null,
      period: newPeriod,
      generation: contextGenRef.current
    };
    setSelectedPeriod(newPeriod);
    setScores({ care: 0, teaching: 0, communication: 0, overallRating: 0 });
    setFeedback('');
    setError('');
    setSuccess('');
    loadData(childId, newPeriod);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!target || !isContextForCurrentChild) return;

    const opChildId = childId;
    const opTeacherId = target.teacherId;
    const opPeriod = currentPeriodCode;
    const opGeneration = contextGenRef.current;
    const opId = crypto.randomUUID();

    if (!opPeriod) {
      setError('Vui lòng chọn kỳ đánh giá hợp lệ.');
      return;
    }

    if (!scores.care || !scores.teaching || !scores.communication || !scores.overallRating) {
      setError('Vui lòng chọn số sao đánh giá cho tất cả 4 tiêu chí trước khi gửi.');
      return;
    }

    if (feedback.trim().length > 2000) {
      setError(`Nội dung góp ý không được vượt quá 2000 ký tự (hiện có ${feedback.trim().length} ký tự).`);
      return;
    }

    activeSubmitOpRef.current = opId;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/parent-teacher-evaluations', {
        studentId: opChildId,
        teacherId: opTeacherId,
        period: opPeriod,
        criteria: {
          care: scores.care,
          teaching: scores.teaching,
          communication: scores.communication
        },
        overallRating: scores.overallRating,
        feedback: feedback.trim()
      });

      // Strict validation: check against live activeContextRef and mount status
      const current = activeContextRef.current;
      const isStillValidCurrentContext =
        isMountedRef.current &&
        current.generation === opGeneration &&
        String(current.childId) === String(opChildId) &&
        String(current.period) === String(opPeriod);

      if (isStillValidCurrentContext) {
        setSuccess('Cảm ơn phụ huynh đã gửi đánh giá giáo viên chủ nhiệm!');
        setFeedback('');
        setScores({ care: 0, teaching: 0, communication: 0, overallRating: 0 });
        loadData(opChildId, opPeriod);
      }
    } catch (err) {
      const current = activeContextRef.current;
      const isStillValidCurrentContext =
        isMountedRef.current &&
        current.generation === opGeneration &&
        String(current.childId) === String(opChildId);

      if (isStillValidCurrentContext) {
        setError(err.response?.data?.message || 'Không thể gửi đánh giá.');
      }
    } finally {
      // ONLY release the submitting lock if this operation is still the active one!
      if (activeSubmitOpRef.current === opId) {
        activeSubmitOpRef.current = null;
        submittingRef.current = false;
        if (isMountedRef.current) {
          setSubmitting(false);
        }
      }
    }
  };

  const renderStarSelector = (key, label, description) => (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', color: '#1e293b', marginBottom: '2px' }}>
        {label} <span style={{ color: '#ef4444' }}>*</span> {scores[key] > 0 ? `(${scores[key]}/5 sao)` : '(Chưa chọn)'}
      </label>
      <small style={{ color: '#64748b', display: 'block', marginBottom: '6px' }}>{description}</small>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={submitting}
            onClick={() => setScores((prev) => ({ ...prev, [key]: star }))}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              border: scores[key] === star ? '2px solid #3b82f6' : '1px solid #cbd5e1',
              background: scores[key] === star ? '#eff6ff' : '#fff',
              color: scores[key] === star ? '#1d4ed8' : '#334155',
              fontWeight: scores[key] === star ? 800 : 500,
              cursor: submitting ? 'not-allowed' : 'pointer'
            }}
          >
            {star} ★
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ marginBottom: '18px' }}>
        <h3 style={{ margin: '0 0 6px', color: '#1e3a8a', fontSize: '18px' }}>
          Đánh giá giáo viên chủ nhiệm
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
          Ý kiến của phụ huynh về sự chăm sóc, giảng dạy và trao đổi thông tin của giáo viên chủ nhiệm trong kỳ. Thông tin được tổng hợp độc lập, không dùng cho mục đích đào tạo/xếp loại chuyên môn nội bộ.
        </p>
      </div>

      {loading && <div className="inline-loader">Đang tải thông tin đánh giá...</div>}

      {!loading && !target && (
        <div className="empty-state" style={{ padding: '24px', textAlign: 'center' }}>
          <p style={{ color: '#64748b', margin: 0 }}>
            {child?.fullName || 'Học sinh'} hiện chưa có lớp học hoạt động hoặc chưa được phân công giáo viên chủ nhiệm trong năm học này.
          </p>
        </div>
      )}

      {!loading && target && (
        <div>
          {/* Target Teacher Summary Card */}
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
            gap: '12px'
          }}>
            <div>
              <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 800 }}>
                GIÁO VIÊN CHỦ NHIỆM
              </span>
              <h4 style={{ margin: '2px 0', color: '#1e293b', fontSize: '16px' }}>{target.teacherName}</h4>
              <small style={{ color: '#475569' }}>
                Lớp: <b>{target.className}</b> · Năm học: <b>{target.schoolYear}</b> · Học sinh: <b>{child.fullName}</b>
              </small>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginRight: '8px' }}>
                Kỳ đánh giá:
              </label>
              <select
                disabled={submitting}
                value={currentPeriodCode}
                onChange={(e) => handlePeriodChange(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#fff' }}
              >
                {(context?.activePeriods || []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} ({p.schoolYear})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <div className="form-error" role="alert" style={{ marginBottom: '14px' }}>{error}</div>}
          {success && <div className="timekeeping-notice success" role="status" style={{ marginBottom: '14px' }}>{success}</div>}

          {/* Already Evaluated in this Period Banner */}
          {target.alreadyEvaluated && (
            <div style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '18px',
              color: '#065f46',
              fontSize: '13px'
            }}>
              ✓ Phụ huynh đã gửi đánh giá cho giáo viên chủ nhiệm trong kỳ <b>{currentPeriodCode}</b>. Mỗi học sinh chỉ gửi một lần mỗi kỳ để bảo đảm tính khách quan. Cảm ơn sự đồng hành của gia đình!
            </div>
          )}

          {/* Evaluation Form (Only if not already evaluated) */}
          {!target.alreadyEvaluated && (
            <form onSubmit={handleSubmit} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px', background: '#fff', marginBottom: '24px' }}>
              <h4 style={{ margin: '0 0 14px', color: '#1e3a8a', fontSize: '15px' }}>
                Phiếu đánh giá giáo viên chủ nhiệm ({currentPeriodCode})
              </h4>

              {renderStarSelector(
                'care',
                '1. Mức độ quan tâm, chăm sóc trẻ',
                'Quan tâm đến sức khỏe, tâm lý, sinh hoạt hằng ngày và hỗ trợ trẻ hòa nhập tại lớp.'
              )}

              {renderStarSelector(
                'teaching',
                '2. Phương pháp giáo dục & hướng dẫn',
                'Truyền đạt kiến thức phù hợp lứa tuổi, khuyến khích sự tự lập và kích thích sáng tạo của trẻ.'
              )}

              {renderStarSelector(
                'communication',
                '3. Giao tiếp & trao đổi với phụ huynh',
                'Kịp thời thông tin tình hình của trẻ, lắng nghe và phối hợp hiệu quả với phụ huynh.'
              )}

              {renderStarSelector(
                'overallRating',
                '4. Đánh giá chung sự hài lòng',
                'Mức độ hài lòng tổng thể của gia đình đối với công tác chủ nhiệm của giáo viên.'
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: '13px', color: '#1e293b', marginBottom: '4px' }}>
                  Ý kiến đóng góp / Chia sẻ thêm (tùy chọn)
                </label>
                <textarea
                  rows={3}
                  disabled={submitting}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Chia sẻ thêm những điểm tích cực hoặc đề xuất cải thiện để giáo viên và nhà trường phối hợp tốt hơn..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
                <small style={{ color: '#64748b' }}>Tối đa 2000 ký tự. Ý kiến được gửi bảo mật.</small>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={submitting}
                  style={{ minWidth: '150px' }}
                >
                  {submitting ? 'Đang gửi...' : 'Gửi đánh giá'}
                </button>
              </div>
            </form>
          )}

          {/* Evaluation History Section */}
          <div>
            <h4 style={{ margin: '0 0 10px', color: '#334155', fontSize: '14px' }}>Lịch sử đánh giá của học sinh</h4>
            {childEvals.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                Chưa có phiếu đánh giá nào được gửi cho học sinh này.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {childEvals.map((item) => (
                  <div key={item._id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ color: '#1e293b', fontSize: '13px' }}>
                        Kỳ: {item.period} · GV: {item.teacherName}
                      </strong>
                      <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 700 }}>
                        {item.overallRating} / 5 ★
                      </span>
                    </div>
                    <small style={{ color: '#64748b', display: 'block', marginTop: '2px' }}>
                      Chăm sóc: {item.criteria?.care}★ · Giảng dạy: {item.criteria?.teaching}★ · Giao tiếp: {item.criteria?.communication}★
                    </small>
                    {item.feedback && (
                      <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#475569', fontStyle: 'italic' }}>
                        &quot;{item.feedback}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
