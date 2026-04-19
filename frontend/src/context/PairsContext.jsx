// frontend/src/context/PairsContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3001/api';
const PairsContext = createContext();

export function usePairs() {
  return useContext(PairsContext);
}

export function PairsProvider({ children, telegramUserId }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!telegramUserId) return;

    const fetchPairs = async () => {
      try {
        setLoading(true);
        const response = await axios.post(`${API_URL}/pair`, {
          userId: telegramUserId,
        });
        
        // Теперь сервер возвращает объект { pairs: [...] }
        setPairs(response.data.pairs || []);
      } catch (err) {
        console.error('Ошибка загрузки пар:', err);
        setError('Не удалось загрузить пары');
      } finally {
        setLoading(false);
      }
    };

    fetchPairs();
  }, [telegramUserId]);

  const addPair = (newPair) => {
    setPairs((prev) => [...prev, newPair]);
  };

  const updatePair = (pairId, updates) => {
    setPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, ...updates } : p))
    );
  };

  const value = {
    pairs,
    loading,
    error,
    addPair,
    updatePair,
  };

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}