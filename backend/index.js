// Подключаем библиотеки
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const { nanoid } = require('nanoid');

// Загружаем настройки из .env
dotenv.config();

// Создаём клиент Supabase (администраторский, для бота)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Клиент для API (с ограниченными правами)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Создаём бота Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Создаём веб-сервер Express
const app = express();
const PORT = process.env.PORT || 3001;

// Настраиваем CORS и возможность принимать JSON
app.use(cors());
app.use(express.json());

// ---------- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЕМ ----------
async function getOrCreateUser(telegramId, username, firstName) {
  // Ищем пользователя в базе по telegram_id
  const { data: existingUser, error: selectError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existingUser) return existingUser;

  // Если не нашли — создаём нового
  const { data: newUser, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      telegram_id: telegramId,
      username,
      first_name: firstName,
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return newUser;
}

// ---------- API ДЛЯ MINI APP (ФРОНТЕНД БУДЕТ СЮДА ОБРАЩАТЬСЯ) ----------

// Получить данные о паре для пользователя
app.post('/api/pair', async (req, res) => {
  try {
    const { userId } = req.body; // userId — это telegram_id (число)

    // Находим внутренний ID пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single();

    if (userError || !user) {
      return res.json({ pair: null });
    }

    // Получаем первую пару, в которой состоит пользователь
    const { data: userPairs, error: pairsError } = await supabase
      .from('user_pairs')
      .select('pair_id, pairs(*)')
      .eq('user_id', user.id)
      .limit(1);

    if (pairsError) throw pairsError;

    if (userPairs.length === 0) {
      return res.json({ pair: null });
    }

    const pairData = userPairs[0].pairs;
    res.json({ pair: pairData });
  } catch (error) {
    console.error('/api/pair error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Покормить питомца
app.post('/api/feed', async (req, res) => {
  try {
    const { userId, pairId } = req.body;

    // Проверяем, что пользователь существует
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single();
    if (userError || !user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Проверяем, состоит ли он в паре
    const { data: membership, error: membershipError } = await supabase
      .from('user_pairs')
      .select('*')
      .eq('user_id', user.id)
      .eq('pair_id', pairId)
      .single();
    if (membershipError || !membership) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: existingFeed } = await supabase
      .from('feed_history')
      .select('*')
      .eq('pair_id', pairId)
      .eq('user_id', user.id)
      .eq('fed_at', today)
      .maybeSingle();

    if (existingFeed) {
      return res.json({ success: false, message: 'Сегодня уже кормили' });
    }

    // Добавляем запись о кормлении
    await supabase
      .from('feed_history')
      .insert({ pair_id: pairId, user_id: user.id, fed_at: today });

    // Получаем текущие очки и уровень
    const { data: pair, error: pairError } = await supabase
      .from('pairs')
      .select('growth_points, pet_level')
      .eq('id', pairId)
      .single();
    if (pairError) throw pairError;

    let newPoints = pair.growth_points + 10;
    let newLevel = pair.pet_level;
    if (newPoints >= 100) {
      newLevel += Math.floor(newPoints / 100);
      newPoints = newPoints % 100;
    }

    // Обновляем пару
    await supabase
      .from('pairs')
      .update({ growth_points: newPoints, pet_level: newLevel })
      .eq('id', pairId);

    res.json({
      success: true,
      newPoints,
      newLevel,
      message: `+10 очков роста!`
    });
  } catch (error) {
    console.error('/api/feed error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ---------- КОМАНДЫ БОТА ----------

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';

  try {
    await getOrCreateUser(telegramId, username, firstName);
    bot.sendMessage(chatId,
      '🐾 Привет! Я бот для ухода за питомцами.\n\n' +
      'Доступные команды:\n' +
      '/create — создать новую пару\n' +
      '/join <код> — присоединиться к существующей паре\n' +
      '/mypairs — показать мои пары\n'
    );
  } catch (error) {
    console.error('/start error:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
  }
});

bot.onText(/\/create/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const user = await getOrCreateUser(
      telegramId,
      msg.from.username,
      msg.from.first_name
    );

    const code = nanoid(8);

    const { data: newPair, error: pairError } = await supabaseAdmin
      .from('pairs')
      .insert({
        code,
        pet_type: 'cat',
        pet_level: 0,
        streak_days: 0,
        growth_points: 0,
      })
      .select()
      .single();

    if (pairError) throw pairError;

    const { error: linkError } = await supabaseAdmin
      .from('user_pairs')
      .insert({
        user_id: user.id,
        pair_id: newPair.id,
        role: 'owner',
      });

    if (linkError) throw linkError;

    bot.sendMessage(
      chatId,
      `✅ Новая пара создана! Код для приглашения: \`${code}\`\n\n` +
      `Друг может присоединиться командой /join ${code}`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('/create error:', error);
    bot.sendMessage(chatId, '❌ Ошибка при создании пары.');
  }
});

bot.onText(/\/join (\w+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const code = match[1];

  try {
    const user = await getOrCreateUser(
      telegramId,
      msg.from.username,
      msg.from.first_name
    );

    const { data: pair, error: pairError } = await supabaseAdmin
      .from('pairs')
      .select('*')
      .eq('code', code)
      .single();

    if (pairError || !pair) {
      return bot.sendMessage(chatId, '❌ Пара с таким кодом не найдена.');
    }

    const { data: existingLink } = await supabaseAdmin
      .from('user_pairs')
      .select('*')
      .eq('user_id', user.id)
      .eq('pair_id', pair.id)
      .maybeSingle();

    if (existingLink) {
      return bot.sendMessage(chatId, 'ℹ️ Вы уже состоите в этой паре.');
    }

    await supabaseAdmin
      .from('user_pairs')
      .insert({
        user_id: user.id,
        pair_id: pair.id,
        role: 'member',
      });

    bot.sendMessage(chatId, `🎉 Вы присоединились к паре!`);
  } catch (error) {
    console.error('/join error:', error);
    bot.sendMessage(chatId, '❌ Ошибка при присоединении.');
  }
});

bot.onText(/\/mypairs/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const user = await getOrCreateUser(
      telegramId,
      msg.from.username,
      msg.from.first_name
    );

    const { data: pairs, error } = await supabaseAdmin
      .from('user_pairs')
      .select('pairs(*)')
      .eq('user_id', user.id);

    if (error) throw error;

    if (pairs.length === 0) {
      return bot.sendMessage(chatId, 'У вас пока нет пар. Создайте новую: /create');
    }

    let message = '📋 Ваши пары:\n';
    pairs.forEach((item, index) => {
      const p = item.pairs;
      message += `${index + 1}. ${p.pet_type} (ур. ${p.pet_level}) — код ${p.code}\n`;
    });
    bot.sendMessage(chatId, message);
  } catch (error) {
    console.error('/mypairs error:', error);
    bot.sendMessage(chatId, '❌ Ошибка при получении списка пар.');
  }
});

// Создание новой пары
app.post('/api/pair/create', async (req, res) => {
  try {
    const { userId, petType } = req.body;

    // Находим пользователя
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const code = nanoid(8);

    const { data: newPair, error: pairError } = await supabaseAdmin
      .from('pairs')
      .insert({
        code,
        pet_type: petType || 'cat',
        pet_level: 0,
        streak_days: 0,
        growth_points: 0,
      })
      .select()
      .single();

    if (pairError) throw pairError;

    // Связываем пользователя как владельца
    const { error: linkError } = await supabaseAdmin
      .from('user_pairs')
      .insert({
        user_id: user.id,
        pair_id: newPair.id,
        role: 'owner',
      });

    if (linkError) throw linkError;

    res.json({ pair: newPair });
  } catch (error) {
    console.error('/api/pair/create error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Запускаем сервер
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});