import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { PairsProvider, usePairs } from './context/PairsContext';
import { LangProvider } from './context/LangContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import './App.css';

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
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();

        // Save initData for API auth
        if (tg.initData) {
          setInitData(tg.initData);
        }

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && tg.isVersionAtLeast?.('8.0')) {
          try { tg.requestFullscreen(); } catch (e) {}
          tg.onEvent?.('fullscreenFailed', () => {});
        }

        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();

        if (tg.enableClosingConfirmation) {
          tg.enableClosingConfirmation();
        }

        try { tg.setHeaderColor?.('#FFF8E1'); } catch (e) {}
        try { tg.setBackgroundColor?.('#FFF8E1'); } catch (e) {}
        try { if (tg.setBottomBarColor) tg.setBottomBarColor('#FFF8E1'); } catch (e) {}

        const uid = tg.initDataUnsafe?.user?.id?.toString();
        if (uid) { setTelegramUserId(uid); return; }
      }
    } catch (e) {
      console.error('TG init error:', e);
    }
    const testId = localStorage.getItem('chumi_test_uid') || '713156118';
    localStorage.setItem('chumi_test_uid', testId);
    setTelegramUserId(testId);
  }, []);

  if (!telegramUserId) return <div className="sk-loading"><div className="sk-spinner" /></div>;

  return (
    <BrowserRouter>
      <LangProvider>
        <PairsProvider telegramUserId={telegramUserId} initData={initData}>
          <AppContent />
        </PairsProvider>
      </LangProvider>
    </BrowserRouter>
  );
}

export default App;
