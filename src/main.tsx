import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import AppErrorBoundary from '@/components/AppErrorBoundary';
import './index.css';
import { preventPullToRefresh } from '@/lib/preventPullToRefresh';

preventPullToRefresh();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
