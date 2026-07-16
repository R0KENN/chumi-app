import React, { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { LangProvider } from './context/LangContext';
import { PairsProvider, usePairs } from './context/PairsContext';

import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import JumpGame from './components/JumpGame';

import './App.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
          }}
        >
          😿
        </div>

        <h2 style={{ color: '#e53e3e' }}>
          Приложение завершилось с ошибкой
        </h2>

        <pre
          style={{
            maxWidth: 360,
            margin: '16px auto',
            padding: 12,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'left',
            fontSize: 12,
            color: '#666',
            background: '#f5f5f5',
            borderRadius: 8,
          }}
        >
          {this.state.error?.toString()}
        </pre>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            background: '#9B72CF',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      </div>
    );
  }
}

function FullScreenMessage({
  icon,
  title,
  children,
  showReload = false,
}) {
  return (
    <div
      style={{
        maxWidth: 380,
        margin: '0 auto',
        padding: '48px 28px',
        textAlign: 'center',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          marginBottom: 16,
          fontSize: 56,
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          margin: '0 0 12px',
          color: '#2d2438',
        }}
      >
        {title}
      </h3>

      <div
        style={{
          marginBottom: showReload ? 20 : 0,
          color: '#666',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>

      {showReload && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            background: '#9B72CF',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      )}
    </div>
  );
}

function AppContent() {
  const { pairs, loading } = usePairs();

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading || !pairs || pairs.length === 0) {
      return;
    }

    const params = new URLSearchParams(location.search);

    if (params.get('newpair')) {
      return;
    }

    if (location.pathname === '/' || location.pathname === '') {
      navigate(`/pair/${pairs[0].code}`, {
        replace: true,
      });
    }
  }, [
    pairs,
    loading,
    navigate,
    location.pathname,
    location.search,
  ]);

  return (
    <Routes>
      <Route path="/" element={<PairSelector />} />
      <Route path="/pair/:pairId" element={<PairScreen />} />
      <Route path="/game/:pairId" element={<JumpGame />} />
      <Route path="*" element={<PairSelector />} />
    </Routes>
  );
}

function App() {
  const [telegramStatus, setTelegramStatus] = useState('loading');
  const [telegramUserId, setTelegramUserId] = useState(null);
  const [initData, setInitData] = useState('');

  useEffect(() => {
    let cancelled = false;
    let tgForCleanup = null;
    let updateTelegramInsets = null;
    let handleFullscreenFailed = null;

    (async () => {
      // Если SDK ещё не загрузился и не упал — ждём до 3 секунд
      // (нужно при медленном/проксированном соединении в Telegram)
      const start = Date.now();

      while (
        !window.Telegram?.WebApp &&
        !window.__tgSdkFailed &&
        Date.now() - start < 3000
      ) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (cancelled) return;

      try {
        const tg = window.Telegram?.WebApp;

        if (tg) {
          tgForCleanup = tg;

          tg.ready();
          tg.expand();

          if (tg.initData) {
            setInitData(tg.initData);
          }

          /*
           * Telegram имеет два разных типа safe area:
           *
           * safeAreaInset — системная безопасная зона устройства;
           * contentSafeAreaInset — зона, свободная от элементов Telegram.
           *
           * Для верхней панели приложения и HUD игры важнее именно
           * contentSafeAreaInset.
           */
          updateTelegramInsets = () => {
            const safeTop =
              Number(tg.safeAreaInset?.top) || 0;

            const contentSafeTop =
              Number(tg.contentSafeAreaInset?.top) || 0;

            const safeBottom =
              Number(tg.safeAreaInset?.bottom) || 0;

            const contentSafeBottom =
              Number(tg.contentSafeAreaInset?.bottom) || 0;

            const topInset = Math.max(
              safeTop,
              contentSafeTop,
            );

            const bottomInset = Math.max(
              safeBottom,
              contentSafeBottom,
            );

            document.documentElement.style.setProperty(
              '--chumi-safe-top',
              `${topInset}px`,
            );

            document.documentElement.style.setProperty(
              '--chumi-safe-bottom',
              `${bottomInset}px`,
            );

            /*
             * Эта переменная уже используется основным экраном приложения.
             * Оставляем минимум 16px для браузера и десктопного Telegram.
             */
            document.documentElement.style.setProperty(
              '--chumi-top-pad',
              `${Math.max(16, topInset)}px`,
            );
          };

          handleFullscreenFailed = error => {
            console.warn(
              'Telegram fullscreen request failed:',
              error,
            );

            updateTelegramInsets?.();
          };

          updateTelegramInsets();

          tg.onEvent?.(
            'safeAreaChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'contentSafeAreaChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'fullscreenChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'viewportChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'fullscreenFailed',
            handleFullscreenFailed,
          );

          const isMobile =
            /iPhone|iPad|iPod|Android/i.test(
              navigator.userAgent,
            );

          if (
            isMobile &&
            tg.isVersionAtLeast?.('8.0') &&
            !tg.isFullscreen
          ) {
            try {
              tg.requestFullscreen();
            } catch (error) {
              handleFullscreenFailed(error);
            }
          }

          if (tg.disableVerticalSwipes) {
            tg.disableVerticalSwipes();
          }

          try {
            tg.setHeaderColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram header color failed:',
              error,
            );
          }

          try {
            tg.setBackgroundColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram background color failed:',
              error,
            );
          }

          try {
            tg.setBottomBarColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram bottom bar color failed:',
              error,
            );
          }

          const uid =
            tg.initDataUnsafe?.user?.id?.toString();

          if (uid) {
            setTelegramUserId(uid);
            return;
          }
        }
      } catch (error) {
        console.error('TG init error:', error);
      }

      /*
       * Если SDK именно упал, гостевой доступ не выдаём.
       * Ниже отобразится экран с инструкцией про прокси.
       */
      if (window.__tgSdkFailed) {
        return;
      }

      /*
       * Fallback для локальной разработки вне Telegram.
       */
      try {
        const testId =
          localStorage.getItem('chumi_test_uid') ||
          'guest';

        localStorage.setItem(
          'chumi_test_uid',
          testId,
        );

        setTelegramUserId(testId);
      } catch {
        setTelegramUserId('guest');
      }
    })();

    return () => {
      cancelled = true;

      if (tgForCleanup && updateTelegramInsets) {
        tgForCleanup.offEvent?.(
          'safeAreaChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'contentSafeAreaChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'fullscreenChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'viewportChanged',
          updateTelegramInsets,
        );
      }

      if (
        tgForCleanup &&
        handleFullscreenFailed
      ) {
        tgForCleanup.offEvent?.(
          'fullscreenFailed',
          handleFullscreenFailed,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (
      telegramStatus !== 'ready' ||
      !telegramUserId
    ) {
      return;
    }

    let cancelled = false;

    const updateTimezone = async () => {
      try {
        const timezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!timezone) {
          return;
        }

        const lastSentRaw =
          localStorage.getItem('chumi_tz_sent_at');

        const lastTimezone =
          localStorage.getItem('chumi_tz_value');

        const lastSent = Number(lastSentRaw);
        const now = Date.now();

        const wasRecentlySent =
          lastTimezone === timezone &&
          Number.isFinite(lastSent) &&
          now - lastSent < 86_400_000;

        if (wasRecentlySent) {
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
          console.warn(
            'Timezone update failed:',
            response.status,
          );

          return;
        }

        if (cancelled) {
          return;
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
        console.warn('Timezone update error:', error);
      }
    };

    updateTimezone();

    return () => {
      cancelled = true;
    };
  }, [
    telegramStatus,
    telegramUserId,
    initData,
  ]);

  if (telegramStatus === 'loading') {
    const showDiag =
      new URLSearchParams(window.location.search)
        .get('diag') === '1';

    if (showDiag) {
      const tg = window.Telegram?.WebApp;

      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'monospace',
            fontSize: 13,
            color: '#333',
            wordBreak: 'break-word',
          }}
        >
          <div>DIAG: Telegram initialization</div>
          <div>Status: {telegramStatus}</div>
          <div>WebApp exists: {String(Boolean(tg))}</div>
          <div>User ID: {String(tg?.initDataUnsafe?.user?.id)}</div>
          <div>initData length: {String((tg?.initData || '').length)}</div>
          <div>Platform: {String(tg?.platform)}</div>
          <div>Version: {String(tg?.version)}</div>
          <div>SDK failed: {String(Boolean(window.__tgSdkFailed))}</div>
        </div>
      );
    }

    return (
      <div className="sk-loading">
        <div className="sk-spinner" />
      </div>
    );
  }

  if (
    telegramStatus === 'sdk-error' ||
    telegramStatus === 'local-error'
  ) {
    return (
      <FullScreenMessage
        icon="🌐"
        title="Не удалось загрузить Telegram"
        showReload
      >
        Не удалось инициализировать Telegram Mini App.
        Проверь интернет или прокси Telegram, после чего
        перезагрузи приложение.
      </FullScreenMessage>
    );
  }

  if (telegramStatus === 'outside-telegram') {
    return (
      <FullScreenMessage
        icon="🐾"
        title="Открой Chumi в Telegram"
      >
        Это приложение использует авторизацию Telegram.
        Открой Chumi через кнопку меню или сообщение бота.
      </FullScreenMessage>
    );
  }

  return (
    <ErrorBoundary>
      <LangProvider>
        <PairsProvider
          telegramUserId={telegramUserId}
          initData={initData}
        >
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </PairsProvider>
      </LangProvider>
    </ErrorBoundary>
  );
}

export default App;
