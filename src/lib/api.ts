/**
 * Data access layer.
 *
 * Reads: fetch a whole collection (RLS already scopes rows to the signed-in
 * user), cache it in IndexedDB, and fall back to the cache when offline.
 *
 * Writes: applied on the server immediately; if the network is unavailable the
 * mutation is queued in the outbox and the UI shows it as pending until the
 * server confirms persistence.
 */
import { supabase, isNetworkError, errorMessage } from './supabase';
import {
  addConflict,
  cacheCollection,
  enqueue,
  listOutbox,
  patchOutbox,
  readCachedCollection,
  removeOutbox,
  setSyncState,
  type OutboxItem,
} from './offline';
import { uuid } from './utils';

type Row = Record<string, any>;

export interface ListOptions {
  order?: string;
  ascending?: boolean;
  limit?: number;
  select?: string;
}

const dataListeners = new Set<() => void>();

export function onDataChanged(fn: () => void): () => void {
  dataListeners.add(fn);
  return () => dataListeners.delete(fn);
}

export function notifyDataChanged() {
  dataListeners.forEach((fn) => fn());
}

export async function listRows<T>(table: string, opts: ListOptions = {}): Promise<{ data: T[]; fromCache: boolean }> {
  let query = supabase.from(table).select(opts.select ?? '*');
  if (opts.order) query = query.order(opts.order, { ascending: opts.ascending ?? false });
  if (opts.limit) query = query.limit(opts.limit);

  try {
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    void cacheCollection(table, rows);
    return { data: rows, fromCache: false };
  } catch (error) {
    const cached = await readCachedCollection<T>(table);
    if (cached) return { data: cached, fromCache: true };
    throw new Error(errorMessage(error, `Could not load ${table}.`));
  }
}

export interface MutationResult<T> {
  row: T;
  pending: boolean;
}

function offlinePayload(table: string, kind: string, payload: Row): Row {
  const now = new Date().toISOString();
  if (kind === 'insert') {
    return {
      id: payload.id ?? uuid(),
      created_at: payload.created_at ?? now,
      updated_at: now,
      version: payload.version ?? 1,
      user_id: payload.user_id,
      ...payload,
    };
  }
  return { ...payload, updated_at: now };
}

/**
 * Column map mirrored from supabase/migrations/0001_schema.sql. `offlinePayload`
 * stamps bookkeeping columns so a queued row is complete offline, but not every
 * table owns them (`flashcard_reviews` has only `reviewed_at`, `challenge_questions`
 * has no timestamps at all, and only some tables track `version`). Sending the
 * injected keys to Postgres raises “column does not exist”, so strip whatever the
 * table does not have before writing.
 */
const WITH_CREATED_AT = new Set([
  'profiles', 'user_settings', 'sections', 'topics', 'task_categories', 'task_tags',
  'tasks', 'task_reminders', 'timetable_entries', 'learning_records', 'learning_resources',
  'learning_paths', 'learning_path_nodes', 'streak_history', 'flashcard_decks', 'flashcards',
  'question_bank', 'challenges', 'challenge_answers', 'diary_entries', 'goals',
  'goal_milestones', 'integration_accounts', 'integration_activity', 'integration_sync_logs',
  'notifications', 'backup_records', 'audit_logs',
]);
const WITH_UPDATED_AT = new Set([
  'platform_settings', 'profiles', 'user_settings', 'sections', 'topics', 'tasks',
  'timetable_entries', 'learning_records', 'learning_resources', 'learning_paths',
  'learning_path_nodes', 'flashcard_decks', 'flashcards', 'question_bank', 'goals',
  'diary_entries', 'integration_accounts', 'integration_tokens',
]);
const WITH_VERSION = new Set([
  'profiles', 'sections', 'topics', 'tasks', 'timetable_entries', 'learning_records',
  'learning_resources', 'flashcard_decks', 'flashcards', 'diary_entries', 'goals',
]);

function sanitize(table: string, payload: Row): Row {
  const row = { ...payload };
  if (!WITH_CREATED_AT.has(table)) delete row.created_at;
  if (!WITH_UPDATED_AT.has(table)) delete row.updated_at;
  if (!WITH_VERSION.has(table)) delete row.version;
  return row;
}

async function queue(table: string, kind: OutboxItem['kind'], payload: Row, expectedVersion?: number) {
  const item: OutboxItem = {
    id: uuid(),
    table,
    kind,
    payload,
    rowId: payload.id,
    expectedVersion,
    createdAt: Date.now(),
    tries: 0,
  };
  await enqueue(item);
  const all = await listOutbox();
  setSyncState(navigator.onLine ? 'pending' : 'offline', all.length);
}

export async function insertRow<T extends Row>(table: string, payload: Row): Promise<MutationResult<T>> {
  const row = offlinePayload(table, 'insert', payload);
  try {
    const { data, error } = await supabase.from(table).insert(sanitize(table, row)).select().single();
    if (error) throw error;
    const saved = (data ?? row) as T;
    notifyDataChanged();
    return { row: saved, pending: false };
  } catch (error) {
    if (!isNetworkError(error)) throw new Error(errorMessage(error, 'Could not save.'));
    await queue(table, 'insert', row);
    return { row: row as T, pending: true };
  }
}

export async function updateRow<T extends Row>(
  table: string,
  id: string,
  changes: Row,
  expectedVersion?: number,
): Promise<MutationResult<T>> {
  const clean = sanitize(table, changes);
  try {
    const { data, error } = await supabase.from(table).update(clean).eq('id', id).select().single();
    if (error) throw error;
    notifyDataChanged();
    return { row: data as T, pending: false };
  } catch (error) {
    if (!isNetworkError(error)) throw new Error(errorMessage(error, 'Could not update.'));
    const payload = { ...clean, id };
    await queue(table, 'update', payload, expectedVersion);
    return { row: payload as unknown as T, pending: true };
  }
}

export async function deleteRow(table: string, id: string, soft = false): Promise<{ pending: boolean }> {
  try {
    const builder = soft
      ? supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id)
      : supabase.from(table).delete().eq('id', id);
    const { error } = await builder;
    if (error) throw error;
    notifyDataChanged();
    return { pending: false };
  } catch (error) {
    if (!isNetworkError(error)) throw new Error(errorMessage(error, 'Could not delete.'));
    await queue(table, soft ? 'update' : 'delete', soft ? { id, deleted_at: new Date().toISOString() } : { id });
    return { pending: true };
  }
}

/** Applies queued mutations in creation order. Called when connectivity returns. */
export async function flushOutbox(): Promise<{ flushed: number; failed: number }> {
  const items = await listOutbox();
  if (items.length === 0) {
    setSyncState(navigator.onLine ? 'synced' : 'offline', 0);
    return { flushed: 0, failed: 0 };
  }

  setSyncState('syncing', items.length);
  let flushed = 0;
  let failed = 0;

  for (const item of items) {
    try {
      if (item.kind === 'insert') {
        const { error } = await supabase.from(item.table).upsert(sanitize(item.table, item.payload), { onConflict: 'id' });
        if (error) throw error;
      } else if (item.kind === 'update') {
        if (item.expectedVersion !== undefined) {
          const { error } = await supabase
            .from(item.table)
            .update(sanitize(item.table, item.payload))
            .eq('id', item.rowId)
            .eq('version', item.expectedVersion);
          if (error) throw error;
        } else {
          const { error } = await supabase.from(item.table).update(sanitize(item.table, item.payload)).eq('id', item.rowId);
          if (error) throw error;
        }
      } else {
        const { error } = await supabase.from(item.table).delete().eq('id', item.rowId);
        if (error && error.code !== 'PGRST116') throw error;
      }
      await removeOutbox(item.id);
      flushed += 1;
    } catch (error) {
      if (isNetworkError(error)) {
        // Still offline: keep the queue intact and stop.
        setSyncState('offline', items.length - flushed);
        notifyDataChanged();
        return { flushed, failed: items.length - flushed };
      }

      // A real server rejection: record it, then drop the item so the queue
      // cannot wedge. Server state is never silently overwritten.
      const message = errorMessage(error, 'Rejected by server.');
      await patchOutbox(item.id, { tries: item.tries + 1, lastError: message });
      await addConflict({
        id: item.id,
        table: item.table,
        rowId: item.rowId ?? '',
        message,
        localPayload: item.payload,
        at: Date.now(),
      });
      await removeOutbox(item.id);
      failed += 1;
    }
  }

  setSyncState(failed ? 'error' : 'synced', 0);
  notifyDataChanged();
  return { flushed, failed };
}

export async function pendingCount(): Promise<number> {
  return (await listOutbox()).length;
}

// ── RPC wrappers ────────────────────────────────────────────────────────────
export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error, `RPC ${fn} failed.`));
  return data as T;
}

export async function invokeFunction<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(errorMessage(error, `Function ${name} failed.`));
  return data as T;
}
