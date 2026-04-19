import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';

const API = '/api';

const LEVELS = [
  { level: 0, name: 'Spark',   nameRu: 'Искра',   maxPoints: 30,  bg: ['#FFF8E1','#FFECB3'] },
  { level: 1, name: 'Flame',   nameRu: 'Огонёк',  maxPoints: 70,  bg: ['#FFF3D0','#FFE082'] },
  { level: 2, name: 'Blaze',   nameRu: 'Пламя',   maxPoints: 50,  bg: ['#FFE0CC','#FFB088'] },
  { level: 3, name: 'Fire',    nameRu: 'Костёр',   maxPoints: 150, bg: ['#FFD0C0','#FF8A65'] },
  { level: 4, name: 'Inferno', nameRu: 'Инферно', maxPoints: 200, bg: ['#FFC0B0','#FF5722'] },
];

const TASKS = [
  { key: 'daily_open',   points: 1, ru: 'Зайти в приложение',               en: 'Open the app',                 icon: '📱', action: 'auto' },
  { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'inline' },
  { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'inline' },
  { key: 'send_media',   points: 4, ru: 'Отправить партнёру фото или видео', en: 'Send partner a photo or video', icon: '📸', action: 'inline' },
  { key: 'pet_touch',    points: 1, ru: 'Погладить питомца',                 en: 'Pet your flame',                icon: '🔥', action: 'pet' },
];

function getLevel(totalPoints) {
  let acc = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < acc + LEVELS[i].maxPoints) {
      return { ...LEVELS[i], current: totalPoints - acc, needed: LEVELS[i].maxPoints, remaining: acc + LEVELS[i].maxPoints - totalPoints };
    }
    acc += LEVELS[i].maxPoints;
  }
  const last = LEVELS[LEVELS.length - 1];
  return { ...last, current: last.maxPoints, needed: last.maxPoints, remaining: 0 };
}

export default function PairScreen() {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { lang } = useLang();
  const tg = window.Telegram?.WebApp;
  const userId = String(tg?.initDataUnsafe?.user?.id || localStorage.getItem('chumi_test_uid') || '713156118');

  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [showLevels, setShowLevels] = useState(false);
  const [petAnim, setPetAnim] = useState(false);
  const [avatars, setAvatars] = useState({});

  // Задание, которое ждёт завершения после возврата из inline
  const pendingTaskRef = useRef(null);

  const completeTask = useCallback(async (taskKey) => {
    try {
      const res = await fetch(`${API}/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId, taskKey }),
      });
      const data = await res.json();
      return !data.error;
    } catch (e) {
      console.error('complete-task error:', e);
      return false;
    }
  }, [pairId, userId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/pair/${pairId}/${userId}`);
      const data = await res.json();
      if (data.error) { navigate('/'); return; }
      setPair(data);
      setNewName(data.pet_name || '');

      // Auto-complete daily_open
      const alreadyOpened = data.daily_tasks?.some(t => t.task_key === 'daily_open');
      if (!alreadyOpened) {
        await completeTask('daily_open');
        const r2 = await fetch(`${API}/pair/${pairId}/${userId}`);
        const d2 = await r2.json();
        if (!d2.error) setPair(d2);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pairId, userId, navigate, completeTask]);

  useEffect(() => { load(); }, [load]);

  // ──────────────────────────────────────────
  // При возврате в приложение — завершить pending задание
  // ──────────────────────────────────────────
  useEffect(() => {
    const finishPending = async () => {
      if (pendingTaskRef.current) {
        const taskKey = pendingTaskRef.current;
        pendingTaskRef.current = null;
        await completeTask(taskKey);
        load();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') finishPending();
    };

    document.addEventListener('visibilitychange', onVisible);
    tg?.onEvent?.('activated', finishPending);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      tg?.offEvent?.('activated', finishPending);
    };
  }, [completeTask, load, tg]);

  // ──────────────────────────────────────────
  // Аватарки — загрузка через прокси (для мобильных)
  // ──────────────────────────────────────────
  useEffect(() => {
    if (!pair?.members) return;

    pair.members.forEach(async (m) => {
      // Если avatar_url уже есть от сервера — попробуем через прокси
      // Прямые ссылки на api.telegram.org блокируются на мобильных
      try {
        const res = await fetch(`${API}/avatar/${m.user_id}`);
        const data = await res.json();
        if (data.avatar_url) {
          setAvatars(prev => ({ ...prev, [m.user_id]: data.avatar_url }));
        }
      } catch (e) {
        console.error('Avatar load error:', e);
      }
    });
  }, [pair?.members]);

  if (loading) return <div className="streak-loading">{lang === 'ru' ? 'Загрузка...' : 'Loading...'}</div>;
  if (!pair) return <div className="streak-loading">{lang === 'ru' ? 'Не найдено' : 'Not found'}</div>;

  const lv = getLevel(pair.growth_points || 0);
  const pct = Math.min(100, (lv.current / lv.needed) * 100);
  const bg = `linear-gradient(180deg, ${lv.bg[0]} 0%, ${lv.bg[1]} 100%)`;
  const partner = pair.members?.find(m => m.user_id !== userId);

  const mergedTasks = TASKS.map(t => ({
    ...t,
    completed: pair.daily_tasks?.some(dt => dt.task_key === t.key) || false,
  }));
  const donePoints = mergedTasks.filter(t => t.completed).reduce((s, t) => s + t.points, 0);
  const totalPoints = TASKS.reduce((s, t) => s + t.points, 0);

  const haptic = (type = 'medium') => {
    try { tg?.HapticFeedback?.impactOccurred(type); } catch (e) {}
  };

  // ──────────────────────────────────────────
  // Нажатие на задание
  // ──────────────────────────────────────────
  const handleTask = async (task) => {
    // Если уже выполнено — ничего не делаем
    if (task.completed) {
      haptic('light');
      return;
    }

    // === Inline задания (открывают выбор чата) ===
    if (task.action === 'inline') {
      if (!tg?.switchInlineQuery) {
        // Fallback: если switchInlineQuery не поддерживается
        haptic('warning');
        tg?.showAlert?.(
          lang === 'ru'
            ? 'Обновите Telegram для выполнения этого задания'
            : 'Update Telegram to complete this task'
        );
        return;
      }

      haptic('light');

      // Запоминаем задание — завершим при возврате
      pendingTaskRef.current = task.key;

      // Открываем выбор чата с inline query
      // choose_chat_types: ['users'] — только личные чаты
      tg.switchInlineQuery('', ['users']);
      return;
    }

    // === Погладить питомца ===
    if (task.action === 'pet') {
      haptic('medium');
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 800);
      await completeTask(task.key);
      load();
      return;
    }
  };

  const handlePetClick = () => {
    haptic('medium');
    const petTask = mergedTasks.find(t => t.key === 'pet_touch');
    if (petTask && !petTask.completed) {
      handleTask(petTask);
    } else {
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 800);
    }
  };

  const handleRename = async () => {
    if (!newName.trim()) return;
    await fetch(`${API}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairId, pet_name: newName.trim() }),
    });
    setPair(p => ({ ...p, pet_name: newName.trim() }));
    setRenaming(false);
  };

  const petImage = `/pets/${pair.pet_type || 'spark'}_${Math.min(lv.level, 4)}.png`;

  return (
    <div className="streak-screen" style={{ background: bg }}>
      {/* Header */}
      <div className="streak-header">
        <div className="streak-header-left">
          <div className="streak-label">{lang === 'ru' ? 'Дней Серии' : 'Streak Days'}</div>
          <div className="streak-count">{pair.streak_days || 0}</div>
        </div>
        <div className="streak-header-right">
          <button className="streak-menu-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
          <div className="streak-avatars">
            <div className="streak-avatar">
              {avatars[userId]
                ? <img src={avatars[userId]} alt="" onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='inline'); }} />
                : null}
              <span style={avatars[userId] ? {display:'none'} : {}}>👤</span>
            </div>
            <div className="streak-avatar partner">
              {partner && avatars[partner.user_id]
                ? <img src={avatars[partner.user_id]} alt="" onError={e => { e.target.style.display='none'; e.target.nextSibling && (e.target.nextSibling.style.display='inline'); }} />
                : null}
              <span style={partner && avatars[partner.user_id] ? {display:'none'} : {}}>👤</span>
            </div>
          </div>
        </div>
      </div>

      {showMenu && (
        <div className="streak-dropdown" onClick={() => setShowMenu(false)}>
          <button onClick={() => { setRenaming(true); setShowMenu(false); }}>
            ✏️ {lang === 'ru' ? 'Изменить имя' : 'Edit name'}
          </button>
          <button onClick={() => { navigator.clipboard.writeText(pairId); }}>
            📋 {lang === 'ru' ? 'Копировать код' : 'Copy code'}
          </button>
          <button onClick={() => navigate('/')}>
            ↩️ {lang === 'ru' ? 'Мои пары' : 'My pairs'}
          </button>
        </div>
      )}

      <div className="streak-pet-area" onClick={handlePetClick}>
        <div className={`streak-pet-img ${petAnim ? 'pet-bounce' : ''}`}>
          <img src={petImage} alt="pet" onError={e => { e.target.outerHTML = '<div style="font-size:120px">🔥</div>'; }} />
        </div>
      </div>

      <div className="streak-pet-name">
        {renaming ? (
          <div className="streak-rename">
            <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={20} autoFocus />
            <button onClick={handleRename}>✓</button>
            <button onClick={() => setRenaming(false)}>✕</button>
          </div>
        ) : (
          <span onClick={() => setRenaming(true)}>
            {pair.pet_name || (lang === 'ru' ? 'Без имени' : 'Unnamed')} ✏️
          </span>
        )}
      </div>

      <div className="streak-progress-wrap" onClick={() => setShowLevels(true)}>
        <div className="streak-progress-bar">
          <div className="streak-progress-fill" style={{ width: `${pct}%` }} />
          <span className="streak-progress-text">{lv.current}/{lv.needed}</span>
        </div>
        <div className="streak-progress-hint">
          {lv.remaining > 0
            ? (lang === 'ru' ? `Осталось ${lv.remaining} очков до следующего уровня` : `${lv.remaining} points to next level`)
            : (lang === 'ru' ? 'Максимальный уровень!' : 'Max level!')} {lv.remaining > 0 ? '›' : ''}
        </div>
      </div>

      {/* Tasks */}
      <div className="streak-tasks-card">
        <div className="streak-tasks-header">
          <h3>{lang === 'ru' ? 'Растите своего Серийчика' : 'Grow your Streak Pet'}</h3>
          <span className="streak-tasks-counter">{donePoints}/{totalPoints}</span>
        </div>
        <div className="streak-tasks-list">
          {mergedTasks.map(task => (
            <div
              key={task.key}
              className={`streak-task ${task.completed ? 'done' : ''}`}
              onClick={() => handleTask(task)}
              style={task.completed ? { opacity: 0.6, pointerEvents: 'none' } : { cursor: 'pointer' }}
            >
              <div className={`streak-task-icon ${task.completed ? 'completed' : ''}`}>
                {task.completed ? '✅' : task.icon}
              </div>
              <div className="streak-task-info">
                <div className="streak-task-text">
                  {lang === 'ru' ? task.ru : task.en}
                </div>
                <div className="streak-task-points" style={task.completed ? { color: '#4CAF50', fontWeight: 600 } : {}}>
                  {task.completed
                    ? (lang === 'ru' ? 'Выполнено ✓' : 'Completed ✓')
                    : `+${task.points} ${lang === 'ru' ? 'очков роста' : 'growth pts'}`
                  }
                </div>
              </div>
              {!task.completed && task.action === 'inline' && <div className="streak-task-arrow">›</div>}
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
                <span className="streak-level-name">{lang === 'ru' ? l.nameRu : l.name}</span>
                <span className="streak-level-pts">{l.maxPoints} pts</span>
              </div>
            ))}
            <button onClick={() => setShowLevels(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
