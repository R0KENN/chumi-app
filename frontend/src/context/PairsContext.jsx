import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { setInitDataGlobal } from './initDataStore';

const API_URL = '/api';
const REQUEST_TIMEOUT = 15000;

const PairsContext = createContext(null);

export { getInitData } from './initDataStore';

export function usePairs() {
  const context = useContext(PairsContext);

  if (!context) {
    throw new Error(
      'usePairs must be used inside PairsProvider'
    );
  }

  return context;
}

function isLocalDevelopment() {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

function getDeviceStorage() {
  return window.Telegram?.WebApp?.DeviceStorage || null;
}

async function dsGet(key) {
  const storage = getDeviceStorage();

  if (storage) {
    try {
      const value = await new Promise((resolve) => {
        storage.getItem(key, (error, storedValue) => {
          if (error || !storedValue) {
            resolve(null);
            return;
          }

          try {
            resolve(JSON.parse(storedValue));
          } catch {
            resolve(null);
          }
        });
      });

      if (value !== null) {
        return value;
      }
    } catch (error) {
      console.warn(
        `DeviceStorage read failed for "${key}":`,
        error
      );
    }
  }

  try {
    const storedValue = localStorage.getItem(`ds_${key}`);

    if (!storedValue) {
      return null;
    }

    return JSON.parse(storedValue);
  } catch (error) {
    console.warn(
      `localStorage read failed for "${key}":`,
      error
    );

    return null;
  }
}

async function dsSet(key, value) {
  const serializedValue = JSON.stringify(value);
  const storage = getDeviceStorage();

  if (storage) {
    try {
      storage.setItem(
        key,
        serializedValue,
        (error) => {
          if (error) {
            console.warn(
              `DeviceStorage write failed for "${key}":`,
              error
            );
          }
        }
      );
    } catch (error) {
      console.warn(
        `DeviceStorage write failed for "${key}":`,
        error
      );
    }
  }

  try {
    localStorage.setItem(
      `ds_${key}`,
      serializedValue
    );
  } catch (error) {
    console.warn(
      `localStorage write failed for "${key}":`,
      error
    );
  }
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
      `Request failed with status ${response.status}`
    );
  }

  return data;
}

export function PairsProvider({
  children,
  telegramUserId,
  initData,
}) {
  const [pairs, setPairs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setInitDataGlobal(initData || '');
  }, [initData]);

  const fetchPairs = useCallback(async () => {
    if (!telegramUserId) {
      return;
    }

    const controller = new AbortController();

    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    try {
      const headers = {};

      if (initData) {
        headers['X-Telegram-Init-Data'] = initData;
      }

      if (isLocalDevelopment()) {
        headers['X-Dev-User-Id'] =
          String(telegramUserId);
      }

      const response = await fetch(
        `${API_URL}/pairs/${encodeURIComponent(
          telegramUserId
        )}`,
        {
          headers,
          signal: controller.signal,
        }
      );

      const data = await readJsonResponse(response);

      const freshPairs = Array.isArray(data.pairs)
        ? data.pairs
        : [];

      setPairs(freshPairs);
      setError(null);

      await Promise.allSettled([
        dsSet(
          `pairs_${telegramUserId}`,
          freshPairs
        ),
        dsSet(
          `pairs_ts_${telegramUserId}`,
          Date.now()
        ),
      ]);
    } catch (requestError) {
      if (requestError.name === 'AbortError') {
        setError(
          'Сеть слишком медленная. Проверь интернет, VPN или прокси.'
        );
      } else {
        console.error(
          'Failed to load pairs:',
          requestError
        );

        setError(
          requestError.message ||
          'Не удалось загрузить пары'
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [telegramUserId, initData]);

  useEffect(() => {
    if (!telegramUserId) {
      return undefined;
    }

    let cancelled = false;

    const initialize = async () => {
      const cachedPairs = await dsGet(
        `pairs_${telegramUserId}`
      );

      if (
        !cancelled &&
        Array.isArray(cachedPairs)
      ) {
        setPairs(cachedPairs);
        setLoading(false);
      }

      if (!cancelled) {
        await fetchPairs();
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [telegramUserId, fetchPairs]);

  useEffect(() => {
    if (!telegramUserId) {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchPairs();
      }
    };

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    );

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );
    };
  }, [telegramUserId, fetchPairs]);

  const addPair = useCallback((newPair) => {
    setPairs((currentPairs) => [
      ...(currentPairs || []),
      newPair,
    ]);
  }, []);

  const updatePair = useCallback(
    (pairId, updates) => {
      setPairs((currentPairs) =>
        (currentPairs || []).map((pair) =>
          pair.code === pairId
            ? { ...pair, ...updates }
            : pair
        )
      );
    },
    []
  );

  const value = useMemo(
    () => ({
      pairs: pairs || [],
      loading,
      error,
      addPair,
      updatePair,
      refreshPairs: fetchPairs,
      initData: initData || '',
    }),
    [
      pairs,
      loading,
      error,
      addPair,
      updatePair,
      fetchPairs,
      initData,
    ]
  );

  return (
    <PairsContext.Provider value={value}>
      {children}
    </PairsContext.Provider>
  );
}
