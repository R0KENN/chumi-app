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

const ADMIN_IDS = [713156118];
const MAX_PAIRS = 2;

const PET_STAGES = [
  { name: 'Egg', emoji: '🥚', minPoints: 0 },
  { name: 'Baby', emoji: '🐣', minPoints: 0 },
  { name: 'Teen', emoji: '🐲', minPoints: 200 },
  { name: 'Adult', emoji: '🔥', minPoints: 500 },
  { name: 'Legend', emoji: '👑', minPoints: 1000 },
];

function getStage(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  let stage = PET_STAGES[1];
  for (let i = 2; i < PET_STAGES.length; i++) {
    if (points >= PET_STAGES[i].minPoints) stage = PET_STAGES[i];
  }
  return stage;
}

const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba', egg: 'Egg' };

export async function onRequestPost(context) {
  const { request, env } = context;
  const supabase = getSupabase(env);
  const WEBAPP_URL = env.WEBAPP_URL || 'https://chumi-app.pages.dev';

  try {
    const body = await request.json();
    const message = body.message;

    if (!message || !message.text) return new Response('OK');

    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text.trim();
    const isAdmin = ADMIN_IDS.includes(userId);

    if (text === '/start') {
      await sendMessage(env, chatId,
        '🐾 *Chumi* — raise a pet together!\n\n' +
        '🥚 Create a pair, feed your pet for 3 days — and it hatches!\n\n' +
        'Commands:\n' +
        '/create — create a new pair\n' +
        '/join CODE — join a pair\n' +
        '/status — check your pets\n' +
        '/mypairs — list all your pairs',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Open Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );
    }

    else if (text === '/create') {
      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!isAdmin && existing && existing.length >= MAX_PAIRS) {
        await sendMessage(env, chatId, `⚠️ Max ${MAX_PAIRS} pairs allowed! Use /mypairs to see them.`);
        return new Response('OK');
      }

      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'egg', hatched: false, streak_days: 0, growth_points: 0 });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(env, chatId,
        `✅ Pair created!\n\n🔑 Code: *${code}*\n\nSend this to a friend:\n/join ${code}`
      );
    }

    else if (text.startsWith('/join')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await sendMessage(env, chatId, '❌ Provide a code! Example: /join ABC123');
        return new Response('OK');
      }

      const code = parts[1].trim().toUpperCase();

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!isAdmin && existing && existing.length >= MAX_PAIRS) {
        await sendMessage(env, chatId, `⚠️ Max ${MAX_PAIRS} pairs allowed!`);
        return new Response('OK');
      }

      // Проверяем что не уже в этой паре
      if (existing?.find(e => e.pair_code === code)) {
        await sendMessage(env, chatId, '⚠️ You are already in this pair!');
        return new Response('OK');
      }

      const { data: pair } = await supabase
        .from('pairs').select('code').eq('code', code).single();

      if (!pair) {
        await sendMessage(env, chatId, '❌ Code not found.');
        return new Response('OK');
      }

      const { data: pairUsers } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      if (pairUsers.length >= 2) {
        await sendMessage(env, chatId, '❌ This pair is full (2/2).');
        return new Response('OK');
      }

      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId });

      await sendMessage(env, chatId,
        '✅ Joined the pair! 🐾\n\nFeed your pet together for 3 days to hatch it!',
        {
          reply_markup: JSON.stringify({
            inline_keyboard: [[{ text: '🐾 Open Chumi', web_app: { url: WEBAPP_URL } }]],
          }),
        }
      );

      const partner = pairUsers[0]?.user_id;
      if (partner) {
        await sendMessage(env, partner,
          '🎉 Your friend joined the pair! Start feeding together.',
          {
            reply_markup: JSON.stringify({
              inline_keyboard: [[{ text: '🐾 Open Chumi', web_app: { url: WEBAPP_URL } }]],
            }),
          }
        );
      }
    }

    else if (text === '/mypairs') {
      const { data: pairLinks } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!pairLinks || pairLinks.length === 0) {
        await sendMessage(env, chatId, '❌ No pairs yet. Use /create or /join');
        return new Response('OK');
      }

      const codes = pairLinks.map(p => p.pair_code);
      const { data: pairs } = await supabase
        .from('pairs').select('*').in('code', codes);

      let msg = '🐾 *Your pairs:*\n\n';
      pairs.forEach((p, i) => {
        const stage = getStage(p.growth_points || 0, p.hatched);
        const name = PET_NAMES[p.pet_type] || p.pet_type;
        msg += `${i + 1}. ${stage.emoji} *${name}* — ${stage.name}\n   Code: \`${p.code}\` | ⭐ ${p.growth_points || 0}\n\n`;
      });

      await sendMessage(env, chatId, msg);
    }

    else if (text === '/status') {
      const { data: pairLinks } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);

      if (!pairLinks || pairLinks.length === 0) {
        await sendMessage(env, chatId, '❌ No pairs yet. Use /create or /join');
        return new Response('OK');
      }

      const codes = pairLinks.map(p => p.pair_code);
      const { data: pairs } = await supabase
        .from('pairs').select('*').in('code', codes);

      for (const pair of pairs) {
        const { data: users } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', pair.code);

        const hatched = pair.hatched || false;
        const stage = getStage(pair.growth_points || 0, hatched);
        const petName = PET_NAMES[pair.pet_type] || pair.pet_type;

        let statusText;
        if (!hatched) {
          const daysLeft = Math.max(0, 3 - (pair.streak_days || 0));
          statusText = `🥚 *Egg* (${pair.code})\n🔥 Streak: ${pair.streak_days || 0} days\n⏳ Hatches in: ${daysLeft} days\n👥 ${users.length}/2`;
        } else {
          statusText = `${stage.emoji} *${petName}* — ${stage.name} (${pair.code})\n🔥 Streak: ${pair.streak_days || 0} days\n⭐ Points: ${pair.growth_points || 0}\n👥 ${users.length}/2`;
        }
        await sendMessage(env, chatId, statusText);
      }
    }

  } catch (error) {
    console.log('Bot error:', error);
  }

  return new Response('OK');
}
