import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import NoPairs from './NoPairs';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba', egg: 'Egg' };

function getPetImage(petType, hatched) {
  if (!hatched) return '/pets/egg.png';
  return `/pets/${petType}_0.png`;
}

export default function PairSelector({ onCreate, onJoin }) {
  const { pairs, loading } = usePairs();
  const navigate = useNavigate();

  if (loading) return <div className="loading">Loading...</div>;

  if (pairs.length === 0) {
    return <NoPairs onCreate={onCreate} onJoin={onJoin} />;
  }

  return (
    <div className="pair-selector">
      <h2 className="selector-title">🐾 Your Pets</h2>
      <div className="pairs-list">
        {pairs.map(pair => (
          <div
            key={pair.id}
            className="pair-card"
            onClick={() => navigate(`/pair/${pair.id}`)}
          >
            <img src={getPetImage(pair.petType, pair.hatched)} alt={pair.petType} />
            <h3>{pair.hatched ? (PET_NAMES[pair.petType] || pair.petType) : 'Egg'}</h3>
            <p>{pair.hatched ? pair.stage.name : `🔥 ${pair.streakDays}/3`}</p>
          </div>
        ))}
      </div>
      <div className="action-buttons">
        <button className="join-pair-button" onClick={onJoin}>🔗</button>
        <button className="add-pair-button" onClick={onCreate}>➕</button>
      </div>
    </div>
  );
}
