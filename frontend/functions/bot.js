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
const FIRE_EMOJI_ID = '5368324170671202286';

const LEVELS = [
  { name: 'Egg',    emoji: '🥚', maxPoints: 33 },
  { name: 'Baby',   emoji: '🐣', maxPoints: 45 },
  { name: 'Junior', emoji: '🐾', maxPoints: 63 },
  { name: 'Teen',   emoji: '💜', maxPoints: 90 },
  { name: 'Adult',  emoji: '💎', maxPoints: 135 },
  { name: 'Legend', emoji: '👑', maxPoints: 200 },
];

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

// ─── Получить язык пользователя из базы ───
async function getUserLang(supabase, userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('lang')
    .eq('telegram_user_id', userId)
    .single();
  return data?.lang || 'ru';
}

// ─── Сохранить язык пользователя в базу ───
async function setUserLang(supabase, userId, lang) {
  const { data: existing } = await supabase
    .from('user_settings')
    .select('telegram_user_id')
    .eq('telegram_user_id', userId)
    .single();

  if (existing) {
    await supabase
      .from('user_settings')
      .update({ lang, updated_at: new Date().toISOString() })
      .eq('telegram_user_id', userId);
  } else {
    await supabase
      .from('user_settings')
      .insert({ telegram_user_id: userId, lang });
  }
}

// ─── Определить язык из Telegram при первом запуске ───
function detectLangFromTelegram(from) {
  const code = from?.language_code || '';
  if (code.startsWith('ru') || code.startsWith('uk') || code.startsWith('be') || code.startsWith('kk')) {
    return 'ru';
  }
  return 'en';
}

// ─── Все тексты бота на двух языках ───
const T = {
  ru: {
    welcome: (name) => `Привет, ${name}! 🐾\n\n*Chumi* — растите питомца вместе с другом!\n\n📝 Команды:\n/create — создать пару\n/join КОД — вступить в пару\n/mypairs — мои питомцы\n/status — подробный статус\n/lang — сменить язык\n/help — справка`,
    help: `📖 *Команды:*\n\n/start — начать\n/create — создать пару\n/join КОД — вступить\n/mypairs — список\n/status — статус\n/lang — сменить язык\n\n🐾 Выполняйте задания каждый день!`,
    pairCreated: (code) => `✅ *Пара создана!*\n\nКод: \`${code}\`\n\nОтправь другу или нажми кнопку ниже:`,
    maxPairs: (count, max) => `⚠️ У тебя ${count}/${max} пар.`,
    joinNoCode: '⚠️ Укажи код: `/join ABCDEF`',
    pairNotFound: (code) => `❌ Пара \`${code}\` не найдена.`,
    alreadyInPair: '✅ Ты уже в этой паре!',
    pairFull: '⚠️ В паре уже 2 участника.',
    joined: (code) => `✅ *Ты в паре!* Код: \`${code}\``,
    partnerJoined: (name, code) => `🎉 *${name}* присоединился к паре \`${code}\`!`,
    noPairs: '😔 Нет пар. Создай: /create',
    myPairsTitle: '🐾 *Мои питомцы:*\n\n',
    statusTitle: '📊 *Статус:*\n\n',
    pairLine: (emoji, name, levelName, code, xp, streak) => `${emoji} *${name}* — ${levelName}\n   Код: \`${code}\` | ${xp} XP | 🔥 ${streak} дн.\n\n`,
    statusLine: (emoji, name, levelName, code, streak, xp, members, partnerName, isDead) => {
      let msg = `${emoji} *${name}* (${levelName})\n   Код: \`${code}\`\n   🔥 Серия: ${streak} дн. | ⭐ ${xp} XP\n   👥 ${members}/2`;
      if (partnerName) msg += ` — с ${partnerName}`;
      msg += '\n';
      if (isDead) msg += '   💀 *Мёртв*\n';
      return msg + '\n';
    },
    slotBought: '✅ *Слот куплен!*\nТеперь у тебя на 1 место для пары больше.',
    paySupport: '🛟 По оплате: @R0KENN',
    langChanged: '✅ Язык изменён на *Русский* 🇷🇺',
    langPrompt: '🌐 *Выбери язык / Choose language:*',
    inviteText: (code) => `Присоединяйся к моей паре в Chumi! 🐾\nКод: ${code}`,
    maxPairsLimit: (max) => `⚠️ Лимит пар: ${max}.`,
    joinedNotify: (name, code) => `🎉 *${name}* присоединился к \`${code}\`!`,
    pairDeleted: (code) => `😢 Пара \`${code}\` была удалена.`,
  },
  en: {
    welcome: (name) => `Hi, ${name}! 🐾\n\n*Chumi* — grow a pet together with a friend!\n\n📝 Commands:\n/create — create a pair\n/join CODE — join a pair\n/mypairs — my pets\n/status — detailed status\n/lang — change language\n/help — help`,
    help: `📖 *Commands:*\n\n/start — start\n/create — create a pair\n/join CODE — join\n/mypairs — list\n/status — status\n/lang — change language\n\n🐾 Complete tasks every day!`,
    pairCreated: (code) => `✅ *Pair created!*\n\nCode: \`${code}\`\n\nSend it to your friend or tap the button below:`,
    maxPairs: (count, max) => `⚠️ You have ${count}/${max} pairs.`,
    joinNoCode: '⚠️ Specify code: `/join ABCDEF`',
    pairNotFound: (code) => `❌ Pair \`${code}\` not found.`,
    alreadyInPair: '✅ You are already in this pair!',
    pairFull: '⚠️ Pair already has 2 members.',
    joined: (code) => `✅ *You joined!* Code: \`${code}\``,
    partnerJoined: (name, code) => `🎉 *${name}* joined pair \`${code}\`!`,
    noPairs: '😔 No pairs. Create one: /create',
    myPairsTitle: '🐾 *My pets:*\n\n',
    statusTitle: '📊 *Status:*\n\n',
    pairLine: (emoji, name, levelName, code, xp, streak) => `${emoji} *${name}* — ${levelName}\n   Code: \`${code}\` | ${xp} XP | 🔥 ${streak} days\n\n`,
    statusLine: (emoji, name, levelName, code, streak, xp, members, partnerName, isDead) => {
      let msg = `${emoji} *${name}* (${levelName})\n   Code: \`${code}\`\n   🔥 Streak: ${streak} days | ⭐ ${xp} XP\n   👥 ${members}/2`;
      if (partnerName) msg += ` — with ${partnerName}`;
      msg += '\n';
      if (isDead) msg += '   💀 *Dead*\n';
      return msg + '\n';
    },
    slotBought: '✅ *Slot purchased!*\nYou now have one more pair slot.',
    paySupport: '🛟 Payment support: @R0KENN',
    langChanged: '✅ Language changed to *English* 🇬🇧',
    langPrompt: '🌐 *Выбери язык / Choose language:*',
    inviteText: (code) => `Join my pair in Chumi! 🐾\nCode: ${code}`,
    maxPairsLimit: (max) => `⚠️ Pair limit: ${max}.`,
    joinedNotify: (name, code) => `🎉 *${name}* joined \`${code}\`!`,
    pairDeleted: (code) => `😢 Pair \`${code}\` has been deleted.`,
  },
};

const webAppButton = {
  reply_markup: JSON.stringify({
    inline_keyboard: [[{
      text: '🐾 Chumi',
      web_app: { url: WEBAPP_URL },
    }]],
  }),
};

function langButtons() {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: '🇷🇺 Русский', callback_data: 'set_lang_ru' }],
        [{ text: '🇬🇧 English', callback_data: 'set_lang_en' }],
      ],
    }),
  };
}

function inviteButton(code, lang, botUsername = 'ChumiPetBot') {
  const inviteUrl = `https://t.me/${botUsername}?start=join_${code}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(T[lang].inviteText(code))}`;
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{
text: '🐾 Chumi',
          web_app: { url: WEBAPP_URL },
        }],
        [{
          text: lang === 'ru' ? '📨 Пригласить партнёра' : '📨 Invite partner',
          url: shareUrl,
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
  "You are my sunshine ☀️",
  "Thinking of you 💭💕",
  "You make my day better 🌈",
  "Sending you a virtual hug 🤗",
  "You're the best person ever 💖",
  "I miss you 🥺",
  "Thank you for being you 🙏💕",
  "You deserve the best ✨",
  "You warm my heart 💓",
  "I'm so lucky to have you 🍀",
  "Sending lots of love 💌",
  "You are my closest person 🫶",
  "Our flame grows thanks to you 🔥",
  "Let's never lose our streak! 🔥",
];

export async function onRequestPost(context) {
  const { env, request } = context;
  const BOT_TOKEN = env.BOT_TOKEN;

  try {
    const update = await request.json();
    const supabase = getSupabase(env);

    // ═══ CALLBACK QUERY (кнопки смены языка) ═══
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbUserId = String(cb.from.id);
      const cbChatId = cb.message?.chat?.id;
      const cbData = cb.data;

      if (cbData === 'set_lang_ru' || cbData === 'set_lang_en') {
        const newLang = cbData === 'set_lang_ru' ? 'ru' : 'en';
        await setUserLang(supabase, cbUserId, newLang);

        // Ответить на callback
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: cb.id,
            text: newLang === 'ru' ? '✅ Русский' : '✅ English',
          }),
        });

        // Отправить подтверждение
        if (cbChatId) {
          await sendMessage(env, cbChatId, T[newLang].langChanged, webAppButton);
        }
      }
      return new Response('OK');
    }

    // ═══ INLINE QUERY ═══
    if (update.inline_query) {
      const queryId = update.inline_query.id;
      const shuffled = [...CUTE_MESSAGES].sort(() => Math.random() - 0.5).slice(0, 10);
      const results = shuffled.map((text, i) => ({
        type: 'article',
        id: String(Date.now()) + '_' + i,
        title: text,
        description: '💕',
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
      const lang = await getUserLang(supabase, userId);
      const payload = JSON.parse(payment.invoice_payload);
      if (payload.productId === 'extra_slot') {
              if (payload.type === 'skin' && payload.skinId) {
        await supabase.from('user_skins').insert({
          user_id: userId,
          skin_id: payload.skinId,
        }).catch(() => {}); // ignore duplicate
        const skinName = payload.skinId.charAt(0).toUpperCase() + payload.skinId.slice(1);
        await sendMessage(env, update.message.chat.id,
          lang === 'ru' ? `✅ Наряд *${skinName}* разблокирован! 🎨` : `✅ Outfit *${skinName}* unlocked! 🎨`,
          webAppButton
        );
      }
        const { data: existing } = await supabase.from('user_slots').select('extra_slots').eq('telegram_user_id', userId).single();
        if (existing) {
          await supabase.from('user_slots').update({ extra_slots: existing.extra_slots + 1 }).eq('telegram_user_id', userId);
        } else {
          await supabase.from('user_slots').insert({ telegram_user_id: userId, extra_slots: 1 });
        }
        await sendMessage(env, update.message.chat.id, T[lang].slotBought, webAppButton);
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

    // Получаем язык пользователя из базы
    let lang = await getUserLang(supabase, userId);

    // /start
    if (text === '/start' || text.startsWith('/start ')) {
      const startParam = text.split(' ')[1] || '';

      // При первом /start — определяем и сохраняем язык
      const { data: existingSettings } = await supabase
        .from('user_settings')
        .select('telegram_user_id')
        .eq('telegram_user_id', userId)
        .single();

      if (!existingSettings) {
        // Первый раз — определяем язык из Telegram
        lang = detectLangFromTelegram(message.from);
        await setUserLang(supabase, userId, lang);
      }

      if (startParam.startsWith('join_')) {
        const joinCode = startParam.replace('join_', '').toUpperCase();
        const maxP = await getMaxPairs(supabase, userId);
        const { data: ex } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
        const isAdmin = ADMIN_IDS.includes(userId);
        if (!isAdmin && ex && ex.length >= maxP) { await sendMessage(env, chatId, T[lang].maxPairs(ex.length, maxP), webAppButton); return new Response('OK'); }
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', joinCode).single();
        if (!pair) { await sendMessage(env, chatId, T[lang].pairNotFound(joinCode)); return new Response('OK'); }
        const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', joinCode);
        if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, T[lang].alreadyInPair, webAppButton); return new Response('OK'); }
        if (members && members.length >= 2) { await sendMessage(env, chatId, T[lang].pairFull); return new Response('OK'); }
        await supabase.from('pair_users').insert({ pair_code: joinCode, user_id: userId, display_name: firstName, username });
                // Track referral — the existing member invited this user
        for (const m of members || []) {
          if (m.user_id !== userId) {
            await supabase.from('user_referrals').insert({
              inviter_user_id: m.user_id,
              invited_user_id: userId,
              pair_code: joinCode,
            }).catch(() => {}); // ignore duplicate
          }
        }
        await sendMessage(env, chatId, T[lang].joined(joinCode), webAppButton);
        for (const m of members || []) {
          if (m.user_id !== userId) {
            const partnerLang = await getUserLang(supabase, m.user_id);
            await sendMessage(env, m.user_id, T[partnerLang].partnerJoined(firstName, joinCode), webAppButton);
          }
        }
        return new Response('OK');
      }

      await sendMessage(env, chatId, T[lang].welcome(firstName), webAppButton);
      return new Response('OK');
    }

    // /help
    if (text === '/help') {
      await sendMessage(env, chatId, T[lang].help, webAppButton);
      return new Response('OK');
    }

    // /lang — смена языка
    if (text === '/lang') {
      await sendMessage(env, chatId, T[lang].langPrompt, langButtons());
      return new Response('OK');
    }

    // /create
    if (text === '/create') {
      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);
      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) { await sendMessage(env, chatId, T[lang].maxPairs(existing.length, maxPairs), webAppButton); return new Response('OK'); }
      const code = generateCode();
      await supabase.from('pairs').insert({ code, pet_type: 'spark', streak_days: 0, growth_points: 0, hatched: false, bg_id: 'room', pet_name: null, streak_recoveries_used: 0, is_dead: false });
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username });
      const botUser = env.BOT_USERNAME || 'chumi_pet_bot';
      await sendMessage(env, chatId, T[lang].pairCreated(code), inviteButton(code, lang, botUser));
      return new Response('OK');
    }

    // /join
    if (text.startsWith('/join')) {
      const code = text.split(' ')[1]?.trim()?.toUpperCase();
      if (!code) { await sendMessage(env, chatId, T[lang].joinNoCode); return new Response('OK'); }
      const maxPairs = await getMaxPairs(supabase, userId);
      const isAdmin = ADMIN_IDS.includes(userId);
      const { data: existing } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!isAdmin && existing && existing.length >= maxPairs) { await sendMessage(env, chatId, T[lang].maxPairsLimit(maxPairs), webAppButton); return new Response('OK'); }
      const { data: pair } = await supabase.from('pairs').select('*').eq('code', code).single();
      if (!pair) { await sendMessage(env, chatId, T[lang].pairNotFound(code)); return new Response('OK'); }
      const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', code);
      if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, T[lang].alreadyInPair, webAppButton); return new Response('OK'); }
      if (members && members.length >= 2) { await sendMessage(env, chatId, T[lang].pairFull); return new Response('OK'); }
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username });
              // Track referral — the existing member invited this user
        for (const m of members || []) {
          if (m.user_id !== userId) {
            await supabase.from('user_referrals').insert({
              inviter_user_id: m.user_id,
              invited_user_id: userId,
              pair_code: joinCode,
            }).catch(() => {}); // ignore duplicate
          }
        }
      await sendMessage(env, chatId, T[lang].joined(code), webAppButton);
      for (const m of members || []) {
        if (m.user_id !== userId) {
          const partnerLang = await getUserLang(supabase, m.user_id);
          await sendMessage(env, m.user_id, T[partnerLang].joinedNotify(firstName, code), webAppButton);
        }
      }
      return new Response('OK');
    }

    // /mypairs
    if (text === '/mypairs') {
      const { data: userPairs } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!userPairs || userPairs.length === 0) { await sendMessage(env, chatId, T[lang].noPairs); return new Response('OK'); }
      let msg = T[lang].myPairsTitle;
      for (const up of userPairs) {
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;
        const lv = getLevel(pair.growth_points || 0);
        const name = pair.pet_name || lv.name;
        msg += T[lang].pairLine(lv.emoji, name, lv.name, pair.code, pair.growth_points || 0, pair.streak_days || 0);
      }
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /status
    if (text === '/status') {
      const { data: userPairs } = await supabase.from('pair_users').select('pair_code').eq('user_id', userId);
      if (!userPairs || userPairs.length === 0) { await sendMessage(env, chatId, T[lang].noPairs); return new Response('OK'); }
      let msg = T[lang].statusTitle;
      for (const up of userPairs) {
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).single();
        if (!pair) continue;
        const { data: members } = await supabase.from('pair_users').select('user_id, display_name').eq('pair_code', up.pair_code);
        const lv = getLevel(pair.growth_points || 0);
        const name = pair.pet_name || lv.name;
        const partner = members?.find(m => m.user_id !== userId);
        msg += T[lang].statusLine(
          lv.emoji, name, lv.name, pair.code,
          pair.streak_days || 0, pair.growth_points || 0,
          members?.length || 1, partner?.display_name || null, pair.is_dead
        );
      }
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /paysupport
    if (text === '/paysupport') {
      await sendMessage(env, chatId, T[lang].paySupport);
      return new Response('OK');
    }

  } catch (e) {
    console.error('Bot error:', e);
  }
  return new Response('OK');
}
