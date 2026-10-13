import {id,now} from './db.js';
import {digest} from './auth.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function ensureJourney(db,routeId,sessionId=null){
 if(!routeId)return null;
 let journey=db.prepare("SELECT * FROM route_journeys WHERE route_id=? AND state='open'").get(routeId);
 if(journey&&sessionId&&journey.session_id&&journey.session_id!==sessionId){const bound=db.prepare('SELECT state FROM cash_sessions WHERE id=?').get(journey.session_id);const shared=db.prepare("SELECT count(*) n FROM cash_sessions WHERE route_id=? AND state='open'").get(routeId).n;if(bound?.state!=='closed'&&shared<2)fail(409,'La ruta ya tiene otra jornada de caja abierta.');db.prepare('UPDATE route_journeys SET session_id=NULL WHERE id=?').run(journey.id);journey.session_id=null;}
 if(!journey){
  const start=db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM inventory_movements').get().n;
  const journeyId=id();db.prepare('INSERT INTO route_journeys VALUES(?,?,?,?,?,?,?)').run(journeyId,routeId,sessionId,now(),start,'open',null);
  db.prepare('INSERT INTO route_journey_opening SELECT ?,product_id,quantity_milli FROM route_stock WHERE route_id=?').run(journeyId,routeId);
  journey=db.prepare('SELECT * FROM route_journeys WHERE id=?').get(journeyId);
 }else if(sessionId&&!journey.session_id){db.prepare('UPDATE route_journeys SET session_id=? WHERE id=?').run(sessionId,journey.id);journey.session_id=sessionId;}
 return journey;
}
export function routeCanLoad(db,routeId){
 const closing=db.prepare("SELECT id FROM cash_sessions WHERE route_id=? AND state='open' AND close_state='preparing'").get(routeId);
 if(closing)fail(409,'La ruta está preparando su cierre. Termina o cancela el cierre antes de cargar o ajustar stock.');
}
export function inventoryClosingPreview(db,session){
 if(!session.route_id)return {route_id:null,route_name:null,items:[],revision:digest('no-route')};
 const other=db.prepare("SELECT id FROM cash_sessions WHERE route_id=? AND state='open' AND id<>?").get(session.route_id,session.id);
 if(other)return {route_id:session.route_id,route_name:db.prepare('SELECT name FROM routes WHERE id=?').get(session.route_id)?.name,items:[],shared:true,message:'El stock compartido se conciliará al cerrar la última caja de esta ruta.',revision:digest(JSON.stringify(db.prepare("SELECT id FROM cash_sessions WHERE route_id=? AND state='open' ORDER BY id").all(session.route_id)))};
 const j=ensureJourney(db,session.route_id,session.id);
 const movements=db.prepare('SELECT rowid AS sequence,* FROM inventory_movements WHERE route_id=? AND rowid>? ORDER BY rowid').all(session.route_id,j.start_movement_rowid);
 const openings=db.prepare('SELECT * FROM route_journey_opening WHERE journey_id=?').all(j.id);
 const products=db.prepare(`SELECT p.*,COALESCE(rs.quantity_milli,0) expected_milli FROM products p LEFT JOIN route_stock rs ON rs.product_id=p.id AND rs.route_id=? WHERE p.id IN (SELECT product_id FROM route_stock WHERE route_id=? UNION SELECT product_id FROM route_journey_opening WHERE journey_id=?) ORDER BY p.name,p.id`).all(j.route_id,j.route_id,j.id);
 const items=products.filter(p=>p.unit).map(p=>{
  const ms=movements.filter(m=>m.product_id===p.id),opening_milli=openings.find(o=>o.product_id===p.id)?.quantity_milli||0;
  const saleIds=new Set(ms.filter(m=>m.kind==='sale').map(m=>m.sale_id));
  const currentReturn=m=>m.kind==='return'&&m.sale_id&&saleIds.has(m.sale_id);
  const loaded_milli=ms.filter(m=>['entry','allocation'].includes(m.kind)&&m.quantity_milli>0).reduce((n,m)=>n+m.quantity_milli,0);
  const sold_milli=-ms.filter(m=>m.kind==='sale'||currentReturn(m)).reduce((n,m)=>n+m.quantity_milli,0);
  const adjusted_milli=ms.filter(m=>!['entry','allocation','sale'].includes(m.kind)&&!currentReturn(m)).reduce((n,m)=>n+m.quantity_milli,0);
  if(opening_milli+loaded_milli-sold_milli+adjusted_milli!==p.expected_milli)fail(409,'El inventario de la ruta requiere conciliación: '+p.name);
  return {product_id:p.id,name:p.name,unit:p.unit,opening_milli,loaded_milli,sold_milli,adjusted_milli,expected_milli:p.expected_milli,received_milli:p.expected_milli,difference_milli:0};
 }).filter(p=>p.opening_milli||p.loaded_milli||p.sold_milli||p.adjusted_milli||p.expected_milli);
 const routeName=db.prepare('SELECT name FROM routes WHERE id=?').get(j.route_id)?.name;
 return {journey_id:j.id,route_id:j.route_id,route_name:routeName,items,revision:digest(JSON.stringify({journey:j.id,items,movements:movements.map(m=>m.id)}))};
}
export function closingStatus(db,session){
 const devices=db.prepare('SELECT device_id,ack_epoch,pending_count,last_seen FROM session_devices WHERE session_id=? ORDER BY device_id').all(session.id);
 return {state:session.close_state,epoch:session.close_epoch,legacy_confirmation_required:devices.some(d=>d.device_id==='legacy'),devices:devices.map(d=>({...d,ready:session.close_state==='preparing'&&d.ack_epoch===session.close_epoch&&d.pending_count===0})),ready:session.close_state==='preparing'&&devices.length>0&&devices.every(d=>d.ack_epoch===session.close_epoch&&d.pending_count===0)};
}
export function deviceStatus(db,user,session,deviceId,pendingCount){
 if(session.opened_by!==user.id)fail(403,'Solo el vendedor de esta caja puede confirmar su sincronización.');
 if(session.state!=='open')return {state:'closed',epoch:session.close_epoch};
 db.prepare('INSERT INTO session_devices VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,device_id) DO UPDATE SET pending_count=excluded.pending_count,last_seen=excluded.last_seen,ack_epoch=CASE WHEN excluded.pending_count>0 THEN NULL ELSE session_devices.ack_epoch END').run(session.id,deviceId,null,pendingCount,now(),user.id);
 return {...closingStatus(db,session),device_id:deviceId};
}
