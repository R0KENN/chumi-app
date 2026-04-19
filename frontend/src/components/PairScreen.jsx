import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { usePairs } from '../context/PairsContext';

const API_URL = '/api';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

const PET_STAGES = [
  { name: 'Egg', minPoints: 0, imageIndex: -1 },
  { name: 'Baby', minPoints: 0, imageIndex: 0 },
  { name: 'Teen', minPoints: 200, imageIndex: 1 },
  { name: 'Adult', minPoints: 500, imageIndex: 2 },
  { name: 'Legend', minPoints: 1000, imageIndex: 3 },
];

function getStageByPoints(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  let stage = PET_STAGES[1];
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points >= PET_STAGES[i].minPoints) stage = PET_STAGES[i];
  }
  return stage;
}

function getPetImage(petType, stage, hatched) {
  if (!hatched) return '/pets/egg.png';
  const idx = stage.imageIndex;
  if (idx < 0) return '/pets/egg.png';
  return `/pets/${petType}_${idx}.png`;
}

function hasVideo(petType, stage, hatched) {
  if (!hatched) return false;
  return petType === 'muru' && stage.imageIndex === 0;
}

function getProgress(points, hatched) {
  if (!hatched) return 0;
  const t = [0, 200, 500, 1000];
  for (let i = 0; i < t.length - 1; i++) {
    if (points < t[i + 1]) return ((points - t[i]) / (t[i + 1] - t[i])) * 100;
  }
  return 100;
}

function getNextThreshold(points) {
  const t = [200, 500, 1000];
  for (const v of t) { if (points < v) return v; }
  return 1000;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

export default function PairScreen({ telegramUserId }) {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { updatePair } = usePairs();
  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feeding, setFeeding] = useState(false);
  const [message, setMessage] = useState('');
  const [bgId] = useState(() => localStorage.getItem('chumi_bg') || 'room');

  const BACKGROUNDS = [
    { id: 'room', file: '/pets/bg_room.jpg' },
    { id: 'forest', file: '/pets/bg_forest.jpg' },
    { id: 'ocean', file: '/pets/bg_ocean.jpg' },
    { id: 'sakura', file: '/pets/bg_sakura.jpg' },
    { id: 'candy', file: '/pets/bg_candy.jpg' },
  ];
  const currentBg = BACKGROUNDS.find(b => b.id === bgId) || BACKGROUNDS[0];

  const fetchPair = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/pair/${pairId}/${telegramUserId}`);
      const data = await res.json();
      if (data.success) setPair(data.pair);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [pairId, telegramUserId]);

  useEffect(() => { fetchPair(); }, [fetchPair]);

  const handleFeed = async () => {
    if (feeding || !pair) return;
    setFeeding(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, pairCode: pair.code }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.hatched) setMessage(`🎉 ${PET_NAMES[data.pair.petType] || data.pair.petType} hatched!`);
        else if (data.evolved) setMessage(`✨ Evolved: ${data.pair.stage.name}!`);
        else if (data.allFedToday) setMessage('✅ Both fed today!');
        else setMessage('🍖 Fed! Waiting for partner...');
        setPair(data.pair);
      } else {
        setMessage(data.message);
      }
    } catch (e) {
      setMessage('❌ Connection error');
    }
    setFeeding(false);
  };

  const handleInvite = () => {
    if (pair?.code) {
      navigator.clipboard?.writeText(pair.code);
      setMessage('📋 Code copied!');
    }
  };

  if (loading) return <div className="app"><div className="center-screen"><p>Loading...</p></div></div>;
  if (!pair) return <div className="app"><div className="center-screen"><p>Pair not found</p></div></div>;

  const hatched = pair.hatched || false;
  const stage = getStageByPoints(pair.growthPoints, hatched);
  const petImage = getPetImage(pair.petType, stage, hatched);
  const useVid = hasVideo(pair.petType, stage, hatched);
  const todayFed = pair.lastFed && pair.lastFed[telegramUserId?.toString()] === getTodayDate();
  const daysUntilHatch = hatched ? 0 : Math.max(0, 3 - pair.streakDays);
  const progress = getProgress(pair.growthPoints, hatched);

  return (
    <div className="app">
      <div className="app-bg" style={{ backgroundImage: `url(${currentBg.file})` }}></div>
      <div className="app-bg-overlay"></div>

      <div className="main">
        <div className="pair-topbar">
          <button className="back-btn" onClick={() => navigate('/')}>← Back</button>
          <div className="topbar-info">
            <span className="topbar-name">{hatched ? stage.name : 'Egg'}</span>
            <span className="topbar-pts">{hatched ? `${pair.growthPoints} / ${getNextThreshold(pair.growthPoints)}` : `${pair.streakDays} / 3 days`}</span>
          </div>
        </div>

        <div className="topbar-track">
          <div className="topbar-fill" style={{ width: hatched ? `${progress}%` : `${(pair.streakDays / 3) * 100}%` }}></div>
        </div>

        <div className="pet-zone">
          {useVid ? (
            <div className="pet-wrap pet-wrap--video">
              <video src={`/pets/${pair.petType}_${stage.imageIndex}.webm`} className="pet-video" autoPlay loop muted playsInline />
            </div>
          ) : (
            <div className={`pet-wrap ${!hatched ? 'pet-wrap--egg' : 'pet-wrap--img'}`}>
              <img src={petImage} alt="pet" className="pet-pic" />
            </div>
          )}
          <div className="pet-shadow"></div>
        </div>

        <div className="pet-label">
          {hatched ? (PET_NAMES[pair.petType] || pair.petType) : `Hatches in: ${daysUntilHatch} days`}
        </div>

        <div className="stats">
          <div className="st"><span className="st-i">🔥</span><span className="st-v">{pair.streakDays}</span></div>
          <div className="st"><span className="st-i">⭐</span><span className="st-v">{pair.growthPoints}</span></div>
          <div className="st"><span className="st-i">👥</span><span className="st-v">{pair.users?.length || 0}/2</span></div>
        </div>

        <button className={`fbtn ${todayFed ? 'fbtn--done' : ''} ${feeding ? 'fbtn--load' : ''}`} onClick={handleFeed} disabled={todayFed || feeding}>
          {feeding ? '⏳ Feeding...' : todayFed ? '✅ Fed' : '🍖 Feed'}
        </button>

        {pair.users?.length < 2 && (
          <button className="inv-btn" onClick={handleInvite}>💌 Invite friend</button>
        )}

        {message && <div className="toast">{message}</div>}
      </div>
    </div>
  );
}
