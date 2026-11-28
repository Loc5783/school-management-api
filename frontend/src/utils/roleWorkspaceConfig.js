/**
 * @fileoverview Cấu hình chuẩn hóa Vai trò Hệ thống (`role`), Chức danh Thực tế (`position`)
 * và Không gian Làm việc Tách biệt cho từng bộ phận trong Trường Mầm Non.
 *
 * Mục tiêu kiến trúc:
 * - Giữ nguyên 8 `User.role` gốc (`admin`, `principal`, `teacher`, `accountant`, `chef`, `hr`, `guard`, `parent`)
 *   để tương thích 100% với tầng bảo mật RBAC trên toàn bộ API Backend.
 * - Sử dụng `position` (Chức danh thực tế lưu đồng bộ trên cả `User.employeeInfo.position` và `Employee.position`)
 *   để phân tách chính xác giao diện trang chủ, menu bên trái và phạm vi chức trách cho từng vị trí:
 *   Hiệu trưởng, Phó Hiệu trưởng, Tổng phụ trách, Tổ trưởng chuyên môn, Giáo viên đứng lớp, Bảo mẫu,
 *   Kế toán trưởng, Kế toán học phí, Nhân sự HR, Hành chính văn thư, Trưởng bếp, Đầu bếp, Phụ bếp,
 *   Bảo vệ cổng, Nhân viên Y tế, Lao công/Tạp vụ, Kỹ thuật bảo trì và Tài xế đưa đón.
 */

export const POSITION_LABELS = {
  principal: 'Hiệu trưởng',
  vice_principal: 'Phó Hiệu trưởng',
  youth_leader: 'Tổng phụ trách',
  head_teacher: 'Tổ trưởng chuyên môn',
  teacher: 'Giáo viên chủ nhiệm',
  assistant_teacher: 'Giáo viên phụ lớp / Bảo mẫu',
  chief_accountant: 'Kế toán trưởng',
  accountant: 'Kế toán học phí & Thu ngân',
  hr: 'Trưởng bộ phận Nhân sự (HR)',
  office_admin: 'Hành chính - Văn thư',
  head_chef: 'Trưởng bếp Bán trú',
  chef: 'Đầu bếp chính',
  kitchen_helper: 'Phụ bếp / Cấp dưỡng',
  security: 'Bảo vệ & An ninh cổng',
  nurse: 'Nhân viên Y tế học đường',
  cleaner: 'Nhân viên Lao công / Tạp vụ',
  maintenance: 'Nhân viên Kỹ thuật / Bảo trì',
  driver: 'Tài xế xe đưa đón'
};

export const DEFAULT_POSITION_BY_ROLE = {
  admin: 'principal',
  principal: 'principal',
  teacher: 'teacher',
  accountant: 'accountant',
  hr: 'hr',
  chef: 'chef',
  guard: 'security'
};

export const SUPPORT_NON_SECURITY_POSITIONS = ['nurse', 'cleaner', 'maintenance', 'driver'];

/**
 * Danh mục nhóm vai trò hiển thị trực quan trong Modal Cấp Phát Tài Khoản.
 * Tách riêng "Tổng phụ trách" và "Nhân viên vận hành đa vị trí" để người quản trị chọn đúng ngay từ cái nhìn đầu tiên.
 */
export const PROVISIONING_ROLE_GROUPS = [
  {
    groupKey: 'principal',
    role: 'principal',
    defaultPosition: 'principal',
    adminOnly: true,
    icon: 'chart',
    tone: 'violet',
    title: 'Ban Giám hiệu / Hiệu trưởng',
    shortDesc: 'Điều hành toàn trường, duyệt lương, chi phí & giám sát chất lượng',
    homeLabel: 'Sổ điều hành Giám đốc (/principal)',
    positions: [
      {
        value: 'principal',
        label: 'Hiệu trưởng',
        duty: 'Phê duyệt bảng lương, hoàn học phí, chi vận hành, giao việc & điều hành chung toàn phân hiệu.'
      },
      {
        value: 'vice_principal',
        label: 'Phó Hiệu trưởng',
        duty: 'Phụ trách chuyên môn giảng dạy, chất lượng chăm sóc bán trú, duyệt đơn nghỉ & phản hồi phụ huynh.'
      }
    ],
    allowedModules: [
      'Sổ điều hành & Cảnh báo vận hành',
      'Phê duyệt Lương, Hoàn phí & Chi vận hành',
      'Giám sát Hồ sơ Học sinh, Lớp học & Nhân sự',
      'Báo cáo tổng hợp toàn trường'
    ],
    isolatedNote: 'Tách biệt khỏi màn hình cấu hình phần cứng kỹ thuật của Admin phân hiệu.'
  },
  {
    groupKey: 'general_supervisor',
    role: 'teacher',
    defaultPosition: 'youth_leader',
    adminOnly: false,
    icon: 'calendar',
    tone: 'indigo',
    title: 'Tổng Phụ Trách & Tổ Trưởng CM',
    shortDesc: 'Nề nếp chuyên cần toàn trường, hoạt động sự kiện & hỗ trợ chuyên môn khối',
    homeLabel: 'Bàn làm việc Tổng phụ trách (/staff-workspace)',
    positions: [
      {
        value: 'youth_leader',
        label: 'Tổng phụ trách (Nề nếp & Sự kiện)',
        duty: 'Theo dõi chuyên cần các lớp, điều phối lễ hội/ngoại khóa, truyền thông nội bộ & đề xuất vật tư hoạt động.'
      },
      {
        value: 'head_teacher',
        label: 'Tổ trưởng chuyên môn khối lớp',
        duty: 'Giám sát chất lượng chuyên môn khối lớp, hỗ trợ điểm danh, lịch dạy thay & đề xuất học cụ.'
      }
    ],
    allowedModules: [
      'Bàn điều phối Nề nếp & Hoạt động trường',
      'Điểm danh & Báo cáo vắng mặt các lớp',
      'Tra cứu Học sinh & Thông báo nội bộ',
      'Đề xuất mua sắm vật tư sự kiện / học cụ'
    ],
    isolatedNote: 'Không truy cập Học phí, Sổ quỹ kế toán hay Bảng lương của nhân sự khác.'
  },
  {
    groupKey: 'teacher',
    role: 'teacher',
    defaultPosition: 'teacher',
    adminOnly: false,
    icon: 'students',
    tone: 'blue',
    title: 'Giáo viên Đứng lớp & Bảo mẫu',
    shortDesc: 'Điểm danh đón trả trẻ, ghi sổ chăm sóc ăn-ngủ & nhắn tin phụ huynh lớp mình',
    homeLabel: 'Tổng quan Lớp học của tôi (/dashboard)',
    positions: [
      {
        value: 'teacher',
        label: 'Giáo viên chủ nhiệm lớp',
        duty: 'Phụ trách chính lớp học: điểm danh đến/về, sổ chăm sóc bé hàng ngày, trao đổi trực tiếp với phụ huynh.'
      },
      {
        value: 'assistant_teacher',
        label: 'Giáo viên phụ lớp / Bảo mẫu',
        duty: 'Phối hợp đón trả trẻ, chăm sóc bữa ăn - giấc ngủ - vệ sinh của bé và theo dõi dị ứng thực phẩm tại lớp.'
      }
    ],
    allowedModules: [
      'Điểm danh đón & trả trẻ tại lớp',
      'Sổ chăm sóc bé (Ăn, Ngủ, Sức khỏe)',
      'Nhắn tin Phụ huynh & Xem dị ứng lớp',
      'Chấm công, Nghỉ phép & Phiếu lương cá nhân'
    ],
    isolatedNote: 'Chỉ nhìn thấy học sinh lớp được phân công; không thấy lớp khác, tài chính hay nhân sự.'
  },
  {
    groupKey: 'accountant',
    role: 'accountant',
    defaultPosition: 'accountant',
    adminOnly: false,
    icon: 'money',
    tone: 'emerald',
    title: 'Kế toán & Tài chính',
    shortDesc: 'Thu học phí, công nợ, hoàn tiền ăn, sổ quỹ thu-chi & chi trả lương',
    homeLabel: 'Tổng quan Kế toán (/accounting)',
    positions: [
      {
        value: 'chief_accountant',
        label: 'Kế toán trưởng',
        duty: 'Kiểm soát biểu phí, đối soát sổ quỹ thu - chi, khóa kỳ kế toán, chi lương & lập báo cáo tài chính.'
      },
      {
        value: 'accountant',
        label: 'Kế toán học phí & Thu ngân',
        duty: 'Phát hành hóa đơn học phí theo lớp, gạch nợ thu tiền, xử lý hoàn tiền ăn nghỉ phép & ghi chứng từ chi.'
      }
    ],
    allowedModules: [
      'Hóa đơn, Biểu phí, Công nợ & Hoàn học phí',
      'Sổ chi mua sắm, Chi vận hành & Thanh toán lương',
      'Sổ quỹ đối soát thu – chi & Báo cáo kế toán',
      'Chấm công & Phiếu lương cá nhân'
    ],
    isolatedNote: 'Không can thiệp Sổ chăm sóc chuyên môn lớp học, Thực đơn bếp hay Cấp tài khoản hệ thống.'
  },
  {
    groupKey: 'hr',
    role: 'hr',
    defaultPosition: 'hr',
    adminOnly: false,
    icon: 'users',
    tone: 'rose',
    title: 'Nhân sự & Hành chính (HR)',
    shortDesc: 'Hồ sơ hợp đồng, cấp tài khoản nhân viên, phân ca, chấm công & tính lương',
    homeLabel: 'Quản trị Nhân sự (/hr)',
    positions: [
      {
        value: 'hr',
        label: 'Trưởng bộ phận Nhân sự - Tiền lương',
        duty: 'Quản lý hợp đồng lao động, cấp tài khoản nhân viên, phân công ca trực/dạy thay, tổng hợp công & lập lương.'
      },
      {
        value: 'office_admin',
        label: 'Nhân viên Hành chính - Văn thư',
        duty: 'Cập nhật hồ sơ nhân viên, theo dõi chấm công hàng ngày, tiếp nhận đơn nghỉ phép & điều chuyển lớp học sinh.'
      }
    ],
    allowedModules: [
      'Hồ sơ Nhân sự, Hợp đồng & Cấp tài khoản NV',
      'Phân công Giáo viên / Ca trực & Duyệt đơn nghỉ',
      'Bảng chấm công toàn trường & Lập bảng lương',
      'Điều chuyển lớp học sinh & Thông báo nội bộ'
    ],
    isolatedNote: 'Không sửa tài khoản Hiệu trưởng/Admin, không can thiệp sổ quỹ thu học phí của Kế toán.'
  },
  {
    groupKey: 'chef',
    role: 'chef',
    defaultPosition: 'head_chef',
    adminOnly: false,
    icon: 'utensils',
    tone: 'amber',
    title: 'Trưởng Bếp & Bán trú',
    shortDesc: 'Suất nấu theo điểm danh thực tế, cảnh báo dị ứng, thực đơn tuần & lưu mẫu 24h',
    homeLabel: 'Bếp hôm nay — Suất nấu (/kitchen)',
    positions: [
      {
        value: 'head_chef',
        label: 'Trưởng bếp Bán trú',
        duty: 'Chịu trách nhiệm toàn bộ bếp ăn: chốt suất nấu theo điểm danh, lên thực đơn tuần, quản lý kho & lưu mẫu 24h.'
      },
      {
        value: 'chef',
        label: 'Đầu bếp chính',
        duty: 'Chế biến theo định lượng suất ăn hôm nay, kiểm tra danh sách trẻ dị ứng thực phẩm & ghi sổ an toàn lưu mẫu.'
      },
      {
        value: 'kitchen_helper',
        label: 'Phụ bếp / Nhân viên cấp dưỡng',
        duty: 'Giao diện tinh gọn: xem số suất chia về từng lớp, lưu ý dị ứng, chấm công ca bếp & xem lương cá nhân.'
      }
    ],
    allowedModules: [
      'Bếp hôm nay (Số suất theo lớp & Cảnh báo dị ứng)',
      'Thực đơn tuần, Kho thực phẩm & Lưu mẫu 24h (Trưởng bếp / Đầu bếp)',
      'Đề xuất mua sắm thực phẩm & Dụng cụ bếp',
      'Chấm công ca bếp, Lịch trực & Lương cá nhân'
    ],
    isolatedNote: 'Không xem Học phí, Bảng lương trường hay thông tin riêng tư của phụ huynh.'
  },
  {
    groupKey: 'guard_and_ops',
    role: 'guard',
    defaultPosition: 'security',
    adminOnly: false,
    icon: 'shield',
    tone: 'teal',
    title: 'Nhân viên Vận hành (Bảo vệ, Y tế, Tạp vụ...)',
    shortDesc: 'Tự động mở giao diện riêng biệt đúng theo công việc thực tế của từng nhân viên',
    homeLabel: 'Tự động tách theo vị trí công việc',
    positions: [
      {
        value: 'security',
        label: 'Bảo vệ & An ninh cổng',
        duty: 'Mở giao diện Trực cổng (/guard): quét QR người đón trẻ, ghi khách ra vào, nhận hàng thực phẩm & bàn giao ca.'
      },
      {
        value: 'nurse',
        label: 'Nhân viên Y tế học đường',
        duty: 'Mở Cổng Nhân viên Y tế (/staff-workspace): lịch trực y tế, thông báo sức khỏe nội bộ, chấm công & phiếu lương.'
      },
      {
        value: 'cleaner',
        label: 'Nhân viên Lao công / Tạp vụ',
        duty: 'Mở Cổng Nhân viên Tạp vụ siêu gọn (/staff-workspace): 4 nút lớn Chấm công, Xem khu vực trực, Xin nghỉ & Xem lương.'
      },
      {
        value: 'maintenance',
        label: 'Nhân viên Kỹ thuật / Bảo trì',
        duty: 'Mở Cổng Nhân viên Kỹ thuật (/staff-workspace): ca trực điện nước/cơ sở vật chất, chấm công, nghỉ phép & lương.'
      },
      {
        value: 'driver',
        label: 'Tài xế xe đưa đón học sinh',
        duty: 'Mở Cổng Nhân viên Đưa đón (/staff-workspace): lịch ca chạy trong ngày, thông báo nhà trường, chấm công & lương.'
      }
    ],
    allowedModules: [
      'Bảo vệ cổng: Trực cổng QR, Khách ra vào, Nhận hàng & Sự cố',
      'Y tế / Lao công / Kỹ thuật / Tài xế: Cổng làm việc 4 nút lớn riêng biệt',
      'Chấm công vào/ra ca & Lịch phân công hôm nay',
      'Xin nghỉ phép & Xem phiếu lương cá nhân'
    ],
    isolatedNote: 'Lao công, Y tế, Kỹ thuật có không gian riêng gọn nhẹ — không bị trộn chung màn hình Trực cổng của Bảo vệ.'
  }
];

export function getEffectivePosition(userOrAccount) {
  if (!userOrAccount) return '';
  const explicit = userOrAccount.position || userOrAccount.employeeInfo?.position || '';
  if (explicit && POSITION_LABELS[explicit]) {
    return explicit;
  }
  return DEFAULT_POSITION_BY_ROLE[userOrAccount.role] || '';
}

export function isNonSecuritySupportStaff(userOrAccount) {
  if (!userOrAccount || userOrAccount.role !== 'guard') return false;
  const pos = getEffectivePosition(userOrAccount);
  return SUPPORT_NON_SECURITY_POSITIONS.includes(pos);
}

export function isGeneralSupervisorTeacher(userOrAccount) {
  if (!userOrAccount || userOrAccount.role !== 'teacher') return false;
  const pos = getEffectivePosition(userOrAccount);
  return pos === 'youth_leader' || pos === 'head_teacher';
}

export function getHomePathForUser(userOrAccount) {
  const role = typeof userOrAccount === 'string' ? userOrAccount : userOrAccount?.role;
  const pos = typeof userOrAccount === 'object' ? getEffectivePosition(userOrAccount) : '';

  switch (role) {
    case 'superadmin':
      return '/multi-school';
    case 'admin':
      return '/campuses';
    case 'principal':
      return '/principal';
    case 'teacher':
      return pos === 'youth_leader' ? '/staff-workspace' : '/dashboard';
    case 'chef':
      return '/kitchen';
    case 'accountant':
      return '/accounting';
    case 'hr':
      return '/hr';
    case 'guard':
      return SUPPORT_NON_SECURITY_POSITIONS.includes(pos) ? '/staff-workspace' : '/guard';
    case 'parent':
      return '/parent-dashboard';
    default:
      return '/login';
  }
}

export function getUserRoleBadgeLabel(userOrAccount, isVendorSupport = false) {
  if (!userOrAccount) return 'Tài khoản trường';
  const role = userOrAccount.role;
  if (isVendorSupport && role === 'admin') {
    return 'Kỹ thuật viên Nhà cung cấp';
  }
  if (role === 'admin') return 'Quản trị Phân hiệu Trường';
  if (role === 'parent') return 'Phụ huynh học sinh';
  if (role === 'superadmin') return 'Quản trị Tổng Hệ thống';

  const pos = getEffectivePosition(userOrAccount);
  if (pos && POSITION_LABELS[pos]) {
    return POSITION_LABELS[pos];
  }

  return {
    principal: 'Ban Giám hiệu',
    teacher: 'Giáo viên đứng lớp',
    accountant: 'Kế toán học phí',
    chef: 'Đầu bếp / Dinh dưỡng',
    hr: 'Nhân sự & Tiền lương',
    guard: 'Bảo vệ & An ninh'
  }[role] || 'Nhân sự nhà trường';
}

export function getWorkspaceSummaryForAccount(account) {
  if (!account) return { badgeLabel: '', workspaceLabel: '', tone: 'slate', groupKey: 'teacher' };
  if (account.role === 'admin') {
    return {
      badgeLabel: 'Quản trị Phân hiệu',
      workspaceLabel: 'Cấu hình Phân hiệu, Cấp TK & Máy chấm công',
      tone: 'indigo',
      groupKey: 'admin'
    };
  }
  const pos = getEffectivePosition(account);
  const badgeLabel = POSITION_LABELS[pos] || getUserRoleBadgeLabel(account);

  if (account.role === 'principal') {
    return {
      badgeLabel,
      workspaceLabel: 'Sổ điều hành Giám đốc & Phê duyệt',
      tone: 'violet',
      groupKey: 'principal'
    };
  }
  if (account.role === 'teacher' && (pos === 'youth_leader' || pos === 'head_teacher')) {
    return {
      badgeLabel,
      workspaceLabel: pos === 'youth_leader'
        ? 'Nề nếp chuyên cần & Hoạt động toàn trường'
        : 'Điều phối chuyên môn khối & Lớp học',
      tone: 'indigo',
      groupKey: 'general_supervisor'
    };
  }
  if (account.role === 'teacher') {
    return {
      badgeLabel,
      workspaceLabel: 'Điểm danh, Sổ chăm sóc & Phụ huynh lớp',
      tone: 'blue',
      groupKey: 'teacher'
    };
  }
  if (account.role === 'accountant') {
    return {
      badgeLabel,
      workspaceLabel: 'Học phí, Sổ quỹ đối soát & Chi lương',
      tone: 'emerald',
      groupKey: 'accountant'
    };
  }
  if (account.role === 'hr') {
    return {
      badgeLabel,
      workspaceLabel: 'Hồ sơ NS, Phân ca, Chấm công & Lương',
      tone: 'rose',
      groupKey: 'hr'
    };
  }
  if (account.role === 'chef') {
    return {
      badgeLabel,
      workspaceLabel: pos === 'kitchen_helper'
        ? 'Suất ăn chia lớp, Dị ứng & Ca bếp'
        : 'Bếp hôm nay, Thực đơn tuần & Lưu mẫu 24h',
      tone: 'amber',
      groupKey: 'chef'
    };
  }
  if (account.role === 'guard') {
    if (pos === 'nurse') {
      return {
        badgeLabel,
        workspaceLabel: 'Cổng Nhân viên Y tế, Ca trực & Nội bộ',
        tone: 'cyan',
        groupKey: 'guard_and_ops'
      };
    }
    if (pos === 'cleaner') {
      return {
        badgeLabel,
        workspaceLabel: 'Cổng Tạp vụ tinh gọn (Chấm công & Lịch trực)',
        tone: 'teal',
        groupKey: 'guard_and_ops'
      };
    }
    if (pos === 'maintenance' || pos === 'driver') {
      return {
        badgeLabel,
        workspaceLabel: 'Cổng Vận hành kỹ thuật / Đưa đón & Ca trực',
        tone: 'slate',
        groupKey: 'guard_and_ops'
      };
    }
    return {
      badgeLabel,
      workspaceLabel: 'Trực cổng, Quét QR đón trẻ & An ninh',
      tone: 'teal',
      groupKey: 'guard_and_ops'
    };
  }
  return {
    badgeLabel,
    workspaceLabel: 'Không gian làm việc nội bộ',
    tone: 'slate',
    groupKey: 'teacher'
  };
}

export function resolveGroupKeyFromRoleAndPosition(role, position) {
  if (role === 'principal') return 'principal';
  if (role === 'teacher' && (position === 'youth_leader' || position === 'head_teacher')) {
    return 'general_supervisor';
  }
  if (role === 'teacher') return 'teacher';
  if (role === 'accountant') return 'accountant';
  if (role === 'hr') return 'hr';
  if (role === 'chef') return 'chef';
  if (role === 'guard') return 'guard_and_ops';
  return 'teacher';
}

/**
 * Tự động chuyển Họ tên tiếng Việt thành gợi ý `@username` ngắn gọn, dễ nhớ.
 * Ví dụ: "Ngô Thị Phương Thảo" + position "teacher" -> "gv.phuongthao" hoặc "thao.ntp"
 */
export function suggestUsernameFromFullName(fullName = '', position = '') {
  const clean = String(fullName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();

  if (!clean) return '';
  const parts = clean.split(/\s+/).filter(Boolean);
  const prefixByPos = {
    principal: 'ht',
    vice_principal: 'pht',
    youth_leader: 'tpt',
    head_teacher: 'ttcm',
    teacher: 'gv',
    assistant_teacher: 'bm',
    chief_accountant: 'ktt',
    accountant: 'kt',
    hr: 'ns',
    office_admin: 'hc',
    head_chef: 'tbep',
    chef: 'bep',
    kitchen_helper: 'bep',
    security: 'bv',
    nurse: 'yte',
    cleaner: 'tv',
    maintenance: 'ktv',
    driver: 'tx'
  }[position] || '';

  if (parts.length === 1) {
    return prefixByPos ? `${prefixByPos}.${parts[0]}` : parts[0];
  }
  const givenName = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((w) => w.charAt(0)).join('');
  const base = `${givenName}.${initials}`;
  return prefixByPos ? `${prefixByPos}.${base}` : base;
}

