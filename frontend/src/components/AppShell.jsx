import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';
import AppErrorBoundary from './ErrorBoundary';
import api from '../api/axiosConfig';
import { getUnreadChat } from '../api/chat';
import { enterSchoolWorkspace, getPublicSystemMeta, getSuperAdminSchools } from '../api/multiSchool';
import { playGentleAttendanceChime } from '../utils/vietnameseHardwareTranslator';

const ROUTE_MODULE_MAP = {
  '/attendance': 'attendance',
  '/timekeeping': 'timekeeping',
  '/devices': 'timekeeping',
  '/hr': 'hr',
  '/payroll': 'hr',
  '/my-payroll': 'hr',
  '/my-staffing': 'hr',
  '/my-leave-requests': 'hr',
  '/finance': 'finance',
  '/accounting': 'finance',
  '/kitchen': 'nutrition',
  '/nutrition': 'nutrition',
  '/guard': 'guard',
  '/pickups': 'pickups',
  '/assets': 'procurement',
  '/reports': 'reports',
  '/internal-notices': 'notifications',
  '/student-profile-change-requests': 'feedback',
  '/parent-feedback': 'feedback',
  '/messages': 'chat'
};

const isNavAllowedByTenantModules = (targetTo, tenantObj) => {
  if (!tenantObj?.moduleGateConfigured || !Array.isArray(tenantObj.enabledModules)) {
    return true;
  }
  const cleanPath = String(targetTo || '').split('?')[0];
  for (const [prefix, modKey] of Object.entries(ROUTE_MODULE_MAP)) {
    if (cleanPath === prefix || cleanPath.startsWith(`${prefix}/`)) {
      return tenantObj.enabledModules.includes(modKey);
    }
  }
  return true;
};

// Context truyền các khe cắm (Portal Slots) của Topbar từ PersistentAppShell xuống từng trang,
// giúp giữ nguyên Sidebar & Topbar xuyên suốt quá trình chuyển trang mà không bị remount hay nhấp nháy.
const AppShellSlotContext = createContext(null);

const readStoredJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const allNavItems = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'grid', roles: ['admin', 'principal', 'teacher'], theme: 'system' },
  { to: '/principal', label: 'Sổ điều hành', icon: 'chart', roles: ['admin', 'principal'], theme: 'system' },
  { to: '/campuses', label: 'Trường & Phân hiệu', icon: 'classes', roles: ['admin', 'principal'], theme: 'system' },
  { to: '/accounts', label: 'Tài khoản & vai trò', icon: 'shield', roles: ['admin', 'hr'], theme: 'hr' },
  { to: '/students', label: 'Học sinh', icon: 'students', roles: ['admin', 'principal', 'teacher', 'hr'], theme: 'student' },
  { to: '/classrooms', label: 'Lớp học', icon: 'classes', roles: ['admin', 'principal'], theme: 'student' },
  { to: '/attendance', label: 'Điểm danh', icon: 'attendance', roles: ['admin', 'teacher'], theme: 'student' },
  { to: '/attendance/reports', label: 'Báo cáo điểm danh', icon: 'attendance', roles: ['principal'], theme: 'student' },
  { to: '/timekeeping', label: 'Chấm công nhân sự', icon: 'clock', roles: ['admin', 'principal', 'guard', 'chef', 'hr'], theme: 'hr' },
  { to: '/hr', label: 'Nhân sự', icon: 'users', roles: ['admin', 'principal', 'hr'], theme: 'hr' },
  { to: '/payroll', label: 'Lương & Chi trả', icon: 'money', roles: ['admin', 'principal', 'accountant', 'hr'], theme: 'hr' },
  { to: '/finance', label: 'Tài chính', icon: 'money', roles: ['admin', 'principal', 'accountant'], theme: 'finance' },
  { to: '/accounting', label: 'Tổng quan kế toán', icon: 'grid', roles: ['accountant'], theme: 'system' },
  { to: '/accounting/expenses', label: 'Sổ chi mua sắm', icon: 'money', roles: ['accountant', 'admin'], theme: 'finance' },
  { to: '/accounting/operating-expenses', label: 'Chi vận hành', icon: 'money', roles: ['admin', 'principal', 'accountant'], theme: 'finance' },
  { to: '/accounting/cashbook', label: 'Đối soát thu – chi', icon: 'chart', roles: ['accountant', 'admin'], theme: 'finance' },
  { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart', roles: ['accountant', 'admin'], theme: 'finance' },
  { to: '/kitchen', label: 'Bếp hôm nay', icon: 'grid', roles: ['chef', 'admin'], theme: 'ops' },
  { to: '/nutrition', label: 'Bếp ăn & Bán trú', icon: 'utensils', roles: ['admin', 'principal', 'chef', 'teacher'], theme: 'ops' },
  { to: '/guard', label: 'Tổng quan trực cổng', icon: 'grid', roles: ['guard', 'admin'], theme: 'ops' },
  { to: '/pickups', label: 'Đón trẻ', icon: 'users', roles: ['parent', 'admin', 'principal'], theme: 'student' },
  { to: '/assets', label: 'Đề xuất mua sắm', icon: 'settings', roles: ['teacher'], theme: 'ops' },
  { to: '/assets', label: 'Cơ sở vật chất', icon: 'settings', roles: ['admin', 'principal'], theme: 'ops' },
  { to: '/reports', label: 'Báo cáo', icon: 'chart', roles: ['admin', 'principal', 'accountant'], theme: 'system' },
  { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'calendar', roles: ['admin', 'principal', 'hr', 'teacher', 'accountant', 'chef', 'guard'], theme: 'hr' },
  { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar', roles: ['teacher', 'chef', 'guard'], theme: 'personal' },
  { to: '/my-payroll', label: 'Lương của tôi', icon: 'money', roles: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'], theme: 'personal' },
  { to: '/student-profile-change-requests', label: 'Duyệt cập nhật hồ sơ', icon: 'card', roles: ['principal'], theme: 'student' },
  { to: '/parent-feedback', label: 'Phản hồi phụ huynh', icon: 'chat', roles: ['principal'], theme: 'student' },
  { to: '/parent-dashboard', label: 'Tổng quan', icon: 'grid', roles: ['parent'], theme: 'system' },
  { to: '/parent-portal', label: 'Thông tin của con', icon: 'students', roles: ['parent'], theme: 'student' },
  { to: '/parent-care', label: 'Sổ chăm sóc của con', icon: 'attendance', roles: ['parent'], theme: 'student' },
  { to: '/messages', label: 'Tin nhắn', icon: 'chat', roles: ['parent', 'teacher'], theme: 'student' },
  { to: '/daily-care', label: 'Sổ chăm sóc lớp', icon: 'attendance', roles: ['teacher'], theme: 'student' },
];

const ADMIN_SIDEBAR_STORAGE_KEY = 'admin_sidebar_open_groups';

/**
 * Bảng phân chia nhóm Menu theo đúng chức trách của từng Vai trò (8 vai trò trong trường):
 * 1. `admin` (Quản trị Hệ thống Trường & Phân hiệu): Chỉ quản lý cấu hình hệ thống của trường/phân hiệu,
 *    khung lớp học, cấp tài khoản cho các vai trò nội bộ, kết nối thiết bị chấm công/Webhook & nhật ký hệ thống.
 * 2. `principal` (Ban Giám đốc / Hiệu trưởng): Điều hành toàn diện học sinh, giáo viên, tài chính, bếp ăn, tài sản & phê duyệt.
 * 3. `teacher` (Giáo viên đứng lớp): Quản lý lớp được phân công, điểm danh, sổ chăm sóc, tin nhắn phụ huynh.
 * 4. `chef` (Đầu bếp / Dinh dưỡng): Suất nấu hôm nay, thực đơn tuần, kho thực phẩm, lưu mẫu 24h & đề xuất mua sắm bếp.
 * 5. `accountant` (Kế toán): Học phí, công nợ, hoàn phí, đối soát lương, chi vận hành, sổ quỹ & báo cáo kế toán.
 * 6. `hr` (Nhân sự): Hồ sơ nhân sự, cấp tài khoản nhân viên, phân công ca/lớp, bảng công, lập lương & điều chuyển HS.
 * 7. `guard` (Bảo vệ): Ca trực cổng, quét QR đón trẻ, khách ra vào, giao nhận hàng hóa, sự cố & khẩn cấp.
 * 8. `parent` (Phụ huynh): Theo dõi con, sổ chăm sóc, đăng ký người đón QR, học phí, đơn xin nghỉ & nhắn tin giáo viên.
 */
const adminNavSections = [
  {
    id: 'admin-campus-system',
    label: 'CÀI ĐẶT PHÂN HIỆU TRƯỜNG',
    icon: 'settings',
    theme: 'system',
    items: [
      { to: '/campuses?tab=settings', label: 'Cài đặt Vận hành Phân hiệu', icon: 'settings' },
      { to: '/campuses', label: 'Hồ sơ Phân hiệu & Gói Phần mềm', icon: 'classes' },
      { to: '/classrooms', label: 'Quản lý Khung Lớp học', icon: 'grid' },
    ],
  },
  {
    id: 'admin-accounts-rbac',
    label: 'TÀI KHOẢN CHỨC NĂNG',
    icon: 'shield',
    theme: 'hr',
    items: [
      { to: '/accounts', label: 'Cấp Tài khoản Nhân sự (GĐ, GV, Bếp...)', icon: 'users' },
      { to: '/accounts?tab=parents', label: 'Duyệt Tài khoản Phụ huynh', icon: 'shield' },
      { to: '/accounts?tab=profile-requests', label: 'Duyệt Cập nhật Hồ sơ', icon: 'card' },
    ],
  },
  {
    id: 'admin-devices-logs',
    label: 'MÁY CHẤM CÔNG & NHẬT KÝ',
    icon: 'clock',
    theme: 'ops',
    items: [
      { to: '/devices', label: 'Máy chấm công & Cầu nối nội bộ', icon: 'clock' },
      { to: '/audit-logs', label: 'Nhật ký Hoạt động Phân hiệu', icon: 'fileText' },
    ],
  },
  {
    id: 'admin-security',
    label: 'THÔNG BÁO & BẢO MẬT',
    icon: 'lock',
    theme: 'personal',
    items: [
      { to: '/internal-notices', label: 'Thông báo Nội bộ Trường', icon: 'bell' },
      { to: '/staff-settings', label: 'Đổi mật khẩu Admin Trường', icon: 'settings' },
    ],
  },
];

const PRINCIPAL_SIDEBAR_STORAGE_KEY = 'principal_sidebar_open_groups';

const principalNavSections = [
  {
    id: 'overview-ops',
    label: 'ĐIỀU HÀNH & PHÂN TRƯỜNG',
    icon: 'grid',
    theme: 'system',
    items: [
      { to: '/principal', label: 'Sổ điều hành Giám đốc', icon: 'chart' },
      { to: '/dashboard', label: 'Tổng quan hôm nay', icon: 'grid' },
      { to: '/campuses', label: 'Hệ thống Phân hiệu', icon: 'classes' },
      { to: '/reports', label: 'Báo cáo Nhà trường', icon: 'chart' },
    ],
  },
  {
    id: 'supervision',
    label: 'HỌC SINH & LỚP HỌC',
    icon: 'students',
    theme: 'student',
    items: [
      { to: '/students', label: 'Hồ sơ học sinh', icon: 'students' },
      { to: '/classrooms', label: 'Quản lý lớp học', icon: 'classes' },
      { to: '/attendance/reports', label: 'Báo cáo chuyên cần', icon: 'attendance' },
      { to: '/pickups', label: 'Giám sát đón trẻ', icon: 'users' },
      { to: '/student-profile-change-requests', label: 'Duyệt hồ sơ học sinh', icon: 'card' },
      { to: '/parent-feedback', label: 'Phản hồi phụ huynh', icon: 'chat' },
    ],
  },
  {
    id: 'approvals',
    label: 'GIÁO VIÊN & NHÂN SỰ',
    icon: 'users',
    theme: 'hr',
    items: [
      { to: '/hr', label: 'Nhân sự & Phân công', icon: 'users' },
      { to: '/hr?tab=leave', label: 'Duyệt nghỉ phép', icon: 'calendar' },
      { to: '/payroll?tab=approvals', label: 'Duyệt bảng lương', icon: 'money' },
      { to: '/internal-notices', label: 'Thông báo chỉ đạo', icon: 'bell' },
    ],
  },
  {
    id: 'reports',
    label: 'TÀI CHÍNH, BẾP & TÀI SẢN',
    icon: 'money',
    theme: 'finance',
    items: [
      { to: '/finance', label: 'Tài chính học phí', icon: 'money' },
      { to: '/finance?tab=refunds', label: 'Duyệt hoàn học phí', icon: 'money' },
      { to: '/accounting/operating-expenses', label: 'Duyệt chi vận hành', icon: 'money' },
      { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart' },
      { to: '/nutrition', label: 'Duyệt thực đơn & Bếp ăn', icon: 'utensils' },
      { to: '/assets', label: 'Cơ sở vật chất & Mua sắm', icon: 'settings' },
    ],
  },
  {
    id: 'personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/timekeeping', label: 'Chấm công của tôi', icon: 'clock' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const TEACHER_SIDEBAR_STORAGE_KEY = 'teacher_sidebar_open_groups';

const teacherNavSections = [
  {
    id: 'teacher-overview',
    label: 'TỔNG QUAN',
    icon: 'grid',
    theme: 'system',
    items: [
      { to: '/dashboard', label: 'Tổng quan lớp học', icon: 'grid' },
    ],
  },
  {
    id: 'teacher-classroom-care',
    label: 'HỌC SINH & LỚP HỌC',
    icon: 'classes',
    theme: 'student',
    items: [
      { to: '/students', label: 'Học sinh lớp tôi', icon: 'students' },
      { to: '/attendance', label: 'Điểm danh & Trả trẻ', icon: 'attendance' },
      { to: '/daily-care', label: 'Sổ chăm sóc lớp', icon: 'attendance' },
      { to: '/messages', label: 'Tin nhắn phụ huynh', icon: 'chat' },
      { to: '/nutrition', label: 'Thực đơn & Dị ứng lớp', icon: 'utensils' },
    ],
  },
  {
    id: 'teacher-work',
    label: 'CÔNG VIỆC GIÁO VIÊN',
    icon: 'calendar',
    theme: 'hr',
    items: [
      { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'bell' },
      { to: '/assets', label: 'Đề xuất mua sắm lớp', icon: 'settings' },
    ],
  },
  {
    id: 'teacher-personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/timekeeping?tab=corrections', label: 'Chấm công & Bù công', icon: 'clock' },
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const CHEF_SIDEBAR_STORAGE_KEY = 'chef_sidebar_open_groups';

const chefNavSections = [
  {
    id: 'chef-kitchen-ops',
    label: 'VẬN HÀNH BẾP BÁN TRÚ',
    icon: 'utensils',
    theme: 'ops',
    items: [
      { to: '/kitchen', label: 'Bếp hôm nay (Suất nấu)', icon: 'grid' },
      { to: '/nutrition', label: 'Thực đơn, Kho & Lưu mẫu 24h', icon: 'utensils' },
      { to: '/assets', label: 'Đề xuất Mua sắm Bếp', icon: 'settings' },
    ],
  },
  {
    id: 'chef-shifts',
    label: 'CA TRỰC & NỘI BỘ',
    icon: 'clock',
    theme: 'hr',
    items: [
      { to: '/timekeeping', label: 'Chấm công ca bếp', icon: 'clock' },
      { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'bell' },
    ],
  },
  {
    id: 'chef-personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const HR_SIDEBAR_STORAGE_KEY = 'hr_sidebar_open_groups';

const hrNavSections = [
  {
    id: 'hr-core',
    label: 'NHÂN SỰ, CHẤM CÔNG & LƯƠNG',
    icon: 'users',
    theme: 'hr',
    items: [
      { to: '/hr', label: 'Hồ sơ Nhân sự & Hợp đồng', icon: 'users' },
      { to: '/accounts', label: 'Cấp Tài khoản Nhân viên', icon: 'shield' },
      { to: '/hr?tab=staffing', label: 'Phân công Giáo viên & Ca', icon: 'calendar' },
      { to: '/hr?tab=timekeeping', label: 'Chấm công toàn trường', icon: 'clock' },
      { to: '/hr?tab=devices', label: 'Ánh xạ Máy chấm công', icon: 'settings' },
      { to: '/hr?tab=leave', label: 'Quản lý Đơn nghỉ phép', icon: 'fileText' },
      { to: '/payroll', label: 'Lập Bảng lương tháng', icon: 'money' },
    ],
  },
  {
    id: 'hr-coordination',
    label: 'ĐIỀU PHỐI & TRUYỀN THÔNG',
    icon: 'students',
    theme: 'student',
    items: [
      { to: '/students', label: 'Tra cứu & Điều chuyển HS', icon: 'students' },
      { to: '/internal-notices', label: 'Thông báo & Bảng công', icon: 'bell' },
    ],
  },
  {
    id: 'hr-personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/timekeeping', label: 'Chấm công của tôi', icon: 'clock' },
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const ACCOUNTANT_SIDEBAR_STORAGE_KEY = 'accountant_sidebar_open_groups';

const accountantNavSections = [
  {
    id: 'accountant-overview',
    label: 'TỔNG QUAN',
    icon: 'grid',
    theme: 'system',
    items: [
      { to: '/accounting', label: 'Tổng quan kế toán', icon: 'grid' },
    ],
  },
  {
    id: 'accountant-tuition',
    label: 'HỌC PHÍ HỌC SINH',
    icon: 'money',
    theme: 'student',
    items: [
      { to: '/finance?tab=invoices', label: 'Hóa đơn học phí', icon: 'card' },
      { to: '/finance?tab=schedules', label: 'Thiết lập mức thu', icon: 'settings' },
      { to: '/finance?tab=create', label: 'Lập học phí theo lớp', icon: 'users' },
      { to: '/finance?tab=debts', label: 'Công nợ', icon: 'chart' },
      { to: '/finance?tab=refunds', label: 'Hoàn học phí', icon: 'money' },
    ],
  },
  {
    id: 'accountant-expenses',
    label: 'LƯƠNG & CHI PHÍ',
    icon: 'money',
    theme: 'hr',
    items: [
      { to: '/payroll', label: 'Thanh toán lương NS', icon: 'users' },
      { to: '/accounting/expenses', label: 'Sổ chi mua sắm', icon: 'money' },
      { to: '/accounting/operating-expenses', label: 'Chi vận hành', icon: 'money' },
    ],
  },
  {
    id: 'accountant-cashbook',
    label: 'SỔ QUỸ & BÁO CÁO',
    icon: 'chart',
    theme: 'finance',
    items: [
      { to: '/accounting/cashbook', label: 'Sổ thu – chi / Đối soát', icon: 'chart' },
      { to: '/accounting/report', label: 'Báo cáo kế toán', icon: 'chart' },
      { to: '/finance?tab=report', label: 'Báo cáo kỳ thu', icon: 'chart' },
      { to: '/reports', label: 'Báo cáo tổng hợp', icon: 'chart' },
    ],
  },
  {
    id: 'accountant-personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/timekeeping', label: 'Chấm công của tôi', icon: 'clock' },
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'bell' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const GUARD_SIDEBAR_STORAGE_KEY = 'guard_sidebar_open_groups';

const guardNavSections = [
  {
    id: 'guard-overview',
    label: 'CA TRỰC & CHẤM CÔNG',
    icon: 'grid',
    theme: 'hr',
    items: [
      { to: '/guard?tab=overview', label: 'Tổng quan ca trực & Quét QR', icon: 'grid' },
      { to: '/timekeeping', label: 'Chấm công vào/ra ca', icon: 'clock' },
      { to: '/my-staffing', label: 'Lịch phân công của tôi', icon: 'calendar' },
      { to: '/guard?tab=handover', label: 'Bàn giao ca trực', icon: 'clock' },
      { to: '/internal-notices', label: 'Thông báo nội bộ', icon: 'bell' },
    ],
  },
  {
    id: 'guard-security',
    label: 'AN NINH & TRỰC CỔNG',
    icon: 'shield',
    theme: 'ops',
    items: [
      { to: '/guard?tab=visitors', label: 'Khách ra/vào', icon: 'users' },
      { to: '/guard?tab=deliveries', label: 'Giao nhận hàng & Thực phẩm', icon: 'utensils' },
      { to: '/guard?tab=incidents', label: 'Sự cố an ninh', icon: 'alertCircle' },
      { to: '/guard?tab=emergency', label: 'Xử lý khẩn cấp', icon: 'shield' },
    ],
  },
  {
    id: 'guard-personal',
    label: 'THÔNG TIN CÁ NHÂN',
    icon: 'users',
    theme: 'personal',
    items: [
      { to: '/my-leave-requests', label: 'Nghỉ phép cá nhân', icon: 'calendar' },
      { to: '/my-payroll', label: 'Lương của tôi', icon: 'money' },
      { to: '/staff-settings', label: 'Cài đặt tài khoản', icon: 'settings' },
    ],
  },
];

const PARENT_SIDEBAR_STORAGE_KEY = 'parent_sidebar_open_groups';

const parentNavSections = [
  {
    id: 'parent-children',
    label: 'THEO DÕI CON HẰNG NGÀY',
    icon: 'students',
    theme: 'student',
    items: [
      { to: '/parent-dashboard', label: 'Tổng quan hôm nay', icon: 'grid' },
      { to: '/parent-portal', label: 'Hồ sơ, Học phí & Xin nghỉ', icon: 'students' },
      { to: '/parent-care', label: 'Sổ chăm sóc của con', icon: 'attendance' },
      { to: '/pickups', label: 'Đăng ký đón trẻ & Mã QR', icon: 'card' },
      { to: '/messages', label: 'Nhắn tin với Giáo viên', icon: 'chat' },
    ],
  },
  {
    id: 'parent-account',
    label: 'TÀI KHOẢN PHỤ HUYNH',
    icon: 'settings',
    theme: 'personal',
    items: [
      { to: '/parent-settings', label: 'Cài đặt cá nhân', icon: 'settings' },
    ],
  },
];

const isNavItemActive = (itemTo, pathname, search) => {
  const [targetPath, targetQuery] = itemTo.split('?');
  const targetParams = new URLSearchParams(targetQuery || '');
  const targetTab = targetParams.get('tab');

  const currentParams = new URLSearchParams(search || '');
  const currentTab = currentParams.get('tab');

  if (pathname !== targetPath) {
    if (pathname.startsWith(`${targetPath}/`)) {
      if (targetPath === '/accounting') {
        return false;
      }
      if (targetTab) {
        return currentTab === targetTab;
      }
      return true;
    }
    return false;
  }

  // Exact pathname match
  if (targetPath === '/guard') {
    if (targetTab) {
      if (targetTab === 'overview') {
        return !currentTab || currentTab === 'overview';
      }
      return currentTab === targetTab;
    }
    return !currentTab || currentTab === 'overview';
  }

  if (targetPath === '/finance') {
    if (targetTab) {
      if (targetTab === 'invoices') {
        return !currentTab || currentTab === 'invoices' || !['invoices', 'refunds', 'schedules', 'create', 'debts', 'report'].includes(currentTab);
      }
      return currentTab === targetTab;
    }
    return currentTab !== 'refunds';
  }

  if (targetPath === '/hr') {
    if (targetTab) {
      return currentTab === targetTab;
    }
    return !currentTab || currentTab === 'employees';
  }

  if (targetPath === '/campuses') {
    if (targetTab) {
      return currentTab === targetTab;
    }
    return !currentTab || currentTab === 'campuses';
  }

  if (targetPath === '/accounts') {
    if (targetTab) {
      return currentTab === targetTab;
    }
    return !currentTab || currentTab === 'internal';
  }

  if (targetTab) {
    return currentTab === targetTab;
  }

  return true;
};

const isPrincipalItemActive = isNavItemActive;

const getActiveSectionId = (sections, pathname, search) => {
  for (const section of sections) {
    if (section.items.some((item) => isPrincipalItemActive(item.to, pathname, search))) {
      return section.id;
    }
  }
  return null;
};

function ShellFrame({ title, subtitle, actions, children, isPersistentLayout = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const chatUnreadRequestRef = useRef(0);
  const [titleSlot, setTitleSlot] = useState(null);
  const [subtitleSlot, setSubtitleSlot] = useState(null);
  const [actionsSlot, setActionsSlot] = useState(null);
  const [user, setUser] = useState(() => readStoredJson('user'));
  const [tenant, setTenant] = useState(() => readStoredJson('tenant'));
  const [permissions, setPermissions] = useState(() => readStoredJson('user')?.permissions || []);
  const [loading, setLoading] = useState(() => !readStoredJson('user'));
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState({ total: 0, data: [] });
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [systemBanner, setSystemBanner] = useState(null);
  const [prevPath, setPrevPath] = useState(location.pathname);

  useEffect(() => {
    let cancelled = false;
    const currentSchoolCode = tenant?.code || user?.schoolCode || '';
    getPublicSystemMeta(currentSchoolCode)
      .then((res) => {
        const banner = res.data?.data?.systemBanner;
        if (!cancelled) {
          setSystemBanner(banner?.enabled && banner?.message ? banner : null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenant?.code, user?.schoolCode]);
  const slotContextValue = useMemo(
    () => (isPersistentLayout ? { titleSlot, subtitleSlot, actionsSlot } : null),
    [isPersistentLayout, titleSlot, subtitleSlot, actionsSlot]
  );
  const [openSections, setOpenSections] = useState(() => {
    let initialOpen = principalNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(PRINCIPAL_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu hiệu trưởng:', e);
    }
    const activeSectionId = getActiveSectionId(principalNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [teacherOpenSections, setTeacherOpenSections] = useState(() => {
    let initialOpen = teacherNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(TEACHER_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu giáo viên:', e);
    }
    const activeSectionId = getActiveSectionId(teacherNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [accountantOpenSections, setAccountantOpenSections] = useState(() => {
    let initialOpen = accountantNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu kế toán:', e);
    }
    const activeSectionId = getActiveSectionId(accountantNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [guardOpenSections, setGuardOpenSections] = useState(() => {
    let initialOpen = guardNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(GUARD_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu bảo vệ:', e);
    }
    const activeSectionId = getActiveSectionId(guardNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [adminOpenSections, setAdminOpenSections] = useState(() => {
    let initialOpen = adminNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(ADMIN_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.some((id) => adminNavSections.some((s) => s.id === id))) {
          initialOpen = parsed;
        }
      }
    } catch (e) {
      console.error('Lỗi đọc trạng thái menu quản trị:', e);
    }
    const activeSectionId = getActiveSectionId(adminNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [chefOpenSections, setChefOpenSections] = useState(() => {
    let initialOpen = chefNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(CHEF_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) initialOpen = parsed;
      }
    } catch {
      // Bỏ qua lỗi localStorage
    }
    const activeSectionId = getActiveSectionId(chefNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [hrOpenSections, setHrOpenSections] = useState(() => {
    let initialOpen = hrNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(HR_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) initialOpen = parsed;
      }
    } catch {
      // Bỏ qua lỗi localStorage
    }
    const activeSectionId = getActiveSectionId(hrNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  const [parentOpenSections, setParentOpenSections] = useState(() => {
    let initialOpen = parentNavSections.map((s) => s.id);
    try {
      const saved = localStorage.getItem(PARENT_SIDEBAR_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) initialOpen = parsed;
      }
    } catch {
      // Bỏ qua lỗi localStorage
    }
    const activeSectionId = getActiveSectionId(parentNavSections, location.pathname, location.search);
    if (activeSectionId && !initialOpen.includes(activeSectionId)) {
      initialOpen = [...initialOpen, activeSectionId];
    }
    return initialOpen;
  });

  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMobileNavOpen(false);
    setShowNotifications(false);
  }

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await api.get('/auth/me');
        const userData = res.data?.data || res.data;
        if (userData && typeof userData === 'object') {
          setUser(userData);
          setPermissions(userData.permissions || []);
          localStorage.setItem('user', JSON.stringify(userData));
        }
        if (res.data?.tenant) {
          setTenant(res.data.tenant);
          localStorage.setItem('tenant', JSON.stringify(res.data.tenant));
        } else if (res.data && Object.prototype.hasOwnProperty.call(res.data, 'tenant')) {
          setTenant(null);
          localStorage.removeItem('tenant');
        }
      } catch (err) {
        // Không xóa tenant khi chỉ bị rớt mạng tạm thời hoặc lỗi 5xx thoáng qua
        console.error('Lỗi lấy user:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
    const syncStoredTenant = () => {
      setTenant(readStoredJson('tenant'));
    };
    const handleStorageSync = (event) => {
      if (event.key === 'token' && !event.newValue) {
        window.location.assign('/login');
        return;
      }
      if (event.key === 'user') {
        const nextUser = readStoredJson('user');
        if (nextUser) setUser(nextUser);
      }
      if (event.key === 'tenant') {
        setTenant(readStoredJson('tenant'));
      }
    };
    window.addEventListener('tenant-updated', syncStoredTenant);
    window.addEventListener('storage', handleStorageSync);
    return () => {
      window.removeEventListener('tenant-updated', syncStoredTenant);
      window.removeEventListener('storage', handleStorageSync);
    };
  }, []);

  useEffect(() => {
    if (!isPersistentLayout) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, isPersistentLayout]);

  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      const activeLink = nav?.querySelector('.nav-link.active');
      if (!nav || !activeLink) return;
      // Chỉ cuộn thanh bên khi mục đang chọn nằm khuất ngoài khung nhìn hiện tại,
      // tránh làm danh sách menu bị giật lên/xuống dưới trỏ chuột mỗi lần chuyển trang.
      const navRect = nav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      if (linkRect.top < navRect.top + 12 || linkRect.bottom > navRect.bottom - 12) {
        activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search, loading]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications', { params: { limit: 10 } });
      setNotifications(res.data.data || []);
      setUnreadCount(res.data.unread || 0);
    } catch (err) { console.error('Lỗi lấy thông báo:', err); }
  }, []);

  const loadUnreadChat = useCallback(async () => {
    const requestId = ++chatUnreadRequestRef.current;
    try {
      const res = await getUnreadChat();
      if (requestId === chatUnreadRequestRef.current) {
        setChatUnread({ total: res.data.total || 0, data: res.data.data || [] });
      }
    } catch (err) { console.error('Lỗi lấy tin nhắn chưa đọc:', err); }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const chatEnabled = ['parent', 'teacher'].includes(user.role);
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void loadNotifications();
      if (chatEnabled) void loadUnreadChat();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('chat:updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('chat:updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [user, loadNotifications, loadUnreadChat]);

  useEffect(() => {
    if (!showNotifications) return undefined;
    const handlePointerDown = (event) => {
      if (notificationMenuRef.current && !notificationMenuRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showNotifications]);

  const isAdminRole = user?.role === 'admin';
  const isPrincipal = user?.role === 'principal';
  const isTeacher = user?.role === 'teacher';
  const isChef = user?.role === 'chef';
  const isHr = user?.role === 'hr';
  const isAccountant = user?.role === 'accountant';
  const isGuard = user?.role === 'guard';
  const isParent = user?.role === 'parent';

  // Trạng thái chuyển nhanh Phân hiệu dành cho Kỹ thuật viên Nhà cung cấp & Luồng thông báo tiếng Việt thời gian thực (SSE)
  const [vendorSchools, setVendorSchools] = useState([]);
  const [switchingSchoolId, setSwitchingSchoolId] = useState('');
  const [liveToasts, setLiveToasts] = useState([]);
  const [liveSoundEnabled, setLiveSoundEnabled] = useState(() => localStorage.getItem('hn_live_sound') !== 'off');
  const liveSoundRef = useRef(liveSoundEnabled);

  useEffect(() => {
    liveSoundRef.current = liveSoundEnabled;
  }, [liveSoundEnabled]);

  const toggleLiveSound = () => {
    setLiveSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('hn_live_sound', next ? 'on' : 'off');
      } catch { /* ignore */ }
      return next;
    });
  };

  // Tự động cuộn mượt về đầu khung nội dung khi đổi trang hoặc đổi ?tab=settings
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, location.search]);

  // Nếu là phiên Kỹ thuật viên Nhà cung cấp đang vào hỗ trợ bàn giao -> tải danh sách tất cả phân hiệu để chuyển 1 chạm
  useEffect(() => {
    const superToken = localStorage.getItem('superadmin_token');
    if (!superToken) return undefined;
    let cancelled = false;
    getSuperAdminSchools()
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data?.schools || [];
        setVendorSchools(list.filter((s) => s.status === 'active'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenant?._id]);

  // Luồng SSE thời gian thực cô lập đúng phân hiệu: hiện Toast tiếng Việt thân thiện khi trẻ/nhân sự quét mặt
  useEffect(() => {
    const token = localStorage.getItem('token');
    const canReceiveLiveGate = ['admin', 'principal', 'teacher', 'guard', 'hr'].includes(user?.role);
    if (!token || !tenant?._id || !canReceiveLiveGate || typeof window.EventSource === 'undefined') {
      return undefined;
    }

    const streamUrl = `/api/v1/timekeeping/live-stream?streamToken=${encodeURIComponent(token)}`;
    const es = new window.EventSource(streamUrl);

    const handleCampusEvent = (evt) => {
      try {
        const parsed = JSON.parse(evt.data || '{}');
        if (!parsed?.message) return;
        window.dispatchEvent(new CustomEvent('hoanang:campus-live-event', { detail: parsed }));

        setLiveToasts((prev) => [parsed, ...prev.filter((x) => x.id !== parsed.id)].slice(0, 3));
        if (liveSoundRef.current) {
          playGentleAttendanceChime();
        }
        window.setTimeout(() => {
          setLiveToasts((prev) => prev.filter((x) => x.id !== parsed.id));
        }, 8500);
      } catch {
        // ignore malformed event
      }
    };

    es.addEventListener('campus_event', handleCampusEvent);
    return () => {
      es.removeEventListener('campus_event', handleCampusEvent);
      es.close();
    };
  }, [tenant?._id, user?.role]);

  const handleVendorSwitchSchool = async (nextSchoolId) => {
    if (!nextSchoolId || String(nextSchoolId) === String(tenant?._id) || switchingSchoolId) return;
    setSwitchingSchoolId(nextSchoolId);
    try {
      const res = await enterSchoolWorkspace(nextSchoolId);
      const { token: nextToken, tenant: nextTenant, user: nextUser } = res.data || {};
      if (nextToken && nextUser) {
        localStorage.setItem('token', nextToken);
        localStorage.setItem('user', JSON.stringify(nextUser));
        if (nextTenant) {
          localStorage.setItem('tenant', JSON.stringify(nextTenant));
        }
        setUser(nextUser);
        setTenant(nextTenant || null);
        window.location.reload();
      }
    } catch {
      // ignore switch error
    } finally {
      setSwitchingSchoolId('');
    }
  };
  const currentLocationKey = `${location.pathname}${location.search}`;
  const [prevLocationKey, setPrevLocationKey] = useState(currentLocationKey);

  if (prevLocationKey !== currentLocationKey) {
    setPrevLocationKey(currentLocationKey);
    if (isAdminRole) {
      const activeSectionId = getActiveSectionId(adminNavSections, location.pathname, location.search);
      if (activeSectionId && !adminOpenSections.includes(activeSectionId)) {
        const next = [...adminOpenSections, activeSectionId];
        setAdminOpenSections(next);
        try {
          localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu quản trị:', e);
        }
      }
    }
    if (isPrincipal) {
      const activeSectionId = getActiveSectionId(principalNavSections, location.pathname, location.search);
      if (activeSectionId && !openSections.includes(activeSectionId)) {
        const next = [...openSections, activeSectionId];
        setOpenSections(next);
        try {
          localStorage.setItem(PRINCIPAL_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu hiệu trưởng:', e);
        }
      }
    }
    if (isTeacher) {
      const activeSectionId = getActiveSectionId(teacherNavSections, location.pathname, location.search);
      if (activeSectionId && !teacherOpenSections.includes(activeSectionId)) {
        const next = [...teacherOpenSections, activeSectionId];
        setTeacherOpenSections(next);
        try {
          localStorage.setItem(TEACHER_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu giáo viên:', e);
        }
      }
    }
    if (isChef) {
      const activeSectionId = getActiveSectionId(chefNavSections, location.pathname, location.search);
      if (activeSectionId && !chefOpenSections.includes(activeSectionId)) {
        const next = [...chefOpenSections, activeSectionId];
        setChefOpenSections(next);
        try {
          localStorage.setItem(CHEF_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Bỏ qua lỗi localStorage
        }
      }
    }
    if (isHr) {
      const activeSectionId = getActiveSectionId(hrNavSections, location.pathname, location.search);
      if (activeSectionId && !hrOpenSections.includes(activeSectionId)) {
        const next = [...hrOpenSections, activeSectionId];
        setHrOpenSections(next);
        try {
          localStorage.setItem(HR_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Bỏ qua lỗi localStorage
        }
      }
    }
    if (isAccountant) {
      const activeSectionId = getActiveSectionId(accountantNavSections, location.pathname, location.search);
      if (activeSectionId && !accountantOpenSections.includes(activeSectionId)) {
        const next = [...accountantOpenSections, activeSectionId];
        setAccountantOpenSections(next);
        try {
          localStorage.setItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu kế toán:', e);
        }
      }
    }
    if (isGuard) {
      const activeSectionId = getActiveSectionId(guardNavSections, location.pathname, location.search);
      if (activeSectionId && !guardOpenSections.includes(activeSectionId)) {
        const next = [...guardOpenSections, activeSectionId];
        setGuardOpenSections(next);
        try {
          localStorage.setItem(GUARD_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {
          console.error('Lỗi lưu trạng thái menu bảo vệ:', e);
        }
      }
    }
    if (isParent) {
      const activeSectionId = getActiveSectionId(parentNavSections, location.pathname, location.search);
      if (activeSectionId && !parentOpenSections.includes(activeSectionId)) {
        const next = [...parentOpenSections, activeSectionId];
        setParentOpenSections(next);
        try {
          localStorage.setItem(PARENT_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Bỏ qua lỗi localStorage
        }
      }
    }
  }

  const toggleAdminSection = (sectionId) => {
    setAdminOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(ADMIN_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu quản trị:', e);
      }
      return next;
    });
  };

  const toggleSection = (sectionId) => {
    setOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(PRINCIPAL_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu hiệu trưởng:', e);
      }
      return next;
    });
  };

  const toggleTeacherSection = (sectionId) => {
    setTeacherOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(TEACHER_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu giáo viên:', e);
      }
      return next;
    });
  };

  const toggleAccountantSection = (sectionId) => {
    setAccountantOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(ACCOUNTANT_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu kế toán:', e);
      }
      return next;
    });
  };

  const toggleGuardSection = (sectionId) => {
    setGuardOpenSections((prev) => {
      const next = prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId];
      try {
        localStorage.setItem(GUARD_SIDEBAR_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('Lỗi lưu trạng thái menu bảo vệ:', e);
      }
      return next;
    });
  };

  const toggleChefSection = (sectionId) => {
    setChefOpenSections((prev) => {
      const next = prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId];
      try { localStorage.setItem(CHEF_SIDEBAR_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const toggleHrSection = (sectionId) => {
    setHrOpenSections((prev) => {
      const next = prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId];
      try { localStorage.setItem(HR_SIDEBAR_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const toggleParentSection = (sectionId) => {
    setParentOpenSections((prev) => {
      const next = prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId];
      try { localStorage.setItem(PARENT_SIDEBAR_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const toggleNotifications = async () => {
    setShowNotifications((value) => !value);
    if (!showNotifications) {
      await loadNotifications();
      if (['parent', 'teacher'].includes(user?.role)) await loadUnreadChat();
    }
  };

  const openNotification = async (item) => {
    if (!item.isRead) {
      try { await api.patch(`/notifications/${item._id}/read`); } catch (err) { console.error(err); }
    }
    setNotifications((items) => items.map((entry) => entry._id === item._id ? { ...entry, isRead: true } : entry));
    setUnreadCount((count) => Math.max(0, count - (item.isRead ? 0 : 1)));
    setShowNotifications(false);
    if (item.link?.startsWith('/')) navigate(item.link);
  };

  const openChatAlert = (item) => {
    setShowNotifications(false);
    navigate(`/messages?conversation=${item.conversationId}`);
  };

  if (loading) return <div className="page-loader"><span className="loading-orb" /></div>;

  const displayName = user?.profile?.fullName || user?.username || 'Quản trị viên';
  const isAdmin = user?.role === 'admin';
  const isVendorSupportSession = Boolean(user?.isVendorSupport || localStorage.getItem('superadmin_token'));
  const roleLabel = isVendorSupportSession && isAdmin
    ? 'Kỹ thuật viên Nhà cung cấp'
    : ({
        admin: 'Quản trị Phân hiệu Trường',
        principal: 'Ban Giám đốc / Hiệu trưởng',
        teacher: 'Giáo viên đứng lớp',
        accountant: 'Kế toán học phí',
        chef: 'Đầu bếp / Dinh dưỡng',
        hr: 'Nhân sự & Tiền lương',
        parent: 'Phụ huynh học sinh',
        guard: 'Bảo vệ & An ninh'
      }[user?.role] || 'Tài khoản trường');
  const totalUnread = unreadCount + chatUnread.total;
  const homePath =
    user?.role === 'admin'
      ? '/campuses'
      : user?.role === 'guard'
        ? '/guard'
        : user?.role === 'chef'
          ? '/kitchen'
          : user?.role === 'accountant'
            ? '/accounting'
            : user?.role === 'parent'
              ? '/parent-dashboard'
              : user?.role === 'hr'
                ? '/hr'
                : isPrincipal
                  ? '/principal'
                  : '/dashboard';

  // Lọc menu dựa trên permissions và vai trò
  // Đảm bảo không trùng lặp route trong danh sách
  const seenPaths = new Set();
  const navItems = allNavItems.filter((item) => {
    if (!isNavAllowedByTenantModules(item.to, tenant)) return false;
    if (user?.role === 'parent') return Boolean(item.roles?.includes('parent'));
    if (item.positions && !item.positions.includes(user?.employeeInfo?.position)) return false;
    if (item.roles && !item.roles.includes(user?.role)) return false;
    if (!item.roles && !isAdmin) {
      if (!item.permission || !permissions.includes(item.permission)) return false;
    }
    if (seenPaths.has(item.to)) return false;
    seenPaths.add(item.to);
    return true;
  });

  const renderAccordionSections = (sections, openIds, onToggle, ariaLabel, extraClass = '', mobile = false) => {
    const prefix = mobile ? 'mobile' : 'desktop';
    return (
      <div
        className={`principal-nav-accordion ${extraClass}`.trim()}
        role="region"
        aria-label={ariaLabel}
      >
        {sections.map((section) => {
          const visibleItems = section.items.filter(
            (item) =>
              isNavAllowedByTenantModules(item.to, tenant) &&
              (!item.positions || item.positions.includes(user?.employeeInfo?.position))
          );
          if (!visibleItems.length) return null;

          const isOpen = openIds.includes(section.id);
          const contentId = `${prefix}-nav-section-${section.id}`;
          const themeClass = `nav-theme-${section.theme || 'system'}`;

          return (
            <div key={section.id} className={`nav-accordion-section ${themeClass}`}>
              <button
                type="button"
                className={`nav-accordion-header ${isOpen ? 'is-open' : ''}`}
                aria-expanded={isOpen}
                aria-controls={contentId}
                onClick={() => onToggle(section.id)}
              >
                <span className="nav-accordion-header-title">
                  <span className="nav-theme-dot" aria-hidden="true" />
                  {section.icon && <Icon name={section.icon} size={15} />}
                  <span>{section.label}</span>
                </span>
                <span className={`nav-accordion-chevron ${isOpen ? 'expanded' : ''}`}>
                  <Icon name="chevronRight" size={14} />
                </span>
              </button>
              <div
                id={contentId}
                className="nav-accordion-content"
                hidden={!isOpen}
              >
                {visibleItems.map((item) => {
                  const isActive = isNavItemActive(item.to, location.pathname, location.search);
                  return (
                    <NavLink
                      to={item.to}
                      key={item.to}
                      aria-current={isActive ? 'page' : undefined}
                      className={() => `nav-link nav-sub-link ${isActive ? 'active' : ''}`.trim()}
                      onClick={mobile ? () => setMobileNavOpen(false) : undefined}
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.to === '/messages' && chatUnread.total > 0 && (
                        <span className="nav-chat-count">
                          {chatUnread.total > 99 ? '99+' : chatUnread.total}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderNavigation = (mobile = false) => {
    if (isAdmin) {
      return renderAccordionSections(
        adminNavSections,
        adminOpenSections,
        toggleAdminSection,
        mobile ? 'Menu chức năng quản trị di động' : 'Menu chức năng quản trị',
        'admin-nav-accordion',
        mobile
      );
    }

    if (isPrincipal) {
      return renderAccordionSections(
        principalNavSections,
        openSections,
        toggleSection,
        mobile ? 'Menu chức năng hiệu trưởng di động' : 'Menu chức năng hiệu trưởng',
        '',
        mobile
      );
    }

    if (isTeacher) {
      return renderAccordionSections(
        teacherNavSections,
        teacherOpenSections,
        toggleTeacherSection,
        mobile ? 'Menu chức năng giáo viên di động' : 'Menu chức năng giáo viên',
        'teacher-nav-accordion',
        mobile
      );
    }

    if (isAccountant) {
      return renderAccordionSections(
        accountantNavSections,
        accountantOpenSections,
        toggleAccountantSection,
        mobile ? 'Menu chức năng kế toán di động' : 'Menu chức năng kế toán',
        'accountant-nav-accordion',
        mobile
      );
    }

    if (isGuard) {
      return renderAccordionSections(
        guardNavSections,
        guardOpenSections,
        toggleGuardSection,
        mobile ? 'Menu chức năng bảo vệ di động' : 'Menu chức năng bảo vệ',
        'guard-nav-accordion',
        mobile
      );
    }

    if (isChef) {
      return renderAccordionSections(
        chefNavSections,
        chefOpenSections,
        toggleChefSection,
        mobile ? 'Menu chức năng bếp ăn di động' : 'Menu chức năng bếp ăn',
        'chef-nav-accordion',
        mobile
      );
    }

    if (isHr) {
      return renderAccordionSections(
        hrNavSections,
        hrOpenSections,
        toggleHrSection,
        mobile ? 'Menu chức năng nhân sự di động' : 'Menu chức năng nhân sự',
        'hr-nav-accordion',
        mobile
      );
    }

    if (isParent) {
      return renderAccordionSections(
        parentNavSections,
        parentOpenSections,
        toggleParentSection,
        mobile ? 'Menu phụ huynh di động' : 'Menu phụ huynh',
        'parent-nav-accordion',
        mobile
      );
    }

    return (
      <>
        <p className="nav-label">QUẢN LÝ THEO CHỦ ĐỀ</p>
        {navItems.map((item) => {
          const isActive = isNavItemActive(item.to, location.pathname, location.search);
          const itemTheme = `nav-link-theme-${item.theme || 'system'}`;
          return (
            <NavLink
              to={item.to}
              key={item.to}
              aria-current={isActive ? 'page' : undefined}
              className={() => `nav-link ${itemTheme} ${isActive ? 'active' : ''}`.trim()}
              onClick={mobile ? () => setMobileNavOpen(false) : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.to === '/messages' && chatUnread.total > 0 && (
                <span className="nav-chat-count">
                  {chatUnread.total > 99 ? '99+' : chatUnread.total}
                </span>
              )}
            </NavLink>
          );
        })}
      </>
    );
  };

  const hasSuperAdminReturn = Boolean(localStorage.getItem('superadmin_token'));
  const returnToMultiSchoolConsole = () => {
    const superToken = localStorage.getItem('superadmin_token');
    const superUserRaw = localStorage.getItem('superadmin_user');
    if (superToken) {
      localStorage.setItem('token', superToken);
    }
    if (superUserRaw) {
      localStorage.setItem('user', superUserRaw);
    }
    localStorage.removeItem('tenant');
    navigate('/multi-school');
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Bỏ qua lỗi kết nối khi logout
    } finally {
      const wasSuperAdminSession = Boolean(localStorage.getItem('superadmin_token'));
      setUser(null);
      setTenant(null);
      localStorage.removeItem('superadmin_token');
      localStorage.removeItem('superadmin_user');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('tenant');
      if (wasSuperAdminSession) {
        localStorage.removeItem('last_school_code');
      }
      navigate('/login');
    }
  };

  return (
    <div className="app-shell">
      {/* Mobile Drawer Overlay */}
      {mobileNavOpen && (
        <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} role="presentation">
          <aside className="sidebar mobile-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-sidebar-header">
              <NavLink to={homePath} className="brand" onClick={() => setMobileNavOpen(false)} aria-label="Mầm Non Hoa Nắng">
                <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
                <span><strong>Hoa Nắng</strong><small>Mầm Non Hạnh Phúc</small></span>
              </NavLink>
              <button type="button" className="mobile-nav-close" onClick={() => setMobileNavOpen(false)} aria-label="Đóng menu">
                <Icon name="close" size={20} />
              </button>
            </div>
            {tenant && (
              <div className="school-tenant-badge" title={`Cơ sở: ${tenant.name || tenant.code} (${tenant.code})`}>
                <span className="tenant-status-dot" />
                <div className="tenant-info-text">
                  <span className="tenant-school-name">{tenant.name || tenant.code}</span>
                  <span className="tenant-school-code">{tenant.code}</span>
                </div>
              </div>
            )}
            {hasSuperAdminReturn && (
              <div className="vendor-campus-switcher">
                <button type="button" className="superadmin-switch-btn" onClick={returnToMultiSchoolConsole}>
                  <Icon name="shield" size={14} /> Về Trung tâm Nhà cung cấp
                </button>
                {vendorSchools.length > 1 && (
                  <select
                    aria-label="Chọn phân hiệu để cấu hình bàn giao"
                    className="vendor-campus-select"
                    disabled={Boolean(switchingSchoolId)}
                    value={String(tenant?._id || '')}
                    onChange={(e) => handleVendorSwitchSchool(e.target.value)}
                  >
                    {vendorSchools.map((s) => (
                      <option key={s._id} value={s._id}>
                        🔧 Phân hiệu: {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <nav className="sidebar-nav" aria-label="Điều hướng chính di động">
              {renderNavigation(true)}
            </nav>
            <div className="sidebar-bottom">
              {user?.role === 'parent' ? (
                <NavLink to="/parent-settings" className="nav-link nav-link-theme-personal" onClick={() => setMobileNavOpen(false)}>
                  <Icon name="settings" />Cài đặt cá nhân
                </NavLink>
              ) : (
                <NavLink to="/staff-settings" className="nav-link nav-link-theme-personal" onClick={() => setMobileNavOpen(false)}>
                  <Icon name="settings" />Cài đặt tài khoản
                </NavLink>
              )}
              <div className="account-card">
                <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
                <span><strong>{displayName}</strong><small>{roleLabel}</small></span>
              </div>
              <button className="sidebar-logout" onClick={logout} title="Đăng xuất khỏi hệ thống">
                <Icon name="logout" size={17} />Đăng xuất
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Persistent Sidebar */}
      <aside className="sidebar desktop-sidebar">
        <NavLink to={homePath} className="brand" aria-label="Mầm Non Hoa Nắng">
          <span className="brand-mark"><Icon name="sun" size={22} stroke={2.2} /></span>
          <span><strong>Hoa Nắng</strong><small>Mầm Non Hạnh Phúc</small></span>
        </NavLink>
        {tenant && (
          <div className="school-tenant-badge" title={`Cơ sở: ${tenant.name || tenant.code} (${tenant.code})`}>
            <span className="tenant-status-dot" />
            <div className="tenant-info-text">
              <span className="tenant-school-name">{tenant.name || tenant.code}</span>
              <span className="tenant-school-code">{tenant.code}</span>
            </div>
          </div>
        )}
        {hasSuperAdminReturn && (
          <div className="vendor-campus-switcher">
            <button type="button" className="superadmin-switch-btn" onClick={returnToMultiSchoolConsole}>
              <Icon name="shield" size={14} /> Về Trung tâm Nhà cung cấp
            </button>
            {vendorSchools.length > 1 && (
              <select
                aria-label="Chọn phân hiệu để cấu hình bàn giao"
                className="vendor-campus-select"
                disabled={Boolean(switchingSchoolId)}
                value={String(tenant?._id || '')}
                onChange={(e) => handleVendorSwitchSchool(e.target.value)}
              >
                {vendorSchools.map((s) => (
                  <option key={s._id} value={s._id}>
                    🔧 Phân hiệu: {s.code} — {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <nav ref={navRef} className="sidebar-nav" aria-label="Điều hướng chính">
          {renderNavigation()}
        </nav>
        <div className="sidebar-bottom">
          {user?.role === 'parent' ? (
            <NavLink to="/parent-settings" className="nav-link nav-link-theme-personal">
              <Icon name="settings" />Cài đặt cá nhân
            </NavLink>
          ) : (
            <NavLink to="/staff-settings" className="nav-link nav-link-theme-personal">
              <Icon name="settings" />Cài đặt tài khoản
            </NavLink>
          )}
          <div className="account-card">
            <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{roleLabel}</small></span>
          </div>
          <button className="sidebar-logout" onClick={logout} title="Đăng xuất khỏi hệ thống">
            <Icon name="logout" size={17} />Đăng xuất
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-copy">
            <div className="topbar-title-row">
              <button type="button" className="mobile-menu-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Mở menu điều hướng">
                <Icon name="menu" size={22} />
              </button>
              <div>
                <div className="topbar-eyebrow-row">
                  <p className="eyebrow">HỆ THỐNG QUẢN LÝ TRƯỜNG MẦM NON</p>
                  {tenant && (
                    <span className="topbar-tenant-tag" title={`Cơ sở: ${tenant.name || tenant.code}`}>
                      <Icon name="shield" size={13} />
                      {tenant.code}
                    </span>
                  )}
                </div>
                {isPersistentLayout ? (
                  <div ref={setTitleSlot} className="topbar-title-slot" />
                ) : (
                  <h1>{title}</h1>
                )}
              </div>
            </div>
            {isPersistentLayout ? (
              <div ref={setSubtitleSlot} className="topbar-subtitle-slot" />
            ) : (
              subtitle && <p className="page-subtitle">{subtitle}</p>
            )}
          </div>
          <div className="topbar-actions">
            {isPersistentLayout ? (
              <div ref={setActionsSlot} className="topbar-page-actions-slot" />
            ) : (
              actions
            )}
            <div className="notification-menu" ref={notificationMenuRef}>
              <button className="icon-button" aria-label={`Thông báo${totalUnread ? `, ${totalUnread} chưa đọc` : ''}`} onClick={toggleNotifications}>
                <Icon name="bell" />{totalUnread > 0 && <span className="notification-count">{totalUnread > 99 ? '99+' : totalUnread}</span>}
              </button>
              {showNotifications && (
                <div className="notification-popover">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong>Thông báo nhà trường</strong>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {totalUnread > 0 && <span>{totalUnread} chưa đọc</span>}
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#2563eb',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0
                          }}
                          onClick={async () => {
                            try {
                              await api.patch('/notifications/read-all');
                              setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
                              setUnreadCount(0);
                            } catch {
                              // Bỏ qua nếu lỗi mạng tạm thời
                            }
                          }}
                        >
                          Đọc tất cả
                        </button>
                      )}
                    </div>
                  </div>
                  {chatUnread.data.length > 0 && (
                    <>
                      <div className="notification-group-label">TIN NHẮN</div>
                      {chatUnread.data.map((item) => (
                        <button key={item.conversationId} className="chat-alert unread" onClick={() => openChatAlert(item)}>
                          <strong>Bạn có {item.count} tin nhắn từ {user?.role === 'teacher' ? 'phụ huynh' : 'giáo viên'} {item.senderName}</strong>
                          <small>Về bé {item.studentName} · Nhấn để xem và đánh dấu đã đọc</small>
                          <span className="chat-unread-dot" />
                        </button>
                      ))}
                    </>
                  )}
                  {notifications.length > 0 && chatUnread.data.length > 0 && <div className="notification-group-label">THÔNG BÁO KHÁC</div>}
                  {notifications.length ? (
                    notifications.map((item) => (
                      <button key={item._id} className={`${item.isRead ? '' : 'unread'} ${item.metadata?.priority === 'high' ? 'priority' : ''}`.trim()} onClick={() => openNotification(item)}>
                        <strong>{item.metadata?.priority === 'high' ? '⚠ ' : ''}{item.title}</strong>
                        <small>{item.message}</small>
                      </button>
                    ))
                  ) : chatUnread.data.length === 0 && <p>Chưa có thông báo mới.</p>}
                </div>
              )}
            </div>
            <NavLink
              to={user?.role === 'parent' ? '/parent-settings' : '/staff-settings'}
              className="topbar-profile"
              title="Cài đặt tài khoản cá nhân"
            >
              <span className="avatar">{displayName.charAt(0).toUpperCase()}</span>
              <span><strong>{displayName}</strong><small className={`role-pill role-pill-${user?.role || 'default'}`}>{roleLabel}</small></span>
              <Icon name="chevronRight" size={15} />
            </NavLink>
          </div>
        </header>
        {systemBanner?.enabled && systemBanner?.message && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 24px',
              fontSize: '13.5px',
              fontWeight: 600,
              background:
                systemBanner.level === 'critical'
                  ? '#fef2f2'
                  : systemBanner.level === 'warning'
                    ? '#fffbeb'
                    : '#eff6ff',
              color:
                systemBanner.level === 'critical'
                  ? '#991b1b'
                  : systemBanner.level === 'warning'
                    ? '#92400e'
                    : '#1e40af',
              borderBottom:
                systemBanner.level === 'critical'
                  ? '1px solid #fecaca'
                  : systemBanner.level === 'warning'
                    ? '1px solid #fde68a'
                    : '1px solid #bfdbfe'
            }}
          >
            <Icon name="alertCircle" size={16} />
            <span>
              <strong>Thông báo từ Hệ thống Trung tâm:</strong> {systemBanner.message}
            </span>
          </div>
        )}
        <div className="page-content">
          {isPersistentLayout ? (
            <AppShellSlotContext.Provider value={slotContextValue}>
              <AppErrorBoundary inline resetKey={location.pathname}>
                <div key={location.pathname} className="route-view-transition">
                  {children}
                </div>
              </AppErrorBoundary>
            </AppShellSlotContext.Provider>
          ) : (
            <AppErrorBoundary inline resetKey={location.pathname}>
              {children}
            </AppErrorBoundary>
          )}
        </div>

        {/* HỘP THÔNG BÁO TIẾNG VIỆT THỜI GIAN THỰC KHI TRẺ / NHÂN SỰ QUÉT MẶT TẠI CỔNG */}
        {liveToasts.length > 0 && (
          <div className="hn-live-toast-stack" role="region" aria-label="Thông báo điểm danh trực tiếp">
            {liveToasts.map((toast) => (
              <div key={toast.id} className={`hn-live-toast hn-live-toast-${toast.tone || 'success'}`}>
                <div className="hn-live-toast-head">
                  <strong>{toast.title || 'Điểm danh trực tiếp tại cổng'}</strong>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="hn-live-sound-btn"
                      onClick={toggleLiveSound}
                      title={liveSoundEnabled ? 'Đang bật chuông báo nhẹ (Bấm để tắt tiếng)' : 'Đang tắt tiếng chuông (Bấm để bật)'}
                    >
                      {liveSoundEnabled ? '🔊 Chuông' : '🔇 Tắt tiếng'}
                    </button>
                    <button
                      type="button"
                      className="hn-live-close-btn"
                      onClick={() => setLiveToasts((prev) => prev.filter((x) => x.id !== toast.id))}
                      aria-label="Đóng thông báo"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <p>{toast.message}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Khung điều hướng cố định (Persistent Layout Route) bọc quanh toàn bộ các route đăng nhập.
 * Giữ Sidebar & Topbar không bao giờ bị hủy/tạo lại khi đổi trang, triệt tiêu hoàn toàn hiện tượng nhấp nháy.
 */
export function PersistentAppShell() {
  if (!localStorage.getItem('token')) {
    return <Navigate to="/login" replace />;
  }
  return (
    <ShellFrame isPersistentLayout>
      <Outlet />
    </ShellFrame>
  );
}

/**
 * Thành phần khai báo tiêu đề/hành động của từng màn hình.
 * Khi nằm trong PersistentAppShell, chỉ cập nhật Topbar qua Portal và trả về nội dung trang mượt mà;
 * khi render độc lập (ví dụ trong kiểm thử đơn lẻ), tự động fallback về ShellFrame đầy đủ.
 */
export default function AppShell({ title, subtitle, actions, children }) {
  const slots = useContext(AppShellSlotContext);
  if (slots) {
    return (
      <>
        {slots.titleSlot && createPortal(<h1>{title}</h1>, slots.titleSlot)}
        {slots.subtitleSlot && createPortal(subtitle ? <p className="page-subtitle">{subtitle}</p> : null, slots.subtitleSlot)}
        {slots.actionsSlot && createPortal(actions || null, slots.actionsSlot)}
        {children}
      </>
    );
  }

  return (
    <ShellFrame title={title} subtitle={subtitle} actions={actions}>
      {children}
    </ShellFrame>
  );
}
