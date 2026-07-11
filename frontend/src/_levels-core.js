// ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ для уровней (пороги + названия).
// Импортируется и фронтом (_levels-meta.js), и бэком (functions/_levels.js).
// Здесь НЕТ визуальных данных (цвета/спрайты) — только то, что общее
// для клиента и сервера.

export const LEVEL_CORE = [
  { level: 0, name: 'Egg',    nameRu: 'Яйцо',      emoji: '🥚', maxPoints: 33  },
  { level: 1, name: 'Baby',   nameRu: 'Малыш',     emoji: '🐣', maxPoints: 45  },
  { level: 2, name: 'Junior', nameRu: 'Подросток', emoji: '🐾', maxPoints: 63  },
  { level: 3, name: 'Teen',   nameRu: 'Юный',      emoji: '💜', maxPoints: 90  },
  { level: 4, name: 'Adult',  nameRu: 'Взрослый',  emoji: '💎', maxPoints: 135 },
  { level: 5, name: 'Legend', nameRu: 'Легенда',   emoji: '👑', maxPoints: 200 },
];

// Общая функция расчёта уровня. Принимает массив уровней (чтобы фронт мог
// передать свой расширенный массив с визуалом, а бэк — базовый LEVEL_CORE),
// и всегда считает по полю maxPoints, которое одинаково в обоих.
export function computeLevel(levels, totalPoints) {
  let acc = 0;
  for (let i = 0; i < levels.length; i++) {
    if (totalPoints < acc + levels[i].maxPoints) {
      return {
        ...levels[i],
        idx: i,
        current: totalPoints - acc,
        needed: levels[i].maxPoints,
        remaining: acc + levels[i].maxPoints - totalPoints,
      };
    }
    acc += levels[i].maxPoints;
  }
  const last = levels[levels.length - 1];
  return {
    ...last,
    idx: levels.length - 1,
    current: last.maxPoints,
    needed: last.maxPoints,
    remaining: 0,
  };
}
