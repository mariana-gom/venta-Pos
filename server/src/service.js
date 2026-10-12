import { id, now, audit, transaction } from './db.js';
import { money, quantity, subtotal } from './money.js';
import { digest } from './auth.js';
import {electronic,inventoryMove} from './operations.js';
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
 const closed=!day&&db.prepare("SELECT cl.snapshot FROM closures cl JOIN cash_sessions cs ON cs.id=cl.session_id WHERE cs.id=? AND cs.state='closed'").get(sessionId);
 if(closed){const s=JSON.parse(closed.snapshot);const keys=['sales_cash_cents','sales_electronic_cents','credit_cents','collection_cash_cents','collection_electronic_cents','refund_cash_cents','refund_electronic_cents','cash_cents','electronic_cents','total_cents','sale_count','platforms','session_revision'];return Object.fromEntries(keys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));}

 const range=day?' AND s.created_at>=? AND s.created_at<?':'';const params=day?[sessionId,day.start,day.end]:[sessionId];
 const rows=db.prepare(`SELECT p.method,p.platform_id,p.platform_name,SUM(p.amount_cents) amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.session_id=? AND NOT EXISTS(SELECT 1 FROM cancellations c WHERE c.sale_id=s.id)${range} GROUP BY p.method,p.platform_id,p.platform_name`).all(...params);
 const sum=method=>rows.filter(r=>r.method===method).reduce((n,r)=>n+r.amount,0),sales_cash_cents=sum('cash'),sales_electronic_cents=sum('electronic'),credit_cents=sum('credit');
 const count=db.prepare(`SELECT COUNT(*) n FROM sales s WHERE session_id=? AND NOT EXISTS(SELECT 1 FROM cancellations c WHERE c.sale_id=s.id)${range}`).get(...params).n;
 const collectionRange=day?' AND created_at>=? AND created_at<?':'';
 const receipts=db.prepare(`SELECT method,SUM(amount_cents) amount FROM collections WHERE session_id=?${collectionRange} GROUP BY method`).all(...params);
 const refunds=db.prepare(`SELECT method,SUM(amount_cents) amount FROM refunds WHERE session_id=?${collectionRange} GROUP BY method`).all(...params);
 // Las ventas anuladas se excluyen de las ventas; el dinero recibido se conserva hasta su devolución real.
 const canceledReceipts=db.prepare(`SELECT p.method,SUM(p.amount_cents) amount FROM payments p JOIN sales s ON s.id=p.sale_id JOIN cancellations c ON c.sale_id=s.id WHERE s.session_id=? AND p.method!='credit'${range} GROUP BY p.method`).all(...params);
 const by=(list,method)=>list.filter(r=>r.method===method).reduce((n,r)=>n+r.amount,0);
 const collection_cash_cents=by(receipts,'cash'),collection_electronic_cents=by(receipts,'electronic'),refund_cash_cents=by(refunds,'cash'),refund_electronic_cents=by(refunds,'electronic');
 const session_revision=digest(JSON.stringify({sales:db.prepare('SELECT id FROM sales WHERE session_id=? ORDER BY id').all(sessionId),collections:db.prepare('SELECT id FROM collections WHERE session_id=? ORDER BY id').all(sessionId),refunds:db.prepare('SELECT id FROM refunds WHERE session_id=? ORDER BY id').all(sessionId),cancellations:db.prepare('SELECT id FROM cancellations WHERE original_session_id=? ORDER BY id').all(sessionId)}));
 return {session_revision,sales_cash_cents,sales_electronic_cents,credit_cents,collection_cash_cents,collection_electronic_cents,refund_cash_cents,refund_electronic_cents,cash_cents:sales_cash_cents+by(canceledReceipts,'cash')+collection_cash_cents-refund_cash_cents,electronic_cents:sales_electronic_cents+by(canceledReceipts,'electronic')+collection_electronic_cents-refund_electronic_cents,total_cents:sales_cash_cents+sales_electronic_cents+credit_cents,sale_count:count,platforms:rows.filter(r=>r.method==='electronic')};
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
 const cancellation=db.prepare('SELECT c.*,u.name AS actor_name FROM cancellations c JOIN users u ON u.id=c.actor_id WHERE sale_id=?').get(saleId)||null;
 return {...sale,status:cancellation?'cancelled':'active',cancellation,session_number:sessionNumber(db,sale.session_id),snapshot:JSON.parse(sale.snapshot),items:db.prepare('SELECT * FROM sale_items WHERE sale_id=? ORDER BY rowid').all(saleId),payments:db.prepare('SELECT * FROM payments WHERE sale_id=?').all(saleId)};
}
// Una venta que llega más de 2 minutos después de hecha viene de una ruta sin señal: ya ocurrió y se le entregó
// el producto al cliente. Reglas acordadas con el negocio: se respeta el precio con el que se vendió, se acepta aunque
// el precio acordado. El inventario por ruta siempre exige saldo suficiente, incluso al sincronizar.
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
   customer=c.identification?db.prepare('SELECT * FROM customers WHERE identification=? AND active=1').get(c.identification):db.prepare("SELECT * FROM customers WHERE name=? COLLATE NOCASE AND city=? COLLATE NOCASE AND identification='' AND active=1").get(c.name,c.city);
   if(!customer){db.prepare('INSERT INTO customers(id,name,city,active,created_at,updated_at,identification) VALUES (?,?,?,?,?,?,?)').run(c.id,c.name,c.city,1,created,created,c.identification||'');audit(db,user.id,'customer.create',c.id,{name:c.name,city:c.city,offline:true});customer=db.prepare('SELECT * FROM customers WHERE id=?').get(c.id);}
  }
  if(!customer) fail(400,'Selecciona un cliente activo.');
  const pay=electronic(db,input);
  if(input.method==='credit'&&!customer.identification?.trim())fail(400,'El crédito requiere un cliente identificado.');
  // Se valida la asignación actual del usuario autenticado. La fecha o ruta del navegador no otorgan acceso a otro stock.
  const currentUser=db.prepare('SELECT route_id FROM users WHERE id=? AND active=1').get(user.id);if(!currentUser)fail(403,'Usuario inactivo.');
  const routeId=currentUser.route_id||null;
  if(routeId&&!db.prepare('SELECT id FROM routes WHERE id=? AND active=1').get(routeId))fail(409,'La ruta asignada está inactiva. Solicita al administrador revisarla.');
  if(input.route_id!==undefined&&input.route_id!==routeId)fail(409,'La ruta de la venta no coincide con la asignación actual del vendedor. Conserva la venta pendiente y solicita revisar la ruta original.');
  const seen=new Set();
  const items=input.items.map(item=>{
   if(seen.has(item.product_id)) fail(400,'Agrupa la cantidad del producto repetido en una sola línea.');seen.add(item.product_id);
   const p=db.prepare(`SELECT * FROM products WHERE id=? ${late?'':'AND active=1'}`).get(item.product_id);
   if(!p||!p.unit||!p.price_cents) fail(400,'Uno de los productos no está disponible o está pendiente de completar.');
   let price=p.price_cents;
   if(item.expected_price_cents!==undefined && item.expected_price_cents!==p.price_cents) {
    if(!late) fail(409,`El precio de ${p.name} cambió. Actualiza los productos antes de confirmar.`);
    price=item.expected_price_cents;alerts.push({type:'price',product:p.name,sold_cents:price,current_cents:p.price_cents});
   }
   const qty=quantity(item.quantity,p.unit);
   if(p.stock_milli!==null){if(!routeId)fail(409,'Asigna una ruta al vendedor antes de vender productos con inventario.');const stock=db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(p.id,routeId)?.quantity_milli||0;if(stock<qty)fail(409,`Existencias insuficientes en la ruta: ${p.name}.`);}
   return {id:id(),product_id:p.id,name:p.name,unit:p.unit,quantity_milli:qty,price_cents:price,subtotal_cents:subtotal(price,qty),tracks_stock:p.stock_milli!==null};
  });
  const total=items.reduce((sum,i)=>sum+i.subtotal_cents,0);
  if(!Number.isSafeInteger(total)||total>100_000_000_000) fail(400,'El total supera el límite permitido.');
  const saleId=id();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM sales').get().n;
  const settings=db.prepare('SELECT * FROM settings WHERE id=1').get();
  // Los datos del negocio quedan congelados en la venta: el comprobante histórico no cambia si se editan después.
  const snapshot={business_name:settings.business_name,business_nit:settings.business_nit,business_address:settings.business_address,business_phone:settings.business_phone,business_city:settings.business_city,customer_name:customer.name,customer_city:customer.city,customer_identification:customer.identification,seller_name:user.name,route_id:routeId,...(late&&input.offline_ref?{offline_ref:input.offline_ref}:{})};
  db.prepare('INSERT INTO sales(id,number,session_id,seller_id,customer_id,created_at,total_cents,snapshot,request_key,request_hash,route_id,inventory_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,2)').run(saleId,number,session.id,user.id,customer.id,created,total,JSON.stringify(snapshot),input.request_key,requestHash,routeId);
  for(const item of items) {
   db.prepare('INSERT INTO sale_items VALUES (?,?,?,?,?,?,?,?)').run(item.id,saleId,item.product_id,item.name,item.unit,item.quantity_milli,item.price_cents,item.subtotal_cents);
   // Débito atómico exclusivo de la ruta original. No se permite stock negativo.
   if(item.tracks_stock)inventoryMove(db,{product_id:item.product_id,route_id:routeId,quantity_milli:-item.quantity_milli,kind:'sale',actor_id:user.id,reason:'Venta #'+number,sale_id:saleId});
  }
  db.prepare('INSERT INTO payments VALUES (?,?,?,?,?,?,?)').run(id(),saleId,input.method,pay.platform_id,pay.platform_name,total,pay.reference);
  if(input.method==='credit')db.prepare('INSERT INTO debts VALUES(?,?,?,?)').run(saleId,customer.id,total,created);
  audit(db,user.id,'sale.create',saleId,{session_id:session.id,total_cents:total,...(late?{offline:true,sold_at:created}:{})});
  if(alerts.length) audit(db,user.id,'sale.offline_alert',saleId,{number,offline_ref:input.offline_ref||null,alerts});
  const saved=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);return canReadSale(user,saved)?readSale(db,saved):saleAcknowledgement(saved);
 });
}
export function closureDetail(db,closureId) {
 const closure=db.prepare('SELECT * FROM closures WHERE id=?').get(closureId);
 if(!closure) fail(404,'Cierre no encontrado.');
 return {...closure,session_number:sessionNumber(db,closure.session_id),snapshot:JSON.parse(closure.snapshot),adjustments:db.prepare('SELECT * FROM closure_adjustments WHERE closure_id=? ORDER BY created_at').all(closureId).map(a=>({...a,detail:JSON.parse(a.detail)})),annotations:db.prepare('SELECT n.*,u.name AS author_name FROM closure_notes n JOIN users u ON u.id=n.author_id WHERE closure_id=? ORDER BY n.created_at').all(closureId)};
}
export function closeSession(db,user,sessionId,input) {
 if(user.role!=='admin') fail(403,'Solo el administrador puede cerrar la caja.');
 return transaction(db,()=>{
  const session=sessionFor(db,user,sessionId);
  if(session.state!=='open') fail(409,'La caja ya está cerrada. Consulta su cierre en el historial.');
  const computed=totals(db,session.id);
  if(input.reviewed_sale_count!==undefined && input.reviewed_sale_count!==computed.sale_count) fail(409,'Se registraron ventas después de revisar la caja. Cancela y vuelve a abrir la conciliación con los totales actualizados.');
  if(input.reviewed_revision&&input.reviewed_revision!==computed.session_revision)fail(409,'Entró un movimiento después de revisar la caja. Reabre la conciliación.');
  const declaredCash=money(input.declared_cash),declaredElectronic=money(input.declared_electronic),declaredCredit=money(input.declared_credit||'0');
  const expectedCash=session.opening_cents+computed.cash_cents;
  const created=now(); const closureId=id();
  const number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM closures').get().n;
  const snapshot={business_name:db.prepare('SELECT business_name FROM settings WHERE id=1').get().business_name,session_id:session.id,
   opened_at:session.opened_at,closed_at:created,opened_by:session.opened_by,opener_name:session.opener_name,admin_name:user.name,
   opening_cents:session.opening_cents,...computed,expected_cash_cents:expectedCash,declared_cash_cents:declaredCash,declared_electronic_cents:declaredElectronic,declared_credit_cents:declaredCredit,credit_difference_cents:declaredCredit-computed.credit_cents,
   cash_difference_cents:declaredCash-expectedCash,electronic_difference_cents:declaredElectronic-computed.electronic_cents,
   total_difference_cents:declaredCash-expectedCash+declaredElectronic-computed.electronic_cents,notes:input.notes};
  db.prepare('INSERT INTO closures VALUES (?,?,?,?,?,?)').run(closureId,number,session.id,user.id,created,JSON.stringify(snapshot));
  db.prepare("UPDATE cash_sessions SET state='closed',closed_at=? WHERE id=? AND state='open'").run(created,session.id);
  audit(db,user.id,'cash.close',closureId,snapshot);
  return closureDetail(db,closureId);
 });
}
