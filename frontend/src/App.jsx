import React, { useState, useEffect } from 'react';
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
      if (location.pathname === '/' || location.pathname === '') {
        navigate(`/pair/${pairs[0].code}`);
      }
    }
  }, [pairs, loading, navigate, location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<PairSelector />} />
      <Route path="/pair/:pairId" element={<PairScreen />} />
    </Routes>
  );
}

function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);

  useEffect(() => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();

        // ─── Полноэкранный режим (Bot API 8.0+) ───
        if (tg.isVersionAtLeast?.('8.0')) {
          try {
            tg.requestFullscreen();
          } catch (e) {
            console.log('Fullscreen not supported:', e);
          }

          // Слушаем выход из fullscreen
          tg.onEvent?.('fullscreenFailed', () => {
            console.log('Fullscreen request failed');
          });
        }

        // ─── Disable vertical swipes (не закрывать при свайпе вниз) ───
        if (tg.disableVerticalSwipes) {
          tg.disableVerticalSwipes();
        }

        // ─── Цвета UI ───
        tg.setHeaderColor?.('#FFF8E1');
        tg.setBackgroundColor?.('#FFF8E1');
        if (tg.setBottomBarColor) {
          tg.setBottomBarColor('#FFF8E1');
        }

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
        <PairsProvider telegramUserId={telegramUserId}>
          <AppContent />
        </PairsProvider>
      </LangProvider>
    </BrowserRouter>
  );
}

export default App;
