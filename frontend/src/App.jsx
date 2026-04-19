import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { PairsProvider } from './context/PairsContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import CreatePairModal from './components/CreatePairModal';
import JoinPairModal from './components/JoinPairModal';
import './App.css';

function AppContent({ telegramUserId }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const navigate = useNavigate();

  const handlePairCreated = (newPair) => {
    setShowCreateModal(false);
    navigate(`/pair/${newPair.id}`);
  };

  const handlePairJoined = (joinedPair) => {
    setShowJoinModal(false);
    navigate(`/pair/${joinedPair.id}`);
  };

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            <>
              <PairSelector
                onCreate={() => setShowCreateModal(true)}
                onJoin={() => setShowJoinModal(true)}
              />
              {showCreateModal && (
                <CreatePairModal
                  telegramUserId={telegramUserId}
                  onClose={() => setShowCreateModal(false)}
                  onCreated={handlePairCreated}
                />
              )}
              {showJoinModal && (
                <JoinPairModal
                  telegramUserId={telegramUserId}
                  onClose={() => setShowJoinModal(false)}
                  onJoined={handlePairJoined}
                />
              )}
            </>
          }
        />
        <Route
          path="/pair/:pairId"
          element={<PairScreen telegramUserId={telegramUserId} />}
        />
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
        tg.ready();
        tg.expand();
        setTelegramUserId(tg.initDataUnsafe.user.id.toString());
        return;
      }
    } catch (e) {
      console.warn('Telegram WebApp not available:', e);
    }
    // Fallback for testing outside Telegram
    setTelegramUserId('test_user_123');
  }, []);

  if (!telegramUserId) {
    return <div style={{ padding: 20, textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <PairsProvider telegramUserId={telegramUserId}>
      <AppContent telegramUserId={telegramUserId} />
    </PairsProvider>
  );
}

export default App;
