import { Component } from 'react';

/**
 * Khung bắt ngoại lệ giao diện (ErrorBoundary) toàn cục & cấp từng trang.
 *
 * Mục đích:
 * - Ngăn chặn hoàn toàn lỗi trắng trang (White Screen of Death) nếu dữ liệu bất thường làm lỗi render.
 * - Khi gắn `inline` bên trong `AppShell`, thanh điều hướng trái (Sidebar) và thanh trên (Topbar) vẫn hoạt động bình thường
 *   để người dùng chuyển sang trang khác hoặc bấm tải lại ngay lập tức.
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Đã xảy ra sự cố hiển thị không mong muốn.'
    };
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[AppErrorBoundary] Đã bắt ngoại lệ giao diện:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  handleReloadPage = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.assign('/dashboard');
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isInline = Boolean(this.props.inline);

    return (
      <div
        style={{
          minHeight: isInline ? '52vh' : '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: isInline ? 'transparent' : '#f4f7fe'
        }}
      >
        <div
          style={{
            maxWidth: '520px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            padding: '28px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
            textAlign: 'center'
          }}
        >
          <div
            style={{
              width: '52px',
              height: '52px',
              margin: '0 auto 14px',
              borderRadius: '14px',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 700
            }}
          >
            !
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            Màn hình gặp sự cố hiển thị tạm thời
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: '14px', lineHeight: 1.6, color: '#475569' }}>
            Dữ liệu của bạn vẫn an toàn. Vui lòng bấm <strong>Thử lại</strong> hoặc chuyển sang mục khác trên thanh menu.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="button button-primary" onClick={this.handleRetry}>
              Thử lại ngay
            </button>
            <button type="button" className="button button-secondary" onClick={this.handleReloadPage}>
              Tải lại trang
            </button>
            <button type="button" className="button button-secondary" onClick={this.handleGoHome}>
              Về trang chủ
            </button>
          </div>
        </div>
      </div>
    );
  }
}

