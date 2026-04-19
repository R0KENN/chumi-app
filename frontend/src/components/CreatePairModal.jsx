// src/components/CreatePairModal.jsx
import { useState } from 'react';
import axios from 'axios';
import { usePairs } from '../context/PairsContext';

const API_URL = 'http://localhost:3001/api';

export default function CreatePairModal({ telegramUserId, onClose, onCreated }) {
  const [petType, setPetType] = useState('cat');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addPair } = usePairs();
  const [name, setName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Создаём пару через API
const response = await axios.post(`${API_URL}/pair/create`, {
  userId: telegramUserId,
  petType,
  name: name || petType, // если имя не введено, используем тип
  imageUrl: '/default-pet.png', // потом можно добавить выбор
});
      const newPair = response.data.pair;
      addPair(newPair);
      onCreated(newPair);
    } catch (err) {
      console.error('Ошибка создания пары:', err);
      setError('Не удалось создать пару');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Создать новую пару</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Тип питомца:
            <select value={petType} onChange={(e) => setPetType(e.target.value)}>
              <option value="cat">Кот</option>
              <option value="dog">Собака</option>
              <option value="dragon">Дракон</option>
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-buttons">
            <button type="button" onClick={onClose} disabled={loading}>
              Отмена
            </button>
            <button type="submit" disabled={loading}>
              {loading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
  <label>
  Имя питомца:
  <input
    type="text"
    value={name}
    onChange={(e) => setName(e.target.value)}
    placeholder="Например, Барсик"
  />
</label>
}