/**
 * IndexedDB layer: offline cache for collections, an outbox of pending
 * mutations, and local drafts. Nothing here is authoritative — the server is.
 */
import { openDB, type IDBPDatabase } from 'idb';

export type MutationKind = 'insert' | 'update' | 'delete';

export interface OutboxItem {
  id: string;
  table: string;
  kind: MutationKind;
  payload: Record<string, any>;
  rowId?: string;
  expectedVersion?: number;
  createdAt: number;
  tries: number;
  lastError?: string;
}

export interface ConflictItem {
  id: string;
  table: string;
  rowId: string;
  message: string;
  localPayload: Record<string, any>;
  at: number;
}

export type SyncState = 'online' | 'offline' | 'pending' | 'syncing' | 'synced' | 'error';

const DB_NAME = 'life-os';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('cache')) {
          database.createObjectStore('cache', { keyPath: 'table' });
        }
        if (!database.objectStoreNames.contains('outbox')) {
          const store = database.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!database.objectStoreNames.contains('drafts')) {
          database.createObjectStore('drafts', { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains('conflicts')) {
          database.createObjectStore('conflicts', { keyPath: 'id' });
        }
      },
    });
  }
  return dbp;
}

export async function cacheCollection(table: string, rows: unknown[]): Promise<void> {
  try {
    const database = await db();
    await database.put('cache', { table, rows, at: Date.now() });
  } catch {
    /* storage unavailable — caching is best effort */
  }
}

export async function readCachedCollection<T>(table: string): Promise<T[] | null> {
  try {
    const database = await db();
    const entry = await database.get('cache', table);
    return entry ? (entry.rows as T[]) : null;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<void> {
  const database = await db();
  await database.clear('cache');
}

export async function enqueue(item: OutboxItem): Promise<void> {
  const database = await db();
  await database.put('outbox', item);
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const database = await db();
  const all = (await database.getAll('outbox')) as OutboxItem[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeOutbox(id: string): Promise<void> {
  const database = await db();
  await database.delete('outbox', id);
}

export async function patchOutbox(id: string, patch: Partial<OutboxItem>): Promise<void> {
  const database = await db();
  const current = (await database.get('outbox', id)) as OutboxItem | undefined;
  if (current) await database.put('outbox', { ...current, ...patch });
}

export async function addConflict(item: ConflictItem): Promise<void> {
  const database = await db();
  await database.put('conflicts', item);
}

export async function listConflicts(): Promise<ConflictItem[]> {
  const database = await db();
  return (await database.getAll('conflicts')) as ConflictItem[];
}

export async function clearConflicts(): Promise<void> {
  const database = await db();
  await database.clear('conflicts');
}

// ── drafts (autosave) ───────────────────────────────────────────────────────
export async function saveDraft(key: string, value: unknown): Promise<void> {
  try {
    const database = await db();
    await database.put('drafts', { key, value, at: Date.now() });
  } catch {
    /* ignore */
  }
}

export async function readDraft<T>(key: string): Promise<T | null> {
  try {
    const database = await db();
    const entry = await database.get('drafts', key);
    return entry ? (entry.value as T) : null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    const database = await db();
    await database.delete('drafts', key);
  } catch {
    /* ignore */
  }
}

// ── sync status bus ────────────────────────────────────────────────────────
type Listener = (state: SyncState, pending: number) => void;

let state: SyncState = navigator.onLine ? 'synced' : 'offline';
let pendingCount = 0;
const listeners = new Set<Listener>();

export function setSyncState(next: SyncState, pending = pendingCount) {
  state = next;
  pendingCount = pending;
  listeners.forEach((l) => l(state, pendingCount));
}

export function getSyncState(): { state: SyncState; pending: number } {
  return { state, pending: pendingCount };
}

export function onSyncState(listener: Listener): () => void {
  listeners.add(listener);
  listener(state, pendingCount);
  return () => listeners.delete(listener);
}
