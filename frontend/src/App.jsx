import React, { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { LangProvider } from './context/LangContext';
import { PairsProvider, usePairs } from './context/PairsContext';

import PairSelector from './components/PairSelector';
import PairScreen from './components/PairScreen';
import JumpGame from './components/JumpGame';

import './App.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
          }}
        >
          😿
        </div>

        <h2 style={{ color: '#e53e3e' }}>
          Приложение завершилось с ошибкой
        </h2>

        <pre
          style={{
            maxWidth: 360,
            margin: '16px auto',
            padding: 12,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textAlign: 'left',
            fontSize: 12,
            color: '#666',
            background: '#f5f5f5',
            borderRadius: 8,
          }}
        >
          {this.state.error?.toString()}
        </pre>

        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            background: '#9B72CF',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      </div>
    );
  }
}

function FullScreenMessage({
  icon,
  title,
  children,
  showReload = false,
}) {
  return (
    <div
      style={{
        maxWidth: 380,
        margin: '0 auto',
        padding: '48px 28px',
        textAlign: 'center',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          marginBottom: 16,
          fontSize: 56,
        }}
      >
        {icon}
      </div>

      <h3
        style={{
          margin: '0 0 12px',
          color: '#2d2438',
        }}
      >
        {title}
      </h3>

      <div
        style={{
          marginBottom: showReload ? 20 : 0,
          color: '#666',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>

      {showReload && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            background: '#9B72CF',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Перезагрузить
        </button>
      )}
    </div>
  );
}

function WeeklyRatingAnnouncement({
  onClose,
}) {
  return (
    <div className="weekly-rating-overlay">
      <section
        className="weekly-rating-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-rating-title"
        aria-describedby="weekly-rating-description"
      >
        <div
          className="weekly-rating-icon"
          aria-hidden="true"
        >
          🎁
        </div>

        <div className="weekly-rating-badge">
          Недельный розыгрыш
        </div>

        <h2 id="weekly-rating-title">
          Розыгрыш подарков начался!
        </h2>

        <p id="weekly-rating-description">
          Попади в топ-10 недельного рейтинга в игре
          и участвуй в розыгрыше подарков.
        </p>

        <button
          type="button"
          className="weekly-rating-button"
          onClick={onClose}
        >
          Понятно, играю!
        </button>
      </section>
    </div>
  );
}

function AppContent() {
  const { pairs, loading } = usePairs();

  const navigate = useNavigate();
  const location = useLocation();

  const [
    showWeeklyRatingAnnouncement,
    setShowWeeklyRatingAnnouncement,
  ] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAnnouncementSetting = async () => {
      try {
        const response = await fetch(
          '/api/app-settings',
          {
            cache: 'no-store',
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (
          cancelled ||
          !response.ok
        ) {
          return;
        }

        setShowWeeklyRatingAnnouncement(
          data.weeklyRatingAnnouncementEnabled ===
            true,
        );
      } catch (error) {
        console.warn(
          'Failed to load announcement setting:',
          error,
        );
      }
    };

    const handleAnnouncementSettingChanged =
      event => {
        setShowWeeklyRatingAnnouncement(
          event.detail?.enabled === true,
        );
      };

    loadAnnouncementSetting();

    window.addEventListener(
      'chumi-weekly-rating-announcement-changed',
      handleAnnouncementSettingChanged,
    );

    return () => {
      cancelled = true;

      window.removeEventListener(
        'chumi-weekly-rating-announcement-changed',
        handleAnnouncementSettingChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (loading || !pairs || pairs.length === 0) {
      return;
    }

    const params = new URLSearchParams(location.search);

    if (params.get('newpair')) {
      return;
    }

    if (location.pathname === '/' || location.pathname === '') {
      navigate(`/pair/${pairs[0].code}`, {
        replace: true,
      });
    }
  }, [
    pairs,
    loading,
    navigate,
    location.pathname,
    location.search,
  ]);

  return (
    <>
      <Routes>
        <Route path="/" element={<PairSelector />} />
        <Route path="/pair/:pairId" element={<PairScreen />} />
        <Route path="/game/:pairId" element={<JumpGame />} />
        <Route path="*" element={<PairSelector />} />
      </Routes>

      {showWeeklyRatingAnnouncement && (
        <WeeklyRatingAnnouncement
          onClose={() => {
            setShowWeeklyRatingAnnouncement(false);

            window.Telegram?.WebApp?.HapticFeedback
              ?.impactOccurred?.('light');
          }}
        />
      )}
    </>
  );
}

function App() {
  const [telegramStatus, setTelegramStatus] = useState('loading');
  const [telegramUserId, setTelegramUserId] = useState(null);
  const [initData, setInitData] = useState('');

  useEffect(() => {
    let cancelled = false;
    let tgForCleanup = null;
    let updateTelegramInsets = null;
    let handleFullscreenFailed = null;

    (async () => {
      const isLocal =
        window.location.hostname ===
          'localhost' ||
        window.location.hostname ===
          '127.0.0.1';

      // Если SDK ещё не загрузился и не упал — ждём до 3 секунд
      // (нужно при медленном/проксированном соединении в Telegram)
      const start = Date.now();

      while (
        !window.Telegram?.WebApp &&
        !window.__tgSdkFailed &&
        Date.now() - start < 3000
      ) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (cancelled) return;

      try {
        const tg = window.Telegram?.WebApp;

        if (tg) {
          tgForCleanup = tg;

          tg.ready();
          tg.expand();

          /*
           * Определяем платформу один раз.
           *
           * iPad с современным User-Agent может
           * определяться как Macintosh, поэтому
           * дополнительно проверяем maxTouchPoints.
           */
          const userAgent =
            navigator.userAgent || '';

          const isIPhone =
            /iPhone|iPod/i.test(userAgent);

          const isIPad =
            /iPad/i.test(userAgent) ||
            (
              /Macintosh/i.test(userAgent) &&
              navigator.maxTouchPoints > 1
            );

          const isIOS =
            isIPhone || isIPad;

          const isAndroid =
            /Android/i.test(userAgent);

          const isMobile =
            isIOS || isAndroid;

          if (tg.initData) {
            setInitData(tg.initData);
          }

          /*
           * Telegram имеет два разных типа safe area:
           *
           * safeAreaInset — системная безопасная зона устройства;
           * contentSafeAreaInset — зона, свободная от элементов Telegram.
           *
           * Для верхней панели приложения и HUD игры важнее именно
           * contentSafeAreaInset.
           */
          updateTelegramInsets = () => {
            const safeTop =
              Number(tg.safeAreaInset?.top) || 0;

            const contentSafeTop =
              Number(tg.contentSafeAreaInset?.top) || 0;

            const safeBottom =
              Number(tg.safeAreaInset?.bottom) || 0;

            const contentSafeBottom =
              Number(tg.contentSafeAreaInset?.bottom) || 0;

            /*
             * В fullscreen Telegram рисует поверх Mini App:
             *
             * 1. системную строку iOS;
             * 2. кнопку закрытия;
             * 3. кнопку сворачивания;
             * 4. меню Telegram.
             *
             * На некоторых версиях Telegram iOS
             * contentSafeAreaInset.top возвращает 0
             * или слишком маленькое значение.
             *
             * Поэтому используем разные минимальные
             * fallback-значения для разных устройств.
             */
            let fullscreenTopFallback = 0;

            if (tg.isFullscreen) {
              if (isIPhone) {
                /*
                 * Dynamic Island/status bar плюс
                 * верхние управляющие кнопки Telegram.
                 * Понижено, чтобы верхняя панель приложения
                 * не уезжала слишком низко под панель Telegram.
                 */
                fullscreenTopFallback = 92;
              } else if (isIPad) {
                /*
                 * На iPad верхняя панель обычно ниже,
                 * чем на iPhone.
                 */
                fullscreenTopFallback = 92;
              } else if (isAndroid) {
                /*
                 * На части Android-устройств Telegram рисует
                 * панель управления выше — берём 84px, чтобы
                 * верхняя строка приложения не уезжала под неё.
                 */
                fullscreenTopFallback = 84;
              } else {
                fullscreenTopFallback = 60;
              }
            }

            /*
             * Берём наибольшее значение из:
             *
             * 1. системного safe area;
             * 2. content safe area Telegram;
             * 3. нашего fullscreen fallback.
             */
            const topInset = Math.max(
              safeTop,
              contentSafeTop,
              fullscreenTopFallback,
            );

            const bottomInset = Math.max(
              safeBottom,
              contentSafeBottom,
            );

            /*
             * --chumi-safe-top используют игровые экраны.
             * JumpGame.css самостоятельно добавляет
             * небольшой визуальный отступ.
             */
            document.documentElement.style.setProperty(
              '--chumi-safe-top',
              `${topInset}px`,
            );

            document.documentElement.style.setProperty(
              '--chumi-safe-bottom',
              `${bottomInset}px`,
            );

            /*
             * --chumi-top-pad используется основным
             * экраном питомца.
             *
             * Добавляем 6px, чтобы элементы не просто
             * касались панели Telegram, а имели небольшой
             * визуальный промежуток. Значение понижено,
             * чтобы верхняя панель располагалась выше.
             */
            const contentTop =
              Math.max(16, topInset + 6);

            document.documentElement.style.setProperty(
              '--chumi-top-pad',
              `${contentTop}px`,
            );

            /*
             * Общая переменная для новых экранов.
             * Все будущие верхние панели приложения
             * должны использовать именно её.
             */
            document.documentElement.style.setProperty(
              '--chumi-content-top',
              `${contentTop}px`,
            );

            /*
             * Атрибуты полезны для CSS и диагностики.
             */
            document.documentElement.dataset.chumiPlatform =
              isIPhone
                ? 'iphone'
                : isIPad
                  ? 'ipad'
                  : isAndroid
                    ? 'android'
                    : 'desktop';

            document.documentElement.dataset.chumiFullscreen =
              tg.isFullscreen
                ? 'true'
                : 'false';
          };

          handleFullscreenFailed = error => {
            console.warn(
              'Telegram fullscreen request failed:',
              error,
            );

            updateTelegramInsets?.();
          };

          updateTelegramInsets();

          tg.onEvent?.(
            'safeAreaChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'contentSafeAreaChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'fullscreenChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'viewportChanged',
            updateTelegramInsets,
          );

          tg.onEvent?.(
            'fullscreenFailed',
            handleFullscreenFailed,
          );

          if (
            isMobile &&
            tg.isVersionAtLeast?.('8.0') &&
            !tg.isFullscreen
          ) {
            try {
              tg.requestFullscreen();

              /*
               * Некоторые версии Telegram не сразу присылают
               * fullscreenChanged. Повторно проверяем состояние
               * после завершения fullscreen-анимации.
               */
              /*
               * Telegram iOS может обновлять isFullscreen
               * с задержкой. Проверяем safe-area несколько раз
               * после fullscreen-анимации.
               */
              window.setTimeout(() => {
                if (!cancelled) {
                  updateTelegramInsets?.();
                }
              }, 150);

              window.setTimeout(() => {
                if (!cancelled) {
                  updateTelegramInsets?.();
                }
              }, 400);

              window.setTimeout(() => {
                if (!cancelled) {
                  updateTelegramInsets?.();
                }
              }, 900);

              window.setTimeout(() => {
                if (!cancelled) {
                  updateTelegramInsets?.();
                }
              }, 1500);
            } catch (error) {
              handleFullscreenFailed(error);
            }
          }

          if (tg.disableVerticalSwipes) {
            tg.disableVerticalSwipes();
          }

          try {
            tg.setHeaderColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram header color failed:',
              error,
            );
          }

          try {
            tg.setBackgroundColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram background color failed:',
              error,
            );
          }

          try {
            tg.setBottomBarColor?.('#FFF8E1');
          } catch (error) {
            console.warn(
              'Telegram bottom bar color failed:',
              error,
            );
          }

          const uid =
            tg.initDataUnsafe?.user?.id?.toString();

          const rawInitData =
            typeof tg.initData === 'string'
              ? tg.initData
              : '';

          /*
           * В production обязательно нужны:
           * 1. Telegram user ID;
           * 2. подписанный initData.
           *
           * На localhost разрешён тестовый пользователь
           * без настоящего initData.
           */
          if (
            uid &&
            (rawInitData || isLocal)
          ) {
            if (cancelled) {
              return;
            }

            setInitData(rawInitData);
            setTelegramUserId(uid);
            setTelegramStatus('ready');

            return;
          }
        }
      } catch (error) {
        console.error(
          'Telegram initialization error:',
          error,
        );

        if (!cancelled) {
          setTelegramStatus('sdk-error');
        }

        return;
      }

      /*
       * Если SDK именно упал, гостевой доступ не выдаём.
       * Ниже отобразится экран с инструкцией про прокси.
       */
      if (window.__tgSdkFailed) {
        if (!cancelled) {
          setTelegramStatus('sdk-error');
        }

        return;
      }

      /*
       * SDK загрузился, но Telegram не передал
       * подписанный initData или пользователя.
       *
       * В production не запускаем приложение
       * с гостевым ID, потому что API всё равно
       * вернёт 401.
       */
      if (!isLocal) {
        if (!cancelled) {
          setTelegramStatus(
            'outside-telegram',
          );
        }

        return;
      }

      /*
       * Fallback для локальной разработки вне Telegram.
       */
      try {
        const testId =
          localStorage.getItem('chumi_test_uid') ||
          'guest';

        localStorage.setItem(
          'chumi_test_uid',
          testId,
        );

        if (cancelled) {
          return;
        }

        setTelegramUserId(testId);
        setTelegramStatus('ready');
      } catch {
        if (cancelled) {
          return;
        }

        setTelegramUserId('guest');
        setTelegramStatus('ready');
      }
    })();

    return () => {
      cancelled = true;

      if (tgForCleanup && updateTelegramInsets) {
        tgForCleanup.offEvent?.(
          'safeAreaChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'contentSafeAreaChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'fullscreenChanged',
          updateTelegramInsets,
        );

        tgForCleanup.offEvent?.(
          'viewportChanged',
          updateTelegramInsets,
        );
      }

      if (
        tgForCleanup &&
        handleFullscreenFailed
      ) {
        tgForCleanup.offEvent?.(
          'fullscreenFailed',
          handleFullscreenFailed,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (
      telegramStatus !== 'ready' ||
      !telegramUserId
    ) {
      return;
    }

    let cancelled = false;

    const updateTimezone = async () => {
      try {
        const timezone =
          Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!timezone) {
          return;
        }

        const lastSentRaw =
          localStorage.getItem('chumi_tz_sent_at');

        const lastTimezone =
          localStorage.getItem('chumi_tz_value');

        const lastSent = Number(lastSentRaw);
        const now = Date.now();

        const wasRecentlySent =
          lastTimezone === timezone &&
          Number.isFinite(lastSent) &&
          now - lastSent < 86_400_000;

        if (wasRecentlySent) {
          return;
        }

        const headers = {
          'Content-Type': 'application/json',
        };

        if (initData) {
          headers['X-Telegram-Init-Data'] = initData;
        }

        const response = await fetch('/api/update-timezone', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            userId: telegramUserId,
            timezone,
          }),
        });

        if (!response.ok) {
          console.warn(
            'Timezone update failed:',
            response.status,
          );

          return;
        }

        if (cancelled) {
          return;
        }

        localStorage.setItem(
          'chumi_tz_sent_at',
          String(now),
        );

        localStorage.setItem(
          'chumi_tz_value',
          timezone,
        );
      } catch (error) {
        console.warn('Timezone update error:', error);
      }
    };

    updateTimezone();

    return () => {
      cancelled = true;
    };
  }, [
    telegramStatus,
    telegramUserId,
    initData,
  ]);

  if (telegramStatus === 'loading') {
    const showDiag =
      new URLSearchParams(window.location.search)
        .get('diag') === '1';

    if (showDiag) {
      const tg = window.Telegram?.WebApp;

      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'monospace',
            fontSize: 13,
            color: '#333',
            wordBreak: 'break-word',
          }}
        >
          <div>DIAG: Telegram initialization</div>
          <div>Status: {telegramStatus}</div>
          <div>WebApp exists: {String(Boolean(tg))}</div>
          <div>User ID: {String(tg?.initDataUnsafe?.user?.id)}</div>
          <div>initData length: {String((tg?.initData || '').length)}</div>
          <div>Platform: {String(tg?.platform)}</div>
          <div>Version: {String(tg?.version)}</div>
          <div>SDK failed: {String(Boolean(window.__tgSdkFailed))}</div>
        </div>
      );
    }

    return (
      <div className="sk-loading">
        <div className="sk-spinner" />
      </div>
    );
  }

  if (telegramStatus === 'sdk-error') {
    return (
      <FullScreenMessage
        icon="🌐"
        title="Не удалось загрузить Telegram"
        showReload
      >
        Не удалось инициализировать Telegram Mini App.
        Проверь интернет или прокси Telegram, после чего
        перезагрузи приложение.
      </FullScreenMessage>
    );
  }

  if (telegramStatus === 'outside-telegram') {
    return (
      <FullScreenMessage
        icon="🐾"
        title="Открой Chumi в Telegram"
      >
        Это приложение использует авторизацию Telegram.
        Открой Chumi через кнопку меню или сообщение бота.
      </FullScreenMessage>
    );
  }

  return (
    <ErrorBoundary>
      <LangProvider>
        <PairsProvider
          telegramUserId={telegramUserId}
          initData={initData}
        >
          <BrowserRouter>
            <AppContent />
          </BrowserRouter>
        </PairsProvider>
      </LangProvider>
    </ErrorBoundary>
  );
}

export default App;
