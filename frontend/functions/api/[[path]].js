import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];

const PET_STAGES = [
  { name: 'Яйцо', minPoints: 0 },
  { name: 'Малыш', minPoints: 0 },
  { name: 'Подросток', minPoints: 200 },
  { name: 'Взрослый', minPoints: 500 },
  { name: 'Легенда', minPoints: 1000 },
];

function getStage(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  let stage = PET_STAGES[1];
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points >= PET_STAGES[i].minPoints) stage = PET_STAGES[i];
  }
  return stage;
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
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
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return json({});
  }

  // params.path — массив сегментов после /api/
  const segments = params.path || [];
  const path = '/' + segments.join('/');

  try {
    const supabase = getSupabase(env);

    // ==========================================
    // GET /api/pair/:userId
    // ==========================================
    if (request.method === 'GET' && segments[0] === 'pair' && segments[1]) {
      const userId = segments[1];

      const { data: pairUser, error: pairUserError } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (!pairUser || pairUserError) {
        return json({ success: false, message: 'Пара не найдена' });
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', pairUser.pair_code)
        .single();

      if (!pair) {
        return json({ success: false, message: 'Данные пары не найдены' });
      }

      const { data: users } = await supabase
        .from('pair_users')
        .select('user_id')
        .eq('pair_code', pairUser.pair_code);

      const today = getTodayDate();
      const { data: todayFeedings } = await supabase
        .from('feedings')
        .select('user_id')
        .eq('pair_code', pairUser.pair_code)
        .eq('fed_date', today);

      const lastFed = {};
      if (todayFeedings) {
        todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
      }

      const hatched = pair.hatched || false;
      const stage = getStage(pair.growth_points, hatched);

      return json({
        success: true,
        pair: {
          code: pair.code,
          petType: pair.pet_type,
          streakDays: pair.streak_days,
          growthPoints: pair.growth_points,
          hatched,
          stage,
          users: users.map(u => u.user_id),
          lastFed,
        },
      });
    }

    // ==========================================
    // POST /api/feed
    // ==========================================
    if (request.method === 'POST' && segments[0] === 'feed') {
      const { userId } = await request.json();
      if (!userId) {
        return json({ success: false, message: 'userId не указан' });
      }

      const { data: pairUser } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (!pairUser) {
        return json({ success: false, message: 'Пара не найдена' });
      }

      const pairCode = pairUser.pair_code;
      const today = getTodayDate();

      const { data: existingFeed } = await supabase
        .from('feedings')
        .select('id')
        .eq('pair_code', pairCode)
        .eq('user_id', userId)
        .eq('fed_date', today)
        .single();

      if (existingFeed) {
        return json({ success: false, message: 'Ты уже покормил сегодня! Приходи завтра 🌙' });
      }

      const { error: insertError } = await supabase
        .from('feedings')
        .insert({ pair_code: pairCode, user_id: userId, fed_date: today });

      if (insertError) {
        return json({ success: false, message: 'Ошибка записи кормления' });
      }

      const { data: users } = await supabase
        .from('pair_users')
        .select('user_id')
        .eq('pair_code', pairCode);

      const { data: todayFeedings } = await supabase
        .from('feedings')
        .select('user_id')
        .eq('pair_code', pairCode)
        .eq('fed_date', today);

      const allFedToday = users.length === 2 &&
        users.every(u => todayFeedings.some(f => f.user_id === u.user_id));

      let evolved = false;
      let justHatched = false;
      let pair = (await supabase.from('pairs').select('*').eq('code', pairCode).single()).data;

      if (allFedToday) {
        if (pair.last_streak_date === today) {
          const lastFed = {};
          todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
          const hatched = pair.hatched || false;
          const stage = getStage(pair.growth_points, hatched);

          return json({
            success: true, fed: true, allFedToday: true, evolved: false, hatched,
            pair: {
              code: pair.code, petType: pair.pet_type,
              streakDays: pair.streak_days, growthPoints: pair.growth_points,
              hatched, stage, lastFed,
              users: users.map(u => u.user_id),
            },
          });
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        let newStreak = pair.streak_days;
        if (pair.last_streak_date === yesterdayStr || pair.streak_days === 0) {
          newStreak += 1;
        } else {
          newStreak = 1;
        }

        const oldHatched = pair.hatched || false;
        const oldStage = getStage(pair.growth_points, oldHatched);
        const newPoints = pair.growth_points + 10 + newStreak * 2;

        let newHatched = oldHatched;
        let newPetType = pair.pet_type;

        if (!oldHatched && newStreak >= 3) {
          newHatched = true;
          justHatched = true;
          newPetType = randomPetType();
        }

        const newStage = getStage(newPoints, newHatched);
        if (oldHatched && oldStage.name !== newStage.name) {
          evolved = true;
        }

        await supabase
          .from('pairs')
          .update({
            streak_days: newStreak,
            growth_points: newPoints,
            last_streak_date: today,
            hatched: newHatched,
            pet_type: newPetType,
          })
          .eq('code', pairCode);

        pair.streak_days = newStreak;
        pair.growth_points = newPoints;
        pair.hatched = newHatched;
        pair.pet_type = newPetType;
      }

      const lastFed = {};
      todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
      const hatched = pair.hatched || false;
      const stage = getStage(pair.growth_points, hatched);

      return json({
        success: true, fed: true, allFedToday, evolved, hatched: justHatched,
        pair: {
          code: pair.code, petType: pair.pet_type,
          streakDays: pair.streak_days, growthPoints: pair.growth_points,
          hatched, stage, lastFed,
          users: users.map(u => u.user_id),
        },
      });
    }

    // ==========================================
    // POST /api/create
    // ==========================================
    if (request.method === 'POST' && segments[0] === 'create') {
      const { userId } = await request.json();

      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (existing) {
        return json({ success: false, message: 'Ты уже в паре!' });
      }

      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'egg', hatched: false });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      return json({ success: true, code });
    }

    // ==========================================
    // POST /api/join
    // ==========================================
    if (request.method === 'POST' && segments[0] === 'join') {
      const { userId, code } = await request.json();

      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (existing) {
        return json({ success: false, message: 'Ты уже в паре!' });
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('code')
        .eq('code', code.toUpperCase())
        .single();

      if (!pair) {
        return json({ success: false, message: 'Код не найден' });
      }

      const { data: pairUsers } = await supabase
        .from('pair_users')
        .select('user_id')
        .eq('pair_code', code.toUpperCase());

      if (pairUsers.length >= 2) {
        return json({ success: false, message: 'В этой паре уже 2 человека' });
      }

      await supabase.from('pair_users').insert({ pair_code: code.toUpperCase(), user_id: userId });

      return json({ success: true, message: 'Ты присоединился!' });
    }

  } catch (error) {
    return json({ error: error.message }, 500);
  }

  return json({ error: 'Not found' }, 404);
}
