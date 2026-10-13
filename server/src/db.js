import {migrateOperations,migrateSimpleProducts,migrateRouteClosing} from './migrations.js';
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
 migrate(db);
 migrateOperations(db);
 migrateSimpleProducts(db);
 migrateRouteClosing(db);
 for (const table of ['sales','sale_items','payments','closures','closure_notes','audit','documents','debts','collections','collection_allocations','cancellations','allocation_resolutions','refunds','closure_adjustments','inventory_movements','route_assignments','import_runs','operation_requests','stock_loads','stock_load_items','route_journey_opening','route_stock_closures']) {
  for (const operation of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Registro inmutable'); END;`);
 }
 return db;
}
export const DEFAULT_BUSINESS_NAME = "DISTRIBUIDORA & SALSAMENTARIA DANNY'S";
// Datos opcionales del comprobante. Se agregan sin tocar filas existentes; vacío = no se imprime.
export const BUSINESS_FIELDS = ['business_nit','business_address','business_phone','business_city'];
function migrate(db) {
 const columns = new Set(db.prepare('PRAGMA table_info(settings)').all().map(c => c.name));
 for (const field of BUSINESS_FIELDS) if (!columns.has(field)) db.exec(`ALTER TABLE settings ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
 // Solo reemplaza el nombre genérico inicial; un nombre configurado por el administrador se respeta.
 db.prepare("UPDATE settings SET business_name=? WHERE id=1 AND business_name='Mi negocio'").run(DEFAULT_BUSINESS_NAME);
}
export function transaction(db, fn) {
 db.exec('BEGIN IMMEDIATE');
 try { const result = fn(); db.exec('COMMIT'); return result; }
 catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function audit(db, actor, action, entity, detail = {}) {
 db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?)').run(id(), actor, action, entity, JSON.stringify(detail), now());
}
