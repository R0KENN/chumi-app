import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { PairsProvider, usePairs } from './context/PairsContext';
import { LangProvider } from './context/LangContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import './App.css';
import JumpGame from './components/JumpGame';

// ── Error Boundary для отлова crash'ей ──
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😿</div>
          <h2 style={{ color: '#e53e3e' }}>App crashed</h2>
          <pre style={{ fontSize: 12, color: '#666', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: 360, margin: '16px auto', textAlign: 'left', background: '#f5f5f5', padding: 12, borderRadius: 8 }}>
            {this.state.error?.toString()}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#9B72CF', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && pairs && pairs.length > 0) {
      const params = new URLSearchParams(location.search);
      if (params.get('newpair')) return;
      if (location.pathname === '/' || location.pathname === '') {
        navigate(`/pair/${pairs[0].code}`);
      }
    }
  }, [pairs, loading, navigate, location.pathname, location.search]);

  return (
    <Routes>
      <Route path="/" element={<PairSelector />} />
      <Route path="/pair/:pairId" element={<PairScreen />} />
      <Route path="/game/:pairId" element={<JumpGame />} />
    </Routes>
  );
}

function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);
  const [initData, setInitData] = useState('');
  const [telegramSdkFailed, setTelegramSdkFailed] = useState(false);
  const [telegramError, setTelegramError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms) => new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

    const initializeTelegram = async () => {
      const startedAt = Date.now();
      const timeoutMs = 10000;

      while (
        !cancelled &&
        !window.Telegram?.WebApp &&
        !window.__tgSdkFailed &&
        Date.now() - startedAt < timeoutMs
      ) {
        await sleep(100);
      }

      if (cancelled) return;

  if (telegramSdkFailed) {
        setTelegramSdkFailed(true);
        return;
      }

      const tg = window.Telegram?.WebApp;

      if (!tg) {
        setTelegramSdkFailed(true);
        return;
      }

      try {
        tg.ready?.();
        tg.expand?.();

        if (tg.initData) {
          setInitData(tg.initData);
        }

        const isMobileUserAgent =
          /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (
          isMobileUserAgent &&
          tg.isVersionAtLeast?.('8.0') &&
          !tg.isFullscreen
        ) {
          try {
            tg.requestFullscreen?.();
          } catch {
            // Fullscreen может быть запрещён конкретным клиентом Telegram.
          }
        }

        try {
          tg.disableVerticalSwipes?.();
        } catch {
          // Метод может отсутствовать в старом клиенте Telegram.
        }

        try {
          const isMobilePlatform =
            tg.platform === 'ios' ||
            tg.platform === 'android';

          document.documentElement.style.setProperty(
            '--chumi-top-pad',
            isMobilePlatform ? '96px' : '16px',
          );
        } catch {
          // CSS-переменная не критична для запуска приложения.
        }

        try {
          tg.setHeaderColor?.('#FFF8E1');
        } catch {
          // Клиент может не поддерживать произвольный цвет.
        }

        try {
          tg.setBackgroundColor?.('#FFF8E1');
        } catch {
          // Клиент может не поддерживать произвольный цвет.
        }

        try {
          tg.setBottomBarColor?.('#FFF8E1');
        } catch {
          // Клиент может не поддерживать Bottom Bar API.
        }

        const userId =
          tg.initDataUnsafe?.user?.id?.toString();

        if (userId) {
          setTelegramUserId(userId);
          return;
        }
      } catch (error) {
        console.error('Telegram initialization error:', error);
      }

      /*
       * Telegram SDK загрузился, но реального пользователя нет.
       * Это обычный браузер или локальная разработка.
       */
      try {
        const testId =
          localStorage.getItem('chumi_test_uid') ||
          'guest';

        localStorage.setItem('chumi_test_uid', testId);
        setTelegramUserId(testId);
      } catch {
        setTelegramUserId('guest');
      }
    };

    initializeTelegram();

    return () => {
      cancelled = true;
    };
  }, []);

  if (telegramError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          padding: '40px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: 'sans-serif',
          background: '#FFF8E1',
          color: '#2D2D2D',
        }}
      >
        <div
          style={{
            fontSize: 56,
            marginBottom: 16,
          }}
        >
          😿
        </div>

        <h3
          style={{
            margin: '0 0 12px',
            fontSize: 20,
          }}
        >
          Не удалось запустить Chumi
        </h3>

        <p
          style={{
            maxWidth: 360,
            margin: '0 0 20px',
            color: '#666',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {telegramError}
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            marginBottom: 12,
            border: 'none',
            borderRadius: 12,
            background: '#9B72CF',
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>

        <a
          href="https://t.me/ChumiPetBot?startapp"
          style={{
            color: '#7952A8',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Открыть через @ChumiPetBot
        </a>
      </div>
    );
  }

  useEffect(() => {
    if (!telegramUserId) return;

    const updateTimezone = async () => {
      try {
        const timezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!timezone) return;

        const lastSentRaw =
          localStorage.getItem('chumi_tz_sent_at');

        const lastTimezone =
          localStorage.getItem('chumi_tz_value');

        const lastSent = Number(lastSentRaw);
        const now = Date.now();

        const wasSentRecently =
          Number.isFinite(lastSent) &&
          now - lastSent < 24 * 60 * 60 * 1000;

        if (
          lastTimezone === timezone &&
          wasSentRecently
        ) {
          return;
        }

        const headers = {
          'Content-Type': 'application/json',
        };

        if (initData) {
          headers['X-Telegram-Init-Data'] = initData;
        }

        const response = await fetch('/api/update-timezone', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId: telegramUserId,
            timezone,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Timezone update failed with HTTP ${response.status}`,
          );
        }

        localStorage.setItem(
          'chumi_tz_sent_at',
          String(now),
        );

        localStorage.setItem(
          'chumi_tz_value',
          timezone,
        );
      } catch (error) {
        console.warn('Timezone update failed:', error);
      }
    };

    updateTimezone();
  }, [telegramUserId, initData]);


    // ── Гостевой режим: приложение открыто вне Telegram ──
  // SDK не упал (иначе сработал бы __tgSdkFailed выше), но настоящего
  // Telegram-пользователя нет → API вернёт 401 на всё. Показываем заглушку
  // вместо неработающего UI.
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  const telegramWebApp = window.Telegram?.WebApp;

  const isRealTgUser =
    Boolean(telegramWebApp?.initDataUnsafe?.user?.id) &&
    Boolean(telegramWebApp?.initData);

  const canOpenApplication =
    isLocalhost || isRealTgUser;
  if (!canOpenApplication) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif', maxWidth: 360, margin: '0 auto' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🐾</div>
        <h3 style={{ marginBottom: 12 }}>Открой Chumi в Telegram</h3>
        <p style={{ color: '#666', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
          Это мини-приложение работает только внутри Telegram.
          Найди бота и запусти его оттуда.
        </p>
        <a
          href="https://t.me/ChumiPetBot?startapp"
          style={{
            display: 'inline-block', padding: '12px 24px', borderRadius: 12,
            background: '#9B72CF', color: '#fff', fontSize: 15,
            textDecoration: 'none', fontWeight: 600,
          }}
        >
          Открыть @ChumiPetBot
        </a>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <LangProvider>
          <PairsProvider telegramUserId={telegramUserId} initData={initData}>
            <AppContent />
          </PairsProvider>
        </LangProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
