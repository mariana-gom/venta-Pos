import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
// Ventas hechas en ruta sin señal y subidas más tarde (sold_at con más de 2 minutos).
test('Modo ruta: precio respetado, stock por ruta estricto, cliente nuevo, caja cerrada e idempotencia',async()=>{
 const db=openDatabase(':memory:');
 const admin=await createUser(db,{name:'Admin',username:'admin-r',password:'admin-password-123',role:'admin'});
 const seller=await createUser(db,{name:'Ruta 1',username:'ruta-1',password:'seller-password-123',role:'seller'});
 const tokens={admin:(await login(db,admin.username,'admin-password-123')).token,seller:(await login(db,seller.username,'seller-password-123')).token};
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(method,path,body,role='admin',status=200){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const json=await r.json();assert.equal(r.status,status,JSON.stringify(json));return json;}
 const ago=minutes=>new Date(Date.now()-minutes*60000).toISOString();
 try{
  const pollo=await req('POST','/products',{name:'Pollo',price:'12000',unit:'kg',stock:'10'});
  await req('POST','/inventory',{product_id:pollo.id,route_id:null,quantity:'10',kind:'entry',reason:'Entrada central',request_key:randomUUID()});
  const route=await req('POST','/routes',{name:'Ruta prueba',request_key:randomUUID()},'admin',201);
  await req('PUT','/users/'+seller.id+'/route',{route_id:route.id,request_key:randomUUID()});
  await req('POST','/inventory',{product_id:pollo.id,route_id:route.id,quantity:'10',kind:'allocate',reason:'Distribución inicial',request_key:randomUUID()});
  const customer=await req('POST','/customers',{name:'Ana',city:'Facatativá'},'seller',201);
  const session=await req('POST','/cash-sessions',{opening:'0'},'seller',201);
  const body=(extra)=>({session_id:session.id,customer_id:customer.id,items:[{product_id:pollo.id,quantity:'2',expected_price_cents:1200000}],method:'cash',request_key:randomUUID(),...extra});
  // El precio sube mientras el vendedor está en ruta.
  await req('PUT',`/products/${pollo.id}`,{name:'Pollo',price:'13000',unit:'kg',active:true,stock:'10'});
  // Venta inmediata con precio viejo: sigue siendo estricta.
  await req('POST','/sales',body(),'seller',409);
  await req('POST','/sales',body({sold_at:ago(1)}),'seller',409);
  // Venta de ruta: respeta el precio con el que se vendió y conserva la hora real.
  const soldAt=ago(90);const late=body({sold_at:soldAt,offline_ref:'R-ABC-0001'});
  const sale=await req('POST','/sales',late,'seller',201);
  assert.equal(sale.total_cents,2400000);assert.equal(sale.items[0].price_cents,1200000);assert.equal(sale.created_at,soldAt);assert.equal(sale.snapshot.offline_ref,'R-ABC-0001');
  // Reintento idéntico (la señal se cortó antes de la respuesta): misma venta, sin duplicar ni descontar dos veces.
  assert.equal((await req('POST','/sales',late,'seller',201)).id,sale.id);
  assert.equal((await req('GET','/products')).find(p=>p.id===pollo.id).stock_milli,8000);
  // La sincronización tampoco puede producir stock negativo.
  await req('POST','/sales',body({items:[{product_id:pollo.id,quantity:'11',expected_price_cents:1300000}],sold_at:ago(60)}),'seller',409);
  assert.equal((await req('GET','/products')).find(p=>p.id===pollo.id).stock_milli,8000);
  // Cliente creado en ruta llega con la venta; un reintento no lo duplica.
  const newId=randomUUID();const withCustomer=body({customer_id:newId,new_customer:{id:newId,name:'Tienda La Esquina',city:'Madrid'},items:[{product_id:pollo.id,quantity:'1',expected_price_cents:1300000}],sold_at:ago(30)});
  const s3=await req('POST','/sales',withCustomer,'seller',201);assert.equal(s3.customer_id,newId);assert.equal(s3.snapshot.customer_name,'Tienda La Esquina');
  await req('POST','/sales',withCustomer,'seller',201);assert.equal((await req('GET','/customers')).filter(c=>c.name==='Tienda La Esquina').length,1);
  // Un cliente nuevo en ruta igual a uno existente (nombre y ciudad) conserva un ID distinto y una cuenta separada.
  const dupId=randomUUID();const dup=await req('POST','/sales',body({customer_id:dupId,new_customer:{id:dupId,name:'ana',city:'facatativá'},items:[{product_id:pollo.id,quantity:'1',expected_price_cents:1300000}],sold_at:ago(20)}),'seller',201);
  assert.equal(dup.customer_id,dupId);assert.notEqual(dup.customer_id,customer.id);
  // La caja se cerró antes de que el celular subiera: sin caja abierta se rechaza; con una nueva, entra en ella.
  await req('POST',`/cash-sessions/${session.id}/close`,{declared_cash:'0',declared_electronic:'0'},'admin',201);
  const pending=body({items:[{product_id:pollo.id,quantity:'1',expected_price_cents:1300000}],sold_at:ago(15)});
  await req('POST','/sales',pending,'seller',409);
  await req('POST','/sales',body({items:[{product_id:pollo.id,quantity:'1',expected_price_cents:1300000}]}),'seller',409);
  const next=await req('POST','/cash-sessions',{opening:'0'},'seller',201);
  const moved=await req('POST','/sales',pending,'seller',201);assert.equal(moved.session_id,next.id);
  // Hora en el futuro (reloj del celular adelantado) se toma como la hora del servidor.
  await req('PUT',`/products/${pollo.id}`,{name:'Pollo',price:'13000',unit:'kg',active:true,stock:'5',reason:'Conteo de saldo sin asignar'});
  const future=await req('POST','/sales',{...body({sold_at:new Date(Date.now()+3600e3).toISOString(),items:[{product_id:pollo.id,quantity:'1',expected_price_cents:1300000}]}),session_id:next.id},'seller',201);
  assert.ok(Date.parse(future.created_at)<=Date.now());
  const alerts=await req('GET','/alerts');
  assert.deepEqual([...new Set(alerts.flatMap(a=>a.detail.alerts.map(x=>x.type)))].sort(),['price','session_moved']);
  assert.equal(alerts.find(a=>a.sale_id===sale.id).detail.alerts[0].sold_cents,1200000);
  await req('GET','/alerts',undefined,'seller',403);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
