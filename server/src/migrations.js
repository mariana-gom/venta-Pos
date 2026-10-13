import {randomUUID} from 'node:crypto';
// Ejecutado una vez al iniciar, antes de aceptar peticiones. Nunca modifica facturas o cierres existentes.
export function migrateSimpleProducts(db) {
 if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get())return;
 db.exec('BEGIN IMMEDIATE');
 try {
  db.exec(`
   ALTER TABLE products ADD COLUMN central_stock_enabled INTEGER NOT NULL DEFAULT 0 CHECK(central_stock_enabled IN (0,1));
   UPDATE products SET central_stock_enabled=1 WHERE id IN (SELECT product_id FROM unassigned_stock);
   CREATE TABLE product_price_reviews(product_id TEXT PRIMARY KEY REFERENCES products(id),normal_price_cents INTEGER,wholesale_price_cents INTEGER,reviewed_at TEXT,actor_id TEXT REFERENCES users(id),chosen_price_cents INTEGER);
   INSERT INTO product_price_reviews(product_id,normal_price_cents,wholesale_price_cents) SELECT id,price_cents,wholesale_price_cents FROM products WHERE wholesale_price_cents IS NOT NULL;
   CREATE TABLE stock_loads(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),load_date TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,reason TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE);
   CREATE TABLE stock_load_items(load_id TEXT NOT NULL REFERENCES stock_loads(id),product_id TEXT NOT NULL REFERENCES products(id),quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),before_milli INTEGER NOT NULL,after_milli INTEGER NOT NULL,source TEXT NOT NULL CHECK(source IN ('central','entry')),PRIMARY KEY(load_id,product_id));
   ALTER TABLE inventory_movements ADD COLUMN load_id TEXT REFERENCES stock_loads(id);
   ALTER TABLE inventory_movements ADD COLUMN effective_date TEXT;
   DROP INDEX IF EXISTS customer_identification;
   INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Referencias inválidas en la migración.');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
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

export function migrateRouteClosing(db){
 if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=4').get())return;
 db.exec('BEGIN IMMEDIATE');try{
  db.exec(`
   DROP TRIGGER IF EXISTS session_transition;
   ALTER TABLE cash_sessions ADD COLUMN route_id TEXT REFERENCES routes(id);
   ALTER TABLE cash_sessions ADD COLUMN close_state TEXT NOT NULL DEFAULT 'active' CHECK(close_state IN ('active','preparing'));
   ALTER TABLE cash_sessions ADD COLUMN close_epoch INTEGER NOT NULL DEFAULT 0;
   UPDATE cash_sessions SET route_id=(SELECT route_id FROM users WHERE id=cash_sessions.opened_by) WHERE state='open';
   CREATE TABLE route_journeys(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),session_id TEXT REFERENCES cash_sessions(id),opened_at TEXT NOT NULL,start_movement_rowid INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('open','closed')),closed_at TEXT);
   CREATE UNIQUE INDEX one_route_journey ON route_journeys(route_id) WHERE state='open';
   CREATE TABLE route_journey_opening(journey_id TEXT NOT NULL REFERENCES route_journeys(id),product_id TEXT NOT NULL REFERENCES products(id),quantity_milli INTEGER NOT NULL CHECK(quantity_milli>=0),PRIMARY KEY(journey_id,product_id));
   CREATE TABLE route_stock_closures(closure_id TEXT PRIMARY KEY REFERENCES closures(id),journey_id TEXT NOT NULL UNIQUE REFERENCES route_journeys(id),route_id TEXT NOT NULL REFERENCES routes(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,detail TEXT NOT NULL);
   ALTER TABLE inventory_movements ADD COLUMN closure_id TEXT REFERENCES closures(id);
   CREATE TABLE session_devices(session_id TEXT NOT NULL REFERENCES cash_sessions(id),device_id TEXT NOT NULL,ack_epoch INTEGER,pending_count INTEGER NOT NULL CHECK(pending_count>=0),last_seen TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(session_id,device_id));
   INSERT INTO session_devices SELECT id,'legacy',NULL,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),opened_by FROM cash_sessions WHERE state='open';
   CREATE TRIGGER session_transition BEFORE UPDATE ON cash_sessions BEGIN
    SELECT CASE WHEN OLD.state!='open' OR NEW.id!=OLD.id OR NEW.opened_by!=OLD.opened_by OR NEW.opened_at!=OLD.opened_at OR NEW.opening_cents!=OLD.opening_cents
    OR (NEW.state='open' AND NEW.closed_at IS NOT NULL)
    OR (NEW.state='closed' AND (NEW.closed_at IS NULL OR NOT EXISTS(SELECT 1 FROM closures WHERE session_id=OLD.id)))
    OR (OLD.route_id IS NOT NULL AND NEW.route_id IS NOT OLD.route_id)
    OR NEW.close_epoch<OLD.close_epoch OR NEW.close_epoch>OLD.close_epoch+1
    THEN RAISE(ABORT,'Transición de caja inválida') END;
   END;
   INSERT INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  // Reconstruye la jornada de las cajas abiertas y conserva sobrantes anteriores como apertura, sin modificar movimientos.
  const stamp=new Date().toISOString(),latestMovement=db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM inventory_movements').get().n;
  for(const r of db.prepare("SELECT id FROM routes WHERE EXISTS(SELECT 1 FROM route_stock WHERE route_id=routes.id)").all()){
   const jid=randomUUID(),sessions=db.prepare("SELECT id,opened_at FROM cash_sessions WHERE route_id=? AND state='open' ORDER BY opened_at").all(r.id);
   const opened=sessions[0]?.opened_at||stamp,start=sessions.length?db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM inventory_movements WHERE created_at<?').get(opened).n:latestMovement;
   db.prepare('INSERT INTO route_journeys VALUES(?,?,?,?,?,?,?)').run(jid,r.id,sessions.length===1?sessions[0].id:null,opened,start,'open',null);
   for(const stock of db.prepare('SELECT * FROM route_stock WHERE route_id=?').all(r.id)){
    const changes=db.prepare('SELECT COALESCE(SUM(quantity_milli),0) n FROM inventory_movements WHERE route_id=? AND product_id=? AND rowid>?').get(r.id,stock.product_id,start).n;
    const opening=stock.quantity_milli-changes;if(opening<0)throw new Error('No se puede reconstruir la apertura del stock de esta ruta.');
    db.prepare('INSERT INTO route_journey_opening VALUES(?,?,?)').run(jid,stock.product_id,opening);
   }
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Referencias inválidas en migración de cierre de ruta.');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
