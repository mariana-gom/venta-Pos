import {useProductSearch} from './useProductSearch';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Platform, Pressable, Text, View, useWindowDimensions} from 'react-native';
import {Feather} from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import {canDisplaySale} from './businessDay';
import {api, ApiError, readPending, savePending} from './api';
import {deviceId,nextProvisional, printLocal, saleTitle, type QueuedSale} from './offline';
import {Badge, Banner, Button, Card, Choice, Empty, Field, FooterBar, IconButton, Loading, Page, SearchBar, Segmented, Sheet, Stepper, colors, cop, fitSize, lineSubtotal, moneyToCents, normalizeSearch, parseQuantity, quantityForApi, quantityLabel, quantityText, receiptNumber, styles, unitLabel, useBack} from './ui';
import type {CashSession, SellableProduct as Product, Customer, Platform as PayPlatform, CartLine, Sale, SaleAcknowledgement, Settings, User} from './types';
import type {Run} from '../App';
type Props = {reserved:Record<string,number>;businessDate: string; user: User; settings: Settings; enqueue: (entry: QueuedSale) => Promise<void>; dequeue: (key: string) => Promise<void>; onLocalCustomer: (c: Customer) => void; active: boolean; session?: CashSession; products: Product[]; customers: Customer[]; platforms: PayPlatform[]; paperWidth: 58 | 80; refresh: () => Promise<void>; run: Run; busy: boolean; onViewSale: (sale: Sale) => void; onOpenCash: () => void};
type SaleView = 'catalog' | 'cart' | 'pay';
const KG_PRESETS = ['0,25', '0,5', '1', '1,5', '2', '3'];
const UNIT_PRESETS = ['1', '2', '3', '6', '12', '24'];
const PAGE = 30;

export function SaleScreen({reserved,businessDate, user, settings, enqueue, dequeue, onLocalCustomer, active, session, products, customers, platforms, paperWidth, refresh, run, busy, onViewSale, onOpenCash}: Props) {
  const [cart, setCart] = useState<CartLine[]>([]), [query, setQuery] = useState(''), [limit, setLimit] = useState(PAGE), [view, setView] = useState<SaleView>('catalog');
  const [customer, setCustomer] = useState(''), [pickCustomer, setPickCustomer] = useState(false), [customerSearch, setCustomerSearch] = useState(''), [newCustomer, setNewCustomer] = useState(false), [name, setName] = useState(''), [city, setCity] = useState('');
  const [editing, setEditing] = useState<Product | null>(null), [qtyText, setQtyText] = useState('');
  const [pay, setPay] = useState(''), [reference, setReference] = useState(''), [received, setReceived] = useState('');
  const {width}=useWindowDimensions(),wide=width>=1000;
  const search=useProductSearch(products,query,'sale',undefined,active&&view!=='pay',reserved);
  const userId = user.id;
  const [ready, setReady] = useState(false), [done, setDone] = useState<{sale: Sale; change: number | null; offline: boolean} | null>(null);
  useEffect(() => { setDone(current => current && !canDisplaySale(user, current.sale, businessDate, settings.time_zone) ? null : current); }, [businessDate]);
  // Bloqueo síncrono: un doble toque no alcanza a crear dos ventas aunque React aún no haya deshabilitado el botón.
  const confirming = useRef(false);
  // Una confirmación pendiente de la versión anterior pasa a la cola de ruta (misma referencia: no se duplica).
  useEffect(() => { run(async () => {
    const old = await readPending(userId);
    if (old) { await enqueue({key: String(old.request_key), provisional: 'Pendiente', created_at: new Date().toISOString(), body: old, sale: {id: String(old.request_key), number: 0, session_id: String(old.session_id), seller_id: userId, customer_id: String(old.customer_id), created_at: new Date().toISOString(), total_cents: 0, snapshot: {business_name: settings.business_name, customer_name: 'Venta pendiente', customer_city: '', seller_name: user.name, offline_ref: 'Pendiente'}, items: [], payments: []}}); await savePending(userId, null); }
    setReady(true);
  }); }, [userId]);
  // Al actualizar el catálogo, el carrito toma precios y existencias vigentes (la API rechaza precios desactualizados).
  useEffect(() => { setCart(lines => lines.map(l => ({...l, product: products.find(p => p.id === l.product.id) || l.product}))); }, [products]);
  // En web, advertir antes de cerrar o recargar con una venta sin terminar.
  useEffect(() => {
    if (Platform.OS !== 'web' || cart.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [cart.length]);
  useBack(active && view !== 'catalog' && !done, () => setView('catalog'));

  const selectedCustomer = customers.find(c => c.id === customer);
  const lines = cart.map(l => {
    const milli = parseQuantity(l.quantity, l.product.unit);
    const short = milli !== null && l.product.stock_milli !== null && (!l.product.route_id || milli > l.product.stock_milli);
    return {...l, milli, short, subtotal: milli ? lineSubtotal(l.product.price_cents, milli) : 0};
  });
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const linesOk = lines.length > 0 && lines.every(l => l.milli !== null && !l.short);
  const method = pay === 'cash' ? 'cash' : pay === 'credit' ? 'credit' : pay ? 'electronic' : '';
  useEffect(() => { setReference(''); }, [pay]);
  const receivedCents = received.trim() ? moneyToCents(received) : null;
  const receivedError = method === 'cash' && received.trim() ? (receivedCents === null ? 'Escribe un valor válido, por ejemplo 50.000' : receivedCents < total ? `Faltan ${cop(total - receivedCents)}` : null) : null;
  const valid = !!session && session.close_state!=='preparing' && !!customer && linesOk && !!method && !receivedError && (method !== 'electronic' || !!reference.trim());
  const inCart = (id: string) => lines.find(l => l.product.id === id);

  const visible=search.rows.filter((p):p is Product=>!!p.unit&&p.price_cents!==null);
  const customerMatches = useMemo(() => {
    const q = normalizeSearch(customerSearch);
    return customers.filter(c => !q || normalizeSearch(c.name).includes(q) || normalizeSearch(c.city).includes(q)).slice(0, 40);
  }, [customers, customerSearch]);

  function setLine(product: Product, quantity: string) {
    setCart(c => c.some(l => l.product.id === product.id) ? c.map(l => l.product.id === product.id ? {...l, quantity} : l) : [...c, {product, quantity}]);
  }
  const remove = (id: string) => setCart(c => c.filter(l => l.product.id !== id));
  function step(line: CartLine, direction: 1 | -1) {
    const unit = line.product.unit, delta = unit === 'kg' ? 250 : 1000;
    const current = parseQuantity(line.quantity, unit) || 0;
    setLine(line.product, quantityText(Math.max(delta, current + direction * delta)));
  }
  /** Toda selección permite revisar la cantidad antes de agregar. */
  function quickAdd(product: Product) {
    openQuantity(product);
  }
  function openQuantity(product: Product) {
    const line = inCart(product.id);
    setEditing(product); setQtyText(line ? line.quantity : product.unit === 'unit' ? '1' : '');
  }
  const editMilli = editing ? parseQuantity(qtyText, editing.unit) : null;
  const editShort = editing && editMilli !== null && editing.stock_milli !== null && (!editing.route_id || editMilli > editing.stock_milli);
  function saveQuantity() { if (editing && editMilli !== null && !editShort) { setLine(editing, quantityText(editMilli)); setEditing(null); } }

  function reset() { setCart([]); setPay(''); setReference(''); setReceived(''); setView('catalog'); setQuery(''); setCustomer(''); setLimit(PAGE); }
  async function confirm() {
    if (confirming.current) return;
    if (!valid) throw new Error('Completa el cliente, las cantidades y el método de pago antes de confirmar.');
    confirming.current = true;
    try {
      const key = Crypto.randomUUID(), soldAt = new Date().toISOString(), provisional = await nextProvisional();
      const c = selectedCustomer!, platformName = platforms.find(p => p.id === pay)?.name || null;
      const body = {device_id:await deviceId(),session_id: session!.id, customer_id: customer, items: lines.map(l => ({product_id: l.product.id, quantity: quantityForApi(l.milli!), expected_price_cents: l.product.price_cents})), method, platform_id: method === 'electronic' ? pay : null, request_key: key,
        reference: method === 'electronic' ? reference.trim() : undefined, route_id: products.find(p=>p.stock_milli!==null)?.route_id ?? undefined, sold_at: soldAt, offline_ref: provisional, ...(c.pending ? {new_customer: {id: c.id, name: c.name, city: c.city}} : {})};
      // Vista local de la venta: permite imprimir el comprobante y verla en el historial aunque no haya señal.
      const preview: Sale = {id: key, number: 0, session_id: session!.id, session_number: session!.number, seller_id: userId, customer_id: c.id, created_at: soldAt, total_cents: total,
        snapshot: {business_name: settings.business_name, business_nit: settings.business_nit, business_address: settings.business_address, business_phone: settings.business_phone, business_city: settings.business_city, customer_name: c.name, customer_city: c.city, customer_identification:c.identification, seller_name: user.name, offline_ref: provisional},
        items: lines.map(l => ({id: l.product.id, name: l.product.name, unit: l.product.unit, price_cents: l.product.price_cents, quantity_milli: l.milli!, subtotal_cents: l.subtotal})),
        payments: [{method, platform_name: method === 'electronic' ? platformName : null, reference:method === 'electronic'?reference.trim():null, amount_cents: total}]};
      // Primero se guarda en el celular; luego se intenta subir. Si no hay señal, queda en la cola y se sube sola.
      await enqueue({key, provisional, created_at: soldAt, body, sale: preview});
      const change = method === 'cash' && receivedCents !== null ? receivedCents - total : null;
      let sale: Sale;
      try { const result = await api<Sale | SaleAcknowledgement>('/sales', 'POST', body); if ('history_restricted' in result) { await dequeue(key); reset(); await refresh().catch(() => undefined); return; } sale = result; }
      catch (e) {
        // Rechazo con señal (precio cambiado, stock, caja): no se registró; se quita de la cola y se informa.
        if (e instanceof ApiError && e.status > 0 && e.status < 500) { await dequeue(key); void refresh().catch(() => undefined); throw e; }
        setDone({sale: preview, change, offline: true}); reset(); return;
      }
      await dequeue(key);
      setDone({sale, change, offline: false});
      reset(); await refresh().catch(() => undefined);
    } finally { confirming.current = false; }
  }

  if (!ready) return <Page><Loading text="Recuperando ventas pendientes…"/></Page>;

  // ── Venta registrada
  if (done && canDisplaySale(user, done.sale, businessDate, settings.time_zone)) {
    const {sale, change} = done, p = sale.payments?.[0];
    return <Page testID="sale-done">
      <View style={{alignItems: 'center', gap: 8, paddingTop: 12}}>
        <View style={{width: 76, height: 76, borderRadius: 38, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center'}}><Feather name="check" size={40} color="white"/></View>
        <Text style={styles.title}>{done.offline ? '¡Venta guardada!' : '¡Venta registrada!'}</Text>
        <Text style={styles.muted}>Venta {saleTitle(sale)} · {sale.snapshot.customer_name}</Text>
      </View>
      <Card style={{alignItems: 'center', gap: 4}}>
        <Text style={styles.small}>{p?.method==='credit'?'Total a crédito':'Total cobrado'}</Text>
        <Text testID="done-total" style={[styles.metric, {fontSize: 34, color: colors.green}]}>{cop(sale.total_cents)}</Text>
        <Badge text={p?.method === 'cash' ? 'Efectivo' : p?.method === 'credit' ? 'Crédito' : p?.platform_name || 'Electrónico'} tone="gray"/>
        {change !== null && change > 0 && <View style={{marginTop: 8, alignItems: 'center'}}><Text style={styles.small}>Cambio para el cliente</Text><Text style={[styles.metric, {color: colors.orange}]}>{cop(change)}</Text></View>}
      </Card>
      {done.offline && <Banner tone="yellow" title="Sin señal: guardada en el celular" text="Se subirá sola cuando haya internet y recibirá su número consecutivo oficial. Ya puedes imprimir el comprobante."/>}
      {sale.pdf_message && <Banner tone="orange" text={sale.pdf_message}/>}
      <View style={{gap: 10}}>
        <Button title="Nueva venta" icon="plus" size="lg" onPress={() => setDone(null)} testID="sale-new"/>
        <View style={[styles.row, {gap: 10}]}>
          <Button title="Imprimir" icon="printer" variant="secondary" style={{flex: 1}} disabled={busy} onPress={() => run(() => printLocal(sale, paperWidth, 'print'))} testID="sale-print"/>
          <Button title="Compartir" icon="share-2" variant="secondary" style={{flex: 1}} disabled={busy} onPress={() => run(() => printLocal(sale, paperWidth, 'share'))}/>
        </View>
        <Button title="Ver comprobante" icon="file-text" variant="outline" onPress={() => { setDone(null); onViewSale(sale); }} testID="sale-view-receipt"/>
      </View>
    </Page>;
  }

  if (!session) return <Page><Empty icon="lock" title="Tu caja está cerrada" text="Para registrar ventas, primero abre tu caja con el dinero base. Consulta las ventas permitidas en el historial." action="Abrir mi caja" onAction={onOpenCash}/></Page>;

  const footer = view === 'pay'
    ? <FooterBar>
        <View style={{flex: 1, minWidth: 0}}><Text style={styles.small}>{method==='credit'?'Crédito a registrar':'Total a cobrar'}</Text><Text numberOfLines={1} style={[styles.metric, {color: colors.green, fontSize: fitSize(cop(total), 22, 9)}]}>{cop(total)}</Text></View>
        <Button title="Confirmar" icon="check" size="lg" style={{flexShrink: 0, paddingHorizontal: 18}} loading={busy} disabled={!valid} onPress={() => run(confirm)} testID="confirm-sale"/>
      </FooterBar>
    : <FooterBar>
        <Pressable accessibilityRole="button" accessibilityLabel="Ver productos de la venta" onPress={() => setView('cart')} style={{flex: 1, minWidth: 0}}>
          <Text style={styles.small}>{cart.length === 0 ? 'Sin productos' : `${cart.length} ${cart.length === 1 ? 'producto' : 'productos'} · ver`}</Text>
          <Text testID="sale-total" numberOfLines={1} style={[styles.metric, {color: colors.green, fontSize: fitSize(cop(total), 22, 9)}]}>{cop(total)}</Text>
        </Pressable>
        <Button title="Continuar al pago" icon="arrow-right" size="lg" style={{flexShrink: 0, paddingHorizontal: 22}} disabled={!linesOk||session.close_state==='preparing'} onPress={() => setView('pay')} testID="checkout"/>
      </FooterBar>;

  const customerCard = <Card onPress={() => { setPickCustomer(true); setCustomerSearch(''); setNewCustomer(false); }} testID="customer-picker" style={{paddingVertical: 12}}>
    <View style={[styles.row, {justifyContent: 'flex-start'}]}>
      <View style={{width: 38, height: 38, borderRadius: 19, backgroundColor: selectedCustomer ? colors.greenSoft : colors.orangeSoft, alignItems: 'center', justifyContent: 'center'}}><Feather name="user" size={18} color={selectedCustomer ? colors.green : colors.orange}/></View>
      <View style={{flex: 1}}>
        <Text style={styles.small}>Cliente</Text>
        {selectedCustomer ? <Text numberOfLines={1} style={styles.h2}>{selectedCustomer.name} <Text style={[styles.small, {fontWeight: '400'}]}>· {selectedCustomer.city}</Text></Text> : <Text style={[styles.h2, {color: colors.orange}]}>Seleccionar cliente</Text>}
      </View>
      <Text style={styles.link}>{selectedCustomer ? 'Cambiar' : 'Elegir'}</Text>
    </View>
  </Card>;

  return <>
    <Page footer={footer} testID="sale-screen" header={view!=='pay'?<View style={[styles.row,{gap:8}]}><View style={{flex:1}}><SearchBar value={query} onChange={setQuery} placeholder="Buscar producto" testID="product-search"/></View><IconButton icon="refresh-cw" label="Actualizar precios y existencias" onPress={()=>run(refresh,'Precios actualizados')} disabled={busy}/></View>:undefined}>
      {session.close_state==='preparing'&&<Banner tone="yellow" text="La jornada está preparando cierre. Las ventas pendientes se sincronizan y ya no puedes agregar ventas nuevas."/>}
      {view === 'pay' ? <>
        <Pressable accessibilityRole="button" onPress={() => setView('catalog')} style={[styles.row, {justifyContent: 'flex-start', gap: 6}]} hitSlop={8}><Feather name="arrow-left" size={18} color={colors.green}/><Text style={styles.link}>Seguir agregando productos</Text></Pressable>
        <Text accessibilityRole="header" style={styles.title}>Cobrar</Text>
        {customerCard}
        {!customer && <Text style={[styles.small, {color: colors.orange, marginTop: -8}]}>Elige el cliente para poder confirmar.</Text>}
        <Card>
          <View style={styles.row}><Text style={styles.sectionTitle}>Resumen</Text><Pressable onPress={() => setView('cart')} hitSlop={8}><Text style={styles.link}>Editar</Text></Pressable></View>
          {lines.map(l => <View key={l.product.id} style={[styles.row, {alignItems: 'flex-start'}]}>
            <View style={{flex: 1}}><Text style={{color: colors.ink, fontWeight: '600', fontSize: 15}}>{l.product.name}</Text><Text style={styles.small}>{l.milli ? quantityLabel(l.milli, l.product.unit) : '—'} × {cop(l.product.price_cents)}{l.product.unit === 'kg' ? '/kg' : ''}</Text></View>
            <Text style={[styles.money, {fontSize: 15}]}>{cop(l.subtotal)}</Text>
          </View>)}
          <View style={styles.divider}/>
          <View style={styles.row}><Text style={styles.h2}>Total</Text><Text style={[styles.metric, {color: colors.green}]}>{cop(total)}</Text></View>
        </Card>
        <Card>
          <Text style={styles.sectionTitle}>Método de pago</Text>
          <View style={[styles.wrap, {gap: 10}]}>
            {[{id: 'cash', name: 'Efectivo', icon: 'dollar-sign' as const}, {id:'credit',name:'Crédito',icon:'clock' as const}, ...platforms.filter(p => p.active).map(p => ({id: p.id, name: p.name, icon: 'smartphone' as const}))].map(m => {
              const on = pay === m.id;
              return <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={m.name} accessibilityState={{checked: on}} onPress={() => setPay(m.id)}
                style={[{flexGrow: 1, flexBasis: '45%', minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderColor: on ? colors.green : colors.lineStrong, backgroundColor: on ? colors.greenSoft : colors.white, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12}]}>
                <Feather name={on ? 'check-circle' : m.icon} size={18} color={on ? colors.green : colors.muted}/><Text numberOfLines={2} style={{flex: 1, fontWeight: '700', color: colors.ink, fontSize: 14}}>{m.name}</Text>
              </Pressable>;
            })}
          </View>
          {method === 'cash' && <View style={{gap: 10}}>
            <Field label="¿Con cuánto paga? (opcional)" kind="decimal" prefix="$" value={received} onChange={setReceived} placeholder={cop(total).replace('$', '').trim()} error={receivedError} testID="cash-received"/>
            <Choice items={cashSuggestions(total).map(v => ({id: String(v), name: v === total ? 'Exacto' : cop(v)}))} value={receivedCents !== null ? String(receivedCents) : ''} onChange={v => setReceived(String(Number(v) / 100))}/>
            {receivedCents !== null && !receivedError && <Card tone={receivedCents > total ? 'yellow' : 'green'} style={{paddingVertical: 12}}><View style={styles.row}><Text style={[styles.h2, {fontSize: 15}]}>Cambio a entregar</Text><Text testID="cash-change" style={[styles.metric, {color: colors.ink}]}>{cop(receivedCents - total)}</Text></View></Card>}
          </View>}
          {method === 'electronic' && <Field label="Número de referencia" kind="plain" value={reference} onChange={setReference} placeholder="Ej. 000ABC123" testID="electronic-reference"/>}
          {method === 'credit' && <Banner tone="yellow" text="Esta venta queda pendiente en la cartera del cliente seleccionado. No ingresa dinero a caja."/>}
          {method === 'electronic' && <Text style={styles.small}>Verifica que el pago aparezca en la cuenta antes de confirmar.</Text>}
        </Card>
        <Text style={[styles.small, {textAlign: 'center'}]}>Con señal, el sistema verifica precios, existencias y caja al confirmar. Sin señal, la venta queda guardada en el celular y se sube sola.</Text>
      </> : <>
        {products.some(p=>p.stock_milli!==null&&!p.route_id)&&<Banner tone="yellow" text="Para vender productos con inventario, el administrador debe asignarte una ruta y distribuir sus existencias."/>}
        {customerCard}
        <Segmented items={[{id: 'catalog', name: 'Productos'}, {id: 'cart', name: `En la venta${cart.length ? ` (${cart.length})` : ''}`}]} value={view} onChange={v => setView(v as SaleView)} testID="sale-tabs"/>
        <View style={{flexDirection:wide?'row':'column',gap:16,alignItems:wide?'flex-start':'stretch'}}>
        {(wide||view==='catalog')&&<View style={{flex:wide?1:undefined,minWidth:0,gap:8}}>
          <Text style={styles.h2}>Resultados de productos</Text>
          {search.offline&&<Text style={styles.small}>Buscando en el catálogo guardado en este equipo.</Text>}
          {search.loading&&<Text style={styles.small}>Buscando productos…</Text>}
          {search.error&&<><Banner text={search.error}/><Button title="Reintentar búsqueda" onPress={search.reload}/></>}
          {!search.loading&&!search.error&&visible.length === 0 && <Empty icon="search" title={products.length ? 'Sin resultados' : 'Aún no hay productos'} text={products.length ? `No encontramos “${query}”. Revisa la escritura.` : 'Un administrador debe crear productos en Catálogo.'}/>}
          <View style={{gap: 8}}>
            {visible.map(p => {
              const line = inCart(p.id), out = p.stock_milli === 0 || p.stock_milli!==null&&!p.route_id;
              return <Pressable key={p.id} testID={`product-${p.name}`} accessibilityRole="button" accessibilityLabel={`${p.name}, ${cop(p.price_cents)} por ${p.unit === 'kg' ? 'kilogramo' : 'unidad'}`} disabled={out} onPress={() => openQuantity(p)}
                style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 14, borderWidth: line ? 1.5 : 1, borderColor: line ? colors.green : colors.line, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, minHeight: 64}, pressed && {backgroundColor: '#F7FAF7'}, out && {opacity: 0.55}]}>
                <View style={{flex: 1, gap: 3}}>
                  <Text numberOfLines={3} style={{fontSize: 15, fontWeight: "700", color: colors.ink}}>{p.name}</Text>
                  <View style={[styles.row, {justifyContent: 'flex-start', gap: 6, flexWrap: 'wrap'}]}>
                    <Text style={[styles.money, {fontSize: 14, color: colors.greenDark}]}>{cop(p.price_cents)}<Text style={styles.small}>/{p.unit === 'kg' ? 'kg' : 'und'}</Text></Text>
                    {p.stock_milli !== null && <Text style={[styles.small, {color: out ? colors.red : p.stock_milli <= (p.unit === 'kg' ? 2000 : 5000) ? colors.orange : colors.muted}]}>{out ? (!p.route_id&&p.stock_milli!==null?'Sin ruta asignada':'Agotado') : `Quedan ${quantityLabel(p.stock_milli, p.unit)}`}</Text>}
                  </View>
                  {line && <Badge text={`En la venta: ${line.milli ? quantityLabel(line.milli, p.unit) : line.quantity}`} icon="check"/>}
                </View>
                <IconButton icon={p.unit === 'kg' ? 'edit-3' : 'plus'} label={`Agregar ${p.name}`} tone="solid" size={46} disabled={out} onPress={() => quickAdd(p)} testID={`add-${p.name}`}/>
              </Pressable>;
            })}
          </View>
          {search.hasMore&&<Button title="Ver más productos" variant="outline" disabled={search.loading} onPress={search.next}/>}
        </View>}
        {(wide||view==='cart')&&<View style={{flex:wide?1:undefined,minWidth:0,gap:8}}>
          <Text style={styles.h2}>Productos de la venta</Text>
          {lines.length === 0 && <Empty icon="shopping-cart" title="La venta está vacía" text="Busca un producto y tócalo para agregarlo." action="Ver productos" onAction={() => setView('catalog')}/>}
          {lines.map(l => <Card key={l.product.id} style={{gap: 10, paddingVertical: 12}}>
            <View style={[styles.row, {alignItems: 'flex-start'}]}>
              <View style={{flex: 1}}><Text style={{fontSize: 15, fontWeight: '700', color: colors.ink}}>{l.product.name}</Text><Text style={styles.small}>{cop(l.product.price_cents)} / {l.product.unit === 'kg' ? 'kg' : 'unidad'}</Text></View>
              <IconButton icon="trash-2" label={`Quitar ${l.product.name}`} tone="red" size={38} onPress={() => remove(l.product.id)}/>
            </View>
            <View style={[styles.row, {flexWrap: 'wrap'}]}>
              <Stepper label={l.product.unit === 'kg' ? `Kilos de ${l.product.name}` : `Unidades de ${l.product.name}`} value={l.quantity} unit={unitLabel(l.product.unit)} onChange={q => setLine(l.product, q)} onStep={d => step(l, d)} testID={`qty-${l.product.name}`}/>
              <Text style={[styles.money, {fontSize: 17}]}>{cop(l.subtotal)}</Text>
            </View>
            {l.milli === null && <Text style={styles.fieldError}>{l.product.unit === 'kg' ? 'Escribe el peso, por ejemplo 0,25 o 1,5' : 'Escribe una cantidad entera mayor a cero'}</Text>}
            {l.short && <Text style={styles.fieldError}>{!l.product.route_id?'Asigna una ruta antes de vender este producto.':'Solo hay '} {l.product.route_id?quantityLabel(l.product.stock_milli!, l.product.unit)+' disponibles':''}</Text>}
          </Card>)}
          {lines.length > 0 && <Button title="Vaciar venta" icon="x" variant="ghost" onPress={() => setCart([])} style={{alignSelf: 'center'}}/>}
        </View>}
        </View>
      </>}
    </Page>

    <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.name || ''} subtitle={editing ? `${cop(editing.price_cents)} por ${editing.unit === 'kg' ? 'kilogramo' : 'unidad'}` : ''}
      footer={editing && <>
        <Button title={`${inCart(editing.id) ? 'Actualizar' : 'Agregar'} · ${cop(editMilli ? lineSubtotal(editing.price_cents, editMilli) : 0)}`} icon="check" size="lg" disabled={editMilli === null || !!editShort} onPress={saveQuantity} testID="quantity-save"/>
        {inCart(editing.id) && <Button title="Quitar de la venta" variant="ghost" onPress={() => { remove(editing.id); setEditing(null); }}/>}
      </>}>
      {editing && <>
        <Field label={editing.unit === 'kg' ? 'Peso en kilogramos' : 'Cantidad en unidades'} kind={editing.unit === 'kg' ? 'decimal' : 'number'} value={qtyText} onChange={setQtyText} autoFocus large onSubmit={saveQuantity} placeholder={editing.unit === 'kg' ? '0,25' : '1'} testID="quantity-input"
          error={qtyText && editMilli === null ? (editing.unit === 'kg' ? 'Usa coma o punto para decimales: 0,25 · 1,5 · 125,5' : 'Solo números enteros') : editShort ? `Solo hay ${quantityLabel(editing.stock_milli!, editing.unit)} disponibles` : null}
          hint={editing.unit === 'kg' ? 'Ejemplos: 0,25 = media libra · 0,5 = una libra · 1,75 = kilo y tres cuartos' : undefined} right={<Text style={[styles.h2, {color: colors.muted}]}>{unitLabel(editing.unit)}</Text>}/>
        <Choice items={(editing.unit === 'kg' ? KG_PRESETS : UNIT_PRESETS).map(v => ({id: v, name: `${v} ${unitLabel(editing.unit)}`}))} value={qtyText} onChange={setQtyText}/>
      </>}
    </Sheet>

    <Sheet visible={pickCustomer} onClose={() => setPickCustomer(false)} title={newCustomer ? 'Nuevo cliente' : 'Elegir cliente'} subtitle={newCustomer ? 'Se guarda y queda seleccionado en esta venta' : undefined}
      footer={newCustomer ? <>
        <Button title="Crear y seleccionar" icon="user-plus" size="lg" disabled={busy || !name.trim() || !city.trim()} loading={busy} testID="customer-create"
          onPress={() => run(async () => {
            let c: Customer;
            try { c = await api<Customer>('/customers', 'POST', {name: name.trim(), city: city.trim()}); await refresh(); }
            catch (e) {
              if (!(e instanceof ApiError && e.status === 0)) throw e;
              // Sin señal: el cliente queda en el celular y se crea en el sistema junto con la venta.
              c = {id: Crypto.randomUUID(), name: name.trim(), city: city.trim(), pending: true}; onLocalCustomer(c);
            }
            setCustomer(c.id); setNewCustomer(false); setPickCustomer(false); setName(''); setCity('');
          }, 'Cliente guardado')}/>
        <Button title="Volver a la lista" variant="ghost" onPress={() => setNewCustomer(false)}/>
      </> : <Button title="Crear cliente nuevo" icon="user-plus" variant="secondary" onPress={() => { setNewCustomer(true); setName(customerSearch.trim()); }} testID="customer-new"/>}>
      {newCustomer ? <>
        <Field label="Nombre del cliente" kind="name" value={name} onChange={setName} autoFocus placeholder="Ej. Manuel Rodríguez"/>
        <Field label="Ciudad o municipio" kind="name" value={city} onChange={setCity} placeholder="Ej. El Rosal"/>
      </> : <>
        <SearchBar value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar por nombre o ciudad" testID="customer-search"/>
        {customerMatches.length === 0 && <Text style={[styles.muted, {textAlign: 'center', paddingVertical: 12}]}>{customers.length ? 'Ningún cliente coincide. Créalo con el botón de abajo.' : 'Todavía no hay clientes. Crea el primero.'}</Text>}
        <View>{customerMatches.map(c => <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.city}${customers.filter(x=>x.name===c.name&&x.city===c.city).length>1?' · Cuenta '+c.id.slice(0,8):''}`} onPress={() => { setCustomer(c.id); setPickCustomer(false); }}
          style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 56}, pressed && {backgroundColor: colors.greenSoft}]}>
          <View style={{width: 36, height: 36, borderRadius: 18, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}><Text style={{fontWeight: '800', color: colors.green}}>{c.name[0]?.toUpperCase()}</Text></View>
          <View style={{flex: 1}}><Text style={{fontSize: 15, fontWeight: '700', color: colors.ink}}>{c.name}</Text><Text style={styles.small}>{c.city}{customers.filter(x=>x.name===c.name&&x.city===c.city).length>1?' · Cuenta '+c.id.slice(0,8):''}</Text></View>
          {c.id === customer && <Feather name="check-circle" size={20} color={colors.green}/>}
        </Pressable>)}</View>
      </>}
    </Sheet>
  </>;
}
/** Billetes con los que suele pagar el cliente: exacto y redondeos hacia arriba. */
function cashSuggestions(total: number) {
  if (total <= 0) return [];
  const values = new Set([total]);
  for (const step of [100000, 500000, 1000000, 2000000, 5000000, 10000000]) { const v = Math.ceil(total / step) * step; if (v > total) values.add(v); }
  return [...values].sort((a, b) => a - b).slice(0, 4);
}
