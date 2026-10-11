import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function openDatabase(path = process.env.DATABASE_PATH || './data/pos.sqlite') {
 if (path !== ':memory:') mkdirSync(dirname(resolve(path)), {recursive:true});
 const db = new DatabaseSync(path);
 db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
 for (const table of ['sales','sale_items','payments','closures','closure_notes','audit','documents']) {
  for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Registro inmutable'); END;`);
 }
 return db;
}
export function transaction(db, fn) {
 db.exec('BEGIN IMMEDIATE');
 try { const result = fn(); db.exec('COMMIT'); return result; }
 catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function audit(db, actor, action, entity, detail = {}) {
 db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(id(), actor, action, entity, JSON.stringify(detail), now());
}
