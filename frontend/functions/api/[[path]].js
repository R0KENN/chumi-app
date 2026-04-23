import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

// ────────── CONFIG ──────────
const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;

const LEVELS = [
  { level: 0, name: 'Egg',    nameRu: 'Яйцо',      maxPoints: 33  },
  { level: 1, name: 'Baby',   nameRu: 'Малыш',      maxPoints: 45  },
  { level: 2, name: 'Junior', nameRu: 'Подросток',   maxPoints: 63  },
  { level: 3, name: 'Teen',   nameRu: 'Юный',        maxPoints: 90  },
  { level: 4, name: 'Adult',  nameRu: 'Взрослый',    maxPoints: 135 },
  { level: 5, name: 'Legend', nameRu: 'Легенда',     maxPoints: 200 },
];

const TASK_POINTS = {
  daily_open: 1,
  send_msg: 1,
  send_sticker: 2,
  send_media: 4,
  pet_touch: 1,
  add_to_home: 3,
};

// ────────── HELPERS ──────────
function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Telegram-Init-Data',
    },
  });
}

function getLevel(totalPoints) {
  let accumulated = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < accumulated + LEVELS[i].maxPoints) {
      return {
        ...LEVELS[i],
        current: totalPoints - accumulated,
        needed: LEVELS[i].maxPoints,
        remaining: accumulated + LEVELS[i].maxPoints - totalPoints,
      };
    }
    accumulated += LEVELS[i].maxPoints;
  }
  const last = LEVELS[LEVELS.length - 1];
  return { ...last, current: last.maxPoints, needed: last.maxPoints, remaining: 0 };
}

async function getMaxPairs(supabase, userId) {
  if (ADMIN_IDS.includes(userId)) return 999;
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .single();
  return MAX_PAIRS_BASE + (data?.extra_slots || 0);
}

async function sendTelegramMessage(env, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

// ────────── Telegram initData validation ──────────
function validateInitData(initDataRaw, botToken) {
  if (!initDataRaw || !botToken) return null;
  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const entries = [...params.entries()];
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return { userId: String(user.id), user };
  } catch (e) {
    return null;
  }
}

// ────────── Extract userId from request ──────────
function extractUserId(request, env, bodyUserId) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN);
    if (validated) return validated.userId;
  }
  // Fallback: trust body userId (for dev/testing; remove in production)
  return bodyUserId ? String(bodyUserId) : null;
}

function formatPair(pair, members, tasksToday, userId, oneTimeTasks) {
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
      avatar_url: m.avatar_url ? `/api/avatar/${m.user_id}?proxy=1` : null,
    })) || [],
    active_skin: pair.active_skin || null,
    partner_name: partner?.display_name || null,
    partner_username: partner?.username || null,
    my_name: me?.display_name || null,
    member_count: members?.length || 0,
    daily_tasks: tasksToday || [],
    one_time_tasks: oneTimeTasks || [],
  };
}

// ────────── Seeded random for daily shuffle ──────────
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
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

// ────────── Stars invoice helper ──────────
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
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Telegram-Init-Data',
      },
    });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const supabase = getSupabase(env);

    // ═══════════════════════════════════════
    // GET /api/pairs/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/pairs\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId);

      if (!userPairs || userPairs.length === 0) return json({ pairs: [] });

      const today = getTodayDate();
      const pairs = [];

      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;

        const { data: members } = await supabase
          .from('pair_users').select('*').eq('pair_code', up.pair_code);

        const { data: tasks } = await supabase
          .from('daily_tasks').select('*')
          .eq('pair_code', up.pair_code)
          .eq('user_id', userId)
          .eq('task_date', today);

        const { data: otTasks } = await supabase
          .from('one_time_tasks').select('task_key')
          .eq('pair_code', up.pair_code)
          .eq('user_id', userId);

        pairs.push(formatPair(pair, members, tasks, userId, otTasks));
      }

      return json({ pairs });
    }

    // ═══════════════════════════════════════
    // GET /api/pair/:pairCode/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/pair\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];
      const today = getTodayDate();

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase
        .from('pair_users').select('*').eq('pair_code', pairCode);

      const { data: tasks } = await supabase
        .from('daily_tasks').select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', userId)
        .eq('task_date', today);

      const { data: otTasks } = await supabase
        .from('one_time_tasks').select('task_key')
        .eq('pair_code', pairCode)
        .eq('user_id', userId);

      return json(formatPair(pair, members, tasks, userId, otTasks));
    }

    // ═══════════════════════════════════════
    // GET /api/avatar/:userId  [FIX #1: убран дублированный блок]
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/avatar\/[^/]+$/)) {
      const tgUserId = path.split('/')[3];
      const BOT_TOKEN = env.BOT_TOKEN;
      const wantProxy = url.searchParams.get('proxy');

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

          await supabase
            .from('pair_users')
            .update({ avatar_file_path: filePath })
            .eq('user_id', tgUserId);
        }

        // FIX: единый блок прокси с retry при протухшем файле
        if (wantProxy) {
          const avatarUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          const imgRes = await fetch(avatarUrl);

          if (!imgRes.ok) {
            // Файл протух — очищаем кеш, клиент должен повторить запрос
            await supabase
              .from('pair_users')
              .update({ avatar_file_path: null })
              .eq('user_id', tgUserId);
            return json({ avatar_url: null });
          }

          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const imgBuffer = await imgRes.arrayBuffer();
          return new Response(imgBuffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }

        return json({ avatar_url: `/api/avatar/${tgUserId}?proxy=1` });
      } catch (e) {
        return json({ avatar_url: null });
      }
    }

    // ═══════════════════════════════════════
    // GET /api/daily-tasks/:pairCode/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/daily-tasks\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];
      const today = getTodayDate();

      const { data: tasks } = await supabase
        .from('daily_tasks').select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', userId)
        .eq('task_date', today);

      return json({ tasks: tasks || [] });
    }

    // ═══════════════════════════════════════
    // GET /api/user-slots/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/user-slots\/[^/]+$/)) {
      const userId = path.split('/')[3];
      const maxPairs = await getMaxPairs(supabase, userId);
      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      return json({
        maxPairs,
        currentPairs: existing?.length || 0,
        extraSlots: maxPairs - MAX_PAIRS_BASE,
      });
    }

    // ═══════════════════════════════════════
    // POST /api/create
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/create') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const displayName = body.displayName || null;
      const username = body.username || null;
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400);
      }

      const code = generateCode();

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
      });

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username,
      });

      return json({ code });
    }

    // ═══════════════════════════════════════
    // POST /api/join
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/join') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = (body.code || '').trim().toUpperCase();
      const displayName = body.displayName || null;
      const username = body.username || null;
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400);
      }

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', code).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      if (members?.some(m => m.user_id === userId)) {
        return json({ error: 'Already in pair' }, 400);
      }
      if (members && members.length >= 2) {
        return json({ error: 'Pair full' }, 400);
      }

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username,
      });

      for (const m of members || []) {
        if (m.user_id !== userId) {
          await sendTelegramMessage(env, m.user_id, `🎉 Someone joined pair \`${code}\`!`);
        }
      }

      return json({ code });
    }

    // ═══════════════════════════════════════
    // POST /api/complete-task
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/complete-task') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.code;
      const taskKey = body.taskKey;
      const today = getTodayDate();

      const points = TASK_POINTS[taskKey];
      if (points === undefined) return json({ error: 'Invalid task' }, 400);

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return json({ error: 'Not a member of this pair' }, 403);

      // ── One-time task (add_to_home) ──
      if (taskKey === 'add_to_home') {
        const { data: alreadyDone } = await supabase
          .from('one_time_tasks').select('id')
          .eq('pair_code', code)
          .eq('user_id', userId)
          .eq('task_key', taskKey)
          .maybeSingle();

        if (alreadyDone) return json({ error: 'Already completed' }, 400);

        await supabase.from('one_time_tasks').insert({
          pair_code: code,
          user_id: userId,
          task_key: taskKey,
          completed_at: new Date().toISOString(),
        });

        const { data: pair } = await supabase
          .from('pairs').select('growth_points').eq('code', code).single();
        if (pair) {
          await supabase.from('pairs')
            .update({ growth_points: (pair.growth_points || 0) + points })
            .eq('code', code);
        }

        return json({ success: true, points_added: points });
      }

      // ── Daily tasks ──
      const { data: existing } = await supabase
        .from('daily_tasks').select('id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .eq('task_key', taskKey)
        .eq('task_date', today)
        .maybeSingle();

      if (existing) return json({ error: 'Already completed' }, 400);

      await supabase.from('daily_tasks').insert({
        pair_code: code,
        user_id: userId,
        task_key: taskKey,
        task_date: today,
        completed: true,
        completed_at: new Date().toISOString(),
      });

      const { data: members } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code);

      const partnerIds = (members || [])
        .map(m => String(m.user_id))
        .filter(id => id !== String(userId));

      let pointsAdded = 0;

      if (partnerIds.length > 0) {
        const partnerId = partnerIds[0];
        const { data: partnerDone } = await supabase
          .from('daily_tasks').select('id')
          .eq('pair_code', code)
          .eq('user_id', partnerId)
          .eq('task_key', taskKey)
          .eq('task_date', today)
          .maybeSingle();

        if (partnerDone) {
          const { data: pair } = await supabase
            .from('pairs').select('growth_points, streak_days, last_streak_date, hatched')
            .eq('code', code).single();
          if (pair) {
            const newPoints = (pair.growth_points || 0) + points;
            const updates = { growth_points: newPoints };

            if (taskKey === 'daily_open' && pair.last_streak_date !== today) {
              if (pair.last_streak_date === null) {
                updates.last_streak_date = today;
              } else {
                const lastDate = new Date(pair.last_streak_date + 'T00:00:00Z');
                const todayDate = new Date(today + 'T00:00:00Z');
                const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

                if (diffDays === 1) {
                  const newStreak = (pair.streak_days || 0) + 1;
                  updates.streak_days = newStreak;
                  updates.last_streak_date = today;

                  if (!pair.hatched && newPoints >= 33) {
                    updates.hatched = true;
                  }
                } else if (diffDays > 1) {
                  updates.streak_days = 1;
                  updates.last_streak_date = today;
                } else {
                  updates.last_streak_date = today;
                }
              }
            }

            await supabase.from('pairs').update(updates).eq('code', code);
            pointsAdded = points;
          }
        }
      }

      return json({ success: true, points_added: pointsAdded });
    }

    // ═══════════════════════════════════════
    // POST /api/rename
    // ═══════════════════════════════════════
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

    // ═══════════════════════════════════════
    // POST /api/delete
    // ═══════════════════════════════════════
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
          await sendTelegramMessage(env, m.user_id, `😢 Pair \`${code}\` has been deleted.`);
        }
      }

      await supabase.from('one_time_tasks').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);
      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('pair_users').delete().eq('pair_code', code);
      await supabase.from('pairs').delete().eq('code', code);

      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/setbg
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/setbg') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      await supabase.from('pairs')
        .update({ bg_id: body.bgId })
        .eq('code', code);
      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/notify
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/notify') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const targetUserId = body.targetUserId;

      const { data: callerPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      const { data: targetPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', targetUserId);

      const callerCodes = new Set((callerPairs || []).map(p => p.pair_code));
      const isPartner = (targetPairs || []).some(p => callerCodes.has(p.pair_code));

      if (!isPartner) return json({ error: 'Can only notify your partner' }, 403);

      await sendTelegramMessage(env, targetUserId, body.message || '🔔 Напоминание от Chumi');
      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/recover-streak
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;
      const currentMonth = getCurrentMonth();

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', code).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      let used = pair.streak_recoveries_used || 0;
      if (pair.last_recovery_month !== currentMonth) used = 0;
      if (used >= 5) return json({ error: 'Max 5 recoveries per month' }, 400);

      await supabase.from('pairs').update({
        is_dead: false,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
      }).eq('code', code);

      return json({ success: true, remaining: 5 - (used + 1) });
    }

    // ═══════════════════════════════════════
    // POST /api/create-invoice
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/create-invoice') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
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
            prices: [{ label: 'Extra pair slot', amount: 50 }],
          }),
        });
        const data = await res.json();
        if (!data.ok) return json({ error: 'Invoice creation failed' }, 500);
        return json({ invoiceUrl: data.result });
      }

      if (productId === 'premium_monthly') {
        const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
          title: 'Chumi Premium',
          description: 'Exclusive skins, unlimited pairs, unique outfits',
          payload: JSON.stringify({ userId, productId: 'premium_monthly', timestamp: Date.now() }),
          provider_token: '',
          currency: 'XTR',
          prices: [{ amount: 150, label: 'Premium Monthly' }],
          subscription_period: 2592000,
        });
        if (!invoiceUrl) return json({ error: 'Invoice creation failed' }, 500);
        return json({ invoiceUrl });
      }

      return json({ error: 'Invalid product' }, 400);
    }

    // ═══════════════════════════════════════
    // POST /api/send-invite
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${body.pairCode}`;
      return json({ inviteLink, pairCode: body.pairCode });
    }

    // ═══════════════════════════════════════
    // POST /api/create-egg
    // ═══════════════════════════════════════
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

    // ═══════════════════════════════════════
    // GET /api/ranking
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path === '/api/ranking') {
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days')
        .order('growth_points', { ascending: false })
        .limit(100);

      const ranking = [];
      for (const p of (allPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users')
          .select('user_id, display_name, username')
          .eq('pair_code', p.code);

        ranking.push({
          code: p.code,
          pet_name: p.pet_name,
          growth_points: p.growth_points || 0,
          streak_days: p.streak_days || 0,
          members: (members || []).map(m => ({
            user_id: m.user_id,
            display_name: m.display_name || null,
            avatar_url: `/api/avatar/${m.user_id}?proxy=1`,
          })),
        });
      }

      return json({ ranking });
    }

    // ═══════════════════════════════════════
    // GET /api/ranking-random
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path === '/api/ranking-random') {
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days')
        .not('pet_name', 'is', null);

      const named = (allPairs || []).filter(p => p.pet_name && p.pet_name.trim() !== '');
      if (named.length === 0) return json({ ranking: [] });

      const today = getTodayDate().replace(/-/g, '');
      const seed = parseInt(today);
      const shuffled = shuffleWithSeed(named, seed).slice(0, 50);

      const ranking = [];
      for (const p of shuffled) {
        const { data: members } = await supabase
          .from('pair_users')
          .select('user_id, display_name, username')
          .eq('pair_code', p.code);

        ranking.push({
          code: p.code,
          pet_name: p.pet_name,
          growth_points: p.growth_points || 0,
          streak_days: p.streak_days || 0,
          members: (members || []).map(m => ({
            user_id: m.user_id,
            display_name: m.display_name || null,
            avatar_url: `/api/avatar/${m.user_id}?proxy=1`,
          })),
        });
      }

      return json({ ranking });
    }

    // ═══════════════════════════════════════
    // POST /api/prepare-share
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/prepare-share') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = body.pairCode;
      const messageText = body.text || '🐾 Присоединяйся к Chumi — растим питомца вместе!';

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'share_' + pairCode + '_' + Date.now(),
            title: 'Chumi — Вырасти питомца! 🐾',
            input_message_content: {
              message_text: messageText + `\n\nhttps://t.me/ChumiPetBot?start=join_${pairCode}`,
            },
            description: 'Нажми чтобы пригласить в пару 🐾',
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: false,
        }),
      });

      const data = await res.json();
      if (data.ok && data.result?.id) {
        return json({ prepared_message_id: data.result.id });
      }
      return json({ error: 'Failed to prepare message', details: data }, 500);
    }

    // ═══════════════════════════════════════
    // GET /api/user-lang/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/user-lang\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const { data } = await supabase
        .from('user_settings')
        .select('lang')
        .eq('telegram_user_id', userId)
        .single();

      return json({ lang: data?.lang || 'ru' });
    }

    // ═══════════════════════════════════════
    // POST /api/set-lang
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/set-lang') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const lang = body.lang === 'en' ? 'en' : 'ru';

      const { data: existing } = await supabase
        .from('user_settings')
        .select('telegram_user_id')
        .eq('telegram_user_id', userId)
        .single();

      if (existing) {
        await supabase
          .from('user_settings')
          .update({ lang, updated_at: new Date().toISOString() })
          .eq('telegram_user_id', userId);
      } else {
        await supabase
          .from('user_settings')
          .insert({ telegram_user_id: userId, lang });
      }

      return json({ success: true, lang });
    }

    // ═══════════════════════════════════════
    // POST /api/send-reminders  [FIX #3: полная реализация]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/send-reminders') {
      const BOT_TOKEN = env.BOT_TOKEN;
      const todayStr = getTodayDate();

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days')
        .eq('is_dead', false)
        .gte('streak_days', 1);

      let sent = 0;
      for (const pair of (allPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users')
          .select('user_id')
          .eq('pair_code', pair.code);

        for (const member of (members || [])) {
          const { data: opened } = await supabase
            .from('daily_tasks').select('id')
            .eq('pair_code', pair.code)
            .eq('user_id', member.user_id)
            .eq('task_key', 'daily_open')
            .eq('task_date', todayStr)
            .maybeSingle();

          if (!opened) {
            const petName = pair.pet_name || 'Chumi';
            await sendTelegramMessage(env, member.user_id,
              `🔔 *${petName}* ждёт тебя! Серия: ${pair.streak_days} дн. 🔥\nНе забудь зайти сегодня!`
            );
            sent++;
          }
        }
      }

      return json({ success: true, sent });
    }

    // ═══════════════════════════════════════
    // POST /api/update-streaks  [FIX #3: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/update-streaks') {
      const today = getTodayDate();
      const todayDate = new Date(today + 'T00:00:00Z');
      const yesterdayDate = new Date(todayDate.getTime() - 86400000);
      const yesterday = yesterdayDate.toISOString().split('T')[0];

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, last_streak_date, streak_days, is_dead')
        .eq('is_dead', false);

      let killed = 0;
      for (const pair of (allPairs || [])) {
        // Если пара имеет серию и последний день серии был раньше вчерашнего — серия сломана
        if (pair.last_streak_date && pair.last_streak_date < yesterday) {
          await supabase.from('pairs').update({
            is_dead: true,
          }).eq('code', pair.code);
          killed++;

          // Уведомить участников
          const { data: members } = await supabase
            .from('pair_users').select('user_id').eq('pair_code', pair.code);
          for (const m of (members || [])) {
            await sendTelegramMessage(env, m.user_id,
              `💀 Ваш питомец в паре \`${pair.code}\` умер... Серия прервалась.`
            );
          }
        }
      }

      return json({ success: true, killed });
    }

    // ═══════════════════════════════════════
    // POST /api/cleanup-empty-pairs  [FIX #3: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/cleanup-empty-pairs') {
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, created_at');

      const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
      let cleaned = 0;

      for (const pair of (allPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', pair.code);

        // Удаляем соло-пары старше 5 дней
        if ((!members || members.length < 2) && pair.created_at && pair.created_at < fiveDaysAgo) {
          await supabase.from('one_time_tasks').delete().eq('pair_code', pair.code);
          await supabase.from('daily_tasks').delete().eq('pair_code', pair.code);
          await supabase.from('feedings').delete().eq('pair_code', pair.code);
          await supabase.from('pair_users').delete().eq('pair_code', pair.code);
          await supabase.from('pairs').delete().eq('code', pair.code);
          cleaned++;
        }
      }

      return json({ success: true, cleaned });
    }

    // ═══════════════════════════════════════
    // POST /api/send-partner-message  [FIX #5: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/send-partner-message') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.code;
      const text = body.text || '💌 Сообщение от партнёра!';

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const { data: members } = await supabase
        .from('pair_users').select('user_id, display_name').eq('pair_code', code);

      const WEBAPP_URL = 'https://chumi-app.pages.dev';
      for (const m of (members || [])) {
        if (m.user_id !== userId) {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: m.user_id,
              text,
              parse_mode: 'Markdown',
              reply_markup: JSON.stringify({
                inline_keyboard: [[{
                  text: '🐾 Chumi',
                  web_app: { url: WEBAPP_URL },
                }]],
              }),
            }),
          });
        }
      }

      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // GET /api/skins/:userId  [FIX #4: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/skins\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const { data: owned } = await supabase
        .from('user_skins')
        .select('skin_id')
        .eq('user_id', userId);

      const { data: referrals } = await supabase
        .from('user_referrals')
        .select('invited_user_id')
        .eq('inviter_user_id', userId);

      return json({
        owned: (owned || []).map(s => s.skin_id),
        referral_count: referrals?.length || 0,
      });
    }

    // ═══════════════════════════════════════
    // POST /api/buy-skin  [FIX #4: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/buy-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const skinId = body.skinId;
      if (!skinId) return json({ error: 'skinId required' }, 400);

      const SKIN_PRICES = {
        strawberry: 25,
        floral: 25,
        astronaut: 25,
      };

      const price = SKIN_PRICES[skinId];
      if (price === undefined) return json({ error: 'Invalid skin' }, 400);

      // Проверим, не куплен ли уже
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

    // ═══════════════════════════════════════
    // POST /api/claim-bee-skin  [FIX #4: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/claim-bee-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      // Проверяем количество рефералов
      const { data: referrals } = await supabase
        .from('user_referrals')
        .select('invited_user_id')
        .eq('inviter_user_id', userId);

      const count = referrals?.length || 0;
      if (count < 2) return json({ error: 'Need at least 2 referrals' }, 400);

      // Проверяем, не получен ли уже
      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', userId).eq('skin_id', 'bee').maybeSingle();
      if (alreadyOwned) return json({ error: 'Already claimed' }, 400);

      await supabase.from('user_skins').insert({
        user_id: userId,
        skin_id: 'bee',
      });

      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/set-skin  [FIX #4: НОВЫЙ ЭНДПОИНТ]
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/set-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const pairCode = body.pairCode;
      const skinId = body.skinId; // null = снять скин

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // Если skinId не null, проверяем владение
      if (skinId) {
        const { data: owned } = await supabase
          .from('user_skins').select('id')
          .eq('user_id', userId).eq('skin_id', skinId).maybeSingle();
        if (!owned) return json({ error: 'Skin not owned' }, 403);
      }

      await supabase.from('pairs')
        .update({ active_skin: skinId })
        .eq('code', pairCode);

      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // Fallback 404
    // ═══════════════════════════════════════
    return json({ error: 'Not found' }, 404);

  } catch (err) {
    console.error('API Error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}
