// Единственный источник истины для уровней.
// При изменении синхронизируй с frontend/src/components/PairScreen.jsx

export const LEVELS = [
  { level: 0, name: 'Egg',    nameRu: 'Яйцо',       maxPoints: 33  },
  { level: 1, name: 'Baby',   nameRu: 'Малыш',      maxPoints: 45  },
  { level: 2, name: 'Junior', nameRu: 'Подросток',  maxPoints: 63  },
  { level: 3, name: 'Teen',   nameRu: 'Юный',       maxPoints: 90  },
  { level: 4, name: 'Adult',  nameRu: 'Взрослый',   maxPoints: 135 },
  { level: 5, name: 'Legend', nameRu: 'Легенда',    maxPoints: 200 },
];

export function getLevel(totalPoints) {
  let acc = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < acc + LEVELS[i].maxPoints) {
      return {
        ...LEVELS[i],
        idx: i,
        current: totalPoints - acc,
        needed: LEVELS[i].maxPoints,
        remaining: acc + LEVELS[i].maxPoints - totalPoints,
      };
    }
    acc += LEVELS[i].maxPoints;
  }
  const last = LEVELS[LEVELS.length - 1];
  return { ...last, idx: LEVELS.length - 1, current: last.maxPoints, needed: last.maxPoints, remaining: 0 };
}
