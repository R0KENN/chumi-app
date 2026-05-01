// Единственный источник истины LEVELS для клиента.
// При изменении синхронизируй с frontend/functions/_levels.js (он используется на сервере).

export const LEVELS = [
  { level: 0, name: 'Egg',    nameRu: 'Яйцо',      maxPoints: 33,
    bg: ['#F5F0FF','#E8E0F0'], accent: '#B39DDB', check: '#B39DDB',
    pet: null,            petTap: null,                emojiId: null },
  { level: 1, name: 'Baby',   nameRu: 'Малыш',     maxPoints: 45,
    bg: ['#F3EDF7','#D7C8E8'], accent: '#9B72CF', check: '#9B72CF',
    pet: 'axolotl_idle',  petTap: 'axolotl_tap',       emojiId: null },
  { level: 2, name: 'Junior', nameRu: 'Подросток', maxPoints: 63,
    bg: ['#FFF4EC','#FDDCBF'], accent: '#E8985A', check: '#E8985A',
    pet: 'axolotl_peach', petTap: 'axolotl_peach_tap', emojiId: null },
  { level: 3, name: 'Teen',   nameRu: 'Юный',      maxPoints: 90,
    bg: ['#FFF0F3','#F9C8D4'], accent: '#E8729A', check: '#E8729A',
    pet: 'axolotl_pink',  petTap: 'axolotl_pink_tap',  emojiId: null },
  { level: 4, name: 'Adult',  nameRu: 'Взрослый',  maxPoints: 135,
    bg: ['#EDF5FC','#B8D8F4'], accent: '#4A9AD4', check: '#4A9AD4',
    pet: 'axolotl_blue',  petTap: 'axolotl_blue_tap',  emojiId: null },
  { level: 5, name: 'Legend', nameRu: 'Легенда',   maxPoints: 200,
    bg: ['#1A1A2E','#16213E'], accent: '#E94560', check: '#E94560',
    pet: 'axolotl_black', petTap: 'axolotl_black_tap', emojiId: null },
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
  return {
    ...last,
    idx: LEVELS.length - 1,
    current: last.maxPoints,
    needed: last.maxPoints,
    remaining: 0,
  };
}
