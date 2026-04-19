import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

const PET_TYPES = ['muru', 'neco', 'pico', 'boba'];

const PET_STAGES = [
  { name: 'Egg', minPoints: 0 },
  { name: 'Baby', minPoints: 0 },
  { name: 'Teen', minPoints: 200 },
  { name: 'Adult', minPoints: 500 },
  { name: 'Legend', minPoints: 1000 },
];

const ADMIN_IDS = ['713156118'];
const MAX_PAIRS = 2;

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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

function formatPair(pair, users, lastFed, hatched, stage) {
  return {
    id: pair.code,
    code: pair.code,
    petType: pair.pet_type,
    petName: pair.pet_name || null,
    streakDays: pair.streak_days || 0,
    growthPoints: pair.growth_points || 0,
    hatched,
    stage,
    users: users.map(u => u.user_id),
    lastFed,
  };
}

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') return json({});

  const segments = params.path || [];

  try {
    const supabase = getSupabase(env);

    // GET /api/pairs/:userId
    if (request.method === 'GET' && segments[0] === 'pairs' && segments[1]) {
      const userId = segments[1];
      const { data: pairLinks } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!pairLinks || pairLinks.length === 0) return json({ success: true, pairs: [] });

      const codes = pairLinks.map(p => p.pair_code);
      const { data: pairsData } = await supabase.from('pairs').select('*').in('code', codes);
      const today = getTodayDate();
      const pairs = [];

      for (const pair of pairsData) {
        const { data: users } = await supabase.from('pair_users').select('user_id').eq('pair_code', pair.code);
        const { data: todayFeedings } = await supabase.from('feedings').select('user_id').eq('pair_code', pair.code).eq('fed_date', today);
        const lastFed = {};
        if (todayFeedings) todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
        const hatched = pair.hatched || false;
        const stage = getStage(pair.growth_points || 0, hatched);
        pairs.push(formatPair(pair, users, lastFed, hatched, stage));
      }
      return json({ success: true, pairs });
    }

    // GET /api/pair/:pairCode/:userId
    if (request.method === 'GET' && segments[0] === 'pair' && segments[1] && segments[2]) {
      const pairCode = segments[1];
      const { data: pair } = await supabase.from('pairs').select('*').eq('code', pairCode).single();
      if (!pair) return json({ success: false, message: 'Pair not found' });

      const { data: users } = await supabase.from('pair_users').select('user_id').eq('pair_code', pairCode);
      const today = getTodayDate();
      const { data: todayFeedings } = await supabase.from('feedings').select('user_id').eq('pair_code', pairCode).eq('fed_date', today);
      const lastFed = {};
      if (todayFeedings) todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
      const hatched = pair.hatched || false;
      const stage = getStage(pair.growth_points || 0, hatched);
      return json({ success: true, pair: formatPair(pair, users, lastFed, hatched, stage) });
    }

    // POST /api/create
    if (request.method === 'POST' && segments[0] === 'create') {
      const { userId } = await request.json();
      if (!userId) return json({ success: false, message: 'userId required' });

      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      const isAdmin = ADMIN_IDS.includes(userId.toString());
      if (!isAdmin && existing && existing.length >= MAX_PAIRS) {
        return json({ success: false, message: `Max ${MAX_PAIRS} pairs allowed` });
      }

      const code = generateCode();
      await supabase.from('pairs').insert({
        code, pet_type: 'egg', hatched: false, streak_days: 0,
        growth_points: 0, last_streak_date: null, pet_name: null,
      });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });
      return json({ success: true, code });
    }

    // POST /api/join
    if (request.method === 'POST' && segments[0] === 'join') {
      const { userId, code } = await request.json();
      if (!userId || !code) return json({ success: false, message: 'userId and code required' });
      const upperCode = code.toUpperCase();

      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      const isAdmin = ADMIN_IDS.includes(userId.toString());
      if (!isAdmin && existing && existing.length >= MAX_PAIRS) {
        return json({ success: false, message: `Max ${MAX_PAIRS} pairs allowed` });
      }

      if (existing?.find(e => e.pair_code === upperCode)) return json({ success: false, message: 'Already in this pair' });

      const { data: pair } = await supabase.from('pairs').select('code').eq('code', upperCode).single();
      if (!pair) return json({ success: false, message: 'Code not found' });

      const { data: pairUsers } = await supabase.from('pair_users').select('user_id').eq('pair_code', upperCode);
      if (pairUsers.length >= 2) return json({ success: false, message: 'Pair is full (2/2)' });

      await supabase.from('pair_users').insert({ pair_code: upperCode, user_id: userId });
      return json({ success: true, code: upperCode });
    }

    // POST /api/rename — дать имя питомцу
    if (request.method === 'POST' && segments[0] === 'rename') {
      const { userId, pairCode, petName } = await request.json();
      if (!userId || !pairCode) return json({ success: false, message: 'userId and pairCode required' });

      const { data: link } = await supabase.from('pair_users').select('pair_code')
        .eq('user_id', userId).eq('pair_code', pairCode).single();
      if (!link) return json({ success: false, message: 'Not in this pair' });

      const trimmed = (petName || '').trim().substring(0, 20);
      await supabase.from('pairs').update({ pet_name: trimmed || null }).eq('code', pairCode);
      return json({ success: true, petName: trimmed || null });
    }

    // POST /api/delete — удалить пару
    if (request.method === 'POST' && segments[0] === 'delete') {
      const { userId, pairCode } = await request.json();
      if (!userId || !pairCode) return json({ success: false, message: 'userId and pairCode required' });

      const { data: link } = await supabase.from('pair_users').select('pair_code')
        .eq('user_id', userId).eq('pair_code', pairCode).single();
      if (!link) return json({ success: false, message: 'Not in this pair' });

      await supabase.from('feedings').delete().eq('pair_code', pairCode);
      await supabase.from('pair_users').delete().eq('pair_code', pairCode);
      await supabase.from('pairs').delete().eq('code', pairCode);
      return json({ success: true });
    }

    // POST /api/feed
    if (request.method === 'POST' && segments[0] === 'feed') {
      const { userId, pairCode } = await request.json();
      if (!userId || !pairCode) return json({ success: false, message: 'userId and pairCode required' });

      const { data: link } = await supabase.from('pair_users').select('pair_code')
        .eq('user_id', userId).eq('pair_code', pairCode).single();
      if (!link) return json({ success: false, message: 'Not in this pair' });

      const today = getTodayDate();
      const { data: existingFeed } = await supabase.from('feedings').select('id')
        .eq('pair_code', pairCode).eq('user_id', userId).eq('fed_date', today).single();
      if (existingFeed) return json({ success: false, message: 'Already fed today! Come back tomorrow 🌙' });

      await supabase.from('feedings').insert({ pair_code: pairCode, user_id: userId, fed_date: today });

      const { data: users } = await supabase.from('pair_users').select('user_id').eq('pair_code', pairCode);
      const { data: todayFeedings } = await supabase.from('feedings').select('user_id').eq('pair_code', pairCode).eq('fed_date', today);

      const allFedToday = users.length === 2 && users.every(u => todayFeedings.some(f => f.user_id === u.user_id));

      let evolved = false;
      let justHatched = false;
      let pair = (await supabase.from('pairs').select('*').eq('code', pairCode).single()).data;

      if (allFedToday) {
        if (pair.last_streak_date === today) {
          const lastFed = {};
          todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
          const hatched = pair.hatched || false;
          const stage = getStage(pair.growth_points || 0, hatched);
          return json({ success: true, fed: true, allFedToday: true, evolved: false, hatched: false, pair: formatPair(pair, users, lastFed, hatched, stage) });
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        let newStreak = pair.streak_days || 0;
        if (pair.last_streak_date === yesterdayStr || newStreak === 0) newStreak += 1;
        else newStreak = 1;

        const oldHatched = pair.hatched || false;
        const oldStage = getStage(pair.growth_points || 0, oldHatched);
        const newPoints = (pair.growth_points || 0) + 10 + newStreak * 2;

        let newHatched = oldHatched;
        let newPetType = pair.pet_type;

        if (!oldHatched && newStreak >= 3) {
          newHatched = true;
          justHatched = true;
          newPetType = randomPetType();
        }

        const newStage = getStage(newPoints, newHatched);
        if (oldHatched && oldStage.name !== newStage.name) evolved = true;

        await supabase.from('pairs').update({
          streak_days: newStreak, growth_points: newPoints,
          last_streak_date: today, hatched: newHatched, pet_type: newPetType,
        }).eq('code', pairCode);

        pair.streak_days = newStreak;
        pair.growth_points = newPoints;
        pair.hatched = newHatched;
        pair.pet_type = newPetType;
      }

      const lastFed = {};
      todayFeedings.forEach(f => { lastFed[f.user_id] = today; });
      const hatched = pair.hatched || false;
      const stage = getStage(pair.growth_points || 0, hatched);

      return json({ success: true, fed: true, allFedToday, evolved, hatched: justHatched, pair: formatPair(pair, users, lastFed, hatched, stage) });
    }

  } catch (error) {
    return json({ error: error.message }, 500);
  }

  return json({ error: 'Not found' }, 404);
}
