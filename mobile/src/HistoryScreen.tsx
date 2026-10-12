import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api, ApiError, documentAction} from './api';
import {canDisplaySale} from './businessDay';
import {CancelSaleSheet} from './CancelSaleSheet';
import {Receipt} from './Receipt';
import {printLocal, saleTitle, type QueuedSale} from './offline';
import {Badge, Banner, Button, Card, Choice, Divider, Empty, Field, FooterBar, Header, IconButton, InfoRow, Loading, Page, SearchBar, Section, Segmented, Sheet, bogotaDay, colors, cop, date, dayLabel, diff, isIsoDate, normalizeSearch, quantityLabel, receiptNumber, shortDate, signed, styles, time, useBack} from './ui';
import type {Sale, Closure, SalesPage, Settings, User, Customer, CashSession, Platform} from './types';
import type {Run} from '../App';
type Props = {platforms:Platform[];refresh:()=>Promise<void>;businessDate: string; user: User; settings: Settings; run: Run; busy: boolean; initialSale: Sale | null; initialClosure: Closure | null; sessionFilter: string; clearInitial: () => void; customers: Customer[]; sessions: CashSession[]; queue: QueuedSale[]};
type Period = 'today' | 'yesterday' | 'week' | 'all' | 'range';
const PERIODS: {id: Period; name: string}[] = [{id: 'today', name: 'Hoy'}, {id: 'yesterday', name: 'Ayer'}, {id: 'week', name: '7 días'}, {id: 'all', name: 'Todo'}, {id: 'range', name: 'Rango'}];
const methodName = (s: {method?: string; platform_name?: string | null}) => s.method === 'cash' ? 'Efectivo' : s.method==='credit'?'Crédito':s.platform_name || 'Electrónico';

export function HistoryScreen({platforms,refresh,businessDate, user, settings, run, busy, initialSale, initialClosure, sessionFilter, clearInitial, customers, sessions, queue}: Props) {
  const [cancelOpen,setCancelOpen]=useState(false),[search,setSearch]=useState('');
  const admin = user.role === 'admin';
  const [tab, setTab] = useState(initialClosure ? 'closures' : 'sales'), [activeSession, setActiveSession] = useState(sessionFilter);
  const [storedSale, setSale] = useState<Sale | null>(initialSale), [receipt, setReceipt] = useState(!!initialSale), [closure, setClosure] = useState<Closure | null>(initialClosure);
  const [storedPage, setPage] = useState<SalesPage | null>(null), [storedList, setList] = useState<Sale[]>([]), [closures, setClosures] = useState<Closure[] | null>(null);
  const [period, setPeriod] = useState<Period>(admin && sessionFilter ? 'all' : 'today'), [from, setFrom] = useState(''), [to, setTo] = useState(''), [method, setMethod] = useState(''), [customer, setCustomer] = useState(''), [seller, setSeller] = useState('');
  const [filters, setFilters] = useState(false), [customerSearch, setCustomerSearch] = useState(''), [showGroups, setShowGroups] = useState(false), [group, setGroup] = useState('method');
  const [width, setWidth] = useState<58 | 80>(settings.paper_width), [note, setNote] = useState('');
  const zone = settings.time_zone || 'America/Bogota';
  const allowed = (s: Sale) => canDisplaySale(user, s, businessDate, zone);
  const sale = storedSale && allowed(storedSale) ? storedSale : null;
  const page = admin || storedPage?.access.date === businessDate ? storedPage : null;
  const list = storedList.filter(allowed), visibleQueue = queue.filter(q => allowed(q.sale));
  const request = useRef(0), previousDate = useRef(businessDate), currentDate = useRef(businessDate); currentDate.current = businessDate;
  useEffect(() => { if (previousDate.current === businessDate) return; previousDate.current = businessDate; request.current++; setPage(null); setList([]); if (!admin) { setSale(null); setReceipt(false); clearInitial(); } }, [businessDate]);
  useEffect(() => () => { request.current++; }, []);
  useBack(!!sale || !!closure, back);

  const range = useMemo(() => {
    if (!admin) return {from: '', to: ''};
    if (period === 'today') return {from: businessDate, to: businessDate};
    if (period === 'yesterday') return {from: bogotaDay(-1, new Date(`${businessDate}T12:00:00Z`), 'UTC'), to: bogotaDay(-1, new Date(`${businessDate}T12:00:00Z`), 'UTC')};
    if (period === 'week') return {from: bogotaDay(-6, new Date(`${businessDate}T12:00:00Z`), 'UTC'), to: businessDate};
    if (period === 'range') return {from: isIsoDate(from) ? from : '', to: isIsoDate(to) ? to : ''};
    return {from: '', to: ''};
  }, [period, from, to, businessDate, admin]);
  const rangeError = period === 'range' && ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) ? 'Usa el formato AAAA-MM-DD, por ejemplo 2026-10-01' : period === 'range' && range.from && range.to && range.from > range.to ? 'La fecha inicial debe ser anterior a la final' : null;

  async function load(next = 1) {
    const ticket = ++request.current, requestedDate = businessDate;
    const params = new URLSearchParams({page: String(next)});
    if (activeSession) params.set('session_id', activeSession);
    if (method) params.set('method', method);
    if(search.trim())params.set('search',search.trim());
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    if (customer) params.set('customer_id', customer);
    if (seller) params.set('seller_id', seller);
    const result = await api<SalesPage>('/sales?' + params);
    if (ticket !== request.current || requestedDate !== currentDate.current || (!admin && result.access.date !== currentDate.current)) return;
    setPage(result); setList(current => next === 1 ? result.sales : [...current, ...result.sales]);
  }
  const [noSignal, setNoSignal] = useState(false);
  // Sin señal no es un error: se muestran las ventas guardadas en el celular y un aviso.
  const loadSafe = (next = 1) => load(next).then(() => setNoSignal(false)).catch(e => { if (e instanceof ApiError && e.status === 0) setNoSignal(true); else throw e; });
  useEffect(() => { if (tab === 'sales' && !rangeError) run(() => loadSafe(1)); }, [tab, range.from, range.to, method, customer, seller, activeSession, businessDate, search]);
  useEffect(() => { if (tab === 'closures' && admin) run(async () => setClosures(await api<Closure[]>('/closures'))); }, [tab]);

  function back() { if (receipt && sale) { setReceipt(false); return; } setSale(null); setClosure(null); setReceipt(false); clearInitial(); }
  const sellers = Array.from(new Map(sessions.map(s => [s.opened_by, {id: s.opened_by, name: s.opener_name}])).values());
  const customerName = (id: string) => customers.find(c => c.id === id)?.name;
  const sessionNumber = sessions.find(s => s.id === activeSession)?.number;
  const pdf = (path: string, action: 'print' | 'share' | 'open') => run(() => documentAction(path, width, action));
  // Una venta aún en el celular (sin número oficial) se imprime localmente; las registradas usan el PDF guardado.
  const printSale = (s: Sale, action: 'print' | 'share') => s.number ? pdf(`/sales/${s.id}`, action) : run(() => printLocal(s, width, action));
  const BackLink = ({text}: {text: string}) => <Pressable accessibilityRole="button" onPress={back} hitSlop={8} style={[styles.row, {justifyContent: 'flex-start', gap: 6}]}><Feather name="arrow-left" size={18} color={colors.green}/><Text style={styles.link}>{text}</Text></Pressable>;
  const WidthPicker = () => <View style={{gap: 6}}><Text style={styles.label}>Tamaño del papel</Text><Segmented items={[{id: '58', name: '58 mm'}, {id: '80', name: '80 mm'}]} value={String(width)} onChange={v => setWidth(Number(v) as 58 | 80)}/></View>;

  // ── Vista previa del comprobante: datos históricos guardados, nunca los precios actuales.
  if (sale && receipt) return <Page testID="receipt-screen" footer={<FooterBar>
      <Button title="Imprimir" icon="printer" style={{flex: 1.2}} disabled={busy} onPress={() => printSale(sale, 'print')} testID="receipt-print"/>
      <Button title="Compartir" icon="share-2" variant="secondary" style={{flex: 1}} disabled={busy} onPress={() => printSale(sale, 'share')}/>
      {!!sale.number && <Button title="PDF" icon="download" variant="outline" disabled={busy} onPress={() => pdf(`/sales/${sale.id}`, 'open')} testID="receipt-pdf"/>}
    </FooterBar>}>
    <BackLink text="Volver al detalle de la venta"/>
    {sale.pdf_message && <Banner tone="orange" text={sale.pdf_message}/>}
    <WidthPicker/>
    <View style={{backgroundColor: '#E4E9E4', borderRadius: 18, paddingVertical: 20, paddingHorizontal: 8}}><Receipt sale={sale} width={width}/></View>
    <Text style={[styles.small, {textAlign: 'center'}]}>Vista de impresión en blanco y negro. Imprime al 100 %, sin “ajustar a página”.</Text>
  </Page>;

  // ── Detalle de venta
  if (sale) return <Page testID="sale-detail">
    <BackLink text="Historial"/>
    <Header eyebrow={sale.number ? 'VENTA REGISTRADA' : 'GUARDADA EN EL CELULAR'} title={`Venta ${saleTitle(sale)}`} subtitle={date(sale.created_at)} right={sale.number ? <Badge text="Guardada" icon="check"/> : <Badge text="Por subir" icon="upload-cloud" tone="yellow"/>}/>
    {!sale.number && <Banner tone="yellow" text="Esta venta se hizo sin señal. Se subirá sola y recibirá su número consecutivo oficial."/>}
    {!!sale.number && !!sale.snapshot.offline_ref && <Text style={styles.small}>Hecha en ruta sin señal · comprobante provisional {sale.snapshot.offline_ref}</Text>}
    <Card>
      <InfoRow label="Cliente" value={sale.snapshot.customer_name} strong/>
      <InfoRow label="Ciudad" value={sale.snapshot.customer_city}/>
      <InfoRow label="Vendedor" value={sale.snapshot.seller_name}/>
      {!!sale.session_number && <InfoRow label="Caja" value={`#${sale.session_number}`}/>}
      <InfoRow label="Fecha y hora" value={`${shortDate(sale.created_at)} · ${time(sale.created_at)}`}/>
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>Productos</Text>
      {sale.items?.map(i => <View key={i.id} style={[styles.row, {alignItems: 'flex-start'}]}>
        <View style={{flex: 1}}><Text style={{color: colors.ink, fontWeight: '600', fontSize: 15}}>{i.name}</Text><Text style={styles.small}>{quantityLabel(i.quantity_milli, i.unit)} × {cop(i.price_cents)}{i.unit === 'kg' ? '/kg' : ''}</Text></View>
        <Text style={[styles.money, {fontSize: 15}]}>{cop(i.subtotal_cents)}</Text>
      </View>)}
      <Divider/>
      <View style={styles.row}><Text style={styles.h2}>Total</Text><Text style={[styles.metric, {color: colors.green}]}>{cop(sale.total_cents)}</Text></View>
      {!!sale.snapshot.customer_identification&&<InfoRow label="Identificación" value={sale.snapshot.customer_identification}/>}
      {sale.payments?.map((p, i) => <InfoRow key={i} label="Método de pago" value={p.method === 'cash' ? 'Efectivo' : p.method==='credit'?'Crédito': `Electrónico · ${p.platform_name}`}/>)}
    </Card>
    {sale.payments?.filter(p=>p.method==='electronic'&&p.reference).map((p,i)=><InfoRow key={i} label="Número de referencia" value={p.reference!}/>)}
    {sale.cancellation&&<Banner tone="orange" title="Venta anulada" text={sale.cancellation.actor_name+' · '+date(sale.cancellation.created_at)+' · '+sale.cancellation.reason}/>}
    {admin&&!sale.cancellation&&<Button title="Anular venta" icon="slash" variant="outline" disabled={busy} onPress={()=>setCancelOpen(true)} testID="cancel-sale"/>}
    {cancelOpen&&admin&&<CancelSaleSheet sale={sale} platforms={platforms} run={run} busy={busy} onClose={()=>setCancelOpen(false)} onDone={async s=>{setSale(s);await refresh();await load(1);}}/>}
    <Button title="Ver comprobante" icon="file-text" size="lg" onPress={() => setReceipt(true)} testID="view-receipt"/>
    <View style={[styles.row, {gap: 10}]}>
      <Button title="Reimprimir" icon="printer" variant="secondary" style={{flex: 1}} disabled={busy} onPress={() => printSale(sale, 'print')}/>
      <Button title="Compartir" icon="share-2" variant="secondary" style={{flex: 1}} disabled={busy} onPress={() => printSale(sale, 'share')}/>
    </View>
    <Text style={[styles.small, {textAlign: 'center'}]}>Las facturas conservan sus datos originales. Las anulaciones administrativas quedan registradas por separado.</Text>
  </Page>;

  // ── Detalle de cierre
  if (closure) { const c = closure.snapshot; return <Page testID="closure-detail">
    <BackLink text="Historial de cierres"/>
    {closure.pdf_message && <Banner tone="orange" text={closure.pdf_message}/>}
    <Header eyebrow="CIERRE DE CAJA" title={`Cierre ${receiptNumber(closure.number)}`} subtitle={date(c.closed_at)} right={<Badge text="Definitivo" icon="lock" tone="gray"/>}/>
    <Card>
      {!!closure.session_number && <InfoRow label="Caja" value={`#${closure.session_number}`}/>}
      <InfoRow label="Abrió" value={c.opener_name}/>
      <InfoRow label="Apertura" value={`${shortDate(c.opened_at)} · ${time(c.opened_at)}`}/>
      <InfoRow label="Cerró" value={c.admin_name}/>
      <InfoRow label="Cierre" value={`${shortDate(c.closed_at)} · ${time(c.closed_at)}`}/>
      <Divider/>
      <InfoRow label={`Total vendido · ${c.sale_count} ventas`} value={cop(c.total_cents)} strong/>
      <InfoRow label="Ventas en efectivo" value={cop(c.sales_cash_cents??c.cash_cents)}/>
      <InfoRow label="Ventas electrónicas" value={cop(c.sales_electronic_cents??c.electronic_cents)}/>
      {c.platforms.map((p, i) => <InfoRow key={i} label={`· ${p.platform_name}`} value={cop(p.amount)}/>)}
      <InfoRow label="Crédito registrado" value={cop(c.credit_cents||0)}/>
      <InfoRow label="Cobros de cartera en efectivo" value={cop(c.collection_cash_cents||0)}/>
      <InfoRow label="Cobros de cartera electrónicos" value={cop(c.collection_electronic_cents||0)}/>
      <InfoRow label="Base inicial" value={cop(c.opening_cents)}/>
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>Conciliación</Text>
      <InfoRow label="Efectivo esperado" value={cop(c.expected_cash_cents)}/>
      <InfoRow label="Efectivo contado" value={cop(c.declared_cash_cents)}/>
      <InfoRow label="Diferencia efectivo" value={signed(c.cash_difference_cents)} tone={c.cash_difference_cents === 0 ? 'green' : 'orange'}/>
      <Text style={styles.small}>{diff(c.cash_difference_cents)}</Text>
      <Divider/>
      <InfoRow label="Electrónico registrado" value={cop(c.electronic_cents)}/>
      <InfoRow label="Electrónico verificado" value={cop(c.declared_electronic_cents)}/>
      <InfoRow label="Diferencia electrónico" value={signed(c.electronic_difference_cents)} tone={c.electronic_difference_cents === 0 ? 'green' : 'orange'}/>
      <Text style={styles.small}>{diff(c.electronic_difference_cents)}</Text>
      <Divider/>
      <InfoRow label="Crédito reportado" value={cop(c.declared_credit_cents||0)}/>
      <InfoRow label="Diferencia de crédito" value={signed(c.credit_difference_cents||0)}/>
      <InfoRow label="Diferencia total" value={signed(c.total_difference_cents)} strong/>
      {!!c.notes && <Text style={styles.body}>Observaciones: {c.notes}</Text>}
    </Card>
    {closure.adjustments?.map(a=><Banner key={a.id} tone="orange" title="Ajuste posterior al cierre" text={date(a.created_at)+' · '+a.detail.reason+' · '+cop(a.detail.reversed_cents)}/>)}
    <Button title="Ver ventas incluidas" icon="list" variant="secondary" onPress={() => { setActiveSession(closure.session_id); setPeriod('all'); setClosure(null); setTab('sales'); }}/>
    <Card>
      <Text style={styles.sectionTitle}>Documento del cierre</Text>
      <WidthPicker/>
      <View style={[styles.row, {gap: 10, flexWrap: 'wrap'}]}>
        <Button title="Imprimir" icon="printer" style={{flexGrow: 1}} disabled={busy} onPress={() => pdf(`/closures/${closure.id}`, 'print')}/>
        <Button title="Compartir" icon="share-2" variant="secondary" style={{flexGrow: 1}} disabled={busy} onPress={() => pdf(`/closures/${closure.id}`, 'share')}/>
        <Button title="PDF" icon="download" variant="outline" style={{flexGrow: 1}} disabled={busy} onPress={() => pdf(`/closures/${closure.id}`, 'open')}/>
      </View>
    </Card>
    <Card>
      <Text style={styles.sectionTitle}>Aclaraciones</Text>
      {closure.annotations?.length ? closure.annotations.map(n => <View key={n.id} style={{gap: 2, paddingVertical: 4}}><Text style={styles.body}>{n.note}</Text><Text style={styles.small}>{n.author_name} · {date(n.created_at)}</Text></View>) : <Text style={styles.small}>Sin aclaraciones.</Text>}
      <Field label="Agregar aclaración" value={note} onChange={setNote} multiline placeholder="No cambia los valores del cierre; queda registrada con tu nombre."/>
      <Button title="Guardar aclaración" variant="secondary" disabled={busy || !note.trim()} onPress={() => run(async () => { setClosure(await api<Closure>(`/closures/${closure.id}/notes`, 'POST', {note})); setNote(''); }, 'Aclaración guardada')}/>
    </Card>
  </Page>; }

  // ── Listado
  const totals = page?.groups.method?.reduce((a, g) => ({count: a.count + g.count, total: a.total + g.total_cents}), {count: 0, total: 0});
  const sections: {day: string; items: Sale[]}[] = [];
  for (const s of list) { const day = dayLabel(s.created_at, zone); const last = sections[sections.length - 1]; if (last?.day === day) last.items.push(s); else sections.push({day, items: [s]}); }
  const activeChips = [
    activeSession && {key: 'session', text: `Caja${sessionNumber ? ' #' + sessionNumber : ''}`, clear: () => setActiveSession('')},
    customer && {key: 'customer', text: customerName(customer) || 'Cliente', clear: () => setCustomer('')},
    seller && {key: 'seller', text: sellers.find(s => s.id === seller)?.name || 'Vendedor', clear: () => setSeller('')},
  ].filter(Boolean) as {key: string; text: string; clear: () => void}[];

  return <Page onRefresh={() => run(() => tab === 'sales' ? load(1) : api<Closure[]>('/closures').then(setClosures))}>
    <Header eyebrow="HISTORIAL" title={tab === 'sales' ? 'Ventas' : 'Cierres de caja'}/>
    {admin && <Segmented items={[{id: 'sales', name: 'Ventas'}, {id: 'closures', name: 'Cierres'}]} value={tab} onChange={setTab} testID="history-tabs"/>}
    {tab === 'sales' ? <>
      {!admin && <Banner tone="gray" text="Solo puedes consultar las ventas del día actual"/>}
      <SearchBar value={search} onChange={setSearch} placeholder="Buscar factura, cliente o referencia"/>
      {noSignal && <Banner tone="gray" text="Sin señal: el historial del sistema se verá al recuperar internet. Abajo están las ventas guardadas en este celular."/>}
      {visibleQueue.length > 0 && <Section title={`Por subir (${visibleQueue.length})`}>
        <View style={{backgroundColor: colors.yellowSoft, borderRadius: 16, overflow: 'hidden'}}>
          {visibleQueue.map((q, i) => <Pressable key={q.key} testID={`queued-${q.provisional}`} accessibilityRole="button" accessibilityLabel={`Venta ${q.provisional} por subir`} onPress={() => { setSale(q.sale); setReceipt(false); }}
            style={[{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 60}, i > 0 && {borderTopWidth: 1, borderTopColor: '#F1E2B3'}]}>
            <View style={{flex: 1, gap: 2}}>
              <Text style={{fontSize: 15, fontWeight: '800', color: colors.ink}}>Venta {q.provisional}</Text>
              <Text numberOfLines={1} style={styles.small}>{time(q.created_at)} · {q.sale.snapshot.customer_name}</Text>
              {!!q.error && <Text style={[styles.small, {color: colors.red}]}>{q.error}</Text>}
            </View>
            <View style={{alignItems: 'flex-end', gap: 4}}><Text style={[styles.money, {fontSize: 15}]}>{cop(q.sale.total_cents)}</Text><Badge text="Por subir" icon="upload-cloud" tone="yellow"/></View>
          </Pressable>)}
        </View>
      </Section>}
      {admin && <Choice items={PERIODS} value={period} onChange={v => setPeriod(v as Period)}/>}
      {admin && period === 'range' && <View style={[styles.row, {alignItems: 'flex-start', gap: 10}]}>
        <View style={{flex: 1}}><Field label="Desde" kind="date" value={from} onChange={setFrom} placeholder={bogotaDay(-30)}/></View>
        <View style={{flex: 1}}><Field label="Hasta" kind="date" value={to} onChange={setTo} placeholder={bogotaDay(0)}/></View>
      </View>}
      {rangeError && <Text style={styles.fieldError}>{rangeError}</Text>}
      <View style={[styles.row, {alignItems: 'flex-start', gap: 8}]}>
        <View style={{flex: 1}}><Choice items={[{id: '', name: 'Todo pago'}, {id: 'cash', name: 'Efectivo'}, {id: 'electronic', name: 'Electrónico'},{id:'credit',name:'Crédito'}]} value={method} onChange={setMethod}/></View>
        <IconButton icon="sliders" label="Más filtros" onPress={() => setFilters(true)} tone={activeChips.length ? 'green' : 'gray'}/>
      </View>
      {activeChips.length > 0 && <View style={styles.wrap}>{activeChips.map(c => <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`Quitar filtro ${c.text}`} onPress={c.clear} style={[styles.chip, styles.chipOn]}><Text style={[styles.chipText, {color: 'white'}]}>{c.text}</Text><Feather name="x" size={14} color="white"/></Pressable>)}</View>}

      {page && <Card tone="green" style={{paddingVertical: 12}}>
        <View style={styles.row}><View><Text style={[styles.small, {color: colors.greenDark}]}>{totals?.count ?? page.count} {(totals?.count ?? page.count) === 1 ? 'venta' : 'ventas'}</Text><Text testID="history-total" style={[styles.metric, {color: colors.greenDark}]}>{cop(totals?.total || 0)}</Text></View>
          {admin && page.count > 0 && <Button title={showGroups ? 'Ocultar' : 'Totales'} icon="bar-chart-2" variant="ghost" size="sm" onPress={() => setShowGroups(!showGroups)}/>}</View>
        {showGroups && admin && <View style={{gap: 8}}>
          <Choice items={[{id: 'method', name: 'Pago'}, {id: 'platform', name: 'Plataforma'}, {id: 'seller', name: 'Vendedor'}, {id: 'customer', name: 'Cliente'}, {id: 'date', name: 'Fecha'}]} value={group} onChange={setGroup}/>
          {page.groups[group]?.map((g, i) => <InfoRow key={i} label={`${group === 'customer' ? customerName(g.key || '') || g.key : group === 'seller' ? sellers.find(s => s.id === g.key)?.name || g.key : g.key === 'cash' ? 'Efectivo' : g.key === 'electronic' ? 'Electrónico' : g.key || 'Efectivo'} · ${g.count}`} value={cop(g.total_cents)}/>)}
        </View>}
      </Card>}

      {!page && busy && <Loading text="Buscando ventas…"/>}
      {page && list.length === 0 && <Empty icon="calendar" title={period === 'today' ? 'Sin ventas hoy' : 'Sin ventas en este filtro'} text={period === 'today' ? 'Las ventas confirmadas hoy aparecerán aquí.' : 'Prueba otro periodo o quita filtros.'} action={admin ? 'Ver todas las ventas' : activeChips.length || method ? 'Quitar filtros' : undefined} onAction={() => { setPeriod(admin ? 'all' : 'today'); setMethod(''); setCustomer(''); setSeller(''); setActiveSession(''); }}/>}
      {sections.map(section => <Section key={section.day} title={section.day.charAt(0).toUpperCase() + section.day.slice(1)}>
        <View style={{backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden'}}>
          {section.items.map((s, i) => <Pressable key={s.id} testID={`sale-row-${s.number}`} accessibilityRole="button" accessibilityLabel={`Venta ${receiptNumber(s.number)}, ${s.snapshot.customer_name}, ${cop(s.total_cents)}`} onPress={() => run(async () => { const requestedDate = businessDate, ticket = ++request.current; const detail = await api<Sale>(`/sales/${s.id}`); if (ticket === request.current && requestedDate === currentDate.current) { setSale(detail); setReceipt(false); } })}
            style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 64}, i > 0 && {borderTopWidth: 1, borderTopColor: colors.line}, pressed && {backgroundColor: colors.greenSoft}]}>
            <View style={{flex: 1, gap: 2}}>
              <Text style={{fontSize: 15, fontWeight: '800', color: colors.ink}}>Venta {receiptNumber(s.number)}{s.status==='cancelled'?' · Anulada':''}</Text>
              <Text numberOfLines={1} style={styles.small}>{time(s.created_at)} · {s.snapshot.customer_name}{s.method==='electronic'&&s.reference?' · Ref. '+s.reference:''}{admin ? ` · ${s.snapshot.seller_name}` : ''}</Text>
            </View>
            <View style={{alignItems: 'flex-end', gap: 4}}><Text style={[styles.money, {fontSize: 15}]}>{cop(s.total_cents)}</Text><Badge text={methodName(s)} tone={s.method === 'cash' ? 'green' : 'gray'}/></View>
          </Pressable>)}
        </View>
      </Section>)}
      {page && list.length < page.count && <Button title={`Cargar más (${page.count - list.length})`} variant="outline" loading={busy} onPress={() => run(() => load(page.page + 1))}/>}
    </> : <>
      {closures === null && <Loading text="Cargando cierres…"/>}
      {closures?.length === 0 && <Empty icon="archive" title="Sin cierres todavía" text="Cada cierre de caja queda guardado aquí de forma permanente."/>}
      {closures?.map(c => <Card key={c.id} testID={`closure-row-${c.number}`} onPress={() => run(async () => setClosure(await api<Closure>(`/closures/${c.id}`)))}>
        <View style={styles.row}>
          <View style={{flex: 1, gap: 2}}><Text style={styles.h2}>Cierre {receiptNumber(c.number)}</Text><Text style={styles.small}>{c.session_number ? `Caja #${c.session_number} · ` : ''}{c.snapshot.opener_name} · {shortDate(c.created_at)}</Text></View>
          <Text style={styles.money}>{cop(c.snapshot.total_cents)}</Text>
        </View>
        <View style={styles.wrap}>
          <Badge tone={c.snapshot.cash_difference_cents === 0 ? 'green' : 'orange'} text={`Efectivo ${c.snapshot.cash_difference_cents === 0 ? 'cuadra' : signed(c.snapshot.cash_difference_cents)}`}/>
          <Badge tone={c.snapshot.electronic_difference_cents === 0 ? 'green' : 'orange'} text={`Electrónico ${c.snapshot.electronic_difference_cents === 0 ? 'cuadra' : signed(c.snapshot.electronic_difference_cents)}`}/>
        </View>
      </Card>)}
    </>}

    <Sheet visible={filters} onClose={() => setFilters(false)} title="Más filtros" footer={<>
      <Button title="Ver resultados" size="lg" onPress={() => setFilters(false)}/>
      <Button title="Quitar filtros" variant="ghost" onPress={() => { setCustomer(''); setSeller(''); setActiveSession(''); setFilters(false); }}/>
    </>}>
      {admin && sellers.length > 0 && <View style={{gap: 8}}><Text style={styles.label}>Vendedor</Text><Choice items={[{id: '', name: 'Todos'}, ...sellers]} value={seller} onChange={setSeller}/></View>}
      <View style={{gap: 8}}>
        <Text style={styles.label}>Cliente{customer ? `: ${customerName(customer)}` : ''}</Text>
        <SearchBar value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar cliente"/>
        <Choice items={[{id: '', name: 'Todos'}, ...customers.filter(c => !customerSearch || normalizeSearch(c.name).includes(normalizeSearch(customerSearch))).slice(0, 20).map(c => ({id: c.id, name: c.name}))]} value={customer} onChange={setCustomer}/>
      </View>
    </Sheet>
  </Page>;
}
