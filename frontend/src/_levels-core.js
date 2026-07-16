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
export function computeLevel(
  levels,
  totalPoints,
) {
  if (
    !Array.isArray(levels) ||
    levels.length === 0
  ) {
    throw new Error(
      'computeLevel requires a non-empty levels array',
    );
  }

  const parsedPoints = Number(totalPoints);

  const safePoints =
    Number.isFinite(parsedPoints)
      ? Math.max(0, parsedPoints)
      : 0;

  let accumulatedPoints = 0;

  for (
    let index = 0;
    index < levels.length;
    index += 1
  ) {
    const level = levels[index];

    const needed = Math.max(
      0,
      Number(level.maxPoints) || 0,
    );

    const levelEnd =
      accumulatedPoints + needed;

    if (safePoints < levelEnd) {
      return {
        ...level,
        idx: index,
        current:
          safePoints -
          accumulatedPoints,
        needed,
        remaining:
          levelEnd - safePoints,
      };
    }

    accumulatedPoints = levelEnd;
  }

  const lastIndex =
    levels.length - 1;

  const lastLevel =
    levels[lastIndex];

  const lastNeeded = Math.max(
    0,
    Number(lastLevel.maxPoints) || 0,
  );

  return {
    ...lastLevel,
    idx: lastIndex,
    current: lastNeeded,
    needed: lastNeeded,
    remaining: 0,
  };
}
