import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getInitData } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import './JumpGame.css';

const ACCENT = '#9B72CF';
const JUMP_GAME_RULES_VERSION = 2;
const JUMP_GAME_CLIENT_VERSION = 'jump-2';

const MAX_GAME_SEED = 2147483646;

const GAME_CHECKPOINT_SCORES = [
  25,
  50,
  100,
  200,
  300,
  500,
];

const JUMP_GAME_MUTED_KEY =
  'chumi_jump_muted';

function normalizeGameSeed(value) {
  const parsed = Number(value);

  if (
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_GAME_SEED
  ) {
    return parsed;
  }

  return 1;
}

function createSeededRandom(seedValue) {
  let state = normalizeGameSeed(seedValue) >>> 0;

  return () => {
    state += 0x6D2B79F5;

    let value = state;

    value = Math.imul(
      value ^ (value >>> 15),
      value | 1,
    );

    value ^= value + Math.imul(
      value ^ (value >>> 7),
      value | 61,
    );

    return (
      (value ^ (value >>> 14)) >>> 0
    ) / 4294967296;
  };
}

function getFallbackGameSeed() {
  try {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);

    return (
      values[0] % MAX_GAME_SEED
    ) + 1;
  } catch {
    return (
      Math.floor(Math.random() * MAX_GAME_SEED)
    ) + 1;
  }
}

function getGameDifficulty(scoreValue) {
  const score = Math.max(
    0,
    Number(scoreValue) || 0,
  );

  /*
   * baseDifficulty сохраняет существующий баланс
   * от 0 до 200 очков.
   *
   * endlessDifficulty продолжает постепенно повышать
   * сложность после 200 очков и достигает максимума
   * примерно к 1000 очкам.
   */
  const baseDifficulty = clamp(
    score / 200,
    0,
    1,
  );

  const endlessDifficulty = clamp(
    (score - 200) / 800,
    0,
    1,
  );

  return {
    baseDifficulty,
    endlessDifficulty,
  };
}

const STATE = {
  INTRO: 'intro',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  OVER: 'over',
};

const TYPE = {
  NORMAL: 'normal',
  CLOUD: 'cloud',
  MOVING: 'moving',
  SPRING: 'spring',
  SPIKE: 'spike',
};

const PHYSICS = {
  gravity: 2200,
  jump: -820,
  spring: -1040,

  // Ракета теперь даёт продолжительный управляемый полёт,
  // а не один очень сильный прыжок.
  rocketSpeed: -720,
  rocketDuration: 1.25,

  /*
   * Параметры под управление «следование за пальцем»:
   * высокое ускорение — мгновенный подхват движения пальца;
   * высокий maxSpeed — питомец успевает за быстрым свайпом
   * через весь экран; friction гасит скорость после отпускания.
   */
  acceleration: 4000,
  maxSpeed: 520,
  friction: 0.60,
  step: 1 / 60,

  /*
   * Чувствительность управления: во сколько раз перемещение
   * питомца больше перемещения пальца. 1 = «палец к пальцу»
   * (абсолютный режим), 2 = питомец проезжает вдвое больше,
   * чем сдвинут палец — не нужно водить пальцем по всему экрану.
   */
  controlSensitivity: 2,
};

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

const random = (min, max) =>
  min + Math.random() * (max - min);

function routeRandom(game, min, max) {
  if (
    typeof game?.routeRandom !==
    'function'
  ) {
    throw new Error(
      'Route random generator is missing',
    );
  }

  return (
    min +
    game.routeRandom() *
    (max - min)
  );
}

function routeRoll(game) {
  if (
    typeof game?.routeRandom !==
    'function'
  ) {
    throw new Error(
      'Route random generator is missing',
    );
  }

  return game.routeRandom();
}

function getLocalStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLocalStorageItem(
  key,
  value,
) {
  try {
    localStorage.setItem(
      key,
      value,
    );
  } catch {
    // localStorage может быть недоступен.
  }
}

function createRunMetrics(
  width,
  height,
  language,
) {
  const telegramWebApp =
    window.Telegram?.WebApp;

  return {
    activeDurationMs: 0,
    pausedDurationMs: 0,
    frameCount: 0,
    maxFrameGapMs: 0,

    fpsTotal: 0,
    fpsSampleCount: 0,
    minimumFps: 0,

    landingCount: 0,
    normalLandings: 0,
    cloudLandings: 0,
    movingLandings: 0,
    springLandings: 0,

    rocketsCollected: 0,
    rocketsMissed: 0,

    maximumScore: 0,
    deathReason: 'unknown',

    screenWidth:
      Math.max(
        1,
        Math.round(width),
      ),

    screenHeight:
      Math.max(
        1,
        Math.round(height),
      ),

    telegramPlatform:
      telegramWebApp?.platform
        ? String(
            telegramWebApp.platform,
          ).slice(0, 32)
        : null,

    telegramWebAppVersion:
      telegramWebApp?.version
        ? String(
            telegramWebApp.version,
          ).slice(0, 32)
        : null,

    language:
      language === 'en'
        ? 'en'
        : 'ru',

    checkpoints: [],
    nextCheckpointIndex: 0,

    pauseStartedAt: null,
  };
}

function makeScoreMetrics(game) {
  const runMetrics =
    game?.metrics;

  if (!runMetrics) {
    return null;
  }

  const frameCount =
    Math.max(
      0,
      Math.round(
        runMetrics.frameCount,
      ),
    );

  const averageFps =
    runMetrics.fpsSampleCount > 0
      ? runMetrics.fpsTotal /
        runMetrics.fpsSampleCount
      : 0;

  const minimumFps =
    runMetrics.fpsSampleCount > 0
      ? runMetrics.minimumFps
      : 0;

  return {
    activeDurationMs:
      Math.max(
        0,
        Math.round(
          runMetrics.activeDurationMs,
        ),
      ),

    pausedDurationMs:
      Math.max(
        0,
        Math.round(
          runMetrics.pausedDurationMs,
        ),
      ),

    frameCount,

    maxFrameGapMs:
      Math.max(
        0,
        Math.round(
          runMetrics.maxFrameGapMs,
        ),
      ),

    averageFps:
      Math.max(
        0,
        Math.min(
          240,
          Number(
            averageFps.toFixed(2),
          ),
        ),
      ),

    minimumFps:
      Math.max(
        0,
        Math.min(
          240,
          Number(
            minimumFps.toFixed(2),
          ),
        ),
      ),

    landingCount:
      runMetrics.landingCount,

    normalLandings:
      runMetrics.normalLandings,

    cloudLandings:
      runMetrics.cloudLandings,

    movingLandings:
      runMetrics.movingLandings,

    springLandings:
      runMetrics.springLandings,

    rocketsCollected:
      runMetrics.rocketsCollected,

    rocketsMissed:
      runMetrics.rocketsMissed,

    maximumScore:
      runMetrics.maximumScore,

    deathReason:
      runMetrics.deathReason,

    screenWidth:
      Math.max(
        1,
        Math.round(
          game.width,
        ),
      ),

    screenHeight:
      Math.max(
        1,
        Math.round(
          game.height,
        ),
      ),

    telegramPlatform:
      runMetrics.telegramPlatform,

    telegramWebAppVersion:
      runMetrics.telegramWebAppVersion,

    language:
      runMetrics.language,

    checkpoints:
      runMetrics.checkpoints.map(
        checkpoint => ({
          score:
            checkpoint.score,

          activeDurationMs:
            checkpoint.activeDurationMs,

          landingCount:
            checkpoint.landingCount,

          rocketsCollected:
            checkpoint.rocketsCollected,
        }),
      ),

    clientMetrics: {
      seed:
        game.seed,

      rulesVersion:
        game.rulesVersion,

      clientVersion:
        game.clientVersion,

      distance:
        Math.max(
          0,
          Number(
            game.distance.toFixed(2),
          ),
        ),

      remainingPlatforms:
        game.platforms.length,

      remainingRockets:
        game.rockets.length,
    },
  };
}

function formatWeekCountdown(
  language,
  weekEndsAt,
  serverOffset,
  localNow,
) {
  const weekEndTime =
    Date.parse(
      weekEndsAt || '',
    );

  if (
    !Number.isFinite(
      weekEndTime,
    )
  ) {
    return '';
  }

  const serverNow =
    localNow +
    serverOffset;

  const remainingMs =
    weekEndTime -
    serverNow;

  if (remainingMs <= 0) {
    return language === 'ru'
      ? 'Подведение итогов…'
      : 'Finalizing results…';
  }

  const totalHours =
    Math.ceil(
      remainingMs /
      (60 * 60 * 1000),
    );

  const days =
    Math.floor(
      totalHours / 24,
    );

  const hours =
    totalHours % 24;

  return language === 'ru'
    ? (
        `До конца недели: ` +
        `${days} д. ${hours} ч.`
      )
    : (
        `Week ends in: ` +
        `${days}d ${hours}h`
      );
}

function wrappedDistance(from, to, width) {
  let distance = to - from;

  if (distance > width / 2) distance -= width;
  if (distance < -width / 2) distance += width;

  return distance;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createPlatform(game, options) {
  return {
    id: game.nextPlatformId++,
    x: options.x,
    y: options.y,
    baseX: options.x,
    width: options.width || 90,
    height: 15,
    type: options.type || TYPE.NORMAL,
    mainRoute: options.mainRoute !== false,

    /*
     * broken пока оставляем для совместимости
     * с текущей физикой и очисткой платформ.
     */
    broken: false,
    breakVelocity: 0,

    /*
     * Для облака:
     * 0 — на него ещё не приземлялись;
     * > 0 — идёт растворение.
     */
    dissolveProgress: 0,
    dissolved: false,

    moveRange: options.moveRange || 0,
    moveSpeed: options.moveSpeed || 0,
    phase: routeRandom(
      game,
      0,
      Math.PI * 2,
    ),
  };
}

function choosePlatformType(game, score) {
  const roll = routeRoll(game);

  const {
    baseDifficulty,
    endlessDifficulty,
  } = getGameDifficulty(score);

  /*
   * До 200 очков сохраняется прежний рост.
   * После 200 очков вероятность сложных платформ
   * продолжает плавно увеличиваться.
   */
  const movingChance =
    0.08 +
    baseDifficulty * 0.17 +
    endlessDifficulty * 0.07;

  const cloudChance =
    0.12 +
    baseDifficulty * 0.26 +
    endlessDifficulty * 0.10;

  const springChance =
    0.05 +
    baseDifficulty * 0.02;

  let chanceCursor = 0;

  if (score >= 28) {
    chanceCursor += movingChance;

    if (roll < chanceCursor) {
      return TYPE.MOVING;
    }
  }

  if (score >= 15) {
    chanceCursor += cloudChance;

    if (roll < chanceCursor) {
      return TYPE.CLOUD;
    }
  }

  if (score >= 10) {
    chanceCursor += springChance;

    if (roll < chanceCursor) {
      return TYPE.SPRING;
    }
  }

  return TYPE.NORMAL;
}

function addPlatform(game) {
  const score = Math.floor(
    game.distance / 10,
  );

  const {
    baseDifficulty,
    endlessDifficulty,
  } = getGameDifficulty(score);

  const previous = game.lastRoutePlatform;

  /*
   * После 200 очков платформы продолжают постепенно
   * сужаться, но остаются достаточно широкими
   * для мобильного управления.
   */
  const width = routeRandom(
    game,
    94 -
      baseDifficulty * 14 -
      endlessDifficulty * 10,
    118 -
      baseDifficulty * 17 -
      endlessDifficulty * 12,
  );

  /*
   * Основной маршрут всегда остаётся в пределах
   * достижимой высоты обычного прыжка.
   */
  const verticalGap = routeRandom(
    game,
    72 +
      baseDifficulty * 8 +
      endlessDifficulty * 5,
    106 +
      baseDifficulty * 15 +
      endlessDifficulty * 8,
  );

  const horizontalLimit = Math.min(
    game.width * 0.46,
    125 +
      baseDifficulty * 60 +
      endlessDifficulty * 25,
  );

  const type = choosePlatformType(
    game,
    score,
  );

  const moveRange =
    type === TYPE.MOVING
      ? routeRandom(
          game,
          16,
          32 + endlessDifficulty * 5,
        )
      : 0;

  const edgePadding = 12;

  const minPlatformX =
    edgePadding + moveRange;

  const maxPlatformX =
    game.width -
    width -
    edgePadding -
    moveRange;

  const x = clamp(
    previous.x +
      routeRandom(
        game,
        -horizontalLimit,
        horizontalLimit,
      ),
    minPlatformX,
    Math.max(
      minPlatformX,
      maxPlatformX,
    ),
  );

  const platform = createPlatform(game, {
    x,
    y: previous.y - verticalGap,
    width,
    type,
    moveRange,
    moveSpeed:
      type === TYPE.MOVING
        ? routeRandom(
            game,
            1.0 +
              baseDifficulty * 2.2 +
              endlessDifficulty * 0.8,
            1.5 +
              baseDifficulty * 2.6 +
              endlessDifficulty * 1.1,
          )
        : 0,
  });

  game.platforms.push(platform);
  game.lastRoutePlatform = platform;

  /*
   * Набор препятствий не меняется.
   * После 200 очков повышается только вероятность.
   */
  const spikeChance =
    0.13 +
    baseDifficulty * 0.06 +
    endlessDifficulty * 0.06;

  if (
    score >= 30 &&
    routeRoll(game) < spikeChance
  ) {
    const hazardWidth = routeRandom(
      game,
      65,
      85,
    );

    const placeRight =
      x < game.width / 2;

    let hazardX = placeRight
      ? x +
        width +
        routeRandom(game, 45, 75)
      : x -
        hazardWidth -
        routeRandom(game, 45, 75);

    hazardX = clamp(
      hazardX,
      12,
      game.width - hazardWidth - 12,
    );

    const overlaps =
      hazardX < x + width + 22 &&
      hazardX + hazardWidth > x - 22;

    if (!overlaps) {
      game.platforms.push(
        createPlatform(game, {
          x: hazardX,
          y:
            platform.y +
            routeRandom(game, -8, 10),
          width: hazardWidth,
          type: TYPE.SPIKE,
          mainRoute: false,
        }),
      );
    }
  }

  const distanceFromLastRocket =
    game.distance -
    game.lastRocketDistance;

  const distanceFromCollectedRocket =
    game.distance -
    game.lastCollectedRocketDistance;

  const hasActiveRocket =
    game.rockets.some(
      rocket => !rocket.collected,
    );

  const canSpawnRocket =
    distanceFromLastRocket >= 750 &&
    distanceFromCollectedRocket >= 450 &&
    game.player.boost <= 0 &&
    !hasActiveRocket;

  const rocketChance = Math.max(
    0.02,
    0.07 -
      baseDifficulty * 0.03 -
      endlessDifficulty * 0.015,
  );

  if (
    score >= 12 &&
    type !== TYPE.CLOUD &&
    canSpawnRocket &&
    routeRoll(game) < rocketChance
  ) {
    game.rockets.push({
      id: game.nextRocketId++,
      x: x + width / 2,
      y: platform.y - 36,
      phase: routeRandom(
        game,
        0,
        Math.PI * 2,
      ),
      collected: false,
    });

    game.lastRocketDistance =
      game.distance;
  }
}

function ensurePlatforms(game) {
  while (game.lastRoutePlatform.y > -220) {
    addPlatform(game);
  }
}

function makeGame(
  width,
  height,
  seedValue = getFallbackGameSeed(),
  language = 'ru',
) {
  const seed = normalizeGameSeed(seedValue);
  const seededRandom =
    createSeededRandom(seed);
  const startPlatform = {
    id: 1,
    x: width / 2 - 58,
    y: height - 95,
    baseX: width / 2 - 58,
    width: 116,
    height: 15,
    type: TYPE.NORMAL,
    mainRoute: true,
    broken: false,
    breakVelocity: 0,
    moveRange: 0,
    moveSpeed: 0,
    phase: 0,
  };

  const game = {
    width,
    height,
    seed,
    rulesVersion: JUMP_GAME_RULES_VERSION,
    clientVersion: JUMP_GAME_CLIENT_VERSION,
    routeRandom: seededRandom,

    state: STATE.INTRO,
    time: 0,
    accumulator: 0,
    previousTime: 0,

    distance: 0,
    score: 0,

    metrics:
      createRunMetrics(
        width,
        height,
        language,
      ),

    nextPlatformId: 2,
    nextRocketId: 1,

    // Расстояние, на котором была создана последняя ракета.
    lastRocketDistance: -Infinity,

    // Расстояние, на котором игрок собрал последнюю ракету.
    // Используется для паузы между ракетными полётами.
    lastCollectedRocketDistance: -Infinity,

    platforms: [startPlatform],
    rockets: [],
    particles: [],
    lastRoutePlatform: startPlatform,

    pointer: {
      active: false,

      /*
       * ID активного пальца.
       * Не позволяет второму одновременному касанию
       * перехватить управление.
       */
      pointerId: null,

      /*
       * Целевая горизонтальная позиция питомца
       * в координатах игры (0..width). Питомец плавно
       * тянется к ней в игровом цикле.
       * null — палец не касается экрана.
       */
      targetX: null,

      /*
       * Опорные точки для относительного управления
       * с усилением: позиция питомца и позиция пальца
       * в момент касания. Цель считается как сдвиг пальца
       * относительно anchorPointerX, умноженный на
       * чувствительность, прибавленный к anchorPetX.
       */
      anchorPetX: 0,
      anchorPointerX: 0,
    },

    player: {
      x: width / 2,
      y: startPlatform.y - 30,
      previousY: startPlatform.y - 30,
      vx: 0,
      vy: PHYSICS.jump,
      radius: 26,
      squash: 0,
      rotation: 0,
      boost: 0,
      lastPlatformId: startPlatform.id,
    },

    shake: 0,
    flash: 0,
  };

  ensurePlatforms(game);
  return game;
}

function addParticles(
  game,
  x,
  y,
  color,
  count = 8,
  options = {},
) {
  for (let i = 0; i < count; i += 1) {
    const life = random(0.35, 0.7);

    game.particles.push({
      x,
      y,
      vx: random(options.minVx ?? -120, options.maxVx ?? 120),
      vy: random(options.minVy ?? -210, options.maxVy ?? -60),
      gravity: options.gravity ?? 650,
      life,
      maxLife: life,
      size: random(2.5, 6),
      color,
    });
  }
}

function updateParticles(game, dt) {
  for (const particle of game.particles) {
    particle.life -= dt;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }

  game.particles = game.particles.filter(
    particle => particle.life > 0,
  );
}

function drawBackground(ctx, game, dark) {
  const gradient = ctx.createLinearGradient(
    0,
    0,
    0,
    game.height,
  );

  if (dark) {
    gradient.addColorStop(0, '#151326');
    gradient.addColorStop(0.62, '#292044');
    gradient.addColorStop(1, '#44366A');
  } else {
    gradient.addColorStop(0, '#F3EDF7');
    gradient.addColorStop(0.62, '#D7C8E8');
    gradient.addColorStop(1, '#BDA7D8');
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, game.width, game.height);

  if (dark) {
    for (let i = 0; i < 30; i += 1) {
      const x = (i * 97 + 31) % game.width;
      const y =
        (i * 173 + game.distance * 0.05) %
        game.height;

      const alpha =
        0.28 + Math.sin(game.time * 2 + i) * 0.12;

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(
        x,
        y,
        i % 5 === 0 ? 1.8 : 1,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 7; i += 1) {
      const x =
        ((i * 157 + game.time * (4 + i * 0.2)) %
          (game.width + 150)) -
        75;

      const y =
        90 +
        ((i * 143 + game.distance * 0.08) %
          Math.max(180, game.height - 180));

      ctx.fillStyle = 'rgba(255,255,255,0.23)';
      ctx.beginPath();
      ctx.arc(x, y, 27, 0, Math.PI * 2);
      ctx.arc(x + 27, y + 5, 21, 0, Math.PI * 2);
      ctx.arc(x - 24, y + 7, 17, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlatform(ctx, platform, dark) {
  const {
    x,
    y,
    width,
    height,
    type,
  } = platform;

  ctx.save();

  if (
    type === TYPE.CLOUD &&
    platform.dissolveProgress > 0
  ) {
    ctx.globalAlpha = clamp(
      1 -
        platform.dissolveProgress,
      0,
      1,
    );
  }

  if (platform.broken) {
    ctx.globalAlpha = clamp(
      1 - platform.breakVelocity / 1000,
      0.15,
      1,
    );
  }

  if (type === TYPE.SPIKE) {
    ctx.fillStyle = dark ? '#593244' : '#FFE1E7';
    roundRect(ctx, x, y, width, height, 7);
    ctx.fill();

    const count = Math.max(3, Math.floor(width / 17));
    const spikeWidth = width / count;

    ctx.fillStyle = '#E5485F';

    for (let i = 0; i < count; i += 1) {
      const spikeX = x + i * spikeWidth;

      ctx.beginPath();
      ctx.moveTo(spikeX + 2, y);
      ctx.lineTo(spikeX + spikeWidth / 2, y - 15);
      ctx.lineTo(spikeX + spikeWidth - 2, y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
    return;
  }

  const gradient = ctx.createLinearGradient(
    x,
    y,
    x,
    y + height,
  );

  if (type === TYPE.CLOUD) {
    gradient.addColorStop(
      0,
      dark
        ? '#F1ECF8'
        : '#FFFFFF',
    );

    gradient.addColorStop(
      1,
      dark
        ? '#BBAFD0'
        : '#DDD5E8',
    );
  } else if (type === TYPE.MOVING) {
    gradient.addColorStop(0, '#87D0FF');
    gradient.addColorStop(1, '#438FCE');
  } else if (type === TYPE.SPRING) {
    gradient.addColorStop(0, '#72E6A5');
    gradient.addColorStop(1, '#32A86B');
  } else {
    gradient.addColorStop(0, dark ? '#CBB8E6' : '#FFFFFF');
    gradient.addColorStop(1, dark ? '#8871AF' : '#D9CBE9');
  }

  ctx.shadowColor = 'rgba(28,16,48,0.18)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = gradient;

  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';

  roundRect(ctx, x + 5, y + 2, width - 10, 3, 2);
  ctx.fill();

  if (type === TYPE.CLOUD) {
    ctx.fillStyle =
      dark
        ? 'rgba(255,255,255,0.18)'
        : 'rgba(255,255,255,0.7)';

    ctx.beginPath();

    ctx.arc(
      x + width * 0.28,
      y + 2,
      13,
      Math.PI,
      Math.PI * 2,
    );

    ctx.arc(
      x + width * 0.48,
      y - 3,
      18,
      Math.PI,
      Math.PI * 2,
    );

    ctx.arc(
      x + width * 0.7,
      y + 1,
      14,
      Math.PI,
      Math.PI * 2,
    );

    ctx.fill();
  }

  if (type === TYPE.MOVING) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↔', x + width / 2, y + height / 2);
  }

  if (type === TYPE.SPRING) {
    ctx.strokeStyle = '#EFFFF4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + width / 2 - 12, y);
    ctx.lineTo(x + width / 2 - 7, y - 7);
    ctx.lineTo(x + width / 2, y);
    ctx.lineTo(x + width / 2 + 7, y - 7);
    ctx.lineTo(x + width / 2 + 12, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRocket(ctx, rocket, time) {
  const pulse =
    1 + Math.sin(time * 5 + rocket.phase) * 0.05;

  const flame =
    0.8 + Math.sin(time * 15 + rocket.phase) * 0.15;

  ctx.save();
  ctx.translate(rocket.x, rocket.y);
  ctx.scale(pulse, pulse);

  const flameGradient = ctx.createLinearGradient(
    0,
    10,
    0,
    38,
  );

  flameGradient.addColorStop(0, '#FFF36A');
  flameGradient.addColorStop(0.45, '#FF963D');
  flameGradient.addColorStop(1, 'rgba(255,70,40,0)');

  ctx.fillStyle = flameGradient;
  ctx.beginPath();
  ctx.moveTo(-7, 12);
  ctx.quadraticCurveTo(0, 20 + 17 * flame, 7, 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(15, -7, 11, 14);
  ctx.lineTo(-11, 14);
  ctx.quadraticCurveTo(-15, -7, 0, -20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(8, -13, 10, -5);
  ctx.lineTo(-10, -5);
  ctx.quadraticCurveTo(-8, -13, 0, -20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#8FD3FF';
  ctx.beginPath();
  ctx.arc(0, 1, 5.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#7C5CCB';

  ctx.beginPath();
  ctx.moveTo(-10, 5);
  ctx.lineTo(-19, 15);
  ctx.lineTo(-9, 13);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(10, 5);
  ctx.lineTo(19, 15);
  ctx.lineTo(9, 13);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawParticles(ctx, particles) {
  for (const particle of particles) {
    const alpha = clamp(
      particle.life / particle.maxLife,
      0,
      1,
    );

    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(
      particle.x,
      particle.y,
      particle.size * alpha,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawFallbackPet(ctx, player) {
  ctx.fillStyle = '#9B72CF';
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 23, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#CDB6EA';

  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 27, -10, 11, 5, side * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(side * 29, 2, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(side * 26, 13, 10, 5, -side * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(-9, -4, 4, 0, Math.PI * 2);
  ctx.arc(9, -4, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#30243D';
  ctx.beginPath();
  ctx.arc(-9, -4, 2, 0, Math.PI * 2);
  ctx.arc(9, -4, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#30243D';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 3, 6, 0.15, Math.PI - 0.15);
  ctx.stroke();

  if (player.boost > 0) {
    ctx.fillStyle = '#FF9A3D';
    ctx.beginPath();
    ctx.moveTo(-10, 20);
    ctx.lineTo(0, 46 + Math.sin(player.boost * 40) * 5);
    ctx.lineTo(10, 20);
    ctx.closePath();
    ctx.fill();
  }
}

function drawPlayer(ctx, game, image) {
  const player = game.player;

  const squash = clamp(player.squash, 0, 1);
  const scaleX = 1 + squash * 0.18;
  const scaleY = 1 - squash * 0.14;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.rotation);
  ctx.scale(scaleX, scaleY);

  if (player.boost > 0) {
    const glow = ctx.createRadialGradient(
      0,
      15,
      5,
      0,
      15,
      50,
    );

    glow.addColorStop(0, 'rgba(255,180,65,0.45)');
    glow.addColorStop(1, 'rgba(255,180,65,0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 15, 50, 0, Math.PI * 2);
    ctx.fill();
  }

  if (
    image?.complete &&
    image.naturalWidth > 0
  ) {
    ctx.drawImage(image, -52, -52, 104, 104);
  } else {
    drawFallbackPet(ctx, player);
  }

  ctx.restore();
}

function drawGame(ctx, game, image, dark) {
  /*
   * Плавное короткое колебание вместо случайного shake.
   * Math.random здесь не используется, поэтому экран
   * не будет хаотично дёргаться между кадрами.
   */
  const shakeX =
    game.shake > 0
      ? Math.sin(game.time * 65) *
        game.shake
      : 0;

  const shakeY =
    game.shake > 0
      ? Math.cos(game.time * 58) *
        game.shake *
        0.4
      : 0;

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawBackground(ctx, game, dark);

  for (const platform of game.platforms) {
    drawPlatform(ctx, platform, dark);
  }

  for (const rocket of game.rockets) {
    if (!rocket.collected) {
      drawRocket(
        ctx,
        rocket,
        game.time,
      );
    }
  }

  drawParticles(
    ctx,
    game.particles,
  );

  drawPlayer(
    ctx,
    game,
    image,
  );

  const playerVisualRadius = 52;

  if (
    game.player.x - playerVisualRadius < 0
  ) {
    ctx.save();
    ctx.translate(game.width, 0);

    drawPlayer(
      ctx,
      game,
      image,
    );

    ctx.restore();
  }

  if (
    game.player.x + playerVisualRadius >
    game.width
  ) {
    ctx.save();
    ctx.translate(-game.width, 0);

    drawPlayer(
      ctx,
      game,
      image,
    );

    ctx.restore();
  }

  ctx.restore();

  /*
   * Мягкая сиреневая подсветка.
   * Максимальная прозрачность очень маленькая.
   */
  if (game.flash > 0) {
    const alpha = clamp(
      game.flash * 0.12,
      0,
      0.025,
    );

    ctx.fillStyle =
      `rgba(220,205,255,${alpha})`;

    ctx.fillRect(
      0,
      0,
      game.width,
      game.height,
    );
  }
}

export default function JumpGame() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const petImageRef = useRef(null);
  const gameSessionRef = useRef(null);
  const gameSessionLoadingRef = useRef(false);
  const startLockRef = useRef(false);
  const scoreSavingRef = useRef(false);
  const pendingScoreRef = useRef(null);
  const personalBestRef = useRef(0);
  const pausedFromRef = useRef(null);
  const renderedScoreRef = useRef(-1);
  const leaderboardAbortRef = useRef(null);
  const sessionAbortRef = useRef(null);
  const scoreAbortRef = useRef(null);
  const personalScoreAbortRef = useRef(null);
  const mountedRef = useRef(true);

  const audioContextRef = useRef(null);
  const audioGainRef = useRef(null);
  const activeOscillatorsRef =
    useRef(
      new Set(),
    );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      leaderboardAbortRef.current?.abort();
      leaderboardAbortRef.current = null;

      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;

      scoreAbortRef.current?.abort();
      scoreAbortRef.current = null;

      personalScoreAbortRef.current?.abort();
      personalScoreAbortRef.current = null;
    };
  }, []);

  const navigate = useNavigate();
  const { pairId } = useParams();
  const [searchParams] = useSearchParams();
  const { lang } = useLang();

  const [screen, setScreen] = useState(STATE.INTRO);
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [isNewRecord, setIsNewRecord] = useState(false);
  const [gameStarting, setGameStarting] =
    useState(false);

  const [showLeaderboard, setShowLeaderboard] =
    useState(false);

  const [leaderboardLoading, setLeaderboardLoading] =
    useState(false);

  const [leaderboardError, setLeaderboardError] =
    useState('');

  const [leaders, setLeaders] =
    useState([]);

  const [pairLeaders, setPairLeaders] =
    useState([]);

  const [
    leaderboardTab,
    setLeaderboardTab,
  ] = useState('players');

  const [
    leaderboardServerOffset,
    setLeaderboardServerOffset,
  ] = useState(0);

  const [
    leaderboardWeekEndsAt,
    setLeaderboardWeekEndsAt,
  ] = useState('');

  const [
    leaderboardClock,
    setLeaderboardClock,
  ] = useState(
    () => Date.now(),
  );

  const [personalBest, setPersonalBest] =
    useState(0);

  const [personalRank, setPersonalRank] =
    useState(null);

  const [saveStatus, setSaveStatus] =
    useState('idle');

  const [saveError, setSaveError] =
    useState('');

  const [canRetrySave, setCanRetrySave] =
    useState(false);

  const [muted, setMuted] =
    useState(
      () =>
        getLocalStorageItem(
          JUMP_GAME_MUTED_KEY,
        ) === '1',
    );

  const mutedRef =
    useRef(muted);

  useEffect(() => {
    personalBestRef.current = personalBest;
  }, [personalBest]);

  useEffect(() => {
    mutedRef.current = muted;

    setLocalStorageItem(
      JUMP_GAME_MUTED_KEY,
      muted
        ? '1'
        : '0',
    );

    const gainNode =
      audioGainRef.current;

    const audioContext =
      audioContextRef.current;

    if (
      gainNode &&
      audioContext
    ) {
      gainNode.gain.setTargetAtTime(
        muted
          ? 0
          : 0.075,
        audioContext.currentTime,
        0.015,
      );
    }
  }, [muted]);

  const ensureAudioContext =
    useCallback(() => {
      let audioContext =
        audioContextRef.current;

      if (!audioContext) {
        const AudioContextClass =
          window.AudioContext ||
          window.webkitAudioContext;

        if (!AudioContextClass) {
          return null;
        }

        try {
          audioContext =
            new AudioContextClass();

          const gainNode =
            audioContext.createGain();

          gainNode.gain.value =
            mutedRef.current
              ? 0
              : 0.075;

          gainNode.connect(
            audioContext.destination,
          );

          audioContextRef.current =
            audioContext;

          audioGainRef.current =
            gainNode;
        } catch (error) {
          console.warn(
            'Jump audio initialization failed:',
            error,
          );

          return null;
        }
      }

      return audioContext;
    }, []);

  const resumeAudio =
    useCallback(() => {
      const audioContext =
        ensureAudioContext();

      if (
        audioContext?.state ===
        'suspended'
      ) {
        audioContext
          .resume()
          .catch(error => {
            console.warn(
              'Jump audio resume failed:',
              error,
            );
          });
      }
    }, [ensureAudioContext]);

  const suspendAudio =
    useCallback(() => {
      const audioContext =
        audioContextRef.current;

      if (
        audioContext?.state ===
        'running'
      ) {
        audioContext
          .suspend()
          .catch(error => {
            console.warn(
              'Jump audio suspend failed:',
              error,
            );
          });
      }
    }, []);

  const stopAudio =
    useCallback(() => {
      for (
        const oscillator of
        activeOscillatorsRef.current
      ) {
        try {
          oscillator.stop();
        } catch {
          // Осциллятор уже остановлен.
        }
      }

      activeOscillatorsRef.current.clear();

      const audioContext =
        audioContextRef.current;

      audioContextRef.current = null;
      audioGainRef.current = null;

      if (
        audioContext &&
        audioContext.state !== 'closed'
      ) {
        audioContext
          .close()
          .catch(error => {
            console.warn(
              'Jump audio close failed:',
              error,
            );
          });
      }
    }, []);

  const playSound =
    useCallback((
      soundType,
    ) => {
      if (mutedRef.current) {
        return;
      }

      const audioContext =
        ensureAudioContext();

      const masterGain =
        audioGainRef.current;

      if (
        !audioContext ||
        !masterGain ||
        audioContext.state !==
          'running'
      ) {
        return;
      }

      const soundSettings = {
        landing: {
          frequency: 190,
          endFrequency: 145,
          duration: 0.07,
          volume: 0.18,
          oscillatorType: 'sine',
        },

        cloud: {
          frequency: 420,
          endFrequency: 210,
          duration: 0.2,
          volume: 0.12,
          oscillatorType: 'sine',
        },

        spring: {
          frequency: 310,
          endFrequency: 720,
          duration: 0.16,
          volume: 0.18,
          oscillatorType: 'triangle',
        },

        rocket: {
          frequency: 260,
          endFrequency: 780,
          duration: 0.24,
          volume: 0.16,
          oscillatorType: 'sawtooth',
        },

        death: {
          frequency: 230,
          endFrequency: 75,
          duration: 0.34,
          volume: 0.16,
          oscillatorType: 'triangle',
        },

        record: {
          frequency: 520,
          endFrequency: 880,
          duration: 0.28,
          volume: 0.15,
          oscillatorType: 'sine',
        },
      };

      const settings =
        soundSettings[
          soundType
        ];

      if (!settings) {
        return;
      }

      try {
        const now =
          audioContext.currentTime;

        const oscillator =
          audioContext
            .createOscillator();

        const soundGain =
          audioContext
            .createGain();

        oscillator.type =
          settings.oscillatorType;

        oscillator.frequency
          .setValueAtTime(
            settings.frequency,
            now,
          );

        oscillator.frequency
          .exponentialRampToValueAtTime(
            Math.max(
              1,
              settings.endFrequency,
            ),
            now +
              settings.duration,
          );

        soundGain.gain
          .setValueAtTime(
            0.0001,
            now,
          );

        soundGain.gain
          .exponentialRampToValueAtTime(
            settings.volume,
            now + 0.012,
          );

        soundGain.gain
          .exponentialRampToValueAtTime(
            0.0001,
            now +
              settings.duration,
          );

        oscillator.connect(
          soundGain,
        );

        soundGain.connect(
          masterGain,
        );

        activeOscillatorsRef.current.add(
          oscillator,
        );

        oscillator.addEventListener(
          'ended',
          () => {
            activeOscillatorsRef.current.delete(
              oscillator,
            );

            try {
              oscillator.disconnect();
              soundGain.disconnect();
            } catch {
              // Узлы уже отключены.
            }
          },
          {
            once: true,
          },
        );

        oscillator.start(now);

        oscillator.stop(
          now +
            settings.duration +
            0.02,
        );
      } catch (error) {
        console.warn(
          'Jump sound playback failed:',
          error,
        );
      }
    }, [ensureAudioContext]);

  const toggleMuted =
    useCallback(() => {
      resumeAudio();

      setMuted(
        currentMuted =>
          !currentMuted,
      );
    }, [resumeAudio]);

  const pauseForInterruption = useCallback(() => {
    const game = gameRef.current;

    if (
      !game ||
      (
        game.state !== STATE.RUNNING &&
        game.state !== STATE.COUNTDOWN
      )
    ) {
      return;
    }

    pausedFromRef.current =
      game.state === STATE.COUNTDOWN
        ? STATE.COUNTDOWN
        : STATE.RUNNING;

    game.state = STATE.PAUSED;
    game.accumulator = 0;
    game.previousTime = 0;

    if (
      game.metrics &&
      game.metrics.pauseStartedAt ===
        null
    ) {
      game.metrics.pauseStartedAt =
        Date.now();
    }

    game.pointer.active = false;
    game.pointer.pointerId = null;
    game.pointer.targetX = null;
    game.player.vx = 0;

    suspendAudio();

    if (mountedRef.current) {
      setScreen(STATE.PAUSED);
    }
  }, [suspendAudio]);

  const enableTelegramGameMode =
    useCallback(() => {
      const tg =
        window.Telegram?.WebApp;

      if (!tg) {
        return;
      }

      try {
        tg.expand?.();
      } catch (error) {
        console.warn(
          'Telegram expand failed:',
          error,
        );
      }

      try {
        tg.disableVerticalSwipes?.();
      } catch (error) {
        console.warn(
          'Telegram disableVerticalSwipes failed:',
          error,
        );
      }

      try {
        tg.enableClosingConfirmation?.();
      } catch (error) {
        console.warn(
          'Telegram closing confirmation failed:',
          error,
        );
      }

      try {
        if (
          tg.isVersionAtLeast?.('8.0') &&
          !tg.isFullscreen
        ) {
          tg.requestFullscreen?.();
        }
      } catch (error) {
        console.warn(
          'Telegram fullscreen request failed:',
          error,
        );
      }

      try {
        tg.lockOrientation?.();
      } catch (error) {
        console.warn(
          'Telegram lockOrientation failed:',
          error,
        );
      }
    }, []);

  const disableTelegramGameMode =
    useCallback(() => {
      const tg =
        window.Telegram?.WebApp;

      if (!tg) {
        return;
      }

      try {
        tg.enableVerticalSwipes?.();
      } catch (error) {
        console.warn(
          'Telegram enableVerticalSwipes failed:',
          error,
        );
      }

      try {
        tg.disableClosingConfirmation?.();
      } catch (error) {
        console.warn(
          'Telegram disableClosingConfirmation failed:',
          error,
        );
      }

      try {
        tg.unlockOrientation?.();
      } catch (error) {
        console.warn(
          'Telegram unlockOrientation failed:',
          error,
        );
      }

      try {
        if (
          tg.isVersionAtLeast?.('8.0') &&
          tg.isFullscreen
        ) {
          tg.exitFullscreen?.();
        }
      } catch (error) {
        console.warn(
          'Telegram exitFullscreen failed:',
          error,
        );
      }
    }, []);

  useEffect(() => {
    const tg =
      window.Telegram?.WebApp;

    if (!tg) {
      return undefined;
    }

    const handleTelegramDeactivate =
      () => {
        pauseForInterruption();
      };

    const handleTelegramActivate =
      () => {
        /*
         * Не продолжаем игру автоматически.
         * Пользователь сам нажмёт кнопку продолжения.
         */
      };

    tg.onEvent?.(
      'deactivated',
      handleTelegramDeactivate,
    );

    tg.onEvent?.(
      'activated',
      handleTelegramActivate,
    );

    return () => {
      tg.offEvent?.(
        'deactivated',
        handleTelegramDeactivate,
      );

      tg.offEvent?.(
        'activated',
        handleTelegramActivate,
      );

      disableTelegramGameMode();
    };
  }, [
    disableTelegramGameMode,
    pauseForInterruption,
  ]);

  useEffect(() => {
    const activeGameScreen =
      screen === STATE.COUNTDOWN ||
      screen === STATE.RUNNING;

    if (activeGameScreen) {
      enableTelegramGameMode();
      resumeAudio();
    } else {
      disableTelegramGameMode();

      if (
        screen === STATE.PAUSED ||
        screen === STATE.INTRO
      ) {
        suspendAudio();
      }
    }
  }, [
    disableTelegramGameMode,
    enableTelegramGameMode,
    resumeAudio,
    screen,
    suspendAudio,
  ]);

  useEffect(() => {
    return () => {
      stopAudio();
      disableTelegramGameMode();
    };
  }, [
    disableTelegramGameMode,
    stopAudio,
  ]);

  const petName = searchParams.get('pet') || '';

  const gameOverPetImage =
    petName.startsWith('egg_')
      ? '/pets/egg_dead.png'
      : `/pets/${petName || 'axolotl_idle'}_dead.png`;

  const userId = String(
    window.Telegram?.WebApp?.initDataUnsafe?.user?.id ||
    getLocalStorageItem('chumi_test_uid') ||
    'guest',
  );

  const dark =
    getLocalStorageItem('chumi_theme') === 'night';

  const t = lang === 'ru'
    ? {
        title: 'Jump Chumi',
        subtitle: 'Поднимайся как можно выше',
        play: 'Играть',
        control: 'Удерживай палец и веди влево или вправо',
        fragile: 'Оранжевые платформы ломаются',
        spike: 'Не приземляйся на шипы',
        rocket: 'Ракета подбросит тебя выше',
        paused: 'Пауза',
        resume: 'Продолжить',
        gameOver: 'Игра окончена',
        score: 'Очки',
        record: 'Новый рекорд!',
        again: 'Ещё раз',
        back: 'К питомцу',
        leaderboard: 'Недельный рейтинг',
        leaderboardTitle: 'Лучшие игроки недели',
        pairLeaderboardTitle: 'Лучшие пары недели',
        playersTab: 'Игроки',
        pairsTab: 'Пары',
        waitingForPartner: 'Ожидает второго участника',
        pairScore: 'Общий результат',
        personalBest: 'Личный рекорд',
        yourPlace: 'Твоё место',
        loading: 'Загрузка...',
        leaderboardError: 'Не удалось загрузить рейтинг',
        emptyLeaderboard: 'Пока никто не установил рекорд',
        close: 'Закрыть',
        player: 'Игрок',
        savingScore: 'Сохраняем результат...',
        scoreSaved: 'Результат сохранён',
        scoreNotRanked: 'Результат сохранён, но не попал в рейтинг',
        scoreSaveError: 'Не удалось сохранить результат',
        retrySave: 'Повторить сохранение',
        waitForSaving: 'Подожди, пока сохранится предыдущий результат.',
      }
    : {
        title: 'Jump Chumi',
        subtitle: 'Climb as high as you can',
        play: 'Play',
        control: 'Hold and move left or right',
        fragile: 'Orange platforms break',
        spike: 'Do not land on spikes',
        rocket: 'Rockets boost you higher',
        paused: 'Paused',
        resume: 'Continue',
        gameOver: 'Game over',
        score: 'Score',
        record: 'New record!',
        again: 'Play again',
        back: 'Back to pet',
        leaderboard: 'Weekly ranking',
        leaderboardTitle: 'Top players of the week',
        pairLeaderboardTitle: 'Top pairs of the week',
        playersTab: 'Players',
        pairsTab: 'Pairs',
        waitingForPartner: 'Waiting for second partner',
        pairScore: 'Total score',
        personalBest: 'Personal best',
        yourPlace: 'Your place',
        loading: 'Loading...',
        leaderboardError: 'Failed to load leaderboard',
        emptyLeaderboard: 'No records yet',
        close: 'Close',
        player: 'Player',
        savingScore: 'Saving result...',
        scoreSaved: 'Result saved',
        scoreNotRanked: 'Result saved but was not added to the ranking',
        scoreSaveError: 'Failed to save result',
        retrySave: 'Retry saving',
        waitForSaving: 'Wait until the previous result is saved.',
      };

  const authHeaders = useCallback(() => {
    const headers = {
      'Content-Type': 'application/json',
    };

    const initData = getInitData();

    if (initData) {
      headers['X-Telegram-Init-Data'] = initData;
    }

    if (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) {
      headers['X-Dev-User-Id'] = userId;
    }

    return headers;
  }, [userId]);

  const createGameSession = useCallback(
    async () => {
      if (!pairId) {
        throw new Error(
          'Pair ID is missing'
        );
      }

      if (gameSessionLoadingRef.current) {
        throw new Error(
          'Game session is already being created'
        );
      }

      gameSessionLoadingRef.current = true;

      sessionAbortRef.current?.abort();

      const controller =
        new AbortController();

      sessionAbortRef.current =
        controller;

      try {
        const response = await fetch(
          '/api/game-session',
          {
            method: 'POST',
            headers: authHeaders(),
            signal:
              controller.signal,
            body: JSON.stringify({
              userId,
              pairCode: pairId,
              clientVersion:
                JUMP_GAME_CLIENT_VERSION,
            }),
          }
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Failed to create game session'
          );
        }

        if (!data.sessionId) {
          throw new Error(
            'Server did not return sessionId'
          );
        }

        const serverSeed =
          Number(
            data.seed,
          );

        const serverRulesVersion =
          Number(
            data.rulesVersion,
          );

        if (
          !Number.isSafeInteger(
            serverSeed,
          ) ||
          serverSeed < 1 ||
          serverSeed >
            MAX_GAME_SEED
        ) {
          throw new Error(
            'Server did not return a valid game seed'
          );
        }

        if (
          serverRulesVersion !==
          JUMP_GAME_RULES_VERSION
        ) {
          throw new Error(
            'Unsupported game rules version'
          );
        }

        if (
          data.clientVersion !==
          JUMP_GAME_CLIENT_VERSION
        ) {
          throw new Error(
            'Unsupported game client version'
          );
        }

        const sessionMetadata = {
          sessionId:
            String(
              data.sessionId,
            ),

          seed:
            serverSeed,

          rulesVersion:
            serverRulesVersion,

          clientVersion:
            JUMP_GAME_CLIENT_VERSION,

          serverTime:
            typeof data.serverTime ===
              'string'
              ? data.serverTime
              : null,

          startedAt:
            typeof data.startedAt ===
              'string'
              ? data.startedAt
              : null,

          expiresAt:
            typeof data.expiresAt ===
              'string'
              ? data.expiresAt
              : null,
        };

        gameSessionRef.current =
          sessionMetadata;

        return sessionMetadata;
      } finally {
        if (
          sessionAbortRef.current ===
          controller
        ) {
          sessionAbortRef.current =
            null;
        }

        gameSessionLoadingRef.current = false;
      }
    },
    [
      authHeaders,
      pairId,
      userId,
    ]
  );

  const loadLeaderboard = useCallback(async (
    requestedTab,
  ) => {
    const nextTab =
      requestedTab === 'pairs'
        ? 'pairs'
        : 'players';

    leaderboardAbortRef.current?.abort();

    const controller =
      new AbortController();

    leaderboardAbortRef.current =
      controller;

    if (mountedRef.current) {
      setLeaderboardLoading(true);
      setLeaderboardError('');
    }

    try {
      const endpoint =
        nextTab === 'pairs'
          ? '/api/game-pair-leaderboard'
          : '/api/game-leaderboard';

      const response = await fetch(
        endpoint,
        {
          headers:
            authHeaders(),

          signal:
            controller.signal,
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Leaderboard request failed',
        );
      }

      if (
        leaderboardAbortRef.current !==
          controller ||
        !mountedRef.current
      ) {
        return;
      }

      const serverTime =
        Date.parse(
          data.serverTime || '',
        );

      const weekEndsAt =
        Date.parse(
          data.weekEndsAt || '',
        );

      if (
        Number.isFinite(
          serverTime,
        )
      ) {
        setLeaderboardServerOffset(
          serverTime -
          Date.now(),
        );
      }

      if (
        Number.isFinite(
          weekEndsAt,
        )
      ) {
        setLeaderboardWeekEndsAt(
          data.weekEndsAt,
        );
      }

      setLeaderboardClock(
        Date.now(),
      );

      if (nextTab === 'pairs') {
        setPairLeaders(
          Array.isArray(
            data.leaders,
          )
            ? data.leaders
            : [],
        );
      } else {
        setLeaders(
          Array.isArray(
            data.leaders,
          )
            ? data.leaders
            : [],
        );

        if (data.me) {
          setPersonalBest(
            Number(
              data.me.score,
            ) || 0,
          );

          setPersonalRank(
            Number(
              data.me.rank,
            ) || null,
          );
        } else {
          setPersonalBest(0);
          setPersonalRank(null);
        }
      }
    } catch (error) {
      if (
        error?.name ===
        'AbortError'
      ) {
        return;
      }

      console.error(
        'Leaderboard loading failed:',
        error,
      );

      if (
        leaderboardAbortRef.current ===
          controller &&
        mountedRef.current
      ) {
        setLeaderboardError(
          t.leaderboardError,
        );
      }
    } finally {
      if (
        leaderboardAbortRef.current ===
        controller
      ) {
        leaderboardAbortRef.current =
          null;

        if (mountedRef.current) {
          setLeaderboardLoading(false);
        }
      }
    }
  }, [
    authHeaders,
    t.leaderboardError,
  ]);

  const openLeaderboard = useCallback(() => {
    setLeaderboardTab('players');
    setShowLeaderboard(true);
    loadLeaderboard('players');
  }, [loadLeaderboard]);

  const closeLeaderboard = useCallback(() => {
    leaderboardAbortRef.current?.abort();
    leaderboardAbortRef.current = null;

    setShowLeaderboard(false);
  }, []);

  const changeLeaderboardTab =
    useCallback((
      nextTab,
    ) => {
      const normalizedTab =
        nextTab === 'pairs'
          ? 'pairs'
          : 'players';

      setLeaderboardTab(
        normalizedTab,
      );

      loadLeaderboard(
        normalizedTab,
      );
    }, [loadLeaderboard]);

  const cleanupBeforeExit =
    useCallback(() => {
      const game =
        gameRef.current;

      if (game) {
        game.pointer.active = false;
        game.pointer.pointerId = null;
        game.pointer.targetX = null;
        game.player.vx = 0;
        game.accumulator = 0;
        game.previousTime = 0;

        if (
          game.state !== STATE.OVER
        ) {
          game.state = STATE.PAUSED;
        }
      }

      leaderboardAbortRef.current?.abort();
      leaderboardAbortRef.current = null;

      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;

      scoreAbortRef.current?.abort();
      scoreAbortRef.current = null;

      personalScoreAbortRef.current?.abort();
      personalScoreAbortRef.current = null;

      disableTelegramGameMode();
      stopAudio();
    }, [
      disableTelegramGameMode,
      stopAudio,
    ]);

  const navigateBack =
    useCallback(() => {
      cleanupBeforeExit();
      navigate(`/pair/${pairId}`);
    }, [
      cleanupBeforeExit,
      navigate,
      pairId,
    ]);

  useEffect(() => {
    if (
      !showLeaderboard ||
      !leaderboardWeekEndsAt
    ) {
      return undefined;
    }

    setLeaderboardClock(
      Date.now(),
    );

    const timer =
      window.setInterval(
        () => {
          if (mountedRef.current) {
            setLeaderboardClock(
              Date.now(),
            );
          }
        },
        60 * 1000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, [
    leaderboardWeekEndsAt,
    showLeaderboard,
  ]);

  const weekCountdownText =
    formatWeekCountdown(
      lang,
      leaderboardWeekEndsAt,
      leaderboardServerOffset,
      leaderboardClock,
    );

  const haptic = useCallback((type = 'light') => {
    try {
      const feedback =
        window.Telegram?.WebApp?.HapticFeedback;

      if (
        type === 'success' ||
        type === 'error' ||
        type === 'warning'
      ) {
        feedback?.notificationOccurred(type);
      } else {
        feedback?.impactOccurred(type);
      }
    } catch {
      // Haptic недоступен.
    }
  }, []);

  const submitScore = useCallback(async submission => {
    if (
      !submission ||
      scoreSavingRef.current
    ) {
      return false;
    }

    scoreSavingRef.current = true;

    if (mountedRef.current) {
      setSaveStatus('saving');
      setSaveError('');
      setCanRetrySave(false);
    }

    scoreAbortRef.current?.abort();

    const controller =
      new AbortController();

    scoreAbortRef.current =
      controller;

    try {
      const response = await fetch('/api/game-score', {
        method: 'POST',
        headers: authHeaders(),
        keepalive: true,
        signal:
          controller.signal,
        body: JSON.stringify({
          userId,
          pairCode:
            submission.pairCode,

          sessionId:
            submission.sessionId,

          score:
            submission.score,

          rulesVersion:
            submission.rulesVersion,

          metrics:
            submission.metrics,
        }),
      });

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
          'Failed to save game score',
        );
      }

      if (
        pendingScoreRef.current?.sessionId !==
          submission.sessionId ||
        !mountedRef.current
      ) {
        return true;
      }

      pendingScoreRef.current = null;
      setSaveError('');
      setCanRetrySave(false);

      const verificationStatus =
        typeof data.verificationStatus ===
          'string'
          ? data.verificationStatus
          : (
              typeof data.verification_status ===
                'string'
                ? data.verification_status
                : null
            );

      const accepted =
        data.accepted !== false &&
        (
          !verificationStatus ||
          verificationStatus ===
            'accepted'
        );

      setSaveStatus(
        accepted
          ? 'saved'
          : 'not-ranked',
      );

      if (!accepted) {
        setIsNewRecord(false);
        return true;
      }

      if (
        typeof data.isPersonalRecord === 'boolean'
      ) {
        setIsNewRecord(
          data.isPersonalRecord,
        );

        if (data.isPersonalRecord) {
          haptic('success');
          playSound('record');
        }
      }

      if (
        typeof data.personalBest === 'number'
      ) {
        personalBestRef.current =
          data.personalBest;

        setPersonalBest(
          data.personalBest,
        );
      }

      if (
        typeof data.rank === 'number'
      ) {
        setPersonalRank(
          data.rank,
        );
      }

      return true;
    } catch (error) {
      if (
        error?.name ===
        'AbortError'
      ) {
        return false;
      }

      console.error(
        'Game score saving failed:',
        error,
      );

      if (
        mountedRef.current &&
        pendingScoreRef.current?.sessionId ===
          submission.sessionId
      ) {
        setSaveStatus('error');
        setSaveError(
          error instanceof Error
            ? error.message
            : 'Failed to save game score',
        );

        setCanRetrySave(true);
      }

      return false;
    } finally {
      if (
        scoreAbortRef.current ===
        controller
      ) {
        scoreAbortRef.current =
          null;
      }

      scoreSavingRef.current = false;
    }
  }, [
    authHeaders,
    haptic,
    playSound,
    userId,
  ]);

  const retryScoreSave = useCallback(() => {
    const submission =
      pendingScoreRef.current;

    if (submission) {
      submitScore(submission);
    }
  }, [submitScore]);

  const finishGame = useCallback((
    finalScore,
    deathReason = 'unknown',
  ) => {
    const game = gameRef.current;

    if (
      !game ||
      game.state === STATE.OVER
    ) {
      return;
    }

    game.state = STATE.OVER;
    game.shake = 1.4;
    game.flash = 0;

    game.pointer.active = false;
    game.pointer.pointerId = null;
    game.pointer.targetX = null;
    game.player.vx = 0;

    pausedFromRef.current = null;

    if (game.metrics) {
      if (
        game.metrics.pauseStartedAt !==
          null
      ) {
        game.metrics.pausedDurationMs +=
          Math.max(
            0,
            Date.now() -
            game.metrics.pauseStartedAt,
          );

        game.metrics.pauseStartedAt =
          null;
      }

      game.metrics.maximumScore =
        Math.max(
          game.metrics.maximumScore,
          finalScore,
        );

      game.metrics.deathReason =
        deathReason;
    }

    setScreen(STATE.OVER);
    setScore(finalScore);

    const localRecord =
      finalScore > personalBestRef.current &&
      finalScore > 0;

    setIsNewRecord(localRecord);
    haptic('error');
    playSound('death');

    const sessionMetadata =
      gameSessionRef.current;

    gameSessionRef.current = null;

    if (!pairId) {
      pendingScoreRef.current = null;
      setSaveStatus('idle');
      setSaveError('');
      setCanRetrySave(false);
      return;
    }

    if (
      !sessionMetadata?.sessionId
    ) {
      console.error(
        'Score was not saved: game session metadata is missing'
      );

      setSaveStatus('error');
      setSaveError(
        'Game session is missing',
      );
      setCanRetrySave(false);

      return;
    }

    const metrics =
      makeScoreMetrics(
        game,
      );

    if (!metrics) {
      console.error(
        'Score was not saved: game metrics are missing'
      );

      setSaveStatus('error');
      setSaveError(
        'Game metrics are missing',
      );
      setCanRetrySave(false);

      return;
    }

    const submission = {
      pairCode:
        pairId,

      sessionId:
        sessionMetadata.sessionId,

      score:
        finalScore,

      rulesVersion:
        sessionMetadata.rulesVersion,

      metrics,
    };

    pendingScoreRef.current = submission;
    setCanRetrySave(false);
    submitScore(submission);
  }, [
    haptic,
    pairId,
    playSound,
    submitScore,
  ]);

  useEffect(() => {
    if (!petName) {
      petImageRef.current = null;
      return undefined;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = `/pets/${petName}_game.png`;

    petImageRef.current = image;

    return () => {
      petImageRef.current = null;
    };
  }, [petName]);

  useEffect(() => {
    if (!pairId) return undefined;

    let cancelled = false;

    personalScoreAbortRef.current?.abort();

    const controller =
      new AbortController();

    personalScoreAbortRef.current =
      controller;

    fetch(`/api/game-score/${pairId}`, {
      headers: authHeaders(),
      signal:
        controller.signal,
    })
      .then(async response => {
        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Failed to load game score',
          );
        }

        return data;
      })
      .then(data => {
        if (
          !cancelled &&
          typeof data.personalBest === 'number'
        ) {
          setPersonalBest(
            data.personalBest,
          );
        }

        if (
          !cancelled &&
          typeof data.rank === 'number'
        ) {
          setPersonalRank(
            data.rank,
          );
        }
      })
      .catch(error => {
        if (
          error?.name ===
          'AbortError'
        ) {
          return;
        }

        if (
          !cancelled &&
          mountedRef.current
        ) {
          console.error(
            'Game score loading failed:',
            error,
          );
        }
      })
      .finally(() => {
        if (
          personalScoreAbortRef.current ===
          controller
        ) {
          personalScoreAbortRef.current =
            null;
        }
      });

    return () => {
      cancelled = true;
      controller.abort();

      if (
        personalScoreAbortRef.current ===
        controller
      ) {
        personalScoreAbortRef.current =
          null;
      }
    };
  }, [authHeaders, pairId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d', {
      alpha: false,
    });

    if (!ctx) return undefined;

    let frameId = 0;
    let destroyed = false;
    let dpr = 1;

    let canvasPixelWidth = 0;
    let canvasPixelHeight = 0;
    let resizeFrame = 0;

    const drawCurrentFrame = () => {
      const game = gameRef.current;

      if (!game) return;

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0,
      );

      drawGame(
        ctx,
        game,
        petImageRef.current,
        dark,
      );
    };

    const resize = () => {
      const container =
        canvas.parentElement;

      const rect =
        container?.getBoundingClientRect();

      const width = Math.max(
        280,
        Math.round(
          rect?.width ||
          window.innerWidth,
        ),
      );

      const height = Math.max(
        480,
        Math.round(
          rect?.height ||
          window.visualViewport?.height ||
          window.innerHeight,
        ),
      );

      const nextDpr = clamp(
        window.devicePixelRatio || 1,
        1,
        2,
      );

      const nextPixelWidth =
        Math.round(width * nextDpr);

      const nextPixelHeight =
        Math.round(height * nextDpr);

      /*
       * Telegram WebView может отправлять повторные resize-события
       * без фактического изменения размеров.
       *
       * Повторно назначать canvas.width/canvas.height нельзя:
       * это полностью очищает canvas и создаёт видимое мерцание.
       */
      if (
        nextPixelWidth === canvasPixelWidth &&
        nextPixelHeight === canvasPixelHeight
      ) {
        return;
      }

      dpr = nextDpr;
      canvasPixelWidth = nextPixelWidth;
      canvasPixelHeight = nextPixelHeight;

      canvas.width = canvasPixelWidth;
      canvas.height = canvasPixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const game = gameRef.current;

      if (!game) {
        gameRef.current = makeGame(width, height);
        drawCurrentFrame();
        return;
      }

      const oldWidth = game.width;
      const oldHeight = game.height;

      const scaleX =
        oldWidth > 0 ? width / oldWidth : 1;

      const offsetY =
        height - oldHeight;

      game.width = width;
      game.height = height;

      if (game.metrics) {
        game.metrics.screenWidth =
          Math.max(
            1,
            Math.round(width),
          );

        game.metrics.screenHeight =
          Math.max(
            1,
            Math.round(height),
          );
      }

      game.player.x *= scaleX;
      game.player.y += offsetY;
      game.player.previousY += offsetY;

      for (const platform of game.platforms) {
        platform.x *= scaleX;
        platform.baseX *= scaleX;
        platform.y += offsetY;

        platform.width = clamp(
          platform.width * scaleX,
          64,
          126,
        );
      }

      for (const rocket of game.rockets) {
        rocket.x *= scaleX;
        rocket.y += offsetY;
      }

      for (const particle of game.particles) {
        particle.x *= scaleX;
        particle.y += offsetY;
      }

      game.player.x = clamp(
        game.player.x,
        -game.player.radius,
        width + game.player.radius,
      );

      ensurePlatforms(game);

      /*
       * Canvas очищается при изменении размеров.
       * Поэтому сразу рисуем новый кадр, не ожидая следующего RAF.
       */
      drawCurrentFrame();
    };

    const requestResize = () => {
      cancelAnimationFrame(resizeFrame);

      resizeFrame = requestAnimationFrame(() => {
        resize();
      });
    };

    const visibilityChange = () => {
      if (
        document.visibilityState === 'hidden'
      ) {
        pauseForInterruption();
      }
    };

    const update = (game, dt) => {
      const player = game.player;

      if (game.metrics) {
        game.metrics.activeDurationMs +=
          dt * 1000;
      }

      game.time += dt;

      game.shake = Math.max(
        0,
        game.shake - dt * 20,
      );

      game.flash = Math.max(
        0,
        game.flash - dt * 3.5,
      );

      player.previousY = player.y;

      player.squash = Math.max(
        0,
        player.squash - dt * 4.8,
      );

      const movementDirection = clamp(
        player.vx / PHYSICS.maxSpeed,
        -1,
        1,
      );

      const jumpAmount = clamp(
        Math.abs(player.vy) / Math.abs(PHYSICS.jump),
        0,
        1,
      );

      const targetRotation =
        movementDirection *
        (0.08 + jumpAmount * 0.16);

      const rotationSmoothing =
        1 - Math.exp(-9 * dt);

      player.rotation +=
        (targetRotation - player.rotation) *
        rotationSmoothing;

      /*
       * Продолжительный полёт на ракете.
       */
      if (player.boost > 0) {
        player.boost = Math.max(
          0,
          player.boost - dt,
        );

        const rocketAcceleration = 9;

        const smoothing = Math.min(
          1,
          rocketAcceleration * dt,
        );

        player.vy +=
          (PHYSICS.rocketSpeed - player.vy) *
          smoothing;

        /*
         * Огненный след ракеты.
         */
        if (Math.random() < 0.5) {
          addParticles(
            game,
            player.x + random(-7, 7),
            player.y + player.radius * 0.65,
            Math.random() < 0.5
              ? '#FFB13B'
              : '#FFF073',
            1,
            {
              minVx: -35,
              maxVx: 35,
              minVy: 80,
              maxVy: 180,
              gravity: 180,
            },
          );
        }
      }

      /*
       * Горизонтальное управление: питомец следует за пальцем.
       *
       * Желаемая скорость пропорциональна расстоянию до целевой
       * позиции пальца (targetX), но не больше maxSpeed. Чем ближе
       * питомец к пальцу, тем медленнее он едет — поэтому он мягко
       * и точно останавливается у нужной платформы.
       *
       * Затем текущая скорость плавно подтягивается к желаемой
       * через ускорение, что убирает рывки.
       */
      if (
        game.pointer.active &&
        game.pointer.targetX !== null
      ) {
        const distanceToTarget =
          game.pointer.targetX - player.x;

        /*
         * followStrength переводит расстояние в желаемую
         * скорость. Больше значение — резче питомец догоняет
         * палец. Ограничиваем скорость PHYSICS.maxSpeed.
         */
        const followStrength = 9;

        const desiredVelocity = clamp(
          distanceToTarget * followStrength,
          -PHYSICS.maxSpeed,
          PHYSICS.maxSpeed,
        );

        const difference =
          desiredVelocity - player.vx;

        const maximumChange =
          PHYSICS.acceleration * dt;

        player.vx += clamp(
          difference,
          -maximumChange,
          maximumChange,
        );

        /*
         * У самой цели гасим микро-дрожание.
         */
        if (
          Math.abs(distanceToTarget) < 1 &&
          Math.abs(player.vx) < 6
        ) {
          player.vx = 0;
        }
      } else {
        /*
         * После отпускания пальца питомец
         * быстро и плавно останавливается.
         */
        player.vx *= Math.pow(
          PHYSICS.friction,
          dt * 60,
        );

        if (Math.abs(player.vx) < 2) {
          player.vx = 0;
        }
      }

      /*
       * Во время ракеты обычная гравитация отключена.
       */
      if (player.boost <= 0) {
        player.vy +=
          PHYSICS.gravity * dt;
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      /*
       * Горизонтальное зацикливание экрана.
       */
      if (player.x < -player.radius) {
        player.x =
          game.width + player.radius;
      }

      if (
        player.x >
        game.width + player.radius
      ) {
        player.x = -player.radius;
      }

      /*
       * Обновление платформ.
       */
      for (const platform of game.platforms) {
        if (
          platform.type === TYPE.MOVING &&
          !platform.broken
        ) {
          platform.x = clamp(
            platform.baseX +
              Math.sin(
                game.time *
                  platform.moveSpeed +
                  platform.phase,
              ) *
                platform.moveRange,
            12,
            game.width -
              platform.width -
              12,
          );
        }

        if (
          platform.type === TYPE.CLOUD &&
          platform.dissolved
        ) {
          platform.dissolveProgress =
            Math.min(
              1,
              platform.dissolveProgress +
                dt / 0.38,
            );
        }

        if (platform.broken) {
          platform.breakVelocity +=
            1300 * dt;

          platform.y +=
            platform.breakVelocity * dt;
        }
      }

      /*
       * Столкновения с платформами.
       *
       * Проверяем пересечение между предыдущей
       * и текущей позицией игрока.
       */
      if (player.vy >= 0) {
        const previousBottom =
          player.previousY +
          player.radius * 0.72;

        const currentBottom =
          player.y +
          player.radius * 0.72;

        let landedPlatform = null;
        let landedTop = Infinity;

        for (const platform of game.platforms) {
          if (
            platform.broken ||
            (
              platform.type ===
                TYPE.CLOUD &&
              platform.dissolved
            )
          ) {
            continue;
          }

          /*
           * У шипов опасная поверхность находится
           * на 15 пикселей выше основания платформы.
           */
          const platformTop =
            platform.type === TYPE.SPIKE
              ? platform.y - 15
              : platform.y;

          const crossedPlatform =
            previousBottom <= platformTop + 2 &&
            currentBottom >= platformTop;

          if (!crossedPlatform) {
            continue;
          }

          const platformCenter =
            platform.x +
            platform.width / 2;

          const horizontalDistance =
            Math.abs(
              wrappedDistance(
                player.x,
                platformCenter,
                game.width,
              ),
            );

          const allowedDistance =
            platform.width / 2 +
            player.radius * 0.62;

          if (
            horizontalDistance <= allowedDistance &&
            platformTop < landedTop
          ) {
            landedPlatform = platform;
            landedTop = platformTop;
          }
        }

        if (landedPlatform) {
          /*
           * Попадание на шипы.
           */
          if (
            landedPlatform.type === TYPE.SPIKE
          ) {
            addParticles(
              game,
              player.x,
              player.y,
              '#E5485F',
              18,
              {
                minVx: -170,
                maxVx: 170,
                minVy: -220,
                maxVy: -50,
                gravity: 550,
              },
            );

            finishGame(
              game.score,
              'spike',
            );

            return;
          }

          /*
           * Обычное приземление.
           */
          player.y =
            landedPlatform.y -
            player.radius * 0.72 -
            0.5;

          player.vy =
            landedPlatform.type === TYPE.SPRING
              ? PHYSICS.spring
              : PHYSICS.jump;

          player.squash =
            landedPlatform.type === TYPE.SPRING
              ? 1
              : 0.72;

          if (game.metrics) {
            game.metrics.landingCount +=
              1;

            if (
              landedPlatform.type ===
              TYPE.CLOUD
            ) {
              game.metrics.cloudLandings +=
                1;
            } else if (
              landedPlatform.type ===
              TYPE.MOVING
            ) {
              game.metrics.movingLandings +=
                1;
            } else if (
              landedPlatform.type ===
              TYPE.SPRING
            ) {
              game.metrics.springLandings +=
                1;
            } else {
              game.metrics.normalLandings +=
                1;
            }
          }

          if (
            player.lastPlatformId !==
            landedPlatform.id
          ) {
            player.lastPlatformId =
              landedPlatform.id;

            addParticles(
              game,
              player.x,
              landedPlatform.y,
              landedPlatform.type === TYPE.SPRING
                ? '#72E6A5'
                : '#FFFFFF',
              landedPlatform.type === TYPE.SPRING
                ? 14
                : 7,
            );

            haptic(
              landedPlatform.type === TYPE.SPRING
                ? 'medium'
                : 'light',
            );

            if (
              landedPlatform.type ===
              TYPE.SPRING
            ) {
              playSound('spring');
            } else if (
              landedPlatform.type ===
              TYPE.CLOUD
            ) {
              playSound('cloud');
            } else {
              playSound('landing');
            }
          }

          /*
           * После первого приземления облако
           * сразу теряет коллизию и растворяется.
           */
          if (
            landedPlatform.type === TYPE.CLOUD
          ) {
            landedPlatform.dissolved = true;
            landedPlatform.dissolveProgress =
              Math.max(
                landedPlatform.dissolveProgress,
                0.01,
              );

            addParticles(
              game,
              landedPlatform.x +
                landedPlatform.width / 2,
              landedPlatform.y,
              dark
                ? '#D9D0E8'
                : '#FFFFFF',
              13,
              {
                minVx: -90,
                maxVx: 90,
                minVy: -90,
                maxVy: -20,
                gravity: 120,
              },
            );
          }
        }
      }

      /*
       * Столкновения с ракетами.
       */
      for (const rocket of game.rockets) {
        if (rocket.collected) {
          continue;
        }

        const dx = wrappedDistance(
          player.x,
          rocket.x,
          game.width,
        );

        const dy =
          player.y - rocket.y;

        const collisionRadius = 43;

        if (
          dx * dx + dy * dy <
          collisionRadius * collisionRadius
        ) {
          rocket.collected = true;

          game.lastCollectedRocketDistance =
            game.distance;

          if (game.metrics) {
            game.metrics.rocketsCollected +=
              1;
          }

          player.vy =
            PHYSICS.rocketSpeed;

          player.boost =
            PHYSICS.rocketDuration;

          player.squash = 0.15;

          /*
           * Очень лёгкая подсветка при взятии ракеты.
           */
          game.flash = Math.max(
            game.flash,
            0.06,
          );

          addParticles(
            game,
            rocket.x,
            rocket.y,
            '#FFAA3D',
            18,
            {
              minVx: -180,
              maxVx: 180,
              minVy: -180,
              maxVy: 100,
              gravity: 300,
            },
          );

          haptic('success');
          playSound('rocket');
        }
      }

      /*
       * Камера начинает двигаться, когда питомец
       * поднимается выше 38% экрана.
       */
      const cameraLine =
        game.height * 0.38;

      if (player.y < cameraLine) {
        const shift =
          cameraLine - player.y;

        player.y = cameraLine;
        player.previousY += shift;

        game.distance += shift;

        for (const platform of game.platforms) {
          platform.y += shift;
        }

        for (const rocket of game.rockets) {
          rocket.y += shift;
        }

        for (const particle of game.particles) {
          particle.y += shift;
        }

        const nextScore =
          Math.floor(game.distance / 10);

        if (nextScore !== game.score) {
          game.score = nextScore;

          if (
            renderedScoreRef.current !==
            nextScore
          ) {
            renderedScoreRef.current =
              nextScore;

            setScore(nextScore);
          }

          if (game.metrics) {
            game.metrics.maximumScore =
              Math.max(
                game.metrics.maximumScore,
                nextScore,
              );

            while (
              game.metrics.nextCheckpointIndex <
                GAME_CHECKPOINT_SCORES.length &&
              GAME_CHECKPOINT_SCORES[
                game.metrics.nextCheckpointIndex
              ] <= nextScore
            ) {
              const checkpointScore =
                GAME_CHECKPOINT_SCORES[
                  game.metrics.nextCheckpointIndex
                ];

              game.metrics.checkpoints.push({
                score:
                  checkpointScore,

                activeDurationMs:
                  Math.max(
                    0,
                    Math.round(
                      game.metrics.activeDurationMs,
                    ),
                  ),

                landingCount:
                  game.metrics.landingCount,

                rocketsCollected:
                  game.metrics.rocketsCollected,
              });

              game.metrics.nextCheckpointIndex +=
                1;
            }
          }

          /*
           * Лёгкая вибрация каждые 25 очков.
           * Полноэкранной вспышки здесь нет.
           */
          if (
            nextScore > 0 &&
            nextScore % 25 === 0
          ) {
            haptic('light');
          }
        }
      }

      /*
       * Удаляем объекты, которые ушли далеко вниз.
       */
      game.platforms =
        game.platforms.filter(
          platform =>
            platform.y <
              game.height + 170 &&
            !(
              platform.type ===
                TYPE.CLOUD &&
              platform.dissolveProgress >=
                1
            ),
        );

      for (const rocket of game.rockets) {
        if (
          !rocket.collected &&
          rocket.y >=
            game.height + 120
        ) {
          if (game.metrics) {
            game.metrics.rocketsMissed +=
              1;
          }
        }
      }

      game.rockets =
        game.rockets.filter(
          rocket =>
            !rocket.collected &&
            rocket.y <
              game.height + 120,
        );

      updateParticles(
        game,
        dt,
      );

      /*
       * Генерируем новые платформы сверху.
       */
      ensurePlatforms(game);

      /*
       * Игрок упал ниже экрана.
       */
      if (
        player.y - player.radius >
        game.height + 90
      ) {
        finishGame(
          game.score,
          'fall',
        );
      }
    };

    const loop = timestamp => {
      if (destroyed) {
        return;
      }

      const game = gameRef.current;

      if (!game) {
        frameId =
          requestAnimationFrame(loop);
        return;
      }

      if (!game.previousTime) {
        game.previousTime = timestamp;
      }

      const rawFrameTime =
        Math.max(
          0,
          (
            timestamp -
            game.previousTime
          ) / 1000,
        );

      const frameTime =
        Math.min(
          0.05,
          rawFrameTime,
        );

      game.previousTime = timestamp;

      /*
       * Игровая физика работает фиксированными шагами.
       */
      if (game.state === STATE.RUNNING) {
        if (game.metrics) {
          const frameGapMs =
            Math.max(
              0,
              Math.round(
                rawFrameTime * 1000,
              ),
            );

          game.metrics.frameCount +=
            1;

          game.metrics.maxFrameGapMs =
            Math.max(
              game.metrics.maxFrameGapMs,
              frameGapMs,
            );

          if (rawFrameTime > 0) {
            const currentFps =
              Math.min(
                240,
                1 / rawFrameTime,
              );

            game.metrics.fpsTotal +=
              currentFps;

            game.metrics.fpsSampleCount +=
              1;

            if (
              game.metrics.minimumFps ===
                0 ||
              currentFps <
                game.metrics.minimumFps
            ) {
              game.metrics.minimumFps =
                currentFps;
            }
          }
        }

        game.accumulator += frameTime;

        let safety = 0;

        while (
          game.accumulator >= PHYSICS.step &&
          safety < 8
        ) {
          update(
            game,
            PHYSICS.step,
          );

          game.accumulator -=
            PHYSICS.step;

          safety += 1;

          /*
           * Если update завершил игру,
           * прекращаем физику в этом кадре.
           */
          if (
            game.state !== STATE.RUNNING
          ) {
            game.accumulator = 0;
            break;
          }
        }
      } else {
        game.accumulator = 0;
        game.time += frameTime;

        /*
         * Время паузы считается по Date.now()
         * между pauseForInterruption и resumeGame.
         * Это учитывает background, где RAF
         * может полностью остановиться.
         */

        /*
         * Эффекты затухают даже после смерти.
         */
        game.shake = Math.max(
          0,
          game.shake - frameTime * 20,
        );

        game.flash = Math.max(
          0,
          game.flash - frameTime * 4,
        );

        updateParticles(
          game,
          frameTime,
        );
      }

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0,
      );

      drawGame(
        ctx,
        game,
        petImageRef.current,
        dark,
      );

      frameId =
        requestAnimationFrame(loop);
    };

    resize();

    window.addEventListener(
      'resize',
      requestResize,
    );

    window.addEventListener(
      'orientationchange',
      requestResize,
    );

    window.visualViewport?.addEventListener(
      'resize',
      requestResize,
    );

    const tg = window.Telegram?.WebApp;

    tg?.onEvent?.(
      'viewportChanged',
      requestResize,
    );

    tg?.onEvent?.(
      'fullscreenChanged',
      requestResize,
    );

    tg?.onEvent?.(
      'safeAreaChanged',
      requestResize,
    );

    tg?.onEvent?.(
      'contentSafeAreaChanged',
      requestResize,
    );

    document.addEventListener(
      'visibilitychange',
      visibilityChange,
    );

    frameId =
      requestAnimationFrame(loop);

    return () => {
      destroyed = true;

      cancelAnimationFrame(frameId);
      cancelAnimationFrame(resizeFrame);

      window.removeEventListener(
        'resize',
        requestResize,
      );

      window.removeEventListener(
        'orientationchange',
        requestResize,
      );

      window.visualViewport?.removeEventListener(
        'resize',
        requestResize,
      );

      tg?.offEvent?.(
        'viewportChanged',
        requestResize,
      );

      tg?.offEvent?.(
        'fullscreenChanged',
        requestResize,
      );

      tg?.offEvent?.(
        'safeAreaChanged',
        requestResize,
      );

      tg?.offEvent?.(
        'contentSafeAreaChanged',
        requestResize,
      );

      document.removeEventListener(
        'visibilitychange',
        visibilityChange,
      );
    };
  }, [
    dark,
    finishGame,
    haptic,
    pauseForInterruption,
    playSound,
  ]);

  useEffect(() => {
    if (screen !== STATE.COUNTDOWN) {
      return undefined;
    }

    if (countdown > 1) {
      const timer = setTimeout(() => {
        setCountdown(value => value - 1);
        haptic('light');
      }, 650);

      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      const game = gameRef.current;

      if (game) {
        game.state = STATE.RUNNING;
        game.accumulator = 0;
        game.previousTime = performance.now();
      }

      setScreen(STATE.RUNNING);
      haptic('medium');
    }, 650);

    return () => clearTimeout(timer);
  }, [countdown, haptic, screen]);

  useEffect(() => {
    const backButton =
      window.Telegram?.WebApp?.BackButton;

    if (!backButton) return undefined;

    const goBack = () => {
      navigateBack();
    };

    try {
      backButton.show();
      backButton.onClick(goBack);
    } catch {
      // Старые версии Telegram.
    }

    return () => {
      try {
        backButton.offClick(goBack);
        backButton.hide();
      } catch {
        // Старые версии Telegram.
      }
    };
  }, [navigateBack]);

  const startGame = useCallback(async () => {
    if (
      startLockRef.current ||
      gameStarting
    ) {
      return;
    }

    if (
      scoreSavingRef.current ||
      pendingScoreRef.current
    ) {
      window.Telegram?.WebApp?.showAlert?.(
        t.waitForSaving,
      );

      return;
    }

    startLockRef.current = true;
    setGameStarting(true);

    resumeAudio();

    try {
      gameSessionRef.current = null;

      const sessionMetadata =
        await createGameSession();

      const canvas = canvasRef.current;
      const currentGame = gameRef.current;

      const containerRect =
        canvas?.parentElement
          ?.getBoundingClientRect();

      const width = Math.max(
        280,
        Math.round(
          containerRect?.width ||
          currentGame?.width ||
          window.innerWidth,
        ),
      );

      const height = Math.max(
        480,
        Math.round(
          containerRect?.height ||
          currentGame?.height ||
          window.visualViewport?.height ||
          window.innerHeight,
        ),
      );

      const nextGame = makeGame(
        width,
        height,
        sessionMetadata.seed,
        lang,
      );

      nextGame.rulesVersion =
        sessionMetadata.rulesVersion;

      nextGame.clientVersion =
        sessionMetadata.clientVersion;

      nextGame.state = STATE.COUNTDOWN;
      nextGame.accumulator = 0;
      nextGame.previousTime = 0;

      gameRef.current = nextGame;

      pausedFromRef.current = null;
      pendingScoreRef.current = null;
      renderedScoreRef.current = 0;

      setSaveStatus('idle');
      setSaveError('');
      setCanRetrySave(false);
      setScore(0);
      setIsNewRecord(false);
      setCountdown(3);
      setScreen(STATE.COUNTDOWN);

      haptic('light');
    } catch (error) {
      if (
        error?.name !==
        'AbortError'
      ) {
        console.error(
          'Unable to start game:',
          error,
        );
      }

      gameSessionRef.current = null;

      if (
        mountedRef.current &&
        error?.name !==
          'AbortError'
      ) {
        window.Telegram?.WebApp?.showAlert?.(
          lang === 'ru'
            ? 'Не удалось начать игру. Попробуй ещё раз.'
            : 'Failed to start the game. Please try again.',
        );
      }
    } finally {
      startLockRef.current = false;

      if (mountedRef.current) {
        setGameStarting(false);
      }
    }
  }, [
    createGameSession,
    gameStarting,
    haptic,
    lang,
    resumeAudio,
    t.waitForSaving,
  ]);

  const pauseGame = () => {
    const game = gameRef.current;

    if (!game || game.state !== STATE.RUNNING) {
      return;
    }

    pausedFromRef.current = STATE.RUNNING;
    pauseForInterruption();
    haptic('light');
  };

  const resumeGame = () => {
    const game = gameRef.current;

    if (!game || game.state !== STATE.PAUSED) {
      return;
    }

    const pausedFrom =
      pausedFromRef.current;

    pausedFromRef.current = null;
    game.accumulator = 0;
    game.previousTime = performance.now();

    if (
      game.metrics &&
      game.metrics.pauseStartedAt !==
        null
    ) {
      game.metrics.pausedDurationMs +=
        Math.max(
          0,
          Date.now() -
          game.metrics.pauseStartedAt,
        );

      game.metrics.pauseStartedAt =
        null;
    }

    resumeAudio();

    if (pausedFrom === STATE.COUNTDOWN) {
      game.state = STATE.COUNTDOWN;

      setCountdown(3);
      setScreen(STATE.COUNTDOWN);
    } else {
      game.state = STATE.RUNNING;
      setScreen(STATE.RUNNING);
    }

    haptic('light');
  };

  /*
   * Управление начинается при касании canvas.
   *
   * Точка касания задаёт целевую позицию питомца,
   * к которой он плавно тянется. Ведя палец,
   * пользователь перемещает эту цель без отпускания.
   */
  const pointerDown = event => {
    const game = gameRef.current;
    const canvas = canvasRef.current;

    if (
      !game ||
      !canvas ||
      game.state !== STATE.RUNNING
    ) {
      return;
    }

    /*
     * Обрабатываем только основное касание.
     * Второй палец не должен менять направление.
     */
    if (
      event.isPrimary === false ||
      game.pointer.active
    ) {
      return;
    }

    event.preventDefault();

    const rect =
      canvas.getBoundingClientRect();

    /*
     * Переводим координату касания из пикселей экрана
     * в координаты игры (0..game.width).
     */
    const scaleX =
      rect.width > 0
        ? game.width / rect.width
        : 1;

    const localX =
      (event.clientX - rect.left) * scaleX;

    game.pointer.active = true;
    game.pointer.pointerId =
      event.pointerId;

    /*
     * Относительный режим: цель не прыгает в точку касания,
     * а начинает двигаться от текущей позиции питомца.
     * Запоминаем, где стоял питомец и где коснулся палец.
     */
    game.pointer.anchorPetX = game.player.x;
    game.pointer.anchorPointerX = localX;
    game.pointer.targetX = game.player.x;

    try {
      canvas.setPointerCapture(
        event.pointerId,
      );
    } catch {
      /*
       * Старые Telegram WebView могут
       * не поддерживать Pointer Capture.
       */
    }
  };

  /*
   * Пока палец удерживается, целевая позиция питомца
   * следует за его текущим положением.
   *
   * Палец можно непрерывно вести по всей ширине canvas,
   * не отпуская его — питомец плавно тянется за ним.
   */
  const pointerMove = event => {
    const game = gameRef.current;
    const canvas = canvasRef.current;

    if (
      !game?.pointer.active ||
      !canvas ||
      game.pointer.pointerId !==
        event.pointerId
    ) {
      return;
    }

    event.preventDefault();

    const rect =
      canvas.getBoundingClientRect();

    /*
     * Целевая позиция питомца всегда равна текущей
     * позиции пальца (в координатах игры). Питомец
     * плавно тянется к ней в игровом цикле.
     */
    const scaleX =
      rect.width > 0
        ? game.width / rect.width
        : 1;

    const localX =
      (event.clientX - rect.left) * scaleX;

    /*
     * Относительное управление с усилением: сдвиг пальца
     * от точки касания умножается на чувствительность.
     * Небольшое движение пальца перемещает питомца дальше,
     * поэтому не нужно водить пальцем по всему экрану.
     */
    const pointerDelta =
      localX - game.pointer.anchorPointerX;

    game.pointer.targetX = clamp(
      game.pointer.anchorPetX +
        pointerDelta * PHYSICS.controlSensitivity,
      0,
      game.width,
    );
  };

  const pointerUp = event => {
    const game = gameRef.current;
    const canvas = canvasRef.current;

    if (!game) {
      return;
    }

    /*
     * Не завершаем управление, если событие
     * пришло от другого пальца.
     */
    if (
      game.pointer.pointerId !== null &&
      game.pointer.pointerId !==
        event.pointerId
    ) {
      return;
    }

    game.pointer.active = false;
    game.pointer.pointerId = null;
    game.pointer.targetX = null;

    try {
      if (
        canvas?.hasPointerCapture?.(
          event.pointerId,
        )
      ) {
        canvas.releasePointerCapture(
          event.pointerId,
        );
      }
    } catch {
      /*
       * Pointer Capture уже мог быть
       * автоматически освобождён браузером.
       */
    }
  };

  return (
    <div className={`jump-game ${dark ? 'jump-game-dark' : ''}`}>
      <canvas
        ref={canvasRef}
        className="jump-game-canvas"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onLostPointerCapture={pointerUp}
      />

      <header className="jump-game-hud">
        <button
          className="jump-game-circle-button"
          onClick={navigateBack}
          aria-label={t.back}
        >
          ←
        </button>

        <div className="jump-game-score-card">
          <span>{t.score}</span>
          <strong>{score}</strong>
        </div>

        <div className="jump-game-best-card">
          <span>🏆</span>
          <strong>{personalBest}</strong>
        </div>

        <button
          className="jump-game-circle-button"
          onClick={toggleMuted}
          aria-label={
            muted
              ? (
                  lang === 'ru'
                    ? 'Включить звук'
                    : 'Enable sound'
                )
              : (
                  lang === 'ru'
                    ? 'Выключить звук'
                    : 'Mute sound'
                )
          }
          aria-pressed={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        {screen === STATE.RUNNING ? (
          <button
            className="jump-game-circle-button"
            onClick={pauseGame}
            aria-label={t.paused}
          >
            Ⅱ
          </button>
        ) : (
          <div className="jump-game-button-placeholder" />
        )}
      </header>

      {screen === STATE.INTRO && (
        <div className="jump-game-overlay">
          <div className="jump-game-panel">
            <div className="jump-game-logo">🐾</div>

            <h1>{t.title}</h1>
            <p className="jump-game-subtitle">
              {t.subtitle}
            </p>

            <div className="jump-game-instructions">
              <div>
                <span>👆</span>
                <p>{t.control}</p>
              </div>

              <div>
                <span>🟠</span>
                <p>{t.fragile}</p>
              </div>

              <div>
                <span>⚠️</span>
                <p>{t.spike}</p>
              </div>

              <div>
                <span>🚀</span>
                <p>{t.rocket}</p>
              </div>
            </div>

            <button
              className="jump-game-primary-button"
              onClick={startGame}
              disabled={gameStarting}
            >
              {gameStarting
                ? t.loading
                : t.play}
            </button>

            <button
              className="jump-game-secondary-button"
              onClick={openLeaderboard}
            >
              🏆 {t.leaderboard}
            </button>

            <button
              className="jump-game-secondary-button"
              onClick={navigateBack}
            >
              {t.back}
            </button>
          </div>
        </div>
      )}

      {screen === STATE.COUNTDOWN && (
        <div
          className="jump-game-countdown"
          key={countdown}
        >
          {countdown}
        </div>
      )}

      {screen === STATE.PAUSED && (
        <div className="jump-game-overlay">
          <div className="jump-game-panel jump-game-small-panel">
            <div className="jump-game-pause-icon">Ⅱ</div>
            <h2>{t.paused}</h2>

            <button
              className="jump-game-primary-button"
              onClick={resumeGame}
            >
              {t.resume}
            </button>

            <button
              className="jump-game-secondary-button"
              onClick={navigateBack}
            >
              {t.back}
            </button>
          </div>
        </div>
      )}

      {screen === STATE.OVER && (
        <div className="jump-game-overlay">
          <div className="jump-game-panel jump-game-result-panel">
            {isNewRecord && (
              <div className="jump-game-record-badge">
                🏆 {t.record}
              </div>
            )}

            <img
              src={gameOverPetImage}
              alt=""
              style={{
                display: 'block',
                width: 170,
                height: 170,
                maxWidth: '100%',
                margin: '-28px auto -4px',
                objectFit: 'contain',
              }}
            />

            <h2>{t.gameOver}</h2>

            <div className="jump-game-result-score">
              <span>{t.score}</span>
              <strong>{score}</strong>
            </div>

            <div className="jump-game-result-best">
              <span>{t.personalBest}</span>
              <strong>🏆 {personalBest}</strong>
            </div>

            {saveStatus === 'saving' && (
              <div className="jump-game-save-status">
                {t.savingScore}
              </div>
            )}

            {saveStatus === 'saved' && (
              <div className="jump-game-save-status">
                ✅ {t.scoreSaved}
              </div>
            )}

            {saveStatus === 'not-ranked' && (
              <div className="jump-game-save-status">
                ℹ️ {t.scoreNotRanked}
              </div>
            )}

            {saveStatus === 'error' && (
              <div className="jump-game-save-status jump-game-save-status-error">
                <span>
                  ⚠️ {t.scoreSaveError}
                </span>

                {saveError && (
                  <small>
                    {saveError}
                  </small>
                )}

                {canRetrySave && (
                  <button
                    className="jump-game-secondary-button"
                    onClick={retryScoreSave}
                  >
                    ↻ {t.retrySave}
                  </button>
                )}
              </div>
            )}

            <button
              className="jump-game-primary-button"
              onClick={startGame}
              disabled={
                gameStarting ||
                saveStatus === 'saving' ||
                saveStatus === 'error'
              }
            >
              {gameStarting
                ? t.loading
                : saveStatus === 'saving'
                  ? t.savingScore
                  : `↻ ${t.again}`}
            </button>

            <button
              className="jump-game-secondary-button"
              onClick={openLeaderboard}
            >
              🏆 {t.leaderboard}
            </button>

            <button
              className="jump-game-secondary-button"
              onClick={navigateBack}
            >
              {t.back}
            </button>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="jump-game-overlay jump-game-leaderboard-overlay">
          <div className="jump-game-panel jump-game-leaderboard-panel">
            <div className="jump-game-leaderboard-header">
              <div>
                <div className="jump-game-leaderboard-icon">
                  🏆
                </div>

                <h2>
                  {leaderboardTab ===
                    'players'
                    ? t.leaderboardTitle
                    : t.pairLeaderboardTitle}
                </h2>
              </div>

              <button
                className="jump-game-leaderboard-close"
                onClick={closeLeaderboard}
                aria-label={t.close}
              >
                ×
              </button>
            </div>

            {weekCountdownText && (
              <div className="jump-game-week-countdown">
                {weekCountdownText}
              </div>
            )}

            <div
              className="jump-game-leaderboard-tabs"
              role="tablist"
              aria-label={t.leaderboard}
            >
              <button
                type="button"
                role="tab"
                aria-selected={
                  leaderboardTab ===
                  'players'
                }
                className={
                  `jump-game-leaderboard-tab ${
                    leaderboardTab ===
                    'players'
                      ? 'jump-game-leaderboard-tab-active'
                      : ''
                  }`
                }
                onClick={() => {
                  changeLeaderboardTab(
                    'players',
                  );
                }}
              >
                {t.playersTab}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={
                  leaderboardTab ===
                  'pairs'
                }
                className={
                  `jump-game-leaderboard-tab ${
                    leaderboardTab ===
                    'pairs'
                      ? 'jump-game-leaderboard-tab-active'
                      : ''
                  }`
                }
                onClick={() => {
                  changeLeaderboardTab(
                    'pairs',
                  );
                }}
              >
                {t.pairsTab}
              </button>
            </div>

            {leaderboardTab ===
              'players' &&
              personalBest > 0 && (
              <div className="jump-game-personal-result">
                <div>
                  <span>
                    {t.personalBest}
                  </span>

                  <strong>
                    {personalBest}
                  </strong>
                </div>

                <div>
                  <span>
                    {t.yourPlace}
                  </span>

                  <strong>
                    {personalRank
                      ? `#${personalRank}`
                      : '—'}
                  </strong>
                </div>
              </div>
            )}

            {leaderboardLoading && (
              <div className="jump-game-leaderboard-message">
                <div className="jump-game-leaderboard-spinner" />

                <span>
                  {t.loading}
                </span>
              </div>
            )}

            {!leaderboardLoading &&
              leaderboardError && (
                <div className="jump-game-leaderboard-message jump-game-leaderboard-error">
                  <span>
                    {leaderboardError}
                  </span>

                  <button
                    className="jump-game-secondary-button"
                    onClick={() => {
                      loadLeaderboard(
                        leaderboardTab,
                      );
                    }}
                  >
                    ↻
                  </button>
                </div>
              )}

            {!leaderboardLoading &&
              !leaderboardError &&
              (
                leaderboardTab ===
                  'players'
                  ? leaders.length === 0
                  : pairLeaders.length === 0
              ) && (
                <div className="jump-game-leaderboard-message">
                  {t.emptyLeaderboard}
                </div>
              )}

            {!leaderboardLoading &&
              !leaderboardError &&
              leaderboardTab ===
                'players' &&
              leaders.length > 0 && (
                <div className="jump-game-leaderboard-list">
                  {leaders.map(leader => {
                    const medal =
                      leader.rank === 1
                        ? '🥇'
                        : leader.rank === 2
                          ? '🥈'
                          : leader.rank === 3
                            ? '🥉'
                            : null;

                    const name =
                      leader.displayName ||
                      t.player;

                    return (
                      <div
                        key={leader.userId}
                        className={
                          `jump-game-leaderboard-row ${
                            leader.isMe
                              ? 'jump-game-leaderboard-row-me'
                              : ''
                          }`
                        }
                      >
                        <div className="jump-game-leaderboard-rank">
                          {medal || `#${leader.rank}`}
                        </div>

                        <div className="jump-game-leaderboard-user">
                          <div className="jump-game-leaderboard-avatar">
                            <span aria-hidden="true">
                              {name
                                .trim()
                                .charAt(0)
                                .toUpperCase() || '👤'}
                            </span>

                            {leader.avatarUrl && (
                              <img
                                src={leader.avatarUrl}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onLoad={event => {
                                  event.currentTarget.hidden = false;
                                }}
                                onError={event => {
                                  event.currentTarget.hidden = true;
                                }}
                              />
                            )}
                          </div>

                          <div className="jump-game-leaderboard-user-text">
                            <strong>
                              {name}
                            </strong>
                          </div>
                        </div>

                        <div className="jump-game-leaderboard-score">
                          {leader.score}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            {!leaderboardLoading &&
              !leaderboardError &&
              leaderboardTab ===
                'pairs' &&
              pairLeaders.length > 0 && (
                <div className="jump-game-leaderboard-list">
                  {pairLeaders.map(
                    leader => {
                      const medal =
                        leader.rank === 1
                          ? '🥇'
                          : leader.rank === 2
                            ? '🥈'
                            : leader.rank === 3
                              ? '🥉'
                              : null;

                      const members =
                        Array.isArray(
                          leader.members,
                        )
                          ? leader.members
                          : [];

                      return (
                        <div
                          key={
                            leader.pairCode
                          }
                          className={
                            `jump-game-leaderboard-row jump-game-pair-row ${
                              leader.isMyPair
                                ? 'jump-game-leaderboard-row-me'
                                : ''
                            }`
                          }
                        >
                          <div className="jump-game-leaderboard-rank">
                            {medal ||
                              `#${leader.rank}`}
                          </div>

                          <div className="jump-game-pair-info">
                            <div className="jump-game-pair-avatars">
                              {members
                                .slice(0, 2)
                                .map(
                                  member => {
                                    const memberName =
                                      member.displayName ||
                                      t.player;

                                    return (
                                      <div
                                        key={
                                          member.userId
                                        }
                                        className="jump-game-leaderboard-avatar jump-game-pair-avatar"
                                        title={
                                          memberName
                                        }
                                      >
                                        <span aria-hidden="true">
                                          {memberName
                                            .trim()
                                            .charAt(0)
                                            .toUpperCase() ||
                                            '👤'}
                                        </span>

                                        {member.avatarUrl && (
                                          <img
                                            src={
                                              member.avatarUrl
                                            }
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                            referrerPolicy="no-referrer"
                                            onLoad={event => {
                                              event.currentTarget.hidden =
                                                false;
                                            }}
                                            onError={event => {
                                              event.currentTarget.hidden =
                                                true;
                                            }}
                                          />
                                        )}
                                      </div>
                                    );
                                  },
                                )}

                              {members.length < 2 && (
                                <div
                                  className="jump-game-leaderboard-avatar jump-game-pair-avatar jump-game-pair-avatar-empty"
                                  aria-hidden="true"
                                >
                                  <span>?</span>
                                </div>
                              )}
                            </div>

                            <div className="jump-game-pair-text">
                              <strong>
                                {members.length > 0
                                  ? members
                                      .slice(0, 2)
                                      .map(
                                        member =>
                                          member.displayName ||
                                          t.player,
                                      )
                                      .join(' + ')
                                  : (
                                      leader.pairName ||
                                      'Chumi'
                                    )}
                              </strong>

                              <span>
                                {members.length < 2
                                  ? t.waitingForPartner
                                  : (
                                      leader.pairName ||
                                      t.pairScore
                                    )}
                              </span>
                            </div>
                          </div>

                          <div
                            className="jump-game-leaderboard-score"
                            title={t.pairScore}
                          >
                            {leader.score}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}

            <button
              className="jump-game-secondary-button"
              onClick={closeLeaderboard}
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
