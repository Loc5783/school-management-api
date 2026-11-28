import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/motion.css';
import App from './App.jsx';
import AppErrorBoundary from './components/ErrorBoundary.jsx';
import { installGlobalActionProgressGuard } from './utils/actionProgressGuard.js';

installGlobalActionProgressGuard();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
