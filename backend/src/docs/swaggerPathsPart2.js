'use strict';

/**
 * @fileoverview Đặc tả chi tiết API Phần 2 (Tags 08 → 14):
 * - 08. Nhân sự, Phân công & Bảng lương (HR & Payroll)
 * - 09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)
 * - 10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)
 * - 11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)
 * - 12. Mua sắm & Cơ sở vật chất (Procurement & Assets)
 * - 13. Thông báo, Tin nhắn & Phản hồi Phụ huynh (Communication)
 * - 14. Báo cáo Điều hành & Thống kê (Reports)
 */

const { jsonContent, standardErrorResponses, idParam } = require('./swaggerPathsPart1');

const swaggerPathsPart2 = {
  // ============================================================================
  // 08. NHÂN SỰ, PHÂN CÔNG & BẢNG LƯƠNG (HR & PAYROLL)
  // ============================================================================
  '/api/hr/employees': {
    get: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, principal, accountant, hr] Danh sách Hồ sơ Nhân sự kèm thông tin Tài khoản liên kết & Cấu hình lương',
      parameters: [
        { name: 'status', in: 'query', description: 'active | on_leave | resigned', schema: { type: 'string' } },
        { name: 'payrollRole', in: 'query', description: 'principal | teacher | accountant | chef | guard | hr', schema: { type: 'string' } },
        { name: 'search', in: 'query', description: 'Tìm theo họ tên, mã NV, số điện thoại', schema: { type: 'string' } }
      ],
      responses: {
        200: {
          description: 'Danh sách nhân viên (mức lương chi tiết được kiểm soát theo quyền HR/Kế toán/Admin)',
          content: jsonContent({
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Lấy danh sách nhân viên thành công' },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Employee' } }
            }
          })
        }
      }
    },
    post: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, hr] Tạo Hồ sơ Nhân sự (Hỗ trợ gộp 1 bước `createAccount: true` cấp luôn Tài khoản đăng nhập trong cùng Transaction)',
      description:
        '- Nếu `createAccount: true`, hệ thống tạo đồng thời `User` nội bộ (`status: "active"`) + `Employee` đã liên kết trong cùng 1 MongoDB Transaction.\n' +
        '- Ràng buộc phân quyền: Nhân sự (`hr`) không được phép tạo tài khoản vai trò `principal` hoặc `admin`.',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['fullName', 'phone'],
          properties: {
            createAccount: { type: 'boolean', default: true, example: true },
            accountUsername: { type: 'string', example: '0977888999' },
            accountPassword: { type: 'string', default: '123456', example: '123456' },
            accountRole: { type: 'string', enum: ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'], example: 'teacher' },
            userId: { type: 'string', description: 'Chỉ truyền khi gắn với User có sẵn (createAccount = false)', example: '' },
            employeeCode: { type: 'string', description: 'Để trống tự sinh mã số tăng dần', example: '' },
            fullName: { type: 'string', example: 'Nguyễn Thu Phương' },
            phone: { type: 'string', example: '0977888999' },
            email: { type: 'string', example: 'phuong.gv@hoanang.edu.vn' },
            position: { type: 'string', enum: ['principal', 'vice_principal', 'teacher', 'head_teacher', 'assistant_teacher', 'accountant', 'chef', 'hr', 'security'], example: 'teacher' },
            payrollRole: { type: 'string', enum: ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'], example: 'teacher' },
            contractType: { type: 'string', enum: ['probation', 'fixed_1_year', 'fixed_3_year', 'indefinite'], example: 'fixed_1_year' },
            startDate: { type: 'string', format: 'date', example: '2026-09-01' },
            salaryConfig: {
              type: 'object',
              properties: {
                baseSalary: { type: 'integer', example: 9500000 },
                standardWorkDays: { type: 'integer', example: 26 },
                lowMonthlySalaryConfirmed: { type: 'boolean', example: false }
              }
            }
          }
        })
      },
      responses: {
        201: {
          description: 'Hồ sơ nhân viên (và tài khoản nếu createAccount=true) vừa khởi tạo',
          content: jsonContent({
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Tạo nhân viên thành công' },
              data: { $ref: '#/components/schemas/DB_Employee' }
            }
          })
        },
        409: { description: 'Trùng mã nhân viên hoặc trùng tên đăng nhập', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) },
        422: standardErrorResponses[422]
      }
    }
  },
  '/api/hr/employees/{id}': {
    get: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, principal, accountant, hr] Xem chi tiết hồ sơ nhân sự',
      parameters: [idParam('id', 'ID nhân sự (Employee)')],
      responses: { 200: { description: 'Chi tiết nhân viên', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_Employee' } } }) } }
    },
    put: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, hr] Cập nhật hồ sơ, hợp đồng, mức lương cơ bản hoặc liên kết tài khoản nhân sự',
      parameters: [idParam('id', 'ID nhân sự (Employee)')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            phone: { type: 'string' },
            contractType: { type: 'string' },
            salaryConfig: { type: 'object', properties: { baseSalary: { type: 'integer', example: 10000000 }, standardWorkDays: { type: 'integer', example: 26 } } }
          }
        })
      },
      responses: { 200: { description: 'Đã cập nhật hồ sơ', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_Employee' } } }) } }
    }
  },
  '/api/hr/payroll/generate': {
    post: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, hr] Khởi tạo / Tính lại Bảng lương nháp tháng dựa trên ngày công thực tế (AttendanceRecord)',
      description: 'Quy trình phê duyệt 3 bước: `draft` (HR lập nháp) → `reviewed` (Kế toán đối soát) → `confirmed` (Hiệu trưởng phê duyệt) → `paid` (Kế toán ghi chi).',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['month', 'year'],
          properties: {
            month: { type: 'integer', minimum: 1, maximum: 12, example: 11 },
            year: { type: 'integer', example: 2026 }
          }
        })
      },
      responses: {
        200: {
          description: 'Danh sách phiếu lương tháng vừa tính',
          content: jsonContent({
            type: 'object',
            properties: {
              message: { type: 'string' },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Payroll' } }
            }
          })
        }
      }
    }
  },
  '/api/hr/payroll': {
    get: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, principal, accountant, hr] Xem Bảng lương toàn trường theo tháng/năm',
      parameters: [
        { name: 'month', in: 'query', required: true, schema: { type: 'integer', example: 11 } },
        { name: 'year', in: 'query', required: true, schema: { type: 'integer', example: 2026 } }
      ],
      responses: {
        200: {
          description: 'Danh sách phiếu lương kèm tổng quỹ thực lĩnh',
          content: jsonContent({
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Payroll' } },
              summary: {
                type: 'object',
                properties: {
                  totalEmployees: { type: 'integer', example: 24 },
                  totalNet: { type: 'number', example: 215000000 }
                }
              }
            }
          })
        }
      }
    }
  },
  '/api/hr/payroll/{id}/status': {
    patch: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[admin, principal, accountant] Chuyển bước duyệt phiếu lương (`reviewed` → `confirmed` → `paid`)',
      parameters: [idParam('id', 'ID phiếu lương (Payroll)')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['reviewed', 'confirmed', 'paid'], example: 'confirmed' },
            paymentMethod: { type: 'string', enum: ['bank_transfer', 'cash'], example: 'bank_transfer' },
            paidDate: { type: 'string', format: 'date', example: '2026-11-30' },
            paymentReference: { type: 'string', example: 'UNC-202611-001' }
          }
        })
      },
      responses: { 200: { description: 'Phiếu lương sau chuyển trạng thái', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_Payroll' } } }) } }
    }
  },
  '/api/hr/my-payroll': {
    get: {
      tags: ['08. Nhân sự, Phân công & Bảng lương (HR & Payroll)'],
      summary: '[Tất cả nhân sự] Xem phiếu lương cá nhân của chính mình',
      responses: {
        200: { description: 'Lịch sử phiếu lương cá nhân', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_Payroll' } } } }) }
      }
    }
  },

  // ============================================================================
  // 09. CHẤM CÔNG NHÂN SỰ & WEBHOOK MÁY HIKVISION (TIMEKEEPING)
  // ============================================================================
  '/api/timekeeping/check-in': {
    post: {
      tags: ['09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)'],
      summary: '[Tất cả nhân sự] Nhân sự chấm công vào / ra ca trực tiếp trên Web',
      requestBody: {
        required: false,
        content: jsonContent({
          type: 'object',
          properties: {
            note: { type: 'string', example: 'Trực đón trẻ sáng' }
          }
        })
      },
      responses: {
        200: { description: 'Bản ghi chấm công trong ngày', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_AttendanceRecord' } } }) }
      }
    }
  },
  '/api/timekeeping/corrections': {
    post: {
      tags: ['09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)'],
      summary: '[admin, principal, teacher, accountant, chef, hr] Gửi Đơn chấm công bù khi quên chấm công / đi công tác',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['workDate', 'requestedCheckInTime', 'reason'],
          properties: {
            workDate: { type: 'string', format: 'date', example: '2026-11-26' },
            requestedCheckInTime: { type: 'string', example: '07:25' },
            requestedCheckOutTime: { type: 'string', example: '17:05' },
            reason: { type: 'string', example: 'Đón trẻ ngoài sân trường lúc 7h15 nên quên bấm máy' }
          }
        })
      },
      responses: {
        201: { description: 'Đã tạo đơn chấm công bù chờ Ban giám hiệu duyệt', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_TimekeepingCorrectionRequest' } } }) }
      }
    }
  },
  '/api/timekeeping/devices': {
    get: {
      tags: ['09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)'],
      summary: '[admin, principal, hr] Danh sách máy chấm công khuôn mặt/vân tay Hikvision ISAPI của trường',
      responses: {
        200: { description: 'Danh sách thiết bị chấm công', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_TimekeepingDevice' } } } }) }
      }
    }
  },
  '/api/attendance/webhook/{schoolCode}': {
    post: {
      tags: ['09. Chấm công Nhân sự & Máy Hikvision (Timekeeping)'],
      summary: '[Webhook Thiết bị] Nhận gói tin sự kiện khuôn mặt/thẻ đẩy trực tiếp từ máy Hikvision ISAPI theo Mã trường',
      parameters: [
        { name: 'schoolCode', in: 'path', required: true, schema: { type: 'string', example: 'HOANANG-A' } },
        { name: 'X-Webhook-Token', in: 'header', required: false, schema: { type: 'string' } }
      ],
      responses: {
        200: { description: 'Đã tiếp nhận và phân loại tự động (Học sinh điểm danh hoặc Nhân sự chấm công)', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  },

  // ============================================================================
  // 10. TÀI CHÍNH, HỌC PHÍ, SỔ QUỸ & KHÓA KỲ KẾ TOÁN (FINANCE)
  // ============================================================================
  '/api/finance/invoices': {
    get: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, principal, accountant] Danh sách Hóa đơn Học phí theo kỳ thu (có phân trang)',
      parameters: [
        { name: 'period', in: 'query', description: 'Kỳ học phí MM-YYYY (VD: 11-2026)', schema: { type: 'string', example: '11-2026' } },
        { name: 'classroomId', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', description: 'unpaid | partial | paid | cancelled', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
      ],
      responses: {
        200: {
          description: 'Danh sách hóa đơn học phí kèm phân trang',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_TuitionFee' } },
              pagination: { $ref: '#/components/schemas/PaginationMeta' }
            }
          })
        }
      }
    }
  },
  '/api/finance/tuition/bulk/preview': {
    post: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, principal, accountant] Xem trước & Đối soát ngày nghỉ có phép kỳ trước khi lập Hóa đơn Học phí đầu tháng',
      description:
        'Tự động truy vấn bảng `StudentAttendance` (`status: "absent_permission"`) trong kỳ đối chiếu (`creditPeriod`, mặc định tháng liền trước) ' +
        'để tính số tiền ăn trừ lùi cho từng học sinh (`absentDays * dailyMealCreditRate`) trước khi Kế toán xác nhận phát hành.',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['period', 'tuitionBase', 'dueDate'],
          properties: {
            classroomId: { type: 'string', example: '674580a1b2c3d4e5f6000101' },
            applyToAll: { type: 'boolean', default: false, example: false },
            period: { type: 'string', example: '11-2026' },
            tuitionBase: { type: 'number', example: 1500000 },
            mealFee: { type: 'number', example: 880000 },
            busFee: { type: 'number', example: 0 },
            discount: { type: 'number', example: 0 },
            dueDate: { type: 'string', format: 'date', example: '2026-11-10' },
            deductPriorMeal: { type: 'boolean', default: true, example: true },
            creditPeriod: { type: 'string', description: 'Tháng điểm danh đối chiếu (MM-YYYY)', example: '10-2026' },
            dailyMealCreditRate: { type: 'number', description: 'Đơn giá hoàn ăn / 1 ngày nghỉ có phép (bỏ trống tự chia mealFee / 22)', example: 40000 },
            additionalItems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Đồng phục mùa đông' },
                  amount: { type: 'number', example: 150000 }
                }
              }
            }
          }
        })
      },
      responses: {
        200: {
          description: 'Bảng xem trước tổng tiền & chi tiết khấu trừ tiền ăn từng học sinh (`studentCredits`)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  period: { type: 'string', example: '11-2026' },
                  perStudent: { type: 'number', example: 2530000 },
                  studentCount: { type: 'integer', example: 20 },
                  totalAmount: { type: 'number', example: 50120000 },
                  mealCreditPeriod: { type: 'string', example: '10-2026' },
                  dailyMealCreditRate: { type: 'number', example: 40000 },
                  totalMealCreditDeduction: { type: 'number', example: 480000 },
                  canCreate: { type: 'boolean', example: true },
                  studentCredits: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        studentId: { type: 'string' },
                        fullName: { type: 'string', example: 'Nguyễn Bảo Ngọc' },
                        className: { type: 'string', example: 'MGL 5-6A' },
                        absentDays: { type: 'integer', example: 3 },
                        suggestedDeduction: { type: 'number', example: 120000 },
                        appliedDeduction: { type: 'number', example: 120000 },
                        finalTotal: { type: 'number', example: 2410000 }
                      }
                    }
                  }
                }
              }
            }
          })
        }
      }
    }
  },
  '/api/finance/tuition/bulk': {
    post: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, accountant] Phát hành hàng loạt Hóa đơn Học phí đầu tháng (Hỗ trợ ghi đè mức trừ từng học sinh `studentCreditOverrides`)',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['period', 'tuitionBase', 'dueDate'],
          properties: {
            classroomId: { type: 'string', example: '674580a1b2c3d4e5f6000101' },
            applyToAll: { type: 'boolean', example: false },
            period: { type: 'string', example: '11-2026' },
            tuitionBase: { type: 'number', example: 1500000 },
            mealFee: { type: 'number', example: 880000 },
            dueDate: { type: 'string', format: 'date', example: '2026-11-10' },
            deductPriorMeal: { type: 'boolean', example: true },
            creditPeriod: { type: 'string', example: '10-2026' },
            dailyMealCreditRate: { type: 'number', example: 40000 },
            studentCreditOverrides: {
              type: 'object',
              description: 'Map `{ [studentId]: soTienTruTuyChinh }` nếu Kế toán sửa tay trên bảng xem trước',
              additionalProperties: { type: 'number' },
              example: { '674580a1b2c3d4e5f6000301': 150000 }
            }
          }
        })
      },
      responses: {
        201: {
          description: 'Danh sách hóa đơn TuitionFee vừa phát hành trong Transaction',
          content: jsonContent({
            type: 'object',
            properties: {
              message: { type: 'string' },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_TuitionFee' } }
            }
          })
        },
        409: { description: 'Lớp đã có hóa đơn kỳ này (chống phát hành trùng)', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) }
      }
    }
  },
  '/api/finance/payment': {
    post: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, accountant] Ghi nhận Thu tiền Học phí & Cấp mã Biên lai (chống thu trùng bằng Idempotency-Key)',
      parameters: [
        { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', example: 'pay-550e8400-e29b-41d4' } }
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['invoiceId', 'amount', 'method'],
          properties: {
            invoiceId: { type: 'string', example: '674580a1b2c3d4e5f6000501' },
            amount: { type: 'number', example: 2410000 },
            method: { type: 'string', enum: ['cash', 'bank_transfer', 'ewallet'], example: 'bank_transfer' },
            txnRef: { type: 'string', description: 'Bắt buộc khi chuyển khoản / ví điện tử', example: 'FT26331998877' },
            note: { type: 'string', example: 'Mẹ chuyển khoản học phí tháng 11' }
          }
        })
      },
      responses: {
        201: {
          description: 'Phiếu thu Payment vừa ghi nhận (cập nhật nguyên tử paidAmount & status trên TuitionFee)',
          content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { $ref: '#/components/schemas/DB_Payment' } } })
        }
      }
    }
  },
  '/api/finance/cashbook': {
    get: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, principal, accountant] Sổ quỹ đối soát Tổng Thu – Tổng Chi (Học phí, Hoàn phí, Mua sắm, Chi vận hành, Lương)',
      parameters: [
        { name: 'month', in: 'query', description: 'YYYY-MM (VD: 2026-11)', schema: { type: 'string', example: '2026-11' } }
      ],
      responses: {
        200: { description: 'Tổng hợp dòng tiền thu/chi và biên bản đối soát tiền mặt', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  },
  '/api/finance/accounting-period/{month}/close': {
    post: {
      tags: ['10. Tài chính, Học phí, Sổ quỹ & Khóa kỳ (Finance)'],
      summary: '[admin, principal] Khóa sổ Kỳ kế toán tháng (chặn mọi thay đổi chứng từ lùi vào kỳ đã khóa)',
      parameters: [{ name: 'month', in: 'path', required: true, schema: { type: 'string', example: '2026-10' } }],
      requestBody: {
        required: true,
        content: jsonContent({ type: 'object', properties: { reason: { type: 'string', example: 'Chốt sổ quyết toán tháng 10/2026' } } })
      },
      responses: { 200: { description: 'Đã khóa sổ kỳ kế toán', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_AccountingPeriod' } } }) } }
    }
  },

  // ============================================================================
  // 11. BẾP ĂN, THỰC ĐƠN & AN TOÀN THỰC PHẨM (NUTRITION)
  // ============================================================================
  '/api/nutrition/menus': {
    get: {
      tags: ['11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)'],
      summary: '[admin, principal, chef, teacher, parent] Xem Thực đơn tuần theo Nhóm tuổi / Lớp học',
      responses: {
        200: { description: 'Danh sách thực đơn tuần', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/DB_Menu' } } } }) }
      }
    },
    post: {
      tags: ['11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)'],
      summary: '[admin, chef] Tạo Thực đơn tuần mới (tự động đối chiếu cảnh báo dị ứng học sinh)',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/DB_Menu' }) },
      responses: { 201: { description: 'Thực đơn vừa tạo', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_Menu' } } }) } }
    }
  },
  '/api/nutrition/servings/daily': {
    get: {
      tags: ['11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)'],
      summary: '[admin, principal, chef, teacher] Kế hoạch chia suất ăn trong ngày tự động tính từ sĩ số Có mặt + Đi muộn',
      parameters: [{ name: 'date', in: 'query', schema: { type: 'string', example: '2026-11-27' } }],
      responses: { 200: { description: 'Số suất ăn theo từng lớp & danh sách học sinh dị ứng cần suất riêng', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },
  '/api/nutrition/food-samples': {
    get: {
      tags: ['11. Bếp ăn, Thực đơn & An toàn Thực phẩm (Nutrition)'],
      summary: '[admin, principal, chef] Sổ theo dõi Lưu mẫu thức ăn 24 giờ',
      responses: {
        200: { description: 'Danh sách mẫu lưu thức ăn', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_FoodSample' } } } }) }
      }
    }
  },

  // ============================================================================
  // 12. MUA SẮM & CƠ SỞ VẬT CHẤT (PROCUREMENT & ASSETS)
  // ============================================================================
  '/api/procurement/assets': {
    get: {
      tags: ['12. Mua sắm & Cơ sở vật chất (Procurement & Assets)'],
      summary: '[admin, principal, accountant, teacher] Danh sách Tài sản & Thiết bị nhà trường',
      responses: {
        200: { description: 'Danh mục tài sản kèm lịch sử bảo trì', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_Asset' } } } }) }
      }
    },
    post: {
      tags: ['12. Mua sắm & Cơ sở vật chất (Procurement & Assets)'],
      summary: '[admin, principal] Ghi nhận Tài sản mới vào danh mục quản lý',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['itemId', 'name', 'location', 'originalCost'],
          properties: {
            itemId: { type: 'string' },
            name: { type: 'string', example: 'Điều hòa Daikin Inverter 1.5HP' },
            category: { type: 'string', example: 'equipment' },
            location: { type: 'string', example: 'Lớp Nhà trẻ 6-12A' },
            originalCost: { type: 'number', example: 11500000 },
            serialNumber: { type: 'string', example: 'DK-2026-9981' }
          }
        })
      },
      responses: { 201: { description: 'Tài sản vừa lưu', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_Asset' } } }) } }
    }
  },
  '/api/procurement/requests': {
    get: {
      tags: ['12. Mua sắm & Cơ sở vật chất (Procurement & Assets)'],
      summary: 'Danh sách Đề xuất mua sắm thiết bị / học phẩm',
      responses: {
        200: { description: 'Danh sách đề xuất mua sắm', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_ProcurementRequest' } } } }) }
      }
    },
    post: {
      tags: ['12. Mua sắm & Cơ sở vật chất (Procurement & Assets)'],
      summary: '[admin, principal, teacher, accountant, chef] Tạo Đề xuất mua sắm mới',
      requestBody: { required: true, content: jsonContent({ $ref: '#/components/schemas/DB_ProcurementRequest' }) },
      responses: { 201: { description: 'Đề xuất vừa tạo', content: jsonContent({ type: 'object', properties: { data: { $ref: '#/components/schemas/DB_ProcurementRequest' } } }) } }
    }
  },

  // ============================================================================
  // 13. THÔNG BÁO, TIN NHẮN & PHẢN HỒI PHỤ HUYNH (COMMUNICATION)
  // ============================================================================
  '/api/notifications': {
    get: {
      tags: ['13. Thông báo, Tin nhắn & Phản hồi (Communication)'],
      summary: '[Mọi vai trò] Danh sách Thông báo của người dùng đang đăng nhập',
      parameters: [
        { name: 'unread', in: 'query', schema: { type: 'boolean' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } }
      ],
      responses: {
        200: { description: 'Danh sách thông báo kèm số lượng chưa đọc', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_Notification' } }, unreadCount: { type: 'integer', example: 2 } } }) }
      }
    }
  },
  '/api/chat/conversations': {
    get: {
      tags: ['13. Thông báo, Tin nhắn & Phản hồi (Communication)'],
      summary: '[parent, teacher] Danh sách cuộc trò chuyện trực tiếp giữa Phụ huynh & Giáo viên lớp con theo học',
      responses: {
        200: { description: 'Danh sách hội thoại', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_Conversation' } } } }) }
      }
    }
  },
  '/api/parent-feedback': {
    get: {
      tags: ['13. Thông báo, Tin nhắn & Phản hồi (Communication)'],
      summary: '[parent, admin, principal] Danh sách Ý kiến / Góp ý của Phụ huynh gửi Ban giám hiệu',
      responses: {
        200: { description: 'Danh sách phản hồi phụ huynh', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_ParentFeedback' } } } }) }
      }
    }
  },
  '/api/student-profile-change-requests': {
    get: {
      tags: ['13. Thông báo, Tin nhắn & Phản hồi (Communication)'],
      summary: '[parent, admin, principal] Danh sách Yêu cầu cập nhật thông tin nhạy cảm / người đón ủy quyền chờ duyệt',
      responses: {
        200: { description: 'Danh sách yêu cầu cập nhật hồ sơ', content: jsonContent({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/DB_StudentProfileChangeRequest' } } } }) }
      }
    }
  },

  // ============================================================================
  // 14. BÁO CÁO ĐIỀU HÀNH & THỐNG KÊ (REPORTS)
  // ============================================================================
  '/api/reports/dashboard': {
    get: {
      tags: ['14. Báo cáo Điều hành & Thống kê (Reports)'],
      summary: '[admin, principal, teacher] Số liệu Tổng quan Dashboard (Sĩ số, Nhân sự, Lớp học, Doanh thu hôm nay, Biểu đồ Điểm danh & Cảnh báo thiếu giáo viên)',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }
      ],
      responses: {
        200: {
          description: 'Dữ liệu tổng quan toàn trường (hoặc phạm vi lớp của Giáo viên)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  summary: {
                    type: 'object',
                    properties: {
                      totalStudents: { type: 'integer', example: 145 },
                      totalStaff: { type: 'integer', example: 24 },
                      totalClassrooms: { type: 'integer', example: 7 },
                      todayRevenue: { type: 'number', example: 122200000 }
                    }
                  },
                  attendanceSummary: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer', example: 145 },
                      present: { type: 'integer', example: 132 },
                      late: { type: 'integer', example: 4 },
                      absent: { type: 'integer', example: 2 },
                      absent_permission: { type: 'integer', example: 7 }
                    }
                  },
                  recentAttendance: { type: 'array', items: { $ref: '#/components/schemas/DB_StudentAttendance' } }
                }
              }
            }
          })
        }
      }
    }
  },
  '/api/reports/principal-work': {
    get: {
      tags: ['14. Báo cáo Điều hành & Thống kê (Reports)'],
      summary: '[principal, admin] Đếm số lượng đầu việc đang chờ Hiệu trưởng phê duyệt (Bảng lương, Đơn nghỉ, Hoàn phí, Chi vận hành, Hồ sơ, Phản hồi)',
      responses: {
        200: {
          description: 'Số lượng công việc chờ xử lý theo từng nhóm',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  payroll: { type: 'integer', example: 2 },
                  leave: { type: 'integer', example: 1 },
                  refunds: { type: 'integer', example: 0 },
                  operatingExpenses: { type: 'integer', example: 1 },
                  profileChanges: { type: 'integer', example: 3 },
                  parentFeedback: { type: 'integer', example: 1 }
                }
              }
            }
          })
        }
      }
    }
  },
  '/api/reports/accounting-summary': {
    get: {
      tags: ['14. Báo cáo Điều hành & Thống kê (Reports)'],
      summary: '[admin, principal, accountant] Báo cáo Kế toán Tổng hợp Thu – Chi – Công nợ theo tháng',
      parameters: [{ name: 'month', in: 'query', required: true, schema: { type: 'string', example: '2026-11' } }],
      responses: {
        200: { description: 'Báo cáo tài chính kế toán chi tiết', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  }
};

module.exports = { swaggerPathsPart2 };

