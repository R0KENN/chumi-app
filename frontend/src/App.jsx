import { Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import { PairsProvider } from './context/PairsContext';
import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import CreatePairModal from './components/CreatePairModal';
import NoPairs from './components/NoPairs';
import './App.css'; // или index.css – подключи свои стили

function App() {
  const [telegramUserId, setTelegramUserId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Инициализируем Telegram WebApp
    WebApp.ready();
    WebApp.expand();

    const initData = WebApp.initDataUnsafe;
    if (initData && initData.user) {
      setTelegramUserId(initData.user.id);
    } else {
      // Для тестирования в браузере без Telegram
      console.warn('Не удалось получить данные пользователя Telegram');
      // Можно задать тестовый ID
      setTelegramUserId(12345678);
    }
  }, []);

  const handleOpenCreateModal = () => setShowCreateModal(true);
  const handleCloseCreateModal = () => setShowCreateModal(false);

  const handlePairCreated = (newPair) => {
    setShowCreateModal(false);
    // Переходим на экран новой пары
    navigate(`/pair/${newPair.id}`);
  };

  if (!telegramUserId) {
    return <div>Загрузка...</div>;
  }

  return (
    <PairsProvider telegramUserId={telegramUserId}>
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
    </PairsProvider>
  );
}

export default App;