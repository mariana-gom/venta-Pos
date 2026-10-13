import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {digest} from '../src/auth.js';
// Regression fixtures use the real preparation and seller acknowledgement endpoints.
export async function closingInput(db,base,tokens,sessionId){
 const session=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(sessionId);if(!session||session.state!=='open')return {request_key:randomUUID()};
 const ownerToken=Object.values(tokens).find(t=>db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash=?').get(digest(t))?.user_id===session.opened_by);
 async function call(path,body,token){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
 await call('/cash-sessions/'+sessionId+'/prepare-close',{request_key:randomUUID()},tokens.admin);
 await call('/cash-sessions/'+sessionId+'/device',{device_id:randomUUID(),pending_count:0},ownerToken);
 let preview=await call('/cash-sessions/'+sessionId+'/close-preview',null,tokens.admin);
 if(preview.sync.legacy_confirmation_required){const device=preview.sync.devices.find(d=>d.device_id!=='legacy');await call('/cash-sessions/'+sessionId+'/confirm-legacy-sync',{device_id:device.device_id,epoch:preview.sync.epoch,pending_count:0},ownerToken);preview=await call('/cash-sessions/'+sessionId+'/close-preview',null,tokens.admin);}
 for(const d of preview.sync.devices)await call('/cash-sessions/'+sessionId+'/device-ack',{device_id:d.device_id,epoch:preview.sync.epoch,pending_count:0},ownerToken);
 return {request_key:randomUUID(),close_epoch:preview.sync.epoch,inventory_revision:preview.inventory.revision,returns:preview.inventory.items.map(i=>({product_id:i.product_id,quantity:String(i.expected_milli/1000),observation:''}))};
}
