import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import WebApp from '@twa-dev/sdk';
import { PairsProvider, usePairs } from './context/PairsContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import CreatePairModal from './components/CreatePairModal';
import './App.css';

// Этот внутренний компонент будет использовать хуки
function AppContent({ telegramUserId }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const navigate = useNavigate();
  const { pairs } = usePairs(); // Теперь usePairs используется корректно внутри провайдера

  const handleOpenCreateModal = () => setShowCreateModal(true);
  const handleCloseCreateModal = () => setShowCreateModal(false);

  const handlePairCreated = (newPair) => {
    setShowCreateModal(false);
    navigate(`/pair/${newPair.id}`);
  };

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            <>
              <PairSelector onCreate={handleOpenCreateModal} />
              {showCreateModal && (
                <CreatePairModal
                  telegramUserId={telegramUserId}
                  onClose={handleCloseCreateModal}
                  onCreated={handlePairCreated}
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

// Главный компонент App отвечает за получение ID пользователя и оборачивание в провайдер
function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();

    const initData = WebApp.initDataUnsafe;
    if (initData && initData.user) {
      setTelegramUserId(initData.user.id);
    } else {
      console.warn('Не удалось получить данные пользователя Telegram');
      setTelegramUserId(12345678); // ID для тестирования
    }
  }, []);

  if (!telegramUserId) {
    return <div>Загрузка...</div>;
  }

  return (
    <PairsProvider telegramUserId={telegramUserId}>
      <AppContent telegramUserId={telegramUserId} />
    </PairsProvider>
  );
}

export default App;