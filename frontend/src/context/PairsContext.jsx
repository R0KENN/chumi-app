import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = '/api';
const PairsContext = createContext();

export function usePairs() {
  return useContext(PairsContext);
}

export function PairsProvider({ children, telegramUserId }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPairs = useCallback(async () => {
    if (!telegramUserId) return;
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/pairs/${telegramUserId}`);
      const data = await res.json();
      if (data.success) {
        setPairs(data.pairs || []);
      }
    } catch (err) {
      console.error('Error loading pairs:', err);
      setError('Failed to load pairs');
    } finally {
      setLoading(false);
    }
  }, [telegramUserId]);

  useEffect(() => {
    fetchPairs();
  }, [fetchPairs]);

  const addPair = (newPair) => {
    setPairs(prev => [...prev, newPair]);
  };

  const updatePair = (pairId, updates) => {
    setPairs(prev => prev.map(p => p.id === pairId ? { ...p, ...updates } : p));
  };

  const value = { pairs, loading, error, addPair, updatePair, refreshPairs: fetchPairs };

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}
