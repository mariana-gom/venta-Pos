import test from 'node:test';
import {backup} from 'node:sqlite';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
import {receiptPdf,closurePdf} from '../src/pdf.js';
test('Flujo integral: permisos, stock, conciliación, persistencia e históricos',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'venta-pos-'));const path=join(dir,'data.sqlite');let db=openDatabase(path);
 const a=await createUser(db,{name:'Administradora',username:'admin',password:'admin-123456789',role:'admin'});
 const u=await createUser(db,{name:'Vendedora',username:'seller',password:'seller-123456789',role:'seller'});
 const other=await createUser(db,{name:'Otro',username:'other',password:'seller-123456789',role:'seller'});
 const tokens={admin:(await login(db,a.username,'admin-123456789')).token,seller:(await login(db,u.username,'seller-123456789')).token,other:(await login(db,other.username,'seller-123456789')).token};
 let server=createApp(db).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));let base=`http://127.0.0.1:${server.address().port}`;
 async function request(method,url,body,role='admin',status=200){const r=await fetch(base+'/api'+url,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const json=await r.json();assert.equal(r.status,status,JSON.stringify(json));return json;}
 try{
  await request('POST','/products',{name:'Denegado',price:'1',unit:'unit'},'seller',403);
  const unit=await request('POST','/products',{name:'Producto unidad',price:'5000',unit:'unit',stock:'1000'},'admin');
  await request('POST','/inventory',{product_id:unit.id,route_id:null,quantity:'1000',kind:'entry',reason:'Entrada central',request_key:randomUUID()});
  const route=await request('POST','/routes',{name:'Ruta prueba',request_key:randomUUID()},'admin',201);
  await request('PUT','/users/'+u.id+'/route',{route_id:route.id,request_key:randomUUID()});
  await request('POST','/inventory',{product_id:unit.id,route_id:route.id,quantity:'1000',kind:'allocate',reason:'Distribución inicial',request_key:randomUUID()});
  const cheese=await request('POST','/products',{name:'Queso campesino',price:'24000',unit:'kg'},'admin');
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(cheese.id);
  const customer=await request('POST','/customers',{name:'Ana',city:'Bogotá'},'seller',201);
  const duplicate=await request('POST','/customers',{name:'Ana',city:'Bogotá'},'seller',201);assert.notEqual(duplicate.id,customer.id);
  const session=await request('POST','/cash-sessions',{opening:'0'},'seller',201);
  await request('POST','/cash-sessions',{opening:'0'},'seller',409);
  const sell=(items,method='cash',platform_id=null,key=randomUUID())=>request('POST','/sales',{session_id:session.id,customer_id:customer.id,items,method,platform_id,reference:method==='electronic'?'000-PRUEBA':undefined,request_key:key},'seller',201);
  const firstKey=randomUUID();const first=await sell([{product_id:unit.id,quantity:'3'}],'cash',null,firstKey);assert.equal(first.total_cents,1500000);
  assert.equal((await sell([{product_id:unit.id,quantity:'3'}],'cash',null,firstKey)).id,first.id);
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:unit.id,quantity:'4'}],method:'cash',request_key:firstKey},'seller',409);
  const weighted=await sell([{product_id:cheese.id,quantity:'1,5'}]);assert.equal(weighted.total_cents,3600000);
  const electronic=await sell([{product_id:unit.id,quantity:'10'}],'electronic','nequi');assert.equal(electronic.total_cents,5000000);
  let summary=await request('GET',`/cash-sessions/${session.id}`,undefined,'seller');assert.equal(summary.electronic_cents,5000000);assert.equal(summary.platforms[0].amount,5000000);
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[],method:'cash',request_key:randomUUID()},'seller',400);
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:unit.id,quantity:'1.5'}],method:'cash',request_key:randomUUID()},'seller',400);
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:unit.id,quantity:'1001'}],method:'cash',request_key:randomUUID()},'seller',409);
  summary=await request('GET',`/cash-sessions/${session.id}`,undefined,'seller');assert.equal(summary.sale_count,3);
  await request('GET',`/sales/${first.id}`,undefined,'other',403);
  await request('POST',`/cash-sessions/${session.id}/close`,{declared_cash:'0',declared_electronic:'0'},'seller',403);
  await request('PUT',`/products/${unit.id}`,{name:'Nuevo nombre',price:'10000',unit:'unit',stock:'987'});
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:unit.id,quantity:'1',expected_price_cents:500000}],method:'cash',request_key:randomUUID()},'seller',409);
  await request('GET','/sales?to=2026-99-99',undefined,'admin',400);
  assert.equal((await request('GET',`/sales/${first.id}`)).items[0].price_cents,500000);
  assert.equal((await request('GET',`/sales/${first.id}`)).items[0].name,'Producto unidad');
  // Completar exactamente 2 millones efectivo y 500 mil electrónico.
  const cashTop=await request('POST','/products',{name:'Ajuste prueba efectivo',price:'1949000',unit:'unit'});
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(cashTop.id);
  const elecTop=await request('POST','/products',{name:'Ajuste prueba electrónico',price:'450000',unit:'unit'});
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(elecTop.id);
  await sell([{product_id:cashTop.id,quantity:'1'}]);await sell([{product_id:elecTop.id,quantity:'1'}],'electronic','nequi');
  await backup(db,join(dir,'backup.sqlite'));const restored=openDatabase(join(dir,'backup.sqlite'));assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM sales').get().n,5);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM documents').get().n,10);restored.close();
  await new Promise(resolve=>server.close(resolve));db.close();db=openDatabase(path);server=createApp(db).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
  summary=await request('GET',`/cash-sessions/${session.id}`,undefined,'seller');assert.equal(summary.sale_count,5);assert.equal(summary.cash_cents,200000000);assert.equal(summary.electronic_cents,50000000);
  await request('POST',`/cash-sessions/${session.id}/close`,{reviewed_sale_count:4,declared_cash:'2300000',declared_electronic:'200000'},'admin',409);
  assert.equal((await request('GET',`/cash-sessions/${session.id}`)).state,'open');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE sale_id IS NOT NULL').get().n,10);
  const close=await request('POST',`/cash-sessions/${session.id}/close`,{declared_cash:'2300000',declared_electronic:'200000',notes:'Revisar clasificación de pagos'},'admin',201);
  assert.equal(close.snapshot.cash_difference_cents,30000000);assert.equal(close.snapshot.electronic_difference_cents,-30000000);assert.equal(close.snapshot.total_difference_cents,0);
  await request('POST',`/cash-sessions/${session.id}/close`,{declared_cash:'0',declared_electronic:'0'},'admin',409);
  await request('POST','/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:unit.id,quantity:'1'}],method:'cash',request_key:randomUUID()},'seller',409);
  // Un reintento de una venta ya confirmada conserva su respuesta incluso después del cierre.
  assert.equal((await sell([{product_id:unit.id,quantity:'3'}],'cash',null,firstKey)).id,first.id);
  assert.throws(()=>db.prepare('UPDATE closures SET snapshot=? WHERE id=?').run('{}',close.id),/inmutable/);
  assert.throws(()=>db.prepare('DELETE FROM sales WHERE id=?').run(first.id),/inmutable/);
  const annotation=await request('POST',`/closures/${close.id}/notes`,{note:'Corrección informativa; no altera valores'},'admin',201);assert.equal(annotation.annotations.length,1);assert.deepEqual(annotation.snapshot,close.snapshot);
  const newSession=await request('POST','/cash-sessions',{opening:'100000'},'seller',201);
  assert.equal((await request('GET',`/cash-sessions/${newSession.id}`)).sale_count,0);
  assert.equal((await request('GET',`/sales?session_id=${session.id}`)).count,5);
  assert.equal((await request('GET','/closures')).length,1);
  const closeWithOpening=await request('POST',`/cash-sessions/${newSession.id}/close`,{declared_cash:'100000',declared_electronic:'0'},'admin',201);assert.equal(closeWithOpening.snapshot.cash_difference_cents,0);assert.equal(closeWithOpening.snapshot.total_cents,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE closure_id IS NOT NULL').get().n,4);
  const originalPdf=Buffer.from(db.prepare('SELECT content FROM documents WHERE sale_id=? AND width=58').get(first.id).content);
  await request('PUT','/settings',{business_name:'Nuevo negocio',paper_width:80});
  const pdfCopy=await fetch(base+`/api/sales/${first.id}/pdf?width=58`,{headers:{Authorization:`Bearer ${tokens.seller}`}});assert.deepEqual(Buffer.from(await pdfCopy.arrayBuffer()),originalPdf);
  const output=process.env.PDF_OUTPUT_DIR;if(output)mkdirSync(output,{recursive:true});
  for(const width of [58,80]){
   const salePdf=await receiptPdf(first,width);const closePdf=await closurePdf(close,width);
   assert.equal(salePdf.subarray(0,4).toString(),'%PDF');assert.equal(closePdf.subarray(0,4).toString(),'%PDF');
   if(output){writeFileSync(join(output,`venta-${width}mm.pdf`),salePdf);writeFileSync(join(output,`cierre-${width}mm.pdf`),closePdf);}
   const response=await fetch(base+`/api/sales/${first.id}/pdf?width=${width}`,{headers:{Authorization:`Bearer ${tokens.seller}`}});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
  }
  await request('GET',`/closures/${close.id}`,undefined,'seller',403);
  assert.equal((await request('GET','/audit')).some(a=>a.action==='cash.close'),true);
  await request('POST','/auth/logout',{},'seller');await request('GET','/me',undefined,'seller',401);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Concurrencia: cierre único y ninguna venta posterior al cierre',async()=>{
 const db=openDatabase(':memory:');const admin=await createUser(db,{name:'Admin',username:'race-admin',password:'race-password-123',role:'admin'});const user=await createUser(db,{name:'Seller',username:'race-seller',password:'race-password-123',role:'seller'});
 const adminToken=(await login(db,admin.username,'race-password-123')).token;const sellerToken=(await login(db,user.username,'race-password-123')).token;
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(path,body,token){const r=await fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 try{
  const p=(await req('/products',{name:'P',unit:'unit',price:'5000'},adminToken)).data;
  db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(p.id);
  const c=(await req('/customers',{name:'C',city:'Bogotá'},sellerToken)).data;
  const s=(await req('/cash-sessions',{opening:'0'},sellerToken)).data;
  const body={session_id:s.id,customer_id:c.id,items:[{product_id:p.id,quantity:'1'}],method:'cash',request_key:randomUUID()};
  const races=await Promise.all([req('/sales',body,sellerToken),req(`/cash-sessions/${s.id}/close`,{declared_cash:'0',declared_electronic:'0'},adminToken),req(`/cash-sessions/${s.id}/close`,{declared_cash:'0',declared_electronic:'0'},adminToken)]);
  assert.equal(races.slice(1).filter(r=>r.status===201).length,1);assert.equal(races.slice(1).filter(r=>r.status===409).length,1);
  assert.ok([201,409].includes(races[0].status));
  const snapshot=JSON.parse(db.prepare('SELECT snapshot FROM closures').get().snapshot);
  assert.equal(snapshot.sale_count,db.prepare('SELECT COUNT(*) AS n FROM sales').get().n);
  assert.equal(snapshot.cash_cents,db.prepare('SELECT COALESCE(SUM(total_cents),0) AS n FROM sales').get().n);
  assert.equal((await req('/sales',{...body,request_key:randomUUID()},sellerToken)).status,409);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
