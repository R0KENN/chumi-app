import { createClient } from '@supabase/supabase-js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

async function sendMessage(env, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
}

const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;
const WEBAPP_URL = 'https://chumi-app.pages.dev';

// ── 🔥 Custom emoji ID ──
// Чтобы найти свой: отправь кастомный эмоджи огонька боту @sticker → он вернёт custom_emoji_id
// Или вызови Bot API: getCustomEmojiStickers с нужным ID
// Стандартный animated fire: 5368324170671202286
const FIRE_EMOJI_ID = '5368324170671202286';

const LEVELS = [
  { name: 'Spark', emoji: '✨', maxPoints: 30 },
  { name: 'Flame', emoji: '🔥', maxPoints: 70 },
  { name: 'Blaze', emoji: '🔥', maxPoints: 50 },
  { name: 'Fire', emoji: '🔥', maxPoints: 150 },
  { name: 'Inferno', emoji: '👑', maxPoints: 200 },
];

const PET_NAMES = ['Spark', 'Flame', 'Blaze', 'Fire', 'Inferno'];

function getLevel(totalPoints) {
  let accumulated = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalPoints < accumulated + LEVELS[i].maxPoints) {
      return { ...LEVELS[i], level: i };
    }
    accumulated += LEVELS[i].maxPoints;
  }
  return { ...LEVELS[LEVELS.length - 1], level: LEVELS.length - 1 };
}

async function getMaxPairs(supabase, userId) {
  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .single();
  return MAX_PAIRS_BASE + (data?.extra_slots || 0);
}

// ─── Кнопка "Открыть Chumi" — цветная с кастомным эмоджи ───
const webAppButton = {
  reply_markup: JSON.stringify({
    inline_keyboard: [[{
      text: '🔥 Открыть Chumi',
      web_app: { url: WEBAPP_URL },
      style: 'primary',
      icon_custom_emoji_id: FIRE_EMOJI_ID,
    }]],
  }),
};

// ─── Кнопка после создания пары — "Открыть" + "Пригласить" ───
function inviteButton(code, botUsername = 'chumi_pet_bot') {
  const inviteUrl = `https://t.me/${botUsername}?start=join_${code}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(`Присоединяйся к моей паре в Chumi! 🔥\nКод: ${code}`)}`;
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{
          text: '🔥 Открыть Chumi',
          web_app: { url: WEBAPP_URL },
          style: 'primary',
          icon_custom_emoji_id: FIRE_EMOJI_ID,
        }],
        [{
          text: '📨 Пригласить партнёра',
          url: shareUrl,
          style: 'secondary',
        }],
      ],
    }),
  };
}

const CUTE_MESSAGES = [
  "Ты моё солнышко ☀️",
  "Думаю о тебе 💭💕",
  "Ты делаешь мой день лучше 🌈",
  "Обнимаю тебя мысленно 🤗",
  "Ты самый лучший человек на свете 💖",
  "Скучаю по тебе 🥺",
  "Ты мой любимый человечек 💗",
  "Спасибо что ты есть 🙏💕",
  "Хочу обнять тебя прямо сейчас 🫂",
  "Ты заслуживаешь всего самого лучшего ✨",
  "Улыбнись, ты прекрасен(на) 😊",
  "Ты согреваешь моё сердце 💓",
  "Мне так повезло что ты у меня есть 🍀",
  "Посылаю тебе много любви 💌",
  "Ты мой самый близкий человек 🫶",
  "Каждый день с тобой — подарок 🎁",
  "Ты делаешь мир ярче 🌟",
  "Люблю твою улыбку 😄💕",
  "Ты — причина моего счастья 😍",
  "Давай проведём вечер вместе? 🌙",
  "Горжусь тобой! 🏆💕",
  "Ты невероятный человек 💎",
  "Хочу увидеть тебя поскорее 👀💗",
  "Наш огонёк растёт благодаря тебе 🔥",
  "Отправляю тебе виртуальный поцелуй 😘",
  "Ты мой лучший друг и любимый человек 💞",
  "Без тебя день не тот 🥹",
  "Ты заряжаешь меня энергией ⚡💕",
  "Давай никогда не теряем наш стрик! 🔥",
  "Ты — моя самая тёплая мысль 💭❤️",
];

export async function onRequestPost(context) {
  const { env, request } = context;
  const BOT_TOKEN = env.BOT_TOKEN;

  try {
    const update = await request.json();
    const supabase = getSupabase(env);

    // ═══ INLINE QUERY ═══
    if (update.inline_query) {
      const queryId = update.inline_query.id;
      const shuffled = [...CUTE_MESSAGES].sort(() => Math.random() - 0.5).slice(0, 10);
      const results = shuffled.map((text, i) => ({
        type: 'article',
        id: String(Date.now()) + '_' + i,
        title: text,
        description: 'Нажми чтобы отправить 💕',
        input_message_content: { message_text: text },
      }));
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerInlineQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inline_query_id: queryId, results, cache_time: 0, is_personal: true }),
      });
      return new Response('OK');
    }

    // ═══ PRE CHECKOUT ═══
    if (update.pre_checkout_query) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true }),
      });
      return new Response('OK');
    }

    // ═══ PAYMENT ═══
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const userId = String(update.message.from.id);
      const payload = JSON.parse(payment.invoice_payload);
      if (payload.productId === 'extra_slot') {
        const { data: existing } = await supabase.from('user_slots').select('extra_slots').eq('telegram_user_id', userId).single();
        if (existing) {
          await supabase.from('user_slots').update({ extra_slots: existing.extra_slots + 1 }).eq('telegram_user_id', userId);
        } else {
          await supabase.from('user_slots').insert({ telegram_user_id: userId, extra_slots: 1 });
        }
        await sendMessage(env, update.message.chat.id, '✅ *Слот куплен!*\nТеперь у тебя на 1 место для пары больше.', webAppButton);
      }
      return new Response('OK');
    }

    // ═══ MESSAGES ═══
    const message = update.message;
    if (!message || !message.text) return new Response('OK');

    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text.trim();
    const firstName = message.from.first_name || 'User';
    const username = message.from.username || null;

    // /start
    if (text === '/start' || text.startsWith('/start ')) {
      const startParam = text.split(' ')[1] || '';
      if (startParam.startsWith('join_')) {
        const joinCode = startParam.replace('join_', '').toUpperCase();
        const maxP = await getMaxPairs(supabase, userId);
        const { data: ex } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
        const isAdmin = ADMIN_IDS.includes(userId);
        if (!isAdmin && ex && ex.length >= maxP) { await sendMessage(env, chatId, `⚠️ У тебя уже ${ex.length} пар.`, webAppButton); return new Response('OK'); }
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', joinCode).single();
        if (!pair) { await sendMessage(env, chatId, `❌ Пара \`${joinCode}\` не найдена.`); return new Response('OK'); }
        const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', joinCode);
        if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, '✅ Ты уже в этой паре!', webAppButton); return new Response('OK'); }
        if (members && members.length >= 2) { await sendMessage(env, chatId, '⚠️ В паре уже 2 участника.'); return new Response('OK'); }
        await supabase.from('pair_users').insert({ pair_code: joinCode, user_id: userId, display_name: firstName, username });
        await sendMessage(env, chatId, `✅ *Ты присоединился к паре!*\nКод: \`${joinCode}\``, webAppButton);
        for (const m of members || []) {
          if (m.user_id !== userId) {
            await sendMessage(env, m.user_id, `🎉 *${firstName}* присоединился к паре \`${joinCode}\`!`, webAppButton);
          }
        }
        return new Response('OK');
      }
      await sendMessage(env, chatId,
        `Привет, ${firstName}! 🔥\n\n*Chumi* — растите огонёк вместе с другом!\n\n📝 Команды:\n/create — создать пару\n/join КОД — вступить в пару\n/mypairs — мои огоньки\n/status — подробный статус\n/help — справка`,
        webAppButton
      );
      return new Response('OK');
    }

    // /help
    if (text === '/help') {
      await sendMessage(env, chatId, `📖 *Команды:*\n\n/start — начать\n/create — создать пару\n/join КОД — вступить\n/mypairs — список\n/status — статус\n\n🔥 Выполняйте задания каждый день!`, webAppButton);
      return new Response('OK');
    }

    // /create — с кнопкой "Пригласить партнёра"
    if (text === '/create') {
      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);
      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) { await sendMessage(env, chatId, `⚠️ У тебя ${existing.length}/${maxPairs} пар.`, webAppButton); return new Response('OK'); }
      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'spark', streak_days: 0, growth_points: 0, hatched: false, bg_id: 'room', pet_name: null, streak_recoveries_used: 0, is_dead: false });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username });
      const botUser = env.BOT_USERNAME || 'chumi_pet_bot';
      await sendMessage(env, chatId, `✅ *Пара создана!*\n\nКод: \`${code}\`\n\nОтправь другу или нажми кнопку ниже:`, inviteButton(code, botUser));
      return new Response('OK');
    }

    // /join
    if (text.startsWith('/join')) {
      const code = text.split(' ')[1]?.trim()?.toUpperCase();
      if (!code) { await sendMessage(env, chatId, '⚠️ Укажи код: `/join ABCDEF`'); return new Response('OK'); }
      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);
      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) { await sendMessage(env, chatId, `⚠️ Лимит пар: ${maxPairs}.`, webAppButton); return new Response('OK'); }
      const { data: pair } = await supabase.from('pairs').select('*').eq('code', code).single();
      if (!pair) { await sendMessage(env, chatId, '❌ Пара не найдена.'); return new Response('OK'); }
      const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', code);
      if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, '✅ Ты уже в паре!', webAppButton); return new Response('OK'); }
      if (members && members.length >= 2) { await sendMessage(env, chatId, '⚠️ Пара заполнена.'); return new Response('OK'); }
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username });
      await sendMessage(env, chatId, `✅ *Ты в паре!* Код: \`${code}\``, webAppButton);
      for (const m of members || []) {
        if (m.user_id !== userId) {
          await sendMessage(env, m.user_id, `🎉 *${firstName}* присоединился к \`${code}\`!`, webAppButton);
        }
      }
      return new Response('OK');
    }

    // /mypairs
    if (text === '/mypairs') {
      const { data: userPairs } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!userPairs || userPairs.length === 0) { await sendMessage(env, chatId, '😔 Нет пар. Создай: /create'); return new Response('OK'); }
      let msg = '🔥 *Мои огоньки:*\n\n';
      for (const up of userPairs) {
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;
        const lv = getLevel(pair.growth_points || 0);
        const name = pair.pet_name || lv.name;
        msg += `${lv.emoji} *${name}* — ${lv.name}\n   Код: \`${pair.code}\` | ${pair.growth_points || 0} XP | 🔥 ${pair.streak_days || 0} дн.\n\n`;
      }
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /status
    if (text === '/status') {
      const { data: userPairs } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!userPairs || userPairs.length === 0) { await sendMessage(env, chatId, '😔 Нет пар.'); return new Response('OK'); }
      let msg = '📊 *Статус:*\n\n';
      for (const up of userPairs) {
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;
        const { data: members } = await supabase.from('pair_users').select('user_id, display_name').eq('pair_code', up.pair_code);
        const lv = getLevel(pair.growth_points || 0);
        const name = pair.pet_name || lv.name;
        const partner = members?.find(m => m.user_id !== userId);
        msg += `${lv.emoji} *${name}* (${lv.name})\n   Код: \`${pair.code}\`\n   🔥 Серия: ${pair.streak_days || 0} дн. | ⭐ ${pair.growth_points || 0} XP\n   👥 ${members?.length || 1}/2`;
        if (partner) msg += ` — с ${partner.display_name || 'партнёром'}`;
        msg += '\n';
        if (pair.is_dead) msg += '   💀 *Мёртв*\n';
        msg += '\n';
      }
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /paysupport
    if (text === '/paysupport') {
      await sendMessage(env, chatId, '🛟 По оплате: @R0KENN');
      return new Response('OK');
    }

  } catch (e) {
    console.error('Bot error:', e);
  }
  return new Response('OK');
}
