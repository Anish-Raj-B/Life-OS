import { useCallback, useEffect, useRef, useState } from 'react';
import { listRows, onDataChanged } from '@/lib/api';
import { onSyncState } from '@/lib/offline';

interface CollectionState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  fromCache: boolean;
  reload: () => void;
}

/**
 * Loads an entire collection once and refreshes it after local mutations or a
 * completed sync. Row sets are per-user and small, and RLS guarantees isolation.
 */
export function useCollection<T>(table: string, order = 'created_at', ascending = false): CollectionState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const mounted = useRef(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listRows<T>(table, { order, ascending })
      .then(({ data: rows, fromCache: cached }) => {
        if (cancelled || !mounted.current) return;
        setData(rows);
        setFromCache(cached);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled && mounted.current) setError(e.message);
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [table, order, ascending, nonce]);

  useEffect(() => {
    const off = onDataChanged(() => setNonce((n) => n + 1));
    const offSync = onSyncState((state) => {
      if (state === 'synced' || state === 'error') setNonce((n) => n + 1);
    });
    return () => {
      off();
      offSync();
    };
  }, []);

  return { data, loading, error, fromCache, reload };
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], initial: T | null = null) {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, setData };
}
