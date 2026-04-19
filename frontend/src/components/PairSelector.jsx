// src/components/PairSelector.jsx
import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';

export default function PairSelector({ onCreate }) {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();

  if (loading) return <div className="loading">Загрузка...</div>;

  if (pairs.length === 0) {
    // Если пар нет — показываем кнопку создания
    return (
      <div className="pair-selector-empty">
        <p>Нет питомцев</p>
        <button onClick={onCreate}>Создать</button>
      </div>
    );
  }

  return (
    <div className="pair-selector">
      <div className="pairs-list">
        {pairs.map((pair) => (
          <div
            key={pair.id}
            className="pair-card"
            onClick={() => navigate(`/pair/${pair.id}`)}
          >
            <img src={pair.image || '/default-pet.png'} alt={pair.pet_type} />
            <h3>{pair.pet_type}</h3>
            <p>Уровень: {pair.pet_level}</p>
            <p>🔥 {pair.streak_days} дн.</p>
          </div>
        ))}
      </div>
      <button className="add-pair-button" onClick={onCreate}>
        ➕
      </button>
    </div>
  );
}