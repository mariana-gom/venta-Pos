import { id, now, audit, transaction } from './db.js';
import { money, quantity, subtotal } from './money.js';
import { digest } from './auth.js';
import {canReadSale,saleAcknowledgement} from './sales-access.js';
export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
// Número corto y legible de caja (#1, #2…). Las cajas nunca se borran, así que el orden de inserción es estable.
export const SESSION_NUMBER='(SELECT COUNT(*) FROM cash_sessions x WHERE x.rowid<=c.rowid)';
const sessionNumber=(db,sessionId)=>db.prepare(`SELECT ${SESSION_NUMBER} AS n FROM cash_sessions c WHERE c.id=?`).get(sessionId)?.n??null;
export function sessionFor(db,user,sessionId) {
 const session=db.prepare(`SELECT c.*,u.name AS opener_name,${SESSION_NUMBER} AS number FROM cash_sessions c JOIN users u ON u.id=c.opened_by WHERE c.id=?`).get(sessionId);
 if(!session) fail(404,'Caja no encontrada.');
 if(user.role!=='admin' && session.opened_by!==user.id) fail(403,'No puedes acceder a una caja ajena.');
 return session;
}
export function totals(db,sessionId,day=null) {
 const scope=day?' AND s.created_at>=? AND s.created_at<?':'';const params=day?[sessionId,day.start,day.end]:[sessionId];
 const rows=db.prepare(`SELECT p.method,p.platform_id,p.platform_name,SUM(p.amount_cents) AS amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.session_id=?${scope} GROUP BY p.method,p.platform_id,p.platform_name`).all(...params);
 const cash=rows.filter(r=>r.method==='cash').reduce((a,r)=>a+r.amount,0);
 const electronic=rows.filter(r=>r.method==='electronic').reduce((a,r)=>a+r.amount,0);
 const count=db.prepare(`SELECT COUNT(*) AS n FROM sales s WHERE session_id=?${scope}`).get(...params).n;
 return {cash_cents:cash,electronic_cents:electronic,total_cents:cash+electronic,sale_count:count,platforms:rows.filter(r=>r.method==='electronic')};
}
export function saleDetail(db,user,saleId) {
 const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
 if(!sale) fail(404,'Venta no encontrada.');
 if(user.role!=='admin' && sale.seller_id!==user.id) fail(403,'No puedes consultar una venta ajena.');
 if(!canReadSale(user,sale)) fail(403,'Solo puedes consultar las ventas del día actual');
 return readSale(db,sale);
}
// Uso interno tras escribir una venta; no es una ruta de consulta.
function readSale(db,sale) {
 const saleId=sale.id;
 return {...sale,session_number:sessionNumber(db,sale.session_id),snapshot:JSON.parse(sale.snapshot),items:db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid').all(saleId),payments:db.prepare('SELECT * FROM payments WHERE sale_id=?').all(saleId)};
}
// Una venta que llega más de 2 minutos después de hecha viene de una ruta sin señal: ya ocurrió y se le entregó
// el producto al cliente. Reglas acordadas con el negocio: se respeta el precio con el que se vendió, se acepta aunque
// falte stock (queda en 0) y se avisa al administrador. Las ventas inmediatas siguen siendo estrictas.
export const LATE_SALE_MS=2*60*1000;
export function recordSale(db,user,input) {
 return transaction(db,()=>{
  const requestHash=digest(JSON.stringify(input));
  const existing=db.prepare('SELECT id,request_hash FROM sales WHERE seller_id=? AND request_key=?').get(user.id,input.request_key);
  if(existing) {if(existing.request_hash!==requestHash) fail(409,'Esta referencia ya fue usada para otra venta.');const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(existing.id);return canReadSale(user,sale)?readSale(db,sale):saleAcknowledgement(sale);}
  const received=Date.now();let created=new Date(received).toISOString(),late=false;
  if(input.sold_at){const t=Date.parse(input.sold_at);if(t<=received+10*60*1000){created=new Date(Math.min(t,received)).toISOString();late=received-t>LATE_SALE_MS;}}
  const alerts=[];
  let session=sessionFor(db,user,input.session_id);
  if(session.opened_by!==user.id) fail(403,'Solo el propietario puede vender en esta caja.');
  if(session.state!=='open') {
   if(!late) fail(409,'La caja está cerrada. Abre una nueva.');
   // La caja se cerró mientras el celular estaba sin señal: la venta entra en la caja abierta actual del vendedor.
   const open=db.prepare("SELECT id FROM cash_sessions WHERE opened_by=? AND state='open'").get(user.id);
   if(!open) fail(409,'La caja de esta venta ya se cerró. Abre una caja nueva para subir las ventas de ruta pendientes.');
   alerts.push({type:'session_moved',from_session:session.id});session=sessionFor(db,user,open.id);
  }
  let customer=db.prepare(`SELECT * FROM customers WHERE id=? ${late?'':'AND active=1'}`).get(input.customer_id);
  // Cliente creado en ruta sin señal: llega con la venta. Si ya existe con el mismo nombre y ciudad, se reutiliza.
  if(!customer&&input.new_customer&&input.new_customer.id===input.customer_id){
   const c=input.new_customer;
   customer=db.prepare('SELECT * FROM customers WHERE name=? COLLATE NOCASE AND city=? COLLATE NOCASE AND active=1').get(c.name,c.city);
   if(!customer){db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)').run(c.id,c.name,c.city,1,created,created);audit(db,user.id,'customer.create',c.id,{name:c.name,city:c.city,offline:true});customer=db.prepare('SELECT * FROM customers WHERE id=?').get(c.id);}
  }
  if(!customer) fail(400,'Selecciona un cliente activo.');
  let platform=null;
  if(input.method==='electronic') {
   platform=db.prepare(`SELECT * FROM platforms WHERE id=? ${late?'':'AND active=1'}`).get(input.platform_id||'');
   if(!platform) fail(400,'Selecciona una plataforma electrónica activa.');
  } else if(input.platform_id) fail(400,'Un pago en efectivo no debe tener plataforma.');
  const seen=new Set();
  const items=input.items.map(item=>{
   if(seen.has(item.product_id)) fail(400,'Agrupa la cantidad del producto repetido en una sola línea.');seen.add(item.product_id);
   const p=db.prepare(`SELECT * FROM products WHERE id=? ${late?'':'AND active=1'}`).get(item.product_id);
   if(!p) fail(400,'Uno de los productos no está disponible.');
   let price=p.price_cents;
   if(item.expected_price_cents!==undefined && item.expected_price_cents!==p.price_cents) {
    if(!late) fail(409,`El precio de ${p.name} cambió. Actualiza los productos antes de confirmar.`);
    price=item.expected_price_cents;alerts.push({type:'price',product:p.name,sold_cents:price,current_cents:p.price_cents});
   }
   const qty=quantity(item.quantity,p.unit);
   if(p.stock_milli!==null && p.stock_milli<qty) {
    if(!late) fail(409,`Existencias insuficientes: ${p.name}.`);
    alerts.push({type:'stock',product:p.name,unit:p.unit,missing_milli:qty-p.stock_milli});
   }
   return {id:id(),product_id:p.id,name:p.name,unit:p.unit,quantity_milli:qty,price_cents:price,subtotal_cents:subtotal(price,qty),tracks_stock:p.stock_milli!==null};
  });
  const total=items.reduce((sum,i)=>sum+i.subtotal_cents,0);
  if(!Number.isSafeInteger(total)||total>100_000_000_000) fail(400,'El total supera el límite permitido.');
  const saleId=id();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM sales').get().n;
  const settings=db.prepare('SELECT * FROM settings WHERE id=1').get();
  // Los datos del negocio quedan congelados en la venta: el comprobante histórico no cambia si se editan después.
  const snapshot={business_name:settings.business_name,business_nit:settings.business_nit,business_address:settings.business_address,business_phone:settings.business_phone,business_city:settings.business_city,customer_name:customer.name,customer_city:customer.city,seller_name:user.name,...(late&&input.offline_ref?{offline_ref:input.offline_ref}:{})};
  db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?)').run(saleId,number,session.id,user.id,customer.id,created,total,JSON.stringify(snapshot),input.request_key,requestHash);
  for(const item of items) {
   db.prepare('INSERT INTO sale_items VALUES (?,?,?,?,?,?,?,?)').run(item.id,saleId,item.product_id,item.name,item.unit,item.quantity_milli,item.price_cents,item.subtotal_cents);
   // MAX(0,…): una venta de ruta con stock insuficiente deja el producto en 0 (la diferencia queda en la alerta).
   if(item.tracks_stock) db.prepare('UPDATE products SET stock_milli=MAX(0,stock_milli-?),updated_at=? WHERE id=?').run(item.quantity_milli,now(),item.product_id);
  }
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(id(),saleId,input.method,platform?.id||null,platform?.name||null,total);
  audit(db,user.id,'sale.create',saleId,{session_id:session.id,total_cents:total,...(late?{offline:true,sold_at:created}:{})});
  if(alerts.length) audit(db,user.id,'sale.offline_alert',saleId,{number,offline_ref:input.offline_ref||null,alerts});
  const saved=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);return canReadSale(user,saved)?readSale(db,saved):saleAcknowledgement(saved);
 });
}
export function closureDetail(db,closureId) {
 const closure=db.prepare('SELECT * FROM closures WHERE id=?').get(closureId);
 if(!closure) fail(404,'Cierre no encontrado.');
 return {...closure,session_number:sessionNumber(db,closure.session_id),snapshot:JSON.parse(closure.snapshot),annotations:db.prepare('SELECT n.*,u.name AS author_name FROM closure_notes n JOIN users u ON u.id=n.author_id WHERE closure_id=? ORDER BY n.created_at').all(closureId)};
}
export function closeSession(db,user,sessionId,input) {
 if(user.role!=='admin') fail(403,'Solo el administrador puede cerrar la caja.');
 return transaction(db,()=>{
  const session=sessionFor(db,user,sessionId);
  if(session.state!=='open') fail(409,'La caja ya está cerrada. Consulta su cierre en el historial.');
  const computed=totals(db,session.id);
  if(input.reviewed_sale_count!==undefined && input.reviewed_sale_count!==computed.sale_count) fail(409,'Se registraron ventas después de revisar la caja. Cancela y vuelve a abrir la conciliación con los totales actualizados.');
  const declaredCash=money(input.declared_cash),declaredElectronic=money(input.declared_electronic);
  const expectedCash=session.opening_cents+computed.cash_cents;
  const created=now(); const closureId=id();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM closures').get().n;
  const snapshot={business_name:db.prepare('SELECT business_name FROM settings WHERE id=1').get().business_name,session_id:session.id,
   opened_at:session.opened_at,closed_at:created,opened_by:session.opened_by,opener_name:session.opener_name,admin_name:user.name,
   opening_cents:session.opening_cents,...computed,expected_cash_cents:expectedCash,declared_cash_cents:declaredCash,declared_electronic_cents:declaredElectronic,
   cash_difference_cents:declaredCash-expectedCash,electronic_difference_cents:declaredElectronic-computed.electronic_cents,
   total_difference_cents:declaredCash-expectedCash+declaredElectronic-computed.electronic_cents,notes:input.notes};
  db.prepare('INSERT INTO closures VALUES (?,?,?,?,?,?)').run(closureId,number,session.id,user.id,created,JSON.stringify(snapshot));
  db.prepare("UPDATE cash_sessions SET state='closed',closed_at=? WHERE id=? AND state='open'").run(created,session.id);
  audit(db,user.id,'cash.close',closureId,snapshot);
  return closureDetail(db,closureId);
 });
}
