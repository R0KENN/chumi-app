import { useState } from 'react';
import axios from 'axios';
import { usePairs } from '../context/PairsContext';

const API_URL = 'http://localhost:3001/api';

export default function EditPairModal({ pair, telegramUserId, onClose, onUpdated }) {
  const [name, setName] = useState(pair.name || pair.pet_type);
  const [imageUrl, setImageUrl] = useState(pair.image_url || '/default-pet.png');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { updatePair } = usePairs();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await axios.put(`${API_URL}/pair/${pair.id}`, {
        userId: telegramUserId,
        name,
        imageUrl,
      });
      const updated = response.data.pair;
      updatePair(pair.id, updated);
      onUpdated(updated);
    } catch (err) {
      console.error('Ошибка обновления:', err);
      setError('Не удалось сохранить изменения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>✏️ Редактировать питомца</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Имя:
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          </label>
          <label>
            URL картинки:
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              disabled={loading}
            />
          </label>
          <div className="image-preview">
            <img src={imageUrl} alt="Preview" style={{ maxWidth: '100px' }} />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="modal-buttons">
            <button type="button" onClick={onClose} disabled={loading}>
              Отмена
            </button>
            <button type="submit" disabled={loading}>
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}