import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = '/api';
const PairsContext = createContext();

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
    console.log('DeviceStorage setItem error:', e);
  }
}

export function PairsProvider({ children, telegramUserId }) {
  const [pairs, setPairs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPairs = useCallback(async () => {
    if (!telegramUserId) return;
    try {
      const res = await fetch(`${API_URL}/pairs/${telegramUserId}`);
      const data = await res.json();
      const freshPairs = data.pairs || [];
      setPairs(freshPairs);
      setError(null);
      // Кэшируем в DeviceStorage
      dsSet(`pairs_${telegramUserId}`, freshPairs);
      dsSet(`pairs_ts_${telegramUserId}`, Date.now());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [telegramUserId]);

  // При монтировании: сначала показать кэш, потом обновить
  useEffect(() => {
    if (!telegramUserId) return;

    (async () => {
      // 1. Попробовать загрузить кэш из DeviceStorage
      const cached = await dsGet(`pairs_${telegramUserId}`);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        setPairs(cached);
        setLoading(false); // UI сразу показывает данные
        console.log('[PairsContext] Loaded from DeviceStorage cache');
      }

      // 2. Всегда обновляем с сервера
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
  };

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}
