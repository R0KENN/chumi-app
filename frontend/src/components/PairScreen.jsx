import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';

const API = '/api';

// Уровни питомца
const LEVELS = [
  { level: 1, name: 'Baby',   maxPoints: 30,  bg: ['#FFF8E1','#FFE082'] },
  { level: 2, name: 'Kid',    maxPoints: 100, bg: ['#FFF3D0','#FFD54F'] },
  { level: 3, name: 'Teen',   maxPoints: 150, bg: ['#FFE0CC','#FFB088'] },
  { level: 4, name: 'Adult',  maxPoints: 300, bg: ['#FFD0C0','#FF8A65'] },
  { level: 5, name: 'Legend', maxPoints: 500, bg: ['#FFC0B0','#FF5722'] },
];

function getLevel(totalPoints) {
  let accumulated = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < accumulated + LEVELS[i].maxPoints) {
      return {
        ...LEVELS[i],
        current: totalPoints - accumulated,
        needed: LEVELS[i].maxPoints,
        remaining: (accumulated + LEVELS[i].maxPoints) - totalPoints,
      };
    }
    accumulated += LEVELS[i].maxPoints;
  }
  // Max level
  return { ...LEVELS[LEVELS.length - 1], current: LEVELS[LEVELS.length - 1].maxPoints, needed: LEVELS[LEVELS.length - 1].maxPoints, remaining: 0 };
}

// Задания
const TASKS_TEMPLATE = [
  { key: 'msg_1',       points: 1, ru: 'Отправьте друг другу 1 сообщение', en: 'Send each other 1 message' },
  { key: 'post_2',      points: 2, ru: 'Отправьте в чат по 2 публикации',  en: 'Send 2 posts in chat each' },
  { key: 'photo_video', points: 4, ru: 'Отправляйте друг другу фото или видео', en: 'Send each other a photo or video' },
  { key: 'msg_10',      points: 2, ru: 'Отправьте друг другу 10 сообщений', en: 'Send each other 10 messages' },
];

export default function PairScreen() {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useLang();

  const tg = window.Telegram?.WebApp;
  const userId = String(tg?.initDataUnsafe?.user?.id || localStorage.getItem('test_user_id') || '713156118');

  const [pair, setPair] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [showLevels, setShowLevels] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/pair/${pairId}/${userId}`);
      const data = await res.json();
      if (data.error) { navigate('/'); return; }
      setPair(data);
      setNewName(data.pet_name || '');

      // Load tasks
      const tRes = await fetch(`${API}/daily-tasks/${pairId}/${userId}`);
      const tData = await tRes.json();
      setTasks(tData.tasks || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pairId, userId, navigate]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="streak-loading">Loading...</div>;
  }

  if (!pair) {
    return <div className="streak-loading">Pair not found</div>;
  }

  const lv = getLevel(pair.growth_points || 0);
  const progressPct = Math.min(100, (lv.current / lv.needed) * 100);
  const bgGrad = `linear-gradient(180deg, ${lv.bg[0]} 0%, ${lv.bg[1]} 100%)`;

  // Members
  const partner = pair.members?.find(m => String(m.user_id) !== userId);
  const me = pair.members?.find(m => String(m.user_id) === userId);

  // Merge tasks with template
  const mergedTasks = TASKS_TEMPLATE.map(tmpl => {
    const done = tasks.find(t => t.task_key === tmpl.key && t.completed);
    return { ...tmpl, completed: !!done };
  });

  const handleRename = async () => {
    if (!newName.trim()) return;
    try {
      await fetch(`${API}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, pet_name: newName.trim() })
      });
      setPair(prev => ({ ...prev, pet_name: newName.trim() }));
      setRenaming(false);
    } catch (e) { console.error(e); }
  };

  const handleCompleteTask = async (taskKey) => {
    try {
      const res = await fetch(`${API}/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId, taskKey })
      });
      const data = await res.json();
      if (!data.error) {
        load(); // reload pair + tasks
      }
    } catch (e) { console.error(e); }
  };

  // Pet image based on level
  const petImage = `/pets/${pair.pet_type || 'muru'}_${Math.min(lv.level - 1, 3)}.png`;

  return (
    <div className="streak-screen" style={{ background: bgGrad }}>

      {/* Header */}
      <div className="streak-header">
        <div className="streak-header-left">
          <div className="streak-label">{lang === 'ru' ? 'Дней Серии' : 'Streak Days'}</div>
          <div className="streak-count">{pair.streak_days || 0}</div>
        </div>
        <div className="streak-header-right">
          <button className="streak-menu-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
          <div className="streak-avatars">
            <div className="streak-avatar">{me?.display_name?.[0] || '👤'}</div>
            <div className="streak-avatar partner">{partner?.display_name?.[0] || '👤'}</div>
          </div>
        </div>
      </div>

      {/* Menu dropdown */}
      {showMenu && (
        <div className="streak-dropdown">
          <button onClick={() => { setRenaming(true); setShowMenu(false); }}>
            ✏️ {lang === 'ru' ? 'Изменить имя' : 'Edit name'}
          </button>
          <button onClick={() => { navigator.clipboard.writeText(pairId); setShowMenu(false); }}>
            📋 {lang === 'ru' ? 'Копировать код' : 'Copy code'}
          </button>
          <button onClick={() => navigate('/')}>
            ↩️ {lang === 'ru' ? 'Мои пары' : 'My pairs'}
          </button>
        </div>
      )}

      {/* Pet display */}
      <div className="streak-pet-area">
        <div className="streak-pet-img">
          <img src={petImage} alt="pet" onError={e => { e.target.src = '/pets/muru_0.png'; }} />
        </div>
      </div>

      {/* Pet name */}
      <div className="streak-pet-name">
        {renaming ? (
          <div className="streak-rename">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              maxLength={20}
              autoFocus
            />
            <button onClick={handleRename}>✓</button>
            <button onClick={() => setRenaming(false)}>✕</button>
          </div>
        ) : (
          <span onClick={() => setRenaming(true)}>
            {pair.pet_name || 'Unnamed'} ✏️
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="streak-progress-wrap" onClick={() => setShowLevels(true)}>
        <div className="streak-progress-bar">
          <div className="streak-progress-fill" style={{ width: `${progressPct}%` }} />
          <span className="streak-progress-text">{lv.current}/{lv.needed}</span>
        </div>
        <div className="streak-progress-hint">
          {lang === 'ru'
            ? `${lv.remaining > 0 ? `Осталось ${lv.remaining} очка до следующего уровня` : 'Максимальный уровень!'}`
            : `${lv.remaining > 0 ? `${lv.remaining} points to next level` : 'Max level!'}`
          } {lv.remaining > 0 ? '›' : ''}
        </div>
      </div>

      {/* Tasks card */}
      <div className="streak-tasks-card">
        <h3>{lang === 'ru' ? 'Растите своего Серийчика' : 'Grow your Streak Pet'}</h3>
        <div className="streak-tasks-list">
          {mergedTasks.map(task => (
            <div
              key={task.key}
              className={`streak-task ${task.completed ? 'done' : ''}`}
              onClick={() => !task.completed && handleCompleteTask(task.key)}
            >
              <div className={`streak-task-icon ${task.completed ? 'completed' : ''}`}>
                {task.completed ? '✅' : '⭐'}
              </div>
              <div className="streak-task-info">
                <div className="streak-task-text">{lang === 'ru' ? task.ru : task.en}</div>
                <div className="streak-task-points">+{task.points} {lang === 'ru' ? 'очка роста' : 'growth points'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Levels popup */}
      {showLevels && (
        <div className="streak-popup-overlay" onClick={() => setShowLevels(false)}>
          <div className="streak-popup" onClick={e => e.stopPropagation()}>
            <h3>{lang === 'ru' ? 'Уровни' : 'Levels'}</h3>
            {LEVELS.map(l => (
              <div key={l.level} className={`streak-level-row ${l.level === lv.level ? 'active' : ''}`}>
                <span className="streak-level-badge">{l.level}</span>
                <span className="streak-level-name">{l.name}</span>
                <span className="streak-level-pts">{l.maxPoints} pts</span>
              </div>
            ))}
            <button onClick={() => setShowLevels(false)}>
              {lang === 'ru' ? 'Закрыть' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
