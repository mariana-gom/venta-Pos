import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ExcelJS from 'exceljs';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
import {previewImport,applyImport} from '../src/import-products.js';
import {account,paidAmount} from '../src/operations.js';
const key=()=>randomUUID();
async function fixture(){
 const db=openDatabase(':memory:'),users={},tokens={};
 for(const role of ['admin','seller','other']){users[role]=await createUser(db,{username:role,name:role,password:'password-de-prueba',role:role==='admin'?'admin':'seller'});tokens[role]=(await login(db,role,'password-de-prueba')).token;}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 async function req(path,body=null,role='admin',status=200,method=body?'POST':'GET'){
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const isPdf=r.headers.get('content-type')?.includes('application/pdf'),data=isPdf?Buffer.from(await r.arrayBuffer()):await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
 }
 const product=await req('/products',{name:'Producto',price:'5000',unit:'unit',stock:'20',code:'0007',wholesale_price:'4000'});
 db.prepare('UPDATE products SET code=?,wholesale_price_cents=? WHERE id=?').run('0007',400000,product.id);
 await req('/inventory',{product_id:product.id,route_id:null,quantity:'20',kind:'entry',reason:'Entrada central',request_key:key()});
 const customer=await req('/customers',{name:'Ana',city:'Bogotá',identification:'001234'},'admin',201);
 db.prepare('UPDATE customers SET identification=? WHERE id=?').run('001234',customer.id);
 const session=await req('/cash-sessions',{opening:'1000'},'seller',201);
 const route=await req('/routes',{name:'Ruta Norte',request_key:key()},'admin',201);
 await req(`/users/${users.seller.id}/route`,{route_id:route.id,request_key:key()},'admin',200,'PUT');
 await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'20',kind:'allocate',reason:'Distribución inicial',request_key:key()});
 const sale=(method='cash',extra={})=>req('/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:product.id,quantity:'1'}],method,request_key:key(),...extra},'seller',201);
 return {db,users,tokens,req,product,customer,session,route,sale,close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
test('Referencia electrónica, crédito, abonos identificados, caja y conciliación',async()=>{
 const f=await fixture();try{
  const {req,customer,session,product,sale,db}=f;
  await req('/sales',{session_id:session.id,customer_id:customer.id,items:[{product_id:product.id,quantity:'1'}],method:'electronic',platform_id:'nequi',request_key:key()},'seller',400);
  const electronic=await sale('electronic',{platform_id:'nequi',reference:'000ABC'});assert.equal(electronic.payments[0].reference,'000ABC');
  const cash=await sale('cash',{reference:'inaplicable'});assert.equal(cash.payments[0].reference,null);
  const anonymous=await req('/customers',{name:'Ana',city:'Bogotá'},'admin',201);
  await req('/sales',{session_id:session.id,customer_id:anonymous.id,items:[{product_id:product.id,quantity:'1'}],method:'credit',request_key:key()},'seller',201);
  assert.notEqual(anonymous.id,customer.id);assert.equal((await req(`/accounts/${anonymous.id}`)).balance_cents,500000);
  const credit=await sale('credit',{reference:'inaplicable'});assert.equal(credit.payments[0].reference,null);
  assert.equal((await req(`/accounts/${customer.id}`)).balance_cents,500000);
  const body={customer_id:customer.id,amount:'2000',method:'cash',session_id:session.id,occurred_at:new Date().toISOString(),request_key:key()};
  const partial=await req('/collections',body,'admin',201);assert.equal(partial.account.state,'partial');assert.equal(partial.allocations[0].sale_id,credit.id);assert.equal(partial.account.balance_cents,300000);
  assert.equal((await req('/collections',body,'admin',201)).id,partial.id);
  for(const amount of ['0','3001'])await req('/collections',{...body,request_key:key(),amount},'admin',400);
  await req('/collections',{...body,request_key:key(),amount:'-1'},'admin',400);
  await req('/collections',{...body,request_key:key(),amount:'1'},'seller',403);
  await req('/collections',{...body,request_key:key(),amount:'1',session_id:null},'admin',400);
  await req('/collections',{...body,request_key:key(),amount:'1',method:'electronic',platform_id:'nequi'},'admin',400);
  const complete=await req('/collections',{...body,request_key:key(),amount:'3000',method:'electronic',platform_id:'nequi',reference:'000-END',occurred_at:new Date().toISOString()},'admin',201);
  assert.equal(complete.account.balance_cents,0);assert.equal(complete.account.state,'paid');assert.equal(db.prepare('SELECT total_cents FROM sales WHERE id=?').get(credit.id).total_cents,500000);
  const summary=await req(`/cash-sessions/${session.id}`);assert.equal(summary.total_cents,2000000);assert.equal(summary.credit_cents,1000000);assert.equal(summary.collection_cash_cents,200000);assert.equal(summary.collection_electronic_cents,300000);assert.equal(summary.cash_cents,700000);assert.equal(summary.electronic_cents,800000);
  await req('/collections',{...body,request_key:key(),amount:'1'},'admin',400); // saldo ya pagado
  const reviewed=summary.session_revision;
  // Un cambio de movimientos, incluso sin nuevas ventas, invalida la conciliación revisada.
  await req('/sales/'+cash.id+'/cancel',{reason:'Devolución',request_key:key(),refund:{amount:'5000',method:'cash',session_id:session.id}});
  await req('/cash-sessions/'+session.id+'/close',{reviewed_revision:reviewed,declared_cash:'3000',declared_electronic:'8000',declared_credit:'4500'},'admin',409);
  const close=await req(`/cash-sessions/${session.id}/close`,{declared_cash:'3000',declared_electronic:'8000',declared_credit:'9500'},'admin',201);assert.equal(close.snapshot.credit_difference_cents,-50000);assert.equal(close.snapshot.cash_difference_cents,0);assert.equal(close.snapshot.electronic_difference_cents,0);assert.equal(account(db,customer.id).balance_cents,0);
  await req(`/accounts/${customer.id}/pdf`);await req('/accounts',null,'seller',403);await req('/inventory',null,'seller',403);
 }finally{await f.close();}
});
test('Anulación: caja original, ajustes de cierre, abonos devueltos o reasignados, stock original e idempotencia',async()=>{
 const f=await fixture();try{
  const {req,sale,session,customer,db,route,product,users}=f;
  const cash=await sale();
  const cancel={reason:'Devolución del cliente',request_key:key(),refund:{amount:'5000',method:'cash',session_id:session.id}};
  await req(`/sales/${cash.id}/cancel`,cancel,'seller',403);
  await req(`/sales/${cash.id}/cancel`,{...cancel,reason:''},'admin',400);
  const result=await req(`/sales/${cash.id}/cancel`,cancel);assert.equal((await req(`/sales/${cash.id}/cancel`,cancel)).id,result.id);
  await req(`/sales/${cash.id}/cancel`,{...cancel,request_key:key()},'admin',409);
  assert.equal((await req(`/cash-sessions/${session.id}`)).cash_cents,0);assert.equal((await req(`/sales/${cash.id}`)).status,'cancelled');
  const credit=await sale('credit'),next=await sale('credit');
  const abono=await req('/collections',{customer_id:customer.id,amount:'1000',method:'cash',session_id:session.id,occurred_at:new Date().toISOString(),request_key:key(),allocations:[{sale_id:credit.id,amount:'1000'}]},'admin',201);
  await req(`/sales/${credit.id}/cancel`,{reason:'Error',request_key:key()},'admin',409);
  const allocation=db.prepare('SELECT id FROM collection_allocations WHERE collection_id=?').get(abono.id).id;
  await req(`/sales/${credit.id}/cancel`,{reason:'Reasignar abono',request_key:key(),resolutions:[{allocation_id:allocation,kind:'reassign',target_sale_id:next.id}]});
  assert.equal(paidAmount(db,next.id),100000);assert.equal(account(db,customer.id).balance_cents,400000);
  await req(`/sales/${next.id}/cancel`,{reason:'Devolver abono reasignado',request_key:key(),resolutions:[{allocation_id:allocation,kind:'refund'}],refund:{amount:'1000',method:'cash',session_id:session.id}});assert.equal(account(db,customer.id).balance_cents,0);
  const historical=await sale('electronic',{platform_id:'nequi',reference:'H001'}),closure=await req(`/cash-sessions/${session.id}/close`,{declared_cash:'1000',declared_electronic:'5000',declared_credit:'0'},'admin',201);
  const original=JSON.stringify(closure.snapshot),second=await req('/cash-sessions',{opening:'0'},'other',201);
  await req(`/sales/${historical.id}/cancel`,{reason:'Caja cerrada',request_key:key(),refund:{amount:'5000',method:'cash',session_id:second.id}},'admin',400);
  const route2=await req('/routes',{name:'Ruta Sur',request_key:key()},'admin',201);await req(`/users/${users.seller.id}/route`,{route_id:route2.id,request_key:key()},'admin',200,'PUT');
  await req(`/sales/${historical.id}/cancel`,{reason:'Caja cerrada',request_key:key(),refund:{amount:'5000',method:'electronic',platform_id:'nequi',reference:'000-REFUND',outside_cash_reason:'Transferencia administrativa fuera de caja'}});
  const kept=await req(`/closures/${closure.id}`);assert.equal(JSON.stringify(kept.snapshot),original);assert.equal(kept.adjustments.length,1);assert.equal((await req(`/cash-sessions/${second.id}`)).cash_cents,0);
  assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(product.id,route.id).quantity_milli,20000);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n,4);
 }finally{await f.close();}
});
test('Rutas: ausencia de asignación, aislamiento, concurrencia, venta sin inventario y movimientos',async()=>{
 const f=await fixture();try{
  const {req,db,product,users,session,customer,route}=f;
  await req('/products/'+product.id,{name:'Producto',price:'5000',unit:'kg',stock:'20'},'admin',409,'PUT');assert.equal(db.prepare('SELECT unit FROM products WHERE id=?').get(product.id).unit,'unit');
  const other=await req('/cash-sessions',{opening:'0'},'other',201),body={session_id:other.id,customer_id:customer.id,items:[{product_id:product.id,quantity:'1'}],method:'cash',request_key:key()};
  await req('/sales',body,'other',409);
  await req(`/users/${users.other.id}/route`,{route_id:route.id,request_key:key()},'admin',200,'PUT');
  await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'1',kind:'adjustment',reason:'Conteo físico',request_key:key()});
  const attempts=await Promise.allSettled([req('/sales',body,'other',201),req('/sales',{...body,session_id:session.id,request_key:key()},'seller',201)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(product.id,route.id).quantity_milli,0);
  assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(product.id).stock_milli,0);
  const free=await req('/products',{name:'Sin inventario histórico',price:'1000',unit:'unit'});db.prepare('UPDATE products SET stock_milli=NULL WHERE id=?').run(free.id);await req(`/users/${users.other.id}/route`,{route_id:null,request_key:key()},'admin',200,'PUT');await req('/sales',{...body,items:[{product_id:free.id,quantity:'1'}],request_key:key()},'other',201);
  const newRoute=await req('/routes',{name:'Nueva ruta',request_key:key()},'admin',201);
  await req('/inventory',{product_id:product.id,route_id:null,quantity:'2',kind:'entry',reason:'Entrada central',request_key:key()});
  await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'2',kind:'allocate',reason:'Carga adicional',request_key:key()});
  await req('/users/'+users.seller.id+'/route',{route_id:newRoute.id,request_key:key()},'admin',200,'PUT');
  await req('/sales',{...body,session_id:session.id,route_id:route.id,sold_at:new Date(Date.now()-3600000).toISOString(),request_key:key()},'seller',409);
  await req('/sales',{...body,session_id:session.id,sold_at:new Date(Date.now()-3600000).toISOString(),request_key:key()},'seller',409);
  assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(product.id,route.id).quantity_milli,2000);
  await req('/routes',{name:'Ajena',request_key:key()},'seller',403);await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'10',kind:'entry',reason:'Entrada',request_key:key()},'seller',403);
 }finally{await f.close();}
});
test('Importación: precio único, modalidad explícita o completada, códigos, errores y rollback',async()=>{
 const f=await fixture();try{
  const {db,users,product}=f,wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Productos');
  sheet.getRow(5).values=['ID producto','Código','Descripción','Categoría','Marca','Precio de venta (COP)','Precio de venta mayoristas'];
  sheet.addRow(['','0007','Nombre actualizado','','',{error:'#VALUE!'},4500]);
  sheet.addRow(['','0008','Nuevo','','',{formula:'1/0',result:{error:'#DIV/0!'}},6000]);
  for(const [code,price] of [['0009',null],['0010',{formula:'1+1'}],['0011',{error:'#VALUE!'}],['0012',-1],['0014',0],['0017','3000']])sheet.addRow(['',code,'Inválido','','',999,price]);
  sheet.addRow(['','DUP','Duplicado','','',1,100]);sheet.addRow(['','DUP','Duplicado2','','',1,200]);
  sheet.addRow([product.id,'conflicto','Conflicto','','',1,100]);
  const buffer=Buffer.from(await wb.xlsx.writeBuffer()),preview=await previewImport(db,users.admin,buffer),movements=db.prepare('SELECT count(*) n FROM inventory_movements').get().n;
  assert.equal(preview.header_row,5);assert.equal(preview.unit_column,null);assert.equal(preview.summary.new,1);assert.equal(preview.summary.updates,1);
  assert.throws(()=>applyImport(db,users.admin,{preview_id:preview.id,request_key:key(),units:[]}),{status:400});assert.equal(db.prepare('SELECT price_cents FROM products WHERE id=?').get(product.id).price_cents,500000);
  const input={preview_id:preview.id,request_key:key(),units:[{row:7,unit:'kg'}]},result=applyImport(db,users.admin,input);assert.equal(result.summary.created,1);assert.equal(result.summary.updated,1);assert.deepEqual(applyImport(db,users.admin,input),result);
  const after=db.prepare('SELECT * FROM products WHERE id=?').get(product.id);assert.equal(after.price_cents,450000);assert.equal(after.name,'Nombre actualizado');assert.equal(after.wholesale_price_cents,400000);assert.equal(after.stock_milli,20000);
  const created=db.prepare("SELECT * FROM products WHERE code='0008'").get();assert.equal(created.price_cents,600000);assert.equal(created.unit,'kg');assert.equal(created.active,1);assert.equal(created.stock_milli,0);assert.equal(created.central_stock_enabled,0);assert.equal(db.prepare('SELECT count(*) n FROM inventory_movements').get().n,movements);
  assert.throws(()=>applyImport(db,users.seller,input),{status:403});assert.throws(()=>applyImport(db,users.admin,{...input,request_key:key()}),{status:409});
  const explicit=new ExcelJS.Workbook(),es=explicit.addWorksheet('Productos');es.getRow(3).values=['Descripción','Precio de venta mayoristas','Unidad de venta','Código'];es.addRow(['Por peso',2300,'Kilogramo','0020']);es.addRow(['Por unidad',900,'Unidad',21]);es.getRow(5).getCell(4).numFmt='0000';
  const ep=await previewImport(db,users.admin,Buffer.from(await explicit.xlsx.writeBuffer()));assert.equal(ep.unit_column,'Unidad de venta');const er=applyImport(db,users.admin,{preview_id:ep.id,request_key:key(),units:[]});assert.equal(er.summary.created,2);assert.equal(db.prepare("SELECT unit FROM products WHERE code='0021'").get().unit,'unit');
  const stale=await previewImport(db,users.admin,buffer);db.prepare('UPDATE products SET price_cents=777 WHERE id=?').run(product.id);assert.throws(()=>applyImport(db,users.admin,{preview_id:stale.id,request_key:key(),units:[{row:7,unit:'kg'}]}),{status:409});
 }finally{await f.close();}
});
test('Migración de stock: sin duplicar existencias y conservando históricos e integridad',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pos-migration-')),file=join(dir,'old.sqlite');try{
  const old=new DatabaseSync(file);old.exec(readFileSync(new URL('../src/schema.sql',import.meta.url),'utf8'));old.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)').run(key(),'Histórico',10000,'unit',1,20000,new Date().toISOString(),new Date().toISOString());old.close();
  const db=openDatabase(file);assert.equal(db.prepare('SELECT SUM(quantity_milli) n FROM unassigned_stock').get().n,20000);assert.equal(db.prepare('SELECT COUNT(*) n FROM route_stock').get().n,0);assert.equal(db.prepare('SELECT SUM(stock_milli) n FROM products').get().n,20000);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
  const again=openDatabase(file);assert.equal(again.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,1);again.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Abonos fuera de caja, distribución más antigua y extracto con saldo inicial',async()=>{
 const f=await fixture();try{
  const {req,sale,customer,session,db}=f;
  const older=await sale('credit',{sold_at:new Date(Date.now()-2*86400000).toISOString()}),current=await sale('credit');
  const body={customer_id:customer.id,amount:'7000',method:'cash',outside_cash_reason:'Cobro administrativo en oficina',occurred_at:new Date().toISOString(),request_key:key()};
  const payment=await req('/collections',body,'admin',201);assert.deepEqual(payment.allocations.map(a=>[a.sale_id,a.amount_cents]),[[older.id,500000],[current.id,200000]]);
  assert.equal(payment.account.balance_cents,300000);assert.equal((await req('/cash-sessions/'+session.id)).cash_cents,0);
  assert.equal((await req('/accounts?search=Ana')).length,1);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const pdf=await req('/accounts/'+customer.id+'/pdf?from='+today+'&to='+today);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  const {spawnSync}=await import('node:child_process'),text=spawnSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8'});
  if(!text.error){assert.match(text.stdout,/Saldo inicial:\s*\$\s*5\.000/);assert.match(text.stdout,/Saldo final:\s*\$\s*3\.000/);}
  const before=account(db,customer.id).balance_cents;
  await req('/collections',{...body,amount:'1',request_key:key(),occurred_at:new Date(Date.now()+3600000).toISOString()},'admin',400);
  assert.equal(account(db,customer.id).balance_cents,before);
 }finally{await f.close();}
});

test('Productos simples, cargas diarias atómicas, central opcional, sobrantes, devolución y caja intacta',async()=>{
 const f=await fixture();try{
  const {req,db,route,product,session,sale}=f;
  const kg=await req('/products',{name:'Peso nuevo',unit:'kg',price:'10000',stock:'99',code:'NO-EXIGIDO',brand:'Ignorada'});
  assert.equal(kg.price_cents,1000000);assert.equal(kg.code,null);assert.equal(kg.stock_milli,0);assert.equal(kg.central_stock_enabled,0);assert.equal(kg.wholesale_price_cents,undefined);assert.equal(kg.brand,undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM inventory_movements WHERE product_id=?').get(kg.id).n,0);
  assert.equal(db.prepare('SELECT * FROM unassigned_stock WHERE product_id=?').get(kg.id),undefined);
  const beforeCash=await req('/cash-sessions/'+session.id),date=new Date().toISOString().slice(0,10);
  const input={route_id:route.id,date,reason:'Entrega diaria',request_key:key(),items:[{product_id:kg.id,quantity:'2.750',expected_before_milli:0,expected_central_milli:null}]};
  const responses=await Promise.all([req('/inventory/loads',input,'admin',201),req('/inventory/loads',input,'admin',201)]);assert.equal(responses[0].id,responses[1].id);
  assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(kg.id).stock_milli,2750);
  assert.equal((await req('/inventory/loads'))[0].items[0].after_milli,2750);
  await req('/sales',{session_id:session.id,customer_id:f.customer.id,method:'cash',request_key:key(),items:[{product_id:kg.id,quantity:'0.250'}]},'seller',201);
  const next={...input,date:new Date(Date.now()+86400000).toISOString().slice(0,10),request_key:key(),items:[{product_id:kg.id,quantity:'1.125',expected_before_milli:2500,expected_central_milli:null}]};
  await req('/inventory/loads',next,'admin',201);assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(kg.id,route.id).quantity_milli,3625);
  await req('/inventory/loads',{...next,request_key:key()},'admin',409); // reviewed amount is stale
  await req('/inventory/loads',{...input,request_key:key()},'seller',403);
  await req('/inventory',{product_id:product.id,route_id:null,quantity:'3',kind:'entry',reason:'Reabastecimiento central',request_key:key()});
  const multi={...input,request_key:key(),items:[{product_id:kg.id,quantity:'1',expected_before_milli:3625,expected_central_milli:null},{product_id:product.id,quantity:'4',expected_before_milli:20000,expected_central_milli:3000}]};
  await req('/inventory/loads',multi,'admin',409);assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(kg.id).stock_milli,3625); // no partial entry
  multi.items[1].quantity='2';const loaded=await req('/inventory/loads',multi,'admin',201);assert.equal(loaded.items[1].source,'central');assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(product.id).stock_milli,23000);
  assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(product.id).quantity_milli,1000);
  await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'1',kind:'return',reason:'Sobrante devuelto',request_key:key()});assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(product.id).quantity_milli,2000);assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(product.id).stock_milli,23000);
  await req('/inventory',{product_id:kg.id,route_id:route.id,quantity:'0.625',kind:'return',reason:'Sobrante sin central',request_key:key()});assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(kg.id).stock_milli,4000);assert.equal(db.prepare('SELECT * FROM unassigned_stock WHERE product_id=?').get(kg.id),undefined);
  await req('/inventory/loads',{...input,request_key:key(),items:[{product_id:product.id,quantity:'0.5',expected_before_milli:21000,expected_central_milli:2000}]},'admin',400);
  const afterCash=await req('/cash-sessions/'+session.id);assert.equal(afterCash.sale_count,beforeCash.sale_count+1);assert.equal(afterCash.total_cents,250000);assert.equal(db.prepare('SELECT count(*) n FROM debts').get().n,0);
  const historical=await sale();const oldPrice=historical.items[0].price_cents;
  db.prepare('INSERT INTO product_price_reviews VALUES(?,?,?,?,?,?)').run(product.id,500000,400000,null,null,null);
  const priceBody={request_key:key(),items:[{product_id:product.id,price:'4000',expected_price_cents:500000,expected_wholesale_cents:400000}]};
  assert.equal((await req('/products/price-migration'))[0].price_cents,500000);await req('/products/price-migration',priceBody);await req('/products/price-migration',priceBody);assert.equal((await req('/products/price-migration')).length,0);assert.equal((await req('/sales/'+historical.id)).items[0].price_cents,oldPrice);assert.equal((await sale()).items[0].price_cents,400000);
 }finally{await f.close();}
});

test('Extracto automático: primera factura y último movimiento, factura posterior al último abono, rangos y sin movimientos',async()=>{
 const f=await fixture();try{
  const {statementPeriod}=await import('../src/pdf.js'),{calendarDay}=await import('../src/sales-access.js'),{req,customer,db,sale}=f;
  await sale('credit',{sold_at:new Date(Date.now()-3*86400000).toISOString()});
  await req('/collections',{customer_id:customer.id,amount:'1000',method:'cash',outside_cash_reason:'Cobro en oficina',occurred_at:new Date(Date.now()-2*86400000).toISOString(),request_key:key()},'admin',201);
  await sale('credit');
  const data=account(db,customer.id),period=statementPeriod(data);assert.equal(period.from,calendarDay(data.debts[0].created_at));assert.equal(period.to,calendarDay(data.debts.at(-1).created_at));assert.equal(period.initial,0);assert.equal(period.final,900000);
  const ranged=statementPeriod(data,{from:period.to,to:period.to});assert.equal(ranged.initial,400000);assert.equal(ranged.final,900000);assert.equal(ranged.events.length,1);
  const pdf=await req('/accounts/'+customer.id+'/pdf');const {spawnSync}=await import('node:child_process'),text=spawnSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8'});if(!text.error){assert.equal(text.status,0);assert.ok(text.stdout.includes(`Periodo: ${period.from} - ${period.to}`));assert.match(text.stdout,/Generado:/);}
  const empty=await req('/customers',{name:'Sin movimientos',city:'Bogotá'},'admin',201);const ep=statementPeriod(account(db,empty.id));assert.equal(ep.from,null);assert.equal(ep.to,null);
  const emptyPdf=await req('/accounts/'+empty.id+'/pdf?from='+period.from+'&to='+period.to),emptyText=spawnSync('pdftotext',['-','-'],{input:emptyPdf,encoding:'utf8'});if(!emptyText.error)assert.match(emptyText.stdout,/Sin movimientos de cartera/);
 }finally{await f.close();}
});
