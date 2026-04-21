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

  // На главном экране скрываем BackButton — Telegram покажет свою кнопку «Закрыть»
  useEffect(() => {
    if (tg?.BackButton) tg.BackButton.hide();
  }, [tg]);

  console.log('[PairSelector] loading:', loading, 'pairs:', pairs?.length, 'userId:', userId);

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', color: '#fff'
      }}>
        {t('loading') || 'Loading...'}
      </div>
    );
  }

  return (
    <div>
      <NoPairs
        onCreate={() => {
          console.log('[PairSelector] Opening create modal');
          setShowCreate(true);
        }}
        onJoin={() => {
          console.log('[PairSelector] Opening join modal');
          setShowJoin(true);
        }}
      />

      {showCreate && (
        <CreatePairModal
          userId={userId}
          onClose={() => setShowCreate(false)}
          onCreated={(code) => {
            console.log('[PairSelector] Pair created, navigating to:', code);
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
            console.log('[PairSelector] Joined pair, navigating to:', code);
            setShowJoin(false);
            navigate(`/pair/${code}`);
          }}
        />
      )}
    </div>
  );
}
