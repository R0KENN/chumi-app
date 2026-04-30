import { LEVELS as BASE } from '../../functions/_levels.js';

const META = [
  { bg: ['#F5F0FF','#E8E0F0'], accent: '#B39DDB', pet: null,             petTap: null,                 emojiId: null },
  { bg: ['#F3EDF7','#D7C8E8'], accent: '#9B72CF', pet: 'axolotl_idle',   petTap: 'axolotl_tap',        emojiId: null },
  { bg: ['#FFF4EC','#FDDCBF'], accent: '#E8985A', pet: 'axolotl_peach',  petTap: 'axolotl_peach_tap',  emojiId: null },
  { bg: ['#FFF0F3','#F9C8D4'], accent: '#E8729A', pet: 'axolotl_pink',   petTap: 'axolotl_pink_tap',   emojiId: null },
  { bg: ['#EDF5FC','#B8D8F4'], accent: '#4A9AD4', pet: 'axolotl_blue',   petTap: 'axolotl_blue_tap',   emojiId: null },
  { bg: ['#1A1A2E','#16213E'], accent: '#E94560', pet: 'axolotl_black',  petTap: 'axolotl_black_tap',  emojiId: null },
];

export const LEVELS = BASE.map((l, i) => ({ ...l, ...META[i], check: META[i].accent }));
export { getLevel } from '../../functions/_levels.js';
