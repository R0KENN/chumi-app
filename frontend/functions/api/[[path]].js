import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { LEVELS, getLevel } from '../_levels.js';
import { SKIN_PRICES, PRODUCT_PRICES } from '../_prices.js';
import {
  ADMIN_IDS, MAX_PAIRS_BASE, WEBAPP_URL,
  getSupabase, generateUniqueCode, escapeMd, getMaxPairs,
} from '../_shared.js';

// ────────── CONFIG ──────────

const TASK_POINTS = {
  daily_open: 1,
  send_msg: 1,
  send_sticker: 2,
  send_media: 4,
  pet_touch: 1,
};

const JUMP_GAME_RULES_VERSION = 2;
const JUMP_GAME_CLIENT_VERSION = 'jump-2';

const MAX_UPLOADED_IMAGE_BYTES =
  8 * 1024 * 1024;

const MAX_UPLOADED_IMAGE_BASE64_LENGTH =
  Math.ceil(
    MAX_UPLOADED_IMAGE_BYTES *
    4 /
    3,
  ) + 4;

const DEATH_STICKER_FILE_IDS = {
  egg: 'CAACAgIAAxkBAAERkSNqXF8oMQdvSDAzuH40k4Zhv9jNtgACVpsAAu8b6EpIcX6Y4NlIwD0E',
  idle: 'CAACAgIAAxkBAAERkPlqXE_irAT4BXXq4Od5dNXT7vvrjQAC-qgAAikz4Uo70-N11x_ALT0E',
  level_1: 'CAACAgIAAxkBAAERkPlqXE_irAT4BXXq4Od5dNXT7vvrjQAC-qgAAikz4Uo70-N11x_ALT0E',
  level_2: 'CAACAgIAAxkBAAERkPtqXFAYESsW08t9K3hYxsj2caUBkgACu60AAhTA4Eo8GaDhcTINjz0E',
  level_3: 'CAACAgIAAxkBAAERkP1qXFArikt9dNsrx0G895R7VhaWHgACgKMAAn_S4Eo2g1Kh5950mT0E',
  level_4: 'CAACAgIAAxkBAAERkP9qXFA141QpqqdY0NF0b2HSUIRt7wAC9aAAAjdR4Epzqb4CT9GxAT0E',
  level_5: 'CAACAgIAAxkBAAERkQFqXFBADdrrJbf8xLGjUwS64iTAMwACAq8AAvrf4EoNi95ZDS52Tz0E',
  strawberry: 'CAACAgIAAxkBAAERkQNqXFBKXFbHbliYWErjeJbAGQp48gACK58AAmtj6EqWChGt5WzrGD0E',
  bee: 'CAACAgIAAxkBAAERkQVqXFBVoykAATUtZc52CosqpBPtOB4AAmKoAAJF--BKToFDDUMV72k9BA',
  floral: 'CAACAgIAAxkBAAERkQdqXFBi5PFKUJ3iPDbf5YOeFU-O6gACAqQAAgO24UowMds7NqVIID0E',
  astronaut: 'CAACAgIAAxkBAAERkQlqXFBqt4fEh0TAAcWMZiR-mGjkOAACgqYAAtb24EqauuHhFsWioj0E',
};

function getDeathStickerFileId(pair) {
  const activeSkin =
    pair?.active_skin
      ? String(pair.active_skin)
      : null;

  if (
    activeSkin &&
    DEATH_STICKER_FILE_IDS[activeSkin]
  ) {
    return DEATH_STICKER_FILE_IDS[
      activeSkin
    ];
  }

  const currentLevel =
    Number(
      getLevel(
        pair?.growth_points || 0,
      )?.level,
    );

  if (currentLevel === 0) {
    return (
      DEATH_STICKER_FILE_IDS.egg
    );
  }

  return (
    DEATH_STICKER_FILE_IDS[
      `level_${currentLevel}`
    ] ||
    DEATH_STICKER_FILE_IDS.idle
  );
}

async function isPremium(
  _supabase,
  userId
) {
  return ADMIN_IDS.includes(
    String(userId)
  );
}

// Дата YYYY-MM-DD в указанной таймзоне (UTC по умолчанию)
function getTodayDate(tz) {
  const date = new Date();
  if (!tz) return date.toISOString().split('T')[0];
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
}

// "Вчера" в таймзоне
function getYesterdayDate(tz) {
  const today = getTodayDate(tz);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

// Текущий месяц YYYY-MM в таймзоне
function getCurrentMonth(tz) {
  return getTodayDate(tz).slice(0, 7);
}

function getDateDifferenceInDays(
  earlierDateString,
  laterDateString,
) {
  if (
    !earlierDateString ||
    !laterDateString
  ) {
    return null;
  }

  const earlierDate = new Date(
    `${earlierDateString}T00:00:00Z`,
  );

  const laterDate = new Date(
    `${laterDateString}T00:00:00Z`,
  );

  const difference =
    laterDate.getTime() -
    earlierDate.getTime();

  if (!Number.isFinite(difference)) {
    return null;
  }

  return Math.round(
    difference /
    (1000 * 60 * 60 * 24),
  );
}

function getRecoveryState(pair) {
  const timezone =
    pair?.timezone ||
    'UTC';

  const today =
    getTodayDate(timezone);

  const currentMonth =
    getCurrentMonth(timezone);

  const used =
    pair?.last_recovery_month ===
    currentMonth
      ? Number(
          pair?.streak_recoveries_used,
        ) || 0
      : 0;

  const maximum = 5;

  const remaining =
    Math.max(
      0,
      maximum - used,
    );

  const lastPairStreakDate =
    pair?.last_pair_streak_date ||
    null;

  const daysSincePairStreak =
    getDateDifferenceInDays(
      lastPairStreakDate,
      today,
    );

  /*
   * Например:
   * понедельник — последний совместный день;
   * вторник — пропущенный день;
   * среда — единственный день для воскрешения.
   *
   * Поэтому разница должна быть строго равна 2.
   */
  const canRevive =
    Number(pair?.streak_days || 0) > 0 &&
    Boolean(lastPairStreakDate) &&
    daysSincePairStreak === 2 &&
    remaining > 0;

  return {
    canRevive,
    today,
    currentMonth,
    used,
    remaining,
    maximum,
    daysSincePairStreak,
    lastPairStreakDate,
  };
}

function getUtcWeekStart(date = new Date()) {
  const utcDate = new Date(date);

  const day =
    utcDate.getUTCDay();

  const daysSinceMonday =
    day === 0
      ? 6
      : day - 1;

  utcDate.setUTCHours(
    0,
    0,
    0,
    0,
  );

  utcDate.setUTCDate(
    utcDate.getUTCDate() -
    daysSinceMonday,
  );

  return utcDate
    .toISOString()
    .slice(0, 10);
}

function getUtcWeekEnd(
  weekStart = getUtcWeekStart(),
) {
  const weekEnd =
    new Date(
      `${weekStart}T00:00:00.000Z`,
    );

  weekEnd.setUTCDate(
    weekEnd.getUTCDate() + 7,
  );

  return weekEnd.toISOString();
}

async function getWeeklyScoreRank(
  supabase,
  userId,
  weekStart,
  bestScore,
  bestScoreAchievedAt,
) {
  if (
    !Number.isInteger(bestScore) ||
    bestScore <= 0 ||
    !bestScoreAchievedAt
  ) {
    return null;
  }

  const [
    higherResult,
    earlierEqualResult,
    stableEqualResult,
  ] = await Promise.all([
    supabase
      .from('jump_game_scores')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq(
        'week_start',
        weekStart,
      )
      .gt(
        'best_score',
        bestScore,
      ),

    supabase
      .from('jump_game_scores')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq(
        'week_start',
        weekStart,
      )
      .eq(
        'best_score',
        bestScore,
      )
      .lt(
        'best_score_achieved_at',
        bestScoreAchievedAt,
      ),

    supabase
      .from('jump_game_scores')
      .select('*', {
        count: 'exact',
        head: true,
      })
      .eq(
        'week_start',
        weekStart,
      )
      .eq(
        'best_score',
        bestScore,
      )
      .eq(
        'best_score_achieved_at',
        bestScoreAchievedAt,
      )
      .lt(
        'user_id',
        String(userId),
      ),
  ]);

  const rankError =
    higherResult.error ||
    earlierEqualResult.error ||
    stableEqualResult.error;

  if (rankError) {
    throw rankError;
  }

  return (
    Number(
      higherResult.count,
    ) +
    Number(
      earlierEqualResult.count,
    ) +
    Number(
      stableEqualResult.count,
    ) +
    1
  );
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function getJsonByteLength(value) {
  try {
    return new TextEncoder()
      .encode(
        JSON.stringify(value),
      )
      .byteLength;
  } catch {
    return Infinity;
  }
}

const ALLOWED_ORIGINS = [
  'https://chumi.space',
  'https://www.chumi.space',
  'https://app.chumi.space',
  'https://chumi-app.pages.dev',
  'https://web.telegram.org',
  'https://webk.telegram.org',
  'https://webz.telegram.org',
];

function corsHeaders(request) {
  const origin = request?.headers?.get?.('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,X-Telegram-Init-Data,X-Dev-User-Id',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}

async function sendTelegramMessage(env, chatId, text, extra = {}) {
  try {
    const body = { chat_id: chatId, text, parse_mode: 'Markdown', ...extra };

    if (!body.reply_markup) {
      body.reply_markup = {
        inline_keyboard: [[
          { text: '🐾 Открыть Chumi', web_app: { url: 'https://chumi.space' } },
        ]],
      };
    }

    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Проверяем ответ Telegram: если пользователь заблокировал бота
    // (403) или чат не найден — логируем, но не падаем.
    if (!res.ok) {
      let desc = '';
      try { const j = await res.json(); desc = j.description || ''; } catch {}
      const blocked = res.status === 403 || /blocked|deactivated|chat not found/i.test(desc);
      console.warn(`Telegram send failed (chat ${chatId}, status ${res.status})${blocked ? ' [blocked]' : ''}: ${desc}`);
      return { ok: false, blocked, status: res.status, description: desc };
    }
    return { ok: true };
  } catch (e) {
    console.error('Telegram send error:', e);
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
      const description =
        data.description || '';

      const blocked =
        response.status === 403 ||
        /blocked|deactivated|chat not found/i.test(
          description,
        );

      console.warn(
        `Telegram copyMessage failed (chat ${chatId}, status ${response.status})` +
        `${blocked ? ' [blocked]' : ''}: ${description}`,
      );

      return {
        ok: false,
        blocked,
        status: response.status,
        description,
      };
    }

    return {
      ok: true,
      messageId:
        data.result?.message_id ||
        null,
    };
  } catch (error) {
    console.error(
      'Telegram copyMessage error:',
      error,
    );

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

async function sendTelegramSticker(
  env,
  chatId,
  stickerFileId,
) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.BOT_TOKEN}/sendSticker`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          sticker: stickerFileId,
        }),
      },
    );

    if (!res.ok) {
      let description = '';

      try {
        const data = await res.json();
        description =
          data.description || '';
      } catch {}

      const blocked =
        res.status === 403 ||
        /blocked|deactivated|chat not found/i.test(
          description,
        );

      console.warn(
        `Telegram sticker failed (chat ${chatId}, status ${res.status})` +
        `${blocked ? ' [blocked]' : ''}: ${description}`,
      );

      return {
        ok: false,
        blocked,
        status: res.status,
        description,
      };
    }

    return { ok: true };
  } catch (e) {
    console.error(
      'Telegram sticker error:',
      e,
    );

    return {
      ok: false,
      error: String(e),
    };
  }
}

// ────────── Admin notifications ──────────
async function notifyAdmins(env, text) {
  for (const adminId of ADMIN_IDS) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminId,
          text: '🛠 ' + text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {}
  }
}

async function sendAdminPlainMessage(
  env,
  adminId,
  text,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify({
        chat_id: adminId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
      `Telegram sendMessage failed: ${response.status}`,
    );
  }
}

async function loadWeeklyRankingAvatar(
  env,
  userId,
) {
  try {
    const expiresAt =
      Date.now() +
      30 * 60 * 1000;

    const signature =
      await makeAvatarToken(
        env.BOT_TOKEN,
        String(userId),
        expiresAt,
      );

    const avatarUrl =
      `${WEBAPP_URL}` +
      `/api/avatar/${encodeURIComponent(
        String(userId),
      )}` +
      `?proxy=1` +
      `&exp=${expiresAt}` +
      `&sig=${signature}`;

    const response =
      await fetch(
        avatarUrl,
        {
          headers: {
            Accept:
              'image/png,image/jpeg,image/webp',
          },
        },
      );

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get(
        'Content-Type',
      ) || '';

    if (
      !contentType.startsWith(
        'image/',
      )
    ) {
      return null;
    }

    const imageBuffer =
      await response.arrayBuffer();

    /*
     * Ограничиваем размер одной аватарки.
     * Telegram-аватары обычно значительно меньше,
     * но слишком большое изображение не отправляем
     * в сервис генерации карточки.
     */
    if (
      imageBuffer.byteLength === 0 ||
      imageBuffer.byteLength >
        2 * 1024 * 1024
    ) {
      return null;
    }

    const base64 =
      Buffer
        .from(imageBuffer)
        .toString('base64');

    return (
      `data:${contentType};base64,` +
      base64
    );
  } catch (error) {
    console.warn(
      'Weekly ranking avatar load failed:',
      {
        userId:
          String(userId),
        error:
          String(
            error?.message ||
            error,
          ),
      },
    );

    return null;
  }
}

async function createWeeklyRankingImage(
  env,
  rows,
  weekStart,
  weekEnd,
) {
  /*
   * На PNG показываем первые 10 мест.
   * Username и Telegram ID остаются только
   * в текстовом сообщении администратору.
   */
  const imageRows =
    rows.slice(0, 10);

  const cardRows =
    imageRows.map(
      row => {
        const normalizedName =
          String(
            row.display_name ||
            'Игрок',
          )
            .replace(
              /\s+/g,
              ' ',
            )
            .trim()
            .slice(
              0,
              28,
            );

        return {
          rank:
            Number(row.rank) || 0,

          name:
            normalizedName ||
            'Игрок',

          score:
            Number(
              row.best_score,
            ) || 0,

          userId:
            String(row.user_id),
        };
      },
    );

  /*
   * Загружаем последовательно, а не через Promise.all.
   * Это не превышает ограничение Cloudflare
   * на одновременные внешние соединения.
   */
  const avatarDataUrls = [];

  for (const row of cardRows) {
    const avatarDataUrl =
      await loadWeeklyRankingAvatar(
        env,
        row.userId,
      );

    avatarDataUrls.push(
      avatarDataUrl,
    );
  }

  const scores =
    cardRows.map(
      row => row.score,
    );

  const barColors =
    cardRows.map(
      row => {
        if (row.rank === 1) {
          return '#F6C453';
        }

        if (row.rank === 2) {
          return '#BCC5D3';
        }

        if (row.rank === 3) {
          return '#D99A66';
        }

        return '#A77BD8';
      },
    );

  const borderColors =
    cardRows.map(
      row => {
        if (row.rank === 1) {
          return '#D99A27';
        }

        if (row.rank === 2) {
          return '#8E99AA';
        }

        if (row.rank === 3) {
          return '#B66E39';
        }

        return '#7E55AE';
      },
    );

  const chartData = {
    labels:
      cardRows.map(
        () => '',
      ),

    datasets: [
      {
        data: scores,

        backgroundColor:
          barColors,

        borderColor:
          borderColors,

        borderWidth: 2,

        borderRadius: 16,

        borderSkipped: false,

        barThickness: 36,

        maxBarThickness: 36,
      },
    ],
  };

  const chartOptions = {
    indexAxis: 'y',

    responsive: false,

    animation: false,

    maintainAspectRatio: false,

    layout: {
      padding: {
        top: 35,
        right: 100,
        bottom: 45,
        left: 370,
      },
    },

    scales: {
      x: {
        beginAtZero: true,

        grace: '18%',

        border: {
          display: false,
        },

        grid: {
          color:
            'rgba(126, 85, 174, 0.10)',

          lineWidth: 1,
        },

        ticks: {
          display: false,
        },
      },

      y: {
        border: {
          display: false,
        },

        grid: {
          display: false,
        },

        ticks: {
          display: false,
        },
      },
    },

    plugins: {
      legend: {
        display: false,
      },

      title: {
        display: true,

        text: [
          'CHUMI JUMP',
          'Недельный рейтинг',
        ],

        color: '#352743',

        font: {
          size: 34,
          weight: 'bold',
          family:
            'Arial, sans-serif',
        },

        padding: {
          top: 5,
          bottom: 8,
        },
      },

      subtitle: {
        display: true,

        text:
          `${weekStart} — ${weekEnd}`,

        color: '#806C91',

        font: {
          size: 21,
          weight: 'normal',
          family:
            'Arial, sans-serif',
        },

        padding: {
          bottom: 32,
        },
      },

      datalabels: {
        display: true,

        anchor: 'end',

        align: 'right',

        offset: 10,

        clamp: true,

        clip: false,

        color: '#352743',

        font: {
          size: 23,
          weight: 'bold',
          family:
            'Arial, sans-serif',
        },
      },
    },
  };

  /*
   * QuickChart принимает конфигурацию Chart.js
   * не только как JSON, но и как JavaScript-строку.
   *
   * JavaScript-строка нужна для inline-плагина,
   * который рисует круглые аватары и имена.
   */
  const chartSource =
    `{
      type: 'bar',

      data: ${JSON.stringify(
        chartData,
      )},

      options: ${JSON.stringify(
        chartOptions,
      )},

      plugins: [
        {
          id: 'chumiRankingCard',

          afterDraw: function(chart) {
            var ctx = chart.ctx;

            var rows = ${JSON.stringify(
              cardRows.map(
                row => ({
                  rank:
                    row.rank,

                  name:
                    row.name,

                  score:
                    row.score,
                }),
              ),
            )};

            var avatars = ${JSON.stringify(
              avatarDataUrls,
            )};

            var yScale =
              chart.scales.y;

            function getPlaceColor(rank) {
              if (rank === 1) {
                return '#D99A27';
              }

              if (rank === 2) {
                return '#8E99AA';
              }

              if (rank === 3) {
                return '#B66E39';
              }

              return '#7E55AE';
            }

            function getAvatarColor(rank) {
              if (rank === 1) {
                return '#FBE4A1';
              }

              if (rank === 2) {
                return '#E2E6ED';
              }

              if (rank === 3) {
                return '#EBC09F';
              }

              return '#DCC6F3';
            }

            rows.forEach(
              function(row, index) {
                var centerY =
                  yScale.getPixelForValue(
                    index,
                  );

                var rankX = 42;
                var avatarX = 100;
                var nameX = 148;
                var avatarRadius = 29;

                ctx.save();

                ctx.textAlign =
                  'center';

                ctx.textBaseline =
                  'middle';

                ctx.fillStyle =
                  getPlaceColor(
                    row.rank,
                  );

                ctx.font =
                  'bold 25px Arial';

                ctx.fillText(
                  String(row.rank),
                  rankX,
                  centerY,
                );

                ctx.beginPath();

                ctx.arc(
                  avatarX,
                  centerY,
                  avatarRadius + 4,
                  0,
                  Math.PI * 2,
                );

                ctx.fillStyle =
                  getPlaceColor(
                    row.rank,
                  );

                ctx.fill();

                ctx.beginPath();

                ctx.arc(
                  avatarX,
                  centerY,
                  avatarRadius,
                  0,
                  Math.PI * 2,
                );

                ctx.fillStyle =
                  getAvatarColor(
                    row.rank,
                  );

                ctx.fill();

                var avatarDrawn =
                  false;

                if (avatars[index]) {
                  try {
                    var avatarImage =
                      new Image();

                    avatarImage.src =
                      avatars[index];

                    ctx.save();

                    ctx.beginPath();

                    ctx.arc(
                      avatarX,
                      centerY,
                      avatarRadius,
                      0,
                      Math.PI * 2,
                    );

                    ctx.clip();

                    ctx.drawImage(
                      avatarImage,
                      avatarX -
                        avatarRadius,
                      centerY -
                        avatarRadius,
                      avatarRadius * 2,
                      avatarRadius * 2,
                    );

                    ctx.restore();

                    avatarDrawn =
                      true;
                  } catch (
                    avatarError
                  ) {
                    avatarDrawn =
                      false;
                  }
                }

                if (!avatarDrawn) {
                  var firstLetter =
                    String(
                      row.name ||
                      '?',
                    )
                      .trim()
                      .charAt(0)
                      .toUpperCase() ||
                    '?';

                  ctx.fillStyle =
                    '#5D3E7C';

                  ctx.font =
                    'bold 25px Arial';

                  ctx.textAlign =
                    'center';

                  ctx.fillText(
                    firstLetter,
                    avatarX,
                    centerY + 1,
                  );
                }

                ctx.textAlign =
                  'left';

                ctx.textBaseline =
                  'middle';

                ctx.fillStyle =
                  '#352743';

                ctx.font =
                  'bold 24px Arial';

                ctx.fillText(
                  row.name,
                  nameX,
                  centerY,
                );

                ctx.restore();
              },
            );
          },
        },
      ],
    }`;

  const response = await fetch(
    'https://quickchart.io/chart',
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body: JSON.stringify({
        width: 1200,

        height: Math.max(
          800,
          310 +
          cardRows.length * 72,
        ),

        format: 'png',

        backgroundColor:
          '#F8F4FC',

        devicePixelRatio: 1,

        version: '4',

        chart: chartSource,
      }),
    },
  );

  if (!response.ok) {
    const responseText =
      await response
        .text()
        .catch(() => '');

    throw new Error(
      `Ranking image generation failed: ` +
      `${response.status}` +
      (
        responseText
          ? ` — ${responseText.slice(0, 300)}`
          : ''
      ),
    );
  }

  const contentType =
    response.headers.get(
      'Content-Type',
    ) || '';

  if (
    !contentType.includes(
      'image/',
    )
  ) {
    throw new Error(
      `Ranking image generation returned ` +
      `unexpected content type: ` +
      `${contentType || 'unknown'}`,
    );
  }

  return response.blob();
}

async function sendAdminRankingPhoto(
  env,
  adminId,
  photo,
  caption,
) {
  const form = new FormData();

  form.append(
    'chat_id',
    String(adminId),
  );

  form.append(
    'caption',
    caption,
  );

  form.append(
    'photo',
    photo,
    'weekly-chumi-ranking.png',
  );

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`,
    {
      method: 'POST',
      body: form,
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
      `Telegram sendPhoto failed: ${response.status}`,
    );
  }
}

async function sendAdminWeeklyRewardPrompt(
  env,
  adminId,
  weekStart,
  winnerCount,
) {
  const weekKey =
    String(weekStart).replace(
      /-/g,
      '',
    );

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/json',
      },
      body: JSON.stringify({
        chat_id:
          String(adminId),
        text:
          `🎁 Награждение за неделю\n\n` +
          `Неделя: ${weekStart}\n` +
          `Призовых мест: ${winnerCount}\n\n` +
          `Откройте награды, задайте число мест и выберите подарки.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  '🎁 Выбрать подарок',
                callback_data:
                  `admin_reward_open_${weekKey}`,
              },
            ],
          ],
        },
      }),
    },
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok || data.ok === false) {
    throw new Error(
      data.description ||
      `Telegram reward prompt failed: ${response.status}`,
    );
  }
}

function formatWeeklyDuration(
  milliseconds,
) {
  const totalSeconds =
    Math.round(
      Math.max(
        0,
        Number(milliseconds) || 0,
      ) / 1000,
    );

  if (totalSeconds < 60) {
    return `${totalSeconds} сек.`;
  }

  return (
    `${Math.floor(totalSeconds / 60)} мин. ` +
    `${totalSeconds % 60} сек.`
  );
}

function formatWeeklyDistribution(
  items,
  limit = 5,
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return '—';
  }

  return items
    .slice(0, limit)
    .map(
      item =>
        `${item.key}: ${item.count}`,
    )
    .join(' · ');
}

function buildWeeklyStatsChunk(
  summary,
  weekStart,
  weekEnd,
) {
  const rocketAttempts =
    summary.rockets.collected +
    summary.rockets.missed;

  const checkpointText =
    summary.checkpointDistribution
      .map(
        checkpoint =>
          `${checkpoint.score}: ${checkpoint.count}`,
      )
      .join(' · ');

  return (
    `📊 Статистика Chumi Jump за неделю\n` +
    `${weekStart} — ${weekEnd}\n\n` +
    `👥 Уникальные игроки: ${summary.uniquePlayers}\n` +
    `🎮 Забегов: ${summary.sessions}\n` +
    `🔁 Забегов на игрока: ${summary.runsPerPlayer}\n` +
    `♻️ Играли больше раза: ${summary.repeatPlayers}\n\n` +
    `✅ Завершено: ${summary.completed}\n` +
    `🚪 Брошено: ${summary.abandoned}\n` +
    `0️⃣ Нулевой результат: ${summary.zeroScoreRuns}\n\n` +
    `📈 Средний результат: ${summary.score.average}\n` +
    `📊 Медиана: ${summary.score.median}\n` +
    `🏆 Рекорд недели: ${summary.score.maximum}\n\n` +
    `⏱ Средний забег: ${formatWeeklyDuration(summary.activeDurationMs.average)}\n` +
    `⏱ Медиана забега: ${formatWeeklyDuration(summary.activeDurationMs.median)}\n\n` +
    `🎯 Дошли до отметки:\n${checkpointText}\n\n` +
    `🚀 Ракеты: ${summary.rockets.collected} собрано, ` +
    `${summary.rockets.missed} упущено` +
    (
      rocketAttempts > 0
        ? ` (${Math.round(summary.rockets.collectionShare * 100)}%)`
        : ''
    ) +
    `\n` +
    `🧱 Приземлений: ${summary.platformUsage.landings}\n\n` +
    `💀 Причины смерти: ${formatWeeklyDistribution(summary.deathReasons)}\n` +
    `📱 Платформы: ${formatWeeklyDistribution(summary.telegramPlatforms)}\n` +
    `🌐 Языки: ${formatWeeklyDistribution(summary.languages)}\n\n` +
    `🛡 Anti-cheat\n` +
    `Принято: ${summary.accepted} · ` +
    `Подозрительных: ${summary.suspicious} · ` +
    `Отклонено: ${summary.rejected}\n` +
    (
      summary.antiCheatReasons.length > 0
        ? `Причины: ${formatWeeklyDistribution(summary.antiCheatReasons, 6)}\n`
        : ''
    ) +
    `\n💾 Ошибки сохранения: ${summary.saving.errors}\n` +
    `📉 Средний FPS: ${summary.fps.average} · ` +
    `просадки ≥250 мс: ${summary.fps.longFrameGapSessions}`
  );
}

function buildWeeklyRankingChunks(
  rows,
  weekStart,
  weekEnd,
) {
  const header =
    `🏆 Chumi Jump — итоги недели\n` +
    `${weekStart} — ${weekEnd}\n\n`;

  if (rows.length === 0) {
    return [
      header +
      'На этой неделе никто не установил результат.',
    ];
  }

  const lines = rows.map(
    row => {
      const name =
        row.display_name ||
        'Игрок';

      const username =
        row.username
          ? `@${row.username}`
          : 'без username';

      return (
        `${row.rank}. ${name}\n` +
        `   ${username} · ID ${row.user_id}\n` +
        `   ${row.best_score} очков`
      );
    },
  );

  const chunks = [];
  let currentChunk = header;

  for (const line of lines) {
    const nextLine =
      `${line}\n\n`;

    if (
      currentChunk.length +
      nextLine.length >
      3800
    ) {
      chunks.push(
        currentChunk.trimEnd(),
      );

      currentChunk =
        `🏆 Продолжение рейтинга\n\n`;
    }

    currentChunk += nextLine;
  }

  if (currentChunk.trim()) {
    chunks.push(
      currentChunk.trimEnd(),
    );
  }

  return chunks;
}


// ────────── Telegram initData validation ──────────
function validateInitData(
  initDataRaw,
  botToken,
  maxAgeSec = 21_600,
) {
  if (
    typeof initDataRaw !== 'string' ||
    !initDataRaw ||
    typeof botToken !== 'string' ||
    !botToken
  ) {
    return null;
  }

  try {
    const params = new URLSearchParams(initDataRaw);
    const receivedHash = params.get('hash');

    if (
      !receivedHash ||
      !/^[a-f0-9]{64}$/i.test(receivedHash)
    ) {
      return null;
    }

    params.delete('hash');

    const entries = [...params.entries()]
      .sort(([firstKey], [secondKey]) =>
        firstKey.localeCompare(secondKey)
      );

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHmac(
      'sha256',
      'WebAppData',
    )
      .update(botToken)
      .digest();

    const computedHash = createHmac(
      'sha256',
      secretKey,
    )
      .update(dataCheckString)
      .digest('hex');

    const receivedBuffer =
      Buffer.from(receivedHash, 'hex');

    const computedBuffer =
      Buffer.from(computedHash, 'hex');

    if (
      receivedBuffer.length !== computedBuffer.length ||
      !timingSafeEqual(
        receivedBuffer,
        computedBuffer,
      )
    ) {
      return null;
    }

    const authDate = Number(
      params.get('auth_date'),
    );

    if (!Number.isInteger(authDate) || authDate <= 0) {
      return null;
    }

    const currentUnixTime = Math.floor(
      Date.now() / 1000,
    );

    const ageSeconds =
      currentUnixTime - authDate;

    /*
     * Максимум 30 секунд в будущем допускается из-за
     * небольшой разницы часов между устройствами.
     */
    if (
      ageSeconds < -30 ||
      ageSeconds > maxAgeSec
    ) {
      return null;
    }

    const userRaw = params.get('user');

    if (!userRaw) {
      return null;
    }

    const user = JSON.parse(userRaw);
    const userId = user?.id;

    if (
      userId === undefined ||
      userId === null ||
      !/^\d+$/.test(String(userId))
    ) {
      return null;
    }

    return {
      userId: String(userId),
      user,
      authDate,
    };
  } catch (error) {
    console.warn(
      'Telegram initData validation failed:',
      error,
    );

    return null;
  }
}

async function syncAuthenticatedTelegramProfile(
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

  const username =
    telegramUser.username
      ? String(
          telegramUser.username,
        ).slice(0, 100)
      : null;

  /*
   * Авторизованный запрос Mini App
   * фиксирует последнюю активность пользователя.
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
      'Failed to update Mini App activity:',
      activityUpdateError,
    );
  }

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
      'Failed to sync Mini App profile in pair_users:',
      pairUsersError,
    );
  }

  /*
   * updated_at не меняем без необходимости.
   * Время достижения рекорда хранится отдельно
   * в best_score_achieved_at.
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
      'Failed to sync Mini App profile in jump_game_scores:',
      gameScoresError,
    );
  }
}

// Разрешаем dev-обход авторизации ТОЛЬКО когда запрос реально с localhost.
// Это страхует от случайно выставленной ALLOW_DEV_AUTH=1 в продакшене.
function isLocalDev(request, env) {
  if (env.ALLOW_DEV_AUTH !== '1') return false;
  try {
    const host = new URL(request.url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function extractUserId(request, env, bodyUserId, opts = {}) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN, opts.maxAgeSec);
    if (validated) return validated.userId;
  }
  if (isLocalDev(request, env) && bodyUserId) return String(bodyUserId);
  return null;
}

// Возвращает userId вызывающего ТОЛЬКО из проверенного initData (без dev-fallback по URL).
// Для GET-эндпоинтов, где userId нельзя брать из тела/пути.
function getAuthedUserId(request, env) {
  const initData = request.headers.get('X-Telegram-Init-Data');
  if (initData) {
    const validated = validateInitData(initData, env.BOT_TOKEN);
    if (validated) return validated.userId;
  }
  if (isLocalDev(request, env)) {
    // 1) Заголовок (если фронт его прислал)
    const devId = request.headers.get('X-Dev-User-Id');
    if (devId) return String(devId);
    // 2) Query-параметр ?devUser=...
    try {
      const url = new URL(request.url);
      const q = url.searchParams.get('devUser');
      if (q) return String(q);
    } catch {}
  }
  return null;
}

// Проверяет, что userId — участник пары pairCode.
async function isPairMember(supabase, pairCode, userId) {
  if (!pairCode || !userId) return false;
  const { data } = await supabase
    .from('pair_users').select('user_id')
    .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
  return !!data;
}

async function _usersSharePair(
  supabase,
  firstUserId,
  secondUserId
) {
  if (!firstUserId || !secondUserId) {
    return false;
  }

  if (
    String(firstUserId) ===
    String(secondUserId)
  ) {
    return true;
  }

  const {
    data: firstMemberships,
    error: firstError,
  } = await supabase
    .from('pair_users')
    .select('pair_code')
    .eq('user_id', String(firstUserId));

  if (firstError || !firstMemberships?.length) {
    return false;
  }

  const pairCodes = firstMemberships.map(
    (membership) => membership.pair_code
  );

  const {
    data: sharedMembership,
    error: sharedError,
  } = await supabase
    .from('pair_users')
    .select('pair_code')
    .eq('user_id', String(secondUserId))
    .in('pair_code', pairCodes)
    .limit(1)
    .maybeSingle();

  if (sharedError) {
    console.error(
      'Shared pair check failed:',
      sharedError
    );

    return false;
  }

  return Boolean(sharedMembership);
}

function getJumpAnalyticsPeriod(
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
    start =
      new Date(
        `${getUtcWeekStart(end)}T00:00:00.000Z`,
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

function getFiniteNumbers(
  values,
  options = {},
) {
  const minimum =
    Number.isFinite(
      options.minimum,
    )
      ? options.minimum
      : -Infinity;

  const maximum =
    Number.isFinite(
      options.maximum,
    )
      ? options.maximum
      : Infinity;

  return (values || [])
    .map(value =>
      Number(value)
    )
    .filter(value =>
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum
    );
}

function getAverage(
  values,
) {
  const numbers =
    getFiniteNumbers(
      values,
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

function getMedian(
  values,
) {
  const numbers =
    getFiniteNumbers(
      values,
    ).sort(
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

function roundAnalyticsNumber(
  value,
  fractionDigits = 2,
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

function countAnalyticsValues(
  values,
  options = {},
) {
  const fallbackKey =
    options.fallbackKey ||
    'unknown';

  const limit =
    Number.isSafeInteger(
      options.limit,
    )
      ? options.limit
      : 50;

  const counts =
    new Map();

  for (const value of (
    values || []
  )) {
    const normalizedValue =
      String(
        value ??
        fallbackKey,
      )
        .trim()
        .slice(
          0,
          160,
        ) ||
      fallbackKey;

    counts.set(
      normalizedValue,
      (
        counts.get(
          normalizedValue,
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
      limit,
    );
}

function normalizeVerificationReasons(
  value,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(reason =>
      typeof reason ===
      'string'
    )
    .map(reason =>
      reason
        .trim()
        .slice(
          0,
          200,
        )
    )
    .filter(Boolean)
    .slice(
      0,
      64,
    );
}

async function loadJumpAnalyticsSessions(
  supabase,
  start,
  end,
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
        'id, user_id, pair_code, created_at, started_at, expires_at, verified_at, abandoned_at, game_seed, rules_version, client_version, active_duration_ms, paused_duration_ms, frame_count, max_frame_gap_ms, average_fps, minimum_fps, landing_count, normal_landings, cloud_landings, moving_landings, spring_landings, rockets_collected, rockets_missed, maximum_score, death_reason, screen_width, screen_height, telegram_platform, telegram_webapp_version, language, checkpoints, client_metrics, verification_status, verification_reasons, save_duration_ms'
      )
      .gte(
        'created_at',
        start,
      )
      .lt(
        'created_at',
        end,
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

function buildJumpAnalyticsSummary(
  rows,
) {
  const sessions =
    rows || [];

  const completedStatuses =
    new Set([
      'accepted',
      'suspicious',
      'rejected',
    ]);

  const completedSessions =
    sessions.filter(
      session =>
        completedStatuses.has(
          session.verification_status,
        ),
    );

  const abandonedSessions =
    sessions.filter(
      session =>
        session.verification_status ===
          'abandoned',
    );

  const pendingSessions =
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
    completedSessions.map(
      session =>
        Number(
          session.maximum_score,
        ) || 0,
    );

  const activeDurations =
    completedSessions.map(
      session =>
        Number(
          session.active_duration_ms,
        ) || 0,
    );

  const pausedDurations =
    completedSessions.map(
      session =>
        Number(
          session.paused_duration_ms,
        ) || 0,
    );

  const saveDurations =
    completedSessions
      .map(session =>
        Number(
          session.save_duration_ms,
        )
      )
      .filter(value =>
        Number.isFinite(value) &&
        value >= 0
      );

  const averageFpsValues =
    completedSessions
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

  const minimumFpsValues =
    completedSessions
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

  const longFrameGapSessions =
    completedSessions.filter(
      session =>
        Number(
          session.max_frame_gap_ms,
        ) >= 250,
    );

  const pausedSessions =
    completedSessions.filter(
      session =>
        Number(
          session.paused_duration_ms,
        ) > 0,
    );

  const checkpointScores = [
    25,
    50,
    100,
    200,
    300,
    500,
  ];

  const checkpointDistribution =
    checkpointScores.map(
      checkpointScore => {
        const count =
          completedSessions.filter(
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

        return {
          score:
            checkpointScore,

          count,

          share:
            completedSessions.length > 0
              ? roundAnalyticsNumber(
                  count /
                  completedSessions.length,
                  4,
                )
              : 0,
        };
      },
    );

  const verificationReasons = [];

  let saveErrorCount = 0;

  for (const session of sessions) {
    const reasons =
      normalizeVerificationReasons(
        session.verification_reasons,
      );

    verificationReasons.push(
      ...reasons,
    );

    if (
      reasons.some(reason =>
        /save|database|rpc|timeout|network/i.test(
          reason,
        )
      )
    ) {
      saveErrorCount += 1;
    }
  }

  const screenSizes =
    completedSessions.map(
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
    );

  const platformUsage = {
    landings:
      completedSessions.reduce(
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
      completedSessions.reduce(
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
      completedSessions.reduce(
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
      completedSessions.reduce(
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
      completedSessions.reduce(
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
    completedSessions.reduce(
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
    completedSessions.reduce(
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

  const acceptedCount =
    completedSessions.filter(
      session =>
        session.verification_status ===
          'accepted',
    ).length;

  const suspiciousCount =
    completedSessions.filter(
      session =>
        session.verification_status ===
          'suspicious',
    ).length;

  const rejectedCount =
    completedSessions.filter(
      session =>
        session.verification_status ===
          'rejected',
    ).length;

  return {
    uniquePlayers:
      uniquePlayers.size,

    sessions:
      sessions.length,

    completed:
      completedSessions.length,

    abandoned:
      abandonedSessions.length,

    pending:
      pendingSessions.length,

    accepted:
      acceptedCount,

    suspicious:
      suspiciousCount,

    rejected:
      rejectedCount,

    zeroScoreRuns:
      completedSessions.filter(
        session =>
          Number(
            session.maximum_score,
          ) === 0,
      ).length,

    score: {
      average:
        roundAnalyticsNumber(
          getAverage(
            scores,
          ),
        ),

      median:
        roundAnalyticsNumber(
          getMedian(
            scores,
          ),
        ),

      maximum:
        scores.length > 0
          ? Math.max(
              ...scores,
            )
          : 0,
    },

    activeDurationMs: {
      average:
        roundAnalyticsNumber(
          getAverage(
            activeDurations,
          ),
        ),

      median:
        roundAnalyticsNumber(
          getMedian(
            activeDurations,
          ),
        ),

      maximum:
        activeDurations.length > 0
          ? Math.max(
              ...activeDurations,
            )
          : 0,
    },

    runsPerPlayer:
      uniquePlayers.size > 0
        ? roundAnalyticsNumber(
            sessions.length /
            uniquePlayers.size,
          )
        : 0,

    repeatPlayers,

    repeatPlayerShare:
      uniquePlayers.size > 0
        ? roundAnalyticsNumber(
            repeatPlayers /
            uniquePlayers.size,
            4,
          )
        : 0,

    checkpointDistribution,

    deathReasons:
      countAnalyticsValues(
        completedSessions.map(
          session =>
            session.death_reason ||
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    platformUsage,

    rockets: {
      collected:
        rocketsCollected,

      missed:
        rocketsMissed,

      collectionShare:
        rocketsCollected +
          rocketsMissed >
        0
          ? roundAnalyticsNumber(
              rocketsCollected /
              (
                rocketsCollected +
                rocketsMissed
              ),
              4,
            )
          : 0,
    },

    screenSizes:
      countAnalyticsValues(
        screenSizes,
        {
          limit: 20,
        },
      ),

    telegramPlatforms:
      countAnalyticsValues(
        completedSessions.map(
          session =>
            session.telegram_platform ||
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    telegramWebAppVersions:
      countAnalyticsValues(
        completedSessions.map(
          session =>
            session.telegram_webapp_version ||
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    languages:
      countAnalyticsValues(
        completedSessions.map(
          session =>
            session.language ||
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    rulesVersions:
      countAnalyticsValues(
        sessions.map(
          session =>
            session.rules_version ??
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    clientVersions:
      countAnalyticsValues(
        sessions.map(
          session =>
            session.client_version ||
            'unknown',
        ),
        {
          limit: 20,
        },
      ),

    fps: {
      average:
        roundAnalyticsNumber(
          getAverage(
            averageFpsValues,
          ),
        ),

      minimum:
        minimumFpsValues.length > 0
          ? roundAnalyticsNumber(
              Math.min(
                ...minimumFpsValues,
              ),
            )
          : 0,

      longFrameGapSessions:
        longFrameGapSessions.length,

      longFrameGapShare:
        completedSessions.length > 0
          ? roundAnalyticsNumber(
              longFrameGapSessions.length /
              completedSessions.length,
              4,
            )
          : 0,

      averageMaximumFrameGapMs:
        roundAnalyticsNumber(
          getAverage(
            completedSessions.map(
              session =>
                Number(
                  session.max_frame_gap_ms,
                ) || 0,
            ),
          ),
        ),
    },

    pauses: {
      sessions:
        pausedSessions.length,

      share:
        completedSessions.length > 0
          ? roundAnalyticsNumber(
              pausedSessions.length /
              completedSessions.length,
              4,
            )
          : 0,

      averageDurationMs:
        roundAnalyticsNumber(
          getAverage(
            pausedDurations,
          ),
        ),

      medianDurationMs:
        roundAnalyticsNumber(
          getMedian(
            pausedDurations,
          ),
        ),
    },

    saving: {
      errors:
        saveErrorCount,

      averageDurationMs:
        roundAnalyticsNumber(
          getAverage(
            saveDurations,
          ),
        ),

      medianDurationMs:
        roundAnalyticsNumber(
          getMedian(
            saveDurations,
          ),
        ),

      maximumDurationMs:
        saveDurations.length > 0
          ? Math.max(
              ...saveDurations,
            )
          : 0,
    },

    antiCheatReasons:
      countAnalyticsValues(
        verificationReasons,
        {
          limit: 50,
        },
      ),
  };
}

function buildFlaggedJumpRuns(
  rows,
  limit = 50,
) {
  return (rows || [])
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
      limit,
    )
    .map(
      session => ({
        sessionId:
          String(
            session.id,
          ),

        userId:
          String(
            session.user_id,
          ),

        pairCode:
          session.pair_code
            ? String(
                session.pair_code,
              )
            : null,

        score:
          Number(
            session.maximum_score,
          ) || 0,

        status:
          session.verification_status,

        reasons:
          normalizeVerificationReasons(
            session.verification_reasons,
          ),

        createdAt:
          session.created_at,

        verifiedAt:
          session.verified_at,

        rulesVersion:
          Number(
            session.rules_version,
          ) || null,

        clientVersion:
          session.client_version ||
          null,

        activeDurationMs:
          Number(
            session.active_duration_ms,
          ) || 0,

        landingCount:
          Number(
            session.landing_count,
          ) || 0,

        rocketsCollected:
          Number(
            session.rockets_collected,
          ) || 0,

        averageFps:
          roundAnalyticsNumber(
            session.average_fps,
          ),

        minimumFps:
          roundAnalyticsNumber(
            session.minimum_fps,
          ),

        maxFrameGapMs:
          Number(
            session.max_frame_gap_ms,
          ) || 0,
      }),
    );
}

function isCronAuthorized(request, env) {
  if (!env.CRON_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.CRON_SECRET}`;
}

function formatPair(pair, members, tasksToday, userId) {
  const lv = getLevel(pair.growth_points || 0);
  const partner = members?.find(m => m.user_id !== userId);
  const me = members?.find(m => m.user_id === userId);
  const recoveryState = getRecoveryState(pair);

  return {
    code: pair.code,
    pet_type: pair.pet_type,
    pet_name: pair.pet_name,
    streak_days: pair.streak_days || 0,
    growth_points: pair.growth_points || 0,
    level: lv.level,
    levelName: lv.name,
    bg_id: pair.bg_id || 'room',
    is_dead: pair.is_dead || false,
    hatched: pair.hatched || false,
    streak_recoveries_used: recoveryState.used,
    last_recovery_month: pair.last_recovery_month,
    last_streak_date: pair.last_streak_date,
    last_pair_streak_date: pair.last_pair_streak_date,
    can_revive: recoveryState.canRevive,
    recoveries_remaining: recoveryState.remaining,
    recoveries_max: recoveryState.maximum,
    server_today: recoveryState.today,
    days_since_pair_streak: recoveryState.daysSincePairStreak,
    members: members?.map(m => ({
      user_id: m.user_id,
      display_name: m.display_name || null,
      username: m.username || null,
      // avatar_url фронт получает отдельным авторизованным запросом /api/avatar/:id
    })) || [],
    active_skin: pair.active_skin || null,
    active_bg: pair.active_bg || null,
    partner_name: partner?.display_name || null,
    partner_username: partner?.username || null,
    my_name: me?.display_name || null,
    member_count: members?.length || 0,
    daily_tasks: tasksToday || [],
  };
}

// ────────── Подписанные ссылки на аватар ──────────
// Токен = HMAC(botToken, "avatar:<userId>:<expTs>"). Защищает бинарный
// прокси-эндпоинт от перебора чужих user_id: ссылку выдаёт только
// авторизованный JSON-запрос, и живёт она ограниченное время.
async function makeAvatarToken(botToken, userId, expTs) {
  const key = createHmac('sha256', 'AvatarProxy').update(botToken).digest();
  return createHmac('sha256', key)
    .update(`avatar:${userId}:${expTs}`)
    .digest('hex')
    .slice(0, 32);
}

async function verifyAvatarToken(
  botToken,
  userId,
  expTs,
  token,
) {
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{32}$/i.test(token) ||
    !expTs
  ) {
    return false;
  }

  const expiresAt = Number(expTs);

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  /*
   * Не принимаем ссылки, срок которых находится слишком далеко
   * в будущем. Это ограничивает последствия ошибочной генерации.
   */
  if (expiresAt - Date.now() > 2 * 60 * 60 * 1000) {
    return false;
  }

  const expectedToken = await makeAvatarToken(
    botToken,
    userId,
    expiresAt,
  );

  const receivedBuffer =
    Buffer.from(token, 'hex');

  const expectedBuffer =
    Buffer.from(expectedToken, 'hex');

  if (
    receivedBuffer.length !== expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    receivedBuffer,
    expectedBuffer,
  );
}


function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffleWithSeed(arr, seed) {
  const shuffled = [...arr];
  const rng = seededRandom(seed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function createStarsInvoice(botToken, params) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) return null;
  return data.result;
}

// ────────── MAIN HANDLER ──────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(request) });
  }


  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const supabase = getSupabase(env);

    /*
     * Telegram не отправляет отдельное событие
     * при изменении имени или username.
     * Поэтому подхватываем актуальный профиль
     * из подписанного initData при запросах Mini App.
     */
    const initDataForProfile =
      request.headers.get(
        'X-Telegram-Init-Data',
      );

    const shouldSyncProfile =
      (
        request.method === 'GET' &&
        path.match(
          /^\/api\/pairs\/[^/]+$/,
        )
      ) ||
      (
        request.method === 'POST' &&
        path === '/api/game-score'
      );

    if (
      initDataForProfile &&
      shouldSyncProfile
    ) {
      const authenticatedProfile =
        validateInitData(
          initDataForProfile,
          env.BOT_TOKEN,
        );

      if (authenticatedProfile?.user) {
        await syncAuthenticatedTelegramProfile(
          supabase,
          authenticatedProfile.user,
        );
      }
    }

    // ── GET /api/admin/jump-analytics ──
    if (
      request.method === 'GET' &&
      path ===
        '/api/admin/jump-analytics'
    ) {
      const adminUserId =
        getAuthedUserId(
          request,
          env,
        );

      if (!adminUserId) {
        return json(
          {
            error:
              'Unauthorized',
          },
          401,
          request,
        );
      }

      if (
        !ADMIN_IDS.includes(
          String(
            adminUserId,
          ),
        )
      ) {
        return json(
          {
            error:
              'Forbidden',
          },
          403,
          request,
        );
      }

      const requestedPeriod =
        url.searchParams.get(
          'period',
        ) ||
        'today';

      const requestedMode =
        url.searchParams.get(
          'mode',
        ) === 'suspicious'
          ? 'suspicious'
          : 'summary';

      const period =
        getJumpAnalyticsPeriod(
          requestedPeriod,
        );

      let loadedSessions;

      try {
        loadedSessions =
          await loadJumpAnalyticsSessions(
            supabase,
            period.start,
            period.end,
          );
      } catch (analyticsError) {
        console.error(
          'Jump analytics query failed:',
          analyticsError,
        );

        return json(
          {
            error:
              'Failed to load Jump analytics',
          },
          500,
          request,
        );
      }

      const summary =
        buildJumpAnalyticsSummary(
          loadedSessions.rows,
        );

      if (
        requestedMode ===
        'suspicious'
      ) {
        return json(
          {
            period:
              period.period,

            periodStart:
              period.start,

            periodEnd:
              period.end,

            serverTime:
              new Date()
                .toISOString(),

            truncated:
              loadedSessions.truncated,

            summary: {
              sessions:
                summary.sessions,

              suspicious:
                summary.suspicious,

              rejected:
                summary.rejected,

              antiCheatReasons:
                summary.antiCheatReasons,
            },

            runs:
              buildFlaggedJumpRuns(
                loadedSessions.rows,
                50,
              ),
          },
          200,
          request,
        );
      }

      return json(
        {
          period:
            period.period,

          periodStart:
            period.start,

          periodEnd:
            period.end,

          serverTime:
            new Date()
              .toISOString(),

          truncated:
            loadedSessions.truncated,

          summary,
        },
        200,
        request,
      );
    }

    // ── GET /api/app-settings ──
    // Публично возвращает только безопасные настройки интерфейса.
    if (
      request.method === 'GET' &&
      path === '/api/app-settings'
    ) {
      const {
        data: announcementSetting,
        error: announcementSettingError,
      } = await supabase
        .from('app_settings')
        .select('enabled')
        .eq(
          'key',
          'weekly_rating_announcement',
        )
        .maybeSingle();

      if (announcementSettingError) {
        console.error(
          'App settings query failed:',
          announcementSettingError,
        );

        return json(
          {
            error:
              'Failed to load app settings',
            weeklyRatingAnnouncementEnabled:
              false,
          },
          500,
          request,
        );
      }

      return json(
        {
          weeklyRatingAnnouncementEnabled:
            announcementSetting?.enabled === true,
        },
        200,
        request,
      );
    }

    // ── POST /api/admin/app-settings/weekly-rating-announcement ──
    // Изменять глобальную настройку может только администратор.
    if (
      request.method === 'POST' &&
      path ===
        '/api/admin/app-settings/weekly-rating-announcement'
    ) {
      const adminUserId =
        getAuthedUserId(
          request,
          env,
        );

      if (!adminUserId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      if (
        !ADMIN_IDS.includes(
          String(adminUserId),
        )
      ) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      const body = await request
        .json()
        .catch(() => ({}));

      if (
        typeof body.enabled !==
        'boolean'
      ) {
        return json(
          {
            error:
              'enabled must be boolean',
          },
          400,
          request,
        );
      }

      const updatedAt =
        new Date().toISOString();

      const {
        data: updatedSetting,
        error: updateSettingError,
      } = await supabase
        .from('app_settings')
        .upsert(
          {
            key:
              'weekly_rating_announcement',
            enabled:
              body.enabled,
            updated_at:
              updatedAt,
            updated_by:
              String(adminUserId),
          },
          {
            onConflict: 'key',
          },
        )
        .select(
          'enabled, updated_at, updated_by'
        )
        .single();

      if (updateSettingError) {
        console.error(
          'App settings update failed:',
          updateSettingError,
        );

        return json(
          {
            error:
              'Failed to update app settings',
          },
          500,
          request,
        );
      }

      return json(
        {
          success: true,
          weeklyRatingAnnouncementEnabled:
            updatedSetting.enabled === true,
          updatedAt:
            updatedSetting.updated_at,
          updatedBy:
            updatedSetting.updated_by,
        },
        200,
        request,
      );
    }

    // ── POST /api/admin-weekly-game-report ──
    if (
      request.method === 'POST' &&
      path === '/api/admin-weekly-game-report'
    ) {
      if (
        !isCronAuthorized(
          request,
          env,
        )
      ) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      const currentWeekStart =
        getUtcWeekStart();

      const previousWeekDate =
        new Date(
          `${currentWeekStart}T00:00:00.000Z`,
        );

      previousWeekDate.setUTCDate(
        previousWeekDate.getUTCDate() - 7,
      );

      const previousWeekStart =
        previousWeekDate
          .toISOString()
          .slice(0, 10);

      const previousWeekEndDate =
        new Date(
          `${currentWeekStart}T00:00:00.000Z`,
        );

      previousWeekEndDate.setUTCDate(
        previousWeekEndDate.getUTCDate() - 1,
      );

      const previousWeekEnd =
        previousWeekEndDate
          .toISOString()
          .slice(0, 10);

      const {
        data: existingReport,
        error: existingReportError,
      } = await supabase
        .from('weekly_game_reports')
        .select(
          'status, updated_at, sent_at'
        )
        .eq(
          'week_start',
          previousWeekStart,
        )
        .maybeSingle();

      if (existingReportError) {
        console.error(
          'Weekly report status query failed:',
          existingReportError,
        );

        return json(
          {
            error:
              'Failed to check weekly report status',
          },
          500,
          request,
        );
      }

      if (
        existingReport?.status === 'sent'
      ) {
        return json(
          {
            success: true,
            alreadySent: true,
            weekStart:
              previousWeekStart,
            sentAt:
              existingReport.sent_at,
          },
          200,
          request,
        );
      }

      if (
        existingReport?.status ===
        'processing'
      ) {
        const updatedAt =
          new Date(
            existingReport.updated_at,
          ).getTime();

        const isRecent =
          Number.isFinite(updatedAt) &&
          Date.now() - updatedAt <
            15 * 60 * 1000;

        if (isRecent) {
          return json(
            {
              success: true,
              processing: true,
              weekStart:
                previousWeekStart,
            },
            202,
            request,
          );
        }
      }

      const {
        error: claimError,
      } = await supabase
        .from('weekly_game_reports')
        .upsert(
          {
            week_start:
              previousWeekStart,
            status: 'processing',
            player_count: 0,
            started_at:
              new Date().toISOString(),
            updated_at:
              new Date().toISOString(),
            sent_at: null,
          },
          {
            onConflict: 'week_start',
          },
        );

      if (claimError) {
        console.error(
          'Weekly report claim failed:',
          claimError,
        );

        return json(
          {
            error:
              'Failed to claim weekly report',
          },
          500,
          request,
        );
      }

      try {
        const {
          data: scoreRows,
          error: scoreRowsError,
        } = await supabase
          .from('jump_game_scores')
          .select(
            'user_id, display_name, username, best_score, best_score_achieved_at'
          )
          .eq(
            'week_start',
            previousWeekStart,
          )
          .gt(
            'best_score',
            0,
          )
          .order(
            'best_score',
            {
              ascending: false,
            },
          )
          .order(
            'best_score_achieved_at',
            {
              ascending: true,
            },
          )
          .order(
            'user_id',
            {
              ascending: true,
            },
          )
          .limit(1000);

        if (scoreRowsError) {
          throw new Error(
            scoreRowsError.message ||
            'Failed to load weekly scores',
          );
        }

        const rankedRows =
          (scoreRows || []).map(
            (row, index) => {
              const rowScore =
                Number(
                  row.best_score,
                ) || 0;

              return {
                ...row,
                rank:
                  index + 1,
                best_score:
                  rowScore,
              };
            },
          );

        const chunks =
          buildWeeklyRankingChunks(
            rankedRows,
            previousWeekStart,
            previousWeekEnd,
          );

        let rankingImage = null;

        /*
         * Картинка не критична для отчёта.
         * Если QuickChart недоступен,
         * администратор всё равно получает текст.
         */
        if (rankedRows.length > 0) {
          try {
            rankingImage =
              await createWeeklyRankingImage(
                env,
                rankedRows,
                previousWeekStart,
                previousWeekEnd,
              );
          } catch (imageError) {
            console.error(
              'Weekly ranking image failed:',
              imageError,
            );
          }
        }

        let statsChunk = null;

        try {
          const loadedWeekSessions =
            await loadJumpAnalyticsSessions(
              supabase,
              `${previousWeekStart}T00:00:00.000Z`,
              `${currentWeekStart}T00:00:00.000Z`,
            );

          statsChunk =
            buildWeeklyStatsChunk(
              buildJumpAnalyticsSummary(
                loadedWeekSessions.rows,
              ),
              previousWeekStart,
              previousWeekEnd,
            ) +
            (
              loadedWeekSessions.truncated
                ? `\n\n⚠️ Учтены первые 20000 забегов.`
                : ''
            );
        } catch (statsError) {
          console.error(
            'Weekly stats build failed:',
            statsError,
          );
        }

        let rewardWinnerCount = 0;

        const {
          data: rewardsSetting,
        } = await supabase
          .from('app_settings')
          .select('enabled')
          .eq(
            'key',
            'weekly_game_rewards_enabled',
          )
          .maybeSingle();

        const rewardsEnabled =
          rewardsSetting?.enabled === true;

        if (
          rewardsEnabled &&
          rankedRows.length > 0 &&
          ADMIN_IDS.length > 0
        ) {
          const {
            data: preparedRewards,
            error: prepareRewardsError,
          } = await supabase.rpc(
            'prepare_weekly_game_rewards',
            {
              p_week_start:
                previousWeekStart,
              p_admin_chat_id:
                String(ADMIN_IDS[0]),
              p_created_by:
                String(ADMIN_IDS[0]),
            },
          );

          if (prepareRewardsError) {
            throw new Error(
              prepareRewardsError.message ||
              'Failed to prepare weekly rewards',
            );
          }

          const preparedReward =
            Array.isArray(
              preparedRewards,
            )
              ? preparedRewards[0]
              : preparedRewards;

          rewardWinnerCount =
            Number(
              preparedReward?.reward_winner_count,
            ) || Math.min(
              rankedRows.length,
              10,
            );
        }

        for (
          const adminId of ADMIN_IDS
        ) {
          for (
            const chunk of chunks
          ) {
            await sendAdminPlainMessage(
              env,
              adminId,
              chunk,
            );
          }

          if (rankingImage) {
            await sendAdminRankingPhoto(
              env,
              adminId,
              rankingImage,
              `🏆 Chumi Jump: ${previousWeekStart} — ${previousWeekEnd}`,
            );
          }

          if (statsChunk) {
            await sendAdminPlainMessage(
              env,
              adminId,
              statsChunk,
            );
          }

          if (rewardWinnerCount > 0) {
            await sendAdminWeeklyRewardPrompt(
              env,
              adminId,
              previousWeekStart,
              rewardWinnerCount,
            );
          }
        }

        const sentAt =
          new Date().toISOString();

        const {
          error: completeError,
        } = await supabase
          .from('weekly_game_reports')
          .update({
            status: 'sent',
            player_count:
              rankedRows.length,
            sent_at: sentAt,
            updated_at: sentAt,
          })
          .eq(
            'week_start',
            previousWeekStart,
          );

        if (completeError) {
          throw new Error(
            completeError.message ||
            'Failed to complete weekly report',
          );
        }

        return json(
          {
            success: true,
            alreadySent: false,
            weekStart:
              previousWeekStart,
            weekEnd:
              previousWeekEnd,
            playerCount:
              rankedRows.length,
            sentAt,
          },
          200,
          request,
        );
      } catch (error) {
        console.error(
          'Weekly game report failed:',
          error,
        );

        await supabase
          .from('weekly_game_reports')
          .update({
            status: 'failed',
            updated_at:
              new Date().toISOString(),
          })
          .eq(
            'week_start',
            previousWeekStart,
          );

        return json(
          {
            error:
              'Weekly game report failed',
            details:
              String(
                error?.message ||
                error,
              ),
          },
          500,
          request,
        );
      }
    }

    // ── POST /api/admin-ranking-image ──
    if (
      request.method === 'POST' &&
      path ===
        '/api/admin-ranking-image'
    ) {
      if (
        !isCronAuthorized(
          request,
          env,
        )
      ) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      const body = await request
        .json()
        .catch(() => ({}));

      const adminChatId =
        String(
          body.chatId || '',
        );

      /*
       * Эндпоинт вызывается ботом от имени администратора.
       * Картинка отправляется только в админский чат.
       */
      if (
        !ADMIN_IDS.includes(
          adminChatId,
        )
      ) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      const currentWeekStart =
        getUtcWeekStart();

      const usePreviousWeek =
        body.week === 'previous';

      let targetWeekStart =
        currentWeekStart;

      let targetWeekEnd =
        new Date()
          .toISOString()
          .slice(0, 10);

      if (usePreviousWeek) {
        const previousStart =
          new Date(
            `${currentWeekStart}T00:00:00.000Z`,
          );

        previousStart.setUTCDate(
          previousStart.getUTCDate() - 7,
        );

        targetWeekStart =
          previousStart
            .toISOString()
            .slice(0, 10);

        const previousEnd =
          new Date(
            `${currentWeekStart}T00:00:00.000Z`,
          );

        previousEnd.setUTCDate(
          previousEnd.getUTCDate() - 1,
        );

        targetWeekEnd =
          previousEnd
            .toISOString()
            .slice(0, 10);
      }

      const {
        data: scoreRows,
        error: scoreRowsError,
      } = await supabase
        .from('jump_game_scores')
        .select(
          'user_id, display_name, username, best_score, best_score_achieved_at'
        )
        .eq(
          'week_start',
          targetWeekStart,
        )
        .gt(
          'best_score',
          0,
        )
        .order(
          'best_score',
          {
            ascending: false,
          },
        )
        .order(
          'best_score_achieved_at',
          {
            ascending: true,
          },
        )
        .order(
          'user_id',
          {
            ascending: true,
          },
        )
        .limit(10);

      if (scoreRowsError) {
        console.error(
          'Ranking image scores query failed:',
          scoreRowsError,
        );

        return json(
          {
            error:
              'Failed to load weekly scores',
          },
          500,
          request,
        );
      }

      const rankedRows =
        (scoreRows || []).map(
          (row, index) => ({
            ...row,
            rank:
              index + 1,
            best_score:
              Number(
                row.best_score,
              ) || 0,
          }),
        );

      if (rankedRows.length === 0) {
        return json(
          {
            success: true,
            empty: true,
            weekStart:
              targetWeekStart,
          },
          200,
          request,
        );
      }

      try {
        const rankingImage =
          await createWeeklyRankingImage(
            env,
            rankedRows,
            targetWeekStart,
            targetWeekEnd,
          );

        await sendAdminRankingPhoto(
          env,
          adminChatId,
          rankingImage,
          `🏆 Chumi Jump: ${targetWeekStart} — ${targetWeekEnd}` +
            (
              usePreviousWeek
                ? ''
                : ' (неделя идёт)'
            ),
        );
      } catch (imageError) {
        console.error(
          'Ranking image generation failed:',
          imageError,
        );

        return json(
          {
            error:
              'Ranking image generation failed',
            details:
              String(
                imageError?.message ||
                imageError,
              ),
          },
          500,
          request,
        );
      }

      return json(
        {
          success: true,
          empty: false,
          weekStart:
            targetWeekStart,
          weekEnd:
            targetWeekEnd,
          playerCount:
            rankedRows.length,
        },
        200,
        request,
      );
    }

    // ── POST /api/game-session ──
    if (
      request.method === 'POST' &&
      path === '/api/game-session'
    ) {
      const body = await request
        .json()
        .catch(() => ({}));

      const userId = getAuthedUserId(
        request,
        env,
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const pairCode =
        typeof body.pairCode === 'string'
          ? body.pairCode.trim().toUpperCase()
          : '';

      if (!pairCode) {
        return json(
          { error: 'pairCode is required' },
          400,
          request
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          userId
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request
        );
      }

      const oneMinuteAgo =
        new Date(
          Date.now() - 60 * 1000,
        ).toISOString();

      const {
        count: recentSessionCount,
        error: recentSessionError,
      } = await supabase
        .from('jump_game_sessions')
        .select('id', {
          count: 'exact',
          head: true,
        })
        .eq(
          'user_id',
          userId,
        )
        .gte(
          'created_at',
          oneMinuteAgo,
        );

      if (recentSessionError) {
        console.error(
          'Recent game sessions query failed:',
          recentSessionError,
        );

        return json(
          {
            error:
              'Failed to check game session limit',
          },
          500,
          request,
        );
      }

      if (
        Number(
          recentSessionCount,
        ) >= 10
      ) {
        return json(
          {
            error:
              'Too many game sessions',
            retryAfter: 60,
          },
          429,
          request,
        );
      }

      const sessionSeed =
        randomInt(
          1,
          2147483647,
        );

      const startedAt =
        new Date();

      const expiresAt =
        new Date(
          startedAt.getTime() +
          30 * 60 * 1000,
        );

      const requestedClientVersion =
        typeof body.clientVersion ===
          'string'
          ? body.clientVersion
              .trim()
              .slice(0, 64)
          : null;

      const protectedClient =
        requestedClientVersion ===
        JUMP_GAME_CLIENT_VERSION;

      const sessionRulesVersion =
        protectedClient
          ? JUMP_GAME_RULES_VERSION
          : 1;

      const sessionClientVersion =
        protectedClient
          ? JUMP_GAME_CLIENT_VERSION
          : 'legacy';

      const {
        data: session,
        error: sessionError,
      } = await supabase
        .from('jump_game_sessions')
        .insert({
          user_id:
            userId,
          pair_code:
            pairCode,
          started_at:
            startedAt.toISOString(),
          expires_at:
            expiresAt.toISOString(),
          game_seed:
            sessionSeed,
          rules_version:
            sessionRulesVersion,
          client_version:
            sessionClientVersion,
          verification_status:
            'pending',
          verification_reasons:
            [],
        })
        .select(
          'id, started_at, expires_at, game_seed, rules_version'
        )
        .single();

      if (sessionError) {
        console.error(
          'Game session creation failed:',
          sessionError
        );

        return json(
          { error: 'Failed to create game session' },
          500,
          request
        );
      }

      return json(
        {
          sessionId:
            session.id,
          startedAt:
            session.started_at,
          expiresAt:
            session.expires_at,
          seed:
            Number(
              session.game_seed,
            ),
          rulesVersion:
            Number(
              session.rules_version,
            ),
          clientVersion:
            sessionClientVersion,
          serverTime:
            new Date().toISOString(),
        },
        201,
        request
      );
    }

    // ── GET /api/game-score/:pairCode ──
    if (
      request.method === 'GET' &&
      path.match(/^\/api\/game-score\/[^/]+$/)
    ) {
      const pairCode = path
        .split('/')[3]
        .trim()
        .toUpperCase();

      const userId = getAuthedUserId(
        request,
        env
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          userId
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request
        );
      }

      const currentWeekStart =
        getUtcWeekStart();

      const {
        data: personal,
        error: personalError,
      } = await supabase
        .from('jump_game_scores')
        .select(
          'best_score, best_score_achieved_at'
        )
        .eq('user_id', userId)
        .eq(
          'week_start',
          currentWeekStart,
        )
        .maybeSingle();

      if (personalError) {
        console.error(
          'Personal score query failed:',
          personalError
        );

        return json(
          { error: 'Failed to load personal score' },
          500,
          request
        );
      }

      const personalBest =
        Number(personal?.best_score) || 0;

      let rank = null;

      if (
        personalBest > 0 &&
        personal?.best_score_achieved_at
      ) {
        try {
          rank =
            await getWeeklyScoreRank(
              supabase,
              userId,
              currentWeekStart,
              personalBest,
              personal.best_score_achieved_at,
            );
        } catch (rankError) {
          console.error(
            'Rank query failed:',
            rankError,
          );
        }
      }

      return json(
        {
          personalBest,
          rank,
          weekStart:
            currentWeekStart,
          weekEndsAt:
            getUtcWeekEnd(
              currentWeekStart,
            ),
          serverTime:
            new Date().toISOString(),
        },
        200,
        request
      );
    }

    // ── GET /api/game-leaderboard ──
    if (
      request.method === 'GET' &&
      path === '/api/game-leaderboard'
    ) {
      const userId = getAuthedUserId(
        request,
        env
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const currentWeekStart =
        getUtcWeekStart();

      const {
        data: rows,
        error: leadersError,
      } = await supabase
        .from('jump_game_scores')
        .select(
          'user_id, display_name, username, best_score, best_score_achieved_at'
        )
        .eq(
          'week_start',
          currentWeekStart,
        )
        .gt('best_score', 0)
        .order('best_score', {
          ascending: false,
        })
        .order('best_score_achieved_at', {
          ascending: true,
        })
        .order('user_id', {
          ascending: true,
        })
        .limit(50);

      if (leadersError) {
        console.error(
          'Leaderboard query failed:',
          leadersError
        );

        return json(
          { error: 'Failed to load leaderboard' },
          500,
          request
        );
      }

      /*
       * Место всегда уникально.
       * При одинаковых очках выше пользователь,
       * который раньше установил результат.
       */
      const rankedLeaders = (rows || []).map(
        (row, index) => {
          const rowScore =
            Number(row.best_score) || 0;

          return {
            rank:
              index + 1,
            userId:
              String(row.user_id),
            displayName:
              row.display_name ||
              'Player',
            username:
              row.username || null,
            score:
              rowScore,
            achievedAt:
              row.best_score_achieved_at,
            isMe:
              String(row.user_id) ===
              String(userId),
          };
        },
      );

      /*
       * <img> не может отправить X-Telegram-Init-Data,
       * поэтому создаём для каждой аватарки временную
       * подписанную ссылку.
       *
       * Ссылка доступна любому пользователю,
       * получившему результат рейтинга, и действует 1 час.
       * Само изображение отдельно кешируется браузером/CDN.
       */
      const avatarExpiresAt =
        Date.now() + 60 * 60 * 1000;

      const leaders = await Promise.all(
        rankedLeaders.map(async leader => {
          const avatarSignature =
            await makeAvatarToken(
              env.BOT_TOKEN,
              leader.userId,
              avatarExpiresAt,
            );

          const avatarUrl =
            `/api/avatar/${encodeURIComponent(
              leader.userId,
            )}` +
            `?proxy=1` +
            `&exp=${avatarExpiresAt}` +
            `&sig=${avatarSignature}`;

          return {
            ...leader,
            avatarUrl,
          };
        }),
      );

      const {
        data: personal,
        error: personalError,
      } = await supabase
        .from('jump_game_scores')
        .select(
          'best_score, best_score_achieved_at'
        )
        .eq('user_id', userId)
        .eq(
          'week_start',
          currentWeekStart,
        )
        .maybeSingle();

      if (personalError) {
        console.error(
          'Personal leaderboard query failed:',
          personalError
        );
      }

      const personalBest =
        Number(personal?.best_score) || 0;

      let personalRank = null;

      if (
        personalBest > 0 &&
        personal?.best_score_achieved_at
      ) {
        try {
          personalRank =
            await getWeeklyScoreRank(
              supabase,
              userId,
              currentWeekStart,
              personalBest,
              personal.best_score_achieved_at,
            );
        } catch (rankError) {
          console.error(
            'Personal rank query failed:',
            rankError,
          );
        }
      }

      return json(
        {
          leaders,
          me: personalBest > 0
            ? {
                rank:
                  personalRank,
                score:
                  personalBest,
                achievedAt:
                  personal.best_score_achieved_at,
              }
            : null,
          weekStart:
            currentWeekStart,
          weekEndsAt:
            getUtcWeekEnd(
              currentWeekStart,
            ),
          serverTime:
            new Date().toISOString(),
        },
        200,
        request
      );
    }

    // ── GET /api/game-pair-leaderboard ──
    if (
      request.method === 'GET' &&
      path ===
        '/api/game-pair-leaderboard'
    ) {
      const userId =
        getAuthedUserId(
          request,
          env,
        );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      const currentWeekStart =
        getUtcWeekStart();

      const {
        data: rows,
        error: pairLeadersError,
      } = await supabase
        .from(
          'jump_game_pair_weekly_leaderboard',
        )
        .select(
          'week_start, pair_code, pair_name, pet_type, scoring_member_count, total_score, total_score_achieved_at'
        )
        .eq(
          'week_start',
          currentWeekStart,
        )
        .gt(
          'total_score',
          0,
        )
        .order(
          'total_score',
          {
            ascending: false,
          },
        )
        .order(
          'total_score_achieved_at',
          {
            ascending: true,
          },
        )
        .order(
          'pair_code',
          {
            ascending: true,
          },
        )
        .limit(50);

      if (pairLeadersError) {
        console.error(
          'Pair leaderboard query failed:',
          pairLeadersError,
        );

        return json(
          {
            error:
              'Failed to load pair leaderboard',
          },
          500,
          request,
        );
      }

      const pairCodes =
        (rows || []).map(
          row =>
            String(
              row.pair_code,
            ),
        );

      let memberRows = [];

      if (pairCodes.length > 0) {
        const {
          data: loadedMembers,
          error: membersError,
        } = await supabase
          .from('pair_users')
          .select(
            'pair_code, user_id, display_name, username'
          )
          .in(
            'pair_code',
            pairCodes,
          )
          .order(
            'pair_code',
            {
              ascending: true,
            },
          )
          .order(
            'user_id',
            {
              ascending: true,
            },
          );

        if (membersError) {
          console.error(
            'Pair leaderboard members query failed:',
            membersError,
          );
        } else {
          memberRows =
            loadedMembers || [];
        }
      }

      const {
        data: myMemberships,
        error: myMembershipsError,
      } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq(
          'user_id',
          userId,
        );

      if (myMembershipsError) {
        console.error(
          'Pair leaderboard membership query failed:',
          myMembershipsError,
        );
      }

      const myPairCodes =
        new Set(
          (myMemberships || []).map(
            membership =>
              String(
                membership.pair_code,
              ),
          ),
        );

      const membersByPair =
        new Map();

      for (const member of memberRows) {
        const memberPairCode =
          String(
            member.pair_code,
          );

        if (
          !membersByPair.has(
            memberPairCode,
          )
        ) {
          membersByPair.set(
            memberPairCode,
            [],
          );
        }

        membersByPair
          .get(memberPairCode)
          .push(member);
      }

      const avatarExpiresAt =
        Date.now() +
        60 * 60 * 1000;

      const leaders = [];

      for (
        let index = 0;
        index < (rows || []).length;
        index += 1
      ) {
        const row =
          rows[index];

        const pairCode =
          String(
            row.pair_code,
          );

        const members = [];

        for (
          const member of
          membersByPair.get(
            pairCode,
          ) || []
        ) {
          const memberUserId =
            String(
              member.user_id,
            );

          const avatarSignature =
            await makeAvatarToken(
              env.BOT_TOKEN,
              memberUserId,
              avatarExpiresAt,
            );

          members.push({
            userId:
              memberUserId,
            displayName:
              member.display_name ||
              'Player',
            username:
              member.username ||
              null,
            avatarUrl:
              `/api/avatar/${encodeURIComponent(
                memberUserId,
              )}` +
              `?proxy=1` +
              `&exp=${avatarExpiresAt}` +
              `&sig=${avatarSignature}`,
          });
        }

        leaders.push({
          rank:
            index + 1,
          pairCode,
          pairName:
            row.pair_name ||
            'Chumi',
          petType:
            row.pet_type ||
            null,
          score:
            Number(
              row.total_score,
            ) || 0,
          scoringMemberCount:
            Number(
              row.scoring_member_count,
            ) || 0,
          achievedAt:
            row.total_score_achieved_at,
          members,
          isMyPair:
            myPairCodes.has(
              pairCode,
            ),
        });
      }

      return json(
        {
          leaders,
          weekStart:
            currentWeekStart,
          weekEndsAt:
            getUtcWeekEnd(
              currentWeekStart,
            ),
          serverTime:
            new Date().toISOString(),
        },
        200,
        request,
      );
    }

    // ── POST /api/game-score ──
    if (
      request.method === 'POST' &&
      path === '/api/game-score'
    ) {
      const body = await request
        .json()
        .catch(() => ({}));

      const initDataRaw = request.headers.get(
        'X-Telegram-Init-Data'
      );

      const telegramData = initDataRaw
        ? validateInitData(
            initDataRaw,
            env.BOT_TOKEN
          )
        : null;

      const userId = getAuthedUserId(
        request,
        env,
      );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request
        );
      }

      const pairCode =
        typeof body.pairCode === 'string'
          ? body.pairCode.trim().toUpperCase()
          : '';

      const sessionId =
        typeof body.sessionId === 'string'
          ? body.sessionId.trim()
          : '';

      const score =
        body.score;

      if (!pairCode) {
        return json(
          { error: 'pairCode is required' },
          400,
          request
        );
      }

      if (!sessionId) {
        return json(
          { error: 'sessionId is required' },
          400,
          request
        );
      }

      if (
        !Number.isInteger(score) ||
        score < 0 ||
        score > 100000
      ) {
        return json(
          { error: 'Invalid score' },
          400,
          request
        );
      }

      const submittedRulesVersion =
        body.rulesVersion;

      const {
        data: gameSession,
        error: gameSessionError,
      } = await supabase
        .from(
          'jump_game_sessions',
        )
        .select(
          'id, user_id, pair_code, game_seed, rules_version, client_version, verification_status, verification_reasons, expires_at'
        )
        .eq(
          'id',
          sessionId,
        )
        .eq(
          'user_id',
          userId,
        )
        .eq(
          'pair_code',
          pairCode,
        )
        .maybeSingle();

      if (gameSessionError) {
        console.error(
          'Game session validation failed:',
          gameSessionError,
        );

        return json(
          {
            error:
              'Failed to validate game session',
          },
          500,
          request,
        );
      }

      if (!gameSession) {
        return json(
          {
            error:
              'Game session not found',
          },
          400,
          request,
        );
      }

      if (
        gameSession.verification_status !==
        'pending'
      ) {
        const previousStatus =
          gameSession.verification_status;

        return json(
          {
            success: true,
            alreadyFinished: true,
            accepted:
              previousStatus ===
              'accepted',
            verificationStatus:
              previousStatus,
          },
          200,
          request,
        );
      }

      const sessionExpiresAt =
        Date.parse(
          gameSession.expires_at ||
          '',
        );

      if (
        !Number.isFinite(
          sessionExpiresAt,
        ) ||
        sessionExpiresAt <=
          Date.now()
      ) {
        return json(
          {
            error:
              'Game session has expired',
            code:
              'GAME_SESSION_EXPIRED',
          },
          409,
          request,
        );
      }

      const sessionRulesVersion =
        Number(
          gameSession.rules_version,
        );

      const useVerifiedSubmission =
        sessionRulesVersion ===
        JUMP_GAME_RULES_VERSION;

      if (
        useVerifiedSubmission &&
        gameSession.client_version !==
          JUMP_GAME_CLIENT_VERSION
      ) {
        return json(
          {
            error:
              'Protected game client version mismatch',
            code:
              'GAME_CLIENT_VERSION_MISMATCH',
          },
          409,
          request,
        );
      }

      if (
        useVerifiedSubmission &&
        submittedRulesVersion !==
          JUMP_GAME_RULES_VERSION
      ) {
        return json(
          {
            error:
              'Protected game metrics are required',
            code:
              'PROTECTED_GAME_METRICS_REQUIRED',
          },
          409,
          request,
        );
      }

      if (
        !useVerifiedSubmission &&
        submittedRulesVersion ===
          JUMP_GAME_RULES_VERSION
      ) {
        return json(
          {
            error:
              'Game rules version mismatch',
            code:
              'GAME_RULES_VERSION_MISMATCH',
          },
          409,
          request,
        );
      }

      let verifiedMetrics = null;

      if (useVerifiedSubmission) {
        const protectedSeed =
          Number(
            gameSession.game_seed,
          );

        if (
          !Number.isSafeInteger(
            protectedSeed,
          ) ||
          protectedSeed < 1 ||
          protectedSeed > 2147483646
        ) {
          return json(
            {
              error:
                'Game session seed is invalid',
            },
            409,
            request,
          );
        }

        const metrics =
          body.metrics;

        const checkpoints =
          metrics?.checkpoints ??
          body.checkpoints;

        const clientMetrics =
          metrics?.clientMetrics ??
          body.clientMetrics;

        const integerMetrics = {
          activeDurationMs:
            24 * 60 * 60 * 1000,
          pausedDurationMs:
            24 * 60 * 60 * 1000,
          frameCount:
            10_000_000,
          maxFrameGapMs:
            24 * 60 * 60 * 1000,
          landingCount:
            1_000_000,
          normalLandings:
            1_000_000,
          cloudLandings:
            1_000_000,
          movingLandings:
            1_000_000,
          springLandings:
            1_000_000,
          rocketsCollected:
            100_000,
          rocketsMissed:
            100_000,
          maximumScore:
            100_000,
          screenWidth:
            10_000,
          screenHeight:
            10_000,
        };

        if (
          !isPlainObject(
            metrics,
          )
        ) {
          return json(
            {
              error:
                'Game metrics are required',
            },
            400,
            request,
          );
        }

        if (
          getJsonByteLength(
            metrics,
          ) > 64 * 1024
        ) {
          return json(
            {
              error:
                'Game metrics are too large',
            },
            413,
            request,
          );
        }

        for (
          const [
            metricName,
            maximumValue,
          ] of Object.entries(
            integerMetrics,
          )
        ) {
          const metricValue =
            metrics[metricName];

          const minimumValue =
            metricName ===
              'screenWidth' ||
            metricName ===
              'screenHeight'
              ? 1
              : 0;

          if (
            typeof metricValue !==
              'number' ||
            !Number.isSafeInteger(
              metricValue,
            ) ||
            metricValue <
              minimumValue ||
            metricValue >
              maximumValue
          ) {
            return json(
              {
                error:
                  `Invalid game metric: ${metricName}`,
              },
              400,
              request,
            );
          }
        }

        const typedLandingCount =
          metrics.normalLandings +
          metrics.cloudLandings +
          metrics.movingLandings +
          metrics.springLandings;

        if (
          typedLandingCount !==
          metrics.landingCount
        ) {
          return json(
            {
              error:
                'Landing metrics mismatch',
            },
            400,
            request,
          );
        }

        if (
          metrics.rocketsCollected >
            metrics.landingCount +
            1000
        ) {
          return json(
            {
              error:
                'Rocket metrics mismatch',
            },
            400,
            request,
          );
        }

        const averageFps =
          metrics.averageFps;

        const minimumFps =
          metrics.minimumFps;

        if (
          typeof averageFps !==
            'number' ||
          !Number.isFinite(
            averageFps,
          ) ||
          averageFps < 0 ||
          averageFps > 240 ||
          typeof minimumFps !==
            'number' ||
          !Number.isFinite(
            minimumFps,
          ) ||
          minimumFps < 0 ||
          minimumFps > 240 ||
          minimumFps >
            averageFps
        ) {
          return json(
            {
              error:
                'Invalid FPS metrics',
            },
            400,
            request,
          );
        }

        const allowedDeathReasons =
          new Set([
            'fall',
            'spike',
            'exit',
            'closed',
            'unknown',
          ]);

        const deathReason =
          typeof metrics.deathReason ===
            'string'
            ? metrics.deathReason
            : '';

        if (
          !allowedDeathReasons.has(
            deathReason,
          )
        ) {
          return json(
            {
              error:
                'Invalid death reason',
            },
            400,
            request,
          );
        }

        if (
          !Array.isArray(
            checkpoints,
          ) ||
          checkpoints.length > 6 ||
          getJsonByteLength(
            checkpoints,
          ) > 8 * 1024
        ) {
          return json(
            {
              error:
                'Invalid checkpoints',
            },
            400,
            request,
          );
        }

        const allowedCheckpointScores =
          new Set([
            25,
            50,
            100,
            200,
            300,
            500,
          ]);

        const expectedCheckpointScores = [
          25,
          50,
          100,
          200,
          300,
          500,
        ].filter(
          checkpointScore =>
            checkpointScore <= score,
        );

        let previousCheckpointScore = 0;

        for (
          let checkpointIndex = 0;
          checkpointIndex <
            checkpoints.length;
          checkpointIndex += 1
        ) {
          const checkpoint =
            checkpoints[
              checkpointIndex
            ];

          if (
            !isPlainObject(
              checkpoint,
            )
          ) {
            return json(
              {
                error:
                  'Invalid checkpoint',
              },
              400,
              request,
            );
          }

          const checkpointScore =
            checkpoint.score;

          if (
            typeof checkpointScore !==
              'number' ||
            !Number.isSafeInteger(
              checkpointScore,
            ) ||
            !allowedCheckpointScores.has(
              checkpointScore,
            ) ||
            checkpointScore <=
              previousCheckpointScore ||
            checkpointScore > score
          ) {
            return json(
              {
                error:
                  'Invalid checkpoint score',
              },
              400,
              request,
            );
          }

          const checkpointIntegerFields = [
            'activeDurationMs',
            'landingCount',
            'rocketsCollected',
          ];

          for (
            const checkpointField of
            checkpointIntegerFields
          ) {
            const checkpointValue =
              checkpoint[
                checkpointField
              ];

            if (
              typeof checkpointValue !==
                'number' ||
              !Number.isSafeInteger(
                checkpointValue,
              ) ||
              checkpointValue < 0
            ) {
              return json(
                {
                  error:
                    `Invalid checkpoint metric: ${checkpointField}`,
                },
                400,
                request,
              );
            }
          }

          if (
            checkpoint.activeDurationMs >
              metrics.activeDurationMs ||
            checkpoint.landingCount >
              metrics.landingCount ||
            checkpoint.rocketsCollected >
              metrics.rocketsCollected
          ) {
            return json(
              {
                error:
                  'Checkpoint exceeds final metrics',
              },
              400,
              request,
            );
          }

          if (
            checkpointScore !==
            expectedCheckpointScores[
              checkpointIndex
            ]
          ) {
            return json(
              {
                error:
                  'Checkpoint sequence mismatch',
              },
              400,
              request,
            );
          }

          previousCheckpointScore =
            checkpointScore;
        }

        if (
          checkpoints.length !==
          expectedCheckpointScores.length
        ) {
          return json(
            {
              error:
                'Required checkpoints are missing',
            },
            400,
            request,
          );
        }

        if (
          !isPlainObject(
            clientMetrics,
          ) ||
          getJsonByteLength(
            clientMetrics,
          ) > 16 * 1024
        ) {
          return json(
            {
              error:
                'Invalid client metrics',
            },
            400,
            request,
          );
        }

        if (
          clientMetrics.seed !==
          protectedSeed
        ) {
          return json(
            {
              error:
                'Game seed mismatch',
            },
            400,
            request,
          );
        }

        if (
          clientMetrics.rulesVersion !==
          JUMP_GAME_RULES_VERSION
        ) {
          return json(
            {
              error:
                'Client rules version mismatch',
            },
            400,
            request,
          );
        }

        if (
          clientMetrics.clientVersion !==
          JUMP_GAME_CLIENT_VERSION
        ) {
          return json(
            {
              error:
                'Client version mismatch',
            },
            400,
            request,
          );
        }

        if (
          typeof clientMetrics.distance !==
            'number' ||
          !Number.isFinite(
            clientMetrics.distance,
          ) ||
          clientMetrics.distance < 0 ||
          clientMetrics.distance >
            10_000_000
        ) {
          return json(
            {
              error:
                'Invalid client distance',
            },
            400,
            request,
          );
        }

        const clientIntegerMetrics = [
          'remainingPlatforms',
          'remainingRockets',
        ];

        for (
          const metricName of
          clientIntegerMetrics
        ) {
          const metricValue =
            clientMetrics[
              metricName
            ];

          if (
            typeof metricValue !==
              'number' ||
            !Number.isSafeInteger(
              metricValue,
            ) ||
            metricValue < 0 ||
            metricValue >
              100_000
          ) {
            return json(
              {
                error:
                  `Invalid client metric: ${metricName}`,
              },
              400,
              request,
            );
          }
        }

        const expectedDistance =
          score * 10;

        if (
          Math.abs(
            clientMetrics.distance -
            expectedDistance,
          ) >= 10
        ) {
          return json(
            {
              error:
                'Client distance mismatch',
            },
            400,
            request,
          );
        }

        if (
          metrics.maximumScore !==
          score
        ) {
          return json(
            {
              error:
                'Maximum score mismatch',
            },
            400,
            request,
          );
        }

        const stringMetricLimits = {
          telegramPlatform: 32,
          telegramWebAppVersion: 32,
          language: 16,
        };

        const normalizedStringMetrics = {};

        for (
          const [
            metricName,
            maximumLength,
          ] of Object.entries(
            stringMetricLimits,
          )
        ) {
          const metricValue =
            metrics[metricName];

          if (
            metricValue ===
              undefined ||
            metricValue === null ||
            metricValue === ''
          ) {
            normalizedStringMetrics[
              metricName
            ] = null;

            continue;
          }

          if (
            typeof metricValue !==
              'string'
          ) {
            return json(
              {
                error:
                  `Invalid game metric: ${metricName}`,
              },
              400,
              request,
            );
          }

          const normalizedMetricValue =
            metricValue.trim();

          if (
            normalizedMetricValue.length ===
              0 ||
            normalizedMetricValue.length >
              maximumLength
          ) {
            return json(
              {
                error:
                  `Invalid game metric: ${metricName}`,
              },
              400,
              request,
            );
          }

          normalizedStringMetrics[
            metricName
          ] = normalizedMetricValue;
        }

        verifiedMetrics = {
          ...metrics,
          ...normalizedStringMetrics,
          averageFps,
          minimumFps,
          deathReason,
          checkpoints,
          clientMetrics,
        };
      }

      const displayName =
        [
          telegramData?.user?.first_name,
          telegramData?.user?.last_name,
        ]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100) ||
        telegramData?.user?.username ||
        null;

      const username =
        telegramData?.user?.username || null;

      const saveStartedAt =
        Date.now();

      const rpcResult =
        useVerifiedSubmission
          ? await supabase.rpc(
              'finish_jump_game_v2',
              {
                p_session_id:
                  sessionId,
                p_user_id:
                  userId,
                p_pair_code:
                  pairCode,
                p_score:
                  score,
                p_active_duration_ms:
                  Number(
                    verifiedMetrics
                      .activeDurationMs,
                  ),
                p_paused_duration_ms:
                  Number(
                    verifiedMetrics
                      .pausedDurationMs,
                  ),
                p_frame_count:
                  Number(
                    verifiedMetrics
                      .frameCount,
                  ),
                p_max_frame_gap_ms:
                  Number(
                    verifiedMetrics
                      .maxFrameGapMs,
                  ),
                p_average_fps:
                  verifiedMetrics
                    .averageFps,
                p_minimum_fps:
                  verifiedMetrics
                    .minimumFps,
                p_landing_count:
                  Number(
                    verifiedMetrics
                      .landingCount,
                  ),
                p_normal_landings:
                  Number(
                    verifiedMetrics
                      .normalLandings,
                  ),
                p_cloud_landings:
                  Number(
                    verifiedMetrics
                      .cloudLandings,
                  ),
                p_moving_landings:
                  Number(
                    verifiedMetrics
                      .movingLandings,
                  ),
                p_spring_landings:
                  Number(
                    verifiedMetrics
                      .springLandings,
                  ),
                p_rockets_collected:
                  Number(
                    verifiedMetrics
                      .rocketsCollected,
                  ),
                p_rockets_missed:
                  Number(
                    verifiedMetrics
                      .rocketsMissed,
                  ),
                p_maximum_score:
                  Number(
                    verifiedMetrics
                      .maximumScore,
                  ),
                p_death_reason:
                  verifiedMetrics
                    .deathReason,
                p_screen_width:
                  Number(
                    verifiedMetrics
                      .screenWidth,
                  ),
                p_screen_height:
                  Number(
                    verifiedMetrics
                      .screenHeight,
                  ),
                p_telegram_platform:
                  verifiedMetrics
                    .telegramPlatform ||
                  null,
                p_telegram_webapp_version:
                  verifiedMetrics
                    .telegramWebAppVersion ||
                  null,
                p_language:
                  verifiedMetrics
                    .language ||
                  null,
                p_checkpoints:
                  verifiedMetrics
                    .checkpoints,
                p_client_metrics:
                  verifiedMetrics
                    .clientMetrics,
                p_display_name:
                  displayName,
                p_username:
                  username,
              },
            )
          : await supabase.rpc(
              'finish_jump_game',
              {
                p_session_id:
                  sessionId,
                p_user_id:
                  userId,
                p_pair_code:
                  pairCode,
                p_score:
                  score,
                p_display_name:
                  displayName,
                p_username:
                  username,
              },
            );

      const {
        data: rpcData,
        error,
      } = rpcResult;

      const data =
        Array.isArray(
          rpcData,
        )
          ? (
              rpcData[0] ||
              null
            )
          : rpcData;

      const saveDurationMs =
        Math.max(
          0,
          Date.now() -
          saveStartedAt,
        );

      if (!error) {
        const legacyUpdate =
          useVerifiedSubmission
            ? {
                save_duration_ms:
                  saveDurationMs,
              }
            : {
                save_duration_ms:
                  saveDurationMs,
                verification_status:
                  'accepted',
                verification_reasons:
                  [
                    'legacy_api_fallback',
                  ],
                verified_at:
                  new Date()
                    .toISOString(),
              };

        const {
          error: sessionMetricsError,
        } = await supabase
          .from(
            'jump_game_sessions',
          )
          .update(
            legacyUpdate,
          )
          .eq(
            'id',
            sessionId,
          )
          .eq(
            'user_id',
            userId,
          );

        if (sessionMetricsError) {
          console.error(
            'Game session save duration update failed:',
            sessionMetricsError,
          );
        }
      }

      if (error) {
        console.error(
          'Game score submission failed:',
          error
        );

        const previousReasons =
          normalizeVerificationReasons(
            gameSession.verification_reasons,
          );

        const nextReasons =
          previousReasons.includes(
            'save_rpc_error',
          )
            ? previousReasons
            : [
                ...previousReasons,
                'save_rpc_error',
              ];

        const {
          error: saveFailureUpdateError,
        } = await supabase
          .from(
            'jump_game_sessions',
          )
          .update({
            save_duration_ms:
              saveDurationMs,
            verification_reasons:
              nextReasons,
          })
          .eq(
            'id',
            sessionId,
          )
          .eq(
            'user_id',
            userId,
          )
          .eq(
            'verification_status',
            'pending',
          );

        if (saveFailureUpdateError) {
          console.error(
            'Game save failure metrics update failed:',
            saveFailureUpdateError,
          );
        }

        const message =
          error.message || 'Failed to save score';

        const clientError =
          /session|score|member|pair/i.test(
            message
          );

        return json(
          {
            error: message,
          },
          clientError ? 400 : 500,
          request
        );
      }

      // ── Уведомление партнёру о новом личном рекорде ──
      // isPersonalRecord приходит из RPC finish_jump_game. Шлём партнёру
      // сообщение «установил новый личный рекорд: N». Не роняем сохранение
      // счёта, если Telegram-отправка не удалась.
      if (
        data &&
        (
          !useVerifiedSubmission ||
          data.accepted === true
        ) &&
        data.isPersonalRecord === true &&
        score > 0
      ) {
        try {
          const { data: recordMembers } = await supabase
            .from('pair_users')
            .select('user_id')
            .eq('pair_code', pairCode);

          const recordPartner = (recordMembers || [])
            .find(m => String(m.user_id) !== String(userId));

          if (recordPartner) {
            const { data: recordPs } = await supabase
              .from('user_settings')
              .select('lang')
              .eq('telegram_user_id', recordPartner.user_id)
              .maybeSingle();

            const recordLang = recordPs?.lang || 'ru';
            const recordPlayerName = displayName
              || (recordLang === 'ru' ? 'Партнёр' : 'Partner');
            const safeRecordPlayer = escapeMd(recordPlayerName);

            const recordText = recordLang === 'ru'
              ? `🏆 *${safeRecordPlayer}* установил новый личный рекорд в игре: *${score}* очков! 🎮`
              : `🏆 *${safeRecordPlayer}* set a new personal best in the game: *${score}* points! 🎮`;
            const recordBtn = recordLang === 'ru' ? '🎮 Играть' : '🎮 Play';

            await sendTelegramMessage(env, recordPartner.user_id, recordText, {
              reply_markup: {
                inline_keyboard: [[{ text: recordBtn, web_app: { url: 'https://chumi.space' } }]],
              },
            });
          }
        } catch (notifyError) {
          console.error('Game record notify error:', notifyError);
        }
      }

      return json(
        data || { success: true },
        200,
        request
      );
    }

    // ── GET /api/pairs/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/pairs\/[^/]+$/)) {
      const userId = path.split('/')[3];

      // ── Авторизация: запросить пары можно только за самого себя ──
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403, request);

      const { data: userPairs } = await supabase
        .from('pair_users')
        .select('pair_code')
        .eq('user_id', userId);

      if (!userPairs || userPairs.length === 0) return json({ pairs: [] }, 200, request);

      const pairs = [];
      for (const up of userPairs) {
        const { data: pair } = await supabase
          .from('pairs').select('*').eq('code', up.pair_code).maybeSingle();
        if (!pair) continue;

        const today = getTodayDate(pair.timezone || 'UTC');

        const { data: members } = await supabase
          .from('pair_users').select('*').eq('pair_code', up.pair_code);

        const { data: tasks } = await supabase
          .from('daily_tasks').select('*')
          .eq('pair_code', up.pair_code)
          .eq('user_id', userId)
          .eq('task_date', today);

        pairs.push(formatPair(pair, members, tasks, userId));
      }

      return json({ pairs }, 200, request);
    }

    // ── GET /api/pair/:pairCode/:userId ──
    if (
      request.method === 'GET' &&
      path.match(/^\/api\/pair\/[^/]+\/[^/]+$/)
    ) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const requestedUserId = parts[4];

      const authedId = getAuthedUserId(request, env);

      if (!authedId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      if (String(authedId) !== String(requestedUserId)) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      if (
        !(await isPairMember(
          supabase,
          pairCode,
          authedId,
        ))
      ) {
        return json(
          { error: 'Not a member' },
          403,
          request,
        );
      }

      const {
        data: pair,
        error: pairError,
      } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', pairCode)
        .maybeSingle();

      if (pairError) {
        console.error('Pair query failed:', pairError);

        return json(
          { error: 'Failed to load pair' },
          500,
          request,
        );
      }

      if (!pair) {
        return json(
          { error: 'Pair not found' },
          404,
          request,
        );
      }

      const today = getTodayDate(
        pair.timezone || 'UTC',
      );

      const {
        data: members,
        error: membersError,
      } = await supabase
        .from('pair_users')
        .select('*')
        .eq('pair_code', pairCode);

      if (membersError) {
        console.error(
          'Pair members query failed:',
          membersError,
        );

        return json(
          { error: 'Failed to load pair members' },
          500,
          request,
        );
      }

      const {
        data: tasks,
        error: tasksError,
      } = await supabase
        .from('daily_tasks')
        .select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', authedId)
        .eq('task_date', today);

      if (tasksError) {
        console.error(
          'Daily tasks query failed:',
          tasksError,
        );

        return json(
          { error: 'Failed to load daily tasks' },
          500,
          request,
        );
      }

      return json(
        formatPair(
          pair,
          members || [],
          tasks || [],
          authedId,
        ),
        200,
        request,
      );
    }

    // ── GET /api/avatar/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/avatar\/[^/]+$/)) {
      const tgUserId = path.split('/')[3];
      const BOT_TOKEN = env.BOT_TOKEN;
      const wantProxy = url.searchParams.get('proxy');

      let avatarAuthedId = null;

      if (wantProxy === '1') {
        /*
         * Тег <img> не может передать Telegram initData,
         * поэтому бинарный запрос проверяется одноразовой
         * ограниченной по времени подписью.
         */
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');

        const tokenIsValid = await verifyAvatarToken(
          BOT_TOKEN,
          tgUserId,
          exp,
          sig,
        );

        if (!tokenIsValid) {
          return json(
            { error: 'Forbidden' },
            403,
            request,
          );
        }
      } else {
        avatarAuthedId = getAuthedUserId(
          request,
          env,
        );

        if (!avatarAuthedId) {
          return json(
            { error: 'Unauthorized' },
            401,
            request,
          );
        }

        /*
         * Сначала получаем пары вызывающего пользователя.
         */
        const {
          data: callerPairs,
          error: callerPairsError,
        } = await supabase
          .from('pair_users')
          .select('pair_code')
          .eq('user_id', avatarAuthedId);

        if (callerPairsError) {
          console.error(
            'Avatar caller pairs query failed:',
            callerPairsError,
          );

          return json(
            { error: 'Failed to verify avatar access' },
            500,
            request,
          );
        }

        const callerPairCodes = (
          callerPairs || []
        ).map((row) => row.pair_code);

        if (callerPairCodes.length === 0) {
          return json(
            { avatar_url: null },
            200,
            request,
          );
        }

        /*
         * Целевой пользователь должен состоять хотя бы
         * в одной паре вместе с вызывающим.
         */
        const {
          data: sharedMembership,
          error: sharedMembershipError,
        } = await supabase
          .from('pair_users')
          .select('pair_code')
          .eq('user_id', tgUserId)
          .in('pair_code', callerPairCodes)
          .limit(1)
          .maybeSingle();

        if (sharedMembershipError) {
          console.error(
            'Shared avatar membership query failed:',
            sharedMembershipError,
          );

          return json(
            { error: 'Failed to verify avatar access' },
            500,
            request,
          );
        }

        if (!sharedMembership) {
          return json(
            { avatar_url: null },
            200,
            request,
          );
        }
      }


      try {
        const { data: cached } = await supabase
          .from('pair_users')
          .select('avatar_file_path')
          .eq('user_id', tgUserId)
          .limit(1)
          .maybeSingle();

        let filePath = cached?.avatar_file_path;

        if (!filePath) {
          const photosRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getUserProfilePhotos?user_id=${tgUserId}&limit=1`
          );
          const photosData = await photosRes.json();
          if (!photosData.ok || !photosData.result.photos.length) {
            return json({ avatar_url: null });
          }
          const photo = photosData.result.photos[0];
          const fileId = photo[photo.length - 1].file_id;

          const fileRes = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
          );
          const fileData = await fileRes.json();
          if (!fileData.ok) return json({ avatar_url: null });
          filePath = fileData.result.file_path;

          await supabase.from('pair_users')
            .update({ avatar_file_path: filePath })
            .eq('user_id', tgUserId);
        }

        if (wantProxy === '1') {
          const avatarUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          const imgRes = await fetch(avatarUrl);
          if (!imgRes.ok) {
            await supabase.from('pair_users')
              .update({ avatar_file_path: null })
              .eq('user_id', tgUserId);

            const alreadyRefreshed =
              url.searchParams.get('refresh') === '1';

            if (alreadyRefreshed) {
              return new Response(
                JSON.stringify({
                  avatar_url: null,
                }),
                {
                  status: 404,
                  headers: {
                    ...corsHeaders(request),
                    'Content-Type':
                      'application/json',
                    'Cache-Control':
                      'no-store',
                  },
                },
              );
            }

            /*
             * Telegram file_path мог устареть.
             * Очищаем сохранённый путь и один раз
             * повторяем подписанный запрос.
             */
            const retryUrl =
              new URL(request.url);

            retryUrl.searchParams.set(
              'refresh',
              '1',
            );

            return Response.redirect(
              retryUrl.toString(),
              307,
            );
          }
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const imgBuffer = await imgRes.arrayBuffer();
          return new Response(imgBuffer, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400',
              ...corsHeaders(request),
            },
          });
        }

        {
          // Подписанная ссылка действует 1 час.
          // Само изображение кешируется браузером и CDN отдельно.
          const exp = Date.now() + 60 * 60 * 1000;
          const sig = await makeAvatarToken(BOT_TOKEN, tgUserId, exp);
          return json({ avatar_url: `/api/avatar/${tgUserId}?proxy=1&exp=${exp}&sig=${sig}` });
        }
      } catch {
        return json({ avatar_url: null });
      }
    }

    // ── GET /api/daily-tasks/:pairCode/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/daily-tasks\/[^/]+\/[^/]+$/)) {
      const parts = path.split('/');
      const pairCode = parts[3];
      const userId = parts[4];

      // ── Авторизация: смотреть задачи может только участник пары,
      // и только свои собственные (userId должен совпадать с авторизованным) ──
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403, request);
      if (!(await isPairMember(supabase, pairCode, authedId))) {
        return json({ error: 'Not a member' }, 403, request);
      }

      const { data: pairTz } = await supabase
        .from('pairs').select('timezone').eq('code', pairCode).maybeSingle();
      const today = getTodayDate(pairTz?.timezone || 'UTC');

      const { data: tasks } = await supabase
        .from('daily_tasks').select('*')
        .eq('pair_code', pairCode)
        .eq('user_id', userId)
        .eq('task_date', today);

      return json({ tasks: tasks || [] }, 200, request);
    }

    // ── GET /api/streak-calendar/:pairCode ──
// Возвращает дни месяца с активностью обоих партнёров
if (request.method === 'GET' && path.match(/^\/api\/streak-calendar\/[^/]+$/)) {
  const pairCode = path.split('/')[3];
  const monthParam = url.searchParams.get('month'); // YYYY-MM, опционально

  const authedId = getAuthedUserId(request, env);
  if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
  if (!(await isPairMember(supabase, pairCode, authedId))) {
    return json({ error: 'Not a member' }, 403, request);
  }

  const { data: pair } = await supabase
    .from('pairs').select('timezone, created_at').eq('code', pairCode).maybeSingle();
  if (!pair) return json({ error: 'Pair not found' }, 404, request);

  const tz = pair.timezone || 'UTC';
  const month = monthParam || getTodayDate(tz).slice(0, 7); // YYYY-MM
  const startDate = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const { data: members } = await supabase
    .from('pair_users').select('user_id').eq('pair_code', pairCode);
  if (!members || members.length === 0) return json({ days: [] }, 200, request);

  const memberIds = members.map(m => m.user_id);

  const { data: opens } = await supabase
    .from('daily_tasks')
    .select('user_id, task_date')
    .eq('pair_code', pairCode)
    .eq('task_key', 'daily_open')
    .gte('task_date', startDate)
    .lte('task_date', endDate)
    .in('user_id', memberIds);

  // Группируем по дате: сколько уникальных юзеров зашли
  const byDate = {};
  for (const row of (opens || [])) {
    if (!byDate[row.task_date]) byDate[row.task_date] = new Set();
    byDate[row.task_date].add(row.user_id);
  }

  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const count = byDate[date]?.size || 0;
    let status = 'empty';
    if (count >= 2) status = 'both';
    else if (count === 1) status = 'one';
    days.push({ date, status, count });
  }

  const bothCount = days.filter(d => d.status === 'both').length;
  return json({ month, days, bothCount, totalDays: lastDay }, 200, request);
}

// ── GET /api/diary/:pairCode ──
// Возвращает записи и сообщает, можно ли пользователю создать запись сегодня.
if (request.method === 'GET' && path.match(/^\/api\/diary\/[^/]+$/)) {
  const pairCode = path.split('/')[3];
  const authedId = getAuthedUserId(request, env);

  if (!authedId) {
    return json(
      { error: 'Unauthorized' },
      401,
      request,
    );
  }

  if (
    !(await isPairMember(
      supabase,
      pairCode,
      authedId,
    ))
  ) {
    return json(
      { error: 'Not a member' },
      403,
      request,
    );
  }

  const {
    data: pair,
    error: pairError,
  } = await supabase
    .from('pairs')
    .select('timezone')
    .eq('code', pairCode)
    .maybeSingle();

  if (pairError) {
    return json(
      { error: 'Failed to load pair timezone' },
      500,
      request,
    );
  }

  if (!pair) {
    return json(
      { error: 'Pair not found' },
      404,
      request,
    );
  }

  const today =
    getTodayDate(
      pair.timezone || 'UTC',
    );

  const {
    data: entries,
    error: entriesError,
  } = await supabase
    .from('pair_diary')
    .select(
      'id, user_id, emoji, text, entry_date, created_at'
    )
    .eq('pair_code', pairCode)
    .order('entry_date', {
      ascending: false,
    })
    .order('created_at', {
      ascending: false,
    })
    .limit(200);

  if (entriesError) {
    return json(
      { error: 'Failed to load diary entries' },
      500,
      request,
    );
  }

  const hasTodayEntry =
    (entries || []).some(
      entry =>
        String(entry.user_id) ===
          String(authedId) &&
        entry.entry_date === today,
    );

  return json(
    {
      entries: entries || [],
      today,
      canCreate: !hasTodayEntry,
    },
    200,
    request,
  );
}

// ── POST /api/diary ──
// Создаёт одну неизменяемую запись пользователя в сутки.
if (request.method === 'POST' && path === '/api/diary') {
  const body = await request
    .json()
    .catch(() => ({}));

  const userId = extractUserId(
    request,
    env,
    body.userId,
  );

  if (!userId) {
    return json(
      { error: 'Unauthorized' },
      401,
      request,
    );
  }

  const pairCode =
    typeof body.pairCode === 'string'
      ? body.pairCode.trim().toUpperCase()
      : '';

  const emoji =
    (body.emoji || '')
      .toString()
      .trim()
      .slice(0, 8);

  const text =
    (body.text || '')
      .toString()
      .trim()
      .slice(0, 100);

  if (
    !pairCode ||
    !emoji ||
    !text
  ) {
    return json(
      {
        error:
          'pairCode, emoji and text required',
      },
      400,
      request,
    );
  }

  const {
    data: membership,
    error: membershipError,
  } = await supabase
    .from('pair_users')
    .select(
      'user_id, display_name'
    )
    .eq('pair_code', pairCode)
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    return json(
      {
        error:
          'Membership query failed',
      },
      500,
      request,
    );
  }

  if (!membership) {
    return json(
      { error: 'Not a member' },
      403,
      request,
    );
  }

  const {
    data: pair,
    error: pairError,
  } = await supabase
    .from('pairs')
    .select(
      'timezone, pet_name'
    )
    .eq('code', pairCode)
    .maybeSingle();

  if (pairError) {
    return json(
      { error: 'Failed to load pair' },
      500,
      request,
    );
  }

  if (!pair) {
    return json(
      { error: 'Pair not found' },
      404,
      request,
    );
  }

  const today =
    getTodayDate(
      pair.timezone || 'UTC',
    );

  /*
   * Используем только INSERT.
   * UNIQUE(pair_code, user_id, entry_date)
   * атомарно защищает запись от повторного создания
   * и перезаписи при параллельных запросах.
   */
  const {
    data: createdEntry,
    error: insertError,
  } = await supabase
    .from('pair_diary')
    .insert({
      pair_code: pairCode,
      user_id: userId,
      emoji,
      text,
      entry_date: today,
    })
    .select(
      'id, user_id, emoji, text, entry_date, created_at'
    )
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return json(
        {
          error:
            'Diary entry already exists for today',
          code:
            'DIARY_ENTRY_ALREADY_EXISTS',
          entry_date:
            today,
        },
        409,
        request,
      );
    }

    console.error(
      'Diary insert failed:',
      insertError,
    );

    return json(
      {
        error:
          'Failed to create diary entry',
      },
      500,
      request,
    );
  }

  try {
    const {
      data: members,
    } = await supabase
      .from('pair_users')
      .select('user_id')
      .eq('pair_code', pairCode);

    const partner =
      (members || []).find(
        member =>
          String(member.user_id) !==
          String(userId),
      );

    if (partner) {
      const {
        data: partnerSettings,
      } = await supabase
        .from('user_settings')
        .select('lang')
        .eq(
          'telegram_user_id',
          partner.user_id,
        )
        .maybeSingle();

      const partnerLang =
        partnerSettings?.lang || 'ru';

      const authorName =
        membership.display_name ||
        (
          partnerLang === 'ru'
            ? 'Партнёр'
            : 'Partner'
        );

      const petName =
        pair.pet_name || 'Chumi';

      const safeAuthor =
        escapeMd(authorName);

      const safePet =
        escapeMd(petName);

      const safeText =
        escapeMd(text);

      const notifyText =
        partnerLang === 'ru'
          ? `📔 *${safeAuthor}* оставил(а) запись в дневнике ${safePet}!\n\n${emoji} _${safeText}_`
          : `📔 *${safeAuthor}* added a diary entry for ${safePet}!\n\n${emoji} _${safeText}_`;

      const buttonText =
        partnerLang === 'ru'
          ? '📖 Посмотреть'
          : '📖 View';

      await sendTelegramMessage(
        env,
        partner.user_id,
        notifyText,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: buttonText,
                  web_app: {
                    url: WEBAPP_URL,
                  },
                },
              ],
            ],
          },
        },
      );
    }
  } catch (error) {
    console.error(
      'Diary notification failed:',
      error,
    );
  }

  return json(
    {
      success: true,
      entry: createdEntry,
      entry_date: today,
      canCreate: false,
    },
    201,
    request,
  );
}

// Записи дневника неизменяемые.
// Удаление через пользовательский API запрещено.
if (
  request.method === 'POST' &&
  path === '/api/diary-delete'
) {
  return json(
    {
      error:
        'Diary entries cannot be deleted',
      code:
        'DIARY_ENTRY_IMMUTABLE',
    },
    405,
    request,
  );
}

    // ── GET /api/user-slots/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/user-slots\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403);

      const maxPairs = await getMaxPairs(supabase, userId);
      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      return json({
        maxPairs,
        currentPairs: existing?.length || 0,
        extraSlots: maxPairs - MAX_PAIRS_BASE,
      });
    }

    // ── POST /api/create ──
    if (request.method === 'POST' && path === '/api/create') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const displayName = body.displayName || null;
      const username = body.username || null;
      const userTz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : 'UTC';
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400, request);
      }

      const code = await generateUniqueCode(supabase, 20);

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
          last_recovery_month: null,
          last_streak_date: null,
          is_dead: false,
          timezone: userTz,
        });

      if (pairInsertError) {
        console.error(
          'Pair creation failed:',
          pairInsertError,
        );

        return json(
          {
            error:
              'Failed to create pair',
          },
          500,
          request,
        );
      }

      const {
        error: memberInsertError,
      } = await supabase
        .from('pair_users')
        .insert({
          pair_code: code,
          user_id: userId,
          display_name: displayName,
          username,
          timezone: userTz,
        });

      if (memberInsertError) {
        console.error(
          'Pair owner creation failed:',
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
            'Pair creation rollback failed:',
            rollbackError,
          );
        }

        return json(
          {
            error:
              'Failed to add pair owner',
          },
          500,
          request,
        );
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

      return json({ code }, 200, request);
    }


    // ── POST /api/join ──
    if (request.method === 'POST' && path === '/api/join') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = (body.code || '').trim().toUpperCase();
      const displayName = body.displayName || null;
      const username = body.username || null;
      const userTz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : 'UTC';
      const maxPairs = await getMaxPairs(supabase, userId);

      const { data: existing } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      if (existing && existing.length >= maxPairs) {
        return json({ error: `Max ${maxPairs} pairs`, maxReached: true }, 400, request);
      }

      const { data: pair } = await supabase
        .from('pairs').select('*').eq('code', code).maybeSingle();
      if (!pair) return json({ error: 'Pair not found' }, 404, request);

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      if (members?.some(m => m.user_id === userId)) return json({ error: 'Already in pair' }, 400, request);
      if (members && members.length >= 2) return json({ error: 'Pair full' }, 400, request);

      const {
        error: joinError,
      } = await supabase
        .from('pair_users')
        .insert({
          pair_code: code,
          user_id: userId,
          display_name: displayName,
          username,
          timezone: userTz,
        });

      if (joinError) {
        console.error(
          'Pair join failed:',
          {
            code,
            userId,
            error:
              joinError,
          },
        );

        if (joinError.code === '23505') {
          return json(
            {
              error:
                'Already in pair',
            },
            409,
            request,
          );
        }

        if (joinError.code === '23514') {
          return json(
            {
              error:
                'Pair full',
            },
            409,
            request,
          );
        }

        return json(
          {
            error:
              'Failed to join pair',
          },
          500,
          request,
        );
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


      // Уведомление с именем
      for (const m of members || []) {
        if (m.user_id !== userId) {
          const { data: ps } = await supabase
            .from('user_settings').select('lang')
            .eq('telegram_user_id', m.user_id).maybeSingle();
          const partnerLang = ps?.lang || 'ru';
          const who = (displayName || '').toString().slice(0, 40)
            || (partnerLang === 'ru' ? 'Партнёр' : 'Someone');
          const safeWho = escapeMd(who);
          const msg = partnerLang === 'ru'
            ? `🎉 *${safeWho}* присоединился к паре \`${code}\`!`
            : `🎉 *${safeWho}* joined pair \`${code}\`!`;
          await sendTelegramMessage(env, m.user_id, msg);
        }
      }

      return json({ code }, 200, request);
    }

    // ── POST /api/complete-task ──
    if (request.method === 'POST' && path === '/api/complete-task') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.code;
      const taskKey = body.taskKey;

      const points = TASK_POINTS[taskKey];
      if (points === undefined) return json({ error: 'Invalid task' }, 400, request);

      const { data: pairCheck } = await supabase
        .from('pairs')
        .select(
          'is_dead, timezone, last_streak_date, last_pair_streak_date, streak_days, growth_points, streak_recoveries_used, last_recovery_month'
        )
        .eq('code', code)
        .maybeSingle();

      if (!pairCheck) {
        return json(
          { error: 'Pair not found' },
          404,
          request,
        );
      }

      const recoveryState =
        getRecoveryState(pairCheck);

      /*
       * В день воскрешения запрещаем выполнять задания
       * до нажатия «Воскресить». Это не позволяет
       * complete-task сбросить старую серию на 1.
       */
      if (recoveryState.canRevive) {
        return json(
          {
            error: 'Revival required',
            reviveRequired: true,
            remaining:
              recoveryState.remaining,
          },
          409,
          request,
        );
      }

      /*
       * Если единственный день воскрешения уже закончился,
       * сбрасываем прогресс при первой попытке выполнить
       * задание, даже если cron ещё не успел отработать.
       */
      if (
        Number(pairCheck.streak_days || 0) > 0 &&
        recoveryState.daysSincePairStreak !== null &&
        recoveryState.daysSincePairStreak >= 3
      ) {
        await supabase.from('pairs').update({
          is_dead: false,
          streak_days: 0,
          growth_points: 0,
          hatched: false,
          active_skin: null,
          last_streak_date:
            recoveryState.today,
          last_pair_streak_date:
            recoveryState.today,
        }).eq('code', code);

        await supabase
          .from('one_time_tasks')
          .delete()
          .eq('pair_code', code);

        await supabase
          .from('daily_tasks')
          .delete()
          .eq('pair_code', code);

        await supabase
          .from('feedings')
          .delete()
          .eq('pair_code', code);

        return json(
          {
            error:
              'Pet was reset due to long inactivity',
            reset: true,
          },
          400,
          request,
        );
      }

      if (pairCheck.is_dead) {
        return json(
          { error: 'Pet is dead' },
          400,
          request,
        );
      }

      const today = getTodayDate(pairCheck.timezone || 'UTC');

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return json({ error: 'Not a member of this pair' }, 403, request);

      // Daily tasks — полагаемся на UNIQUE-индекс daily_tasks_unique.
      // Если insert упал с конфликтом, задача уже выполнена сегодня → не начисляем.
      const { error: dtErr } = await supabase.from('daily_tasks').insert({
        pair_code: code,
        user_id: userId,
        task_key: taskKey,
        task_date: today,
        completed: true,
        completed_at: new Date().toISOString(),
      });
      if (dtErr) {
        return json({ error: 'Already completed' }, 400, request);
      }

      const { data: members } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code);

      const partnerIds = (members || [])
        .map(m => String(m.user_id))
        .filter(id => id !== String(userId));

      // ── Обновляем last_streak_date ВСЕГДА, когда кто-то открыл приложение ──
      // streak_days растёт, только когда оба зашли в один день (см. ниже).
      if (taskKey === 'daily_open') {
        const { data: pairForLife } = await supabase
          .from('pairs')
          .select('last_streak_date')
          .eq('code', code).single();
        if (pairForLife && pairForLife.last_streak_date !== today) {
          await supabase.from('pairs')
            .update({ last_streak_date: today })
            .eq('code', code);
        }
      }

      let pointsAdded = 0;

      if (partnerIds.length > 0) {
        // Считаем, сколько РАЗНЫХ участников пары выполнили эту задачу сегодня.
        // Это устойчиво к гонке: к моменту подсчёта обе записи уже вставлены,
        // поэтому хотя бы один из двух параллельных запросов увидит всех.
        const memberIds = (members || []).map(m => String(m.user_id));
        const { data: doneRows } = await supabase
          .from('daily_tasks').select('user_id')
          .eq('pair_code', code)
          .eq('task_key', taskKey)
          .eq('task_date', today)
          .in('user_id', memberIds);

        const doneUsers = new Set((doneRows || []).map(r => String(r.user_id)));
        const allMembersDone = memberIds.length >= 2 && memberIds.every(id => doneUsers.has(id));

        if (allMembersDone) {
          const { data: pair } = await supabase
            .from('pairs')
            .select('growth_points, streak_days, last_streak_date, last_pair_streak_date, hatched')
            .eq('code', code).single();

          if (pair) {
            if (taskKey === 'daily_open') {
              // ── Совместный daily_open засчитывается РОВНО один раз в день ──
              // XP и streak привязаны к одной отметке last_pair_streak_date.
              // Это убирает гонку: при одновременном заходе обоих партнёров
              // только один запрос пройдёт условие eq(last_pair_streak_date, prev).
              const alreadyCountedToday = pair.last_pair_streak_date === today;
              if (!alreadyCountedToday) {
                const prev = pair.last_pair_streak_date;
                let newStreak;
                if (!prev) {
                  newStreak = 1;
                } else {
                  const lastDate = new Date(prev + 'T00:00:00Z');
                  const todayDate = new Date(today + 'T00:00:00Z');
                  const diffDays = Math.round((todayDate - lastDate) / (1000 * 60 * 60 * 24));
                  if (diffDays === 1) newStreak = (pair.streak_days || 0) + 1;
                  else if (diffDays > 1) newStreak = 1;
                  else newStreak = pair.streak_days || 0;
                }

                const newPoints = (pair.growth_points || 0) + points;
                const updates = {
                  growth_points: newPoints,
                  streak_days: newStreak,
                  last_pair_streak_date: today,
                  last_streak_date: today,
                };
                if (!pair.hatched && newPoints >= LEVELS[0].maxPoints) {
                  updates.hatched = true;
                }

                // Оптимистическая блокировка: апдейт применится, только если
                // last_pair_streak_date всё ещё равен prev (т.е. сегодня ещё не
                // засчитан). Второй из гонящихся запросов получит 0 строк и НЕ
                // начислит очки повторно.
                let q = supabase.from('pairs').update(updates).eq('code', code);
                q = prev === null
                  ? q.is('last_pair_streak_date', null)
                  : q.eq('last_pair_streak_date', prev);
                const { data: changedRows } = await q.select('code');

                if (changedRows && changedRows.length > 0) {
                  pointsAdded = points;
                }
                // если changedRows пуст — день уже засчитал параллельный запрос,
                // pointsAdded остаётся 0, ничего не начисляем
              }
            } else {
              // ── Прочие парные задачи (не daily_open) ──
              // У них нет дневной отметки, поэтому полагаемся на UNIQUE-индекс
              // daily_tasks: каждый участник может выполнить задачу один раз в день,
              // а XP за «оба выполнили» начисляем при подтверждённом allMembersDone.
              const newPoints = (pair.growth_points || 0) + points;
              await supabase.from('pairs')
                .update({ growth_points: newPoints })
                .eq('code', code);
              pointsAdded = points;
            }
          }
        }
      }

      return json({ success: true, points_added: pointsAdded }, 200, request);
    }


    // ── POST /api/rename ──
    if (request.method === 'POST' && path === '/api/rename') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.code || body.pairCode;
      const name = (body.pet_name || body.name || '').trim().slice(0, 20);
      if (!name) return json({ error: 'Name required' }, 400, request);

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      await supabase.from('pairs').update({ pet_name: name }).eq('code', code);
      return json({ success: true, pet_name: name }, 200, request);
    }

    // ── POST /api/delete ──
    if (request.method === 'POST' && path === '/api/delete') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      const { data: members } = await supabase
        .from('pair_users').select('user_id, display_name').eq('pair_code', code);
      for (const m of members || []) {
        if (m.user_id !== userId) {
          const { data: ps } = await supabase
            .from('user_settings').select('lang')
            .eq('telegram_user_id', m.user_id).maybeSingle();
          const pLang = ps?.lang || 'ru';
          const msg = pLang === 'ru'
            ? `😢 Пара \`${code}\` была удалена.`
            : `😢 Pair \`${code}\` has been deleted.`;
          await sendTelegramMessage(env, m.user_id, msg);
        }
      }

      await supabase.from('one_time_tasks').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);
      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('pair_users').delete().eq('pair_code', code);
      await supabase.from('pairs').delete().eq('code', code);

      return json({ success: true }, 200, request);
    }

    // ── POST /api/setbg ──
    if (request.method === 'POST' && path === '/api/setbg') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.pairCode || body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      // bgId может быть null (= авто/сброс) или id из списка фонов
      const bgId = body.bgId ?? null;
      await supabase.from('pairs').update({ active_bg: bgId }).eq('code', code);
      return json({ success: true }, 200, request);
    }

    // ── POST /api/notify ──
    if (request.method === 'POST' && path === '/api/notify') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const targetUserId = String(body.targetUserId || '');
      if (!targetUserId || targetUserId === userId) {
        return json({ error: 'Invalid target' }, 400, request);
      }

      const { data: callerPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      const { data: targetPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', targetUserId);

      const callerCodes = new Set((callerPairs || []).map(p => p.pair_code));
      const isPartner = (targetPairs || []).some(p => callerCodes.has(p.pair_code));
      if (!isPartner) return json({ error: 'Can only notify your partner' }, 403, request);

      // Rate-limit: не чаще 1 уведомления в час одному партнёру
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('notification_log')
        .select('id')
        .eq('sender_user_id', userId)
        .eq('target_user_id', targetUserId)
        .gte('sent_at', oneHourAgo)
        .limit(1);
      if (recent && recent.length > 0) {
        return json({ error: 'Too many notifications', retryAfter: 3600 }, 429, request);
      }

      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', targetUserId).maybeSingle();
      const tLang = ps?.lang || 'ru';
      const defaultMsg = tLang === 'ru' ? '🔔 Напоминание от Chumi' : '🔔 Reminder from Chumi';

      const sendRes = await sendTelegramMessage(env, targetUserId, defaultMsg);
      if (!sendRes.ok) {
        return json({ error: 'Delivery failed', blocked: !!sendRes.blocked }, 502, request);
      }
      await supabase.from('notification_log').insert({
        sender_user_id: userId,
        target_user_id: targetUserId,
        sent_at: new Date().toISOString(),
      });
      return json({ success: true }, 200, request);
    }

    // ── POST /api/recover-streak ──
    // При воскрешении серия и XP СОХРАНЯЮТСЯ.
    // Питомец оживает в том же состоянии, в котором был перед смертью.
    if (request.method === 'POST' && path === '/api/recover-streak') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.pairCode || body.code;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      const { data: pair } = await supabase
        .from('pairs')
        .select('*')
        .eq('code', code)
        .maybeSingle();

      if (!pair) {
        return json(
          { error: 'Pair not found' },
          404,
          request,
        );
      }

      const recoveryState =
        getRecoveryState(pair);

      if (
        recoveryState.remaining <= 0
      ) {
        return json(
          {
            error:
              'Max 5 recoveries per month',
            remaining: 0,
          },
          400,
          request,
        );
      }

      /*
       * Воскрешение доступно только при разнице
       * ровно в два дня:
       *
       * день 0 — последний совместный день;
       * день 1 — пропущенный день;
       * день 2 — день воскрешения.
       *
       * is_dead намеренно не является обязательным:
       * пользователь может открыть приложение раньше,
       * чем Cloudflare cron пометит питомца мёртвым.
       */
      if (!recoveryState.canRevive) {
        return json(
          {
            error:
              'Revival is not available today',
            code:
              'REVIVE_NOT_AVAILABLE',
            remaining:
              recoveryState.remaining,
            server_today:
              recoveryState.today,
            days_since_pair_streak:
              recoveryState.daysSincePairStreak,
          },
          409,
          request,
        );
      }

      const tz =
        pair.timezone ||
        'UTC';

      const currentMonth =
        recoveryState.currentMonth;

      const today =
        recoveryState.today;

      const MAX_RECOVERIES =
        recoveryState.maximum;

      const used =
        recoveryState.used;

      const remainingAfter =
        MAX_RECOVERIES -
        (used + 1);

      /*
       * Ставим last_pair_streak_date на вчера.
       * Когда оба участника выполнят daily_open сегодня,
       * complete-task увидит разницу ровно в один день
       * и увеличит сохранённую серию на 1.
       */
      const yesterday =
        getYesterdayDate(tz);

      const previousPairStreakDate =
        pair.last_pair_streak_date;

      const {
        data: updated,
        error: updateError,
      } = await supabase
        .from('pairs')
        .update({
          is_dead: false,
          streak_recoveries_used:
            used + 1,
          last_recovery_month:
            currentMonth,
          last_streak_date:
            today,
          last_pair_streak_date:
            yesterday,
        })
        .eq('code', code)
        .eq(
          'last_pair_streak_date',
          previousPairStreakDate,
        )
        .select()
        .maybeSingle();

      if (updateError) {
        console.error(
          'Streak recovery update failed:',
          updateError,
        );

        return json(
          {
            error:
              'Failed to recover streak',
          },
          500,
          request,
        );
      }

      if (!updated) {
        return json(
          {
            error:
              'Streak was already recovered',
            code:
              'ALREADY_RECOVERED',
          },
          409,
          request,
        );
      }

      // Уведомляем партнёра о воскрешении
try {
  const { data: allMembers } = await supabase
    .from('pair_users').select('user_id, display_name')
    .eq('pair_code', code);
  const reviver = (allMembers || []).find(m => String(m.user_id) === String(userId));
  const partners = (allMembers || []).filter(m => String(m.user_id) !== String(userId));
  for (const p of partners) {
    const { data: ps } = await supabase
      .from('user_settings').select('lang')
      .eq('telegram_user_id', p.user_id).maybeSingle();
    const pLang = ps?.lang || 'ru';
    const reviverName = reviver?.display_name || (pLang === 'ru' ? 'Партнёр' : 'Partner');
    const petName = pair.pet_name || (pLang === 'ru' ? 'Питомец' : 'Pet');
    const safeReviver = escapeMd(reviverName);
    const safePet = escapeMd(petName);
    const tail = remainingAfter > 0
      ? (pLang === 'ru'
          ? `Осталось воскрешений в этом месяце: ${remainingAfter}/${MAX_RECOVERIES}.`
          : `Revives left this month: ${remainingAfter}/${MAX_RECOVERIES}.`)
      : (pLang === 'ru'
          ? `Воскрешения на этот месяц закончились — берегите серию, иначе прогресс сбросится!`
          : `No revives left this month — keep the streak or progress will reset!`);
    const text = pLang === 'ru'
      ? `✨ *${safeReviver}* воскресил(а) *${safePet}*! Серия (${pair.streak_days} дн.) сохранена 🐾\n${tail}`
      : `✨ *${safeReviver}* revived *${safePet}*! Streak (${pair.streak_days} days) preserved 🐾\n${tail}`;
    const btnText = pLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';
    await sendTelegramMessage(env, p.user_id, text, {
      reply_markup: {
        inline_keyboard: [[{ text: btnText, web_app: { url: 'https://chumi.space' } }]],
      },
    });
  }
} catch (e) {
  console.error('Revive notify error:', e);
}

      return json({
        success: true,
        remaining: remainingAfter,
        streak_days: updated?.streak_days ?? pair.streak_days,
        growth_points: updated?.growth_points ?? pair.growth_points,
        is_dead: false,
        last_streak_date: today,
        streak_recoveries_used: used + 1,
        last_recovery_month: currentMonth,
      }, 200, request);
    }

    // ── POST /api/create-invoice ──
    if (request.method === 'POST' && path === '/api/create-invoice') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const productId = body.productId;

      if (productId === 'extra_slot') {
        const payload = JSON.stringify({ userId, productId, timestamp: Date.now() });
        const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Дополнительный слот для пары',
            description: 'Получите возможность создать ещё одну пару',
            payload,
            provider_token: '',
            currency: 'XTR',
            prices: [{ label: 'Extra pair slot', amount: PRODUCT_PRICES.extra_slot }],
          }),
        });
        const data = await res.json();
        if (!data.ok) return json({ error: 'Invoice creation failed' }, 500, request);
        return json({ invoiceUrl: data.result }, 200, request);
      }

      return json({ error: 'Invalid product' }, 400, request);
    }

    // ── POST /api/send-invite ──
    if (request.method === 'POST' && path === '/api/send-invite') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const pairCode = (body.pairCode || '').toUpperCase();
      if (!pairCode) return json({ error: 'pairCode required' }, 400, request);

      // Ссылку на приглашение отдаём только участнику этой пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${pairCode}`;
      return json({ inviteLink, pairCode }, 200, request);
    }

    // ── POST /api/create-egg ──
    if (request.method === 'POST' && path === '/api/create-egg') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.pairCode || body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      await supabase.from('pairs').update({
        pet_type: 'spark',
        hatched: false,
        streak_days: 0,
        growth_points: 0,
        is_dead: false,
        pet_name: null,
        streak_recoveries_used: 0,
        last_recovery_month: null,
        last_streak_date: null,
        last_pair_streak_date: null,
      }).eq('code', code);

      await supabase.from('feedings').delete().eq('pair_code', code);
      await supabase.from('daily_tasks').delete().eq('pair_code', code);
      await supabase.from('one_time_tasks').delete().eq('pair_code', code);

      return json({ success: true }, 200, request);
    }

    // ── GET /api/ranking ──
    if (request.method === 'GET' && path === '/api/ranking') {
      const userId =
        getAuthedUserId(
          request,
          env,
        );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days')
        .order('streak_days', { ascending: false })
        .order('growth_points', { ascending: false })
        .limit(100);

      const codes = (allPairs || []).map(p => p.code);
      if (codes.length === 0) return json({ ranking: [] }, 200, request);

      const { data: allMembers } = await supabase
        .from('pair_users')
        .select('pair_code, user_id, display_name, username')
        .in('pair_code', codes);

      // Временные подписанные ссылки на аватарки: действуют 1 час, показываются
      // всем, кто получил рейтинг (не требуют общей пары с целевым юзером).
      const avatarExpiresAt = Date.now() + 60 * 60 * 1000;
      const buildAvatarUrl = async (uid) => {
        const sig = await makeAvatarToken(env.BOT_TOKEN, String(uid), avatarExpiresAt);
        return `/api/avatar/${encodeURIComponent(String(uid))}?proxy=1&exp=${avatarExpiresAt}&sig=${sig}`;
      };

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
          avatar_url: await buildAvatarUrl(m.user_id),
        });
      }

      const ranking = (allPairs || []).map(p => ({
        code: p.code,
        pet_name: p.pet_name,
        growth_points: p.growth_points || 0,
        streak_days: p.streak_days || 0,
        members: membersByPair.get(p.code) || [],
      }));

      return json({ ranking }, 200, request);
    }

    // ── GET /api/ranking-random ──
    if (request.method === 'GET' && path === '/api/ranking-random') {
      const userId =
        getAuthedUserId(
          request,
          env,
        );

      if (!userId) {
        return json(
          { error: 'Unauthorized' },
          401,
          request,
        );
      }

      // Активные = заходили в последние 2 дня (вчера или сегодня)
      // Используем UTC как точку отсчёта, чтобы покрыть все таймзоны
      const todayUtc = new Date().toISOString().split('T')[0];
      const dUtc = new Date(todayUtc + 'T00:00:00Z');
      dUtc.setUTCDate(dUtc.getUTCDate() - 2);
      const twoDaysAgoUtc = dUtc.toISOString().split('T')[0];

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, growth_points, streak_days, last_streak_date, is_dead')
        .not('pet_name', 'is', null)
        .eq('is_dead', false)
        .gte('last_streak_date', twoDaysAgoUtc);

      const named = (allPairs || []).filter(p => p.pet_name && p.pet_name.trim() !== '');
      if (named.length === 0) return json({ ranking: [] }, 200, request);

      const today = getTodayDate().replace(/-/g, '');
      const seed = parseInt(today, 10);
      const shuffled = shuffleWithSeed(named, seed).slice(0, 50);

      const codes = shuffled.map(p => p.code);
      const { data: allMembers } = await supabase
        .from('pair_users')
        .select('pair_code, user_id, display_name, username')
        .in('pair_code', codes);

      const avatarExpiresAt = Date.now() + 60 * 60 * 1000;
      const buildAvatarUrl = async (uid) => {
        const sig = await makeAvatarToken(env.BOT_TOKEN, String(uid), avatarExpiresAt);
        return `/api/avatar/${encodeURIComponent(String(uid))}?proxy=1&exp=${avatarExpiresAt}&sig=${sig}`;
      };

      const membersByPair = new Map();
      for (const m of (allMembers || [])) {
        if (!membersByPair.has(m.pair_code)) membersByPair.set(m.pair_code, []);
        membersByPair.get(m.pair_code).push({
          user_id: m.user_id,
          display_name: m.display_name || null,
          avatar_url: await buildAvatarUrl(m.user_id),
        });
      }

      const ranking = shuffled.map(p => ({
        code: p.code,
        pet_name: p.pet_name,
        growth_points: p.growth_points || 0,
        streak_days: p.streak_days || 0,
        members: membersByPair.get(p.code) || [],
      }));

      return json({ ranking }, 200, request);
    }

    // ── POST /api/prepare-share ──
    // Если пришла imageDataUrl — заливаем в Storage и шлём как photo с кнопкой.
    // Если нет — fallback на старый text-only вариант.
    if (request.method === 'POST' && path === '/api/prepare-share') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const botLink = `https://t.me/${botUsername}`;

      // Язык отправителя
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';

      const caption = userLang === 'ru'
        ? `🐾 Chumi — заведи виртуального питомца и расти его вместе с другом!\n\nВыполняй задания каждый день, поддерживай серию и открывай новые образы.`
        : `🐾 Chumi — get a virtual pet and grow it with a friend!\n\nComplete tasks daily, keep your streak, unlock new outfits.`;
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const imageDataUrl = body.imageDataUrl || '';

      // ── Вариант с картинкой (photo) ──
      const shareImgMatch = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (shareImgMatch) {
        const shareExt = shareImgMatch[1] === 'jpeg' ? 'jpg' : 'png';
        const shareContentType = `image/${shareImgMatch[1]}`;
        const base64 = imageDataUrl.split(',')[1];

        if (
          !base64 ||
          base64.length >
            MAX_UPLOADED_IMAGE_BASE64_LENGTH
        ) {
          return json(
            {
              error:
                'Image is too large',
            },
            413,
            request,
          );
        }

        const binary = Uint8Array.from(
          atob(base64),
          character =>
            character.charCodeAt(0),
        );

        if (
          binary.byteLength >
          MAX_UPLOADED_IMAGE_BYTES
        ) {
          return json(
            {
              error:
                'Image is too large',
            },
            413,
            request,
          );
        }

        const fileName = `promo_${userId}_${Date.now()}.${shareExt}`;

        const uploadRes = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_KEY}`,
              'Content-Type': shareContentType,
              'x-upsert': 'true',
            },
            body: binary,
          }
        );
        if (uploadRes.ok) {
          const photoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;

          const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: parseInt(userId),
              result: {
                type: 'photo',
                id: 'share_promo_' + Date.now(),
                photo_url: photoUrl,
                thumbnail_url: photoUrl,
                caption,
                reply_markup: { inline_keyboard: [[{ text: btnText, url: botLink }]] },
              },
              allow_user_chats: true,
              allow_bot_chats: false,
              allow_group_chats: true,
              allow_channel_chats: true,
            }),
          });
          const tgData = await tgRes.json();
          if (tgData.ok && tgData.result?.id) {
            return json({ prepared_message_id: tgData.result.id }, 200, request);
          }
          // если Telegram не принял photo — падаем в text-fallback ниже
        }
      }

      // ── Fallback: текстовый article (как было) ──
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'share_app_' + Date.now(),
            title: userLang === 'ru' ? 'Chumi — Вырасти питомца! 🐾' : 'Chumi — Grow a pet! 🐾',
            input_message_content: { message_text: caption },
            description: userLang === 'ru' ? 'Заведи питомца и расти вместе с другом 🐾' : 'Get a pet and grow with a friend 🐾',
            reply_markup: { inline_keyboard: [[{ text: btnText, url: botLink }]] },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id }, 200, request);
      return json({ error: 'Failed to prepare message', details: data }, 500, request);
    }

        // ── POST /api/prepare-invite ──
    // Готовит inline-сообщение для приглашения в конкретную пару (с кодом)
    if (request.method === 'POST' && path === '/api/prepare-invite') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const pairCode = (body.pairCode || '').toUpperCase();
      if (!pairCode) return json({ error: 'pairCode required' }, 400, request);

      // Проверяем, что вызывающий — участник этой пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      // Получаем язык пользователя
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const inviteLink = `https://t.me/${botUsername}?start=join_${pairCode}`;

      const messageText = userLang === 'ru'
        ? `🐾 *Присоединяйся к моей паре в Chumi!*\n\nКод пары: \`${pairCode}\`\n\nРастим питомца вместе — выполняй задания, поддерживай серию и открывай новые наряды 🐣`
        : `🐾 *Join my pair in Chumi!*\n\nPair code: \`${pairCode}\`\n\nLet's grow a pet together — complete tasks, keep the streak, unlock outfits 🐣`;

      const btnText = userLang === 'ru' ? '🐾 Присоединиться' : '🐾 Join pair';

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'invite_' + pairCode + '_' + Date.now(),
            title: userLang === 'ru'
              ? `Приглашение в Chumi: ${pairCode}`
              : `Chumi invite: ${pairCode}`,
            input_message_content: {
              message_text: messageText,
              parse_mode: 'Markdown',
            },
            description: userLang === 'ru'
              ? 'Растите питомца вместе 🐾'
              : 'Grow a pet together 🐾',
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: inviteLink }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id }, 200, request);
      return json({ error: 'Failed to prepare message', details: data }, 500, request);
    }

        // ── POST /api/upload-postcard ──
    // Загружает PNG-открытку в Supabase Storage (bucket: postcards) и возвращает публичный URL
    if (request.method === 'POST' && path === '/api/upload-postcard') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const imageDataUrl = body.imageDataUrl || '';
      const m = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (!m) {
        return json({ error: 'Invalid image' }, 400, request);
      }
      const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
      const contentType = `image/${m[1]}`;
      const base64 = imageDataUrl.split(',')[1];

      if (
        !base64 ||
        base64.length >
          MAX_UPLOADED_IMAGE_BASE64_LENGTH
      ) {
        return json(
          {
            error:
              'Image is too large',
          },
          413,
          request,
        );
      }

      const binary = Uint8Array.from(
        atob(base64),
        character =>
          character.charCodeAt(0),
      );

      if (
        binary.byteLength >
        MAX_UPLOADED_IMAGE_BYTES
      ) {
        return json(
          {
            error:
              'Image is too large',
          },
          413,
          request,
        );
      }

      const fileName = `postcard_${userId}_${Date.now()}.${ext}`;

      const uploadRes = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: binary,
        }
      );
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        return json({ error: 'Upload failed: ' + err.slice(0, 200) }, 500, request);
      }
      const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;
      return json({ url: publicUrl }, 200, request);
    }

    // ── POST /api/prepare-postcard ──
    // Заливает открытку в Storage и готовит inline-сообщение с фото для tg.shareMessage
    if (request.method === 'POST' && path === '/api/prepare-postcard') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const imageDataUrl = body.imageDataUrl || '';
      const text = (body.text || '').toString().slice(0, 800);
      const m = imageDataUrl.match(/^data:image\/(png|jpeg);base64,/);
      if (!m) {
        return json({ error: 'Invalid image' }, 400, request);
      }
      const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
      const contentType = `image/${m[1]}`;
      const base64 = imageDataUrl.split(',')[1];

      if (
        !base64 ||
        base64.length >
          MAX_UPLOADED_IMAGE_BASE64_LENGTH
      ) {
        return json(
          {
            error:
              'Image is too large',
          },
          413,
          request,
        );
      }

      const binary = Uint8Array.from(
        atob(base64),
        character =>
          character.charCodeAt(0),
      );

      if (
        binary.byteLength >
        MAX_UPLOADED_IMAGE_BYTES
      ) {
        return json(
          {
            error:
              'Image is too large',
          },
          413,
          request,
        );
      }

      const fileName = `postcard_${userId}_${Date.now()}.${ext}`;

      const uploadRes = await fetch(
        `${env.SUPABASE_URL}/storage/v1/object/postcards/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
          },
          body: binary,
        }
      );
      if (!uploadRes.ok) return json({ error: 'Upload failed' }, 500, request);
      const photoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/postcards/${fileName}`;

      const botUsername = env.BOT_USERNAME || 'ChumiPetBot';
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'photo',
            id: 'pc_' + Date.now(),
            photo_url: photoUrl,
            thumbnail_url: photoUrl,
            caption: text,
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: `https://t.me/${botUsername}` }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const tgData = await tgRes.json();
      if (!tgData.ok) return json({ error: tgData.description || 'TG error' }, 500, request);
      return json({ prepared_message_id: tgData.result.id }, 200, request);
    }

// ── POST /api/prepare-sticker ──
// Готовит prepared inline-сообщение со стикером из набора @ChumiPetBot.
// При вызове tg.shareMessage пользователь выбирает чат, и туда отправляется
// настоящий стикер (type: 'sticker').
if (request.method === 'POST' && path === '/api/prepare-sticker') {
  const body = await request.json();
  const userId = extractUserId(request, env, body.userId);
  if (!userId) return json({ error: 'Unauthorized' }, 401, request);

  const stickerFileId = (body.sticker_file_id || '').toString();
  if (!stickerFileId) return json({ error: 'sticker_file_id required' }, 400, request);

  // Защита: принимаем только стикеры из нашего пакета @ChumiPetBot
  if (!stickerFileId.startsWith('CAACAgIAAxUAAWoD')) {
    return json({ error: 'Invalid sticker' }, 400, request);
  }

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: parseInt(userId),
      result: {
        type: 'sticker',
        id: 'sticker_' + Date.now(),
        sticker_file_id: stickerFileId,
      },
      allow_user_chats: true,
      allow_bot_chats: false,
      allow_group_chats: true,
      allow_channel_chats: true,
    }),
  });
  const data = await res.json();
  if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id }, 200, request);
  return json({ error: 'Failed to prepare sticker', details: data }, 500, request);
}

        // ── POST /api/prepare-task-message ──
    // Готовит inline-сообщение для заданий send_msg / send_sticker / send_media.
    // У получателя в чате появится текстовое сообщение с inline-кнопкой
    // «🐾 Открыть Chumi», которая открывает Mini App.
    if (request.method === 'POST' && path === '/api/prepare-task-message') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const pairCode = (body.pairCode || '').toUpperCase();
      const taskKey = body.taskKey || 'send_msg';
      const text = (body.text || '').toString().slice(0, 800);
      if (!pairCode) return json({ error: 'pairCode required' }, 400, request);
      if (!text) return json({ error: 'text required' }, 400, request);
      if (!['send_msg', 'send_sticker', 'send_media'].includes(taskKey)) {
        return json({ error: 'invalid taskKey' }, 400, request);
      }

      // Проверяем участие в паре
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      // Получаем язык отправителя для подписи кнопки
      const { data: ps } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', userId).maybeSingle();
      const userLang = ps?.lang || 'ru';
      const btnText = userLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

      const titleByTask = {
        send_msg:     userLang === 'ru' ? 'Сообщение Chumi 🐾'   : 'Chumi message 🐾',
        send_sticker: userLang === 'ru' ? 'Стикер от Chumi 🎨'   : 'Sticker from Chumi 🎨',
        send_media:   userLang === 'ru' ? 'Фото-привет Chumi 📸' : 'Photo from Chumi 📸',
      };

      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/savePreparedInlineMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: parseInt(userId),
          result: {
            type: 'article',
            id: 'task_' + taskKey + '_' + pairCode + '_' + Date.now(),
            title: titleByTask[taskKey],
            input_message_content: {
              message_text: text,
              parse_mode: 'Markdown',
            },
            description: text.slice(0, 80),
            reply_markup: {
              inline_keyboard: [[{ text: btnText, url: `https://t.me/${env.BOT_USERNAME || 'ChumiPetBot'}` }]],
            },
          },
          allow_user_chats: true,
          allow_bot_chats: false,
          allow_group_chats: true,
          allow_channel_chats: true,
        }),
      });
      const data = await res.json();
      if (data.ok && data.result?.id) return json({ prepared_message_id: data.result.id }, 200, request);
      return json({ error: 'Failed to prepare message', details: data }, 500, request);
    }

    // ── GET /api/user-lang/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/user-lang\/[^/]+$/)) {
      const _userId = path.split('/')[3];

      // Язык — некритичные данные, нужные на самом старте (ещё до полной
      // инициализации). Если initData недоступен, не валим старт ошибкой —
      // отдаём дефолтный язык. При наличии авторизации читаем язык того,
      // кто запрашивает (а не произвольного userId из пути), чтобы не было
      // утечки чужих настроек.
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ lang: 'ru' }, 200, request);

      const { data } = await supabase
        .from('user_settings').select('lang')
        .eq('telegram_user_id', authedId).maybeSingle();
      return json({ lang: data?.lang || 'ru' }, 200, request);
    }

    // ── POST /api/set-lang ──
    if (request.method === 'POST' && path === '/api/set-lang') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const lang = body.lang === 'en' ? 'en' : 'ru';
      await supabase.from('user_settings').upsert(
        { telegram_user_id: userId, lang, updated_at: new Date().toISOString() },
        { onConflict: 'telegram_user_id' }
      );
      return json({ success: true, lang }, 200, request);
    }

    // ── POST /api/send-reminders (cron) ──
    if (request.method === 'POST' && path === '/api/send-reminders') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403, request);

      const { data: allPairs } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days, timezone')
        .eq('is_dead', false)
        .gte('streak_days', 1);

      const pairs = allPairs || [];
      if (pairs.length === 0) return json({ success: true, sent: 0 }, 200, request);

      const pairCodes = pairs.map(p => p.code);

      // ── Батч 1: все участники всех пар ──
      const { data: allMembers } = await supabase
        .from('pair_users').select('pair_code, user_id')
        .in('pair_code', pairCodes);

      // "Сегодня" у каждой пары своё (таймзона). Считаем один раз на пару.
      const todayByPair = new Map();
      for (const p of pairs) todayByPair.set(p.code, getTodayDate(p.timezone || 'UTC'));

      // ── Батч 2: все сегодняшние daily_open по всем парам ──
      // Диапазон дат: собираем набор уникальных "сегодня" и тянем по нему.
      const todaySet = [...new Set([...todayByPair.values()])];
      const { data: opens } = await supabase
        .from('daily_tasks').select('pair_code, user_id, task_date')
        .eq('task_key', 'daily_open')
        .in('pair_code', pairCodes)
        .in('task_date', todaySet);

      // Множество "кто уже открыл сегодня" ключом pair_code|user_id
      const openedSet = new Set();
      for (const o of (opens || [])) {
        if (o.task_date === todayByPair.get(o.pair_code)) {
          openedSet.add(`${o.pair_code}|${o.user_id}`);
        }
      }

      // Кандидаты на напоминание (кто НЕ открыл сегодня)
      const candidates = [];
      for (const m of (allMembers || [])) {
        if (!openedSet.has(`${m.pair_code}|${m.user_id}`)) {
          candidates.push(m);
        }
      }
      if (candidates.length === 0) return json({ success: true, sent: 0 }, 200, request);

      const candidateIds = [...new Set(candidates.map(c => String(c.user_id)))];

      // ── Батч 3: кому уже слали напоминание сегодня (по UTC-дню) ──
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { data: sentToday } = await supabase
        .from('notification_log').select('target_user_id')
        .eq('sender_user_id', 'system_reminder')
        .gte('sent_at', todayStart.toISOString())
        .in('target_user_id', candidateIds);
      const alreadySentSet = new Set((sentToday || []).map(r => String(r.target_user_id)));

      // ── Батч 4: языки всех кандидатов ──
      const { data: settings } = await supabase
        .from('user_settings').select('telegram_user_id, lang')
        .in('telegram_user_id', candidateIds);
      const langByUser = new Map();
      for (const s of (settings || [])) langByUser.set(String(s.telegram_user_id), s.lang || 'ru');

      // Быстрый доступ к паре по коду
      const pairByCode = new Map(pairs.map(p => [p.code, p]));

      // Один пользователь может быть в нескольких парах; напоминание слём
      // не чаще одного раза в день на пользователя (rate-limit ниже).
      const notifiedThisRun = new Set();
      let sent = 0;

      for (const c of candidates) {
        const uid = String(c.user_id);
        if (alreadySentSet.has(uid) || notifiedThisRun.has(uid)) continue;

        const pair = pairByCode.get(c.pair_code);
        if (!pair) continue;

        const safePet = escapeMd(pair.pet_name || 'Chumi');
        const mLang = langByUser.get(uid) || 'ru';
        const reminderText = mLang === 'ru'
          ? `🔔 *${safePet}* ждёт тебя! Серия: ${pair.streak_days} дн. 🔥\nНе забудь зайти сегодня!`
          : `🔔 *${safePet}* is waiting! Streak: ${pair.streak_days} days 🔥\nDon't forget to come today!`;
        const btnText = mLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

        const res = await sendTelegramMessage(env, uid, reminderText, {
          reply_markup: {
            inline_keyboard: [[{ text: btnText, web_app: { url: 'https://chumi.space' } }]],
          },
        });

        // Пишем в лог только при успешной доставке
        if (res.ok) {
          await supabase.from('notification_log').insert({
            sender_user_id: 'system_reminder',
            target_user_id: uid,
            sent_at: new Date().toISOString(),
          });
          notifiedThisRun.add(uid);
          sent++;
        }
      }

      return json({ success: true, sent }, 200, request);
    }

    // ── POST /api/update-streaks (cron) ──
    if (request.method === 'POST' && path === '/api/update-streaks') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403, request);

      // ── Батч: тянем живые и мёртвые пары одним запросом каждую ──
      const { data: alivePairsRaw } = await supabase
        .from('pairs')
        .select('code, last_streak_date, last_pair_streak_date, streak_days, growth_points, is_dead, pet_name, timezone, active_skin')
        .eq('is_dead', false);
      const { data: deadPairsRaw } = await supabase
        .from('pairs')
        .select('code, last_streak_date, last_pair_streak_date, streak_days, pet_name, timezone')
        .eq('is_dead', true);

      const alivePairs = alivePairsRaw || [];
      const deadPairs = deadPairsRaw || [];

      // Все коды, по которым понадобятся участники (живые + мёртвые)
      const allCodes = [
        ...alivePairs.map(p => p.code),
        ...deadPairs.map(p => p.code),
      ];

      // ── Батч: все участники всех этих пар ──
      const membersByCode = new Map();
      if (allCodes.length > 0) {
        const { data: allMembers } = await supabase
          .from('pair_users').select('pair_code, user_id')
          .in('pair_code', allCodes);
        for (const m of (allMembers || [])) {
          if (!membersByCode.has(m.pair_code)) membersByCode.set(m.pair_code, []);
          membersByCode.get(m.pair_code).push(m.user_id);
        }
      }

      // Собираем список пар, которых надо УБИТЬ, и пар, которые надо СБРОСИТЬ.
      // Уведомления шлём в конце, языки подтянем одним батчем.
      const toKill = [];   // { pair }
      const toReset = [];  // { pair }

      // ── 1) Определяем, кого убить ──
      for (const pair of alivePairs) {
        const tz = pair.timezone || 'UTC';
        // Питомец живёт/умирает только в полной паре (2 участника).
        const memberIds = membersByCode.get(pair.code) || [];
        if (memberIds.length < 2) continue;

        const yesterday = getYesterdayDate(tz);

        /*
         * Смерть зависит от последнего совместно
         * засчитанного дня, а не от входа одного
         * из участников.
         */
        if (
          pair.last_pair_streak_date &&
          pair.last_pair_streak_date < yesterday
        ) {
          toKill.push(pair);
        }
      }

      // ── 2) Определяем, кого сбросить (мёртв 3+ дня) ──
      for (const pair of deadPairs) {
        if (!pair.last_pair_streak_date) continue;

        const tz =
          pair.timezone ||
          'UTC';

        const today =
          getTodayDate(tz);

        const diffDays =
          getDateDifferenceInDays(
            pair.last_pair_streak_date,
            today,
          );

        if (
          diffDays !== null &&
          diffDays >= 3
        ) {
          toReset.push(pair);
        }
      }

      // ── Батч: языки всех затронутых пользователей ──
      const affectedUserIds = new Set();
      for (const pair of [...toKill, ...toReset]) {
        for (const uid of (membersByCode.get(pair.code) || [])) {
          affectedUserIds.add(String(uid));
        }
      }
      const langByUser = new Map();
      if (affectedUserIds.size > 0) {
        const { data: settings } = await supabase
          .from('user_settings').select('telegram_user_id, lang')
          .in('telegram_user_id', [...affectedUserIds]);
        for (const s of (settings || [])) {
          langByUser.set(String(s.telegram_user_id), s.lang || 'ru');
        }
      }

      // ── Выполняем убийства ──
      let killed = 0;
      for (const pair of toKill) {
        const {
          data: killedPair,
          error: killError,
        } = await supabase
          .from('pairs')
          .update({
            is_dead: true,
          })
          .eq('code', pair.code)
          .eq('is_dead', false)
          .select('code')
          .maybeSingle();

        if (killError) {
          console.error(
            'Failed to mark pet as dead:',
            {
              pairCode: pair.code,
              error: killError,
            },
          );

          continue;
        }

        /*
         * Если cron запустился параллельно,
         * уведомление отправляет только тот запуск,
         * который действительно изменил is_dead
         * с false на true.
         */
        if (!killedPair) {
          continue;
        }

        killed++;

        const deathStickerFileId =
          getDeathStickerFileId(pair);

        for (const uid of (membersByCode.get(pair.code) || [])) {
          const dLang = langByUser.get(String(uid)) || 'ru';
          const petName = pair.pet_name || (dLang === 'ru' ? 'Питомец' : 'Pet');
          const safePet = escapeMd(petName);
          const text = dLang === 'ru'
            ? `💀 *${safePet}* умер... Серия (${pair.streak_days} дн.) под угрозой!\nЗайди в приложение и нажми «Воскресить», чтобы продолжить серию.\nОсталось воскрешений в этом месяце: до 5.`
            : `💀 *${safePet}* has died... Streak (${pair.streak_days} days) is at risk!\nOpen the app and tap "Revive" to continue.\nUp to 5 revivals per month available.`;
          const dBtnText = dLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';

          await sendTelegramSticker(
            env,
            uid,
            deathStickerFileId,
          );

          await sendTelegramMessage(env, uid, text, {
            reply_markup: {
              inline_keyboard: [[{ text: dBtnText, web_app: { url: 'https://chumi.space' } }]],
            },
          });
        }
      }

      // ── Выполняем сбросы (мёртв 3+ дня → полный сброс к яйцу) ──
      let reset = 0;
      for (const pair of toReset) {
        const tz = pair.timezone || 'UTC';
        const today = getTodayDate(tz);
        await supabase.from('pairs').update({
          is_dead: false,
          streak_days: 0,
          growth_points: 0,
          hatched: false,
          active_skin: null,
          last_streak_date: today,
          last_pair_streak_date: today,
        }).eq('code', pair.code);
        await supabase.from('daily_tasks').delete().eq('pair_code', pair.code);
        await supabase.from('feedings').delete().eq('pair_code', pair.code);
        reset++;

        for (const uid of (membersByCode.get(pair.code) || [])) {
          const rLang = langByUser.get(String(uid)) || 'ru';
          const petName = pair.pet_name || (rLang === 'ru' ? 'Питомец' : 'Pet');
          const safePet = escapeMd(petName);
          const text = rLang === 'ru'
            ? `🥚 *${safePet}* не воскресили 3 дня — прогресс обнулён.\nНачните заново: зайдите в Chumi и вырастите нового питомца вместе!`
            : `🥚 *${safePet}* wasn't revived for 3 days — progress was reset.\nStart over: open Chumi and grow a new pet together!`;
          const rBtn = rLang === 'ru' ? '🐾 Открыть Chumi' : '🐾 Open Chumi';
          await sendTelegramMessage(env, uid, text, {
            reply_markup: {
              inline_keyboard: [[{ text: rBtn, web_app: { url: 'https://chumi.space' } }]],
            },
          });
        }
      }

      return json({ success: true, killed, reset }, 200, request);
    }

    // ── POST /api/cleanup-empty-pairs (cron) ──
    // Удаляет: 1) пустые пары (< 2 участников) старше 5 дней;
    //          2) активные пары, в которые никто не заходил 5+ дней
    if (request.method === 'POST' && path === '/api/cleanup-empty-pairs') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403, request);

      const { data: allPairsRaw } = await supabase
        .from('pairs').select('code, created_at, last_streak_date, timezone');
      const allPairs = allPairsRaw || [];
      if (allPairs.length === 0) {
        return json({ success: true, cleaned: 0, cleanedInactive: 0 }, 200, request);
      }

      const allCodes = allPairs.map(p => p.code);

      // ── Батч: участники всех пар одним запросом ──
      const membersByCode = new Map();
      const { data: allMembers } = await supabase
        .from('pair_users').select('pair_code, user_id')
        .in('pair_code', allCodes);
      for (const m of (allMembers || [])) {
        if (!membersByCode.has(m.pair_code)) membersByCode.set(m.pair_code, []);
        membersByCode.get(m.pair_code).push(m.user_id);
      }

      const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();

      // Классифицируем пары: какие удалить как пустые, какие — как неактивные.
      const toDeleteEmpty = [];     // { pair }
      const toDeleteInactive = [];  // { pair, memberIds }

      for (const pair of allPairs) {
        const memberIds = membersByCode.get(pair.code) || [];
        const isOldEnough = pair.created_at && pair.created_at < fiveDaysAgo;
        const isEmpty = memberIds.length < 2;

        // 1) Пустая пара старше 5 дней
        if (isEmpty && isOldEnough) {
          toDeleteEmpty.push(pair);
          continue;
        }

        // 2) Полная пара, неактивная 5+ дней
        if (!isEmpty) {
          const tz = pair.timezone || 'UTC';
          const today = getTodayDate(tz);
          const todayD = new Date(today + 'T00:00:00Z');
          todayD.setUTCDate(todayD.getUTCDate() - 5);
          const fiveDaysAgoDate = todayD.toISOString().split('T')[0];

          const lastActivity = pair.last_streak_date
            || (pair.created_at ? pair.created_at.split('T')[0] : null);

          if (lastActivity && lastActivity < fiveDaysAgoDate) {
            toDeleteInactive.push({ pair, memberIds });
          }
        }
      }

      // ── Батч: языки участников неактивных пар (их надо уведомить) ──
      const notifyUserIds = new Set();
      for (const { memberIds } of toDeleteInactive) {
        for (const uid of memberIds) notifyUserIds.add(String(uid));
      }
      const langByUser = new Map();
      if (notifyUserIds.size > 0) {
        const { data: settings } = await supabase
          .from('user_settings').select('telegram_user_id, lang')
          .in('telegram_user_id', [...notifyUserIds]);
        for (const s of (settings || [])) {
          langByUser.set(String(s.telegram_user_id), s.lang || 'ru');
        }
      }

      // Хелпер удаления всех связанных данных пары
      const purgePair = async (code) => {
        await supabase.from('one_time_tasks').delete().eq('pair_code', code);
        await supabase.from('daily_tasks').delete().eq('pair_code', code);
        await supabase.from('feedings').delete().eq('pair_code', code);
        await supabase.from('pair_users').delete().eq('pair_code', code);
        await supabase.from('pairs').delete().eq('code', code);
      };

      // ── Удаляем пустые пары ──
      let cleaned = 0;
      for (const pair of toDeleteEmpty) {
        await purgePair(pair.code);
        cleaned++;
      }

      // ── Удаляем неактивные пары (с уведомлением участников) ──
      let cleanedInactive = 0;
      for (const { pair, memberIds } of toDeleteInactive) {
        for (const uid of memberIds) {
          const pLang = langByUser.get(String(uid)) || 'ru';
          const msg = pLang === 'ru'
            ? `⏳ Пара \`${pair.code}\` удалена из-за неактивности (5+ дней без заходов).`
            : `⏳ Pair \`${pair.code}\` was deleted due to inactivity (5+ days without logins).`;
          await sendTelegramMessage(env, uid, msg);
        }
        await purgePair(pair.code);
        cleanedInactive++;
      }

      return json({ success: true, cleaned, cleanedInactive }, 200, request);
    }

    // ── POST /api/cleanup-jump-game-sessions (cron) ──
    if (
      request.method === 'POST' &&
      path ===
        '/api/cleanup-jump-game-sessions'
    ) {
      if (
        !isCronAuthorized(
          request,
          env,
        )
      ) {
        return json(
          {
            error:
              'Forbidden',
          },
          403,
          request,
        );
      }

      const abandonedAt =
        new Date()
          .toISOString();

      const {
        data: abandonedSessions,
        error: abandonError,
      } = await supabase
        .from(
          'jump_game_sessions',
        )
        .update({
          verification_status:
            'abandoned',
          verification_reasons:
            [
              'session_expired',
            ],
          abandoned_at:
            abandonedAt,
        })
        .eq(
          'verification_status',
          'pending',
        )
        .lt(
          'expires_at',
          abandonedAt,
        )
        .select(
          'id'
        );

      if (abandonError) {
        console.error(
          'Expired Jump session cleanup failed:',
          abandonError,
        );

        return json(
          {
            error:
              'Failed to clean expired Jump sessions',
          },
          500,
          request,
        );
      }

      return json(
        {
          success: true,
          abandoned:
            abandonedSessions?.length ||
            0,
          abandonedAt,
        },
        200,
        request,
      );
    }

        // ── POST /api/cleanup-postcards (cron) ──
    // Удаляет PNG-открытки из Storage-бакета `postcards` старше N часов.
    // Порог 48 часов: картинки нужны только в момент «поделиться» / на время
    // показа в Stories (24 ч). После этого файл в бакете больше не нужен.
    if (request.method === 'POST' && path === '/api/cleanup-postcards') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403, request);

      const MAX_AGE_HOURS = 48;
      const cutoff = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

      let deleted = 0;
      let errors = 0;

      // Пагинация: Storage list отдаёт максимум 100 за раз, идём пачками,
      // пока не закончатся старые файлы.
      for (let i = 0; i < 200; i++) { // жёсткий потолок 200 итераций = до 20000 файлов за запуск
        const { data: files, error: listErr } = await supabase
          .storage.from('postcards')
          .list('', { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });

        if (listErr) { errors++; break; }
        if (!files || files.length === 0) break;

        // Берём только реально старые файлы
        const oldNames = files
          .filter(f => f.created_at && f.created_at < cutoff)
          .map(f => f.name);

        if (oldNames.length === 0) break; // дальше идут только свежие — выходим

        const { error: rmErr } = await supabase
          .storage.from('postcards')
          .remove(oldNames);

        if (rmErr) { errors++; break; }
        deleted += oldNames.length;

        // Если в этой пачке старых было меньше 100 — значит дальше свежие, выходим
        if (oldNames.length < 100) break;
      }

      return json({ success: true, deleted, errors }, 200, request);
    }

    // ── POST /api/process-broadcast-queue (cron) ──
    if (
      request.method === 'POST' &&
      path === '/api/process-broadcast-queue'
    ) {
      if (
        !isCronAuthorized(
          request,
          env,
        )
      ) {
        return json(
          { error: 'Forbidden' },
          403,
          request,
        );
      }

      const {
        data: claimedRecipients,
        error: claimError,
      } = await supabase.rpc(
        'claim_broadcast_recipients',
        {
          p_limit: 20,
        },
      );

      if (claimError) {
        console.error(
          'Broadcast queue claim failed:',
          claimError,
        );

        return json(
          {
            error:
              'Failed to claim broadcast recipients',
            details:
              claimError.message,
          },
          500,
          request,
        );
      }

      const recipients =
        claimedRecipients || [];

      let jobId = null;
      let sent = 0;
      let failed = 0;
      let blocked = 0;
      let retrying = 0;

      if (recipients.length > 0) {
        jobId =
          Number(
            recipients[0].job_id,
          );

        const results = [];

        for (const recipient of recipients) {
          const delivery =
            recipient.source_chat_id &&
            recipient.source_message_id
              ? await copyTelegramMessage(
                  env,
                  recipient.telegram_user_id,
                  recipient.source_chat_id,
                  recipient.source_message_id,
                  Array.isArray(
                    recipient.buttons,
                  )
                    ? recipient.buttons
                    : [],
                )
              : await sendTelegramMessage(
                  env,
                  recipient.telegram_user_id,
                  recipient.message_text,
                  {
                    parse_mode: undefined,
                  },
                );

          let recipientStatus;
          let lastError = null;

          if (delivery?.ok) {
            recipientStatus = 'sent';
            sent += 1;
          } else if (delivery?.blocked) {
            recipientStatus = 'blocked';
            blocked += 1;

            lastError =
              delivery.description ||
              `Telegram HTTP ${delivery.status || 403}`;
          } else if (
            Number(recipient.attempts) >= 3
          ) {
            recipientStatus = 'failed';
            failed += 1;

            lastError =
              delivery?.description ||
              delivery?.error ||
              `Telegram HTTP ${delivery?.status || 0}`;
          } else {
            recipientStatus = 'pending';
            retrying += 1;

            lastError =
              delivery?.description ||
              delivery?.error ||
              `Telegram HTTP ${delivery?.status || 0}`;
          }

          results.push({
            id:
              Number(
                recipient.recipient_id,
              ),
            status:
              recipientStatus,
            last_error:
              lastError
                ? String(lastError).slice(
                    0,
                    1000,
                  )
                : null,
          });
        }

        const {
          error: completeError,
        } = await supabase.rpc(
          'complete_broadcast_batch',
          {
            p_job_id: jobId,
            p_results: results,
          },
        );

        if (completeError) {
          console.error(
            'Broadcast batch completion failed:',
            completeError,
          );

          return json(
            {
              error:
                'Messages were processed, but batch completion failed',
              details:
                completeError.message,
              jobId,
              claimed:
                recipients.length,
              sent,
              failed,
              blocked,
              retrying,
            },
            500,
            request,
          );
        }
      }

      const {
        data: completedJobs,
        error: completedJobsError,
      } = await supabase
        .from('broadcast_jobs')
        .select(
          'id, admin_chat_id, total_count, sent_count, failed_count, blocked_count, completed_at'
        )
        .eq(
          'status',
          'completed',
        )
        .is(
          'notified_at',
          null,
        )
        .order(
          'completed_at',
          {
            ascending: true,
          },
        )
        .limit(5);

      if (completedJobsError) {
        console.error(
          'Completed broadcasts query failed:',
          completedJobsError,
        );
      } else {
        for (const completedJob of (
          completedJobs || []
        )) {
          const notification =
            await sendTelegramMessage(
              env,
              completedJob.admin_chat_id,
              `✅ *Рассылка завершена*\n\n` +
                `🆔 Задание: \`${completedJob.id}\`\n` +
                `👥 Всего получателей: *${completedJob.total_count || 0}*\n` +
                `📨 Отправлено: *${completedJob.sent_count || 0}*\n` +
                `🚫 Заблокировали бота: *${completedJob.blocked_count || 0}*\n` +
                `❌ Другие ошибки: *${completedJob.failed_count || 0}*`,
            );

          if (notification?.ok) {
            const {
              error: notifyUpdateError,
            } = await supabase
              .from('broadcast_jobs')
              .update({
                notified_at:
                  new Date().toISOString(),
              })
              .eq(
                'id',
                completedJob.id,
              )
              .is(
                'notified_at',
                null,
              );

            if (notifyUpdateError) {
              console.error(
                'Broadcast notification status update failed:',
                notifyUpdateError,
              );
            }
          }
        }
      }

      return json(
        {
          success: true,
          jobId,
          claimed:
            recipients.length,
          sent,
          failed,
          blocked,
          retrying,
        },
        200,
        request,
      );
    }

        // ── POST /api/admin-daily-summary (cron) ──
    // Ежедневная сводка для админа
    if (request.method === 'POST' && path === '/api/admin-daily-summary') {
      if (!isCronAuthorized(request, env)) return json({ error: 'Forbidden' }, 403, request);

      const now = new Date();
      const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // ── Общие счётчики ──
      const { count: totalUsers } = await supabase
        .from('user_settings').select('telegram_user_id', { count: 'exact', head: true });
      const { count: totalPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true });
      const { count: alivePairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', false);
      const { count: deadPairs } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true }).eq('is_dead', true);
      const { count: totalSkinsOwned } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true });

      // ── За последние 24 часа ──
      const { count: newPairs24h } = await supabase
        .from('pairs').select('code', { count: 'exact', head: true })
        .gte('created_at', yesterdayIso);
      const { count: newSkins24h } = await supabase
        .from('user_skins').select('id', { count: 'exact', head: true })
        .gte('created_at', yesterdayIso);

      // ── Активные сегодня (заходили в daily_open) ──
      const todayUtc = now.toISOString().split('T')[0];
      const { data: activeToday } = await supabase
        .from('daily_tasks')
        .select('user_id')
        .eq('task_key', 'daily_open')
        .eq('task_date', todayUtc);
      const activeUsersToday = new Set((activeToday || []).map(t => t.user_id)).size;

      // ── Топ-3 пар по серии ──
      const { data: topStreaks } = await supabase
        .from('pairs')
        .select('code, pet_name, streak_days')
        .eq('is_dead', false)
        .order('streak_days', { ascending: false })
        .limit(3);

      let topStreaksText = '—';
      if (topStreaks && topStreaks.length > 0) {
        topStreaksText = topStreaks
          .map((p, i) => `${i + 1}. ${escapeMd(p.pet_name || '—')} (${p.streak_days} дн.)`)
          .join('\n');
      }

      const summary =
        `📊 *Chumi — ежедневная сводка*\n` +
        `_${now.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}_\n\n` +
        `👥 *Всего пользователей:* ${totalUsers ?? 0}\n` +
        `🟢 *Активные сегодня:* ${activeUsersToday}\n\n` +
        `🐾 *Пары:* ${totalPairs ?? 0}\n` +
        `   ❤️ Живые: ${alivePairs ?? 0}\n` +
        `   💀 Мёртвые: ${deadPairs ?? 0}\n\n` +
        `*За последние 24 часа:*\n` +
        `   🆕 Новых пар: ${newPairs24h ?? 0}\n` +
        `   🎨 Куплено скинов: ${newSkins24h ?? 0}\n\n` +
        `🎨 *Скинов в собственности:* ${totalSkinsOwned ?? 0}\n\n` +
        `🏆 *Топ-3 серии:*\n${topStreaksText}`;

      // Шлём админам
      let sent = 0;
      for (const adminId of ADMIN_IDS) {
        try {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: adminId,
              text: summary,
              parse_mode: 'Markdown',
            }),
          });
          sent++;
        } catch (e) {}
      }

      return json({ success: true, sent }, 200, request);
    }

    // ── POST /api/send-partner-message ──
    if (request.method === 'POST' && path === '/api/send-partner-message') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const code = body.code;
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', code).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      // ── Rate-limit: не чаще 1 сообщения партнёру в час ──
      // Находим партнёра заранее, чтобы залогировать отправку именно ему.
      const { data: rlMembers } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);
      const rlPartner = (rlMembers || []).find(m => String(m.user_id) !== String(userId));
      if (rlPartner) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent } = await supabase
          .from('notification_log')
          .select('id')
          .eq('sender_user_id', userId)
          .eq('target_user_id', String(rlPartner.user_id))
          .gte('sent_at', oneHourAgo)
          .limit(1);
        if (recent && recent.length > 0) {
          return json({ error: 'Too many messages', retryAfter: 3600 }, 429, request);
        }
      }

      const { data: pairRow } = await supabase
        .from('pairs').select('pet_name, streak_days').eq('code', code).maybeSingle();
      const petName = pairRow?.pet_name || 'Chumi';
      const safePet = escapeMd(petName);
      const streak = pairRow?.streak_days || 0;

      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', code);

      const WEBAPP_URL = 'https://chumi.space';
      const RU = [
        `🐾 Привет! Не забывай про ${safePet} — серия ${streak} дн.!`,
        `💌 Сообщение от партнёра по Chumi! Питомец растёт уже ${streak} дн. 🐾`,
        `👋 ${safePet} ждёт тебя! Серия: ${streak} дн. 🐾`,
      ];
      const EN = [
        `🐾 Hey! Don't forget about ${safePet} — streak ${streak} days!`,
        `💌 Message from your Chumi partner! Pet is growing for ${streak} days 🐾`,
        `👋 ${safePet} is waiting! Streak: ${streak} days 🐾`,
      ];

      let deliveredCount = 0;
      for (const m of (members || [])) {
        if (m.user_id === userId) continue;
        const { data: ps } = await supabase
          .from('user_settings').select('lang')
          .eq('telegram_user_id', m.user_id).maybeSingle();
        const targetLang = ps?.lang || 'ru';
        const pool = targetLang === 'ru' ? RU : EN;
        const text = pool[Math.floor(Math.random() * pool.length)];

        const btnText = '🐾 Chumi';
        let delivered = false;
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: m.user_id,
              text,
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: WEBAPP_URL } }]] },
            }),
          });
          delivered = tgRes.ok;
        } catch (e) {
          delivered = false;
        }

        if (delivered) {
          deliveredCount++;
          // Записываем факт отправки — для rate-limit (1 раз в час)
          await supabase.from('notification_log').insert({
            sender_user_id: String(userId),
            target_user_id: String(m.user_id),
            sent_at: new Date().toISOString(),
          });
        }
      }

      // Если ни одному партнёру не доставлено (например, бот заблокирован) —
      // возвращаем ошибку, чтобы фронт НЕ засчитывал задание.
      if (deliveredCount === 0) {
        return json({ error: 'Delivery failed' }, 502, request);
      }
      return json({ success: true }, 200, request);
    }

    // ── GET /api/skins/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/skins\/[^/]+$/)) {
      const userId = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403, request);

      const { data: owned } = await supabase
        .from('user_skins').select('skin_id').eq('user_id', userId);
      const { data: referrals } = await supabase
        .from('user_referrals').select('invited_user_id').eq('inviter_user_id', userId);
      const premium = await isPremium(supabase, userId);
      return json({
        owned: (owned || []).map(s => s.skin_id),
        referral_count: referrals?.length || 0,
        premium,
      }, 200, request);
    }

    // ── POST /api/buy-skin ──
    if (request.method === 'POST' && path === '/api/buy-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const skinId = body.skinId;
      if (!skinId) return json({ error: 'skinId required' }, 400, request);

      const price = SKIN_PRICES[skinId];
      if (price === undefined) return json({ error: 'Invalid skin' }, 400, request);

      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', userId).eq('skin_id', skinId).maybeSingle();
      if (alreadyOwned) return json({ error: 'Already owned' }, 400, request);

      const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
        title: `Наряд: ${skinId}`,
        description: `Разблокируй наряд ${skinId} для своего аксолотля!`,
        payload: JSON.stringify({ type: 'skin', skinId, userId, timestamp: Date.now() }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ amount: price, label: `Skin ${skinId}` }],
      });

      if (!invoiceUrl) return json({ error: 'Invoice creation failed' }, 500, request);
      return json({ invoiceUrl }, 200, request);
    }

        // ── POST /api/buy-skin-gift ──
    // Купить скин и подарить партнёру по паре
    if (request.method === 'POST' && path === '/api/buy-skin-gift') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId, { maxAgeSec: 3600 });
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const skinId = body.skinId;
      const pairCode = body.pairCode;
      if (!skinId) return json({ error: 'skinId required' }, 400, request);
      if (!pairCode) return json({ error: 'pairCode required' }, 400, request);

      const price = SKIN_PRICES[skinId];
      if (price === undefined) return json({ error: 'Invalid skin' }, 400, request);

      // Проверяем, что отправитель — участник пары
      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      // Находим партнёра
      const { data: members } = await supabase
        .from('pair_users').select('user_id').eq('pair_code', pairCode);
      const partner = (members || []).find(m => String(m.user_id) !== String(userId));
      if (!partner) return json({ error: 'No partner in pair' }, 400, request);

      // Проверяем, что у партнёра ещё нет такого скина
      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', partner.user_id).eq('skin_id', skinId).maybeSingle();
      if (alreadyOwned) return json({ error: 'Partner already owns this skin' }, 400, request);

      // Если у партнёра активный Premium — все скины ему и так доступны
      const recipientPremium = await isPremium(supabase, partner.user_id);
      if (recipientPremium) return json({ error: 'Partner already owns this skin' }, 400, request);

      // Создаём инвойс с типом "gift" и id получателя
      // ВАЖНО: payload в Telegram имеет лимит 128 байт, поэтому используем короткие ключи
      const invoiceUrl = await createStarsInvoice(env.BOT_TOKEN, {
        title: `Подарок: ${skinId}`,
        description: `Подарок другу — наряд ${skinId}!`,
        payload: JSON.stringify({
          t: 'skin_gift',
          s: skinId,
          u: userId,
          r: partner.user_id,
        }),
        provider_token: '',
        currency: 'XTR',
        prices: [{ amount: price, label: `Skin gift: ${skinId}` }],
      });


      if (!invoiceUrl) return json({ error: 'Invoice creation failed' }, 500, request);
      return json({ invoiceUrl }, 200, request);
    }

    // ── POST /api/claim-bee-skin ──
    if (request.method === 'POST' && path === '/api/claim-bee-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const { data: referrals } = await supabase
        .from('user_referrals').select('invited_user_id').eq('inviter_user_id', userId);
      const count = referrals?.length || 0;
      if (count < 2) return json({ error: 'Need at least 2 referrals' }, 400, request);

      const { data: alreadyOwned } = await supabase
        .from('user_skins').select('id')
        .eq('user_id', userId).eq('skin_id', 'bee').maybeSingle();
      if (alreadyOwned) return json({ error: 'Already claimed' }, 400, request);

      const { error: beeErr } = await supabase
        .from('user_skins').insert({ user_id: userId, skin_id: 'bee' });
      if (beeErr) return json({ error: 'Already claimed' }, 400, request);
      return json({ success: true }, 200, request);
    }

    // ── POST /api/set-skin ──
    if (request.method === 'POST' && path === '/api/set-skin') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const pairCode = body.pairCode;
      const skinId = body.skinId;

      const { data: membership } = await supabase
        .from('pair_users').select('user_id')
        .eq('pair_code', pairCode).eq('user_id', userId).maybeSingle();
      if (!membership) return json({ error: 'Not a member' }, 403, request);

      if (skinId) {
        const levelMatch = skinId.match(/^level_(\d+)$/);
        if (levelMatch) {
          // Уровневый скин — проверяем достигнут ли уровень
          const requiredLevel = parseInt(levelMatch[1]);
          const { data: pairData } = await supabase
            .from('pairs').select('growth_points').eq('code', pairCode).single();
          if (!pairData) return json({ error: 'Pair not found' }, 404, request);
          const currentLevel = getLevel(pairData.growth_points || 0).level;
          if (currentLevel < requiredLevel) return json({ error: 'Level not reached' }, 403, request);
        } else {
          // Обычный скин — проверяем владение или премиум
          const premium = await isPremium(supabase, userId);
          if (!premium) {
            const { data: owned } = await supabase
              .from('user_skins').select('id')
              .eq('user_id', userId).eq('skin_id', skinId).maybeSingle();
            if (!owned) return json({ error: 'Skin not owned' }, 403, request);
          }
        }
      }

      await supabase.from('pairs').update({ active_skin: skinId }).eq('code', pairCode);
      return json({ success: true }, 200, request);
    }

    // ── GET /api/premium/:userId ──
    if (request.method === 'GET' && path.match(/^\/api\/premium\/[^/]+$/)) {
      const userId = path.split('/')[3];
      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
      if (authedId !== String(userId)) return json({ error: 'Forbidden' }, 403, request);
      const premium = ADMIN_IDS.includes(String(userId));
      return json({ premium, expires_at: premium ? '2099-12-31T23:59:59Z' : null }, 200, request);
    }

    // ── GET /api/recoveries-left/:pairCode ──
    if (request.method === 'GET' && path.match(/^\/api\/recoveries-left\/[^/]+$/)) {
      const pairCode = path.split('/')[3];

      const authedId = getAuthedUserId(request, env);
      if (!authedId) return json({ error: 'Unauthorized' }, 401, request);
      if (!(await isPairMember(supabase, pairCode, authedId))) {
        return json({ error: 'Not a member' }, 403, request);
      }

      const { data: pair } = await supabase
        .from('pairs')
        .select(
          'streak_recoveries_used, last_recovery_month, timezone, last_pair_streak_date, streak_days'
        )
        .eq('code', pairCode)
        .maybeSingle();

      if (!pair) {
        return json(
          { error: 'Pair not found' },
          404,
          request,
        );
      }

      const recoveryState =
        getRecoveryState(pair);

      return json(
        {
          used:
            recoveryState.used,
          remaining:
            recoveryState.remaining,
          max:
            recoveryState.maximum,
          can_revive:
            recoveryState.canRevive,
          server_today:
            recoveryState.today,
          days_since_pair_streak:
            recoveryState.daysSincePairStreak,
        },
        200,
        request,
      );
    }

    // ── POST /api/update-timezone ──
    if (request.method === 'POST' && path === '/api/update-timezone') {
      const body = await request.json();
      const userId = extractUserId(request, env, body.userId);
      if (!userId) return json({ error: 'Unauthorized' }, 401, request);

      const tz = (typeof body.timezone === 'string' && body.timezone.length < 64)
        ? body.timezone : null;
      if (!tz) return json({ error: 'Invalid timezone' }, 400, request);

      // Обновляем личную таймзону пользователя
      await supabase.from('pair_users')
        .update({ timezone: tz })
        .eq('user_id', userId);

      // Таймзона ПАРЫ (определяет "сегодня" для стрика) фиксируется по таймзоне
      // того, кто был в паре один на момент установки — обычно создателя.
      // Правило: обновляем pairs.timezone, только если
      //   а) в паре пока 1 участник (партнёр ещё не присоединился), ИЛИ
      //   б) у пары вообще не задана таймзона (бэкфилл старых/битых данных).
      const { data: myPairs } = await supabase
        .from('pair_users').select('pair_code').eq('user_id', userId);
      for (const up of (myPairs || [])) {
        const { data: members } = await supabase
          .from('pair_users').select('user_id').eq('pair_code', up.pair_code);
        const { data: pairRow } = await supabase
          .from('pairs').select('timezone').eq('code', up.pair_code).maybeSingle();

        const isSolo = (members || []).length <= 1;
        const pairHasNoTz = !pairRow?.timezone;

        if (isSolo || pairHasNoTz) {
          await supabase.from('pairs').update({ timezone: tz }).eq('code', up.pair_code);
        }
      }

      return json({ success: true, timezone: tz }, 200, request);
    }

    // ── Fallback 404 ──
    return json({ error: 'Not found' }, 404, request);

  } catch (err) {
    console.error('API Error:', err);
    await notifyAdmins(env, `*API Error:*\n\`\`\`\n${(err?.stack || err?.message || String(err)).slice(0, 1500)}\n\`\`\``);
    return json({ error: 'Internal server error' }, 500, request);
  }
}
