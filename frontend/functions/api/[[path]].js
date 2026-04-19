import { createClient } from '@supabase/supabase-js';

const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];
const PET_STAGES = [
  { name: 'Egg', minPoints: 0 },
  { name: 'Baby', minPoints: 0 },
  { name: 'Teen', minPoints: 200 },
  { name: 'Adult', minPoints: 500 },
  { name: 'Legend', minPoints: 1000 }
];
const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function getStage(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  for (let i = PET_STAGES.length - 1; i >= 1; i--) {
    if (points >= PET_STAGES[i].minPoints) return PET_STAGES[i];
  }
  return PET_STAGES[1];
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

function randomPetType() {
  return PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

async function getMaxPairs(supabase, userId) {
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .single();
  return MAX_PAIRS_BASE + (data?.extra_slots || 0);
}

function formatPair(pair, members, feedingsToday, userId) {
  const today = getTodayDate();
  const userFed = feedingsToday?.some(f => f.telegram_user_id === userId && f.feed_date === today) || false;
  const allFed = members?.length > 0 && members.every(m =>
    feedingsToday?.some(f => f.telegram_user_id === m.telegram_user_id && f.feed_date === today)
  );
  const userPetted = feedingsToday?.some(f => f.telegram_user_id === userId && f.feed_date === today && f.petted) || false;
  const stage = getStage(pair.growth_points, pair.hatched);
  const partner = members?.find(m => m.telegram_user_id !== userId);

  return {
    code: pair.code,
    petType: pair.pet_type,
    petName: pair.pet_name,
    hatched: pair.hatched,
    streakDays: pair.streak_days,
    growthPoints: pair.growth_points,
    stage: stage.name,
    bgId: pair.bg_id || 'room',
    isDead: pair.is_dead || false,
    streakRecoveriesUsed: pair.streak_recoveries_used || 0,
    lastRecoveryMonth: pair.last_recovery_month,
    userFedToday: userFed,
    allFedToday: allFed,
    userPettedToday: userPetted,
    members: members?.map(m => ({
      odID: m.telegram_user_id,
      displayName: m.display_name || null
    })) || [],
    partnerName: partner?.display_name || null,
    memberCount: members?.length || 0
  };
}

async function sendTelegramMessage(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const supabase = getSupabase(env);

    // ═══ GET /api/pairs/:userId ═══
if (request.method === 'GET' && path.match(/^\/api\/pairs\/[^/]+$/)) {
    const userId = path.split('/')[3];
    const { data: userPairs } = await supabase
      .from('pair_users')
      .select('pair_code')
      .eq('user_id', userId);

    if (!userPairs || userPairs.length === 0) return json({ pairs: [] });

    const pairs = [];
    for (const up of userPairs) {
      const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).single();
      if (!pair) continue;
      const { data: members } = await supabase.from('pair_users').select('*').eq('pair_code', up.pair_code);
      const { data: feeds } = await supabase.from('feedings').select('*').eq('pair_code', up.pair_code).eq('feed_date', getTodayDate());
      pairs.push(formatPair(pair, members, feeds, userId));
    }
    return json({ pairs });
}


    // ═══ GET /api/pair/:pairCode/:userId ═══
    if (request.method === 'GET' && path.match(/^\/api\/pair\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase.from('pair_users').select('*').eq('pair_code', pairCode);
      const { data: feeds } = await supabase.from('feedings').select('*').eq('pair_code', pairCode).eq('feed_date', getTodayDate());

      // Daily tasks
      const { data: tasks } = await supabase.from('daily_tasks')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('telegram_user_id', userId)
        .eq('task_date', getTodayDate());

      const pairData = formatPair(pair, members, feeds, userId);
      pairData.dailyTasks = tasks || [];

      return json({ pair: pairData });
    }

    // ═══ POST /api/create ═══
    if (request.method === 'POST' && path === '/api/create') {
      const body = await request.json();
      const userId = String(body.userId);
      const displayName = body.displayName || null;

      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('telegram_user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true, currentCount: existing.length, maxPairs }, 400);
      }

      const code = generateCode();
      await supabase.from('pairs').insert({
        code,
        pet_type: 'egg',
        hatched: false,
        streak_days: 0,
        growth_points: 0,
        bg_id: 'room',
        pet_name: null,
        streak_recoveries_used: 0,
        last_recovery_month: null,
        is_dead: false
      });

      await supabase.from('pair_users').insert({
        pair_code: code,
        telegram_user_id: userId,
        display_name: displayName
      });

      return json({ code });
    }

    // ═══ POST /api/join ═══
    if (request.method === 'POST' && path === '/api/join') {
      const body = await request.json();
      const userId = String(body.userId);
      const code = (body.code || '').trim().toUpperCase();
      const displayName = body.displayName || null;

      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('telegram_user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400);
      }

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', code).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase.from('pair_users').select('telegram_user_id').eq('pair_code', code);
      if (members?.some(m => m.telegram_user_id === userId)) return json({ error: 'Already in pair' }, 400);
      if (members && members.length >= 2) return json({ error: 'Pair full' }, 400);

      await supabase.from('pair_users').insert({
        pair_code: code,
        telegram_user_id: userId,
        display_name: displayName
      });

      // Notify partner via Telegram
      for (const m of members || []) {
        if (m.telegram_user_id !== userId) {
          try {
            await sendTelegramMessage(env, m.telegram_user_id,
              `🎉 Кто-то присоединился к паре \`${code}\`!`
            );
          } catch (e) {}
        }
      }

      return json({ code });
    }

    // ═══ POST /api/feed ═══
    if (request.method === 'POST' && path === '/api/feed') {
      const body = await request.json();
      const userId = String(body.userId);
      const pairCode = body.pairCode;
      const today = getTodayDate();

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);
      if (pair.is_dead) return json({ error: 'Pet is dead', isDead: true }, 400);

      const { data: members } = await supabase.from('pair_users').select('*').eq('pair_code', pairCode);
      if (!members?.some(m => m.telegram_user_id === userId)) return json({ error: 'Not a member' }, 403);

      const { data: existingFeed } = await supabase.from('feedings')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('telegram_user_id', userId)
        .eq('feed_date', today);

      if (existingFeed && existingFeed.length > 0) return json({ error: 'Already fed today' }, 400);

      await supabase.from('feedings').insert({
        pair_code: pairCode,
        telegram_user_id: userId,
        feed_date: today
      });

      // Mark daily task "feed" as completed
      await supabase.from('daily_tasks').upsert({
        pair_code: pairCode,
        telegram_user_id: userId,
        task_date: today,
        task_type: 'feed',
        completed: true
      }, { onConflict: 'pair_code,telegram_user_id,task_date,task_type' });

      // Check if all members fed
      const { data: todayFeeds } = await supabase.from('feedings')
        .select('telegram_user_id')
        .eq('pair_code', pairCode)
        .eq('feed_date', today);

      const allFed = members.every(m =>
        todayFeeds?.some(f => f.telegram_user_id === m.telegram_user_id)
      );

      let hatched = pair.hatched;
      let streakDays = pair.streak_days;
      let growthPoints = pair.growth_points;
      let petType = pair.pet_type;
      let evolved = false;
      let justHatched = false;

      if (allFed) {
        streakDays += 1;
        const bonus = 10 + 2 * streakDays;
        growthPoints += bonus;

        if (!hatched && streakDays >= 3) {
          hatched = true;
          justHatched = true;
          petType = body.chosenPetType || randomPetType();
          if (!PET_TYPES.includes(petType)) petType = randomPetType();
        }

        const oldStage = getStage(pair.growth_points, pair.hatched);
        const newStage = getStage(growthPoints, hatched);
        if (oldStage.name !== newStage.name && !justHatched) evolved = true;

        await supabase.from('pairs').update({
          streak_days: streakDays,
          growth_points: growthPoints,
          hatched,
          pet_type: petType
        }).eq('code', pairCode);

        // Notify partner
        for (const m of members) {
          if (m.telegram_user_id !== userId) {
            try {
              let notif = `🍖 Твой партнёр покормил питомца! Серия: ${streakDays} дн.`;
              if (justHatched) notif = `🐣 Яйцо вылупилось! Это *${petType}*!`;
              if (evolved) notif = `✨ Питомец эволюционировал в *${newStage.name}*!`;
              await sendTelegramMessage(env, m.telegram_user_id, notif);
            } catch (e) {}
          }
        }
      } else {
        // Notify partner that one member fed
        for (const m of members) {
          if (m.telegram_user_id !== userId) {
            try {
              await sendTelegramMessage(env, m.telegram_user_id,
                `🍖 Партнёр покормил питомца (\`${pairCode}\`). Твоя очередь!`
              );
            } catch (e) {}
          }
        }
      }

      const stage = getStage(growthPoints, hatched);
      return json({
        allFed,
        hatched,
        justHatched,
        evolved,
        streakDays,
        growthPoints,
        stage: stage.name,
        petType
      });
    }

    // ═══ POST /api/pet (гладить) ═══
    if (request.method === 'POST' && path === '/api/pet') {
      const body = await request.json();
      const userId = String(body.userId);
      const pairCode = body.pairCode;
      const today = getTodayDate();

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', pairCode).single();
      if (!pair || pair.is_dead) return json({ error: 'Not available' }, 400);

      const { data: existing } = await supabase.from('feedings')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('telegram_user_id', userId)
        .eq('feed_date', today)
        .eq('petted', true);

      if (existing && existing.length > 0) return json({ error: 'Already petted today' }, 400);

      // Insert or update
      const { data: feedRow } = await supabase.from('feedings')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('telegram_user_id', userId)
        .eq('feed_date', today);

      if (feedRow && feedRow.length > 0) {
        await supabase.from('feedings')
          .update({ petted: true })
          .eq('pair_code', pairCode)
          .eq('telegram_user_id', userId)
          .eq('feed_date', today);
      } else {
        await supabase.from('feedings').insert({
          pair_code: pairCode,
          telegram_user_id: userId,
          feed_date: today,
          petted: true
        });
      }

      // Mark daily task
      await supabase.from('daily_tasks').upsert({
        pair_code: pairCode,
        telegram_user_id: userId,
        task_date: today,
        task_type: 'pet',
        completed: true
      }, { onConflict: 'pair_code,telegram_user_id,task_date,task_type' });

      // Bonus: +2 points for petting
      await supabase.from('pairs')
        .update({ growth_points: pair.growth_points + 2 })
        .eq('code', pairCode);

      return json({ success: true, bonusPoints: 2 });
    }

    // ═══ POST /api/recover-streak ═══
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const userId = String(body.userId);
      const pairCode = body.pairCode;
      const currentMonth = getCurrentMonth();

      const { data: pair } = await supabase.from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ error: 'Pair not found' }, 404);

      const { data: members } = await supabase.from('pair_users').select('*').eq('pair_code', pairCode);
      if (!members?.some(m => m.telegram_user_id === userId)) return json({ error: 'Not a member' }, 403);

      // Reset month counter if new month
      let used = pair.streak_recoveries_used || 0;
      if (pair.last_recovery_month !== currentMonth) {
        used = 0;
      }

      if (used >= 5) {
        return json({ error: 'Max 5 recoveries per month', remaining: 0 }, 400);
      }

      await supabase.from('pairs').update({
        is_dead: false,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth
      }).eq('code', pairCode);

      return json({
        success: true,
        recoveriesUsed: used + 1,
        remaining: 5 - (used + 1)
      });
    }

    // ═══ POST /api/rename ═══
    if (request.method === 'POST' && path === '/api/rename') {
      const body = await request.json();
      const pairCode = body.pairCode;
      const name = (body.name || '').trim().slice(0, 20);
      if (!name) return json({ error: 'Name required' }, 400);

      await supabase.from('pairs').update({ pet_name: name }).eq('code', pairCode);

      // Mark daily task
      if (body.userId) {
        await supabase.from('daily_tasks').upsert({
          pair_code: pairCode,
          telegram_user_id: String(body.userId),
          task_date: getTodayDate(),
          task_type: 'rename',
          completed: true
        }, { onConflict: 'pair_code,telegram_user_id,task_date,task_type' });
      }

      return json({ success: true, petName: name });
    }

    // ═══ POST /api/delete ═══
    if (request.method === 'POST' && path === '/api/delete') {
      const body = await request.json();
      const pairCode = body.pairCode;

      await supabase.from('feedings').delete().eq('pair_code', pairCode);
      await supabase.from('daily_tasks').delete().eq('pair_code', pairCode);
      await supabase.from('pair_users').delete().eq('pair_code', pairCode);
      await supabase.from('pairs').delete().eq('code', pairCode);

      return json({ success: true });
    }

    // ═══ POST /api/setbg ═══
    if (request.method === 'POST' && path === '/api/setbg') {
      const body = await request.json();
      await supabase.from('pairs').update({ bg_id: body.bgId }).eq('code', body.pairCode);

      // Mark daily task
      if (body.userId) {
        await supabase.from('daily_tasks').upsert({
          pair_code: body.pairCode,
          telegram_user_id: String(body.userId),
          task_date: getTodayDate(),
          task_type: 'changebg',
          completed: true
        }, { onConflict: 'pair_code,telegram_user_id,task_date,task_type' });
      }

      return json({ success: true });
    }

    // ═══ POST /api/notify ═══
    if (request.method === 'POST' && path === '/api/notify') {
      const body = await request.json();
      const targetUserId = body.targetUserId;
      const message = body.message || '🔔 Уведомление от Chumi';

      await sendTelegramMessage(env, targetUserId, message);
      return json({ success: true });
    }

    // ═══ POST /api/create-invoice ═══
    if (request.method === 'POST' && path === '/api/create-invoice') {
      const body = await request.json();
      const userId = String(body.userId);
      const productId = body.productId;

      const products = {
        extra_slot: {
          title: 'Дополнительный слот для пары',
          description: 'Получите возможность создать ещё одну пару',
          stars: 50
        }
      };

      const product = products[productId];
      if (!product) return json({ error: 'Invalid product' }, 400);

      const payload = JSON.stringify({ userId, productId, timestamp: Date.now() });

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title,
          description: product.description,
          payload: payload,
          provider_token: '',
          currency: 'XTR',
          prices: [{ label: product.title, amount: product.stars }]
        })
      });

      const data = await res.json();
      if (!data.ok) return json({ error: 'Invoice creation failed' }, 500);

      return json({ invoiceUrl: data.result });
    }

    // ═══ POST /api/send-invite ═══
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const senderName = body.senderName || 'Друг';
      const pairCode = body.pairCode;

      // Generate a deeplink the recipient can tap
      const botUsername = env.BOT_USERNAME || 'chumi_pet_bot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${pairCode}`;

      return json({ inviteLink, pairCode });
    }

    // ═══ GET /api/daily-tasks/:pairCode/:userId ═══
    if (request.method === 'GET' && path.match(/^\/api\/daily-tasks\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];
      const today = getTodayDate();

      const { data: tasks } = await supabase.from('daily_tasks')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('telegram_user_id', userId)
        .eq('task_date', today);

      const allTasks = [
        { type: 'feed', label_en: 'Feed your pet', label_ru: 'Покорми питомца', xp: 0 },
        { type: 'pet', label_en: 'Pet your pet', label_ru: 'Погладь питомца', xp: 2 },
        { type: 'changebg', label_en: 'Change background', label_ru: 'Смени фон', xp: 0 }
      ];

      const result = allTasks.map(t => ({
        ...t,
        completed: tasks?.some(dt => dt.task_type === t.type && dt.completed) || false
      }));

      return json({ tasks: result });
    }

    // ═══ POST /api/create-egg ═══ (restart after death)
    if (request.method === 'POST' && path === '/api/create-egg') {
      const body = await request.json();
      const pairCode = body.pairCode;

      await supabase.from('pairs').update({
        pet_type: 'egg',
        hatched: false,
        streak_days: 0,
        growth_points: 0,
        is_dead: false,
        pet_name: null,
        streak_recoveries_used: 0
      }).eq('code', pairCode);

      await supabase.from('feedings').delete().eq('pair_code', pairCode);
      await supabase.from('daily_tasks').delete().eq('pair_code', pairCode);

      return json({ success: true });
    }

    // ═══ GET /api/user-slots/:userId ═══
    if (request.method === 'GET' && path.match(/^\/api\/user-slots\/[^/]+$/)) {
      const userId = path.split('/')[3];
      const maxPairs = await getMaxPairs(supabase, userId);
      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('telegram_user_id', userId);
      return json({
        maxPairs,
        currentPairs: existing?.length || 0,
        extraSlots: maxPairs - MAX_PAIRS_BASE
      });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error('API Error:', e);
    return json({ error: 'Internal error' }, 500);
  }
}
