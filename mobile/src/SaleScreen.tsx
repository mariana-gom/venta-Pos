import React,{useEffect,useState} from 'react';
import {Text,View,Pressable} from 'react-native';
import * as Crypto from 'expo-crypto';
import {api,ApiError,readPending,savePending} from './api';
import {Badge,Button,Card,Choice,Empty,Field,Header,Page,colors,cop,styles,preview,milli} from './ui';
import type {CashSession,Product,Customer,Platform,CartLine,Sale} from './types';
type Props={userId:string;session?:CashSession;products:Product[];customers:Customer[];platforms:Platform[];refresh:()=>Promise<void>;run:(fn:()=>Promise<void>)=>void;onSale:(sale:Sale)=>void;busy:boolean};
export function SaleScreen({userId,session,products,customers,platforms,refresh,run,onSale,busy}:Props){
 const [cart,setCart]=useState<CartLine[]>([]),[query,setQuery]=useState(''),[customer,setCustomer]=useState(''),[customerSearch,setCustomerSearch]=useState(''),[method,setMethod]=useState(''),[platform,setPlatform]=useState('');
 const [newCustomer,setNewCustomer]=useState(false),[name,setName]=useState(''),[city,setCity]=useState('');
 const [ready,setReady]=useState(false);
 useEffect(()=>{run(async()=>{setPending(await readPending(userId));setReady(true);});},[userId]);
 const [review,setReview]=useState(false),[pending,setPending]=useState<Record<string,unknown>|null>(null);
 const selectedCustomer=customers.find(c=>c.id===customer);const total=cart.reduce((sum,line)=>sum+preview(line.product.price_cents,line.quantity),0);
 const valid=!!session&&!!customer&&cart.length>0&&cart.every(l=>milli(l.quantity)>0&&Number.isInteger(milli(l.quantity))&&(l.product.unit==='kg'||milli(l.quantity)%1000===0))&&!!method&&(method!=='electronic'||!!platform);
 function add(product:Product){if(cart.some(l=>l.product.id===product.id))return;setCart([...cart,{product,quantity:product.unit==='unit'?'1':'0,250'}]);}
 async function confirm(){
  if(!valid&&!pending)throw new Error('Selecciona cliente, productos, cantidades válidas y método de pago.');
  const body=pending||{session_id:session!.id,customer_id:customer,items:cart.map(l=>({product_id:l.product.id,quantity:l.quantity,expected_price_cents:l.product.price_cents})),method,platform_id:method==='electronic'?platform:null,request_key:Crypto.randomUUID()};
  await savePending(userId,body);setPending(body);
  let sale:Sale;
  try{sale=await api<Sale>('/sales','POST',body);}catch(e){if(e instanceof ApiError&&e.status>0&&e.status<500){await savePending(userId,null);setPending(null);}throw e;}
  await savePending(userId,null);setPending(null);setCart([]);setReview(false);setMethod('');onSale(sale);await refresh();
 }
 if(!ready)return <Page><Text style={styles.muted}>Recuperando ventas pendientes…</Text></Page>;
 if(!session&&!pending)return <Page><Header eyebrow="VENTAS" title="Abre tu caja" subtitle="Necesitas una sesión abierta para registrar ventas."/><Empty title="Tu caja está cerrada" text="Entra en Caja e ingresa el saldo inicial. Las ventas anteriores permanecen en el historial."/></Page>;
 return <Page><Header eyebrow={`CAJA ABIERTA · ${session?.id.slice(0,8)||'CONFIRMACIÓN PENDIENTE'}`} title={review?'Confirmar venta':'Nueva venta'} subtitle="Unidades y kilogramos, con el total siempre a la vista."/>
  {pending&&<Card><Text style={styles.h2}>Confirmación pendiente</Text><Text style={styles.muted}>Reintenta la misma venta para consultar o confirmar su resultado. Su referencia evita duplicados: {String(pending.request_key)}</Text><Button title="Reintentar confirmación" disabled={busy} onPress={()=>run(confirm)}/></Card>}
  {!review&&!pending&&<>
   <Card><Text style={styles.h2}>1. Cliente</Text>{selectedCustomer?<View style={styles.row}><View><Text style={{color:colors.ink,fontWeight:'700'}}>{selectedCustomer.name}</Text><Text style={styles.muted}>{selectedCustomer.city}</Text></View><Pressable onPress={()=>setCustomer('')}><Text style={styles.link}>Cambiar</Text></Pressable></View>:<><Field label="Buscar cliente" value={customerSearch} onChange={setCustomerSearch} placeholder="Nombre del cliente"/>{customers.filter(c=>c.name.toLowerCase().includes(customerSearch.toLowerCase())).slice(0,10).map(c=><Pressable key={c.id} onPress={()=>setCustomer(c.id)} style={{paddingVertical:10}}><Text style={{color:colors.ink,fontWeight:'600'}}>{c.name}</Text><Text style={styles.muted}>{c.city}</Text></Pressable>)}</>}
    <Button secondary title={newCustomer?'Cancelar nuevo cliente':'+ Crear cliente'} onPress={()=>setNewCustomer(!newCustomer)}/>
    {newCustomer&&<><Field label="Nombre" value={name} onChange={setName}/><Field label="Ciudad" value={city} onChange={setCity}/><Button title="Crear y seleccionar" disabled={busy||!name.trim()||!city.trim()} onPress={()=>run(async()=>{const c=await api<Customer>('/customers','POST',{name,city});setCustomer(c.id);setNewCustomer(false);setName('');setCity('');await refresh();})}/></>}
   </Card>
   <Button secondary title="Actualizar precios y existencias" disabled={busy} onPress={()=>run(async()=>{const latest=await api<Product[]>('/products');setCart(cart.map(line=>({...line,product:latest.find(p=>p.id===line.product.id)||line.product})));setReview(false);await refresh();})}/>
   <Card><Text style={styles.h2}>2. Productos</Text><Field label="Buscar producto" value={query} onChange={setQuery} placeholder="¿Qué vas a vender?"/>{products.filter(p=>p.active&&p.name.toLowerCase().includes(query.toLowerCase())).slice(0,12).map(p=><Pressable key={p.id} onPress={()=>add(p)} style={[styles.row,{paddingVertical:10}]}><View style={{flex:1,gap:4}}><Text style={{color:colors.ink,fontWeight:'600'}}>{p.name}</Text><Text style={styles.muted}>{cop(p.price_cents)} / {p.unit==='kg'?'kg':'unidad'}{p.stock_milli!==null?` · ${p.stock_milli/1000} disponibles`:''}</Text></View><Badge text={cart.some(l=>l.product.id===p.id)?'Agregado':'+ Agregar'}/></Pressable>)}</Card>
   {cart.length>0&&<Card><Text style={styles.h2}>Tu carrito · {cart.length} productos</Text>{cart.map(line=><View key={line.product.id} style={{gap:8}}><View style={styles.row}><Text style={{flex:1,fontWeight:'600',color:colors.ink}}>{line.product.name}</Text><Pressable onPress={()=>setCart(cart.filter(l=>l.product.id!==line.product.id))}><Text style={{color:colors.red,fontSize:12}}>Quitar</Text></Pressable></View><Field label={line.product.unit==='kg'?'Peso en kilogramos (ej. 0,250)':'Cantidad en unidades enteras'} numeric value={line.quantity} onChange={quantity=>setCart(cart.map(l=>l.product.id===line.product.id?{...l,quantity}:l))}/><Text style={{textAlign:'right',fontWeight:'700',color:colors.ink}}>{cop(preview(line.product.price_cents,line.quantity))}</Text><View style={styles.divider}/></View>)}</Card>}
   <Card><Text style={styles.h2}>3. Pago</Text><Choice items={[{id:'cash',name:'Efectivo'},{id:'electronic',name:'Electrónico'}]} value={method} onChange={setMethod}/>{method==='electronic'&&<><Text style={styles.muted}>Selecciona dónde recibiste el pago</Text><Choice items={platforms.filter(p=>p.active)} value={platform} onChange={setPlatform}/></>}</Card>
  </>}
  {review&&!pending&&<Card><Badge text="Revisa antes de confirmar"/><Text style={styles.h2}>{selectedCustomer?.name}</Text><Text style={styles.muted}>{selectedCustomer?.city}</Text>{cart.map(l=><View key={l.product.id} style={styles.row}><View style={{flex:1}}><Text style={{color:colors.ink,fontWeight:'600'}}>{l.product.name}</Text><Text style={styles.muted}>{l.quantity} {l.product.unit==='kg'?'kg':'und'} × {cop(l.product.price_cents)}</Text></View><Text style={{color:colors.ink}}>{cop(preview(l.product.price_cents,l.quantity))}</Text></View>)}<View style={styles.divider}/><Text style={styles.muted}>Pago: {method==='cash'?'Efectivo':`Electrónico · ${platforms.find(p=>p.id===platform)?.name}`}</Text></Card>}
  <Card><View style={styles.row}><Text style={styles.muted}>Total de la venta</Text><Text style={[styles.metric,{color:colors.green}]}>{cop(total)}</Text></View>{!pending&&<Button title={review?'Confirmar y generar comprobante':'Revisar venta'} disabled={busy||!valid} onPress={()=>review?run(confirm):setReview(true)}/>} {review&&!pending&&<Button secondary title="Volver al carrito" onPress={()=>setReview(false)}/>}<Text style={[styles.muted,{fontSize:11}]}>El servidor verifica precios, existencias y estado de la caja.</Text></Card>
 </Page>;
}
