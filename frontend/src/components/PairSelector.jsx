import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';

export default function PairSelector({ onCreate, onJoin }) {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();

  if (loading) return <div className="loading">Загрузка...</div>;

  if (pairs.length === 0) {
    // Используем компонент NoPairs, если он есть
    return <NoPairs onCreate={onCreate} onJoin={onJoin} />;
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
            <h3>{pair.name || pair.pet_type}</h3>
            <p>Уровень: {pair.pet_level}</p>
          </div>
        ))}
      </div>
      <div className="action-buttons">
        <button className="add-pair-button" onClick={onCreate}>
          ➕
        </button>
        <button className="join-pair-button" onClick={onJoin}>
          🔗
        </button>
      </div>
    </div>
  );
}