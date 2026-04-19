import { useState, useEffect, useCallback } from 'react';
import './App.css';

const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];

const PET_NAMES = {
  muru: 'Muru',
  neco: 'Neco',
  pico: 'Pico',
  boba: 'Boba',
};

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

function getNextStage(points, hatched) {
  if (!hatched) return 'Hatch';
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points < PET_STAGES[i].minPoints) return PET_STAGES[i].name;
  }
  return 'MAX';
}

function getProgress(points, hatched) {
  if (!hatched) return 0;
  const t = [0, 200, 500, 1000];
  for (let i = 0; i < t.length - 1; i++) {
    if (points < t[i + 1]) return ((points - t[i]) / (t[i + 1] - t[i])) * 100;
  }
  return 100;
}

function getNextThreshold(points, hatched) {
  if (!hatched) return 3;
  const t = [0, 200, 500, 1000];
  for (let i = 0; i < t.length; i++) {
    if (points < t[i]) return t[i];
  }
  return 1000;
}

function getPetImage(petType, stage, hatched) {
  if (!hatched) return '/pets/egg.png';
  const idx = stage.imageIndex;
  if (idx < 0) return '/pets/egg.png';
  return `/pets/${petType}_${idx}.png`;
}

function hasVideo(petType, stage, hatched) {
  if (!hatched) return false;
  const idx = stage.imageIndex;
  if (idx < 0) return false;
  // Only muru_0 has a video for now
  return petType === 'muru' && idx === 0;
}

function getPetVideo(petType, stage) {
  return `/pets/${petType}_${stage.imageIndex}.webm`;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

const sounds = { feed: null, evolve: null, hatch: null, click: null };
let soundEnabled = true;

function initSounds() {
  try {
    sounds.feed = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
    sounds.evolve = new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
    sounds.hatch = new Audio('https://assets.mixkit.co/active_storage/sfx/2018/2018-preview.mp3');
    sounds.click = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
    Object.values(sounds).forEach(s => { if (s) { s.volume = 0.3; s.load(); } });
  } catch (e) {}
}

function playSound(name) {
  if (!soundEnabled || !sounds[name]) return;
  try { sounds[name].currentTime = 0; sounds[name].play().catch(() => {}); } catch (e) {}
}

function App() {
  const [userId, setUserId] = useState(null);
  const [pair, setPair] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [feeding, setFeeding] = useState(false);
  const [showEvolve, setShowEvolve] = useState(false);
  const [showHatch, setShowHatch] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [notifications, setNotifications] = useState(true);
  const [soundOn, setSoundOn] = useState(true);

  const API_URL = '/api';

  useEffect(() => {
    initSounds();
    const ss = localStorage.getItem('chumi_sound');
    const sn = localStorage.getItem('chumi_notifications');
    if (ss !== null) { const v = ss === 'true'; setSoundOn(v); soundEnabled = v; }
    if (sn !== null) setNotifications(sn === 'true');
    let found = false;
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) { tg.ready(); tg.expand(); const u = tg.initDataUnsafe?.user; if (u?.id) { setUserId(u.id.toString()); found = true; } }
    } catch (e) {}
    if (!found) setUserId('test_user_123');
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API_URL}/pair/${userId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setPair(d.pair); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  const feedPet = async () => {
    if (feeding) return;
    setFeeding(true); setMessage('');
    try {
      const res = await fetch(`${API_URL}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const data = await res.json();
      if (data.success) {
        playSound('feed');
        if (data.hatched) { setShowHatch(true); playSound('hatch'); setTimeout(() => setShowHatch(false), 3000); setMessage(`🎉 ${PET_NAMES[data.pair.petType] || data.pair.petType} hatched!`); }
        else if (data.evolved) { setShowEvolve(true); playSound('evolve'); setTimeout(() => setShowEvolve(false), 2000); setMessage(`✨ Evolved: ${data.pair.stage.name}!`); }
        else if (data.allFedToday) { setMessage('✅ Both fed today!'); }
        else { setMessage('🍖 Fed! Waiting for partner...'); }
        setPair(data.pair);
      } else { setMessage(data.message); }
    } catch (e) { setMessage('❌ Connection error'); }
    setFeeding(false);
  };

  const inviteFriend = useCallback(() => {
    playSound('click');
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) { tg.switchInlineQuery(`🐾 Pair code: ${pair?.code}\nJoin me!`, ['users']); }
    } catch (e) { if (pair?.code) { navigator.clipboard?.writeText(pair.code); setMessage('📋 Code copied!'); } }
  }, [pair]);

  const toggleSound = () => { const v = !soundOn; setSoundOn(v); soundEnabled = v; localStorage.setItem('chumi_sound', String(v)); if (v) playSound('click'); };
  const toggleNotifications = () => { const v = !notifications; setNotifications(v); localStorage.setItem('chumi_notifications', String(v)); playSound('click'); };

  if (loading) return (
    <div className="app">
      <div className="stars"></div>
      <div className="center-screen">
        <img src="/pets/egg.png" alt="egg" className="load-egg" />
        <p className="load-text">Loading...</p>
      </div>
    </div>
  );

  if (!pair) return (
    <div className="app">
      <div className="stars"></div>
      <div className="center-screen">
        <img src="/pets/egg.png" alt="egg" className="load-egg" />
        <h1 className="logo">Chumi</h1>
        <p className="subtitle">Raise a pet together!</p>
        <div className="info-box">
          <p>Open the bot:</p>
          <div className="cmd"><span>/create</span> — create a pair</div>
          <div className="cmd"><span>/join CODE</span> — join a pair</div>
        </div>
      </div>
    </div>
  );

  const hatched = pair.hatched || false;
  const stage = getStageByPoints(pair.growthPoints, hatched);
  const petImage = getPetImage(pair.petType, stage, hatched);
  const useVideo = hasVideo(pair.petType, stage, hatched);
  const todayFed = pair.lastFed && pair.lastFed[userId] === getTodayDate();
  const daysUntilHatch = hatched ? 0 : Math.max(0, 3 - pair.streakDays);
  const progress = getProgress(pair.growthPoints, hatched);

  return (
    <div className="app">
      <div className="stars"></div>

      {showHatch && (
        <div className="ov">
          <div className="ov-inner">
            <div className="ov-glow"></div>
            <img src={petImage} alt="pet" className="ov-img" />
            <h2>🎉 Hatched!</h2>
            <p className="ov-sub">{PET_NAMES[pair.petType] || pair.petType}</p>
          </div>
        </div>
      )}
      {showEvolve && (
        <div className="ov">
          <div className="ov-inner">
            <img src={petImage} alt="pet" className="ov-img ov-img--ev" />
            <h2>✨ Evolution!</h2>
            <p className="ov-sub">{stage.name}</p>
          </div>
        </div>
      )}

      {activeTab === 'home' && (
        <div className="main">
          {/* Progress bar top */}
          <div className="topbar">
            <div className="topbar-row">
              <span className="topbar-name">{hatched ? stage.name : 'Egg'}</span>
              <span className="topbar-pts">{hatched ? `${pair.growthPoints} / ${getNextThreshold(pair.growthPoints, hatched)}` : `${pair.streakDays} / 3 days`}</span>
            </div>
            <div className="topbar-track">
              <div className="topbar-fill" style={{ width: hatched ? `${progress}%` : `${(pair.streakDays / 3) * 100}%` }}></div>
            </div>
          </div>

          {/* Pet */}
          <div className="pet-zone">
            {useVideo ? (
              <div className="pet-wrap pet-wrap--video">
<video
  src={getPetVideo(pair.petType, stage)}
  className="pet-video"
  autoPlay
  loop
  muted
  playsInline
  type="video/webm"
/>

              </div>
            ) : (
              <div className={`pet-wrap ${!hatched ? 'pet-wrap--egg' : 'pet-wrap--img'}`}>
                <img src={petImage} alt="pet" className="pet-pic" />
              </div>
            )}
            <div className="pet-shadow"></div>
          </div>

          {/* Name */}
          <div className="pet-label">
            {hatched ? (PET_NAMES[pair.petType] || pair.petType) : `Hatches in: ${daysUntilHatch} days`}
          </div>

          {/* Stats */}
          <div className="stats">
            <div className="st"><span className="st-i">🔥</span><span className="st-v">{pair.streakDays}</span></div>
            <div className="st"><span className="st-i">⭐</span><span className="st-v">{pair.growthPoints}</span></div>
            <div className="st"><span className="st-i">👥</span><span className="st-v">{pair.users?.length || 0}/2</span></div>
          </div>

          {/* Feed */}
          <button className={`fbtn ${todayFed ? 'fbtn--done' : ''} ${feeding ? 'fbtn--load' : ''}`} onClick={feedPet} disabled={todayFed || feeding}>
            {feeding ? '⏳ Feeding...' : todayFed ? '✅ Fed' : '🍖 Feed'}
          </button>

          {pair.users?.length < 2 && (
            <button className="inv-btn" onClick={inviteFriend}>💌 Invite friend</button>
          )}

          {message && <div className="toast">{message}</div>}
        </div>
      )}

      {activeTab === 'shop' && (
        <div className="main">
          <div className="center-screen">
            <div style={{ fontSize: 64 }}>🏪</div>
            <h2>Shop</h2>
            <p className="subtitle">Accessories coming soon!</p>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="main settings">
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
        </div>
      )}

      <nav className="tabs">
        <button className={`tb ${activeTab === 'home' ? 'tb--on' : ''}`} onClick={() => { setActiveTab('home'); playSound('click'); }}>
          <span className="tb-i">🏠</span><span className="tb-l">Home</span>
        </button>
        <button className={`tb ${activeTab === 'shop' ? 'tb--on' : ''}`} onClick={() => { setActiveTab('shop'); playSound('click'); }}>
          <span className="tb-i">🏪</span><span className="tb-l">Shop</span>
        </button>
        <button className={`tb ${activeTab === 'settings' ? 'tb--on' : ''}`} onClick={() => { setActiveTab('settings'); playSound('click'); }}>
          <span className="tb-i">⚙️</span><span className="tb-l">Settings</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
