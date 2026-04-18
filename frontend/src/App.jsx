import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [userId, setUserId] = useState(null);
  const [pair, setPair] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [feeding, setFeeding] = useState(false);
  const [evolved, setEvolved] = useState(false);

  const API_URL = '';

  // Получаем userId из Telegram
  useEffect(() => {
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

    // Для тестирования без Telegram
    if (!foundUser) {
      setUserId('test_user_123');
    }
  }, []);


  // Загружаем данные пары
  useEffect(() => {
    if (!userId) return;

    fetch(`${API_URL}/api/pair/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPair(data.pair);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  // Кормление
  const feedPet = async () => {
    if (feeding) return;
    setFeeding(true);
    setMessage('');
    setEvolved(false);

    try {
      const res = await fetch(`${API_URL}/api/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();

      if (data.success) {
        setPair(data.pair);
        if (data.evolved) {
          setEvolved(true);
          setMessage(`🎉 Питомец эволюционировал в "${data.pair.stage.name}"!`);
        } else if (data.allFedToday) {
          setMessage('✅ Оба покормили! Серия продолжается!');
        } else {
          setMessage('🍖 Ты покормил питомца! Ждём второго участника...');
        }
      } else {
        setMessage(data.message);
      }
    } catch (err) {
      setMessage('❌ Ошибка соединения с сервером');
    }

    setFeeding(false);
  };

  // Получаем изображение питомца по стадии
  const getPetImage = (stageName) => {
    const images = {
      'Яйцо': '🥚',
      'Малыш': '🐣',
      'Подросток': '🐲',
      'Взрослый': '🔥',
      'Легенда': '👑'
    };
    return images[stageName] || '🥚';
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Загрузка...</div>
      </div>
    );
  }

  if (!pair) {
    return (
      <div className="app">
        <div className="no-pair">
          <div className="logo">🐾</div>
          <h1>Chumi</h1>
          <p>У тебя пока нет пары!</p>
          <p>Открой бота и используй:</p>
          <p><b>/create</b> — создать пару</p>
          <p><b>/join КОД</b> — присоединиться</p>
        </div>
      </div>
    );
  }

  const todayFed = pair.lastFed && pair.lastFed[userId] === new Date().toISOString().split('T')[0];

  return (
    <div className="app">
      <div className="pet-container">
        <div className={`pet ${evolved ? 'evolved' : ''}`}>
          <div className="pet-emoji">{getPetImage(pair.stage.name)}</div>
        </div>
        <h2 className="pet-stage">{pair.stage.name}</h2>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-icon">🔥</span>
          <span className="stat-value">{pair.streakDays}</span>
          <span className="stat-label">дней</span>
        </div>
        <div className="stat">
          <span className="stat-icon">⭐</span>
          <span className="stat-value">{pair.growthPoints}</span>
          <span className="stat-label">очков</span>
        </div>
      </div>

      <button
        className={`feed-button ${todayFed ? 'fed' : ''}`}
        onClick={feedPet}
        disabled={todayFed || feeding}
      >
        {feeding ? '⏳ Кормлю...' : todayFed ? '✅ Покормлен!' : '🍖 Покормить'}
      </button>

      {message && (
        <div className={`message ${evolved ? 'message-evolved' : ''}`}>
          {message}
        </div>
      )}

      <div className="progress">
        <div className="progress-label">
          {pair.stage.name} → {getNextStage(pair.growthPoints)}
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${getProgress(pair.growthPoints)}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}

// Вспомогательные функции
function getNextStage(points) {
  const stages = [
    { name: 'Малыш', min: 50 },
    { name: 'Подросток', min: 200 },
    { name: 'Взрослый', min: 500 },
    { name: 'Легенда', min: 1000 },
  ];
  for (const s of stages) {
    if (points < s.min) return s.name;
  }
  return 'Макс!';
}

function getProgress(points) {
  const stages = [0, 50, 200, 500, 1000];
  for (let i = 0; i < stages.length - 1; i++) {
    if (points < stages[i + 1]) {
      return ((points - stages[i]) / (stages[i + 1] - stages[i])) * 100;
    }
  }
  return 100;
}

export default App;
