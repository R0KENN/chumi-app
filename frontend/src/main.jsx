import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';

const isLocalhost =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1';

// Локальный Telegram mock.
// В production этот блок никогда не выполняется.
if (isLocalhost) {
  const existingWebApp = window.Telegram?.WebApp;
  const existingUserId = existingWebApp?.initDataUnsafe?.user?.id;

  if (!existingUserId) {
    const noop = () => {};

    const mockWebApp = {
      initData: '',

      initDataUnsafe: {
        user: {
          id: 999000001,
          first_name: 'Local',
          last_name: 'Tester',
          username: 'local_tester',
          language_code: 'ru',
        },
      },

      platform: 'web',
      version: '9.0',
      colorScheme: 'light',
      themeParams: {},
      isFullscreen: false,

      ready: noop,
      expand: noop,
      close: noop,
      disableVerticalSwipes: noop,
      enableVerticalSwipes: noop,

      isVersionAtLeast: () => false,

      requestFullscreen: noop,
      exitFullscreen: noop,

      setHeaderColor: noop,
      setBackgroundColor: noop,
      setBottomBarColor: noop,

      onEvent: noop,
      offEvent: noop,

      openInvoice: noop,
      openLink: noop,
      openTelegramLink: noop,

      showAlert: message => window.alert(message),
      showConfirm: noop,

      HapticFeedback: {
        impactOccurred: noop,
        notificationOccurred: noop,
        selectionChanged: noop,
      },

      MainButton: {
        hide: noop,
        show: noop,
        setText: noop,
        onClick: noop,
        offClick: noop,
      },

      SecondaryButton: {
        hide: noop,
        show: noop,
        setText: noop,
        onClick: noop,
        offClick: noop,
      },

      BackButton: {
        hide: noop,
        show: noop,
        onClick: noop,
        offClick: noop,
      },

      CloudStorage: null,
      DeviceStorage: null,
      SecureStorage: null,
    };

    window.Telegram = window.Telegram || {};
    window.Telegram.WebApp = mockWebApp;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

ReactDOM.createRoot(rootElement).render(<App />);
