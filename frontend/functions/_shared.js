// Общие хелперы и константы для bot.js и api/[[path]].js.
// Единый источник правды — чтобы не было копипасты и рассинхрона.

import { createClient } from '@supabase/supabase-js';

// ── Константы ──
export const ADMIN_IDS = ['713156118'];

/*
 * Аккаунты, которым разрешено оплачивать
 * служебный счёт на пополнение баланса бота.
 * Прав администратора этот список не даёт.
 */
export const TOPUP_USER_IDS = [
  ...ADMIN_IDS,
  '7589962009',
];

export const MAX_PAIRS_BASE = 2;
export const WEBAPP_URL = 'https://chumi.space';

// ── Supabase ──
export function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

// ── Генерация кода пары ──
export function generateCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomValues = new Uint32Array(6);

  crypto.getRandomValues(randomValues);

  let code = '';

  for (
    let index = 0;
    index < randomValues.length;
    index += 1
  ) {
    code +=
      characters[
        randomValues[index] %
        characters.length
      ];
  }

  return code;
}

// attempts по умолчанию 10 (как в bot.js); api вызывал с 20 — передаём параметром.
export async function generateUniqueCode(
  supabase,
  attempts = 10,
) {
  for (
    let attempt = 0;
    attempt < attempts;
    attempt += 1
  ) {
    const code = generateCode();

    const {
      data,
      error,
    } = await supabase
      .from('pairs')
      .select('code')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unique code check failed: ${error.message}`,
      );
    }

    if (!data) {
      return code;
    }
  }

  throw new Error(
    `Could not generate a unique pair code after ${attempts} attempts`,
  );
}

// ── Экранирование Markdown (legacy parse_mode: 'Markdown') ──
// Обратный слеш экранируем ПЕРВЫМ, иначе он испортит уже добавленные слеши.
export function escapeMd(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/([_*`[\]])/g, '\\$1');
}

// ── Лимит пар ──
export async function getMaxPairs(supabase, userId) {
  if (ADMIN_IDS.includes(userId)) return 999;
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .maybeSingle();
  return MAX_PAIRS_BASE + (data?.extra_slots || 0);
}
