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
  { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'open_chat' },
  { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'open_chat' },
  { key: 'send_media',   points: 4, ru: 'Отправить партнёру фото или видео', en: 'Send partner a photo or video', icon: '📸', action: 'open_chat' },
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
  const [confirmTask, setConfirmTask] = useState(null); // задание, ожидающее подтверждения

  // Ref для задания, которое надо завершить при возврате из чата
  const pendingChatTask = useRef(null);

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
        await fetch(`${API}/complete-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairId, userId, taskKey: 'daily_open' }),
        });
        const r2 = await fetch(`${API}/pair/${pairId}/${userId}`);
        const d2 = await r2.json();
        if (!d2.error) setPair(d2);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pairId, userId, navigate]);

  useEffect(() => { load(); }, [load]);

  // ──────────────────────────────────────────
  // Когда пользователь возвращается в приложение из чата —
  // помечаем задание выполненным
  // ──────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && pendingChatTask.current) {
        const taskKey = pendingChatTask.current;
        pendingChatTask.current = null;

        try {
          await fetch(`${API}/complete-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: pairId, userId, taskKey }),
          });
          load();
        } catch (e) {
          console.error('Failed to complete task on return:', e);
        }
      }
    };

    // Telegram Mini App 'activated' event (when app comes back to foreground)
    const handleActivated = async () => {
      if (pendingChatTask.current) {
        const taskKey = pendingChatTask.current;
        pendingChatTask.current = null;

        try {
          await fetch(`${API}/complete-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: pairId, userId, taskKey }),
          });
          load();
        } catch (e) {
          console.error('Failed to complete task on activated:', e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    tg?.onEvent?.('activated', handleActivated);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      tg?.offEvent?.('activated', handleActivated);
    };
  }, [pairId, userId, load, tg]);

  // Load avatars
  useEffect(() => {
    if (!pair?.members) return;
    pair.members.forEach(m => {
      if (m.avatar_url) {
        setAvatars(prev => ({ ...prev, [m.user_id]: m.avatar_url }));
      } else {
        fetch(`${API}/avatar/${m.user_id}`)
          .then(r => r.json())
          .then(d => {
            if (d.avatar_url) setAvatars(prev => ({ ...prev, [m.user_id]: d.avatar_url }));
          }).catch(() => {});
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
  // Открыть чат партнёра
  // ──────────────────────────────────────────
  const openPartnerChat = () => {
    const uname = partner?.username;
    if (uname && tg) {
      tg.openTelegramLink(`https://t.me/${uname}`);
    } else if (partner?.user_id && tg) {
      tg.openTelegramLink(`https://t.me/@id${partner.user_id}`);
    } else if (partner?.user_id) {
      window.open(`https://t.me/@id${partner.user_id}`, '_blank');
    }
  };

  // ──────────────────────────────────────────
  // Обработка нажатия на задание
  // ──────────────────────────────────────────
  const handleTask = async (task) => {
    if (task.completed) return;
    haptic('light');

    // === Задания с открытием чата ===
    if (task.action === 'open_chat') {
      if (!partner) {
        // Нет партнёра — показать предупреждение
        tg?.showAlert?.(
          lang === 'ru'
            ? 'Пригласите партнёра, чтобы выполнить это задание!'
            : 'Invite a partner to complete this task!'
        );
        return;
      }

      // Показываем подтверждение: "Отправь сообщение/стикер/фото, потом вернись"
      setConfirmTask(task);
      return;
    }

    // === Погладить питомца ===
    if (task.action === 'pet') {
      haptic('medium');
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 800);
      await fetch(`${API}/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId, taskKey: task.key }),
      });
      load();
    }
  };

  // ──────────────────────────────────────────
  // Подтвердить и открыть чат
  // ──────────────────────────────────────────
  const confirmAndOpenChat = () => {
    if (!confirmTask) return;
    haptic('medium');

    // Запоминаем задание — завершим когда пользователь вернётся
    pendingChatTask.current = confirmTask.key;
    setConfirmTask(null);

    // Открываем чат партнёра
    openPartnerChat();
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

  // Текст подтверждения в зависимости от задания
  const getConfirmText = (task) => {
    if (!task) return '';
    const texts = {
      send_msg: {
        ru: 'Отправь сообщение партнёру в Telegram, затем вернись в приложение — задание засчитается автоматически!',
        en: 'Send a message to your partner in Telegram, then come back — the task will be completed automatically!',
      },
      send_sticker: {
        ru: 'Отправь стикер партнёру в Telegram, затем вернись в приложение — задание засчитается автоматически!',
        en: 'Send a sticker to your partner in Telegram, then come back — the task will be completed automatically!',
      },
      send_media: {
        ru: 'Отправь фото или видео партнёру в Telegram, затем вернись в приложение — задание засчитается автоматически!',
        en: 'Send a photo or video to your partner in Telegram, then come back — the task will be completed automatically!',
      },
    };
    return texts[task.key]?.[lang] || texts[task.key]?.en || '';
  };

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
              {avatars[userId] ? <img src={avatars[userId]} alt="" /> : <span>👤</span>}
            </div>
            <div className="streak-avatar partner">
              {partner && avatars[partner.user_id]
                ? <img src={avatars[partner.user_id]} alt="" />
                : <span>👤</span>}
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
            >
              <div className={`streak-task-icon ${task.completed ? 'completed' : ''}`}>
                {task.completed ? '✅' : task.icon}
              </div>
              <div className="streak-task-info">
                <div className="streak-task-text">{lang === 'ru' ? task.ru : task.en}</div>
                <div className="streak-task-points">
                  {task.completed
                    ? (lang === 'ru' ? 'Выполнено' : 'Completed')
                    : `+${task.points} ${lang === 'ru' ? 'очков роста' : 'growth pts'}`
                  }
                </div>
              </div>
              {!task.completed && task.action === 'open_chat' && <div className="streak-task-arrow">›</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Confirm Chat Task Popup ── */}
      {confirmTask && (
        <div className="streak-popup-overlay" onClick={() => setConfirmTask(null)}>
          <div className="streak-popup confirm-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>
              {confirmTask.icon}
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px' }}>
              {lang === 'ru' ? confirmTask.ru : confirmTask.en}
            </h3>
            <p style={{ color: '#666', fontSize: '14px', lineHeight: '1.4', margin: '0 0 20px' }}>
              {getConfirmText(confirmTask)}
            </p>
            <button
              onClick={confirmAndOpenChat}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #FF9800, #FF5722)',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                marginBottom: '8px',
              }}
            >
              {lang === 'ru' ? 'Открыть чат' : 'Open chat'} 💬
            </button>
            <button
              onClick={() => setConfirmTask(null)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '12px',
                border: 'none',
                background: '#f0f0f0',
                color: '#666',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              {lang === 'ru' ? 'Отмена' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

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
