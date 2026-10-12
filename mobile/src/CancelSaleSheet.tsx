import React,{useEffect,useState} from 'react';
import {Text} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api} from './api';
import {Banner,Button,Card,Choice,Confirm,Field,InfoRow,Sheet,cop,styles} from './ui';
import type {Debt,Platform,Sale} from './types';
import type {Run} from '../App';
type Allocation={id:string;amount_cents:number};
export function CancelSaleSheet({sale,platforms,run,busy,onClose,onDone}:{sale:Sale;platforms:Platform[];run:Run;busy:boolean;onClose:()=>void;onDone:(sale:Sale)=>Promise<void>}){
 const [preview,setPreview]=useState<{allocations:Allocation[];targets:Debt[];session_open:boolean}|null>(null),[reason,setReason]=useState(''),[pay,setPay]=useState('cash'),[reference,setReference]=useState(''),[destination,setDestination]=useState('outside'),[outside,setOutside]=useState(''),[resolutions,setResolutions]=useState<Record<string,string>>({}),[confirm,setConfirm]=useState(false),[requestKey]=useState(Crypto.randomUUID());
 useEffect(()=>{run(async()=>{const p=await api<typeof preview>('/sales/'+sale.id+'/cancel-preview');setPreview(p);setDestination(p?.session_open?'original':'outside');});},[sale.id]);
 useEffect(()=>setReference(''),[pay]);
 const credit=sale.payments?.[0]?.method==='credit';
 const refund=credit?(preview?.allocations.filter(a=>resolutions[a.id]==='refund').reduce((n,a)=>n+a.amount_cents,0)||0):sale.total_cents;
 const resolved=preview?.allocations.every(a=>!!resolutions[a.id]);
 const valid=!!reason.trim()&&!!preview&&(!credit||resolved)&&(!refund||((pay==='cash'||reference.trim())&&(destination==='original'||outside.trim())));
 async function cancel(){await api('/sales/'+sale.id+'/cancel','POST',{reason,request_key:requestKey,resolutions:credit?preview!.allocations.map(a=>({allocation_id:a.id,kind:resolutions[a.id]==='refund'?'refund':'reassign',target_sale_id:resolutions[a.id]==='refund'?undefined:resolutions[a.id]})):undefined,refund:refund?{amount:String(refund/100),method:pay==='cash'?'cash':'electronic',platform_id:pay==='cash'?undefined:pay,reference:pay==='cash'?undefined:reference,session_id:destination==='original'?sale.session_id:null,outside_cash_reason:destination==='original'?undefined:outside}:undefined});setConfirm(false);await onDone(await api<Sale>('/sales/'+sale.id));onClose();}
 return <>
  <Sheet visible onClose={onClose} title={'Anular venta #'+sale.number} footer={<Button title="Revisar anulación" disabled={busy||!valid} onPress={()=>setConfirm(true)}/> }>
   <Banner tone="orange" text="La factura permanecerá en el historial como Anulada. La caja original y la ruta de la venta conservan la trazabilidad."/>
   <Field label="Motivo de anulación" value={reason} onChange={setReason} multiline/>
   {preview&&!preview.session_open&&<Banner tone="yellow" text="La caja original está cerrada: se conservará su cierre y se registrará un ajuste vinculado. La devolución se registra fuera de caja."/>}
   {credit&&preview?.allocations.map(a=><Card key={a.id}><InfoRow label="Abono que debes resolver" value={cop(a.amount_cents)}/><Choice items={[{id:'refund',name:'Devolver abono'},...preview.targets.map(d=>({id:d.sale_id,name:'Reasignar a #'+d.number+' · saldo '+cop(d.balance_cents)}))]} value={resolutions[a.id]||''} onChange={v=>setResolutions(current=>({...current,[a.id]:v}))}/></Card>)}
   {refund>0&&<Card><InfoRow label="Devolución real a registrar" value={cop(refund)} strong/><Text style={styles.label}>Medio de devolución</Text><Choice items={[{id:'cash',name:'Efectivo'},...platforms.filter(p=>p.active).map(p=>({id:p.id,name:p.name}))]} value={pay} onChange={setPay}/>{pay!=='cash'&&<Field label="Número de referencia de devolución" kind="plain" value={reference} onChange={setReference}/>}<Choice items={[...preview?.session_open?[{id:'original',name:'Caja original'}]:[],{id:'outside',name:'Fuera de caja'}]} value={destination} onChange={setDestination}/>{destination==='outside'&&<Field label="Motivo de devolución fuera de caja" value={outside} onChange={setOutside}/>}</Card>}
   {credit&&!refund&&<Text style={styles.body}>Se revertirá la deuda pendiente. Los abonos reasignados se aplicarán a las facturas indicadas.</Text>}
  </Sheet>
  <Confirm visible={confirm} title="¿Anular esta venta?" message="Esta operación es definitiva. Confirma que la devolución indicada realmente se realizó y que los abonos se resolvieron correctamente." confirmText="Confirmar anulación" danger busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>run(cancel)}/>
 </>;
}
