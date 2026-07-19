import { LEVELS, getLevel } from './_levels.js';
import { expectedAmount } from './_prices.js';
import {
  ADMIN_IDS, WEBAPP_URL,
  getSupabase, generateUniqueCode, escapeMd, getMaxPairs,
} from './_shared.js';

// Пытается «застолбить» платёж. Возвращает один из статусов:
//   'new'  — charge новый, товар можно выдавать;
//   'dup'  — charge уже обрабатывался (дубликат вебхука), выдавать НЕ нужно;
//   'error'— ошибка БД (не дубликат); товар не выдан, нужно вмешательство.
// Атомарность обеспечивается UNIQUE-констрейнтом processed_charges.charge_id.
async function claimCharge(
  supabase,
  chargeId,
  userId,
  product
) {
  const normalizedChargeId =
    typeof chargeId === 'string'
      ? chargeId.trim()
      : '';

  if (!normalizedChargeId) {
    console.error(
      'Payment fulfillment rejected: chargeId is missing',
      {
        userId: String(userId),
        product: String(product),
      }
    );

    return 'error';
  }

  const {
    error,
  } = await supabase
    .from('processed_charges')
    .insert({
      charge_id: normalizedChargeId,
      user_id: String(userId),
      product: String(product),
    });

  if (!error) {
    return 'new';
  }

  if (error.code === '23505') {
    console.warn(
      'Duplicate payment event ignored:',
      normalizedChargeId
    );

    return 'dup';
  }

  console.error(
    'Failed to reserve payment charge:',
    {
      chargeId: normalizedChargeId,
      userId: String(userId),
      product: String(product),
      error,
    }
  );

  return 'error';
}

// Возвращает true, если товар нужно выдавать. При 'dup' и 'error' возвращает false.
// При 'error' дополнительно уведомляет админов о застрявшем платеже.
async function shouldFulfill(env, status, ctx) {
  if (status === 'new') return true;
  if (status === 'dup') return false;
  // status === 'error' — платёж прошёл, но БД не дала застолбить charge.
  await notifyAdmins(env,
    `⚠️ *Платёж не обработан (сбой БД)*\n\n` +
    `Товар НЕ выдан автоматически — нужна ручная выдача!\n\n` +
    `Продукт: *${escapeMd(ctx.product)}*\n` +
    `Покупатель ID: \`${ctx.userId}\`\n` +
    (ctx.recipientId ? `Получатель ID: \`${ctx.recipientId}\`\n` : '') +
    (ctx.skinId ? `Скин: *${escapeMd(ctx.skinId)}*\n` : '') +
    `Сумма: ⭐ ${ctx.amount}\n` +
    `Charge: \`${ctx.chargeId || '—'}\``
  );
  return false;
}

async function sendMessage(env, chatId, text, extra = {}) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    ...extra,
  };

  if (!body.reply_markup) {
    body.reply_markup = {
      inline_keyboard: [[
        { text: '🐾 Открыть Chumi', web_app: { url: WEBAPP_URL } },
      ]],
    };
  } else if (typeof body.reply_markup === 'string') {
    // В коде местами reply_markup сериализован как строка (старый формат)
    // — Telegram это принимает, оставляем как есть
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let desc = '';
      try { const j = await res.json(); desc = j.description || ''; } catch {}
      const blocked = res.status === 403 || /blocked|deactivated|chat not found/i.test(desc);
      console.warn(`sendMessage failed (chat ${chatId}, status ${res.status})${blocked ? ' [blocked]' : ''}: ${desc}`);
      return { ok: false, blocked, status: res.status, description: desc };
    }
    return { ok: true };
  } catch (e) {
    console.error('sendMessage network error:', e);
    return { ok: false, error: String(e) };
  }
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
  {
    command: 'admin',
    description: '🛠 Панель администратора',
  },
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

async function syncTelegramProfile(
  supabase,
  telegramUser,
) {
  if (!telegramUser?.id) {
    return;
  }

  const userId =
    String(telegramUser.id);

  const displayName =
    [
      telegramUser.first_name,
      telegramUser.last_name,
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) ||
    'User';

  /*
   * Если пользователь удалил username,
   * записываем null, чтобы старый username
   * не оставался в базе.
   */
  const username =
    telegramUser.username
      ? String(
          telegramUser.username,
        ).slice(0, 100)
      : null;

  const {
    error: pairUsersError,
  } = await supabase
    .from('pair_users')
    .update({
      display_name:
        displayName,
      username,
    })
    .eq('user_id', userId);

  if (pairUsersError) {
    console.error(
      'Failed to update pair user profile:',
      pairUsersError,
    );
  }

  /*
   * Обновляем имя в игровом рейтинге.
   * updated_at намеренно не изменяем,
   * поскольку он участвует в сортировке
   * пользователей с одинаковым счётом.
   */
  const {
    error: gameScoresError,
  } = await supabase
    .from('jump_game_scores')
    .update({
      display_name:
        displayName,
      username,
    })
    .eq('user_id', userId);

  if (gameScoresError) {
    console.error(
      'Failed to update game profile:',
      gameScoresError,
    );
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

function adminMenuButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '📊 Статистика',
            callback_data: 'admin_stats',
          },
          {
            text: '👥 Пользователи',
            callback_data: 'admin_users',
          },
        ],
        [
          {
            text: '📅 Ежедневная сводка',
            callback_data: 'admin_summary',
          },
        ],
        [
          {
            text: '📣 Создать рассылку',
            callback_data: 'admin_broadcast',
          },
        ],
        [
          {
            text: '🐝 Выдать Пчёлку',
            callback_data: 'admin_grantbee',
          },
          {
            text: '➕ Выдать слот',
            callback_data: 'admin_grantslot',
          },
        ],
        [
          {
            text: '🔧 Обновить команды',
            callback_data: 'admin_setcommands',
          },
        ],
        [
          {
            text: '🔄 Обновить меню',
            callback_data: 'admin_menu',
          },
        ],
      ],
    },
  };
}

function adminForceReply(placeholder) {
  return {
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: placeholder,
    },
  };
}

async function answerCallbackQuery(
  env,
  callbackQueryId,
  options = {},
) {
  try {
    await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callback_query_id:
            callbackQueryId,
          ...options,
        }),
      },
    );
  } catch (error) {
    console.error(
      'answerCallbackQuery failed:',
      error,
    );
  }
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

  // Webhook всегда должен работать в fail-closed режиме.
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    console.error(
      'TELEGRAM_WEBHOOK_SECRET is not configured',
    );

    return new Response(
      'Webhook is not configured',
      { status: 503 },
    );
  }

  const receivedWebhookSecret =
    request.headers.get(
      'X-Telegram-Bot-Api-Secret-Token',
    );

  if (
    receivedWebhookSecret !==
    env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response(
      'Forbidden',
      { status: 403 },
    );
  }

  try {
    const update = await request.json();
    const supabase = getSupabase(env);

    const telegramUser =
      update.message?.from ||
      update.edited_message?.from ||
      update.callback_query?.from ||
      update.inline_query?.from ||
      update.chosen_inline_result?.from ||
      update.pre_checkout_query?.from ||
      update.shipping_query?.from ||
      null;

    if (telegramUser) {
      await syncTelegramProfile(
        supabase,
        telegramUser,
      );
    }

    // ═══ CALLBACK QUERY ═══
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbUserId = String(cb.from.id);
      const cbChatId = cb.message?.chat?.id;
      const cbData = cb.data || '';

      if (
        cbData === 'set_lang_ru' ||
        cbData === 'set_lang_en'
      ) {
        const newLang =
          cbData === 'set_lang_ru'
            ? 'ru'
            : 'en';

        await setUserLang(
          supabase,
          cbUserId,
          newLang,
        );

        await answerCallbackQuery(
          env,
          cb.id,
          {
            text:
              newLang === 'ru'
                ? '✅ Русский'
                : '✅ English',
          },
        );

        if (cbChatId) {
          await sendMessage(
            env,
            cbChatId,
            T[newLang].langChanged,
            webAppButton,
          );
        }

        return new Response('OK');
      }

      if (cbData.startsWith('admin_')) {
        if (!ADMIN_IDS.includes(cbUserId)) {
          await answerCallbackQuery(
            env,
            cb.id,
            {
              text:
                '⛔ Нет доступа',
              show_alert: true,
            },
          );

          return new Response('OK');
        }

        if (!cbChatId) {
          await answerCallbackQuery(
            env,
            cb.id,
          );

          return new Response('OK');
        }

        await answerCallbackQuery(
          env,
          cb.id,
        );

        if (cbData === 'admin_menu') {
          await sendMessage(
            env,
            cbChatId,
            '🛠 *Панель администратора*\n\nВыберите действие:',
            adminMenuButtons(),
          );

          return new Response('OK');
        }

        if (cbData === 'admin_broadcast') {
          await sendMessage(
            env,
            cbChatId,
            'ADMIN_BROADCAST_PROMPT\n\n📣 Отправьте текст сообщения для рассылки всем пользователям.',
            adminForceReply(
              'Введите текст рассылки',
            ),
          );

          return new Response('OK');
        }

        if (cbData === 'admin_grantbee') {
          await sendMessage(
            env,
            cbChatId,
            'ADMIN_GRANTBEE_PROMPT\n\n🐝 Отправьте Telegram ID пользователя, которому нужно выдать наряд Пчёлка.',
            adminForceReply(
              'Введите Telegram ID',
            ),
          );

          return new Response('OK');
        }

        if (cbData === 'admin_grantslot') {
          await sendMessage(
            env,
            cbChatId,
            'ADMIN_GRANTSLOT_PROMPT\n\n➕ Отправьте Telegram ID пользователя, которому нужно выдать дополнительный слот.',
            adminForceReply(
              'Введите Telegram ID',
            ),
          );

          return new Response('OK');
        }

        const adminCommandMap = {
          admin_stats: '/stats',
          admin_users: '/users',
          admin_summary: '/summary',
          admin_setcommands:
            '/setcommands',
        };

        const adminCommand =
          adminCommandMap[cbData];

        if (!adminCommand) {
          return new Response('OK');
        }

        update.message = {
          message_id:
            cb.message?.message_id ||
            0,
          from: cb.from,
          chat: cb.message.chat,
          date:
            Math.floor(
              Date.now() / 1000,
            ),
          text: adminCommand,
        };
      } else {
        await answerCallbackQuery(
          env,
          cb.id,
        );

        return new Response('OK');
      }
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
      const query = update.pre_checkout_query;

      let isValid = false;
      let validationError =
        'Invalid product or payment amount';

      try {
        const payload = JSON.parse(
          query.invoice_payload,
        );

        const payloadType =
          payload.type ||
          payload.t ||
          null;

        const skinId =
          payload.skinId ||
          payload.s ||
          null;

        const payloadUserId =
          payload.userId ||
          payload.u ||
          null;

        const productId =
          payload.productId ||
          payload.p ||
          null;

        let productKey = null;

        if (payloadType === 'skin') {
          productKey = 'skin';
        } else if (payloadType === 'skin_gift') {
          productKey = 'skin_gift';
        } else {
          productKey = productId;
        }

        const expected =
          expectedAmount(
            productKey,
            skinId,
          );

        const userMatches =
          payloadUserId === null ||
          String(payloadUserId) ===
            String(query.from.id);

        const currencyMatches =
          query.currency === 'XTR';

        const amountMatches =
          Number.isFinite(expected) &&
          query.total_amount === expected;

        isValid =
          userMatches &&
          currencyMatches &&
          amountMatches;

        if (!userMatches) {
          validationError =
            'This invoice belongs to another user';
        } else if (!currencyMatches) {
          validationError =
            'Only Telegram Stars are supported';
        } else if (!Number.isFinite(expected)) {
          validationError =
            'Unknown product';
        } else if (!amountMatches) {
          validationError =
            'The product price has changed. Please reopen the shop';
        }
      } catch (error) {
        console.error(
          'Pre-checkout validation failed:',
          error,
        );

        validationError =
          'Invalid payment payload';
      }

      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pre_checkout_query_id: query.id,
            ok: isValid,
            ...(isValid
              ? {}
              : {
                  error_message:
                    validationError,
                }),
          }),
        },
      );

      if (!response.ok) {
        console.error(
          'answerPreCheckoutQuery failed:',
          response.status,
        );
      }

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

      // ── Единое чтение полей payload (поддержка короткого формата t/s/u/r
      // и длинного type/skinId/userId/recipientId) ──
      const pType = payload.type || payload.t || null;          // 'skin' | 'skin_gift' | undefined
      const pSkinId = payload.skinId || payload.s || null;
      const pRecipientId = payload.recipientId || payload.r || null;
      const pProductId = payload.productId || null;             // 'extra_slot' | 'premium_monthly'

      // ── Sanity-check: проверяем что заплатили правильную сумму ──
      // productKey определяется ОДИН раз и используется и для проверки суммы,
      // и для дальнейшей обработки — они не могут разойтись.
      let productKey;
      if (pType === 'skin') productKey = 'skin';
      else if (pType === 'skin_gift') productKey = 'skin_gift';
      else productKey = pProductId;

      // Цена берётся из общего модуля _prices.js — единый источник правды
      // для скинов (по skinId) и товаров (extra_slot и т.п.).
      // Как и в pre_checkout: неизвестный продукт (expected === undefined)
      // считаем невалидным и товар не выдаём — иначе сумма не проверяется вообще.
      const expected = expectedAmount(productKey, pSkinId);
      if (!Number.isFinite(expected) || payment.total_amount !== expected) {
        console.error(`Payment amount mismatch: got ${payment.total_amount}, expected ${expected}`);
        return new Response('OK');
      }

      // ── Skin purchase ──
      if (pType === 'skin' && pSkinId) {
        // Идемпотентность: атомарно столбим платёж ДО выдачи товара
        const skinClaim = await claimCharge(supabase, chargeId, userId, 'skin');
        if (!(await shouldFulfill(env, skinClaim, {
          product: 'skin', userId, skinId: pSkinId,
          amount: payment.total_amount, chargeId,
        }))) {
          return new Response('OK');
        }

        const { data: alreadyOwned } = await supabase
          .from('user_skins')
          .select('id')
          .eq('user_id', userId)
          .eq('skin_id', pSkinId)
          .maybeSingle();
        if (!alreadyOwned) {
          await supabase.from('user_skins').insert({
            user_id: userId,
            skin_id: pSkinId,
          });
        }

        const skinName = pSkinId.charAt(0).toUpperCase() + pSkinId.slice(1);
        await sendMessage(env, update.message.chat.id,
          lang === 'ru' ? `✅ Наряд *${escapeMd(skinName)}* разблокирован! 🎨` : `✅ Outfit *${escapeMd(skinName)}* unlocked! 🎨`,
          webAppButton
        );

        // Уведомление админу
        const buyerName = update.message.from.first_name || 'User';
        const buyerUser = update.message.from.username ? '@' + update.message.from.username : '—';
        await notifyAdmins(env,
          `💰 *Покупка скина*\n\n` +
          `Пользователь: ${escapeMd(buyerName)} (${escapeMd(buyerUser)})\n` +
          `ID: \`${userId}\`\n` +
          `Скин: *${escapeMd(skinName)}*\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
          `Charge: \`${chargeId || '—'}\``
        );
        return new Response('OK');
      }

      // ── Skin GIFT (подарок партнёру) ──
      if (pType === 'skin_gift' && pSkinId && pRecipientId) {
        // Идемпотентность: атомарно столбим платёж ДО выдачи товара
        const giftClaim = await claimCharge(supabase, chargeId, userId, 'skin_gift');
        if (!(await shouldFulfill(env, giftClaim, {
          product: 'skin_gift', userId, recipientId: String(pRecipientId),
          skinId: pSkinId, amount: payment.total_amount, chargeId,
        }))) {
          return new Response('OK');
        }

        const recipientId = String(pRecipientId);
        const skinName = pSkinId.charAt(0).toUpperCase() + pSkinId.slice(1);

        // Проверяем, не владеет ли получатель уже этим скином
        const { data: alreadyOwned } = await supabase
          .from('user_skins')
          .select('id')
          .eq('user_id', recipientId)
          .eq('skin_id', pSkinId)
          .maybeSingle();
        if (!alreadyOwned) {
          await supabase.from('user_skins').insert({
            user_id: recipientId,
            skin_id: pSkinId,
          });
        }

        // Имя дарителя
        const giverName = update.message?.from?.first_name || 'User';
        const giverUser = update.message?.from?.username ? '@' + update.message.from.username : '—';

        // Сообщение дарителю
        await sendMessage(env, update.message.chat.id,
          lang === 'ru'
            ? `🎁 Подарок отправлен партнёру!\nНаряд *${escapeMd(skinName)}* теперь у него 🎨`
            : `🎁 Gift sent to your partner!\nThey now own outfit *${escapeMd(skinName)}* 🎨`,
          webAppButton
        );

        // Сообщение получателю на его языке
        const recipientLang = await getUserLang(supabase, recipientId);
        const giverDisplay = update.message?.from?.first_name || (recipientLang === 'ru' ? 'Партнёр' : 'Partner');
        await sendMessage(env, recipientId,
          recipientLang === 'ru'
            ? `🎁 *${escapeMd(giverDisplay)}* подарил тебе наряд *${escapeMd(skinName)}*! 🎨\nОткрой Chumi и примерь его 🐾`
            : `🎁 *${escapeMd(giverDisplay)}* gifted you outfit *${escapeMd(skinName)}*! 🎨\nOpen Chumi and try it on 🐾`,
          webAppButton
        );

        // Уведомление админу о подарке
        await notifyAdmins(env,
          `🎁 *Подарок скина*\n\n` +
          `Даритель: ${escapeMd(giverName)} (${escapeMd(giverUser)})\n` +
          `ID: \`${userId}\`\n` +
          `Получатель ID: \`${recipientId}\`\n` +
          `Скин: *${escapeMd(skinName)}*\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
          `Charge: \`${chargeId || '—'}\``
        );
        return new Response('OK');
      }


      // ── Extra slot ──
      if (pProductId === 'extra_slot') {
        // Идемпотентность: атомарно столбим платёж ДО выдачи слота
        const slotClaim = await claimCharge(supabase, chargeId, userId, 'extra_slot');
        if (!(await shouldFulfill(env, slotClaim, {
          product: 'extra_slot', userId,
          amount: payment.total_amount, chargeId,
        }))) {
          return new Response('OK');
        }

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
          `Пользователь: ${escapeMd(slotBuyer)} (${escapeMd(slotBuyerUser)})\n` +
          `ID: \`${userId}\`\n` +
          `Сумма: ⭐ ${payment.total_amount} Stars\n` +
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
    let text = message.text.trim();
    const firstName = message.from.first_name || 'User';
    const username = message.from.username || null;

    const repliedBotText =
      message.reply_to_message?.text ||
      '';

    if (ADMIN_IDS.includes(userId)) {
      if (
        repliedBotText.startsWith(
          'ADMIN_BROADCAST_PROMPT',
        )
      ) {
        text = `/broadcast ${text}`;
      } else if (
        repliedBotText.startsWith(
          'ADMIN_GRANTBEE_PROMPT',
        )
      ) {
        text = `/grantbee ${text}`;
      } else if (
        repliedBotText.startsWith(
          'ADMIN_GRANTSLOT_PROMPT',
        )
      ) {
        text = `/grantslot ${text}`;
      }
    }

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
                      `Имя: ${escapeMd(firstName)}\n` +
                      `Username: ${username ? '@' + escapeMd(username) : '—'}\n` +
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
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', joinCode).maybeSingle();
        if (!pair) { await sendMessage(env, chatId, T[lang].pairNotFound(joinCode)); return new Response('OK'); }
        const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', joinCode);
        if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, T[lang].alreadyInPair, webAppButton); return new Response('OK'); }
        if (members && members.length >= 2) { await sendMessage(env, chatId, T[lang].pairFull); return new Response('OK'); }
        await supabase.from('pair_users').insert({ pair_code: joinCode, user_id: userId, display_name: firstName, username, timezone: null });
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
            await sendMessage(env, m.user_id, T[partnerLang].partnerJoined(escapeMd(firstName), joinCode), webAppButton);
          }
        }
        return new Response('OK');
      }

      await sendMessage(env, chatId, T[lang].welcome(escapeMd(firstName)), webAppButton);
      return new Response('OK');
    }

    // /admin — панель администратора
    if (
      text === '/admin' ||
      text.startsWith('/admin@')
    ) {
      if (!ADMIN_IDS.includes(userId)) {
        return new Response('OK');
      }

      if (message.chat.type !== 'private') {
        await sendMessage(
          env,
          chatId,
          '⚠️ Панель администратора доступна только в личном чате с ботом.',
        );

        return new Response('OK');
      }

      await sendMessage(
        env,
        chatId,
        '🛠 *Панель администратора*\n\nВыберите действие:',
        adminMenuButtons(),
      );

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
      const maxPairs = await getMaxPairs(
        supabase,
        userId,
      );

      const isAdmin =
        ADMIN_IDS.includes(userId);

      const {
        data: existing,
        error: existingError,
      } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId);

      if (existingError) {
        console.error(
          'Failed to load user pairs:',
          existingError,
        );

        await sendMessage(
          env,
          chatId,
          lang === 'ru'
            ? '❌ Не удалось проверить список пар. Попробуй позже.'
            : '❌ Failed to check your pairs. Please try again later.',
          webAppButton,
        );

        return new Response('OK');
      }

      if (
        !isAdmin &&
        existing &&
        existing.length >= maxPairs
      ) {
        await sendMessage(
          env,
          chatId,
          T[lang].maxPairs(
            existing.length,
            maxPairs,
          ),
          webAppButton,
        );

        return new Response('OK');
      }

      let code;

      try {
        code = await generateUniqueCode(
          supabase,
        );
      } catch (error) {
        console.error(
          'Failed to generate pair code:',
          error,
        );

        await sendMessage(
          env,
          chatId,
          lang === 'ru'
            ? '❌ Не удалось создать код пары. Попробуй позже.'
            : '❌ Failed to generate a pair code. Please try again later.',
          webAppButton,
        );

        return new Response('OK');
      }

      const {
        error: pairInsertError,
      } = await supabase
        .from('pairs')
        .insert({
          code,
          pet_type: 'spark',
          streak_days: 0,
          growth_points: 0,
          hatched: false,
          bg_id: 'room',
          pet_name: null,
          streak_recoveries_used: 0,
          is_dead: false,
          timezone: null,
          last_streak_date: null,
          last_pair_streak_date: null,
        });

      if (pairInsertError) {
        console.error(
          'Failed to create pair:',
          pairInsertError,
        );

        await sendMessage(
          env,
          chatId,
          lang === 'ru'
            ? '❌ Не удалось создать пару. Попробуй позже.'
            : '❌ Failed to create the pair. Please try again later.',
          webAppButton,
        );

        return new Response('OK');
      }

      const {
        error: memberInsertError,
      } = await supabase
        .from('pair_users')
        .insert({
          pair_code: code,
          user_id: userId,
          display_name: firstName,
          username,
          timezone: null,
        });

      if (memberInsertError) {
        console.error(
          'Failed to add pair owner:',
          memberInsertError,
        );

        const {
          error: rollbackError,
        } = await supabase
          .from('pairs')
          .delete()
          .eq('code', code);

        if (rollbackError) {
          console.error(
            'Failed to roll back pair creation:',
            rollbackError,
          );
        }

        await sendMessage(
          env,
          chatId,
          lang === 'ru'
            ? '❌ Не удалось добавить тебя в пару. Попробуй ещё раз.'
            : '❌ Failed to add you to the pair. Please try again.',
          webAppButton,
        );

        return new Response('OK');
      }

      // Засчитываем pending-реферал.
      const {
        data: pending,
      } = await supabase
        .from('pending_referrals')
        .select('inviter_user_id')
        .eq('invited_user_id', userId)
        .maybeSingle();

      if (pending?.inviter_user_id) {
        const {
          error: referralInsertError,
        } = await supabase
          .from('user_referrals')
          .insert({
            inviter_user_id:
              pending.inviter_user_id,
            invited_user_id: userId,
            pair_code: code,
          });

        if (referralInsertError) {
          console.warn(
            'Failed to save referral:',
            referralInsertError,
          );
        } else {
          const {
            error: pendingDeleteError,
          } = await supabase
            .from('pending_referrals')
            .delete()
            .eq(
              'invited_user_id',
              userId,
            );

          if (pendingDeleteError) {
            console.warn(
              'Failed to delete pending referral:',
              pendingDeleteError,
            );
          }
        }
      }

      const botUsername =
        env.BOT_USERNAME ||
        'ChumiPetBot';

      await sendMessage(
        env,
        chatId,
        T[lang].pairCreated(code),
        inviteButton(
          code,
          lang,
          botUsername,
        ),
      );

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
      const { data: pair } = await supabase.from('pairs').select('*').eq('code', code).maybeSingle();
      if (!pair) { await sendMessage(env, chatId, T[lang].pairNotFound(code)); return new Response('OK'); }
      const { data: members } = await supabase.from('pair_users').select('user_id').eq('pair_code', code);
      if (members?.some(m => m.user_id === userId)) { await sendMessage(env, chatId, T[lang].alreadyInPair, webAppButton); return new Response('OK'); }
      if (members && members.length >= 2) { await sendMessage(env, chatId, T[lang].pairFull); return new Response('OK'); }
      await supabase.from('pair_users').insert({ pair_code: code, user_id: userId, display_name: firstName, username, timezone: null });
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
          await sendMessage(env, m.user_id, T[partnerLang].joinedNotify(escapeMd(firstName), code), webAppButton);
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
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).maybeSingle();
        if (!pair) continue;
        const lv = getLevel(pair.growth_points || 0);
        const name = escapeMd(pair.pet_name || lv.name);
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
        const { data: pair } = await supabase.from('pairs').select('*').eq('code', up.pair_code).maybeSingle();
        if (!pair) continue;
        const { data: members } = await supabase.from('pair_users').select('user_id, display_name').eq('pair_code', up.pair_code);
        const lv = getLevel(pair.growth_points || 0);
        const name = escapeMd(pair.pet_name || lv.name);
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

    // /broadcast ТЕКСТ — постановка рассылки в очередь
    if (
      /^\/broadcast(?:@\w+)?(?:\s|$)/i.test(
        text,
      )
    ) {
      if (!ADMIN_IDS.includes(userId)) {
        return new Response('OK');
      }

      const broadcastText =
        text
          .replace(
            /^\/broadcast(?:@\w+)?\s*/i,
            '',
          )
          .trim();

      if (!broadcastText) {
        await sendMessage(
          env,
          chatId,
          `⚠️ *Не указан текст сообщения.*\n\n` +
            `Использование:\n` +
            `/broadcast Текст сообщения`,
        );

        return new Response('OK');
      }

      if (
        Array.from(broadcastText).length >
        4000
      ) {
        await sendMessage(
          env,
          chatId,
          '⚠️ Сообщение слишком длинное. Максимум — 4000 символов.',
        );

        return new Response('OK');
      }

      const {
        data: createdJobs,
        error: createError,
      } = await supabase.rpc(
        'create_broadcast_job',
        {
          p_message_text:
            broadcastText,
          p_created_by:
            userId,
          p_admin_chat_id:
            String(chatId),
        },
      );

      if (createError) {
        console.error(
          'Broadcast queue creation failed:',
          createError,
        );

        await sendMessage(
          env,
          chatId,
          `❌ *Не удалось создать рассылку*\n\n` +
            `${escapeMd(createError.message || 'Unknown database error')}`,
        );

        return new Response('OK');
      }

      const createdJob =
        Array.isArray(createdJobs)
          ? createdJobs[0]
          : createdJobs;

      if (!createdJob?.job_id) {
        await sendMessage(
          env,
          chatId,
          '❌ База данных не вернула ID рассылки.',
        );

        return new Response('OK');
      }

      await sendMessage(
        env,
        chatId,
        `✅ *Рассылка поставлена в очередь*\n\n` +
          `🆔 Задание: \`${createdJob.job_id}\`\n` +
          `👥 Получателей: *${createdJob.recipient_count || 0}*\n\n` +
          `Обработка начнётся автоматически в течение минуты.`,
        adminMenuButtons(),
      );

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
      const { count: totalSkins } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true });

      const msg = `📊 *Chumi stats*\n\n` +
        `👥 Users: *${totalUsers ?? 0}*\n` +
        `🐾 Pairs: *${totalPairs ?? 0}* (alive: ${alivePairs ?? 0}, dead: ${deadPairs ?? 0})\n` +
        `🎨 Skins owned: *${totalSkins ?? 0}*`;
      await sendMessage(env, chatId, msg, webAppButton);
      return new Response('OK');
    }

    // /users — полный список всех пользователей (только для админа)
    if (text === '/users') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      // Все, кто запускал бота (есть запись в user_settings), новые сверху
      const { data: allUsers } = await supabase
        .from('user_settings')
        .select('telegram_user_id, lang, created_at')
        .order('created_at', { ascending: false });

      const list = allUsers || [];
      if (list.length === 0) {
        await sendMessage(env, chatId, '👥 Пользователей пока нет.');
        return new Response('OK');
      }

      // Подтягиваем имена/username из pair_users (у кого они есть)
      const { data: named } = await supabase
        .from('pair_users')
        .select('user_id, display_name, username');

      const nameMap = new Map();
      for (const n of (named || [])) {
        if (!nameMap.has(n.user_id)) {
          nameMap.set(n.user_id, {
            display_name: n.display_name || null,
            username: n.username || null,
          });
        }
      }

      // Формируем строки
      const lines = list.map((u, i) => {
        const info = nameMap.get(u.telegram_user_id) || {};
        const name = info.display_name ? escapeMd(info.display_name) : '—';
        const uname = info.username ? '@' + escapeMd(info.username) : 'no username';
        const date = u.created_at
          ? new Date(u.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
          : '—';
        return `${i + 1}. ${name} (${uname}) \`${u.telegram_user_id}\` [${u.lang || '—'}] ${date}`;
      });

      // Разбиваем на части по ~3500 символов, чтобы влезть в лимит Telegram
      const header = `👥 *Всего пользователей: ${list.length}*\n\n`;
      let chunk = header;
      const chunks = [];
      for (const line of lines) {
        if ((chunk + line + '\n').length > 3500) {
          chunks.push(chunk);
          chunk = '';
        }
        chunk += line + '\n';
      }
      if (chunk.trim()) chunks.push(chunk);

      // Отправляем по частям
      for (const part of chunks) {
        await sendMessage(env, chatId, part);
      }
      return new Response('OK');
    }

        // /summary — ручной запуск ежедневной сводки (только для админа)
    if (text === '/summary') {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      // Зовём эндпоинт с CRON_SECRET в заголовке
      const r = await fetch(`${env.BASE_URL || WEBAPP_URL}/api/admin-daily-summary`, {
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

        // /grantbee USER_ID — только для админа, выдаёт скин "Пчёлка" и уведомляет
    if (text.startsWith('/grantbee')) {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      const parts = text.split(/\s+/);
      const targetId = (parts[1] || '').trim();
      if (!targetId || !/^\d+$/.test(targetId)) {
        await sendMessage(env, chatId, '⚠️ Использование: `/grantbee USER_ID`');
        return new Response('OK');
      }

      // Проверяем, нет ли уже у пользователя этого скина
      const { data: already } = await supabase
        .from('user_skins')
        .select('id')
        .eq('user_id', targetId)
        .eq('skin_id', 'bee')
        .maybeSingle();

      if (already) {
        await sendMessage(env, chatId, `ℹ️ У пользователя \`${targetId}\` уже есть наряд *Пчёлка*.`);
        return new Response('OK');
      }

      // Выдаём скин
      const { error: insErr } = await supabase
        .from('user_skins')
        .insert({ user_id: targetId, skin_id: 'bee' });

      if (insErr) {
        await sendMessage(env, chatId, `❌ Ошибка: \`${insErr.message}\``);
        return new Response('OK');
      }

      // Уведомляем получателя на его языке
      const targetLang = await getUserLang(supabase, targetId);
      const notifyText = targetLang === 'ru'
        ? `🎁 Тебе подарили наряд *Пчёлка* 🐝!\n\nОткрой Chumi → *Наряды* → *Магазин* — он уже у тебя.`
        : `🎁 You've been gifted the *Bee* outfit 🐝!\n\nOpen Chumi → *Outfits* → *Shop* — it's yours.`;

      try {
        await sendMessage(env, targetId, notifyText, webAppButton);
      } catch (e) {
        await sendMessage(env, chatId, `⚠️ Скин выдан, но не удалось отправить уведомление: \`${e.message}\``);
        return new Response('OK');
      }

      await sendMessage(env, chatId,
        `✅ Наряд *Пчёлка* выдан пользователю \`${targetId}\` и отправлено уведомление.`);
      return new Response('OK');
    }

        // /grantslot USER_ID — только для админа, выдаёт бесплатный доп. слот
    if (text.startsWith('/grantslot')) {
      if (!ADMIN_IDS.includes(userId)) return new Response('OK');

      const parts = text.split(/\s+/);
      const targetId = (parts[1] || '').trim();
      if (!targetId || !/^\d+$/.test(targetId)) {
        await sendMessage(env, chatId, '⚠️ Использование: `/grantslot USER_ID`');
        return new Response('OK');
      }

      // Прибавляем один слот: если запись есть — инкремент, иначе создаём
      const { data: existing } = await supabase
        .from('user_slots')
        .select('extra_slots')
        .eq('telegram_user_id', targetId)
        .maybeSingle();

      let newTotal;
      if (existing) {
        newTotal = (existing.extra_slots || 0) + 1;
        const { error: updErr } = await supabase
          .from('user_slots')
          .update({ extra_slots: newTotal })
          .eq('telegram_user_id', targetId);
        if (updErr) {
          await sendMessage(env, chatId, `❌ Ошибка: \`${updErr.message}\``);
          return new Response('OK');
        }
      } else {
        newTotal = 1;
        const { error: insErr } = await supabase
          .from('user_slots')
          .insert({ telegram_user_id: targetId, extra_slots: 1 });
        if (insErr) {
          await sendMessage(env, chatId, `❌ Ошибка: \`${insErr.message}\``);
          return new Response('OK');
        }
      }

      // Уведомляем получателя на его языке
      const targetLang = await getUserLang(supabase, targetId);
      const notifyText = targetLang === 'ru'
        ? `🎁 Тебе подарили дополнительный слот для пары!\n\nТеперь у тебя на 1 пару больше. Открой Chumi и создай новую пару 🐾`
        : `🎁 You've been gifted an extra pair slot!\n\nYou can now create one more pair. Open Chumi and start a new one 🐾`;

      try {
        await sendMessage(env, targetId, notifyText, webAppButton);
      } catch (e) {
        await sendMessage(env, chatId, `⚠️ Слот выдан, но не удалось отправить уведомление: \`${e.message}\``);
        return new Response('OK');
      }

      await sendMessage(env, chatId,
        `✅ Дополнительный слот выдан пользователю \`${targetId}\`.\nВсего доп. слотов у него теперь: *${newTotal}*.`);
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
