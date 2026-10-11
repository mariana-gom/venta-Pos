import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate,admin,createUser,login,hashPassword,publicUser } from './auth.js';
import { id,now,audit,transaction,BUSINESS_FIELDS } from './db.js';
import { schemas,validate } from './validation.js';
import { money,quantity,scaled } from './money.js';
import { sessionFor,totals,recordSale,saleDetail,closeSession,closureDetail,fail,SESSION_NUMBER } from './service.js';
import {storedPdf,generateDocuments} from './documents.js';
export function createApp(db) {
 const app=express();app.disable('x-powered-by');app.use(helmet());
 // Detrás de un proxy (Railway, Render, Nginx) indica cuántos saltos confiar para que el límite de login use la IP real.
 if(process.env.TRUST_PROXY)app.set('trust proxy',/^\d+$/.test(process.env.TRUST_PROXY)?Number(process.env.TRUST_PROXY):process.env.TRUST_PROXY);
 const origins=(process.env.CORS_ORIGINS||'http://localhost:8097,http://127.0.0.1:8097').split(',').map(s=>s.trim());
 app.use((req,res,next)=>{
  const origin=req.headers.origin;
  if(origin){if(!origins.includes(origin))return res.status(403).json({error:'Origen web no autorizado.'});res.set('Access-Control-Allow-Origin',origin).vary('Origin');res.set('Access-Control-Allow-Headers','Authorization,Content-Type');res.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');}
  if(req.method==='OPTIONS')return res.sendStatus(204);next();
 });
 app.use(express.json({limit:'64kb'}));
 const noCache=(req,res,next)=>{res.set('Cache-Control','no-store');next();};app.use(noCache);
 app.get('/health',(_,res)=>res.json({ok:true}));
 app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Espera 15 minutos.'}}),validate(schemas.login),async(req,res)=>res.json(await login(db,req.input.username,req.input.password)));
 app.use('/api',authenticate(db));
 app.get('/api/me',(req,res)=>res.json(req.user));
 app.post('/api/auth/logout',(req,res)=>{db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(req.tokenHash);audit(db,req.user.id,'auth.logout',req.user.id);res.json({ok:true});});
 app.get('/api/users',admin,(_,res)=>res.json(db.prepare('SELECT id,name,username,role,active FROM users ORDER BY name').all()));
 app.post('/api/users',admin,validate(schemas.user),async(req,res)=>res.status(201).json(await createUser(db,req.input,req.user.id)));
 app.patch('/api/users/:id',admin,validate(schemas.userStatus),(req,res)=>res.json(transaction(db,()=>{
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);if(!u) fail(404,'Usuario no encontrado.');
  if(u.id===req.user.id && !req.input.active) fail(400,'No puedes desactivar tu propia cuenta.');
  db.prepare('UPDATE users SET active=? WHERE id=?').run(Number(req.input.active),u.id);
  if(!req.input.active) db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(u.id);
  audit(db,req.user.id,'user.status',u.id,req.input);return {...publicUser(u),active:Number(req.input.active)};
 })));
 app.post('/api/users/:id/password',admin,validate(schemas.password),async(req,res)=>{
  const u=db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);if(!u) fail(404,'Usuario no encontrado.');
  const hash=await hashPassword(req.input.password);
  transaction(db,()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,u.id);db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(u.id);audit(db,req.user.id,'user.password_reset',u.id);});res.json({ok:true});
 });
 const settingsQuery=`SELECT business_name,paper_width,${BUSINESS_FIELDS.join(',')} FROM settings WHERE id=1`;
 app.get('/api/settings',(_,res)=>res.json(db.prepare(settingsQuery).get()));
 app.put('/api/settings',admin,validate(schemas.settings),(req,res)=>{
  // Campos fiscales omitidos conservan su valor; una cadena vacía los borra del comprobante.
  const fields=BUSINESS_FIELDS.filter(f=>req.input[f]!==undefined);
  const result=transaction(db,()=>{db.prepare(`UPDATE settings SET business_name=?,paper_width=?${fields.map(f=>`,${f}=?`).join('')} WHERE id=1`).run(req.input.business_name,req.input.paper_width,...fields.map(f=>req.input[f]));audit(db,req.user.id,'settings.update','1',req.input);return db.prepare(settingsQuery).get();});res.json(result);
 });
 app.get('/api/products',(req,res)=>res.json(db.prepare(`SELECT * FROM products ${req.user.role==='admin'?'': 'WHERE active=1'} ORDER BY name`).all()));
 const saveProduct=(req,res)=>res.json(transaction(db,()=>{
  const p=req.input;const productId=req.params.id||id();const previous=req.params.id?db.prepare('SELECT * FROM products WHERE id=?').get(productId):null;
  if(req.params.id&&!previous) fail(404,'Producto no encontrado.');
  if(previous && previous.unit!==p.unit && db.prepare('SELECT id FROM sale_items WHERE product_id=?').get(productId)) fail(409,'Un producto con ventas conserva su unidad de medida. Crea otro producto.');
  const price=money(p.price);if(price<=0) fail(400,'El precio debe ser mayor a cero.');
  const stock=p.stock===null?null:(scaled(p.stock,3,'Existencias')===0?0:quantity(p.stock,p.unit)); const updated=now();
  db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_cents=excluded.price_cents,unit=excluded.unit,active=excluded.active,stock_milli=excluded.stock_milli,updated_at=excluded.updated_at').run(productId,p.name,price,p.unit,Number(p.active),stock,previous?.created_at||updated,updated);
  audit(db,req.user.id,previous?'product.update':'product.create',productId,{before:previous,after:{...p,price_cents:price,stock_milli:stock}});
  return db.prepare('SELECT * FROM products WHERE id=?').get(productId);
 }));
 app.post('/api/products',admin,validate(schemas.product),saveProduct);app.put('/api/products/:id',admin,validate(schemas.product),saveProduct);
 app.delete('/api/products/:id',admin,(req,res)=>{
  transaction(db,()=>{if(!db.prepare('SELECT id FROM products WHERE id=?').get(req.params.id))fail(404,'Producto no encontrado.');db.prepare('UPDATE products SET active=0,updated_at=? WHERE id=?').run(now(),req.params.id);audit(db,req.user.id,'product.deactivate',req.params.id);});res.json({ok:true,message:'Producto desactivado; historial conservado.'});
 });
 app.get('/api/customers',(req,res)=>{const search=String(req.query.search||'').slice(0,120);res.json(db.prepare(`SELECT * FROM customers WHERE active=1 AND instr(lower(name),lower(?))>0 ORDER BY name`).all(search));});
 app.post('/api/customers',validate(schemas.customer),(req,res)=>res.status(201).json(transaction(db,()=>{
  const p=req.input;const existing=db.prepare('SELECT * FROM customers WHERE name=? COLLATE NOCASE AND city=? COLLATE NOCASE AND active=1').get(p.name,p.city);if(existing)return existing;
  const customerId=id();const created=now();db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(customerId,p.name,p.city,1,created,created);audit(db,req.user.id,'customer.create',customerId,p);return db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
 })));
 app.put('/api/customers/:id',admin,validate(schemas.customer),(req,res)=>res.json(transaction(db,()=>{
  if(!db.prepare('SELECT id FROM customers WHERE id=? AND active=1').get(req.params.id)) fail(404,'Cliente no encontrado.');
  db.prepare('UPDATE customers SET name=?,city=?,updated_at=? WHERE id=?').run(req.input.name,req.input.city,now(),req.params.id);audit(db,req.user.id,'customer.update',req.params.id,req.input);return db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
 })));
 app.delete('/api/customers/:id',admin,(req,res)=>{
  transaction(db,()=>{if(!db.prepare('SELECT id FROM customers WHERE id=?').get(req.params.id))fail(404,'Cliente no encontrado.');db.prepare('UPDATE customers SET active=0,updated_at=? WHERE id=?').run(now(),req.params.id);audit(db,req.user.id,'customer.deactivate',req.params.id);});res.json({ok:true});
 });
 app.get('/api/platforms',(req,res)=>res.json(db.prepare(`SELECT * FROM platforms ${req.user.role==='admin'?'':'WHERE active=1'} ORDER BY name`).all()));
 app.post('/api/platforms',admin,validate(schemas.platform),(req,res)=>res.status(201).json(transaction(db,()=>{
  const platformId=id();db.prepare('INSERT INTO platforms VALUES (?,?,?)').run(platformId,req.input.name,Number(req.input.active));audit(db,req.user.id,'platform.create',platformId,req.input);return {id:platformId,...req.input};
 })));
 app.put('/api/platforms/:id',admin,validate(schemas.platform),(req,res)=>{
  transaction(db,()=>{if(!db.prepare('SELECT id FROM platforms WHERE id=?').get(req.params.id))fail(404,'Plataforma no encontrada.');db.prepare('UPDATE platforms SET name=?,active=? WHERE id=?').run(req.input.name,Number(req.input.active),req.params.id);audit(db,req.user.id,'platform.update',req.params.id,req.input);});res.json({id:req.params.id,...req.input});
 });
 app.get('/api/cash-sessions',(req,res)=>{
  const columns=`c.*,u.name AS opener_name,${SESSION_NUMBER} AS number`;
  const rows=req.user.role==='admin'?db.prepare(`SELECT ${columns} FROM cash_sessions c JOIN users u ON u.id=c.opened_by ORDER BY c.opened_at DESC`).all():db.prepare(`SELECT ${columns} FROM cash_sessions c JOIN users u ON u.id=c.opened_by WHERE c.opened_by=? ORDER BY c.opened_at DESC`).all(req.user.id);
  res.json(rows.map(c=>({...c,...totals(db,c.id)})));
 });
 app.post('/api/cash-sessions',validate(schemas.opening),(req,res)=>res.status(201).json(transaction(db,()=>{
  if(db.prepare("SELECT id FROM cash_sessions WHERE opened_by=? AND state='open'").get(req.user.id))fail(409,'Ya tienes una caja abierta.');
  const sessionId=id();db.prepare('INSERT INTO cash_sessions VALUES (?,?,?,?,?,?)').run(sessionId,req.user.id,now(),money(req.input.opening),'open',null);audit(db,req.user.id,'cash.open',sessionId,req.input);return sessionFor(db,req.user,sessionId);
 })));
 app.get('/api/cash-sessions/:id',(req,res)=>{const session=sessionFor(db,req.user,req.params.id);const computed=totals(db,session.id);res.json({...session,...computed,expected_cash_cents:session.opening_cents+computed.cash_cents,closure_id:db.prepare('SELECT id FROM closures WHERE session_id=?').get(session.id)?.id||null});});
 app.post('/api/sales',validate(schemas.sale),async(req,res)=>{const sale=recordSale(db,req.user,req.input);res.status(201).json({...sale,...await generateDocuments(db,'sale',sale)});});
 app.get('/api/sales',(req,res)=>{
  const filter=z.object({session_id:z.string().uuid().optional(),seller_id:z.string().uuid().optional(),customer_id:z.string().uuid().optional(),method:z.enum(['cash','electronic']).optional(),from:z.iso.date().optional(),to:z.iso.date().optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).safeParse(req.query);
  if(!filter.success)fail(400,'Filtros inválidos.');const f=filter.data;const where=[],params=[];
  if(req.user.role!=='admin'){where.push('s.seller_id=?');params.push(req.user.id);}
  for(const key of ['session_id','seller_id','customer_id']) if(f[key]){where.push(`s.${key}=?`);params.push(f[key]);}
  if(f.method){where.push('p.method=?');params.push(f.method);}
  if(f.from){where.push('s.created_at>=?');params.push(`${f.from}T05:00:00.000Z`);}
  if(f.to){const date=new Date(`${f.to}T05:00:00.000Z`);date.setUTCDate(date.getUTCDate()+1);where.push('s.created_at<?');params.push(date.toISOString());}
  const base=`FROM sales s JOIN payments p ON p.sale_id=s.id ${where.length?'WHERE '+where.join(' AND '):''}`;
  const count=db.prepare(`SELECT COUNT(DISTINCT s.id) AS n ${base}`).get(...params).n;
  const rows=db.prepare(`SELECT s.*,p.method,p.platform_name ${base} ORDER BY s.created_at DESC LIMIT 50 OFFSET ?`).all(...params,(f.page-1)*50).map(s=>({...s,snapshot:JSON.parse(s.snapshot)}));
  // Primera versión: un pago por venta. Modelo de pagos permite ampliación a varios.
  const groups={};for(const [key,expr] of Object.entries({seller:'s.seller_id',customer:'s.customer_id',date:"date(s.created_at,'-5 hours')",method:'p.method',platform:'p.platform_name'}))groups[key]=db.prepare(`SELECT ${expr} AS key,COUNT(*) AS count,SUM(p.amount_cents) AS total_cents ${base} GROUP BY ${expr}`).all(...params);
  res.json({sales:rows,count,page:f.page,groups});
 });
 app.get('/api/sales/:id',(req,res)=>res.json(saleDetail(db,req.user,req.params.id)));
 app.get('/api/sales/:id/pdf',async(req,res)=>{
  const width=paperWidth(db,req.query.width);const sale=saleDetail(db,req.user,req.params.id);
  res.type('pdf').set('Content-Disposition',`inline; filename="venta-${sale.number}-${width}mm.pdf"`).send(await storedPdf(db,'sale',sale,width));
 });
 app.post('/api/cash-sessions/:id/close',admin,validate(schemas.closing),async(req,res)=>{const closure=closeSession(db,req.user,req.params.id,req.input);res.status(201).json({...closure,...await generateDocuments(db,'closure',closure)});});
 app.get('/api/closures',admin,(_,res)=>res.json(db.prepare(`SELECT cl.*,${SESSION_NUMBER} AS session_number FROM closures cl JOIN cash_sessions c ON c.id=cl.session_id ORDER BY cl.created_at DESC`).all().map(c=>({...c,snapshot:JSON.parse(c.snapshot)}))));
 app.get('/api/closures/:id',admin,(req,res)=>res.json(closureDetail(db,req.params.id)));
 app.post('/api/closures/:id/notes',admin,validate(schemas.note),(req,res)=>res.status(201).json(transaction(db,()=>{
  closureDetail(db,req.params.id);const noteId=id();db.prepare('INSERT INTO closure_notes VALUES (?,?,?,?,?)').run(noteId,req.params.id,req.user.id,req.input.note,now());audit(db,req.user.id,'closure.annotate',req.params.id,req.input);return closureDetail(db,req.params.id);
 })));
 app.get('/api/closures/:id/pdf',admin,async(req,res)=>{
  const width=paperWidth(db,req.query.width),closure=closureDetail(db,req.params.id);
  res.type('pdf').set('Content-Disposition',`inline; filename="cierre-${closure.number}-${width}mm.pdf"`).send(await storedPdf(db,'closure',closure,width));
 });
 // Avisos de ventas de ruta subidas tarde (precio distinto, stock insuficiente o caja ya cerrada).
 app.get('/api/alerts',admin,(_,res)=>res.json(db.prepare("SELECT a.id,a.entity_id AS sale_id,a.detail,a.created_at,u.name AS seller_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.action='sale.offline_alert' AND a.created_at>=? ORDER BY a.created_at DESC LIMIT 50").all(new Date(Date.now()-7*864e5).toISOString()).map(a=>({...a,detail:JSON.parse(a.detail)}))));
 app.get('/api/audit',admin,(_,res)=>res.json(db.prepare('SELECT a.*,u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 200').all()));
 app.use((req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  if(error.status)return res.status(error.status).json({error:error.message});
  if(error.code?.startsWith('ERR_SQLITE') && /UNIQUE/.test(error.message))return res.status(409).json({error:'Ya existe un registro con esos datos.'});
  console.error('Error de operación:',error.code||error.name,error.message);
  res.status(500).json({error:'No se pudo guardar o consultar la operación. Reintenta; si era una venta, conserva su referencia para evitar duplicados.'});
 });
 return app;
}
function paperWidth(db,value) {const width=value===undefined?db.prepare('SELECT paper_width FROM settings WHERE id=1').get().paper_width:Number(value);if(![58,80].includes(width))fail(400,'El ancho debe ser 58 u 80 mm.');return width;}
