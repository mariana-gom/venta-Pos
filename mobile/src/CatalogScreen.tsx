import React, {useMemo, useState} from 'react';
import {Pressable, Switch, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import {api,uploadExcel,downloadFile} from './api';
import {Badge, Button, Choice, Confirm, Empty, Field, Header, Page, SearchBar, Segmented, Sheet, colors, cop, moneyInput, moneyToCents, normalizeMoney, normalizeSearch, parseQuantity, quantityForApi, quantityLabel, quantityText, styles} from './ui';
import type {Product, Customer, User, ImportPreview} from './types';
import type {Run} from '../App';
type Props = {products: Product[]; customers: Customer[]; user: User; run: Run; refresh: () => Promise<void>; busy: boolean; initialTab?: 'products' | 'customers'};
const PAGE = 40;

export function CatalogScreen({products, customers, user, run, refresh, busy, initialTab}: Props) {
  const admin = user.role === 'admin';
  const [tab, setTab] = useState<'products' | 'customers'>(initialTab || (admin ? 'products' : 'customers')), [query, setQuery] = useState(''), [status, setStatus] = useState('active'), [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(''), [price, setPrice] = useState(''), [unit, setUnit] = useState<'unit' | 'kg'>('unit'), [active, setActive] = useState(true), [tracks, setTracks] = useState(false), [stock, setStock] = useState(''), [city, setCity] = useState('');
  const [identification,setIdentification]=useState(''),[code,setCode]=useState(''),[category,setCategory]=useState(''),[brand,setBrand]=useState(''),[wholesale,setWholesale]=useState(''),[stockReason,setStockReason]=useState('');
  const [importPreview,setImportPreview]=useState<ImportPreview|null>(null),[importKey,setImportKey]=useState(''),[reviewedZero,setReviewedZero]=useState<number[]>([]),[confirmImport,setConfirmImport]=useState(false),[importResult,setImportResult]=useState<{id:string;summary:{created:number;updated:number;omitted:number}}|null>(null);
  async function chooseExcel(){const result=await DocumentPicker.getDocumentAsync({type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',copyToCacheDirectory:true});if(result.canceled)return;setImportResult(null);setReviewedZero([]);setImportPreview(await uploadExcel(result.assets[0].uri));setImportKey(Crypto.randomUUID());}
  const [deactivate, setDeactivate] = useState<{id: string; name: string} | null>(null);
  const isProducts = tab === 'products';

  function open(item: Product | Customer | null) {
    setEditing(item ? item.id : 'new'); setName(item?.name || '');setStockReason('');setIdentification(item&&'city' in item?item.identification||'':'');
    if (item && 'price_cents' in item) { setCode(item.code||'');setCategory(item.category||'');setBrand(item.brand||'');setWholesale(item.wholesale_price_cents==null?'':moneyInput(item.wholesale_price_cents));setPrice(item.price_cents==null?'':moneyInput(item.price_cents)); setUnit(item.unit||'unit'); setActive(!!item.active); setTracks(item.stock_milli !== null); setStock(item.stock_milli === null ? '' : quantityText(item.stock_milli)); }
    else {setCode('');setCategory('');setBrand('');setWholesale(''); setPrice(''); setUnit('unit'); setActive(true); setTracks(false); setStock(''); setCity(item && 'city' in item ? item.city : ''); }
  }
  const priceCents = moneyToCents(price);
  // Existencias: 0 es válido (agotado); vacío con control activo no lo es.
  const stockMilli = stock.trim() === '0' ? 0 : parseQuantity(stock, unit);
  const errors = isProducts
    ? {price: price && (priceCents === null || priceCents <= 0) ? 'Escribe un precio válido, por ejemplo 12.000' : null, stock: tracks && stock && stockMilli === null ? (unit === 'unit' ? 'Solo unidades enteras' : 'Usa coma para decimales: 12,5') : null}
    : {price: null, stock: null};
  const canSave = isProducts ? !!name.trim() && priceCents !== null && priceCents > 0 && (!tracks || stockMilli !== null) : !!name.trim() && !!city.trim();
  async function save() {
    const body = isProducts ? {name: name.trim(), price: normalizeMoney(price), unit, active, stock: tracks ? quantityForApi(stockMilli!) : null,code:code.trim()||null,category:category.trim(),brand:brand.trim(),wholesale_price:wholesale.trim()?normalizeMoney(wholesale):null,reason:stockReason.trim()||undefined} : {name: name.trim(), city: city.trim(),identification:identification.trim()};
    await api(`/${tab}${editing && editing !== 'new' ? '/' + editing : ''}`, editing === 'new' ? 'POST' : 'PUT', body);
    setEditing(null); await refresh();
  }

  const list = useMemo(() => {
    const q = normalizeSearch(query);
    if (isProducts) return products.filter(p => (status === 'all' || (status === 'active' ? !!p.active : !p.active)) && (!q || normalizeSearch(p.name).includes(q)));
    return customers.filter(c => !q || normalizeSearch(c.name).includes(q) || normalizeSearch(c.city).includes(q) || (c.identification||'').includes(q));
  }, [products, customers, query, status, isProducts]);
  const canCreate = admin || !isProducts;

  return <Page onRefresh={() => run(refresh)}>
    <Header eyebrow="TU NEGOCIO" title="Catálogo"/>
    <Segmented items={[{id: 'products', name: `Productos (${products.filter(p => p.active).length})`}, {id: 'customers', name: `Clientes (${customers.length})`}]} value={tab} onChange={v => { setTab(v as typeof tab); setQuery(''); setLimit(PAGE); }} testID="catalog-tabs"/>
    <View style={[styles.row, {gap: 8}]}>
      <View style={{flex: 1}}><SearchBar value={query} onChange={t => { setQuery(t); setLimit(PAGE); }} placeholder={isProducts ? 'Buscar producto' : 'Buscar cliente o ciudad'}/></View>
      {canCreate && <Button title="Nuevo" icon="plus" onPress={() => open(null)} testID="catalog-new" style={{paddingHorizontal: 14}}/>}
    </View>
    {isProducts && admin && <Button title="Importar Excel" icon="upload" variant="secondary" disabled={busy} onPress={()=>run(chooseExcel)} testID="import-excel"/>}
    {importResult && <Text style={styles.body}>Importación: {importResult.summary.created} borradores, {importResult.summary.updated} precios actualizados, {importResult.summary.omitted} filas omitidas.</Text>}
    {importResult && <Button title="Descargar resumen" icon="download" variant="outline" onPress={()=>run(()=>downloadFile('/products/import/'+importResult.id+'/result','resultado-importacion.csv','text/csv'))}/>}
    {isProducts && admin && <Choice items={[{id: 'active', name: 'Disponibles'}, {id: 'inactive', name: 'Inactivos'}, {id: 'all', name: 'Todos'}]} value={status} onChange={setStatus}/>}
    {list.length === 0 && <Empty icon={isProducts ? 'package' : 'users'} title={query ? 'Sin resultados' : isProducts ? 'Aún no hay productos' : 'Aún no hay clientes'}
      text={query ? `No encontramos “${query}”.` : isProducts ? (admin ? 'Crea tu primer producto con el botón Nuevo.' : 'Un administrador debe crear los productos.') : 'Crea clientes aquí o directamente desde una venta.'}
      action={!query && canCreate ? (isProducts ? 'Crear producto' : 'Crear cliente') : undefined} onAction={() => open(null)}/>}
    <View style={{gap: 8}}>
      {list.slice(0, limit).map(item => {
        const p = 'price_cents' in item ? item : null;
        const editable = admin;
        return <Pressable key={item.id} testID={`catalog-${item.name}`} accessibilityRole={editable ? 'button' : undefined} accessibilityLabel={editable ? `Editar ${item.name}` : item.name} disabled={!editable} onPress={() => open(item)}
          style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, paddingHorizontal: 14, minHeight: 62}, pressed && {backgroundColor: '#F7FAF7'}, p && !p.active && {opacity: 0.6}]}>
          <View style={{width: 40, height: 40, borderRadius: 12, backgroundColor: p ? (p.unit === 'kg' ? colors.yellowSoft : colors.greenSoft) : colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}>
            {p ? <Text style={{fontSize: 12, fontWeight: '900', color: p.unit === 'kg' ? '#7A5600' : colors.greenDark}}>{p.unit === 'kg' ? 'KG' : 'UND'}</Text> : <Text style={{fontSize: 16, fontWeight: '800', color: colors.green}}>{item.name[0]?.toUpperCase()}</Text>}
          </View>
          <View style={{flex: 1, gap: 3}}>
            <Text numberOfLines={2} style={{fontSize: 15, fontWeight: '700', color: colors.ink}}>{item.name}</Text>
            {p ? <View style={[styles.row, {justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap'}]}>
              <Text style={[styles.money, {fontSize: 14, color: colors.greenDark}]}>{p.price_cents===null?'Precio normal pendiente':cop(p.price_cents)}<Text style={styles.small}>/{p.unit === 'kg' ? 'kg' : 'und'}</Text></Text>
              <Text style={[styles.small, p.stock_milli === 0 && {color: colors.red, fontWeight: '700'}]}>{p.stock_milli === null ? 'Sin control de stock' : p.stock_milli === 0 ? 'Agotado' : `Stock: ${quantityLabel(p.stock_milli, p.unit||'unit')}`}</Text>
              {!p.active && <Badge text="Inactivo" tone="gray"/>}
            </View> : <Text style={styles.small}><Feather name="map-pin" size={12}/> {(item as Customer).city}</Text>}
          </View>
          {editable && <Feather name="chevron-right" size={20} color={colors.muted}/>}
        </Pressable>;
      })}
    </View>
    {list.length > limit && <Button title={`Ver más (${list.length - limit})`} variant="outline" onPress={() => setLimit(limit + PAGE)}/>}
    {!admin && isProducts && <Text style={[styles.small, {textAlign: 'center'}]}>Solo un administrador puede crear o editar productos.</Text>}

    <Sheet visible={!!editing} onClose={() => setEditing(null)} title={`${editing === 'new' ? 'Nuevo' : 'Editar'} ${isProducts ? 'producto' : 'cliente'}`}
      footer={<>
        <Button title="Guardar" icon="check" size="lg" disabled={busy || !canSave} loading={busy} onPress={() => run(save, isProducts ? 'Producto guardado' : 'Cliente guardado')} testID="catalog-save"/>
        {admin && editing && editing !== 'new' && (!isProducts || active) && <Button title={`Desactivar ${isProducts ? 'producto' : 'cliente'}`} icon="slash" variant="ghost" onPress={() => { setDeactivate({id: editing, name}); setEditing(null); }}/>}
      </>}>
      <Field label="Nombre" kind={isProducts ? 'text' : 'name'} value={name} onChange={setName} placeholder={isProducts ? 'Ej. Pechuga de pollo' : 'Ej. Manuel Rodríguez'} autoFocus={editing === 'new'} testID="catalog-name"/>
      {isProducts ? <>
        <View style={{gap: 6}}><Text style={styles.label}>¿Cómo se vende?</Text>
          <Segmented items={[{id: 'unit', name: 'Por unidad'}, {id: 'kg', name: 'Por kilogramo'}]} value={unit} onChange={v => setUnit(v as 'unit' | 'kg')}/>
          {editing !== 'new' && <Text style={styles.hint}>Si el producto tiene ventas o movimientos de inventario, conserva su unidad. Para cambiarla, crea otro producto.</Text>}
        </View>
        <Field label="Código único" kind="plain" value={code} onChange={setCode} hint="Conserva los ceros iniciales"/>
        <Field label="Categoría" value={category} onChange={setCategory}/>
        <Field label="Marca" value={brand} onChange={setBrand}/>
        <Field label="Precio mayorista (opcional)" kind="decimal" prefix="$" value={wholesale} onChange={setWholesale}/>
        <Field label={unit === 'kg' ? 'Precio por kilogramo' : 'Precio por unidad'} kind="decimal" prefix="$" value={price} onChange={setPrice} placeholder="0" error={errors.price} hint={priceCents ? `${cop(priceCents)} por ${unit === 'kg' ? 'kg' : 'unidad'}` : undefined} testID="catalog-price"/>
        <View style={[styles.row, {paddingVertical: 4}]}>
          <View style={{flex: 1}}><Text style={styles.label}>Controlar existencias</Text><Text style={styles.hint}>Descuenta automáticamente con cada venta.</Text></View>
          <Switch accessibilityLabel="Controlar existencias" value={tracks} onValueChange={setTracks} trackColor={{true: colors.green, false: colors.lineStrong}} thumbColor={colors.white}/>
        </View>
        {tracks && <Field label={`Existencias en ${unit === 'kg' ? 'kilogramos' : 'unidades'}`} kind={unit === 'kg' ? 'decimal' : 'number'} value={stock} onChange={setStock} placeholder="0" error={errors.stock} testID="catalog-stock" hint="Total global. El cambio afecta el saldo sin asignar; distribuye por ruta desde Rutas e inventario."/>}
        {editing!=='new' && <Field label="Motivo del ajuste de existencias" value={stockReason} onChange={setStockReason}/>}
        <View style={[styles.row, {paddingVertical: 4}]}>
          <View style={{flex: 1}}><Text style={styles.label}>Disponible para la venta</Text><Text style={styles.hint}>Los inactivos no aparecen en Vender; su historial se conserva.</Text></View>
          <Switch accessibilityLabel="Disponible para la venta" value={active} onValueChange={setActive} trackColor={{true: colors.green, false: colors.lineStrong}} thumbColor={colors.white}/>
        </View>
      </> : <><Field label="Identificación del cliente" kind="plain" value={identification} onChange={setIdentification} hint="Obligatoria para vender a crédito"/><Field label="Ciudad o municipio" kind="name" value={city} onChange={setCity} placeholder="Ej. El Rosal" testID="catalog-city"/></>}
    </Sheet>
    <Sheet visible={!!importPreview} onClose={()=>setImportPreview(null)} title="Vista previa de importación" subtitle={importPreview?importPreview.summary.new+' nuevos · '+importPreview.summary.updates+' actualizaciones · '+importPreview.summary.omitted+' omitidos':''} footer={<Button title="Revisar y confirmar importación" disabled={busy} onPress={()=>setConfirmImport(true)}/>}>
      <Text style={styles.body}>Solo se importa el precio mayorista. Los nuevos productos quedan inactivos hasta completar precio normal y unidad. Las existencias se conservan.</Text>
      {importPreview?.rows.map(r=><View key={r.row} style={{gap:4,paddingVertical:8,borderBottomWidth:1,borderBottomColor:colors.line}}>
        <Text style={styles.h2}>Fila {r.row} · {r.code||'Sin código'} · {r.name}</Text>
        <Text style={styles.small}>{r.action==='update'?'Actualizar precio':r.action==='create'?'Nuevo borrador':'Omitir'} · {r.previous_price_cents==null?'Sin precio mayorista':cop(r.previous_price_cents)} → {r.new_price_cents==null?'Inválido':cop(r.new_price_cents)}</Text>
        {r.errors.map(e=><Text key={e} style={styles.fieldError}>{e}</Text>)}
        {r.warnings.map(w=><Text key={w} style={styles.small}>{w}</Text>)}
        {!r.errors.length&&r.new_price_cents===0&&<Choice items={[{id:'no',name:'Omitir cero'},{id:'yes',name:'He revisado el cero'}]} value={reviewedZero.includes(r.row)?'yes':'no'} onChange={v=>setReviewedZero(list=>v==='yes'?[...list,r.row]:list.filter(n=>n!==r.row))}/>}
      </View>)}
    </Sheet>
    <Confirm visible={confirmImport} title="¿Aplicar la vista previa?" message="Se actualizará únicamente el precio mayorista de las filas válidas y se crearán los borradores nuevos. Las filas con errores se omiten." confirmText="Confirmar importación" busy={busy} onCancel={()=>setConfirmImport(false)} onConfirm={()=>run(async()=>{const result=await api<{id:string;summary:{created:number;updated:number;omitted:number}}>('/products/import/apply','POST',{preview_id:importPreview!.id,request_key:importKey,reviewed_zero_rows:reviewedZero});setImportResult(result);setConfirmImport(false);setImportPreview(null);await refresh();})}/>
    <Confirm visible={!!deactivate} title={`¿Desactivar “${deactivate?.name}”?`} message={isProducts ? 'Dejará de aparecer en Vender. Las ventas anteriores no cambian y puedes reactivarlo después.' : 'Dejará de aparecer en la lista de clientes. Las ventas anteriores conservan su nombre.'}
      confirmText="Desactivar" danger busy={busy} onCancel={() => setDeactivate(null)}
      onConfirm={() => run(async () => { await api(`/${tab}/${deactivate!.id}`, 'DELETE'); setDeactivate(null); setEditing(null); await refresh(); }, 'Desactivado; historial conservado')}/>
  </Page>;
}
