import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import NoPairs from './NoPairs';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

function getPetImage(petType, hatched) {
  if (!hatched) return '/pets/egg.png';
  return `/pets/${petType}_0.png`;
}

export default function PairSelector({ onCreate, onJoin }) {
  const { pairs, loading } = usePairs();
  const { t } = useLang();
  const navigate = useNavigate();

  if (loading) return <div className="app"><div className="center-screen"><div className="loader"></div></div></div>;

  if (pairs.length === 0) {
    return <NoPairs onCreate={onCreate} onJoin={onJoin} />;
  }

  // Если есть пара — useEffect в App.jsx автоматически перенаправит
  return (
    <div className="app">
      <div className="center-screen">
        <div className="loader"></div>
      </div>
    </div>
  );
}
