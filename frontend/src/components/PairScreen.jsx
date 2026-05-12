import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { usePairs, getInitData } from '../context/PairsContext';
import { LEVELS, getLevel } from '../_levels-meta.js';


const API = '/api';
const ADMIN_IDS = ['713156118'];
const BOT_USERNAME = 'ChumiPetBot';


const EGG_VIDEOS = {
  1: '/pets/egg_1.webm',
  2: '/pets/egg_2.webm',
  3: '/pets/egg_3.webm',
};


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
  const [reviving, setReviving] = useState(false);
  const [reviveError, setReviveError] = useState('');
  const [recoveriesLeft, setRecoveriesLeft] = useState(5);
  const idleVideoRef = useRef(null);
  const tapVideoRef = useRef(null);
  const eggVideoRef = useRef(null);
  const rankingAvatarsRef = useRef({});
  const [previewSkin, setPreviewSkin] = useState(undefined);
  const [levelUpData, setLevelUpData] = useState(null); // { level, name, skinName, petPreview }
  const [outfitTab, setOutfitTab] = useState('levels');

  const petName = pair?.pet_name || (lang === 'ru' ? 'питомца' : 'pet');
  const hasPartner = pair?.member_count >= 2;
  const addToHomeDone = pair?.one_time_tasks?.some(t => t.task_key === 'add_to_home') || false;

const [showCalendar, setShowCalendar] = useState(false);
const [showPostcard, setShowPostcard] = useState(false);
const [postcardUrl, setPostcardUrl] = useState(null);
const [postcardGenerating, setPostcardGenerating] = useState(false);
const [postcardBg, setPostcardBg] = useState(null);
const [postcardSharing, setPostcardSharing] = useState(false);
const [showShareCard, setShowShareCard] = useState(false);
const [shareCardUrl, setShareCardUrl] = useState(null);
const [shareCardGenerating, setShareCardGenerating] = useState(false);
const [shareCardSharing, setShareCardSharing] = useState(false);
// Зафиксированный случайный питомец на время сессии попапа,
// чтобы при смене цвета фона не менялся питомец
const [shareCardPet, setShareCardPet] = useState(null);
const [calendarMonth, setCalendarMonth] = useState(() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
});
const [calendarData, setCalendarData] = useState(null);

// Сегодняшняя дата в локальной таймзоне в формате YYYY-MM-DD
const todayStr = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// Текущий месяц (для блокировки кнопки «вперёд»)
const currentMonthStr = todayStr.slice(0, 7);

const loadCalendar = useCallback(async (month) => {
  try {
    setCalendarData(null);
    const res = await fetch(`${API}/streak-calendar/${pairId}?month=${month}`);
    const data = await res.json();
    if (!data.error) setCalendarData(data);
  } catch (e) {}
}, [pairId]);

const changeMonth = (delta) => {
  const [y, m] = calendarMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  // Не пускаем в будущее
  if (newMonth > currentMonthStr) return;
  setCalendarMonth(newMonth);
};

const [showDiary, setShowDiary] = useState(false);
const [diaryEntries, setDiaryEntries] = useState([]);
const [diaryLoading, setDiaryLoading] = useState(false);
const [diaryEmoji, setDiaryEmoji] = useState('😊');
const [diaryText, setDiaryText] = useState('');
const [diarySaving, setDiarySaving] = useState(false);

const loadDiary = useCallback(async () => {
  setDiaryLoading(true);
  try {
    const res = await fetch(`${API}/diary/${pairId}`);
    const data = await res.json();
    setDiaryEntries(data.entries || []);
  } catch (e) {}
  finally { setDiaryLoading(false); }
}, [pairId]);

useEffect(() => {
  if (showDiary) loadDiary();
}, [showDiary, loadDiary]);

const handleSaveDiary = async () => {
  if (!diaryText.trim() || diarySaving) return;
  setDiarySaving(true);
  try {
    const res = await fetch(`${API}/diary`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId, pairCode: pairId, emoji: diaryEmoji, text: diaryText.trim() }),
    });
    const data = await res.json();
    if (!data.error) {
      haptic('success');
      setDiaryText('');
      await loadDiary();
} else {
  haptic('error');
  const errMsg = data.error || (lang === 'ru' ? 'Не удалось сохранить' : 'Failed to save');
  if (tg?.showAlert) tg.showAlert(errMsg);
  else alert(errMsg);
}
  } catch (e) { haptic('error'); }
  finally { setDiarySaving(false); }
};

const handleDeleteDiary = async (entryId) => {
  try {
    const res = await fetch(`${API}/diary-delete`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ userId, entryId }),
    });
    const data = await res.json();
    if (data.success) {
      haptic('light');
      await loadDiary();
    }
  } catch (e) {}
};

// Когда открывается календарь — сбрасываем месяц на текущий
useEffect(() => {
  if (showCalendar) {
    setCalendarMonth(currentMonthStr);
  }
}, [showCalendar, currentMonthStr]);

// Загружаем данные при изменении месяца (только если попап открыт)
useEffect(() => {
  if (showCalendar && calendarMonth) loadCalendar(calendarMonth);
}, [showCalendar, calendarMonth, loadCalendar]);


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

// ══════ Уведомление + Emoji Status при повышении уровня ══════
useEffect(() => {
  if (!pair) return;
  const lv = getLevel(pair.growth_points || 0);
  const storageKey = `chumi_last_level_${pairId}_${userId}`;
  const lastShownLevel = parseInt(localStorage.getItem(storageKey) || '-1', 10);

  // Первый запуск для этой пары — просто запоминаем уровень, popup не показываем
  if (lastShownLevel === -1) {
    localStorage.setItem(storageKey, String(lv.idx));
    return;
  }

  // Уровень действительно вырос с прошлого показа
  if (lv.idx > lastShownLevel) {
    if (tg?.setEmojiStatus && lv.emojiId) {
      tg.setEmojiStatus(lv.emojiId, { duration: 3600 }, () => {});
    }
    haptic('success');
    setLevelUpData({
      level: lv.idx,
      name: lang === 'ru' ? lv.nameRu : lv.name,
      pet: lv.pet,
    });
    localStorage.setItem(storageKey, String(lv.idx));
  } else if (lv.idx < lastShownLevel) {
    // Питомец перезапущен (сброс) — обновляем без popup
    localStorage.setItem(storageKey, String(lv.idx));
  }
}, [tg, pair, lang, pairId, userId]);


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
      // Если бэк сбросил пару из-за долгой неактивности — перезагружаем данные
      if (data.reset) {
        await new Promise(r => setTimeout(r, 100));
        return false;
      }
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

  // ══════ Premium status ══════
  useEffect(() => {
    // Админ всегда премиум — не ждём ответа сервера
    if (isAdmin) {
      setPremiumActive(true);
      setPremiumExpires('2099-12-31T23:59:59Z');
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API}/premium/${userId}`);
        const data = await res.json();
        setPremiumActive(data.premium || false);
        setPremiumExpires(data.expires_at || null);
      } catch (e) {}
    })();
  }, [userId, isAdmin]);

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

  // Recoveries left
  useEffect(() => {
    if (!pairId) return;
    setRecoveriesLeft(5); // сброс на дефолт при смене пары
    (async () => {
      try {
        const res = await fetch(`${API}/recoveries-left/${pairId}`);
        const data = await res.json();
        if (typeof data.remaining === 'number') setRecoveriesLeft(data.remaining);
      } catch (e) {}
    })();
  }, [pairId, pair?.is_dead, pair?.streak_recoveries_used, pair?.last_recovery_month]);


  // ══════ Share to Story ══════
  const handleShareToStory = () => {
    if (!tg?.shareToStory) return;
    const mediaUrl = `https://chumi-app.pages.dev/pets/story-promo.png`;
    tg.shareToStory(mediaUrl, {
      text: lang === 'ru'
        ? `🐾 Заведи питомца с другом!\n\nРастим вместе, поддерживаем серию, открываем новые наряды 💕\n\n👉 https://t.me/${BOT_USERNAME}`
        : `🐾 Get a pet with a friend!\n\nGrow together, keep your streak, unlock new outfits 💕\n\n👉 https://t.me/${BOT_USERNAME}`,
      widget_link: { url: `https://t.me/${BOT_USERNAME}`, name: 'Chumi' },
    });
  };

      // ── Список всех питомцев для случайной промо-карточки ──
  // Берём всех уровневых питомцев + скины
  const ALL_PROMO_PETS = (() => {
    const list = [];
    // Уровневые питомцы (axolotl_pink, axolotl_peach, axolotl_blue, axolotl_black и т.д.)
    LEVELS.forEach(l => {
      if (l.pet) list.push({ pet: l.pet, bg: l.bg, accent: l.accent });
    });
    // Скины
    list.push({ pet: 'axolotl_Strawberry', bg: ['#FFE5EC', '#FFB3C6'], accent: '#E63946' });
    list.push({ pet: 'axolotl_Bee',        bg: ['#FFF8DC', '#FFE066'], accent: '#F4A300' });
    list.push({ pet: 'axolotl_Floral',     bg: ['#F0FFF4', '#C8F0D4'], accent: '#52B788' });
    list.push({ pet: 'axolotl_Astronaut',  bg: ['#E8F0FF', '#B8D0F4'], accent: '#4A7BD4' });
    // Яйцо тоже добавим как опцию
    list.push({ pet: 'egg_3', bg: ['#FFF4E0', '#FFD89B'], accent: '#F5A623' });
    return list;
  })();

  // ── Генерация промо-карточки 1080×1080 ──
  // Фон автоматически соответствует питомцу (берётся из его bg)
  const generatePromoCard = (chosenPet) => new Promise((resolve, reject) => {
    try {
      const W = 1080, H = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      const chosen = chosenPet || ALL_PROMO_PETS[Math.floor(Math.random() * ALL_PROMO_PETS.length)];

      // Фон — родной для питомца
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, chosen.bg[0]);
      grad.addColorStop(1, chosen.bg[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Декоративные круги
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.beginPath(); ctx.arc(120, 180, 95, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - 140, 220, 70, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(W - 90, H - 280, 110, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(160, H - 200, 75, 0, Math.PI * 2); ctx.fill();

      // Заголовок
      ctx.font = 'bold 78px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🐾 Chumi', W / 2, 130);

      // Подзаголовок
      ctx.font = '42px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(
        lang === 'ru' ? 'Питомец для двоих' : 'A pet for two',
        W / 2, 200
      );

      const petSize = 720;
      const petX = (W - petSize) / 2;
      const petY = 240;
      const petPath = `/pets/${chosen.pet}_frame.png`;

      const img = new Image();
      img.crossOrigin = 'anonymous';

      const finish = () => {
        ctx.font = 'bold 44px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = chosen.accent || '#1a1a1a';
        ctx.textAlign = 'center';
        ctx.fillText(
          lang === 'ru' ? 'Заведи питомца с другом' : 'Get a pet with a friend',
          W / 2, H - 130
        );

        ctx.font = '34px -apple-system, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText('@ChumiPetBot', W / 2, H - 70);

        resolve(canvas.toDataURL('image/png', 0.95));
      };

      img.onload = () => {
        ctx.drawImage(img, petX, petY, petSize, petSize);
        finish();
      };
      img.onerror = () => {
        ctx.font = '380px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🐾', W / 2, petY + petSize / 2);
        finish();
      };
      img.src = petPath;
    } catch (e) { reject(e); }
  });

  // ══════ Share Message — открывает попап с превью промо-карты ══════
  const handleShareMessage = () => {
    haptic('light');
    const randomPet = ALL_PROMO_PETS[Math.floor(Math.random() * ALL_PROMO_PETS.length)];
    setShareCardPet(randomPet);
    setShareCardUrl(null);
    setShowShareCard(true);
  };

  // Перегенерация при открытии или смене питомца
  if (showShareCard && shareCardPet && !shareCardGenerating && !shareCardUrl) {
    setShareCardGenerating(true);
    setTimeout(() => {
      generatePromoCard(shareCardPet)
        .then(url => { setShareCardUrl(url); })
        .catch(() => {})
        .finally(() => setShareCardGenerating(false));
    }, 0);
  }
    // Перегенерация открытки при открытии попапа или смене фона
  if (showPostcard && !postcardGenerating && !postcardUrl) {
    setPostcardGenerating(true);
    setTimeout(() => {
      generatePostcard()
        .then(url => { setPostcardUrl(url); })
        .catch(() => {})
        .finally(() => setPostcardGenerating(false));
    }, 0);
  }

  const handleSendShareCard = async () => {
    if (!shareCardUrl || shareCardSharing) return;
    setShareCardSharing(true);
    haptic('light');
    try {
      const res = await fetch(`${API}/prepare-share`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, imageDataUrl: shareCardUrl }),
      });
      const data = await res.json();
      if (data.prepared_message_id && tg?.shareMessage) {
        tg.shareMessage(data.prepared_message_id, (ok) => {
          if (ok) haptic('success');
          setShowShareCard(false);
        });
      } else {
        handleShareInvite();
        setShowShareCard(false);
      }
    } catch (e) {
      handleShareInvite();
      setShowShareCard(false);
    } finally {
      setShareCardSharing(false);
    }
  };

  const handleReshufflePet = () => {
    haptic('light');
    let next = shareCardPet;
    for (let i = 0; i < 5 && next === shareCardPet; i++) {
      next = ALL_PROMO_PETS[Math.floor(Math.random() * ALL_PROMO_PETS.length)];
    }
    setShareCardPet(next);
    setShareCardUrl(null);
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
  const isEgg = lv.idx === 0;
  const eggDay = Math.min((pair?.streak_days || 0) + 1, 3);

  // Накопительные XP: показываем общее количество очков и порог следующего уровня
  // Уровень 0 (Egg):    0  →  33
  // Уровень 1 (Baby):  33  →  78    (33+45)
  // Уровень 2 (Junior): 78 → 141    (33+45+63)
  // и т.д.
  const totalPointsDisplay = pair.growth_points || 0;
  let prevLevelTotal = 0;
  for (let i = 0; i < lv.idx; i++) prevLevelTotal += LEVELS[i].maxPoints;
  const nextLevelTotal = prevLevelTotal + LEVELS[lv.idx].maxPoints;

  // Прогресс-бар считаем по «текущие XP внутри уровня» / «порог уровня»
  const pct = Math.min(100, ((totalPointsDisplay - prevLevelTotal) / LEVELS[lv.idx].maxPoints) * 100);


  const TASKS = [
    { key: 'daily_open',   points: 1, ru: 'Зайти в приложение',               en: 'Open the app',                 icon: '📱', action: 'auto' },
    { key: 'send_msg',     points: 1, ru: 'Написать партнёру сообщение',       en: 'Send partner a message',        icon: '💬', action: 'share' },
    { key: 'send_sticker', points: 2, ru: 'Отправить партнёру стикер',         en: 'Send partner a sticker',        icon: '🎨', action: 'share' },
    { key: 'send_media',   points: 4, ru: 'Отправить партнёру открытку', en: 'Send partner a postcard', icon: '💌', action: 'postcard' },
    { key: 'pet_touch',    points: 1,
      ru: isEgg ? 'Тапнуть яйцо' : `Тапнуть ${petName}`,
      en: isEgg ? 'Tap the egg' : `Tap ${petName}`,
      icon: '👆', action: 'pet' },
  ];

    const SKINS = [
    { id: 'strawberry', name: 'Strawberry', nameRu: 'Клубничка', price: 25,
      pet: 'axolotl_Strawberry', petTap: 'axolotl_Strawberry_tap',
      bg: ['#FFE5EC', '#FFB3C6'], accent: '#E63946' },
    { id: 'bee',        name: 'Bee',        nameRu: 'Пчёлка',    price: 0,
      pet: 'axolotl_Bee',        petTap: 'axolotl_Bee_tap', referralReward: true,
      bg: ['#FFF8DC', '#FFE066'], accent: '#F4A300' },
    { id: 'floral',     name: 'Floral',     nameRu: 'Цветочный',  price: 25,
      pet: 'axolotl_Floral',     petTap: 'axolotl_Floral_tap',
      bg: ['#F0FFF4', '#C8F0D4'], accent: '#52B788' },
    { id: 'astronaut',  name: 'Astronaut',  nameRu: 'Астронавт',  price: 25,
      pet: 'axolotl_Astronaut',  petTap: 'axolotl_Astronaut_tap',
      bg: ['#E8F0FF', '#B8D0F4'], accent: '#4A7BD4' },
  ];


  const partner = pair.members?.find(m => m.user_id !== userId);
  const isMaxLevel = lv.idx === LEVELS.length - 1 && lv.remaining === 0;
  const isDark = !isEgg && lv.idx === 5;

  // Если активен покупной скин с собственным фоном — используем его, иначе цвета уровня
  const activeSkinData = (showOutfits && previewSkin !== undefined && previewSkin !== null && !String(previewSkin).startsWith('level_'))
    ? SKINS.find(s => s.id === previewSkin)
    : (pair.active_skin && !pair.active_skin.startsWith('level_'))
      ? SKINS.find(s => s.id === pair.active_skin)
      : null;

  const bgColors = activeSkinData?.bg || lv.bg;
  const accentColor = activeSkinData?.accent || lv.accent;
  const checkColor = activeSkinData?.accent || lv.check;

    // ── Postcard helpers ──
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const drawCircleAvatar = (ctx, img, x, y, radius) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
  };

  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

// Размер исходных PNG: 770×1024 (но рисуем в canvas 1080×1440 → координаты ниже масштабированы под 1080×1440)
// Хелпер для рисования питомца с fallback
const drawPetSafe = (ctx, url, x, y, size) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { ctx.drawImage(img, x, y, size, size); resolve(); };
  img.onerror = () => {
    ctx.font = `${Math.floor(size * 0.55)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🐾', x + size / 2, y + size / 2);
    resolve();
  };
  img.src = url;
});

// Хелпер для аватара с fallback на эмодзи
const drawAvatarSafe = (ctx, url, x, y, r) => new Promise((resolve) => {
  if (!url) {
    // Серый кружок с эмодзи
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e7eb';
    ctx.fill();
    ctx.font = `${Math.floor(r * 1.1)}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👤', x, y);
    ctx.restore();
    // Белая обводка
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
    resolve();
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { drawCircleAvatar(ctx, img, x, y, r); resolve(); };
  img.onerror = () => { drawAvatarSafe(ctx, null, x, y, r).then(resolve); };
  img.src = url;
});

// Рисуем контент внутри уже нарисованного полароида на фоне
const drawPolaroidContent = async (ctx, bgConfig) => {
  const I = bgConfig.inner;
  const N = bgConfig.nameStrip;

  // Безопасные отступы от краёв цветной зоны (чтобы не вылезать за рамку)
  const TOP_PAD = 110;
  const SIDE_PAD = 70;

  // ── Бейдж серии (СЛЕВА сверху, внутри рамки) ──
  const streakText = `🔥 ${pair?.streak_days || 0}`;
  ctx.font = 'bold 52px -apple-system, system-ui, sans-serif';
  const streakW = ctx.measureText(streakText).width + 44;
  const streakH = 78;
  const streakX = I.x + SIDE_PAD;
  const streakY = I.y + TOP_PAD;
  ctx.fillStyle = bgConfig.accent;
  roundRect(ctx, streakX, streakY, streakW, streakH, 38);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(streakText, streakX + streakW / 2, streakY + streakH / 2);

  // ── Аватары (СПРАВА сверху, на одной линии со streak) ──
  const avR = 68;
  const avY = streakY + streakH / 2;
  const avX2 = I.x + I.w - SIDE_PAD - avR;      // партнёр (внешний)
  const avX1 = avX2 - avR * 2 + 36;             // я (под партнёром, перекрытие 36px)
  await drawAvatarSafe(ctx, avatars?.[partner?.user_id], avX2, avY, avR);
  await drawAvatarSafe(ctx, avatars?.[userId], avX1, avY, avR);

  // ── Питомец (центр окна, ниже бейджа) ──
  const petTop = streakY + streakH + 30;
  const petBot = I.y + I.h - 24;
  const petSize = Math.min(I.w - 60, petBot - petTop);
  const petX = I.x + (I.w - petSize) / 2;
  const petY = petTop + (petBot - petTop - petSize) / 2;
  await drawPetSafe(ctx, `/pets/${petSrc?.idle || 'egg_1'}_frame.png`, petX, petY, petSize);

  // ── Имя — строго по центру белой полосы ──
  ctx.fillStyle = bgConfig.textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const stripCenterX = N.x + N.w / 2;
  const stripCenterY = N.y + N.h / 2;

  ctx.font = 'bold 110px "Caveat", "Patrick Hand", cursive';
  const petName = pair?.pet_name || (lang === 'ru' ? 'Наш Chumi' : 'Our Chumi');
  ctx.fillText(petName, stripCenterX, stripCenterY - 24);

  // ── Подпись под именем ──
  ctx.font = '46px "Caveat", "Patrick Hand", cursive';
  ctx.globalAlpha = 0.7;
  const subtitle = lang === 'ru'
    ? `${pair?.streak_days || 0} дней вместе 💕`
    : `${pair?.streak_days || 0} days together 💕`;
  ctx.fillText(subtitle, stripCenterX, stripCenterY + 42);
  ctx.globalAlpha = 1;
};

const POSTCARD_BACKGROUNDS = [
  { id:'sakura', label:'🌸', file:'/pets/postcard-bg-sakura.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#E89AB8', textColor:'#8a5a6a', innerColor:'#FADCE3' },

  { id:'strawberry', label:'🍓', file:'/pets/postcard-bg-strawberry.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#E63976', textColor:'#9a3a5a', innerColor:'#FFC2D1' },

  { id:'sunshine', label:'☀️', file:'/pets/postcard-bg-sunshine.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#F4A300', textColor:'#8a6a20', innerColor:'#FFE89A' },

  { id:'ocean', label:'🌊', file:'/pets/postcard-bg-ocean.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#3FA8B8', textColor:'#2a6a75', innerColor:'#A8DDD6' },

  { id:'cocoa', label:'❄️', file:'/pets/postcard-bg-cocoa.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#4A9CB8', textColor:'#3a5a75', innerColor:'#BFDBE8' },

  { id:'night', label:'✨', file:'/pets/postcard-bg-night.png',
    inner: { x: 145, y: 130, w: 790, h: 970 },
    nameStrip: { x: 145, y: 1090, w: 790, h: 160 },
    accent:'#B89DE8', textColor:'#4a3a7a', innerColor:'#5D4B8C' }
];

  // Открытка 1080×1920 (тот же размер что и Stories) — фон + полароид
const generatePostcard = () => new Promise((resolve) => {
  const W = 1080, H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = (postcardBg && postcardBg.file) ? postcardBg : POSTCARD_BACKGROUNDS[0];

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    ctx.drawImage(img, 0, 0, W, H);                  // фон с уже нарисованным полароидом
    await drawPolaroidContent(ctx, bg);              // контент поверх
    ctx.font = '22px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.textAlign = 'right';
    ctx.fillText('@ChumiPetBot', W - 28, H - 22);
    resolve(canvas.toDataURL('image/png', 0.95));
  };
  img.onerror = () => resolve(canvas.toDataURL('image/png', 0.95));
  img.src = bg.file;
});

const wrapPostcardForStory = () => new Promise((resolve) => {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = (postcardBg && postcardBg.file) ? postcardBg : POSTCARD_BACKGROUNDS[0];

  // Фон-заливка по краям (берём центральный цвет фона)
  ctx.fillStyle = bg.innerColor || '#FDE8EC';
  ctx.fillRect(0, 0, W, H);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = async () => {
    const offsetY = 240;
    ctx.drawImage(img, 0, offsetY, 1080, 1440);

    // Контент рисуем со смещением (используем те же inner/nameStrip)
    ctx.save();
    ctx.translate(0, offsetY);
    await drawPolaroidContent(ctx, bg);
    ctx.restore();

    ctx.font = '26px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText('@ChumiPetBot', W - 28, H - 28);
    resolve(canvas.toDataURL('image/png', 0.95));
  };
  img.onerror = () => resolve(canvas.toDataURL('image/png', 0.95));
  img.src = bg.file;
});


  // 💾 Сохранить на устройство
  // Telegram WebView блокирует <a download>, поэтому используем tg.downloadFile
  // (Bot API 8.0+), а как fallback — заливаем в Storage и открываем через tg.openLink.
  const handleDownloadPostcard = async () => {
    if (!postcardUrl) return;
    haptic('light');

    const fileName = `chumi-${pair?.pet_name || 'pet'}-${new Date().toISOString().slice(0, 10)}.png`;

    // 1) Заливаем картинку на сервер, чтобы получить публичный URL
    let publicUrl = null;
    try {
      const res = await fetch(`${API}/upload-postcard`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, imageDataUrl: postcardUrl }),
      });
      const data = await res.json();
      if (data.url) publicUrl = data.url;
    } catch (e) {}

    // 2) Способ A: Telegram downloadFile (нативное сохранение)
    if (publicUrl && tg?.downloadFile) {
      try {
        tg.downloadFile({ url: publicUrl, file_name: fileName }, (accepted) => {
          if (accepted) {
            haptic('success');
            if (tg?.showAlert) {
              tg.showAlert(lang === 'ru' ? '✅ Открытка сохраняется в Галерею' : '✅ Saving to Gallery');
            }
          }
        });
        return;
      } catch (e) {}
    }

    // 3) Способ B: открыть картинку в браузере — пользователь долгим тапом сохранит
    if (publicUrl && tg?.openLink) {
      tg.openLink(publicUrl, { try_instant_view: false });
      if (tg?.showAlert) {
        tg.showAlert(lang === 'ru'
          ? '📷 Открытка открыта в браузере. Зажмите её пальцем и выберите «Сохранить изображение».'
          : '📷 Postcard opened in browser. Long-press it and choose "Save image".');
      }
      return;
    }

    // 4) Fallback для обычного браузера: классический download
    try {
      const link = document.createElement('a');
      link.download = fileName;
      link.href = postcardUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      haptic('success');
    } catch (e) {
      if (tg?.showAlert) tg.showAlert(lang === 'ru' ? 'Не удалось сохранить' : 'Failed to save');
    }
  };

  // 📤 Поделиться (выбор чата в Telegram)
  const handleSharePostcardChat = async () => {
    if (!postcardUrl || postcardSharing) return;
    setPostcardSharing(true);
    haptic('light');
    try {
      const res = await fetch(`${API}/prepare-postcard`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          userId,
          pairCode: pairId,
          imageDataUrl: postcardUrl,
          text: lang === 'ru'
            ? `💌 Наша открытка из Chumi! ${pair?.pet_name || ''} — ${pair?.streak_days || 0} дней вместе 🐾`
            : `💌 Our Chumi postcard! ${pair?.pet_name || ''} — ${pair?.streak_days || 0} days together 🐾`,
        }),
      });
      const data = await res.json();
      if (data.prepared_message_id && tg?.shareMessage) {
        tg.shareMessage(data.prepared_message_id, (ok) => {
          if (ok) {
            haptic('success');
            // Засчитываем задание send_media (Отправить партнёру открытку), если ещё не выполнено
            const mediaDone = pair?.daily_tasks?.some(dt => dt.task_key === 'send_media');
            if (!mediaDone && !completing) {
              setCompleting(true);
              completeTask('send_media').then(() => load()).finally(() => setCompleting(false));
            }
            // Закрываем попап
            setShowPostcard(false);
          }
        });
      } else {
        handleDownloadPostcard();
        if (tg?.showAlert) {
          tg.showAlert(lang === 'ru'
            ? 'Открытка сохранена. Отправь её вручную в чат.'
            : 'Postcard saved. Send it manually to a chat.');
        }
      }
    } catch (e) {
      handleDownloadPostcard();
    } finally {
      setPostcardSharing(false);
    }
  };

  // 📱 Опубликовать в Stories — оборачиваем в 1080×1920
  const handlePublishPostcardStory = async () => {
    if (!postcardUrl) return;
    haptic('light');
    try {
      // 1) Оборачиваем открытку в формат 9:16 специально для Stories
      const storyDataUrl = await wrapPostcardForStory();

      // 2) Загружаем её на сервер
      const res = await fetch(`${API}/upload-postcard`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, imageDataUrl: storyDataUrl }),
      });
      const data = await res.json();
      if (data.url && tg?.shareToStory) {
        tg.shareToStory(data.url, {
          text: lang === 'ru'
            ? `💌 Моя открытка в Chumi 🐾\n\nЗаведи питомца с другом: https://t.me/${BOT_USERNAME}`
            : `💌 My Chumi postcard 🐾\n\nGet a pet with a friend: https://t.me/${BOT_USERNAME}`,
          widget_link: { url: `https://t.me/${BOT_USERNAME}`, name: 'Chumi' },
        });
        haptic('success');
      } else if (tg?.showAlert) {
        tg.showAlert(lang === 'ru'
          ? 'Stories недоступны в этой версии Telegram'
          : 'Stories not available in this Telegram version');
      }
    } catch (e) {
      if (tg?.showAlert) tg.showAlert(lang === 'ru' ? 'Не удалось опубликовать' : 'Failed to publish');
    }
  };


  const mergedTasks = TASKS.map(t => ({ ...t, completed: pair.daily_tasks?.some(dt => dt.task_key === t.key) || false }));
  const allTasks = [...mergedTasks];
  const isDeadBlocked = pair.is_dead && hasPartner;
const platform = tg?.platform || '';
const isIOS = platform === 'ios';
const supportsAddToHome = !!tg?.addToHomeScreen && !isIOS;

if (!addToHomeDone && supportsAddToHome) {
  allTasks.push({ key: 'add_to_home', points: 3, ru: 'Добавить на главный экран', en: 'Add to Home Screen', icon: '📌', action: 'add_home', completed: false, oneTime: true });
}
  const doneCount = allTasks.filter(t => t.completed).length;
  const totalCount = allTasks.length;

  // ══════ handleTask ══════
  const handleTask = (task) => {
    if (task.completed || completing || isDeadBlocked) return;
    haptic('light');
    if (task.action === 'share') { handleShareTask(task); return; }
        if (task.action === 'postcard') {
      // Открываем попап открытки. Задание засчитается после успешного «Поделиться».
      setPostcardUrl(null);
      setShowPostcard(true);
      return;
    }
    if (task.action === 'add_home') {
      if (!tg?.addToHomeScreen) return;
      // Слушаем результат: засчитываем XP только при реальном добавлении
      const onAdded = () => {
        try { tg.offEvent?.('homeScreenAdded', onAdded); } catch (e) {}
        setCompleting(true);
        completeTask('add_to_home').then(() => load()).finally(() => setCompleting(false));
      };
      try { tg.onEvent?.('homeScreenAdded', onAdded); } catch (e) {}
      tg.addToHomeScreen();
      // Fallback: если события нет (старые версии), засчитываем через таймаут как раньше
      setTimeout(() => {
        try { tg.offEvent?.('homeScreenAdded', onAdded); } catch (e) {}
      }, 30000);
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
  // Все три задания (send_msg / send_sticker / send_media) теперь работают одинаково:
  // 1) бэк готовит inline-сообщение с текстом и кнопкой «🐾 Открыть Chumi»;
  // 2) фронт открывает системный выбор чата (tg.shareMessage);
  // 3) в выбранном чате появляется красивое сообщение с inline-кнопкой;
  // 4) задание засчитывается, когда callback shareMessage вернул ok:true
  //    (или когда пользователь покинул Mini App — fallback).
  const handleShareTask = async (task) => {
    if (task.completed || completing) return;
    haptic('light');

    const msgs = getShareMessages(petName, pair.streak_days || 0, pairId, lang);
    const text = pickRandom(msgs[task.key] || msgs.send_msg);

    // ─── send_msg: бот сам отправляет сообщение партнёру ───
    if (task.key === 'send_msg') {
      setCompleting(true);
      try {
        const res = await fetch(`${API}/send-partner-message`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ code: pairId, userId, text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.error) {
          haptic('success');
          await completeTask(task.key);
          await load();
        } else {
          haptic('error');
          if (tg?.showAlert) {
            tg.showAlert(lang === 'ru' ? 'Не удалось отправить сообщение' : 'Failed to send message');
          }
        }
      } catch (e) {
        haptic('error');
      } finally {
        setCompleting(false);
      }
      return;
    }

    // ─── send_sticker / send_media: prepared inline через выбор чата ───
    const hint = task.key === 'send_sticker'
      ? (lang === 'ru'
          ? 'После отправки сообщения отправь партнёру любой стикер 🎨'
          : 'After sending the message, send any sticker to your partner 🎨')
      : (lang === 'ru'
          ? 'После отправки сообщения отправь партнёру фото или видео 📸'
          : 'After sending the message, send a photo or video to your partner 📸');

    if (tg?.showAlert) {
      await new Promise(resolve => tg.showAlert(hint, resolve));
    } else {
      alert(hint);
    }

    let preparedId = null;
    try {
      const res = await fetch(`${API}/prepare-task-message`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, pairCode: pairId, taskKey: task.key, text }),
      });
      const data = await res.json();
      if (data.prepared_message_id) preparedId = data.prepared_message_id;
    } catch (e) {}

    if (preparedId && tg?.shareMessage) {
      tg.shareMessage(preparedId, (ok) => {
        if (ok) {
          haptic('success');
          setCompleting(true);
          completeTask(task.key).then(() => load()).finally(() => setCompleting(false));
        }
      });
      return;
    }

    // Fallback
    const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
    } catch (e) {}

    let counted = false;
    const onHide = () => {
      if (counted) return;
      counted = true;
      document.removeEventListener('visibilitychange', onHide);
      try { tg?.offEvent?.('viewportChanged', onHide); } catch (e) {}
      setCompleting(true);
      completeTask(task.key).then(() => load()).finally(() => setCompleting(false));
    };
    document.addEventListener('visibilitychange', onHide);
    try { tg?.onEvent?.('viewportChanged', onHide); } catch (e) {}
    setTimeout(() => {
      if (!counted) {
        document.removeEventListener('visibilitychange', onHide);
        try { tg?.offEvent?.('viewportChanged', onHide); } catch (e) {}
      }
    }, 60000);
  };


  const handlePetClick = () => {
    if (!hasPartner || isDeadBlocked) return;
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
    if (petTask && !petTask.completed && !completing) {
      setCompleting(true);
      completeTask('pet_touch').then(() => load()).finally(() => setCompleting(false));
    }
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
  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(refLink);
    haptic('success');
  }

  const text = lang === 'ru'
    ? `🐾 Chumi — заведи питомца и расти его вместе с другом!\n\nПрисоединяйся по моей ссылке 👇\n${refLink}`
    : `🐾 Chumi — get a pet and grow it with a friend!\n\nJoin via my link 👇\n${refLink}`;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
  else window.open(shareUrl, '_blank');
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

    // Воскрешение питомца
  const handleRevive = async () => {
    if (reviving) return;
    setReviving(true);
    setReviveError('');
    try {
      const res = await fetch(`${API}/recover-streak`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, pairCode: pairId }),
      });
      const data = await res.json();
      if (data.error) {
        setReviveError(
          data.error === 'Max 5 recoveries per month'
            ? (lang === 'ru' ? 'Воскрешения закончились в этом месяце 😢' : 'No more revives this month 😢')
            : data.error
        );
      } else {
        haptic('heavy');
        if (typeof data.remaining === 'number') setRecoveriesLeft(data.remaining);
        await load();
      }
    } catch (e) {
      setReviveError(lang === 'ru' ? 'Ошибка сети' : 'Network error');
    } finally {
      setReviving(false);
    }
  };

  // Создание нового яйца (когда воскрешения закончились)
  const handleCreateNewEgg = async () => {
    try {
      await fetch(`${API}/create-egg`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId, pairCode: pairId }),
      });
      haptic('success');
      await load();
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

const handleGiftSkin = async (skinId) => {
  if (!hasPartner) {
    haptic('warning');
    return;
  }
  try {
    const res = await fetch(`${API}/buy-skin-gift`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ userId, skinId, pairCode: pairId }),
    });
    const data = await res.json();
    if (data.error) {
      haptic('error');
      const errorMessages = {
        'Partner already owns this skin': lang === 'ru' ? 'У партнёра уже есть этот скин 🎁' : 'Partner already owns this skin 🎁',
        'No partner in pair': lang === 'ru' ? 'В паре нет партнёра' : 'No partner in pair',
        'Not a member': lang === 'ru' ? 'Вы не участник этой пары' : 'Not a member of this pair',
        'Invalid skin': lang === 'ru' ? 'Этот скин нельзя подарить' : 'This skin cannot be gifted',
        'Invoice creation failed': lang === 'ru' ? 'Не удалось создать счёт. Попробуйте позже.' : 'Failed to create invoice. Try later.',
        'Unauthorized': lang === 'ru' ? 'Сессия истекла, перезайдите' : 'Session expired, please reopen',
      };
      const msg = errorMessages[data.error] || `${lang === 'ru' ? 'Ошибка' : 'Error'}: ${data.error}`;
      if (tg?.showAlert) tg.showAlert(msg);
      else alert(msg);
      return;
    }
    if (data.invoiceUrl && tg?.openInvoice) {
      tg.openInvoice(data.invoiceUrl, (st) => {
        if (st === 'paid') { haptic('heavy'); loadSkins(); load(); }
      });
    } else if (data.invoiceUrl) {
      window.open(data.invoiceUrl, '_blank');
    }
  } catch (e) {
    haptic('error');
    if (tg?.showAlert) tg.showAlert(lang === 'ru' ? `Ошибка сети: ${e.message}` : `Network error: ${e.message}`);
  }
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


const renderEgg = () => (
  <video ref={eggVideoRef} key={`egg-${eggDay}`} autoPlay loop muted playsInline
    className={`pet-animated ${petAnim ? 'tapped' : ''}`}
    style={{width:260,height:340,objectFit:'contain',transform:'scale(1.4)',pointerEvents:'none',background:'transparent'}}>
    <source src={`/pets/egg_${eggDay}_ios.mov`} type='video/mp4; codecs="hvc1"' />
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
      style={{width:260,height:340,objectFit:'contain',transform:'scale(1.4)',pointerEvents:'none',display:petTapped?'none':'block',background:'transparent'}}>
      <source src={`/pets/${petSrc.idle}_ios.mov`} type='video/mp4; codecs="hvc1"' />
      <source src={`/pets/${petSrc.idle}.webm`} type="video/webm" />
    </video>
    <video ref={tapVideoRef} muted playsInline key={`tap-${petSrc.tap}`}
      className={`pet-animated ${petAnim ? 'tapped' : ''}`}
      style={{width:260,height:340,objectFit:'contain',transform:'scale(1.4)',pointerEvents:'none',display:petTapped?'block':'none',background:'transparent'}}>
      <source src={`/pets/${petSrc.tap}_ios.mov`} type='video/mp4; codecs="hvc1"' />
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
            <button onClick={() => { setShowMyPairs(true); setShowMenu(false); }}>🐾 {lang === 'ru' ? 'Мои пары' : 'My pairs'}</button>
            <button onClick={() => { setShowCalendar(true); setShowMenu(false); }}>
  📅 {lang === 'ru' ? 'Календарь серии' : 'Streak Calendar'}
</button>
<button onClick={() => { setShowDiary(true); setShowMenu(false); }}>
  📔 {lang === 'ru' ? 'Дневник' : 'Diary'}
</button>
<button onClick={() => { setPostcardUrl(null); setShowPostcard(true); setShowMenu(false); }}>
  💌 {lang === 'ru' ? 'Открытка' : 'Postcard'}
</button>
            <button onClick={() => { loadRanking(); setShowRanking(true); setShowMenu(false); }}>🏆 {lang === 'ru' ? 'Рейтинг' : 'Ranking'}</button>
            <button onClick={() => { handleShareToStory(); setShowMenu(false); }}>📸 {lang === 'ru' ? 'В сторис' : 'Share Story'}</button>
            <button onClick={() => { handleShareMessage(); setShowMenu(false); }}>📤 {lang === 'ru' ? 'Поделиться' : 'Share'}</button>
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

      {pair.is_dead && hasPartner && (
        <div className="sk-overlay" style={{ zIndex: 200 }}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 64, textAlign: 'center', marginBottom: 12 }}>💀</div>
            <h3 style={{ textAlign: 'center', color: '#e53e3e' }}>
              {lang === 'ru' ? 'Питомец умер' : 'Your pet has died'}
            </h3>
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 8, lineHeight: 1.5 }}>
              {lang === 'ru'
                ? `Вы пропустили день. Серия ${pair.streak_days || 0} дн. под угрозой!`
                : `You missed a day. Streak ${pair.streak_days || 0} days is at risk!`}
            </p>
            <p style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 16 }}>
              {lang === 'ru'
                ? `Доступно воскрешений в этом месяце: ${recoveriesLeft}/5`
                : `Revives left this month: ${recoveriesLeft}/5`}
            </p>

            {reviveError && (
              <p style={{ color: '#e53e3e', fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                {reviveError}
              </p>
            )}

            {recoveriesLeft > 0 ? (
              <button
                onClick={handleRevive}
                disabled={reviving}
                className="sk-btn-primary"
                style={{ background: '#9B72CF', marginBottom: 8 }}
              >
                {reviving
                  ? (lang === 'ru' ? 'Воскрешаем...' : 'Reviving...')
                  : `✨ ${lang === 'ru' ? 'Воскресить' : 'Revive'} (${recoveriesLeft})`}
              </button>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 12 }}>
                  {lang === 'ru'
                    ? 'Воскрешения закончились. Можно начать заново с яйца — серия обнулится.'
                    : 'No revives left. You can start over with a new egg — streak will reset.'}
                </p>
                <button
                  onClick={handleCreateNewEgg}
                  className="sk-btn-primary"
                  style={{ background: '#F5A623' }}
                >
                  🥚 {lang === 'ru' ? 'Создать новое яйцо' : 'Create new egg'}
                </button>
              </>
            )}
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
            onClick={async () => {
              haptic('light');
              const botUsername = BOT_USERNAME;
              const inviteLink = `https://t.me/${botUsername}?start=join_${pairId}`;

              // Пытаемся отправить через prepared inline message — это даёт inline-кнопку
              if (tg?.shareMessage) {
                try {
                  const res = await fetch(`${API}/prepare-invite`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ userId, pairCode: pairId }),
                  });
                  const data = await res.json();
                  if (data.prepared_message_id) {
                    tg.shareMessage(data.prepared_message_id, (ok) => {
                      if (ok) haptic('success');
                    });
                    return;
                  }
                } catch (e) {}
              }

              // Fallback: системный диалог "Поделиться" (без inline-кнопки)
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
              <span className="sk-progress-text">{totalPointsDisplay}/{nextLevelTotal}</span>
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
                      {r.members?.some(m => m.is_premium) && <span style={{ marginRight: 4, fontSize: 11 }}>⭐</span>}
                      {r.pet_name || '—'}
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
<video autoPlay loop muted playsInline style={{ width: '100%', height: 60, objectFit: 'contain', background: 'transparent' }}>
  <source src={`/pets/${skin.pet}_ios.mov`} type='video/mp4; codecs="hvc1"' />
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
<video autoPlay loop muted playsInline style={{ width: '100%', height: 60, objectFit: 'contain', background: 'transparent' }}>
  <source src={`/pets/${skin.pet}_ios.mov`} type='video/mp4; codecs="hvc1"' />
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
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleBuySkin(previewSkin)} style={{
                  flex: 1, padding: '14px 0', borderRadius: 16, border: 'none',
                  background: accentColor, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>
                  ⭐ {sd.price} {lang === 'ru' ? 'Купить' : 'Buy'}
                </button>
                {hasPartner && (
                  <button onClick={() => handleGiftSkin(previewSkin)} style={{
                    flex: 1, padding: '14px 0', borderRadius: 16, border: `2px solid ${accentColor}`,
                    background: '#fff', color: accentColor, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}>
                    🎁 {lang === 'ru' ? 'Подарить' : 'Gift'}
                  </button>
                )}
              </div>
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
              <div className={`sk-lvl-row ${isCurrent ? 'sk-lvl-active' : ''}`} key={i}>
                <div className="sk-lvl-badge" style={{ background: l.accent + '20', color: l.accent }}>{i + 1}</div>
                <span className="sk-lvl-name">{lang === 'ru' ? l.nameRu : l.name}</span>
                <span className="sk-lvl-pts">
                  {LEVELS.slice(0, i + 1).reduce((sum, x) => sum + x.maxPoints, 0)} XP
                </span>
              </div>
              );
            })}
            <button className="sk-popup-close" onClick={() => setShowLevels(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}

      {/* Level-up popup */}
      {levelUpData && (
        <div className="sk-overlay" onClick={() => setLevelUpData(null)}>
          <div className="sk-popup" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 56, textAlign: 'center', marginBottom: 8 }}>🎉</div>
            <h3 style={{ textAlign: 'center', color: accentColor }}>
              {lang === 'ru' ? 'Новый уровень!' : 'Level up!'}
            </h3>
            <p style={{ fontSize: 16, fontWeight: 700, textAlign: 'center', marginBottom: 12, color: '#1a1a1a' }}>
              {levelUpData.name}
            </p>
{levelUpData.pet && (
  <video autoPlay loop muted playsInline
    style={{ width: 140, height: 140, objectFit: 'contain', display: 'block', margin: '0 auto 12px', background: 'transparent' }}>
    <source src={`/pets/${levelUpData.pet}_ios.mov`} type='video/mp4; codecs="hvc1"' />
    <source src={`/pets/${levelUpData.pet}.webm`} type="video/webm" />
  </video>
)}
            <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16, lineHeight: 1.5 }}>
              {lang === 'ru'
                ? `Разблокирован новый наряд «${levelUpData.name}»! Открой «Наряды», чтобы примерить его.`
                : `New outfit "${levelUpData.name}" unlocked! Open "Outfits" to try it on.`}
            </p>
            <button
              onClick={() => {
                setLevelUpData(null);
                loadSkins();
                setPreviewSkin(`level_${levelUpData.level}`);
                setOutfitTab('levels');
                setShowOutfits(true);
              }}
              className="sk-btn-primary"
              style={{ background: accentColor }}
            >
              👕 {lang === 'ru' ? 'Примерить' : 'Try on'}
            </button>
            <button className="sk-popup-close" onClick={() => setLevelUpData(null)}>
              {lang === 'ru' ? 'Позже' : 'Later'}
            </button>
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

      {/* Streak Calendar popup */}
      {showCalendar && (
        <div className="sk-overlay" onClick={() => setShowCalendar(false)}>
          <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()}>
            <h3>📅 {lang === 'ru' ? 'Календарь серии' : 'Streak Calendar'}</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <button onClick={() => changeMonth(-1)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>‹</button>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {new Date(calendarMonth + '-01').toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric' })}
              </span>
        <button
          onClick={() => changeMonth(1)}
          disabled={calendarMonth >= currentMonthStr}
          style={{
            background: 'none', border: 'none', fontSize: 20,
            cursor: calendarMonth >= currentMonthStr ? 'default' : 'pointer',
            opacity: calendarMonth >= currentMonthStr ? 0.3 : 1,
          }}
        >›</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 12 }}>
              {(lang === 'ru' ? ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'] : ['Mo','Tu','We','Th','Fr','Sa','Su']).map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#999', fontWeight: 600 }}>{d}</div>
              ))}
              {(() => {
                if (!calendarData) return null;
                const firstDay = new Date(calendarMonth + '-01');
                const offset = (firstDay.getDay() + 6) % 7;
                const cells = [];
                for (let i = 0; i < offset; i++) cells.push(<div key={'empty-' + i} />);
calendarData.days.forEach(d => {
  const day = parseInt(d.date.split('-')[2]);
  const bg = d.status === 'both' ? '#4CAF50' : d.status === 'one' ? '#FFC107' : '#f0f0f0';
  const color = d.status === 'empty' ? '#666' : '#fff';
  const isToday = d.date === todayStr;
  cells.push(
    <div key={d.date} style={{
      aspectRatio: '1', borderRadius: 8, background: bg, color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 600,
      border: isToday ? `2px solid ${accentColor}` : '2px solid transparent',
      boxShadow: isToday ? `0 0 0 1px ${accentColor}40` : 'none',
    }}>
      {day}
    </div>
  );
});
                return cells;
              })()}
            </div>
            {calendarData && (
              <div style={{ textAlign: 'center', fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.6 }}>
                {lang === 'ru'
                  ? `🔥 Вместе ${calendarData.bothCount} из ${calendarData.totalDays} дней`
                  : `🔥 Together ${calendarData.bothCount} of ${calendarData.totalDays} days`}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 11, color: '#888', marginBottom: 8 }}>
              <span>🟢 {lang === 'ru' ? 'Оба' : 'Both'}</span>
              <span>🟡 {lang === 'ru' ? 'Один' : 'One'}</span>
              <span>⚪ {lang === 'ru' ? 'Нет' : 'None'}</span>
            </div>
            <button className="sk-popup-close" onClick={() => setShowCalendar(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
          </div>
        </div>
      )}
      {/* Diary popup */}
{showDiary && (
  <div className="sk-overlay" onClick={() => setShowDiary(false)}>
    <div className="sk-popup sk-popup-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
      <h3>📔 {lang === 'ru' ? 'Наш дневник' : 'Our diary'}</h3>

      {/* Форма ввода */}
      <div style={{ background: '#f5f5f7', borderRadius: 14, padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          {lang === 'ru' ? 'Запись дня (1 в день)' : "Today's entry (1 per day)"}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {['😊','🥰','😂','😍','🤗','😎','😴','🥺','😢','🔥','💖','✨','🌈','☀️','🌙'].map(e => (
            <button key={e} onClick={() => setDiaryEmoji(e)} style={{
              fontSize: 20, padding: 4, borderRadius: 8, border: 'none',
              background: diaryEmoji === e ? accentColor + '30' : 'transparent',
              cursor: 'pointer',
            }}>{e}</button>
          ))}
        </div>
        <textarea
          value={diaryText}
          onChange={e => setDiaryText(e.target.value.slice(0, 100))}
          placeholder={lang === 'ru' ? 'Что-то приятное или просто как день...' : 'Something nice or just how the day was...'}
          rows={2}
          style={{
            width: '100%', borderRadius: 10, border: '1px solid #ddd', padding: 8,
            fontSize: 14, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#aaa' }}>{diaryText.length}/100</span>
          <button onClick={handleSaveDiary} disabled={!diaryText.trim() || diarySaving} style={{
            padding: '8px 18px', borderRadius: 12, border: 'none',
            background: diaryText.trim() ? accentColor : '#ddd',
            color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: diaryText.trim() ? 'pointer' : 'default',
          }}>
            {diarySaving ? '...' : (lang === 'ru' ? 'Сохранить' : 'Save')}
          </button>
        </div>
      </div>

      {/* Лента записей */}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 8 }}>
        {diaryLoading ? (
          <div style={{ textAlign: 'center', padding: 20 }}><div className="sk-spinner" /></div>
        ) : diaryEntries.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#888', fontSize: 13, padding: 20 }}>
            {lang === 'ru' ? 'Пока нет записей. Будьте первыми! 💕' : 'No entries yet. Be the first! 💕'}
          </p>
        ) : (
          (() => {
            const grouped = {};
            diaryEntries.forEach(e => {
              if (!grouped[e.entry_date]) grouped[e.entry_date] = [];
              grouped[e.entry_date].push(e);
            });
            return Object.entries(grouped).map(([date, entries]) => (
              <div key={date} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#999', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>
                  {new Date(date + 'T00:00:00').toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'long' })}
                </div>
                {entries.map((e, i) => {
                  const isMine = String(e.user_id) === String(userId);
                  const author = isMine ? (lang === 'ru' ? 'Я' : 'Me') : (partner?.display_name || (lang === 'ru' ? 'Партнёр' : 'Partner'));
                  return (
                    <div key={i} style={{
                      display: 'flex', gap: 8, padding: 10, marginBottom: 6,
                      background: isMine ? accentColor + '10' : '#f5f5f7', borderRadius: 12,
                      alignItems: 'flex-start',
                    }}>
                      <span style={{ fontSize: 22, lineHeight: 1 }}>{e.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{author}</div>
                        <div style={{ fontSize: 13, color: '#333', wordBreak: 'break-word' }}>{e.text}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()
        )}
      </div>

      <button className="sk-popup-close" onClick={() => setShowDiary(false)}>{lang === 'ru' ? 'Закрыть' : 'Close'}</button>
    </div>
  </div>
)}

{/* Postcard popup */}
{showPostcard && (
  <div className="sk-overlay" onClick={() => setShowPostcard(false)}>
    <div
      className="sk-popup"
      onClick={e => e.stopPropagation()}
      style={{
        maxWidth: 320,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxHeight: '92vh',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, textAlign: 'center' }}>
        💌 {lang === 'ru' ? 'Наша открытка' : 'Our postcard'}
      </h3>

      {/* Превью */}
<div style={{
  width: '100%',
  aspectRatio: '1080/1440',
  maxHeight: '58vh',
  margin: '0 auto',
  borderRadius: 14,
  overflow: 'hidden',
  background: '#f3f4f6',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 16px rgba(0,0,0,0.10)'
}}>
  {postcardUrl
    ? <img
        src={postcardUrl}
        alt="postcard"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    : <div style={{ color: '#888', fontSize: 14 }}>
        ⏳ {lang === 'ru' ? 'Создаём...' : 'Generating...'}
      </div>}
</div>

      {/* Выбор стиля фона */}
      <div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>
          🎨 {lang === 'ru' ? 'Стиль фона' : 'Background style'}
        </div>
        <div style={{
          display: 'flex',
          gap: 6,
          justifyContent: 'center',
          flexWrap: 'nowrap',
          overflowX: 'auto',
          paddingBottom: 2,
        }}>
          {POSTCARD_BACKGROUNDS.map(bg => {
            const isActive = (postcardBg?.id || POSTCARD_BACKGROUNDS[0].id) === bg.id;
            return (
              <button
                key={bg.id}
                onClick={() => {
                  setPostcardBg(bg);
                  setPostcardUrl(null);
                }}
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  border: isActive ? `2.5px solid ${accentColor}` : '2px solid rgba(0,0,0,0.08)',
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, flexShrink: 0,
                }}
                title={bg.id}
              >
                {bg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Кнопки действий */}
      <button
        onClick={handlePublishPostcardStory}
        disabled={postcardGenerating || !postcardUrl}
        style={{
          width: '100%', padding: '11px 0', borderRadius: 12, border: 'none',
          background: `linear-gradient(135deg, ${accentColor}, #ec4899)`,
          color: '#fff', fontSize: 14, fontWeight: 600,
          cursor: postcardUrl ? 'pointer' : 'default',
          opacity: postcardUrl ? 1 : 0.6,
        }}
      >
        📱 {lang === 'ru' ? 'Опубликовать в Stories' : 'Publish to Stories'}
      </button>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSharePostcardChat}
          disabled={postcardGenerating || !postcardUrl || postcardSharing}
          style={{
            flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
            background: '#3390EC', color: '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: postcardUrl ? 'pointer' : 'default',
            opacity: postcardUrl ? 1 : 0.6,
          }}
        >
          📤 {postcardSharing
            ? (lang === 'ru' ? '...' : '...')
            : (lang === 'ru' ? 'Поделиться' : 'Share')}
        </button>
        <button
          onClick={handleDownloadPostcard}
          disabled={postcardGenerating || !postcardUrl}
          style={{
            flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
            background: '#4CAF50', color: '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: postcardUrl ? 'pointer' : 'default',
            opacity: postcardUrl ? 1 : 0.6,
          }}
        >
          💾 {lang === 'ru' ? 'Сохранить' : 'Save'}
        </button>
      </div>

      <button
        onClick={() => setShowPostcard(false)}
        style={{
          width: '100%', padding: '8px 0',
          background: 'transparent', color: '#6b7280',
          border: 'none', borderRadius: 12,
          fontSize: 13, cursor: 'pointer',
        }}
      >
        {lang === 'ru' ? 'Закрыть' : 'Close'}
      </button>
    </div>
  </div>
)}
{/* Share promo-card popup */}
{showShareCard && (
  <div className="sk-overlay" onClick={() => setShowShareCard(false)}>
    <div
      className="sk-popup"
      onClick={e => e.stopPropagation()}
      style={{
        maxWidth: 320,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxHeight: '92vh',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 16, textAlign: 'center' }}>
        📤 {lang === 'ru' ? 'Поделиться Chumi' : 'Share Chumi'}
      </h3>

      {/* Превью 1:1 */}
      <div style={{
        width: '100%',
        aspectRatio: '1 / 1',
        maxHeight: '50vh',
        margin: '0 auto',
        borderRadius: 14,
        overflow: 'hidden',
        background: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      }}>
        {shareCardGenerating || !shareCardUrl ? (
          <div className="sk-spinner" />
        ) : (
          <img
            src={shareCardUrl}
            alt="promo"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
      </div>

      {/* Кнопка "Другой питомец" */}
      <button
        onClick={handleReshufflePet}
        disabled={shareCardGenerating}
        style={{
          width: '100%', padding: '8px 0',
          background: 'transparent',
          color: accentColor,
          border: `1px dashed ${accentColor}80`,
          borderRadius: 12,
          fontSize: 12, fontWeight: 600,
          cursor: shareCardGenerating ? 'default' : 'pointer',
        }}
      >
        🎲 {lang === 'ru' ? 'Другой питомец' : 'Another pet'}
      </button>

      {/* Кнопка отправки */}
      <button
        onClick={handleSendShareCard}
        disabled={shareCardGenerating || !shareCardUrl || shareCardSharing}
        style={{
          width: '100%', padding: '11px 0', borderRadius: 12, border: 'none',
          background: `linear-gradient(135deg, ${accentColor}, #ec4899)`,
          color: '#fff', fontSize: 14, fontWeight: 600,
          cursor: shareCardUrl ? 'pointer' : 'default',
          opacity: shareCardUrl ? 1 : 0.6,
        }}
      >
        📤 {shareCardSharing
          ? (lang === 'ru' ? 'Отправка...' : 'Sending...')
          : (lang === 'ru' ? 'Поделиться' : 'Share')}
      </button>

      <button
        onClick={() => setShowShareCard(false)}
        style={{
          width: '100%', padding: '8px 0',
          background: 'transparent', color: '#6b7280',
          border: 'none', borderRadius: 12,
          fontSize: 13, cursor: 'pointer',
        }}
      >
        {lang === 'ru' ? 'Закрыть' : 'Close'}
      </button>
    </div>
  </div>
)}
    </div>
  );
}

