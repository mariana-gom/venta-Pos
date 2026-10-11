PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','seller')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT NOT NULL, paper_width INTEGER NOT NULL CHECK(paper_width IN (58,80)));
INSERT OR IGNORE INTO settings (id,business_name,paper_width) VALUES (1,'Mi negocio',80);
CREATE TABLE IF NOT EXISTS products (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents>0),
 unit TEXT NOT NULL CHECK(unit IN ('unit','kg')), active INTEGER NOT NULL CHECK(active IN (0,1)),
 stock_milli INTEGER CHECK(stock_milli>=0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS platforms (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO platforms VALUES ('nequi','Nequi',1),('daviplata','Daviplata',1),('bank','Transferencia bancaria',1),('other','Otro medio electrónico',1);
CREATE TABLE IF NOT EXISTS cash_sessions (
 id TEXT PRIMARY KEY, opened_by TEXT NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL,
 opening_cents INTEGER NOT NULL CHECK(opening_cents>=0), state TEXT NOT NULL CHECK(state IN ('open','closed')), closed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON cash_sessions(opened_by) WHERE state='open';
CREATE TABLE IF NOT EXISTS sales (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES cash_sessions(id),
 seller_id TEXT NOT NULL REFERENCES users(id), customer_id TEXT NOT NULL REFERENCES customers(id),
 created_at TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(total_cents>0),
 snapshot TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(seller_id,request_key)
);
CREATE TABLE IF NOT EXISTS sale_items (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL REFERENCES products(id),
 name TEXT NOT NULL, unit TEXT NOT NULL CHECK(unit IN ('unit','kg')), quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),
 price_cents INTEGER NOT NULL CHECK(price_cents>0), subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>0)
);
CREATE TABLE IF NOT EXISTS payments (
 id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), method TEXT NOT NULL CHECK(method IN ('cash','electronic')),
 platform_id TEXT REFERENCES platforms(id), platform_name TEXT, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 CHECK((method='cash' AND platform_id IS NULL) OR (method='electronic' AND platform_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS closures (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, session_id TEXT NOT NULL UNIQUE REFERENCES cash_sessions(id),
 closed_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS closure_notes (
 id TEXT PRIMARY KEY, closure_id TEXT NOT NULL REFERENCES closures(id), author_id TEXT NOT NULL REFERENCES users(id),
 note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL,
 detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS sale_open BEFORE INSERT ON sales BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cash_sessions WHERE id=NEW.session_id AND state='open' AND opened_by=NEW.seller_id)
 THEN RAISE(ABORT,'Caja cerrada o ajena') END;
END;
CREATE TRIGGER IF NOT EXISTS close_admin BEFORE INSERT ON closures BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.closed_by AND role='admin' AND active=1)
 THEN RAISE(ABORT,'Cierre exclusivo del administrador') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cash_sessions WHERE id=NEW.session_id AND state='open')
 THEN RAISE(ABORT,'Caja cerrada') END;
END;
CREATE TRIGGER IF NOT EXISTS session_transition BEFORE UPDATE ON cash_sessions BEGIN
 SELECT CASE WHEN OLD.state!='open' OR NEW.state!='closed' OR NEW.closed_at IS NULL
 OR NEW.id!=OLD.id OR NEW.opened_by!=OLD.opened_by OR NEW.opened_at!=OLD.opened_at OR NEW.opening_cents!=OLD.opening_cents
 OR NOT EXISTS(SELECT 1 FROM closures WHERE session_id=OLD.id)
 THEN RAISE(ABORT,'Transición de caja inválida') END;
END;
CREATE TRIGGER IF NOT EXISTS session_no_delete BEFORE DELETE ON cash_sessions BEGIN SELECT RAISE(ABORT,'Historial permanente'); END;
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, sale_id TEXT REFERENCES sales(id), closure_id TEXT REFERENCES closures(id),
 width INTEGER NOT NULL CHECK(width IN (58,80)), content BLOB NOT NULL, created_at TEXT NOT NULL,
 CHECK((sale_id IS NULL) != (closure_id IS NULL)), UNIQUE(sale_id,width), UNIQUE(closure_id,width)
);
