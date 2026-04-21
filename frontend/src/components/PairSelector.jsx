import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import NoPairs from './NoPairs';
import CreatePairModal from './CreatePairModal';
import JoinPairModal from './JoinPairModal';

export default function PairSelector() {
  const { pairs, loading } = usePairs();
  const { t } = useLang();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const tg = window.Telegram?.WebApp;
  const userId = tg?.initDataUnsafe?.user?.id || localStorage.getItem('chumi_test_uid') || '713156118';

  useEffect(() => {
    if (tg?.BackButton) tg.BackButton.hide();
  }, [tg]);

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', color: '#fff',
      }}>
        {t('loading') || 'Loading...'}
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
