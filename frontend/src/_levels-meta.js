// Уровни для клиента: пороги берём из общего ядра (_levels-core.js),
// а визуальные данные (цвета/спрайты) добавляем поверх здесь.
// Пороги физически не могут разойтись с сервером, т.к. maxPoints/name
// приходят из одного и того же LEVEL_CORE.

import { LEVEL_CORE, computeLevel } from './_levels-core.js';

// Визуальные метаданные по индексу уровня. Порядок соответствует LEVEL_CORE.
const LEVEL_VISUALS = [
  { bg: ['#F5F0FF','#E8E0F0'], accent: '#B39DDB', check: '#B39DDB',
    pet: null,            petTap: null,                emojiId: null },
  { bg: ['#F3EDF7','#D7C8E8'], accent: '#9B72CF', check: '#9B72CF',
    pet: 'axolotl_idle',  petTap: 'axolotl_tap',       emojiId: null },
  { bg: ['#FFF4EC','#FDDCBF'], accent: '#E8985A', check: '#E8985A',
    pet: 'axolotl_peach', petTap: 'axolotl_peach_tap', emojiId: null },
  { bg: ['#FFF0F3','#F9C8D4'], accent: '#E8729A', check: '#E8729A',
    pet: 'axolotl_pink',  petTap: 'axolotl_pink_tap',  emojiId: null },
  { bg: ['#EDF5FC','#B8D8F4'], accent: '#4A9AD4', check: '#4A9AD4',
    pet: 'axolotl_blue',  petTap: 'axolotl_blue_tap',  emojiId: null },
  { bg: ['#ECEAF5','#C7C2DE'], accent: '#6C5CE7', check: '#6C5CE7',
    pet: 'axolotl_black', petTap: 'axolotl_black_tap', emojiId: null },
];

// Собираем полный LEVELS: ядро + визуал по индексу.
export const LEVELS = LEVEL_CORE.map((core, i) => ({
  ...core,
  ...(LEVEL_VISUALS[i] || {}),
}));

export function getLevel(totalPoints) {
  return computeLevel(LEVELS, totalPoints);
}
