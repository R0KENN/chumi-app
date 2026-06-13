// Набор кастомных иконок для нижнего дока.
// Все рисуются через currentColor — цвет наследуется от .lg-tab.
const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

// 🐾 Питомец — лапка
export function IconPet(props) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="6.5" cy="9.5" rx="1.7" ry="2.2" fill="currentColor" stroke="none" />
      <ellipse cx="17.5" cy="9.5" rx="1.7" ry="2.2" fill="currentColor" stroke="none" />
      <ellipse cx="9.8" cy="6" rx="1.5" ry="2" fill="currentColor" stroke="none" />
      <ellipse cx="14.2" cy="6" rx="1.5" ry="2" fill="currentColor" stroke="none" />
      <path d="M12 12.5c-2.5 0-4.6 1.8-4.6 4 0 1.7 1.5 2.6 3 2.6 0.8 0 1.1-0.3 1.6-0.3s0.8 0.3 1.6 0.3c1.5 0 3-0.9 3-2.6 0-2.2-2.1-4-4.6-4Z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

// 📅 Календарь
export function IconCalendar(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v3M16 3v3" />
      <circle cx="8.5" cy="13.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 📔 Дневник — книжка с сердечком
export function IconDiary(props) {
  return (
    <svg {...base} {...props}>
      <path d="M5 4.5h11a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 19V4.5Z" />
      <path d="M5 19a2.5 2.5 0 0 1 2.5-2.5h11" />
      <path d="M11.8 9.2c-0.7-0.8-2-0.6-2.4 0.4-0.3 0.7 0 1.4 0.6 2l1.8 1.7 1.8-1.7c0.6-0.6 0.9-1.3 0.6-2-0.4-1-1.7-1.2-2.4-0.4Z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

// 🏆 Рейтинг — кубок
export function IconTrophy(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7 4.5h10v4a5 5 0 0 1-10 0v-4Z" />
      <path d="M7 6H4.5v1.5A3 3 0 0 0 7 10.5M17 6h2.5v1.5A3 3 0 0 1 17 10.5" />
      <path d="M12 13.5v3" />
      <path d="M8.5 19.5h7M9.5 19.5l0.5-3h4l0.5 3" />
    </svg>
  );
}

// ⋯ Ещё — три точки
export function IconMore(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 💌 Открытка — конверт с сердечком
export function IconPostcard(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
      <path d="M12 11.2c-0.6-0.7-1.7-0.5-2 0.3-0.25 0.6 0 1.2 0.5 1.6l1.5 1.4 1.5-1.4c0.5-0.4 0.75-1 0.5-1.6-0.3-0.8-1.4-1-2-0.3Z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

// 📤 Поделиться — стрелка вверх из коробки
export function IconShare(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5v11" />
      <path d="M8.5 7L12 3.5 15.5 7" />
      <path d="M6 12.5v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

// 🌐 Язык — глобус
export function IconGlobe(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.3-3.5-8.5S9.7 5.8 12 3.5Z" />
    </svg>
  );
}

// 🗑️ Удалить — корзина
export function IconTrash(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 6.5h15" />
      <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
      <path d="M6.5 6.5l0.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l0.8-12" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

// 👕 Наряды — футболка
export function IconShirt(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 4l-4.5 2.2a1 1 0 0 0-0.5 1.1l0.8 3.1a0.8 0.8 0 0 0 1 0.6l1.7-0.5V19a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-8.5l1.7 0.5a0.8 0.8 0 0 0 1-0.6l0.8-3.1a1 1 0 0 0-0.5-1.1L15 4" />
      <path d="M9 4c0 1.6 1.3 2.8 3 2.8S15 5.6 15 4" />
    </svg>
  );
}

// 💕 Мои пары — два сердца
export function IconPairs(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8.2 7.2c-1-1.1-2.8-0.9-3.4 0.5-0.4 0.9 0 1.9 0.8 2.7l4.4 4.3 4.4-4.3c0.8-0.8 1.2-1.8 0.8-2.7-0.6-1.4-2.4-1.6-3.4-0.5l-0.8 0.9-0.8-0.9Z"
        fill="currentColor" stroke="none" opacity="0.45" />
      <path d="M13.4 10.6c-1-1.1-2.8-0.9-3.4 0.5-0.4 0.9 0 1.9 0.8 2.7l4.4 4.3 4.4-4.3c0.8-0.8 1.2-1.8 0.8-2.7-0.6-1.4-2.4-1.6-3.4-0.5l-0.8 0.9-0.8-0.9Z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

// ☀️ Солнце — для переключения на светлую тему
export function IconSun(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M2.5 12H5M19 12h2.5M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8" />
    </svg>
  );
}

// 🌙 Луна — для переключения на тёмную тему
export function IconMoon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"
        fill="currentColor" stroke="none" />
    </svg>
  );
}

// 🎮 Игра — джойстик
export function IconGame(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
      <path d="M7 10.5v3M5.5 12h3" />
      <circle cx="15.5" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
