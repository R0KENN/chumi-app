import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { usePairs } from '../context/PairsContext';

const API = '/api';
const ADMIN_IDS = ['713156118'];
const BOT_USERNAME = 'ChumiPetBot';

const LEVELS = [
  { level: 0, name: 'Spark',  nameRu: 'Искра',   maxPoints: 30,  bg: ['#FFF8E1','#FFE082'], accent: '#F5A623', check: '#F5A623' },
  { level: 1, name: 'Flame',  nameRu: 'Огонёк',  maxPoints: 70,  bg: ['#FFE0B2','#FFB74D'], accent: '#FB8C00', check: '#FB8C00' },
  { level: 2, name: 'Blaze',  nameRu: 'Пламя',   maxPoints: 50,  bg: ['#E8D5F5','#B39DDB'], accent: '#7C4DFF', check: '#7C4DFF' },
  { level: 3, name: 'Fire',   nameRu: 'Костёр',   maxPoints: 150, bg: ['#BBDEFB','#64B5F6'], accent: '#1E88E5', check: '#1E88E5' },
  { level: 4, name: 'Inferno',nameRu: 'Инферно', maxPoints: 200, bg: ['#B2DFDB','#4DB6AC'], accent: '#00897B', check: '#00897B' },
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
  const { pairs, refreshPairs } = usePairs();
  const tg = window.Telegram?.WebApp;
  const userId = String(tg?.initDataUnsafe?.user?.id || localStorage.getItem('chumi_test_uid') || '713156118');
  const isAdmin = ADMIN_IDS.includes(userId);

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
  const [showMyPairs, setShowMyPairs] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingTab, setRankingTab] = useState('top'); // 'top' | 'random'
  const [ranking, setRanking] = useState([]);
  const [randomRanking, setRandomRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingAvatars, setRankingAvatars] = useState({});
  const [expandedRankingName, setExpandedRankingName] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const petName = pair?.pet_name || (lang === 'ru' ? 'питомца' : 'pet');
  const hasParter = pair?.member_count >= 2;

  // One-time task check
  const addToHomeDone = pair?.one_time_tasks?.some(t => t.task_key === 'add_to_home') || false;

  const TASKS = [
    { key: 'daily_open',   points: 1, ru: 'Зайти в приложение',               en: 'Open the app',                 icon: '📱', action: 'auto' },
    { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'chat' },
    { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'chat' },
    { key: 'send_media',   points: 4, ru: 'Отправить партнёру фото или видео', en: 'Send partner a photo or video', icon: '📸', action: 'chat' },
    { key: 'pet_touch',    points: 1, ru: `Тапнуть ${petName}`,                en: `Tap ${petName}`,                icon: '👆', action: 'pet' },
  ];

  const completeTask = useCallback(async (taskKey) => {
    try {
      const res = await fetch(`${API}/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId, taskKey }),
      });
      const data = await res.json();
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
      // Auto-complete daily_open only if pair has 2 members
      if (data.member_count >= 2) {
        const alreadyOpened = data.daily_tasks?.some(t => t.task_key === 'daily_open');
        if (!alreadyOpened) {
          await completeTask('daily_open');
          const r2 = await fetch(`${API}/pair/${pairId}/${userId}`);
          const d2 = await r2.json();
          if (!d2.error) setPair(d2);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pairId, userId, navigate, completeTask]);

  useEffect(() => { load(); }, [load]);

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

  // ── Load avatars for ranking entries ──
  const loadRankingAvatars = (entries) => {
    const allMemberIds = new Set();
    entries.forEach(r => {
      if (r.members) r.members.forEach(m => allMemberIds.add(m.user_id));
    });
    allMemberIds.forEach(async (uid) => {
      if (rankingAvatars[uid]) return;
      try {
        const ares = await fetch(`${API}/avatar/${uid}`);
        const adata = await ares.json();
        if (adata.avatar_url) setRankingAvatars(prev => ({ ...prev, [uid]: adata.avatar_url }));
      } catch (e) {}
    });
  };

  const loadRanking = async () => {
    setRankingLoading(true);
    try {
      const [topRes, rndRes] = await Promise.all([
        fetch(`${API}/ranking`),
        fetch(`${API}/ranking-random`),
      ]);
      const topData = await topRes.json();
      const rndData = await rndRes.json();
      if (topData.ranking) { setRanking(topData.ranking); loadRankingAvatars(topData.ranking); }
      if (rndData.ranking) { setRandomRanking(rndData.ranking); loadRankingAvatars(rndData.ranking); }
    } catch (e) { console.error('ranking err:', e); }
    finally { setRankingLoading(false); }
  };

  // ── Delete pair ──
  const handleDeletePair = async () => {
    setDeleting(true);
    try {
      await fetch(`${API}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairId, userId }),
      });
      if (refreshPairs) refreshPairs();
      navigate('/');
    } catch (e) { console.error('delete err:', e); }
    finally { setDeleting(false); }
  };

  if (loading) return <div className="sk-loading"><div className="sk-spinner" /></div>;
  if (!pair) return <div className="sk-loading">{lang === 'ru' ? 'Не найдено' : 'Not found'}</div>;

  const lv = getLevel(pair.growth_points || 0);
  const pct = Math.min(100, (lv.current / lv.needed) * 100);
  const partner = pair.members?.find(m => m.user_id !== userId);
  const isMaxLevel = lv.idx === LEVELS.length - 1 && lv.remaining === 0;

  const mergedTasks = TASKS.map(t => ({
    ...t,
    completed: pair.daily_tasks?.some(dt => dt.task_key === t.key) || false,
  }));

  // Add one-time task if not done yet
  const allTasks = [...mergedTasks];
  if (!addToHomeDone) {
    allTasks.push({
      key: 'add_to_home',
      points: 3,
      ru: 'Добавить на главный экран',
      en: 'Add to Home Screen',
      icon: '📌',
      action: 'add_home',
      completed: false,
      oneTime: true,
    });
  }

  const doneCount = allTasks.filter(t => t.completed).length;
  const totalCount = allTasks.length;

  const haptic = (type = 'medium') => {
    try { tg?.HapticFeedback?.impactOccurred(type); } catch (e) {}
  };

  const handleTask = (task) => {
    if (task.completed || completing) return;
    haptic('light');

    if (task.action === 'add_home') {
      // One-time: add to home screen
      if (tg?.addToHomeScreen) {
        tg.addToHomeScreen();
      }
      setCompleting(true);
      completeTask('add_to_home').then(() => load()).finally(() => setCompleting(false));
      return;
    }

    if (task.action === 'chat') { setConfirmTask(task); return; }
    if (task.action === 'pet') {
      haptic('medium');
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 800);
      setCompleting(true);
      completeTask(task.key).then(() => load()).finally(() => setCompleting(false));
    }
  };

  const confirmAndOpenChat = async () => {
    if (!confirmTask || completing) return;
    const taskKey = confirmTask.key;
    const uname = partner?.username;
    setCompleting(true);
    await completeTask(taskKey);
    await load();
    setConfirmTask(null);
    setCompleting(false);
    if (uname) {
      const link = `https://t.me/${uname}`;
      try {
        if (tg?.openTelegramLink) tg.openTelegramLink(link);
        else window.open(link, '_blank');
      } catch (e) { console.error('openTelegramLink error:', e); }
    }
  };

  const completeWithoutPartner = async () => {
    if (!confirmTask || completing) return;
    setCompleting(true);
    await completeTask(confirmTask.key);
    await load();
    setConfirmTask(null);
    setCompleting(false);
  };

  const handlePetClick = () => {
    if (!hasParter) return;
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

  const myPairsData = pairs || [];
  const maxPairs = isAdmin ? 999 : 3;
  const canAddPair = isAdmin || myPairsData.length < maxPairs;

  const handleAddPair = () => {
    if (canAddPair) {
      navigate('/');
    } else {
      const openPayment = async () => {
        try {
          const res = await fetch(`${API}/create-invoice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, productId: 'extra_slot' }),
          });
          const data = await res.json();
          if (data.invoiceUrl && tg?.openInvoice) {
            tg.openInvoice(data.invoiceUrl, (status) => {
              if (status === 'paid') { haptic('heavy'); setShowMyPairs(false); }
            });
          } else if (data.invoiceUrl) {
            window.open(data.invoiceUrl, '_blank');
          }
        } catch (e) { console.error('Invoice error:', e); }
      };
      openPayment();
    }
  };

  const handleShareInvite = () => {
    const link = `https://t.me/${BOT_USERNAME}?start=join_${pairId}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(lang === 'ru' ? '🔥 Присоединяйся к Chumi!' : '🔥 Join Chumi!')}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
    else window.open(shareUrl, '_blank');
  };

  // Active ranking data
  const activeRanking = rankingTab === 'top' ? ranking : randomRanking;

  return (
    <div className="sk" style={{ background: `linear-gradient(180deg, ${lv.bg[0]} 0%, ${lv.bg[1]} 60%, #f5f5f5 100%)` }}>

      {/* ── Имя питомца ── */}
      <div className="sk-pet-name-row">
        {renaming ? (
          <div className="sk-rename-inline">
            <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={20} autoFocus
              onKeyDown={e => e.key === 'Enter' && handleRename()} />
            <button onClick={handleRename}>✓</button>
          </div>
        ) : (
          <span className="sk-pet-name-label" onClick={() => { setNewName(pair.pet_name || ''); setRenaming(true); }}>
            {pair.pet_name || (lang === 'ru' ? 'Без имени' : 'Unnamed')}
            <span className="sk-edit-pencil">✏️</span>
          </span>
        )}
      </div>

      {/* ── Info row: streak | avatars | ••• ── */}
      <div className="sk-info-row">
        <div className="sk-info-row-left">
          <div className="sk-streak-badge">
            <span className="sk-streak-fire">🔥</span>
            <span className="sk-streak-num">{pair.streak_days || 0}</span>
            <span className="sk-streak-label">{lang === 'ru' ? 'дн.' : 'days'}</span>
          </div>
        </div>
        <div className="sk-info-row-right">
          <div className="sk-avatars">
            <div className="sk-ava glass-circle">
              {avatars[userId] ? <img src={avatars[userId]} alt="" onError={e => e.target.style.display='none'} /> : <span>👤</span>}
            </div>
            <div className="sk-ava sk-ava-partner glass-circle">
              {partner && avatars[partner.user_id] ? <img src={avatars[partner.user_id]} alt="" onError={e => e.target.style.display='none'} /> : <span>👤</span>}
            </div>
          </div>
          <button className="sk-topbar-btn" onClick={() => setShowMenu(!showMenu)}>•••</button>
        </div>
      </div>

      {/* ── Menu ── */}
      {showMenu && (
        <div className="sk-menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="sk-menu glass-card" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setRenaming(true); setShowMenu(false); }}>✏️ {lang === 'ru' ? 'Изменить имя' : 'Edit name'}</button>
            <button onClick={() => { navigator.clipboard?.writeText(pairId); setShowMenu(false); haptic('light'); }}>📋 {lang === 'ru' ? 'Копировать код' : 'Copy code'}</button>
            <button onClick={() => { setShowMyPairs(true); setShowMenu(false); }}>🔥 {lang === 'ru' ? 'Мои пары' : 'My pairs'}</button>
            <button onClick={() => { loadRanking(); setShowRanking(true); setShowMenu(false); }}>🏆 {lang === 'ru' ? 'Рейтинг' : 'Ranking'}</button>
            <button onClick={async () => {
              if (tg?.addToHomeScreen) { tg.addToHomeScreen(); haptic('light'); }
              setShowMenu(false);
            }}>📌 {lang === 'ru' ? 'На главный экран' : 'Add to Home Screen'}</button>
            <button onClick={async () => {
              try {
                const res = await fetch(`${API}/prepare-share`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId, pairCode: pairId,
                    text: lang === 'ru'
                      ? `🔥 Растим огонёк "${pair.pet_name || 'Chumi'}" уже ${pair.streak_days || 0} дней подряд!`
                      : `🔥 Growing "${pair.pet_name || 'Chumi'}" for ${pair.streak_days || 0} days!`,
                  }),
                });
                const data = await res.json();
                if (data.prepared_message_id && tg?.shareMessage) {
                  tg.shareMessage(data.prepared_message_id, (sent) => { if (sent) haptic('heavy'); });
                } else {
                  const link = `https://t.me/${BOT_USERNAME}?start=join_${pairId}`;
                  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Присоединяйся к Chumi! 🔥')}`;
                  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
                  else window.open(shareUrl, '_blank');
                }
              } catch (e) { console.error('Share error:', e); }
              setShowMenu(false);
            }}>📤 {lang === 'ru' ? 'Поделиться' : 'Share'}</button>
            <button className="sk-menu-danger" onClick={() => { setShowDeleteConfirm(true); setShowMenu(false); }}>
              🗑️ {lang === 'ru' ? 'Удалить пару' : 'Delete pair'}
            </button>
          </div>
        </div>
      )}

      {/* ── Waiting for partner (нет партнёра → нельзя расти) ── */}
      {!hasParter ? (
        <div className="sk-waiting-partner">
          <div className="sk-waiting-emoji">🔥</div>
          <div className="sk-waiting-title">{lang === 'ru' ? 'Ожидаем партнёра' : 'Waiting for partner'}</div>
          <div className="sk-waiting-desc">
            {lang === 'ru'
              ? 'Растить Серийчика можно только в паре! Отправь код партнёру или поделись ссылкой.'
              : 'You need a partner to grow your Streak Pet! Share the code or invite link.'}
          </div>
          <div className="sk-waiting-code" onClick={() => { navigator.clipboard?.writeText(pairId); haptic('light'); }}>
            {pairId}
            <span className="sk-waiting-code-copy">📋</span>
          </div>
          <button className="sk-waiting-btn" style={{ background: lv.accent }} onClick={handleShareInvite}>
            {lang === 'ru' ? '📤 Пригласить партнёра' : '📤 Invite partner'}
          </button>
        </div>
      ) : (
        <>
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
            <div className="sk-outfits-icon">
              <span>🔥</span><span>👕</span>
            </div>
            <span className="sk-outfits-text">{showSoon ? (lang === 'ru' ? 'Скоро!' : 'Soon!') : (lang === 'ru' ? 'Наряды' : 'Outfits')}</span>
          </div>

          {/* ── Progress ── */}
          <div className="sk-progress-wrap" onClick={() => setShowLevels(true)}>
            <div className="sk-progress glass-bar">
              <div className="sk-progress-fill" style={{ width: `${pct}%`, background: lv.accent }} />
              <span className="sk-progress-text">{lv.current}/{lv.needed}</span>
            </div>
            {isMaxLevel && (
              <div className="sk-progress-hint">
                {lang === 'ru' ? 'Скоро появится больше образов' : 'More outfits coming soon'} ›
              </div>
            )}
          </div>

          {/* ── Tasks ── */}
          <div className="sk-tasks glass-card">
            <div className="sk-tasks-top">
              <h3>{lang === 'ru' ? 'Растите своего Серийчика' : 'Grow your Streak Pet'}</h3>
              <span className="sk-tasks-count" style={{ color: lv.accent, background: lv.accent + '18' }}>{doneCount}/{totalCount}</span>
            </div>
            {allTasks.map(task => (
              <div key={task.key} className={`sk-task ${task.completed ? 'sk-task-done' : ''}`} onClick={() => handleTask(task)}>
                <div className="sk-task-check" style={task.completed ? { background: lv.check, borderColor: lv.check } : { borderColor: lv.check + '40' }}>
                  {task.completed && <span>✓</span>}
                </div>
                <div className="sk-task-body">
                  <div className="sk-task-title">
                    {lang === 'ru' ? task.ru : task.en}
                    {task.oneTime && <span className="sk-task-badge">{lang === 'ru' ? 'Разовое' : 'Once'}</span>}
                  </div>
                  <div className="sk-task-pts" style={{ color: task.completed ? '#4CAF50' : lv.accent }}>
                    {task.completed ? (lang === 'ru' ? 'Выполнено ✓' : 'Done ✓') : `+${task.points} ${lang === 'ru' ? 'очка роста' : 'growth pts'}`}
                  </div>
                </div>
                {!task.completed && task.action === 'chat' && <div className="sk-task-go">›</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Confirm Chat Task Popup ── */}
      {confirmTask && (
        <div className="sk-overlay" onClick={() => setConfirmTask(null)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>{confirmTask.icon || '💬'}</div>
            <h3 style={{ marginBottom: 8 }}>{lang === 'ru' ? confirmTask.ru : confirmTask.en}</h3>
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              {TASK_HINTS[confirmTask.key]?.[lang] || TASK_HINTS[confirmTask.key]?.ru}
            </p>
            {partner ? (
              <button onClick={confirmAndOpenChat} disabled={completing} className="sk-btn-primary"
                style={{ background: completing ? '#ccc' : lv.accent }}>
                {completing ? (lang === 'ru' ? 'Засчитываем...' : 'Completing...')
                  : (lang === 'ru' ? `💬 Открыть чат${partner.display_name ? ` с ${partner.display_name}` : ''}` : `💬 Open chat${partner.display_name ? ` with ${partner.display_name}` : ''}`)}
              </button>
            ) : (
              <button onClick={completeWithoutPartner} disabled={completing} className="sk-btn-primary"
                style={{ background: completing ? '#ccc' : lv.accent }}>
                {completing ? (lang === 'ru' ? 'Засчитываем...' : 'Completing...') : (lang === 'ru' ? '✓ Выполнить задание' : '✓ Complete task')}
              </button>
            )}
            <button className="sk-popup-close" onClick={() => setConfirmTask(null)}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* ── Delete confirm popup ── */}
      {showDeleteConfirm && (
        <div className="sk-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>🗑️</div>
            <h3>{lang === 'ru' ? 'Удалить пару?' : 'Delete pair?'}</h3>
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
              {lang === 'ru'
                ? 'Серийчик, вся серия и прогресс будут удалены безвозвратно. Партнёр получит уведомление.'
                : 'The pet, streak and all progress will be deleted permanently. Partner will be notified.'}
            </p>
            <button onClick={handleDeletePair} disabled={deleting} className="sk-btn-danger">
              {deleting ? (lang === 'ru' ? 'Удаляем...' : 'Deleting...') : (lang === 'ru' ? '🗑️ Да, удалить' : '🗑️ Yes, delete')}
            </button>
            <button className="sk-popup-close" onClick={() => setShowDeleteConfirm(false)}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* ── Мои пары popup ── */}
      {showMyPairs && (
        <div className="sk-overlay" onClick={() => setShowMyPairs(false)}>
          <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()}>
            <h3>{lang === 'ru' ? 'Мои пары' : 'My pairs'}</h3>
            <div className="sk-pairs-grid">
              {myPairsData.map(p => {
                const plv = getLevel(p.growth_points || 0);
                return (
                  <div key={p.code} className={`sk-pair-card glass-card ${p.code === pairId ? 'sk-pair-card-active' : ''}`}
                    onClick={() => { setShowMyPairs(false); navigate(`/pair/${p.code}`); }}>
                    <div className="sk-pair-card-emoji">{plv.idx >= 3 ? '🔥' : '✨'}</div>
                    <div className="sk-pair-card-name">{p.pet_name || plv.name}</div>
                    <div className="sk-pair-card-info">
                      <span>🔥 {p.streak_days || 0}</span>
                      <span>⭐ {p.growth_points || 0}</span>
                    </div>
                  </div>
                );
              })}
              <div className="sk-pair-card sk-pair-card-add glass-card" onClick={handleAddPair}>
                <div className="sk-pair-card-plus">+</div>
                <div className="sk-pair-card-name" style={{ fontSize: 12 }}>
                  {canAddPair ? (lang === 'ru' ? 'Новая пара' : 'New pair') : (lang === 'ru' ? '50 ⭐ Stars' : '50 ⭐ Stars')}
                </div>
              </div>
            </div>
            {!isAdmin && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 12 }}>
                {myPairsData.length}/{maxPairs} {lang === 'ru' ? 'пар' : 'pairs'}
              </div>
            )}
            <button className="sk-popup-close" onClick={() => setShowMyPairs(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}

      {/* ── Ranking popup (tabs: Топ 100 / Случайно) ── */}
      {showRanking && (
        <div className="sk-overlay" onClick={() => setShowRanking(false)}>
          <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()}>
            <h3>🏆 {lang === 'ru' ? 'Рейтинг' : 'Ranking'}</h3>

            {/* Tabs */}
            <div className="sk-ranking-tabs">
              <button className={`sk-ranking-tab ${rankingTab === 'top' ? 'sk-ranking-tab-active' : ''}`}
                onClick={() => setRankingTab('top')}>
                {lang === 'ru' ? 'Топ 100' : 'Top 100'}
              </button>
              <button className={`sk-ranking-tab ${rankingTab === 'random' ? 'sk-ranking-tab-active' : ''}`}
                onClick={() => setRankingTab('random')}>
                {lang === 'ru' ? 'Случайно' : 'Random'}
              </button>
            </div>

            {rankingLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><div className="sk-spinner" /></div>
            ) : activeRanking.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#888' }}>{lang === 'ru' ? 'Пока нет данных' : 'No data yet'}</p>
            ) : (
              <div className="sk-ranking-list">
                {activeRanking.map((r, i) => (
                  <div key={r.code} className={`sk-ranking-row ${r.code === pairId ? 'sk-ranking-me' : ''}`}
                    onClick={() => setExpandedRankingName(expandedRankingName === r.code ? null : r.code)}>
                    <span className="sk-ranking-pos">
                      {rankingTab === 'top'
                        ? (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`)
                        : `#${i + 1}`}
                    </span>
                    <div className="sk-ranking-avatars">
                      {(r.members || []).map((m) => (
                        <div key={m.user_id} className="sk-ranking-ava">
                          {rankingAvatars[m.user_id]
                            ? <img src={rankingAvatars[m.user_id]} alt="" onError={e => e.target.style.display='none'} />
                            : <span style={{ fontSize: 14 }}>👤</span>}
                        </div>
                      ))}
                      {(!r.members || r.members.length === 0) && (
                        <div className="sk-ranking-ava"><span style={{ fontSize: 14 }}>👤</span></div>
                      )}
                    </div>
                    <span className={expandedRankingName === r.code ? 'sk-ranking-name-full' : 'sk-ranking-name'}>
                      {r.pet_name || 'Unnamed'}
                    </span>
                    <span className="sk-ranking-stats">
                      ⭐{r.growth_points || 0} 🔥{r.streak_days || 0}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button className="sk-popup-close" onClick={() => setShowRanking(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
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
