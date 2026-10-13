import * as Crypto from 'expo-crypto';
import React, {useEffect, useState,useRef} from 'react';
import {Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api} from './api';
import {deviceId,loadQueue,withQueueLock} from './offline';
import {Badge, Banner, Button, Card, Choice, Confirm, Divider, Empty, Field, FooterBar, Header, InfoRow, Page, Section, colors, cop, diff, moneyInput, moneyToCents, normalizeMoney, quantityLabel,quantityText,parseQuantity,Sheet,shortDate, signed, styles, time, useBack} from './ui';
import type {CashSession, Closure, User,ClosingPreview,ClosingSync,InventoryClosingItem} from './types';
import type {Run} from '../App';
type Props = {queued: number; sessions: CashSession[]; user: User; run: Run; refresh: () => Promise<void>; busy: boolean; onClosure: (closure: Closure) => void; onHistory: (session: string) => void; onSell: () => void};
const OPENING_PRESETS = [0, 5000000, 10000000, 20000000];
const label = (s: CashSession) => `Caja${s.number ? ` #${s.number}` : ''}`;

export function CashScreen({queued, sessions, user, run, refresh, busy, onClosure, onHistory, onSell}: Props) {
  const [opening, setOpening] = useState(''), [selected, setSelected] = useState<CashSession | null>(null), [cash, setCash] = useState(''), [electronic, setElectronic] = useState(''), [notes, setNotes] = useState(''),[credit,setCredit]=useState('0'), [review, setReview] = useState(false), [showClosed, setShowClosed] = useState(8), [now, setNow] = useState(new Date());
  const [preview,setPreview]=useState<ClosingPreview|null>(null),[returns,setReturns]=useState<Record<string,{quantity:string;observation:string;edited?:boolean}>>({}),[editingReturn,setEditingReturn]=useState<InventoryClosingItem|null>(null),[returnQuantity,setReturnQuantity]=useState(''),[returnObservation,setReturnObservation]=useState(''),[closeKey,setCloseKey]=useState(''),[closeBody,setCloseBody]=useState<Record<string,unknown>|null>(null);
  const closing=useRef(false);
  function applyPreview(p:ClosingPreview){setPreview(p);setSelected(p.session);setReturns(prev=>Object.fromEntries(p.inventory.items.map(i=>[i.product_id,prev[i.product_id]?.edited?prev[i.product_id]:{quantity:quantityText(i.expected_milli),observation:''}])));}
  useEffect(()=>{if(!selected)return;let live=true;const timer=setInterval(()=>{void api<ClosingPreview>('/cash-sessions/'+selected.id+'/close-preview').then(p=>{if(live&&!closing.current)applyPreview(p);}).catch(()=>{});},2000);return()=>{live=false;clearInterval(timer);};},[selected?.id]);
  const [confirmLegacy,setConfirmLegacy]=useState(false);
  async function confirmLegacySync(){if(!own)return;await withQueueLock(user.id,async()=>{if((await loadQueue(user.id)).some(e=>e.sale.session_id===own.id))throw new Error('Aún hay ventas pendientes en este equipo. Espera a que se sincronicen.');const device=await deviceId();const status=await api<ClosingSync>('/cash-sessions/'+own.id+'/device','POST',{device_id:device,pending_count:0});await api('/cash-sessions/'+own.id+'/confirm-legacy-sync','POST',{device_id:device,epoch:status.epoch,pending_count:0});});setConfirmLegacy(false);await refresh();}
  const admin = user.role === 'admin';
  const own = sessions.find(s => s.opened_by === user.id && s.state === 'open');
  const others = sessions.filter(s => s.state === 'open' && s.id !== own?.id);
  const closed = sessions.filter(s => s.state === 'closed');
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  useBack(!!selected, () => setSelected(null));

  // Regla existente: efectivo esperado = saldo inicial + ventas en efectivo. Electrónico se concilia aparte.
  const expected = selected ? selected.opening_cents + selected.cash_cents : 0;
  const cashCents = moneyToCents(cash), elecCents = moneyToCents(electronic);
  const cashDiff = cashCents === null ? 0 : cashCents - expected, elecDiff = elecCents === null ? 0 : elecCents - (selected?.electronic_cents || 0);
  const creditCents=moneyToCents(credit),creditDiff=(creditCents||0)-(selected?.credit_cents||0);
  const stockValid=!!preview&&preview.inventory.items.every(i=>{const r=returns[i.product_id];if(!r)return false;const n=r.quantity.replace(',','.')==='0'?0:parseQuantity(r.quantity,i.unit);return n!==null&&(n===i.expected_milli||!!r.observation.trim());});
  const valid = cashCents !== null && elecCents !== null && creditCents!==null&&stockValid&&!!preview?.sync.ready;
  const openingCents = opening.trim() ? moneyToCents(opening) : 0;

  async function startClose(session: CashSession) {
    await api('/cash-sessions/'+session.id+'/prepare-close','POST',{request_key:Crypto.randomUUID()});
    const latest=await api<ClosingPreview>('/cash-sessions/'+session.id+'/close-preview');
    if(latest.session.state!=='open')throw new Error('Esta caja ya fue cerrada.');
    applyPreview(latest);setCash('');setElectronic('');setNotes('');setCredit('0');setReview(false);setCloseKey(Crypto.randomUUID());
  }
  function reviewClose(){setCloseBody({request_key:closeKey,close_epoch:preview!.sync.epoch,inventory_revision:preview!.inventory.revision,returns:preview!.inventory.items.map(i=>({product_id:i.product_id,quantity:returns[i.product_id].quantity.replace(',','.'),observation:returns[i.product_id].observation})),reviewed_revision:selected!.session_revision,reviewed_sale_count:selected!.sale_count,declared_cash:normalizeMoney(cash),declared_electronic:normalizeMoney(electronic),declared_credit:normalizeMoney(credit),notes});setReview(true);}
  async function close(){if(closing.current)return;closing.current=true;try{const c=await api<Closure>(`/cash-sessions/${selected!.id}/close`,'POST',closeBody);setReview(false);setSelected(null);onClosure(c);await refresh();}finally{closing.current=false;}}
  async function cancelClose(){await api('/cash-sessions/'+selected!.id+'/cancel-close','POST',{request_key:Crypto.randomUUID()});setSelected(null);await refresh();}

  // ── Conciliación y cierre (solo administrador)
  if (selected) return <Page footer={<FooterBar><View style={{flex:1}}><Text style={styles.h2}>{preview?.inventory.items.length||0} productos</Text><Text style={styles.small}>{preview?.sync.ready?'Devoluciones listas para revisar':'Esperando sincronización'}</Text></View><Button title="Revisar cierre" icon="clipboard" disabled={!valid||busy} onPress={reviewClose} testID="review-close"/></FooterBar>}>
    <Header eyebrow={`CERRAR ${label(selected).toUpperCase()}`} title="Contar y cerrar" subtitle={`${selected.opener_name} · abierta ${shortDate(selected.opened_at)} ${time(selected.opened_at)}`}/>
    <Card>
      <Text style={styles.sectionTitle}>Lo que dice el sistema</Text>
      <InfoRow label="Ventas registradas" value={String(selected.sale_count)}/>
      <InfoRow label="Base inicial" value={cop(selected.opening_cents)}/>
      <InfoRow label="Ventas en efectivo" value={cop(selected.sales_cash_cents??selected.cash_cents)}/>
      <InfoRow label="Ventas electrónicas" value={cop(selected.sales_electronic_cents??selected.electronic_cents)}/>
      <InfoRow label="Ventas a crédito" value={cop(selected.credit_cents||0)}/>
      <InfoRow label="Cobros cartera en efectivo" value={cop(selected.collection_cash_cents||0)}/>
      <InfoRow label="Cobros cartera electrónicos" value={cop(selected.collection_electronic_cents||0)}/>
      <InfoRow label="Devoluciones en efectivo" value={cop(selected.refund_cash_cents||0)}/>
      <InfoRow label="Devoluciones electrónicas" value={cop(selected.refund_electronic_cents||0)}/>
      <InfoRow label="Efectivo esperado" value={cop(expected)} strong/>
      <Divider/>
      <InfoRow label="Pagos electrónicos" value={cop(selected.electronic_cents)} strong/>
      {selected.platforms?.map(p => <InfoRow key={p.platform_name} label={`· ${p.platform_name}`} value={cop(p.amount)}/>)}
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>Lo que contaste</Text>
      <Field label="Efectivo físico en caja" kind="decimal" prefix="$" value={cash} onChange={setCash} placeholder="0" hint={`Incluye la base de ${cop(selected.opening_cents)}.`} error={cash && cashCents === null ? 'Escribe un valor válido, por ejemplo 250.000' : null} testID="close-cash"/>
      {cashCents !== null && <DiffLine value={cashDiff}/>}
      <Field label="Pagos electrónicos verificados en las cuentas" kind="decimal" prefix="$" value={electronic} onChange={setElectronic} placeholder="0" error={electronic && elecCents === null ? 'Escribe un valor válido' : null} testID="close-electronic"/>
      <Button title={`Coincide con lo registrado (${cop(selected.electronic_cents)})`} variant="ghost" size="sm" onPress={() => setElectronic(moneyInput(selected.electronic_cents))} style={{alignSelf: 'flex-start'}}/>
      {elecCents !== null && <DiffLine value={elecDiff}/>}
      <Field label="Crédito reportado por el vendedor" kind="decimal" prefix="$" value={credit} onChange={setCredit} hint="Conciliación únicamente: no cambia las deudas de clientes." testID="close-credit"/>
      <InfoRow label="Crédito registrado" value={cop(selected.credit_cents||0)}/>
      {creditCents!==null&&<DiffLine value={creditDiff}/>}
      <Field label="Observaciones (opcional)" value={notes} onChange={setNotes} multiline placeholder="Ej. Se pagó un domicilio con efectivo de la caja"/>
    </Card>
    {selected.opened_by===user.id&&preview?.sync.legacy_confirmation_required&&<Button title="Confirmar equipos de versión anterior sincronizados" disabled={busy||queued>0} onPress={()=>setConfirmLegacy(true)}/>}
    <Confirm visible={confirmLegacy} title="¿Todos tus equipos anteriores están sincronizados?" message="Actualiza y sincroniza todos los equipos usados en tu jornada antes de confirmar." confirmText="Confirmar equipos sincronizados" busy={busy} onCancel={()=>setConfirmLegacy(false)} onConfirm={()=>run(confirmLegacySync)}/>
    <Section title="Inventario de la ruta">
      <Text style={styles.h2}>{preview?.inventory.route_name||'Caja sin ruta'}</Text>
      {preview?.inventory.shared&&<Banner tone="yellow" text={preview.inventory.message||''}/>}
      <Text style={styles.small}>Las devoluciones ya están prellenadas. Confirma todas o edita únicamente los productos con diferencias.</Text>
      {preview?.inventory.items.map(i=>{const r=returns[i.product_id],n=r?.quantity.replace(',','.')==='0'?0:parseQuantity(r?.quantity||'',i.unit);return <Card key={i.product_id}>
       <Text style={styles.h2}>{i.name}</Text><InfoRow label="Cantidad cargada / disponible al inicio" value={quantityLabel(i.opening_milli+i.loaded_milli,i.unit)}/>{i.opening_milli>0&&<Text style={styles.small}>Incluye saldo de apertura: {quantityLabel(i.opening_milli,i.unit)}</Text>}<InfoRow label="Cantidad vendida" value={quantityLabel(i.sold_milli,i.unit)}/>{i.adjusted_milli!==0&&<InfoRow label="Ajustes anteriores" value={quantityLabel(i.adjusted_milli,i.unit)}/>}<InfoRow label="Debería sobrar" value={quantityLabel(i.expected_milli,i.unit)}/><InfoRow label="Devolución recibida" value={quantityLabel(n||0,i.unit)} strong/><InfoRow label="Diferencia" value={quantityLabel((n||0)-i.expected_milli,i.unit)}/>{r?.observation&&<Text style={styles.small}>{r.observation}</Text>}<Button title={'Editar devolución de '+i.name} variant="outline" onPress={()=>{setEditingReturn(i);setReturnQuantity(r?.quantity||'0');setReturnObservation(r?.observation||'');}}/>
      </Card>;})}
    </Section>
    <Banner tone={preview?.sync.ready?'green':'yellow'} text={preview?.sync.ready?'Todos los equipos confirmaron sincronización. Puedes revisar y cerrar dinero e inventario.':'Esperando los equipos del vendedor. Deben abrir el POS con internet y subir todas las ventas pendientes.'}/>
    <Button title="Actualizar conciliación" variant="outline" onPress={()=>run(async()=>applyPreview(await api('/cash-sessions/'+selected.id+'/close-preview')))}/>
    <Button title="Cancelar preparación de cierre" variant="outline" onPress={()=>run(cancelClose)}/>
    <Confirm visible={review} title="¿Cerrar caja e inventario?" message="Se cerrará la jornada y se devolverá al inventario general únicamente el stock recibido y confirmado." confirmText="Confirmar cierre definitivo" busy={busy} onCancel={() => setReview(false)} onConfirm={() => run(close, 'Caja cerrada')}>
      <Card style={{gap: 6}}>
        <InfoRow label="Efectivo" value={signed(cashDiff)} tone={cashDiff === 0 ? 'green' : 'orange'}/>
        <Text style={styles.small}>{diff(cashDiff)}</Text>
        <InfoRow label="Electrónico" value={signed(elecDiff)} tone={elecDiff === 0 ? 'green' : 'orange'}/>
        <Text style={styles.small}>{diff(elecDiff)}</Text>
        <InfoRow label="Diferencia crédito" value={signed(creditDiff)} tone={creditDiff===0?'green':'orange'}/>
        <Divider/>
        <InfoRow label="Diferencia total" value={signed(cashDiff + elecDiff)} strong/>
      </Card>
      <Text style={styles.h2}>Resumen de inventario · {preview?.inventory.route_name||'Sin ruta'}</Text>{preview?.inventory.items.map(i=><InfoRow key={i.product_id} label={i.name} value={quantityLabel(Number(closeBody?.returns?(closeBody.returns as {product_id:string;quantity:string}[]).find(r=>r.product_id===i.product_id)?.quantity||0:0)*1000,i.unit)}/>)}
      <Text style={styles.small}>El servidor verifica sincronización, dinero y stock nuevamente. Si cambiaron, debes revisar otra vez.</Text>
    </Confirm>
    <Sheet visible={!!editingReturn} onClose={()=>setEditingReturn(null)} title={editingReturn?.name||'Devolución'} footer={<Button title="Guardar devolución" disabled={!editingReturn||!(returnQuantity.replace(',','.')==='0'||parseQuantity(returnQuantity,editingReturn.unit)!==null)||((returnQuantity.replace(',','.')==='0'?0:parseQuantity(returnQuantity,editingReturn.unit))!==editingReturn.expected_milli&&!returnObservation.trim())} onPress={()=>{setReturns(prev=>({...prev,[editingReturn!.product_id]:{quantity:returnQuantity,observation:returnObservation,edited:true}}));setEditingReturn(null);}}/>}>
      <Field label="Cantidad realmente recibida" kind={editingReturn?.unit==='kg'?'decimal':'number'} value={returnQuantity} onChange={setReturnQuantity}/><Field label="Observación de la diferencia" value={returnObservation} onChange={setReturnObservation} multiline hint="Obligatoria si difiere de lo esperado."/>
    </Sheet>
  </Page>;

  return <Page onRefresh={() => run(refresh)}>
    <Header eyebrow="CONTROL DE CAJA" title="Caja" subtitle={own ? 'Tu caja está abierta.' : 'Abre tu caja para empezar a vender.'}/>
    {own ? <SessionCard session={own} mine admin={admin} busy={busy} onHistory={onHistory} onClose={() => run(() => startClose(own))} onSell={onSell}/>
      : <Card testID="open-cash-form">
          <View style={[styles.row, {justifyContent: 'flex-start'}]}>
            <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}><Feather name="unlock" size={18} color={colors.green}/></View>
            <View style={{flex: 1}}><Text style={styles.h2}>Abrir mi caja</Text><Text style={styles.small}>Cuenta el dinero que hay en el cajón antes de empezar.</Text></View>
          </View>
          <InfoRow label="Responsable" value={user.name}/>
          <InfoRow label="Fecha y hora" value={`${shortDate(now.toISOString())} · ${time(now.toISOString())}`}/>
          <Field label="Monto inicial (base en efectivo)" kind="decimal" prefix="$" value={opening} onChange={setOpening} placeholder="0" hint="Es el dinero para dar cambio. No cuenta como venta." error={opening && openingCents === null ? 'Escribe un valor válido, por ejemplo 100.000' : null} testID="opening-amount"/>
          <Choice items={OPENING_PRESETS.map(v => ({id: String(v), name: cop(v)}))} value={openingCents !== null && opening.trim() ? String(openingCents) : ''} onChange={v => setOpening(moneyInput(Number(v)))}/>
          <Button title="Abrir caja" icon="unlock" size="lg" disabled={busy || openingCents === null} loading={busy} testID="open-cash"
            onPress={() => run(async () => { await api('/cash-sessions', 'POST', {opening: opening.trim() ? normalizeMoney(opening) : '0'}); setOpening(''); await refresh(); }, 'Caja abierta. ¡Buenas ventas!')}/>
        </Card>}
    {own?.close_state==='preparing'&&own.legacy_sync_required&&<Button title="Confirmar equipos de versión anterior sincronizados" disabled={busy||queued>0} onPress={()=>setConfirmLegacy(true)}/>}
    <Confirm visible={confirmLegacy} title="¿Todos tus equipos anteriores están sincronizados?" message="Abre y actualiza cada equipo usado en esta jornada. Confirma solo después de subir todas sus ventas guardadas; no se eliminará ninguna venta pendiente." confirmText="Confirmar equipos sincronizados" busy={busy} onCancel={()=>setConfirmLegacy(false)} onConfirm={()=>run(confirmLegacySync)}/>
    {queued > 0 && <Banner tone="yellow" title={`${queued} ${queued === 1 ? 'venta' : 'ventas'} de ruta sin subir`} text="Conéctate a internet antes de que cierren tu caja. El cierre definitivo queda bloqueado hasta confirmar la sincronización de tus equipos."/>}
    {own?.close_state==='preparing'&&<Banner tone="yellow" text="Jornada terminando. Mantén el POS abierto con internet hasta sincronizar todas las ventas; luego el administrador podrá cerrar."/>}
    {!admin && own && <Banner tone="gray" text="El cierre de caja lo realiza un administrador: cuenta el efectivo y verifica los pagos electrónicos."/>}

    {admin && <Section title={`Otras cajas abiertas (${others.length})`}>
      {others.length === 0 ? <Text style={styles.small}>No hay otras cajas abiertas.</Text>
        : others.map(s => <SessionCard key={s.id} session={s} admin busy={busy} onHistory={onHistory} onClose={() => run(() => startClose(s))}/>)}
    </Section>}

    <Section title="Cajas anteriores">
      {closed.length === 0 && <Empty icon="archive" title="Sin cajas cerradas" text="Cada caja cerrada queda guardada aquí con sus ventas."/>}
      {closed.slice(0, showClosed).map(s => <Card key={s.id} onPress={() => onHistory(s.id)} style={{paddingVertical: 12}}>
        <View style={styles.row}>
          <View style={{flex: 1, gap: 2}}>
            <Text style={[styles.h2, {fontSize: 15}]}>{label(s)} · {s.opener_name}</Text>
            <Text style={styles.small}>{shortDate(s.opened_at)} · {s.sale_count} {s.sale_count === 1 ? 'venta' : 'ventas'}</Text>
          </View>
          <View style={{alignItems: 'flex-end', gap: 4}}><Text style={styles.money}>{cop(s.total_cents)}</Text><Badge text="Cerrada" tone="gray"/></View>
        </View>
      </Card>)}
      {closed.length > showClosed && <Button title="Ver más cajas" variant="outline" onPress={() => setShowClosed(showClosed + 10)}/>}
    </Section>
  </Page>;
}

function DiffLine({value}: {value: number}) {
  const tone = value === 0 ? 'green' : 'orange';
  return <Badge tone={tone} icon={value === 0 ? 'check' : 'alert-triangle'} text={value === 0 ? 'Cuadra exacto' : `${value > 0 ? 'Sobran' : 'Faltan'} ${cop(Math.abs(value))}`}/>;
}

function SessionCard({session: s, mine, admin, busy, onHistory, onClose, onSell}: {session: CashSession; mine?: boolean; admin: boolean; busy: boolean; onHistory: (id: string) => void; onClose: () => void; onSell?: () => void}) {
  return <Card testID={mine ? 'own-session' : undefined}>
    <View style={styles.row}>
      <View style={{flex: 1}}><Text style={styles.h2}>{label(s)}{mine ? '' : ` · ${s.opener_name}`}</Text><Text style={styles.small}>Abierta {shortDate(s.opened_at)} · {time(s.opened_at)} · {s.opener_name}</Text></View>
      <Badge text="Abierta" icon="unlock"/>
    </View>
    <View style={{backgroundColor: colors.greenSoft, borderRadius: 14, padding: 14, gap: 2}}>
      <InfoRow label="Ventas a crédito" value={cop(s.credit_cents||0)}/>
      <InfoRow label="Cobros cartera" value={cop((s.collection_cash_cents||0)+(s.collection_electronic_cents||0))}/>
      <Text style={[styles.small, {color: colors.greenDark}]}>Total vendido · {s.sale_count} {s.sale_count === 1 ? 'venta' : 'ventas'}</Text>
      <Text style={[styles.metric, {fontSize: 28, color: colors.greenDark}]}>{cop(s.total_cents)}</Text>
    </View>
    <InfoRow label="Efectivo vendido" value={cop(s.cash_cents)}/>
    <InfoRow label="Pagos electrónicos" value={cop(s.electronic_cents)}/>
    {s.platforms?.map(p => <InfoRow key={p.platform_name} label={`· ${p.platform_name}`} value={cop(p.amount)}/>)}
    <InfoRow label="Base inicial" value={cop(s.opening_cents)}/>
    <Divider/>
    <InfoRow label="Efectivo esperado en caja" value={cop(s.opening_cents + s.cash_cents)} strong/>
    <View style={[styles.row, {gap: 10, flexWrap: 'wrap'}]}>
      {onSell && <Button title="Vender" icon="shopping-cart" style={{flexGrow: 1}} onPress={onSell}/>}
      <Button title="Ver ventas" icon="list" variant="secondary" style={{flexGrow: 1}} onPress={() => onHistory(s.id)}/>
      {admin && <Button title="Cerrar caja" icon="lock" variant="outline" style={{flexGrow: 1}} disabled={busy} onPress={onClose} testID={`close-session-${s.number ?? s.id}`}/>}
    </View>
  </Card>;
}
