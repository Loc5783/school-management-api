import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import StudentExcelImportModal from "../components/StudentExcelImportModal";
import { createStudent, getStudent, updateStudent } from "../api/students";
import api from "../api/axiosConfig";
import { getStoredUser } from '../utils/storage';

const ALLERGEN_OPTIONS = [
  { value: "gluten", label: "Gluten / lúa mì" },
  { value: "crustacean", label: "Giáp xác (tôm, cua)" },
  { value: "fish", label: "Cá" },
  { value: "egg", label: "Trứng" },
  { value: "milk", label: "Sữa" },
  { value: "peanut", label: "Đậu phộng / lạc" },
  { value: "soy", label: "Đậu nành" },
  { value: "sesame", label: "Mè / vừng" },
  { value: "tree_nut", label: "Hạt cây (hạnh nhân, điều...)" },
  { value: "mollusc", label: "Nhuyễn thể (nghêu, sò, mực...)" },
];
const ALLERGEN_ALIASES = {
  gluten: ["gluten", "lúa mì", "bột mì"],
  crustacean: ["giáp xác", "tôm", "cua", "hải sản"],
  fish: ["cá"],
  egg: ["trứng"],
  milk: ["sữa", "sữa bò"],
  peanut: ["đậu phộng", "lạc"],
  soy: ["đậu nành"],
  sesame: ["mè", "vừng"],
  tree_nut: ["hạt cây", "hạnh nhân", "hạt điều", "óc chó"],
  mollusc: ["nhuyễn thể", "nghêu", "sò", "ốc", "mực"],
};
const BLOOD_TYPE_OPTIONS = ["", "A", "B", "AB", "O", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const empty = {
  studentCode: "",
  identityCode: "",
  healthInsuranceCode: "",
  bloodType: "",
  fullName: "",
  birthDate: "",
  gender: "male",
  classroomId: "",
  admissionDate: "",
  schoolYear: "2026-2027",
  status: "enrolled",
  address: "",
  nationality: "Việt Nam",
  ethnicity: "",
  birthPlace: "",
  notes: "",
  allergens: [],
  allergyNote: "",
  diseaseName: "",
  diseaseDescription: "",
  parent1Name: "",
  parent1Phone: "",
  parent1Email: "",
  parent1Relationship: "father",
  parent2Name: "",
  parent2Phone: "",
  parent2Email: "",
  parent2Relationship: "mother",
  emergencyName: "",
  emergencyPhone: "",
};
const toDate = (value) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";
const normalizeAllergen = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    Object.entries(ALLERGEN_ALIASES).find(([, aliases]) =>
      aliases.some(
        (alias) => normalized === alias || normalized.includes(alias),
      ),
    )?.[0] || ""
  );
};
const labelAllergen = (value) =>
  ALLERGEN_OPTIONS.find((item) => item.value === value)?.label || value;

export default function StudentForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [classes, setClasses] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelImported, setExcelImported] = useState(false);
  const editing = Boolean(id);
  const role = (() => {
    try {
      return getStoredUser()?.role || "";
    } catch {
      return "";
    }
  })();
  const manager = ["admin", "principal"].includes(role);

  useEffect(() => {
    Promise.all([
      api.get("/classrooms"),
      editing ? getStudent(id) : Promise.resolve(null),
    ])
      .then(([classRes, studentRes]) => {
        setClasses(classRes.data.data || []);
        if (!studentRes) return;
        const data = studentRes.data.data;
        const normalized = (data.allergies || []).map((item) => ({
          ...item,
          code: normalizeAllergen(item.allergen),
        }));
        const standardCodes = [
          ...new Set(normalized.map((item) => item.code).filter(Boolean)),
        ];
        const otherNotes = normalized
          .filter((item) => !item.code)
          .map((item) => [item.allergen, item.note].filter(Boolean).join(": "))
          .filter(Boolean);
        const existingParents = Array.isArray(data.parents) ? data.parents : [];
        const p1 = existingParents[0] || {};
        const p2 = existingParents[1] || {};
        setForm((old) => ({
          ...old,
          ...data,
          identityCode: data.identityCode || "",
          healthInsuranceCode: data.healthInsuranceCode || "",
          bloodType: data.bloodType || "",
          birthDate: toDate(data.birthDate),
          admissionDate: toDate(data.admissionDate),
          allergens: standardCodes,
          allergyNote: otherNotes.join("; "),
          diseaseName: data.disease?.name || "",
          diseaseDescription: data.disease?.description || "",
          parent1Name: p1.fullName || "",
          parent1Phone: p1.phone || "",
          parent1Email: p1.email || "",
          parent1Relationship: p1.relationship || "father",
          parent2Name: p2.fullName || "",
          parent2Phone: p2.phone || "",
          parent2Email: p2.email || "",
          parent2Relationship: p2.relationship || "mother",
          emergencyName: data.emergencyContact?.name || p1.fullName || "",
          emergencyPhone: data.emergencyContact?.phone || p1.phone || "",
        }));
      })
      .catch(() => setError("Không thể tải dữ liệu biểu mẫu."))
      .finally(() => setLoadingInitial(false));
  }, [id, editing]);

  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const toggleAllergen = (code) =>
    setForm((old) => ({
      ...old,
      allergens: old.allergens.includes(code)
        ? old.allergens.filter((item) => item !== code)
        : [...old.allergens, code],
    }));
  const submit = async (event) => {
    event.preventDefault();
    if (saving || loadingInitial) return;

    // Ngăn chặn mất dữ liệu phụ huynh âm thầm nếu người dùng chỉ điền Tên mà quên SĐT (hoặc ngược lại)
    if (manager || !editing) {
      const p1HasAny = Boolean(form.parent1Name.trim() || form.parent1Phone.trim() || form.parent1Email.trim());
      if (p1HasAny && (!form.parent1Name.trim() || !form.parent1Phone.trim())) {
        setError("Phụ huynh 1: Vui lòng nhập đầy đủ cả Họ tên và Số điện thoại (hoặc để trống cả hai).");
        return;
      }
      const p2HasAny = Boolean(form.parent2Name.trim() || form.parent2Phone.trim() || form.parent2Email.trim());
      if (p2HasAny && (!form.parent2Name.trim() || !form.parent2Phone.trim())) {
        setError("Phụ huynh 2: Vui lòng nhập đầy đủ cả Họ tên và Số điện thoại (hoặc để trống cả hai).");
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      const teacherCreateFields = [
        "studentCode",
        "identityCode",
        "healthInsuranceCode",
        "bloodType",
        "fullName",
        "birthDate",
        "gender",
        "address",
        "nationality",
        "ethnicity",
        "birthPlace",
        "avatar",
        "notes",
        "classroomId",
      ];
      const teacherUpdateFields = ["avatar", "notes", "healthInsuranceCode", "bloodType"];
      const managerFields = [
        ...teacherCreateFields,
        "admissionDate",
        "schoolYear",
      ];
      const fields = manager
        ? managerFields
        : editing
          ? teacherUpdateFields
          : teacherCreateFields;
      const data = Object.fromEntries(fields.map((key) => [key, form[key]]));
      const builtParents = [];
      if (form.parent1Name.trim() && form.parent1Phone.trim()) {
        builtParents.push({
          fullName: form.parent1Name.trim(),
          phone: form.parent1Phone.trim(),
          email: form.parent1Email.trim() || undefined,
          relationship: form.parent1Relationship || "father",
          isPrimary: true,
        });
      }
      if (form.parent2Name.trim() && form.parent2Phone.trim()) {
        builtParents.push({
          fullName: form.parent2Name.trim(),
          phone: form.parent2Phone.trim(),
          email: form.parent2Email.trim() || undefined,
          relationship: form.parent2Relationship || "mother",
          isPrimary: builtParents.length === 0,
        });
      }
      if (manager || !editing) {
        if (builtParents.length > 0 || manager) {
          data.parents = builtParents;
        }
      }
      if (manager) {
        if (!editing) data.status = form.status;
        data.allergies = form.allergens.map((allergen) => ({
          allergen,
          severity: "moderate",
        }));
        if (form.allergyNote.trim())
          data.allergies.push({
            allergen: "Khác",
            severity: "moderate",
            note: form.allergyNote.trim(),
          });
        data.disease = {
          name: form.diseaseName.trim(),
          description: form.diseaseDescription.trim(),
        };
        const fallbackParent = builtParents[0];
        data.emergencyContact = {
          name: form.emergencyName.trim() || fallbackParent?.fullName || "",
          phone: form.emergencyPhone.trim() || fallbackParent?.phone || "",
        };
      }
      if (editing) await updateStudent(id, data);
      else await createStudent(data);
      navigate(editing ? `/students/${id}` : "/students");
    } catch (err) {
      setError(err.response?.data?.message || "Không thể lưu hồ sơ học sinh.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title={editing ? "Cập nhật học sinh" : "Thêm học sinh"}
      subtitle="Thông tin hồ sơ được kiểm tra và phân quyền tại máy chủ."
    >
      <form className="content-card student-form" onSubmit={submit}>
        <div className="section-heading">
          <div>
            <p className="card-kicker">HỒ SƠ HỌC SINH</p>
            <h2>{editing ? "Cập nhật thông tin" : "Tạo hồ sơ mới"}</h2>
          </div>
          {!editing && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowExcelModal(true)}
            >
              <Icon name="upload" size={16} /> Nhập từ Excel
            </button>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="student-form-grid">
          <label>
            Mã ID học sinh / Mã máy chấm công
            <input
              disabled={editing && !manager}
              maxLength="30"
              placeholder="Để trống tự đánh số (1, 2, 3...) hoặc nhập mã riêng"
              value={form.studentCode || ""}
              onChange={(e) => set("studentCode", e.target.value)}
            />
          </label>
          <label>
            Mã định danh học sinh
            <input
              disabled={editing && !manager}
              maxLength="40"
              placeholder="Mã định danh cá nhân / Bộ GD&ĐT (nếu có)"
              value={form.identityCode || ""}
              onChange={(e) => set("identityCode", e.target.value)}
            />
          </label>
          <label>
            Số thẻ Bảo hiểm Y tế (BHYT)
            <input
              maxLength="30"
              placeholder="VD: TE1012600012345"
              value={form.healthInsuranceCode || ""}
              onChange={(e) => set("healthInsuranceCode", e.target.value.toUpperCase())}
            />
          </label>
          <label>
            Nhóm máu
            <select
              value={form.bloodType || ""}
              onChange={(e) => set("bloodType", e.target.value)}
            >
              {BLOOD_TYPE_OPTIONS.map((bt) => (
                <option key={bt || "unknown"} value={bt}>
                  {bt ? `Nhóm máu ${bt}` : "Chưa xác định"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Họ và tên
            <input
              required
              disabled={editing && !manager}
              maxLength="120"
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
            />
          </label>
          <label>
            Ngày sinh
            <input
              required
              disabled={editing && !manager}
              type="date"
              value={form.birthDate}
              onChange={(e) => set("birthDate", e.target.value)}
            />
          </label>
          <label>
            Giới tính
            <select
              disabled={editing && !manager}
              value={form.gender}
              onChange={(e) => set("gender", e.target.value)}
            >
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>
          </label>
          <label>
            Lớp học
            <select
              required
              value={form.classroomId}
              onChange={(e) => set("classroomId", e.target.value)}
              disabled={editing && !manager}
            >
              <option value="">Chọn lớp học</option>
              {classes.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {manager && (
            <>
              <label>
                Ngày nhập học
                <input
                  type="date"
                  value={form.admissionDate}
                  onChange={(e) => set("admissionDate", e.target.value)}
                />
              </label>
              <label>
                Năm học
                <input
                  value={form.schoolYear}
                  onChange={(e) => set("schoolYear", e.target.value)}
                  placeholder="Ví dụ: 2026-2027"
                />
              </label>
              {!editing && (
                <label className="form-wide">
                  Trạng thái khi tạo
                  <select
                    value={form.status}
                    onChange={(e) => set("status", e.target.value)}
                  >
                    <option value="enrolled">
                      Đang theo học — được tính vào sĩ số và Dashboard
                    </option>
                    <option value="pending_admission">
                      Chờ nhập học — lưu hồ sơ, chưa tính sĩ số
                    </option>
                  </select>
                  <small>
                    Với học sinh đã tạo, trạng thái được thay đổi tại trang chi
                    tiết để lưu lịch sử và cập nhật sĩ số đúng quy trình.
                  </small>
                </label>
              )}
            </>
          )}
          <label className="form-wide">
            Địa chỉ
            <input
              disabled={editing && !manager}
              maxLength="500"
              value={form.address || ""}
              onChange={(e) => set("address", e.target.value)}
            />
          </label>
          {manager && (
            <>
              <label>
                Quốc tịch
                <input
                  value={form.nationality || ""}
                  onChange={(e) => set("nationality", e.target.value)}
                />
              </label>
              <label>
                Nơi sinh
                <input
                  value={form.birthPlace || ""}
                  onChange={(e) => set("birthPlace", e.target.value)}
                />
              </label>
              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Dị ứng / lưu ý ăn uống</legend>
                <p>
                  Chọn dị nguyên chuẩn để hệ thống đối chiếu trực tiếp với công
                  thức món ăn.
                </p>
                <div className="student-allergen-options">
                  {ALLERGEN_OPTIONS.map((allergen) => (
                    <label key={allergen.value}>
                      <input
                        type="checkbox"
                        checked={form.allergens.includes(allergen.value)}
                        onChange={() => toggleAllergen(allergen.value)}
                      />
                      {allergen.label}
                    </label>
                  ))}
                </div>
                <label className="student-allergy-note">
                  Dị ứng khác hoặc lưu ý chế độ ăn
                  <textarea
                    value={form.allergyNote}
                    onChange={(e) => set("allergyNote", e.target.value)}
                    placeholder="Ví dụ: Không dùng mật ong; cần cắt nhỏ thức ăn. Nội dung này hiển thị cho bếp nhưng không thay thế cảnh báo tự động."
                    maxLength="500"
                  />
                </label>
                {form.allergens.length > 0 && (
                  <small className="student-allergy-selection">
                    Đã chọn: {form.allergens.map(labelAllergen).join(", ")}
                  </small>
                )}
              </fieldset>
              <label>
                Bệnh lý cần lưu ý
                <input
                  value={form.diseaseName}
                  onChange={(e) => set("diseaseName", e.target.value)}
                  placeholder="Ví dụ: hen suyễn"
                />
              </label>
              <label>
                Mô tả / hướng dẫn y tế
                <input
                  value={form.diseaseDescription}
                  onChange={(e) => set("diseaseDescription", e.target.value)}
                  placeholder="Ví dụ: mang thuốc xịt theo chỉ định"
                />
              </label>
              <fieldset className="student-allergy-fieldset form-wide">
                <legend>Thông tin 2 Phụ huynh (Đảm bảo liên lạc dự phòng khi khẩn cấp)</legend>
                <p>
                  Khai báo cả Phụ huynh 1 và Phụ huynh 2 để nhà trường luôn có số gọi dự phòng khi người thứ nhất không nghe máy.
                </p>
                <div className="student-form-grid" style={{ padding: 0 }}>
                  <label>
                    Họ tên Phụ huynh 1
                    <input
                      value={form.parent1Name}
                      onChange={(e) => set("parent1Name", e.target.value)}
                      placeholder="Ví dụ: Nguyễn Văn Hùng"
                    />
                  </label>
                  <label>
                    SĐT Phụ huynh 1
                    <input
                      value={form.parent1Phone}
                      onChange={(e) => set("parent1Phone", e.target.value)}
                      placeholder="09xxxxxxxx"
                    />
                  </label>
                  <label>
                    Hòm thư (Email) Phụ huynh 1
                    <input
                      type="email"
                      value={form.parent1Email}
                      onChange={(e) => set("parent1Email", e.target.value)}
                      placeholder="phuhuynh1@gmail.com"
                    />
                  </label>
                  <label>
                    Quan hệ Phụ huynh 1
                    <select
                      value={form.parent1Relationship}
                      onChange={(e) => set("parent1Relationship", e.target.value)}
                    >
                      <option value="father">Bố</option>
                      <option value="mother">Mẹ</option>
                      <option value="guardian">Người giám hộ</option>
                    </select>
                  </label>
                  <label>
                    Họ tên Phụ huynh 2 (Dự phòng)
                    <input
                      value={form.parent2Name}
                      onChange={(e) => set("parent2Name", e.target.value)}
                      placeholder="Ví dụ: Trần Thị Lan"
                    />
                  </label>
                  <label>
                    SĐT Phụ huynh 2 (Dự phòng)
                    <input
                      value={form.parent2Phone}
                      onChange={(e) => set("parent2Phone", e.target.value)}
                      placeholder="09xxxxxxxx"
                    />
                  </label>
                  <label>
                    Hòm thư (Email) Phụ huynh 2
                    <input
                      type="email"
                      value={form.parent2Email}
                      onChange={(e) => set("parent2Email", e.target.value)}
                      placeholder="phuhuynh2@gmail.com"
                    />
                  </label>
                  <label>
                    Quan hệ Phụ huynh 2
                    <select
                      value={form.parent2Relationship}
                      onChange={(e) => set("parent2Relationship", e.target.value)}
                    >
                      <option value="mother">Mẹ</option>
                      <option value="father">Bố</option>
                      <option value="guardian">Người giám hộ</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              <label>
                Người liên hệ khẩn cấp khác
                <input
                  value={form.emergencyName}
                  onChange={(e) => set("emergencyName", e.target.value)}
                />
              </label>
              <label>
                Số điện thoại khẩn cấp khác
                <input
                  value={form.emergencyPhone}
                  onChange={(e) => set("emergencyPhone", e.target.value)}
                />
              </label>
            </>
          )}
          <label className="form-wide">
            Ghi chú
            <textarea
              maxLength="2000"
              value={form.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(-1)}
          >
            Hủy
          </button>
          <button className="button button-primary" disabled={saving || loadingInitial}>
            {loadingInitial ? "Đang tải hồ sơ..." : saving ? "Đang lưu..." : "Lưu hồ sơ"}
          </button>
        </div>
      </form>
      {showExcelModal && (
        <StudentExcelImportModal
          isOpen={showExcelModal}
          onClose={() => {
            setShowExcelModal(false);
            if (excelImported) {
              setExcelImported(false);
              navigate("/students");
            }
          }}
          defaultClassroomId={form.classroomId}
          classrooms={classes}
          onSuccess={() => {
            // Giữ modal mở để người dùng đọc kết quả nhập + thống kê tài khoản Phụ huynh tự tạo
            setExcelImported(true);
          }}
        />
      )}
    </AppShell>
  );
}
