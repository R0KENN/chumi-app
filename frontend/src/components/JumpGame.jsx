import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getInitData } from '../context/PairsContext';
import { useLang } from '../context/LangContext';
import './JumpGame.css';

const ACCENT = '#9B72CF';

const STATE = {
  INTRO: 'intro',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  OVER: 'over',
};

const TYPE = {
  NORMAL: 'normal',
  FRAGILE: 'fragile',
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
    broken: false,
    breakVelocity: 0,
    moveRange: options.moveRange || 0,
    moveSpeed: options.moveSpeed || 0,
    phase: random(0, Math.PI * 2),
  };
}

function choosePlatformType(score) {
  const roll = Math.random();

  /*
   * Сложность растёт линейно от 0 до 200 очков.
   * После 200 очков параметры остаются на максимальном,
   * но всё ещё проходимом уровне.
   */
  const difficulty = clamp(score / 200, 0, 1);

  /*
   * Движущиеся платформы:
   *   28 очков  — начинают появляться;
   *   200 очков — вероятность достигает 25%.
   */
  const movingChance =
    0.08 + difficulty * 0.17;

  /*
   * Ломающиеся платформы:
   *   15 очков  — начинают появляться;
   *   200 очков — вероятность достигает 38%.
   *
   * В старом коде вероятность фактически оставалась
   * примерно одинаковой, потому что movingChance
   * прибавлялся одновременно к обеим границам.
   */
  const fragileChance =
    0.12 + difficulty * 0.26;

  /*
   * Пружины остаются редкими полезными платформами.
   */
  const springChance =
    0.05 + difficulty * 0.02;

  let chanceCursor = 0;

  if (score >= 28) {
    chanceCursor += movingChance;

    if (roll < chanceCursor) {
      return TYPE.MOVING;
    }
  }

  if (score >= 15) {
    chanceCursor += fragileChance;

    if (roll < chanceCursor) {
      return TYPE.FRAGILE;
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
  const score = Math.floor(game.distance / 10);
  const difficulty = clamp(score / 200, 0, 1);
  const previous = game.lastRoutePlatform;

  const width = random(
    94 - difficulty * 14,
    118 - difficulty * 17,
  );

  /*
   * Вертикальный разрыв всегда меньше реальной высоты прыжка.
   * Поэтому основной маршрут остаётся проходимым.
   */
  const verticalGap = random(
    72 + difficulty * 8,
    106 + difficulty * 15,
  );

  const horizontalLimit = Math.min(
    game.width * 0.42,
    125 + difficulty * 60,
  );

  const type = choosePlatformType(score);

  /*
   * Для движущейся платформы заранее учитываем
   * амплитуду движения. Иначе платформа,
   * созданная около края, частично уезжает
   * за границы экрана.
   */
  const moveRange =
    type === TYPE.MOVING
      ? random(16, 32)
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
      random(
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
    /*
     * Скорость движущихся платформ плавно увеличивается:
     *
     *   начало игры — 1.0–1.5;
     *   100 очков   — примерно 2.1–2.8;
     *   200 очков   — 3.2–4.1.
     *
     * Амплитуда движения остаётся ограниченной, поэтому
     * платформа не становится физически недостижимой.
     */
    moveSpeed:
      type === TYPE.MOVING
        ? random(
            1.0 + difficulty * 2.2,
            1.5 + difficulty * 2.6,
          )
        : 0,
  });

  game.platforms.push(platform);
  game.lastRoutePlatform = platform;

  /*
   * Шипы — только дополнительное препятствие.
   * Они не становятся частью обязательного маршрута.
   */
  if (score >= 30 && Math.random() < 0.13 + difficulty * 0.06) {
    const hazardWidth = random(65, 85);
    const placeRight = x < game.width / 2;

    let hazardX = placeRight
      ? x + width + random(45, 75)
      : x - hazardWidth - random(45, 75);

    hazardX = clamp(
      hazardX,
      12,
      game.width - hazardWidth - 12,
    );

    const overlaps =
      hazardX < x + width + 22 &&
      hazardX + hazardWidth > x - 22;

    if (!overlaps) {
      game.platforms.push(createPlatform(game, {
        x: hazardX,
        y: platform.y + random(-8, 10),
        width: hazardWidth,
        type: TYPE.SPIKE,
        mainRoute: false,
      }));
    }
  }

  /*
   * Ракета появляется только около безопасной платформы.
   */
  const distanceFromLastRocket =
    game.distance - game.lastRocketDistance;

  const distanceFromCollectedRocket =
    game.distance - game.lastCollectedRocketDistance;

  const hasActiveRocket = game.rockets.some(
    rocket => !rocket.collected,
  );

  const canSpawnRocket =
    distanceFromLastRocket >= 750 &&
    distanceFromCollectedRocket >= 450 &&
    game.player.boost <= 0 &&
    !hasActiveRocket;

  if (
    score >= 12 &&
    type !== TYPE.FRAGILE &&
    canSpawnRocket &&
    Math.random() < 0.07 - difficulty * 0.03
  ) {
    game.rockets.push({
      id: game.nextRocketId++,
      x: x + width / 2,
      y: platform.y - 36,
      phase: random(0, Math.PI * 2),
      collected: false,
    });

    game.lastRocketDistance = game.distance;
  }
}

function ensurePlatforms(game) {
  while (game.lastRoutePlatform.y > -220) {
    addPlatform(game);
  }
}

function makeGame(width, height) {
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
    state: STATE.INTRO,
    time: 0,
    accumulator: 0,
    previousTime: 0,

    distance: 0,
    score: 0,

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

  if (type === TYPE.FRAGILE) {
    gradient.addColorStop(0, '#FFD27A');
    gradient.addColorStop(1, '#E99A3F');
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

  if (type === TYPE.FRAGILE) {
    ctx.strokeStyle = 'rgba(100,55,15,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.35, y + 1);
    ctx.lineTo(x + width * 0.47, y + height * 0.6);
    ctx.lineTo(x + width * 0.58, y + 2);
    ctx.stroke();
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

  player.rotation +=
    (targetRotation - player.rotation) * 0.14;

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
  const renderedScoreRef = useRef(-1);
  const leaderboardAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      leaderboardAbortRef.current?.abort();
      leaderboardAbortRef.current = null;
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

  const [personalBest, setPersonalBest] =
    useState(0);

  const [personalRank, setPersonalRank] =
    useState(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (!tg) {
      return undefined;
    }

    const handleTelegramDeactivate = () => {
      window.dispatchEvent(
        new CustomEvent('chumi-game-deactivated'),
      );
    };

    const handleTelegramActivate = () => {
      window.dispatchEvent(
        new CustomEvent('chumi-game-activated'),
      );
    };

    try {
      tg.expand?.();
    } catch (error) {
      console.warn('Telegram expand failed:', error);
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
      tg.disableVerticalSwipes?.();
    } catch (error) {
      console.warn(
        'Telegram disableVerticalSwipes failed:',
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

      try {
        tg.enableVerticalSwipes?.();
      } catch (error) {
        console.warn(
          'Telegram enableVerticalSwipes failed:',
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
        tg.exitFullscreen?.();
      } catch (error) {
        console.warn(
          'Telegram exitFullscreen failed:',
          error,
        );
      }
    };
  }, []);

  const petName = searchParams.get('pet') || '';

  const userId = String(
    window.Telegram?.WebApp?.initDataUnsafe?.user?.id ||
    localStorage.getItem('chumi_test_uid') ||
    'guest',
  );

  const dark = (() => {
    try {
      return localStorage.getItem('chumi_theme') === 'night';
    } catch {
      return false;
    }
  })();

  const t = lang === 'ru'
    ? {
        title: 'Прыжок Chumi',
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
        personalBest: 'Личный рекорд',
        yourPlace: 'Твоё место',
        loading: 'Загрузка...',
        leaderboardError: 'Не удалось загрузить рейтинг',
        emptyLeaderboard: 'Пока никто не установил рекорд',
        close: 'Закрыть',
        player: 'Игрок',
      }
    : {
        title: 'Chumi Jump',
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
        personalBest: 'Personal best',
        yourPlace: 'Your place',
        loading: 'Loading...',
        leaderboardError: 'Failed to load leaderboard',
        emptyLeaderboard: 'No records yet',
        close: 'Close',
        player: 'Player',
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

      try {
        const response = await fetch(
          '/api/game-session',
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              userId,
              pairCode: pairId,
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

        gameSessionRef.current =
          data.sessionId;

        return data.sessionId;
      } finally {
        gameSessionLoadingRef.current = false;
      }
    },
    [
      authHeaders,
      pairId,
      userId,
    ]
  );

  const loadLeaderboard = useCallback(async () => {
    leaderboardAbortRef.current?.abort();

    const controller = new AbortController();

    leaderboardAbortRef.current = controller;

    setLeaderboardLoading(true);
    setLeaderboardError('');

    try {
      const response = await fetch(
        '/api/game-leaderboard',
        {
          headers: authHeaders(),
          signal: controller.signal,
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
        controller
      ) {
        return;
      }

      setLeaders(
        Array.isArray(data.leaders)
          ? data.leaders
          : [],
      );

      if (data.me) {
        setPersonalBest(
          Number(data.me.score) || 0,
        );

        setPersonalRank(
          Number(data.me.rank) || null,
        );
      } else {
        setPersonalBest(0);
        setPersonalRank(null);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      }

      console.error(
        'Leaderboard loading failed:',
        error,
      );

      if (
        leaderboardAbortRef.current ===
        controller
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
        leaderboardAbortRef.current = null;
        setLeaderboardLoading(false);
      }
    }
  }, [
    authHeaders,
    t.leaderboardError,
  ]);

  const openLeaderboard = useCallback(() => {
    setShowLeaderboard(true);
    loadLeaderboard();
  }, [loadLeaderboard]);

  const closeLeaderboard = useCallback(() => {
    leaderboardAbortRef.current?.abort();
    leaderboardAbortRef.current = null;

    setShowLeaderboard(false);
  }, []);

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

  const finishGame = useCallback((finalScore) => {
    const game = gameRef.current;

    if (
      !game ||
      game.state === STATE.OVER
    ) {
      return;
    }

    game.state = STATE.OVER;

    /*
     * Почти незаметное короткое колебание.
     * Если тряска вообще не нужна — поставь 0.
     */
    game.shake = 1.4;

    /*
     * После смерти не делаем полноэкранную вспышку.
     */
    game.flash = 0;

    /*
     * Отключаем управление, чтобы сохранённый pointer
     * не влиял на следующий запуск.
     */
      game.pointer.active = false;
      game.pointer.pointerId = null;
      game.pointer.targetX = null;
      game.player.vx = 0;

    setScreen(STATE.OVER);
    setScore(finalScore);

    /*
     * Локальная предварительная оценка нового личного рекорда
     * (до ответа сервера). Точный результат придёт из RPC
     * в поле isPersonalRecord ниже.
     */
    const localRecord =
      finalScore > personalBest &&
      finalScore > 0;

    setIsNewRecord(localRecord);

    haptic('error');

    if (!pairId || finalScore <= 0) return;

    const sessionId =
      gameSessionRef.current;

    gameSessionRef.current = null;

    if (!sessionId) {
      console.error(
        'Score was not saved: game session is missing'
      );

      return;
    }

    fetch('/api/game-score', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        userId,
        pairCode: pairId,
        sessionId,
        score: finalScore,
      }),
    })
      .then(async response => {
        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
            'Failed to save game score',
          );
        }

        return data;
      })
      .then(data => {
        if (
          typeof data.isPersonalRecord === 'boolean'
        ) {
          setIsNewRecord(
            data.isPersonalRecord,
          );

          if (data.isPersonalRecord) {
            haptic('success');
          }
        }

        if (
          typeof data.personalBest === 'number'
        ) {
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
      })
      .catch(error => {
        console.error(
          'Game score saving failed:',
          error,
        );
      });
  }, [
    authHeaders,
    haptic,
    pairId,
    userId,
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

    fetch(`/api/game-score/${pairId}`, {
      headers: authHeaders(),
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
        if (!cancelled) {
          console.error(
            'Game score loading failed:',
            error,
          );
        }
      });

    return () => {
      cancelled = true;
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
      const game = gameRef.current;

      if (
        document.visibilityState === 'hidden' &&
        game?.state === STATE.RUNNING
      ) {
        game.state = STATE.PAUSED;
        game.accumulator = 0;

        game.pointer.active = false;
        game.pointer.pointerId = null;
        game.pointer.targetX = null;
        game.player.vx = 0;

        setScreen(STATE.PAUSED);
      }
    };

    const update = (game, dt) => {
      const player = game.player;

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
          if (platform.broken) {
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

            finishGame(game.score);
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
          }

          /*
           * Ломкая платформа падает после приземления.
           */
          if (
            landedPlatform.type === TYPE.FRAGILE
          ) {
            landedPlatform.broken = true;
            landedPlatform.breakVelocity = 90;

            addParticles(
              game,
              landedPlatform.x +
                landedPlatform.width / 2,
              landedPlatform.y,
              '#F1A64B',
              13,
              {
                minVx: -150,
                maxVx: 150,
                minVy: -140,
                maxVy: -30,
                gravity: 600,
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
            game.height + 170,
        );

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
        finishGame(game.score);
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

      const frameTime = Math.min(
        0.05,
        Math.max(
          0,
          (timestamp - game.previousTime) / 1000,
        ),
      );

      game.previousTime = timestamp;

      /*
       * Игровая физика работает фиксированными шагами.
       */
      if (game.state === STATE.RUNNING) {
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
  }, [dark, finishGame, haptic]);

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
      navigate(`/pair/${pairId}`);
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
  }, [navigate, pairId]);

  const startGame = useCallback(async () => {
    if (gameStarting) {
      return;
    }

    setGameStarting(true);

    try {
      gameSessionRef.current = null;

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

      gameRef.current = makeGame(
        width,
        height,
      );

      renderedScoreRef.current = 0;

      setScore(0);
      setIsNewRecord(false);
      setCountdown(3);
      setScreen(STATE.COUNTDOWN);

      haptic('light');
    } catch (error) {
      console.error(
        'Unable to start game:',
        error,
      );

      window.Telegram?.WebApp?.showAlert?.(
        lang === 'ru'
          ? 'Не удалось начать игру. Попробуй ещё раз.'
          : 'Failed to start the game. Please try again.',
      );
    } finally {
      setGameStarting(false);
    }
  }, [
    createGameSession,
    gameStarting,
    haptic,
    lang,
  ]);

  const pauseGame = () => {
    const game = gameRef.current;

    if (!game || game.state !== STATE.RUNNING) {
      return;
    }

    game.state = STATE.PAUSED;
    game.accumulator = 0;

    /*
     * После паузы пользователь должен
     * заново приложить палец к экрану.
     */
    game.pointer.active = false;
    game.pointer.pointerId = null;
    game.pointer.targetX = null;
    game.player.vx = 0;

    setScreen(STATE.PAUSED);
    haptic('light');
  };

  const resumeGame = () => {
    const game = gameRef.current;

    if (!game || game.state !== STATE.PAUSED) {
      return;
    }

    game.state = STATE.RUNNING;
    game.accumulator = 0;
    game.previousTime = performance.now();

    setScreen(STATE.RUNNING);
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
          onClick={() => navigate(`/pair/${pairId}`)}
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
              onClick={() => navigate(`/pair/${pairId}`)}
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
              onClick={() => navigate(`/pair/${pairId}`)}
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

            <div className="jump-game-over-emoji">
              {isNewRecord ? '🎉' : '😿'}
            </div>

            <h2>{t.gameOver}</h2>

            <div className="jump-game-result-score">
              <span>{t.score}</span>
              <strong>{score}</strong>
            </div>

            <div className="jump-game-result-best">
              <span>{t.personalBest}</span>
              <strong>🏆 {personalBest}</strong>
            </div>

            <button
              className="jump-game-primary-button"
              onClick={startGame}
              disabled={gameStarting}
            >
              {gameStarting
                ? t.loading
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
              onClick={() => navigate(`/pair/${pairId}`)}
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
                  {t.leaderboardTitle}
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

            {personalBest > 0 && (
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
                    onClick={loadLeaderboard}
                  >
                    ↻
                  </button>
                </div>
              )}

            {!leaderboardLoading &&
              !leaderboardError &&
              leaders.length === 0 && (
                <div className="jump-game-leaderboard-message">
                  {t.emptyLeaderboard}
                </div>
              )}

            {!leaderboardLoading &&
              !leaderboardError &&
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
