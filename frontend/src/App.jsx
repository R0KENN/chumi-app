import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { PairsProvider, usePairs } from './context/PairsContext';
import { LangProvider } from './context/LangContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import './App.css';

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
    </Routes>
  );
}

function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);
  const [initData, setInitData] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Если SDK ещё не загрузился и не упал — ждём до 3 секунд
      // (нужно при медленном/проксированном соединении в Telegram)
      const start = Date.now();
      while (!window.Telegram?.WebApp && !window.__tgSdkFailed && Date.now() - start < 3000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (cancelled) return;

      try {
        const tg = window.Telegram?.WebApp;
        if (tg) {
          tg.ready();
          tg.expand();

          if (tg.initData) {
            setInitData(tg.initData);
          }

          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
          if (isMobile && tg.isVersionAtLeast?.('8.0') && !tg.isFullscreen) {
            try { tg.requestFullscreen(); } catch (e) { /* ignore */ }
            tg.onEvent?.('fullscreenFailed', () => {});
          }

          if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();

          try { tg.setHeaderColor?.('#FFF8E1'); } catch (e) { /* ignore */ }
          try { tg.setBackgroundColor?.('#FFF8E1'); } catch (e) { /* ignore */ }
          try { if (tg.setBottomBarColor) tg.setBottomBarColor('#FFF8E1'); } catch (e) { /* ignore */ }

          const uid = tg.initDataUnsafe?.user?.id?.toString();
          if (uid) { setTelegramUserId(uid); return; }
        }
      } catch (e) {
        console.error('TG init error:', e);
      }

      // Fallback: SDK не загрузился (прокси заблокировал telegram.org)
      // или приложение открыто вне Telegram
      try {
        const testId = localStorage.getItem('chumi_test_uid') || '713156118';
        localStorage.setItem('chumi_test_uid', testId);
        setTelegramUserId(testId);
      } catch {
        setTelegramUserId('713156118');
      }
    })();

    return () => { cancelled = true; };
  }, []);


    // Обновляем таймзону на сервере при каждом запуске (но не чаще раза в сутки)
  useEffect(() => {
    if (!telegramUserId) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return;
      const lastSent = localStorage.getItem('chumi_tz_sent_at');
      const lastTz = localStorage.getItem('chumi_tz_value');
      const now = Date.now();
      if (lastTz === tz && lastSent && (now - parseInt(lastSent, 10)) < 86400000) return;

      const headers = { 'Content-Type': 'application/json' };
      if (initData) headers['X-Telegram-Init-Data'] = initData;
      fetch('/api/update-timezone', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: telegramUserId, timezone: tz }),
      }).then(() => {
        localStorage.setItem('chumi_tz_sent_at', String(now));
        localStorage.setItem('chumi_tz_value', tz);
      }).catch(() => {});
    } catch (e) {}
  }, [telegramUserId, initData]);

  if (!telegramUserId) return <div className="sk-loading"><div className="sk-spinner" /></div>;

    if (window.__tgSdkFailed) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif', maxWidth: 360, margin: '0 auto' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🌐</div>
        <h3 style={{ marginBottom: 12 }}>Не удалось загрузить Telegram</h3>
        <p style={{ color: '#666', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
          Похоже, твой прокси или VPN блокирует <code>telegram.org</code>.
          Попробуй отключить прокси в Telegram (Настройки → Данные и память → Прокси)
          или переключиться на другой.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: '#9B72CF', color: '#fff', fontSize: 15, cursor: 'pointer' }}
        >
          Перезагрузить
        </button>
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
