import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { listStudents } from "../api/students";
import api from "../api/axiosConfig";

const today = () => new Date().toISOString().slice(0, 10);
const emptyCare = {
  classroomId: "",
  reportDate: today(),
  activities: "",
  meals: "",
  sleep: "",
  health: "",
  studentNotes: [],
};

export default function DailyCare() {
  const [students, setStudents] = useState([]);
  const [careReports, setCareReports] = useState([]);
  const [care, setCare] = useState(emptyCare);
  const [announcements, setAnnouncements] = useState([]);
  const [announcement, setAnnouncement] = useState({
    classroomId: "",
    title: "",
    content: "",
  });
  const [state, setState] = useState({
    loading: true,
    saving: false,
    error: "",
    success: "",
  });
  const classrooms = useMemo(
    () =>
      [
        ...new Map(
          students.map((student) => [
            String(student.classroomId),
            student.currentClassName,
          ]),
        ).entries(),
      ].map(([id, name]) => ({ id, name })),
    [students],
  );
  const classStudents = students.filter(
    (student) => String(student.classroomId) === String(care.classroomId),
  );

  const load = useCallback(async () => {
    try {
      const [studentRes, careRes, announcementRes] = await Promise.all([
        listStudents({ status: "enrolled", limit: 100, sortBy: "fullName" }),
        api.get("/class-communication/care-reports"),
        api.get("/class-communication/announcements"),
      ]);
      const items = studentRes.data.data || [];
      const classroomId = items[0]?.classroomId || "";
      setStudents(items);
      setCare((current) => ({
        ...current,
        classroomId: current.classroomId || classroomId,
      }));
      setAnnouncement((current) => ({
        ...current,
        classroomId: current.classroomId || classroomId,
      }));
      setCareReports(careRes.data.data || []);
      setAnnouncements(announcementRes.data.data || []);
      setState((current) => ({ ...current, loading: false }));
    } catch (error) {
      setState({
        loading: false,
        saving: false,
        success: "",
        error: error.response?.data?.message || "Không thể tải sổ lớp.",
      });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setClassroom = (classroomId) =>
    setCare((current) => ({ ...current, classroomId, studentNotes: [] }));
  const addStudentNote = () => {
    const used = new Set(care.studentNotes.map((item) => item.studentId));
    const student = classStudents.find((item) => !used.has(item._id));
    if (student)
      setCare((current) => ({
        ...current,
        studentNotes: [
          ...current.studentNotes,
          { studentId: student._id, note: "" },
        ],
      }));
  };
  const updateStudentNote = (index, field, value) =>
    setCare((current) => ({
      ...current,
      studentNotes: current.studentNotes.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  const removeStudentNote = (index) =>
    setCare((current) => ({
      ...current,
      studentNotes: current.studentNotes.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));

  const submitCare = async (event) => {
    event.preventDefault();
    setState((current) => ({
      ...current,
      saving: true,
      error: "",
      success: "",
    }));
    try {
      const response = await api.put("/class-communication/care-reports", care);
      setCare((current) => ({
        ...emptyCare,
        classroomId: current.classroomId,
        reportDate: current.reportDate,
      }));
      setState((current) => ({
        ...current,
        saving: false,
        success: response.data.message,
      }));
      const list = await api.get("/class-communication/care-reports");
      setCareReports(list.data.data || []);
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        error:
          error.response?.data?.message || "Không thể lưu sổ chăm sóc lớp.",
      }));
    }
  };
  const sendAnnouncement = async (event) => {
    event.preventDefault();
    setState((current) => ({
      ...current,
      saving: true,
      error: "",
      success: "",
    }));
    try {
      const response = await api.post(
        "/class-communication/announcements",
        announcement,
      );
      setAnnouncement((current) => ({ ...current, title: "", content: "" }));
      setState((current) => ({
        ...current,
        saving: false,
        success: response.data.message,
      }));
      const list = await api.get("/class-communication/announcements");
      setAnnouncements(list.data.data || []);
    } catch (error) {
      setState((current) => ({
        ...current,
        saving: false,
        error: error.response?.data?.message || "Không thể gửi thông báo lớp.",
      }));
    }
  };

  return (
    <AppShell
      title="Sổ chăm sóc lớp"
      subtitle="Ghi nhận một lần cho cả lớp và chỉ gắn học sinh cần lưu ý riêng."
    >
      {state.error && <div className="form-error">{state.error}</div>}
      {state.success && (
        <div className="notice notice-success">
          <Icon name="check" size={17} />
          {state.success}
        </div>
      )}
      <section className="daily-care-layout">
        <form className="content-card student-form" onSubmit={submitCare}>
          <div className="card-heading">
            <div>
              <p className="card-kicker">NHẬT KÝ CHUNG</p>
              <h2>Tình hình cả lớp trong ngày</h2>
              <p>
                Phụ huynh trong lớp đều nhận nội dung chung; học sinh được chọn
                sẽ nhận thêm lưu ý riêng.
              </p>
            </div>
          </div>
          {state.loading ? (
            <div className="inline-loader">
              <span className="loading-orb" />
              Đang tải...
            </div>
          ) : !classrooms.length ? (
            <div className="empty-state compact">
              Bạn chưa được phân công lớp.
            </div>
          ) : (
            <div className="student-form-grid">
              <label>
                Lớp
                <select
                  value={care.classroomId}
                  onChange={(event) => setClassroom(event.target.value)}
                  required
                >
                  {classrooms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ngày ghi nhận
                <input
                  type="date"
                  max={today()}
                  value={care.reportDate}
                  onChange={(event) =>
                    setCare({ ...care, reportDate: event.target.value })
                  }
                  required
                />
              </label>
              <CareField
                label="Hoạt động và nhận xét chung"
                value={care.activities}
                placeholder="Hoạt động, tâm trạng và kỹ năng chung của lớp..."
                onChange={(value) => setCare({ ...care, activities: value })}
              />
              <CareField
                label="Ăn uống chung"
                value={care.meals}
                placeholder="Các con ăn thế nào, món được yêu thích..."
                onChange={(value) => setCare({ ...care, meals: value })}
              />
              <CareField
                label="Giấc ngủ chung"
                value={care.sleep}
                placeholder="Khung giờ ngủ và tình hình chung..."
                onChange={(value) => setCare({ ...care, sleep: value })}
              />
              <CareField
                label="Sức khỏe và vệ sinh chung"
                value={care.health}
                placeholder="Tình hình sức khỏe chung của lớp..."
                onChange={(value) => setCare({ ...care, health: value })}
              />
              <div className="care-note-builder form-wide">
                <div>
                  <strong>Học sinh cần lưu ý riêng</strong>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={addStudentNote}
                    disabled={care.studentNotes.length >= classStudents.length}
                  >
                    <Icon name="plus" size={14} />
                    Thêm học sinh
                  </button>
                </div>
                {care.studentNotes.length ? (
                  care.studentNotes.map((item, index) => (
                    <div
                      className="care-note-row"
                      key={`${item.studentId}-${index}`}
                    >
                      <select
                        value={item.studentId}
                        onChange={(event) =>
                          updateStudentNote(
                            index,
                            "studentId",
                            event.target.value,
                          )
                        }
                      >
                        {classStudents.map((student) => (
                          <option
                            key={student._id}
                            value={student._id}
                            disabled={care.studentNotes.some(
                              (note, noteIndex) =>
                                noteIndex !== index &&
                                note.studentId === student._id,
                            )}
                          >
                            {student.fullName}
                          </option>
                        ))}
                      </select>
                      <textarea
                        rows="2"
                        value={item.note}
                        onChange={(event) =>
                          updateStudentNote(index, "note", event.target.value)
                        }
                        placeholder="Ví dụ: Bé ho nhẹ, phụ huynh theo dõi thêm tối nay."
                        maxLength="1000"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => removeStudentNote(index)}
                        aria-label="Bỏ lưu ý"
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <p>Không có học sinh cần lưu ý riêng.</p>
                )}
              </div>
              <div className="form-actions form-wide">
                <button
                  className="button button-primary"
                  disabled={state.saving}
                >
                  {state.saving ? "Đang gửi..." : "Lưu và gửi phụ huynh"}
                </button>
              </div>
            </div>
          )}
        </form>
        <CareHistory reports={careReports} />
      </section>
      <section className="daily-care-layout">
        <form className="content-card student-form" onSubmit={sendAnnouncement}>
          <div className="card-heading">
            <div>
              <p className="card-kicker">THÔNG BÁO LỚP</p>
              <h2>Gửi chung cho phụ huynh</h2>
            </div>
          </div>
          <div className="student-form-grid">
            <label className="form-wide">
              Lớp
              <select
                value={announcement.classroomId}
                onChange={(event) =>
                  setAnnouncement({
                    ...announcement,
                    classroomId: event.target.value,
                  })
                }
                required
              >
                {classrooms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-wide">
              Tiêu đề
              <input
                value={announcement.title}
                onChange={(event) =>
                  setAnnouncement({
                    ...announcement,
                    title: event.target.value,
                  })
                }
                maxLength="160"
                required
              />
            </label>
            <label className="form-wide">
              Nội dung
              <textarea
                value={announcement.content}
                onChange={(event) =>
                  setAnnouncement({
                    ...announcement,
                    content: event.target.value,
                  })
                }
                maxLength="2000"
                rows="5"
                required
              />
            </label>
            <div className="form-actions form-wide">
              <button className="button button-primary" disabled={state.saving}>
                Gửi thông báo
              </button>
            </div>
          </div>
        </form>
        <section className="content-card">
          <div className="card-heading">
            <div>
              <p className="card-kicker">ĐÃ GỬI</p>
              <h2>Thông báo gần đây</h2>
            </div>
          </div>
          <div className="daily-care-history">
            {announcements.length ? (
              announcements.slice(0, 10).map((item) => (
                <article key={item._id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {new Date(item.publishedAt).toLocaleDateString("vi-VN")}
                    </small>
                  </div>
                  <p>{item.content}</p>
                </article>
              ))
            ) : (
              <div className="empty-state compact">Chưa có thông báo lớp.</div>
            )}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function CareField({ label, value, placeholder, onChange }) {
  return (
    <label className="form-wide">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength="1000"
      />
    </label>
  );
}
function CareHistory({ reports }) {
  return (
    <section className="content-card">
      <div className="card-heading">
        <div>
          <p className="card-kicker">LỊCH SỬ LỚP</p>
          <h2>Nhật ký gần đây</h2>
        </div>
      </div>
      <div className="daily-care-history">
        {reports.length ? (
          reports.slice(0, 10).map((report) => (
            <article key={report._id}>
              <div>
                <strong>
                  {report.className} ·{" "}
                  {new Date(report.reportDate).toLocaleDateString("vi-VN")}
                </strong>
                <small>{report.recordedByName}</small>
              </div>
              {report.activities && (
                <p>
                  <b>Hoạt động:</b> {report.activities}
                </p>
              )}
              {report.meals && (
                <p>
                  <b>Ăn:</b> {report.meals}
                </p>
              )}
              {report.sleep && (
                <p>
                  <b>Ngủ:</b> {report.sleep}
                </p>
              )}
              {report.health && (
                <p>
                  <b>Sức khỏe:</b> {report.health}
                </p>
              )}
              {report.studentNotes?.length > 0 && (
                <p className="care-private-summary">
                  <b>Lưu ý riêng:</b>{" "}
                  {report.studentNotes
                    .map((note) => note.studentName)
                    .join(", ")}
                </p>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state compact">Chưa có nhật ký lớp.</div>
        )}
      </div>
    </section>
  );
}
