import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import NoPairs from './NoPairs';
import CreatePairModal from './CreatePairModal';
import JoinPairModal from './JoinPairModal';

export default function PairSelector() {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();
  const { t } = useLang();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString()
    || localStorage.getItem('chumi_test_uid') || '0';

  if (loading) return <div className="loading">{t('loading')}</div>;

  if (!pairs || pairs.length === 0) {
    return (
      <>
        <NoPairs onCreate={() => setShowCreate(true)} onJoin={() => setShowJoin(true)} />
        {showCreate && (
          <CreatePairModal
            telegramUserId={telegramUserId}
            onClose={() => setShowCreate(false)}
            onCreated={(code) => { setShowCreate(false); navigate(`/pair/${code}`); }}
          />
        )}
        {showJoin && (
          <JoinPairModal
            telegramUserId={telegramUserId}
            onClose={() => setShowJoin(false)}
            onJoined={(code) => { setShowJoin(false); navigate(`/pair/${code}`); }}
          />
        )}
      </>
    );
  }

  // Has pairs — redirect handled by App.jsx useEffect
  return <div className="loading">{t('loading')}</div>;
}
