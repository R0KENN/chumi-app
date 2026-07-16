import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { LEVELS, getLevel } from '../_levels.js';
import { SKIN_PRICES, PRODUCT_PRICES } from '../_prices.js';
import {
  ADMIN_IDS, MAX_PAIRS_BASE, WEBAPP_URL,
  getSupabase, generateUniqueCode, escapeMd, getMaxPairs,
} from '../_shared.js';

// ────────── CONFIG ──────────

const TASK_POINTS = {
  daily_open: 1,
  send_msg: 1,
  send_sticker: 2,
  send_media: 4,
  pet_touch: 1,
};

async function isPremium(
  _supabase,
  userId
) {
  return ADMIN_IDS.includes(
    String(userId)
  );
}

// Дата YYYY-MM-DD в указанной таймзоне (UTC по умолчанию)
function getTodayDate(tz) {
  const date = new Date();
  if (!tz) return date.toISOString().split('T')[0];
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

// "Вчера" в таймзоне
function getYesterdayDate(tz) {
  const today = getTodayDate(tz);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

// Текущий месяц YYYY-MM в таймзоне
function getCurrentMonth(tz) {
  return getTodayDate(tz).slice(0, 7);
}

const ALLOWED_ORIGINS = [
  'https://chumi.space',
  'https://www.chumi.space',
  'https://app.chumi.space',
  'https://chumi-app.pages.dev',
  'https://web.telegram.org',
  'https://webk.telegram.org',
  'https://webz.telegram.org',
];

function corsHeaders(request) {
  const origin = request?.headers?.get?.('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Telegram-Init-Data',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}

async function sendTelegramMessage(env, chatId, text, extra = {}) {
  try {
    const body = { chat_id: chatId, text, parse_mode: 'Markdown', ...extra };

    if (!body.reply_markup) {
      body.reply_markup = {
        inline_keyboard: [[
          { text: '🐾 Открыть Chumi', web_app: { url: 'https://chumi.space' } },
        ]],
      };
    }

    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Проверяем ответ Telegram: если пользователь заблокировал бота
    // (403) или чат не найден — логируем, но не падаем.
    if (!res.ok) {
      let desc = '';
      try { const j = await res.json(); desc = j.description || ''; } catch {}
      const blocked = res.status === 403 || /blocked|deactivated|chat not found/i.test(desc);
      console.warn(`Telegram send failed (chat ${chatId}, status ${res.status})${blocked ? ' [blocked]' : ''}: ${desc}`);
      return { ok: false, blocked, status: res.status, description: desc };
    }
    return { ok: true };
  } catch (e) {
    console.error('Telegram send error:', e);
    return { ok: false, error: String(e) };
  }
}

// ────────── Admin notifications ──────────
async function notifyAdmins(env, text) {
  for (const adminId of ADMIN_IDS) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          text: '🛠 ' + text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {}
  }
}


// ────────── Telegram initData validation ──────────
function validateInitData(
  initDataRaw,
  botToken,
  maxAgeSec = 21_600,
) {
  if (
    typeof initDataRaw !== 'string' ||
    !initDataRaw ||
    typeof botToken !== 'string' ||
    !botToken
  ) {
    return null;
  }

  try {
    const params = new URLSearchParams(initDataRaw);
    const receivedHash = params.get('hash');

    if (
      !receivedHash ||
      !/^[a-f0-9]{64}$/i.test(receivedHash)
    ) {
      return null;
    }

    params.delete('hash');

    const entries = [...params.entries()]
      .sort(([firstKey], [secondKey]) =>
        firstKey.localeCompare(secondKey)
      );

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHmac(
      'sha256',
      'WebAppData',
    )
      .update(botToken)
      .digest();

    const computedHash = createHmac(
      'sha256',
      secretKey,
    )
      .update(dataCheckString)
      .digest('hex');

    const receivedBuffer =
      Buffer.from(receivedHash, 'hex');

    const computedBuffer =
      Buffer.from(computedHash, 'hex');

    if (
      receivedBuffer.length !== computedBuffer.length ||
      !timingSafeEqual(
        receivedBuffer,
        computedBuffer,
      )
    ) {
      return null;
    }

    const authDate = Number(
      params.get('auth_date'),
    );

    if (!Number.isInteger(authDate) || authDate <= 0) {
      return null;
    }

    const currentUnixTime = Math.floor(
      Date.now() / 1000,
    );

    const ageSeconds =
      currentUnixTime - authDate;

    /*
     * Максимум 30 секунд в будущем допускается из-за
     * небольшой разницы часов между устройствами.
     */
    if (
      ageSeconds < -30 ||
      ageSeconds > maxAgeSec
    ) {
      return null;
    }

    const userRaw = params.get('user');

    if (!userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw);
    const userId = user?.id;

    if (
      userId === undefined ||
      userId === null ||
      !/^\d+$/.test(String(userId))
    ) {
      return null;
    }

    return {
      userId: String(userId),
      user,
      authDate,
    };
  } catch (error) {
    console.warn(
      'Telegram initData validation failed:',
      error,
    );

    return null;
  }
}

// Разрешаем dev-обход авторизации ТОЛЬКО когда запрос реально с localhost.
// Это страхует от случайно выставленной ALLOW_DEV_AUTH=1 в продакшене.
function isLocalDev(request, env) {
  if (env.ALLOW_DEV_AUTH !== '1') return false;
  try {
    const host = new URL(request.url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function extractUserId(request, env, bodyUserId, opts = {}) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN, opts.maxAgeSec);
    if (validated) return validated.userId;
  }
  if (isLocalDev(request, env) && bodyUserId) return String(bodyUserId);
  return null;
}

// Возвращает userId вызывающего ТОЛЬКО из проверенного initData (без dev-fallback по URL).
// Для GET-эндпоинтов, где userId нельзя брать из тела/пути.
function getAuthedUserId(request, env) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN);
    if (validated) return validated.userId;
  }
  if (isLocalDev(request, env)) {
    // 1) Заголовок (если фронт его прислал)
    const devId = request.headers.get('X-Dev-User-Id');
    if (devId) return String(devId);
    // 2) Query-параметр ?devUser=...
    try {
      const url = new URL(request.url);
      const q = url.searchParams.get('devUser');
      if (q) return String(q);
    } catch {}
  }
  return null;
}

// Проверяет, что userId — участник пары pairCode.
async function isPairMember(supabase, pairCode, userId) {
  if (!pairCode || !userId) return false;
  const { data } = await supabase
    .from('pair_users').select('user_id')
    .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
  return !!data;
}

async function _usersSharePair(
  supabase,
  firstUserId,
  secondUserId
) {
  if (!firstUserId || !secondUserId) {
    return false;
  }

  if (
    String(firstUserId) ===
    String(secondUserId)
  ) {
    return true;
  }

  const {
    data: firstMemberships,
    error: firstError,
  } = await supabase
    .from('pair_users')
    .select('pair_code')
    .eq('user_id', String(firstUserId));

  if (firstError || !firstMemberships?.length) {
    return false;
  }

  const pairCodes = firstMemberships.map(
    (membership) => membership.pair_code
  );

  const {
    data: sharedMembership,
    error: sharedError,
  } = await supabase
    .from('pair_users')
    .select('pair_code')
    .eq('user_id', String(secondUserId))
    .in('pair_code', pairCodes)
    .limit(1)
    .maybeSingle();

  if (sharedError) {
    console.error(
      'Shared pair check failed:',
      sharedError
    );

    return false;
  }

  return Boolean(sharedMembership);
}

function isCronAuthorized(request, env) {
  if (!env.CRON_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.CRON_SECRET}`;
}

function formatPair(pair, members, tasksToday, userId) {
  const lv = getLevel(pair.growth_points || 0);
  const partner = members?.find(m => m.user_id !== userId);
  const me = members?.find(m => m.user_id === userId);

  return {
    code: pair.code,
    pet_type: pair.pet_type,
    pet_name: pair.pet_name,
    streak_days: pair.streak_days || 0,
    growth_points: pair.growth_points || 0,
    level: lv.level,
    levelName: lv.name,
    bg_id: pair.bg_id || 'room',
    is_dead: pair.is_dead || false,
    hatched: pair.hatched || false,
    streak_recoveries_used: pair.streak_recoveries_used || 0,
    last_recovery_month: pair.last_recovery_month,
    last_streak_date: pair.last_streak_date,
    members: members?.map(m => ({
      user_id: m.user_id,
      display_name: m.display_name || null,
      username: m.username || null,
      // avatar_url фронт получает отдельным авторизованным запросом /api/avatar/:id
    })) || [],
    active_skin: pair.active_skin || null,
    active_bg: pair.active_bg || null,
    partner_name: partner?.display_name || null,
    partner_username: partner?.username || null,
    my_name: me?.display_name || null,
    member_count: members?.length || 0,
    daily_tasks: tasksToday || [],
  };
}

// ────────── Подписанные ссылки на аватар ──────────
// Токен = HMAC(botToken, "avatar:<userId>:<expTs>"). Защищает бинарный
// прокси-эндпоинт от перебора чужих user_id: ссылку выдаёт только
// авторизованный JSON-запрос, и живёт она ограниченное время.
async function makeAvatarToken(botToken, userId, expTs) {
  const key = createHmac('sha256', 'AvatarProxy').update(botToken).digest();
  return createHmac('sha256', key)
    .update(`avatar:${userId}:${expTs}`)
    .digest('hex')
    .slice(0, 32);
}

async function verifyAvatarToken(
  botToken,
  userId,
  expTs,
  token,
) {
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{32}$/i.test(token) ||
    !expTs
  ) {
    return false;
  }

  const expiresAt = Number(expTs);

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  /*
   * Не принимаем ссылки, срок которых находится слишком далеко
   * в будущем. Это ограничивает последствия ошибочной генерации.
   */
  if (expiresAt - Date.now() > 2 * 60 * 60 * 1000) {
    return false;
  }

  const expectedToken = await makeAvatarToken(
    botToken,
    userId,
    expiresAt,
  );

  const receivedBuffer =
    Buffer.from(token, 'hex');

  const expectedBuffer =
    Buffer.from(expectedToken, 'hex');

  if (
    receivedBuffer.length !== expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    receivedBuffer,
    expectedBuffer,
  );
}


function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffleWithSeed(arr, seed) {
  const shuffled = [...arr];
  const rng = seededRandom(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function createStarsInvoice(botToken, params) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) return null;
  return data.result;
}

// ────────── MAIN HANDLER ──────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }


  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const supabase = getSupabase(env);

        // ── POST /api/game-session ──
    if (
      request.method === 'POST' &&
      path === '/api/game-session'
    ) {
      const body = await request
        .json()
        .catch(() => ({}));

      const userId = extractUserId(
        request,
        env,
        body.userId
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const pairCode =
        typeof body.pairCode === 'string'
          ? body.pairCode.trim().toUpperCase()
          : '';

      if (!pairCode) {
        return json(
          { error: 'pairCode is required' },
          400,
          request
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          userId
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request
        );
      }

      const {
        data: session,
        error: sessionError,
      } = await supabase
        .from('jump_game_sessions')
        .insert({
          user_id: userId,
          pair_code: pairCode,
          started_at: new Date().toISOString(),
          expires_at: new Date(
            Date.now() + 30 * 60 * 1000
          ).toISOString(),
        })
        .select('id, expires_at')
        .single();

      if (sessionError) {
        console.error(
          'Game session creation failed:',
          sessionError
        );

        return json(
          { error: 'Failed to create game session' },
          500,
          request
        );
      }

      return json(
        {
          sessionId: session.id,
          expiresAt: session.expires_at,
        },
        201,
        request
      );
    }

    // ── GET /api/game-score/:pairCode ──
    if (
      request.method === 'GET' &&
      path.match(/^\/api\/game-score\/[^/]+$/)
    ) {
      const pairCode = path
        .split('/')[3]
        .trim()
        .toUpperCase();

      const userId = getAuthedUserId(
        request,
        env
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          userId
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request
        );
      }

      const {
        data: pair,
        error: pairError,
      } = await supabase
        .from('pairs')
        .select('game_best_score')
        .eq('code', pairCode)
        .maybeSingle();

      if (pairError) {
        console.error(
          'Pair score query failed:',
          pairError
        );

        return json(
          { error: 'Failed to load pair score' },
          500,
          request
        );
      }

      const {
        data: personal,
        error: personalError,
      } = await supabase
        .from('jump_game_scores')
        .select('best_score')
        .eq('user_id', userId)
        .maybeSingle();

      if (personalError) {
        console.error(
          'Personal score query failed:',
          personalError
        );

        return json(
          { error: 'Failed to load personal score' },
          500,
          request
        );
      }

      const personalBest =
        Number(personal?.best_score) || 0;

      let rank = null;

      if (personalBest > 0) {
        const {
          count,
          error: rankError,
        } = await supabase
          .from('jump_game_scores')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .gt('best_score', personalBest);

        if (rankError) {
          console.error(
            'Rank query failed:',
            rankError
          );
        } else {
          rank = (count || 0) + 1;
        }
      }

      return json(
        {
          best:
            Number(pair?.game_best_score) || 0,
          personalBest,
          rank,
        },
        200,
        request
      );
    }

    // ── GET /api/game-leaderboard ──
    if (
      request.method === 'GET' &&
      path === '/api/game-leaderboard'
    ) {
      const userId = getAuthedUserId(
        request,
        env
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const {
        data: rows,
        error: leadersError,
      } = await supabase
        .from('jump_game_scores')
        .select(
          'user_id, display_name, username, best_score, updated_at'
        )
        .gt('best_score', 0)
        .order('best_score', {
          ascending: false,
        })
        .order('updated_at', {
          ascending: true,
        })
        .order('user_id', {
          ascending: true,
        })
        .limit(50);

      if (leadersError) {
        console.error(
          'Leaderboard query failed:',
          leadersError
        );

        return json(
          { error: 'Failed to load leaderboard' },
          500,
          request
        );
      }

      let previousScore = null;
      let previousRank = 0;

      /*
       * Сначала рассчитываем места синхронно.
       * Пользователи с одинаковым количеством очков
       * получают одинаковое место.
       */
      const rankedLeaders = (rows || []).map(
        (row, index) => {
          const rowScore =
            Number(row.best_score) || 0;

          const rank =
            previousScore === rowScore
              ? previousRank
              : index + 1;

          previousScore = rowScore;
          previousRank = rank;

          return {
            rank,
            userId:
              String(row.user_id),
            displayName:
              row.display_name ||
              'Player',
            username:
              row.username || null,
            score: rowScore,
            isMe:
              String(row.user_id) ===
              String(userId),
          };
        },
      );

      /*
       * <img> не может отправить X-Telegram-Init-Data,
       * поэтому создаём для каждой аватарки временную
       * подписанную ссылку.
       *
       * Ссылка доступна любому пользователю,
       * получившему результат рейтинга, и действует 1 час.
       * Само изображение отдельно кешируется браузером/CDN.
       */
      const avatarExpiresAt =
        Date.now() + 60 * 60 * 1000;

      const leaders = await Promise.all(
        rankedLeaders.map(async leader => {
          const avatarSignature =
            await makeAvatarToken(
              env.BOT_TOKEN,
              leader.userId,
              avatarExpiresAt,
            );

          const avatarUrl =
            `/api/avatar/${encodeURIComponent(
              leader.userId,
            )}` +
            `?proxy=1` +
            `&exp=${avatarExpiresAt}` +
            `&sig=${avatarSignature}`;

          return {
            ...leader,
            avatarUrl,
          };
        }),
      );

      const {
        data: personal,
        error: personalError,
      } = await supabase
        .from('jump_game_scores')
        .select('best_score')
        .eq('user_id', userId)
        .maybeSingle();

      if (personalError) {
        console.error(
          'Personal leaderboard query failed:',
          personalError
        );
      }

      const personalBest =
        Number(personal?.best_score) || 0;

      let personalRank = null;

      if (personalBest > 0) {
        const {
          count,
          error: rankError,
        } = await supabase
          .from('jump_game_scores')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .gt('best_score', personalBest);

        if (rankError) {
          console.error(
            'Personal rank query failed:',
            rankError
          );
        } else {
          personalRank = (count || 0) + 1;
        }
      }

      return json(
        {
          leaders,
          me: personalBest > 0
            ? {
                rank: personalRank,
                score: personalBest,
              }
            : null,
        },
        200,
        request
      );
    }

    // ── POST /api/game-score ──
    if (
      request.method === 'POST' &&
      path === '/api/game-score'
    ) {
      const body = await request
        .json()
        .catch(() => ({}));

      const initDataRaw = request.headers.get(
        'X-Telegram-Init-Data'
      );

      const telegramData = initDataRaw
        ? validateInitData(
            initDataRaw,
            env.BOT_TOKEN
          )
        : null;

      const userId = extractUserId(
        request,
        env,
        body.userId
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const pairCode =
        typeof body.pairCode === 'string'
          ? body.pairCode.trim().toUpperCase()
          : '';

      const sessionId =
        typeof body.sessionId === 'string'
          ? body.sessionId.trim()
          : '';

      const score = Number(body.score);

      if (!pairCode) {
        return json(
          { error: 'pairCode is required' },
          400,
          request
        );
      }

      if (!sessionId) {
        return json(
          { error: 'sessionId is required' },
          400,
          request
        );
      }

      if (
        !Number.isInteger(score) ||
        score < 0 ||
        score > 100000
      ) {
        return json(
          { error: 'Invalid score' },
          400,
          request
        );
      }

      const displayName =
        telegramData?.user?.first_name ||
        telegramData?.user?.username ||
        null;

      const username =
        telegramData?.user?.username || null;

      const {
        data,
        error,
      } = await supabase.rpc(
        'finish_jump_game',
        {
          p_session_id: sessionId,
          p_user_id: userId,
          p_pair_code: pairCode,
          p_score: score,
          p_display_name: displayName,
          p_username: username,
        }
      );

      if (error) {
        console.error(
          'Game score submission failed:',
          error
        );

        const message =
          error.message || 'Failed to save score';

        const clientError =
          /session|score|member|pair/i.test(
            message
          );

        return json(
          {
            error: message,
          },
          clientError ? 400 : 500,
          request
        );
      }

      return json(
        data || { success: true },
        200,
        request
      );
    }

    // ── GET /api/pairs/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/pairs\/[^/]+$/)) {
      const userId = path.split('/')[3];

      // ── Авторизация: запросить пары можно только за самого себя ──
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);

      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId);

      if (!userPairs || userPairs.length === 0) return json({ pairs: [] });

      const pairs = [];
      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs').select('*').eq('code', up.pair_code).maybeSingle();
        if (!pair) continue;

        const today = getTodayDate(pair.timezone || 'UTC');

        const { data: members } = await supabase
          .from('pair_users').select('*').eq('pair_code', up.pair_code);

        const { data: tasks } = await supabase
          .from('daily_tasks').select('*')
          .eq('pair_code', up.pair_code)
          .eq('user_id', userId)
          .eq('task_date', today);

        pairs.push(formatPair(pair, members, tasks, userId));
      }

      return json({ pairs });
    }

    // ── GET /api/pair/:pairCode/:userId ──
    if (
      request.method === 'GET' &&
      path.match(/^\/api\/pair\/[^/]+\/[^/]+$/)
    ) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const requestedUserId = parts[4];

      const authedId = getAuthedUserId(request, env);

      if (!authedId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      if (String(authedId) !== String(requestedUserId)) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          authedId,
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request,
        );
      }

      const {
        data: pair,
        error: pairError,
      } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', pairCode)
        .maybeSingle();

      if (pairError) {
        console.error('Pair query failed:', pairError);

        return json(
          { error: 'Failed to load pair' },
          500,
          request,
        );
      }

      if (!pair) {
        return json(
          { error: 'Pair not found' },
          404,
          request,
        );
      }

      const today = getTodayDate(
        pair.timezone || 'UTC',
      );

      const {
        data: members,
        error: membersError,
      } = await supabase
        .from('pair_users')
        .select('*')
        .eq('pair_code', pairCode);

      if (membersError) {
        console.error(
          'Pair members query failed:',
          membersError,
        );

        return json(
          { error: 'Failed to load pair members' },
          500,
          request,
        );
      }

      const {
        data: tasks,
        error: tasksError,
      } = await supabase
        .from('daily_tasks')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', authedId)
        .eq('task_date', today);

      if (tasksError) {
        console.error(
          'Daily tasks query failed:',
          tasksError,
        );

        return json(
          { error: 'Failed to load daily tasks' },
          500,
          request,
        );
      }

      return json(
        formatPair(
          pair,
          members || [],
          tasks || [],
          authedId,
        ),
        200,
        request,
      );
    }

    // ── GET /api/avatar/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/avatar\/[^/]+$/)) {
      const tgUserId = path.split('/')[3];
      const BOT_TOKEN = env.BOT_TOKEN;
      const wantProxy = url.searchParams.get('proxy');

      let avatarAuthedId = null;

      if (wantProxy === '1') {
        /*
         * Тег <img> не может передать Telegram initData,
         * поэтому бинарный запрос проверяется одноразовой
         * ограниченной по времени подписью.
         */
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');

        const tokenIsValid = await verifyAvatarToken(
          BOT_TOKEN,
          tgUserId,
          exp,
          sig,
        );

        if (!tokenIsValid) {
          return json(
            { error: 'Forbidden' },
            403,
            request,
          );
        }
      } else {
        avatarAuthedId = getAuthedUserId(
          request,
          env,
        );

        if (!avatarAuthedId) {
          return json(
            { error: 'Unauthorized' },
            401,
            request,
          );
        }

        /*
         * Сначала получаем пары вызывающего пользователя.
         */
        const {
          data: callerPairs,
          error: callerPairsError,
        } = await supabase
          .from('pair_users')
          .select('pair_code')
          .eq('user_id', avatarAuthedId);

        if (callerPairsError) {
          console.error(
            'Avatar caller pairs query failed:',
            callerPairsError,
          );

          return json(
            { error: 'Failed to verify avatar access' },
            500,
            request,
          );
        }

        const callerPairCodes = (
          callerPairs || []
        ).map((row) => row.pair_code);

        if (callerPairCodes.length === 0) {
          return json(
            { avatar_url: null },
            200,
            request,
          );
        }

        /*
         * Целевой пользователь должен состоять хотя бы
         * в одной паре вместе с вызывающим.
         */
        const {
          data: sharedMembership,
          error: sharedMembershipError,
        } = await supabase
          .from('pair_users')
          .select('pair_code')
          .eq('user_id', tgUserId)
          .in('pair_code', callerPairCodes)
          .limit(1)
          .maybeSingle();

        if (sharedMembershipError) {
          console.error(
            'Shared avatar membership query failed:',
            sharedMembershipError,
          );

          return json(
            { error: 'Failed to verify avatar access' },
            500,
            request,
          );
        }

        if (!sharedMembership) {
          return json(
            { avatar_url: null },
            200,
            request,
          );
        }
      }


      try {
        const { data: cached } = await supabase
          .from('pair_users')
          .select('avatar_file_path')
          .eq('user_id', tgUserId)
          .limit(1)
          .maybeSingle();

        let filePath = cached?.avatar_file_path;

        if (!filePath) {
          const photosRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${tgUserId}&limit=1`
          );
          const photosData = await photosRes.json();
          if (!photosData.ok || !photosData.result.photos.length) {
            return json({ avatar_url: null });
          }
          const photo = photosData.result.photos[0];
          const fileId = photo[photo.length - 1].file_id;

          const fileRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
          );
          const fileData = await fileRes.json();
          if (!fileData.ok) return json({ avatar_url: null });
          filePath = fileData.result.file_path;

          await supabase.from('pair_users')
            .update({ avatar_file_path: filePath })
            .eq('user_id', tgUserId);
        }

        if (wantProxy === '1') {
          const avatarUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          const imgRes = await fetch(avatarUrl);
          if (!imgRes.ok) {
            await supabase.from('pair_users')
              .update({ avatar_file_path: null })
              .eq('user_id', tgUserId);

            const alreadyRefreshed =
              url.searchParams.get('refresh') === '1';

            if (alreadyRefreshed) {
              return new Response(
                JSON.stringify({
                  avatar_url: null,
                }),
                {
                  status: 404,
                  headers: corsHeaders(
                    request,
                    {
                      'Content-Type':
                        'application/json',
                      'Cache-Control':
                        'no-store',
                    },
                  ),
                },
              );
            }

            /*
             * Telegram file_path мог устареть.
             * Очищаем сохранённый путь и один раз
             * повторяем подписанный запрос.
             */
            const retryUrl =
              new URL(request.url);

            retryUrl.searchParams.set(
              'refresh',
              '1',
            );

            return Response.redirect(
              retryUrl.toString(),
              307,
            );
          }
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const imgBuffer = await imgRes.arrayBuffer();
          return new Response(imgBuffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400',
              ...corsHeaders(request),
            },
          });
        }

        {
          // Подписанная ссылка действует 1 час.
          // Само изображение кешируется браузером и CDN отдельно.
          const exp = Date.now() + 60 * 60 * 1000;
          const sig = await makeAvatarToken(BOT_TOKEN, tgUserId, exp);
          return json({ avatar_url: `/api/avatar/${tgUserId}?proxy=1&exp=${exp}&sig=${sig}` });
        }
      } catch {
        return json({ avatar_url: null });
      }
    }

    // ── GET /api/daily-tasks/:pairCode/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/daily-tasks\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];

      // ── Авторизация: смотреть задачи может только участник пары,
      // и только свои собственные (userId должен совпадать с авторизованным) ──
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);
      if (!(await isPairMember(supabase, pairCode, authedId))) {
        return json({ error: 'Not a member' }, 403);
      }

      const { data: pairTz } = await supabase
        .from('pairs').select('timezone').eq('code', pairCode).maybeSingle();
      const today = getTodayDate(pairTz?.timezone || 'UTC');

      const { data: tasks } = await supabase
        .from('daily_tasks').select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', userId)
        .eq('task_date', today);

      return json({ tasks: tasks || [] });
    }

    // ── GET /api/streak-calendar/:pairCode ──
// Возвращает дни месяца с активностью обоих партнёров
if (request.method === 'GET' && path.match(/^\/api\/streak-calendar\/[^/]+$/)) {
  const pairCode = path.split('/')[3];
  const monthParam = url.searchParams.get('month'); // YYYY-MM, опционально

  const authedId = getAuthedUserId(request, env);
  if (!authedId) return json({ error: 'Unauthorized' }, 401);
  if (!(await isPairMember(supabase, pairCode, authedId))) {
    return json({ error: 'Not a member' }, 403);
  }

  const { data: pair } = await supabase
    .from('pairs').select('timezone, created_at').eq('code', pairCode).maybeSingle();
  if (!pair) return json({ error: 'Pair not found' }, 404);

  const tz = pair.timezone || 'UTC';
  const month = monthParam || getTodayDate(tz).slice(0, 7); // YYYY-MM
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const { data: members } = await supabase
    .from('pair_users').select('user_id').eq('pair_code', pairCode);
  if (!members || members.length === 0) return json({ days: [] });

  const memberIds = members.map(m => m.user_id);

  const { data: opens } = await supabase
    .from('daily_tasks')
    .select('user_id, task_date')
    .eq('pair_code', pairCode)
    .eq('task_key', 'daily_open')
    .gte('task_date', startDate)
    .lte('task_date', endDate)
    .in('user_id', memberIds);

  // Группируем по дате: сколько уникальных юзеров зашли
  const byDate = {};
  for (const row of (opens || [])) {
    if (!byDate[row.task_date]) byDate[row.task_date] = new Set();
    byDate[row.task_date].add(row.user_id);
  }

  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const count = byDate[date]?.size || 0;
    let status = 'empty';
    if (count >= 2) status = 'both';
    else if (count === 1) status = 'one';
    days.push({ date, status, count });
  }

  const bothCount = days.filter(d => d.status === 'both').length;
  return json({ month, days, bothCount, totalDays: lastDay });
}

// ── GET /api/diary/:pairCode ──
// Возвращает все записи дневника пары, сгруппированные по датам
if (request.method === 'GET' && path.match(/^\/api\/diary\/[^/]+$/)) {
  const pairCode = path.split('/')[3];
  const authedId = getAuthedUserId(request, env);
  if (!authedId) return json({ error: 'Unauthorized' }, 401);
  if (!(await isPairMember(supabase, pairCode, authedId))) {
    return json({ error: 'Not a member' }, 403);
  }
  const { data: entries } = await supabase
    .from('pair_diary')
    .select('id, user_id, emoji, text, entry_date, created_at')
    .eq('pair_code', pairCode)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  return json({ entries: entries || [] });
}

// ── POST /api/diary ──
// Добавляет запись (или обновляет, если за сегодня уже была) + уведомляет партнёра
if (request.method === 'POST' && path === '/api/diary') {
  const body = await request.json();
  const userId = extractUserId(request, env, body.userId);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const pairCode = body.pairCode;
  const emoji = (body.emoji || '').toString().slice(0, 8);
  const text = (body.text || '').toString().trim().slice(0, 100);
  if (!pairCode || !emoji || !text) {
    return json({ error: 'pairCode, emoji and text required' }, 400);
  }

  const { data: membership, error: memErr } = await supabase
    .from('pair_users').select('user_id, display_name')
    .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
  if (memErr) return json({ error: 'Membership query failed: ' + memErr.message }, 500);
  if (!membership) return json({ error: 'Not a member' }, 403);

  const { data: pairTz } = await supabase
    .from('pairs').select('timezone, pet_name').eq('code', pairCode).maybeSingle();
  const today = getTodayDate(pairTz?.timezone || 'UTC');

  // Проверяем, была ли уже запись сегодня (чтобы не спамить уведомлением при правке)
  const { data: existingToday } = await supabase
    .from('pair_diary').select('id')
    .eq('pair_code', pairCode).eq('user_id', userId).eq('entry_date', today)
    .maybeSingle();
  const isFirstEntryToday = !existingToday;

  // upsert: одна запись в день на пользователя
  const { error: upErr } = await supabase
    .from('pair_diary')
    .upsert(
      { pair_code: pairCode, user_id: userId, emoji, text, entry_date: today },
      { onConflict: 'pair_code,user_id,entry_date' }
    );
  if (upErr) return json({ error: upErr.message }, 500);

  // Уведомляем партнёра только если это новая запись (а не редактирование существующей)
  if (isFirstEntryToday) {
    try {
      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', pairCode);
      const partner = (members || []).find(m => String(m.user_id) !== String(userId));
      if (partner) {
        const { data: ps } = await supabase
          .from('user_settings').select('lang')
          .eq('telegram_user_id', partner.user_id).maybeSingle();
        const partnerLang = ps?.lang || 'ru';
        const authorName = membership.display_name || (partnerLang === 'ru' ? 'Партнёр' : 'Partner');
        const petName = pairTz?.pet_name || 'Chumi';
        const safeAuthor = escapeMd(authorName);
        const safePet = escapeMd(petName);
        const safeText = escapeMd(text);

        const notifyText = partnerLang === 'ru'
          ? `📔 *${safeAuthor}* оставил(а) запись в дневнике ${safePet}!\n\n${emoji} _${safeText}_`
          : `📔 *${safeAuthor}* added a diary entry for ${safePet}!\n\n${emoji} _${safeText}_`;
        const btnText = partnerLang === 'ru' ? '📖 Посмотреть' : '📖 View';

        await sendTelegramMessage(env, partner.user_id, notifyText, {
          reply_markup: {
            inline_keyboard: [[{ text: btnText, web_app: { url: 'https://chumi.space' } }]],
          },
        });
      }
    } catch (e) {
      // Не падаем, если Telegram-сообщение не отправилось
      console.error('Diary notify error:', e);
    }
  }

  return json({ success: true, entry_date: today });
}

// ── DELETE /api/diary/:id ──
// Удаляет свою запись
if (request.method === 'POST' && path === '/api/diary-delete') {
  const body = await request.json();
  const userId = extractUserId(request, env, body.userId);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const entryId = body.entryId;
  if (!entryId) return json({ error: 'entryId required' }, 400);

  // Проверяем, что запись принадлежит вызывающему
  const { data: entry } = await supabase
    .from('pair_diary').select('user_id')
    .eq('id', entryId).maybeSingle();
  if (!entry) return json({ error: 'Entry not found' }, 404);
  if (String(entry.user_id) !== String(userId)) return json({ error: 'Not yours' }, 403);

  await supabase.from('pair_diary').delete().eq('id', entryId);
  return json({ success: true });
}

    // ── GET /api/user-slots/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/user-slots\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);

      const maxPairs = await getMaxPairs(supabase, userId);
      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      return json({
        maxPairs,
        currentPairs: existing?.length || 0,
        extraSlots: maxPairs - MAX_PAIRS_BASE,
      });
    }

    // ── POST /api/create ──
    if (request.method === 'POST' && path === '/api/create') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const displayName = body.displayName || null;
      const username = body.username || null;
      const userTz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : 'UTC';
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400);
      }

      const code = await generateUniqueCode(supabase, 20);

      await supabase.from('pairs').insert({
        code,
        pet_type: 'spark',
        streak_days: 0,
        growth_points: 0,
        hatched: false,
        bg_id: 'room',
        pet_name: null,
        streak_recoveries_used: 0,
        last_recovery_month: null,
        last_streak_date: null,
        is_dead: false,
        timezone: userTz,
      });

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username,
        timezone: userTz,
      });

      // ── Засчитываем pending-реферал, если он есть ──
      const { data: pending } = await supabase
        .from('pending_referrals')
        .select('inviter_user_id')
        .eq('invited_user_id', userId)
        .maybeSingle();
      if (pending?.inviter_user_id) {
        await supabase.from('user_referrals').insert({
          inviter_user_id: pending.inviter_user_id,
          invited_user_id: userId,
          pair_code: code,
        }).then(() => {}, () => {});
        await supabase.from('pending_referrals')
          .delete()
          .eq('invited_user_id', userId);
      }

      return json({ code });
    }


    // ── POST /api/join ──
    if (request.method === 'POST' && path === '/api/join') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = (body.code || '').trim().toUpperCase();
      const displayName = body.displayName || null;
      const username = body.username || null;
      const userTz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : 'UTC';
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400);
      }

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', code).maybeSingle();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      if (members?.some(m => m.user_id === userId)) return json({ error: 'Already in pair' }, 400);
      if (members && members.length >= 2) return json({ error: 'Pair full' }, 400);

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username,
        timezone: userTz,
      });

      // ── Засчитываем pending-реферал, если он есть ──
      const { data: pending } = await supabase
        .from('pending_referrals')
        .select('inviter_user_id')
        .eq('invited_user_id', userId)
        .maybeSingle();
      if (pending?.inviter_user_id) {
        await supabase.from('user_referrals').insert({
          inviter_user_id: pending.inviter_user_id,
          invited_user_id: userId,
          pair_code: code,
        }).then(() => {}, () => {});
        await supabase.from('pending_referrals')
          .delete()
          .eq('invited_user_id', userId);
      }


      // Уведомление с именем
      for (const m of members || []) {
        if (m.user_id !== userId) {
          const { data: ps } = await supabase
            .from('user_settings').select('lang')
            .eq('telegram_user_id', m.user_id).maybeSingle();
          const partnerLang = ps?.lang || 'ru';
          const who = (displayName || '').toString().slice(0, 40)
            || (partnerLang === 'ru' ? 'Партнёр' : 'Someone');
          const safeWho = escapeMd(who);
          const msg = partnerLang === 'ru'
            ? `🎉 *${safeWho}* присоединился к паре \`${code}\`!`
            : `🎉 *${safeWho}* joined pair \`${code}\`!`;
          await sendTelegramMessage(env, m.user_id, msg);
        }
      }

      return json({ code });
    }

    // ── POST /api/complete-task ──
    if (request.method === 'POST' && path === '/api/complete-task') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.code;
      const taskKey = body.taskKey;

      const points = TASK_POINTS[taskKey];
      if (points === undefined) return json({ error: 'Invalid task' }, 400);

      const { data: pairCheck } = await supabase
        .from('pairs').select('is_dead, timezone, last_streak_date, streak_days, growth_points').eq('code', code).maybeSingle();
      if (!pairCheck) return json({ error: 'Pair not found' }, 404);

      // Если питомец мёртв больше 3 дней без воскрешения — серия и XP обнуляются
      // и питомец «начинается с нуля». Это срабатывает при первой попытке что-то сделать.
      if (pairCheck.is_dead && pairCheck.last_streak_date) {
        const tzCheck = pairCheck.timezone || 'UTC';
        const todayCheck = getTodayDate(tzCheck);
        const lastDate = new Date(pairCheck.last_streak_date + 'T00:00:00Z');
        const todayDate = new Date(todayCheck + 'T00:00:00Z');
        const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays >= 3) {
          await supabase.from('pairs').update({
            is_dead: false,
            streak_days: 0,
            growth_points: 0,
            hatched: false,
            active_skin: null,
            last_streak_date: todayCheck,
            last_pair_streak_date: todayCheck,
          }).eq('code', code);
          await supabase.from('one_time_tasks').delete().eq('pair_code', code);
          await supabase.from('daily_tasks').delete().eq('pair_code', code);
          await supabase.from('feedings').delete().eq('pair_code', code);
          return json({ error: 'Pet was reset due to long inactivity', reset: true }, 400);
        }
      }

      if (pairCheck.is_dead) return json({ error: 'Pet is dead' }, 400);

      const today = getTodayDate(pairCheck.timezone || 'UTC');

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return json({ error: 'Not a member of this pair' }, 403);

      // Daily tasks — полагаемся на UNIQUE-индекс daily_tasks_unique.
      // Если insert упал с конфликтом, задача уже выполнена сегодня → не начисляем.
      const { error: dtErr } = await supabase.from('daily_tasks').insert({
        pair_code: code,
        user_id: userId,
        task_key: taskKey,
        task_date: today,
        completed: true,
        completed_at: new Date().toISOString(),
      });
      if (dtErr) {
        return json({ error: 'Already completed' }, 400);
      }

      const { data: members } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code);

      const partnerIds = (members || [])
        .map(m => String(m.user_id))
        .filter(id => id !== String(userId));

      // ── Обновляем last_streak_date ВСЕГДА, когда кто-то открыл приложение ──
      // Это «отметка жизни» — питомец не умирает, пока хоть кто-то заходит.
      // streak_days растёт, только когда оба зашли в один день (см. ниже).
      if (taskKey === 'daily_open') {
        const { data: pairForLife } = await supabase
          .from('pairs')
          .select('last_streak_date')
          .eq('code', code).single();
        if (pairForLife && pairForLife.last_streak_date !== today) {
          await supabase.from('pairs')
            .update({ last_streak_date: today })
            .eq('code', code);
        }
      }

      let pointsAdded = 0;

      if (partnerIds.length > 0) {
        // Считаем, сколько РАЗНЫХ участников пары выполнили эту задачу сегодня.
        // Это устойчиво к гонке: к моменту подсчёта обе записи уже вставлены,
        // поэтому хотя бы один из двух параллельных запросов увидит всех.
        const memberIds = (members || []).map(m => String(m.user_id));
        const { data: doneRows } = await supabase
          .from('daily_tasks').select('user_id')
          .eq('pair_code', code)
          .eq('task_key', taskKey)
          .eq('task_date', today)
          .in('user_id', memberIds);

        const doneUsers = new Set((doneRows || []).map(r => String(r.user_id)));
        const allMembersDone = memberIds.length >= 2 && memberIds.every(id => doneUsers.has(id));

        if (allMembersDone) {
          const { data: pair } = await supabase
            .from('pairs')
            .select('growth_points, streak_days, last_streak_date, last_pair_streak_date, hatched')
            .eq('code', code).single();

          if (pair) {
            if (taskKey === 'daily_open') {
              // ── Совместный daily_open засчитывается РОВНО один раз в день ──
              // XP и streak привязаны к одной отметке last_pair_streak_date.
              // Это убирает гонку: при одновременном заходе обоих партнёров
              // только один запрос пройдёт условие eq(last_pair_streak_date, prev).
              const alreadyCountedToday = pair.last_pair_streak_date === today;
              if (!alreadyCountedToday) {
                const prev = pair.last_pair_streak_date;
                let newStreak;
                if (!prev) {
                  newStreak = 1;
                } else {
                  const lastDate = new Date(prev + 'T00:00:00Z');
                  const todayDate = new Date(today + 'T00:00:00Z');
                  const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
                  if (diffDays === 1) newStreak = (pair.streak_days || 0) + 1;
                  else if (diffDays > 1) newStreak = 1;
                  else newStreak = pair.streak_days || 0;
                }

                const newPoints = (pair.growth_points || 0) + points;
                const updates = {
                  growth_points: newPoints,
                  streak_days: newStreak,
                  last_pair_streak_date: today,
                  last_streak_date: today,
                };
                if (!pair.hatched && newPoints >= LEVELS[0].maxPoints) {
                  updates.hatched = true;
                }

                // Оптимистическая блокировка: апдейт применится, только если
                // last_pair_streak_date всё ещё равен prev (т.е. сегодня ещё не
                // засчитан). Второй из гонящихся запросов получит 0 строк и НЕ
                // начислит очки повторно.
                let q = supabase.from('pairs').update(updates).eq('code', code);
                q = prev === null
                  ? q.is('last_pair_streak_date', null)
                  : q.eq('last_pair_streak_date', prev);
                const { data: changedRows } = await q.select('code');

                if (changedRows && changedRows.length > 0) {
                  pointsAdded = points;
                }
                // если changedRows пуст — день уже засчитал параллельный запрос,
                // pointsAdded остаётся 0, ничего не начисляем
              }
            } else {
              // ── Прочие парные задачи (не daily_open) ──
              // У них нет дневной отметки, поэтому полагаемся на UNIQUE-индекс
              // daily_tasks: каждый участник может выполнить задачу один раз в день,
              // а XP за «оба выполнили» начисляем при подтверждённом allMembersDone.
              const newPoints = (pair.growth_points || 0) + points;
              await supabase.from('pairs')
                .update({ growth_points: newPoints })
                .eq('code', code);
              pointsAdded = points;
            }
          }
        }
      }

      return json({ success: true, points_added: pointsAdded });
    }


    // ── POST /api/rename ──
    if (request.method === 'POST' && path === '/api/rename') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.code || body.pairCode;
      const name = (body.pet_name || body.name || '').trim().slice(0, 20);
      if (!name) return json({ error: 'Name required' }, 400);

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      await supabase.from('pairs').update({ pet_name: name }).eq('code', code);
      return json({ success: true, pet_name: name });
    }

    // ── POST /api/delete ──
    if (request.method === 'POST' && path === '/api/delete') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const { data: members } = await supabase
        .from('pair_users').select('user_id, display_name').eq('pair_code', code);
      for (const m of members || []) {
        if (m.user_id !== userId) {
          const { data: ps } = await supabase
            .from('user_settings').select('lang')
            .eq('telegram_user_id', m.user_id).maybeSingle();
          const pLang = ps?.lang || 'ru';
          const msg = pLang === 'ru'
            ? `😢 Пара \`${code}\` была удалена.`
            : `😢 Pair \`${code}\` has been deleted.`;
          await sendTelegramMessage(env, m.user_id, msg);
        }
      }

      await supabase.from('one_time_tasks').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);
      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('pair_users').delete().eq('pair_code', code);
      await supabase.from('pairs').delete().eq('code', code);

      return json({ success: true });
    }

    // ── POST /api/setbg ──
    if (request.method === 'POST' && path === '/api/setbg') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // bgId может быть null (= авто/сброс) или id из списка фонов
      const bgId = body.bgId ?? null;
      await supabase.from('pairs').update({ active_bg: bgId }).eq('code', code);
      return json({ success: true });
    }

    // ── POST /api/notify ──
    if (request.method === 'POST' && path === '/api/notify') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const targetUserId = String(body.targetUserId || '');
      if (!targetUserId || targetUserId === userId) {
        return json({ error: 'Invalid target' }, 400);
      }

      const { data: callerPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      const { data: targetPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', targetUserId);

      const callerCodes = new Set((callerPairs || []).map(p => p.pair_code));
      const isPartner = (targetPairs || []).some(p => callerCodes.has(p.pair_code));
      if (!isPartner) return json({ error: 'Can only notify your partner' }, 403);

      // Rate-limit: не чаще 1 уведомления в час одному партнёру
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('notification_log')
        .select('id')
        .eq('sender_user_id', userId)
        .eq('target_user_id', targetUserId)
        .gte('sent_at', oneHourAgo)
        .limit(1);
      if (recent && recent.length > 0) {
        return json({ error: 'Too many notifications', retryAfter: 3600 }, 429);
      }

      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', targetUserId).maybeSingle();
      const tLang = ps?.lang || 'ru';
      const defaultMsg = tLang === 'ru' ? '🔔 Напоминание от Chumi' : '🔔 Reminder from Chumi';

      const sendRes = await sendTelegramMessage(env, targetUserId, defaultMsg);
      if (!sendRes.ok) {
        return json({ error: 'Delivery failed', blocked: !!sendRes.blocked }, 502);
      }
      await supabase.from('notification_log').insert({
        sender_user_id: userId,
        target_user_id: targetUserId,
        sent_at: new Date().toISOString(),
      });
      return json({ success: true });
    }

    // ── POST /api/recover-streak ──
    // При воскрешении серия и XP СОХРАНЯЮТСЯ.
    // Питомец оживает в том же состоянии, в котором был перед смертью.
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', code).maybeSingle();
      if (!pair) return json({ error: 'Pair not found' }, 404);
      if (!pair.is_dead) return json({ error: 'Pet is not dead' }, 400);

      const tz = pair.timezone || 'UTC';
      const currentMonth = getCurrentMonth(tz);
      const today = getTodayDate(tz);

      const MAX_RECOVERIES = 5;

      let used = pair.streak_recoveries_used || 0;
      if (pair.last_recovery_month !== currentMonth) used = 0;
      if (used >= MAX_RECOVERIES) return json({ error: 'Max 5 recoveries per month', remaining: 0 }, 400);

      const remainingAfter = MAX_RECOVERIES - (used + 1);

      // При воскрешении серия и XP полностью сохраняются.
      // last_streak_date = сегодня — питомец оживает «сегодня», cron его не убьёт.
      // last_pair_streak_date = ВЧЕРА — это ключевой момент: когда оба партнёра
      // сделают daily_open сегодня, в /api/complete-task разница дат будет ровно
      // 1 день → серия продолжится (+1), а не сбросится. Если же сегодня зайдёт
      // только один — день не засчитается (нужны оба), как ты и хотел.
      const yesterday = getYesterdayDate(tz);
      const { data: updated } = await supabase.from('pairs').update({
        is_dead: false,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
        last_streak_date: today,
        last_pair_streak_date: yesterday,
      }).eq('code', code).select().single();

      // Уведомляем партнёра о воскрешении
try {
  const { data: allMembers } = await supabase
    .from('pair_users').select('user_id, display_name')
    .eq('pair_code', code);
  const reviver = (allMembers || []).find(m => String(m.user_id) === String(userId));
  const partners = (allMembers || []).filter(m => String(m.user_id) !== String(userId));
  for (const p of partners) {
    const { data: ps } = await supabase
      .from('user_settings').select('lang')
      .eq('telegram_user_id', p.user_id).maybeSingle();
    const pLang = ps?.lang || 'ru';
    const reviverName = reviver?.display_name || (pLang === 'ru' ? 'Партнёр' : 'Partner');
    const petName = pair.pet_name || (pLang === 'ru' ? 'Питомец' : 'Pet');
    const safeReviver = escapeMd(reviverName);
    const safePet = escapeMd(petName);
    const tail = remainingAfter > 0
      ? (pLang === 'ru'
          ? `Осталось воскрешений в этом месяце: ${remainingAfter}/${MAX_RECOVERIES}.`
          : `Revives left this month: ${remainingAfter}/${MAX_RECOVERIES}.`)
      : (pLang === 'ru'
          ? `Воскрешения на этот месяц закончились — берегите серию, иначе прогресс сбросится!`
          : `No revives left this month — keep the streak or progress will reset!`);
    const text = pLang === 'ru'
      ? `✨ *${safeReviver}* воскресил(а) *${safePet}*! Серия (${pair.streak_days} дн.) сохранена 🐾\n${tail}`
      : `✨ *${safeReviver}* revived *${safePet}*! Streak (${pair.streak_days} days) preserved 🐾\n${tail}`;
    const btnText = pLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';
    await sendTelegramMessage(env, p.user_id, text, {
      reply_markup: {
        inline_keyboard: [[{ text: btnText, web_app: { url: 'https://chumi.space' } }]],
      },
    });
  }
} catch (e) {
  console.error('Revive notify error:', e);
}

      return json({
        success: true,
        remaining: remainingAfter,
        streak_days: updated?.streak_days ?? pair.streak_days,
        growth_points: updated?.growth_points ?? pair.growth_points,
        is_dead: false,
        last_streak_date: today,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
      });
    }

    // ── POST /api/create-invoice ──
    if (request.method === 'POST' && path === '/api/create-invoice') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const productId = body.productId;

      if (productId === 'extra_slot') {
        const payload = JSON.stringify({ userId, productId, timestamp: Date.now() });
        const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Дополнительный слот для пары',
            description: 'Получите возможность создать ещё одну пару',
            payload,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: 'Extra pair slot', amount: PRODUCT_PRICES.extra_slot }],
          }),
        });
        const data = await res.json();
        if (!data.ok) return json({ error: 'Invoice creation failed' }, 500);
        return json({ invoiceUrl: data.result });
      }

      return json({ error: 'Invalid product' }, 400);
    }

    // ── POST /api/send-invite ──
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = (body.pairCode || '').toUpperCase();
      if (!pairCode) return json({ error: 'pairCode required' }, 400);

      // Ссылку на приглашение отдаём только участнику этой пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${pairCode}`;
      return json({ inviteLink, pairCode });
    }

    // ── POST /api/create-egg ──
    if (request.method === 'POST' && path === '/api/create-egg') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      await supabase.from('pairs').update({
        pet_type: 'spark',
        hatched: false,
        streak_days: 0,
        growth_points: 0,
        is_dead: false,
        pet_name: null,
        streak_recoveries_used: 0,
        last_streak_date: null,
      }).eq('code', code);

      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);
      await supabase.from('one_time_tasks').delete().eq('pair_code', code);

      return json({ success: true });
    }

    // ── GET /api/ranking ──
    if (request.method === 'GET' && path === '/api/ranking') {
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days')
        .order('streak_days', { ascending: false })
        .order('growth_points', { ascending: false })
        .limit(100);

      const codes = (allPairs || []).map(p => p.code);
      if (codes.length === 0) return json({ ranking: [] });

      const { data: allMembers } = await supabase
        .from('pair_users')
        .select('pair_code, user_id, display_name, username')
        .in('pair_code', codes);

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
        });
      }

      const ranking = (allPairs || []).map(p => ({
        code: p.code,
        pet_name: p.pet_name,
        growth_points: p.growth_points || 0,
        streak_days: p.streak_days || 0,
        members: membersByPair.get(p.code) || [],
      }));

      return json({ ranking });
    }

    // ── GET /api/ranking-random ──
    if (request.method === 'GET' && path === '/api/ranking-random') {
      // Активные = заходили в последние 2 дня (вчера или сегодня)
      // Используем UTC как точку отсчёта, чтобы покрыть все таймзоны
      const todayUtc = new Date().toISOString().split('T')[0];
      const dUtc = new Date(todayUtc + 'T00:00:00Z');
      dUtc.setUTCDate(dUtc.getUTCDate() - 2);
      const twoDaysAgoUtc = dUtc.toISOString().split('T')[0];

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days, last_streak_date, is_dead')
        .not('pet_name', 'is', null)
        .eq('is_dead', false)
        .gte('last_streak_date', twoDaysAgoUtc);

      const named = (allPairs || []).filter(p => p.pet_name && p.pet_name.trim() !== '');
      if (named.length === 0) return json({ ranking: [] });

      const today = getTodayDate().replace(/-/g, '');
      const seed = parseInt(today, 10);
      const shuffled = shuffleWithSeed(named, seed).slice(0, 50);

      const codes = shuffled.map(p => p.code);
      const { data: allMembers } = await supabase
        .from('pair_users')
        .select('pair_code, user_id, display_name, username')
        .in('pair_code', codes);

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
        });
      }

      const ranking = shuffled.map(p => ({
        code: p.code,
        pet_name: p.pet_name,
        growth_points: p.growth_points || 0,
        streak_days: p.streak_days || 0,
        members: membersByPair.get(p.code) || [],
      }));

      return json({ ranking });
    }

    // ── POST /api/prepare-share ──
    // Если пришла imageDataUrl — заливаем в Storage и шлём как photo с кнопкой.
    // Если нет — fallback на старый text-only вариант.
    if (request.method === 'POST' && path === '/api/prepare-share') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const botLink = `https://t.me/${botUsername}`;

      // Язык отправителя
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';

      const caption = userLang === 'ru'
        ? `🐾 Chumi — заведи виртуального питомца и расти его вместе с другом!\n\nВыполняй задания каждый день, поддерживай серию и открывай новые образы.`
        : `🐾 Chumi — get a virtual pet and grow it with a friend!\n\nComplete tasks daily, keep your streak, unlock new outfits.`;
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const imageDataUrl = body.imageDataUrl || '';

      // ── Вариант с картинкой (photo) ──
      const shareImgMatch = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (shareImgMatch) {
        const shareExt = shareImgMatch[1] === 'jpeg' ? 'jpg' : 'png';
        const shareContentType = `image/${shareImgMatch[1]}`;
        const base64 = imageDataUrl.split(',')[1];
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const fileName = `promo_${userId}_${Date.now()}.${shareExt}`;

        const uploadRes = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              'Content-Type': shareContentType,
              'x-upsert': 'true',
            },
            body: binary,
          }
        );
        if (uploadRes.ok) {
          const photoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;

          const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: parseInt(userId),
              result: {
                type: 'photo',
                id: 'share_promo_' + Date.now(),
                photo_url: photoUrl,
                thumbnail_url: photoUrl,
                caption,
                reply_markup: { inline_keyboard: [[{ text: btnText, url: botLink }]] },
              },
              allow_user_chats: true,
              allow_bot_chats: false,
              allow_group_chats: true,
              allow_channel_chats: true,
            }),
          });
          const tgData = await tgRes.json();
          if (tgData.ok && tgData.result?.id) {
            return json({ prepared_message_id: tgData.result.id });
          }
          // если Telegram не принял photo — падаем в text-fallback ниже
        }
      }

      // ── Fallback: текстовый article (как было) ──
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'share_app_' + Date.now(),
            title: userLang === 'ru' ? 'Chumi — Вырасти питомца! 🐾' : 'Chumi — Grow a pet! 🐾',
            input_message_content: { message_text: caption },
            description: userLang === 'ru' ? 'Заведи питомца и расти вместе с другом 🐾' : 'Get a pet and grow with a friend 🐾',
            reply_markup: { inline_keyboard: [[{ text: btnText, url: botLink }]] },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id });
      return json({ error: 'Failed to prepare message', details: data }, 500);
    }

        // ── POST /api/prepare-invite ──
    // Готовит inline-сообщение для приглашения в конкретную пару (с кодом)
    if (request.method === 'POST' && path === '/api/prepare-invite') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = (body.pairCode || '').toUpperCase();
      if (!pairCode) return json({ error: 'pairCode required' }, 400);

      // Проверяем, что вызывающий — участник этой пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // Получаем язык пользователя
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${pairCode}`;

      const messageText = userLang === 'ru'
        ? `🐾 *Присоединяйся к моей паре в Chumi!*\n\nКод пары: \`${pairCode}\`\n\nРастим питомца вместе — выполняй задания, поддерживай серию и открывай новые наряды 🐣`
        : `🐾 *Join my pair in Chumi!*\n\nPair code: \`${pairCode}\`\n\nLet's grow a pet together — complete tasks, keep the streak, unlock outfits 🐣`;

      const btnText = userLang === 'ru' ? '🐾 Присоединиться' : '🐾 Join pair';

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'invite_' + pairCode + '_' + Date.now(),
            title: userLang === 'ru'
              ? `Приглашение в Chumi: ${pairCode}`
              : `Chumi invite: ${pairCode}`,
            input_message_content: {
              message_text: messageText,
              parse_mode: 'Markdown',
            },
            description: userLang === 'ru'
              ? 'Растите питомца вместе 🐾'
              : 'Grow a pet together 🐾',
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: inviteLink }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id });
      return json({ error: 'Failed to prepare message', details: data }, 500);
    }

        // ── POST /api/upload-postcard ──
    // Загружает PNG-открытку в Supabase Storage (bucket: postcards) и возвращает публичный URL
    if (request.method === 'POST' && path === '/api/upload-postcard') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const imageDataUrl = body.imageDataUrl || '';
      const m = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (!m) {
        return json({ error: 'Invalid image' }, 400);
      }
      const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
      const contentType = `image/${m[1]}`;
      const base64 = imageDataUrl.split(',')[1];
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const fileName = `postcard_${userId}_${Date.now()}.${ext}`;

      const uploadRes = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: binary,
        }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return json({ error: 'Upload failed: ' + err.slice(0, 200) }, 500);
      }
      const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;
      return json({ url: publicUrl });
    }

    // ── POST /api/prepare-postcard ──
    // Заливает открытку в Storage и готовит inline-сообщение с фото для tg.shareMessage
    if (request.method === 'POST' && path === '/api/prepare-postcard') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const imageDataUrl = body.imageDataUrl || '';
      const text = (body.text || '').toString().slice(0, 800);
      const m = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (!m) {
        return json({ error: 'Invalid image' }, 400);
      }
      const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
      const contentType = `image/${m[1]}`;
      const base64 = imageDataUrl.split(',')[1];
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const fileName = `postcard_${userId}_${Date.now()}.${ext}`;

      const uploadRes = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: binary,
        }
      );
      if (!uploadRes.ok) return json({ error: 'Upload failed' }, 500);
      const photoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'photo',
            id: 'pc_' + Date.now(),
            photo_url: photoUrl,
            thumbnail_url: photoUrl,
            caption: text,
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: `https://t.me/${botUsername}` }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const tgData = await tgRes.json();
      if (!tgData.ok) return json({ error: tgData.description || 'TG error' }, 500);
      return json({ prepared_message_id: tgData.result.id });
    }

// ── POST /api/prepare-sticker ──
// Готовит prepared inline-сообщение со стикером из набора @ChumiPetBot.
// При вызове tg.shareMessage пользователь выбирает чат, и туда отправляется
// настоящий стикер (type: 'sticker').
if (request.method === 'POST' && path === '/api/prepare-sticker') {
  const body = await request.json();
  const userId = extractUserId(request, env, body.userId);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const stickerFileId = (body.sticker_file_id || '').toString();
  if (!stickerFileId) return json({ error: 'sticker_file_id required' }, 400);

  // Защита: принимаем только стикеры из нашего пакета @ChumiPetBot
  if (!stickerFileId.startsWith('CAACAgIAAxUAAWoD')) {
    return json({ error: 'Invalid sticker' }, 400);
  }

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: parseInt(userId),
      result: {
        type: 'sticker',
        id: 'sticker_' + Date.now(),
        sticker_file_id: stickerFileId,
      },
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: true,
    }),
  });
  const data = await res.json();
  if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id });
  return json({ error: 'Failed to prepare sticker', details: data }, 500);
}

        // ── POST /api/prepare-task-message ──
    // Готовит inline-сообщение для заданий send_msg / send_sticker / send_media.
    // У получателя в чате появится текстовое сообщение с inline-кнопкой
    // «🐾 Открыть Chumi», которая открывает Mini App.
    if (request.method === 'POST' && path === '/api/prepare-task-message') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = (body.pairCode || '').toUpperCase();
      const taskKey = body.taskKey || 'send_msg';
      const text = (body.text || '').toString().slice(0, 800);
      if (!pairCode) return json({ error: 'pairCode required' }, 400);
      if (!text) return json({ error: 'text required' }, 400);
      if (!['send_msg', 'send_sticker', 'send_media'].includes(taskKey)) {
        return json({ error: 'invalid taskKey' }, 400);
      }

      // Проверяем участие в паре
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // Получаем язык отправителя для подписи кнопки
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const titleByTask = {
        send_msg:     userLang === 'ru' ? 'Сообщение Chumi 🐾'   : 'Chumi message 🐾',
        send_sticker: userLang === 'ru' ? 'Стикер от Chumi 🎨'   : 'Sticker from Chumi 🎨',
        send_media:   userLang === 'ru' ? 'Фото-привет Chumi 📸' : 'Photo from Chumi 📸',
      };

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'task_' + taskKey + '_' + pairCode + '_' + Date.now(),
            title: titleByTask[taskKey],
            input_message_content: {
              message_text: text,
              parse_mode: 'Markdown',
            },
            description: text.slice(0, 80),
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: `https://t.me/${env.BOT_USERNAME || 'ChumiPetBot'}` }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id });
      return json({ error: 'Failed to prepare message', details: data }, 500);
    }

    // ── GET /api/user-lang/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/user-lang\/[^/]+$/)) {
      const _userId = path.split('/')[3];

      // Язык — некритичные данные, нужные на самом старте (ещё до полной
      // инициализации). Если initData недоступен, не валим старт ошибкой —
      // отдаём дефолтный язык. При наличии авторизации читаем язык того,
      // кто запрашивает (а не произвольного userId из пути), чтобы не было
      // утечки чужих настроек.
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ lang: 'ru' });

      const { data } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', authedId).maybeSingle();
      return json({ lang: data?.lang || 'ru' });
    }

    // ── POST /api/set-lang ──
    if (request.method === 'POST' && path === '/api/set-lang') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const lang = body.lang === 'en' ? 'en' : 'ru';
      await supabase.from('user_settings').upsert(
        { telegram_user_id: userId, lang, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_user_id' }
      );
      return json({ success: true, lang });
    }

    // ── POST /api/send-reminders (cron) ──
    if (request.method === 'POST' && path === '/api/send-reminders') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days, timezone')
        .eq('is_dead', false)
        .gte('streak_days', 1);

      const pairs = allPairs || [];
      if (pairs.length === 0) return json({ success: true, sent: 0 });

      const pairCodes = pairs.map(p => p.code);

      // ── Батч 1: все участники всех пар ──
      const { data: allMembers } = await supabase
        .from('pair_users').select('pair_code, user_id')
        .in('pair_code', pairCodes);

      // "Сегодня" у каждой пары своё (таймзона). Считаем один раз на пару.
      const todayByPair = new Map();
      for (const p of pairs) todayByPair.set(p.code, getTodayDate(p.timezone || 'UTC'));

      // ── Батч 2: все сегодняшние daily_open по всем парам ──
      // Диапазон дат: собираем набор уникальных "сегодня" и тянем по нему.
      const todaySet = [...new Set([...todayByPair.values()])];
      const { data: opens } = await supabase
        .from('daily_tasks').select('pair_code, user_id, task_date')
        .eq('task_key', 'daily_open')
        .in('pair_code', pairCodes)
        .in('task_date', todaySet);

      // Множество "кто уже открыл сегодня" ключом pair_code|user_id
      const openedSet = new Set();
      for (const o of (opens || [])) {
        if (o.task_date === todayByPair.get(o.pair_code)) {
          openedSet.add(`${o.pair_code}|${o.user_id}`);
        }
      }

      // Кандидаты на напоминание (кто НЕ открыл сегодня)
      const candidates = [];
      for (const m of (allMembers || [])) {
        if (!openedSet.has(`${m.pair_code}|${m.user_id}`)) {
          candidates.push(m);
        }
      }
      if (candidates.length === 0) return json({ success: true, sent: 0 });

      const candidateIds = [...new Set(candidates.map(c => String(c.user_id)))];

      // ── Батч 3: кому уже слали напоминание сегодня (по UTC-дню) ──
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { data: sentToday } = await supabase
        .from('notification_log').select('target_user_id')
        .eq('sender_user_id', 'system_reminder')
        .gte('sent_at', todayStart.toISOString())
        .in('target_user_id', candidateIds);
      const alreadySentSet = new Set((sentToday || []).map(r => String(r.target_user_id)));

      // ── Батч 4: языки всех кандидатов ──
      const { data: settings } = await supabase
        .from('user_settings').select('telegram_user_id, lang')
        .in('telegram_user_id', candidateIds);
      const langByUser = new Map();
      for (const s of (settings || [])) langByUser.set(String(s.telegram_user_id), s.lang || 'ru');

      // Быстрый доступ к паре по коду
      const pairByCode = new Map(pairs.map(p => [p.code, p]));

      // Один пользователь может быть в нескольких парах; напоминание слём
      // не чаще одного раза в день на пользователя (rate-limit ниже).
      const notifiedThisRun = new Set();
      let sent = 0;

      for (const c of candidates) {
        const uid = String(c.user_id);
        if (alreadySentSet.has(uid) || notifiedThisRun.has(uid)) continue;

        const pair = pairByCode.get(c.pair_code);
        if (!pair) continue;

        const safePet = escapeMd(pair.pet_name || 'Chumi');
        const mLang = langByUser.get(uid) || 'ru';
        const reminderText = mLang === 'ru'
          ? `🔔 *${safePet}* ждёт тебя! Серия: ${pair.streak_days} дн. 🔥\nНе забудь зайти сегодня!`
          : `🔔 *${safePet}* is waiting! Streak: ${pair.streak_days} days 🔥\nDon't forget to come today!`;
        const btnText = mLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

        const res = await sendTelegramMessage(env, uid, reminderText, {
          reply_markup: {
            inline_keyboard: [[{ text: btnText, web_app: { url: 'https://chumi.space' } }]],
          },
        });

        // Пишем в лог только при успешной доставке
        if (res.ok) {
          await supabase.from('notification_log').insert({
            sender_user_id: 'system_reminder',
            target_user_id: uid,
            sent_at: new Date().toISOString(),
          });
          notifiedThisRun.add(uid);
          sent++;
        }
      }

      return json({ success: true, sent });
    }

    // ── POST /api/update-streaks (cron) ──
    if (request.method === 'POST' && path === '/api/update-streaks') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      // ── Батч: тянем живые и мёртвые пары одним запросом каждую ──
      const { data: alivePairsRaw } = await supabase
        .from('pairs')
        .select('code, last_streak_date, streak_days, is_dead, pet_name, timezone')
        .eq('is_dead', false);
      const { data: deadPairsRaw } = await supabase
        .from('pairs')
        .select('code, last_streak_date, streak_days, pet_name, timezone')
        .eq('is_dead', true);

      const alivePairs = alivePairsRaw || [];
      const deadPairs = deadPairsRaw || [];

      // Все коды, по которым понадобятся участники (живые + мёртвые)
      const allCodes = [
        ...alivePairs.map(p => p.code),
        ...deadPairs.map(p => p.code),
      ];

      // ── Батч: все участники всех этих пар ──
      const membersByCode = new Map();
      if (allCodes.length > 0) {
        const { data: allMembers } = await supabase
          .from('pair_users').select('pair_code, user_id')
          .in('pair_code', allCodes);
        for (const m of (allMembers || [])) {
          if (!membersByCode.has(m.pair_code)) membersByCode.set(m.pair_code, []);
          membersByCode.get(m.pair_code).push(m.user_id);
        }
      }

      // Собираем список пар, которых надо УБИТЬ, и пар, которые надо СБРОСИТЬ.
      // Уведомления шлём в конце, языки подтянем одним батчем.
      const toKill = [];   // { pair }
      const toReset = [];  // { pair }

      // ── 1) Определяем, кого убить ──
      for (const pair of alivePairs) {
        const tz = pair.timezone || 'UTC';
        // Питомец живёт/умирает только в полной паре (2 участника).
        const memberIds = membersByCode.get(pair.code) || [];
        if (memberIds.length < 2) continue;

        const yesterday = getYesterdayDate(tz);
        // Умирает, только если пропущен ПОЛНЫЙ день (last_streak_date < вчера).
        if (pair.last_streak_date && pair.last_streak_date < yesterday) {
          toKill.push(pair);
        }
      }

      // ── 2) Определяем, кого сбросить (мёртв 3+ дня) ──
      for (const pair of deadPairs) {
        if (!pair.last_streak_date) continue;
        const tz = pair.timezone || 'UTC';
        const today = getTodayDate(tz);
        const lastDate = new Date(pair.last_streak_date + 'T00:00:00Z');
        const todayDate = new Date(today + 'T00:00:00Z');
        const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        if (diffDays >= 3) toReset.push(pair);
      }

      // ── Батч: языки всех затронутых пользователей ──
      const affectedUserIds = new Set();
      for (const pair of [...toKill, ...toReset]) {
        for (const uid of (membersByCode.get(pair.code) || [])) {
          affectedUserIds.add(String(uid));
        }
      }
      const langByUser = new Map();
      if (affectedUserIds.size > 0) {
        const { data: settings } = await supabase
          .from('user_settings').select('telegram_user_id, lang')
          .in('telegram_user_id', [...affectedUserIds]);
        for (const s of (settings || [])) {
          langByUser.set(String(s.telegram_user_id), s.lang || 'ru');
        }
      }

      // ── Выполняем убийства ──
      let killed = 0;
      for (const pair of toKill) {
        await supabase.from('pairs').update({ is_dead: true }).eq('code', pair.code);
        killed++;

        for (const uid of (membersByCode.get(pair.code) || [])) {
          const dLang = langByUser.get(String(uid)) || 'ru';
          const petName = pair.pet_name || (dLang === 'ru' ? 'Питомец' : 'Pet');
          const safePet = escapeMd(petName);
          const text = dLang === 'ru'
            ? `💀 *${safePet}* умер... Серия (${pair.streak_days} дн.) под угрозой!\nЗайди в приложение и нажми «Воскресить», чтобы продолжить серию.\nОсталось воскрешений в этом месяце: до 5.`
            : `💀 *${safePet}* has died... Streak (${pair.streak_days} days) is at risk!\nOpen the app and tap "Revive" to continue.\nUp to 5 revivals per month available.`;
          const dBtnText = dLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';
          await sendTelegramMessage(env, uid, text, {
            reply_markup: {
              inline_keyboard: [[{ text: dBtnText, web_app: { url: 'https://chumi.space' } }]],
            },
          });
        }
      }

      // ── Выполняем сбросы (мёртв 3+ дня → полный сброс к яйцу) ──
      let reset = 0;
      for (const pair of toReset) {
        const tz = pair.timezone || 'UTC';
        const today = getTodayDate(tz);
        await supabase.from('pairs').update({
          is_dead: false,
          streak_days: 0,
          growth_points: 0,
          hatched: false,
          active_skin: null,
          last_streak_date: today,
          last_pair_streak_date: today,
        }).eq('code', pair.code);
        await supabase.from('daily_tasks').delete().eq('pair_code', pair.code);
        await supabase.from('feedings').delete().eq('pair_code', pair.code);
        reset++;

        for (const uid of (membersByCode.get(pair.code) || [])) {
          const rLang = langByUser.get(String(uid)) || 'ru';
          const petName = pair.pet_name || (rLang === 'ru' ? 'Питомец' : 'Pet');
          const safePet = escapeMd(petName);
          const text = rLang === 'ru'
            ? `🥚 *${safePet}* не воскресили 3 дня — прогресс обнулён.\nНачните заново: зайдите в Chumi и вырастите нового питомца вместе!`
            : `🥚 *${safePet}* wasn't revived for 3 days — progress was reset.\nStart over: open Chumi and grow a new pet together!`;
          const rBtn = rLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';
          await sendTelegramMessage(env, uid, text, {
            reply_markup: {
              inline_keyboard: [[{ text: rBtn, web_app: { url: 'https://chumi.space' } }]],
            },
          });
        }
      }

      return json({ success: true, killed, reset });
    }

    // ── POST /api/cleanup-empty-pairs (cron) ──
    // Удаляет: 1) пустые пары (< 2 участников) старше 5 дней;
    //          2) активные пары, в которые никто не заходил 5+ дней
    if (request.method === 'POST' && path === '/api/cleanup-empty-pairs') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const { data: allPairsRaw } = await supabase
        .from('pairs').select('code, created_at, last_streak_date, timezone');
      const allPairs = allPairsRaw || [];
      if (allPairs.length === 0) {
        return json({ success: true, cleaned: 0, cleanedInactive: 0 });
      }

      const allCodes = allPairs.map(p => p.code);

      // ── Батч: участники всех пар одним запросом ──
      const membersByCode = new Map();
      const { data: allMembers } = await supabase
        .from('pair_users').select('pair_code, user_id')
        .in('pair_code', allCodes);
      for (const m of (allMembers || [])) {
        if (!membersByCode.has(m.pair_code)) membersByCode.set(m.pair_code, []);
        membersByCode.get(m.pair_code).push(m.user_id);
      }

      const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();

      // Классифицируем пары: какие удалить как пустые, какие — как неактивные.
      const toDeleteEmpty = [];     // { pair }
      const toDeleteInactive = [];  // { pair, memberIds }

      for (const pair of allPairs) {
        const memberIds = membersByCode.get(pair.code) || [];
        const isOldEnough = pair.created_at && pair.created_at < fiveDaysAgo;
        const isEmpty = memberIds.length < 2;

        // 1) Пустая пара старше 5 дней
        if (isEmpty && isOldEnough) {
          toDeleteEmpty.push(pair);
          continue;
        }

        // 2) Полная пара, неактивная 5+ дней
        if (!isEmpty) {
          const tz = pair.timezone || 'UTC';
          const today = getTodayDate(tz);
          const todayD = new Date(today + 'T00:00:00Z');
          todayD.setUTCDate(todayD.getUTCDate() - 5);
          const fiveDaysAgoDate = todayD.toISOString().split('T')[0];

          const lastActivity = pair.last_streak_date
            || (pair.created_at ? pair.created_at.split('T')[0] : null);

          if (lastActivity && lastActivity < fiveDaysAgoDate) {
            toDeleteInactive.push({ pair, memberIds });
          }
        }
      }

      // ── Батч: языки участников неактивных пар (их надо уведомить) ──
      const notifyUserIds = new Set();
      for (const { memberIds } of toDeleteInactive) {
        for (const uid of memberIds) notifyUserIds.add(String(uid));
      }
      const langByUser = new Map();
      if (notifyUserIds.size > 0) {
        const { data: settings } = await supabase
          .from('user_settings').select('telegram_user_id, lang')
          .in('telegram_user_id', [...notifyUserIds]);
        for (const s of (settings || [])) {
          langByUser.set(String(s.telegram_user_id), s.lang || 'ru');
        }
      }

      // Хелпер удаления всех связанных данных пары
      const purgePair = async (code) => {
        await supabase.from('one_time_tasks').delete().eq('pair_code', code);
        await supabase.from('daily_tasks').delete().eq('pair_code', code);
        await supabase.from('feedings').delete().eq('pair_code', code);
        await supabase.from('pair_users').delete().eq('pair_code', code);
        await supabase.from('pairs').delete().eq('code', code);
      };

      // ── Удаляем пустые пары ──
      let cleaned = 0;
      for (const pair of toDeleteEmpty) {
        await purgePair(pair.code);
        cleaned++;
      }

      // ── Удаляем неактивные пары (с уведомлением участников) ──
      let cleanedInactive = 0;
      for (const { pair, memberIds } of toDeleteInactive) {
        for (const uid of memberIds) {
          const pLang = langByUser.get(String(uid)) || 'ru';
          const msg = pLang === 'ru'
            ? `⏳ Пара \`${pair.code}\` удалена из-за неактивности (5+ дней без заходов).`
            : `⏳ Pair \`${pair.code}\` was deleted due to inactivity (5+ days without logins).`;
          await sendTelegramMessage(env, uid, msg);
        }
        await purgePair(pair.code);
        cleanedInactive++;
      }

      return json({ success: true, cleaned, cleanedInactive });
    }

        // ── POST /api/cleanup-postcards (cron) ──
    // Удаляет PNG-открытки из Storage-бакета `postcards` старше N часов.
    // Порог 48 часов: картинки нужны только в момент «поделиться» / на время
    // показа в Stories (24 ч). После этого файл в бакете больше не нужен.
    if (request.method === 'POST' && path === '/api/cleanup-postcards') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const MAX_AGE_HOURS = 48;
      const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

      let deleted = 0;
      let errors = 0;

      // Пагинация: Storage list отдаёт максимум 100 за раз, идём пачками,
      // пока не закончатся старые файлы.
      for (let i = 0; i < 200; i++) { // жёсткий потолок 200 итераций = до 20000 файлов за запуск
        const { data: files, error: listErr } = await supabase
          .storage.from('postcards')
          .list('', { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });

        if (listErr) { errors++; break; }
        if (!files || files.length === 0) break;

        // Берём только реально старые файлы
        const oldNames = files
          .filter(f => f.created_at && f.created_at < cutoff)
          .map(f => f.name);

        if (oldNames.length === 0) break; // дальше идут только свежие — выходим

        const { error: rmErr } = await supabase
          .storage.from('postcards')
          .remove(oldNames);

        if (rmErr) { errors++; break; }
        deleted += oldNames.length;

        // Если в этой пачке старых было меньше 100 — значит дальше свежие, выходим
        if (oldNames.length < 100) break;
      }

      return json({ success: true, deleted, errors });
    }

        // ── POST /api/admin-daily-summary (cron) ──
    // Ежедневная сводка для админа
    if (request.method === 'POST' && path === '/api/admin-daily-summary') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const now = new Date();
      const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // ── Общие счётчики ──
      const { count: totalUsers } = await supabase
        .from('user_settings').select('telegram_user_id', { count: 'exact', head: true });
      const { count: totalPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true });
      const { count: alivePairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', false);
      const { count: deadPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', true);
      const { count: totalSkinsOwned } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true });

      // ── За последние 24 часа ──
      const { count: newPairs24h } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true })
        .gte('created_at', yesterdayIso);
      const { count: newSkins24h } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true })
        .gte('created_at', yesterdayIso);

      // ── Активные сегодня (заходили в daily_open) ──
      const todayUtc = now.toISOString().split('T')[0];
      const { data: activeToday } = await supabase
        .from('daily_tasks')
        .select('user_id')
        .eq('task_key', 'daily_open')
        .eq('task_date', todayUtc);
      const activeUsersToday = new Set((activeToday || []).map(t => t.user_id)).size;

      // ── Топ-3 пар по серии ──
      const { data: topStreaks } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days')
        .eq('is_dead', false)
        .order('streak_days', { ascending: false })
        .limit(3);

      let topStreaksText = '—';
      if (topStreaks && topStreaks.length > 0) {
        topStreaksText = topStreaks
          .map((p, i) => `${i + 1}. ${escapeMd(p.pet_name || '—')} (${p.streak_days} дн.)`)
          .join('\n');
      }

      const summary =
        `📊 *Chumi — ежедневная сводка*\n` +
        `_${now.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}_\n\n` +
        `👥 *Всего пользователей:* ${totalUsers ?? 0}\n` +
        `🟢 *Активные сегодня:* ${activeUsersToday}\n\n` +
        `🐾 *Пары:* ${totalPairs ?? 0}\n` +
        `   ❤️ Живые: ${alivePairs ?? 0}\n` +
        `   💀 Мёртвые: ${deadPairs ?? 0}\n\n` +
        `*За последние 24 часа:*\n` +
        `   🆕 Новых пар: ${newPairs24h ?? 0}\n` +
        `   🎨 Куплено скинов: ${newSkins24h ?? 0}\n\n` +
        `🎨 *Скинов в собственности:* ${totalSkinsOwned ?? 0}\n\n` +
        `🏆 *Топ-3 серии:*\n${topStreaksText}`;

      // Шлём админам
      let sent = 0;
      for (const adminId of ADMIN_IDS) {
        try {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminId,
              text: summary,
              parse_mode: 'Markdown',
            }),
          });
          sent++;
        } catch (e) {}
      }

      return json({ success: true, sent });
    }

    // ── POST /api/send-partner-message ──
    if (request.method === 'POST' && path === '/api/send-partner-message') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // ── Rate-limit: не чаще 1 сообщения партнёру в час ──
      // Находим партнёра заранее, чтобы залогировать отправку именно ему.
      const { data: rlMembers } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);
      const rlPartner = (rlMembers || []).find(m => String(m.user_id) !== String(userId));
      if (rlPartner) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from('notification_log')
          .select('id')
          .eq('sender_user_id', userId)
          .eq('target_user_id', String(rlPartner.user_id))
          .gte('sent_at', oneHourAgo)
          .limit(1);
        if (recent && recent.length > 0) {
          return json({ error: 'Too many messages', retryAfter: 3600 }, 429);
        }
      }

      const { data: pairRow } = await supabase
        .from('pairs').select('pet_name, streak_days').eq('code', code).maybeSingle();
      const petName = pairRow?.pet_name || 'Chumi';
      const safePet = escapeMd(petName);
      const streak = pairRow?.streak_days || 0;

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      const WEBAPP_URL = 'https://chumi.space';
      const RU = [
        `🐾 Привет! Не забывай про ${safePet} — серия ${streak} дн.!`,
        `💌 Сообщение от партнёра по Chumi! Питомец растёт уже ${streak} дн. 🐾`,
        `👋 ${safePet} ждёт тебя! Серия: ${streak} дн. 🐾`,
      ];
      const EN = [
        `🐾 Hey! Don't forget about ${safePet} — streak ${streak} days!`,
        `💌 Message from your Chumi partner! Pet is growing for ${streak} days 🐾`,
        `👋 ${safePet} is waiting! Streak: ${streak} days 🐾`,
      ];

      let deliveredCount = 0;
      for (const m of (members || [])) {
        if (m.user_id === userId) continue;
        const { data: ps } = await supabase
          .from('user_settings').select('lang')
          .eq('telegram_user_id', m.user_id).maybeSingle();
        const targetLang = ps?.lang || 'ru';
        const pool = targetLang === 'ru' ? RU : EN;
        const text = pool[Math.floor(Math.random() * pool.length)];

        const btnText = '🐾 Chumi';
        let delivered = false;
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: m.user_id,
              text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: WEBAPP_URL } }]] },
            }),
          });
          delivered = tgRes.ok;
        } catch (e) {
          delivered = false;
        }

        if (delivered) {
          deliveredCount++;
          // Записываем факт отправки — для rate-limit (1 раз в час)
          await supabase.from('notification_log').insert({
            sender_user_id: String(userId),
            target_user_id: String(m.user_id),
            sent_at: new Date().toISOString(),
          });
        }
      }

      // Если ни одному партнёру не доставлено (например, бот заблокирован) —
      // возвращаем ошибку, чтобы фронт НЕ засчитывал задание.
      if (deliveredCount === 0) {
        return json({ error: 'Delivery failed' }, 502);
      }
      return json({ success: true });
    }

    // ── GET /api/skins/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/skins\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);

      const { data: owned } = await supabase
        .from('user_skins').select('skin_id').eq('user_id', userId);
      const { data: referrals } = await supabase
        .from('user_referrals').select('invited_user_id').eq('inviter_user_id', userId);
      const premium = await isPremium(supabase, userId);
      return json({
        owned: (owned || []).map(s => s.skin_id),
        referral_count: referrals?.length || 0,
        premium,
      });
    }

    // ── POST /api/buy-skin ──
    if (request.method === 'POST' && path === '/api/buy-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const skinId = body.skinId;
      if (!skinId) return json({ error: 'skinId required' }, 400);

      const price = SKIN_PRICES[skinId];
      if (price === undefined) return json({ error: 'Invalid skin' }, 400);

      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', userId).eq('skin_id', skinId).maybeSingle();
      if (alreadyOwned) return json({ error: 'Already owned' }, 400);

      const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
        title: `Наряд: ${skinId}`,
        description: `Разблокируй наряд ${skinId} для своего аксолотля!`,
        payload: JSON.stringify({ type: 'skin', skinId, userId, timestamp: Date.now() }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ amount: price, label: `Skin ${skinId}` }],
      });

      if (!invoiceUrl) return json({ error: 'Invoice creation failed' }, 500);
      return json({ invoiceUrl });
    }

        // ── POST /api/buy-skin-gift ──
    // Купить скин и подарить партнёру по паре
    if (request.method === 'POST' && path === '/api/buy-skin-gift') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const skinId = body.skinId;
      const pairCode = body.pairCode;
      if (!skinId) return json({ error: 'skinId required' }, 400);
      if (!pairCode) return json({ error: 'pairCode required' }, 400);

      const price = SKIN_PRICES[skinId];
      if (price === undefined) return json({ error: 'Invalid skin' }, 400);

      // Проверяем, что отправитель — участник пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // Находим партнёра
      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', pairCode);
      const partner = (members || []).find(m => String(m.user_id) !== String(userId));
      if (!partner) return json({ error: 'No partner in pair' }, 400);

      // Проверяем, что у партнёра ещё нет такого скина
      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', partner.user_id).eq('skin_id', skinId).maybeSingle();
      if (alreadyOwned) return json({ error: 'Partner already owns this skin' }, 400);

      // Если у партнёра активный Premium — все скины ему и так доступны
      const recipientPremium = await isPremium(supabase, partner.user_id);
      if (recipientPremium) return json({ error: 'Partner already owns this skin' }, 400);

      // Создаём инвойс с типом "gift" и id получателя
      // ВАЖНО: payload в Telegram имеет лимит 128 байт, поэтому используем короткие ключи
      const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
        title: `Подарок: ${skinId}`,
        description: `Подарок другу — наряд ${skinId}!`,
        payload: JSON.stringify({
          t: 'skin_gift',
          s: skinId,
          u: userId,
          r: partner.user_id,
        }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ amount: price, label: `Skin gift: ${skinId}` }],
      });


      if (!invoiceUrl) return json({ error: 'Invoice creation failed' }, 500);
      return json({ invoiceUrl });
    }

    // ── POST /api/claim-bee-skin ──
    if (request.method === 'POST' && path === '/api/claim-bee-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const { data: referrals } = await supabase
        .from('user_referrals').select('invited_user_id').eq('inviter_user_id', userId);
      const count = referrals?.length || 0;
      if (count < 2) return json({ error: 'Need at least 2 referrals' }, 400);

      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', userId).eq('skin_id', 'bee').maybeSingle();
      if (alreadyOwned) return json({ error: 'Already claimed' }, 400);

      const { error: beeErr } = await supabase
        .from('user_skins').insert({ user_id: userId, skin_id: 'bee' });
      if (beeErr) return json({ error: 'Already claimed' }, 400);
      return json({ success: true });
    }

    // ── POST /api/set-skin ──
    if (request.method === 'POST' && path === '/api/set-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = body.pairCode;
      const skinId = body.skinId;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      if (skinId) {
        const levelMatch = skinId.match(/^level_(\d+)$/);
        if (levelMatch) {
          // Уровневый скин — проверяем достигнут ли уровень
          const requiredLevel = parseInt(levelMatch[1]);
          const { data: pairData } = await supabase
            .from('pairs').select('growth_points').eq('code', pairCode).single();
          if (!pairData) return json({ error: 'Pair not found' }, 404);
          const currentLevel = getLevel(pairData.growth_points || 0).level;
          if (currentLevel < requiredLevel) return json({ error: 'Level not reached' }, 403);
        } else {
          // Обычный скин — проверяем владение или премиум
          const premium = await isPremium(supabase, userId);
          if (!premium) {
            const { data: owned } = await supabase
              .from('user_skins').select('id')
              .eq('user_id', userId).eq('skin_id', skinId).maybeSingle();
            if (!owned) return json({ error: 'Skin not owned' }, 403);
          }
        }
      }

      await supabase.from('pairs').update({ active_skin: skinId }).eq('code', pairCode);
      return json({ success: true });
    }

    // ── GET /api/premium/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/premium\/[^/]+$/)) {
      const userId = path.split('/')[3];
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);
      const premium = ADMIN_IDS.includes(String(userId));
      return json({ premium, expires_at: premium ? '2099-12-31T23:59:59Z' : null });
    }

    // ── GET /api/recoveries-left/:pairCode ──
    if (request.method === 'GET' && path.match(/^\/api\/recoveries-left\/[^/]+$/)) {
      const pairCode = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (!(await isPairMember(supabase, pairCode, authedId))) {
        return json({ error: 'Not a member' }, 403);
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('streak_recoveries_used, last_recovery_month, timezone')
        .eq('code', pairCode).maybeSingle();
      if (!pair) return json({ error: 'Pair not found' }, 404);
      const currentMonth = getCurrentMonth(pair.timezone || 'UTC');
      const used = pair.last_recovery_month === currentMonth ? (pair.streak_recoveries_used || 0) : 0;
      return json({ used, remaining: Math.max(0, 5 - used), max: 5 });
    }

    // ── POST /api/update-timezone ──
    if (request.method === 'POST' && path === '/api/update-timezone') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const tz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : null;
      if (!tz) return json({ error: 'Invalid timezone' }, 400);

      // Обновляем личную таймзону пользователя
      await supabase.from('pair_users')
        .update({ timezone: tz })
        .eq('user_id', userId);

      // Таймзона ПАРЫ (определяет "сегодня" для стрика) фиксируется по таймзоне
      // того, кто был в паре один на момент установки — обычно создателя.
      // Правило: обновляем pairs.timezone, только если
      //   а) в паре пока 1 участник (партнёр ещё не присоединился), ИЛИ
      //   б) у пары вообще не задана таймзона (бэкфилл старых/битых данных).
      const { data: myPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      for (const up of (myPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', up.pair_code);
        const { data: pairRow } = await supabase
          .from('pairs').select('timezone').eq('code', up.pair_code).maybeSingle();

        const isSolo = (members || []).length <= 1;
        const pairHasNoTz = !pairRow?.timezone;

        if (isSolo || pairHasNoTz) {
          await supabase.from('pairs').update({ timezone: tz }).eq('code', up.pair_code);
        }
      }

      return json({ success: true, timezone: tz });
    }

    // ── Fallback 404 ──
    return json({ error: 'Not found' }, 404);

  } catch (err) {
    console.error('API Error:', err);
    await notifyAdmins(env, `*API Error:*\n\`\`\`\n${(err?.stack || err?.message || String(err)).slice(0, 1500)}\n\`\`\``);
    return json({ error: 'Internal server error' }, 500);
  }
}
