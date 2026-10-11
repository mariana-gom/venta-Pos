// Celular: base SQLite local (transacciones atómicas; resiste cierres inesperados de la app).
import * as SQLite from 'expo-sqlite';
let db: SQLite.SQLiteDatabase | null = null;
async function open() {
  if (!db) { db = await SQLite.openDatabaseAsync('pos-local.db'); await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);'); }
  return db;
}
export async function read<T>(key: string): Promise<T | null> {
  try { const row = await (await open()).getFirstAsync<{value: string}>('SELECT value FROM kv WHERE key=?', key); return row ? JSON.parse(row.value) : null; } catch { return null; }
}
export async function write(key: string, value: unknown) {
  const d = await open();
  if (value === null) await d.runAsync('DELETE FROM kv WHERE key=?', key);
  else await d.runAsync('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}
