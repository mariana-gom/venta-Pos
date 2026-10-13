import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
import {salesDay,dayStart} from '../src/sales-access.js';

test('Día del negocio: Bogotá por defecto, medianoche y horario de verano',()=>{
 const original=process.env.BUSINESS_TIME_ZONE;
 try {
  delete process.env.BUSINESS_TIME_ZONE;
  assert.deepEqual(salesDay('2026-10-13T04:59:59.999Z'),{date:'2026-10-12',time_zone:'America/Bogota',start:'2026-10-12T05:00:00.000Z',end:'2026-10-13T05:00:00.000Z',server_now:'2026-10-13T04:59:59.999Z'});
  assert.equal(salesDay('2026-10-13T05:00:00.000Z').date,'2026-10-13');
  process.env.BUSINESS_TIME_ZONE='America/New_York';
  const spring=salesDay('2026-03-08T12:00:00Z'),fall=salesDay('2026-11-01T12:00:00Z');
  assert.equal(Date.parse(spring.end)-Date.parse(spring.start),23*3600000);
  assert.equal(Date.parse(fall.end)-Date.parse(fall.start),25*3600000);
  assert.equal(dayStart('2026-10-12','Asia/Tokyo'),'2026-10-11T15:00:00.000Z');
  process.env.BUSINESS_TIME_ZONE='zona-invalida';assert.throws(()=>salesDay(),RangeError);
 }finally{if(original===undefined)delete process.env.BUSINESS_TIME_ZONE;else process.env.BUSINESS_TIME_ZONE=original;}
});

test('API: vendedores limitados al día y propietario; administrador histórico; reintentos y cambio de día',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-13T04:59:59.999Z')});
 const db=openDatabase(':memory:');let server;
 try{
  const users={},tokens={};
  for(const role of ['admin','seller','other']){
   users[role]=await createUser(db,{username:role,name:role,password:'clave-segura-prueba',role:role==='admin'?'admin':'seller'});
   tokens[role]=(await login(db,role,'clave-segura-prueba')).token;
  }
  server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function req(path,role='seller',method='GET',body,status=200){
   const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
   assert.equal(r.status,status,`${method} ${path}: ${r.status}`);assert.equal(r.headers.get('cache-control'),'no-store');
   return r.headers.get('content-type')?.includes('application/pdf')?Buffer.from(await r.arrayBuffer()):r.json();
  }
  const product=await req('/products','admin','POST',{name:'Producto',price:'5000',unit:'unit'});
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(product.id);
  const customer=await req('/customers','seller','POST',{name:'Cliente',city:'Bogotá'},201);
  const session=await req('/cash-sessions','seller','POST',{opening:'1000'},201);
  const otherSession=await req('/cash-sessions','other','POST',{opening:'0'},201);
  const body=(session_id=session.id,sold_at='2026-10-12T05:00:00.000Z')=>({session_id,customer_id:customer.id,items:[{product_id:product.id,quantity:'1'}],method:'cash',request_key:randomUUID(),sold_at});
  const todayBody=body(),today=await req('/sales','seller','POST',todayBody,201);
  const last=await req('/sales','seller','POST',body(session.id,'2026-10-13T04:59:59.998Z'),201);
  const oldBody=body(session.id,'2026-10-12T04:59:59.999Z'),old=await req('/sales','seller','POST',oldBody,201);
  assert.equal(old.history_restricted,true);assert.equal(old.items,undefined);assert.equal(old.snapshot,undefined);
  assert.deepEqual(await req('/sales','seller','POST',oldBody,201),old);
  const foreign=await req('/sales','other','POST',body(otherSession.id),201);
  for(const query of ['', '?from=2020-01-01&to=2030-12-31&role=admin&today=2020-01-01',`?session_id=${session.id}`,`?customer_id=${customer.id}&method=cash`, '?page=2']){
   const result=await req('/sales'+query);assert.equal(result.count,2);assert.ok(result.sales.every(s=>s.id===today.id||s.id===last.id));
   assert.equal(result.groups.method[0].count,2);assert.equal(result.groups.method[0].total_cents,1000000);
  }
  assert.equal((await req('/sales?from=2026-10-11&to=2026-10-11')).count,0);
  assert.equal((await req(`/sales?seller_id=${users.other.id}`)).count,0);
  await req(`/sales/${old.id}`,'seller','GET',null,403);await req(`/sales/${old.id}/pdf`,'seller','GET',null,403);
  await req(`/sales/${foreign.id}`,'seller','GET',null,403);await req(`/sales/${today.id}`);await req(`/sales/${today.id}/pdf`);
  assert.equal((await req('/cash-sessions'))[0].sale_count,2);assert.equal((await req(`/cash-sessions/${session.id}`)).sale_count,2);
  assert.equal((await req('/sales','admin')).count,4);assert.equal((await req('/sales?from=2026-10-11&to=2026-10-11','admin')).count,1);
  await req(`/sales/${old.id}`,'admin');await req(`/sales/${old.id}/pdf`,'admin');
  await req('/closures','seller','GET',null,403);await req('/audit','seller','GET',null,403);
  t.mock.timers.setTime(new Date('2026-10-13T05:00:00.000Z').getTime());
  assert.equal((await req('/sales/access')).date,'2026-10-13');assert.equal((await req('/sales')).count,0);
  await req(`/sales/${today.id}`,'seller','GET',null,403);await req(`/sales/${today.id}/pdf`,'seller','GET',null,403);
  assert.equal((await req('/sales','seller','POST',todayBody,201)).history_restricted,true);
  const midnight=await req('/sales','seller','POST',body(session.id,'2026-10-13T05:00:00.000Z'),201);
  assert.equal((await req('/sales')).sales[0].id,midnight.id);assert.equal((await req('/cash-sessions'))[0].sale_count,1);
  assert.equal((await req('/sales','admin')).count,5);assert.equal((await req('/cash-sessions','admin')).find(s=>s.id===session.id).sale_count,4);
  process.env.BUSINESS_TIME_ZONE='Asia/Tokyo';
  try{
   const zoned=await req('/sales');assert.equal(zoned.access.time_zone,'Asia/Tokyo');assert.equal(zoned.count,2);assert.equal(zoned.groups.date[0].key,'2026-10-13');
   assert.equal((await req('/sales?from=2026-10-12&to=2026-10-12','admin')).count,3);
   await req(`/sales/${today.id}`,'seller','GET',null,403);
  }finally{delete process.env.BUSINESS_TIME_ZONE;}
  // El rol se vuelve a leer de la BD en cada petición, aunque el token se haya emitido como admin.
  db.prepare("UPDATE users SET role='seller' WHERE id=?").run(users.admin.id);
  assert.equal((await req('/sales?role=admin','admin')).count,0);await req(`/sales/${old.id}`,'admin','GET',null,403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n,5);
 }finally{if(server)await new Promise(r=>server.close(r));db.close();}
});
