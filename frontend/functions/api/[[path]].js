import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { LEVELS, getLevel } from '../_levels.js';

// ────────── CONFIG ──────────
const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;

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

async function isPremium(supabase, userId) {
  const { data } = await supabase
    .from('user_subscriptions')
    .select('id, expires_at')
    .eq('telegram_user_id', userId)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  return new Date(data.expires_at) > new Date();
}

async function getMaxPairs(supabase, userId) {
  if (ADMIN_IDS.includes(userId)) return 999;
  const premium = await isPremium(supabase, userId);
  if (premium) return 999;
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .maybeSingle();
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

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate || (Date.now() / 1000) - authDate > 86400) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    const user = JSON.parse(userStr);
    return { userId: String(user.id), user };
  } catch {
    return null;
  }
}

function extractUserId(request, env, bodyUserId) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN);
    if (validated) return validated.userId;
  }
  if (env.ALLOW_DEV_AUTH === '1' && bodyUserId) return String(bodyUserId);
  return null;
}

function isCronAuthorized(request, env) {
  if (!env.CRON_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.CRON_SECRET}`;
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

    // ── GET /api/pairs/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/pairs\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId);

      if (!userPairs || userPairs.length === 0) return json({ pairs: [] });

      const pairs = [];
      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;

        const today = getTodayDate(pair.timezone || 'UTC');

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

    // ── GET /api/pair/:pairCode/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/pair\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const today = getTodayDate(pair.timezone || 'UTC');

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

    // ── GET /api/avatar/:userId ──
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
      } catch {
        return json({ avatar_url: null });
      }
    }

    // ── GET /api/daily-tasks/:pairCode/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/daily-tasks\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];

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

    // ── GET /api/user-slots/:userId ──
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
        timezone: userTz,
      });

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username,
        timezone: userTz,
      });

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
        .from('pairs').select('*').eq('code', code).single();
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

      // Реферал
      for (const m of members || []) {
        if (m.user_id !== userId) {
          await supabase.from('user_referrals').insert({
            inviter_user_id: m.user_id,
            invited_user_id: userId,
            pair_code: code,
          }).then(() => {}, () => {});
        }
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
          const msg = partnerLang === 'ru'
            ? `🎉 *${who}* присоединился к паре \`${code}\`!`
            : `🎉 *${who}* joined pair \`${code}\`!`;
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
        .from('pairs').select('is_dead, timezone').eq('code', code).maybeSingle();
      if (!pairCheck) return json({ error: 'Pair not found' }, 404);
      if (pairCheck.is_dead) return json({ error: 'Pet is dead' }, 400);

      const today = getTodayDate(pairCheck.timezone || 'UTC');

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return json({ error: 'Not a member of this pair' }, 403);

      // One-time task (add_to_home)
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

      // Daily tasks
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
            .from('pairs')
            .select('growth_points, streak_days, last_streak_date, hatched')
            .eq('code', code).single();

          if (pair) {
            const newPoints = (pair.growth_points || 0) + points;
            const updates = { growth_points: newPoints };

            if (taskKey === 'daily_open' && pair.last_streak_date !== today) {
              if (pair.last_streak_date === null) {
                updates.streak_days = 1;
                updates.last_streak_date = today;
              } else {
                const lastDate = new Date(pair.last_streak_date + 'T00:00:00Z');
                const todayDate = new Date(today + 'T00:00:00Z');
                const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                  updates.streak_days = (pair.streak_days || 0) + 1;
                  updates.last_streak_date = today;
                } else if (diffDays > 1) {
                  updates.streak_days = 1;
                  updates.last_streak_date = today;
                }
              }

              if (!pair.hatched && newPoints >= LEVELS[0].maxPoints) {
                updates.hatched = true;
              }
            }

            await supabase.from('pairs').update(updates).eq('code', code);
            pointsAdded = points;
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

      await supabase.from('pairs').update({ bg_id: body.bgId }).eq('code', code);
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
        .maybeSingle();
      if (recent) {
        return json({ error: 'Too many notifications', retryAfter: 3600 }, 429);
      }

      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', targetUserId).maybeSingle();
      const tLang = ps?.lang || 'ru';
      const defaultMsg = tLang === 'ru' ? '🔔 Напоминание от Chumi' : '🔔 Reminder from Chumi';

      await sendTelegramMessage(env, targetUserId, defaultMsg);
      await supabase.from('notification_log').insert({
        sender_user_id: userId,
        target_user_id: targetUserId,
        sent_at: new Date().toISOString(),
      });
      return json({ success: true });
    }

    // ── POST /api/recover-streak ──
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403);

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', code).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);
      if (!pair.is_dead) return json({ error: 'Pet is not dead' }, 400);

      const tz = pair.timezone || 'UTC';
      const currentMonth = getCurrentMonth(tz);
      const yesterday = getYesterdayDate(tz);

      let used = pair.streak_recoveries_used || 0;
      if (pair.last_recovery_month !== currentMonth) used = 0;
      if (used >= 5) return json({ error: 'Max 5 recoveries per month', remaining: 0 }, 400);

      const today = getTodayDate(tz);
      const { data: updated } = await supabase.from('pairs').update({
        is_dead: false,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
        last_streak_date: today,
      }).eq('code', code).select().single();

      return json({
        success: true,
        remaining: 5 - (used + 1),
        streak_days: updated?.streak_days ?? pair.streak_days,
        is_dead: false,
        last_streak_date: today,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
      });
    }

    // ── POST /api/create-invoice ──
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

    // ── POST /api/send-invite ──
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${body.pairCode}`;
      return json({ inviteLink, pairCode: body.pairCode });
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
        .order('growth_points', { ascending: false })
        .limit(100);

      const codes = (allPairs || []).map(p => p.code);
      if (codes.length === 0) return json({ ranking: [] });

      const { data: allMembers } = await supabase
        .from('pair_users')
        .select('pair_code, user_id, display_name, username')
        .in('pair_code', codes);

      const userIds = [...new Set((allMembers || []).map(m => m.user_id))];
      const nowIso = new Date().toISOString();
      const { data: activeSubs } = await supabase
        .from('user_subscriptions')
        .select('telegram_user_id')
        .in('telegram_user_id', userIds)
        .eq('status', 'active')
        .gt('expires_at', nowIso);
      const premiumSet = new Set((activeSubs || []).map(s => String(s.telegram_user_id)));

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
          avatar_url: `/api/avatar/${m.user_id}?proxy=1`,
          is_premium: premiumSet.has(String(m.user_id)),
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
      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days')
        .not('pet_name', 'is', null);

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

      const userIds = [...new Set((allMembers || []).map(m => m.user_id))];
      const nowIso = new Date().toISOString();
      const { data: activeSubs } = await supabase
        .from('user_subscriptions')
        .select('telegram_user_id')
        .in('telegram_user_id', userIds)
        .eq('status', 'active')
        .gt('expires_at', nowIso);
      const premiumSet = new Set((activeSubs || []).map(s => String(s.telegram_user_id)));

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
          avatar_url: `/api/avatar/${m.user_id}?proxy=1`,
          is_premium: premiumSet.has(String(m.user_id)),
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
    if (request.method === 'POST' && path === '/api/prepare-share') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const botLink = `https://t.me/${botUsername}`;
      const messageText = `🐾 Chumi — заведи виртуального питомца и расти его вместе с другом!\n\nВыполняй задания каждый день, поддерживай серию и открывай новые образы.\n\nПопробуй 👇`;

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'share_app_' + Date.now(),
            title: 'Chumi — Вырасти питомца! 🐾',
            input_message_content: { message_text: messageText },
            description: 'Заведи питомца и расти вместе с другом 🐾',
            reply_markup: { inline_keyboard: [[{ text: '🐾 Chumi', url: botLink }]] },
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
      const userId = path.split('/')[3];
      const { data } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
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

      let sent = 0;
      for (const pair of (allPairs || [])) {
        const today = getTodayDate(pair.timezone || 'UTC');
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', pair.code);

        for (const member of (members || [])) {
          const { data: opened } = await supabase
            .from('daily_tasks').select('id')
            .eq('pair_code', pair.code)
            .eq('user_id', member.user_id)
            .eq('task_key', 'daily_open')
            .eq('task_date', today)
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

    // ── POST /api/update-streaks (cron) ──
    if (request.method === 'POST' && path === '/api/update-streaks') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, last_streak_date, streak_days, is_dead, pet_name, timezone')
        .eq('is_dead', false);

      let killed = 0;
      for (const pair of (allPairs || [])) {
        const tz = pair.timezone || 'UTC';
        const today = getTodayDate(tz);

        if (pair.last_streak_date && pair.last_streak_date < today) {
          await supabase.from('pairs').update({ is_dead: true }).eq('code', pair.code);
          killed++;

          // Уведомить обоих партнёров о смерти питомца
          const { data: deadMembers } = await supabase
            .from('pair_users').select('user_id').eq('pair_code', pair.code);
          for (const dm of (deadMembers || [])) {
            const { data: ps } = await supabase
              .from('user_settings').select('lang')
              .eq('telegram_user_id', dm.user_id).maybeSingle();
            const dLang = ps?.lang || 'ru';
            const petName = pair.pet_name || (dLang === 'ru' ? 'Питомец' : 'Pet');
            const text = dLang === 'ru'
              ? `💀 *${petName}* умер... Серия (${pair.streak_days} дн.) под угрозой!\nЗайди в приложение и нажми «Воскресить», чтобы продолжить серию.\nОсталось воскрешений в этом месяце: до 5.`
              : `💀 *${petName}* has died... Streak (${pair.streak_days} days) is at risk!\nOpen the app and tap "Revive" to continue.\nUp to 5 revivals per month available.`;
            await sendTelegramMessage(env, dm.user_id, text);
          }
        }
      }
      return json({ success: true, killed });
    }

    // ── POST /api/cleanup-empty-pairs (cron) ──
    if (request.method === 'POST' && path === '/api/cleanup-empty-pairs') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403);

      const { data: allPairs } = await supabase
        .from('pairs').select('code, created_at');

      const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
      let cleaned = 0;

      for (const pair of (allPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', pair.code);

        const isOldEnough = pair.created_at && pair.created_at < fiveDaysAgo;
        if ((!members || members.length < 2) && isOldEnough) {
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

      const { data: pairRow } = await supabase
        .from('pairs').select('pet_name, streak_days').eq('code', code).maybeSingle();
      const petName = pairRow?.pet_name || 'Chumi';
      const streak = pairRow?.streak_days || 0;

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      const WEBAPP_URL = 'https://chumi-app.pages.dev';
      const RU = [
        `🐾 Привет! Не забывай про ${petName} — серия ${streak} дн.!`,
        `💌 Сообщение от партнёра по Chumi! Питомец растёт уже ${streak} дн. 🐾`,
        `👋 ${petName} ждёт тебя! Серия: ${streak} дн. 🐾`,
      ];
      const EN = [
        `🐾 Hey! Don't forget about ${petName} — streak ${streak} days!`,
        `💌 Message from your Chumi partner! Pet is growing for ${streak} days 🐾`,
        `👋 ${petName} is waiting! Streak: ${streak} days 🐾`,
      ];

      for (const m of (members || [])) {
        if (m.user_id === userId) continue;
        const { data: ps } = await supabase
          .from('user_settings').select('lang')
          .eq('telegram_user_id', m.user_id).maybeSingle();
        const targetLang = ps?.lang || 'ru';
        const pool = targetLang === 'ru' ? RU : EN;
        const text = pool[Math.floor(Math.random() * pool.length)];

        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: m.user_id,
            text,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🐾 Chumi', web_app: { url: WEBAPP_URL } }]] },
          }),
        });
      }
      return json({ success: true });
    }

    // ── GET /api/skins/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/skins\/[^/]+$/)) {
      const userId = path.split('/')[3];
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
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401);

      const skinId = body.skinId;
      if (!skinId) return json({ error: 'skinId required' }, 400);

      const SKIN_PRICES = { strawberry: 25, floral: 25, astronaut: 25 };
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

      await supabase.from('user_skins').insert({ user_id: userId, skin_id: 'bee' });
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
      const premium = await isPremium(supabase, userId);
      let expiresAt = null;
      if (premium) {
        const { data } = await supabase
          .from('user_subscriptions')
          .select('expires_at')
          .eq('telegram_user_id', userId)
          .eq('status', 'active')
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        expiresAt = data?.expires_at || null;
      }
      return json({ premium, expires_at: expiresAt });
    }

    // ── GET /api/recoveries-left/:pairCode ──
    if (request.method === 'GET' && path.match(/^\/api\/recoveries-left\/[^/]+$/)) {
      const pairCode = path.split('/')[3];
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

      await supabase.from('pair_users')
        .update({ timezone: tz })
        .eq('user_id', userId)
        .neq('timezone', tz);

      const { data: myPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      for (const up of (myPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', up.pair_code);
        if ((members || []).length === 1) {
          await supabase.from('pairs').update({ timezone: tz }).eq('code', up.pair_code);
        }
      }

      return json({ success: true, timezone: tz });
    }

    // ── Fallback 404 ──
    return json({ error: 'Not found' }, 404);

  } catch (err) {
    console.error('API Error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
}
