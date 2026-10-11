import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {cop, quantityLabel, receiptNumber, shortDate, time} from './format';
import type {Sale} from './types';

// Misma versión monocromática que imprime la API (server/assets/dannys-logo-print.png): lo que se ve es lo que sale en papel.
const PRINT_LOGO = require('../assets/brand/dannys-logo-print.png');

/**
 * Vista previa del ticket térmico. Usa solo los datos guardados de la venta (instantánea, precios y subtotales
 * históricos); jamás los precios actuales del catálogo. Refleja el diseño de server/src/pdf.js.
 */
export function Receipt({sale, width}: {sale: Sale; width: 58 | 80}) {
  const s = sale.snapshot;
  const paper = width === 58 ? 248 : 330;
  const size = width === 58 ? 11.5 : 13;
  const place = [s.business_address, s.business_city].filter(Boolean).join(' · ');
  const brand = /DANNY/i.test(s.business_name) ? "DANNY'S" : s.business_name;
  const T = ({children, bold, center, big, small}: {children: React.ReactNode; bold?: boolean; center?: boolean; big?: boolean; small?: boolean}) =>
    <Text style={{fontSize: big ? size + 6 : small ? size - 2 : size, fontWeight: bold ? '700' : '400', textAlign: center ? 'center' : 'left', color: '#111', lineHeight: (big ? size + 6 : small ? size - 2 : size) * 1.35}}>{children}</Text>;
  const Pair = ({left, right, bold, big}: {left: string; right: string; bold?: boolean; big?: boolean}) =>
    <View style={r.pair}><Text style={{fontSize: big ? size + 4 : size, fontWeight: bold ? '800' : '400', color: '#111'}}>{left}</Text><Text style={{flexShrink: 1, textAlign: 'right', fontSize: big ? size + 4 : size, fontWeight: '700', color: '#111', fontVariant: ['tabular-nums']}}>{right}</Text></View>;
  return <View testID="receipt-preview" accessibilityLabel={`Comprobante venta ${receiptNumber(sale.number)}`} style={[r.paper, {width: paper}]}>
    <Image source={PRINT_LOGO} resizeMode="contain" accessibilityLabel="Logo Danny's" style={{width: paper * 0.48, height: paper * 0.48 * 400 / 469, alignSelf: 'center'}}/>
    <T bold center>{s.business_name}</T>
    {!!s.business_nit && <T center small>NIT {s.business_nit}</T>}
    {!!place && <T center small>{place}</T>}
    {!!s.business_phone && <T center small>Tel. {s.business_phone}</T>}
    <View style={r.solid}/>
    <T center small bold>COMPROBANTE DE VENTA</T>
    <T center big bold>Venta {receiptNumber(sale.number)}</T>
    <View style={r.solid}/>
    <Pair left="Fecha" right={shortDate(sale.created_at)}/>
    <Pair left="Hora" right={time(sale.created_at)}/>
    <Pair left="Vendedor" right={s.seller_name}/>
    {!!sale.session_number && <Pair left="Caja" right={`#${sale.session_number}`}/>}
    <View style={{height: 4}}/>
    <Pair left="Cliente" right={s.customer_name}/>
    <Pair left="Ciudad" right={s.customer_city}/>
    <View style={r.dash}/>
    <View style={r.pair}><T small bold>PRODUCTO</T><T small bold>VALOR</T></View>
    <View style={r.dash}/>
    {sale.items?.map(item => <View key={item.id} style={{marginBottom: 4}}>
      <T bold>{item.name.toUpperCase()}</T>
      <Pair left={`${quantityLabel(item.quantity_milli, item.unit)} × ${cop(item.price_cents)}${item.unit === 'kg' ? '/kg' : ''}`} right={cop(item.subtotal_cents)}/>
    </View>)}
    <View style={r.double}/>
    <Pair left="TOTAL" right={cop(sale.total_cents)} bold big/>
    <View style={r.double}/>
    <Pair left="Productos" right={String(sale.items?.length || 0)}/>
    {sale.payments?.map((p, i) => <View key={i}>
      <Pair left="Método de pago" right={p.method === 'cash' ? 'EFECTIVO' : (p.platform_name || 'ELECTRÓNICO').toUpperCase()}/>
      {p.method !== 'cash' && <Text style={{textAlign: 'right', fontSize: size - 2, color: '#111'}}>Pago electrónico</Text>}
    </View>)}
    <View style={r.dash}/>
    <T bold center>¡Gracias por comprar en {brand}!</T>
    <View style={{height: 4}}/>
    <T center small>Comprobante de venta.</T>
    <T center small>No es factura electrónica.</T>
  </View>;
}
const r = StyleSheet.create({
  paper: {backgroundColor: '#FFFFFF', alignSelf: 'center', maxWidth: '100%', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 22, gap: 2, borderRadius: 4,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: {width: 0, height: 4}, elevation: 4},
  pair: {flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap'},
  solid: {height: 1.5, backgroundColor: '#111', marginVertical: 6},
  double: {height: 5, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#111', marginVertical: 6},
  dash: {height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#555', marginVertical: 6},
});
