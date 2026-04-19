import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

// Адрес нашего бэкенда (если запущен локально)
const API_URL = 'http://localhost:3001/api';

// Создаём контекст
const PairsContext = createContext();

// Хук для удобного использования контекста в других компонентах
export function usePairs() {
  return useContext(PairsContext);
}

// Компонент-провайдер, который будет оборачивать всё приложение
export function PairsProvider({ children, telegramUserId }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Загружаем список пар при монтировании или смене telegramUserId
  useEffect(() => {
    if (!telegramUserId) return;

    const fetchPairs = async () => {
      try {
        setLoading(true);
        // Пока что бэкенд отдаёт только одну пару, но мы готовимся к списку
        const response = await axios.post(`${API_URL}/pair`, {
          userId: telegramUserId,
        });
        // Пока API возвращает { pair: {...} } – сделаем массив из одной пары
        const data = response.data;
        if (data.pair) {
          setPairs([data.pair]);
        } else {
          setPairs([]);
        }
      } catch (err) {
        console.error('Ошибка загрузки пар:', err);
        setError('Не удалось загрузить пары');
      } finally {
        setLoading(false);
      }
    };

    fetchPairs();
  }, [telegramUserId]);

  // Функция для добавления новой пары (после создания)
  const addPair = (newPair) => {
    setPairs((prev) => [...prev, newPair]);
  };

  // Функция для обновления данных конкретной пары (например, после кормления)
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