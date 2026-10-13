import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createUser,login} from '../src/auth.js';
const key=()=>randomUUID();
async function fixture(){
 const db=openDatabase(':memory:'),users={},tokens={};for(const role of ['admin','seller']){users[role]=await createUser(db,{username:role,name:role,password:'prueba-password-123',role});tokens[role]=(await login(db,role,'prueba-password-123')).token;}
 const server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const req=async(path,body=null,role='admin',status=200,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
 const route=await req('/routes',{name:'Norte',request_key:key()},'admin',201);await req('/users/'+users.seller.id+'/route',{route_id:route.id,request_key:key()},'admin',200,'PUT');
 const session=await req('/cash-sessions',{opening:'1000'},'seller',201),unit=await req('/products',{name:'Unidad',unit:'unit',price:'2000'}),kg=await req('/products',{name:'Peso',unit:'kg',price:'10000'}),customer=await req('/customers',{name:'Ana',city:'Bogotá'},'seller',201),devices=[key(),key()];
 for(const device_id of devices)await req('/cash-sessions/'+session.id+'/device',{device_id,pending_count:0},'seller');
 const load=async(product,amount)=>{const p=await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:product.id,quantity:amount}]});return req('/inventory/loads',{route_id:route.id,date:'2026-10-12',reason:'Entrega',request_key:key(),items:p.items},'admin',201);};
 const sale=async(quantity='1',extra={})=>req('/sales',{device_id:devices[0],session_id:session.id,customer_id:customer.id,method:'cash',request_key:key(),items:[{product_id:unit.id,quantity}],...extra},'seller',201);
 const prepare=async()=>{await req('/cash-sessions/'+session.id+'/prepare-close',{request_key:key()});return req('/cash-sessions/'+session.id+'/close-preview');};
 const ack=async(device_id,epoch)=>{await req('/cash-sessions/'+session.id+'/device',{device_id,pending_count:0},'seller');return req('/cash-sessions/'+session.id+'/device-ack',{device_id,epoch,pending_count:0},'seller');};
 const body=p=>({request_key:key(),close_epoch:p.sync.epoch,inventory_revision:p.inventory.revision,reviewed_revision:p.session.session_revision,declared_cash:String((p.session.opening_cents+p.session.cash_cents)/100),declared_electronic:String(p.session.electronic_cents/100),returns:p.inventory.items.map(i=>({product_id:i.product_id,quantity:String(i.expected_milli/1000),observation:''}))});
 return {db,req,users,tokens,route,session,unit,kg,customer,devices,load,sale,prepare,ack,body,close:async()=>{await new Promise(r=>server.close(r));db.close();}};
}
test('Asignación: vista previa sin efectos, unidades/kg, inventario insuficiente, cargas adicionales y reintentos',async()=>{
 const f=await fixture();try{const {db,req,route,session,unit,kg}=f;
 for(const [p,amount] of [[unit,'10'],[kg,'5']])await req('/inventory',{product_id:p.id,route_id:null,quantity:amount,kind:'entry',reason:'General',request_key:key()});
 const before=db.prepare('SELECT count(*) n FROM inventory_movements').get().n;
 const preview=await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:unit.id,quantity:'2'},{product_id:kg.id,quantity:'1,250'}]});assert.equal(db.prepare('SELECT count(*) n FROM inventory_movements').get().n,before);
 const input={route_id:route.id,date:'2026-10-12',reason:'Primera entrega',request_key:key(),items:preview.items};const a=await req('/inventory/loads',input,'admin',201),b=await req('/inventory/loads',input,'admin',201);assert.equal(a.id,b.id);assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(kg.id).quantity_milli,3750);
 await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:kg.id,quantity:'4'}]},'admin',409);await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:unit.id,quantity:'0.5'}]},'admin',400);
 await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:unit.id,quantity:'1'},{product_id:unit.id,quantity:'2'}]},'admin',400);
 const more=await req('/inventory/load-preview',{route_id:route.id,items:[{product_id:kg.id,quantity:'0.25'}]});await req('/inventory/loads',{...input,items:more.items,request_key:key()},'admin',201);
 const p=await req('/cash-sessions/'+session.id+'/close-preview');assert.equal(p.inventory.items.find(i=>i.product_id===kg.id).loaded_milli,1500);assert.equal(p.session.total_cents,0);assert.equal(p.session.cash_cents,0);
 }finally{await f.close();}
});
test('Cierre conjunto: equipos sin señal bloquean, cola se drena, devoluciones prellenadas, diferencias y atomicidad',async()=>{
 const f=await fixture();try{const {db,req,session,unit,kg,devices,load,sale,prepare,ack,body}=f;
 await load(unit,'10');await load(kg,'2.500');await sale('3');
 await req('/cash-sessions/'+session.id+'/device',{device_id:devices[1],pending_count:1},'seller');let p=await prepare();assert.equal(p.sync.ready,false);assert.equal(p.inventory.items.find(i=>i.product_id===unit.id).received_milli,7000);
 await req('/cash-sessions/'+session.id+'/close',body(p),'admin',409);assert.equal(db.prepare('SELECT state FROM cash_sessions WHERE id=?').get(session.id).state,'open');
 await ack(devices[0],p.sync.epoch);await req('/cash-sessions/'+session.id+'/device-ack',{device_id:devices[1],epoch:p.sync.epoch,pending_count:0},'seller',409);
 await req('/cash-sessions/'+session.id+'/device-ack',{device_id:devices[1],epoch:p.sync.epoch,pending_count:0},'admin',403);
 // Pending sale from the second registered device is still accepted, without changing its original box.
 await sale('1',{device_id:devices[1],sold_at:new Date(Date.now()-3600000).toISOString()});await ack(devices[1],p.sync.epoch);
 const old=body(p);await req('/cash-sessions/'+session.id+'/close',old,'admin',409);p=await req('/cash-sessions/'+session.id+'/close-preview');assert.equal(p.sync.ready,true);assert.equal(p.inventory.items.find(i=>i.product_id===unit.id).sold_milli,4000);
 const input=body(p),r=input.returns.find(r=>r.product_id===unit.id);r.quantity='5';await req('/cash-sessions/'+session.id+'/close',input,'admin',400);assert.equal(db.prepare('SELECT count(*) n FROM route_stock_closures').get().n,0);assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=?').get(unit.id).quantity_milli,6000);
 r.observation='Falta una unidad reportada por vendedor';const result=await req('/cash-sessions/'+session.id+'/close',input,'admin',201);assert.equal(result.snapshot.inventory.items.find(i=>i.product_id===unit.id).difference_milli,-1000);assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(unit.id).quantity_milli,5000);assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(kg.id).quantity_milli,2500);assert.equal(db.prepare('SELECT stock_milli FROM products WHERE id=?').get(unit.id).stock_milli,5000);
 assert.equal((await req('/cash-sessions/'+session.id+'/close',input,'admin',201)).id,result.id);assert.equal(db.prepare('SELECT count(*) n FROM route_stock_closures').get().n,1);assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=?').get(kg.id).quantity_milli,0);
 await req('/sales',{device_id:devices[1],session_id:session.id,customer_id:f.customer.id,method:'cash',request_key:key(),items:[{product_id:unit.id,quantity:'1'}],sold_at:new Date(Date.now()-3600000).toISOString()},'seller',409);
 }finally{await f.close();}
});
test('Cancelar preparación invalida confirmaciones; cierre simultáneo devuelve stock una sola vez',async()=>{
 const f=await fixture();try{const {req,db,unit,session,devices,load,prepare,ack,body}=f;await load(unit,'2');let p=await prepare();for(const d of devices)await ack(d,p.sync.epoch);await req('/cash-sessions/'+session.id+'/cancel-close',{request_key:key()});p=await prepare();await req('/cash-sessions/'+session.id+'/close',body(p),'admin',409);for(const d of devices)await ack(d,p.sync.epoch);p=await req('/cash-sessions/'+session.id+'/close-preview');const input=body(p),results=await Promise.all([req('/cash-sessions/'+session.id+'/close',input,'admin',201),req('/cash-sessions/'+session.id+'/close',input,'admin',201)]);assert.equal(results[0].id,results[1].id);assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(unit.id).quantity_milli,2000);
 }finally{await f.close();}
});
test('Búsqueda paginada: nombres con tildes, límites, ruta del usuario y catálogo completo descargable',async()=>{
 const f=await fixture();try{const {db,req,unit,load}=f;await load(unit,'4');for(let n=0;n<85;n++)db.prepare('INSERT INTO products(id,name,price_cents,unit,active,stock_milli,created_at,updated_at) VALUES(?,?,10000,\'unit\',1,0,?,?)').run(key(),'Jamón '+String(n).padStart(3,'0'),new Date().toISOString(),new Date().toISOString());
 const a=await req('/products/search?search=jamon&limit=30&page=1',null,'seller'),b=await req('/products/search?search=jamon&limit=30&page=2',null,'seller');assert.equal(a.total,85);assert.equal(a.products.length,30);assert.equal(a.has_more,true);assert.equal(new Set([...a.products,...b.products].map(p=>p.id)).size,60);
 const seller=await req('/products/search?search=Unidad',null,'seller');assert.equal(seller.products[0].stock_milli,4000);await req('/products/search?limit=1000',null,'seller',400);await req('/products/search?purpose=assignment',null,'seller',403);assert.equal((await req('/products/catalog-download?page=1',null,'seller')).products.length,87);
 }finally{await f.close();}
});

test('Compatibilidad: equipos antiguos requieren confirmación explícita del responsable',async()=>{
 const f=await fixture();try{const {req,session,unit,customer,load,devices,prepare,ack,body}=f;await load(unit,'2');await req('/sales',{session_id:session.id,customer_id:customer.id,method:'cash',request_key:key(),items:[{product_id:unit.id,quantity:'1'}]},'seller',201);
 let p=await prepare();assert.equal(p.sync.legacy_confirmation_required,true);for(const d of devices)await ack(d,p.sync.epoch);p=await req('/cash-sessions/'+session.id+'/close-preview');assert.equal(p.sync.ready,false);await req('/cash-sessions/'+session.id+'/close',body(p),'admin',409);
 await req('/cash-sessions/'+session.id+'/confirm-legacy-sync',{device_id:devices[0],epoch:p.sync.epoch,pending_count:0},'admin',403);await req('/cash-sessions/'+session.id+'/confirm-legacy-sync',{device_id:devices[0],epoch:p.sync.epoch,pending_count:0},'seller');p=await req('/cash-sessions/'+session.id+'/close-preview');assert.equal(p.sync.ready,true);await req('/cash-sessions/'+session.id+'/close',body(p),'admin',201);
 }finally{await f.close();}
});

test('Cajas compartidas anteriores: solo la última devuelve el inventario común',async()=>{
 const f=await fixture();try{const {db,req,tokens,route,unit,customer,session,devices,load,sale,prepare,ack,body}=f;await load(unit,'10');
 const other=await createUser(db,{username:'other',name:'Otro',password:'prueba-password-123',role:'seller'});tokens.other=(await login(db,'other','prueba-password-123')).token;db.prepare('UPDATE users SET route_id=? WHERE id=?').run(route.id,other.id);const second=key();db.prepare("INSERT INTO cash_sessions(id,opened_by,opened_at,opening_cents,state,closed_at,route_id) VALUES(?,?,?,0,'open',NULL,?)").run(second,other.id,new Date().toISOString(),route.id);const device=key();await req('/cash-sessions/'+second+'/device',{device_id:device,pending_count:0},'other');
 await sale('1');await req('/sales',{device_id:device,session_id:second,customer_id:customer.id,method:'cash',request_key:key(),items:[{product_id:unit.id,quantity:'1'}]},'other',201);
 let p=await prepare();assert.equal(p.inventory.shared,true);for(const d of devices)await ack(d,p.sync.epoch);p=await req('/cash-sessions/'+session.id+'/close-preview');await req('/cash-sessions/'+session.id+'/close',body(p),'admin',201);assert.equal(db.prepare('SELECT quantity_milli FROM route_stock WHERE product_id=?').get(unit.id).quantity_milli,8000);assert.equal(db.prepare('SELECT count(*) n FROM route_stock_closures').get().n,0);
 await req('/cash-sessions/'+second+'/prepare-close',{request_key:key()});p=await req('/cash-sessions/'+second+'/close-preview');await req('/cash-sessions/'+second+'/device-ack',{device_id:device,epoch:p.sync.epoch,pending_count:0},'other');p=await req('/cash-sessions/'+second+'/close-preview');assert.equal(p.inventory.items[0].sold_milli,2000);await req('/cash-sessions/'+second+'/close',body(p),'admin',201);assert.equal(db.prepare('SELECT quantity_milli FROM unassigned_stock WHERE product_id=?').get(unit.id).quantity_milli,8000);assert.equal(db.prepare('SELECT count(*) n FROM route_stock_closures').get().n,1);
 }finally{await f.close();}
});
