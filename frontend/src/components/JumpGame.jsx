import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

const ACCENT = '#9B72CF';
const BG_TOP = '#F3EDF7';
const BG_BOT = '#D7C8E8';

// Типы платформ
const NORMAL = 'normal';
const FRAGILE = 'fragile'; // ломается после одного прыжка
const SPIKE = 'spike';     // иглы — мгновенная смерть

export default function JumpGame() {
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const { pairId } = useParams();
  const [searchParams] = useSearchParams();

  const petName = searchParams.get('pet') || '';
  const petImgSrc = petName ? `/pets/${petName}_frame.png` : null;

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [bestScore, setBestScore] = useState(
    () => Number(localStorage.getItem(`jump_best_${pairId}`) || 0)
  );

  const game = useRef(null);
  const petImg = useRef(null);

  const haptic = useCallback((type = 'light') => {
    try {
      const tg = window.Telegram?.WebApp?.HapticFeedback;
      if (type === 'success' || type === 'error') tg?.notificationOccurred(type);
      else tg?.impactOccurred(type);
    } catch {}
  }, []);

  const endGame = useCallback((finalScore) => {
    setGameOver(true);
    setScore(finalScore);
    setBestScore((prev) => {
      const best = Math.max(prev, finalScore);
      localStorage.setItem(`jump_best_${pairId}`, String(best));
      return best;
    });
    haptic('error');
  }, [pairId, haptic]);

  // Новая платформа выше предыдущей.
  // Гарантия проходимости: опасная платформа никогда не идёт сразу после опасной,
  // и каждая опасная ставится так, чтобы рядом по высоте была достижимая нормальная.
  const makePlatform = useCallback((W, prevY, scrolled, recent) => {
    const PLATFORM_W = 75;
    const gap = 95 + Math.random() * 50; // 95–145 px по вертикали
    const heightFloors = scrolled / 50;
    const y = prevY - gap;

    // Самая верхняя из существующих платформ — от неё прыгаем на новую
    const sorted = [...recent].sort((a, b) => a.y - b.y); // сверху вниз
    const last = sorted[0]; // ближайшая платформа НАД которой мы строим (самая высокая)

    // Максимальная горизонтальная дистанция, которую реально перекрыть за прыжок.
    // При JUMP=-12.8, GRAVITY=0.38 время полёта вверх+вниз велико, а vx≤9,
    // поэтому за прыжок безопасно достаём ~55% ширины экрана. Берём с запасом.
    const MAX_REACH = Math.min(W * 0.5, 230);

    const lastWasHazard = last && last.type !== NORMAL;

    let type = NORMAL;
    if (!lastWasHazard) {
      const r = Math.random();
      if (heightFloors > 40) {
        if (r < 0.14) type = SPIKE;
        else if (r < 0.40) type = FRAGILE;
      } else if (heightFloors > 15) {
        if (r < 0.08) type = SPIKE;
        else if (r < 0.30) type = FRAGILE;
      } else {
        if (r < 0.18) type = FRAGILE;
      }
    }

    // Позиция X
    let x;
    if (type === NORMAL) {
      // Нормальную ставим В ПРЕДЕЛАХ досягаемости от предыдущей платформы,
      // чтобы до неё всегда можно было допрыгнуть.
      if (last) {
        const minX = Math.max(0, last.x - MAX_REACH);
        const maxX = Math.min(W - PLATFORM_W, last.x + MAX_REACH);
        x = minX + Math.random() * (maxX - minX);
      } else {
        x = Math.random() * (W - PLATFORM_W);
      }
    } else {
      // Опасную ставим ПОДАЛЬШЕ от линии прыжка предыдущей платформы —
      // чтобы её можно было облететь, а не натыкаться обязательно.
      x = Math.random() * (W - PLATFORM_W);
    }

    return {
      x,
      y,
      w: PLATFORM_W,
      h: 18,
      type,
      broken: false,
      breakAnim: 0,
    };
  }, []);

  const loop = useCallback((now) => {
    const g = game.current;
    if (!g || !g.running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { player, platforms, boosters, W, H } = g;

    // ── Delta-time ──
    if (!g.lastTime) g.lastTime = now;
    let dt = (now - g.lastTime) / 16.666;
    g.lastTime = now;
    if (dt > 2.5) dt = 2.5;

    // ── Физика игрока ──
    player.vy += g.GRAVITY * dt;
    player.y += player.vy * dt;
    player.x += player.vx * dt;

    if (player.x > W) player.x = -player.w;
    if (player.x + player.w < 0) player.x = W;

    // ── Коллизия с платформами (только при падении) ──
    platforms.forEach((p) => {
      if (p.broken) return; // рассыпавшаяся ломкая — сквозь неё
      const overlapX = player.x + player.w > p.x && player.x < p.x + p.w;
      const landing =
        player.vy > 0 &&
        player.y + player.h > p.y &&
        player.y + player.h < p.y + p.h + player.vy * dt + 6;

      if (overlapX && landing) {
        if (p.type === SPIKE) {
          // Иглы — мгновенная смерть
          g.running = false;
          haptic('error');
          endGame(g.score);
          return;
        }
        player.vy = g.JUMP;
        haptic('light');
        if (p.type === FRAGILE) {
          p.broken = true; // отпрыгнули — и она ломается
        }
      }
    });
    if (!g.running) return;

    // Анимация развала ломких платформ
    platforms.forEach((p) => {
      if (p.broken && p.breakAnim < 1) p.breakAnim = Math.min(1, p.breakAnim + 0.08 * dt);
    });

    // ── Бустеры: летят горизонтально насквозь, при касании — подброс ──
    boosters.forEach((b) => {
      b.x += b.vx * dt;
      if (
        !b.used &&
        player.x + player.w > b.x &&
        player.x < b.x + b.w &&
        player.y + player.h > b.y &&
        player.y < b.y + b.h
      ) {
        b.used = true;
        player.vy = g.BOOST;
        haptic('success');
      }
    });

    // ── Скролл мира вверх ──
    if (player.y < H / 2) {
      const diff = H / 2 - player.y;
      player.y = H / 2;
      platforms.forEach((p) => { p.y += diff; });
      boosters.forEach((b) => { b.y += diff; });
      g.scrolled += diff;
      const newScore = Math.floor(g.scrolled / 50);
      if (newScore > g.score) { g.score = newScore; setScore(newScore); }
    }

    // ── Спавн бустера на каждые 30 очков ──
    if (g.score >= g.nextBoosterScore) {
      g.nextBoosterScore += 30;
      const fromLeft = Math.random() < 0.5;
      boosters.push({
        x: fromLeft ? -60 : W + 60,
        y: H * 0.12 + Math.random() * H * 0.28,
        w: 50, h: 50,
        vx: (fromLeft ? 1 : -1) * (2.6 + Math.random() * 1.2),
        used: false,
      });
    }

    // ── Чистка ──
    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i];
      if (p.y > H || (p.broken && p.breakAnim >= 1)) platforms.splice(i, 1);
    }
    // Бустер ушёл за экран по горизонтали или вниз — удаляем (выплывет новый при +30)
    for (let i = boosters.length - 1; i >= 0; i--) {
      const b = boosters[i];
      if (b.used || b.y > H + 80 || b.x < -120 || b.x > W + 120) boosters.splice(i, 1);
    }
    while (platforms.length < 8) {
      const highest = platforms.reduce((min, p) => Math.min(min, p.y), H);
      // recent = платформы, отсортированные по высоте (самые верхние — последние созданные)
      const recent = [...platforms].sort((a, b) => b.y - a.y);
      platforms.push(makePlatform(W, highest, g.scrolled, recent));
    }

    // Game over (упал вниз)
    if (player.y > H) {
      g.running = false;
      endGame(g.score);
      return;
    }

    // ════════ РЕНДЕР ════════
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, BG_TOP);
    grad.addColorStop(1, BG_BOT);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Платформы
    platforms.forEach((p) => {
      ctx.save();

      if (p.broken) {
        // Разваливается: две половинки разъезжаются и падают
        const off = p.breakAnim * 40;
        ctx.globalAlpha = 1 - p.breakAnim;
        drawPlatformBody(ctx, p.x - off, p.y + off * 0.6, p.w / 2 - 3, p.h, '#E8C9A0');
        drawPlatformBody(ctx, p.x + p.w / 2 + off, p.y + off * 0.6, p.w / 2 - 3, p.h, '#E8C9A0');
        ctx.restore();
        return;
      }

      if (p.type === SPIKE) {
        // База платформы
        drawPlatformBody(ctx, p.x, p.y, p.w, p.h, '#9aa0a8');
        // Иглы сверху
        ctx.fillStyle = '#6b7280';
        const spikes = 6;
        const sw = p.w / spikes;
        for (let i = 0; i < spikes; i++) {
          ctx.beginPath();
          ctx.moveTo(p.x + i * sw, p.y);
          ctx.lineTo(p.x + i * sw + sw / 2, p.y - 11);
          ctx.lineTo(p.x + (i + 1) * sw, p.y);
          ctx.closePath();
          ctx.fill();
        }
      } else if (p.type === FRAGILE) {
        // Ломкая — песочного цвета с трещиной
        drawPlatformBody(ctx, p.x, p.y, p.w, p.h, '#F0D8B0');
        ctx.strokeStyle = '#C9A878';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x + p.w * 0.35, p.y + 2);
        ctx.lineTo(p.x + p.w * 0.5, p.y + p.h - 3);
        ctx.lineTo(p.x + p.w * 0.62, p.y + 3);
        ctx.stroke();
      } else {
        // Обычная — белая с лавандовой обводкой
        ctx.globalAlpha = 0.92;
        drawPlatformBody(ctx, p.x, p.y, p.w, p.h, '#ffffff');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ACCENT + '55';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, p.w, p.h, 10);
        ctx.stroke();
      }
      ctx.restore();
    });

    // Бустеры — красивая ракета
    boosters.forEach((b) => {
      if (b.used) return;
      drawRocket(ctx, b.x, b.y, b.w, b.h, b.vx < 0);
    });

    // Игрок
    const img = petImg.current;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, player.x, player.y, player.w, player.h);
    } else {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(player.x + player.w / 2, player.y + player.h / 2, player.w / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    g.raf = requestAnimationFrame(loop);
  }, [endGame, haptic, makePlatform]);

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width;
    const H = canvas.height;

    const player = {
      x: W / 2 - 36,
      y: H - 170,
      w: 72,
      h: 72,
      vy: 0,
      vx: 0,
    };

    // Первая платформа всегда обычная (под игроком)
    const platforms = [{ x: player.x - 2, y: H - 95, w: 75, h: 18, type: NORMAL, broken: false, breakAnim: 0 }];
    while (platforms.length < 8) {
      platforms.push(makePlatform(W, platforms[platforms.length - 1].y, 0, platforms));
    }

    game.current = {
      player, platforms,
      boosters: [],
      nextBoosterScore: 30, // первый бустер на 30 очках
      GRAVITY: 0.38,
      JUMP: -12.8,
      BOOST: -27,
      W, H,
      score: 0, scrolled: 0, running: true, raf: null, lastTime: 0,
    };

    setScore(0);
    setGameOver(false);
    game.current.raf = requestAnimationFrame(loop);
  }, [loop, makePlatform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (petImgSrc) {
      const img = new Image();
      img.src = petImgSrc;
      petImg.current = img;
    }

    const onTilt = (e) => {
      const g = game.current;
      if (g && g.player) g.player.vx = (e.gamma || 0) * 0.55;
    };
    window.addEventListener('deviceorientation', onTilt);

    // Управление пальцем: водим персонажа к месту касания, держа палец на экране
    const followTouch = (clientX) => {
      const g = game.current;
      if (!g || !g.player) return;
      const targetX = clientX - g.player.w / 2;     // центр персонажа под пальцем
      const dx = targetX - g.player.x;
      // Скорость пропорциональна расстоянию до пальца, с ограничением
      g.player.vx = Math.max(-9, Math.min(9, dx * 0.35));
    };
    const onTouchStart = (e) => {
      followTouch(e.touches[0].clientX);
    };
    const onTouchMove = (e) => {
      e.preventDefault(); // не даём странице скроллиться/тянуться
      followTouch(e.touches[0].clientX);
    };
    const onTouchEnd = () => {
      const g = game.current;
      if (g && g.player) g.player.vx = 0;
    };

    // Клавиатура (для теста в браузере)
    const onKeyDown = (e) => {
      const g = game.current;
      if (!g || !g.player) return;
      if (e.key === 'ArrowLeft') g.player.vx = -7;
      if (e.key === 'ArrowRight') g.player.vx = 7;
    };
    const onKeyUp = () => {
      const g = game.current;
      if (g && g.player) g.player.vx = 0;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    startGame();

    return () => {
      window.removeEventListener('deviceorientation', onTilt);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (game.current) game.current.running = false;
      if (game.current?.raf) cancelAnimationFrame(game.current.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => {
    if (game.current) game.current.running = false;
    navigate(pairId ? `/pair/${pairId}` : '/');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none' }} />

      <div style={{
        position: 'absolute', top: 'calc(var(--chumi-top-pad, 16px) + 6px)',
        left: 0, right: 0, textAlign: 'center',
        fontSize: 42, fontWeight: 800, color: '#3a2a55',
        fontFamily: '-apple-system, system-ui, sans-serif', pointerEvents: 'none',
        textShadow: '0 2px 8px rgba(255,255,255,0.6)',
      }}>
        {score}
      </div>

      <button onClick={goBack} style={{
        position: 'absolute', top: 'calc(var(--chumi-top-pad, 16px))', left: 12,
        width: 42, height: 42, borderRadius: 14, border: 'none',
        background: 'rgba(255,255,255,0.75)', color: '#3a2a55',
        fontSize: 22, cursor: 'pointer', backdropFilter: 'blur(8px)',
      }}>‹</button>

      {gameOver && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(40,25,60,0.45)', backdropFilter: 'blur(4px)',
          fontFamily: '-apple-system, system-ui, sans-serif',
        }}>
          <div style={{
            background: '#fff', borderRadius: 24, padding: '28px 32px',
            textAlign: 'center', minWidth: 250,
            boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontSize: 52, marginBottom: 8 }}>🐾</div>
            <h2 style={{ margin: '0 0 12px', color: '#3a2a55' }}>Игра окончена</h2>
            <p style={{ color: '#777', margin: '4px 0', fontSize: 15 }}>Очки: <b style={{ color: ACCENT }}>{score}</b></p>
            <p style={{ color: '#777', margin: '4px 0 18px', fontSize: 15 }}>Рекорд: <b style={{ color: ACCENT }}>{bestScore}</b></p>
            <button onClick={startGame} style={{
              padding: '14px 28px', borderRadius: 16, border: 'none',
              background: ACCENT, color: '#fff', fontSize: 16,
              fontWeight: 600, cursor: 'pointer', marginBottom: 10, width: '100%',
            }}>Играть снова</button>
            <button onClick={goBack} style={{
              padding: '14px 28px', borderRadius: 16, border: 'none',
              background: '#f0ecf5', color: '#3a2a55', fontSize: 16,
              cursor: 'pointer', width: '100%',
            }}>К питомцу</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Хелперы рисования (вне компонента — чистые функции) ──

function drawPlatformBody(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fill();
}

// Красивая ракета. flip=true — направлена влево
function drawRocket(ctx, x, y, w, h, flip) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (flip) ctx.scale(-1, 1);
  // Ракета смотрит вправо (нос справа)
  const bodyL = -w * 0.42, bodyR = w * 0.30;
  const r = h * 0.26;

  // Пламя сзади (мерцает)
  const flame = (0.7 + Math.random() * 0.3);
  const fgrad = ctx.createLinearGradient(bodyL, 0, bodyL - w * 0.45 * flame, 0);
  fgrad.addColorStop(0, '#FFD24A');
  fgrad.addColorStop(0.5, '#FF8A3D');
  fgrad.addColorStop(1, 'rgba(255,80,40,0)');
  ctx.fillStyle = fgrad;
  ctx.beginPath();
  ctx.moveTo(bodyL, -r * 0.6);
  ctx.lineTo(bodyL - w * 0.5 * flame, 0);
  ctx.lineTo(bodyL, r * 0.6);
  ctx.closePath();
  ctx.fill();

  // Плавники
  ctx.fillStyle = '#7C5CCB';
  ctx.beginPath();
  ctx.moveTo(bodyL + 4, -r);
  ctx.lineTo(bodyL - 8, -r - 8);
  ctx.lineTo(bodyL + 6, -r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bodyL + 4, r);
  ctx.lineTo(bodyL - 8, r + 8);
  ctx.lineTo(bodyL + 6, r * 0.3);
  ctx.closePath();
  ctx.fill();

  // Корпус
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(bodyR, 0);                       // нос
  ctx.quadraticCurveTo(bodyR, -r, bodyL + r * 0.4, -r);
  ctx.lineTo(bodyL, -r * 0.7);
  ctx.lineTo(bodyL, r * 0.7);
  ctx.lineTo(bodyL + r * 0.4, r);
  ctx.quadraticCurveTo(bodyR, r, bodyR, 0);
  ctx.closePath();
  ctx.fill();

  // Нос-конус (акцентный)
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(bodyR, 0);
  ctx.quadraticCurveTo(w * 0.12, -r * 0.55, -w * 0.02, -r * 0.7);
  ctx.lineTo(-w * 0.02, r * 0.7);
  ctx.quadraticCurveTo(w * 0.12, r * 0.55, bodyR, 0);
  ctx.closePath();
  ctx.fill();

  // Иллюминатор
  ctx.fillStyle = '#9AD0F0';
  ctx.beginPath();
  ctx.arc(-w * 0.12, 0, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();
}
