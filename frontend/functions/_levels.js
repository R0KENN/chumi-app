// Уровни на сервере: базовый набор порогов из общего ядра.
// ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ порогов — frontend/src/_levels-core.js.
import { LEVEL_CORE, computeLevel } from '../src/_levels-core.js';

export const LEVELS = LEVEL_CORE;

export function getLevel(totalPoints) {
  return computeLevel(LEVELS, totalPoints);
}
