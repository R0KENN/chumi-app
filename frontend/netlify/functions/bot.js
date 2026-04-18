const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function sendMessage(chatId, text, extra = {}) {
  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  const supabase = getSupabase();
  const WEBAPP_URL = process.env.WEBAPP_URL || 'https://astounding-faun-f4f6ae.netlify.app';

  try {
    const body = JSON.parse(event.body);
    const message = body.message;

    if (!message || !message.text) {
      return { statusCode: 200, body: 'OK' };
    }

    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text.trim();

    // --- /start ---
    if (text === '/start') {
      await sendMessage(chatId,
        '🐾 Привет! Я *Chumi* — бот для выращивания питомца!\n\n' +
        'Команды:\n' +
        '/create — создать пару и получить код\n' +
        '/join КОДИК — присоединиться к паре\n' +
        '/status — посмотреть питомца',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[
              { text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }
            ]]
          })
        }
      );
    }

    // --- /create ---
    else if (text === '/create') {
      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (existing) {
        await sendMessage(chatId, '⚠️ Ты уже в паре! Используй /status чтобы проверить питомца.');
        return { statusCode: 200, body: 'OK' };
      }

      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'grimm' });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(chatId,
        `✅ Пара создана!\n\n🔑 Твой код: *${code}*\n\nОтправь этот код другу, чтобы он присоединился командой:\n/join ${code}`
      );
    }

    // --- /join CODE ---
    else if (text.startsWith('/join')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sendMessage(chatId, '❌ Укажи код! Пример: /join ABC123');
        return { statusCode: 200, body: 'OK' };
      }

      const code = parts[1].trim().toUpperCase();

      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (existing) {
        await sendMessage(chatId, '⚠️ Ты уже в паре!');
        return { statusCode: 200, body: 'OK' };
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('code')
        .eq('code', code)
        .single();

      if (!pair) {
        await sendMessage(chatId, '❌ Код не найден. Проверь и попробуй снова.');
        return { statusCode: 200, body: 'OK' };
      }

      const { data: pairUsers } = await supabase
        .from('pair_users')
        .select('user_id')
        .eq('pair_code', code);

      if (pairUsers.length >= 2) {
        await sendMessage(chatId, '❌ В этой паре уже 2 человека.');
        return { statusCode: 200, body: 'OK' };
      }

      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(chatId,
        '✅ Ты присоединился к паре! 🐾\n\nТеперь вы оба можете кормить питомца каждый день.',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[
              { text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }
            ]]
          })
        }
      );

      const firstUser = pairUsers[0].user_id;
      await sendMessage(firstUser, '🎉 Твой друг присоединился к паре! Теперь вы можете вместе растить питомца.',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[
              { text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } }
            ]]
          })
        }
      );
    }

    // --- /status ---
    else if (text === '/status') {
      const { data: pairUser } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId)
        .single();

      if (!pairUser) {
        await sendMessage(chatId, '❌ Ты пока не в паре. Используй /create или /join');
        return { statusCode: 200, body: 'OK' };
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', pairUser.pair_code)
        .single();

      const { data: users } = await supabase
        .from('pair_users')
        .select('user_id')
        .eq('pair_code', pairUser.pair_code);

      const PET_STAGES = [
        { name: 'Яйцо', emoji: '🥚', minPoints: 0 },
        { name: 'Малыш', emoji: '🐣', minPoints: 50 },
        { name: 'Подросток', emoji: '🐲', minPoints: 200 },
        { name: 'Взрослый', emoji: '🔥', minPoints: 500 },
        { name: 'Легенда', emoji: '👑', minPoints: 1000 },
      ];

      let stage = PET_STAGES[0];
      for (const s of PET_STAGES) {
        if (pair.growth_points >= s.minPoints) stage = s;
      }

      await sendMessage(chatId,
        `${stage.emoji} *${stage.name}*\n\n🔥 Серия: ${pair.streak_days} дней\n⭐ Очки роста: ${pair.growth_points}\n👥 Участников: ${users.length}/2`
      );
    }

  } catch (error) {
    console.log('Bot error:', error);
  }

  return { statusCode: 200, body: 'OK' };
};
