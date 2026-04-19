// src/components/PairScreen.jsx
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { usePairs } from '../context/PairsContext';
import { useState, useEffect } from 'react';
import EditPairModal from './EditPairModal';

const API_URL = 'http://localhost:3001/api';

export default function PairScreen({ telegramUserId }) {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { pairs, updatePair } = usePairs();
  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedMessage, setFeedMessage] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);

  // Сначала ищем пару в контексте (если она уже загружена)
  useEffect(() => {
    const found = pairs.find((p) => p.id === pairId);
    if (found) {
      setPair(found);
      setLoading(false);
    } else {
      // Если нет — можно запросить с сервера (на будущее)
      setLoading(false);
    }
  }, [pairId, pairs]);

  const handleFeed = async () => {
    if (!pair) return;
    try {
      const response = await axios.post(`${API_URL}/feed`, {
        userId: telegramUserId,
        pairId: pair.id,
      });
      const data = response.data;
      if (data.success) {
        setFeedMessage(`✅ ${data.message}`);
        // Обновляем данные в контексте
        updatePair(pair.id, {
          pet_level: data.newLevel,
          growth_points: data.newPoints,
        });
        // Обновляем локальное состояние
        setPair((prev) => ({
          ...prev,
          pet_level: data.newLevel,
          growth_points: data.newPoints,
        }));
      } else {
        setFeedMessage(`⚠️ ${data.message}`);
      }
    } catch (error) {
      console.error('Ошибка кормления:', error);
      setFeedMessage('❌ Не удалось покормить');
    }
  };

  const handleInvite = () => {
    // Копируем код приглашения в буфер обмена
    navigator.clipboard.writeText(pair.code);
    alert(`Код ${pair.code} скопирован! Отправьте его другу.`);
  };

  if (loading) return <div>Загрузка...</div>;
  if (!pair) return <div>Пара не найдена</div>;

  return (
    <div className="pair-screen">
      <button className="back-button" onClick={() => navigate('/')}>
        ← Назад
      </button>
      <h1>{pair.pet_type}</h1>
      <img src={pair.image || '/default-pet.png'} alt={pair.pet_type} />
      <div className="stats">
        <p>Уровень: {pair.pet_level}</p>
        <p>Очки роста: {pair.growth_points}/100</p>
        <p>Дней подряд: {pair.streak_days} 🔥</p>
      </div>
      <div className="actions">
        <button onClick={handleFeed}>🍖 Покормить</button>
        <button onClick={handleInvite}>📨 Пригласить друга</button>
      </div>
      {feedMessage && <p className="feed-message">{feedMessage}</p>}
    </div>
  );
    const handleEdit = () => setShowEditModal(true);
  const handleEditClose = () => setShowEditModal(false);
  const handleEditUpdated = (updatedPair) => {
    setPair(updatedPair);
    setShowEditModal(false);
  };

  if (loading) return <div>Загрузка...</div>;
  if (!pair) return <div>Пара не найдена</div>;

  return (
    <div className="pair-screen">
      <button className="back-button" onClick={() => navigate('/')}>
        ← Назад
      </button>
      <div className="pair-header">
        <h1>{pair.name || pair.pet_type}</h1>
        <button className="edit-button" onClick={handleEdit}>✏️</button>
      </div>
      <img src={pair.image_url || '/default-pet.png'} alt={pair.name} />
      {/* остальное без изменений */}
      {showEditModal && (
        <EditPairModal
          pair={pair}
          telegramUserId={telegramUserId}
          onClose={handleEditClose}
          onUpdated={handleEditUpdated}
        />
      )}
    </div>
  );
}
