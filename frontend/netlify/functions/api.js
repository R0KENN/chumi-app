const TelegramBot = require('node-telegram-bot-api');

// --- База данных в памяти (позже заменим на Supabase) ---
let pairs = {};
let userToPair = {};

// --- Уровни питомца ---
const PET_STAGES = [
  { name: 'Яйцо', emoji: '🥚', minPoints: 0 },
  { name: 'Малыш', emoji: '🐣', minPoints: 50 },
  { name: 'Подросток', emoji: '🐲', minPoints: 200 },
  { name: 'Взрослый', emoji: '🔥', minPoints: 500 },
  { name: 'Легенда', emoji: '👑', minPoints: 1000 },
];

function getPetStage(points) {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) {
    if (points >= s.minPoints) stage = s;
  }
  return stage;
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');

  // --- GET /pair/:userId ---
  if (event.httpMethod === 'GET' && path.startsWith('/pair/')) {
    const userId = path.split('/pair/')[1];
    const code = userToPair[userId];

    if (!code || !pairs[code]) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: false, message: 'Пара не найдена' })
      };
    }

    const pair = pairs[code];
    const stage = getPetStage(pair.growthPoints);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        pair: { code, petType: pair.petType, streakDays: pair.streakDays, growthPoints: pair.growthPoints, stage, users: pair.users, lastFed: pair.lastFed }
      })
    };
  }

  // --- POST /feed ---
  if (event.httpMethod === 'POST' && path === '/feed') {
    const { userId } = JSON.parse(event.body);
    const code = userToPair[userId];

    if (!code || !pairs[code]) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: false, message: 'Пара не найдена' })
      };
    }

    const pair = pairs[code];
    const today = getTodayDate();

    if (pair.lastFed[userId] === today) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: false, message: 'Ты уже покормил сегодня! Приходи завтра 🌙' })
      };
    }

    pair.lastFed[userId] = today;

    const allFedToday = pair.users.length === 2 && pair.users.every(u => pair.lastFed[u] === today);
    let evolved = false;

    if (allFedToday) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (pair.lastStreakDate === yesterdayStr || pair.streakDays === 0) {
        pair.streakDays += 1;
      } else if (pair.lastStreakDate !== today) {
        pair.streakDays = 1;
      }

      pair.lastStreakDate = today;
      const oldStage = getPetStage(pair.growthPoints);
      pair.growthPoints += 10 + pair.streakDays * 2;
      const newStage = getPetStage(pair.growthPoints);

      if (oldStage.name !== newStage.name) evolved = true;
    }

    const stage = getPetStage(pair.growthPoints);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true, fed: true, allFedToday, evolved,
        pair: { streakDays: pair.streakDays, growthPoints: pair.growthPoints, stage, lastFed: pair.lastFed }
      })
    };
  }

  // --- GET /test-create ---
  if (event.httpMethod === 'GET' && path === '/test-create') {
    const code = generateCode();
    pairs[code] = {
      users: ['test_user_123', 'test_user_456'],
      petType: 'grimm', petLevel: 0, streakDays: 0, growthPoints: 0, lastFed: {}, createdAt: getTodayDate()
    };
    userToPair['test_user_123'] = code;
    userToPair['test_user_456'] = code;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, code }) };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};
