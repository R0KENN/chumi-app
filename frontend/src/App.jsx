import { useState, useEffect, useCallback } from 'react';
import './App.css';

const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];

const PET_NAMES = {
  muru: 'Муру',
  neco: 'Неко',
  pico: 'Пико',
  boba: 'Боба',
};

const PET_STAGES = [
  { name: 'Яйцо', minPoints: 0, imageIndex: -1 },
  { name: 'Малыш', minPoints: 0, imageIndex: 0 },
  { name: 'Подросток', minPoints: 200, imageIndex: 1 },
  { name: 'Взрослый', minPoints: 500, imageIndex: 2 },
  { name: 'Легенда', minPoints: 1000, imageIndex: 3 },
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
  if (!hatched) return 'Вылупление';
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points < PET_STAGES[i].minPoints) return PET_STAGES[i].name;
  }
  return 'Макс!';
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

function getPetImage(petType, stage, hatched) {
  if (!hatched) return '/pets/egg.png';
  const idx = stage.imageIndex;
  if (idx < 0) return '/pets/egg.png';
  return `/pets/${petType}_${idx}.png`;
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
  } catch (e) {
    console.log('Sounds not available');
  }
}

function playSound(name) {
  if (!soundEnabled || !sounds[name]) return;
  try {
    sounds[name].currentTime = 0;
    sounds[name].play().catch(() => {});
  } catch (e) {}
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
    const savedSound = localStorage.getItem('chumi_sound');
    const savedNotif = localStorage.getItem('chumi_notifications');
    if (savedSound !== null) { const val = savedSound === 'true'; setSoundOn(val); soundEnabled = val; }
    if (savedNotif !== null) setNotifications(savedNotif === 'true');

    let foundUser = false;
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        const user = tg.initDataUnsafe?.user;
        if (user && user.id) { setUserId(user.id.toString()); foundUser = true; }
      }
    } catch (e) { console.log('Telegram WebApp not available'); }
    if (!foundUser) setUserId('test_user_123');
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch(`${API_URL}/pair/${userId}`)
      .then(res => res.json())
      .then(data => { if (data.success) setPair(data.pair); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  const feedPet = async () => {
    if (feeding) return;
    setFeeding(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (data.success) {
        playSound('feed');
        if (data.hatched) {
          setShowHatch(true);
          playSound('hatch');
          setTimeout(() => setShowHatch(false), 3000);
          setMessage(`🎉 Из яйца вылупился ${PET_NAMES[data.pair.petType] || data.pair.petType}!`);
        } else if (data.evolved) {
          setShowEvolve(true);
          playSound('evolve');
          setTimeout(() => setShowEvolve(false), 2000);
          setMessage(`✨ Питомец эволюционировал в "${data.pair.stage.name}"!`);
        } else if (data.allFedToday) {
          setMessage('✅ Оба покормили! Серия продолжается!');
        } else {
          setMessage('🍖 Ты покормил питомца! Ждём второго...');
        }
        setPair(data.pair);
      } else {
        setMessage(data.message);
      }
    } catch (err) {
      setMessage('❌ Ошибка соединения');
    }
    setFeeding(false);
  };

  const inviteFriend = useCallback(() => {
    playSound('click');
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        const code = pair?.code || '';
        const text = `🐾 Давай вырастим питомца в Chumi!\n\nКод пары: ${code}\n\nПрисоединяйся:`;
        tg.switchInlineQuery(text, ['users']);
      }
    } catch (e) {
      if (pair?.code) {
        navigator.clipboard?.writeText(pair.code);
        setMessage('📋 Код скопирован!');
      }
    }
  }, [pair]);

  const toggleSound = () => {
    const newVal = !soundOn;
    setSoundOn(newVal);
    soundEnabled = newVal;
    localStorage.setItem('chumi_sound', String(newVal));
    if (newVal) playSound('click');
  };

  const toggleNotifications = () => {
    const newVal = !notifications;
    setNotifications(newVal);
    localStorage.setItem('chumi_notifications', String(newVal));
    playSound('click');
  };

  // --- LOADING ---
  if (loading) {
    return (
      <div className="scene">
        <div className="room-bg"></div>
        <div className="loading-screen">
          <img src="/pets/egg.png" alt="egg" className="loading-egg" />
          <p className="loading-text">Загрузка...</p>
        </div>
      </div>
    );
  }

  // --- NO PAIR ---
  if (!pair) {
    return (
      <div className="scene">
        <div className="room-bg"></div>
        <div className="no-pair-screen">
          <img src="/pets/egg.png" alt="egg" className="no-pair-egg" />
          <h1 className="no-pair-title">Chumi</h1>
          <p className="no-pair-sub">Вырастите питомца вместе!</p>
          <div className="no-pair-box">
            <p>Открой бота и используй:</p>
            <div className="cmd"><span>/create</span> — создать пару</div>
            <div className="cmd"><span>/join КОД</span> — присоединиться</div>
          </div>
        </div>
      </div>
    );
  }

  const hatched = pair.hatched || false;
  const stage = getStageByPoints(pair.growthPoints, hatched);
  const petImage = getPetImage(pair.petType, stage, hatched);
  const todayFed = pair.lastFed && pair.lastFed[userId] === getTodayDate();
  const daysUntilHatch = hatched ? 0 : Math.max(0, 3 - pair.streakDays);
  const progress = getProgress(pair.growthPoints, hatched);

  return (
    <div className="scene">
      <div className="room-bg"></div>
      <div className="room-floor"></div>
      <div className="room-decor">
        <div className="decor-shelf"></div>
        <div className="decor-plant"></div>
        <div className="decor-lamp"></div>
      </div>

      {/* --- OVERLAYS --- */}
      {showHatch && (
        <div className="overlay">
          <div className="overlay-content">
            <div className="overlay-flash"></div>
            <img src={petImage} alt="pet" className="overlay-pet-img" />
            <h2>🎉 Вылупился!</h2>
            <p className="overlay-name">{PET_NAMES[pair.petType] || pair.petType}</p>
          </div>
        </div>
      )}

      {showEvolve && (
        <div className="overlay overlay--evolve">
          <div className="overlay-content">
            <img src={petImage} alt="pet" className="overlay-pet-img overlay-pet-img--evolve" />
            <h2>✨ Эволюция!</h2>
            <p className="overlay-name">{stage.name}</p>
          </div>
        </div>
      )}

      {/* --- MAIN UI --- */}
      {activeTab === 'home' && (
        <>
          {/* Top bar */}
          <div className="top-bar">
            <div className="top-bar-level">
              <span className="top-bar-stage">{hatched ? stage.name : 'Яйцо'}</span>
              <span className="top-bar-points">{pair.growthPoints} / {hatched ? getNextStage(pair.growthPoints, hatched) === 'Макс!' ? '1000' : PET_STAGES.find(s => s.name === getNextStage(pair.growthPoints, hatched))?.minPoints || '?' : '3 дн.'}</span>
            </div>
            <div className="top-bar-progress">
              <div className="top-bar-progress-fill" style={{ width: hatched ? `${progress}%` : `${(pair.streakDays / 3) * 100}%` }}></div>
            </div>
          </div>

          {/* Pet */}
          <div className="pet-scene">
            <div className={`pet-character ${!hatched ? 'pet-character--egg' : 'pet-character--alive'}`}>
              <img src={petImage} alt="pet" className="pet-main-img" />
            </div>
            <div className="pet-ground-shadow"></div>
          </div>

          {/* Stats row */}
          <div className="stats-floating">
            <div className="sf-item">
              <span className="sf-icon">🔥</span>
              <span className="sf-val">{pair.streakDays}</span>
            </div>
            <div className="sf-item">
              <span className="sf-icon">⭐</span>
              <span className="sf-val">{pair.growthPoints}</span>
            </div>
            <div className="sf-item">
              <span className="sf-icon">👥</span>
              <span className="sf-val">{pair.users?.length || 0}/2</span>
            </div>
          </div>

          {/* Feed button */}
          <div className="bottom-actions">
            <button
              className={`feed-btn ${todayFed ? 'feed-btn--done' : ''} ${feeding ? 'feed-btn--loading' : ''}`}
              onClick={feedPet}
              disabled={todayFed || feeding}
            >
              {feeding ? '⏳' : todayFed ? '✅ Покормлен' : '🍖 Покормить'}
            </button>

            {pair.users?.length < 2 && (
              <button className="invite-float-btn" onClick={inviteFriend}>💌</button>
            )}
          </div>

          {/* Pet name */}
          <div className="pet-name-tag">
            {hatched ? (PET_NAMES[pair.petType] || pair.petType) : `Яйцо · ${daysUntilHatch} дн.`}
          </div>

          {/* Toast */}
          {message && <div className="toast-msg">{message}</div>}
        </>
      )}

      {activeTab === 'shop' && (
        <div className="page-overlay">
          <div className="page-content">
            <div className="page-icon">🏪</div>
            <h2>Магазин</h2>
            <p>Скоро здесь появятся аксессуары!</p>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="page-overlay">
          <div className="settings-content">
            <h2 className="settings-title">Настройки</h2>
            <div className="s-item">
              <div className="s-info">
                <span className="s-icon">🔔</span>
                <div>
                  <div className="s-name">Уведомления</div>
                  <div className="s-desc">Напоминания о кормлении</div>
                </div>
              </div>
              <button className={`toggle ${notifications ? 'toggle--on' : ''}`} onClick={toggleNotifications}>
                <div className="toggle-knob"></div>
              </button>
            </div>
            <div className="s-item">
              <div className="s-info">
                <span className="s-icon">🔊</span>
                <div>
                  <div className="s-name">Звуки</div>
                  <div className="s-desc">Звуковые эффекты</div>
                </div>
              </div>
              <button className={`toggle ${soundOn ? 'toggle--on' : ''}`} onClick={toggleSound}>
                <div className="toggle-knob"></div>
              </button>
            </div>
            {pair?.code && (
              <div className="s-item">
                <div className="s-info">
                  <span className="s-icon">🔑</span>
                  <div>
                    <div className="s-name">Код пары</div>
                    <div className="s-desc">{pair.code}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav className="tab-bar">
        <button className={`tab ${activeTab === 'home' ? 'tab--active' : ''}`} onClick={() => { setActiveTab('home'); playSound('click'); }}>
          <span className="tab-ico">🏠</span>
          <span className="tab-lbl">Главная</span>
        </button>
        <button className={`tab ${activeTab === 'shop' ? 'tab--active' : ''}`} onClick={() => { setActiveTab('shop'); playSound('click'); }}>
          <span className="tab-ico">🏪</span>
          <span className="tab-lbl">Магазин</span>
        </button>
        <button className={`tab ${activeTab === 'settings' ? 'tab--active' : ''}`} onClick={() => { setActiveTab('settings'); playSound('click'); }}>
          <span className="tab-ico">⚙️</span>
          <span className="tab-lbl">Настройки</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
