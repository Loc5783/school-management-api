import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { getSuperAdminSchoolReport } from '../api/multiSchool';

const formatCurrency = (val) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(val) || 0))} đ`;

const formatDateTime = (val) => {
  if (!val) return 'Chưa ghi nhận';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const ROLE_LABELS = {
  admin: 'Admin Trường',
  principal: 'Ban Giám hiệu / Hiệu trưởng',
  teacher: 'Giáo viên đứng lớp',
  accountant: 'Kế toán học phí',
  hr: 'Nhân sự & Tiền lương',
  chef: 'Đầu bếp & Dinh dưỡng',
  guard: 'Nhân viên & Bảo vệ',
  parent: 'Phụ huynh học sinh'
};

const PLAN_LABELS = {
  professional: 'Gói Toàn diện (Professional)',
  standard: 'Gói Tiêu chuẩn',
  enterprise: 'Gói Chuỗi trường (Enterprise)',
  trial: 'Gói Dùng thử (Trial)'
};

/**
 * Modal Báo cáo 360° của từng Trường dành cho Nhà cung cấp Phần mềm (`SuperAdmin`).
 * Chỉ hiển thị dữ liệu quy mô sử dụng, tài khoản các bộ phận, gói bản quyền Học sinh/năm & các Add-on
 * (tuyệt đối không hiển thị sổ thu học phí hay lương nội bộ của trường).
 */
export default function SuperAdminSchoolReportModal({
  schoolId,
  moduleCatalog = [],
  onClose,
  onEnterWorkspace,
  onOpenConfig
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => {
    if (!schoolId) return undefined;
    let cancelled = false;

    const fetchReport = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getSuperAdminSchoolReport(schoolId);
        if (!cancelled) {
          setReport(res.data?.data || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || 'Không thể tải báo cáo chi tiết của trường này.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchReport();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  if (!schoolId) return null;

  const school = report?.school;
  const billing = school?.saasBilling || report?.saasContract?.billing || {};
  const upsellAddons = school?.availableAddonsToUpsell || report?.saasContract?.availableAddonsToUpsell || [];
  const moduleMap = new Map(moduleCatalog.map((m) => [m.key, m]));
  const totalAccountsCount = (report?.accountsByRole || []).reduce((s, r) => s + (r.total || 0), 0);
  const activeAccountsCount = (report?.accountsByRole || []).reduce((s, r) => s + (r.active || 0), 0);

  return createPortal(
    <div
      className="account-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="account-modal-card"
        style={{ width: 'min(1080px, 96vw)', maxHeight: '90dvh', overflowY: 'auto', padding: '24px 28px' }}
      >
        <div className="account-modal-header" style={{ alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <p className="card-kicker">HỒ SƠ KHÁCH HÀNG TRƯỜNG HỌC &amp; BÁO CÁO SỬ DỤNG 360°</p>
            <h2 style={{ margin: '4px 0' }}>
              {school ? `${school.name} (${school.code})` : 'Đang tải thông tin trường...'}
            </h2>
            {school && (
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                Gói: <strong>{PLAN_LABELS[school.subscriptionPlan] || 'Gói Toàn diện'}</strong> · Trạng thái:{' '}
                <strong style={{ color: school.status === 'active' ? '#15803d' : '#b91c1c' }}>
                  {school.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng'}
                </strong>
                {school.contactPhone ? ` · SĐT: ${school.contactPhone}` : ''}
                {school.contactEmail ? ` · Email: ${school.contactEmail}` : ''}
              </p>
            )}
          </div>

          <div className="classroom-actions" style={{ flexWrap: 'wrap' }}>
            {school && onOpenConfig && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onClose?.();
                  onOpenConfig(school);
                }}
              >
                <Icon name="settings" size={15} /> Cấu hình Giá &amp; Add-on
              </button>
            )}
            {school?.status === 'active' && onEnterWorkspace && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  onClose?.();
                  onEnterWorkspace(school);
                }}
              >
                <Icon name="shield" size={15} /> Vào hỗ trợ kỹ thuật
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={onClose}>
              Đóng
            </button>
          </div>
        </div>

        {loading ? (
          <div className="inline-loader" style={{ padding: '48px 0' }}>
            <span className="loading-orb" />
            Đang tổng hợp quy mô trường học, tài khoản sử dụng và hợp đồng bản quyền SaaS...
          </div>
        ) : error ? (
          <div className="form-error" role="alert" style={{ marginTop: '16px' }}>
            <Icon name="alertCircle" size={17} /> {error}
          </div>
        ) : report ? (
          <>
            <div className="superadmin-report-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                className={`superadmin-report-tab ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                1. Quy mô &amp; Phân hiệu ({report.campuses?.length || 0})
              </button>
              <button
                type="button"
                role="tab"
                className={`superadmin-report-tab ${activeTab === 'accounts' ? 'active' : ''}`}
                onClick={() => setActiveTab('accounts')}
              >
                2. Tài khoản đang sử dụng ({activeAccountsCount}/{totalAccountsCount})
              </button>
              <button
                type="button"
                role="tab"
                className={`superadmin-report-tab ${activeTab === 'licensing' ? 'active' : ''}`}
                onClick={() => setActiveTab('licensing')}
              >
                3. Hợp đồng Bản quyền &amp; Gói Add-on
              </button>
              <button
                type="button"
                role="tab"
                className={`superadmin-report-tab ${activeTab === 'classes' ? 'active' : ''}`}
                onClick={() => setActiveTab('classes')}
              >
                4. Lớp học &amp; Mức độ vận hành ({report.classrooms?.length || 0} lớp)
              </button>
            </div>

            {activeTab === 'overview' && (
              <div>
                <div className="superadmin-kpi-grid" style={{ marginBottom: '18px' }}>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon green"><Icon name="money" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>PHÍ BẢN QUYỀN NĂM (ARR)</small>
                      <strong>
                        {billing.isTrial ? 'Đang dùng thử (0 đ)' : formatCurrency(billing.netAnnualAmount || 0)}
                      </strong>
                      <span className="superadmin-kpi-sub">
                        {billing.billableStudents || 0} HS tính phí · {billing.activeAddonCount || 0} Add-on
                      </span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon purple"><Icon name="students" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>HỌC SINH ĐANG HỌC / QUOTA</small>
                      <strong>
                        {(report.students.enrolled || 0) + (report.students.temporarily_absent || 0)} / {school.quotas.maxStudents}
                      </strong>
                      <span className="superadmin-kpi-sub">
                        Bảo lưu: {report.students.temporarily_absent || 0} · Đã thôi học: {report.students.withdrawn || 0}
                      </span>
                    </div>
                  </div>
                  <div className="superadmin-kpi-card">
                    <span className="superadmin-kpi-icon blue"><Icon name="users" size={20} /></span>
                    <div className="superadmin-kpi-body">
                      <small>TÀI KHOẢN SỬ DỤNG CỦA TRƯỜNG</small>
                      <strong>{activeAccountsCount} hoạt động</strong>
                      <span className="superadmin-kpi-sub">Tổng tài khoản đã cấp: {totalAccountsCount}</span>
                    </div>
                  </div>
                </div>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">CẤU TRÚC PHÂN HIỆU / CƠ SỞ</p>
                      <h3 style={{ margin: '2px 0' }}>Danh sách Phân hiệu thuộc trường ({report.campuses.length} cơ sở)</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table sa-clean-table">
                      <thead>
                        <tr>
                          <th>Mã cơ sở</th>
                          <th>Tên phân hiệu</th>
                          <th>Địa chỉ &amp; SĐT</th>
                          <th>Người phụ trách</th>
                          <th>Số lớp / Học sinh</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.campuses.map((c) => (
                          <tr key={c.code + c.name}>
                            <td><strong>{c.code}</strong></td>
                            <td><strong>{c.name}</strong></td>
                            <td>
                              <div>{c.address || school.address || 'Chưa cập nhật địa chỉ'}</div>
                              {(c.phone || school.contactPhone) && (
                                <small style={{ color: '#64748b' }}>SĐT: {c.phone || school.contactPhone}</small>
                              )}
                            </td>
                            <td>{c.managerName || school.representativeName || '—'}</td>
                            <td><strong>{c.classCount} lớp</strong> · {c.studentCount} học sinh</td>
                            <td>
                              <span className={`student-status ${c.isActive ? 'enrolled' : 'temporarily_absent'}`}>
                                {c.isActive ? 'Hoạt động' : 'Tạm ngưng'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'accounts' && (
              <div>
                <section className="content-card student-list-card" style={{ marginBottom: 16 }}>
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">TỔNG HỢP TÀI KHOẢN THEO VAI TRÒ</p>
                      <h3 style={{ margin: '2px 0' }}>Số lượng tài khoản đang dùng ở từng bộ phận của trường</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table sa-clean-table">
                      <thead>
                        <tr>
                          <th>Vai trò trong trường</th>
                          <th>Tài khoản đang hoạt động</th>
                          <th>Tổng tài khoản đã cấp</th>
                          <th>Đăng nhập gần nhất</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.accountsByRole.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', color: '#64748b' }}>
                              Trường chưa khởi tạo tài khoản người dùng nào.
                            </td>
                          </tr>
                        ) : (
                          report.accountsByRole.map((r) => (
                            <tr key={r._id}>
                              <td><strong>{ROLE_LABELS[r._id] || r._id}</strong></td>
                              <td style={{ color: '#15803d', fontWeight: 700 }}>{r.active} tài khoản</td>
                              <td>{r.total} tài khoản</td>
                              <td>{formatDateTime(r.lastLogin)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="content-card student-list-card">
                  <div className="list-toolbar">
                    <div>
                      <p className="card-kicker">TÀI KHOẢN QUẢN TRỊ BÀN GIAO</p>
                      <h3 style={{ margin: '2px 0' }}>Admin trường &amp; Ban Giám hiệu</h3>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table sa-clean-table">
                      <thead>
                        <tr>
                          <th>Tên đăng nhập</th>
                          <th>Họ và tên</th>
                          <th>Vai trò</th>
                          <th>Liên hệ</th>
                          <th>Đăng nhập gần nhất</th>
                          <th>Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.leadershipAccounts.map((acc) => (
                          <tr key={acc._id}>
                            <td><strong>@{acc.username}</strong></td>
                            <td>{acc.fullName}</td>
                            <td>{ROLE_LABELS[acc.role] || acc.role}</td>
                            <td>{acc.phone || acc.email || '—'}</td>
                            <td>{formatDateTime(acc.lastLogin)}</td>
                            <td>
                              <span className={`student-status ${acc.status === 'active' ? 'enrolled' : 'withdrawn'}`}>
                                {acc.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'licensing' && (
              <div>
                <section className="content-card" style={{ padding: '18px 22px', marginBottom: 16 }}>
                  <p className="card-kicker" style={{ color: '#1d4ed8' }}>BẢNG TÍNH PHÍ BẢN QUYỀN NĂM CỦA TRƯỜNG</p>
                  <div className="sa-form-grid-4" style={{ marginTop: 10 }}>
                    <div className="superadmin-health-box">
                      <small>SĨ SỐ TÍNH PHÍ / NĂM</small>
                      <strong>{billing.billableStudents || 0} học sinh</strong>
                      <small style={{ marginTop: 4 }}>Sĩ số thực tế: {billing.actualStudents || 0} bé</small>
                    </div>
                    <div className="superadmin-health-box">
                      <small>PHÍ GÓI NỀN (THEO HS)</small>
                      <strong>{formatCurrency(billing.coreAnnualAmount || 0)}</strong>
                      <small style={{ marginTop: 4 }}>Đơn giá: {formatCurrency(billing.effectiveBasePrice || 0)}/HS/năm</small>
                    </div>
                    <div className="superadmin-health-box">
                      <small>PHÍ CÁC GÓI ADD-ON ({billing.activeAddonCount || 0})</small>
                      <strong style={{ color: '#0f766e' }}>{formatCurrency(billing.addonAnnualAmount || 0)}</strong>
                      <small style={{ marginTop: 4 }}>Cộng gộp các module nâng cao đã bật</small>
                    </div>
                    <div className="superadmin-health-box" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                      <small style={{ color: '#166534' }}>TỔNG HỢP ĐỒNG / NĂM (ARR)</small>
                      <strong style={{ color: '#15803d' }}>{formatCurrency(billing.netAnnualAmount || 0)}</strong>
                      <small style={{ marginTop: 4, color: '#166534' }}>
                        {billing.discountPercent > 0 ? `Đã chiết khấu ${billing.discountPercent}%` : `~${formatCurrency(Math.round((billing.netAnnualAmount || 0) / 12))}/tháng`}
                      </small>
                    </div>
                  </div>
                </section>

                <div className="superadmin-two-col">
                  <section className="content-card" style={{ padding: '18px 20px' }}>
                    <p className="card-kicker" style={{ color: '#15803d' }}>
                      CÁC GÓI ADD-ON TRƯỜNG ĐANG SỬ DỤNG ({(billing.activeAddons || []).length})
                    </p>
                    {(billing.activeAddons || []).length === 0 ? (
                      <p style={{ color: '#64748b', fontSize: 13 }}>Trường hiện chỉ sử dụng Gói Nền cơ bản.</p>
                    ) : (
                      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        {billing.activeAddons.map((ad) => (
                          <div key={ad.moduleKey} className="sa-donut-row">
                            <div>
                              <strong>✓ {ad.label}</strong>
                              <small style={{ display: 'block', color: '#64748b' }}>
                                {ad.pricingMode === 'flat_school_year'
                                  ? `Trọn gói ${formatCurrency(ad.unitPrice)}/trường/năm`
                                  : `${formatCurrency(ad.unitPrice)}/HS/năm × ${billing.billableStudents} HS`}
                              </small>
                            </div>
                            <strong style={{ color: '#15803d' }}>{formatCurrency(ad.annualAmount)}/năm</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="content-card" style={{ padding: '18px 20px' }}>
                    <p className="card-kicker" style={{ color: '#b45309' }}>
                      GÓI ADD-ON CÓ THỂ CHÀO BÁN THÊM ({upsellAddons.length})
                    </p>
                    {upsellAddons.length === 0 ? (
                      <p style={{ color: '#15803d', fontSize: 13, fontWeight: 600, marginTop: 10 }}>
                        ✓ Trường đã kích hoạt trọn bộ 100% các gói Add-on trên hệ thống!
                      </p>
                    ) : (
                      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        {upsellAddons.map((up) => (
                          <div key={up.moduleKey} className="sa-donut-row">
                            <div>
                              <strong>{up.label}</strong>
                              <small style={{ display: 'block', color: '#64748b' }}>{up.desc}</small>
                            </div>
                            <span className="sa-addon-price-pill">
                              {up.pricingMode === 'flat_school_year'
                                ? `+${formatCurrency(up.price)}/năm`
                                : `+${formatCurrency(up.price)}/HS/năm`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 14 }}>
                      <small style={{ color: '#64748b', display: 'block', marginBottom: 6 }}>
                        Module Gói Nền đang bật:
                      </small>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {school.enabledModules
                          .filter((k) => moduleMap.get(k)?.tier === 'core')
                          .map((k) => (
                            <span key={k} className="sa-addon-mini-chip">
                              {moduleMap.get(k)?.label || k}
                            </span>
                          ))}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {activeTab === 'classes' && (
              <section className="content-card student-list-card">
                <div className="list-toolbar">
                  <div>
                    <p className="card-kicker">DANH SÁCH LỚP HỌC ĐANG HOẠT ĐỘNG</p>
                    <h3 style={{ margin: '2px 0' }}>Quy mô lớp học &amp; sĩ số của trường ({report.classrooms.length} lớp)</h3>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table sa-clean-table">
                    <thead>
                      <tr>
                        <th>Tên lớp</th>
                        <th>Nhóm tuổi</th>
                        <th>Phân hiệu</th>
                        <th>Giáo viên chủ nhiệm</th>
                        <th>Sĩ số / Tối đa</th>
                        <th>Tỷ lệ lấp đầy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.classrooms.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                            Trường chưa khởi tạo lớp học nào.
                          </td>
                        </tr>
                      ) : (
                        report.classrooms.map((cls) => (
                          <tr key={cls._id}>
                            <td><strong>{cls.name}</strong></td>
                            <td>{cls.ageGroup}</td>
                            <td>{cls.campus}</td>
                            <td>{cls.homeroomTeacher}</td>
                            <td><strong>{cls.studentCount}</strong> / {cls.capacity}</td>
                            <td><strong>{cls.occupancyPercent}%</strong></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
