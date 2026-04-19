import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import CreatePairModal from './CreatePairModal';
import JoinPairModal from './JoinPairModal';

const API_URL = '/api';
const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

const BACKGROUNDS = [
  { id: 'room', name: { en: 'Room', ru: 'Комната' }, file: '/pets/bg_room.webp' },
  { id: 'forest', name: { en: 'Forest', ru: 'Лес' }, file: '/pets/bg_forest.webp' },
  { id: 'ocean', name: { en: 'Ocean', ru: 'Океан' }, file: '/pets/bg_ocean.webp' },
  { id: 'sakura', name: { en: 'Sakura', ru: 'Сакура' }, file: '/pets/bg_sakura.webp' },
  { id: 'candy', name: { en: 'Candy', ru: 'Конфеты' }, file: '/pets/bg_candy.webp' },
];

const PET_STAGES = [
  { name: { en: 'Egg', ru: 'Яйцо' }, minPoints: 0, imageIndex: -1 },
  { name: { en: 'Baby', ru: 'Малыш' }, minPoints: 0, imageIndex: 0 },
  { name: { en: 'Teen', ru: 'Подросток' }, minPoints: 200, imageIndex: 1 },
  { name: { en: 'Adult', ru: 'Взрослый' }, minPoints: 500, imageIndex: 2 },
  { name: { en: 'Legend', ru: 'Легенда' }, minPoints: 1000, imageIndex: 3 },
];

function getStageByPoints(p, h) { if (!h) return PET_STAGES[0]; let s = PET_STAGES[1]; for (let i = 2; i < PET_STAGES.length; i++) { if (p >= PET_STAGES[i].minPoints) s = PET_STAGES[i]; } return s; }
function getPetImage(t, s, h) { if (!h) return '/pets/egg.png'; return s.imageIndex < 0 ? '/pets/egg.png' : `/pets/${t}_${s.imageIndex}.png`; }
function hasVideo(t, s, h) { return h && t === 'muru' && s.imageIndex === 0; }
function getProgress(p, h) { if (!h) return 0; const t = [0, 200, 500, 1000]; for (let i = 0; i < t.length - 1; i++) { if (p < t[i + 1]) return ((p - t[i]) / (t[i + 1] - t[i])) * 100; } return 100; }
function getNextThreshold(p) { for (const v of [200, 500, 1000]) { if (p < v) return v; } return 1000; }
function getTodayDate() { return new Date().toISOString().split('T')[0]; }

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);

  const currentBg = BACKGROUNDS.find(b => b.id === bgId) || BACKGROUNDS[0];

  const fetchPair = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/pair/${pairId}/${telegramUserId}`);
      const data = await res.json();
      if (data.success) setPair(data.pair);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [pairId, telegramUserId]);

  useEffect(() => { fetchPair(); }, [fetchPair]);

  const handleFeed = async () => {
    if (feeding || !pair) return;
    setFeeding(true); setMessage('');
    try {
      const res = await fetch(`${API_URL}/feed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: telegramUserId, pairCode: pair.code }) });
      const data = await res.json();
      if (data.success) {
        if (data.hatched) setMessage(`🎉 ${PET_NAMES[data.pair.petType] || data.pair.petType} ${t.hatched}`);
        else if (data.evolved) setMessage(`✨ ${t.evolved} ${data.pair.stage?.name?.[lang] || data.pair.stage?.name || ''}!`);
        else if (data.allFedToday) setMessage(`✅ ${t.bothFed}`);
        else setMessage(`🍖 ${t.fedWaiting}`);
        setPair(data.pair);
      } else setMessage(data.message || '');
    } catch (e) { setMessage(`❌ ${t.connectionError}`); }
    setFeeding(false);
  };

  const handleInvite = () => { if (pair?.code) { navigator.clipboard?.writeText(pair.code); setMessage(`📋 ${t.codeCopied}`); } };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: telegramUserId, pairCode: pair.code }) });
      const data = await res.json();
      if (data.success) { await refreshPairs(); navigate('/'); }
      else setMessage(data.message || '');
    } catch (e) { setMessage(`❌ ${t.connectionError}`); }
    setDeleting(false); setShowDeleteConfirm(false);
  };

  const handleRename = async () => {
    if (!newName.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch(`${API_URL}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: telegramUserId, pairCode: pair.code, petName: newName.trim() }) });
      const data = await res.json();
      if (data.success) { setPair(prev => ({ ...prev, petName: data.petName })); setMessage(`✅ ${t.renamed}`); setShowRename(false); }
      else setMessage(data.message || '');
    } catch (e) { setMessage(`❌ ${t.connectionError}`); }
    setRenaming(false);
  };

  const changeBg = (id) => { setBgId(id); localStorage.setItem('chumi_bg', id); setBgPickerOpen(false); };
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
  const stageName = stage.name?.[lang] || stage.name?.en || '';
  const displayName = pair.petName || (hatched ? (PET_NAMES[pair.petType] || pair.petType) : '');

  return (
    <div className="app">
      <div className="app-bg" style={{ backgroundImage: `url(${currentBg.file})` }}></div>
      <div className="app-bg-overlay"></div>

      {/* ===== HOME ===== */}
      {activeTab === 'home' && (
        <div className="main main--tabbed">
          <div className="topbar-glass">
            <div className="topbar-center">
              <span className="topbar-name">{hatched ? stageName : t.egg}</span>
              <span className="topbar-pts">{hatched ? `${pair.growthPoints} / ${getNextThreshold(pair.growthPoints)}` : `${pair.streakDays} / 3 ${t.days}`}</span>
            </div>
          </div>
          <div className="topbar-track"><div className="topbar-fill" style={{ width: hatched ? `${progress}%` : `${(pair.streakDays / 3) * 100}%` }}></div></div>

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

          <div className="pet-label" onClick={() => { if (hatched) { setNewName(pair.petName || ''); setShowRename(true); } }}>
            {hatched ? (displayName || <span className="tap-name">{t.tapToName}</span>) : `${t.hatchesIn}: ${daysUntilHatch} ${t.days}`}
          </div>

          <div className="glass-stats">
            <div className="st"><span className="st-i">🔥</span><span className="st-v">{pair.streakDays}</span></div>
            <div className="st"><span className="st-i">⭐</span><span className="st-v">{pair.growthPoints}</span></div>
            <div className="st"><span className="st-i">👥</span><span className="st-v">{pair.users?.length || 0}/2</span></div>
          </div>

          <div className="home-actions">
            <button className="bg-picker-toggle" onClick={() => setBgPickerOpen(!bgPickerOpen)}>🖼</button>
            <button className={`feed-btn-sm ${todayFed ? 'feed-btn--done' : ''} ${feeding ? 'feed-btn--load' : ''}`} onClick={handleFeed} disabled={todayFed || feeding}>
              {feeding ? `⏳` : todayFed ? `✅ ${t.fed}` : `🍖 ${t.feed}`}
            </button>
            <button className="glass-btn-sm" onClick={() => setActiveTab('wardrobe')}>👗</button>
          </div>

          {bgPickerOpen && (
            <div className="bg-strip">
              {BACKGROUNDS.map(bg => (
                <button key={bg.id} className={`bg-mini ${bgId === bg.id ? 'bg-mini--on' : ''}`} onClick={() => changeBg(bg.id)}>
                  <img src={bg.file} alt={bg.name[lang]} />
                </button>
              ))}
            </div>
          )}

          {pair.users?.length < 2 && <button className="glass-btn-sm" onClick={handleInvite}>💌 {t.inviteFriend}</button>}
          {message && <div className="toast-glass">{message}</div>}
        </div>
      )}

      {/* ===== WARDROBE ===== */}
      {activeTab === 'wardrobe' && (
        <div className="main main--tabbed"><div className="center-screen">
          <div className="placeholder-icon">👗</div>
          <h2>{t.wardrobe}</h2>
          <p className="placeholder-text">{t.wardrobeDesc}</p>
          <button className="glass-btn" onClick={() => setActiveTab('home')}>← {t.back}</button>
        </div></div>
      )}

      {/* ===== PAIRS ===== */}
      {activeTab === 'pairs' && (
        <div className="main main--tabbed">
          <h2 className="page-title">🐾 {t.yourPets}</h2>
          <p className="page-subtitle">{t.manageDesc}</p>
          <div className="pairs-grid">
            {pairs.map(p => {
              const s = getStageByPoints(p.growthPoints, p.hatched);
              const img = getPetImage(p.petType, s, p.hatched);
              return (
                <button key={p.id} className={`pair-card-glass ${p.id === pairId ? 'pair-card-glass--active' : ''}`}
                  onClick={() => { navigate(`/pair/${p.id}`); setActiveTab('home'); }}>
                  <img src={img} alt={p.petType} className="pair-card-img" />
                  <span className="pair-card-name">{p.petName || (p.hatched ? (PET_NAMES[p.petType] || p.petType) : t.egg)}</span>
                  <span className="pair-card-stage">{p.hatched ? (s.name?.[lang] || '') : `🔥 ${p.streakDays}/3`}</span>
                </button>
              );
            })}
          </div>
          <div className="pairs-actions">
            <button className="glass-btn primary" onClick={() => setShowCreateModal(true)}>➕ {t.createBtn}</button>
            <button className="glass-btn" onClick={() => setShowJoinModal(true)}>🔗 {t.join}</button>
          </div>
          <button className="glass-btn danger" style={{ marginTop: 16 }} onClick={() => setShowDeleteConfirm(true)}>🗑 {t.deletePair}</button>

          {showCreateModal && <CreatePairModal telegramUserId={telegramUserId} onClose={() => setShowCreateModal(false)} onCreated={(p) => { setShowCreateModal(false); navigate(`/pair/${p.id}`); setActiveTab('home'); }} />}
          {showJoinModal && <JoinPairModal telegramUserId={telegramUserId} onClose={() => setShowJoinModal(false)} onJoined={(p) => { setShowJoinModal(false); navigate(`/pair/${p.id}`); setActiveTab('home'); }} />}
        </div>
      )}

      {/* ===== SHOP ===== */}
      {activeTab === 'shop' && (
        <div className="main main--tabbed"><div className="center-screen">
          <div className="placeholder-icon">🏪</div>
          <h2>{t.shop}</h2>
          <p className="placeholder-text">{t.shopDesc}</p>
        </div></div>
      )}

      {/* ===== SETTINGS ===== */}
      {activeTab === 'settings' && (
        <div className="main main--tabbed settings-page">
          <div className="settings-overlay"></div>
          <div className="settings-content">
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
          </div>
        </div>
      )}

      {/* ===== DELETE CONFIRM ===== */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="modal-glass">
            <h2>🗑 {t.deletePair}</h2>
            <p>{t.deleteConfirm}</p>
            <div className="modal-buttons">
              <button className="glass-btn" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>{t.cancel}</button>
              <button className="glass-btn danger" onClick={handleDelete} disabled={deleting}>{deleting ? t.deleting : t.delete}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== RENAME MODAL ===== */}
      {showRename && (
        <div className="modal-overlay">
          <div className="modal-glass">
            <h2>✏️ {t.renamePet}</h2>
            <label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.petNamePlaceholder} maxLength={20} autoFocus />
            </label>
            <div className="modal-buttons">
              <button className="glass-btn" onClick={() => setShowRename(false)} disabled={renaming}>{t.cancel}</button>
              <button className="glass-btn primary" onClick={handleRename} disabled={renaming || !newName.trim()}>{renaming ? t.saving : t.save}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB BAR ===== */}
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
