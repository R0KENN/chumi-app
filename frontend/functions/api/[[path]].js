import { createClient } from '@supabase/supabase-js';

// ────────── CONFIG ──────────
const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;

const LEVELS = [
  { level: 0, name: 'Spark',   nameRu: 'Искра',   maxPoints: 30  },
  { level: 1, name: 'Flame',   nameRu: 'Огонёк',  maxPoints: 70  },
  { level: 2, name: 'Blaze',   nameRu: 'Пламя',   maxPoints: 50  },
  { level: 3, name: 'Fire',    nameRu: 'Костёр',   maxPoints: 150 },
  { level: 4, name: 'Inferno', nameRu: 'Инферно', maxPoints: 200 },
];

const TASK_POINTS = {
  daily_open: 1,
  send_msg: 1,
  send_sticker: 2,
  send_media: 4,
  pet_touch: 1,
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
      'Access-Control-Allow-Headers': 'Content-Type',
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
    streak_recoveries_used: pair.streak_recoveries_used || 0,
    last_recovery_month: pair.last_recovery_month,
    last_streak_date: pair.last_streak_date,
    members: members?.map(m => ({
      user_id: m.user_id,
      display_name: m.display_name || null,
      username: m.username || null,
      avatar_url: m.avatar_url || null,
    })) || [],
    partner_name: partner?.display_name || null,
    partner_username: partner?.username || null,
    my_name: me?.display_name || null,
    member_count: members?.length || 0,
    daily_tasks: tasksToday || [],
  };
}

// ────────── MAIN HANDLER ──────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
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

        pairs.push(formatPair(pair, members, tasks, userId));
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

      return json(formatPair(pair, members, tasks, userId));
    }

    // ═══════════════════════════════════════
// ═══════════════════════════════════════
// GET /api/avatar/:userId
// ═══════════════════════════════════════
if (request.method === 'GET' && path.match(/^\/api\/avatar\/[^/]+$/)) {
  const tgUserId = path.split('/')[3];
  const BOT_TOKEN = env.BOT_TOKEN;

  // Если запрос с ?proxy=1 — отдаём саму картинку (бинарно)
  const url2 = new URL(request.url);
  const wantProxy = url2.searchParams.get('proxy');

  try {
    // Сначала проверяем кэш в БД
    const { data: cached } = await supabase
      .from('pair_users')
      .select('avatar_url')
      .eq('user_id', tgUserId)
      .limit(1)
      .maybeSingle();

    let avatarUrl = cached?.avatar_url;

    // Если нет кэша — запрашиваем у Telegram
    if (!avatarUrl) {
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

      avatarUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;

      // Кэшируем
      await supabase
        .from('pair_users')
        .update({ avatar_url: avatarUrl })
        .eq('user_id', tgUserId);
    }

    // Если просят прокси — скачиваем картинку и отдаём бинарно
    if (wantProxy) {
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

    // Обычный режим — отдаём прокси-URL (на наш домен)
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
      const userId = String(body.userId);
      const displayName = body.displayName || null;
      const username = body.username || null;

      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!isAdmin && existing && existing.length >= maxPairs) {
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
        is_dead: false,
      });

      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: displayName,
        username: username,
      });

      return json({ code });
    }

    // ═══════════════════════════════════════
    // POST /api/join
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/join') {
      const body = await request.json();
      const userId = String(body.userId);
      const code = (body.code || '').trim().toUpperCase();
      const displayName = body.displayName || null;
      const username = body.username || null;

      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!isAdmin && existing && existing.length >= maxPairs) {
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
        username: username,
      });

      // Notify partner
      for (const m of members || []) {
        if (m.user_id !== userId) {
          await sendTelegramMessage(env, m.user_id,
            `🎉 Кто-то присоединился к паре \`${code}\`!`
          );
        }
      }

      return json({ code });
    }

    // ═══════════════════════════════════════
    // POST /api/complete-task
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/complete-task') {
      const body = await request.json();
      const code = body.code;
      const userId = String(body.userId);
      const taskKey = body.taskKey;
      const today = getTodayDate();

      // Validate task key
      const points = TASK_POINTS[taskKey];
      if (points === undefined) return json({ error: 'Invalid task' }, 400);

      // Check if already done
      const { data: existing } = await supabase
        .from('daily_tasks').select('id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .eq('task_key', taskKey)
        .eq('task_date', today)
        .maybeSingle();

      if (existing) return json({ error: 'Already completed' }, 400);

      // Insert task
      await supabase.from('daily_tasks').insert({
        pair_code: code,
        user_id: userId,
        task_key: taskKey,
        task_date: today,
        completed: true,
        completed_at: new Date().toISOString(),
      });

      // Add growth points
      const { data: pair } = await supabase
        .from('pairs').select('growth_points').eq('code', code).single();

      if (pair) {
        const newPoints = (pair.growth_points || 0) + points;
        await supabase.from('pairs')
          .update({ growth_points: newPoints })
          .eq('code', code);
      }

      return json({ success: true, points_added: points });
    }

    // ═══════════════════════════════════════
    // POST /api/rename
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/rename') {
      const body = await request.json();
      const code = body.code || body.pairCode;
      const name = (body.pet_name || body.name || '').trim().slice(0, 20);
      if (!name) return json({ error: 'Name required' }, 400);

      await supabase.from('pairs').update({ pet_name: name }).eq('code', code);
      return json({ success: true, pet_name: name });
    }

    // ═══════════════════════════════════════
    // POST /api/delete
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/delete') {
      const body = await request.json();
      const code = body.pairCode || body.code;

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
      await supabase.from('pairs')
        .update({ bg_id: body.bgId })
        .eq('code', body.pairCode || body.code);
      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/notify
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/notify') {
      const body = await request.json();
      await sendTelegramMessage(env, body.targetUserId, body.message || '🔔 Напоминание от Chumi');
      return json({ success: true });
    }

    // ═══════════════════════════════════════
    // POST /api/recover-streak
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const code = body.pairCode || body.code;
      const userId = String(body.userId);
      const currentMonth = getCurrentMonth();

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
      const userId = String(body.userId);

      const products = {
        extra_slot: {
          title: 'Дополнительный слот для пары',
          description: 'Получите возможность создать ещё одну пару',
          stars: 50,
        },
      };

      const product = products[body.productId];
      if (!product) return json({ error: 'Invalid product' }, 400);

      const payload = JSON.stringify({ userId, productId: body.productId, timestamp: Date.now() });

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title,
          description: product.description,
          payload,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: product.title, amount: product.stars }],
        }),
      });

      const data = await res.json();
      if (!data.ok) return json({ error: 'Invoice creation failed' }, 500);
      return json({ invoiceUrl: data.result });
    }

    // ═══════════════════════════════════════
    // POST /api/send-invite
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const botUsername = env.BOT_USERNAME || 'chumi_pet_bot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${body.pairCode}`;
      return json({ inviteLink, pairCode: body.pairCode });
    }

    // ═══════════════════════════════════════
    // POST /api/create-egg (restart after death)
    // ═══════════════════════════════════════
    if (request.method === 'POST' && path === '/api/create-egg') {
      const body = await request.json();
      const code = body.pairCode || body.code;

      await supabase.from('pairs').update({
        pet_type: 'spark',
        hatched: false,
        streak_days: 0,
        growth_points: 0,
        is_dead: false,
        pet_name: null,
        streak_recoveries_used: 0,
      }).eq('code', code);

      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);

      return json({ success: true });
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
