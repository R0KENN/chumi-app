import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { usePairs } from '../context/PairsContext';

const API_URL = '/api';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

const BACKGROUNDS = [
  { id: 'room', name: 'Cozy Room', file: '/pets/bg_room.jpg' },
  { id: 'forest', name: 'Magic Forest', file: '/pets/bg_forest.jpg' },
  { id: 'ocean', name: 'Ocean Cave', file: '/pets/bg_ocean.jpg' },
  { id: 'sakura', name: 'Sakura Garden', file: '/pets/bg_sakura.jpg' },
  { id: 'candy', name: 'Candy Land', file: '/pets/bg_candy.jpg' },
];

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
  const [activeTab, setActiveTab] = useState('home');
  const [bgId, setBgId] = useState(() => localStorage.getItem('chumi_bg') || 'room');
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('chumi_sound') !== 'false');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('chumi_notifications') !== 'false');

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

  const changeBg = (id) => { setBgId(id); localStorage.setItem('chumi_bg', id); };
  const toggleSound = () => { const v = !soundOn; setSoundOn(v); localStorage.setItem('chumi_sound', String(v)); };
  const toggleNotifications = () => { const v = !notifications; setNotifications(v); localStorage.setItem('chumi_notifications', String(v)); };

  if (loading) return <div className="app"><div className="center-screen"><p>Loading...</p></div></div>;
  if (!pair) return <div className="app"><div className="center-screen"><p>Pair not found</p><button className="back-btn" onClick={() => navigate('/')}>← Back</button></div></div>;

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

      {activeTab === 'home' && (
        <div className="main main--tabbed">
          <div className="pair-topbar">
            <button className="back-btn" onClick={() => navigate('/')}>←</button>
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
      )}

      {activeTab === 'shop' && (
        <div className="main main--tabbed">
          <div className="center-screen">
            <div style={{ fontSize: 64 }}>🏪</div>
            <h2>Shop</h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Accessories coming soon!</p>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="main main--tabbed settings-page">
          <h2 className="stitle">Settings</h2>

          <div className="srow">
            <div className="sinfo"><span className="si">🔔</span><div><div className="sn">Notifications</div><div className="sd">Reminders</div></div></div>
            <button className={`tgl ${notifications ? 'tgl--on' : ''}`} onClick={toggleNotifications}><div className="tgl-k"></div></button>
          </div>
          <div className="srow">
            <div className="sinfo"><span className="si">🔊</span><div><div className="sn">Sound</div><div className="sd">Effects</div></div></div>
            <button className={`tgl ${soundOn ? 'tgl--on' : ''}`} onClick={toggleSound}><div className="tgl-k"></div></button>
          </div>
          {pair?.code && (
            <div className="srow">
              <div className="sinfo"><span className="si">🔑</span><div><div className="sn">Pair code</div><div className="sd">{pair.code}</div></div></div>
            </div>
          )}

          <h3 className="stitle2">Background</h3>
          <div className="bg-grid">
            {BACKGROUNDS.map(bg => (
              <button key={bg.id} className={`bg-card ${bgId === bg.id ? 'bg-card--active' : ''}`} onClick={() => changeBg(bg.id)}>
                <img src={bg.file} alt={bg.name} className="bg-card-img" />
                <span className="bg-card-name">{bg.name}</span>
                {bgId === bg.id && <span className="bg-card-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="tabs">
        <button className={`tb ${activeTab === 'home' ? 'tb--on' : ''}`} onClick={() => setActiveTab('home')}>
          <span className="tb-i">🏠</span><span className="tb-l">Home</span>
        </button>
        <button className={`tb ${activeTab === 'shop' ? 'tb--on' : ''}`} onClick={() => setActiveTab('shop')}>
          <span className="tb-i">🏪</span><span className="tb-l">Shop</span>
        </button>
        <button className={`tb ${activeTab === 'settings' ? 'tb--on' : ''}`} onClick={() => setActiveTab('settings')}>
          <span className="tb-i">⚙️</span><span className="tb-l">Settings</span>
        </button>
      </nav>
    </div>
  );
}
