import {ensureJourney,routeCanLoad} from './route-journey.js';
import {id,now,audit,transaction} from './db.js';
import {money,quantity,scaled} from './money.js';
import {businessInstant,calendarDay,businessTimeZone} from './sales-access.js';
import {digest} from './auth.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const requireAdmin=user=>{if(user.role!=='admin')fail(403,'Esta operación requiere administrador.');};
export function once(db,user,kind,key,input,fn){
 requireAdmin(user);return transaction(db,()=>{
  const hash=digest(JSON.stringify(input)),old=db.prepare('SELECT * FROM operation_requests WHERE request_key=?').get(key);
  if(old){if(old.actor_id!==user.id||old.kind!==kind||old.request_hash!==hash)fail(409,'Referencia usada para otra operación.');return JSON.parse(old.result);}
  const result=fn();db.prepare('INSERT INTO operation_requests VALUES(?,?,?,?,?)').run(key,user.id,kind,hash,JSON.stringify(result));return result;
 });
}
export function electronic(db,input){
 if(input.method!=='electronic')return {platform_id:null,platform_name:null,reference:null};
 if(typeof input.reference!=='string'||!input.reference.trim()||input.reference.trim().length>120)fail(400,'Número de referencia obligatorio (máximo 120 caracteres).');
 const p=db.prepare('SELECT * FROM platforms WHERE id=? AND active=1').get(input.platform_id||'');if(!p)fail(400,'Selecciona un medio electrónico activo.');
 return {platform_id:p.id,platform_name:p.name,reference:input.reference.trim()};
}
function cashDestination(db,input){
 if(input.session_id){const s=db.prepare('SELECT * FROM cash_sessions WHERE id=? AND state=\'open\'').get(input.session_id);if(!s)fail(409,'La caja seleccionada debe estar abierta.');if(input.outside_cash_reason)fail(400,'Elige caja o recepción fuera de caja.');return {session_id:s.id,outside_cash_reason:null};}
 if(!input.outside_cash_reason?.trim())fail(400,'Para recibir o devolver fuera de caja, registra un motivo explícito.');
 return {session_id:null,outside_cash_reason:input.outside_cash_reason.trim()};
}
export function paidAmount(db,saleId){
 const original=db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM collection_allocations WHERE sale_id=?').get(saleId).n;
 const movedOut=db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM allocation_resolutions WHERE source_sale_id=?').get(saleId).n;
 const movedIn=db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM allocation_resolutions WHERE kind='reassign' AND target_sale_id=?").get(saleId).n;
 return original-movedOut+movedIn;
}
export function debtDetail(db,saleId){
 const debt=db.prepare('SELECT d.*,s.number,c.id AS cancellation_id FROM debts d JOIN sales s ON s.id=d.sale_id LEFT JOIN cancellations c ON c.sale_id=d.sale_id WHERE d.sale_id=?').get(saleId);
 if(!debt)fail(404,'Crédito no encontrado.');const paid_cents=paidAmount(db,saleId),balance_cents=debt.cancellation_id?0:debt.amount_cents-paid_cents;
 return {...debt,paid_cents,balance_cents,state:debt.cancellation_id?'cancelled':balance_cents===0?'paid':paid_cents?'partial':'pending'};
}
export function account(db,customerId){
 const customer=db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);if(!customer)fail(404,'Cliente no encontrado.');
 const debts=db.prepare('SELECT sale_id FROM debts WHERE customer_id=? ORDER BY created_at,sale_id').all(customerId).map(d=>debtDetail(db,d.sale_id));
 const collections=db.prepare('SELECT p.*,u.name AS receiver_name,c.opened_by AS session_owner FROM collections p JOIN users u ON u.id=p.received_by LEFT JOIN cash_sessions c ON c.id=p.session_id WHERE customer_id=? ORDER BY occurred_at,created_at,id').all(customerId).map(p=>({...p,allocations:db.prepare('SELECT a.*,s.number FROM collection_allocations a JOIN sales s ON s.id=a.sale_id WHERE collection_id=?').all(p.id)}));
 const events=[];
 for(const d of debts)events.push({id:d.sale_id,at:d.created_at,invoice:d.number,type:'credit',charge_cents:d.amount_cents,payment_cents:0,description:'Venta a crédito'});
 for(const p of collections)for(const a of p.allocations)events.push({id:a.id,at:p.occurred_at,invoice:a.number,type:'payment',charge_cents:0,payment_cents:a.amount_cents,description:`Abono · ${p.receiver_name}${p.reference?' · '+p.reference:''}`});
 for(const c of db.prepare('SELECT c.*,s.number,d.amount_cents FROM cancellations c JOIN debts d ON d.sale_id=c.sale_id JOIN sales s ON s.id=c.sale_id WHERE d.customer_id=?').all(customerId))events.push({id:c.id,at:c.created_at,invoice:c.number,type:'cancel',charge_cents:-c.amount_cents,payment_cents:0,description:'Anulación: '+c.reason});
 const resolutions=db.prepare('SELECT r.*,s.number AS original_number,t.number AS target_number FROM allocation_resolutions r JOIN collection_allocations a ON a.id=r.allocation_id JOIN debts d ON d.sale_id=r.source_sale_id JOIN sales s ON s.id=r.source_sale_id LEFT JOIN sales t ON t.id=r.target_sale_id WHERE d.customer_id=?').all(customerId);
 for(const r of resolutions){events.push({id:r.id,at:r.created_at,invoice:r.original_number,type:r.kind,charge_cents:r.amount_cents,payment_cents:0,description:r.kind==='refund'?'Devolución de abono':'Reasignación del abono'});if(r.kind==='reassign')events.push({id:r.id+'-target',at:r.created_at,invoice:r.target_number,type:'reassign',charge_cents:0,payment_cents:r.amount_cents,description:'Abono reasignado'});}
 const order={credit:0,payment:1,refund:2,reassign:2,cancel:3};events.sort((a,b)=>a.at.localeCompare(b.at)||(order[a.type]-order[b.type])||a.id.localeCompare(b.id));let balance=0;
 for(const e of events){balance+=e.charge_cents-e.payment_cents;e.balance_cents=balance;}
 const balance_cents=debts.reduce((sum,d)=>sum+d.balance_cents,0);
 if(balance!==balance_cents)fail(500,'La cartera requiere revisar su conciliación.');
 return {customer,debts,collections,events,balance_cents,credit_cents:debts.filter(d=>!d.cancellation_id).reduce((n,d)=>n+d.amount_cents,0),paid_cents:debts.filter(d=>!d.cancellation_id).reduce((n,d)=>n+d.paid_cents,0),state:balance_cents===0?'paid':debts.some(d=>d.paid_cents)?'partial':'pending'};
}
export function registerCollection(db,user,input){
 return once(db,user,'collection',input.request_key,input,()=>{
  const balance=account(db,input.customer_id),amount=money(input.amount);if(amount<=0||amount>balance.balance_cents)fail(400,'El abono debe ser positivo y no superar el saldo pendiente.');
  let occurredAt=input.occurred_at;
  if(!occurredAt){if(!input.date||!input.time)fail(400,'Fecha y hora obligatorias.');occurredAt=businessInstant(input.date,input.time);const currentTime=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:businessTimeZone()}).format(new Date());if(input.date===calendarDay(new Date())&&input.time===currentTime)occurredAt=now();}
  occurredAt=new Date(occurredAt).toISOString();
  if(Date.parse(occurredAt)>Date.now())fail(400,'La fecha del abono no puede estar en el futuro.');
  const pay=electronic(db,input),destination=cashDestination(db,input),collectionId=id(),created=now();
  const available=balance.debts.filter(d=>d.balance_cents>0);let allocations=[];
  if(input.allocations?.length){const seen=new Set();let sum=0;for(const a of input.allocations){const debt=available.find(d=>d.sale_id===a.sale_id),cents=money(a.amount);if(!debt||seen.has(a.sale_id)||cents<=0||cents>debt.balance_cents)fail(400,'Distribución del abono inválida.');seen.add(a.sale_id);sum+=cents;allocations.push({sale_id:a.sale_id,amount_cents:cents});}if(sum!==amount)fail(400,'La distribución debe sumar el abono.');}
  else{let left=amount;for(const debt of available){const part=Math.min(left,debt.balance_cents);if(part)allocations.push({sale_id:debt.sale_id,amount_cents:part});left-=part;}}
  // Una fecha anterior a la factura produciría una deuda negativa antes de su creación.
  for(const a of allocations)if(occurredAt<available.find(d=>d.sale_id===a.sale_id).created_at)fail(400,'La fecha del abono debe ser posterior a las facturas que paga.');
  db.prepare('INSERT INTO collections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(collectionId,input.customer_id,amount,input.method,pay.platform_id,pay.platform_name,pay.reference,occurredAt,created,user.id,destination.session_id,destination.outside_cash_reason,input.observation||'',input.request_key,digest(JSON.stringify(input)));
  for(const a of allocations)db.prepare('INSERT INTO collection_allocations VALUES(?,?,?,?)').run(id(),collectionId,a.sale_id,a.amount_cents);
  audit(db,user.id,'collection.receive',collectionId,{...input,allocations});return {id:collectionId,allocations,account:account(db,input.customer_id)};
 });
}
export function inventoryMove(db,{product_id,route_id=null,quantity_milli,kind,actor_id,reason,sale_id=null,request_key=null,load_id=null,effective_date=null,closure_id=null}){
 const p=db.prepare('SELECT * FROM products WHERE id=?').get(product_id);if(!p||p.stock_milli===null)fail(400,'El producto debe controlar existencias.');
 if(!Number.isSafeInteger(p.stock_milli+quantity_milli)||p.stock_milli+quantity_milli<0||p.stock_milli+quantity_milli>100_000_000_000)fail(409,'Existencias totales fuera de rango.');
 if(route_id){ensureJourney(db,route_id);if(!db.prepare('SELECT id FROM routes WHERE id=?').get(route_id))fail(404,'Ruta no encontrada.');db.prepare('INSERT OR IGNORE INTO route_stock VALUES(?,?,0)').run(product_id,route_id);const changed=db.prepare('UPDATE route_stock SET quantity_milli=quantity_milli+? WHERE product_id=? AND route_id=? AND quantity_milli+?>=0').run(quantity_milli,product_id,route_id,quantity_milli);if(!changed.changes)fail(409,'Existencias insuficientes en la ruta.');}
 else{db.prepare('INSERT OR IGNORE INTO unassigned_stock VALUES(?,0)').run(product_id);if(!db.prepare('UPDATE unassigned_stock SET quantity_milli=quantity_milli+? WHERE product_id=? AND quantity_milli+?>=0').run(quantity_milli,product_id,quantity_milli).changes)fail(409,'Saldo sin asignar insuficiente.');}
 db.prepare('UPDATE products SET stock_milli=stock_milli+?,updated_at=? WHERE id=?').run(quantity_milli,now(),product_id);
 db.prepare('INSERT INTO inventory_movements(id,product_id,route_id,quantity_milli,kind,actor_id,created_at,reason,sale_id,request_key,load_id,effective_date,closure_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id(),product_id,route_id,quantity_milli,kind,actor_id,now(),reason,sale_id,request_key,load_id,effective_date,closure_id);
}
export function adjustStock(db,user,input){
 return once(db,user,'stock',input.request_key,input,()=>{
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(input.product_id);if(!p||p.stock_milli===null||!p.unit)fail(400,'Selecciona un producto con inventario.');
  if(input.route_id&&!db.prepare('SELECT id FROM routes WHERE id=? AND active=1').get(input.route_id))fail(400,'Selecciona una ruta activa.');
  if(input.kind==='entry'&&input.route_id&&p.central_stock_enabled)fail(400,'Este producto tiene inventario central. Utiliza Carga de stock por ruta.');
  if(!input.route_id&&(input.kind==='entry'||input.kind==='adjustment'))db.prepare('UPDATE products SET central_stock_enabled=1 WHERE id=?').run(p.id);
  if(input.route_id)routeCanLoad(db,input.route_id);
  const amount=scaled(input.quantity,3);if(p.unit==='unit'&&amount%1000)fail(400,'Solo unidades enteras.');
  if(input.kind==='return'){if(!input.route_id||amount<=0)fail(400,'Selecciona ruta y cantidad a devolver.');inventoryMove(db,{...input,quantity_milli:-amount,kind:'return',actor_id:user.id});if(p.central_stock_enabled)inventoryMove(db,{...input,route_id:null,quantity_milli:amount,kind:'return',actor_id:user.id});}
  else if(input.kind==='allocate'){if(!input.route_id||amount<=0)fail(400,'Selecciona ruta y cantidad positiva.');inventoryMove(db,{...input,route_id:null,quantity_milli:-amount,kind:'allocation',actor_id:user.id});inventoryMove(db,{...input,quantity_milli:amount,kind:'allocation',actor_id:user.id});}
  else{const current=input.route_id?db.prepare('SELECT quantity_milli n FROM route_stock WHERE product_id=? AND route_id=?').get(p.id,input.route_id)?.n||0:db.prepare('SELECT quantity_milli n FROM unassigned_stock WHERE product_id=?').get(p.id)?.n||0;const delta=input.kind==='entry'?amount:amount-current;if(!delta)fail(400,'El ajuste no cambia existencias.');inventoryMove(db,{...input,quantity_milli:delta,kind:input.kind==='entry'?'entry':'adjustment',actor_id:user.id});}
  audit(db,user.id,'inventory.adjust',p.id,input);return db.prepare('SELECT * FROM products WHERE id=?').get(p.id);
 });
}
export function loadRouteStock(db,user,input){
 return once(db,user,'stock-load',input.request_key,input,()=>{
  if(!db.prepare('SELECT id FROM routes WHERE id=? AND active=1').get(input.route_id))fail(400,'Selecciona una ruta activa.');
  routeCanLoad(db,input.route_id);ensureJourney(db,input.route_id);
  const seen=new Set(),items=[];
  for(const item of input.items){
   if(seen.has(item.product_id))fail(400,'Producto duplicado en la carga.');seen.add(item.product_id);
   const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(item.product_id);if(!p?.unit)fail(400,'Selecciona productos activos con modalidad de venta.');
   const amount=quantity(item.quantity,p.unit),before=db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(p.id,input.route_id)?.quantity_milli||0;
   const central=p.central_stock_enabled?(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(p.id)?.quantity_milli||0):null;
   if(before!==item.expected_before_milli||central!==item.expected_central_milli)fail(409,'El stock cambió después de la revisión. Actualiza y revisa la carga.');
   if(central!==null&&amount>central)fail(409,'Saldo central insuficiente: '+p.name);
   if(!Number.isSafeInteger(before+amount)||before+amount>100_000_000_000)fail(400,'Existencias fuera de rango.');
   items.push({product_id:p.id,quantity_milli:amount,before_milli:before,after_milli:before+amount,source:central===null?'entry':'central'});
  }
  const loadId=id(),created=now();db.prepare('INSERT INTO stock_loads VALUES(?,?,?,?,?,?,?)').run(loadId,input.route_id,input.date,user.id,created,input.reason,input.request_key);
  for(const item of items){
   db.prepare('UPDATE products SET stock_milli=COALESCE(stock_milli,0) WHERE id=?').run(item.product_id);
   const common={product_id:item.product_id,actor_id:user.id,reason:input.reason,request_key:input.request_key,load_id:loadId,effective_date:input.date};
   if(item.source==='central')inventoryMove(db,{...common,quantity_milli:-item.quantity_milli,kind:'allocation'});
   inventoryMove(db,{...common,route_id:input.route_id,quantity_milli:item.quantity_milli,kind:item.source==='central'?'allocation':'entry'});
   db.prepare('INSERT INTO stock_load_items VALUES(?,?,?,?,?,?)').run(loadId,item.product_id,item.quantity_milli,item.before_milli,item.after_milli,item.source);
  }
  audit(db,user.id,'inventory.load',loadId,{route_id:input.route_id,date:input.date,items});return {id:loadId,route_id:input.route_id,date:input.date,items};
 });
}
export function reviewPrices(db,user,input){
 return once(db,user,'price-review',input.request_key,input,()=>{
  const seen=new Set();for(const item of input.items){
   if(seen.has(item.product_id))fail(400,'Producto duplicado.');seen.add(item.product_id);
   const p=db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id),review=db.prepare('SELECT * FROM product_price_reviews WHERE product_id=? AND reviewed_at IS NULL').get(item.product_id);
   if(!p||!review||p.price_cents!==item.expected_price_cents||p.wholesale_price_cents!==item.expected_wholesale_cents)fail(409,'Los precios cambiaron. Revisa la vista previa de nuevo.');
   const price=money(item.price);if(price<=0)fail(400,'El precio único debe ser mayor a cero.');
   db.prepare('UPDATE products SET price_cents=?,updated_at=? WHERE id=?').run(price,now(),p.id);
   db.prepare('UPDATE product_price_reviews SET reviewed_at=?,actor_id=?,chosen_price_cents=? WHERE product_id=?').run(now(),user.id,price,p.id);
   audit(db,user.id,'product.price-review',p.id,{before:p.price_cents,wholesale:p.wholesale_price_cents,chosen:price});
  }return {updated:input.items.length};
 });
}
export function cancelSale(db,user,saleId,input){
 return once(db,user,'cancellation',input.request_key,{saleId,...input},()=>{
  const sale=db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);if(!sale)fail(404,'Venta no encontrada.');if(db.prepare('SELECT id FROM cancellations WHERE sale_id=?').get(saleId))fail(409,'La venta ya está anulada.');
  const payment=db.prepare('SELECT * FROM payments WHERE sale_id=?').get(saleId),session=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(sale.session_id),created=now(),cancellationId=id();
  const allocations=db.prepare(`SELECT a.* FROM collection_allocations a WHERE (a.sale_id=? OR EXISTS(SELECT 1 FROM allocation_resolutions r WHERE r.allocation_id=a.id AND r.target_sale_id=? AND r.kind='reassign')) AND NOT EXISTS(SELECT 1 FROM allocation_resolutions r WHERE r.allocation_id=a.id AND r.source_sale_id=?)`).all(saleId,saleId,saleId);
  if(input.resolutions?.length&&(!allocations.length||payment.method!=='credit'))fail(400,'La venta no tiene esos abonos para resolver.');
  let refundAmount=0;
  if(payment.method==='credit'&&allocations.length){
   if(!input.resolutions||input.resolutions.length!==allocations.length)fail(409,'Debes resolver cada abono: devolución o reasignación.');const seen=new Set(),reserved=new Map();
   for(const r of input.resolutions){const a=allocations.find(a=>a.id===r.allocation_id);if(!a||seen.has(a.id))fail(400,'Resolución de abonos inválida.');seen.add(a.id);if(r.kind==='refund')refundAmount+=a.amount_cents;else{const target=debtDetail(db,r.target_sale_id);const used=reserved.get(r.target_sale_id)||0;if(target.customer_id!==sale.customer_id||target.sale_id===saleId||a.amount_cents+used>target.balance_cents)fail(400,'La factura destino debe tener saldo suficiente y pertenecer al mismo cliente.');reserved.set(target.sale_id,used+a.amount_cents);}}
  }else if(payment.method!=='credit')refundAmount=sale.total_cents;
  if(refundAmount&&(!input.refund||money(input.refund.amount)!==refundAmount))fail(409,`Debes registrar la devolución real de ${refundAmount/100} COP.`);
  if(!refundAmount&&input.refund)fail(400,'Esta anulación no requiere devolución.');
  const refund=input.refund?{...electronic(db,input.refund),...cashDestination(db,input.refund)}:null;
  // Una caja ajena nunca recibe una devolución por anular otra caja. Fuera de caja es un flujo explícito.
  if(refund?.session_id&&refund.session_id!==sale.session_id)fail(400,'La devolución solo puede salir de la caja original abierta o registrarse fuera de caja.');
  db.prepare('INSERT INTO cancellations VALUES(?,?,?,?,?,?,?,?,?,?)').run(cancellationId,saleId,user.id,created,input.reason,sale.session_id,Number(session.state==='closed'),input.request_key,digest(JSON.stringify({saleId,...input})),JSON.stringify(input.resolutions||[]));
  for(const r of input.resolutions||[]){const a=allocations.find(a=>a.id===r.allocation_id);db.prepare('INSERT INTO allocation_resolutions VALUES(?,?,?,?,?,?,?,?)').run(id(),cancellationId,a.id,saleId,r.kind==='reassign'?r.target_sale_id:null,a.amount_cents,r.kind,created);}
  if(refund)db.prepare('INSERT INTO refunds VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(),cancellationId,refundAmount,input.refund.method,refund.platform_id,refund.reference,user.id,refund.session_id,refund.outside_cash_reason,created);
  if(session.state==='closed'){const closure=db.prepare('SELECT id FROM closures WHERE session_id=?').get(session.id);db.prepare('INSERT INTO closure_adjustments VALUES(?,?,?,?,?)').run(id(),closure.id,cancellationId,created,JSON.stringify({sale_id:saleId,method:payment.method,reversed_cents:sale.total_cents,refund_cents:refundAmount,reason:input.reason}));}
  // Solo se devuelve lo que realmente fue descontado, en su ubicación original; ventas antiguas usan el saldo sin asignar.
  const original=db.prepare("SELECT product_id,route_id,-SUM(quantity_milli) quantity_milli FROM inventory_movements WHERE sale_id=? AND kind='sale' GROUP BY product_id,route_id").all(saleId);
  for(const m of original)inventoryMove(db,{...m,kind:'return',actor_id:user.id,reason:input.reason,sale_id:saleId});
  if(!original.length&&sale.inventory_version===0){for(const item of db.prepare("SELECT i.* FROM sale_items i JOIN products p ON p.id=i.product_id WHERE i.sale_id=? AND p.stock_milli IS NOT NULL AND EXISTS(SELECT 1 FROM inventory_movements m WHERE m.product_id=p.id AND m.kind='migration')").all(saleId))inventoryMove(db,{product_id:item.product_id,route_id:sale.route_id,quantity_milli:item.quantity_milli,kind:'return',actor_id:user.id,reason:'Devolución de venta histórica: '+input.reason,sale_id:saleId});}
  audit(db,user.id,'sale.cancel',saleId,input);return {id:cancellationId,sale_id:saleId,status:'cancelled',refund_cents:refundAmount};
 });
}
