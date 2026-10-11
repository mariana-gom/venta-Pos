import { id, now, audit, transaction } from './db.js';
import { money, quantity, subtotal } from './money.js';
import { digest } from './auth.js';
export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function sessionFor(db,user,sessionId) {
 const session=db.prepare('SELECT c.*,u.name AS opener_name FROM cash_sessions c JOIN users u ON u.id=c.opened_by WHERE c.id=?').get(sessionId);
 if(!session) fail(404,'Caja no encontrada.');
 if(user.role!=='admin' && session.opened_by!==user.id) fail(403,'No puedes acceder a una caja ajena.');
 return session;
}
export function totals(db,sessionId) {
 const rows=db.prepare('SELECT p.method,p.platform_id,p.platform_name,SUM(p.amount_cents) AS amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.session_id=? GROUP BY p.method,p.platform_id,p.platform_name').all(sessionId);
 const cash=rows.filter(r=>r.method==='cash').reduce((a,r)=>a+r.amount,0);
 const electronic=rows.filter(r=>r.method==='electronic').reduce((a,r)=>a+r.amount,0);
 const count=db.prepare('SELECT COUNT(*) AS n FROM sales WHERE session_id=?').get(sessionId).n;
 return {cash_cents:cash,electronic_cents:electronic,total_cents:cash+electronic,sale_count:count,platforms:rows.filter(r=>r.method==='electronic')};
}
export function saleDetail(db,user,saleId) {
 const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
 if(!sale) fail(404,'Venta no encontrada.');
 if(user.role!=='admin' && sale.seller_id!==user.id) fail(403,'No puedes consultar una venta ajena.');
 return {...sale,snapshot:JSON.parse(sale.snapshot),items:db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid').all(saleId),payments:db.prepare('SELECT * FROM payments WHERE sale_id=?').all(saleId)};
}
export function recordSale(db,user,input) {
 return transaction(db,()=>{
  const requestHash=digest(JSON.stringify(input));
  const existing=db.prepare('SELECT id,request_hash FROM sales WHERE seller_id=? AND request_key=?').get(user.id,input.request_key);
  if(existing) {if(existing.request_hash!==requestHash) fail(409,'Esta referencia ya fue usada para otra venta.');return saleDetail(db,user,existing.id);}
  const session=sessionFor(db,user,input.session_id);
  if(session.opened_by!==user.id) fail(403,'Solo el propietario puede vender en esta caja.');
  if(session.state!=='open') fail(409,'La caja está cerrada. Abre una nueva.');
  const customer=db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(input.customer_id);
  if(!customer) fail(400,'Selecciona un cliente activo.');
  let platform=null;
  if(input.method==='electronic') {
   platform=db.prepare('SELECT * FROM platforms WHERE id=? AND active=1').get(input.platform_id||'');
   if(!platform) fail(400,'Selecciona una plataforma electrónica activa.');
  } else if(input.platform_id) fail(400,'Un pago en efectivo no debe tener plataforma.');
  const seen=new Set();
  const items=input.items.map(item=>{
   if(seen.has(item.product_id)) fail(400,'Agrupa la cantidad del producto repetido en una sola línea.');seen.add(item.product_id);
   const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.product_id);
   if(!p) fail(400,'Uno de los productos no está disponible.');
   if(item.expected_price_cents!==undefined && item.expected_price_cents!==p.price_cents) fail(409,`El precio de ${p.name} cambió. Actualiza los productos antes de confirmar.`);
   const qty=quantity(item.quantity,p.unit);
   if(p.stock_milli!==null && p.stock_milli<qty) fail(409,`Existencias insuficientes: ${p.name}.`);
   return {id:id(),product_id:p.id,name:p.name,unit:p.unit,quantity_milli:qty,price_cents:p.price_cents,subtotal_cents:subtotal(p.price_cents,qty),tracks_stock:p.stock_milli!==null};
  });
  const total=items.reduce((sum,i)=>sum+i.subtotal_cents,0);
  if(!Number.isSafeInteger(total)||total>100_000_000_000) fail(400,'El total supera el límite permitido.');
  const saleId=id(); const created=now();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM sales').get().n;
  const settings=db.prepare('SELECT * FROM settings WHERE id=1').get();
  const snapshot={business_name:settings.business_name,customer_name:customer.name,customer_city:customer.city,seller_name:user.name};
  db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?)').run(saleId,number,session.id,user.id,customer.id,created,total,JSON.stringify(snapshot),input.request_key,requestHash);
  for(const item of items) {
   db.prepare('INSERT INTO sale_items VALUES (?,?,?,?,?,?,?,?)').run(item.id,saleId,item.product_id,item.name,item.unit,item.quantity_milli,item.price_cents,item.subtotal_cents);
   if(item.tracks_stock) db.prepare('UPDATE products SET stock_milli=stock_milli-?,updated_at=? WHERE id=?').run(item.quantity_milli,created,item.product_id);
  }
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?)').run(id(),saleId,input.method,platform?.id||null,platform?.name||null,total);
  audit(db,user.id,'sale.create',saleId,{session_id:session.id,total_cents:total});
  return saleDetail(db,user,saleId);
 });
}
export function closureDetail(db,closureId) {
 const closure=db.prepare('SELECT * FROM closures WHERE id=?').get(closureId);
 if(!closure) fail(404,'Cierre no encontrado.');
 return {...closure,snapshot:JSON.parse(closure.snapshot),annotations:db.prepare('SELECT n.*,u.name AS author_name FROM closure_notes n JOIN users u ON u.id=n.author_id WHERE closure_id=? ORDER BY n.created_at').all(closureId)};
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
