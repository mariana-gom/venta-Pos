import {StockLoadScreen} from './src/StockLoadScreen';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {StatusBar} from 'expo-status-bar';
import {Feather} from '@expo/vector-icons';
import {Text,View,Pressable,StyleSheet,ActivityIndicator,Animated,Platform,useWindowDimensions} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {api,ApiError,clearDocumentCache,forgetSession,onConnectivity,restoreSession,signIn,signOut} from './src/api';
import {loadCache,loadQueue,loadSynced,saveCache,saveQueue,saveSynced,type QueuedSale} from './src/offline';
import {Banner,Logo,ProgressBar,colors,initials,styles,useHardwareBack} from './src/ui';
import type {User,Product,SellableProduct,Customer,Platform as PayPlatform,Settings,CashSession,Sale,Closure,Tab} from './src/types';
import {LoginScreen} from './src/LoginScreen';
import {HomeScreen} from './src/HomeScreen';
import {SaleScreen} from './src/SaleScreen';
import {CatalogScreen} from './src/CatalogScreen';
import {CashScreen} from './src/CashScreen';
import {HistoryScreen} from './src/HistoryScreen';
import {useBusinessDay, canDisplaySale} from './src/businessDay';
import {AdminScreen} from './src/AdminScreen';
import {SettingsScreen} from './src/SettingsScreen';
// Cinco pestañas caben cómodas desde 320 px; Vender queda al centro, al alcance del pulgar. Perfil se abre desde el avatar.
const tabs=[{id:'home',name:'Inicio',icon:'home'},{id:'cash',name:'Caja',icon:'inbox'},{id:'sale',name:'Vender',icon:'shopping-cart'},{id:'catalog',name:'Catálogo',icon:'package'},{id:'history',name:'Historial',icon:'clock'}] as const;
export type Run=(fn:()=>Promise<void>,success?:string)=>void;
export default function App(){return <SafeAreaProvider><Main/></SafeAreaProvider>;}
function Main(){
 const {width}=useWindowDimensions();
 const [user,setUser]=useState<User|null>(null),[boot,setBoot]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState<{text:string;detail?:string}|null>(null),[tab,setTab]=useState<Tab>('home');
 const [products,setProducts]=useState<Product[]>([]),[customers,setCustomers]=useState<Customer[]>([]),[platforms,setPlatforms]=useState<PayPlatform[]>([]),[sessions,setSessions]=useState<CashSession[]>([]),[settings,setSettings]=useState<Settings>({business_name:"DISTRIBUIDORA & SALSAMENTARIA DANNY'S",paper_width:80}),[sale,setSale]=useState<Sale|null>(null),[closure,setClosure]=useState<Closure|null>(null),[sessionFilter,setSessionFilter]=useState(''),[historyVersion,setHistoryVersion]=useState(0),[catalogTab,setCatalogTab]=useState<'products'|'customers'>('products'),[catalogVersion,setCatalogVersion]=useState(0),[toast,setToast]=useState('');
 const businessClock=useBusinessDay(settings.time_zone,!!user);
 const previousDay=useRef(businessClock.date);
 const [online,setOnline]=useState(true),[queue,setQueue]=useState<QueuedSale[]>([]),[localCustomers,setLocalCustomers]=useState<Customer[]>([]);
 const toastTimer=useRef<ReturnType<typeof setTimeout>>(undefined),syncing=useRef(false),loaded=useRef(false);
 const notify=useCallback((text:string)=>{setToast(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),2600);},[]);
 const run=useCallback<Run>((fn,success)=>{setBusy(true);setError(null);void fn().then(()=>{if(success)notify(success);}).catch(async(e:unknown)=>{
  setError({text:e instanceof Error?e.message:'Ocurrió un error inesperado. Inténtalo nuevamente.',detail:e instanceof ApiError?e.detail:e instanceof Error?undefined:String(e)});
  if(e instanceof ApiError&&e.status===401&&!e.detail.includes('/auth/login')){await forgetSession();setUser(null);setError({text:'Tu sesión terminó. Ingresa de nuevo para continuar.'});}
 }).finally(()=>setBusy(false));},[notify]);
 const refresh=useCallback(async()=>{
  const results=await Promise.all([api<Product[]>('/products'),api<Customer[]>('/customers'),api<PayPlatform[]>('/platforms'),api<CashSession[]>('/cash-sessions'),api<Settings>('/settings')]);setProducts(results[0]);setCustomers(results[1]);setPlatforms(results[2]);setSessions(results[3]);setSettings(results[4]);loaded.current=true;
 },[]);
 // Al cambiar de día se purga la información consultable; la cola de escritura sigue intacta para sincronizar.
 useEffect(()=>{
  if(previousDay.current===businessClock.date)return;previousDay.current=businessClock.date;
  if(user?.role==='seller'){setSale(null);setClosure(null);setHistoryVersion(n=>n+1);}
  if(user)void refresh().catch(()=>undefined);
 },[businessClock.date,user,refresh]);
 useEffect(()=>{if(user?.role==='seller')void clearDocumentCache().catch(()=>undefined);},[businessClock.date,user]);
 // Sin señal se trabaja con la última copia guardada en el celular.
 const applyCache=useCallback(async(userId:string)=>{const c=await loadCache();if(!c||c.user.id!==userId)return false;setProducts(c.products);setCustomers(c.customers);setPlatforms(c.platforms);setSessions(c.sessions);setSettings(c.settings);loaded.current=true;return true;},[]);
 const refreshOrCache=useCallback(async(userId:string)=>{try{await refresh();}catch(e){if(!(e instanceof ApiError&&e.status===0&&await applyCache(userId)))throw e;}},[refresh,applyCache]);
 useEffect(()=>onConnectivity(setOnline),[]);
 useEffect(()=>{void restoreSession().then(async u=>{if(u){setUser(u);await refreshOrCache(u.id);}}).catch(e=>setError({text:e.message,detail:e instanceof ApiError?e.detail:undefined})).finally(()=>setBoot(false));},[]);
 const visibleSessions=user?.role==='seller'?sessions.map(s=>s.sales_date===businessClock.date?s:{...s,sales_date:businessClock.date,cash_cents:0,electronic_cents:0,total_cents:0,sale_count:0,credit_cents:0,sales_cash_cents:0,sales_electronic_cents:0,collection_cash_cents:0,collection_electronic_cents:0,refund_cash_cents:0,refund_electronic_cents:0,platforms:[]}):sessions;
 // Copia local actualizada cada vez que cambian los datos (para abrir y vender sin señal).
 useEffect(()=>{if(user&&loaded.current)void saveCache({user,products,customers,platforms,sessions:visibleSessions,settings,saved_at:new Date().toISOString()});},[user,products,customers,platforms,sessions,settings,businessClock.date]);
 useEffect(()=>{if(!user)return;void loadQueue(user.id).then(setQueue);void loadCache().then(c=>setLocalCustomers((c as {local_customers?:Customer[]}|null)?.local_customers||[]));},[user]);
 /** Sube en orden las ventas guardadas sin señal. Idempotente: un reintento nunca duplica una venta. */
 const sync=useCallback(async(manual=false)=>{
  if(!user||syncing.current)return;syncing.current=true;
  try{
   let pending=await loadQueue(user.id);if(!pending.length)return;
   const synced=await loadSynced(user.id);let uploaded=0;
   for(const entry of pending){
    try{const sale=await api<Sale>('/sales','POST',entry.body);pending=pending.filter(x=>x.key!==entry.key);synced.unshift({provisional:entry.provisional,number:sale.number,id:sale.id,at:new Date().toISOString()});uploaded++;}
    catch(e){
     if(e instanceof ApiError&&e.status===0){if(manual)setError({text:'Sigues sin señal. Las ventas quedan guardadas en el celular y se subirán solas.'});break;}
     if(e instanceof ApiError&&e.status===401){await forgetSession();setUser(null);setError({text:'Tu sesión venció. Ingresa de nuevo para subir las ventas pendientes; siguen guardadas en el celular.'});break;}
     pending=pending.map(x=>x.key===entry.key?{...x,error:e instanceof Error?e.message:String(e)}:x);
    }
   }
   await saveQueue(user.id,pending);await saveSynced(user.id,synced);setQueue(pending);
   if(uploaded){notify(`${uploaded} ${uploaded===1?'venta subida':'ventas subidas'} al sistema`);await refresh().catch(()=>undefined);}
  }finally{syncing.current=false;}
 },[user,refresh,notify]);
 // Reintento automático: al recuperar señal y cada 20 s mientras haya ventas por subir.
 useEffect(()=>{if(online)void sync();},[online,sync]);
 useEffect(()=>{if(!queue.length)return;const t=setInterval(()=>void sync(),20000);return()=>clearInterval(t);},[queue.length,sync]);
 /** Guarda la venta en el celular ANTES de enviarla y descuenta el stock local, para seguir vendiendo en ruta. */
 const enqueue=useCallback(async(entry:QueuedSale)=>{
  if(!user)return;const next=[...await loadQueue(user.id),entry];await saveQueue(user.id,next);setQueue(next);
  const items=(entry.sale.items||[]);setProducts(list=>list.map(p=>{const i=items.find(x=>x.id===p.id);return i&&p.stock_milli!==null?{...p,stock_milli:Math.max(0,p.stock_milli-i.quantity_milli)}:p;}));
 },[user]);
 const dequeue=useCallback(async(key:string)=>{if(!user)return;const next=(await loadQueue(user.id)).filter(x=>x.key!==key);await saveQueue(user.id,next);setQueue(next);},[user]);
 const addLocalCustomer=useCallback((c:Customer)=>setLocalCustomers(list=>[...list,c]),[]);
 useEffect(()=>{void loadCache().then(c=>{if(c&&user&&c.user.id===user.id)void saveCache({...c,local_customers:localCustomers} as typeof c);});},[localCustomers,user]);
 // Clientes creados en ruta: se muestran hasta que el servidor los confirme con la venta.
 const allCustomers=[...customers,...localCustomers.filter(c=>!customers.some(x=>x.id===c.id))];
 // Botón atrás de Android: primero cierra hojas/subpantallas, luego vuelve a Inicio y solo entonces sale.
 useHardwareBack(()=>{if(user&&tab!=='home'){setTab('home');return true;}return false;});
 const own=visibleSessions.find(s=>s.opened_by===user?.id&&s.state==='open');
 function go(target:Tab){setError(null);setTab(target);}
 function history(selectedSale:Sale|null=null,selectedClosure:Closure|null=null,filter=''){setSale(selectedSale);setClosure(selectedClosure);setSessionFilter(filter);setHistoryVersion(n=>n+1);go('history');}
 function catalog(sub:'products'|'customers'){setCatalogTab(sub);setCatalogVersion(n=>n+1);go('catalog');}
 const logout=()=>run(async()=>{if(queue.length)throw new Error(`Tienes ${queue.length} ${queue.length===1?'venta':'ventas'} sin subir. Conéctate a internet y espera a que se suban antes de cerrar sesión.`);await signOut();await saveCache(null);setUser(null);setProducts([]);setCustomers([]);setPlatforms([]);setSessions([]);setSale(null);setClosure(null);setSessionFilter('');setTab('home');});
 if(boot)return <SafeAreaView style={local.root}><View style={{flex:1,alignItems:'center',justifyContent:'center',gap:18}}><Logo width={150}/><ActivityIndicator color={colors.green}/></View></SafeAreaView>;
 const errorBanner=error&&<View style={local.bannerWrap}><Banner text={error.text} detail={error.detail} onClose={()=>setError(null)}/></View>;
 if(!user)return <SafeAreaView style={local.root} edges={['top','left','right','bottom']}><StatusBar style="dark"/><ProgressBar active={busy}/>{errorBanner}
  <LoginScreen busy={busy} onSubmit={(username,password)=>run(async()=>{const u=await signIn(username,password);setUser(u);setTab('home');await refresh();})}/></SafeAreaView>;
 const visibleQueue=queue.filter(q=>canDisplaySale(user,q.sale,businessClock.date,settings.time_zone));
 const queuedTotal=visibleQueue.reduce((n,q)=>n+q.sale.total_cents,0);
 const brand=/DANNY/i.test(settings.business_name)?"DANNY'S":settings.business_name;
 return <SafeAreaView style={local.root} edges={['top','left','right','bottom']}><StatusBar style="dark"/>
  <View style={local.top}>
   <Pressable accessibilityRole="button" accessibilityLabel="Ir a inicio" onPress={()=>go('home')} style={local.brandGroup}>
    <Logo width={46}/>
    <View style={{flexShrink:1}}><Text numberOfLines={1} style={local.brandText}>{brand}</Text>{width>=390&&<Text numberOfLines={1} style={local.brandSub}>Distribuidora & Salsamentaria</Text>}</View>
   </Pressable>
   {(queue.length>0||!online)&&<Pressable testID="sync-status" accessibilityRole="button" accessibilityLabel={queue.length?`${queue.length} ventas por subir, subir ahora`:'Sin señal'} onPress={()=>run(()=>sync(true))} style={[local.cashPill,{backgroundColor:online?colors.yellowSoft:'#EEF1EE'}]}>
    <Feather name={online?'upload-cloud':'cloud-off'} size={14} color={online?'#7A5600':colors.text}/>{queue.length>0&&<Text style={[local.cashText,{color:online?'#7A5600':colors.text}]}>{queue.length}</Text>}
   </Pressable>}
   <Pressable testID="cash-status" accessibilityRole="button" accessibilityLabel={own?'Caja abierta, ver caja':'Caja cerrada, abrir caja'} onPress={()=>go('cash')} style={[local.cashPill,{backgroundColor:own?colors.greenSoft:colors.orangeSoft}]}>
    <View style={[local.dot,{backgroundColor:own?colors.green:colors.orange}]}/><Text numberOfLines={1} style={[local.cashText,{color:own?colors.greenDark:colors.orange}]}>{own?`Caja${own.number?' #'+own.number:''}`:'Sin caja'}</Text>
   </Pressable>
   <Pressable testID="profile-button" accessibilityRole="button" accessibilityLabel="Mi perfil y configuración" onPress={()=>go('settings')} style={[local.avatar,tab==='settings'&&{borderColor:colors.green,borderWidth:2}]}>
    <Text style={local.avatarText}>{initials(user.name)}</Text>
   </Pressable>
  </View>
  <View style={{flex:1}}>
   <ProgressBar active={busy}/>
   {errorBanner}
   {tab==='home'&&<HomeScreen user={user} sessions={visibleSessions} busy={busy} run={run} refresh={refresh} go={go} onHistory={()=>history()} onCatalog={catalog} online={online} queued={visibleQueue.length} queuedTotal={queuedTotal} onSync={()=>run(()=>sync(true))}/>}
   {/* Vender permanece montada: el carrito no se pierde al cambiar de pestaña. */}
   <View style={{flex:tab==='sale'?1:0,display:tab==='sale'?'flex':'none'}}><SaleScreen businessDate={businessClock.date} user={user} settings={settings} active={tab==='sale'} session={own} products={products.filter((p):p is SellableProduct=>!!p.active&&p.price_cents!==null&&p.unit!==null)} customers={allCustomers} platforms={platforms} paperWidth={settings.paper_width} refresh={refresh} run={run} busy={busy} onViewSale={s=>history(s)} onOpenCash={()=>go('cash')} enqueue={enqueue} dequeue={dequeue} onLocalCustomer={addLocalCustomer}/></View>
   {tab==='cash'&&<CashScreen key={user.role==='seller'?businessClock.date:'admin'} queued={queue.length} sessions={visibleSessions} user={user} refresh={refresh} run={run} busy={busy} onClosure={c=>history(null,c)} onHistory={id=>history(null,null,id)} onSell={()=>go('sale')}/>}
   {tab==='catalog'&&<CatalogScreen key={catalogVersion} initialTab={catalogTab} products={products} customers={allCustomers} user={user} run={run} refresh={refresh} busy={busy}/>}
   {tab==='history'&&<HistoryScreen platforms={platforms} refresh={refresh} businessDate={businessClock.date} key={historyVersion} user={user} settings={settings} run={run} busy={busy} initialSale={sale} initialClosure={closure} sessionFilter={sessionFilter} clearInitial={()=>{setSale(null);setClosure(null);}} customers={allCustomers} sessions={visibleSessions} queue={queue}/>}
   {(tab==='accounts'||tab==='routes')&&user.role==='admin'&&<AdminScreen section={tab} user={user} settings={settings} products={products} platforms={platforms} sessions={sessions} run={run} busy={busy} refresh={refresh} back={()=>go('settings')}/>}
   {tab==='stock'&&user.role==='admin'&&<StockLoadScreen user={user} settings={settings} products={products} run={run} busy={busy} refresh={refresh} back={()=>go('settings')}/>}
   {tab==='settings'&&<SettingsScreen onAdmin={section=>go(section)} queued={queue.length} user={user} settings={settings} platforms={platforms} run={run} refresh={refresh} busy={busy} logout={logout}/>}
   {!!toast&&<Toast text={toast}/>}
  </View>
  <View style={styles.nav} accessibilityRole="tablist">{tabs.map(t=>{const on=tab===t.id;const center=t.id==='sale';return <Pressable key={t.id} testID={`tab-${t.id}`} accessibilityRole="tab" accessibilityLabel={t.name} accessibilityState={{selected:on}} onPress={()=>t.id==='history'?history():go(t.id)} style={styles.navItem}>
   {center?<View style={[local.sellIcon,on&&{backgroundColor:colors.greenDark}]}><Feather name={t.icon} size={22} color="white"/></View>:<View style={[local.navPill,on&&{backgroundColor:colors.greenSoft}]}><Feather name={t.icon} size={21} color={on?colors.green:colors.muted}/></View>}
   <Text numberOfLines={1} style={[styles.navText,on&&{color:colors.green}]}>{t.name}</Text>
  </Pressable>;})}</View>
 </SafeAreaView>;
}
function Toast({text}:{text:string}){
 const y=useRef(new Animated.Value(-20)).current;
 useEffect(()=>{Animated.spring(y,{toValue:0,useNativeDriver:Platform.OS!=='web'}).start();},[y]);
 return <View pointerEvents="none" style={local.toastWrap}><Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[local.toast,{transform:[{translateY:y}]}]}><Feather name="check-circle" size={18} color="white"/><Text style={local.toastText}>{text}</Text></Animated.View></View>;
}
const local=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.bg},
 top:{paddingHorizontal:12,paddingVertical:6,flexDirection:'row',alignItems:'center',gap:8,borderBottomColor:colors.line,borderBottomWidth:1,backgroundColor:colors.white,minHeight:56},
 brandGroup:{flex:1,flexDirection:'row',alignItems:'center',gap:8,minWidth:0},
 brandText:{fontSize:16,fontWeight:'900',color:colors.greenDark,letterSpacing:0.3},
 brandSub:{fontSize:10,fontWeight:'600',color:colors.muted},
 cashPill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,minHeight:34,borderRadius:999,flexShrink:0},
 dot:{width:8,height:8,borderRadius:4},
 cashText:{fontSize:12,fontWeight:'800'},
 avatar:{width:38,height:38,borderRadius:19,backgroundColor:colors.green,alignItems:'center',justifyContent:'center',flexShrink:0},
 avatarText:{color:'white',fontWeight:'800',fontSize:14},
 bannerWrap:{paddingHorizontal:16,paddingTop:10,width:'100%',maxWidth:760,alignSelf:'center'},
 navPill:{width:52,height:30,borderRadius:15,alignItems:'center',justifyContent:'center'},
 sellIcon:{width:52,height:40,borderRadius:20,backgroundColor:colors.green,alignItems:'center',justifyContent:'center',marginTop:-6,shadowColor:colors.green,shadowOpacity:0.35,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:4},
 toastWrap:{position:'absolute',left:16,right:16,top:10,alignItems:'center',zIndex:30},
 toast:{width:'100%',maxWidth:520,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.ink,paddingHorizontal:16,paddingVertical:13,borderRadius:14,shadowColor:'#000',shadowOpacity:0.2,shadowRadius:10,elevation:6},
 toastText:{color:'white',fontWeight:'700',fontSize:14,flex:1},
});
