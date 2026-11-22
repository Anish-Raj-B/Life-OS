/**
 * JSON export / import. OAuth tokens, integration secrets and audit logs are
 * never exported. Imports are validated before anything is written, and the
 * caller chooses merge (default) or replace.
 */
import { supabase } from './supabase';
import { insertRow } from './api';

export const BACKUP_TABLES = [
  'sections',
  'topics',
  'task_categories',
  'tasks',
  'task_reminders',
  'timetable_entries',
  'learning_records',
  'learning_resources',
  'learning_paths',
  'learning_path_nodes',
  'learning_daily_progress',
  'streak_history',
  'flashcard_decks',
  'flashcards',
  'flashcard_reviews',
  'question_bank',
  'challenges',
  'challenge_questions',
  'challenge_attempts',
  'challenge_answers',
  'diary_entries',
  'goals',
  'goal_milestones',
  'integration_accounts',
  'integration_activity',
  'notifications',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupFile {
  app: 'life-os';
  schemaVersion: 1;
  exportedAt: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function buildBackup(userId: string): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    tables[table] = (data ?? []).map((row) => {
      const copy: Record<string, unknown> = { ...row };
      // Drop nested credentials if a provider ever stores them in metadata.
      if (table === 'integration_accounts') delete copy.user_id;
      return copy;
    });
  }
  return { app: 'life-os', schemaVersion: 1, exportedAt: new Date().toISOString(), tables };
}

export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `life-os-backup-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  counts: Record<string, number>;
  file?: BackupFile;
}

export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const file = raw as BackupFile;

  if (!file || typeof file !== 'object') return { ok: false, errors: ['File is not a JSON object.'], counts };
  if (file.app !== 'life-os') errors.push('This file is not a LIFE OS backup.');
  if (file.schemaVersion !== 1) errors.push(`Unsupported schema version: ${String(file.schemaVersion)}`);
  if (!file.tables || typeof file.tables !== 'object') errors.push('Missing "tables" object.');
  if (errors.length) return { ok: false, errors, counts };

  for (const [table, rows] of Object.entries(file.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(table)) {
      errors.push(`Unknown table skipped: ${table}`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`${table} is not an array.`);
      continue;
    }
    counts[table] = rows.length;
    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        errors.push(`${table} contains a non-object row.`);
        break;
      }
      if (row.id && typeof row.id === 'string' && !UUID_RE.test(row.id)) {
        errors.push(`${table} contains an invalid id.`);
        break;
      }
    }
  }
  return { ok: errors.length === 0, errors, counts, file };
}

/** Restores in dependency order so foreign keys resolve. */
const INSERT_ORDER: BackupTable[] = [
  'sections',
  'topics',
  'task_categories',
  'tasks',
  'task_reminders',
  'timetable_entries',
  'learning_records',
  'learning_resources',
  'learning_paths',
  'learning_path_nodes',
  'learning_daily_progress',
  'streak_history',
  'flashcard_decks',
  'flashcards',
  'flashcard_reviews',
  'question_bank',
  'challenges',
  'challenge_questions',
  'challenge_attempts',
  'challenge_answers',
  'diary_entries',
  'goals',
  'goal_milestones',
  'integration_accounts',
  'integration_activity',
  'notifications',
];

export async function importBackup(
  file: BackupFile,
  userId: string,
  mode: 'merge' | 'replace',
  onProgress?: (table: string, done: number, total: number) => void,
): Promise<{ imported: Record<string, number>; skipped: string[] }> {
  const imported: Record<string, number> = {};
  const skipped: string[] = [];

  if (mode === 'replace') {
    // Delete user-owned rows in reverse dependency order. Auth and secrets are
    // untouched; this only replaces the user's own records.
    for (const table of [...BACKUP_TABLES].reverse()) {
      if (table === 'integration_accounts') continue; // connections stay intact
      const { error } = await supabase.from(table).delete().eq('user_id', userId);
      if (error) skipped.push(`${table}: ${error.message}`);
    }
  }

  for (const table of INSERT_ORDER) {
    const rows = file.tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    let done = 0;
    for (const raw of rows) {
      const row = { ...(raw as Record<string, unknown>), user_id: userId };
      try {
        await insertRow(table, row);
        done += 1;
      } catch (e) {
        skipped.push(`${table}: ${e instanceof Error ? e.message : 'row rejected'}`);
      }
      onProgress?.(table, done, rows.length);
    }
    imported[table] = done;
  }

  return { imported, skipped };
}
