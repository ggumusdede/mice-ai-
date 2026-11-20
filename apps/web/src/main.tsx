import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n';
import { OfflineQueueProvider } from './lib/OfflineQueueProvider';
import { ToastProvider } from './components/Toast';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider lang="tr">
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <OfflineQueueProvider>
              <App />
            </OfflineQueueProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);

// PWA: installable on iPhone home screen; offline app shell (§18.16). Dev uses Vite HMR, so register only in prod.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        window.addEventListener('online', () => reg.active?.postMessage('flush-queue'));
      })
      .catch(() => undefined);
  });
}
