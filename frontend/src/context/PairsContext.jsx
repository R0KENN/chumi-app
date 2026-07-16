import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { setInitDataGlobal } from './initDataStore';

const API_URL = '/api';
const CACHE_TTL_MS = 10 * 60 * 1000;

const PairsContext = createContext(null);

export { getInitData } from './initDataStore';

export function usePairs() {
  const context = useContext(PairsContext);

  if (!context) {
    throw new Error(
      'usePairs must be used inside PairsProvider',
    );
  }

  return context;
}

function getDeviceStorage() {
  return window.Telegram?.WebApp?.DeviceStorage || null;
}

async function dsGet(key) {
  const storage = getDeviceStorage();

  if (storage) {
    try {
      const value = await new Promise(
        (resolve) => {
          let completed = false;

          const finish = result => {
            if (completed) {
              return;
            }

            completed = true;
            window.clearTimeout(timeoutId);
            resolve(result);
          };

          /*
           * Некоторые версии Telegram WebView
           * могут не вызвать callback DeviceStorage.
           * Не позволяем загрузке приложения зависнуть.
           */
          const timeoutId =
            window.setTimeout(() => {
              console.warn(
                'Telegram DeviceStorage get timed out:',
                key,
              );

              finish(null);
            }, 2000);

          try {
            storage.getItem(
              key,
              (
                error,
                storedValue,
              ) => {
                if (
                  error ||
                  !storedValue
                ) {
                  finish(null);
                  return;
                }

                try {
                  finish(
                    JSON.parse(
                      storedValue,
                    ),
                  );
                } catch {
                  finish(null);
                }
              },
            );
          } catch (error) {
            console.warn(
              'Telegram DeviceStorage get failed:',
              error,
            );

            finish(null);
          }
        },
      );

      if (value !== null) {
        return value;
      }
    } catch (error) {
      console.warn(
        'Telegram DeviceStorage get failed:',
        error,
      );
    }
  }

  /*
   * Если Telegram DeviceStorage недоступен
   * или завис, используем localStorage.
   */
  try {
    const storedValue =
      localStorage.getItem(
        `ds_${key}`,
      );

    if (!storedValue) {
      return null;
    }

    return JSON.parse(storedValue);
  } catch (error) {
    console.warn(
      'localStorage get failed:',
      error,
    );

    return null;
  }
}

async function dsSet(key, value) {
  const serialized = JSON.stringify(value);
  const storage = getDeviceStorage();

  if (storage) {
    try {
      storage.setItem(
        key,
        serialized,
        (error) => {
          if (error) {
            console.warn(
              'Telegram DeviceStorage set failed:',
              error,
            );
          }
        },
      );
    } catch (error) {
      console.warn(
        'Telegram DeviceStorage set failed:',
        error,
      );
    }
  }

  try {
    localStorage.setItem(
      `ds_${key}`,
      serialized,
    );
  } catch (error) {
    console.warn(
      'localStorage set failed:',
      error,
    );
  }
}

async function dsRemove(key) {
  const storage = getDeviceStorage();

  if (storage) {
    try {
      storage.removeItem?.(key, () => {});
    } catch (error) {
      console.warn(
        'Telegram DeviceStorage remove failed:',
        error,
      );
    }
  }

  try {
    localStorage.removeItem(`ds_${key}`);
  } catch (error) {
    console.warn(
      'localStorage remove failed:',
      error,
    );
  }
}

async function readJsonResponse(response) {
  const contentType =
    response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const text = await response.text();

    return {
      message:
        text?.slice(0, 300) ||
        `Сервер вернул HTTP ${response.status}`,
    };
  }

  try {
    return await response.json();
  } catch {
    return {
      message: `Не удалось прочитать ответ сервера. HTTP ${response.status}`,
    };
  }
}

function getRequestErrorMessage(status, data) {
  const serverMessage =
    data?.error ||
    data?.message;

  if (serverMessage) {
    return serverMessage;
  }

  if (status === 401) {
    return 'Сессия Telegram недействительна. Закрой и снова открой приложение через бота.';
  }

  if (status === 403) {
    return 'У тебя нет доступа к этим данным.';
  }

  if (status === 429) {
    return 'Слишком много запросов. Подожди несколько секунд.';
  }

  if (status >= 500) {
    return 'Сервер временно недоступен. Попробуй ещё раз.';
  }

  return `Ошибка загрузки данных. HTTP ${status}`;
}

export function PairsProvider({
  children,
  telegramUserId,
  initData,
}) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setInitDataGlobal(initData || '');
  }, [initData]);

  const clearPairsCache = useCallback(async () => {
    if (!telegramUserId) {
      return;
    }

    await Promise.all([
      dsRemove(`pairs_${telegramUserId}`),
      dsRemove(`pairs_ts_${telegramUserId}`),
    ]);
  }, [telegramUserId]);

  const fetchPairs = useCallback(async ({
    showLoading = false,
  } = {}) => {
    if (!telegramUserId) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 15_000);

    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const isLocal =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      const headers = {};

      if (initData) {
        headers['X-Telegram-Init-Data'] = initData;
      }

      if (isLocal) {
        headers['X-Dev-User-Id'] =
          String(telegramUserId);
      }

      const response = await fetch(
        `${API_URL}/pairs/${encodeURIComponent(telegramUserId)}`,
        {
          method: 'GET',
          headers,
          signal: controller.signal,
        },
      );

      const data = await readJsonResponse(response);

      if (!response.ok) {
        const message = getRequestErrorMessage(
          response.status,
          data,
        );

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          await clearPairsCache();

          if (
            mountedRef.current &&
            requestId === requestIdRef.current
          ) {
            setPairs([]);
          }
        }

        throw new Error(message);
      }

      if (!Array.isArray(data?.pairs)) {
        throw new Error(
          'Сервер вернул неправильный формат списка пар.',
        );
      }

      if (
        !mountedRef.current ||
        requestId !== requestIdRef.current
      ) {
        return;
      }

      const freshPairs = data.pairs;

      setPairs(freshPairs);
      setError(null);

      await Promise.all([
        dsSet(
          `pairs_${telegramUserId}`,
          freshPairs,
        ),
        dsSet(
          `pairs_ts_${telegramUserId}`,
          Date.now(),
        ),
      ]);
    } catch (requestError) {
      if (
        !mountedRef.current ||
        requestId !== requestIdRef.current
      ) {
        return;
      }

      if (requestError.name === 'AbortError') {
        setError(
          'Сервер не ответил за 15 секунд. Проверь интернет и попробуй ещё раз.',
        );
      } else {
        setError(
          requestError.message ||
          'Не удалось загрузить пары.',
        );
      }
    } finally {
      window.clearTimeout(timeoutId);

      if (
        mountedRef.current &&
        requestId === requestIdRef.current
      ) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    telegramUserId,
    initData,
    clearPairsCache,
  ]);

  const refreshPairs = useCallback(() => {
    return fetchPairs({
      showLoading: true,
    });
  }, [fetchPairs]);

  useEffect(() => {
    if (!telegramUserId) {
      setPairs([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadCachedPairs = async () => {
      setLoading(true);

      const [
        cachedPairs,
        cachedTimestamp,
      ] = await Promise.all([
        dsGet(`pairs_${telegramUserId}`),
        dsGet(`pairs_ts_${telegramUserId}`),
      ]);

      if (cancelled) {
        return;
      }

      const timestamp = Number(cachedTimestamp);

      const cacheIsFresh =
        Array.isArray(cachedPairs) &&
        Number.isFinite(timestamp) &&
        Date.now() - timestamp < CACHE_TTL_MS;

      if (cacheIsFresh) {
        setPairs(cachedPairs);
        setLoading(false);

        fetchPairs({
          showLoading: false,
        });

        return;
      }

      await fetchPairs({
        showLoading: true,
      });
    };

    loadCachedPairs();

    return () => {
      cancelled = true;
    };
  }, [
    telegramUserId,
    fetchPairs,
  ]);

  useEffect(() => {
    if (!telegramUserId) {
      return undefined;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchPairs({
          showLoading: false,
        });
      }
    };

    document.addEventListener(
      'visibilitychange',
      refreshWhenVisible,
    );

    return () => {
      document.removeEventListener(
        'visibilitychange',
        refreshWhenVisible,
      );
    };
  }, [
    telegramUserId,
    fetchPairs,
  ]);

  const addPair = useCallback((newPair) => {
    setPairs((currentPairs) => {
      const withoutDuplicate =
        currentPairs.filter(
          (pair) => pair.code !== newPair.code,
        );

      return [
        ...withoutDuplicate,
        newPair,
      ];
    });
  }, []);

  const updatePair = useCallback(
    (pairId, updates) => {
      setPairs((currentPairs) =>
        currentPairs.map((pair) =>
          pair.code === pairId
            ? {
                ...pair,
                ...updates,
              }
            : pair
        )
      );
    },
    [],
  );

  const value = useMemo(
    () => ({
      pairs,
      loading,
      refreshing,
      error,
      refreshPairs,
      clearPairsCache,
      addPair,
      updatePair,
    }),
    [
      pairs,
      loading,
      refreshing,
      error,
      refreshPairs,
      clearPairsCache,
      addPair,
      updatePair,
    ],
  );

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}
