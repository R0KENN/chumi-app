import { useState, useEffect, useCallback } from 'react';
import './App.css';

// ==========================================
// КОНФИГ ПЕРСОНАЖЕЙ И СТАДИЙ
// ==========================================
const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];

const PET_NAMES = {
  muru: 'Муру',
  neco: 'Неко',
  pico: 'Пико',
  boba: 'Боба',
};

// Стадии: 0=яйцо, 1=малыш, 2=подросток, 3=взрослый, 4=легенда
const PET_STAGES = [
  { name: 'Яйцо', minPoints: 0, imageIndex: -1 },
  { name: 'Малыш', minPoints: 0, imageIndex: 0 },      // после вылупления
  { name: 'Подросток', minPoints: 200, imageIndex: 1 },
  { name: 'Взрослый', minPoints: 500, imageIndex: 2 },
  { name: 'Легенда', minPoints: 1000, imageIndex: 3 },
];

function getStageByPoints(points, hatched) {
  if (!hatched) return PET_STAGES[0]; // яйцо
  let stage = PET_STAGES[1]; // малыш минимум после вылупления
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
  if (!hatched) return '/pets/egg.webp';
  const idx = stage.imageIndex;
  if (idx < 0) return '/pets/egg.webp';
  return `/pets/${petType}_${idx}.webp`;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

// ==========================================
// ЗВУКИ
// ==========================================
const sounds = {
  feed: null,
  evolve: null,
  hatch: null,
  click: null,
};

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

// ==========================================
// ОСНОВНОЙ КОМПОНЕНТ
// ==========================================
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

  // Инициализация
  useEffect(() => {
    initSounds();

    // Загрузка настроек из localStorage
    const savedSound = localStorage.getItem('chumi_sound');
    const savedNotif = localStorage.getItem('chumi_notifications');
    if (savedSound !== null) {
      const val = savedSound === 'true';
      setSoundOn(val);
      soundEnabled = val;
    }
    if (savedNotif !== null) setNotifications(savedNotif === 'true');

    let foundUser = false;
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        const user = tg.initDataUnsafe?.user;
        if (user && user.id) {
          setUserId(user.id.toString());
          foundUser = true;
        }
      }
    } catch (e) {
      console.log('Telegram WebApp not available');
    }

    if (!foundUser) {
      setUserId('test_user_123');
    }
  }, []);

  // Загрузка данных пары
  useEffect(() => {
    if (!userId) return;

    fetch(`${API_URL}/pair/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setPair(data.pair);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  // Кормление
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

        // Проверка вылупления
        if (data.hatched) {
          setShowHatch(true);
          playSound('hatch');
          setTimeout(() => setShowHatch(false), 3000);
          setMessage(`🎉 Из яйца вылупился ${PET_NAMES[data.pair.petType] || data.pair.petType}!`);
        }
        // Проверка эволюции
        else if (data.evolved) {
          setShowEvolve(true);
          playSound('evolve');
          setTimeout(() => setShowEvolve(false), 2000);
          setMessage(`✨ Питомец эволюционировал в "${data.pair.stage.name}"!`);
        }
        else if (data.allFedToday) {
          setMessage('✅ Оба покормили! Серия продолжается!');
        } else {
          setMessage('🍖 Ты покормил питомца! Ждём второго участника...');
        }

        setPair(data.pair);
      } else {
        setMessage(data.message);
      }
    } catch (err) {
      setMessage('❌ Ошибка соединения с сервером');
    }

    setFeeding(false);
  };

  // Пригласить друга
  const inviteFriend = useCallback(() => {
    playSound('click');
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        const code = pair?.code || '';
        const text = `🐾 Привет! Давай вместе вырастим питомца в Chumi!\n\nМой код для пары: ${code}\n\nПрисоединяйся:`;
        tg.switchInlineQuery(text, ['users']);
      }
    } catch (e) {
      // Fallback: копируем код
      if (pair?.code) {
        navigator.clipboard?.writeText(pair.code);
        setMessage('📋 Код скопирован! Отправь его другу.');
      }
    }
  }, [pair]);

  // Переключение настроек
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

  // ==========================================
  // РЕНДЕР: ЗАГРУЗКА
  // ==========================================
  if (loading) {
    return (
      <div className="app">
        <div className="bg-stars"></div>
        <div className="loading">
          <div className="loading-egg">
            <img src="/pets/egg.webp" alt="egg" className="loading-egg-img" />
          </div>
          <p>Загрузка...</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // РЕНДЕР: НЕТ ПАРЫ
  // ==========================================
  if (!pair) {
    return (
      <div className="app">
        <div className="bg-stars"></div>
        <div className="no-pair">
          <img src="/pets/egg.webp" alt="egg" className="no-pair-egg" />
          <h1>Chumi</h1>
          <p className="no-pair-subtitle">Вырастите питомца вместе с другом!</p>

          <div className="no-pair-instructions">
            <p>Открой бота и используй:</p>
            <div className="command"><span>/create</span> — создать пару</div>
            <div className="command"><span>/join КОД</span> — присоединиться</div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // ДАННЫЕ ДЛЯ РЕНДЕРА
  // ==========================================
  const hatched = pair.hatched || false;
  const stage = getStageByPoints(pair.growthPoints, hatched);
  const petImage = getPetImage(pair.petType, stage, hatched);
  const todayFed = pair.lastFed && pair.lastFed[userId] === getTodayDate();
  const daysUntilHatch = hatched ? 0 : Math.max(0, 3 - pair.streakDays);

  // ==========================================
  // РЕНДЕР: ГЛАВНЫЙ ЭКРАН
  // ==========================================
  return (
    <div className="app">
      <div className="bg-stars"></div>

      {/* Оверлей вылупления */}
      {showHatch && (
        <div className="overlay hatch-overlay">
          <div className="hatch-animation">
            <div className="hatch-flash"></div>
            <img src={petImage} alt="pet" className="hatch-pet-reveal" />
            <h2>🎉 Вылупился!</h2>
            <p>{PET_NAMES[pair.petType] || pair.petType}</p>
          </div>
        </div>
      )}

      {/* Оверлей эволюции */}
      {showEvolve && (
        <div className="overlay evolve-overlay">
          <div className="evolve-animation">
            <img src={petImage} alt="pet" className="evolve-pet" />
            <h2>✨ Эволюция!</h2>
            <p>{stage.name}</p>
          </div>
        </div>
      )}

      {/* === ТАБ: HOME === */}
      {activeTab === 'home' && (
        <div className="tab-content">
          {/* Питомец */}
          <div className="pet-area">
            <div className={`pet-circle ${!hatched ? 'egg-wobble' : 'pet-bounce'}`}>
              <img src={petImage} alt="pet" className="pet-img" />
            </div>

            <h2 className="pet-name">
              {hatched ? (PET_NAMES[pair.petType] || pair.petType) : 'Яйцо'}
            </h2>
            <p className="pet-stage-label">
              {hatched ? stage.name : `До вылупления: ${daysUntilHatch} дн.`}
            </p>
          </div>

          {/* Статы */}
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-icon">🔥</div>
              <div className="stat-value">{pair.streakDays}</div>
              <div className="stat-label">дней</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">⭐</div>
              <div className="stat-value">{pair.growthPoints}</div>
              <div className="stat-label">очков</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">👥</div>
              <div className="stat-value">{pair.users?.length || 0}/2</div>
              <div className="stat-label">пара</div>
            </div>
          </div>

          {/* Кнопка кормления */}
          <button
            className={`feed-btn ${todayFed ? 'feed-btn--done' : ''} ${feeding ? 'feed-btn--loading' : ''}`}
            onClick={feedPet}
            disabled={todayFed || feeding}
          >
            {feeding ? '⏳ Кормлю...' : todayFed ? '✅ Покормлен!' : '🍖 Покормить'}
          </button>

          {/* Сообщение */}
          {message && (
            <div className={`toast ${showHatch || showEvolve ? 'toast--special' : ''}`}>
              {message}
            </div>
          )}

          {/* Прогресс */}
          {hatched && (
            <div className="progress-section">
              <div className="progress-label">
                {stage.name} → {getNextStage(pair.growthPoints, hatched)}
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${getProgress(pair.growthPoints, hatched)}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Кнопка приглашения */}
          {pair.users?.length < 2 && (
            <button className="invite-btn" onClick={inviteFriend}>
              💌 Пригласить друга
            </button>
          )}
        </div>
      )}

      {/* === ТАБ: МАГАЗИН === */}
      {activeTab === 'shop' && (
        <div className="tab-content">
          <div className="placeholder-page">
            <div className="placeholder-icon">🏪</div>
            <h2>Магазин</h2>
            <p>Скоро здесь появятся аксессуары и украшения для твоего питомца!</p>
          </div>
        </div>
      )}

      {/* === ТАБ: НАСТРОЙКИ === */}
      {activeTab === 'settings' && (
        <div className="tab-content">
          <div className="settings-page">
            <h2 className="settings-title">Настройки</h2>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-icon">🔔</div>
                <div>
                  <div className="setting-name">Уведомления</div>
                  <div className="setting-desc">Напоминания о кормлении</div>
                </div>
              </div>
              <button
                className={`toggle ${notifications ? 'toggle--on' : ''}`}
                onClick={toggleNotifications}
              >
                <div className="toggle-knob"></div>
              </button>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-icon">🔊</div>
                <div>
                  <div className="setting-name">Звуки</div>
                  <div className="setting-desc">Звуковые эффекты</div>
                </div>
              </div>
              <button
                className={`toggle ${soundOn ? 'toggle--on' : ''}`}
                onClick={toggleSound}
              >
                <div className="toggle-knob"></div>
              </button>
            </div>

            {pair?.code && (
              <div className="setting-item setting-item--code">
                <div className="setting-info">
                  <div className="setting-icon">🔑</div>
                  <div>
                    <div className="setting-name">Код пары</div>
                    <div className="setting-desc">{pair.code}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === НИЖНЕЕ МЕНЮ === */}
      <nav className="tab-bar">
        <button
          className={`tab-btn ${activeTab === 'home' ? 'tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('home'); playSound('click'); }}
        >
          <span className="tab-icon">🏠</span>
          <span className="tab-label">Главная</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'shop' ? 'tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('shop'); playSound('click'); }}
        >
          <span className="tab-icon">🏪</span>
          <span className="tab-label">Магазин</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'settings' ? 'tab-btn--active' : ''}`}
          onClick={() => { setActiveTab('settings'); playSound('click'); }}
        >
          <span className="tab-icon">⚙️</span>
          <span className="tab-label">Настройки</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
