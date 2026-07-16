import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import NoPairs from './NoPairs';
import CreatePairModal from './CreatePairModal';
import JoinPairModal from './JoinPairModal';

export default function PairSelector() {
  const {
    loading,
    error,
    refreshPairs,
  } = usePairs();
  const { t } = useLang();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const tg = window.Telegram?.WebApp;
  // FIX #2: приведение userId к строке
  const userId = String(tg?.initDataUnsafe?.user?.id || localStorage.getItem('chumi_test_uid') || 'guest');

  useEffect(() => {
    if (tg?.BackButton) tg.BackButton.hide();
  }, [tg]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: '#fff',
        }}
      >
        {t('loading') || 'Loading...'}
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          textAlign: 'center',
          color: '#332741',
          background: '#FFF8E1',
        }}
      >
        <div
          style={{
            fontSize: 48,
          }}
        >
          😿
        </div>

        <h3>
          Не удалось загрузить данные
        </h3>

        <p
          style={{
            maxWidth: 340,
            color: '#6f6578',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>

        <button
          type="button"
          onClick={() => {
            refreshPairs?.();
          }}
          style={{
            padding: '12px 22px',
            border: 0,
            borderRadius: 14,
            color: '#fff',
            background: '#9B72CF',
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  return (
    
    <div>
      <NoPairs
        onCreate={() => setShowCreate(true)}
        onJoin={() => setShowJoin(true)}
      />

      {showCreate && (
        <CreatePairModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={(code) => {
            setShowCreate(false);
            navigate(`/pair/${code}`);
          }}
        />
      )}

      {showJoin && (
        <JoinPairModal
          userId={userId}
          onClose={() => setShowJoin(false)}
          onJoined={(code) => {
            setShowJoin(false);
            navigate(`/pair/${code}`);
          }}
        />
      )}
    </div>
  );
}
