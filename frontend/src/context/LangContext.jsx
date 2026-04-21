import React, { createContext, useContext, useState, useEffect } from 'react';

const strings = {
  en: {
    loading: 'Loading…',
noPets: 'Get your pet!',
    noPetsDesc: 'Create a pair or join one',
    createPair: 'Create pair',
createOrJoin: 'Create a pair and grow your pet together',
    join: 'Join',
    feed: 'Feed',
    petAction: 'Pet',
    wardrobe: 'Wardrobe',
    shop: 'Shop',
    settings: 'Settings',
    home: 'Home',
    pairs: 'Pairs',
    invite: 'Invite friend',
    inviteDesc: 'Send invite via Telegram',
    copyCode: 'Copy code',
    copied: 'Copied!',
    create: 'Create',
    cancel: 'Cancel',
    delete: 'Delete',
    deletePair: 'Delete pair',
    deleteConfirm: 'Delete this pair? This cannot be undone.',
    rename: 'Rename',
    renamePet: 'Rename pet',
    enterName: 'Enter name',
    save: 'Save',
    alreadyFed: 'Already fed today',
    alreadyPetted: 'Already petted today',
    waitPartner: 'Waiting for partner to feed…',
    streakDays: 'Streak',
    growthPoints: 'XP',
    members: 'Members',
    enterCode: 'Enter pair code',
    wardrobePlaceholder: 'Coming soon…',
    shopPlaceholder: 'Coming soon…',
    notifications: 'Notifications',
    sound: 'Sound',
    language: 'Language',
    pairCode: 'Pair code',
    background: 'Background',
    stages: 'Stages',
    egg: 'Egg',
    baby: 'Baby',
    teen: 'Teen',
    adult: 'Adult',
    legend: 'Legend',
    petDied: 'YOUR PET DIED',
    petDiedDesc: 'You missed a feeding day.',
    recoverStreak: 'Recover streak',
    createNewEgg: 'Create new egg',
    recoveriesLeft: 'recoveries left this month',
    noRecoveries: 'No recoveries left this month',
    dailyTasks: 'Daily tasks',
    taskFeed: 'Feed your pet',
    taskPet: 'Pet your pet',
    taskBg: 'Change background',
    completed: 'Done',
    buySlot: 'Buy extra slot',
    buySlotDesc: 'One more pair slot for 50 ⭐',
    buySlotStars: '50 ⭐ Stars',
    partner: 'Partner',
    noPartner: 'No partner yet',
    choosePet: 'Choose your pet',
    choosePetDesc: 'Your egg is hatching! Pick a pet:',
    notifyPartner: 'Nudge partner',
    nudgeSent: 'Nudge sent!',
    sendInvite: 'Send invite',
    changeLang: '🌐 Language',
  },
  ru: {
    loading: 'Загрузка…',
noPets: 'Заведи питомца!',
    noPetsDesc: 'Создай пару или присоединись',
    createPair: 'Создать пару',
createOrJoin: 'Создай пару и начни растить питомца вместе',
    join: 'Вступить',
    feed: 'Покормить',
    petAction: 'Погладить',
    wardrobe: 'Гардероб',
    shop: 'Магазин',
    settings: 'Настройки',
    home: 'Главная',
    pairs: 'Пары',
    invite: 'Пригласить друга',
    inviteDesc: 'Отправь приглашение через Telegram',
    copyCode: 'Скопировать код',
    copied: 'Скопировано!',
    create: 'Создать',
    cancel: 'Отмена',
    delete: 'Удалить',
    deletePair: 'Удалить пару',
    deleteConfirm: 'Удалить эту пару? Это нельзя отменить.',
    rename: 'Переименовать',
    renamePet: 'Имя питомца',
    enterName: 'Введите имя',
    save: 'Сохранить',
    alreadyFed: 'Уже покормлен сегодня',
    alreadyPetted: 'Уже поглажен сегодня',
    waitPartner: 'Ждём партнёра…',
    streakDays: 'Серия',
    growthPoints: 'Опыт',
    members: 'Участники',
    enterCode: 'Введите код пары',
    wardrobePlaceholder: 'Скоро…',
    shopPlaceholder: 'Скоро…',
    notifications: 'Уведомления',
    sound: 'Звук',
    language: 'Язык',
    pairCode: 'Код пары',
    background: 'Фон',
    stages: 'Стадии',
    egg: 'Яйцо',
    baby: 'Малыш',
    teen: 'Подросток',
    adult: 'Взрослый',
    legend: 'Легенда',
    petDied: 'ПИТОМЕЦ УМЕР',
    petDiedDesc: 'Вы пропустили день кормления.',
    recoverStreak: 'Восстановить серию',
    createNewEgg: 'Создать новое яйцо',
    recoveriesLeft: 'восстановлений осталось',
    noRecoveries: 'Восстановления закончились в этом месяце',
    dailyTasks: 'Ежедневные задания',
    taskFeed: 'Покорми питомца',
    taskPet: 'Погладь питомца',
    taskBg: 'Смени фон',
    completed: 'Готово',
    buySlot: 'Купить слот',
    buySlotDesc: 'Ещё одна пара за 50 ⭐',
    buySlotStars: '50 ⭐ Stars',
    partner: 'Партнёр',
    noPartner: 'Партнёра пока нет',
    choosePet: 'Выбери питомца',
    choosePetDesc: 'Яйцо вылупляется! Выбери:',
    notifyPartner: 'Напомнить партнёру',
    nudgeSent: 'Напоминание отправлено!',
    sendInvite: 'Отправить приглашение',
    changeLang: '🌐 Язык',
  }
};

function detectLanguageLocal() {
  const saved = localStorage.getItem('chumi_lang');
  if (saved) return saved;

  try {
    const tg = window.Telegram?.WebApp;
    const tgLang = tg?.initDataUnsafe?.user?.language_code;
    if (tgLang?.startsWith('ru')) return 'ru';
  } catch (e) {}

  const nav = navigator.language || navigator.userLanguage || '';
  if (nav.startsWith('ru')) return 'ru';
  return 'en';
}

function getUserId() {
  try {
    const tg = window.Telegram?.WebApp;
    const uid = tg?.initDataUnsafe?.user?.id?.toString();
    if (uid) return uid;
  } catch (e) {}
  return localStorage.getItem('chumi_test_uid') || '713156118';
}

const LangContext = createContext();

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(detectLanguageLocal);
  const [loaded, setLoaded] = useState(false);

  // При монтировании — попробовать загрузить язык из базы
  useEffect(() => {
    const uid = getUserId();
    fetch(`/api/user-lang/${uid}`)
      .then(r => r.json())
      .then(data => {
        if (data.lang && (data.lang === 'ru' || data.lang === 'en')) {
          setLangState(data.lang);
          localStorage.setItem('chumi_lang', data.lang);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setLang = (l) => {
    setLangState(l);
    localStorage.setItem('chumi_lang', l);

    // Сохранить в базу
    const uid = getUserId();
    fetch('/api/set-lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, lang: l }),
    }).catch(() => {});
  };

  const t = (key) => strings[lang]?.[key] || strings.en[key] || key;

  return (
    <LangContext.Provider value={{ lang, setLang, t, loaded }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
