// Ejecutado una vez al iniciar, antes de aceptar peticiones. Nunca modifica facturas o cierres existentes.
export function migrateOperations(db) {
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
 if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get())return;
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try {
  db.exec(`
   CREATE TABLE products_new (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,price_cents INTEGER CHECK(price_cents>0),unit TEXT CHECK(unit IN ('unit','kg')),
    active INTEGER NOT NULL CHECK(active IN (0,1)),stock_milli INTEGER CHECK(stock_milli>=0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    code TEXT UNIQUE,category TEXT NOT NULL DEFAULT '',brand TEXT NOT NULL DEFAULT '',wholesale_price_cents INTEGER CHECK(wholesale_price_cents>=0),
    CHECK(active=0 OR (price_cents IS NOT NULL AND unit IS NOT NULL))
   );
   INSERT INTO products_new(id,name,price_cents,unit,active,stock_milli,created_at,updated_at) SELECT * FROM products;
   DROP TABLE products; ALTER TABLE products_new RENAME TO products;
   DROP TRIGGER IF EXISTS payments_no_UPDATE; DROP TRIGGER IF EXISTS payments_no_DELETE;
   CREATE TABLE payments_new (
    id TEXT PRIMARY KEY,sale_id TEXT NOT NULL REFERENCES sales(id),method TEXT NOT NULL CHECK(method IN ('cash','electronic','credit')),
    platform_id TEXT REFERENCES platforms(id),platform_name TEXT,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),reference TEXT,
    CHECK((method IN ('cash','credit') AND platform_id IS NULL AND reference IS NULL) OR (method='electronic' AND platform_id IS NOT NULL))
   );
   INSERT INTO payments_new(id,sale_id,method,platform_id,platform_name,amount_cents) SELECT * FROM payments;
   DROP TABLE payments; ALTER TABLE payments_new RENAME TO payments;
   CREATE TABLE routes(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,active INTEGER NOT NULL CHECK(active IN (0,1)),created_at TEXT NOT NULL);
   ALTER TABLE users ADD COLUMN route_id TEXT REFERENCES routes(id);
   ALTER TABLE customers ADD COLUMN identification TEXT NOT NULL DEFAULT '';
   CREATE UNIQUE INDEX customer_identification ON customers(identification) WHERE identification<>'';
   ALTER TABLE sales ADD COLUMN route_id TEXT REFERENCES routes(id);
   ALTER TABLE sales ADD COLUMN inventory_version INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE route_assignments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),route_id TEXT REFERENCES routes(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
   CREATE TABLE route_stock(product_id TEXT NOT NULL REFERENCES products(id),route_id TEXT NOT NULL REFERENCES routes(id),quantity_milli INTEGER NOT NULL CHECK(quantity_milli>=0),PRIMARY KEY(product_id,route_id));
   CREATE TABLE unassigned_stock(product_id TEXT PRIMARY KEY REFERENCES products(id),quantity_milli INTEGER NOT NULL CHECK(quantity_milli>=0));
   INSERT INTO unassigned_stock SELECT id,stock_milli FROM products WHERE stock_milli IS NOT NULL;
   CREATE TABLE inventory_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),route_id TEXT REFERENCES routes(id),quantity_milli INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('migration','entry','adjustment','allocation','sale','return')),actor_id TEXT REFERENCES users(id),created_at TEXT NOT NULL,reason TEXT NOT NULL,sale_id TEXT REFERENCES sales(id),request_key TEXT);
   INSERT INTO inventory_movements SELECT lower(hex(randomblob(16))),id,NULL,stock_milli,'migration',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'Saldo inicial sin asignar',NULL,NULL FROM products WHERE stock_milli IS NOT NULL;
   CREATE TABLE debts(sale_id TEXT PRIMARY KEY REFERENCES sales(id),customer_id TEXT NOT NULL REFERENCES customers(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),created_at TEXT NOT NULL);
   CREATE TABLE collections(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL CHECK(method IN ('cash','electronic')),platform_id TEXT REFERENCES platforms(id),platform_name TEXT,reference TEXT,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,received_by TEXT NOT NULL REFERENCES users(id),session_id TEXT REFERENCES cash_sessions(id),outside_cash_reason TEXT,observation TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,CHECK((session_id IS NOT NULL AND outside_cash_reason IS NULL) OR (session_id IS NULL AND length(outside_cash_reason)>0)),CHECK((method='cash' AND reference IS NULL AND platform_id IS NULL) OR (method='electronic' AND length(reference)>0 AND platform_id IS NOT NULL)));
   CREATE TABLE collection_allocations(id TEXT PRIMARY KEY,collection_id TEXT NOT NULL REFERENCES collections(id),sale_id TEXT NOT NULL REFERENCES debts(sale_id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),UNIQUE(collection_id,sale_id));
   CREATE TABLE cancellations(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,reason TEXT NOT NULL,original_session_id TEXT NOT NULL REFERENCES cash_sessions(id),session_was_closed INTEGER NOT NULL CHECK(session_was_closed IN (0,1)),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,resolution TEXT NOT NULL);
   CREATE TABLE allocation_resolutions(id TEXT PRIMARY KEY,cancellation_id TEXT NOT NULL REFERENCES cancellations(id),allocation_id TEXT NOT NULL REFERENCES collection_allocations(id),source_sale_id TEXT NOT NULL REFERENCES debts(sale_id),target_sale_id TEXT REFERENCES debts(sale_id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),kind TEXT NOT NULL CHECK(kind IN ('refund','reassign')),created_at TEXT NOT NULL,UNIQUE(allocation_id,source_sale_id));
   CREATE TABLE refunds(id TEXT PRIMARY KEY,cancellation_id TEXT NOT NULL REFERENCES cancellations(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL CHECK(method IN ('cash','electronic')),platform_id TEXT REFERENCES platforms(id),reference TEXT,actor_id TEXT NOT NULL REFERENCES users(id),session_id TEXT REFERENCES cash_sessions(id),outside_cash_reason TEXT,created_at TEXT NOT NULL,CHECK((session_id IS NOT NULL AND outside_cash_reason IS NULL) OR (session_id IS NULL AND length(outside_cash_reason)>0)),CHECK((method='cash' AND reference IS NULL AND platform_id IS NULL) OR (method='electronic' AND length(reference)>0 AND platform_id IS NOT NULL)));
   CREATE TABLE closure_adjustments(id TEXT PRIMARY KEY,closure_id TEXT NOT NULL REFERENCES closures(id),cancellation_id TEXT NOT NULL UNIQUE REFERENCES cancellations(id),created_at TEXT NOT NULL,detail TEXT NOT NULL);
   CREATE TABLE import_previews(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,file_hash TEXT NOT NULL,preview TEXT NOT NULL,expires_at TEXT NOT NULL);
   CREATE TABLE import_runs(id TEXT PRIMARY KEY,preview_id TEXT NOT NULL UNIQUE REFERENCES import_previews(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,result TEXT NOT NULL);
   CREATE TABLE operation_requests(request_key TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL);
   CREATE INDEX sales_owner_day ON sales(seller_id,created_at);
   CREATE INDEX allocations_debt ON collection_allocations(sale_id);
   CREATE INDEX collections_session ON collections(session_id,created_at);
  `);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La migración encontró referencias inválidas.');
  db.prepare('INSERT INTO schema_migrations VALUES(2,?)').run(new Date().toISOString());db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.exec('PRAGMA foreign_keys=ON');}
}
