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

// ────────── Extract userId from request (with optional validation) ──────────
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
    // GET /api/avatar/:userId
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/avatar\/[^/]+$/)) {
      const tgUserId = path.split('/')[3];
      const BOT_TOKEN = env.BOT_TOKEN;
      const wantProxy = url.searchParams.get('proxy');

      try {
        // Check if we have a cached file_path (NOT the full URL with token)
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

          // Save only file_path, NOT the full URL with token
          await supabase
            .from('pair_users')
            .update({ avatar_file_path: filePath })
            .eq('user_id', tgUserId);
        }

        if (wantProxy) {
          const avatarUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          const imgRes = await fetch(avatarUrl);
          if (!imgRes.ok) return json({ avatar_url: null });
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

      // Verify user is in this pair
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

      // Points awarded only when BOTH partners completed the same task
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

            // Update streak if both did daily_open today and streak not yet counted
            if (taskKey === 'daily_open' && pair.last_streak_date !== today) {
              // Don't count streak on the very first day (creation day)
              // last_streak_date === null means pair was just created
              if (pair.last_streak_date === null) {
                // First time both opened — just mark the date, don't increment streak
                updates.last_streak_date = today;
              } else {
                // Check if this is a consecutive day (yesterday or today after previous day)
                const lastDate = new Date(pair.last_streak_date + 'T00:00:00Z');
                const todayDate = new Date(today + 'T00:00:00Z');
                const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

                if (diffDays === 1) {
                  // Consecutive day — increment streak
                  const newStreak = (pair.streak_days || 0) + 1;
                  updates.streak_days = newStreak;
                  updates.last_streak_date = today;

                  // Hatch based on growth_points reaching Egg maxPoints (33)
                  if (!pair.hatched && newPoints >= 33) {
                    updates.hatched = true;
                  }
                } else if (diffDays > 1) {
                  // Missed days — streak broken (will be handled by cron, but reset here too)
                  updates.streak_days = 1;
                  updates.last_streak_date = today;
                } else {
                  // Same day (diffDays === 0) — already handled by last_streak_date !== today check
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

      // Verify membership
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

      // Verify membership
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      // Notify partner before deleting
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

      // Verify that caller and target are in the same pair
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

      // ── Extra slot ──
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

      // ── Premium monthly subscription ──
      if (productId === 'premium_monthly') {
        const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
          title: 'Chumi Premium',
          description: 'Exclusive skins, unlimited pairs, unique outfits',
          payload: JSON.stringify({ userId, productId: 'premium_monthly', timestamp: Date.now() }),
          provider_token: '',
          currency: 'XTR',
          prices: [{ amount: 150, label: 'Premium Monthly' }],
          subscription_period: 2592000, // 30 days
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
    // POST /api/send-reminders
    // (called by scheduled cron or manually)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/send-reminders') {
      const BOT_TOKEN = env.BOT_TOKEN;
      const todayStr = getTodayDate();

      // Get all active pairs with at least 1 streak day
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days')
        .gte('streak_days', 1);

      let sent = 0;
      for (const pair of (allPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users')
          .select('user_id')
          .eq('pair_code', pair.code);

        for (const member of (members || [])) {
          // Check if user already opened app today
          const { data: tasks } = await supabase
            .from('daily_tasks')
            .select('task_key')
            .eq('pair_code', pair.code)
            .eq('user_id', member.user_id)
            .eq('task_key', 'daily_open')
            .eq('task_date', todayStr);

          if (!tasks || tasks.length === 0) {
            // Hasn't opened — send reminder
            const { data: settings } = await supabase
              .from('user_settings')
              .select('lang')
              .eq('telegram_user_id', member.user_id)
              .single();

            const lang = settings?.lang || 'ru';
            const name = pair.pet_name || (lang === 'ru' ? 'Питомец' : 'Pet');
            const text = lang === 'ru'
              ? `🐾 ${name} ждёт тебя! Серия ${pair.streak_days} дней — не сломай! 🔥`
              : `🐾 ${name} is waiting! ${pair.streak_days} day streak — don't break it! 🔥`;

            try {
              await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: member.user_id,
                  text,
                  reply_markup: {
                    inline_keyboard: [[{
                      text: lang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi',
                      web_app: { url: `https://chumi-app.pages.dev/pair/${pair.code}` },
                    }]],
                  },
                }),
              });
              sent++;
            } catch (e) {
              console.error('Reminder send error:', e);
            }
          }
        }
      }
      return json({ ok: true, sent });
    }


        // ═══════════════════════════════════════
    // POST /api/update-streaks
    // (called by scheduled cron daily — checks yesterday's activity,
    //  kills pets that missed a day)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/update-streaks') {
      // Optional: protect with a secret
      const authHeader = request.headers.get('Authorization');
      if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const today = getTodayDate();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Get all active (not dead) pairs that have been active at least once
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, streak_days, last_streak_date, is_dead, hatched, pet_name')
        .eq('is_dead', false)
        .not('last_streak_date', 'is', null);

      let checked = 0;
      let killed = 0;

      for (const pair of (allPairs || [])) {
        // Skip if last activity was today (already active today)
        if (pair.last_streak_date === today) continue;

        // Skip if last activity was yesterday (they still have today to complete)
        if (pair.last_streak_date === yesterdayStr) continue;

        // If last_streak_date is older than yesterday — they missed a day
        const lastDate = new Date(pair.last_streak_date + 'T00:00:00Z');
        const todayDate = new Date(today + 'T00:00:00Z');
        const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));

        if (diffDays >= 2) {
          // Missed at least one full day — kill the pet
          await supabase.from('pairs').update({
            is_dead: true,
          }).eq('code', pair.code);
          killed++;

          // Notify members
          const { data: members } = await supabase
            .from('pair_users')
            .select('user_id')
            .eq('pair_code', pair.code);

          for (const m of (members || [])) {
            const { data: settings } = await supabase
              .from('user_settings')
              .select('lang')
              .eq('telegram_user_id', m.user_id)
              .single();

            const lang = settings?.lang || 'ru';
            const petName = pair.pet_name || (lang === 'ru' ? 'Питомец' : 'Pet');
            const text = lang === 'ru'
              ? `💀 ${petName} умер... Серия ${pair.streak_days} дней сломалась.\n\nТы можешь восстановить серию или начать заново.`
              : `💀 ${petName} died... Your ${pair.streak_days} day streak is broken.\n\nYou can recover or start a new egg.`;
            await sendTelegramMessage(env, m.user_id, text);
          }
        }

        checked++;
      }

      return json({ ok: true, checked, killed });
    }

        // ═══════════════════════════════════════
    // GET /api/skins/:userId
    // (получить список скинов пользователя)
    // ═══════════════════════════════════════
    if (request.method === 'GET' && path.match(/^\/api\/skins\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const { data: owned } = await supabase
        .from('user_skins')
        .select('skin_id')
        .eq('user_id', userId);

      // Count referrals for bee skin check
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
    // POST /api/buy-skin
    // (купить скин за Stars)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/buy-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const skinId = body.skinId;
      const PAID_SKINS = ['strawberry', 'floral', 'astronaut'];
      const SKIN_PRICE = 25;

      if (!PAID_SKINS.includes(skinId)) {
        return json({ error: 'Invalid skin or not purchasable' }, 400);
      }

      // Check if already owned
      const { data: existing } = await supabase
        .from('user_skins')
        .select('id')
        .eq('user_id', userId)
        .eq('skin_id', skinId)
        .maybeSingle();

      if (existing) return json({ error: 'Already owned' }, 400);

      // Create invoice for Stars payment
      const payload = JSON.stringify({ userId, skinId, type: 'skin', timestamp: Date.now() });
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Наряд: ${skinId}`,
          description: `Уникальный наряд для вашего питомца`,
          payload,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: `Skin: ${skinId}`, amount: SKIN_PRICE }],
        }),
      });

      const data = await res.json();
      if (!data.ok) return json({ error: 'Invoice creation failed' }, 500);
      return json({ invoiceUrl: data.result });
    }

    // ═══════════════════════════════════════
    // POST /api/set-skin
    // (установить скин для пары)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/set-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;
      const skinId = body.skinId; // null = default skin for current level

      // Verify membership
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      if (skinId) {
        // Verify ownership
        const { data: owned } = await supabase
          .from('user_skins')
          .select('id')
          .eq('user_id', userId)
          .eq('skin_id', skinId)
          .maybeSingle();
        if (!owned) return json({ error: 'Skin not owned' }, 403);
      }

      await supabase.from('pairs')
        .update({ active_skin: skinId || null })
        .eq('code', code);

      return json({ success: true, active_skin: skinId || null });
    }

    // ═══════════════════════════════════════
    // POST /api/claim-bee-skin
    // (получить бесплатный скин Bee за 2 реферала)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/claim-bee-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      // Check already owned
      const { data: existing } = await supabase
        .from('user_skins')
        .select('id')
        .eq('user_id', userId)
        .eq('skin_id', 'bee')
        .maybeSingle();
      if (existing) return json({ error: 'Already owned' }, 400);

      // Count referrals
      const { data: referrals } = await supabase
        .from('user_referrals')
        .select('invited_user_id')
        .eq('inviter_user_id', userId);

      if (!referrals || referrals.length < 2) {
        return json({ error: 'Need 2 referrals', current: referrals?.length || 0 }, 400);
      }

      await supabase.from('user_skins').insert({
        user_id: userId,
        skin_id: 'bee',
      });

      return json({ success: true, skin_id: 'bee' });
    }

    // ═══════════════════════════════════════
    // POST /api/cleanup-empty-pairs
    // (удаление пар без партнёра старше 5 дней)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/cleanup-empty-pairs') {
      const authHeader = request.headers.get('Authorization');
      if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const cutoffDate = fiveDaysAgo.toISOString();

      // Get all pairs created more than 5 days ago
      const { data: oldPairs } = await supabase
        .from('pairs')
        .select('code, created_at')
        .lt('created_at', cutoffDate);

      let deleted = 0;

      for (const pair of (oldPairs || [])) {
        // Count members
        const { data: members } = await supabase
          .from('pair_users')
          .select('user_id')
          .eq('pair_code', pair.code);

        if (!members || members.length < 2) {
          // Solo pair older than 5 days — delete
          // Notify the solo member
          if (members && members.length === 1) {
            const { data: settings } = await supabase
              .from('user_settings')
              .select('lang')
              .eq('telegram_user_id', members[0].user_id)
              .single();
            const lang = settings?.lang || 'ru';
            const text = lang === 'ru'
              ? `🕐 Пара \`${pair.code}\` удалена — партнёр не присоединился в течение 5 дней.`
              : `🕐 Pair \`${pair.code}\` deleted — partner didn't join within 5 days.`;
            await sendTelegramMessage(env, members[0].user_id, text);
          }

          await supabase.from('one_time_tasks').delete().eq('pair_code', pair.code);
          await supabase.from('daily_tasks').delete().eq('pair_code', pair.code);
          await supabase.from('pair_users').delete().eq('pair_code', pair.code);
          await supabase.from('pairs').delete().eq('code', pair.code);
          deleted++;
        }
      }

      return json({ ok: true, deleted });
    }

    // ═══════════════════════════════════════
    // 404
    // ═══════════════════════════════════════
    return json({ error: 'Not found' }, 404);

  } catch (e) {
    console.error('API Error:', e);
    return json({ error: 'Internal error', details: e.message }, 500);
  }
}
