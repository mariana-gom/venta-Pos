import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase,DEFAULT_BUSINESS_NAME} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
test('Migración: agrega datos fiscales sin perder la configuración y solo reemplaza el nombre genérico',()=>{
 const dir=mkdtempSync(join(tmpdir(),'venta-pos-migra-'));
 try{
  for(const [original,expected] of [['Mi negocio',DEFAULT_BUSINESS_NAME],['Salsamentaria La Esquina','Salsamentaria La Esquina']]){
   const path=join(dir,`${randomUUID()}.sqlite`);const old=new DatabaseSync(path);
   // Base creada con la versión anterior: settings sin columnas fiscales.
   old.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT NOT NULL, paper_width INTEGER NOT NULL CHECK(paper_width IN (58,80)))');
   old.prepare('INSERT INTO settings VALUES (1,?,58)').run(original);old.close();
   const db=openDatabase(path);const row=db.prepare('SELECT * FROM settings').get();
   assert.equal(row.business_name,expected);assert.equal(row.paper_width,58);assert.equal(row.business_nit,'');assert.equal(row.business_city,'');
   db.close();openDatabase(path).close();// Reabrir no vuelve a migrar ni falla.
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Datos del negocio congelados en la venta y número corto de caja',async()=>{
 const db=openDatabase(':memory:');
 const admin=await createUser(db,{name:'Admin',username:'admin-s',password:'admin-password-123',role:'admin'});
 const seller=await createUser(db,{name:'Mariana',username:'seller-s',password:'seller-password-123',role:'seller'});
 const tokens={admin:(await login(db,admin.username,'admin-password-123')).token,seller:(await login(db,seller.username,'seller-password-123')).token};
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(method,path,body,role='admin',status=200){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const json=await r.json();assert.equal(r.status,status,JSON.stringify(json));return json;}
 try{
  assert.equal((await req('GET','/settings')).business_name,DEFAULT_BUSINESS_NAME);
  const saved=await req('PUT','/settings',{business_name:DEFAULT_BUSINESS_NAME,paper_width:80,business_nit:'900.123.456-7',business_address:'Calle 10 # 5-20',business_city:'El Rosal',business_phone:'300 123 4567'});
  assert.equal(saved.business_nit,'900.123.456-7');
  // Omitir campos conserva su valor (compatibilidad con clientes anteriores).
  assert.equal((await req('PUT','/settings',{business_name:DEFAULT_BUSINESS_NAME,paper_width:58})).business_city,'El Rosal');
  await req('PUT','/settings',{business_name:'X',paper_width:80,business_nit:'1'.repeat(41)},'admin',400);
  await req('PUT','/settings',{business_name:'X',paper_width:80,business_nit:'1'},'seller',403);
  const product=await req('POST','/products',{name:'Pollo',price:'12000',unit:'kg'});const customer=await req('POST','/customers',{name:'Manuel',city:'El Rosal'},'seller',201);
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(product.id);
  const session=await req('POST','/cash-sessions',{opening:'0'},'seller',201);assert.equal(session.number,1);
  const sale=await req('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:product.id,quantity:'125.5'}],method:'cash',request_key:randomUUID()},'seller',201);
  assert.equal(sale.total_cents,150600000);assert.equal(sale.session_number,1);assert.equal(sale.snapshot.business_nit,'900.123.456-7');assert.equal(sale.snapshot.business_address,'Calle 10 # 5-20');
  // Cambiar los datos después no altera la venta registrada.
  await req('PUT','/settings',{business_name:'Otro',paper_width:80,business_nit:''});
  const detail=await req('GET',`/sales/${sale.id}`,undefined,'seller');assert.equal(detail.snapshot.business_nit,'900.123.456-7');assert.equal(detail.snapshot.business_name,DEFAULT_BUSINESS_NAME);
  assert.equal((await req('GET','/cash-sessions',undefined,'seller'))[0].number,1);
  const closure=await req('POST',`/cash-sessions/${session.id}/close`,{declared_cash:'1506000',declared_electronic:'0'},'admin',201);assert.equal(closure.session_number,1);
  assert.equal((await req('GET','/closures'))[0].session_number,1);
  assert.equal((await req('POST','/cash-sessions',{opening:'0'},'seller',201)).number,2);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
