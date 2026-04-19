import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';

const API_URL = '';

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

const BACKGROUNDS = [
  { id: 'room', file: '/pets/bg_room.webp' },
  { id: 'forest', file: '/pets/bg_forest.webp' },
  { id: 'ocean', file: '/pets/bg_ocean.webp' },
  { id: 'sakura', file: '/pets/bg_sakura.webp' },
  { id: 'candy', file: '/pets/bg_candy.webp' }
];

const PET_STAGES = [
  { name: 'Egg', nameRu: 'Яйцо', minPoints: 0, imageIndex: -1 },
  { name: 'Baby', nameRu: 'Малыш', minPoints: 0, imageIndex: 0 },
  { name: 'Teen', nameRu: 'Подросток', minPoints: 200, imageIndex: 1 },
  { name: 'Adult', nameRu: 'Взрослый', minPoints: 500, imageIndex: 2 },
  { name: 'Legend', nameRu: 'Легенда', minPoints: 1000, imageIndex: 3 }
];

const CHOOSABLE_PETS = [
  { type: 'muru', name: 'Muru', img: '/pets/muru_0.png' },
  { type: 'neco', name: 'Neco', img: '/pets/neco_0.png' },
  { type: 'pico', name: 'Pico', img: '/pets/pico_0.png' },
  { type: 'boba', name: 'Boba', img: '/pets/boba_0.png' }
];

function getStageObj(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  for (let i = PET_STAGES.length - 1; i >= 1; i--) {
    if (points >= PET_STAGES[i].minPoints) return PET_STAGES[i];
  }
  return PET_STAGES[1];
}

function getPetImage(petType, points) {
  const st = getStageObj(points, true);
  return `/pets/${petType}_${st.imageIndex}.png`;
}

function isVideo(petType, points) {
  return petType === 'muru' && getStageObj(points, true).imageIndex === 0;
}

function getProgress(points, hatched) {
  if (!hatched) return 0;
  const thresholds = [0, 200, 500, 1000];
  for (let i = 0; i < thresholds.length - 1; i++) {
    if (points < thresholds[i + 1]) {
      return ((points - thresholds[i]) / (thresholds[i + 1] - thresholds[i])) * 100;
    }
  }
  return 100;
}

function getNextThreshold(points) {
  const t = [200, 500, 1000];
  for (const v of t) if (points < v) return v;
  return null;
}

export default function PairScreen() {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { refreshPairs } = usePairs();
  const { t, lang } = useLang();

  const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString()
    || localStorage.getItem('chumi_test_uid') || '0';

  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feeding, setFeeding] = useState(false);
  const [petting, setPetting] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [showDead, setShowDead] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [dailyTasks, setDailyTasks] = useState([]);
  const [showPetChooser, setShowPetChooser] = useState(false);
  const [nudging, setNudging] = useState(false);

  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('chumi_sound') !== 'off');
  const [notifOn, setNotifOn] = useState(() => localStorage.getItem('chumi_notif') !== 'off');

  const fetchPair = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/pair/${pairId}/${telegramUserId}`);
      const data = await res.json();
      if (data.pair) {
        setPair(data.pair);
        if (data.pair.isDead) setShowDead(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pairId, telegramUserId]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/daily-tasks/${pairId}/${telegramUserId}`);
      const data = await res.json();
      if (data.tasks) setDailyTasks(data.tasks);
    } catch (e) {}
  }, [pairId, telegramUserId]);

  useEffect(() => { fetchPair(); fetchTasks(); }, [fetchPair, fetchTasks]);

  const showToast = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  // ─── Feed ───
  const handleFeed = async (chosenPetType) => {
    if (feeding) return;
    setFeeding(true);
    try {
      const body = { userId: telegramUserId, pairCode: pairId };
      if (chosenPetType) body.chosenPetType = chosenPetType;
      const res = await fetch(`${API_URL}/api/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error === 'Already fed today' ? t('alreadyFed') : data.error);
      } else {
        if (data.justHatched) showToast('🐣 ' + (lang === 'ru' ? 'Вылупился!' : 'Hatched!'));
        else if (data.evolved) showToast('✨ ' + (lang === 'ru' ? 'Эволюция!' : 'Evolved!'));
        else if (data.allFed) showToast('🎉 ' + (lang === 'ru' ? 'Оба покормили!' : 'Both fed!'));
        else showToast('🍖 ' + t('waitPartner'));
        await fetchPair();
        await fetchTasks();
      }
    } catch (e) {
      showToast('Error');
    } finally {
      setFeeding(false);
    }
  };

  // ─── Pet ───
  const handlePet = async () => {
    if (petting) return;
    setPetting(true);
    try {
      const res = await fetch(`${API_URL}/api/pet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, pairCode: pairId })
      });
      const data = await res.json();
      if (data.error) {
        showToast(data.error === 'Already petted today' ? t('alreadyPetted') : data.error);
      } else {
        showToast('💕 +2 XP');
        await fetchPair();
        await fetchTasks();
      }
    } catch (e) {
      showToast('Error');
    } finally {
      setPetting(false);
    }
  };

  // ─── Invite via Telegram ───
  const handleInvite = () => {
    const code = pair?.code;
    if (!code) return;
    const botUsername = 'chumi_pet_bot'; // replace with your bot username
    const text = lang === 'ru'
      ? `Присоединяйся к моему питомцу в Chumi! Код: ${code}`
      : `Join my pet in Chumi! Code: ${code}`;
    const shareUrl = `https://t.me/share/url?url=https://t.me/${botUsername}?start=join_${code}&text=${encodeURIComponent(text)}`;

    try {
      window.Telegram?.WebApp?.openTelegramLink(shareUrl);
    } catch (e) {
      window.open(shareUrl, '_blank');
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pair?.code || '');
    showToast(t('copied'));
  };

  // ─── Delete ───
  const handleDelete = async () => {
    await fetch(`${API_URL}/api/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairCode: pairId })
    });
    await refreshPairs();
    navigate('/');
  };

  // ─── Rename ───
  const handleRename = async () => {
    if (!renameVal.trim()) return;
    await fetch(`${API_URL}/api/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairCode: pairId, name: renameVal, userId: telegramUserId })
    });
    setShowRename(false);
    await fetchPair();
    await fetchTasks();
  };

  // ─── Background ───
  const changeBg = async (id) => {
    setPair(prev => ({ ...prev, bgId: id }));
    await fetch(`${API_URL}/api/setbg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairCode: pairId, bgId: id, userId: telegramUserId })
    });
    await fetchTasks();
    setBgPickerOpen(false);
  };

  // ─── Recover streak ───
  const handleRecover = async () => {
    setRecovering(true);
    try {
      const res = await fetch(`${API_URL}/api/recover-streak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, pairCode: pairId })
      });
      const data = await res.json();
      if (data.success) {
        setShowDead(false);
        showToast(`♻️ ${lang === 'ru' ? 'Серия восстановлена!' : 'Streak recovered!'} (${data.remaining} ${t('recoveriesLeft')})`);
        await fetchPair();
      } else {
        showToast(data.error || t('noRecoveries'));
      }
    } catch (e) {
      showToast('Error');
    } finally {
      setRecovering(false);
    }
  };

  // ─── Create new egg ───
  const handleCreateNewEgg = async () => {
    await fetch(`${API_URL}/api/create-egg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairCode: pairId })
    });
    setShowDead(false);
    await fetchPair();
  };

  // ─── Buy slot ───
  const handleBuySlot = async () => {
    try {
      const res = await fetch(`${API_URL}/api/create-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, productId: 'extra_slot' })
      });
      const data = await res.json();
      if (data.invoiceUrl) {
        window.Telegram?.WebApp?.openInvoice(data.invoiceUrl, (status) => {
          if (status === 'paid') {
            showToast('✅ ' + (lang === 'ru' ? 'Слот куплен!' : 'Slot purchased!'));
          }
        });
      }
    } catch (e) {
      showToast('Error');
    }
  };

  // ─── Nudge partner ───
  const handleNudge = async () => {
    if (nudging) return;
    setNudging(true);
    const partner = pair?.members?.find(m => m.odID !== telegramUserId);
    if (!partner) { setNudging(false); return; }
    try {
      await fetch(`${API_URL}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: partner.odID,
          message: `🔔 ${lang === 'ru' ? 'Партнёр напоминает покормить питомца!' : 'Your partner reminds you to feed the pet!'} (${pair.code})`
        })
      });
      showToast(t('nudgeSent'));
    } catch (e) {}
    finally { setNudging(false); }
  };

  // ─── Choose pet on hatch ───
  const handleChoosePet = (petType) => {
    setShowPetChooser(false);
    handleFeed(petType);
  };

  const toggleSound = () => {
    const v = !soundOn;
    setSoundOn(v);
    localStorage.setItem('chumi_sound', v ? 'on' : 'off');
  };
  const toggleNotif = () => {
    const v = !notifOn;
    setNotifOn(v);
    localStorage.setItem('chumi_notif', v ? 'on' : 'off');
  };

  if (loading) return <div className="loading">{t('loading')}</div>;
  if (!pair) return <div className="loading">Pair not found</div>;

  const stage = getStageObj(pair.growthPoints, pair.hatched);
  const stageLabel = lang === 'ru' ? (PET_STAGES.find(s => s.name === stage.name)?.nameRu || stage.name) : stage.name;
  const petName = pair.petName || (pair.hatched ? PET_NAMES[pair.petType] || pair.petType : (lang === 'ru' ? 'Яйцо' : 'Egg'));
  const progress = getProgress(pair.growthPoints, pair.hatched);
  const nextThresh = getNextThreshold(pair.growthPoints);
  const bg = BACKGROUNDS.find(b => b.id === pair.bgId) || BACKGROUNDS[0];
  const showDim = activeTab !== 'home' && !bgPickerOpen;

  // ─── Check if should show pet chooser before feeding ───
  const onFeedClick = () => {
    // If egg at day 2 of streak (next feed = hatch), show chooser
    if (!pair.hatched && pair.streakDays >= 2 && pair.memberCount >= 2) {
      setShowPetChooser(true);
    } else {
      handleFeed();
    }
  };

  return (
    <div className="pair-screen" style={{ backgroundImage: `url(${bg.file})` }}>
      {showDim && <div className="dim-overlay" />}

      {/* ═══ DEAD SCREEN ═══ */}
      {showDead && (
        <div className="dead-overlay">
          <div className="dead-content">
            <div className="dead-skull">💀</div>
            <h1>{t('petDied')}</h1>
            <p>{t('petDiedDesc')}</p>
            {(pair.streakRecoveriesUsed < 5) ? (
              <>
                <button className="btn-recover" onClick={handleRecover} disabled={recovering}>
                  {recovering ? '...' : `♻️ ${t('recoverStreak')}`}
                </button>
                <p className="recover-info">
                  {5 - pair.streakRecoveriesUsed} {t('recoveriesLeft')}
                </p>
              </>
            ) : (
              <p className="recover-info">{t('noRecoveries')}</p>
            )}
            <button className="btn-new-egg" onClick={handleCreateNewEgg}>
              🥚 {t('createNewEgg')}
            </button>
          </div>
        </div>
      )}

      {/* ═══ PET CHOOSER ═══ */}
      {showPetChooser && (
        <div className="modal-overlay" onClick={() => setShowPetChooser(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            <h3>{t('choosePet')}</h3>
            <p>{t('choosePetDesc')}</p>
            <div className="pet-chooser-grid">
              {CHOOSABLE_PETS.map(p => (
                <button key={p.type} className="pet-choice" onClick={() => handleChoosePet(p.type)}>
                  <img src={p.img} alt={p.name} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ HOME TAB ═══ */}
      {activeTab === 'home' && !showDead && (
        <div className="home-tab">
          {/* Top bar */}
          <div className="top-bar">
            <div className="pet-name-row">
              <span className="pet-name">{petName}</span>
              <button className="edit-name-btn" onClick={() => { setRenameVal(petName); setShowRename(true); }}>✏️</button>
            </div>
            <div className="stage-badge" onClick={() => setStagesOpen(!stagesOpen)}>
              {stageLabel} {pair.hatched && nextThresh ? `(${pair.growthPoints}/${nextThresh})` : ''}
            </div>
            {/* Partner info */}
            <div className="partner-info">
              👤 {pair.partnerName ? pair.partnerName : t('noPartner')}
            </div>
          </div>

          {/* Progress bar */}
          <div className="progress-container">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Stats under progress */}
          <div className="stats-row">
            <div className="stat-item">🔥 {pair.streakDays}</div>
            <div className="stat-item">⭐ {pair.growthPoints}</div>
            <div className="stat-item">👥 {pair.memberCount}/2</div>
          </div>

          {/* Stages popup */}
          {stagesOpen && (
            <div className="stages-popup">
              {PET_STAGES.slice(1).map((s, i) => {
                const current = stage.name === s.name;
                const achieved = pair.growthPoints >= s.minPoints && pair.hatched;
                return (
                  <div key={s.name} className={`stage-item ${current ? 'current' : ''} ${achieved ? 'achieved' : ''}`}>
                    <span>{lang === 'ru' ? s.nameRu : s.name}</span>
                    <span className="stage-pts">{s.minPoints} XP</span>
                    {current && <span className="stage-marker">◄</span>}
                    {achieved && !current && <span className="stage-check">✓</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pet zone */}
          <div className="pet-zone" onClick={() => setStagesOpen(false)}>
            {!pair.hatched ? (
              <img src="/pets/egg.png" alt="egg" className="pet-img egg-anim" />
            ) : isVideo(pair.petType, pair.growthPoints) ? (
              <video src={`/pets/${pair.petType}_0.webm`} autoPlay loop muted playsInline className="pet-video" />
            ) : (
              <img src={getPetImage(pair.petType, pair.growthPoints)} alt="pet" className="pet-img pet-idle" />
            )}
          </div>

          {/* Action buttons row */}
          <div className="action-row">
            <button className="btn-action btn-sm" onClick={handlePet} disabled={petting || pair.userPettedToday}>
              💕
            </button>
            <button className="btn-action btn-feed" onClick={onFeedClick} disabled={feeding || pair.userFedToday}>
              {feeding ? '...' : '🍖'}
            </button>
            <button className="btn-action btn-sm" onClick={() => setBgPickerOpen(!bgPickerOpen)}>
              🖼
            </button>
          </div>

          {/* Wardrobe button */}
          <button className="btn-wardrobe-sm" onClick={() => setActiveTab('wardrobe')}>
            👗 {t('wardrobe')}
          </button>

          {/* Background picker */}
          {bgPickerOpen && (
            <div className="bg-picker">
              {BACKGROUNDS.map(b => (
                <button key={b.id} className={`bg-thumb ${pair.bgId === b.id ? 'active' : ''}`}
                  onClick={() => changeBg(b.id)}
                  style={{ backgroundImage: `url(${b.file})` }} />
              ))}
            </div>
          )}

          {/* Invite / Nudge */}
          {pair.memberCount < 2 && (
            <button className="btn-invite" onClick={handleInvite}>
              📨 {t('sendInvite')}
            </button>
          )}
          {pair.memberCount === 2 && !pair.allFedToday && pair.userFedToday && (
            <button className="btn-invite" onClick={handleNudge} disabled={nudging}>
              🔔 {t('notifyPartner')}
            </button>
          )}

          {/* Daily tasks */}
          <div className="daily-tasks glass-panel">
            <h4>{t('dailyTasks')}</h4>
            {dailyTasks.map(task => (
              <div key={task.type} className={`task-row ${task.completed ? 'done' : ''}`}>
                <span>{lang === 'ru' ? task.label_ru : task.label_en}</span>
                <span>{task.completed ? '✅' : '○'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ WARDROBE TAB ═══ */}
      {activeTab === 'wardrobe' && (
        <div className="tab-content">
          <div className="placeholder-content glass-panel">
            <span className="placeholder-icon">👗</span>
            <p>{t('wardrobePlaceholder')}</p>
          </div>
        </div>
      )}

      {/* ═══ PAIRS TAB ═══ */}
      {activeTab === 'pairs' && (
        <PairsTab
          telegramUserId={telegramUserId}
          currentPairCode={pairId}
          t={t}
          lang={lang}
          navigate={navigate}
          onBuySlot={handleBuySlot}
        />
      )}

      {/* ═══ SHOP TAB ═══ */}
      {activeTab === 'shop' && (
        <div className="tab-content">
          <div className="placeholder-content glass-panel">
            <span className="placeholder-icon">🛒</span>
            <p>{t('shopPlaceholder')}</p>
          </div>
          <div className="shop-item glass-panel" onClick={handleBuySlot}>
            <span>➕ {t('buySlot')}</span>
            <span className="shop-price">{t('buySlotStars')}</span>
          </div>
        </div>
      )}

      {/* ═══ SETTINGS TAB ═══ */}
      {activeTab === 'settings' && (
        <SettingsTab
          t={t} lang={lang} pair={pair}
          soundOn={soundOn} notifOn={notifOn}
          toggleSound={toggleSound} toggleNotif={toggleNotif}
          onCopyCode={handleCopyCode}
          onDelete={() => setShowDeleteConfirm(true)}
        />
      )}

      {/* ═══ Toast ═══ */}
      {msg && <div className="toast">{msg}</div>}

      {/* ═══ Delete confirm ═══ */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            <h3>{t('deletePair')}</h3>
            <p>{t('deleteConfirm')}</p>
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setShowDeleteConfirm(false)}>{t('cancel')}</button>
              <button className="btn-danger" onClick={handleDelete}>{t('delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Rename modal ═══ */}
      {showRename && (
        <div className="modal-overlay" onClick={() => setShowRename(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            <h3>{t('renamePet')}</h3>
            <input className="modal-input" value={renameVal} onChange={e => setRenameVal(e.target.value)}
              maxLength={20} placeholder={t('enterName')} autoFocus />
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setShowRename(false)}>{t('cancel')}</button>
              <button className="btn-primary" onClick={handleRename}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Tab bar (icons only, rounded) ═══ */}
      <div className="tab-bar">
        {[
          { id: 'home', icon: '🏠' },
          { id: 'wardrobe', icon: '👗' },
          { id: 'pairs', icon: '🐾' },
          { id: 'shop', icon: '🛒' },
          { id: 'settings', icon: '⚙️' }
        ].map(tab => (
          <button key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.id); setBgPickerOpen(false); setStagesOpen(false); }}>
            <span className="tab-icon">{tab.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Pairs sub-tab ─── */
function PairsTab({ telegramUserId, currentPairCode, t, lang, navigate, onBuySlot }) {
  const { pairs, refreshPairs } = usePairs();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [createdCode, setCreatedCode] = useState('');
  const [error, setError] = useState('');
  const [slotInfo, setSlotInfo] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/user-slots/${telegramUserId}`)
      .then(r => r.json())
      .then(d => setSlotInfo(d))
      .catch(() => {});
  }, [telegramUserId]);

  const handleCreate = async () => {
    setCreating(true); setError('');
    try {
      const displayName = window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || null;
      const res = await fetch(`${API_URL}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, displayName })
      });
      const data = await res.json();
      if (data.error) {
        if (data.maxReached) setError(`${lang === 'ru' ? 'Макс. пар:' : 'Max pairs:'} ${data.maxPairs}`);
        else setError(data.error);
      } else {
        setCreatedCode(data.code);
        await refreshPairs();
      }
    } catch (e) { setError('Error'); }
    finally { setCreating(false); }
  };

  const handleJoin = async () => {
    setJoining(true); setError('');
    try {
      const displayName = window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || null;
      const res = await fetch(`${API_URL}/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, code, displayName })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        await refreshPairs();
        setShowJoin(false);
        navigate(`/pair/${data.code}`);
      }
    } catch (e) { setError('Error'); }
    finally { setJoining(false); }
  };

  return (
    <div className="tab-content">
      <div className="pairs-grid">
        {pairs.map(p => (
          <div key={p.code} className={`pair-card glass-panel ${p.code === currentPairCode ? 'current' : ''}`}
            onClick={() => navigate(`/pair/${p.code}`)}>
            <img src={p.hatched ? `/pets/${p.petType}_0.png` : '/pets/egg.png'} alt="" className="pair-card-img" />
            <div className="pair-card-info">
              <span className="pair-card-name">{p.petName || (p.hatched ? PET_NAMES[p.petType] : (lang === 'ru' ? 'Яйцо' : 'Egg'))}</span>
              <span className="pair-card-stage">{p.stage}</span>
              {p.partnerName && <span className="pair-card-partner">👤 {p.partnerName}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="pairs-actions">
        <button className="btn-primary" onClick={() => { setShowCreate(true); setCreatedCode(''); setError(''); }}>
          ➕ {t('createPair')}
        </button>
        <button className="btn-secondary" onClick={() => { setShowJoin(true); setCode(''); setError(''); }}>
          🔗 {t('join')}
        </button>
      </div>

      {slotInfo && (
        <div className="slot-info glass-panel">
          <span>{lang === 'ru' ? 'Пар:' : 'Pairs:'} {slotInfo.currentPairs}/{slotInfo.maxPairs}</span>
          <button className="btn-buy-slot" onClick={onBuySlot}>
            ➕ {t('buySlot')} ({t('buySlotStars')})
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            {createdCode ? (
              <>
                <h3>✅ {lang === 'ru' ? 'Пара создана!' : 'Pair created!'}</h3>
                <div className="code-display" onClick={() => { navigator.clipboard.writeText(createdCode); }}>
                  {createdCode}
                </div>
                <p>{lang === 'ru' ? 'Нажми чтобы скопировать' : 'Tap to copy'}</p>
                <button className="btn-primary" onClick={() => { setShowCreate(false); navigate(`/pair/${createdCode}`); }}>OK</button>
              </>
            ) : (
              <>
                <h3>{t('createPair')}</h3>
                {error && <p className="error-text">{error}</p>}
                <div className="modal-btns">
                  <button className="btn-cancel" onClick={() => setShowCreate(false)}>{t('cancel')}</button>
                  <button className="btn-primary" onClick={handleCreate} disabled={creating}>
                    {creating ? '...' : t('create')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Join modal */}
      {showJoin && (
        <div className="modal-overlay" onClick={() => setShowJoin(false)}>
          <div className="modal-glass" onClick={e => e.stopPropagation()}>
            <h3>{t('join')}</h3>
            <input className="modal-input" value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={6} placeholder={t('enterCode')} autoFocus />
            {error && <p className="error-text">{error}</p>}
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setShowJoin(false)}>{t('cancel')}</button>
              <button className="btn-primary" onClick={handleJoin} disabled={joining || code.length < 6}>
                {joining ? '...' : t('join')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Settings sub-tab ─── */
function SettingsTab({ t, lang, pair, soundOn, notifOn, toggleSound, toggleNotif, onCopyCode, onDelete }) {
  const { setLang } = useLang();

  return (
    <div className="tab-content">
      <div className="settings-list">
        <div className="settings-row glass-panel">
          <span>{t('language')}</span>
          <div className="lang-switch">
            <button className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')}>RU</button>
            <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
        <div className="settings-row glass-panel">
          <span>{t('notifications')}</span>
          <label className="toggle"><input type="checkbox" checked={notifOn} onChange={toggleNotif} /><span className="slider" /></label>
        </div>
        <div className="settings-row glass-panel">
          <span>{t('sound')}</span>
          <label className="toggle"><input type="checkbox" checked={soundOn} onChange={toggleSound} /><span className="slider" /></label>
        </div>
        <div className="settings-row glass-panel clickable" onClick={onCopyCode}>
          <span>{t('pairCode')}</span>
          <span className="code-val">{pair?.code}</span>
        </div>
        <button className="btn-danger-full" onClick={onDelete}>
          🗑 {t('deletePair')}
        </button>
      </div>
    </div>
  );
}
