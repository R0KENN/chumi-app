import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { PairsProvider, usePairs } from './context/PairsContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import CreatePairModal from './components/CreatePairModal';
import JoinPairModal from './components/JoinPairModal';
import { LangProvider } from './context/LangContext';
import './App.css';

function AppContent({ telegramUserId }) {
  const { pairs, loading } = usePairs();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && pairs.length > 0 && window.location.pathname === '/') {
      navigate(`/pair/${pairs[0].id}`, { replace: true });
    }
  }, [loading, pairs, navigate]);

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={
          <>
            <PairSelector
              onCreate={() => setShowCreateModal(true)}
              onJoin={() => setShowJoinModal(true)}
            />
            {showCreateModal && <CreatePairModal telegramUserId={telegramUserId} onClose={() => setShowCreateModal(false)} onCreated={(p) => { setShowCreateModal(false); navigate(`/pair/${p.id}`); }} />}
            {showJoinModal && <JoinPairModal telegramUserId={telegramUserId} onClose={() => setShowJoinModal(false)} onJoined={(p) => { setShowJoinModal(false); navigate(`/pair/${p.id}`); }} />}
          </>
        } />
        <Route path="/pair/:pairId" element={<PairScreen telegramUserId={telegramUserId} />} />
      </Routes>
    </div>
  );
}

function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);
  useEffect(() => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg && tg.initDataUnsafe?.user?.id) {
        tg.ready(); tg.expand();
        setTelegramUserId(tg.initDataUnsafe.user.id.toString());
        return;
      }
    } catch (e) { console.warn('Telegram WebApp not available:', e); }
    setTelegramUserId('test_user_123');
  }, []);

  if (!telegramUserId) return <div className="app"><div className="center-screen"><div className="loader"></div></div></div>;

  return (
    <LangProvider>
      <PairsProvider telegramUserId={telegramUserId}>
        <AppContent telegramUserId={telegramUserId} />
      </PairsProvider>
    </LangProvider>
  );
}

export default App;
