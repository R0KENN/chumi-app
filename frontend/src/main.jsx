import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';

// ── Локальный мок Telegram (только на localhost) ──
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  const wa = window.Telegram && window.Telegram.WebApp;
  const hasUser = wa && wa.initDataUnsafe && wa.initDataUnsafe.user && wa.initDataUnsafe.user.id;
  if (!hasUser) {
    const noop = () => {};
    const realMethods = {
      initData: '',
      initDataUnsafe: { user: { id: 713156118, first_name: 'Test', language_code: 'ru' } },
      platform: 'web',
      isFullscreen: false,
      version: '6.0',
      colorScheme: 'light',
      themeParams: {},
      isVersionAtLeast: () => false,
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      MainButton: { hide: noop, show: noop, setText: noop, onClick: noop },
      SecondaryButton: { hide: noop, show: noop, setText: noop, onClick: noop },
      BackButton: { hide: noop, show: noop, onClick: noop },
      showAlert: (m) => alert(m),
      showConfirm: noop,
      CloudStorage: null,
      DeviceStorage: null,
    };
    // Proxy: любой НЕ определённый выше метод возвращает пустую функцию,
    // чтобы приложение не падало на вызове несуществующего метода SDK.
    const mock = new Proxy(realMethods, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return noop;
      },
    });
    window.Telegram = window.Telegram || {};
    window.Telegram.WebApp = mock;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
