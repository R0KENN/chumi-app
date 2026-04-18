const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- База данных (пока в памяти, позже подключим Supabase) ---
const pairs = {};      // { pairCode: { users: [userId1, userId2], petType: 'grimm', petLevel: 0, streakDays: 0, growthPoints: 0, lastFed: {} } }
const userToPair = {}; // { odlpldp: pairCode }

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

// --- Telegram Bot ---
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '🐾 Привет! Я Chumi — бот для выращивания питомца!\n\n' +
    'Команды:\n' +
    '/create — создать пару и получить код\n' +
    '/join КОДИК — присоединиться к паре\n' +
    '/status — посмотреть питомца\n' +
    '/pet — открыть Mini App',
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🐾 Открыть Chumi', web_app: { url: process.env.WEBAPP_URL || 'https://chumi-app.vercel.app' } }
        ]]
      }
    }
  );
});

bot.onText(/\/create/, (msg) => {
  const userId = msg.from.id.toString();

  if (userToPair[userId]) {
    bot.sendMessage(msg.chat.id, '⚠️ Ты уже в паре! Используй /status чтобы проверить питомца.');
    return;
  }

  const code = generateCode();
  pairs[code] = {
    users: [userId],
    petType: 'grimm',
    petLevel: 0,
    streakDays: 0,
    growthPoints: 0,
    lastFed: {},
    createdAt: getTodayDate()
  };
  userToPair[userId] = code;

  bot.sendMessage(msg.chat.id,
    `✅ Пара создана!\n\n🔑 Твой код: **${code}**\n\nОтправь этот код другу, чтобы он присоединился командой:\n/join ${code}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/join (.+)/, (msg, match) => {
  const userId = msg.from.id.toString();
  const code = match[1].trim().toUpperCase();

  if (userToPair[userId]) {
    bot.sendMessage(msg.chat.id, '⚠️ Ты уже в паре!');
    return;
  }

  if (!pairs[code]) {
    bot.sendMessage(msg.chat.id, '❌ Код не найден. Проверь и попробуй снова.');
    return;
  }

  if (pairs[code].users.length >= 2) {
    bot.sendMessage(msg.chat.id, '❌ В этой паре уже 2 человека.');
    return;
  }

  pairs[code].users.push(userId);
  userToPair[userId] = code;

  bot.sendMessage(msg.chat.id,
    '✅ Ты присоединился к паре! 🐾\n\nТеперь вы оба можете кормить питомца каждый день.\nИспользуй /pet чтобы открыть приложение.'
  );

  // Уведомляем первого участника
  const firstUser = pairs[code].users[0];
  bot.sendMessage(firstUser, '🎉 Твой друг присоединился к паре! Теперь вы можете вместе растить питомца.');
});

bot.onText(/\/status/, (msg) => {
  const userId = msg.from.id.toString();
  const code = userToPair[userId];

  if (!code || !pairs[code]) {
    bot.sendMessage(msg.chat.id, '❌ Ты пока не в паре. Используй /create или /join');
    return;
  }

  const pair = pairs[code];
  const stage = getPetStage(pair.growthPoints);

  bot.sendMessage(msg.chat.id,
    `${stage.emoji} **${stage.name}**\n\n` +
    `🔥 Серия: ${pair.streakDays} дней\n` +
    `⭐ Очки роста: ${pair.growthPoints}\n` +
    `👥 Участников: ${pair.users.length}/2`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/pet/, (msg) => {
  bot.sendMessage(msg.chat.id, '🐾 Нажми кнопку ниже, чтобы открыть Chumi:', {
    reply_markup: {
      inline_keyboard: [[
        { text: '🐾 Открыть Chumi', web_app: { url: process.env.WEBAPP_URL || 'https://chumi-app.vercel.app' } }
      ]]
    }
  });
});

// --- API для Mini App ---

// Получить данные пары по userId
app.get('/api/pair/:userId', (req, res) => {
  const userId = req.params.userId;
  const code = userToPair[userId];

  if (!code || !pairs[code]) {
    return res.json({ success: false, message: 'Пара не найдена' });
  }

  const pair = pairs[code];
  const stage = getPetStage(pair.growthPoints);

  res.json({
    success: true,
    pair: {
      code,
      petType: pair.petType,
      streakDays: pair.streakDays,
      growthPoints: pair.growthPoints,
      stage: stage,
      users: pair.users,
      lastFed: pair.lastFed
    }
  });
});

// Покормить питомца
app.post('/api/feed', (req, res) => {
  const { userId } = req.body;
  const code = userToPair[userId];

  if (!code || !pairs[code]) {
    return res.json({ success: false, message: 'Пара не найдена' });
  }

  const pair = pairs[code];
  const today = getTodayDate();

  // Проверяем, кормил ли уже сегодня
  if (pair.lastFed[userId] === today) {
    return res.json({ success: false, message: 'Ты уже покормил сегодня! Приходи завтра 🌙' });
  }

  // Записываем кормление
  pair.lastFed[userId] = today;

  // Проверяем, оба ли покормили сегодня
  const allFedToday = pair.users.length === 2 &&
    pair.users.every(u => pair.lastFed[u] === today);

  let evolved = false;

  if (allFedToday) {
    // Проверяем серию
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (pair.lastStreakDate === yesterdayStr || pair.streakDays === 0) {
      pair.streakDays += 1;
    } else if (pair.lastStreakDate !== today) {
      pair.streakDays = 1; // серия прервалась
    }

    pair.lastStreakDate = today;
    const oldStage = getPetStage(pair.growthPoints);
    pair.growthPoints += 10 + pair.streakDays * 2;
    const newStage = getPetStage(pair.growthPoints);

    if (oldStage.name !== newStage.name) {
      evolved = true;
    }
  }

  const stage = getPetStage(pair.growthPoints);

  res.json({
    success: true,
    fed: true,
    allFedToday,
    evolved,
    pair: {
      streakDays: pair.streakDays,
      growthPoints: pair.growthPoints,
      stage: stage,
      lastFed: pair.lastFed
    }
  });
});

// --- Запуск сервера ---
// --- Тестовый маршрут для создания пары ---
app.get('/api/test-create', (req, res) => {
  const code = generateCode();
  pairs[code] = {
    users: ['test_user_123', 'test_user_456'],
    petType: 'grimm',
    petLevel: 0,
    streakDays: 0,
    growthPoints: 0,
    lastFed: {},
    createdAt: getTodayDate()
  };
  userToPair['test_user_123'] = code;
  userToPair['test_user_456'] = code;
  res.json({ success: true, code });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Chumi сервер запущен на порту ${PORT}`);
});
