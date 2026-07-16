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
  const [telegramError, setTelegramError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const wait = milliseconds =>
      new Promise(resolve => {
        window.setTimeout(resolve, milliseconds);
      });

    const initializeTelegram = async () => {
      setTelegramError('');

      /*
       * После исправления index.html SDK должен существовать до запуска React.
       * Небольшое ожидание оставлено как страховка для старых Telegram-клиентов.
       */
      const startedAt = Date.now();

      while (!window.Telegram?.WebApp && Date.now() - startedAt < 5000) {
        await wait(100);
      }

      if (cancelled) return;

      const tg = window.Telegram?.WebApp;

      if (!tg) {
        console.error('Telegram WebApp SDK is not available');

        setTelegramError(
          'Не удалось загрузить Telegram Mini App SDK. Закрой приложение и открой его повторно.'
        );

        return;
      }

      try {
        tg.ready?.();
        tg.expand?.();
      } catch (error) {
        console.error('Telegram ready/expand failed:', error);
      }

      try {
        const isMobileDevice =
          /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        if (
          isMobileDevice &&
          tg.isVersionAtLeast?.('8.0') &&
          !tg.isFullscreen
        ) {
          try {
            tg.requestFullscreen?.();
          } catch (error) {
            console.warn('Telegram fullscreen request failed:', error);
          }
        }
      } catch (error) {
        console.warn('Telegram fullscreen initialization failed:', error);
      }

      try {
        tg.disableVerticalSwipes?.();
      } catch (error) {
        console.warn('disableVerticalSwipes failed:', error);
      }

      try {
        const platform = tg.platform || '';

        const isMobilePlatform =
          platform === 'ios' ||
          platform === 'android';

        const topPadding = isMobilePlatform ? '96px' : '16px';

        document.documentElement.style.setProperty(
          '--chumi-top-pad',
          topPadding
        );
      } catch (error) {
        console.warn('Unable to set Telegram top padding:', error);
      }

      try {
        tg.setHeaderColor?.('#FFF8E1');
      } catch (error) {
        console.warn('setHeaderColor failed:', error);
      }

      try {
        tg.setBackgroundColor?.('#FFF8E1');
      } catch (error) {
        console.warn('setBackgroundColor failed:', error);
      }

      try {
        tg.setBottomBarColor?.('#FFF8E1');
      } catch (error) {
        console.warn('setBottomBarColor failed:', error);
      }

      const rawInitData =
        typeof tg.initData === 'string'
          ? tg.initData
          : '';

      const telegramUser = tg.initDataUnsafe?.user;
      const rawUserId = telegramUser?.id;

      /*
       * На localhost initData пустой, потому что используется локальный mock.
       * В production настоящий пользователь обязан иметь:
       * 1. user.id;
       * 2. подписанный initData.
       */
      if (isLocalhost && rawUserId) {
        if (cancelled) return;

        setInitData('');
        setTelegramUserId(String(rawUserId));
        return;
      }

      if (!rawUserId) {
        console.error('Telegram did not provide user.id', {
          platform: tg.platform,
          version: tg.version,
          initDataLength: rawInitData.length,
          hashPresent: Boolean(window.location.hash),
        });

        setTelegramError(
          'Telegram не передал данные пользователя. Запусти Chumi через кнопку бота.'
        );

        return;
      }

      if (!rawInitData) {
        console.error('Telegram did not provide signed initData', {
          userId: String(rawUserId),
          platform: tg.platform,
          version: tg.version,
          hashPresent: Boolean(window.location.hash),
        });

        setTelegramError(
          'Telegram не передал данные авторизации. Закрой Chumi, обнови Telegram и запусти приложение снова через бота.'
        );

        return;
      }

      if (cancelled) return;

      setInitData(rawInitData);
      setTelegramUserId(String(rawUserId));
    };

    initializeTelegram().catch(error => {
      console.error('Telegram initialization failed:', error);

      if (!cancelled) {
        setTelegramError(
          'Произошла ошибка при запуске Telegram Mini App. Попробуй открыть приложение повторно.'
        );
      }
    });

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
    if (!telegramUserId) return undefined;

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    const controller = new AbortController();

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

        const sentRecently =
          lastTimezone === timezone &&
          Number.isFinite(lastSent) &&
          now - lastSent < 86_400_000;

        if (sentRecently) return;

        const headers = {
          'Content-Type': 'application/json',
        };

        if (initData) {
          headers['X-Telegram-Init-Data'] = initData;
        }

        if (isLocalhost) {
          headers['X-Dev-User-Id'] = String(telegramUserId);
        }

        const response = await fetch('/api/update-timezone', {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            userId: telegramUserId,
            timezone,
          }),
        });

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
            data.message ||
            `Timezone update failed: HTTP ${response.status}`
          );
        }

        localStorage.setItem(
          'chumi_tz_sent_at',
          String(now)
        );

        localStorage.setItem(
          'chumi_tz_value',
          timezone
        );
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Timezone update failed:', error);
        }
      }
    };

    updateTimezone();

    return () => {
      controller.abort();
    };
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
