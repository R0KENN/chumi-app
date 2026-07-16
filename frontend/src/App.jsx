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

    const initializeTelegram = async () => {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      /*
       * Обычно локальный SDK уже загружен синхронно из index.html.
       * Небольшое ожидание оставляем для старых WebView и кеша Telegram.
       */
      const startedAt = Date.now();

      while (
        !window.Telegram?.WebApp &&
        !window.__tgSdkFailed &&
        Date.now() - startedAt < 5000
      ) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, 100);
        });
      }

      if (cancelled) {
        return;
      }

      if (window.__tgSdkFailed) {
        setTelegramStatus('sdk-error');
        return;
      }

      const tg = window.Telegram?.WebApp;

      if (!tg) {
        setTelegramStatus(isLocal ? 'local-error' : 'sdk-error');
        return;
      }

      try {
        tg.ready?.();
        tg.expand?.();

        try {
          tg.setHeaderColor?.('#FFF8E1');
        } catch (error) {
          console.warn('Telegram setHeaderColor failed:', error);
        }

        try {
          tg.setBackgroundColor?.('#FFF8E1');
        } catch (error) {
          console.warn('Telegram setBackgroundColor failed:', error);
        }

        try {
          tg.setBottomBarColor?.('#FFF8E1');
        } catch (error) {
          console.warn('Telegram setBottomBarColor failed:', error);
        }

        const rawInitData =
          typeof tg.initData === 'string'
            ? tg.initData
            : '';

        const rawUserId =
          tg.initDataUnsafe?.user?.id;

        /*
         * В production нужен одновременно пользователь и подписанный initData.
         * На localhost main.jsx создаёт тестового пользователя без initData.
         */
        if (rawUserId && (rawInitData || isLocal)) {
          setInitData(rawInitData);
          setTelegramUserId(String(rawUserId));
          setTelegramStatus('ready');
          return;
        }

        setTelegramStatus('outside-telegram');
      } catch (error) {
        console.error('Telegram initialization failed:', error);

        setTelegramStatus('sdk-error');
      }
    };

    initializeTelegram();

    return () => {
      cancelled = true;
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
