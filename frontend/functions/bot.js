import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra })
  });
}

const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;
const PET_STAGES = [
  { name: 'Egg', emoji: '🥚', minPoints: 0 },
  { name: 'Baby', emoji: '🐣', minPoints: 0 },
  { name: 'Teen', emoji: '🐥', minPoints: 200 },
  { name: 'Adult', emoji: '🐔', minPoints: 500 },
  { name: 'Legend', emoji: '👑', minPoints: 1000 }
];
const PET_NAMES = { muru: 'Muru', neco: 'Neco', pico: 'Pico', boba: 'Boba' };

function getStage(points, hatched) {
  if (!hatched) return PET_STAGES[0];
  for (let i = PET_STAGES.length - 1; i >= 1; i--) {
    if (points >= PET_STAGES[i].minPoints) return PET_STAGES[i];
  }
  return PET_STAGES[1];
}

const WEBAPP_URL = 'https://chumi-app.pages.dev';

async function getMaxPairs(supabase, userId) {
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .single();
  const extra = data?.extra_slots || 0;
  return MAX_PAIRS_BASE + extra;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const update = await request.json();
    const supabase = getSupabase(env);

    // ─── Handle pre_checkout_query (Stars payments) ───
    if (update.pre_checkout_query) {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true
        })
      });
      return new Response('OK');
    }

    // ─── Handle successful_payment ───
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const userId = String(update.message.from.id);
      const payload = JSON.parse(payment.invoice_payload);

      await supabase.from('payments').insert({
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
        user_id: userId,
        product_id: payload.productId,
        stars_paid: payment.total_amount,
        status: 'completed'
      });

      if (payload.productId === 'extra_slot') {
        const { data: existing } = await supabase
          .from('user_slots')
          .select('extra_slots')
          .eq('telegram_user_id', userId)
          .single();

        if (existing) {
          await supabase
            .from('user_slots')
            .update({ extra_slots: existing.extra_slots + 1 })
            .eq('telegram_user_id', userId);
        } else {
          await supabase.from('user_slots').insert({
            telegram_user_id: userId,
            extra_slots: 1
          });
        }

        await sendMessage(env, update.message.chat.id,
          '✅ *Слот куплен!*\n\nТеперь у тебя на 1 место для пары больше.',
          {
            reply_markup: JSON.stringify({
              inline_keyboard: [[{
                text: '🐾 Открыть Chumi',
                web_app: { url: WEBAPP_URL }
              }]]
            })
          }
        );
      }
      return new Response('OK');
    }

    // ─── Regular messages / commands ───
    const message = update.message;
    if (!message || !message.text) return new Response('OK');

    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text.trim();
    const firstName = message.from.first_name || 'User';

    const webAppButton = {
      reply_markup: JSON.stringify({
        inline_keyboard: [[{
          text: '🐾 Открыть Chumi',
          web_app: { url: WEBAPP_URL }
        }]]
      })
    };

    // /start
if (text === '/start' || text.startsWith('/start ')) {
  const startParam = text.split(' ')[1] || '';

  // Handle invite deeplink: /start join_ABCDEF
  if (startParam.startsWith('join_')) {
    const joinCode = startParam.replace('join_', '').toUpperCase();
    // Auto-join logic
    const maxP = await getMaxPairs(supabase, userId);
    const { data: ex } = await supabase.from('pair_users').select('pair_code').eq('telegram_user_id', userId);
    const isAdmin = ADMIN_IDS.includes(userId);

    if (!isAdmin && ex && ex.length >= maxP) {
      await sendMessage(env, chatId, `⚠️ У тебя уже ${ex.length} пар. Купи слот в приложении.`, webAppButton);
      return new Response('OK');
    }

    const { data: pair } = await supabase.from('pairs').select('*').eq('code', joinCode).single();
    if (!pair) {
      await sendMessage(env, chatId, `❌ Пара \`${joinCode}\` не найдена.`);
      return new Response('OK');
    }

    const { data: members } = await supabase.from('pair_users').select('telegram_user_id').eq('pair_code', joinCode);
    if (members?.some(m => m.telegram_user_id === userId)) {
      await sendMessage(env, chatId, `✅ Ты уже в этой паре!`, webAppButton);
      return new Response('OK');
    }
    if (members && members.length >= 2) {
      await sendMessage(env, chatId, '⚠️ В этой паре уже 2 участника.');
      return new Response('OK');
    }

    await supabase.from('pair_users').insert({
      pair_code: joinCode,
      telegram_user_id: userId,
      display_name: firstName
    });

    await sendMessage(env, chatId,
      `✅ *Ты присоединился к паре!*\nКод: \`${joinCode}\`\n\nОткрой приложение:`,
      webAppButton
    );

    for (const m of members || []) {
      if (m.telegram_user_id !== userId) {
        await sendMessage(env, m.telegram_user_id, `🎉 *${firstName}* присоединился к паре \`${joinCode}\`!`, webAppButton);
      }
    }
    return new Response('OK');
  }

  // Normal /start
  await sendMessage(env, chatId,
    `Привет, ${firstName}! 🐾\n\n...`, // (as above)
    webAppButton
  );
  return new Response('OK');
}


    // /help
    if (text === '/help') {
      await sendMessage(env, chatId,
        `📖 *Команды Chumi:*\n\n` +
        `/start — начать\n` +
        `/create — создать новую пару\n` +
        `/join КОД — присоединиться к паре\n` +
        `/mypairs — список твоих питомцев\n` +
        `/status — подробный статус всех пар\n` +
        `/help — эта справка\n\n` +
        `🌟 Покорми питомца в приложении каждый день!\n` +
        `Серия кормлений даёт бонусные очки роста.`,
        webAppButton
      );
      return new Response('OK');
    }

    // /create
    if (text === '/create') {
      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('telegram_user_id', userId);

      if (!isAdmin && existing && existing.length >= maxPairs) {
        await sendMessage(env, chatId,
          `⚠️ У тебя уже ${existing.length} из ${maxPairs} пар.\n\n` +
          `Купи дополнительный слот в приложении (50 ⭐) или удали одну из пар.`,
          webAppButton
        );
        return new Response('OK');
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
        display_name: firstName
      });

      await sendMessage(env, chatId,
        `✅ *Пара создана!*\n\nКод: \`${code}\`\n\n` +
        `Отправь этот код другу, чтобы он присоединился командой:\n` +
        `/join ${code}`,
        webAppButton
      );
      return new Response('OK');
    }

    // /join CODE
    if (text.startsWith('/join')) {
      const code = text.split(' ')[1]?.trim()?.toUpperCase();
      if (!code) {
        await sendMessage(env, chatId, '⚠️ Укажи код: `/join ABCDEF`');
        return new Response('OK');
      }

      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);

      const { data: existing } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('telegram_user_id', userId);

      if (!isAdmin && existing && existing.length >= maxPairs) {
        await sendMessage(env, chatId,
          `⚠️ У тебя уже ${existing.length} из ${maxPairs} пар. Купи слот или удали пару.`,
          webAppButton
        );
        return new Response('OK');
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', code)
        .single();

      if (!pair) {
        await sendMessage(env, chatId, '❌ Пара с таким кодом не найдена.');
        return new Response('OK');
      }

      const { data: members } = await supabase
        .from('pair_users')
        .select('telegram_user_id')
        .eq('pair_code', code);

      if (members?.some(m => m.telegram_user_id === userId)) {
        await sendMessage(env, chatId, '⚠️ Ты уже в этой паре!');
        return new Response('OK');
      }

      if (members && members.length >= 2) {
        await sendMessage(env, chatId, '⚠️ В этой паре уже 2 участника.');
        return new Response('OK');
      }

      await supabase.from('pair_users').insert({
        pair_code: code,
        telegram_user_id: userId,
        display_name: firstName
      });

      await sendMessage(env, chatId,
        `✅ *Ты присоединился к паре!*\nКод: \`${code}\``,
        webAppButton
      );

      // Notify partner
      for (const m of members || []) {
        if (m.telegram_user_id !== userId) {
          await sendMessage(env, m.telegram_user_id,
            `🎉 *${firstName}* присоединился к паре \`${code}\`!`,
            webAppButton
          );
        }
      }
      return new Response('OK');
    }

    // /mypairs
    if (text === '/mypairs') {
      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('telegram_user_id', userId);

      if (!userPairs || userPairs.length === 0) {
        await sendMessage(env, chatId, '😔 У тебя пока нет пар.\nСоздай: /create');
        return new Response('OK');
      }

      let msg = '🐾 *Мои питомцы:*\n\n';
      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs')
          .select('*')
          .eq('code', up.pair_code)
          .single();
        if (!pair) continue;
        const stage = getStage(pair.growth_points, pair.hatched);
        const name = pair.pet_name || (pair.hatched ? PET_NAMES[pair.pet_type] || pair.pet_type : 'Яйцо');
        msg += `${stage.emoji} *${name}* — ${stage.name}\n`;
        msg += `   Код: \`${pair.code}\` | ${pair.growth_points} XP\n\n`;
      }

      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /status
    if (text === '/status') {
      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('telegram_user_id', userId);

      if (!userPairs || userPairs.length === 0) {
        await sendMessage(env, chatId, '😔 У тебя нет пар.');
        return new Response('OK');
      }

      let msg = '📊 *Статус:*\n\n';
      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs')
          .select('*')
          .eq('code', up.pair_code)
          .single();
        if (!pair) continue;

        const { data: members } = await supabase
          .from('pair_users')
          .select('telegram_user_id, display_name')
          .eq('pair_code', up.pair_code);

        const stage = getStage(pair.growth_points, pair.hatched);
        const name = pair.pet_name || (pair.hatched ? PET_NAMES[pair.pet_type] || pair.pet_type : 'Яйцо');
        const partner = members?.find(m => m.telegram_user_id !== userId);

        msg += `${stage.emoji} *${name}* (${stage.name})\n`;
        msg += `   Код: \`${pair.code}\`\n`;
        msg += `   🔥 Серия: ${pair.streak_days} дн. | ⭐ ${pair.growth_points} XP\n`;
        msg += `   👥 ${members?.length || 1}/2`;
        if (partner) msg += ` — с ${partner.display_name || 'партнёром'}`;
        msg += `\n`;
        if (pair.is_dead) msg += `   💀 *Питомец умер*\n`;
        msg += `\n`;
      }

      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /paysupport (mandatory for Stars)
    if (text === '/paysupport') {
      await sendMessage(env, chatId,
        '🛟 По вопросам оплаты обратитесь: @YOUR_SUPPORT_USERNAME'
      );
      return new Response('OK');
    }

  } catch (e) {
    console.error('Bot error:', e);
  }
  return new Response('OK');
}
