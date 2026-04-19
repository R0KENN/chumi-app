import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';

const API = '/api';

const LEVELS = [
  { level: 0, name: 'Spark',  nameRu: 'Искра',   maxPoints: 30,  bg: ['#FFF8E1','#FFE082'], accent: '#F5A623', check: '#F5A623' },
  { level: 1, name: 'Flame',  nameRu: 'Огонёк',  maxPoints: 70,  bg: ['#FFE0B2','#FFB74D'], accent: '#FB8C00', check: '#FB8C00' },
  { level: 2, name: 'Blaze',  nameRu: 'Пламя',   maxPoints: 50,  bg: ['#E8D5F5','#B39DDB'], accent: '#7C4DFF', check: '#7C4DFF' },
  { level: 3, name: 'Fire',   nameRu: 'Костёр',   maxPoints: 150, bg: ['#BBDEFB','#64B5F6'], accent: '#1E88E5', check: '#1E88E5' },
  { level: 4, name: 'Inferno',nameRu: 'Инферно', maxPoints: 200, bg: ['#B2DFDB','#4DB6AC'], accent: '#00897B', check: '#00897B' },
];

const TASKS = [
  { key: 'daily_open',   points: 1, ru: 'Зайти в приложение',               en: 'Open the app',                 icon: '📱', action: 'auto' },
  { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'chat' },
  { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'chat' },
  { key: 'send_media',   points: 4, ru: 'Отправить партнёру фото или видео', en: 'Send partner a photo or video', icon: '📸', action: 'chat' },
  { key: 'pet_touch',    points: 1, ru: 'Погладить питомца',                 en: 'Pet your flame',                icon: '🔥', action: 'pet' },
];

function getLevel(totalPoints) {
  let acc = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < acc + LEVELS[i].maxPoints) {
      return { ...LEVELS[i], current: totalPoints - acc, needed: LEVELS[i].maxPoints, remaining: acc + LEVELS[i].maxPoints - totalPoints, idx: i };
    }
    acc += LEVELS[i].maxPoints;
  }
  const last = LEVELS[LEVELS.length - 1];
  return { ...last, current: last.maxPoints, needed: last.maxPoints, remaining: 0, idx: LEVELS.length - 1 };
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
  const [showSoon, setShowSoon] = useState(false);
  const [confirmTask, setConfirmTask] = useState(null);
  const [completing, setCompleting] = useState(false);

  const completeTask = useCallback(async (taskKey) => {
    try {
      const res = await fetch(`${API}/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId, taskKey }),
      });
      const data = await res.json();
      console.log('complete-task response:', taskKey, data);
      return !data.error;
    } catch (e) { console.error('complete-task err:', e); return false; }
  }, [pairId, userId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/pair/${pairId}/${userId}`);
      const data = await res.json();
      if (data.error) { navigate('/'); return; }
      setPair(data);
      setNewName(data.pet_name || '');
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

  // Avatars
  useEffect(() => {
    if (!pair?.members) return;
    pair.members.forEach(async (m) => {
      try {
        const res = await fetch(`${API}/avatar/${m.user_id}`);
        const data = await res.json();
        if (data.avatar_url) setAvatars(prev => ({ ...prev, [m.user_id]: data.avatar_url }));
      } catch (e) {}
    });
  }, [pair?.members]);

  if (loading) return <div className="sk-loading"><div className="sk-spinner" /></div>;
  if (!pair) return <div className="sk-loading">{lang === 'ru' ? 'Не найдено' : 'Not found'}</div>;

  const lv = getLevel(pair.growth_points || 0);
  const pct = Math.min(100, (lv.current / lv.needed) * 100);
  const partner = pair.members?.find(m => m.user_id !== userId);

  const mergedTasks = TASKS.map(t => ({
    ...t,
    completed: pair.daily_tasks?.some(dt => dt.task_key === t.key) || false,
  }));
  const doneCount = mergedTasks.filter(t => t.completed).length;

  const haptic = (type = 'medium') => {
    try { tg?.HapticFeedback?.impactOccurred(type); } catch (e) {}
  };

  // ── Обработка клика по заданию ──
  const handleTask = (task) => {
    if (task.completed || completing) return;
    haptic('light');

    if (task.action === 'chat') {
      setConfirmTask(task);
      return;
    }

    if (task.action === 'pet') {
      haptic('medium');
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 800);
      setCompleting(true);
      completeTask(task.key).then(() => load()).finally(() => setCompleting(false));
    }
  };

  // ── Подтвердить: сначала засчитать, потом открыть чат ──
  const confirmAndOpenChat = async () => {
    if (!confirmTask || completing) return;
    const taskKey = confirmTask.key;
    const uname = partner?.username;
    setCompleting(true);

    // 1. Сразу засчитываем задание
    await completeTask(taskKey);
    await load();
    setConfirmTask(null);
    setCompleting(false);

    // 2. Открываем чат партнёра
    if (uname) {
      const link = `https://t.me/${uname}`;
      try {
        if (tg?.openTelegramLink) {
          tg.openTelegramLink(link);
        } else {
          window.open(link, '_blank');
        }
      } catch (e) {
        console.error('openTelegramLink error:', e);
      }
    }
  };

  // ── Для заданий без партнёра — сразу засчитать ──
  const completeWithoutPartner = async () => {
    if (!confirmTask || completing) return;
    setCompleting(true);
    await completeTask(confirmTask.key);
    await load();
    setConfirmTask(null);
    setCompleting(false);
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

  const TASK_HINTS = {
    send_msg:     { ru: 'Напиши сообщение партнёру в Telegram.\nЗадание будет засчитано, а чат откроется автоматически.',
                    en: 'Write a message to your partner in Telegram.\nThe task will be completed and chat will open.' },
    send_sticker: { ru: 'Отправь стикер партнёру в Telegram.\nЗадание будет засчитано, а чат откроется автоматически.',
                    en: 'Send a sticker to your partner in Telegram.\nThe task will be completed and chat will open.' },
    send_media:   { ru: 'Отправь фото или видео партнёру.\nЗадание будет засчитано, а чат откроется автоматически.',
                    en: 'Send a photo or video to your partner.\nThe task will be completed and chat will open.' },
  };

  return (
    <div className="sk" style={{ background: `linear-gradient(180deg, ${lv.bg[0]} 0%, ${lv.bg[1]} 60%, #f5f5f5 100%)` }}>

      {/* ── Top bar ── */}
      <div className="sk-topbar">
        <div className="sk-topbar-title">
          {renaming ? (
            <div className="sk-rename-inline">
              <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={20} autoFocus
                onKeyDown={e => e.key === 'Enter' && handleRename()} />
              <button onClick={handleRename}>✓</button>
            </div>
          ) : (
            <span onClick={() => { setNewName(pair.pet_name || ''); setRenaming(true); }}>
              {pair.pet_name || (lang === 'ru' ? 'Без имени' : 'Unnamed')} 🔥
            </span>
          )}
        </div>
        <button className="sk-topbar-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
      </div>

      {/* ── Menu ── */}
      {showMenu && (
        <div className="sk-menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="sk-menu" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setRenaming(true); setShowMenu(false); }}>✏️ {lang === 'ru' ? 'Изменить имя' : 'Edit name'}</button>
            <button onClick={() => { navigator.clipboard?.writeText(pairId); setShowMenu(false); haptic('light'); }}>📋 {lang === 'ru' ? 'Копировать код' : 'Copy code'}</button>
            <button onClick={() => navigate('/')}>🔥 {lang === 'ru' ? 'Мои пары' : 'My pairs'}</button>
          </div>
        </div>
      )}

      {/* ── Streak + Avatars ── */}
      <div className="sk-header">
        <div className="sk-streak">
          <div className="sk-streak-label">{lang === 'ru' ? 'Дней Серии' : 'Streak Days'}</div>
          <div className="sk-streak-num">{pair.streak_days || 0}</div>
        </div>
        <div className="sk-avatars">
          <div className="sk-ava">
            {avatars[userId] ? <img src={avatars[userId]} alt="" onError={e => e.target.style.display='none'} /> : <span>👤</span>}
          </div>
          <div className="sk-ava sk-ava-partner">
            {partner && avatars[partner.user_id] ? <img src={avatars[partner.user_id]} alt="" onError={e => e.target.style.display='none'} /> : <span>👤</span>}
          </div>
        </div>
      </div>

      {/* ── Pet ── */}
      <div className="sk-pet-area" onClick={handlePetClick}>
        <img
          src="/pets/flame_idle.webp"
          alt="pet"
          className={`pet-animated ${petAnim ? 'tapped' : ''}`}
          style={{ width: 200, height: 260, objectFit: 'contain' }}
        />
      </div>

      {/* ── Outfits button ── */}
      <div className="sk-outfits-btn" onClick={() => { setShowSoon(true); setTimeout(() => setShowSoon(false), 2000); }}>
        <span>🔥</span><span>👕</span>
        <span className="sk-outfits-text">{showSoon ? (lang === 'ru' ? 'Скоро!' : 'Soon!') : (lang === 'ru' ? 'Наряды' : 'Outfits')}</span>
      </div>

      {/* ── Progress ── */}
      <div className="sk-progress-wrap" onClick={() => setShowLevels(true)}>
        <div className="sk-progress">
          <div className="sk-progress-fill" style={{ width: `${pct}%`, background: lv.accent }} />
          <span className="sk-progress-text">{lv.current}/{lv.needed}</span>
        </div>
        <div className="sk-progress-hint">
          {lang === 'ru' ? 'Скоро появится больше образов' : 'More outfits coming soon'} ›
        </div>
      </div>

      {/* ── Tasks ── */}
      <div className="sk-tasks">
        <div className="sk-tasks-top">
          <h3>{lang === 'ru' ? 'Растите своего Серийчика' : 'Grow your Streak Pet'}</h3>
          <span className="sk-tasks-count" style={{ color: lv.accent, background: lv.accent + '18' }}>{doneCount}/{mergedTasks.length}</span>
        </div>
        {mergedTasks.map(task => (
          <div key={task.key} className={`sk-task ${task.completed ? 'sk-task-done' : ''}`} onClick={() => handleTask(task)}>
            <div className="sk-task-check" style={task.completed ? { background: lv.check, borderColor: lv.check } : { borderColor: lv.check + '40' }}>
              {task.completed && <span>✓</span>}
            </div>
            <div className="sk-task-body">
              <div className="sk-task-title">{lang === 'ru' ? task.ru : task.en}</div>
              <div className="sk-task-pts" style={{ color: task.completed ? '#4CAF50' : lv.accent }}>
                {task.completed ? (lang === 'ru' ? 'Выполнено ✓' : 'Done ✓') : `+${task.points} ${lang === 'ru' ? 'очка роста' : 'growth pts'}`}
              </div>
            </div>
            {!task.completed && task.action === 'chat' && <div className="sk-task-go">›</div>}
          </div>
        ))}
      </div>

      {/* ── Confirm Chat Task Popup ── */}
      {confirmTask && (
        <div className="sk-overlay" onClick={() => setConfirmTask(null)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>
              {confirmTask.icon || '💬'}
            </div>
            <h3 style={{ marginBottom: 8 }}>
              {lang === 'ru' ? confirmTask.ru : confirmTask.en}
            </h3>
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              {TASK_HINTS[confirmTask.key]?.[lang] || TASK_HINTS[confirmTask.key]?.ru}
            </p>

            {partner ? (
              <button
                onClick={confirmAndOpenChat}
                disabled={completing}
                style={{
                  width: '100%', padding: 14, borderRadius: 14,
                  border: 'none', background: completing ? '#ccc' : lv.accent, color: '#fff',
                  fontSize: 16, fontWeight: 700, cursor: completing ? 'wait' : 'pointer', marginBottom: 8,
                }}
              >
                {completing
                  ? (lang === 'ru' ? 'Засчитываем...' : 'Completing...')
                  : (lang === 'ru'
                      ? `💬 Открыть чат${partner.display_name ? ` с ${partner.display_name}` : ''}`
                      : `💬 Open chat${partner.display_name ? ` with ${partner.display_name}` : ''}`)}
              </button>
            ) : (
              <button
                onClick={completeWithoutPartner}
                disabled={completing}
                style={{
                  width: '100%', padding: 14, borderRadius: 14,
                  border: 'none', background: completing ? '#ccc' : lv.accent, color: '#fff',
                  fontSize: 16, fontWeight: 700, cursor: completing ? 'wait' : 'pointer', marginBottom: 8,
                }}
              >
                {completing
                  ? (lang === 'ru' ? 'Засчитываем...' : 'Completing...')
                  : (lang === 'ru' ? '✓ Выполнить задание' : '✓ Complete task')}
              </button>
            )}

            <button className="sk-popup-close" onClick={() => setConfirmTask(null)}>
              {lang === 'ru' ? 'Отмена' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* ── Levels popup ── */}
      {showLevels && (
        <div className="sk-overlay" onClick={() => setShowLevels(false)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <h3>{lang === 'ru' ? 'Уровни' : 'Levels'}</h3>
            {LEVELS.map((l, i) => (
              <div key={l.level} className={`sk-lvl-row ${i === lv.idx ? 'sk-lvl-active' : ''}`}>
                <div className="sk-lvl-badge" style={{ background: l.accent + '22', color: l.accent }}>{l.level}</div>
                <span className="sk-lvl-name">{lang === 'ru' ? l.nameRu : l.name}</span>
                <span className="sk-lvl-pts">{l.maxPoints} pts</span>
              </div>
            ))}
            <button className="sk-popup-close" onClick={() => setShowLevels(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
