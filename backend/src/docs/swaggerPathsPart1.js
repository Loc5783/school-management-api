'use strict';

/**
 * @fileoverview Đặc tả chi tiết API Phần 1 (Tags 00 → 07):
 * - 00. Hệ thống & Sức khỏe máy chủ (Health & Database Dictionary)
 * - 01. Xác thực & Phiên đăng nhập (Auth)
 * - 02. Quản trị Tổng Đa Trường (SuperAdmin)
 * - 03. Trường, Phân hiệu & Tài khoản (Campuses & Accounts)
 * - 04. Lớp học (Classrooms)
 * - 05. Học sinh, Y tế & Nhập Excel (Students)
 * - 06. Điểm danh & Đơn xin nghỉ học (Attendance)
 * - 07. Đón trả trẻ 1 chạm & Trực cổng OTP (Pickups & Guard)
 */

const jsonContent = (schema, example) => ({
  'application/json': {
    schema,
    ...(example !== undefined ? { example } : {})
  }
});

const standardErrorResponses = {
  400: {
    description: 'Dữ liệu đầu vào hoặc định dạng ID không hợp lệ',
    content: jsonContent(
      { $ref: '#/components/schemas/ApiErrorResponse' },
      { success: false, message: 'Mã định danh dữ liệu không hợp lệ.' }
    )
  },
  401: {
    description: 'Chưa đăng nhập hoặc JWT Token đã hết hạn / bị thu hồi',
    content: jsonContent(
      { $ref: '#/components/schemas/ApiErrorResponse' },
      { success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }
    )
  },
  403: {
    description: 'Không đủ quyền vai trò (Role) hoặc khác ngữ cảnh Trường học (Multi-Tenant)',
    content: jsonContent(
      { $ref: '#/components/schemas/ApiErrorResponse' },
      { success: false, message: 'Bạn không có quyền thực hiện chức năng này.' }
    )
  },
  422: {
    description: 'Vi phạm quy tắc kiểm tra dữ liệu nghiệp vụ (Validation)',
    content: jsonContent(
      { $ref: '#/components/schemas/ApiErrorResponse' },
      { success: false, message: 'Dữ liệu nhập vào chưa hợp lệ hoặc thiếu trường bắt buộc.' }
    )
  }
};

const idParam = (name = 'id', description = 'MongoDB ObjectId (24 ký tự hex)') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', pattern: '^[0-9a-fA-F]{24}$', example: '674580a1b2c3d4e5f6000101' }
});

const swaggerPathsPart1 = {
  // ============================================================================
  // 00. HỆ THỐNG & TỪ ĐIỂN DATABASE
  // ============================================================================
  '/api/health': {
    get: {
      tags: ['00. Hệ thống & Từ điển Database'],
      summary: 'Kiểm tra trạng thái hoạt động của máy chủ (Health Check)',
      security: [],
      responses: {
        200: {
          description: 'Máy chủ đang hoạt động bình thường',
          content: jsonContent(
            {
              type: 'object',
              properties: {
                status: { type: 'string', example: 'OK' },
                mode: { type: 'string', example: 'saas_phase1a' },
                message: { type: 'string', example: 'SaaS Control Plane 1A Active' }
              }
            }
          )
        }
      }
    }
  },
  '/api/docs/database': {
    get: {
      tags: ['00. Hệ thống & Từ điển Database'],
      summary: 'Tra cứu toàn bộ Từ điển Cơ sở dữ liệu 7 Phân vùng (Collections, Khóa ngoại & Indexes)',
      description:
        'Trả về cấu trúc tổng thể toàn bộ các bảng MongoDB theo 7 phân vùng kiến trúc (`zone1_system` → `zone7_reporting`), ' +
        'danh sách khóa ngoại (`ref`) giữa các bảng và các chỉ mục (`unique` / `tenantId`) để lập trình viên nắm bắt nhanh toàn bộ DB.',
      security: [],
      responses: {
        200: {
          description: 'Danh sách phân vùng và bảng dữ liệu',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              totalZones: { type: 'integer', example: 7 },
              totalCollections: { type: 'integer', example: 74 },
              zones: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    zoneFolder: { type: 'string', example: 'zone3_school' },
                    zoneTitle: { type: 'string', example: 'Zone 3 — Học sinh, Lớp học, Điểm danh & Đón trả (School Core)' },
                    zoneSummary: { type: 'string' },
                    collectionCount: { type: 'integer', example: 12 },
                    collections: { type: 'array', items: { type: 'object' } }
                  }
                }
              }
            }
          })
        }
      }
    }
  },

  // ============================================================================
  // 01. XÁC THỰC & PHIÊN ĐĂNG NHẬP (SCHOOL AUTH)
  // ============================================================================
  '/api/auth/login': {
    post: {
      tags: ['01. Xác thực & Phiên đăng nhập (Auth)'],
      summary: 'Đăng nhập hợp nhất 1 luồng (Để trống schoolCode = Admin Tổng Đa Trường; Có schoolCode = Tài khoản Trường)',
      description:
        '- **Admin Tổng Đa Trường (`PlatformAdmin`)**: Để trống `schoolCode` (`""` hoặc lược bỏ) + `username` (mặc định tự tạo khi DB trống: `admin` / `123456`) → trả về `isSuperAdmin: true`, vào giao diện `/multi-school` để tạo trường mới và cấp tài khoản riêng cho từng trường.\n' +
        '- **Nhân sự từng trường**: Nhập `schoolCode` (VD: `HOANANG-A`) + `username` + `password` của trường đó.\n' +
        '- **Phụ huynh học sinh**: Tài khoản tự động tạo khi thêm học sinh/nhập Excel với `schoolCode` + `username = Số điện thoại` (VD: `0912345678`) và `password` mặc định lần đầu là `123456`.\n' +
        '- Sao chép trường `token` trả về rồi bấm nút **Authorize** màu xanh lá để gọi thử mọi API bên dưới.',
      security: [],
      requestBody: {
        required: true,
        content: jsonContent(
          {
            type: 'object',
            required: ['username', 'password'],
            properties: {
              schoolCode: {
                type: 'string',
                description: 'Để trống ("") nếu đăng nhập Admin Tổng Đa Trường; nhập mã trường (VD: HOANANG-A) nếu đăng nhập tài khoản trường',
                example: ''
              },
              username: { type: 'string', description: 'Tài khoản Admin Tổng (admin), tài khoản trường hoặc SĐT Phụ huynh', example: 'admin' },
              password: { type: 'string', format: 'password', example: '123456' }
            }
          }
        )
      },
      responses: {
        200: {
          description: 'Đăng nhập thành công, trả về JWT Bearer Token kèm thông tin User & Trường (Tenant)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Đăng nhập thành công' },
              token: { type: 'string', description: 'JWT Bearer Token gắn vào header Authorization', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
              user: { $ref: '#/components/schemas/DB_User' },
              tenant: {
                type: 'object',
                properties: {
                  _id: { type: 'string', example: '674580a1b2c3d4e5f6000001' },
                  code: { type: 'string', example: 'HOANANG-A' },
                  name: { type: 'string', example: 'Trường Mầm non Hoa Nắng - Cơ sở A' },
                  status: { type: 'string', example: 'active' }
                }
              }
            }
          })
        },
        401: standardErrorResponses[401]
      }
    }
  },
  '/api/auth/me': {
    get: {
      tags: ['01. Xác thực & Phiên đăng nhập (Auth)'],
      summary: 'Lấy hồ sơ người dùng hiện tại, danh sách quyền hạn và thông tin trường đang đăng nhập',
      responses: {
        200: {
          description: 'Thông tin phiên đăng nhập hiện tại',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { $ref: '#/components/schemas/DB_User' },
              tenant: { $ref: '#/components/schemas/DB_Tenant' }
            }
          })
        },
        401: standardErrorResponses[401]
      }
    }
  },
  '/api/auth/me/password': {
    post: {
      tags: ['01. Xác thực & Phiên đăng nhập (Auth)'],
      summary: 'Đổi mật khẩu cá nhân của tài khoản đang đăng nhập',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', example: '123456' },
            newPassword: { type: 'string', minLength: 6, example: 'MatKhauMoi@2026' }
          }
        })
      },
      responses: {
        200: {
          description: 'Đổi mật khẩu thành công (tăng authVersion để vô hiệu các phiên cũ)',
          content: jsonContent({ $ref: '#/components/schemas/ApiMessageResponse' })
        },
        400: standardErrorResponses[400],
        401: standardErrorResponses[401]
      }
    }
  },
  '/api/auth/logout': {
    post: {
      tags: ['01. Xác thực & Phiên đăng nhập (Auth)'],
      summary: 'Đăng xuất và thu hồi phiên JWT hiện tại (lưu vào bảng RevokedSession)',
      responses: {
        200: {
          description: 'Đã đăng xuất an toàn',
          content: jsonContent({ $ref: '#/components/schemas/ApiMessageResponse' })
        }
      }
    }
  },

  // ============================================================================
  // 02. QUẢN TRỊ TỔNG ĐA TRƯỜNG (SUPERADMIN)
  // ============================================================================
  '/api/multi-school/login': {
    post: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: 'Đăng nhập trực tiếp cổng Quản trị Tổng Đa Trường (Mặc định khởi tạo: admin / 123456)',
      security: [],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'admin' },
            password: { type: 'string', example: '123456' }
          }
        })
      },
      responses: {
        200: {
          description: 'Trả về PlatformAdmin JWT Token (dùng cho các API /api/multi-school/*)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              isSuperAdmin: { type: 'boolean', example: true },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
              user: { $ref: '#/components/schemas/DB_PlatformAdmin' }
            }
          })
        },
        401: standardErrorResponses[401]
      }
    }
  },
  '/api/multi-school/me/password': {
    post: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: '[SuperAdmin] Đổi mật khẩu và/hoặc tên đăng nhập của tài khoản Admin Tổng Đa Trường',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            newUsername: { type: 'string', example: 'admin' },
            currentPassword: { type: 'string', example: '123456' },
            newPassword: { type: 'string', minLength: 6, example: 'AdminTong@2026' }
          }
        })
      },
      responses: {
        200: {
          description: 'Cập nhật mật khẩu Admin Tổng thành công, trả về JWT Token mới',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
              token: { type: 'string' },
              user: { $ref: '#/components/schemas/DB_PlatformAdmin' }
            }
          })
        },
        401: standardErrorResponses[401],
        422: standardErrorResponses[422]
      }
    }
  },
  '/api/multi-school/schools': {
    get: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: '[SuperAdmin] Xem tổng quan toàn bộ chuỗi trường, số phân hiệu, lớp học, học sinh, nhân sự & Account Admin riêng',
      responses: {
        200: {
          description: 'Tổng hợp toàn hệ thống đa trường',
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
                      totalSchools: { type: 'integer', example: 3 },
                      activeSchools: { type: 'integer', example: 3 },
                      totalCampuses: { type: 'integer', example: 6 },
                      totalClassrooms: { type: 'integer', example: 18 },
                      totalStudents: { type: 'integer', example: 420 },
                      totalStaff: { type: 'integer', example: 65 }
                    }
                  },
                  schools: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        _id: { type: 'string' },
                        code: { type: 'string', example: 'HOANANG-A' },
                        name: { type: 'string', example: 'Trường Mầm non Hoa Nắng - Cơ sở A' },
                        status: { type: 'string', enum: ['active', 'suspended', 'terminated'] },
                        campusCount: { type: 'integer', example: 2 },
                        classCount: { type: 'integer', example: 7 },
                        studentCount: { type: 'integer', example: 145 },
                        staffCount: { type: 'integer', example: 24 },
                        primaryAdmin: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string' },
                            username: { type: 'string', example: 'admin_csa' },
                            fullName: { type: 'string', example: 'Quản trị Cơ sở A' },
                            status: { type: 'string', example: 'active' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          })
        }
      }
    },
    post: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: '[SuperAdmin] Tạo Trường học mới kèm 1 Tài khoản Admin riêng & Danh sách Phân hiệu ban đầu trong 1 Transaction',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['code', 'name', 'adminUsername', 'adminPassword'],
          properties: {
            code: { type: 'string', example: 'HOANANG-B', description: 'Mã trường viết hoa duy nhất (3–20 ký tự)' },
            name: { type: 'string', example: 'Trường Mầm non Hoa Nắng - Cơ sở B' },
            organizationCode: { type: 'string', example: 'HOA-NANG-GROUP' },
            contactEmail: { type: 'string', example: 'csb@hoanang.edu.vn' },
            adminUsername: { type: 'string', example: 'admin_csb' },
            adminPassword: { type: 'string', example: '123456' },
            adminFullName: { type: 'string', example: 'Quản trị viên Cơ sở B' },
            initialCampuses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string', example: 'CS-CHINH' },
                  name: { type: 'string', example: 'Cơ sở chính' }
                }
              }
            }
          }
        })
      },
      responses: {
        201: {
          description: 'Đã tạo Trường + Account Admin riêng thành công',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  school: { $ref: '#/components/schemas/DB_Tenant' },
                  adminAccount: { type: 'object', properties: { _id: { type: 'string' }, username: { type: 'string' }, fullName: { type: 'string' } } }
                }
              }
            }
          })
        },
        409: { description: 'Trùng mã trường', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) },
        422: standardErrorResponses[422]
      }
    }
  },
  '/api/multi-school/schools/{id}': {
    put: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: '[SuperAdmin] Cập nhật thông tin trường, tạm khóa/mở trường hoặc đổi Tên đăng nhập / Mật khẩu Admin riêng của trường',
      parameters: [idParam('id', 'ID của Trường (Tenant)')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            name: { type: 'string', example: 'Trường Mầm non Hoa Nắng - Cơ sở B' },
            status: { type: 'string', enum: ['active', 'suspended', 'terminated'], example: 'active' },
            adminUsername: { type: 'string', example: 'admin_csb' },
            newAdminPassword: { type: 'string', description: 'Để trống nếu không đổi mật khẩu', example: '' }
          }
        })
      },
      responses: {
        200: { description: 'Cập nhật thành công', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  },
  '/api/multi-school/schools/{id}/enter': {
    post: {
      tags: ['02. Quản trị Tổng Đa Trường (SuperAdmin)'],
      summary: '[SuperAdmin] Chuyển ngữ cảnh vào điều hành trực tiếp một trường cụ thể (Cấp phiên School JWT 4 giờ)',
      parameters: [idParam('id', 'ID của Trường (Tenant) muốn vào điều hành')],
      responses: {
        200: {
          description: 'Trả về token phiên điều hành của trường được chọn',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              token: { type: 'string' },
              tenant: { $ref: '#/components/schemas/DB_Tenant' },
              user: { $ref: '#/components/schemas/DB_User' }
            }
          })
        }
      }
    }
  },

  // ============================================================================
  // 03. TRƯỜNG, PHÂN HIỆU / CƠ SỞ & TÀI KHOẢN (SYSTEM)
  // ============================================================================
  '/api/system/campuses': {
    get: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin, principal] Xem thông tin trường hiện tại và danh sách toàn bộ Phân hiệu kèm số lớp & sĩ số học sinh',
      responses: {
        200: {
          description: 'Thông tin trường và danh sách phân hiệu',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  school: {
                    type: 'object',
                    properties: {
                      _id: { type: 'string' },
                      code: { type: 'string', example: 'HOANANG-A' },
                      name: { type: 'string', example: 'Trường Mầm non Hoa Nắng' },
                      organizationCode: { type: 'string', example: 'HOA-NANG-GROUP' },
                      contactEmail: { type: 'string', example: 'lienhe@hoanang.edu.vn' }
                    }
                  },
                  campuses: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        code: { type: 'string', example: 'PH-2' },
                        name: { type: 'string', example: 'Phân hiệu 2 - Mỹ Đình' },
                        address: { type: 'string', example: 'Số 18 Hàm Nghi, Nam Từ Liêm' },
                        phone: { type: 'string', example: '02438889999' },
                        managerName: { type: 'string', example: 'Cô Nguyễn Thu Hà' },
                        isActive: { type: 'boolean', example: true },
                        classCount: { type: 'integer', example: 4 },
                        studentCount: { type: 'integer', example: 86 }
                      }
                    }
                  }
                }
              }
            }
          })
        }
      }
    },
    post: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin] Thêm mới một Phân hiệu / Cơ sở trực thuộc trường',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['name'],
          properties: {
            code: { type: 'string', description: 'Tùy chọn (để trống hệ thống tự sinh mã in hoa)', example: 'PH-2' },
            name: { type: 'string', example: 'Phân hiệu 2 - Mỹ Đình' },
            address: { type: 'string', example: 'Số 18 Hàm Nghi, Nam Từ Liêm' },
            phone: { type: 'string', example: '02438889999' },
            managerName: { type: 'string', example: 'Cô Nguyễn Thu Hà' }
          }
        })
      },
      responses: {
        201: { description: 'Đã tạo phân hiệu mới', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) },
        409: { description: 'Trùng tên hoặc mã phân hiệu', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) }
      }
    }
  },
  '/api/system/campuses/{campusCode}': {
    put: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin] Cập nhật Phân hiệu (tự động đổi tên phân hiệu đồng bộ sang các Lớp học trực thuộc)',
      parameters: [{ name: 'campusCode', in: 'path', required: true, schema: { type: 'string', example: 'PH-2' } }],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', example: 'Phân hiệu 2 - Mỹ Đình Mới' },
            address: { type: 'string' },
            phone: { type: 'string' },
            managerName: { type: 'string' },
            isActive: { type: 'boolean', example: true }
          }
        })
      },
      responses: { 200: { description: 'Đã cập nhật phân hiệu', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    },
    delete: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin] Xóa Phân hiệu (chỉ cho phép khi không còn lớp học đang hoạt động tại phân hiệu đó)',
      parameters: [{ name: 'campusCode', in: 'path', required: true, schema: { type: 'string', example: 'PH-2' } }],
      responses: {
        200: { description: 'Đã xóa phân hiệu', content: jsonContent({ $ref: '#/components/schemas/ApiMessageResponse' }) },
        409: { description: 'Phân hiệu đang còn lớp học hoạt động', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) }
      }
    }
  },
  '/api/system/accounts': {
    get: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin, hr] Danh sách tài khoản nhân sự nội bộ trong trường',
      responses: {
        200: {
          description: 'Danh sách tài khoản nội bộ (không bao gồm passwordHash)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_User' } }
            }
          })
        }
      }
    },
    post: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin, hr] Tạo tài khoản nhân sự nội bộ riêng lẻ',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['username', 'password', 'role', 'fullName'],
          properties: {
            username: { type: 'string', example: 'gv.lananh' },
            password: { type: 'string', example: '123456' },
            role: { type: 'string', enum: ['principal', 'teacher', 'accountant', 'chef', 'guard', 'hr'], example: 'teacher' },
            fullName: { type: 'string', example: 'Nguyễn Lan Anh' },
            phone: { type: 'string', example: '0901234567' },
            email: { type: 'string', example: 'lananh@hoanang.edu.vn' }
          }
        })
      },
      responses: { 201: { description: 'Đã tạo tài khoản', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },
  '/api/system/parents': {
    get: {
      tags: ['03. Trường, Phân hiệu & Tài khoản (System)'],
      summary: '[admin] Danh sách toàn bộ tài khoản Phụ huynh và các con đã liên kết trong trường',
      responses: {
        200: {
          description: 'Danh sách tài khoản phụ huynh',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_User' } }
            }
          })
        }
      }
    }
  },

  // ============================================================================
  // 04. LỚP HỌC (CLASSROOMS — TỪ 6 THÁNG TUỔI ĐẾN 6 TUỔI)
  // ============================================================================
  '/api/classrooms': {
    get: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin, principal, teacher, hr] Danh sách Lớp học (tự lọc theo lớp phụ trách nếu là Giáo viên)',
      parameters: [
        { name: 'campus', in: 'query', description: 'Lọc theo tên Phân hiệu (VD: Cơ sở chính, Phân hiệu 2)', schema: { type: 'string' } },
        { name: 'schoolYear', in: 'query', description: 'Lọc theo năm học YYYY-YYYY (VD: 2026-2027)', schema: { type: 'string' } },
        { name: 'includeArchived', in: 'query', description: 'true để lấy cả lớp đã lưu trữ', schema: { type: 'boolean' } }
      ],
      responses: {
        200: {
          description: 'Mảng các đối tượng Classroom kèm sĩ số hiện tại (statistics.currentStudents)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Classroom' } }
            }
          })
        }
      }
    },
    post: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin, principal] Tạo Lớp học mới (hỗ trợ nhóm tuổi Dưới 3 tuổi: 6-12m, 1-2, 2-3 và Mẫu giáo: 3-4, 4-5, 5-6)',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['name', 'ageGroup', 'maxSize', 'schoolYear'],
          properties: {
            name: { type: 'string', example: 'NT 6-12A' },
            fullName: { type: 'string', example: 'Nhà trẻ 6–12 tháng lớp A' },
            campus: { type: 'string', default: 'Cơ sở chính', example: 'Cơ sở chính' },
            ageGroup: { type: 'string', enum: ['6-12m', '1-2', '2-3', '3-4', '4-5', '5-6'], example: '6-12m' },
            maxSize: { type: 'integer', minimum: 1, maximum: 60, example: 20 },
            schoolYear: { type: 'string', pattern: '^\\d{4}-\\d{4}$', example: '2026-2027' },
            subject: { type: 'string', example: '' }
          }
        })
      },
      responses: {
        201: {
          description: 'Tạo lớp học thành công',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Tạo lớp học thành công' },
              data: { $ref: '#/components/schemas/DB_Classroom' }
            }
          })
        },
        409: { description: 'Trùng tên lớp trong cùng phân hiệu & năm học', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) },
        422: standardErrorResponses[422]
      }
    }
  },
  '/api/classrooms/{id}': {
    get: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin, principal, teacher, hr] Xem chi tiết một Lớp học',
      parameters: [idParam('id', 'ID lớp học')],
      responses: {
        200: {
          description: 'Chi tiết lớp học',
          content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_Classroom' } } })
        }
      }
    },
    put: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin, principal] Cập nhật Lớp học (tự động đồng bộ tên lớp mới sang Student & StudentAttendance)',
      parameters: [idParam('id', 'ID lớp học')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            name: { type: 'string', example: 'MGL 5-6A' },
            fullName: { type: 'string', example: 'Mẫu giáo lớn 5–6 tuổi A' },
            campus: { type: 'string', example: 'Cơ sở chính' },
            ageGroup: { type: 'string', enum: ['6-12m', '1-2', '2-3', '3-4', '4-5', '5-6'] },
            maxSize: { type: 'integer', example: 25 },
            schoolYear: { type: 'string', example: '2026-2027' }
          }
        })
      },
      responses: { 200: { description: 'Đã cập nhật lớp học', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    },
    delete: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin] Lưu trữ (Archive) Lớp học khi không còn học sinh đang theo học',
      parameters: [idParam('id', 'ID lớp học')],
      responses: { 200: { description: 'Đã chuyển lớp sang trạng thái archived', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },
  '/api/classrooms/{id}/homeroom-teacher': {
    put: {
      tags: ['04. Lớp học (Classrooms)'],
      summary: '[admin, hr] Phân công hoặc gỡ Giáo viên chủ nhiệm của lớp (mỗi GV chỉ chủ nhiệm 1 lớp active / năm học)',
      parameters: [idParam('id', 'ID lớp học')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            teacherId: { type: 'string', nullable: true, description: 'User._id của giáo viên (gửi null để gỡ phân công)', example: '674580a1b2c3d4e5f6000202' }
          }
        })
      },
      responses: { 200: { description: 'Đã phân công GVCN', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },

  // ============================================================================
  // 05. HỌC SINH, Y TẾ & NHẬP EXCEL (STUDENTS)
  // ============================================================================
  '/api/students': {
    get: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher, hr, parent] Danh sách Học sinh có phân trang (tự lọc theo quyền vai trò)',
      description:
        '- **Admin / Hiệu trưởng / HR**: Xem học sinh toàn trường.\n' +
        '- **Giáo viên**: Chỉ trả về học sinh các lớp được phân công.\n' +
        '- **Phụ huynh**: Chỉ trả về đúng các con đã liên kết trong `parentInfo.studentIds`.',
      parameters: [
        { name: 'classroomId', in: 'query', description: 'Lọc theo ID lớp học', schema: { type: 'string' } },
        { name: 'status', in: 'query', description: 'enrolled | temporarily_absent | withdrawn | graduated | all', schema: { type: 'string', default: 'enrolled' } },
        { name: 'search', in: 'query', description: 'Tìm theo tên, mã HS, mã định danh, SĐT phụ huynh', schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }
      ],
      responses: {
        200: {
          description: 'Danh sách học sinh kèm thông tin phân trang',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Student' } },
              pagination: { $ref: '#/components/schemas/PaginationMeta' }
            }
          })
        }
      }
    },
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Tiếp nhận Học sinh mới (Tự tạo TK Phụ huynh 1+2 theo SĐT & tự điền danh sách đón trẻ)',
      description:
        '**Tự động hóa nghiệp vụ khi lưu:**\n' +
        '1. Nếu để trống `studentCode`, hệ thống tự sinh mã số tăng dần duy nhất trong trường.\n' +
        '2. Tự động tạo/gắn tài khoản Phụ huynh (`role: "parent"`, `username = SĐT`, mật khẩu mặc định lần đầu `123456`) cho cả Phụ huynh 1 và Phụ huynh 2; nếu anh/chị/em ruột trùng SĐT sẽ tự gom chung vào 1 tài khoản.\n' +
        '3. Tự động điền Bố/Mẹ vào `authorizedPickers` để buổi chiều cô giáo trả trẻ 1 chạm được ngay.',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['fullName', 'birthDate', 'gender', 'classroomId'],
          properties: {
            studentCode: { type: 'string', description: 'Để trống tự sinh mã số', example: '' },
            identityCode: { type: 'string', description: 'Mã định danh cá nhân (12 số)', example: '001221004567' },
            healthInsuranceCode: { type: 'string', description: 'Mã thẻ BHYT', example: 'TE1012600099887' },
            bloodType: { type: 'string', enum: ['', 'A', 'B', 'AB', 'O', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], example: 'O+' },
            fullName: { type: 'string', example: 'Nguyễn Bảo Ngọc' },
            birthDate: { type: 'string', format: 'date', example: '2022-05-15' },
            gender: { type: 'string', enum: ['male', 'female'], example: 'female' },
            classroomId: { type: 'string', example: '674580a1b2c3d4e5f6000101' },
            address: { type: 'string', example: 'Cầu Giấy, Hà Nội' },
            parents: {
              type: 'array',
              items: {
                type: 'object',
                required: ['fullName', 'phone'],
                properties: {
                  fullName: { type: 'string', example: 'Nguyễn Văn Hùng' },
                  phone: { type: 'string', example: '0912345678' },
                  email: { type: 'string', example: 'hung@gmail.com' },
                  relationship: { type: 'string', enum: ['father', 'mother', 'guardian'], example: 'father' },
                  isPrimary: { type: 'boolean', example: true }
                }
              }
            }
          }
        })
      },
      responses: {
        201: {
          description: 'Hồ sơ học sinh vừa tạo',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Thêm học sinh thành công' },
              data: { $ref: '#/components/schemas/DB_Student' }
            }
          })
        },
        422: standardErrorResponses[422]
      }
    }
  },
  '/api/students/{id}': {
    get: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher, hr, parent] Xem chi tiết toàn bộ hồ sơ, y tế, tiêm chủng và tăng trưởng của Học sinh',
      parameters: [idParam('id', 'ID học sinh')],
      responses: {
        200: {
          description: 'Chi tiết hồ sơ học sinh (các trường được lọc phù hợp theo vai trò người xem)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { $ref: '#/components/schemas/DB_Student' }
            }
          })
        }
      }
    },
    put: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher, parent] Cập nhật thông tin hồ sơ Học sinh',
      parameters: [idParam('id', 'ID học sinh')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            identityCode: { type: 'string' },
            healthInsuranceCode: { type: 'string' },
            bloodType: { type: 'string' },
            address: { type: 'string' },
            notes: { type: 'string' },
            parents: { type: 'array', items: { type: 'object' } }
          }
        })
      },
      responses: { 200: { description: 'Hồ sơ sau khi cập nhật', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_Student' } } }) } }
    }
  },
  '/api/students/{id}/growth-records': {
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Ghi nhận / Cập nhật chỉ số Cân nặng & Chiều cao theo tháng (tự động tính BMI)',
      parameters: [idParam('id', 'ID học sinh')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['month', 'weightKg', 'heightCm'],
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-11' },
            weightKg: { type: 'number', example: 14.8 },
            heightCm: { type: 'number', example: 96.5 },
            nutritionStatus: { type: 'string', example: 'Bình thường' },
            note: { type: 'string', example: 'Bé ăn ngủ tốt, tăng 0.5kg so với tháng 10' }
          }
        })
      },
      responses: {
        200: { description: 'Trả về hồ sơ học sinh kèm mảng growthRecords mới nhất', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_Student' } } }) }
      }
    }
  },
  '/api/students/{id}/vaccinations': {
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Thêm mũi Tiêm chủng vào Sổ tiêm chủng của học sinh',
      parameters: [idParam('id', 'ID học sinh')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['vaccineName'],
          properties: {
            vaccineName: { type: 'string', example: 'Sởi - Quai bị - Rubella (MMR)' },
            doseNumber: { type: 'integer', example: 2 },
            vaccinatedDate: { type: 'string', format: 'date', example: '2026-09-15' },
            status: { type: 'string', enum: ['completed', 'scheduled', 'missed'], example: 'completed' },
            facility: { type: 'string', example: 'VNVC Cầu Giấy' },
            note: { type: 'string', example: 'Không sốt sau tiêm' }
          }
        })
      },
      responses: { 201: { description: 'Đã thêm mũi tiêm chủng', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_Student' } } }) } }
    }
  },
  '/api/students/{id}/transfer': {
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, hr, principal] Chuyển lớp cho học sinh trong cùng trường (cập nhật sĩ số cả 2 lớp trong Transaction)',
      parameters: [idParam('id', 'ID học sinh')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['toClassroomId'],
          properties: {
            toClassroomId: { type: 'string', example: '674580a1b2c3d4e5f6000102' },
            effectiveDate: { type: 'string', format: 'date', example: '2026-11-27' },
            reason: { type: 'string', example: 'Chuyển lên lớp theo độ tuổi' }
          }
        })
      },
      responses: { 200: { description: 'Đã chuyển lớp thành công', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },
  '/api/students/excel/template': {
    get: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Tải file Excel mẫu chuẩn 24 cột (.xlsx) có sẵn dropdown Lớp của trường, 2 Phụ huynh, BHYT & Nhóm máu',
      responses: {
        200: {
          description: 'Luồng nhị phân tập tin Excel (.xlsx)',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: { type: 'string', format: 'binary' }
            }
          }
        }
      }
    }
  },
  '/api/students/excel/preview': {
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Tải lên & kiểm tra trước file Excel học sinh (Hỗ trợ đẩy tổng toàn trường `__ALL__` hoặc đẩy riêng 1 lớp)',
      description:
        '- Gửi `classroomId = "__ALL__"` (dành cho Admin/Hiệu trưởng) để tự động phân bổ vào nhiều lớp theo cột `Lớp` trong Excel.\n' +
        '- Gửi `classroomId = "<ObjectId>"` (dành cho GVCN hoặc đẩy 1 lớp cụ thể).\n' +
        '- Tự động khôi phục số `0` đầu SĐT nếu cột Excel định dạng Number (`912345678` → `0912345678`) và kiểm tra trùng mã Nhân sự / Học sinh.',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['classroomId', 'file'],
              properties: {
                classroomId: { type: 'string', description: '`__ALL__` (nhiều lớp) hoặc ObjectId của 1 lớp', example: '__ALL__' },
                file: { type: 'string', format: 'binary', description: 'Tập tin Excel (.xlsx, tối đa 5MB)' }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Kết quả phân tích từng dòng, cảnh báo sĩ số và cờ `canImport`',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  totalRows: { type: 'integer', example: 25 },
                  totalValid: { type: 'integer', example: 25 },
                  totalErrors: { type: 'integer', example: 0 },
                  canImport: { type: 'boolean', example: true },
                  capacityExceeded: { type: 'boolean', example: false },
                  rows: { type: 'array', items: { type: 'object' } }
                }
              }
            }
          })
        }
      }
    }
  },
  '/api/students/excel/confirm': {
    post: {
      tags: ['05. Học sinh, Y tế & Nhập Excel (Students)'],
      summary: '[admin, principal, teacher] Xác nhận lưu nguyên khối danh sách học sinh từ Excel + Tự động cấp hàng loạt tài khoản Phụ huynh',
      parameters: [
        { name: 'Idempotency-Key', in: 'header', required: true, description: 'Khóa chống gửi trùng lô nhập', schema: { type: 'string', example: 'import-all-1732680000' } }
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['classroomId', 'students'],
          properties: {
            classroomId: { type: 'string', example: '__ALL__' },
            students: { type: 'array', description: 'Mảng rows hợp lệ nhận từ bước /excel/preview', items: { type: 'object' } }
          }
        })
      },
      responses: {
        201: {
          description: 'Đã lưu toàn bộ học sinh và trả kèm thống kê cấp tài khoản Phụ huynh (`parentSyncStats`)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Đã nhập thành công 25 học sinh.' },
              parentSyncStats: {
                type: 'object',
                properties: {
                  createdCount: { type: 'integer', description: 'Số tài khoản Phụ huynh mới tạo (mật khẩu 123456)', example: 38 },
                  linkedCount: { type: 'integer', description: 'Số tài khoản Phụ huynh gom chung anh/chị/em cùng SĐT', example: 4 }
                }
              },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_Student' } }
            }
          })
        }
      }
    }
  },

  // ============================================================================
  // 06. ĐIỂM DANH HỌC SINH & ĐƠN XIN NGHỈ HỌC (ATTENDANCE)
  // ============================================================================
  '/api/attendance/class/{classroomId}': {
    get: {
      tags: ['06. Điểm danh & Đơn xin nghỉ học (Attendance)'],
      summary: '[teacher, admin, principal] Lấy bảng điểm danh của cả lớp trong ngày (YYYY-MM-DD)',
      parameters: [
        idParam('classroomId', 'ID lớp học'),
        { name: 'date', in: 'query', description: 'Ngày điểm danh YYYY-MM-DD (mặc định hôm nay theo múi giờ Việt Nam)', schema: { type: 'string', example: '2026-11-27' } }
      ],
      responses: {
        200: {
          description: 'Danh sách bản ghi điểm danh của lớp trong ngày',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { $ref: '#/components/schemas/DB_StudentAttendance' } }
            }
          })
        }
      }
    }
  },
  '/api/attendance/bulk': {
    post: {
      tags: ['06. Điểm danh & Đơn xin nghỉ học (Attendance)'],
      summary: '[teacher, admin] Lưu điểm danh hàng loạt cho cả lớp (present, late, absent, absent_permission)',
      description: 'Lưu ý: Các ngày ghi nhận `absent_permission` (Nghỉ có phép) sẽ được phân hệ Tài chính tự động thống kê để khấu trừ tiền ăn vào kỳ thu học phí tháng kế tiếp.',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['classroomId', 'records'],
          properties: {
            classroomId: { type: 'string', example: '674580a1b2c3d4e5f6000101' },
            attendDate: { type: 'string', format: 'date', example: '2026-11-27' },
            records: {
              type: 'array',
              items: {
                type: 'object',
                required: ['studentId', 'status'],
                properties: {
                  studentId: { type: 'string', example: '674580a1b2c3d4e5f6000301' },
                  status: { type: 'string', enum: ['present', 'late', 'absent', 'absent_permission'], example: 'present' },
                  note: { type: 'string', example: '' }
                }
              }
            }
          }
        })
      },
      responses: {
        201: { description: 'Đã lưu điểm danh lớp', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  },
  '/api/attendance/{id}': {
    put: {
      tags: ['06. Điểm danh & Đơn xin nghỉ học (Attendance)'],
      summary: '[teacher, admin] Cập nhật trạng thái hoặc ghi chú một bản ghi điểm danh đã tạo',
      parameters: [idParam('id', 'ID bản ghi StudentAttendance')],
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['present', 'late', 'absent', 'absent_permission'], example: 'late' },
            note: { type: 'string', example: 'Mẹ báo kẹt xe đến lúc 8h35' }
          }
        })
      },
      responses: { 200: { description: 'Bản ghi sau cập nhật', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/DB_StudentAttendance' } } }) } }
    }
  },
  '/api/attendance/leave-requests': {
    get: {
      tags: ['06. Điểm danh & Đơn xin nghỉ học (Attendance)'],
      summary: '[parent, teacher, admin, principal] Danh sách Đơn xin nghỉ học của học sinh',
      responses: {
        200: { description: 'Danh sách đơn xin nghỉ học', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/DB_StudentLeaveRequest' } } } }) }
      }
    },
    post: {
      tags: ['06. Điểm danh & Đơn xin nghỉ học (Attendance)'],
      summary: '[parent] Phụ huynh gửi Đơn xin nghỉ phép cho con',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['studentId', 'startDate', 'endDate', 'reason'],
          properties: {
            studentId: { type: 'string', example: '674580a1b2c3d4e5f6000301' },
            startDate: { type: 'string', format: 'date', example: '2026-11-28' },
            endDate: { type: 'string', format: 'date', example: '2026-11-28' },
            reason: { type: 'string', example: 'Bé đi khám răng định kỳ' }
          }
        })
      },
      responses: { 201: { description: 'Đã tạo đơn xin nghỉ phép', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },

  // ============================================================================
  // 07. ĐÓN TRẢ TRẺ 1 CHẠM TẠI LỚP & TRỰC CỔNG OTP (PICKUPS & GUARD)
  // ============================================================================
  '/api/pickups/classrooms': {
    get: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[teacher, guard, admin, principal] Danh sách các lớp hoạt động được phép thao tác trả trẻ',
      responses: {
        200: {
          description: 'Danh sách lớp trả trẻ',
          content: jsonContent({ type: 'object', properties: { success: { type: 'boolean', example: true }, data: { type: 'array', items: { $ref: '#/components/schemas/DB_Classroom' } } } })
        }
      }
    }
  },
  '/api/pickups/class-roster/{classroomId}': {
    get: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[teacher, guard, admin, principal] Lấy danh sách Trả trẻ tại lớp kèm trạng thái điểm danh sáng & danh sách Bố/Mẹ/Ủy quyền',
      parameters: [
        idParam('classroomId', 'ID lớp học'),
        { name: 'pickupDate', in: 'query', schema: { type: 'string', example: '2026-11-27' } }
      ],
      responses: {
        200: {
          description: 'Danh sách học sinh của lớp kèm gợi ý người đón 1 chạm (`pickerOptions`) và trạng thái đã đón (`departed`)',
          content: jsonContent({
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  classroom: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' } } },
                  pickupDate: { type: 'string', example: '2026-11-27' },
                  summary: {
                    type: 'object',
                    properties: {
                      totalStudents: { type: 'integer', example: 22 },
                      presentCount: { type: 'integer', example: 20 },
                      departedCount: { type: 'integer', example: 5 },
                      waitingCount: { type: 'integer', example: 15 }
                    }
                  },
                  roster: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        studentId: { type: 'string' },
                        studentCode: { type: 'string', example: '15' },
                        fullName: { type: 'string', example: 'Nguyễn Bảo Ngọc' },
                        attendanceStatus: { type: 'string', enum: ['present', 'late', 'absent', 'absent_permission', 'unmarked'] },
                        isPresentToday: { type: 'boolean', example: true },
                        departed: { type: 'boolean', example: false },
                        confirmedPickupId: { type: 'string', nullable: true },
                        pickerOptions: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              key: { type: 'string' },
                              pickerId: { type: 'string' },
                              fullName: { type: 'string', example: 'Lê Thị Mai' },
                              phone: { type: 'string', example: '0944555666' },
                              relationship: { type: 'string', example: 'Mẹ' }
                            }
                          }
                        }
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
  '/api/pickups/direct-handover': {
    post: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[teacher, guard, admin, principal] Xác nhận Trả trẻ 1 chạm trực tiếp tại lớp (không cần Phụ huynh đặt lịch trước)',
      description:
        'Thực thi nguyên tử trong 1 MongoDB Transaction:\n' +
        '1. Tạo/xác nhận `PickupRecord` (`status: "confirmed"`).\n' +
        '2. Ghi sự kiện rời cổng `StudentGateEvent` (`direction: "departure"`).\n' +
        '3. Cập nhật `checkOutTime` & `pickerName` trên `StudentAttendance` hôm nay.\n' +
        '4. Gửi thông báo (`Notification`) tới tất cả tài khoản Phụ huynh đã liên kết với bé.',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['studentId'],
          properties: {
            studentId: { type: 'string', example: '674580a1b2c3d4e5f6000301' },
            pickupDate: { type: 'string', format: 'date', example: '2026-11-27' },
            pickerKey: { type: 'string', description: 'Key từ pickerOptions trong class-roster' },
            pickerId: { type: 'string', description: 'ObjectId của authorizedPicker (nếu có)' },
            pickerFullName: { type: 'string', example: 'Lê Thị Mai' },
            pickerPhone: { type: 'string', example: '0944555666' },
            pickerRelationship: { type: 'string', example: 'Mẹ' },
            note: { type: 'string', example: 'Mẹ đón trực tiếp tại cửa lớp' }
          }
        })
      },
      responses: {
        201: {
          description: 'Đã bàn giao trẻ thành công',
          content: jsonContent({ type: 'object', properties: { success: { type: 'boolean', example: true }, message: { type: 'string' }, data: { $ref: '#/components/schemas/DB_PickupRecord' } } })
        },
        409: { description: 'Học sinh đã được bàn giao trong ngày hôm nay', content: jsonContent({ $ref: '#/components/schemas/ApiErrorResponse' }) }
      }
    }
  },
  '/api/pickups/{id}/undo-handover': {
    post: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[teacher, guard, admin, principal] Hoàn tác trả trẻ nhầm trong ngày hôm nay (để chọn lại đúng bé / đúng người đón)',
      parameters: [idParam('id', 'ID của PickupRecord vừa xác nhận')],
      requestBody: {
        required: false,
        content: jsonContent({
          type: 'object',
          properties: {
            reason: { type: 'string', example: 'Cô giáo bấm nhầm dòng học sinh' }
          }
        })
      },
      responses: {
        200: { description: 'Đã hoàn tác trạng thái đón về Chờ đón', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) }
      }
    }
  },
  '/api/pickups': {
    get: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[parent, teacher, guard, admin, principal] Nhật ký bàn giao & lịch hẹn đón trẻ theo ngày',
      parameters: [
        { name: 'pickupDate', in: 'query', schema: { type: 'string', example: '2026-11-27' } },
        { name: 'classroomId', in: 'query', schema: { type: 'string' } },
        { name: 'studentId', in: 'query', schema: { type: 'string' } }
      ],
      responses: {
        200: { description: 'Danh sách bản ghi PickupRecord', content: jsonContent({ type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: { $ref: '#/components/schemas/DB_PickupRecord' } } } }) }
      }
    },
    post: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[parent] Phụ huynh báo trước người đón & sinh mã vé QR bàn giao trong ngày',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['studentId', 'pickerId'],
          properties: {
            studentId: { type: 'string' },
            pickerId: { type: 'string' },
            pickupDate: { type: 'string', example: '2026-11-27' },
            expectedPickupTime: { type: 'string', example: '17:00' },
            note: { type: 'string', example: 'Hôm nay Ông ngoại đón bé sớm' }
          }
        })
      },
      responses: { 201: { description: 'Đã tạo lịch hẹn đón kèm mã QR', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  },
  '/api/guard/pickup-otp': {
    post: {
      tags: ['07. Đón trả trẻ 1 chạm & Trực cổng (Pickups & Guard)'],
      summary: '[guard, admin] Gửi mã OTP 6 số tới Phụ huynh khi có người lạ / người đón thay 1 lần tại cổng trường',
      requestBody: {
        required: true,
        content: jsonContent({
          type: 'object',
          required: ['studentId', 'fullName', 'phone'],
          properties: {
            studentId: { type: 'string' },
            fullName: { type: 'string', example: 'Phạm Văn Chú' },
            phone: { type: 'string', example: '0988112233' },
            relationship: { type: 'string', example: 'Chú ruột' },
            identityCardLast4: { type: 'string', example: '6789' },
            vehiclePlate: { type: 'string', example: '29A-123.45' }
          }
        })
      },
      responses: { 201: { description: 'Đã phát hành OTP 10 phút tới thông báo của Phụ huynh', content: jsonContent({ $ref: '#/components/schemas/ApiSuccessAny' }) } }
    }
  }
};

module.exports = {
  jsonContent,
  standardErrorResponses,
  idParam,
  swaggerPathsPart1
};

