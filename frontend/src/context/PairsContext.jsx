import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = '/api';
const PairsContext = createContext();

// Global ref for initData so components can use it for API calls
let _initData = '';
export function getInitData() { return _initData; }

export function usePairs() {
  return useContext(PairsContext);
}

// ─── DeviceStorage helpers (Bot API 9.0+) ───
const ds = window.Telegram?.WebApp?.DeviceStorage;

async function dsGet(key) {
  if (!ds) return null;
  return new Promise((resolve) => {
    try {
      ds.getItem(key, (err, value) => {
        if (err || !value) resolve(null);
        else {
          try { resolve(JSON.parse(value)); }
          catch { resolve(null); }
        }
      });
    } catch { resolve(null); }
  });
}

async function dsSet(key, value) {
  if (!ds) return;
  try {
    ds.setItem(key, JSON.stringify(value), () => {});
  } catch (e) {
    // silent
  }
}

export function PairsProvider({ children, telegramUserId, initData }) {
  const [pairs, setPairs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Store initData globally
  useEffect(() => {
    _initData = initData || '';
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
