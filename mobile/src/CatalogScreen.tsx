import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, Switch, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Crypto from 'expo-crypto';
import {api,uploadExcel,downloadFile} from './api';
import {Badge, Button, Card, Choice, Confirm, Empty, Field, Header, Page, SearchBar, Segmented, Sheet, colors, cop, moneyInput, moneyToCents, normalizeMoney, normalizeSearch, parseQuantity, quantityForApi, quantityLabel, quantityText, styles} from './ui';
import type {Product, Customer, User, ImportPreview} from './types';
import type {Run} from '../App';
type Props = {products: Product[]; customers: Customer[]; user: User; run: Run; refresh: () => Promise<void>; busy: boolean; initialTab?: 'products' | 'customers'};
const PAGE = 40;

export function CatalogScreen({products, customers, user, run, refresh, busy, initialTab}: Props) {
  const admin = user.role === 'admin';
  const [tab, setTab] = useState<'products' | 'customers'>(initialTab || (admin ? 'products' : 'customers')), [query, setQuery] = useState(''), [status, setStatus] = useState('active'), [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(''), [price, setPrice] = useState(''), [unit, setUnit] = useState<'unit' | 'kg'>('unit'), [active, setActive] = useState(true), [city, setCity] = useState('');
  const [importUnits,setImportUnits]=useState<Record<number,'unit'|'kg'>>({}),[selectedRows,setSelectedRows]=useState<number[]>([]);
  const [priceReviews,setPriceReviews]=useState<{id:string;name:string;price_cents:number|null;wholesale_price_cents:number|null}[]>([]),[reviewPrices,setReviewPrices]=useState(false),[chosenPrices,setChosenPrices]=useState<Record<string,string>>({}),[priceKey,setPriceKey]=useState(''),[confirmPrices,setConfirmPrices]=useState(false);
  async function loadPrices(){if(admin)setPriceReviews(await api('/products/price-migration'));}
  useEffect(()=>{if(admin)run(loadPrices);},[]);
  const [importPreview,setImportPreview]=useState<ImportPreview|null>(null),[importKey,setImportKey]=useState(''),[confirmImport,setConfirmImport]=useState(false),[importResult,setImportResult]=useState<{id:string;summary:{created:number;updated:number;omitted:number}}|null>(null);
  async function chooseExcel(){const result=await DocumentPicker.getDocumentAsync({type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',copyToCacheDirectory:true});if(result.canceled)return;setImportResult(null);setImportUnits({});setSelectedRows([]);setImportPreview(await uploadExcel(result.assets[0].uri));setImportKey(Crypto.randomUUID());}
  const [deactivate, setDeactivate] = useState<{id: string; name: string} | null>(null);
  const isProducts = tab === 'products';

  function open(item: Product | Customer | null) {
    setEditing(item ? item.id : 'new');setName(item?.name||'');
    if(item&&'price_cents' in item){setPrice(item.price_cents===null?'':moneyInput(item.price_cents));setUnit(item.unit||'unit');setActive(!!item.active);}
    else{setPrice('');setUnit('unit');setActive(true);setCity(item&&'city' in item?item.city:'');}
  }
  const priceCents=moneyToCents(price);
  const errors={price:price&&(priceCents===null||priceCents<=0)?'Escribe un precio mayor a cero':null};
  const canSave=isProducts?!!name.trim()&&priceCents!==null&&priceCents>0:!!name.trim()&&!!city.trim();
  async function save(){
    const body=isProducts?{name:name.trim(),price:normalizeMoney(price),unit,active}:{name:name.trim(),city:city.trim()};
    await api(`/${tab}${editing&&editing!=='new'?'/'+editing:''}`,editing==='new'?'POST':'PUT',body);
    setEditing(null);await refresh();await loadPrices();
  }
  const incompleteUnits=importPreview?.rows.some(r=>!r.errors.length&&!r.unit&&!importUnits[r.row]);
  const list = useMemo(() => {
    const q = normalizeSearch(query);
    if (isProducts) return products.filter(p => (status === 'all' || (status === 'active' ? !!p.active : !p.active)) && (!q || normalizeSearch(p.name).includes(q))).sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
    return customers.filter(c => !q || normalizeSearch(c.name).includes(q) || normalizeSearch(c.city).includes(q) || (c.identification||'').includes(q));
  }, [products, customers, query, status, isProducts]);
  const canCreate = admin || !isProducts;

  return <Page onRefresh={() => run(refresh)}>
    <Header eyebrow="TU NEGOCIO" title="Catálogo"/>
    <Segmented items={[{id: 'products', name: `Productos (${products.filter(p => p.active).length})`}, {id: 'customers', name: `Clientes (${customers.length})`}]} value={tab} onChange={v => { setTab(v as typeof tab); setQuery(''); setLimit(PAGE); }} testID="catalog-tabs"/>
    <View style={[styles.row, {gap: 8}]}>
      <View style={{flex: 1}}><SearchBar value={query} onChange={t => { setQuery(t); setLimit(PAGE); }} placeholder={isProducts ? 'Buscar producto' : 'Buscar cliente o ciudad'} testID="catalog-search"/></View>
      {canCreate && <Button title="Nuevo" icon="plus" onPress={() => open(null)} testID="catalog-new" style={{paddingHorizontal: 14}}/>}
    </View>
    {isProducts && admin && <Button title="Importar Excel" icon="upload" variant="secondary" disabled={busy} onPress={()=>run(chooseExcel)} testID="import-excel"/>}
    {isProducts&&admin&&priceReviews.length>0&&<Button title={`Revisar precio único (${priceReviews.length})`} variant="outline" onPress={()=>{setChosenPrices(Object.fromEntries(priceReviews.map(p=>[p.id,moneyInput(p.wholesale_price_cents&&p.wholesale_price_cents>0?p.wholesale_price_cents:p.price_cents||0)])));setPriceKey(Crypto.randomUUID());setReviewPrices(true);}}/>}
    {importResult && <Text style={styles.body}>Importación: {importResult.summary.created} productos nuevos, {importResult.summary.updated} precios actualizados, {importResult.summary.omitted} filas omitidas.</Text>}
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
              <Text style={[styles.money, {fontSize: 14, color: colors.greenDark}]}>{p.price_cents===null?'Precio pendiente':cop(p.price_cents)}<Text style={styles.small}>/{p.unit === 'kg' ? 'kg' : 'und'}</Text></Text>
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
        {priceReviews.find(p=>p.id===editing)&&<Text style={styles.body}>Precio anterior: {cop(priceReviews.find(p=>p.id===editing)!.price_cents||0)} · Precio adicional anterior: {cop(priceReviews.find(p=>p.id===editing)!.wholesale_price_cents||0)}. Al guardar, el precio indicado abajo será el único del POS.</Text>}
        <Field label={unit === 'kg' ? 'Precio por kilogramo' : 'Precio por unidad'} kind="decimal" prefix="$" value={price} onChange={setPrice} placeholder="0" error={errors.price} hint={priceCents ? `${cop(priceCents)} por ${unit === 'kg' ? 'kg' : 'unidad'}` : undefined} testID="catalog-price"/>
        <View style={[styles.row, {paddingVertical: 4}]}>
          <View style={{flex: 1}}><Text style={styles.label}>Disponible para la venta</Text><Text style={styles.hint}>Los inactivos no aparecen en Vender; su historial se conserva.</Text></View>
          <Switch accessibilityLabel="Disponible para la venta" value={active} onValueChange={setActive} trackColor={{true: colors.green, false: colors.lineStrong}} thumbColor={colors.white}/>
        </View>
      </> : <><Field label="Ciudad o municipio" kind="name" value={city} onChange={setCity} placeholder="Ej. El Rosal" testID="catalog-city"/></>}
    </Sheet>
    <Sheet visible={!!importPreview} onClose={()=>setImportPreview(null)} title="Vista previa de importación" subtitle={importPreview?importPreview.summary.new+' nuevos · '+importPreview.summary.updates+' actualizaciones · '+importPreview.summary.omitted+' omitidos':''} footer={<Button title="Revisar y confirmar importación" disabled={busy||!!incompleteUnits} onPress={()=>setConfirmImport(true)}/>}>
      <Text style={styles.body}>Descripción será el nombre y Precio de venta mayoristas será el único precio del POS. Completa la modalidad cuando falte. Las existencias y las ventas históricas se conservan.</Text>
      {!importPreview?.unit_column&&<Text style={styles.small}>El archivo no contiene una columna explícita de modalidad.</Text>}
      <Text style={styles.label}>Aplicar modalidad a {selectedRows.length} filas seleccionadas</Text>
      <Choice items={[{id:'unit',name:'Por unidad'},{id:'kg',name:'Por kilogramo'}]} value="" onChange={v=>setImportUnits(prev=>({...prev,...Object.fromEntries(selectedRows.map(row=>[row,v]))}))}/>
      <Button title="Seleccionar filas sin modalidad" variant="outline" onPress={()=>setSelectedRows(importPreview!.rows.filter(r=>!r.errors.length&&!r.unit_locked&&!r.unit).map(r=>r.row))}/>
      {importPreview?.rows.map(r=><View key={r.row} style={{gap:4,paddingVertical:8,borderBottomWidth:1,borderBottomColor:colors.line}}>
        <Text style={styles.h2}>Fila {r.row} · {r.code||'Sin código'} · {r.name}</Text>
        <Text style={styles.small}>{r.action==='update'?'Actualizar precio':r.action==='create'?'Crear producto':'Omitir'} · {r.previous_price_cents==null?'Sin precio':cop(r.previous_price_cents)} → {r.new_price_cents==null?'Inválido':cop(r.new_price_cents)}</Text>
        {r.previous_wholesale_cents!=null&&<Text style={styles.small}>Precio adicional anterior: {cop(r.previous_wholesale_cents)}. Precio único después de importar: {cop(r.new_price_cents||0)}.</Text>}
        {!r.errors.length&&!r.unit_locked&&<>
          <Switch accessibilityLabel={'Seleccionar fila '+r.row} value={selectedRows.includes(r.row)} onValueChange={v=>setSelectedRows(prev=>v?[...prev,r.row]:prev.filter(n=>n!==r.row))}/>
          <Choice items={[{id:'unit',name:'Por unidad'},{id:'kg',name:'Por kilogramo'}]} value={importUnits[r.row]||r.unit||''} onChange={v=>setImportUnits(prev=>({...prev,[r.row]:v as 'unit'|'kg'}))}/>
        </>}
        {r.errors.map(e=><Text key={e} style={styles.fieldError}>{e}</Text>)}
        {r.warnings.map(w=><Text key={w} style={styles.small}>{w}</Text>)}

      </View>)}
    </Sheet>
    <Confirm visible={confirmImport} title="¿Aplicar la vista previa?" message="Se guardarán nombre, modalidad y precio único de las filas válidas. Las filas con errores se omiten. No se cambia el inventario ni las facturas históricas." confirmText="Confirmar importación" busy={busy} onCancel={()=>setConfirmImport(false)} onConfirm={()=>run(async()=>{const result=await api<{id:string;summary:{created:number;updated:number;omitted:number}}>('/products/import/apply','POST',{preview_id:importPreview!.id,request_key:importKey,units:Object.entries(importUnits).map(([row,unit])=>({row:Number(row),unit}))});setImportResult(result);setConfirmImport(false);setImportPreview(null);await refresh();await loadPrices();})}/>
    <Sheet visible={reviewPrices} onClose={()=>setReviewPrices(false)} title="Revisar precio único" footer={<Button title="Revisar migración de precios" disabled={busy||priceReviews.some(p=>!moneyToCents(chosenPrices[p.id]||''))} onPress={()=>setConfirmPrices(true)}/>}>
      <Text style={styles.body}>Revisa el precio que usará el POS. Hasta confirmar se conserva el precio actual. Las facturas históricas conservan sus precios originales.</Text>
      {priceReviews.map(p=><Card key={p.id}><Text style={styles.h2}>{p.name}</Text><Text style={styles.small}>Actual: {p.price_cents===null?'Pendiente':cop(p.price_cents)} · Adicional anterior: {p.wholesale_price_cents===null?'Sin precio':cop(p.wholesale_price_cents)}</Text><Field label="Precio único después de migrar" kind="decimal" value={chosenPrices[p.id]||''} onChange={v=>setChosenPrices(prev=>({...prev,[p.id]:v}))}/></Card>)}
    </Sheet>
    <Confirm visible={confirmPrices} title="¿Guardar estos precios únicos?" message="El POS usará los precios revisados. El historial de ventas se conserva." confirmText="Confirmar precios" busy={busy} onCancel={()=>setConfirmPrices(false)} onConfirm={()=>run(async()=>{await api('/products/price-migration','POST',{request_key:priceKey,items:priceReviews.map(p=>({product_id:p.id,price:normalizeMoney(chosenPrices[p.id]),expected_price_cents:p.price_cents,expected_wholesale_cents:p.wholesale_price_cents}))});setConfirmPrices(false);setReviewPrices(false);await refresh();await loadPrices();})}/>
    <Confirm visible={!!deactivate} title={`¿Desactivar “${deactivate?.name}”?`} message={isProducts ? 'Dejará de aparecer en Vender. Las ventas anteriores no cambian y puedes reactivarlo después.' : 'Dejará de aparecer en la lista de clientes. Las ventas anteriores conservan su nombre.'}
      confirmText="Desactivar" danger busy={busy} onCancel={() => setDeactivate(null)}
      onConfirm={() => run(async () => { await api(`/${tab}/${deactivate!.id}`, 'DELETE'); setDeactivate(null); setEditing(null); await refresh(); }, 'Desactivado; historial conservado')}/>
  </Page>;
}
