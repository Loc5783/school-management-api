import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AppShell from './components/AppShell';
import api from './api/axiosConfig';

// Parse query parameters
const params = new URLSearchParams(window.location.search);
const currentRole = params.get('role') || 'teacher';
const unreadChatTotal = parseInt(params.get('badge') || '5', 10);
const isMobileParam = params.get('mobile') === '1';

const defaultRoutes = {
  teacher: '/attendance',
  principal: '/principal',
  accountant: '/accounting',
  guard: '/guard',
};

const targetPath = params.get('path') || defaultRoutes[currentRole] || '/attendance';

// Set window location pathname to match active route before router starts
if (window.location.pathname !== targetPath) {
  window.history.replaceState(null, '', `${targetPath}${window.location.search}`);
}

const mockProfiles = {
  teacher: {
    _id: 'usr-teacher-1',
    username: 'gv_lan',
    role: 'teacher',
    status: 'active',
    profile: { fullName: 'Cô Nguyễn Thị Lan', phone: '0912345678' },
    permissions: [],
  },
  principal: {
    _id: 'usr-principal-1',
    username: 'ht_an',
    role: 'principal',
    status: 'active',
    profile: { fullName: 'Thầy Trần Văn An', phone: '0987654321' },
    permissions: [],
  },
  accountant: {
    _id: 'usr-accountant-1',
    username: 'kt_binh',
    role: 'accountant',
    status: 'active',
    profile: { fullName: 'Cô Lê Thị Bình', phone: '0901122334' },
    permissions: [],
  },
  guard: {
    _id: 'usr-guard-1',
    username: 'bv_hoang',
    role: 'guard',
    status: 'active',
    profile: { fullName: 'Chú Phạm Văn Hoàng', phone: '0933445566' },
    permissions: [],
  },
};

const activeUser = mockProfiles[currentRole] || mockProfiles.teacher;

// Mock Axios GET endpoints called by AppShell
const originalGet = api.get;
api.get = async (url, config) => {
  if (url === '/auth/me') {
    return { data: activeUser };
  }
  if (url === '/chat/unread') {
    return {
      data: {
        total: unreadChatTotal,
        data: [
          {
            conversationId: 'c1',
            count: 3,
            senderName: 'Phụ huynh bé Bo',
            studentName: 'Nguyễn Văn Bo',
          },
          {
            conversationId: 'c2',
            count: 2,
            senderName: 'Phụ huynh bé Na',
            studentName: 'Lê Thị Na',
          },
        ],
      },
    };
  }
  if (url === '/notifications/unread-count') {
    return { data: { unread: 2 } };
  }
  if (url === '/notifications') {
    return {
      data: [
        {
          _id: 'n1',
          title: 'Họp hội đồng giáo viên',
          message: 'Họp vào lúc 16:30 thứ 6',
          isRead: false,
          metadata: { priority: 'high' },
        },
      ],
    };
  }
  return originalGet.call(api, url, config);
};

export default function HarnessApp() {
  useEffect(() => {
    if (isMobileParam) {
      const timer = setTimeout(() => {
        const toggleBtn = document.querySelector('.mobile-nav-toggle, button[aria-label="Mở menu"]');
        if (toggleBtn) toggleBtn.click();
      }, 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  return (
    <BrowserRouter>
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 99999, display: 'flex', gap: 6, background: 'rgba(0,0,0,0.7)', padding: '6px 10px', borderRadius: 8 }}>
        <span style={{ color: '#94a3b8', fontSize: 12, lineHeight: '24px', fontWeight: 600 }}>Chuyển vai trò:</span>
        {['teacher', 'principal', 'accountant', 'guard'].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              window.location.href = `/integration_test.html?role=${r}`;
            }}
            style={{
              padding: '3px 8px',
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 6,
              border: 0,
              cursor: 'pointer',
              background: currentRole === r ? '#2563eb' : '#334155',
              color: '#ffffff',
            }}
          >
            {r}
          </button>
        ))}
      </div>

      <AppShell
        title={`Giao diện ${currentRole.toUpperCase()}`}
        subtitle="Môi trường kiểm thử tích hợp component AppShell thực tế với mock data"
      >
        <div style={{ padding: 24 }}>
          <h2 style={{ color: '#1e3a8a', marginBottom: 12 }}>
            Kiểm thử tích hợp Component AppShell thật: Vai trò {currentRole}
          </h2>
          <p style={{ color: '#475569', lineHeight: 1.6 }}>
            Đang hiển thị component <code>frontend/src/components/AppShell.jsx</code> thực tế với đường dẫn đang chọn:{' '}
            <strong>{targetPath}</strong>.
          </p>
        </div>
      </AppShell>
    </BrowserRouter>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<HarnessApp />);
}
