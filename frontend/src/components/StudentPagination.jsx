export const STUDENTS_PER_PAGE = 10;

export default function StudentPagination({ total, page, onChange, label = 'học sinh' }) {
  const pages = Math.max(1, Math.ceil(total / STUDENTS_PER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  if (!total) return null;
  return <nav className="student-page-controls" aria-label={`Phân trang ${label}`}>
    <span>{(current - 1) * STUDENTS_PER_PAGE + 1}–{Math.min(current * STUDENTS_PER_PAGE, total)} / {total} {label} · Trang {current}/{pages}</span>
    <div><button type="button" className="button button-secondary" disabled={current <= 1} onClick={() => onChange(current - 1)}>Trước</button><button type="button" className="button button-secondary" disabled={current >= pages} onClick={() => onChange(current + 1)}>Sau</button></div>
  </nav>;
}
