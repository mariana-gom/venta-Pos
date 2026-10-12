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
 const customer=await req('/customers',{name:'Ana',city:'Bogotá',identification:'001234'},'admin',201);
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
  const anonymous=await req('/customers',{name:'Sin documento',city:'Bogotá'},'admin',201);
  await req('/sales',{session_id:session.id,customer_id:anonymous.id,items:[{product_id:product.id,quantity:'1'}],method:'credit',request_key:key()},'seller',400);
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
  const summary=await req(`/cash-sessions/${session.id}`);assert.equal(summary.total_cents,1500000);assert.equal(summary.credit_cents,500000);assert.equal(summary.collection_cash_cents,200000);assert.equal(summary.collection_electronic_cents,300000);assert.equal(summary.cash_cents,700000);assert.equal(summary.electronic_cents,800000);
  await req('/collections',{...body,request_key:key(),amount:'1'},'admin',400); // saldo ya pagado
  const reviewed=summary.session_revision;
  // Un cambio de movimientos, incluso sin nuevas ventas, invalida la conciliación revisada.
  await req('/sales/'+cash.id+'/cancel',{reason:'Devolución',request_key:key(),refund:{amount:'5000',method:'cash',session_id:session.id}});
  await req('/cash-sessions/'+session.id+'/close',{reviewed_revision:reviewed,declared_cash:'3000',declared_electronic:'8000',declared_credit:'4500'},'admin',409);
  const close=await req(`/cash-sessions/${session.id}/close`,{declared_cash:'3000',declared_electronic:'8000',declared_credit:'4500'},'admin',201);assert.equal(close.snapshot.credit_difference_cents,-50000);assert.equal(close.snapshot.cash_difference_cents,0);assert.equal(close.snapshot.electronic_difference_cents,0);assert.equal(account(db,customer.id).balance_cents,0);
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
  const other=await req('/cash-sessions',{opening:'0'},'other',201),body={session_id:other.id,customer_id:customer.id,items:[{product_id:product.id,quantity:'1'}],method:'cash',request_key:key()};
  await req('/sales',body,'other',409);
  await req(`/users/${users.other.id}/route`,{route_id:route.id,request_key:key()},'admin',200,'PUT');
  await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'1',kind:'adjustment',reason:'Conteo físico',request_key:key()});
  const attempts=await Promise.allSettled([req('/sales',body,'other',201),req('/sales',{...body,session_id:session.id,request_key:key()},'seller',201)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(product.id,route.id).quantity_milli,0);
  assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(product.id).stock_milli,0);
  const free=await req('/products',{name:'Sin inventario',price:'1000',unit:'unit'});await req(`/users/${users.other.id}/route`,{route_id:null,request_key:key()},'admin',200,'PUT');await req('/sales',{...body,items:[{product_id:free.id,quantity:'1'}],request_key:key()},'other',201);
  const newRoute=await req('/routes',{name:'Nueva ruta',request_key:key()},'admin',201);
  await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'2',kind:'entry',reason:'Entrada',request_key:key()});
  await req('/users/'+users.seller.id+'/route',{route_id:newRoute.id,request_key:key()},'admin',200,'PUT');
  await req('/sales',{...body,session_id:session.id,route_id:route.id,sold_at:new Date(Date.now()-3600000).toISOString(),request_key:key()},'seller',409);
  await req('/sales',{...body,session_id:session.id,sold_at:new Date(Date.now()-3600000).toISOString(),request_key:key()},'seller',409);
  assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=? AND route_id=?').get(product.id,route.id).quantity_milli,2000);
  await req('/routes',{name:'Ajena',request_key:key()},'seller',403);await req('/inventory',{product_id:product.id,route_id:route.id,quantity:'10',kind:'entry',reason:'Entrada',request_key:key()},'seller',403);
 }finally{await f.close();}
});
test('Importación: fila 5, precio normal ignorado, fórmulas, duplicados, ceros, borradores y vista previa atómica',async()=>{
 const f=await fixture();try{
  const {db,users,product}=f;const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Productos');sheet.getRow(5).values=['ID producto','Código','Descripción','Categoría','Marca','Precio de venta (COP)','Precio de venta mayoristas'];
  sheet.addRow(['','0007','Nombre que no sobrescribe','Otra','Otra',{error:'#VALUE!'},4500]);
  sheet.addRow(['','0008','Nuevo','Comidas','Marca',{formula:'1/0',result:{error:'#DIV/0!'}},6000]);
  sheet.addRow(['','0009','Vacío','Comidas','Marca',99999,null]);sheet.addRow(['','0010','Fórmula sin resultado','Comidas','Marca',1,{formula:'1+1'}]);
  sheet.addRow(['','0011','Error','Comidas','Marca',1,{error:'#VALUE!'}]);sheet.addRow(['','0012','Negativo','Comidas','Marca',1,-1]);
  sheet.addRow(['','0013','Duplicado','Comidas','Marca',1,100]);sheet.addRow(['','0013','Duplicado2','Comidas','Marca',1,200]);
  sheet.addRow(['','0014','Cero','Comidas','Marca',1,0]);sheet.addRow(['','0015','Incompleto','','',1,200]);sheet.addRow(['','0016','Fórmula válida','Comidas','Marca',1,{formula:'2000+3000',result:5000}]);
  sheet.addRow([product.id,'conflicto','Conflicto','Comidas','Marca',1,100]);sheet.addRow(['','0017','Texto','Comidas','Marca',1,'3000']);
  const buffer=Buffer.from(await wb.xlsx.writeBuffer()),before=db.prepare('SELECT * FROM products WHERE id=?').get(product.id),movements=db.prepare('SELECT count(*) n FROM inventory_movements').get().n;
  const preview=await previewImport(db,users.admin,buffer);assert.equal(preview.header_row,5);assert.equal(preview.summary.updates,1);assert.equal(preview.summary.new,3);
  const input={preview_id:preview.id,request_key:key(),reviewed_zero_rows:[]},result=applyImport(db,users.admin,input);assert.equal(result.summary.updated,1);assert.equal(result.summary.created,2);assert.deepEqual(applyImport(db,users.admin,input),result);
  const after=db.prepare('SELECT * FROM products WHERE id=?').get(product.id);assert.equal(after.wholesale_price_cents,450000);assert.equal(after.price_cents,before.price_cents);assert.equal(after.name,before.name);assert.equal(after.stock_milli,before.stock_milli);
  const draft=db.prepare('SELECT * FROM products WHERE code=?').get('0008');assert.equal(draft.price_cents,null);assert.equal(draft.unit,null);assert.equal(draft.active,0);assert.equal(db.prepare('SELECT count(*) n FROM inventory_movements').get().n,movements);
  assert.throws(()=>applyImport(db,users.seller,{...input,request_key:key()}),{status:403});assert.throws(()=>applyImport(db,users.admin,{...input,request_key:key()}),{status:409});
  const zeroWorkbook=new ExcelJS.Workbook(),zeroSheet=zeroWorkbook.addWorksheet('Productos');zeroSheet.getRow(2).values=sheet.getRow(5).values;zeroSheet.addRow(['','0020','Revisado cero','Comidas','Marca',1,0]);
  const zeroPreview=await previewImport(db,users.admin,Buffer.from(await zeroWorkbook.xlsx.writeBuffer()));const zeroResult=applyImport(db,users.admin,{preview_id:zeroPreview.id,request_key:key(),reviewed_zero_rows:[3]});assert.equal(zeroResult.summary.created,1);assert.equal(db.prepare("SELECT wholesale_price_cents FROM products WHERE code='0020'").get().wholesale_price_cents,0);
  const rollbackBook=new ExcelJS.Workbook(),rollbackSheet=rollbackBook.addWorksheet('Productos');rollbackSheet.getRow(1).values=sheet.getRow(5).values;rollbackSheet.addRow(['','ROLLBACK','No crear','Comidas','Marca',1,100]);rollbackSheet.addRow(['','0007','Existente','Comidas','Marca',1,5000]);
  const rollbackPreview=await previewImport(db,users.admin,Buffer.from(await rollbackBook.xlsx.writeBuffer()));db.prepare('UPDATE products SET wholesale_price_cents=888 WHERE id=?').run(product.id);assert.throws(()=>applyImport(db,users.admin,{preview_id:rollbackPreview.id,request_key:key(),reviewed_zero_rows:[]}),{status:409});assert.equal(db.prepare("SELECT id FROM products WHERE code='ROLLBACK'").get(),undefined);
  const stale=await previewImport(db,users.admin,buffer);db.prepare('UPDATE products SET wholesale_price_cents=999 WHERE id=?').run(product.id);assert.throws(()=>applyImport(db,users.admin,{preview_id:stale.id,request_key:key(),reviewed_zero_rows:[]}),{status:409});
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
  assert.equal((await req('/accounts?search=001234')).length,1);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const pdf=await req('/accounts/'+customer.id+'/pdf?from='+today+'&to='+today);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  const {spawnSync}=await import('node:child_process'),text=spawnSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8'});
  if(!text.error){assert.match(text.stdout,/Saldo inicial:\s*\$\s*5\.000/);assert.match(text.stdout,/Saldo final:\s*\$\s*3\.000/);}
  const before=account(db,customer.id).balance_cents;
  await req('/collections',{...body,amount:'1',request_key:key(),occurred_at:new Date(Date.now()+3600000).toISOString()},'admin',400);
  assert.equal(account(db,customer.id).balance_cents,before);
 }finally{await f.close();}
});
