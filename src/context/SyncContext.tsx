import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushOutbox, pendingCount } from '@/lib/api';
import {
  getSyncState,
  listConflicts,
  onSyncState,
  setSyncState,
  type ConflictItem,
  type SyncState,
} from '@/lib/offline';

interface SyncValue {
  state: SyncState;
  pending: number;
  conflicts: ConflictItem[];
  online: boolean;
  lastSyncedAt: number | null;
  syncNow: () => Promise<void>;
  refreshConflicts: () => Promise<void>;
}

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SyncState>(getSyncState().state);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const running = useRef(false);

  const refreshConflicts = useCallback(async () => {
    setConflicts(await listConflicts());
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current) return;
    if (!navigator.onLine) {
      setSyncState('offline');
      return;
    }
    running.current = true;
    try {
      const result = await flushOutbox();
      setLastSyncedAt(Date.now());
      if (result.failed > 0) await refreshConflicts();
      const count = await pendingCount();
      setPending(count);
    } catch {
      setSyncState('error');
    } finally {
      running.current = false;
    }
  }, [refreshConflicts]);

  useEffect(() => {
    const off = onSyncState((next, count) => {
      setState(next);
      setPending(count);
    });
    return off;
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const goOffline = () => {
      setOnline(false);
      setSyncState('offline');
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [syncNow]);

  useEffect(() => {
    void (async () => {
      const count = await pendingCount();
      setPending(count);
      await refreshConflicts();
      if (count > 0) void syncNow();
    })();
    const timer = setInterval(() => {
      void (async () => {
        if ((await pendingCount()) > 0) await syncNow();
      })();
    }, 45_000);
    return () => clearInterval(timer);
  }, [syncNow, refreshConflicts]);

  return (
    <SyncContext.Provider
      value={{ state, pending, conflicts, online, lastSyncedAt, syncNow, refreshConflicts }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
