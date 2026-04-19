import { createContext, useContext, useState, useEffect } from 'react';

const LangContext = createContext();

const STRINGS = {
  en: {
    noPets: 'No pets yet', noPetsDesc: 'Create a pair or join with a code!',
    createPair: 'Create pair', join: 'Join', yourPets: 'Your Pets',
    home: 'Home', pairs: 'Pairs', shop: 'Shop', settings: 'Settings',
    wardrobe: 'Wardrobe', wardrobeDesc: 'Outfits coming soon!',
    feed: 'Feed', feeding: 'Feeding...', fed: 'Fed',
    inviteFriend: 'Invite friend', codeCopied: 'Code copied!',
    loading: 'Loading...', pairNotFound: 'Pair not found', back: 'Back',
    egg: 'Egg', hatchesIn: 'Hatches in', days: 'days',
    notifications: 'Notifications', reminders: 'Reminders',
    sound: 'Sound', effects: 'Effects', pairCode: 'Pair code',
    background: 'Background', language: 'Language',
    createNewPair: 'Create New Pair',
    createDesc: 'An egg will appear. Feed it together for 3 days to hatch!',
    cancel: 'Cancel', create: 'Create', creating: 'Creating...',
    pairCreated: 'Pair Created!', shareCode: 'Share this code with your friend:',
    tapToCopy: 'Tap to copy', done: 'Done',
    joinPair: 'Join a Pair', pairCodeLabel: 'Pair code:', joining: 'Joining...',
    shopDesc: 'Accessories coming soon!',
    hatched: 'hatched!', evolved: 'Evolved:', bothFed: 'Both fed today!',
    fedWaiting: 'Fed! Waiting for partner...', connectionError: 'Connection error',
    inviteBtn: 'Invite', createBtn: 'Create',
    manageDesc: 'Create a new pair or join your friend',
    deletePair: 'Delete pair', deleteConfirm: 'Delete this pair and pet? This cannot be undone.',
    delete: 'Delete', deleting: 'Deleting...', deleted: 'Pair deleted',
    renamePet: 'Rename pet', petNamePlaceholder: 'Enter name',
    save: 'Save', saving: 'Saving...', renamed: 'Pet renamed!',
    tapToName: 'Tap to name your pet',
  },
  ru: {
    noPets: 'Питомцев пока нет', noPetsDesc: 'Создай пару или присоединись по коду!',
    createPair: 'Создать пару', join: 'Войти', yourPets: 'Твои питомцы',
    home: 'Дом', pairs: 'Пары', shop: 'Магазин', settings: 'Настройки',
    wardrobe: 'Гардероб', wardrobeDesc: 'Наряды скоро появятся!',
    feed: 'Кормить', feeding: 'Кормлю...', fed: 'Покормлен',
    inviteFriend: 'Пригласить друга', codeCopied: 'Код скопирован!',
    loading: 'Загрузка...', pairNotFound: 'Пара не найдена', back: 'Назад',
    egg: 'Яйцо', hatchesIn: 'Вылупится через', days: 'дн.',
    notifications: 'Уведомления', reminders: 'Напоминания',
    sound: 'Звук', effects: 'Эффекты', pairCode: 'Код пары',
    background: 'Фон', language: 'Язык',
    createNewPair: 'Создать пару',
    createDesc: 'Появится яйцо. Кормите вместе 3 дня — и оно вылупится!',
    cancel: 'Отмена', create: 'Создать', creating: 'Создаю...',
    pairCreated: 'Пара создана!', shareCode: 'Отправь этот код другу:',
    tapToCopy: 'Нажми, чтобы скопировать', done: 'Готово',
    joinPair: 'Присоединиться', pairCodeLabel: 'Код пары:', joining: 'Вхожу...',
    shopDesc: 'Аксессуары скоро появятся!',
    hatched: 'вылупился!', evolved: 'Эволюция:', bothFed: 'Оба покормили!',
    fedWaiting: 'Покормлен! Жду партнёра...', connectionError: 'Ошибка соединения',
    inviteBtn: 'Пригласить', createBtn: 'Создать',
    manageDesc: 'Создай новую пару или присоединись к другу',
    deletePair: 'Удалить пару', deleteConfirm: 'Удалить пару и питомца? Это нельзя отменить.',
    delete: 'Удалить', deleting: 'Удаляю...', deleted: 'Пара удалена',
    renamePet: 'Имя питомца', petNamePlaceholder: 'Введи имя',
    save: 'Сохранить', saving: 'Сохраняю...', renamed: 'Питомец переименован!',
    tapToName: 'Нажми, чтобы дать имя',
  },
};

function detectLanguage() {
  const saved = localStorage.getItem('chumi_lang');
  if (saved) return saved;
  try {
    const tg = window.Telegram?.WebApp;
    const tgLang = tg?.initDataUnsafe?.user?.language_code;
    if (tgLang && tgLang.startsWith('ru')) return 'ru';
  } catch (e) {}
  const navLang = navigator.language || navigator.userLanguage || '';
  if (navLang.startsWith('ru')) return 'ru';
  return 'en';
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => detectLanguage());
  useEffect(() => { localStorage.setItem('chumi_lang', lang); }, [lang]);
  const t = STRINGS[lang] || STRINGS.en;
  const setLang = (l) => setLangState(l);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() { return useContext(LangContext); }
