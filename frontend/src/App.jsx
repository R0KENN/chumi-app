import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { PairsProvider, usePairs } from './context/PairsContext';
import { LangProvider } from './context/LangContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import './App.css';

function AppContent() {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && pairs && pairs.length > 0) {
      const current = window.location.pathname;
      if (current === '/' || current === '') {
        navigate(`/pair/${pairs[0].code}`);
      }
    }
  }, [pairs, loading, navigate]);

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
        const uid = tg.initDataUnsafe?.user?.id?.toString();
        if (uid) {
          setTelegramUserId(uid);
          return;
        }
      }
    } catch (e) {}
    // Fallback for testing
    const testId = localStorage.getItem('chumi_test_uid') || '713156118';
    localStorage.setItem('chumi_test_uid', testId);
    setTelegramUserId(testId);
  }, []);

  if (!telegramUserId) return <div className="loading">Loading…</div>;

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
