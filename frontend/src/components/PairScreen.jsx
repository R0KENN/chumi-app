import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { usePairs } from '../context/PairsContext';
import { getInitData } from '../context/PairsContext';

const API = '/api';
const ADMIN_IDS = ['713156118'];
const BOT_USERNAME = 'ChumiPetBot';


const EGG_VIDEOS = {
  1: '/pets/egg_1.webm',
  2: '/pets/egg_2.webm',
  3: '/pets/egg_3.webm',
};

// ── LEVELS: при изменении порогов синхронизируй с [[path]].js и bot.js ──
const LEVELS = [
  { level: 0, name: 'Egg',    nameRu: 'Яйцо',      maxPoints: 33,  bg: ['#F5F0FF','#E8E0F0'], accent: '#B39DDB', check: '#B39DDB', pet: null,             petTap: null,                 emojiId: null },
  { level: 1, name: 'Baby',   nameRu: 'Малыш',      maxPoints: 45,  bg: ['#F3EDF7','#D7C8E8'], accent: '#9B72CF', check: '#9B72CF', pet: 'axolotl_idle',   petTap: 'axolotl_tap',        emojiId: null },
  { level: 2, name: 'Junior', nameRu: 'Подросток',   maxPoints: 63,  bg: ['#FFF4EC','#FDDCBF'], accent: '#E8985A', check: '#E8985A', pet: 'axolotl_peach',  petTap: 'axolotl_peach_tap',  emojiId: null },
  { level: 3, name: 'Teen',   nameRu: 'Юный',        maxPoints: 90,  bg: ['#FFF0F3','#F9C8D4'], accent: '#E8729A', check: '#E8729A', pet: 'axolotl_pink',   petTap: 'axolotl_pink_tap',   emojiId: null },
  { level: 4, name: 'Adult',  nameRu: 'Взрослый',    maxPoints: 135, bg: ['#EDF5FC','#B8D8F4'], accent: '#4A9AD4', check: '#4A9AD4', pet: 'axolotl_blue',   petTap: 'axolotl_blue_tap',   emojiId: null },
  { level: 5, name: 'Legend', nameRu: 'Легенда',     maxPoints: 200, bg: ['#1A1A2E','#16213E'], accent: '#E94560', check: '#E94560', pet: 'axolotl_black',  petTap: 'axolotl_black_tap',  emojiId: null },
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

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getShareMessages(petName, streak, pairCode, lang) {
  const msg = lang === 'ru' ? {
    send_msg: [
      `🐾 Привет! Давай не сломаем серию в Chumi — уже ${streak} дней подряд!`,
      `💌 Сообщение от твоего партнёра по Chumi! Наш питомец растёт уже ${streak} дней 🐾`,
      `👋 ${petName} ждёт тебя! Серия: ${streak} дней 🐾 Не забудь зайти!`,
      `🐾 ${petName} скучает! Мы на серии ${streak} дней — не сломай!`,
      `💬 Напоминание от ${petName}! Серия ${streak} дней — заходи скорее 🐾`,
    ],
    send_sticker: [
      `🎨 Лови стикер от ${petName}! Растим его уже ${streak} дней 🐾`,
      `✨ ${petName} передаёт привет стикером! ${streak} дней серия 🐾`,
    ],
    send_media: [
      `📸 Фото-привет от партнёра по Chumi! Наша серия: ${streak} дней 🐾`,
      `🐾 Смотри! Мы растим ${petName} уже ${streak} дней подряд!`,
    ],
  } : {
    send_msg: [
      `🐾 Hey! Let's keep our Chumi streak going — ${streak} days!`,
      `💌 Message from your Chumi partner! Our pet is growing for ${streak} days 🐾`,
      `👋 ${petName} is waiting! Streak: ${streak} days 🐾`,
      `🐾 ${petName} misses you! ${streak} day streak — don't break it!`,
    ],
    send_sticker: [
      `🎨 Sticker from ${petName}! Growing our pet for ${streak} days 🐾`,
      `✨ ${petName} says hi with a sticker! ${streak} days streak 🐾`,
    ],
    send_media: [
      `📸 Photo from your Chumi partner! Streak: ${streak} days 🐾`,
      `🐾 Look! Growing ${petName} for ${streak} days!`,
    ],
  };
  return msg;
}


export default function PairScreen() {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const { lang, setLang } = useLang();
  const { pairs, refreshPairs } = usePairs();
  const tg = window.Telegram?.WebApp;
  const userId = String(tg?.initDataUnsafe?.user?.id || localStorage.getItem('chumi_test_uid') || '713156118');
  const isAdmin = ADMIN_IDS.includes(userId);

  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [showLevels, setShowLevels] = useState(false);
  const [petAnim, setPetAnim] = useState(false);
  const [avatars, setAvatars] = useState({});
  const [showSoon, setShowSoon] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showMyPairs, setShowMyPairs] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingTab, setRankingTab] = useState('top');
  const [ranking, setRanking] = useState([]);
  const [randomRanking, setRandomRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [rankingAvatars, setRankingAvatars] = useState({});
  const [expandedRankingName, setExpandedRankingName] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [petTapped, setPetTapped] = useState(false);
  const [maxPairs, setMaxPairs] = useState(3);
  const [showPremium, setShowPremium] = useState(false);
  const [showOutfits, setShowOutfits] = useState(false);
  const [ownedSkins, setOwnedSkins] = useState([]);
  const [referralCount, setReferralCount] = useState(0);
  const [skinsLoading, setSkinsLoading] = useState(false);
  const [premiumActive, setPremiumActive] = useState(false);
  const [premiumExpires, setPremiumExpires] = useState(null);
  const idleVideoRef = useRef(null);
  const tapVideoRef = useRef(null);
  const eggVideoRef = useRef(null);
  const rankingAvatarsRef = useRef({});
  const prevLevelRef = useRef(null);
  const [previewSkin, setPreviewSkin] = useState(undefined);
  const [outfitTab, setOutfitTab] = useState('levels');

  const petName = pair?.pet_name || (lang === 'ru' ? 'питомца' : 'pet');
  const hasPartner = pair?.member_count >= 2;
  const addToHomeDone = pair?.one_time_tasks?.some(t => t.task_key === 'add_to_home') || false;


  const authHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const initData = getInitData();
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    return headers;
  };

  // FIX #8: корректный haptic с поддержкой notification типов
  const haptic = (type = 'medium') => {
    try {
      if (type === 'success' || type === 'error' || type === 'warning') {
        tg?.HapticFeedback?.notificationOccurred(type);
      } else {
        tg?.HapticFeedback?.impactOccurred(type);
      }
    } catch (e) {}
  };

  // ══════ Адаптивные цвета Telegram UI ══════
  useEffect(() => {
    if (!tg || !pair) return;
    const lv = getLevel(pair.growth_points || 0);
    const bgColors = lv.bg;
    const isEggLocal = lv.idx === 0;
    const isDark = !isEggLocal && lv.idx === 5;

    try { tg.setHeaderColor?.(bgColors[0]); } catch (e) {}
    try { tg.setBackgroundColor?.(bgColors[1]); } catch (e) {}
    try { tg.setBottomBarColor?.(isDark ? bgColors[1] : '#f5f5f5'); } catch (e) {}
  }, [tg, pair]);

  // ══════ Emoji Status при повышении уровня ══════
  useEffect(() => {
    if (!tg || !pair) return;
    const lv = getLevel(pair.growth_points || 0);
    if (prevLevelRef.current !== null && lv.idx > prevLevelRef.current && lv.emojiId) {
      if (tg.setEmojiStatus) {
        tg.setEmojiStatus(lv.emojiId, { duration: 3600 }, (ok) => {
          if (ok) console.log('Emoji status set!');
        });
      }
    }
    prevLevelRef.current = lv.idx;
  }, [tg, pair]);

  // ══════ BottomButton — скрываем ══════
  useEffect(() => {
    if (!tg) return;
    const main = tg.MainButton;
    const secondary = tg.SecondaryButton;
    if (main) main.hide();
    if (secondary) secondary.hide();
    return () => {
      if (main) main.hide();
      if (secondary) secondary.hide();
    };
  }, [tg]);


  // ══════ Back Button ══════
  useEffect(() => {
    if (!tg?.BackButton) return;
    tg.BackButton.hide();
  }, [tg]);



  const completeTask = useCallback(async (taskKey) => {
    try {
      const res = await fetch(`${API}/complete-task`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ code: pairId, userId, taskKey }),
      });
      const data = await res.json();
      return !data.error;
    } catch (e) { return false; }
  }, [pairId, userId]);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await fetch(`${API}/pair/${pairId}/${userId}`);
      if (!res.ok) { setLoadError(true); setLoading(false); return; }
      const data = await res.json();
      if (data.error) { navigate('/'); return; }
      setPair(data);
      setNewName(data.pet_name || '');
      if (data.member_count >= 2) {
        const alreadyOpened = data.daily_tasks?.some(t => t.task_key === 'daily_open');
        if (!alreadyOpened) {
          await completeTask('daily_open');
          const r2 = await fetch(`${API}/pair/${pairId}/${userId}`);
          const d2 = await r2.json();
          if (!d2.error) setPair(d2);
        }
      }
    } catch (e) {
      console.error(e);
      setLoadError(true);
    }
    finally { setLoading(false); }
  }, [pairId, userId, navigate, completeTask]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isAdmin) { setMaxPairs(999); return; }
    (async () => {
      try {
        const res = await fetch(`${API}/user-slots/${userId}`);
        const data = await res.json();
        if (data.maxPairs) setMaxPairs(data.maxPairs);
      } catch (e) {}
    })();
  }, [userId, isAdmin]);

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

  // ══════ Premium status ══════
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/premium/${userId}`);
        const data = await res.json();
        setPremiumActive(data.premium || false);
        setPremiumExpires(data.expires_at || null);
      } catch (e) {}
    })();
  }, [userId]);

  const loadRankingAvatars = useCallback((entries) => {
    const ids = new Set();
    entries.forEach(r => { if (r.members) r.members.forEach(m => ids.add(m.user_id)); });
    ids.forEach(async (uid) => {
      if (rankingAvatarsRef.current[uid]) return;
      rankingAvatarsRef.current[uid] = true;
      try {
        const r = await fetch(`${API}/avatar/${uid}`);
        const d = await r.json();
        if (d.avatar_url) {
          rankingAvatarsRef.current[uid] = d.avatar_url;
          setRankingAvatars(p => ({ ...p, [uid]: d.avatar_url }));
        }
      } catch (e) {}
    });
  }, []);

  const loadRanking = async () => {
    setRankingLoading(true);
    try {
      const [topRes, rndRes] = await Promise.all([fetch(`${API}/ranking`), fetch(`${API}/ranking-random`)]);
      const topData = await topRes.json();
      const rndData = await rndRes.json();
      if (topData.ranking) { setRanking(topData.ranking); loadRankingAvatars(topData.ranking); }
      if (rndData.ranking) { setRandomRanking(rndData.ranking); loadRankingAvatars(rndData.ranking); }
    } catch (e) {}
    finally { setRankingLoading(false); }
  };

  const handleDeletePair = async () => {
    setDeleting(true);
    try {
      await fetch(`${API}/delete`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: pairId, userId }),
      });
      if (refreshPairs) refreshPairs();
      navigate('/?newpair=1');
    } catch (e) {}
    finally { setDeleting(false); }
  };


  // ══════ Share to Story ══════
  const handleShareToStory = () => {
    if (!tg?.shareToStory) return;
    const lv = getLevel(pair?.growth_points || 0);
    const mediaUrl = `https://chumi-app.pages.dev/pets/og-preview.png`;
    tg.shareToStory(mediaUrl, {
      text: lang === 'ru'
        ? `🐾 Мой питомец ${petName} — уровень ${lv.nameRu}! Серия ${pair?.streak_days || 0} дней 🔥\n\nПопробуй: https://t.me/${BOT_USERNAME}`
        : `🐾 My pet ${petName} — level ${lv.name}! ${pair?.streak_days || 0} day streak 🔥\n\nTry it: https://t.me/${BOT_USERNAME}`,
    });
  };

  // ══════ Share Message (prepared inline) ══════
const handleShareMessage = async () => {
  if (!tg?.shareMessage) {
    handleShareInvite();
    return;
  }
  try {
    const res = await fetch(`${API}/prepare-share`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (data.prepared_message_id) {
      tg.shareMessage(data.prepared_message_id, (ok) => {
        if (ok) haptic('success');
      });
    } else {
      handleShareInvite();
    }
  } catch (e) {
    handleShareInvite();
  }
};

  if (loading) return <div className="sk-loading"><div className="sk-spinner" /></div>;

  if (loadError) return (
    <div className="sk-loading">
      <div style={{ fontSize: 48, marginBottom: 12 }}>😿</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 }}>
        {lang === 'ru' ? 'Ошибка загрузки' : 'Failed to load'}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 16 }}>
        {lang === 'ru' ? 'Проверьте подключение к интернету' : 'Check your internet connection'}
      </div>
      <button onClick={() => { setLoading(true); load(); }} style={{
        padding: '12px 32px', borderRadius: 14, border: 'none',
        background: '#9B72CF', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer'
      }}>
        {lang === 'ru' ? 'Повторить' : 'Retry'}
      </button>
    </div>
  );

  if (!pair) return <div className="sk-loading">{lang === 'ru' ? 'Не найдено' : 'Not found'}</div>;

  const lv = getLevel(pair.growth_points || 0);
  const pct = Math.min(100, (lv.current / lv.needed) * 100);
  const isEgg = lv.idx === 0;
  const eggDay = Math.min((pair?.streak_days || 0) + 1, 3);

  const TASKS = [
    { key: 'daily_open',   points: 1, ru: 'Зайти в приложение',               en: 'Open the app',                 icon: '📱', action: 'auto' },
    { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'share' },
    { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'share' },
    { key: 'send_media',   points: 4, ru: 'Отправить партнёру фото или видео', en: 'Send partner a photo or video', icon: '📸', action: 'share' },
    { key: 'pet_touch',    points: 1,
      ru: isEgg ? 'Тапнуть яйцо' : `Тапнуть ${petName}`,
      en: isEgg ? 'Tap the egg' : `Tap ${petName}`,
      icon: '👆', action: 'pet' },
  ];

  const partner = pair.members?.find(m => m.user_id !== userId);
  const isMaxLevel = lv.idx === LEVELS.length - 1 && lv.remaining === 0;
  const isDark = !isEgg && lv.idx === 5;

  const bgColors = lv.bg;
  const accentColor = lv.accent;
  const checkColor = lv.check;

  const mergedTasks = TASKS.map(t => ({ ...t, completed: pair.daily_tasks?.some(dt => dt.task_key === t.key) || false }));
  const allTasks = [...mergedTasks];
  if (!addToHomeDone) {
    allTasks.push({ key: 'add_to_home', points: 3, ru: 'Добавить на главный экран', en: 'Add to Home Screen', icon: '📌', action: 'add_home', completed: false, oneTime: true });
  }
  const doneCount = allTasks.filter(t => t.completed).length;
  const totalCount = allTasks.length;

  // ══════ handleTask ══════
  const handleTask = (task) => {
    if (task.completed || completing) return;
    haptic('light');
    if (task.action === 'share') { handleShareTask(task); return; }
    if (task.action === 'add_home') {
      if (tg?.addToHomeScreen) tg.addToHomeScreen();
      setCompleting(true);
      completeTask('add_to_home').then(() => load()).finally(() => setCompleting(false));
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

  // ══════ handleShareTask ══════
  const handleShareTask = async (task) => {
    if (task.completed || completing) return;
    haptic('light');

    const msgs = getShareMessages(petName, pair.streak_days || 0, pairId, lang);
    const text = pickRandom(msgs[task.key] || msgs.send_msg);

    if (task.key === 'send_msg') {
      setCompleting(true);
      try {
        await fetch(`${API}/send-partner-message`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ code: pairId, userId, text }),
        });
        await completeTask(task.key);
        await load();
      } catch (e) {}
      finally { setCompleting(false); }
      return;
    }

    const inviteLink = `https://t.me/${BOT_USERNAME}?start=join_${pairId}`;
    const fullText = `${text}\n\n${inviteLink}`;
    const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(fullText)}`;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
    } catch (e) {}
    setCompleting(true);
    await completeTask(task.key);
    await load();
    setCompleting(false);
  };


  const handlePetClick = () => {
    if (!hasPartner) return;
    if (isEgg) {
      haptic('medium');
      setPetAnim(true);
      setTimeout(() => setPetAnim(false), 600);
      const petTask = mergedTasks.find(t => t.key === 'pet_touch');
      if (petTask && !petTask.completed) handleTask(petTask);
      return;
    }
    if (petTapped) return;
    haptic('medium');
    setPetTapped(true);
    setPetAnim(true);
    setTimeout(() => setPetAnim(false), 800);
    const fallbackTimer = setTimeout(() => { setPetTapped(false); }, 5000);
    if (tapVideoRef.current) {
      tapVideoRef.current.currentTime = 0;
      tapVideoRef.current.play().catch(() => {});
      tapVideoRef.current.onended = () => { clearTimeout(fallbackTimer); setPetTapped(false); };
    }
    const petTask = mergedTasks.find(t => t.key === 'pet_touch');
    if (petTask && !petTask.completed) handleTask(petTask);
  };

  const handleRename = async () => {
    if (!newName.trim()) return;
    await fetch(`${API}/rename`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ code: pairId, pet_name: newName.trim(), userId }),
    });
    setPair(p => ({ ...p, pet_name: newName.trim() }));
    setRenaming(false);
  };

  const myPairsData = pairs || [];
  const canAddPair = isAdmin || myPairsData.length < maxPairs;


  const handleAddPair = () => {
    if (canAddPair) { navigate('/?newpair=1'); }
    else {
      (async () => {
        try {
          const res = await fetch(`${API}/create-invoice`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ userId, productId: 'extra_slot' })
          });
          const data = await res.json();
          if (data.invoiceUrl && tg?.openInvoice) { tg.openInvoice(data.invoiceUrl, (st) => { if (st === 'paid') { haptic('heavy'); setShowMyPairs(false); if (refreshPairs) refreshPairs(); } }); }
          else if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank');
        } catch (e) {}
      })();
    }
  };

const handleShareInvite = () => {
  const botLink = `https://t.me/${BOT_USERNAME}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(botLink);
    haptic('success');
  }

  const text = lang === 'ru'
    ? `🐾 Chumi — заведи питомца и расти его вместе с другом!\n\nВыполняй задания каждый день, поддерживай серию и открывай новые образы.\n\nПопробуй 👇\n${botLink}`
    : `🐾 Chumi — get a pet and grow it with a friend!\n\nComplete tasks daily, keep your streak and unlock new outfits.\n\nTry it 👇\n${botLink}`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl); else window.open(shareUrl, '_blank');
};


  // ══════ Premium подписка ══════
  const handleSubscribe = async () => {
    try {
      const res = await fetch(`${API}/create-invoice`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, productId: 'premium_monthly' }),
      });
      const data = await res.json();
      if (data.invoiceUrl && tg?.openInvoice) {
        tg.openInvoice(data.invoiceUrl, (st) => {
          if (st === 'paid') { haptic('heavy'); setShowPremium(false); load(); }
        });
      } else if (data.invoiceUrl) window.open(data.invoiceUrl, '_blank');
    } catch (e) {}
  };

  const activeRanking = rankingTab === 'top' ? ranking : randomRanking;
  const eggVideoSrc = EGG_VIDEOS[eggDay];

  // FIX #7: loadSkins с auth заголовком
  const loadSkins = async () => {
    setSkinsLoading(true);
    try {
      const headers = {};
      const initData = getInitData();
      if (initData) headers['X-Telegram-Init-Data'] = initData;
      const res = await fetch(`${API}/skins/${userId}`, { headers });
      const data = await res.json();
      setOwnedSkins(data.owned || []);
      setReferralCount(data.referral_count || 0);
      if (data.premium !== undefined) setPremiumActive(data.premium);
    } catch (e) {}
    finally { setSkinsLoading(false); }
  };


  const handleBuySkin = async (skinId) => {
    try {
      const res = await fetch(`${API}/buy-skin`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId, skinId }),
      });
      const data = await res.json();
      if (data.invoiceUrl && tg?.openInvoice) {
        tg.openInvoice(data.invoiceUrl, (st) => {
          if (st === 'paid') { haptic('heavy'); loadSkins(); load(); }
        });
      }
    } catch (e) {}
  };

  const handleClaimBee = async () => {
    try {
      const res = await fetch(`${API}/claim-bee-skin`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.success) { haptic('heavy'); loadSkins(); }
    } catch (e) {}
  };

  const handleSetSkin = async (skinId) => {
    try {
      await fetch(`${API}/set-skin`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ userId, pairCode: pairId, skinId }),
      });
      await load();
      haptic('light');
    } catch (e) {}
  };

  const LEVEL_SKINS = LEVELS
  .filter(l => l.level >= 1 && l.pet)
  .map(l => ({
    id: `level_${l.level}`,
    name: l.name,
    nameRu: l.nameRu,
    pet: l.pet,
    petTap: l.petTap,
    level: l.level,
    unlocked: lv.idx >= l.level,
  }));

  const SKINS = [
    { id: 'strawberry', name: 'Strawberry', nameRu: 'Клубничка', price: 25, pet: 'axolotl_Strawberry', petTap: 'axolotl_Strawberry_tap' },
    { id: 'bee',        name: 'Bee',        nameRu: 'Пчёлка',    price: 0,  pet: 'axolotl_Bee',        petTap: 'axolotl_Bee_tap', referralReward: true },
    { id: 'floral',     name: 'Floral',     nameRu: 'Цветочный',  price: 25, pet: 'axolotl_Floral',     petTap: 'axolotl_Floral_tap' },
    { id: 'astronaut',  name: 'Astronaut',  nameRu: 'Астронавт',  price: 25, pet: 'axolotl_Astronaut',  petTap: 'axolotl_Astronaut_tap' },
  ];


  const renderEgg = () => (
    <video ref={eggVideoRef} key={`egg-${eggDay}`} autoPlay loop muted playsInline
      className={`pet-animated ${petAnim ? 'tapped' : ''}`}
      style={{ width: 260, height: 340, objectFit: 'contain', transform: 'scale(1.4)', pointerEvents: 'none' }}>
      <source src={eggVideoSrc} type="video/webm" />
    </video>
  );

const activeSkin = pair?.active_skin;
const displaySkin = (showOutfits && previewSkin !== undefined) ? previewSkin : activeSkin;
let petSrc;
if (displaySkin && displaySkin.startsWith('level_')) {
  const lvNum = parseInt(displaySkin.split('_')[1]);
  const lvData = LEVELS[lvNum];
  petSrc = lvData && lvData.pet
    ? { idle: lvData.pet, tap: lvData.petTap }
    : { idle: lv.pet, tap: lv.petTap };
} else if (displaySkin) {
  petSrc = {
    idle: `axolotl_${displaySkin.charAt(0).toUpperCase() + displaySkin.slice(1)}`,
    tap: `axolotl_${displaySkin.charAt(0).toUpperCase() + displaySkin.slice(1)}_tap`,
  };
} else {
  petSrc = { idle: lv.pet, tap: lv.petTap };
}


  const renderPet = () => (
    <>
      <video ref={idleVideoRef} autoPlay loop muted playsInline key={`idle-${petSrc.idle}`}
        className={`pet-animated ${petAnim ? 'tapped' : ''}`}
        style={{ width: 260, height: 340, objectFit: 'contain', transform: 'scale(1.4)', pointerEvents: 'none', display: petTapped ? 'none' : 'block' }}>
        <source src={`/pets/${petSrc.idle}.webm`} type="video/webm" />
      </video>
      <video ref={tapVideoRef} muted playsInline key={`tap-${petSrc.tap}`}
        className={`pet-animated ${petAnim ? 'tapped' : ''}`}
        style={{ width: 260, height: 340, objectFit: 'contain', transform: 'scale(1.4)', pointerEvents: 'none', display: petTapped ? 'block' : 'none' }}>
        <source src={`/pets/${petSrc.tap}.webm`} type="video/webm" />
      </video>
    </>
  );


  return (
    <div className="sk" style={{
      background: isDark
        ? `linear-gradient(180deg, ${bgColors[0]} 0%, ${bgColors[1]} 100%)`
        : `linear-gradient(180deg, ${bgColors[0]} 0%, ${bgColors[1]} 60%, #f5f5f5 100%)`,
    }}>
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

      <div className="sk-pet-name-row">
        {isEgg ? (
          <span className="sk-pet-name-label" style={{ color: lv.accent }}>
            {lang === 'ru' ? `🥚 Яйцо — день ${eggDay} из 3` : `🥚 Egg — day ${eggDay} of 3`}
          </span>
        ) : renaming ? (
          <div className="sk-rename-inline">
            <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={20} autoFocus onKeyDown={e => e.key === 'Enter' && handleRename()} />
            <button onClick={handleRename}>✓</button>
          </div>
        ) : (
          <span className="sk-pet-name-label" style={isDark ? { color: '#fff' } : {}} onClick={() => { setNewName(pair.pet_name || ''); setRenaming(true); }}>
            {pair.pet_name || (lang === 'ru' ? 'Без имени' : 'Unnamed')}
            <span className="sk-edit-pencil">✏️</span>
          </span>
        )}
      </div>

      {showMenu && (
        <div className="sk-menu-overlay" onClick={() => setShowMenu(false)}>
          <div className="sk-menu glass-card" onClick={e => e.stopPropagation()}>
            {!isEgg && <button onClick={() => { setRenaming(true); setShowMenu(false); }}>✏️ {lang === 'ru' ? 'Изменить имя' : 'Edit name'}</button>}
            <button onClick={() => { setShowMyPairs(true); setShowMenu(false); }}>🐾 {lang === 'ru' ? 'Мои пары' : 'My pairs'}</button>
            <button onClick={() => { loadRanking(); setShowRanking(true); setShowMenu(false); }}>🏆 {lang === 'ru' ? 'Рейтинг' : 'Ranking'}</button>
            <button onClick={() => { handleShareToStory(); setShowMenu(false); }}>📸 {lang === 'ru' ? 'В сторис' : 'Share Story'}</button>
            <button onClick={() => { handleShareMessage(); setShowMenu(false); }}>📤 {lang === 'ru' ? 'Поделиться' : 'Share'}</button>
            <button onClick={() => { if (tg?.addToHomeScreen) { tg.addToHomeScreen(); haptic('light'); } setShowMenu(false); }}>📌 {lang === 'ru' ? 'На главный экран' : 'Home Screen'}</button>
            <button onClick={() => { setShowPremium(true); setShowMenu(false); }}>⭐ {lang === 'ru' ? 'Премиум' : 'Premium'}</button>
            <button onClick={() => { const newLang = lang === 'ru' ? 'en' : 'ru'; setLang(newLang); setShowMenu(false); haptic('light'); }}>
              🌐 {lang === 'ru' ? 'English 🇬🇧' : 'Русский 🇷🇺'}
            </button>
            <button className="sk-menu-danger" onClick={() => { setShowDeleteConfirm(true); setShowMenu(false); }}>
              🗑️ {lang === 'ru' ? 'Удалить пару' : 'Delete pair'}
            </button>
          </div>
        </div>
      )}

      {!hasPartner ? (
        <div className="sk-waiting-partner">
          <div className="sk-waiting-emoji">🥚</div>
          <div className="sk-waiting-title">{lang === 'ru' ? 'Ожидаем партнёра' : 'Waiting for partner'}</div>
          <div className="sk-waiting-desc">
            {lang === 'ru' ? 'Растить питомца можно только в паре! Отправь код партнёру или поделись ссылкой.' : 'You need a partner to grow your Pet!'}
          </div>
          <div className="sk-waiting-code" onClick={() => { navigator.clipboard?.writeText(pairId); haptic('light'); }}>
            {pairId}<span className="sk-waiting-code-copy">📋</span>
          </div>
          <button
            className="sk-waiting-btn"
            style={{ background: '#9B72CF', marginTop: 16, width: '100%', maxWidth: 280 }}
            onClick={() => {
              const botUsername = BOT_USERNAME;
              const inviteLink = `https://t.me/${botUsername}?start=join_${pairId}`;
              const shareText = lang === 'ru'
                ? `Присоединяйся к моей паре в Chumi! 🐾\nКод: ${pairId}`
                : `Join my pair in Chumi! 🐾\nCode: ${pairId}`;
              const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;
              if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
              else window.open(shareUrl, '_blank');
            }}
          >
            📨 {lang === 'ru' ? 'Пригласить партнёра' : 'Invite partner'}
          </button>
        </div>
      ) : (
        <>
          <div className="sk-pet-area" onClick={handlePetClick}>
            {isEgg ? renderEgg() : renderPet()}
          </div>

          {isEgg && (
            <div style={{ textAlign: 'center', fontSize: 13, color: accentColor, marginTop: -8, marginBottom: 8, fontWeight: 500 }}>
              {lang === 'ru' ? 'Выполняйте задания — питомец вылупится на 4-й день! 🐣' : 'Complete tasks — your pet hatches on day 4! 🐣'}
            </div>
          )}

          {!isEgg && (
            <div className="sk-outfits-btn" 
            onClick={() => { loadSkins(); setPreviewSkin(pair?.active_skin ?? null); setOutfitTab('levels'); setShowOutfits(true); }}>
              <div className="sk-outfits-icon"><span>🐾</span><span>👕</span></div>
              <span className="sk-outfits-text">{lang === 'ru' ? 'Наряды' : 'Outfits'}</span>
            </div>
          )}

          <div className="sk-progress-wrap" onClick={() => setShowLevels(true)}>
            <div className="sk-progress glass-bar">
              <div className="sk-progress-fill" style={{ width: `${pct}%`, background: accentColor }} />
              <span className="sk-progress-text">{lv.current}/{lv.needed}</span>
            </div>
            {isMaxLevel && <div className="sk-progress-hint" style={isDark ? { color: 'rgba(255,255,255,0.5)' } : {}}>{lang === 'ru' ? 'Скоро появится больше образов' : 'More outfits coming soon'} ›</div>}
          </div>

          <div className="sk-tasks glass-card">
            <div className="sk-tasks-top">
              <h3>{isEgg ? (lang === 'ru' ? 'Вырастите своего Питомца' : 'Hatch your Pet') : (lang === 'ru' ? 'Растите своего Питомца' : 'Grow your Pet')}</h3>
              <span className="sk-tasks-count" style={{ color: accentColor, background: accentColor + '18' }}>{doneCount}/{totalCount}</span>
            </div>
            {allTasks.map(task => (
              <div key={task.key} className={`sk-task ${task.completed ? 'sk-task-done' : ''}`} onClick={() => handleTask(task)}>
                <div className="sk-task-check" style={task.completed ? { background: checkColor, borderColor: checkColor } : { borderColor: checkColor + '40' }}>
                  {task.completed && <span>✓</span>}
                </div>
                <div className="sk-task-body">
                  <div className="sk-task-title">
                    {lang === 'ru' ? task.ru : task.en}
                    {task.oneTime && <span className="sk-task-badge">{lang === 'ru' ? 'Разовое' : 'Once'}</span>}
                  </div>
                  <div className="sk-task-pts" style={{ color: task.completed ? '#4CAF50' : accentColor }}>
                    {task.completed ? (lang === 'ru' ? 'Выполнено ✓' : 'Done ✓') : `+${task.points} ${lang === 'ru' ? 'очка роста' : 'growth pts'}`}
                  </div>
                </div>
                {!task.completed && task.action === 'share' && <div className="sk-task-go">›</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="sk-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>🗑️</div>
            <h3>{lang === 'ru' ? 'Удалить пару?' : 'Delete pair?'}</h3>
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
              {lang === 'ru' ? 'Питомец, серия и прогресс будут удалены безвозвратно.' : 'Pet, streak and progress will be permanently deleted.'}
            </p>
            <button onClick={handleDeletePair} disabled={deleting} className="sk-btn-danger">
              {deleting ? (lang === 'ru' ? 'Удаляем...' : 'Deleting...') : (lang === 'ru' ? '🗑️ Да, удалить' : '🗑️ Yes, delete')}
            </button>
            <button className="sk-popup-close" onClick={() => setShowDeleteConfirm(false)}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {/* My pairs */}
      {showMyPairs && (
        <div className="sk-overlay" onClick={() => setShowMyPairs(false)}>
          <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()}>
            <h3>{lang === 'ru' ? 'Мои пары' : 'My pairs'}</h3>
            <div className="sk-pairs-grid">
              {myPairsData.map(p => {
                const plv = getLevel(p.growth_points || 0);
                const pIsEgg = plv.idx === 0;
                return (
                  <div key={p.code} className={`sk-pair-card glass-card ${p.code === pairId ? 'sk-pair-card-active' : ''}`}
                    onClick={() => { setShowMyPairs(false); navigate(`/pair/${p.code}`); }}>
                    <div className="sk-pair-card-emoji">{pIsEgg ? '🥚' : (plv.idx >= 3 ? '🐾' : '✨')}</div>
                    <div className="sk-pair-card-name">{p.pet_name || (pIsEgg ? (lang === 'ru' ? 'Яйцо' : 'Egg') : plv.name)}</div>
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
                  {canAddPair ? (lang === 'ru' ? 'Новая пара' : 'New pair') : '50 ⭐ Stars'}
                </div>
              </div>
            </div>
            {!isAdmin && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 12 }}>{myPairsData.length}/{maxPairs} {lang === 'ru' ? 'пар' : 'pairs'}</div>}
            <button className="sk-popup-close" onClick={() => setShowMyPairs(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}

      {/* Ranking */}
      {showRanking && (
        <div className="sk-overlay" onClick={() => setShowRanking(false)}>
          <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()}>
            <h3>🏆 {lang === 'ru' ? 'Рейтинг' : 'Ranking'}</h3>
            <div className="sk-ranking-tabs">
              <button className={`sk-ranking-tab ${rankingTab === 'top' ? 'sk-ranking-tab-active' : ''}`} onClick={() => setRankingTab('top')}>{lang === 'ru' ? 'Топ 100' : 'Top 100'}</button>
              <button className={`sk-ranking-tab ${rankingTab === 'random' ? 'sk-ranking-tab-active' : ''}`} onClick={() => setRankingTab('random')}>{lang === 'ru' ? 'Случайно' : 'Random'}</button>
            </div>
            {rankingTab === 'random' && (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(0,0,0,0.35)', marginBottom: 8, fontWeight: 500 }}>
                {lang === 'ru' ? '🔄 Обновляется раз в сутки' : '🔄 Updates once a day'}
              </div>
            )}
            {rankingLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><div className="sk-spinner" /></div>
            ) : activeRanking.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#888' }}>{lang === 'ru' ? 'Пока нет данных' : 'No data yet'}</p>
            ) : (
              <div className="sk-ranking-list">
                {activeRanking.map((r, i) => (
                  <div key={r.code} className={`sk-ranking-row ${r.code === pairId ? 'sk-ranking-me' : ''}`}
                    onClick={() => setExpandedRankingName(expandedRankingName === r.code ? null : r.code)}>
                    <span className="sk-ranking-pos">{rankingTab === 'top' ? (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`) : `#${i+1}`}</span>
                    <div className="sk-ranking-avatars">
                      {(() => {
                        const sorted = (r.members || []).slice().sort((a, b) => {
                          return (a.joined_at || '').localeCompare(b.joined_at || '');
                        });
                        if (sorted.length === 0) return <div className="sk-ranking-ava"><span style={{ fontSize: 14 }}>👤</span></div>;
                        return sorted.map((m, idx) => (
                          <div key={m.user_id} className="sk-ranking-ava" style={{ zIndex: sorted.length - idx }}>
                            {rankingAvatars[m.user_id] ? <img src={rankingAvatars[m.user_id]} alt="" onError={e => e.target.style.display='none'} /> : <span style={{ fontSize: 14 }}>👤</span>}
                          </div>
                        ));
                      })()}
                    </div>
                    <span className={expandedRankingName === r.code ? 'sk-ranking-name-full' : 'sk-ranking-name'}>
                      {r.pet_name || '—'}
                      {r.members?.some(m => m.is_premium) && <span style={{ marginLeft: 4, fontSize: 11 }}>⭐</span>}
                    </span>
                    <span className="sk-ranking-stats">
                      ⭐ {r.growth_points} | 🔥 {r.streak_days}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button className="sk-popup-close" onClick={() => setShowRanking(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}

      {/* Outfits popup */}
{showOutfits && (
  <div style={{
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100,
    animation: 'slideUp 0.3s ease-out',
  }}>
    {/* Затемнение сверху — тап закрывает */}
    <div onClick={() => { setPreviewSkin(undefined); setShowOutfits(false); }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} />

    {/* Шторка */}
    <div style={{
      position: 'relative', zIndex: 101,
      background: '#fff', borderRadius: '20px 20px 0 0',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
      maxHeight: '55vh', display: 'flex', flexDirection: 'column',
    }}>
      {/* Хэндл */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#ddd' }} />
      </div>

      {/* Табы */}
      <div style={{ display: 'flex', padding: '0 16px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
        <button onClick={() => setOutfitTab('levels')} style={{
          flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          color: outfitTab === 'levels' ? accentColor : '#aaa',
          borderBottom: outfitTab === 'levels' ? `2px solid ${accentColor}` : '2px solid transparent',
        }}>🎖 {lang === 'ru' ? 'Уровни' : 'Levels'}</button>
        <button onClick={() => setOutfitTab('shop')} style={{
          flex: 1, padding: '12px 0', border: 'none', background: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          color: outfitTab === 'shop' ? accentColor : '#aaa',
          borderBottom: outfitTab === 'shop' ? `2px solid ${accentColor}` : '2px solid transparent',
        }}>🛍 {lang === 'ru' ? 'Магазин' : 'Shop'}</button>
      </div>

      {/* Сетка */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {outfitTab === 'levels' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {LEVEL_SKINS.map(skin => {
              const isActive = (pair.active_skin === `level_${skin.level}`) ||
                (pair.active_skin === null && lv.idx === skin.level);
              const skinKey = skin.level === lv.idx ? null : `level_${skin.level}`;
              const isPreviewing = previewSkin === skinKey ||
                (previewSkin === null && skin.level === lv.idx) ||
                (previewSkin === undefined && isActive);
              return (
                <div key={skin.id} onClick={() => {
                  if (!skin.unlocked) return;
                  setPreviewSkin(skinKey);
                }} style={{
                  textAlign: 'center', padding: 6, borderRadius: 14,
                  border: isPreviewing ? `2px solid ${accentColor}` : '2px solid transparent',
                  background: skin.unlocked ? '#f5f5f7' : 'rgba(0,0,0,0.03)',
                  opacity: skin.unlocked ? 1 : 0.35,
                  cursor: skin.unlocked ? 'pointer' : 'default',
                  position: 'relative',
                }}>
                  <video autoPlay loop muted playsInline style={{ width: '100%', height: 60, objectFit: 'contain' }}>
                    <source src={`/pets/${skin.pet}.webm`} type="video/webm" />
                  </video>
                  <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: '#333' }}>
                    {lang === 'ru' ? skin.nameRu : skin.name}
                  </div>
                  {!skin.unlocked && (
                    <div style={{ fontSize: 8, color: '#999' }}>🔒 Ур.{skin.level}</div>
                  )}
                  {isActive && (
                    <div style={{
                      position: 'absolute', top: 3, right: 3, width: 16, height: 16,
                      borderRadius: '50%', background: accentColor, color: '#fff',
                      fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>✓</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {outfitTab === 'shop' && (
          skinsLoading ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {SKINS.map(skin => {
                const owned = ownedSkins.includes(skin.id) || premiumActive;
                const isActive = pair.active_skin === skin.id;
                const isPreviewing = previewSkin === skin.id;
                return (
                  <div key={skin.id} onClick={() => setPreviewSkin(skin.id)} style={{
                    textAlign: 'center', padding: 6, borderRadius: 14,
                    border: isPreviewing ? `2px solid ${accentColor}` : '2px solid transparent',
                    background: '#f5f5f7',
                    cursor: 'pointer', position: 'relative',
                  }}>
                    <video autoPlay loop muted playsInline style={{ width: '100%', height: 60, objectFit: 'contain' }}>
                      <source src={`/pets/${skin.pet}.webm`} type="video/webm" />
                    </video>
                    <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: '#333' }}>
                      {lang === 'ru' ? skin.nameRu : skin.name}
                    </div>
                    {owned ? (
                      <div style={{ fontSize: 8, color: '#4CAF50', fontWeight: 600 }}>{lang === 'ru' ? 'Есть' : 'Owned'}</div>
                    ) : skin.referralReward ? (
                      <div style={{ fontSize: 8, color: '#FF9800' }}>📨 {referralCount}/2</div>
                    ) : (
                      <div style={{ fontSize: 8, color: '#999' }}>⭐ {skin.price}</div>
                    )}
                    {isActive && (
                      <div style={{
                        position: 'absolute', top: 3, right: 3, width: 16, height: 16,
                        borderRadius: '50%', background: accentColor, color: '#fff',
                        fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>✓</div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Кнопка */}
      <div style={{ padding: '8px 16px 20px', flexShrink: 0 }}>
        {(() => {
          if (previewSkin === undefined) return null;
          const isLevelSkin = previewSkin && previewSkin.startsWith('level_');
          const isSame = previewSkin === pair.active_skin ||
            (previewSkin === null && pair.active_skin === null) ||
            (isLevelSkin && parseInt(previewSkin.split('_')[1]) === lv.idx && !pair.active_skin);
          const canApply = (previewSkin === null && pair.active_skin !== null) || isLevelSkin ||
            (!isLevelSkin && previewSkin && (ownedSkins.includes(previewSkin) || premiumActive));
          const isBee = previewSkin === 'bee' && !ownedSkins.includes('bee') && !premiumActive;

          if (isSame) return (
            <button disabled style={{
              width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
              background: '#e0e0e0', color: '#999', fontSize: 15, fontWeight: 600,
            }}>{lang === 'ru' ? 'Уже надето' : 'Already wearing'}</button>
          );
          if (isBee) return referralCount >= 2 ? (
            <button onClick={handleClaimBee} style={{
              width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
              background: '#FF9800', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>{lang === 'ru' ? 'Забрать!' : 'Claim!'}</button>
          ) : (
            <button onClick={handleShareInvite} style={{
              width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
              background: '#9B72CF', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>📨 {lang === 'ru' ? `Пригласить (${referralCount}/2)` : `Invite (${referralCount}/2)`}</button>
          );
          if (!canApply && previewSkin) {
            const sd = SKINS.find(s => s.id === previewSkin);
            if (sd?.price > 0) return (
              <button onClick={() => handleBuySkin(previewSkin)} style={{
                width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
                background: accentColor, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}>⭐ {sd.price} Stars</button>
            );
          }
          if (canApply) return (
            <button onClick={() => {
              const s = (previewSkin === null || (isLevelSkin && parseInt(previewSkin.split('_')[1]) === lv.idx))
                ? null : previewSkin;
              handleSetSkin(s);
              setShowOutfits(false);
              setPreviewSkin(undefined);
            }} style={{
              width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
              background: accentColor, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            }}>{lang === 'ru' ? 'Применить' : 'Apply'}</button>
          );
          return null;
        })()}
      </div>
    </div>
  </div>
)}


      {/* Levels popup */}
      {showLevels && (
        <div className="sk-overlay" onClick={() => setShowLevels(false)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <h3>{lang === 'ru' ? 'Стадии роста' : 'Growth Stages'}</h3>
            {LEVELS.map((l, i) => {
              const isCurrent = lv.idx === i;
              return (
                <div key={i} className={`sk-lvl-row ${isCurrent ? 'sk-lvl-active' : ''}`}>
                  <div className="sk-lvl-badge" style={{ background: l.accent + '20', color: l.accent }}>{i + 1}</div>
                  <span className="sk-lvl-name">{lang === 'ru' ? l.nameRu : l.name}</span>
                  <span className="sk-lvl-pts">{l.maxPoints} XP</span>
                </div>
              );
            })}
            <button className="sk-popup-close" onClick={() => setShowLevels(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}

      {/* Premium popup */}
      {showPremium && (
        <div className="sk-overlay" onClick={() => setShowPremium(false)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>⭐</div>
            <h3>Chumi Premium</h3>
            {premiumActive ? (
              <>
                <p style={{ fontSize: 14, color: '#4CAF50', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                  {lang === 'ru' ? '✅ Активен' : '✅ Active'}
                </p>
                <p style={{ fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 20 }}>
                  {lang === 'ru' ? 'Действует до' : 'Valid until'}{' '}
                  {premiumExpires ? new Date(premiumExpires).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US') : '—'}
                </p>
                <div style={{ fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 1.6, marginBottom: 16 }}>
                  {lang === 'ru' ? (
                    <>• Безлимит пар<br/>• Все наряды открыты<br/>• Премиум-бейдж в рейтинге</>
                  ) : (
                    <>• Unlimited pairs<br/>• All outfits unlocked<br/>• Premium badge in ranking</>
                  )}
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20, lineHeight: 1.5 }}>
                  {lang === 'ru' ? (
                    <>• Безлимит пар<br/>• Все наряды без покупки<br/>• Премиум-бейдж в рейтинге</>
                  ) : (
                    <>• Unlimited pairs<br/>• All outfits unlocked<br/>• Premium badge in ranking</>
                  )}
                </p>
                <button onClick={handleSubscribe} className="sk-btn-primary" style={{ background: '#F5A623' }}>
                  ⭐ 150 Stars / {lang === 'ru' ? 'месяц' : 'month'}
                </button>
              </>
            )}
            <button className="sk-popup-close" onClick={() => setShowPremium(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
