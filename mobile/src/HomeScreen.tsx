import React, {useEffect, useState} from 'react';
import {Pressable, Text, View, useWindowDimensions} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api} from './api';
import {Banner, Button, Card, IconButton, Page, Section, Stat, capitalize, colors, cop, quantityLabel, fitSize, longToday, styles, time, shortDate} from './ui';
import type {CashSession, Tab, User} from './types';
import type {Run} from '../App';
type Props = {user: User; sessions: CashSession[]; busy: boolean; run: Run; refresh: () => Promise<void>; go: (tab: Tab) => void; onHistory: () => void; onCatalog: (sub: 'products' | 'customers') => void; online: boolean; queued: number; queuedTotal: number; onSync: () => void};
type Alert = {id: string; sale_id: string; created_at: string; seller_name: string; detail: {number: number; offline_ref: string | null; alerts: {type: 'price' | 'stock' | 'session_moved'; product?: string; sold_cents?: number; current_cents?: number; unit?: string; missing_milli?: number}[]}};
export function HomeScreen({user, sessions, busy, run, refresh, go, onHistory, onCatalog, online, queued, queuedTotal, onSync}: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // Avisos de ventas de ruta subidas tarde: solo administrador y con señal.
  useEffect(() => { if (user.role === 'admin' && online) void api<Alert[]>('/alerts').then(setAlerts).catch(() => undefined); }, [user.role, online, sessions]);
  const {width} = useWindowDimensions();
  const own = sessions.find(s => s.opened_by === user.id && s.state === 'open');
  const admin = user.role === 'admin';
  // Administrador ve la suma de todas las cajas abiertas; vendedor, solo la suya.
  const scope = admin ? sessions.filter(s => s.state === 'open') : own ? [own] : [];
  const sum = (key: 'total_cents' | 'cash_cents' | 'electronic_cents' | 'sale_count') => scope.reduce((n, s) => n + s[key], 0);
  const shortcuts = [
    {name: 'Caja', icon: 'inbox' as const, onPress: () => go('cash')},
    {name: 'Historial', icon: 'clock' as const, onPress: onHistory},
    {name: 'Productos', icon: 'package' as const, onPress: () => onCatalog('products')},
    {name: 'Clientes', icon: 'users' as const, onPress: () => onCatalog('customers')},
  ];
  return <Page onRefresh={() => run(refresh)} refreshing={false}>
    <View style={[styles.row, {alignItems: 'flex-start'}]}>
      <View style={{flex: 1, gap: 2}}>
        <Text accessibilityRole="header" style={styles.title}>Hola, {user.name.split(' ')[0]}</Text>
        <Text style={styles.muted}>{capitalize(longToday())}</Text>
      </View>
      <IconButton icon="refresh-cw" label="Actualizar resumen" onPress={() => run(refresh, 'Resumen actualizado')} disabled={busy} testID="refresh-home"/>
    </View>

    {!online && <Banner tone="gray" title="Sin señal · modo ruta" text="Puedes seguir vendiendo. Las ventas se guardan en el celular y se suben solas cuando haya internet."/>}
    {queued > 0 && <Banner tone="yellow" title={`${queued} ${queued === 1 ? 'venta' : 'ventas'} por subir · ${cop(queuedTotal)}`} text="Están guardadas en este celular. Se suben automáticamente; no cierres sesión hasta que terminen." action={online ? 'Subir ahora' : undefined} onAction={onSync}/>}
    {alerts.length > 0 && <Card tone="orange" testID="route-alerts">
      <Text style={[styles.h2, {color: colors.orange}]}>Avisos de ventas en ruta ({alerts.length})</Text>
      {alerts.slice(0, 5).map(a => a.detail.alerts.map((x, i) => <Text key={a.id + i} style={[styles.small, {color: colors.text}]}>
        Venta #{String(a.detail.number).padStart(4, '0')} · {a.seller_name}: {x.type === 'price' ? `${x.product} se vendió a ${cop(x.sold_cents!)} (precio actual ${cop(x.current_cents!)})` : x.type === 'stock' ? `faltó stock de ${x.product} (${quantityLabel(x.missing_milli!, x.unit!)}); quedó en 0` : 'la caja ya estaba cerrada; entró en la caja abierta actual'}
      </Text>))}
      <Text style={styles.small}>Avisos de los últimos 7 días.</Text>
    </Card>}
    {own
      ? <Card tone="green" testID="cash-open-card">
          <View style={[styles.row, {justifyContent: 'flex-start'}]}>
            <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center'}}><Feather name="unlock" size={18} color="white"/></View>
            <View style={{flex: 1}}>
              <Text style={[styles.h2, {color: colors.greenDark}]}>Caja{own.number ? ` #${own.number}` : ''} abierta</Text>
              <Text style={[styles.small, {color: colors.greenDark}]}>Desde {shortDate(own.opened_at)} · {time(own.opened_at)} · Base {cop(own.opening_cents)}</Text>
            </View>
          </View>
          <Button title="Nueva venta" icon="plus" size="lg" onPress={() => go('sale')} testID="new-sale"/>
        </Card>
      : <Card tone="orange" testID="cash-closed-card">
          <View style={[styles.row, {justifyContent: 'flex-start', alignItems: 'flex-start'}]}>
            <View style={{width: 40, height: 40, borderRadius: 20, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center'}}><Feather name="lock" size={18} color="white"/></View>
            <View style={{flex: 1, gap: 2}}>
              <Text style={[styles.h2, {color: colors.orange}]}>Tu caja está cerrada</Text>
              <Text style={[styles.small, {color: colors.text}]}>Para vender, abre tu caja con el dinero base que tienes en el cajón.</Text>
            </View>
          </View>
          <Button title="Abrir mi caja" icon="unlock" size="lg" onPress={() => go('cash')} testID="open-cash-home"/>
        </Card>}

    <Section title={admin ? `Jornada · ${scope.length} ${scope.length === 1 ? 'caja abierta' : 'cajas abiertas'}` : 'Mi jornada'}>
      <View style={[styles.wrap, {gap: 10}]}>
        <View testID="stat-total" style={{flexBasis: '100%', backgroundColor: colors.greenDark, borderRadius: 16, padding: 16, gap: 2}}>
          <Text style={{color: '#CFE8D6', fontSize: 13, fontWeight: '600'}}>Total vendido · {sum('sale_count')} {sum('sale_count') === 1 ? 'venta' : 'ventas'}</Text>
          <Text numberOfLines={1} style={{color: colors.white, fontSize: fitSize(cop(sum('total_cents')), 32, 11), fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums']}}>{cop(sum('total_cents'))}</Text>
        </View>
        <Stat label="Efectivo" value={cop(sum('cash_cents'))} icon="dollar-sign" tone="green"/>
        <Stat label="Electrónico" value={cop(sum('electronic_cents'))} icon="smartphone" tone="yellow"/>
      </View>
      {scope.length === 0 && <Text style={styles.small}>Los valores aparecen cuando hay una caja abierta.</Text>}
    </Section>

    <Section title="Accesos rápidos">
      <View style={[styles.wrap, {gap: 10}]}>
        {shortcuts.map(s => <Pressable key={s.name} accessibilityRole="button" accessibilityLabel={s.name} onPress={s.onPress}
          style={({pressed}) => [{flexGrow: 1, flexBasis: width >= 600 ? '22%' : '45%', minHeight: 76, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8, justifyContent: 'center'}, pressed && {backgroundColor: colors.greenSoft}]}>
          <View style={{width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}><Feather name={s.icon} size={17} color={colors.green}/></View>
          <Text style={{fontSize: 15, fontWeight: '700', color: colors.ink}}>{s.name}</Text>
        </Pressable>)}
      </View>
    </Section>
  </Page>;
}
