import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
}

const PET_STAGES = [
  { name: 'Яйцо', emoji: '🥚', minPoints: 0 },
  { name: 'Малыш', emoji: '🐣', minPoints: 0 },
  { name: 'Подросток', emoji: '🐲', minPoints: 200 },
  { name: 'Взрослый', emoji: '🔥', minPoints: 500 },
  { name: 'Легенда', emoji: '👑', minPoints: 1000 },
];

function getStage(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  let stage = PET_STAGES[1];
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points >= PET_STAGES[i].minPoints) stage = PET_STAGES[i];
  }
  return stage;
}

const PET_NAMES = { muru: 'Муру', neco: 'Неко', pico: 'Пико', boba: 'Боба', egg: 'Яйцо' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const supabase = getSupabase(env);
  const WEBAPP_URL = env.WEBAPP_URL || 'https://chumi-app.pages.dev';

  try {
    const body = await request.json();
    const message = body.message;

    if (!message || !message.text) {
      return new Response('OK');
    }

    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text.trim();

    if (text === '/start') {
      await sendMessage(env, chatId,
        '🐾 Привет! Я *Chumi* — бот для выращивания питомца вместе с другом!\n\n' +
        '🥚 Создай пару, корми питомца 3 дня — и он вылупится!\n\n' +
        'Команды:\n' +
        '/create — создать пару и получить код\n' +
        '/join КОДИК — присоединиться к паре\n' +
        '/status — посмотреть питомца',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );
    }

    else if (text === '/create') {
      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId).single();

      if (existing) {
        await sendMessage(env, chatId, '⚠️ Ты уже в паре! Используй /status чтобы проверить питомца.');
        return new Response('OK');
      }

      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'egg', hatched: false });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(env, chatId,
        `✅ Пара создана!\n\n🔑 Твой код: *${code}*\n\nОтправь этот код другу, чтобы он присоединился командой:\n/join ${code}`
      );
    }

    else if (text.startsWith('/join')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sendMessage(env, chatId, '❌ Укажи код! Пример: /join ABC123');
        return new Response('OK');
      }

      const code = parts[1].trim().toUpperCase();

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId).single();

      if (existing) {
        await sendMessage(env, chatId, '⚠️ Ты уже в паре!');
        return new Response('OK');
      }

      const { data: pair } = await supabase
        .from('pairs').select('code').eq('code', code).single();

      if (!pair) {
        await sendMessage(env, chatId, '❌ Код не найден. Проверь и попробуй снова.');
        return new Response('OK');
      }

      const { data: pairUsers } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      if (pairUsers.length >= 2) {
        await sendMessage(env, chatId, '❌ В этой паре уже 2 человека.');
        return new Response('OK');
      }

      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(env, chatId,
        '✅ Ты присоединился к паре! 🐾\n\nТеперь кормите питомца 3 дня подряд — и он вылупится!',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );

      const firstUser = pairUsers[0].user_id;
      await sendMessage(env, firstUser,
        '🎉 Твой друг присоединился к паре! Теперь вы можете вместе растить питомца.',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );
    }

    else if (text === '/status') {
      const { data: pairUser } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId).single();

      if (!pairUser) {
        await sendMessage(env, chatId, '❌ Ты пока не в паре. Используй /create или /join');
        return new Response('OK');
      }

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', pairUser.pair_code).single();

      const { data: users } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', pairUser.pair_code);

      const hatched = pair.hatched || false;
      const stage = getStage(pair.growth_points, hatched);
      const petName = PET_NAMES[pair.pet_type] || pair.pet_type;

      let statusText;
      if (!hatched) {
        const daysLeft = Math.max(0, 3 - pair.streak_days);
        statusText =
          `🥚 *Яйцо*\n\n` +
          `🔥 Серия: ${pair.streak_days} дней\n` +
          `⏳ До вылупления: ${daysLeft} дн.\n` +
          `👥 Участников: ${users.length}/2`;
      } else {
        statusText =
          `${stage.emoji} *${petName}* — ${stage.name}\n\n` +
          `🔥 Серия: ${pair.streak_days} дней\n` +
          `⭐ Очки роста: ${pair.growth_points}\n` +
          `👥 Участников: ${users.length}/2`;
      }

      await sendMessage(env, chatId, statusText);
    }

    else if (text === '/remind') {
      const { data: pairUser } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId).single();

      if (!pairUser) {
        await sendMessage(env, chatId, '❌ Ты пока не в паре.');
        return new Response('OK');
      }

      const { data: users } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', pairUser.pair_code);

      const partner = users.find(u => u.user_id !== userId);
      if (!partner) {
        await sendMessage(env, chatId, '❌ У тебя пока нет напарника.');
        return new Response('OK');
      }

      await sendMessage(env, partner.user_id,
        '🔔 Твой напарник напоминает: не забудь покормить питомца сегодня! 🍖',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );

      await sendMessage(env, chatId, '✅ Напоминание отправлено!');
    }

  } catch (error) {
    console.log('Bot error:', error);
  }

  return new Response('OK');
}
