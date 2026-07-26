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

async function copyTelegramMessage(
  env,
  chatId,
  sourceChatId,
  sourceMessageId,
  buttons = [],
) {
  try {
    const body = {
      chat_id: chatId,
      from_chat_id: sourceChatId,
      message_id: Number(sourceMessageId),
    };

    if (
      Array.isArray(buttons) &&
      buttons.length > 0
    ) {
      body.reply_markup = {
        inline_keyboard: buttons,
      };
    }

    const response = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (
      !response.ok ||
      data.ok === false
    ) {
      return {
        ok: false,
        status: response.status,
        description:
          data.description ||
          'Telegram copyMessage failed',
      };
    }

    return {
      ok: true,
      messageId:
        data.result?.message_id ||
        null,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        String(
          error?.message ||
          error,
        ),
    };
  }
}

async function callTelegramBotApi(
  env,
  method,
  body = {},
) {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response
      .json()
      .catch(() => ({}));

    if (
      !response.ok ||
      data.ok === false
    ) {
      return {
        ok: false,
        networkError: false,
        status:
          response.status,
        description:
          data.description ||
          `Telegram ${method} failed`,
        errorCode:
          data.error_code ||
          null,
      };
    }

    return {
      ok: true,
      result:
        data.result,
    };
  } catch (error) {
    return {
      ok: false,
      networkError: true,
      status: 0,
      description:
        String(
          error?.message ||
          error,
        ),
    };
  }
}

function rewardWeekToKey(
  weekStart,
) {
  return String(
    weekStart || '',
  ).replace(
    /-/g,
    '',
  );
}

function rewardKeyToWeek(
  weekKey,
) {
  const match =
    String(weekKey || '').match(
      /^(\d{4})(\d{2})(\d{2})$/,
    );

  if (!match) {
    return null;
  }

  const weekStart =
    `${match[1]}-${match[2]}-${match[3]}`;

  const date =
    new Date(
      `${weekStart}T00:00:00.000Z`,
    );

  if (
    !Number.isFinite(
      date.getTime(),
    ) ||
    date.toISOString().slice(0, 10) !==
      weekStart
  ) {
    return null;
  }

  return weekStart;
}

function getPreviousUtcWeekStart() {
  const date = new Date();

  const day =
    date.getUTCDay();

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1;

  date.setUTCHours(
    0,
    0,
    0,
    0,
  );

  date.setUTCDate(
    date.getUTCDate() -
    daysSinceMonday -
    7,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

async function getAvailableTelegramGifts(
  env,
) {
  const response =
    await callTelegramBotApi(
      env,
      'getAvailableGifts',
    );

  if (!response.ok) {
    return {
      ok: false,
      gifts: [],
      ...response,
    };
  }

  const gifts =
    Array.isArray(
      response.result?.gifts,
    )
      ? response.result.gifts
      : [];

  gifts.sort(
    (
      firstGift,
      secondGift,
    ) => {
      const priceDifference =
        Number(
          firstGift.star_count,
        ) -
        Number(
          secondGift.star_count,
        );

      if (priceDifference !== 0) {
        return priceDifference;
      }

      return String(
        firstGift.id,
      ).localeCompare(
        String(
          secondGift.id,
        ),
      );
    },
  );

  return {
    ok: true,
    gifts,
  };
}

async function getTelegramBotStarBalance(
  env,
) {
  const response =
    await callTelegramBotApi(
      env,
      'getMyStarBalance',
    );

  if (!response.ok) {
    return {
      ok: false,
      amount: 0,
      ...response,
    };
  }

  return {
    ok: true,
    amount:
      Number(
        response.result?.amount,
      ) || 0,
    nanostarAmount:
      Number(
        response.result?.nanostar_amount,
      ) || 0,
  };
}

async function sendTelegramGiftPreview(
  env,
  chatId,
  gift,
) {
  const stickerFileId =
    gift?.sticker?.file_id;

  if (!stickerFileId) {
    return {
      ok: true,
      skipped: true,
    };
  }

  return callTelegramBotApi(
    env,
    'sendSticker',
    {
      chat_id:
        String(chatId),
      sticker:
        stickerFileId,
    },
  );
}

async function sendWeeklyRewardSummary(
  env,
  supabase,
  chatId,
  weekStart,
) {
  const {
    data: batch,
    error: batchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'week_start, status, winner_count, selected_gift_id, selected_gift_star_count, total_star_cost'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  if (batchError || !batch) {
    await sendMessage(
      env,
      chatId,
      '❌ Награды для этой недели не найдены.',
      adminMenuButtons(),
    );

    return;
  }

  const {
    data: rewards,
    error: rewardsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'position, user_id, display_name, username, best_score, status'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .order(
      'position',
      {
        ascending: true,
      },
    );

  if (rewardsError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить победителей:\n` +
        `${escapeMd(rewardsError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  const winnerLines =
    (rewards || []).map(
      reward => {
        const name =
          escapeMd(
            reward.display_name ||
            'Игрок',
          );

        const username =
          reward.username
            ? ` @${escapeMd(reward.username)}`
            : '';

        return (
          `${reward.position}. ${name}${username}\n` +
          `   ID: \`${reward.user_id}\` · ` +
          `${reward.best_score} очков · ` +
          `${reward.status}`
        );
      },
    );

  const selectedGiftText =
    batch.selected_gift_id
      ? (
          `🎁 Подарок: \`${escapeMd(batch.selected_gift_id)}\`\n` +
          `⭐ Цена одного: *${batch.selected_gift_star_count || 0}*\n` +
          `💰 Общая стоимость: *${batch.total_star_cost || 0} Stars*`
        )
      : '🎁 Подарок пока не выбран.';

  const keyboard = [];

  if (batch.status === 'draft') {
    keyboard.push([
      {
        text:
          batch.selected_gift_id
            ? '🔄 Изменить подарок'
            : '🎁 Выбрать подарок',
        callback_data:
          `admin_reward_page_${weekKey}_0`,
      },
    ]);

    if (batch.selected_gift_id) {
      keyboard.push([
        {
          text:
            '✅ Отправить топ-10',
          callback_data:
            `admin_reward_confirm_${weekKey}`,
        },
      ]);
    }
  }

  if (batch.status === 'partial') {
    keyboard.push([
      {
        text:
          '🔁 Повторить ошибки',
        callback_data:
          `admin_reward_retry_${weekKey}`,
      },
    ]);
  }

  keyboard.push([
    {
      text:
        '⬅️ В админ-панель',
      callback_data:
        'admin_menu',
    },
  ]);

  await sendMessage(
    env,
    chatId,
    `🏆 *Награды Chumi Jump*\n\n` +
      `📅 Неделя: \`${weekStart}\`\n` +
      `📌 Статус: *${escapeMd(batch.status)}*\n\n` +
      `${winnerLines.join('\n\n') || 'Победителей нет.'}\n\n` +
      `${selectedGiftText}`,
    {
      reply_markup: {
        inline_keyboard:
          keyboard,
      },
    },
  );
}

async function sendWeeklyGiftCatalogPage(
  env,
  supabase,
  chatId,
  weekStart,
  requestedIndex,
) {
  const {
    data: batch,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'status, winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  if (!batch) {
    await sendMessage(
      env,
      chatId,
      '❌ Недельное награждение не найдено.',
      adminMenuButtons(),
    );

    return;
  }

  if (batch.status !== 'draft') {
    await sendMessage(
      env,
      chatId,
      '⚠️ Выбор подарка уже закрыт.',
      adminMenuButtons(),
    );

    return;
  }

  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось получить каталог подарков:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const gifts =
    catalog.gifts.filter(
      gift =>
        gift?.id &&
        Number(
          gift.star_count,
        ) > 0 &&
        (
          gift.remaining_count ===
            undefined ||
          gift.remaining_count ===
            null ||
          Number(
            gift.remaining_count,
          ) > 0
        ),
    );

  if (gifts.length === 0) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Сейчас Telegram не вернул доступных подарков.',
      adminMenuButtons(),
    );

    return;
  }

  const index =
    Math.min(
      Math.max(
        Number(
          requestedIndex,
        ) || 0,
        0,
      ),
      gifts.length - 1,
    );

  const gift =
    gifts[index];

  await sendTelegramGiftPreview(
    env,
    chatId,
    gift,
  );

  const balance =
    await getTelegramBotStarBalance(
      env,
    );

  const remainingText =
    gift.remaining_count ===
      undefined ||
    gift.remaining_count ===
      null
      ? 'без указанного лимита'
      : String(
          gift.remaining_count,
        );

  const requiredStars =
    Number(
      gift.star_count,
    ) *
    Number(
      batch.winner_count,
    );

  const previousIndex =
    index > 0
      ? index - 1
      : gifts.length - 1;

  const nextIndex =
    index < gifts.length - 1
      ? index + 1
      : 0;

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  const giftId =
    String(
      gift.id,
    );

  const selectCallback =
    `admin_reward_select_${weekKey}_${giftId}`;

  if (selectCallback.length > 64) {
    await sendMessage(
      env,
      chatId,
      '❌ Идентификатор подарка слишком длинный для Telegram callback.',
      adminMenuButtons(),
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    `🎁 *Подарок ${index + 1} из ${gifts.length}*\n\n` +
      `ID: \`${escapeMd(giftId)}\`\n` +
      `⭐ Цена: *${Number(gift.star_count)} Stars*\n` +
      `📦 Осталось: *${escapeMd(remainingText)}*\n` +
      `👥 Получателей: *${batch.winner_count}*\n` +
      `💰 Нужно: *${requiredStars} Stars*\n` +
      `🏦 Баланс бота: *${balance.ok ? balance.amount : 'не удалось получить'}*`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '⬅️',
              callback_data:
                `admin_reward_page_${weekKey}_${previousIndex}`,
            },
            {
              text:
                `${index + 1}/${gifts.length}`,
              callback_data:
                `admin_reward_page_${weekKey}_${index}`,
            },
            {
              text:
                '➡️',
              callback_data:
                `admin_reward_page_${weekKey}_${nextIndex}`,
            },
          ],
          [
            {
              text:
                `✅ Выбрать за ${gift.star_count} ⭐`,
              callback_data:
                selectCallback,
            },
          ],
          [
            {
              text:
                '📋 К списку победителей',
              callback_data:
                `admin_reward_open_${weekKey}`,
            },
          ],
        ],
      },
    },
  );
}

async function selectWeeklyTelegramGift(
  env,
  supabase,
  chatId,
  weekStart,
  giftId,
) {
  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить подарок:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const gift =
    catalog.gifts.find(
      catalogGift =>
        String(
          catalogGift.id,
        ) ===
        String(
          giftId,
        ),
    );

  if (!gift) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Подарок больше не доступен. Выберите другой.',
      adminMenuButtons(),
    );

    return;
  }

  const {
    data: batch,
    error: batchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'winner_count, status'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      'draft',
    )
    .maybeSingle();

  if (batchError || !batch) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Выбор подарка уже закрыт.',
      adminMenuButtons(),
    );

    return;
  }

  const starCount =
    Number(
      gift.star_count,
    ) || 0;

  const totalCost =
    starCount *
    Number(
      batch.winner_count,
    );

  const remainingCount =
    gift.remaining_count ===
      undefined ||
    gift.remaining_count ===
      null
      ? null
      : Number(
          gift.remaining_count,
        );

  const {
    error: updateBatchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update({
      selected_gift_id:
        String(gift.id),
      selected_gift_star_count:
        starCount,
      selected_gift_remaining_count:
        remainingCount,
      total_star_cost:
        totalCost,
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      'draft',
    );

  if (updateBatchError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось сохранить подарок:\n` +
        `${escapeMd(updateBatchError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  const {
    error: updateRewardsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .update({
      gift_id:
        String(gift.id),
      gift_star_count:
        starCount,
      status:
        'selected',
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'week_start',
      weekStart,
    )
    .in(
      'status',
      [
        'pending',
        'selected',
      ],
    );

  if (updateRewardsError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось обновить награды:\n` +
        `${escapeMd(updateRewardsError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  await sendWeeklyRewardSummary(
    env,
    supabase,
    chatId,
    weekStart,
  );
}

// Старая версия выдачи сохранена для обработки устаревших данных.
// eslint-disable-next-line no-unused-vars
async function processWeeklyTelegramGifts(
  env,
  supabase,
  chatId,
  weekStart,
  retryFailed = false,
) {
  const expectedBatchStatus =
    retryFailed
      ? 'partial'
      : 'draft';

  const {
    data: batch,
    error: batchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'week_start, status, winner_count, selected_gift_id, selected_gift_star_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      expectedBatchStatus,
    )
    .maybeSingle();

  if (
    batchError ||
    !batch
  ) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Награждение уже запущено, завершено или недоступно.',
      adminMenuButtons(),
    );

    return;
  }

  if (!batch.selected_gift_id) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Сначала выберите подарок.',
      adminMenuButtons(),
    );

    return;
  }

  const targetStatuses =
    retryFailed
      ? [
          'failed',
        ]
      : [
          'pending',
          'selected',
          'failed',
        ];

  const {
    data: recipients,
    error: recipientsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'id, position, user_id, display_name, best_score, status, attempts'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .in(
      'status',
      targetStatuses,
    )
    .order(
      'position',
      {
        ascending: true,
      },
    );

  if (recipientsError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить получателей:\n` +
        `${escapeMd(recipientsError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  if (
    !recipients ||
    recipients.length === 0
  ) {
    await sendMessage(
      env,
      chatId,
      'ℹ️ Нет наград, которые можно безопасно отправить повторно.',
      adminMenuButtons(),
    );

    return;
  }

  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить каталог:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const currentGift =
    catalog.gifts.find(
      gift =>
        String(
          gift.id,
        ) ===
        String(
          batch.selected_gift_id,
        ),
    );

  if (!currentGift) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Выбранный подарок больше не доступен.',
      adminMenuButtons(),
    );

    return;
  }

  const giftPrice =
    Number(
      currentGift.star_count,
    ) || 0;

  const requiredStars =
    giftPrice *
    recipients.length;

  const remainingCount =
    currentGift.remaining_count ===
      undefined ||
    currentGift.remaining_count ===
      null
      ? null
      : Number(
          currentGift.remaining_count,
        );

  if (
    remainingCount !== null &&
    remainingCount <
      recipients.length
  ) {
    await sendMessage(
      env,
      chatId,
      `⚠️ Подарков недостаточно.\n\n` +
        `Нужно: *${recipients.length}*\n` +
        `Осталось: *${remainingCount}*`,
      adminMenuButtons(),
    );

    return;
  }

  const balance =
    await getTelegramBotStarBalance(
      env,
    );

  if (!balance.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить баланс бота:\n` +
        `${escapeMd(balance.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  if (
    balance.amount <
    requiredStars
  ) {
    await sendMessage(
      env,
      chatId,
      `⚠️ *Недостаточно Stars*\n\n` +
        `Баланс: *${balance.amount} ⭐*\n` +
        `Нужно: *${requiredStars} ⭐*\n` +
        `Не хватает: *${requiredStars - balance.amount} ⭐*`,
      adminMenuButtons(),
    );

    return;
  }

  const {
    data: claimedBatch,
    error: claimError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update({
      status:
        'sending',
      sending_started_at:
        new Date().toISOString(),
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      expectedBatchStatus,
    )
    .select(
      'week_start'
    )
    .maybeSingle();

  if (
    claimError ||
    !claimedBatch
  ) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Награждение уже было запущено другим запросом.',
      adminMenuButtons(),
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    `⏳ Начинаю отправку подарков.\n\n` +
      `Получателей: *${recipients.length}*\n` +
      `Стоимость: *${requiredStars} ⭐*`,
    {
      reply_markup: {
        inline_keyboard: [],
      },
    },
  );

  for (const recipient of recipients) {
    const attemptedAt =
      new Date().toISOString();

    const {
      data: claimedReward,
      error: rewardClaimError,
    } = await supabase
      .from(
        'weekly_game_rewards',
      )
      .update({
        status:
          'sending',
        attempts:
          Number(
            recipient.attempts,
          ) + 1,
        attempted_at:
          attemptedAt,
        updated_at:
          attemptedAt,
        last_error:
          null,
      })
      .eq(
        'id',
        recipient.id,
      )
      .in(
        'status',
        targetStatuses,
      )
      .select(
        'id'
      )
      .maybeSingle();

    if (
      rewardClaimError ||
      !claimedReward
    ) {
      continue;
    }

    const telegramUserId =
      Number(
        recipient.user_id,
      );

    if (
      !Number.isSafeInteger(
        telegramUserId,
      ) ||
      telegramUserId <= 0
    ) {
      await supabase
        .from(
          'weekly_game_rewards',
        )
        .update({
          status:
            'failed',
          last_error:
            'Invalid Telegram user ID',
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          'id',
          recipient.id,
        );

      continue;
    }

    const delivery =
      await callTelegramBotApi(
        env,
        'sendGift',
        {
          user_id:
            telegramUserId,
          gift_id:
            String(
              currentGift.id,
            ),
          text:
            `🏆 ${recipient.position} место в недельном рейтинге Chumi Jump!`,
        },
      );

    if (delivery.ok) {
      const sentAt =
        new Date().toISOString();

      await supabase
        .from(
          'weekly_game_rewards',
        )
        .update({
          status:
            'sent',
          gift_id:
            String(
              currentGift.id,
            ),
          gift_star_count:
            giftPrice,
          sent_at:
            sentAt,
          updated_at:
            sentAt,
          last_error:
            null,
        })
        .eq(
          'id',
          recipient.id,
        );

      continue;
    }

    /*
     * При сетевой ошибке результат неизвестен:
     * Telegram мог принять подарок, но ответ не дошёл.
     * Автоматически такой подарок не повторяем.
     */
    const failedStatus =
      delivery.networkError
        ? 'unknown'
        : 'failed';

    await supabase
      .from(
        'weekly_game_rewards',
      )
      .update({
        status:
          failedStatus,
        last_error:
          String(
            delivery.description ||
            'Unknown Telegram error',
          ).slice(
            0,
            1000,
          ),
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        recipient.id,
      );
  }

  const {
    data: finalRewards,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'status'
    )
    .eq(
      'week_start',
      weekStart,
    );

  const statusCounts = {
    sent: 0,
    failed: 0,
    unknown: 0,
    pending: 0,
    selected: 0,
    sending: 0,
  };

  for (const reward of (
    finalRewards || []
  )) {
    if (
      Object.prototype.hasOwnProperty.call(
        statusCounts,
        reward.status,
      )
    ) {
      statusCounts[
        reward.status
      ] += 1;
    }
  }

  const totalCount =
    (finalRewards || []).length;

  const completed =
    totalCount > 0 &&
    statusCounts.sent ===
      totalCount;

  const completedAt =
    completed
      ? new Date().toISOString()
      : null;

  await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update({
      status:
        completed
          ? 'completed'
          : 'partial',
      selected_gift_id:
        String(
          currentGift.id,
        ),
      selected_gift_star_count:
        giftPrice,
      total_star_cost:
        giftPrice *
        totalCount,
      updated_at:
        new Date().toISOString(),
      completed_at:
        completedAt,
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      'sending',
    );

  const keyboard = [];

  if (statusCounts.failed > 0) {
    keyboard.push([
      {
        text:
          '🔁 Повторить ошибки',
        callback_data:
          `admin_reward_retry_${rewardWeekToKey(weekStart)}`,
      },
    ]);
  }

  keyboard.push([
    {
      text:
        '⬅️ В админ-панель',
      callback_data:
        'admin_menu',
    },
  ]);

  await sendMessage(
    env,
    chatId,
    `🎁 *Выдача недельных наград завершена*\n\n` +
      `✅ Отправлено: *${statusCounts.sent}*\n` +
      `❌ Ошибки Telegram: *${statusCounts.failed}*\n` +
      `❓ Неизвестный результат: *${statusCounts.unknown}*\n\n` +
      (
        statusCounts.unknown > 0
          ? `Подарки со статусом unknown не повторяются автоматически, чтобы исключить двойную выдачу.`
          : `Все безопасные попытки обработаны.`
      ),
    {
      reply_markup: {
        inline_keyboard:
          keyboard,
      },
    },
  );
}

async function getActiveBusinessConnection(
  supabase,
  adminUserId,
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      'telegram_business_connections',
    )
    .select(
      'connection_id, owner_user_id, user_chat_id, is_enabled, can_transfer_stars'
    )
    .eq(
      'owner_user_id',
      String(adminUserId),
    )
    .eq(
      'is_enabled',
      true,
    )
    .order(
      'updated_at',
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      'Business connection query failed:',
      error,
    );

    return null;
  }

  return data || null;
}

async function getWeeklyRewardsEnabled(
  supabase,
) {
  const {
    data,
    error,
  } = await supabase
    .from('app_settings')
    .select('enabled')
    .eq(
      'key',
      'weekly_game_rewards_enabled',
    )
    .maybeSingle();

  if (error) {
    console.error(
      'Weekly rewards setting query failed:',
      error,
    );

    return false;
  }

  return data?.enabled === true;
}

async function sendWeeklyRewardsSettings(
  env,
  supabase,
  chatId,
) {
  const enabled =
    await getWeeklyRewardsEnabled(
      supabase,
    );

  await sendMessage(
    env,
    chatId,
    `⚙️ *Настройки раздачи подарков*\n\n` +
      `Статус: *${enabled ? 'включена' : 'выключена'}*\n\n` +
      (
        enabled
          ? (
              `Каждый понедельник бот подготовит список победителей ` +
              `и пришлёт кнопку для выбора подарков.`
            )
          : (
              `Недельный отчёт по рейтингу продолжит приходить, ` +
              `но награждение готовиться не будет.`
            )
      ),
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                enabled
                  ? '🔴 Выключить раздачу'
                  : '🟢 Включить раздачу',
              callback_data:
                enabled
                  ? 'admin_rewards_off'
                  : 'admin_rewards_on',
            },
          ],
          [
            {
              text:
                '🎁 Открыть награды',
              callback_data:
                'admin_weekly_rewards',
            },
          ],
          [
            {
              text:
                '⬅️ В админ-панель',
              callback_data:
                'admin_menu',
            },
          ],
        ],
      },
    },
  );
}

async function setWeeklyRewardsEnabled(
  env,
  supabase,
  chatId,
  adminUserId,
  enabled,
) {
  const {
    error,
  } = await supabase
    .from('app_settings')
    .upsert(
      {
        key:
          'weekly_game_rewards_enabled',
        enabled:
          Boolean(enabled),
        updated_at:
          new Date().toISOString(),
        updated_by:
          String(adminUserId),
      },
      {
        onConflict: 'key',
      },
    );

  if (error) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось сохранить настройку:\n` +
        `${escapeMd(error.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  await sendWeeklyRewardsSettings(
    env,
    supabase,
    chatId,
  );
}

async function sendStarsTopupInvoice(
  env,
  chatId,
  adminUserId,
  starCount,
) {
  const invoice =
    await callTelegramBotApi(
      env,
      'createInvoiceLink',
      {
        title:
          'Пополнение баланса бота',
        description:
          `Перевод ${starCount} Stars на баланс Chumi для выдачи подарков.`,
        payload:
          JSON.stringify({
            t: 'stars_topup',
            a: starCount,
            u: String(adminUserId),
          }),
        provider_token: '',
        currency: 'XTR',
        prices: [
          {
            label:
              'Bot balance top-up',
            amount:
              starCount,
          },
        ],
      },
    );

  if (
    !invoice.ok ||
    typeof invoice.result !== 'string'
  ) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось создать счёт:\n` +
        `${escapeMd(invoice.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    `🧾 *Счёт на пополнение готов*\n\n` +
      `Сумма: *${starCount} ⭐*\n\n` +
      `Оплатите его со своего аккаунта — Stars зачислятся на баланс бота полностью, без комиссии.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                `⭐ Оплатить ${starCount} Stars`,
              url:
                invoice.result,
            },
          ],
          [
            {
              text:
                '🔄 Проверить баланс',
              callback_data:
                'admin_stars_balance',
            },
          ],
        ],
      },
    },
  );
}

async function sendStarsBalancePanel(
  env,
  supabase,
  chatId,
  adminUserId,
) {
  const balance =
    await getTelegramBotStarBalance(
      env,
    );

  const connection =
    await getActiveBusinessConnection(
      supabase,
      adminUserId,
    );

  const balanceText =
    balance.ok
      ? `${balance.amount} Stars`
      : 'не удалось получить';

  let connectionText =
    'Business-аккаунт не подключён.';

  if (connection) {
    connectionText =
      connection.can_transfer_stars
        ? 'подключён, перевод Stars разрешён'
        : 'подключён, но нет разрешения can_transfer_stars';
  }

  const keyboard = [
    [
      {
        text:
          '🧾 Пополнить инвойсом',
        callback_data:
          'admin_stars_invoice',
      },
    ],
    [
      {
        text:
          '🔄 Обновить баланс',
        callback_data:
          'admin_stars_balance',
      },
    ],
  ];

  if (
    connection?.can_transfer_stars
  ) {
    keyboard.unshift([
      {
        text:
          '➕ Перевести с Business',
        callback_data:
          'admin_stars_topup',
      },
    ]);
  }

  keyboard.push([
    {
      text:
        '⬅️ В админ-панель',
      callback_data:
        'admin_menu',
    },
  ]);

  await sendMessage(
    env,
    chatId,
    `⭐ *Баланс бота*\n\n` +
      `Текущий баланс: *${escapeMd(balanceText)}*\n\n` +
      `Business-подключение: ${escapeMd(connectionText)}`,
    {
      reply_markup: {
        inline_keyboard:
          keyboard,
      },
    },
  );
}

function getRewardPlaceLabel(
  position,
) {
  if (position === 1) {
    return '🥇 1 место';
  }

  if (position === 2) {
    return '🥈 2 место';
  }

  if (position === 3) {
    return '🥉 3 место';
  }

  if (position === 0) {
    return 'все места';
  }

  return `${position} место`;
}

async function setWeeklyWinnerCount(
  env,
  supabase,
  chatId,
  weekStart,
  requestedCount,
) {
  const {
    count: availableCount,
    error: countError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      '*',
      {
        count: 'exact',
        head: true,
      },
    )
    .eq(
      'week_start',
      weekStart,
    );

  if (
    countError ||
    !availableCount
  ) {
    await sendMessage(
      env,
      chatId,
      '❌ Не удалось определить количество победителей.',
      adminMenuButtons(),
    );

    return;
  }

  const nextCount =
    Math.min(
      Math.max(
        Number(
          requestedCount,
        ) || 1,
        1,
      ),
      Number(
        availableCount,
      ),
    );

  const {
    data: updatedBatch,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update({
      winner_count:
        nextCount,
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      'draft',
    )
    .select(
      'week_start'
    )
    .maybeSingle();

  if (!updatedBatch) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Менять число призовых мест можно только до отправки подарков.',
      adminMenuButtons(),
    );

    return;
  }

  await sendWeeklyRewardSummaryV2(
    env,
    supabase,
    chatId,
    weekStart,
  );
}

async function sendWeeklyRewardSummaryV2(
  env,
  supabase,
  chatId,
  weekStart,
) {
  const {
    data: batch,
    error: batchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'week_start, status, winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  if (
    batchError ||
    !batch
  ) {
    await sendMessage(
      env,
      chatId,
      '❌ Награждение этой недели не найдено.',
      adminMenuButtons(),
    );

    return;
  }

  const {
    data: rewards,
    error: rewardsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'position, user_id, display_name, username, best_score, gift_id, gift_star_count, status, delivery_method'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .order(
      'position',
      {
        ascending: true,
      },
    );

  if (rewardsError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить награды:\n` +
        `${escapeMd(rewardsError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  const winnerCount =
    Math.max(
      1,
      Number(
        batch.winner_count,
      ) || 1,
    );

  const activeRewards =
    (rewards || []).filter(
      reward =>
        Number(
          reward.position,
        ) <= winnerCount,
    );

  const lines =
    activeRewards.map(
      reward => {
        const name =
          escapeMd(
            reward.display_name ||
            'Игрок',
          );

        const giftText =
          reward.gift_id
            ? `🎁 ${reward.gift_star_count || 0} ⭐`
            : '🎁 не выбран';

        const deliveryText =
          reward.status === 'sent'
            ? (
                reward.delivery_method ===
                'manual'
                  ? 'вручную'
                  : 'автоматически'
              )
            : reward.status;

        return (
          `${getRewardPlaceLabel(reward.position)} — ${name}\n` +
          `ID: \`${reward.user_id}\` · ` +
          `${reward.best_score} очков · ` +
          `${giftText} · ${escapeMd(deliveryText)}`
        );
      },
    );

  const totalCost =
    activeRewards.reduce(
      (
        sum,
        reward,
      ) =>
        sum +
        (
          Number(
            reward.gift_star_count,
          ) || 0
        ),
      0,
    );

  const allSelected =
    activeRewards.length > 0 &&
    activeRewards.every(
      reward =>
        Boolean(
          reward.gift_id,
        ),
    );

  const keyboard = [];

  if (batch.status === 'draft') {
    keyboard.push([
      {
        text:
          '➖ место',
        callback_data:
          `admin_reward2_count_${weekKey}_${winnerCount - 1}`,
      },
      {
        text:
          `🏅 мест: ${winnerCount}`,
        callback_data:
          `admin_reward_open_${weekKey}`,
      },
      {
        text:
          '➕ место',
        callback_data:
          `admin_reward2_count_${weekKey}_${winnerCount + 1}`,
      },
    ]);

    for (const reward of activeRewards) {
      keyboard.push([
        {
          text:
            `${getRewardPlaceLabel(reward.position)} — ` +
            (
              reward.gift_id
                ? `${reward.gift_star_count || 0} ⭐`
                : 'выбрать подарок'
            ),
          callback_data:
            `admin_reward2_place_${weekKey}_${reward.position}`,
        },
      ]);
    }

    keyboard.push([
      {
        text:
          '🎁 Один подарок всем',
        callback_data:
          `admin_reward2_place_${weekKey}_0`,
      },
    ]);

    keyboard.push([
      {
        text:
          '⭐ Проверить баланс',
        callback_data:
          'admin_stars_balance',
      },
    ]);

    keyboard.push([
      {
        text:
          '👤 Ручная выдача',
        callback_data:
          `admin_reward_manual_${weekKey}`,
      },
    ]);

    if (allSelected) {
      keyboard.push([
        {
          text:
            `✅ Проверить и отправить · ${totalCost} ⭐`,
          callback_data:
            `admin_reward2_send_${weekKey}`,
        },
      ]);
    }
  }

  if (batch.status === 'partial') {
    keyboard.push([
      {
        text:
          '🔁 Повторить подтверждённые ошибки',
        callback_data:
          `admin_reward2_retry_${weekKey}`,
      },
    ]);

    keyboard.push([
      {
        text:
          '👤 Ручная выдача',
        callback_data:
          `admin_reward_manual_${weekKey}`,
      },
    ]);

    keyboard.push([
      {
        text:
          '⭐ Проверить баланс',
        callback_data:
          'admin_stars_balance',
      },
    ]);
  }

  keyboard.push([
    {
      text:
        '⬅️ В админ-панель',
      callback_data:
        'admin_menu',
    },
  ]);

  await sendMessage(
    env,
    chatId,
    `🏆 *Награды Chumi Jump*\n\n` +
      `📅 Неделя: \`${weekStart}\`\n` +
      `📌 Статус: *${escapeMd(batch.status)}*\n` +
      `👥 Призовых мест: *${winnerCount}*\n` +
      `⭐ Выбрано подарков на: *${totalCost} Stars*\n\n` +
      `${lines.join('\n\n') || 'Победителей нет.'}`,
    {
      reply_markup: {
        inline_keyboard:
          keyboard,
      },
    },
  );
}

async function sendWeeklyGiftCatalogPageV2(
  env,
  supabase,
  chatId,
  weekStart,
  position,
  requestedIndex,
) {
  const {
    data: batch,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'status, winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  if (
    !batch ||
    batch.status !== 'draft'
  ) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Выбор подарков уже закрыт.',
      adminMenuButtons(),
    );

    return;
  }

  if (position !== 0) {
    const {
      data: reward,
    } = await supabase
      .from(
        'weekly_game_rewards',
      )
      .select(
        'position'
      )
      .eq(
        'week_start',
        weekStart,
      )
      .eq(
        'position',
        position,
      )
      .maybeSingle();

    if (!reward) {
      await sendMessage(
        env,
        chatId,
        '❌ Призовое место не найдено.',
        adminMenuButtons(),
      );

      return;
    }
  }

  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось получить каталог:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const gifts =
    catalog.gifts.filter(
      gift =>
        gift?.id &&
        Number(
          gift.star_count,
        ) > 0 &&
        (
          gift.remaining_count ===
            undefined ||
          gift.remaining_count ===
            null ||
          Number(
            gift.remaining_count,
          ) > 0
        ),
    );

  if (gifts.length === 0) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Сейчас нет доступных подарков.',
      adminMenuButtons(),
    );

    return;
  }

  const index =
    Math.min(
      Math.max(
        Number(
          requestedIndex,
        ) || 0,
        0,
      ),
      gifts.length - 1,
    );

  const gift =
    gifts[index];

  await sendTelegramGiftPreview(
    env,
    chatId,
    gift,
  );

  const balance =
    await getTelegramBotStarBalance(
      env,
    );

  const recipientCount =
    position === 0
      ? Number(
          batch.winner_count,
        )
      : 1;

  const totalCost =
    Number(
      gift.star_count,
    ) *
    recipientCount;

  const remainingText =
    gift.remaining_count ===
      undefined ||
    gift.remaining_count ===
      null
      ? 'без указанного лимита'
      : String(
          gift.remaining_count,
        );

  const previousIndex =
    index > 0
      ? index - 1
      : gifts.length - 1;

  const nextIndex =
    index < gifts.length - 1
      ? index + 1
      : 0;

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  await sendMessage(
    env,
    chatId,
    `🎁 *Подарок для ${escapeMd(getRewardPlaceLabel(position))}*\n\n` +
      `Подарок: *${index + 1} из ${gifts.length}*\n` +
      `ID: \`${escapeMd(String(gift.id))}\`\n` +
      `⭐ Цена одного: *${gift.star_count}*\n` +
      `👥 Получателей: *${recipientCount}*\n` +
      `💰 Общая стоимость: *${totalCost} ⭐*\n` +
      `📦 Осталось: *${escapeMd(remainingText)}*\n` +
      `🏦 Баланс бота: *${balance.ok ? balance.amount : 'неизвестен'} ⭐*`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '⬅️',
              callback_data:
                `admin_reward2_page_${weekKey}_${position}_${previousIndex}`,
            },
            {
              text:
                `${index + 1}/${gifts.length}`,
              callback_data:
                `admin_reward2_page_${weekKey}_${position}_${index}`,
            },
            {
              text:
                '➡️',
              callback_data:
                `admin_reward2_page_${weekKey}_${position}_${nextIndex}`,
            },
          ],
          [
            {
              text:
                `✅ Выбрать за ${gift.star_count} ⭐`,
              callback_data:
                `admin_reward2_pick_${weekKey}_${position}_${index}`,
            },
          ],
          [
            {
              text:
                '📋 К наградам',
              callback_data:
                `admin_reward_open_${weekKey}`,
            },
          ],
        ],
      },
    },
  );
}

async function selectWeeklyGiftV2(
  env,
  supabase,
  chatId,
  weekStart,
  position,
  giftIndex,
) {
  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить каталог:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const gifts =
    catalog.gifts.filter(
      gift =>
        gift?.id &&
        Number(
          gift.star_count,
        ) > 0 &&
        (
          gift.remaining_count ===
            undefined ||
          gift.remaining_count ===
            null ||
          Number(
            gift.remaining_count,
          ) > 0
        ),
    );

  const gift =
    gifts[
      Number(
        giftIndex,
      )
    ];

  if (!gift) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Каталог изменился. Выберите подарок заново.',
      adminMenuButtons(),
    );

    return;
  }

  let updateQuery =
    supabase
      .from(
        'weekly_game_rewards',
      )
      .update({
        gift_id:
          String(gift.id),
        gift_star_count:
          Number(
            gift.star_count,
          ),
        status:
          'selected',
        last_error:
          null,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'week_start',
        weekStart,
      )
      .in(
        'status',
        [
          'pending',
          'selected',
          'failed',
        ],
      );

  if (position !== 0) {
    updateQuery =
      updateQuery.eq(
        'position',
        position,
      );
  } else {
    const {
      data: batchForAll,
    } = await supabase
      .from(
        'weekly_game_reward_batches',
      )
      .select(
        'winner_count'
      )
      .eq(
        'week_start',
        weekStart,
      )
      .maybeSingle();

    updateQuery =
      updateQuery.lte(
        'position',
        Math.max(
          1,
          Number(
            batchForAll?.winner_count,
          ) || 1,
        ),
      );
  }

  const {
    data: updatedRewards,
    error: updateError,
  } = await updateQuery.select(
    'id'
  );

  if (
    updateError ||
    !updatedRewards?.length
  ) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось сохранить подарок.` +
        (
          updateError?.message
            ? `\n${escapeMd(updateError.message)}`
            : ''
        ),
      adminMenuButtons(),
    );

    return;
  }

  await sendWeeklyRewardSummaryV2(
    env,
    supabase,
    chatId,
    weekStart,
  );
}

async function processWeeklyGiftsV2(
  env,
  supabase,
  chatId,
  weekStart,
  retryFailed,
) {
  const expectedBatchStatus =
    retryFailed
      ? 'partial'
      : 'draft';

  const targetStatuses =
    retryFailed
      ? [
          'failed',
        ]
      : [
          'selected',
        ];

  const {
    data: batch,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'week_start, status, winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      expectedBatchStatus,
    )
    .maybeSingle();

  if (!batch) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Награждение уже запущено или завершено.',
      adminMenuButtons(),
    );

    return;
  }

  const winnerCount =
    Math.max(
      1,
      Number(
        batch.winner_count,
      ) || 1,
    );

  const {
    data: recipients,
    error: recipientsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'id, position, user_id, display_name, best_score, gift_id, gift_star_count, status, attempts'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .lte(
      'position',
      winnerCount,
    )
    .in(
      'status',
      targetStatuses,
    )
    .order(
      'position',
      {
        ascending: true,
      },
    );

  if (
    recipientsError ||
    !recipients?.length
  ) {
    await sendMessage(
      env,
      chatId,
      retryFailed
        ? 'ℹ️ Нет подтверждённых ошибок для повторной отправки.'
        : '⚠️ Сначала выберите подарок для каждого места.',
      adminMenuButtons(),
    );

    return;
  }

  if (!retryFailed) {
    const {
      count: totalRewardCount,
    } = await supabase
      .from(
        'weekly_game_rewards',
      )
      .select(
        '*',
        {
          count: 'exact',
          head: true,
        },
      )
      .eq(
        'week_start',
        weekStart,
      )
      .lte(
        'position',
        winnerCount,
      );

    if (
      recipients.length !==
      Number(
        totalRewardCount,
      )
    ) {
      await sendMessage(
        env,
        chatId,
        '⚠️ Подарок выбран не для каждого победителя.',
        adminMenuButtons(),
      );

      return;
    }
  }

  const catalog =
    await getAvailableTelegramGifts(
      env,
    );

  if (!catalog.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить каталог:\n` +
        `${escapeMd(catalog.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  const giftsById =
    new Map(
      catalog.gifts.map(
        gift => [
          String(gift.id),
          gift,
        ],
      ),
    );

  const requiredByGift =
    new Map();

  let totalCost = 0;

  for (const recipient of recipients) {
    const currentGift =
      giftsById.get(
        String(
          recipient.gift_id,
        ),
      );

    if (!currentGift) {
      await sendMessage(
        env,
        chatId,
        `⚠️ Подарок для ${getRewardPlaceLabel(recipient.position)} больше не доступен.`,
        adminMenuButtons(),
      );

      return;
    }

    if (
      Number(
        currentGift.star_count,
      ) !==
      Number(
        recipient.gift_star_count,
      )
    ) {
      await sendMessage(
        env,
        chatId,
        `⚠️ Цена подарка для ${getRewardPlaceLabel(recipient.position)} изменилась. Выберите подарок заново.`,
        adminMenuButtons(),
      );

      return;
    }

    totalCost +=
      Number(
        currentGift.star_count,
      );

    const giftId =
      String(
        currentGift.id,
      );

    requiredByGift.set(
      giftId,
      (
        requiredByGift.get(
          giftId,
        ) || 0
      ) + 1,
    );
  }

  for (const [
    giftId,
    requiredCount,
  ] of requiredByGift) {
    const gift =
      giftsById.get(
        giftId,
      );

    if (
      gift.remaining_count !==
        undefined &&
      gift.remaining_count !==
        null &&
      Number(
        gift.remaining_count,
      ) < requiredCount
    ) {
      await sendMessage(
        env,
        chatId,
        `⚠️ Недостаточно подарков \`${escapeMd(giftId)}\`.\n` +
          `Нужно: *${requiredCount}*\n` +
          `Осталось: *${gift.remaining_count}*`,
        adminMenuButtons(),
      );

      return;
    }
  }

  const balance =
    await getTelegramBotStarBalance(
      env,
    );

  if (!balance.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось проверить баланс:\n` +
        `${escapeMd(balance.description || 'Unknown Telegram error')}`,
      adminMenuButtons(),
    );

    return;
  }

  if (
    balance.amount <
    totalCost
  ) {
    await sendMessage(
      env,
      chatId,
      `⚠️ *Недостаточно Stars*\n\n` +
        `Баланс: *${balance.amount} ⭐*\n` +
        `Нужно: *${totalCost} ⭐*\n` +
        `Не хватает: *${totalCost - balance.amount} ⭐*`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '➕ Пополнить баланс',
                callback_data:
                  'admin_stars_topup',
              },
            ],
            [
              {
                text:
                  '📋 Вернуться к наградам',
                callback_data:
                  `admin_reward_open_${rewardWeekToKey(weekStart)}`,
              },
            ],
          ],
        },
      },
    );

    return;
  }

  const {
    data: claimedBatch,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update({
      status:
        'sending',
      sending_started_at:
        new Date().toISOString(),
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      expectedBatchStatus,
    )
    .select(
      'week_start'
    )
    .maybeSingle();

  if (!claimedBatch) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Награждение уже запущено другим запросом.',
      adminMenuButtons(),
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    `⏳ Отправляю подарки победителям.\n\n` +
      `Получателей: *${recipients.length}*\n` +
      `Стоимость: *${totalCost} ⭐*`,
    {
      reply_markup: {
        inline_keyboard: [],
      },
    },
  );

  for (const recipient of recipients) {
    const attemptedAt =
      new Date().toISOString();

    const {
      data: claimedReward,
    } = await supabase
      .from(
        'weekly_game_rewards',
      )
      .update({
        status:
          'sending',
        attempts:
          Number(
            recipient.attempts,
          ) + 1,
        attempted_at:
          attemptedAt,
        updated_at:
          attemptedAt,
        last_error:
          null,
      })
      .eq(
        'id',
        recipient.id,
      )
      .in(
        'status',
        targetStatuses,
      )
      .select(
        'id'
      )
      .maybeSingle();

    if (!claimedReward) {
      continue;
    }

    const telegramUserId =
      Number(
        recipient.user_id,
      );

    if (
      !Number.isSafeInteger(
        telegramUserId,
      ) ||
      telegramUserId <= 0
    ) {
      await supabase
        .from(
          'weekly_game_rewards',
        )
        .update({
          status:
            'failed',
          last_error:
            'Invalid Telegram user ID',
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          'id',
          recipient.id,
        );

      continue;
    }

    const delivery =
      await callTelegramBotApi(
        env,
        'sendGift',
        {
          user_id:
            telegramUserId,
          gift_id:
            String(
              recipient.gift_id,
            ),
          text:
            `🏆 ${recipient.position} место в недельном рейтинге Chumi Jump!`,
        },
      );

    if (delivery.ok) {
      const sentAt =
        new Date().toISOString();

      await supabase
        .from(
          'weekly_game_rewards',
        )
        .update({
          status:
            'sent',
          delivery_method:
            'automatic',
          manual_sent_by:
            null,
          manual_sent_at:
            null,
          sent_at:
            sentAt,
          updated_at:
            sentAt,
          last_error:
            null,
        })
        .eq(
          'id',
          recipient.id,
        );

      continue;
    }

    await supabase
      .from(
        'weekly_game_rewards',
      )
      .update({
        status:
          delivery.networkError
            ? 'unknown'
            : 'failed',
        last_error:
          String(
            delivery.description ||
            'Unknown Telegram error',
          ).slice(
            0,
            1000,
          ),
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        'id',
        recipient.id,
      );
  }

  const {
    data: finalRewards,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'status'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .lte(
      'position',
      winnerCount,
    );

  const sentCount =
    (finalRewards || []).filter(
      reward =>
        reward.status === 'sent',
    ).length;

  const failedCount =
    (finalRewards || []).filter(
      reward =>
        reward.status === 'failed',
    ).length;

  const unknownCount =
    (finalRewards || []).filter(
      reward =>
        reward.status === 'unknown',
    ).length;

  const completed =
    finalRewards?.length > 0 &&
    sentCount ===
      finalRewards.length;

  const batchUpdate = {
    status:
      completed
        ? 'completed'
        : 'partial',
    updated_at:
      new Date().toISOString(),
    completed_at:
      completed
        ? new Date().toISOString()
        : null,
  };

  if (!retryFailed) {
    batchUpdate.total_star_cost =
      totalCost;
  }

  await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .update(
      batchUpdate,
    )
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'status',
      'sending',
    );

  await sendMessage(
    env,
    chatId,
    `🎁 *Выдача наград завершена*\n\n` +
      `✅ Отправлено: *${sentCount}*\n` +
      `❌ Ошибки Telegram: *${failedCount}*\n` +
      `❓ Неизвестный результат: *${unknownCount}*\n\n` +
      (
        unknownCount > 0
          ? 'Статусы unknown не повторяются автоматически.'
          : 'Все безопасные попытки обработаны.'
      ),
    {
      reply_markup: {
        inline_keyboard: [
          ...(failedCount > 0
            ? [
                [
                  {
                    text:
                      '🔁 Повторить ошибки',
                    callback_data:
                      `admin_reward2_retry_${rewardWeekToKey(weekStart)}`,
                  },
                ],
              ]
            : []),
          [
            {
              text:
                '📋 Открыть награды',
              callback_data:
                `admin_reward_open_${rewardWeekToKey(weekStart)}`,
            },
          ],
        ],
      },
    },
  );
}

function getManualRewardProfileUrl(
  reward,
) {
  const username =
    String(
      reward?.username ||
      '',
    )
      .replace(
        /^@/,
        '',
      )
      .trim();

  if (
    /^[a-zA-Z0-9_]{5,32}$/.test(
      username,
    )
  ) {
    return (
      `https://t.me/${username}`
    );
  }

  return (
    `tg://user?id=${encodeURIComponent(
      String(
        reward?.user_id ||
        '',
      ),
    )}`
  );
}

async function sendManualRewardsPanel(
  env,
  supabase,
  chatId,
  weekStart,
) {
  const {
    data: batch,
    error: batchError,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'week_start, status, winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  if (
    batchError ||
    !batch
  ) {
    await sendMessage(
      env,
      chatId,
      '❌ Награждение этой недели не найдено.',
      adminMenuButtons(),
    );

    return;
  }

  const {
    data: rewards,
    error: rewardsError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'id, position, user_id, display_name, username, best_score, gift_id, gift_star_count, status, delivery_method'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .lte(
      'position',
      Math.max(
        1,
        Number(
          batch.winner_count,
        ) || 1,
      ),
    )
    .order(
      'position',
      {
        ascending: true,
      },
    );

  if (rewardsError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить награды:\n` +
        `${escapeMd(rewardsError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  const lines = [];
  const keyboard = [];

  for (const reward of (
    rewards || []
  )) {
    const name =
      escapeMd(
        reward.display_name ||
        'Игрок',
      );

    let statusText;

    if (
      reward.status === 'sent'
    ) {
      statusText =
        reward.delivery_method ===
          'manual'
          ? '✅ выдан вручную'
          : '✅ выдан автоматически';
    } else if (
      reward.status === 'unknown'
    ) {
      statusText =
        '❓ неизвестный результат — сначала проверьте профиль';
    } else if (
      reward.gift_id
    ) {
      statusText =
        '⏳ ожидает ручной выдачи';
    } else {
      statusText =
        '⚠️ подарок не выбран';
    }

    lines.push(
      `${getRewardPlaceLabel(reward.position)} — ${name}\n` +
      `ID: \`${reward.user_id}\`\n` +
      (
        reward.username
          ? `Username: @${escapeMd(reward.username)}\n`
          : ''
      ) +
      (
        reward.gift_id
          ? (
              `Подарок: \`${escapeMd(reward.gift_id)}\` · ` +
              `${reward.gift_star_count || 0} ⭐\n`
            )
          : ''
      ) +
      `Статус: ${statusText}`,
    );

    if (
      reward.status !== 'sent' &&
      reward.gift_id
    ) {
      keyboard.push([
        {
          text:
            `👤 Открыть профиль · ${reward.position} место`,
          url:
            getManualRewardProfileUrl(
              reward,
            ),
        },
        {
          text:
            '✅ Уже отправил',
          callback_data:
            `admin_reward_manual_mark_${weekKey}_${reward.position}`,
        },
      ]);
    }
  }

  keyboard.push([
    {
      text:
        '🔄 Обновить',
      callback_data:
        `admin_reward_manual_${weekKey}`,
    },
  ]);

  keyboard.push([
    {
      text:
        '📋 К наградам',
      callback_data:
        `admin_reward_open_${weekKey}`,
    },
  ]);

  await sendMessage(
    env,
    chatId,
    `👤 *Ручная выдача подарков*\n\n` +
      `📅 Неделя: \`${weekStart}\`\n\n` +
      `1. Откройте профиль победителя.\n` +
      `2. Отправьте выбранный подарок со своего аккаунта.\n` +
      `3. Вернитесь и нажмите «Уже отправил».\n\n` +
      `Бот не может проверить ручную отправку, поэтому внимательно сверяйте получателя и подарок.\n\n` +
      `${lines.join('\n\n') || 'Наград нет.'}`,
    {
      reply_markup: {
        inline_keyboard:
          keyboard,
      },
    },
  );
}

async function sendManualRewardConfirmation(
  env,
  supabase,
  chatId,
  weekStart,
  position,
) {
  const {
    data: reward,
    error,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      'position, user_id, display_name, username, gift_id, gift_star_count, status'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'position',
      position,
    )
    .maybeSingle();

  if (
    error ||
    !reward
  ) {
    await sendMessage(
      env,
      chatId,
      '❌ Награда не найдена.',
      adminMenuButtons(),
    );

    return;
  }

  const weekKey =
    rewardWeekToKey(
      weekStart,
    );

  if (
    reward.status === 'sent'
  ) {
    await sendMessage(
      env,
      chatId,
      'ℹ️ Эта награда уже отмечена как отправленная.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '👤 К ручной выдаче',
                callback_data:
                  `admin_reward_manual_${weekKey}`,
              },
            ],
          ],
        },
      },
    );

    return;
  }

  if (!reward.gift_id) {
    await sendMessage(
      env,
      chatId,
      '⚠️ Для этого места сначала нужно выбрать подарок.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '📋 К наградам',
                callback_data:
                  `admin_reward_open_${weekKey}`,
              },
            ],
          ],
        },
      },
    );

    return;
  }

  const warningText =
    reward.status === 'unknown'
      ? (
          `\n\n⚠️ У автоматической отправки был неизвестный результат. ` +
          `Перед подтверждением убедитесь, что подарок не был выдан дважды.`
        )
      : '';

  await sendMessage(
    env,
    chatId,
    `✅ *Подтверждение ручной выдачи*\n\n` +
      `Место: *${position}*\n` +
      `Получатель: *${escapeMd(reward.display_name || 'Игрок')}*\n` +
      (
        reward.username
          ? `Username: @${escapeMd(reward.username)}\n`
          : ''
      ) +
      `Telegram ID: \`${reward.user_id}\`\n` +
      `Подарок: \`${escapeMd(reward.gift_id)}\`\n` +
      `Стоимость: *${reward.gift_star_count || 0} ⭐*\n\n` +
      `Подтвердите только после фактической отправки подарка со своего аккаунта.` +
      warningText,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '✅ Подтверждаю отправку',
              callback_data:
                `admin_reward_manual_confirm_${weekKey}_${position}`,
            },
          ],
          [
            {
              text:
                '👤 Открыть профиль',
              url:
                getManualRewardProfileUrl(
                  reward,
                ),
            },
          ],
          [
            {
              text:
                '⬅️ Назад',
              callback_data:
                `admin_reward_manual_${weekKey}`,
            },
          ],
        ],
      },
    },
  );
}

async function markManualRewardAsSent(
  env,
  supabase,
  chatId,
  adminUserId,
  weekStart,
  position,
) {
  const sentAt =
    new Date().toISOString();

  const {
    data: updatedReward,
    error: updateError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .update({
      status:
        'sent',
      delivery_method:
        'manual',
      manual_sent_by:
        String(
          adminUserId,
        ),
      manual_sent_at:
        sentAt,
      sent_at:
        sentAt,
      updated_at:
        sentAt,
      last_error:
        null,
    })
    .eq(
      'week_start',
      weekStart,
    )
    .eq(
      'position',
      position,
    )
    .neq(
      'status',
      'sent',
    )
    .not(
      'gift_id',
      'is',
      null,
    )
    .select(
      'position, user_id, display_name, gift_id'
    )
    .maybeSingle();

  if (updateError) {
    await sendMessage(
      env,
      chatId,
      `❌ Не удалось сохранить ручную выдачу:\n` +
        `${escapeMd(updateError.message)}`,
      adminMenuButtons(),
    );

    return;
  }

  if (!updatedReward) {
    await sendMessage(
      env,
      chatId,
      'ℹ️ Награда уже была отмечена отправленной или подарок не выбран.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '👤 К ручной выдаче',
                callback_data:
                  `admin_reward_manual_${rewardWeekToKey(weekStart)}`,
              },
            ],
          ],
        },
      },
    );

    return;
  }

  const {
    data: batchForCount,
  } = await supabase
    .from(
      'weekly_game_reward_batches',
    )
    .select(
      'winner_count'
    )
    .eq(
      'week_start',
      weekStart,
    )
    .maybeSingle();

  const {
    count: remainingCount,
    error: countError,
  } = await supabase
    .from(
      'weekly_game_rewards',
    )
    .select(
      '*',
      {
        count: 'exact',
        head: true,
      },
    )
    .eq(
      'week_start',
      weekStart,
    )
    .lte(
      'position',
      Math.max(
        1,
        Number(
          batchForCount?.winner_count,
        ) || 1,
      ),
    )
    .neq(
      'status',
      'sent',
    );

  if (countError) {
    console.error(
      'Manual rewards remaining count failed:',
      countError,
    );
  }

  if (
    !countError &&
    Number(
      remainingCount,
    ) === 0
  ) {
    await supabase
      .from(
        'weekly_game_reward_batches',
      )
      .update({
        status:
          'completed',
        completed_at:
          sentAt,
        updated_at:
          sentAt,
      })
      .eq(
        'week_start',
        weekStart,
      )
      .in(
        'status',
        [
          'draft',
          'partial',
        ],
      );
  }

  await sendMessage(
    env,
    chatId,
    `✅ *Ручная выдача сохранена*\n\n` +
      `Место: *${position}*\n` +
      `Получатель: *${escapeMd(updatedReward.display_name || 'Игрок')}*\n` +
      `Подарок: \`${escapeMd(updatedReward.gift_id)}\`\n` +
      `Осталось выдать: *${countError ? 'не удалось определить' : remainingCount}*`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '👤 Продолжить ручную выдачу',
              callback_data:
                `admin_reward_manual_${rewardWeekToKey(weekStart)}`,
            },
          ],
          [
            {
              text:
                '📋 К наградам',
              callback_data:
                `admin_reward_open_${rewardWeekToKey(weekStart)}`,
            },
          ],
        ],
      },
    },
  );
}

function parseBroadcastButtons(input) {
  const normalized =
    String(input || '').trim();

  if (
    !normalized ||
    /^\/skip$/i.test(normalized) ||
    /^без кнопок$/i.test(normalized)
  ) {
    return {
      buttons: [],
      error: null,
    };
  }

  const rows = normalized
    .split('\n')
    .map(row => row.trim())
    .filter(Boolean);

  if (rows.length > 8) {
    return {
      buttons: [],
      error:
        'Максимум 8 рядов кнопок.',
    };
  }

  const buttons = [];
  let totalButtons = 0;

  for (const row of rows) {
    const rawButtons = row
      .split('||')
      .map(item => item.trim())
      .filter(Boolean);

    if (
      rawButtons.length === 0 ||
      rawButtons.length > 8
    ) {
      return {
        buttons: [],
        error:
          'В одном ряду должно быть от 1 до 8 кнопок.',
      };
    }

    const parsedRow = [];

    for (const rawButton of rawButtons) {
      const separatorIndex =
        rawButton.indexOf('|');

      if (separatorIndex <= 0) {
        return {
          buttons: [],
          error:
            `Некорректная кнопка: ${rawButton}`,
        };
      }

      const buttonText =
        rawButton
          .slice(0, separatorIndex)
          .trim()
          .slice(0, 64);

      const target =
        rawButton
          .slice(separatorIndex + 1)
          .trim();

      if (!buttonText || !target) {
        return {
          buttons: [],
          error:
            `Некорректная кнопка: ${rawButton}`,
        };
      }

      if (
        target.toLowerCase() ===
        'webapp'
      ) {
        parsedRow.push({
          text: buttonText,
          web_app: {
            url: WEBAPP_URL,
          },
        });
      } else {
        let parsedUrl;

        try {
          parsedUrl =
            new URL(target);
        } catch {
          return {
            buttons: [],
            error:
              `Некорректная ссылка: ${target}`,
          };
        }

        if (
          ![
            'http:',
            'https:',
            'tg:',
          ].includes(
            parsedUrl.protocol,
          )
        ) {
          return {
            buttons: [],
            error:
              `Недопустимый протокол ссылки: ${target}`,
          };
        }

        parsedRow.push({
          text: buttonText,
          url: target,
        });
      }

      totalButtons += 1;

      if (totalButtons > 20) {
        return {
          buttons: [],
          error:
            'Максимум 20 кнопок в одном посте.',
        };
      }
    }

    buttons.push(parsedRow);
  }

  return {
    buttons,
    error: null,
  };
}

function parseBroadcastSchedule(input) {
  const normalized =
    String(input || '')
      .trim()
      .toLowerCase();

  if (
    normalized === 'сейчас' ||
    normalized === 'now' ||
    normalized === '/now'
  ) {
    return {
      scheduledAt:
        new Date().toISOString(),
      error: null,
    };
  }

  const match =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/,
    );

  if (!match) {
    return {
      scheduledAt: null,
      error:
        'Используйте «сейчас» или дату в формате ГГГГ-ММ-ДД ЧЧ:ММ.',
    };
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
  ] = match;

  /*
   * Ввод администратора интерпретируется
   * по московскому времени UTC+3.
   */
  const date =
    new Date(
      `${year}-${month}-${day}T${hour}:${minute}:00+03:00`,
    );

  const normalizedMoscowDate =
    Number.isFinite(
      date.getTime(),
    )
      ? new Date(
          date.getTime() +
          3 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 16)
      : null;

  const expectedMoscowDate =
    `${year}-${month}-${day}T${hour}:${minute}`;

  if (
    normalizedMoscowDate !==
    expectedMoscowDate
  ) {
    return {
      scheduledAt: null,
      error:
        'Некорректная дата.',
    };
  }

  if (
    date.getTime() <
    Date.now() + 60 * 1000
  ) {
    return {
      scheduledAt: null,
      error:
        'Отложенная дата должна быть минимум на 1 минуту позже текущего времени.',
    };
  }

  return {
    scheduledAt:
      date.toISOString(),
    error: null,
  };
}

async function sendBroadcastButtonsMenu(
  env,
  chatId,
  draftId,
) {
  await sendMessage(
    env,
    chatId,
    `🔘 *Кнопки рассылки*\n\n` +
      `Выберите готовый вариант или добавьте свои кнопки.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '🚫 Без кнопок',
              callback_data:
                `admin_bc_none_${draftId}`,
            },
          ],
          [
            {
              text:
                '🐾 Открыть Chumi',
              callback_data:
                `admin_bc_webapp_${draftId}`,
            },
          ],
          [
            {
              text:
                '✏️ Свои кнопки',
              callback_data:
                `admin_bc_custom_${draftId}`,
            },
          ],
          [
            {
              text:
                '❌ Отменить',
              callback_data:
                `admin_broadcast_cancel_${draftId}`,
            },
          ],
        ],
      },
    },
  );
}

async function sendBroadcastScheduleMenu(
  env,
  chatId,
  draftId,
) {
  await sendMessage(
    env,
    chatId,
    `🕒 *Когда отправить рассылку?*\n\n` +
      `Выберите немедленную отправку или укажите дату и время.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '🚀 Отправить сейчас',
              callback_data:
                `admin_bc_now_${draftId}`,
            },
          ],
          [
            {
              text:
                '⏰ Запланировать',
              callback_data:
                `admin_bc_time_${draftId}`,
            },
          ],
          [
            {
              text:
                '❌ Отменить',
              callback_data:
                `admin_broadcast_cancel_${draftId}`,
            },
          ],
        ],
      },
    },
  );
}

async function showBroadcastPreview(
  env,
  supabase,
  chatId,
  userId,
  draftId,
  scheduledAt,
) {
  const {
    data: draft,
    error: draftError,
  } = await supabase
    .from('broadcast_drafts')
    .update({
      scheduled_at:
        scheduledAt,
      updated_at:
        new Date().toISOString(),
    })
    .eq('id', draftId)
    .eq('created_by', userId)
    .select(
      'id, source_chat_id, source_message_id, buttons, scheduled_at'
    )
    .maybeSingle();

  if (
    draftError ||
    !draft
  ) {
    await sendMessage(
      env,
      chatId,
      '❌ Черновик рассылки не найден. Начните создание поста заново.',
      adminMenuButtons(),
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    '👁 *Предварительный просмотр поста:*',
    {
      reply_markup: {
        inline_keyboard: [],
      },
    },
  );

  const previewResult =
    await copyTelegramMessage(
      env,
      chatId,
      draft.source_chat_id,
      draft.source_message_id,
      Array.isArray(
        draft.buttons,
      )
        ? draft.buttons
        : [],
    );

  if (!previewResult.ok) {
    await sendMessage(
      env,
      chatId,
      `❌ *Не удалось создать предварительный просмотр*\n\n` +
        `${escapeMd(
          previewResult.description ||
          previewResult.error ||
          'Telegram copyMessage failed',
        )}`,
      adminMenuButtons(),
    );

    return;
  }

  const scheduledDate =
    new Date(
      draft.scheduled_at,
    );

  const isScheduled =
    scheduledDate.getTime() >
    Date.now() + 30 * 1000;

  const scheduleText =
    isScheduled
      ? scheduledDate.toLocaleString(
          'ru-RU',
          {
            timeZone:
              'Europe/Moscow',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          },
        ) + ' МСК'
      : 'сейчас';

  await sendMessage(
    env,
    chatId,
    `📣 *Подтвердите рассылку*\n\n` +
      `🕒 Отправка: *${escapeMd(scheduleText)}*\n` +
      `🔘 Кнопок: *${(draft.buttons || []).flat().length}*\n\n` +
      `После подтверждения список получателей будет зафиксирован.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                '✅ Создать рассылку',
              callback_data:
                `admin_broadcast_confirm_${draftId}`,
            },
          ],
          [
            {
              text:
                '⬅️ Изменить время',
              callback_data:
                `admin_bc_schedule_${draftId}`,
            },
          ],
          [
            {
              text:
                '❌ Отменить',
              callback_data:
                `admin_broadcast_cancel_${draftId}`,
            },
          ],
        ],
      },
    },
  );
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
  {
    command: 'activeusers',
    description: '🟢 Активные пользователи за 48 часов',
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

  /*
   * Любое событие пользователя в боте
   * считается активностью.
   */
  const {
    error: activityUpdateError,
  } = await supabase
    .from('user_settings')
    .update({
      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'telegram_user_id',
      userId,
    );

  if (activityUpdateError) {
    console.error(
      'Failed to update bot activity:',
      activityUpdateError,
    );
  }

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
   * updated_at намеренно не изменяем.
   * Tie-breaker использует отдельное поле
   * best_score_achieved_at.
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

// Функция оставлена для возможного ручного обновления профилей.
// eslint-disable-next-line no-unused-vars
async function refreshTelegramProfiles(
  env,
  supabase,
  userIds,
) {
  const uniqueUserIds = [
    ...new Set(
      (userIds || [])
        .filter(Boolean)
        .map(userId => String(userId)),
    ),
  ];

  const profiles = new Map();
  const batchSize = 5;

  for (
    let index = 0;
    index < uniqueUserIds.length;
    index += batchSize
  ) {
    const batch =
      uniqueUserIds.slice(
        index,
        index + batchSize,
      );

    await Promise.all(
      batch.map(async userId => {
        try {
          const response = await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(userId)}`,
          );

          const data = await response
            .json()
            .catch(() => ({}));

          if (
            !response.ok ||
            data.ok === false ||
            !data.result
          ) {
            console.warn(
              'Failed to refresh Telegram profile:',
              {
                userId,
                status: response.status,
                description:
                  data.description || '',
              },
            );

            return;
          }

          const telegramUser = {
            id: data.result.id,
            first_name:
              data.result.first_name ||
              'User',
            last_name:
              data.result.last_name ||
              null,
            username:
              data.result.username ||
              null,
          };

          await syncTelegramProfile(
            supabase,
            telegramUser,
          );

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

          profiles.set(
            userId,
            {
              display_name:
                displayName,
              username:
                telegramUser.username
                  ? String(
                      telegramUser.username,
                    ).slice(0, 100)
                  : null,
            },
          );
        } catch (error) {
          console.warn(
            'Telegram profile refresh failed:',
            {
              userId,
              error:
                String(
                  error?.message ||
                  error,
                ),
            },
          );
        }
      }),
    );
  }

  return profiles;
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

function getBotJumpAnalyticsPeriod(
  period,
  now = new Date(),
) {
  const normalizedPeriod =
    period === 'today' ||
    period === '7d' ||
    period === 'week'
      ? period
      : 'today';

  const end =
    new Date(now);

  let start;

  if (normalizedPeriod === 'today') {
    start =
      new Date(end);

    start.setUTCHours(
      0,
      0,
      0,
      0,
    );
  } else if (
    normalizedPeriod === '7d'
  ) {
    start =
      new Date(
        end.getTime() -
        7 * 24 * 60 * 60 * 1000,
      );
  } else {
    const day =
      end.getUTCDay();

    const daysSinceMonday =
      day === 0
        ? 6
        : day - 1;

    start =
      new Date(end);

    start.setUTCHours(
      0,
      0,
      0,
      0,
    );

    start.setUTCDate(
      start.getUTCDate() -
      daysSinceMonday,
    );
  }

  return {
    period:
      normalizedPeriod,

    start:
      start.toISOString(),

    end:
      end.toISOString(),
  };
}

function getBotAnalyticsAverage(
  values,
) {
  const numbers =
    (values || [])
      .map(value =>
        Number(value)
      )
      .filter(value =>
        Number.isFinite(value)
      );

  if (numbers.length === 0) {
    return 0;
  }

  return (
    numbers.reduce(
      (
        sum,
        value,
      ) =>
        sum + value,
      0,
    ) /
    numbers.length
  );
}

function getBotAnalyticsMedian(
  values,
) {
  const numbers =
    (values || [])
      .map(value =>
        Number(value)
      )
      .filter(value =>
        Number.isFinite(value)
      )
      .sort(
        (
          firstValue,
          secondValue,
        ) =>
          firstValue -
          secondValue,
      );

  if (numbers.length === 0) {
    return 0;
  }

  const middleIndex =
    Math.floor(
      numbers.length / 2,
    );

  if (
    numbers.length % 2 === 1
  ) {
    return numbers[
      middleIndex
    ];
  }

  return (
    numbers[
      middleIndex - 1
    ] +
    numbers[
      middleIndex
    ]
  ) / 2;
}

function roundBotAnalyticsNumber(
  value,
  fractionDigits = 1,
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue,
    )
  ) {
    return 0;
  }

  return Number(
    numericValue.toFixed(
      fractionDigits,
    ),
  );
}

function formatBotAnalyticsDuration(
  milliseconds,
) {
  const normalizedMilliseconds =
    Math.max(
      0,
      Number(
        milliseconds,
      ) || 0,
    );

  const totalSeconds =
    Math.round(
      normalizedMilliseconds /
      1000,
    );

  if (totalSeconds < 60) {
    return `${totalSeconds} сек.`;
  }

  const minutes =
    Math.floor(
      totalSeconds / 60,
    );

  const seconds =
    totalSeconds % 60;

  return (
    `${minutes} мин. ` +
    `${seconds} сек.`
  );
}

function formatBotAnalyticsPercent(
  value,
) {
  return (
    `${roundBotAnalyticsNumber(
      (
        Number(value) ||
        0
      ) * 100,
      1,
    )}%`
  );
}

function countBotAnalyticsValues(
  values,
  limit = 8,
) {
  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 1,
        1,
      ),
      6,
    );

  const counts =
    new Map();

  for (const value of (
    values || []
  )) {
    const key =
      String(
        value ??
        'unknown',
      )
        .trim()
        .slice(
          0,
          48,
        ) ||
      'unknown';

    counts.set(
      key,
      (
        counts.get(
          key,
        ) || 0
      ) + 1,
    );
  }

  return [
    ...counts.entries(),
  ]
    .map(
      ([
        key,
        count,
      ]) => ({
        key,
        count,
      }),
    )
    .sort(
      (
        firstItem,
        secondItem,
      ) =>
        secondItem.count -
          firstItem.count ||
        firstItem.key.localeCompare(
          secondItem.key,
        ),
    )
    .slice(
      0,
      safeLimit,
    );
}

function formatBotAnalyticsDistribution(
  items,
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return '—';
  }

  return items
    .map(
      item =>
        `${escapeMd(item.key)}: ${item.count}`,
    )
    .join(' · ');
}

async function loadBotJumpAnalyticsRows(
  supabase,
  period,
) {
  const rows = [];
  const pageSize = 1000;
  const maximumRows = 20_000;

  for (
    let offset = 0;
    offset < maximumRows;
    offset += pageSize
  ) {
    const {
      data: page,
      error,
    } = await supabase
      .from(
        'jump_game_sessions',
      )
      .select(
        'id, user_id, pair_code, created_at, verified_at, rules_version, client_version, active_duration_ms, paused_duration_ms, frame_count, max_frame_gap_ms, average_fps, minimum_fps, landing_count, normal_landings, cloud_landings, moving_landings, spring_landings, rockets_collected, rockets_missed, maximum_score, death_reason, screen_width, screen_height, telegram_platform, telegram_webapp_version, language, checkpoints, verification_status, verification_reasons, save_duration_ms'
      )
      .gte(
        'created_at',
        period.start,
      )
      .lt(
        'created_at',
        period.end,
      )
      .order(
        'created_at',
        {
          ascending: false,
        },
      )
      .range(
        offset,
        offset +
        pageSize -
        1,
      );

    if (error) {
      throw error;
    }

    const currentPage =
      page || [];

    rows.push(
      ...currentPage,
    );

    if (
      currentPage.length <
      pageSize
    ) {
      return {
        rows,
        truncated: false,
      };
    }
  }

  return {
    rows,
    truncated: true,
  };
}

function getBotJumpPeriodTitle(
  period,
) {
  if (period === '7d') {
    return 'Последние 7 дней';
  }

  if (period === 'week') {
    return 'Текущая неделя';
  }

  return 'Сегодня';
}

function jumpAnalyticsKeyboard(
  period,
) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text:
              '🔄 Обновить',
            callback_data:
              `admin_jump_${period}`,
          },
        ],
        [
          {
            text:
              '⚠️ Подозрительные забеги',
            callback_data:
              'admin_jump_suspicious',
          },
        ],
        [
          {
            text:
              '⬅️ К периодам',
            callback_data:
              'admin_jump_analytics',
          },
        ],
        [
          {
            text:
              '🏠 В админ-панель',
            callback_data:
              'admin_menu',
          },
        ],
      ],
    },
  };
}

async function sendJumpAnalyticsMenu(
  env,
  chatId,
) {
  await sendMessage(
    env,
    chatId,
    `📊 *Аналитика Chumi Jump*\n\n` +
      `Выберите период отчёта.`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                'Сегодня',
              callback_data:
                'admin_jump_today',
            },
          ],
          [
            {
              text:
                '7 дней',
              callback_data:
                'admin_jump_7d',
            },
          ],
          [
            {
              text:
                'Текущая неделя',
              callback_data:
                'admin_jump_week',
            },
          ],
          [
            {
              text:
                '⚠️ Подозрительные забеги',
              callback_data:
                'admin_jump_suspicious',
            },
          ],
          [
            {
              text:
                '⬅️ Назад',
              callback_data:
                'admin_menu',
            },
          ],
        ],
      },
    },
  );
}

async function sendJumpAnalyticsReport(
  env,
  supabase,
  chatId,
  requestedPeriod,
) {
  const period =
    getBotJumpAnalyticsPeriod(
      requestedPeriod,
    );

  let loaded;

  try {
    loaded =
      await loadBotJumpAnalyticsRows(
        supabase,
        period,
      );
  } catch (error) {
    console.error(
      'Bot Jump analytics query failed:',
      error,
    );

    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить аналитику Jump:\n` +
        `${escapeMd(
          error?.message ||
          String(error),
        )}`,
      adminMenuButtons(),
    );

    return;
  }

  const sessions =
    loaded.rows;

  const completedStatuses =
    new Set([
      'accepted',
      'suspicious',
      'rejected',
    ]);

  const completed =
    sessions.filter(
      session =>
        completedStatuses.has(
          session.verification_status,
        ),
    );

  const accepted =
    completed.filter(
      session =>
        session.verification_status ===
          'accepted',
    );

  const suspicious =
    completed.filter(
      session =>
        session.verification_status ===
          'suspicious',
    );

  const rejected =
    completed.filter(
      session =>
        session.verification_status ===
          'rejected',
    );

  const abandoned =
    sessions.filter(
      session =>
        session.verification_status ===
          'abandoned',
    );

  const pending =
    sessions.filter(
      session =>
        session.verification_status ===
          'pending',
    );

  const uniquePlayers =
    new Set(
      sessions
        .map(session =>
          String(
            session.user_id ||
            '',
          )
        )
        .filter(Boolean),
    );

  const runsByPlayer =
    new Map();

  for (const session of sessions) {
    const sessionUserId =
      String(
        session.user_id ||
        '',
      );

    if (!sessionUserId) {
      continue;
    }

    runsByPlayer.set(
      sessionUserId,
      (
        runsByPlayer.get(
          sessionUserId,
        ) || 0
      ) + 1,
    );
  }

  const repeatPlayers =
    [
      ...runsByPlayer.values(),
    ].filter(
      runCount =>
        runCount > 1,
    ).length;

  const scores =
    completed.map(
      session =>
        Number(
          session.maximum_score,
        ) || 0,
    );

  const activeDurations =
    completed.map(
      session =>
        Number(
          session.active_duration_ms,
        ) || 0,
    );

  const pausedDurations =
    completed.map(
      session =>
        Number(
          session.paused_duration_ms,
        ) || 0,
    );

  const validAverageFps =
    completed
      .map(session =>
        Number(
          session.average_fps,
        )
      )
      .filter(value =>
        Number.isFinite(value) &&
        value > 0 &&
        value <= 240
      );

  const validMinimumFps =
    completed
      .map(session =>
        Number(
          session.minimum_fps,
        )
      )
      .filter(value =>
        Number.isFinite(value) &&
        value > 0 &&
        value <= 240
      );

  const longGapSessions =
    completed.filter(
      session =>
        Number(
          session.max_frame_gap_ms,
        ) >= 250,
    );

  const pausedSessions =
    completed.filter(
      session =>
        Number(
          session.paused_duration_ms,
        ) > 0,
    );

  const saveDurations =
    completed
      .map(session =>
        Number(
          session.save_duration_ms,
        )
      )
      .filter(value =>
        Number.isFinite(value) &&
        value >= 0
      );

  const reasons = [];

  for (const session of sessions) {
    if (
      !Array.isArray(
        session.verification_reasons,
      )
    ) {
      continue;
    }

    for (
      const reason of
      session.verification_reasons
    ) {
      if (
        typeof reason ===
          'string' &&
        reason.trim()
      ) {
        reasons.push(
          reason.trim(),
        );
      }
    }
  }

  const saveErrorSessions =
    sessions.filter(
      session => {
        const sessionReasons =
          Array.isArray(
            session.verification_reasons,
          )
            ? session.verification_reasons
            : [];

        return sessionReasons.some(
          reason =>
            typeof reason ===
              'string' &&
            /save|database|rpc|timeout|network/i.test(
              reason,
            ),
        );
      },
    );

  const checkpointScores = [
    25,
    50,
    100,
    200,
    300,
    500,
  ];

  const checkpointText =
    checkpointScores
      .map(
        checkpointScore => {
          const checkpointCount =
            completed.filter(
              session => {
                const checkpoints =
                  Array.isArray(
                    session.checkpoints,
                  )
                    ? session.checkpoints
                    : [];

                return checkpoints.some(
                  checkpoint =>
                    Number(
                      checkpoint?.score,
                    ) ===
                    checkpointScore,
                );
              },
            ).length;

          return (
            `${checkpointScore}: ` +
            `${checkpointCount}`
          );
        },
      )
      .join(' · ');

  const landingTotals = {
    all:
      completed.reduce(
        (
          sum,
          session,
        ) =>
          sum +
          (
            Number(
              session.landing_count,
            ) || 0
          ),
        0,
      ),

    normal:
      completed.reduce(
        (
          sum,
          session,
        ) =>
          sum +
          (
            Number(
              session.normal_landings,
            ) || 0
          ),
        0,
      ),

    cloud:
      completed.reduce(
        (
          sum,
          session,
        ) =>
          sum +
          (
            Number(
              session.cloud_landings,
            ) || 0
          ),
        0,
      ),

    moving:
      completed.reduce(
        (
          sum,
          session,
        ) =>
          sum +
          (
            Number(
              session.moving_landings,
            ) || 0
          ),
        0,
      ),

    spring:
      completed.reduce(
        (
          sum,
          session,
        ) =>
          sum +
          (
            Number(
              session.spring_landings,
            ) || 0
          ),
        0,
      ),
  };

  const rocketsCollected =
    completed.reduce(
      (
        sum,
        session,
      ) =>
        sum +
        (
          Number(
            session.rockets_collected,
          ) || 0
        ),
      0,
    );

  const rocketsMissed =
    completed.reduce(
      (
        sum,
        session,
      ) =>
        sum +
        (
          Number(
            session.rockets_missed,
          ) || 0
        ),
      0,
    );

  const rocketAttempts =
    rocketsCollected +
    rocketsMissed;

  const runsPerPlayer =
    uniquePlayers.size > 0
      ? sessions.length /
        uniquePlayers.size
      : 0;

  const repeatShare =
    uniquePlayers.size > 0
      ? repeatPlayers /
        uniquePlayers.size
      : 0;

  const firstPart =
    `📊 *Chumi Jump — ${getBotJumpPeriodTitle(period.period)}*\n\n` +
    `👥 Уникальные игроки: *${uniquePlayers.size}*\n` +
    `🎮 Сессии: *${sessions.length}*\n` +
    `✅ Завершены: *${completed.length}*\n` +
    `🚪 Брошены: *${abandoned.length}*\n` +
    `⏳ Pending: *${pending.length}*\n\n` +
    `🟢 Accepted: *${accepted.length}*\n` +
    `⚠️ Suspicious: *${suspicious.length}*\n` +
    `⛔ Rejected: *${rejected.length}*\n` +
    `0️⃣ Нулевой результат: *${scores.filter(score => score === 0).length}*\n\n` +
    `📈 Средний результат: *${roundBotAnalyticsNumber(getBotAnalyticsAverage(scores))}*\n` +
    `📊 Медиана: *${roundBotAnalyticsNumber(getBotAnalyticsMedian(scores))}*\n` +
    `🏆 Максимум: *${scores.length > 0 ? Math.max(...scores) : 0}*\n\n` +
    `🔁 Забегов на игрока: *${roundBotAnalyticsNumber(runsPerPlayer, 2)}*\n` +
    `♻️ Повторно запускали: *${repeatPlayers} (${formatBotAnalyticsPercent(repeatShare)})*\n\n` +
    `⏱ Средняя игра: *${formatBotAnalyticsDuration(getBotAnalyticsAverage(activeDurations))}*\n` +
    `⏱ Медиана игры: *${formatBotAnalyticsDuration(getBotAnalyticsMedian(activeDurations))}*`;

  const deathReasons =
    countBotAnalyticsValues(
      completed.map(
        session =>
          session.death_reason ||
          'unknown',
      ),
      8,
    );

  const platforms =
    countBotAnalyticsValues(
      completed.map(
        session =>
          session.telegram_platform ||
          'unknown',
      ),
      8,
    );

  const webAppVersions =
    countBotAnalyticsValues(
      completed.map(
        session =>
          session.telegram_webapp_version ||
          'unknown',
      ),
      8,
    );

  const languages =
    countBotAnalyticsValues(
      completed.map(
        session =>
          session.language ||
          'unknown',
      ),
      8,
    );

  const rulesVersions =
    countBotAnalyticsValues(
      sessions.map(
        session =>
          session.rules_version ??
          'unknown',
      ),
      8,
    );

  const clientVersions =
    countBotAnalyticsValues(
      sessions.map(
        session =>
          session.client_version ||
          'unknown',
      ),
      8,
    );

  const screenSizes =
    countBotAnalyticsValues(
      completed.map(
        session => {
          const width =
            Number(
              session.screen_width,
            );

          const height =
            Number(
              session.screen_height,
            );

          if (
            !Number.isSafeInteger(
              width,
            ) ||
            !Number.isSafeInteger(
              height,
            ) ||
            width <= 0 ||
            height <= 0
          ) {
            return 'unknown';
          }

          return (
            `${width}x${height}`
          );
        },
      ),
      8,
    );

  const secondPart =
    `📋 *Игровые метрики*\n\n` +
    `🎯 Checkpoints:\n${checkpointText}\n\n` +
    `🧱 Приземления: *${landingTotals.all}*\n` +
    `Обычные: *${landingTotals.normal}* · ` +
    `Облака: *${landingTotals.cloud}* · ` +
    `Движущиеся: *${landingTotals.moving}* · ` +
    `Пружины: *${landingTotals.spring}*\n\n` +
    `🚀 Ракеты: *${rocketsCollected}* собрано · *${rocketsMissed}* пропущено\n` +
    `Доля сбора: *${formatBotAnalyticsPercent(rocketAttempts > 0 ? rocketsCollected / rocketAttempts : 0)}*\n\n` +
    `📉 Средний FPS: *${roundBotAnalyticsNumber(getBotAnalyticsAverage(validAverageFps))}*\n` +
    `🔻 Минимальный FPS: *${validMinimumFps.length > 0 ? roundBotAnalyticsNumber(Math.min(...validMinimumFps)) : 0}*\n` +
    `🐢 Frame gap ≥250 мс: *${longGapSessions.length}*\n\n` +
    `⏸ Сессии с паузой: *${pausedSessions.length}*\n` +
    `Средняя пауза: *${formatBotAnalyticsDuration(getBotAnalyticsAverage(pausedDurations))}*\n\n` +
    `💾 Среднее сохранение: *${formatBotAnalyticsDuration(getBotAnalyticsAverage(saveDurations))}*\n` +
    `Медиана сохранения: *${formatBotAnalyticsDuration(getBotAnalyticsMedian(saveDurations))}*\n` +
    `Ошибки сохранения: *${saveErrorSessions.length}*\n\n` +
    `💀 Смерти: ${formatBotAnalyticsDistribution(deathReasons)}\n\n` +
    `📱 Platform: ${formatBotAnalyticsDistribution(platforms)}\n` +
    `Telegram: ${formatBotAnalyticsDistribution(webAppVersions)}\n` +
    `🌐 Язык: ${formatBotAnalyticsDistribution(languages)}\n` +
    `📐 Экраны: ${formatBotAnalyticsDistribution(screenSizes)}\n` +
    `⚙️ Rules: ${formatBotAnalyticsDistribution(rulesVersions)}\n` +
    `🧩 Client: ${formatBotAnalyticsDistribution(clientVersions)}\n\n` +
    `🛡 Anti-cheat: ${formatBotAnalyticsDistribution(countBotAnalyticsValues(reasons, 10))}` +
    (
      loaded.truncated
        ? `\n\n⚠️ Отчёт ограничен первыми 20000 сессиями.`
        : ''
    );

  await sendMessage(
    env,
    chatId,
    firstPart,
    {
      reply_markup: {
        inline_keyboard: [],
      },
    },
  );

  await sendMessage(
    env,
    chatId,
    secondPart,
    jumpAnalyticsKeyboard(
      period.period,
    ),
  );
}

async function sendSuspiciousJumpRuns(
  env,
  supabase,
  chatId,
) {
  const period =
    getBotJumpAnalyticsPeriod(
      'week',
    );

  let loaded;

  try {
    loaded =
      await loadBotJumpAnalyticsRows(
        supabase,
        period,
      );
  } catch (error) {
    console.error(
      'Suspicious Jump runs query failed:',
      error,
    );

    await sendMessage(
      env,
      chatId,
      `❌ Не удалось загрузить подозрительные забеги:\n` +
        `${escapeMd(
          error?.message ||
          String(error),
        )}`,
      adminMenuButtons(),
    );

    return;
  }

  const flaggedRuns =
    loaded.rows
      .filter(
        session =>
          session.verification_status ===
            'suspicious' ||
          session.verification_status ===
            'rejected',
      )
      .sort(
        (
          firstSession,
          secondSession,
        ) =>
          Date.parse(
            secondSession.verified_at ||
            secondSession.created_at ||
            0,
          ) -
          Date.parse(
            firstSession.verified_at ||
            firstSession.created_at ||
            0,
          ),
      )
      .slice(
        0,
        50,
      );

  if (flaggedRuns.length === 0) {
    await sendMessage(
      env,
      chatId,
      `✅ *Подозрительные забеги*\n\n` +
        `За текущую неделю suspicious/rejected забегов нет.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '🔄 Обновить',
                callback_data:
                  'admin_jump_suspicious',
              },
            ],
            [
              {
                text:
                  '⬅️ К аналитике',
                callback_data:
                  'admin_jump_analytics',
              },
            ],
          ],
        },
      },
    );

    return;
  }

  const chunks = [];
  let chunk =
    `⚠️ *Подозрительные забеги текущей недели*\n\n`;

  for (const run of flaggedRuns) {
    const reasons =
      Array.isArray(
        run.verification_reasons,
      )
        ? run.verification_reasons
            .filter(reason =>
              typeof reason ===
              'string'
            )
            .map(reason =>
              escapeMd(
                reason.slice(
                  0,
                  160,
                ),
              )
            )
            .join(', ')
        : '';

    const createdAt =
      run.created_at
        ? new Date(
            run.created_at,
          ).toLocaleString(
            'ru-RU',
            {
              timeZone:
                'Europe/Moscow',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            },
          )
        : '—';

    const line =
      `*${escapeMd(run.verification_status || 'unknown')}* · ` +
      `*${Number(run.maximum_score) || 0} очков*\n` +
      `Session: \`${run.id}\`\n` +
      `User: \`${run.user_id}\`\n` +
      `Pair: \`${run.pair_code || '—'}\`\n` +
      `Время: ${escapeMd(createdAt)} МСК\n` +
      `Причины: ${reasons || '—'}\n\n`;

    if (
      (
        chunk +
        line
      ).length > 3600
    ) {
      chunks.push(
        chunk.trimEnd(),
      );

      chunk =
        `⚠️ *Продолжение подозрительных забегов*\n\n`;
    }

    chunk += line;
  }

  if (chunk.trim()) {
    chunks.push(
      chunk.trimEnd(),
    );
  }

  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    const isLastChunk =
      index ===
      chunks.length - 1;

    await sendMessage(
      env,
      chatId,
      chunks[index],
      isLastChunk
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      '🔄 Обновить',
                    callback_data:
                      'admin_jump_suspicious',
                  },
                ],
                [
                  {
                    text:
                      '⬅️ К аналитике',
                    callback_data:
                      'admin_jump_analytics',
                  },
                ],
                [
                  {
                    text:
                      '🏠 В админ-панель',
                    callback_data:
                      'admin_menu',
                  },
                ],
              ],
            },
          }
        : {
            reply_markup: {
              inline_keyboard: [],
            },
          },
    );
  }
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
            text: '🟢 Активные за 48 часов',
            callback_data: 'admin_active_users',
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
            text: '📊 Аналитика Jump',
            callback_data: 'admin_jump_analytics',
          },
        ],
        [
          {
            text: '🎁 Награды',
            callback_data: 'admin_weekly_rewards',
          },
          {
            text: '⭐ Баланс',
            callback_data: 'admin_stars_balance',
          },
        ],
        [
          {
            text: '⚙️ Настройки раздачи',
            callback_data: 'admin_rewards_settings',
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
      update.business_connection?.user ||
      null;

    if (telegramUser) {
      await syncTelegramProfile(
        supabase,
        telegramUser,
      );
    }

    if (
      update.business_connection
    ) {
      const businessConnection =
        update.business_connection;

      const ownerUserId =
        String(
          businessConnection.user?.id ||
          '',
        );

      if (
        ownerUserId &&
        ADMIN_IDS.includes(
          ownerUserId,
        )
      ) {
        const rights =
          businessConnection.rights ||
          {};

        const {
          error: connectionError,
        } = await supabase
          .from(
            'telegram_business_connections',
          )
          .upsert(
            {
              connection_id:
                String(
                  businessConnection.id,
                ),
              owner_user_id:
                ownerUserId,
              user_chat_id:
                businessConnection.user_chat_id
                  ? String(
                      businessConnection.user_chat_id,
                    )
                  : null,
              is_enabled:
                businessConnection.is_enabled !==
                false,
              can_transfer_stars:
                rights.can_transfer_stars ===
                true,
              updated_at:
                new Date().toISOString(),
            },
            {
              onConflict:
                'connection_id',
            },
          );

        if (connectionError) {
          console.error(
            'Business connection save failed:',
            connectionError,
          );
        }
      }
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

        if (
          cbData ===
          'admin_jump_analytics'
        ) {
          await sendJumpAnalyticsMenu(
            env,
            cbChatId,
          );

          return new Response('OK');
        }

        const jumpPeriodMatch =
          cbData.match(
            /^admin_jump_(today|7d|week)$/,
          );

        if (jumpPeriodMatch) {
          await sendJumpAnalyticsReport(
            env,
            supabase,
            cbChatId,
            jumpPeriodMatch[1],
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_jump_suspicious'
        ) {
          await sendSuspiciousJumpRuns(
            env,
            supabase,
            cbChatId,
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_rewards_settings'
        ) {
          await sendWeeklyRewardsSettings(
            env,
            supabase,
            cbChatId,
          );

          return new Response('OK');
        }

        if (
          cbData === 'admin_rewards_on' ||
          cbData === 'admin_rewards_off'
        ) {
          await setWeeklyRewardsEnabled(
            env,
            supabase,
            cbChatId,
            cbUserId,
            cbData === 'admin_rewards_on',
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_weekly_rewards'
        ) {
          const rewardsEnabled =
            await getWeeklyRewardsEnabled(
              supabase,
            );

          if (!rewardsEnabled) {
            await sendMessage(
              env,
              cbChatId,
              `⚠️ Раздача подарков сейчас выключена.\n\n` +
                `Включите её, чтобы подготовить награждение за прошлую неделю.`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text:
                          '🟢 Включить раздачу',
                        callback_data:
                          'admin_rewards_on',
                      },
                    ],
                    [
                      {
                        text:
                          '⬅️ В админ-панель',
                        callback_data:
                          'admin_menu',
                      },
                    ],
                  ],
                },
              },
            );

            return new Response('OK');
          }

          const previousWeekStart =
            getPreviousUtcWeekStart();

          const {
            data: preparedRewards,
            error: prepareError,
          } = await supabase.rpc(
            'prepare_weekly_game_rewards',
            {
              p_week_start:
                previousWeekStart,
              p_admin_chat_id:
                String(cbChatId),
              p_created_by:
                cbUserId,
            },
          );

          if (prepareError) {
            await sendMessage(
              env,
              cbChatId,
              `❌ Не удалось подготовить награды:\n` +
                `${escapeMd(prepareError.message)}`,
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          const preparedReward =
            Array.isArray(
              preparedRewards,
            )
              ? preparedRewards[0]
              : preparedRewards;

          if (
            Number(
              preparedReward?.reward_winner_count,
            ) === 0
          ) {
            await sendMessage(
              env,
              cbChatId,
              `ℹ️ За неделю \`${previousWeekStart}\` нет результатов для награждения.`,
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendWeeklyRewardSummaryV2(
            env,
            supabase,
            cbChatId,
            previousWeekStart,
          );

          return new Response('OK');
        }

        const rewardOpenMatch =
          cbData.match(
            /^admin_reward_open_(\d{8})$/,
          );

        if (rewardOpenMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardOpenMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendWeeklyRewardSummaryV2(
            env,
            supabase,
            cbChatId,
            weekStart,
          );

          return new Response('OK');
        }

        const rewardPageMatch =
          cbData.match(
            /^admin_reward_page_(\d{8})_(\d+)$/,
          );

        if (rewardPageMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardPageMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendWeeklyGiftCatalogPage(
            env,
            supabase,
            cbChatId,
            weekStart,
            Number(
              rewardPageMatch[2],
            ),
          );

          return new Response('OK');
        }

        const rewardSelectMatch =
          cbData.match(
            /^admin_reward_select_(\d{8})_(.+)$/,
          );

        if (rewardSelectMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardSelectMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await selectWeeklyTelegramGift(
            env,
            supabase,
            cbChatId,
            weekStart,
            rewardSelectMatch[2],
          );

          return new Response('OK');
        }

        const rewardConfirmMatch =
          cbData.match(
            /^admin_reward_confirm_(\d{8})$/,
          );

        if (rewardConfirmMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardConfirmMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendMessage(
            env,
            cbChatId,
            'ℹ️ Эта кнопка относится к старой версии награждения. Откройте актуальный список наград.',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        '🎁 Открыть актуальные награды',
                      callback_data:
                        `admin_reward_open_${rewardWeekToKey(weekStart)}`,
                    },
                  ],
                ],
              },
            },
          );

          return new Response('OK');
        }

        const rewardRetryMatch =
          cbData.match(
            /^admin_reward_retry_(\d{8})$/,
          );

        if (rewardRetryMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardRetryMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendMessage(
            env,
            cbChatId,
            'ℹ️ Эта кнопка относится к старой версии награждения. Откройте актуальный список наград.',
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        '🎁 Открыть актуальные награды',
                      callback_data:
                        `admin_reward_open_${rewardWeekToKey(weekStart)}`,
                    },
                  ],
                ],
              },
            },
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_stars_balance'
        ) {
          await sendStarsBalancePanel(
            env,
            supabase,
            cbChatId,
            cbUserId,
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_stars_topup'
        ) {
          const connection =
            await getActiveBusinessConnection(
              supabase,
              cbUserId,
            );

          if (
            !connection ||
            !connection.can_transfer_stars
          ) {
            await sendMessage(
              env,
              cbChatId,
              `⚠️ Нельзя выполнить перевод.\n\n` +
                `Подключите бота в настройках Telegram Business и разрешите ему перевод Stars.`,
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendMessage(
            env,
            cbChatId,
            `CHUMI-STARS-TOPUP\n\n` +
              `⭐ *Пополнение баланса бота*\n\n` +
              `Введите количество Stars от 1 до 10000.`,
            adminForceReply(
              'От 1 до 10000 Stars',
            ),
          );

          return new Response('OK');
        }

        const starsConfirmMatch =
          cbData.match(
            /^admin_stars_confirm_(\d{1,5})_([a-z0-9]+)$/,
          );

        if (starsConfirmMatch) {
          const starCount =
            Number(
              starsConfirmMatch[1],
            );

          const operationId =
            starsConfirmMatch[2];

          if (
            !Number.isInteger(
              starCount,
            ) ||
            starCount < 1 ||
            starCount > 10000
          ) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректное количество Stars.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          const connection =
            await getActiveBusinessConnection(
              supabase,
              cbUserId,
            );

          if (
            !connection ||
            !connection.can_transfer_stars
          ) {
            await sendMessage(
              env,
              cbChatId,
              '⚠️ Business-подключение отсутствует или не имеет права can_transfer_stars.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          const balanceBefore =
            await getTelegramBotStarBalance(
              env,
            );

          const {
            error: operationError,
          } = await supabase
            .from(
              'bot_star_topups',
            )
            .insert({
              id:
                operationId,
              admin_user_id:
                cbUserId,
              admin_chat_id:
                String(cbChatId),
              business_connection_id:
                connection.connection_id,
              star_count:
                starCount,
              status:
                'processing',
              balance_before:
                balanceBefore.ok
                  ? balanceBefore.amount
                  : null,
            });

          if (operationError) {
            if (
              operationError.code ===
              '23505'
            ) {
              await sendMessage(
                env,
                cbChatId,
                'ℹ️ Эта операция уже была обработана.',
                adminMenuButtons(),
              );
            } else {
              await sendMessage(
                env,
                cbChatId,
                `❌ Не удалось сохранить операцию:\n` +
                  `${escapeMd(operationError.message)}`,
                adminMenuButtons(),
              );
            }

            return new Response('OK');
          }

          const transfer =
            await callTelegramBotApi(
              env,
              'transferBusinessAccountStars',
              {
                business_connection_id:
                  connection.connection_id,
                star_count:
                  starCount,
              },
            );

          if (!transfer.ok) {
            const operationStatus =
              transfer.networkError
                ? 'unknown'
                : 'failed';

            await supabase
              .from(
                'bot_star_topups',
              )
              .update({
                status:
                  operationStatus,
                telegram_error:
                  String(
                    transfer.description ||
                    'Unknown Telegram error',
                  ).slice(
                    0,
                    1000,
                  ),
                completed_at:
                  new Date().toISOString(),
              })
              .eq(
                'id',
                operationId,
              );

            await sendMessage(
              env,
              cbChatId,
              operationStatus === 'unknown'
                ? `❓ Telegram не вернул однозначный результат.\n\nОбновите баланс перед повторной попыткой.`
                : `❌ Перевод не выполнен:\n${escapeMd(transfer.description || 'Unknown Telegram error')}`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text:
                          '🔄 Проверить баланс',
                        callback_data:
                          'admin_stars_balance',
                      },
                    ],
                  ],
                },
              },
            );

            return new Response('OK');
          }

          const balanceAfter =
            await getTelegramBotStarBalance(
              env,
            );

          await supabase
            .from(
              'bot_star_topups',
            )
            .update({
              status:
                'completed',
              balance_after:
                balanceAfter.ok
                  ? balanceAfter.amount
                  : null,
              completed_at:
                new Date().toISOString(),
            })
            .eq(
              'id',
              operationId,
            );

          await sendMessage(
            env,
            cbChatId,
            `✅ *Баланс пополнен*\n\n` +
              `Переведено: *${starCount} Stars*\n` +
              `Баланс до: *${balanceBefore.ok ? balanceBefore.amount : 'неизвестен'}*\n` +
              `Баланс после: *${balanceAfter.ok ? balanceAfter.amount : 'обновите вручную'}*`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        '🔄 Обновить баланс',
                      callback_data:
                        'admin_stars_balance',
                    },
                  ],
                  [
                    {
                      text:
                        '🎁 К наградам',
                      callback_data:
                        'admin_weekly_rewards',
                    },
                  ],
                ],
              },
            },
          );

          return new Response('OK');
        }

        if (
          cbData ===
          'admin_stars_invoice'
        ) {
          await sendMessage(
            env,
            cbChatId,
            `CHUMI-STARS-INVOICE\n\n` +
              `🧾 *Пополнение баланса счётом*\n\n` +
              `Введите количество Stars от 1 до 10000.\n\n` +
              `Бот выставит счёт, который вы оплатите со своего аккаунта. ` +
              `Вся сумма зачислится на баланс бота.`,
            adminForceReply(
              'От 1 до 10000 Stars',
            ),
          );

          return new Response('OK');
        }

        const rewardCountMatch =
          cbData.match(
            /^admin_reward2_count_(\d{8})_(\d{1,2})$/,
          );

        if (rewardCountMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardCountMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await setWeeklyWinnerCount(
            env,
            supabase,
            cbChatId,
            weekStart,
            Number(
              rewardCountMatch[2],
            ),
          );

          return new Response('OK');
        }

        const rewardPlaceMatch =
          cbData.match(
            /^admin_reward2_place_(\d{8})_(\d{1,2})$/,
          );

        if (rewardPlaceMatch) {
          const weekStart =
            rewardKeyToWeek(
              rewardPlaceMatch[1],
            );

          const position =
            Number(
              rewardPlaceMatch[2],
            );

          if (
            !weekStart ||
            !Number.isInteger(
              position,
            ) ||
            position < 0 ||
            position > 10
          ) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректные параметры награды.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendWeeklyGiftCatalogPageV2(
            env,
            supabase,
            cbChatId,
            weekStart,
            position,
            0,
          );

          return new Response('OK');
        }

        const rewardPageV2Match =
          cbData.match(
            /^admin_reward2_page_(\d{8})_(\d{1,2})_(\d+)$/,
          );

        if (rewardPageV2Match) {
          const weekStart =
            rewardKeyToWeek(
              rewardPageV2Match[1],
            );

          const position =
            Number(
              rewardPageV2Match[2],
            );

          const giftIndex =
            Number(
              rewardPageV2Match[3],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendWeeklyGiftCatalogPageV2(
            env,
            supabase,
            cbChatId,
            weekStart,
            position,
            giftIndex,
          );

          return new Response('OK');
        }

        const rewardPickV2Match =
          cbData.match(
            /^admin_reward2_pick_(\d{8})_(\d{1,2})_(\d+)$/,
          );

        if (rewardPickV2Match) {
          const weekStart =
            rewardKeyToWeek(
              rewardPickV2Match[1],
            );

          const position =
            Number(
              rewardPickV2Match[2],
            );

          const giftIndex =
            Number(
              rewardPickV2Match[3],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await selectWeeklyGiftV2(
            env,
            supabase,
            cbChatId,
            weekStart,
            position,
            giftIndex,
          );

          return new Response('OK');
        }

        const rewardSendV2Match =
          cbData.match(
            /^admin_reward2_send_(\d{8})$/,
          );

        if (rewardSendV2Match) {
          const weekStart =
            rewardKeyToWeek(
              rewardSendV2Match[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await processWeeklyGiftsV2(
            env,
            supabase,
            cbChatId,
            weekStart,
            false,
          );

          return new Response('OK');
        }

        const rewardRetryV2Match =
          cbData.match(
            /^admin_reward2_retry_(\d{8})$/,
          );

        if (rewardRetryV2Match) {
          const weekStart =
            rewardKeyToWeek(
              rewardRetryV2Match[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await processWeeklyGiftsV2(
            env,
            supabase,
            cbChatId,
            weekStart,
            true,
          );

          return new Response('OK');
        }

        const manualRewardsMatch =
          cbData.match(
            /^admin_reward_manual_(\d{8})$/,
          );

        if (manualRewardsMatch) {
          const weekStart =
            rewardKeyToWeek(
              manualRewardsMatch[1],
            );

          if (!weekStart) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректная дата награждения.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendManualRewardsPanel(
            env,
            supabase,
            cbChatId,
            weekStart,
          );

          return new Response('OK');
        }

        const manualRewardMarkMatch =
          cbData.match(
            /^admin_reward_manual_mark_(\d{8})_(\d{1,2})$/,
          );

        if (manualRewardMarkMatch) {
          const weekStart =
            rewardKeyToWeek(
              manualRewardMarkMatch[1],
            );

          const position =
            Number(
              manualRewardMarkMatch[2],
            );

          if (
            !weekStart ||
            !Number.isInteger(
              position,
            ) ||
            position < 1 ||
            position > 10
          ) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректные параметры награды.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await sendManualRewardConfirmation(
            env,
            supabase,
            cbChatId,
            weekStart,
            position,
          );

          return new Response('OK');
        }

        const manualRewardConfirmMatch =
          cbData.match(
            /^admin_reward_manual_confirm_(\d{8})_(\d{1,2})$/,
          );

        if (manualRewardConfirmMatch) {
          const weekStart =
            rewardKeyToWeek(
              manualRewardConfirmMatch[1],
            );

          const position =
            Number(
              manualRewardConfirmMatch[2],
            );

          if (
            !weekStart ||
            !Number.isInteger(
              position,
            ) ||
            position < 1 ||
            position > 10
          ) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Некорректные параметры награды.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          await markManualRewardAsSent(
            env,
            supabase,
            cbChatId,
            cbUserId,
            weekStart,
            position,
          );

          return new Response('OK');
        }

        const broadcastChoiceMatch =
          cbData.match(
            /^admin_bc_(none|webapp|custom|now|time|schedule)_(.+)$/,
          );

        if (broadcastChoiceMatch) {
          const action =
            broadcastChoiceMatch[1];

          const draftId =
            broadcastChoiceMatch[2];

          const {
            data: existingDraft,
            error: existingDraftError,
          } = await supabase
            .from('broadcast_drafts')
            .select('id')
            .eq('id', draftId)
            .eq('created_by', cbUserId)
            .maybeSingle();

          if (
            existingDraftError ||
            !existingDraft
          ) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Черновик рассылки не найден или уже был использован.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          if (
            action === 'none' ||
            action === 'webapp'
          ) {
            const selectedButtons =
              action === 'webapp'
                ? [
                    [
                      {
                        text:
                          '🐾 Открыть Chumi',
                        web_app: {
                          url:
                            WEBAPP_URL,
                        },
                      },
                    ],
                  ]
                : [];

            const {
              data: updatedDraft,
              error: updateError,
            } = await supabase
              .from('broadcast_drafts')
              .update({
                buttons:
                  selectedButtons,
                updated_at:
                  new Date().toISOString(),
              })
              .eq('id', draftId)
              .eq('created_by', cbUserId)
              .select('id')
              .maybeSingle();

            if (
              updateError ||
              !updatedDraft
            ) {
              await sendMessage(
                env,
                cbChatId,
                '❌ Не удалось сохранить кнопки рассылки.',
                adminMenuButtons(),
              );

              return new Response('OK');
            }

            await sendBroadcastScheduleMenu(
              env,
              cbChatId,
              draftId,
            );

            return new Response('OK');
          }

          if (action === 'custom') {
            await sendMessage(
              env,
              cbChatId,
              `CHUMI-BROADCAST-BUTTONS:${draftId}\n\n` +
                `✏️ *Добавьте свои кнопки*\n\n` +
                `Одна кнопка:\n` +
                `Название | https://example.com\n\n` +
                `Две кнопки в одном ряду:\n` +
                `Сайт | https://example.com || Канал | https://t.me/example\n\n` +
                `Кнопка открытия Mini App:\n` +
                `Открыть Chumi | webapp\n\n` +
                `Каждый новый ряд отправляйте с новой строки.`,
              adminForceReply(
                'Введите кнопки',
              ),
            );

            return new Response('OK');
          }

          if (
            action === 'schedule'
          ) {
            await sendBroadcastScheduleMenu(
              env,
              cbChatId,
              draftId,
            );

            return new Response('OK');
          }

          if (action === 'now') {
            await showBroadcastPreview(
              env,
              supabase,
              cbChatId,
              cbUserId,
              draftId,
              new Date().toISOString(),
            );

            return new Response('OK');
          }

          if (action === 'time') {
            await sendMessage(
              env,
              cbChatId,
              `CHUMI-BROADCAST-SCHEDULE:${draftId}\n\n` +
                `⏰ *Запланированная отправка*\n\n` +
                `Укажите дату и московское время.\n\n` +
                `Пример:\n` +
                `2026-07-20 18:30\n\n` +
                `Формат: ГГГГ-ММ-ДД ЧЧ:ММ`,
              adminForceReply(
                'ГГГГ-ММ-ДД ЧЧ:ММ',
              ),
            );

            return new Response('OK');
          }
        }

        if (
          cbData.startsWith(
            'admin_broadcast_cancel_',
          )
        ) {
          const draftId =
            cbData.replace(
              'admin_broadcast_cancel_',
              '',
            );

          await supabase
            .from('broadcast_drafts')
            .delete()
            .eq('id', draftId)
            .eq('created_by', cbUserId);

          await sendMessage(
            env,
            cbChatId,
            '🗑️ Создание рассылки отменено.',
            adminMenuButtons(),
          );

          return new Response('OK');
        }

        if (
          cbData.startsWith(
            'admin_broadcast_confirm_',
          )
        ) {
          const draftId =
            cbData.replace(
              'admin_broadcast_confirm_',
              '',
            );

          if (
            cb.message?.message_id
          ) {
            await callTelegramBotApi(
              env,
              'editMessageReplyMarkup',
              {
                chat_id:
                  String(cbChatId),
                message_id:
                  cb.message.message_id,
                reply_markup: {
                  inline_keyboard: [],
                },
              },
            );
          }

          const {
            data: draft,
            error: draftError,
          } = await supabase
            .from('broadcast_drafts')
            .select(
              'id, created_by, admin_chat_id, source_chat_id, source_message_id, buttons, scheduled_at'
            )
            .eq('id', draftId)
            .eq('created_by', cbUserId)
            .maybeSingle();

          if (draftError || !draft) {
            await sendMessage(
              env,
              cbChatId,
              '❌ Черновик рассылки не найден или уже был использован.',
              adminMenuButtons(),
            );

            return new Response('OK');
          }

          const {
            data: createdJobs,
            error: createError,
          } = await supabase.rpc(
            'create_custom_broadcast_job',
            {
              p_source_chat_id:
                draft.source_chat_id,
              p_source_message_id:
                Number(
                  draft.source_message_id,
                ),
              p_buttons:
                draft.buttons || [],
              p_scheduled_at:
                draft.scheduled_at ||
                new Date().toISOString(),
              p_created_by:
                cbUserId,
              p_admin_chat_id:
                String(cbChatId),
            },
          );

          if (createError) {
            console.error(
              'Custom broadcast creation failed:',
              createError,
            );

            await sendMessage(
              env,
              cbChatId,
              `❌ *Не удалось создать рассылку*\n\n` +
                `${escapeMd(createError.message || 'Unknown database error')}`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text:
                          '🔄 Повторить создание',
                        callback_data:
                          `admin_broadcast_confirm_${draftId}`,
                      },
                    ],
                    [
                      {
                        text:
                          '⬅️ Изменить время',
                        callback_data:
                          `admin_bc_schedule_${draftId}`,
                      },
                    ],
                    [
                      {
                        text:
                          '❌ Отменить',
                        callback_data:
                          `admin_broadcast_cancel_${draftId}`,
                      },
                    ],
                  ],
                },
              },
            );

            return new Response('OK');
          }

          const createdJob =
            Array.isArray(createdJobs)
              ? createdJobs[0]
              : createdJobs;

          await supabase
            .from('broadcast_drafts')
            .delete()
            .eq('id', draftId);

          const scheduledDate =
            new Date(
              draft.scheduled_at ||
              Date.now(),
            );

          const isScheduled =
            scheduledDate.getTime() >
            Date.now() + 30 * 1000;

          const scheduleText =
            isScheduled
              ? scheduledDate.toLocaleString(
                  'ru-RU',
                  {
                    timeZone:
                      'Europe/Moscow',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  },
                ) + ' МСК'
              : 'как можно скорее';

          await sendMessage(
            env,
            cbChatId,
            `✅ *Рассылка создана*\n\n` +
              `🆔 Задание: \`${createdJob?.job_id || '—'}\`\n` +
              `👥 Получателей: *${createdJob?.recipient_count || 0}*\n` +
              `🕒 Отправка: *${escapeMd(scheduleText)}*`,
            adminMenuButtons(),
          );

          return new Response('OK');
        }

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
          const promptResult =
            await sendMessage(
              env,
              cbChatId,
              `CHUMI-BROADCAST-POST\n\n` +
                `📣 *Создание рассылки*\n\n` +
                `Ответьте на это сообщение любым постом, который нужно разослать.\n\n` +
                `Поддерживаются текст, форматирование, фото, видео, GIF, документ, аудио, голосовое сообщение и стикер.\n\n` +
                `После этого бот предложит добавить кнопки и выбрать время отправки.`,
              adminForceReply(
                'Отправьте готовый пост',
              ),
            );

          if (!promptResult?.ok) {
            console.error(
              'Failed to open broadcast constructor:',
              promptResult,
            );
          }

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
          admin_active_users:
            '/activeusers',
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
        } else if (
          payloadType === 'stars_topup'
        ) {
          productKey = 'stars_topup';
        } else {
          productKey = productId;
        }

        /*
         * Пополнение баланса — сумма динамическая,
         * поэтому берётся из подписанного нами payload.
         * Счёт может оплатить только администратор.
         */
        const topupAmount =
          Number(
            payload.amount ||
            payload.a,
          );

        const expected =
          productKey === 'stars_topup'
            ? (
                Number.isSafeInteger(
                  topupAmount,
                ) &&
                topupAmount >= 1 &&
                topupAmount <= 10000 &&
                ADMIN_IDS.includes(
                  String(query.from.id),
                )
                  ? topupAmount
                  : NaN
              )
            : expectedAmount(
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

      // ── Единое чтение полей payload (поддержка короткого формата t/s/u/r/p
      // и длинного type/skinId/userId/recipientId/productId) ──
      const pType = payload.type || payload.t || null;          // 'skin' | 'skin_gift' | undefined
      const pSkinId = payload.skinId || payload.s || null;
      const pUserId = payload.userId || payload.u || null;
      const pRecipientId = payload.recipientId || payload.r || null;
      const pProductId = payload.productId || payload.p || null; // 'extra_slot' | 'premium_monthly'

      // ── Sanity-check: payload должен относиться к этому же userId ──
      if (
        pUserId !== null &&
        String(pUserId) !== userId
      ) {
        console.error(
          'Payment payload userId mismatch:',
          pUserId,
          'vs',
          userId,
        );

        return new Response('OK');
      }

      // ── Sanity-check: проверяем что заплатили правильную сумму ──
      // productKey определяется ОДИН раз и используется и для проверки суммы,
      // и для дальнейшей обработки — они не могут разойтись.
      let productKey;
      if (pType === 'skin') productKey = 'skin';
      else if (pType === 'skin_gift') productKey = 'skin_gift';
      else if (pType === 'stars_topup') productKey = 'stars_topup';
      else productKey = pProductId;

      const pTopupAmount =
        Number(
          payload.amount ||
          payload.a,
        );

      // Цена берётся из общего модуля _prices.js — единый источник правды
      // для скинов (по skinId) и товаров (extra_slot и т.п.).
      // Как и в pre_checkout: неизвестный продукт (expected === undefined)
      // считаем невалидным и товар не выдаём — иначе сумма не проверяется вообще.
      // Пополнение баланса проверяется по сумме из payload.
      const expected =
        productKey === 'stars_topup'
          ? (
              Number.isSafeInteger(
                pTopupAmount,
              ) &&
              pTopupAmount >= 1 &&
              pTopupAmount <= 10000 &&
              ADMIN_IDS.includes(userId)
                ? pTopupAmount
                : NaN
            )
          : expectedAmount(productKey, pSkinId);

      if (
        payment.currency !== 'XTR' ||
        !Number.isFinite(expected) ||
        payment.total_amount !== expected
      ) {
        console.error(
          'Payment validation failed:',
          {
            currency: payment.currency,
            totalAmount: payment.total_amount,
            expected,
            productKey,
            skinId: pSkinId,
          },
        );

        return new Response('OK');
      }

      // ── Пополнение баланса бота ──
      if (pType === 'stars_topup') {
        const topupClaim = await claimCharge(supabase, chargeId, userId, 'stars_topup');
        if (!(await shouldFulfill(env, topupClaim, {
          product: 'stars_topup', userId,
          amount: payment.total_amount, chargeId,
        }))) {
          return new Response('OK');
        }

        const balanceAfterTopup =
          await getTelegramBotStarBalance(
            env,
          );

        await sendMessage(
          env,
          update.message.chat.id,
          `✅ *Баланс бота пополнен*\n\n` +
            `Зачислено: *${payment.total_amount} ⭐*\n` +
            `Текущий баланс: *${balanceAfterTopup.ok ? balanceAfterTopup.amount : 'обновите вручную'}*`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      '🔄 Обновить баланс',
                    callback_data:
                      'admin_stars_balance',
                  },
                ],
                [
                  {
                    text:
                      '🎁 К наградам',
                    callback_data:
                      'admin_weekly_rewards',
                  },
                ],
              ],
            },
          },
        );

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

        const {
          data: updatedExtraSlots,
          error: slotGrantError,
        } = await supabase.rpc(
          'increment_user_slots',
          {
            p_telegram_user_id:
              userId,
            p_amount:
              1,
          },
        );

        const normalizedExtraSlots =
          Number(
            updatedExtraSlots,
          );

        if (
          slotGrantError ||
          !Number.isInteger(
            normalizedExtraSlots,
          ) ||
          normalizedExtraSlots < 1
        ) {
          console.error(
            'Paid slot fulfillment failed:',
            {
              userId,
              chargeId,
              updatedExtraSlots,
              error:
                slotGrantError,
            },
          );

          await notifyAdmins(
            env,
            `⚠️ *Оплаченный слот не выдан*\n\n` +
              `Требуется ручная проверка и выдача!\n\n` +
              `Пользователь ID: \`${userId}\`\n` +
              `Сумма: ⭐ ${payment.total_amount} Stars\n` +
              `Charge: \`${chargeId || '—'}\`\n` +
              `Ошибка: ${escapeMd(slotGrantError?.message || 'RPC returned invalid result')}`,
          );

          await sendMessage(
            env,
            update.message.chat.id,
            lang === 'ru'
              ? `⚠️ Оплата прошла, но слот пока не был добавлен.\n\nОбратись в поддержку: @ROKENN`
              : `⚠️ The payment succeeded, but the slot hasn't been added yet.\n\nPlease contact support: @ROKENN`,
            webAppButton,
          );

          return new Response('OK');
        }

        await sendMessage(
          env,
          update.message.chat.id,
          T[lang].slotBought,
          webAppButton,
        );

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

    if (!message) {
      return new Response('OK');
    }

    const chatId = message.chat.id;
    const userId = String(message.from.id);

    const messageText =
      typeof message.text === 'string'
        ? message.text.trim()
        : '';

    let text = messageText;

    const firstName =
      message.from.first_name ||
      'User';

    const username =
      message.from.username ||
      null;

    const repliedBotText =
      message.reply_to_message?.text ||
      message.reply_to_message?.caption ||
      '';

    if (
      ADMIN_IDS.includes(userId) &&
      message.chat.type === 'private'
    ) {
      if (
        repliedBotText.startsWith(
          'CHUMI-STARS-INVOICE',
        )
      ) {
        const invoiceStarCount =
          Number(
            messageText,
          );

        if (
          !/^\d{1,5}$/.test(
            messageText,
          ) ||
          !Number.isInteger(
            invoiceStarCount,
          ) ||
          invoiceStarCount < 1 ||
          invoiceStarCount > 10000
        ) {
          await sendMessage(
            env,
            chatId,
            `❌ Введите целое число от 1 до 10000.`,
            adminForceReply(
              'От 1 до 10000 Stars',
            ),
          );

          return new Response('OK');
        }

        await sendStarsTopupInvoice(
          env,
          chatId,
          userId,
          invoiceStarCount,
        );

        return new Response('OK');
      }

      if (
        repliedBotText.startsWith(
          'CHUMI-STARS-TOPUP',
        )
      ) {
        const starCount =
          Number(
            messageText,
          );

        if (
          !/^\d{1,5}$/.test(
            messageText,
          ) ||
          !Number.isInteger(
            starCount,
          ) ||
          starCount < 1 ||
          starCount > 10000
        ) {
          await sendMessage(
            env,
            chatId,
            `❌ Введите целое число от 1 до 10000.`,
            adminForceReply(
              'От 1 до 10000 Stars',
            ),
          );

          return new Response('OK');
        }

        const balance =
          await getTelegramBotStarBalance(
            env,
          );

        const operationId =
          (
            Date.now().toString(36) +
            userId.slice(-4)
          ).toLowerCase();

        const balanceAfter =
          balance.ok
            ? balance.amount +
              starCount
            : null;

        await sendMessage(
          env,
          chatId,
          `⭐ *Подтверждение пополнения*\n\n` +
            `Будет переведено: *${starCount} Stars*\n` +
            `Текущий баланс бота: *${balance.ok ? balance.amount : 'неизвестен'}*\n` +
            `Ожидаемый баланс: *${balanceAfter ?? 'будет проверен после перевода'}*\n\n` +
            `Stars будут списаны с подключённого Telegram Business-аккаунта.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      `✅ Перевести ${starCount} ⭐`,
                    callback_data:
                      `admin_stars_confirm_${starCount}_${operationId}`,
                  },
                ],
                [
                  {
                    text:
                      '❌ Отменить',
                    callback_data:
                      'admin_stars_balance',
                  },
                ],
              ],
            },
          },
        );

        return new Response('OK');
      }

      /*
       * Шаг 1: администратор ответил готовым постом.
       * Сохраняем только ссылку на исходное сообщение.
       * Сам пост затем отправляется через copyMessage,
       * поэтому сохраняются медиа и форматирование.
       */
      if (
        repliedBotText.startsWith(
          'CHUMI-BROADCAST-POST',
        )
      ) {
        const {
          data: draft,
          error: draftError,
        } = await supabase
          .from('broadcast_drafts')
          .insert({
            created_by: userId,
            admin_chat_id:
              String(chatId),
            source_chat_id:
              String(chatId),
            source_message_id:
              Number(message.message_id),
            buttons: [],
          })
          .select('id')
          .single();

        if (draftError || !draft?.id) {
          console.error(
            'Broadcast draft creation failed:',
            draftError,
          );

          await sendMessage(
            env,
            chatId,
            `❌ *Не удалось сохранить пост*\n\n` +
              `${escapeMd(draftError?.message || 'Unknown database error')}`,
            adminMenuButtons(),
          );

          return new Response('OK');
        }

        await sendBroadcastButtonsMenu(
          env,
          chatId,
          draft.id,
        );

        return new Response('OK');
      }

      /*
       * Шаг 2: администратор прислал описание кнопок.
       */
      if (
        repliedBotText.startsWith(
          'CHUMI-BROADCAST-BUTTONS:'
        )
      ) {
        const draftId =
          repliedBotText
            .split('\n')[0]
            .replace(
              'CHUMI-BROADCAST-BUTTONS:',
              '',
            )
            .trim();

        const {
          buttons,
          error: buttonsError,
        } = parseBroadcastButtons(
          messageText,
        );

        if (buttonsError) {
          await sendMessage(
            env,
            chatId,
            `CHUMI-BROADCAST-BUTTONS:${draftId}\n\n` +
              `❌ *Ошибка в кнопках*\n\n` +
              `${escapeMd(buttonsError)}\n\n` +
              `Повторите ввод в формате:\n` +
              `Название | https://example.com\n\n` +
              `Две кнопки в одном ряду:\n` +
              `Сайт | https://example.com || Канал | https://t.me/example\n\n` +
              `Или отправьте /skip`,
            adminForceReply(
              'Исправьте кнопки',
            ),
          );

          return new Response('OK');
        }

        const {
          data: updatedDraft,
          error: updateError,
        } = await supabase
          .from('broadcast_drafts')
          .update({
            buttons,
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', draftId)
          .eq('created_by', userId)
          .select('id')
          .maybeSingle();

        if (
          updateError ||
          !updatedDraft
        ) {
          await sendMessage(
            env,
            chatId,
            '❌ Черновик рассылки не найден. Начните создание поста заново.',
            adminMenuButtons(),
          );

          return new Response('OK');
        }

        await sendBroadcastScheduleMenu(
          env,
          chatId,
          draftId,
        );

        return new Response('OK');
      }

      /*
       * Шаг 3: администратор выбрал время.
       * Показываем итоговое превью и кнопки подтверждения.
       */
      if (
        repliedBotText.startsWith(
          'CHUMI-BROADCAST-SCHEDULE:'
        )
      ) {
        const draftId =
          repliedBotText
            .split('\n')[0]
            .replace(
              'CHUMI-BROADCAST-SCHEDULE:',
              '',
            )
            .trim();

        const {
          scheduledAt,
          error: scheduleError,
        } = parseBroadcastSchedule(
          messageText,
        );

        if (scheduleError) {
          await sendMessage(
            env,
            chatId,
            `CHUMI-BROADCAST-SCHEDULE:${draftId}\n\n` +
              `❌ *Ошибка времени отправки*\n\n` +
              `${escapeMd(scheduleError)}\n\n` +
              `Укажите будущую дату по московскому времени.\n\n` +
              `Пример:\n` +
              `2026-07-20 18:30\n\n` +
              `Формат: ГГГГ-ММ-ДД ЧЧ:ММ`,
            adminForceReply(
              'ГГГГ-ММ-ДД ЧЧ:ММ',
            ),
          );

          return new Response('OK');
        }

        await showBroadcastPreview(
          env,
          supabase,
          chatId,
          userId,
          draftId,
          scheduledAt,
        );

        return new Response('OK');
      }

      /*
       * Старые Force Reply-команды админской панели.
       */
      if (
        repliedBotText.startsWith(
          'ADMIN_GRANTBEE_PROMPT',
        )
      ) {
        text =
          `/grantbee ${messageText}`;
      } else if (
        repliedBotText.startsWith(
          'ADMIN_GRANTSLOT_PROMPT',
        )
      ) {
        text =
          `/grantslot ${messageText}`;
      }
    }

    /*
     * Медиа без текста уже обработано конструктором выше.
     * Для остальных обработчиков бота по-прежнему нужен текст.
     */
    if (!text) {
      return new Response('OK');
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
        const {
          error: joinError,
        } = await supabase
          .from('pair_users')
          .insert({
            pair_code: joinCode,
            user_id: userId,
            display_name: firstName,
            username,
            timezone: null,
          });

        if (joinError) {
          console.error(
            'Failed to join pair from start parameter:',
            {
              userId,
              joinCode,
              error: joinError,
            },
          );

          if (joinError.code === '23505') {
            await sendMessage(
              env,
              chatId,
              T[lang].alreadyInPair,
              webAppButton,
            );
          } else if (joinError.code === '23514') {
            await sendMessage(
              env,
              chatId,
              T[lang].pairFull,
              webAppButton,
            );
          } else {
            await sendMessage(
              env,
              chatId,
              lang === 'ru'
                ? '❌ Не удалось вступить в пару. Попробуй позже.'
                : '❌ Failed to join the pair. Please try again later.',
              webAppButton,
            );
          }

          return new Response('OK');
        }

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
      const {
        error: joinError,
      } = await supabase
        .from('pair_users')
        .insert({
          pair_code: code,
          user_id: userId,
          display_name: firstName,
          username,
          timezone: null,
        });

      if (joinError) {
        console.error(
          'Failed to join pair:',
          {
            userId,
            code,
            error: joinError,
          },
        );

        if (joinError.code === '23505') {
          await sendMessage(
            env,
            chatId,
            T[lang].alreadyInPair,
            webAppButton,
          );
        } else if (joinError.code === '23514') {
          await sendMessage(
            env,
            chatId,
            T[lang].pairFull,
            webAppButton,
          );
        } else {
          await sendMessage(
            env,
            chatId,
            lang === 'ru'
              ? '❌ Не удалось вступить в пару. Попробуй позже.'
              : '❌ Failed to join the pair. Please try again later.',
            webAppButton,
          );
        }

        return new Response('OK');
      }

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

      /*
       * Имена и username уже синхронизируются
       * при событиях бота и запросах Mini App.
       * Здесь читаем готовые данные из базы,
       * не выполняя отдельный getChat для каждого пользователя.
       */
      // Подтягиваем сохранённые имена/username из pair_users.
      const { data: named } = await supabase
        .from('pair_users')
        .select('user_id, display_name, username');

      const nameMap = new Map();
      for (const n of (named || [])) {
        const normalizedUserId =
          String(n.user_id);

        if (!nameMap.has(normalizedUserId)) {
          nameMap.set(
            normalizedUserId,
            {
              display_name:
                n.display_name || null,
              username:
                n.username || null,
            },
          );
        }
      }

      // Формируем строки.
      const lines = list.map((u, i) => {
        const normalizedUserId =
          String(
            u.telegram_user_id,
          );

        const info =
          nameMap.get(
            normalizedUserId,
          ) ||
          {};

        const name =
          info.display_name
            ? escapeMd(
                info.display_name,
              )
            : '—';

        const uname =
          info.username
            ? '@' +
              escapeMd(
                info.username,
              )
            : 'no username';

        const date = u.created_at
          ? new Date(
              u.created_at,
            ).toLocaleDateString(
              'ru-RU',
              {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              },
            )
          : '—';

        return (
          `${i + 1}. ${name} (${uname}) ` +
          `\`${normalizedUserId}\` ` +
          `[${u.lang || '—'}] ${date}`
        );
      });

      // Разбиваем на части по ~3500 символов, чтобы влезть в лимит Telegram.
      const header =
        `👥 *Всего пользователей: ${list.length}*\n\n`;

      let chunk = header;
      const chunks = [];

      for (const line of lines) {
        if (
          (
            chunk +
            line +
            '\n'
          ).length > 3500
        ) {
          chunks.push(chunk);
          chunk = '';
        }

        chunk += line + '\n';
      }

      if (chunk.trim()) {
        chunks.push(chunk);
      }

      // Отправляем по частям.
      for (const part of chunks) {
        await sendMessage(
          env,
          chatId,
          part,
        );
      }

      return new Response('OK');
    }

    // /activeusers — активные пользователи за последние 48 часов
    if (text === '/activeusers') {
      if (!ADMIN_IDS.includes(userId)) {
        return new Response('OK');
      }

      const activeSince =
        new Date(
          Date.now() -
          48 * 60 * 60 * 1000,
        ).toISOString();

      /*
       * user_settings.updated_at является
       * единым временем последней активности:
       * оно обновляется ботом и Mini App.
       */
      const activeUsers = [];
      const pageSize = 1000;
      let pageOffset = 0;

      while (true) {
        const {
          data: activityRows,
          error: activityError,
        } = await supabase
          .from('user_settings')
          .select(
            'telegram_user_id, updated_at'
          )
          .gte(
            'updated_at',
            activeSince,
          )
          .order(
            'updated_at',
            {
              ascending: false,
            },
          )
          .range(
            pageOffset,
            pageOffset +
            pageSize - 1,
          );

        if (activityError) {
          console.error(
            'Failed to load active users:',
            activityError,
          );

          await sendMessage(
            env,
            chatId,
            `❌ Не удалось загрузить активных пользователей:\n` +
            `\`${escapeMd(activityError.message || 'Unknown error')}\``,
          );

          return new Response('OK');
        }

        const currentPage =
          activityRows || [];

        for (const activity of currentPage) {
          if (
            !activity.telegram_user_id
          ) {
            continue;
          }

          activeUsers.push({
            userId:
              String(
                activity.telegram_user_id,
              ),
            lastActivity:
              activity.updated_at,
          });
        }

        if (
          currentPage.length <
          pageSize
        ) {
          break;
        }

        pageOffset += pageSize;
      }

      if (activeUsers.length === 0) {
        await sendMessage(
          env,
          chatId,
          '🟢 За последние 48 часов активных пользователей нет.',
        );

        return new Response('OK');
      }

      /*
       * Имена и username уже синхронизируются
       * при событиях бота и запросах Mini App.
       * Здесь используем сохранённые данные,
       * чтобы список формировался без задержки.
       */
      const {
        data: savedProfiles,
      } = await supabase
        .from('pair_users')
        .select(
          'user_id, display_name, username'
        );

      const savedProfileMap =
        new Map();

      for (const profile of (
        savedProfiles || []
      )) {
        const profileUserId =
          String(profile.user_id);

        if (
          !savedProfileMap.has(
            profileUserId,
          )
        ) {
          savedProfileMap.set(
            profileUserId,
            {
              display_name:
                profile.display_name ||
                null,
              username:
                profile.username ||
                null,
            },
          );
        }
      }

      const {
        data: settings,
      } = await supabase
        .from('user_settings')
        .select(
          'telegram_user_id, lang'
        );

      const languageMap =
        new Map();

      for (const setting of (
        settings || []
      )) {
        languageMap.set(
          String(
            setting.telegram_user_id,
          ),
          setting.lang || '—',
        );
      }

      const lines =
        activeUsers.map(
          (
            activeUser,
            index,
          ) => {
            const profile =
              savedProfileMap.get(
                activeUser.userId,
              ) ||
              {};

            const displayName =
              profile.display_name
                ? escapeMd(
                    profile.display_name,
                  )
                : '—';

            const usernameText =
              profile.username
                ? '@' +
                  escapeMd(
                    profile.username,
                  )
                : 'no username';

            const activityDate =
              activeUser.lastActivity
                ? new Date(
                    activeUser.lastActivity,
                  ).toLocaleString(
                    'ru-RU',
                    {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    },
                  )
                : '—';

            const userLanguage =
              languageMap.get(
                activeUser.userId,
              ) || '—';

            return (
              `${index + 1}. ${displayName} ` +
              `(${usernameText})\n` +
              `   ID: \`${activeUser.userId}\` ` +
              `[${userLanguage}]\n` +
              `   Активность: ${activityDate}`
            );
          },
        );

      const chunks = [];
      let chunk =
        `🟢 *Активные пользователи за 48 часов: ` +
        `${activeUsers.length}*\n\n`;

      for (const line of lines) {
        const nextLine =
          line + '\n\n';

        if (
          (
            chunk +
            nextLine
          ).length > 3500
        ) {
          chunks.push(
            chunk.trimEnd(),
          );

          chunk =
            `🟢 *Продолжение списка активных пользователей*\n\n`;
        }

        chunk += nextLine;
      }

      if (chunk.trim()) {
        chunks.push(
          chunk.trimEnd(),
        );
      }

      for (const part of chunks) {
        await sendMessage(
          env,
          chatId,
          part,
        );
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

      // Атомарно прибавляем один дополнительный слот.
      const {
        data: updatedExtraSlots,
        error: slotGrantError,
      } = await supabase.rpc(
        'increment_user_slots',
        {
          p_telegram_user_id:
            targetId,
          p_amount:
            1,
        },
      );

      const newTotal =
        Number(
          updatedExtraSlots,
        );

      if (
        slotGrantError ||
        !Number.isInteger(
          newTotal,
        ) ||
        newTotal < 1
      ) {
        console.error(
          'Manual slot grant failed:',
          {
            adminUserId:
              userId,
            targetId,
            updatedExtraSlots,
            error:
              slotGrantError,
          },
        );

        await sendMessage(
          env,
          chatId,
          `❌ Не удалось выдать слот:\n` +
            `\`${escapeMd(slotGrantError?.message || 'RPC returned invalid result')}\``,
          adminMenuButtons(),
        );

        return new Response('OK');
      }

      // Уведомляем получателя на его языке
      const targetLang = await getUserLang(supabase, targetId);
      const notifyText = targetLang === 'ru'
        ? `🎁 Тебе подарили дополнительный слот для пары!\n\nТеперь у тебя на 1 пару больше. Открой Chumi и создай новую пару 🐾`
        : `🎁 You've been gifted an extra pair slot!\n\nYou can now create one more pair. Open Chumi and start a new one 🐾`;

      const notificationResult =
        await sendMessage(
          env,
          targetId,
          notifyText,
          webAppButton,
        );

      if (!notificationResult.ok) {
        await sendMessage(
          env,
          chatId,
          `⚠️ Слот выдан, но уведомление пользователю отправить не удалось.\n\n` +
            `Пользователь: \`${targetId}\`\n` +
            `Всего доп. слотов: *${newTotal}*\n` +
            `Ошибка: ${escapeMd(notificationResult.description || notificationResult.error || 'Unknown Telegram error')}`,
          adminMenuButtons(),
        );

        return new Response('OK');
      }

      await sendMessage(
        env,
        chatId,
        `✅ Дополнительный слот выдан пользователю \`${targetId}\`.\n` +
          `Всего доп. слотов у него теперь: *${newTotal}*.`,
        adminMenuButtons(),
      );
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
