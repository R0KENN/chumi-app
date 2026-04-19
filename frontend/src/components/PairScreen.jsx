import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import CreatePairModal from './CreatePairModal';
import JoinPairModal from './JoinPairModal';

const API_URL = '/api';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

const BACKGROUNDS = [
  { id: 'room', name: { en: 'Cozy Room', ru: 'Комната' }, file: '/pets/bg_room.jpg' },
  { id: 'forest', name: { en: 'Magic Forest', ru: 'Лес' }, file: '/pets/bg_forest.jpg' },
  { id: 'ocean', name: { en: 'Ocean Cave', ru: 'Океан' }, file: '/pets/bg_ocean.jpg' },
  { id: 'sakura', name: { en: 'Sakura Garden', ru: 'Сакура' }, file: '/pets/bg_sakura.jpg' },
  { id: 'candy', name: { en: 'Candy Land', ru: 'Конфеты' }, file: '/pets/bg_candy.jpg' },
];

const PET_STAGES = [
  { name: { en: 'Egg', ru: 'Яйцо' }, minPoints: 0, imageIndex: -1 },
  { name: { en: 'Baby', ru: 'Малыш' }, minPoints: 0, imageIndex: 0 },
  { name: { en: 'Teen', ru: 'Подросток' }, minPoints: 200, imageIndex: 1 },
  { name: { en: 'Adult', ru: 'Взрослый' }, minPoints: 500, imageIndex: 2 },
  { name: { en: 'Legend', ru: 'Легенда' }, minPoints: 1000, imageIndex: 3 },
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
  const { pairs, updatePair, refreshPairs } = usePairs();
  const { lang, setLang, t } = useLang();

  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feeding, setFeeding] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [bgId, setBgId] = useState(() => localStorage.getItem('chumi_bg') || 'room');
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('chumi_sound') !== 'false');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('chumi_notifications') !== 'false');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

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
        if (data.hatched) setMessage(`🎉 ${PET_NAMES[data.pair.petType] || data.pair.petType} ${t.hatched}`);
        else if (data.evolved) setMessage(`✨ ${t.evolved} ${data.pair.stage.name[lang] || data.pair.stage.name}!`);
        else if (data.allFedToday) setMessage(`✅ ${t.bothFed}`);
        else setMessage(`🍖 ${t.fedWaiting}`);
        setPair(data.pair);
      } else {
        setMessage(data.message || t.alreadyFed);
      }
    } catch (e) {
      setMessage(`❌ ${t.connectionError}`);
    }
    setFeeding(false);
  };

  const handleInvite = () => {
    if (pair?.code) {
      navigator.clipboard?.writeText(pair.code);
      setMessage(`📋 ${t.codeCopied}`);
    }
  };

  const changeBg = (id) => { setBgId(id); localStorage.setItem('chumi_bg', id); };
  const toggleSound = () => { const v = !soundOn; setSoundOn(v); localStorage.setItem('chumi_sound', String(v)); };
  const toggleNotifications = () => { const v = !notifications; setNotifications(v); localStorage.setItem('chumi_notifications', String(v)); };

  if (loading) return <div className="app"><div className="center-screen"><div className="loader"></div></div></div>;
  if (!pair) return <div className="app"><div className="center-screen"><p>{t.pairNotFound}</p><button className="glass-btn" onClick={() => navigate('/')}>← {t.back}</button></div></div>;

  const hatched = pair.hatched || false;
  const stage = getStageByPoints(pair.growthPoints, hatched);
  const petImage = getPetImage(pair.petType, stage, hatched);
  const useVid = hasVideo(pair.petType, stage, hatched);
  const todayFed = pair.lastFed && pair.lastFed[telegramUserId?.toString()] === getTodayDate();
  const daysUntilHatch = hatched ? 0 : Math.max(0, 3 - pair.streakDays);
  const progress = getProgress(pair.growthPoints, hatched);
  const stageName = stage.name[lang] || stage.name.en || stage.name;

  return (
    <div className="app">
      <div className="app-bg" style={{ backgroundImage: `url(${currentBg.file})` }}></div>
      <div className="app-bg-overlay"></div>

      {/* ============ HOME TAB ============ */}
      {activeTab === 'home' && (
        <div className="main main--tabbed">
          {/* Top bar */}
          <div className="topbar-glass">
            {pairs.length > 1 && (
              <button className="back-btn-glass" onClick={() => navigate('/')}>←</button>
            )}
            <div className="topbar-center">
              <span className="topbar-name">{hatched ? stageName : t.egg}</span>
              <span className="topbar-pts">{hatched ? `${pair.growthPoints} / ${getNextThreshold(pair.growthPoints)}` : `${pair.streakDays} / 3 ${t.days}`}</span>
            </div>
          </div>

          {/* Progress */}
          <div className="topbar-track">
            <div className="topbar-fill" style={{ width: hatched ? `${progress}%` : `${(pair.streakDays / 3) * 100}%` }}></div>
          </div>

          {/* Pet zone */}
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

          {/* Pet label */}
          <div className="pet-label">
            {hatched ? (PET_NAMES[pair.petType] || pair.petType) : `${t.hatchesIn}: ${daysUntilHatch} ${t.days}`}
          </div>

          {/* Stats */}
          <div className="glass-stats">
            <div className="st"><span className="st-i">🔥</span><span className="st-v">{pair.streakDays}</span></div>
            <div className="st"><span className="st-i">⭐</span><span className="st-v">{pair.growthPoints}</span></div>
            <div className="st"><span className="st-i">👥</span><span className="st-v">{pair.users?.length || 0}/2</span></div>
          </div>

          {/* Action buttons */}
          <div className="home-actions">
            <button
              className={`feed-btn ${todayFed ? 'feed-btn--done' : ''} ${feeding ? 'feed-btn--load' : ''}`}
              onClick={handleFeed}
              disabled={todayFed || feeding}
            >
              {feeding ? `⏳ ${t.feeding}` : todayFed ? `✅ ${t.fed}` : `🍖 ${t.feed}`}
            </button>

            <button className="glass-btn wardrobe-btn" onClick={() => setActiveTab('wardrobe')}>
              👗 {t.wardrobe}
            </button>
          </div>

          {pair.users?.length < 2 && (
            <button className="glass-btn-sm" onClick={handleInvite}>💌 {t.inviteFriend}</button>
          )}

          {message && <div className="toast-glass">{message}</div>}
        </div>
      )}

      {/* ============ WARDROBE TAB ============ */}
      {activeTab === 'wardrobe' && (
        <div className="main main--tabbed">
          <div className="center-screen">
            <div className="placeholder-icon">👗</div>
            <h2>{t.wardrobe}</h2>
            <p className="placeholder-text">{t.wardrobeDesc}</p>
            <button className="glass-btn" onClick={() => setActiveTab('home')}>← {t.back}</button>
          </div>
        </div>
      )}

      {/* ============ PAIRS TAB ============ */}
      {activeTab === 'pairs' && (
        <div className="main main--tabbed">
          <h2 className="page-title">🐾 {t.yourPets}</h2>
          <p className="page-subtitle">{t.manageDesc}</p>

          <div className="pairs-grid">
            {pairs.map(p => {
              const s = getStageByPoints(p.growthPoints, p.hatched);
              const img = getPetImage(p.petType, s, p.hatched);
              const sn = s.name[lang] || s.name.en || s.name;
              return (
                <button
                  key={p.id}
                  className={`pair-card-glass ${p.id === pairId ? 'pair-card-glass--active' : ''}`}
                  onClick={() => { navigate(`/pair/${p.id}`); setActiveTab('home'); }}
                >
                  <img src={img} alt={p.petType} className="pair-card-img" />
                  <span className="pair-card-name">{p.hatched ? (PET_NAMES[p.petType] || p.petType) : t.egg}</span>
                  <span className="pair-card-stage">{p.hatched ? sn : `🔥 ${p.streakDays}/3`}</span>
                </button>
              );
            })}
          </div>

          <div className="pairs-actions">
            <button className="glass-btn" onClick={() => setShowCreateModal(true)}>➕ {t.createBtn}</button>
            <button className="glass-btn" onClick={() => setShowJoinModal(true)}>🔗 {t.join}</button>
          </div>

          {showCreateModal && (
            <CreatePairModal
              telegramUserId={telegramUserId}
              onClose={() => setShowCreateModal(false)}
              onCreated={(newPair) => { setShowCreateModal(false); navigate(`/pair/${newPair.id}`); setActiveTab('home'); }}
            />
          )}
          {showJoinModal && (
            <JoinPairModal
              telegramUserId={telegramUserId}
              onClose={() => setShowJoinModal(false)}
              onJoined={(joinedPair) => { setShowJoinModal(false); navigate(`/pair/${joinedPair.id}`); setActiveTab('home'); }}
            />
          )}
        </div>
      )}

      {/* ============ SHOP TAB ============ */}
      {activeTab === 'shop' && (
        <div className="main main--tabbed">
          <div className="center-screen">
            <div className="placeholder-icon">🏪</div>
            <h2>{t.shop}</h2>
            <p className="placeholder-text">{t.shopDesc}</p>
          </div>
        </div>
      )}

      {/* ============ SETTINGS TAB ============ */}
      {activeTab === 'settings' && (
        <div className="main main--tabbed settings-page">
          <h2 className="page-title">⚙️ {t.settings}</h2>

          <div className="glass-row">
            <div className="sinfo"><span className="si">🌐</span><div><div className="sn">{t.language}</div></div></div>
            <div className="lang-switch">
              <button className={`lang-btn ${lang === 'ru' ? 'lang-btn--on' : ''}`} onClick={() => setLang('ru')}>RU</button>
              <button className={`lang-btn ${lang === 'en' ? 'lang-btn--on' : ''}`} onClick={() => setLang('en')}>EN</button>
            </div>
          </div>

          <div className="glass-row">
            <div className="sinfo"><span className="si">🔔</span><div><div className="sn">{t.notifications}</div><div className="sd">{t.reminders}</div></div></div>
            <button className={`tgl ${notifications ? 'tgl--on' : ''}`} onClick={toggleNotifications}><div className="tgl-k"></div></button>
          </div>

          <div className="glass-row">
            <div className="sinfo"><span className="si">🔊</span><div><div className="sn">{t.sound}</div><div className="sd">{t.effects}</div></div></div>
            <button className={`tgl ${soundOn ? 'tgl--on' : ''}`} onClick={toggleSound}><div className="tgl-k"></div></button>
          </div>

          {pair?.code && (
            <div className="glass-row" onClick={handleInvite} style={{ cursor: 'pointer' }}>
              <div className="sinfo"><span className="si">🔑</span><div><div className="sn">{t.pairCode}</div><div className="sd">{pair.code}</div></div></div>
              <span style={{ fontSize: 18 }}>📋</span>
            </div>
          )}

          <h3 className="section-title">{t.background}</h3>
          <div className="bg-grid">
            {BACKGROUNDS.map(bg => (
              <button key={bg.id} className={`bg-card ${bgId === bg.id ? 'bg-card--active' : ''}`} onClick={() => changeBg(bg.id)}>
                <img src={bg.file} alt={bg.name[lang]} className="bg-card-img" />
                <span className="bg-card-name">{bg.name[lang]}</span>
                {bgId === bg.id && <span className="bg-card-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============ TAB BAR ============ */}
      <nav className="tab-bar">
        <button className={`tab ${activeTab === 'home' ? 'tab--on' : ''}`} onClick={() => setActiveTab('home')}>
          <span className="tab-i">🏠</span><span className="tab-l">{t.home}</span>
        </button>
        <button className={`tab ${activeTab === 'pairs' ? 'tab--on' : ''}`} onClick={() => setActiveTab('pairs')}>
          <span className="tab-i">🐾</span><span className="tab-l">{t.pairs}</span>
        </button>
        <button className={`tab ${activeTab === 'shop' ? 'tab--on' : ''}`} onClick={() => setActiveTab('shop')}>
          <span className="tab-i">🏪</span><span className="tab-l">{t.shop}</span>
        </button>
        <button className={`tab ${activeTab === 'settings' ? 'tab--on' : ''}`} onClick={() => setActiveTab('settings')}>
          <span className="tab-i">⚙️</span><span className="tab-l">{t.settings}</span>
        </button>
      </nav>
    </div>
  );
}
