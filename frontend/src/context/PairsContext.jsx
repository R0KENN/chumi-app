import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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
  const requestIdRef = useRef(0);

  useEffect(() => {
    setInitDataGlobal(initData || '');
  }, [initData]);

  const fetchPairs = useCallback(async () => {
    if (!telegramUserId) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 15000);

    try {
      const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      const headers = {};

      if (initData) {
        headers['X-Telegram-Init-Data'] = initData;
      }

      if (isLocalhost) {
        headers['X-Dev-User-Id'] =
          String(telegramUserId);
      }

      const response = await fetch(
        `${API_URL}/pairs/${encodeURIComponent(telegramUserId)}`,
        {
          headers,
          signal: controller.signal,
        },
      );

      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          `Pairs request failed with HTTP ${response.status}`,
        );
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      const freshPairs = Array.isArray(data?.pairs)
        ? data.pairs
        : [];

      setPairs(freshPairs);
      setError(null);

      await Promise.all([
        dsSet(`pairs_${telegramUserId}`, freshPairs),
        dsSet(`pairs_ts_${telegramUserId}`, Date.now()),
      ]);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (requestError.name === 'AbortError') {
        setError(
          'Сеть слишком медленная. Проверь прокси или интернет.',
        );
      } else {
        setError(
          requestError.message ||
          'Не удалось загрузить пары.',
        );
      }
    } finally {
      window.clearTimeout(timeoutId);

      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [telegramUserId, initData]);

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
