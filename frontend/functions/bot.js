import { createClient } from '@supabase/supabase-js';
import { LEVELS, getLevel } from './_levels.js';

function getSupabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

async function generateUniqueCode(supabase) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const { data } = await supabase
      .from('pairs').select('code').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  throw new Error('Could not generate unique pair code');
}


async function sendMessage(env, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
}

// Отправляет уведомление всем админам
async function notifyAdmins(env, text) {
  for (const adminId of ADMIN_IDS) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
    } catch (e) {}
  }
}

const ADMIN_IDS = ['713156118'];
const MAX_PAIRS_BASE = 2;
const WEBAPP_URL = 'https://chumi-app.pages.dev';
const FIRE_EMOJI_ID = '5368324170671202286';

// Команды для обычных пользователей
const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Начать работу с ботом' },
  { command: 'create', description: 'Создать новую пару' },
  { command: 'join', description: 'Вступить в пару (нужен код)' },
  { command: 'mypairs', description: 'Мои питомцы' },
  { command: 'status', description: 'Подробный статус пар' },
  { command: 'lang', description: 'Сменить язык' },
  { command: 'help', description: 'Справка по командам' },
  { command: 'paysupport', description: 'Поддержка по оплатам' },
];

// Дополнительные команды для админа
const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: 'stats', description: '📊 Статистика приложения' },
  { command: 'users', description: '👥 Последние пользователи' },
  { command: 'summary', description: '📅 Ежедневная сводка' },
  { command: 'setcommands', description: '🔧 Обновить список команд' },
];

async function setBotCommands(env) {
  // Глобальный список — для всех пользователей
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands: PUBLIC_COMMANDS }),
  });

  // Расширенный список — только в личных чатах с админами
  for (const adminId of ADMIN_IDS) {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: ADMIN_COMMANDS,
        scope: { type: 'chat', chat_id: parseInt(adminId) },
      }),
    });
  }
}


async function getMaxPairs(supabase, userId) {
  if (ADMIN_IDS.includes(userId)) return 999;
  // Check premium
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('expires_at')
    .eq('telegram_user_id', userId)
    .eq('status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sub && new Date(sub.expires_at) > new Date()) return 999;

  const { data } = await supabase
    .from('user_slots')
    .select('extra_slots')
    .eq('telegram_user_id', userId)
    .maybeSingle();
  return MAX_PAIRS_BASE + (data?.extra_slots || 0);
}

// ─── Получить язык пользователя из базы ───
async function getUserLang(supabase, userId) {
  const { data } = await supabase
    .from('user_settings')
    .select('lang')
    .eq('telegram_user_id', userId)
    .maybeSingle();
  return data?.lang || 'ru';
}

async function setUserLang(supabase, userId, lang) {
  await supabase.from('user_settings').upsert(
    { telegram_user_id: userId, lang, updated_at: new Date().toISOString() },
    { onConflict: 'telegram_user_id' }
  );
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
    paySupport: '🛟 По оплате: @ROKENN',
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
    paySupport: '🛟 Payment support: @ROKENN',
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

  // Проверка секрета вебхука Telegram
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (got !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }
  }

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
      const chargeId = payment.telegram_payment_charge_id || null;

      let payload;
      try {
        payload = JSON.parse(payment.invoice_payload);
      } catch (e) {
        console.error('Bad payment payload:', payment.invoice_payload);
        return new Response('OK');
      }

            // ── Sanity-check: payload должен относиться к этому же userId ──
      if (payload.userId && String(payload.userId) !== userId) {
        console.error('Payment payload userId mismatch:', payload.userId, 'vs', userId);
        return new Response('OK');
      }

      // ── Sanity-check: проверяем что заплатили правильную сумму ──
      const EXPECTED_AMOUNT = {
        extra_slot: 50,
        premium_monthly: 150,
        skin: 25,
        skin_gift: 25,
      };
      let productKey;
      if (payload.type === 'skin') productKey = 'skin';
      else if (payload.type === 'skin_gift') productKey = 'skin_gift';
      else productKey = payload.productId;
      const expected = EXPECTED_AMOUNT[productKey];
      if (expected !== undefined && payment.total_amount !== expected) {
        console.error(`Payment amount mismatch: got ${payment.total_amount}, expected ${expected}`);
        return new Response('OK');
      }


      // Idempotency: если такой charge уже обработан — просто отвечаем OK
      if (chargeId) {
        const { data: dup } = await supabase
          .from('user_subscriptions')
          .select('id')
          .eq('telegram_payment_charge_id', chargeId)
          .maybeSingle();
        if (dup) return new Response('OK');
      }

      // ── Skin purchase ──
      if (payload.type === 'skin' && payload.skinId) {
        const { data: alreadyOwned } = await supabase
          .from('user_skins')
          .select('id')
          .eq('user_id', userId)
          .eq('skin_id', payload.skinId)
          .maybeSingle();
        if (!alreadyOwned) {
          await supabase.from('user_skins').insert({
            user_id: userId,
            skin_id: payload.skinId,
          });
        }
        const skinName = payload.skinId.charAt(0).toUpperCase() + payload.skinId.slice(1);
        await sendMessage(env, update.message.chat.id,
          lang === 'ru' ? `✅ Наряд *${skinName}* разблокирован! 🎨` : `✅ Outfit *${skinName}* unlocked! 🎨`,
          webAppButton
        );

        // Уведомление админу
        const buyerName = update.message.from.first_name || 'User';
        const buyerUser = update.message.from.username ? '@' + update.message.from.username : '—';
        await notifyAdmins(env,
          `💰 *Покупка скина*\n\n` +
          `Пользователь: ${buyerName} (${buyerUser})\n` +
          `ID: \`${userId}\`\n` +
          `Скин: *${skinName}*\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
          `Charge: \`${chargeId || '—'}\``
        );
        return new Response('OK');
      }

// ── Skin GIFT (подарок партнёру) ──
if (payload.type === 'skin_gift' && payload.skinId && payload.recipientId) {
  const recipientId = String(payload.recipientId);
  const skinName = payload.skinId.charAt(0).toUpperCase() + payload.skinId.slice(1);

  // Проверяем, не владеет ли получатель уже этим скином
  const { data: alreadyOwned } = await supabase
    .from('user_skins')
    .select('id')
    .eq('user_id', recipientId)
    .eq('skin_id', payload.skinId)
    .maybeSingle();
  if (!alreadyOwned) {
    await supabase.from('user_skins').insert({
      user_id: recipientId,
      skin_id: payload.skinId,
    });
  }

  // Имя дарителя — объявляем ОДИН раз
  const giverName = update.message?.from?.first_name || 'User';
  const giverUser = update.message?.from?.username ? '@' + update.message.from.username : '—';

  // Сообщение дарителю
  await sendMessage(env, update.message.chat.id,
    lang === 'ru'
      ? `🎁 Подарок отправлен партнёру!\nНаряд *${skinName}* теперь у него 🎨`
      : `🎁 Gift sent to your partner!\nThey now own outfit *${skinName}* 🎨`,
    webAppButton
  );

  // Сообщение получателю на его языке
  const recipientLang = await getUserLang(supabase, recipientId);
  const giverDisplay = update.message?.from?.first_name || (recipientLang === 'ru' ? 'Партнёр' : 'Partner');
  await sendMessage(env, recipientId,
    recipientLang === 'ru'
      ? `🎁 *${giverDisplay}* подарил тебе наряд *${skinName}*! 🎨\nОткрой Chumi и примерь его 🐾`
      : `🎁 *${giverDisplay}* gifted you outfit *${skinName}*! 🎨\nOpen Chumi and try it on 🐾`,
    webAppButton
  );

  // Уведомление админу о подарке
  await notifyAdmins(env,
    `🎁 *Подарок скина*\n\n` +
    `Даритель: ${giverName} (${giverUser})\n` +
    `ID: \`${userId}\`\n` +
    `Получатель ID: \`${recipientId}\`\n` +
    `Скин: *${skinName}*\n` +
    `Сумма: ⭐ ${payment.total_amount} Stars\n` +
    `Charge: \`${chargeId || '—'}\``
  );
  return new Response('OK');
}

      // ── Extra slot ──
      if (payload.productId === 'extra_slot') {
        // Атомарный upsert через RPC был бы лучше, но оставляем select+update/insert,
        // защищая дубль через unique-индекс на telegram_user_id
        const { data: existing } = await supabase
          .from('user_slots')
          .select('extra_slots')
          .eq('telegram_user_id', userId)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('user_slots')
            .update({ extra_slots: (existing.extra_slots || 0) + 1 })
            .eq('telegram_user_id', userId);
        } else {
          await supabase
            .from('user_slots')
            .insert({ telegram_user_id: userId, extra_slots: 1 });
        }
        await sendMessage(env, update.message.chat.id, T[lang].slotBought, webAppButton);
                // Уведомление админу
        const slotBuyer = update.message.from.first_name || 'User';
        const slotBuyerUser = update.message.from.username ? '@' + update.message.from.username : '—';
        await notifyAdmins(env,
          `💰 *Покупка дополнительного слота*\n\n` +
          `Пользователь: ${slotBuyer} (${slotBuyerUser})\n` +
          `ID: \`${userId}\`\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
          `Charge: \`${chargeId || '—'}\``
        );
        return new Response('OK');
      }

      // ── Premium monthly ──
      if (payload.productId === 'premium_monthly') {
        const now = new Date();

        // Берём максимум(текущая_активная_подписка.expires_at, now) + 30 дней
        const { data: currentSub } = await supabase
          .from('user_subscriptions')
          .select('expires_at')
          .eq('telegram_user_id', userId)
          .eq('status', 'active')
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const baseTs = (currentSub && new Date(currentSub.expires_at) > now)
          ? new Date(currentSub.expires_at).getTime()
          : now.getTime();
        const expiresAt = new Date(baseTs + 30 * 24 * 60 * 60 * 1000);

        // Деактивируем все старые активные
        await supabase
          .from('user_subscriptions')
          .update({ status: 'expired', updated_at: now.toISOString() })
          .eq('telegram_user_id', userId)
          .eq('status', 'active');

        // Создаём новую
        await supabase.from('user_subscriptions').insert({
          telegram_user_id: userId,
          plan: 'premium_monthly',
          status: 'active',
          telegram_payment_charge_id: chargeId,
          starts_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        });

        await sendMessage(env, update.message.chat.id,
          lang === 'ru'
            ? `⭐ *Chumi Premium активирован!*\n\nТеперь у тебя:\n• Безлимит пар\n• Все наряды открыты\n• Премиум-бейдж в рейтинге\n\nДействует до ${expiresAt.toLocaleDateString('ru-RU')}`
            : `⭐ *Chumi Premium activated!*\n\nYou now have:\n• Unlimited pairs\n• All outfits unlocked\n• Premium badge in ranking\n\nValid until ${expiresAt.toLocaleDateString('en-US')}`,
          webAppButton
        );
                // Уведомление админу
        const premBuyer = update.message.from.first_name || 'User';
        const premBuyerUser = update.message.from.username ? '@' + update.message.from.username : '—';
        await notifyAdmins(env,
          `⭐ *Покупка Premium*\n\n` +
          `Пользователь: ${premBuyer} (${premBuyerUser})\n` +
          `ID: \`${userId}\`\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
          `Действует до: ${expiresAt.toLocaleDateString('ru-RU')}\n` +
          `Charge: \`${chargeId || '—'}\``
        );
        return new Response('OK');
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
        .maybeSingle();

      if (!existingSettings) {
        // Первый раз — определяем язык из Telegram
        lang = detectLangFromTelegram(message.from);
        await setUserLang(supabase, userId, lang);

        // Уведомление админа о новом пользователе
        for (const adminId of ADMIN_IDS) {
          if (adminId === userId) continue;
          try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminId,
                text: `👤 *Новый пользователь!*\n\n` +
                      `Имя: ${firstName}\n` +
                      `Username: ${username ? '@' + username : '—'}\n` +
                      `ID: \`${userId}\`\n` +
                      `Язык: ${lang}`,
                parse_mode: 'Markdown',
              }),
            });
          } catch (e) {}
        }
      }

      // ── Реферальная ссылка: запоминаем, кто пригласил ──
if (startParam.startsWith('ref_')) {
  const inviterId = startParam.replace('ref_', '');

  // Не самому себе
  if (inviterId && inviterId !== userId) {
    // Сохраняем ожидающий реферал — засчитается, когда пользователь создаст или вступит в пару
    await supabase.from('pending_referrals').upsert(
      {
        invited_user_id: userId,
        inviter_user_id: inviterId,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'invited_user_id' }
    ).then(() => {}, () => {});
  }
  // Дальше — обычный welcome
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
        await supabase.from('pair_users').insert({ pair_code: joinCode, user_id: userId, display_name: firstName, username, timezone: 'UTC' });
        // ── Засчитываем pending-реферал, если он есть ──
        const { data: pending } = await supabase
          .from('pending_referrals')
          .select('inviter_user_id')
          .eq('invited_user_id', userId)
          .maybeSingle();
        if (pending?.inviter_user_id) {
          await supabase.from('user_referrals').insert({
            inviter_user_id: pending.inviter_user_id,
            invited_user_id: userId,
            pair_code: joinCode,
          }).then(() => {}, () => {});
          await supabase.from('pending_referrals')
            .delete()
            .eq('invited_user_id', userId);
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
      const code = await generateUniqueCode(supabase);
      await supabase.from('pairs').insert({
        code,
        pet_type: 'spark',
        streak_days: 0,
        growth_points: 0,
        hatched: false,
        bg_id: 'room',
        pet_name: null,
        streak_recoveries_used: 0,
        is_dead: false,
        timezone: 'UTC',
        last_streak_date: null,
        last_pair_streak_date: null,
      });
      await supabase.from('pair_users').insert({
        pair_code: code,
        user_id: userId,
        display_name: firstName,
        username,
        timezone: 'UTC',
      });

      // ── Засчитываем pending-реферал, если он есть ──
      const { data: pending } = await supabase
        .from('pending_referrals')
        .select('inviter_user_id')
        .eq('invited_user_id', userId)
        .maybeSingle();
      if (pending?.inviter_user_id) {
        await supabase.from('user_referrals').insert({
          inviter_user_id: pending.inviter_user_id,
          invited_user_id: userId,
          pair_code: code,
        }).then(() => {}, () => {});
        await supabase.from('pending_referrals')
          .delete()
          .eq('invited_user_id', userId);
      }

      const botUser = env.BOT_USERNAME || 'ChumiPetBot';
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
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username, timezone: 'UTC' });
            // ── Засчитываем pending-реферал, если он есть ──
      const { data: pending } = await supabase
        .from('pending_referrals')
        .select('inviter_user_id')
        .eq('invited_user_id', userId)
        .maybeSingle();
      if (pending?.inviter_user_id) {
        await supabase.from('user_referrals').insert({
          inviter_user_id: pending.inviter_user_id,
          invited_user_id: userId,
          pair_code: code,
        }).then(() => {}, () => {});
        await supabase.from('pending_referrals')
          .delete()
          .eq('invited_user_id', userId);
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

        // /stats — только для админа
    if (text === '/stats') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      const { count: totalUsers } = await supabase
        .from('user_settings').select('telegram_user_id', { count: 'exact', head: true });
      const { count: totalPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true });
      const { count: alivePairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', false);
      const { count: deadPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', true);
      const { count: activeSubs } = await supabase
        .from('user_subscriptions').select('id', { count: 'exact', head: true })
        .eq('status', 'active').gt('expires_at', new Date().toISOString());
      const { count: totalSkins } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true });

      const msg = `📊 *Chumi stats*\n\n` +
        `👥 Users: *${totalUsers ?? 0}*\n` +
        `🐾 Pairs: *${totalPairs ?? 0}* (alive: ${alivePairs ?? 0}, dead: ${deadPairs ?? 0})\n` +
        `⭐ Premium subs: *${activeSubs ?? 0}*\n` +
        `🎨 Skins owned: *${totalSkins ?? 0}*`;
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /users — список последних пользователей (только для админа)
    if (text === '/users') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      const { data: users } = await supabase
        .from('pair_users')
        .select('user_id, display_name, username')
        .order('user_id', { ascending: false })
        .limit(50);

      const seen = new Set();
      const unique = (users || []).filter(u => {
        if (seen.has(u.user_id)) return false;
        seen.add(u.user_id);
        return true;
      });

      let msg = `👥 *Последние пользователи (${unique.length}):*\n\n`;
      for (const u of unique) {
        msg += `• ${u.display_name || '—'} (${u.username ? '@' + u.username : 'no username'}) \`${u.user_id}\`\n`;
      }
      await sendMessage(env, chatId, msg.slice(0, 4000));
      return new Response('OK');
    }
        // /summary — ручной запуск ежедневной сводки (только для админа)
    if (text === '/summary') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      // Зовём эндпоинт с CRON_SECRET в заголовке
      const r = await fetch(`https://chumi-app.pages.dev/api/admin-daily-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.CRON_SECRET || ''}`,
        },
      });
      if (!r.ok) {
        await sendMessage(env, chatId, `❌ Ошибка: ${r.status}`);
      } else {
        await sendMessage(env, chatId, '✅ Сводка отправлена.');
      }
      return new Response('OK');
    }

        // /setcommands — только для админа, обновляет список команд бота
    if (text === '/setcommands') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');
      try {
        await setBotCommands(env);
        await sendMessage(env, chatId, '✅ Список команд обновлён.\nВ чате с ботом нажми кнопку «Меню» рядом с полем ввода.');
      } catch (e) {
        await sendMessage(env, chatId, `❌ Ошибка: ${e?.message || e}`);
      }
      return new Response('OK');
    }

    // /paysupport
    if (text === '/paysupport') {
      await sendMessage(env, chatId, T[lang].paySupport);
      return new Response('OK');
    }

  } catch (e) {
    console.error('Bot error:', e);
    // Уведомить админов об ошибке
    for (const adminId of ADMIN_IDS) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: adminId,
            text: `🛠 *Bot error:*\n\`\`\`\n${(e?.stack || e?.message || String(e)).slice(0, 1500)}\n\`\`\``,
            parse_mode: 'Markdown',
          }),
        });
      } catch (err) {}
    }
  }
  return new Response('OK');
}
