import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { setInitDataGlobal } from './initDataStore';

const API_URL = '/api';
const PairsContext = createContext();

// Реэкспорт для обратной совместимости
export { getInitData } from './initDataStore';

export function usePairs() {
  return useContext(PairsContext);
}

// ─── DeviceStorage helpers (Bot API 9.0+) с localStorage fallback ───
const ds = window.Telegram?.WebApp?.DeviceStorage;

async function dsGet(key) {
  if (ds) {
    try {
      const val = await new Promise((resolve) => {
        ds.getItem(key, (err, value) => {
          if (err || !value) resolve(null);
          else {
            try { resolve(JSON.parse(value)); }
            catch { resolve(null); }
          }
        });
      });
      if (val !== null) return val;
    } catch {}
  }
  try {
    const stored = localStorage.getItem(`ds_${key}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

async function dsSet(key, value) {
  const json = JSON.stringify(value);
  if (ds) {
    try { ds.setItem(key, json, () => {}); } catch {}
  }
  try { localStorage.setItem(`ds_${key}`, json); } catch {}
}

export function PairsProvider({ children, telegramUserId, initData }) {
  const [pairs, setPairs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Store initData globally — теперь через initDataStore
  useEffect(() => {
    setInitDataGlobal(initData);
  }, [initData]);

  const fetchPairs = useCallback(async () => {
    if (!telegramUserId) return;
    try {
      const res = await fetch(`${API_URL}/pairs/${telegramUserId}`, {
        headers: initData ? { 'X-Telegram-Init-Data': initData } : {},
      });
      const data = await res.json();
      const freshPairs = data.pairs || [];
      setPairs(freshPairs);
      setError(null);
      dsSet(`pairs_${telegramUserId}`, freshPairs);
      dsSet(`pairs_ts_${telegramUserId}`, Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [telegramUserId, initData]);

  useEffect(() => {
    if (!telegramUserId) return;
    (async () => {
      const cached = await dsGet(`pairs_${telegramUserId}`);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        setPairs(cached);
        setLoading(false);
      }
      fetchPairs();
    })();
  }, [telegramUserId, fetchPairs]);

    // Обновляем пары, когда пользователь возвращается в приложение
  useEffect(() => {
    if (!telegramUserId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchPairs();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [telegramUserId, fetchPairs]);


  const addPair = (newPair) => {
    setPairs(prev => [...(prev || []), newPair]);
  };

  const updatePair = (pairId, updates) => {
    setPairs(prev => (prev || []).map(p =>
      p.code === pairId ? { ...p, ...updates } : p
    ));
  };

  const value = {
    pairs: pairs || [],
    loading,
    error,
    addPair,
    updatePair,
    refreshPairs: fetchPairs,
    initData: initData || '',
  };

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}
