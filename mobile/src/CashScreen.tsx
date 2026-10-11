import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api} from './api';
import {Badge, Banner, Button, Card, Choice, Confirm, Divider, Empty, Field, Header, InfoRow, Page, Section, colors, cop, diff, moneyInput, moneyToCents, normalizeMoney, shortDate, signed, styles, time, useBack} from './ui';
import type {CashSession, Closure, User} from './types';
import type {Run} from '../App';
type Props = {queued: number; sessions: CashSession[]; user: User; run: Run; refresh: () => Promise<void>; busy: boolean; onClosure: (closure: Closure) => void; onHistory: (session: string) => void; onSell: () => void};
const OPENING_PRESETS = [0, 5000000, 10000000, 20000000];
const label = (s: CashSession) => `Caja${s.number ? ` #${s.number}` : ''}`;

export function CashScreen({queued, sessions, user, run, refresh, busy, onClosure, onHistory, onSell}: Props) {
  const [opening, setOpening] = useState(''), [selected, setSelected] = useState<CashSession | null>(null), [cash, setCash] = useState(''), [electronic, setElectronic] = useState(''), [notes, setNotes] = useState(''), [review, setReview] = useState(false), [showClosed, setShowClosed] = useState(8), [now, setNow] = useState(new Date());
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
  const valid = cashCents !== null && elecCents !== null;
  const openingCents = opening.trim() ? moneyToCents(opening) : 0;

  async function startClose(session: CashSession) {
    const latest = await api<CashSession>(`/cash-sessions/${session.id}`);
    if (latest.state !== 'open') throw new Error('Esta caja ya fue cerrada. Desliza hacia abajo o toca Actualizar para ver el estado actual.');
    setSelected({...latest, number: session.number}); setCash(''); setElectronic(''); setNotes(''); setReview(false);
  }
  async function close() {
    const c = await api<Closure>(`/cash-sessions/${selected!.id}/close`, 'POST', {reviewed_sale_count: selected!.sale_count, declared_cash: normalizeMoney(cash), declared_electronic: normalizeMoney(electronic), notes});
    setReview(false); setSelected(null); onClosure(c); await refresh();
  }

  // ── Conciliación y cierre (solo administrador)
  if (selected) return <Page>
    <Header eyebrow={`CERRAR ${label(selected).toUpperCase()}`} title="Contar y cerrar" subtitle={`${selected.opener_name} · abierta ${shortDate(selected.opened_at)} ${time(selected.opened_at)}`}/>
    <Card>
      <Text style={styles.sectionTitle}>Lo que dice el sistema</Text>
      <InfoRow label="Ventas registradas" value={String(selected.sale_count)}/>
      <InfoRow label="Base inicial" value={cop(selected.opening_cents)}/>
      <InfoRow label="Ventas en efectivo" value={cop(selected.cash_cents)}/>
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
      <Field label="Observaciones (opcional)" value={notes} onChange={setNotes} multiline placeholder="Ej. Se pagó un domicilio con efectivo de la caja"/>
    </Card>
    <Button title="Revisar cierre" icon="clipboard" size="lg" disabled={!valid || busy} onPress={() => setReview(true)} testID="review-close"/>
    <Button title="Cancelar" variant="outline" onPress={() => setSelected(null)}/>
    <Confirm visible={review} title="¿Cerrar la caja definitivamente?" message="El cierre no se puede deshacer. Después solo podrás agregar aclaraciones." confirmText="Confirmar cierre definitivo" busy={busy} onCancel={() => setReview(false)} onConfirm={() => run(close, 'Caja cerrada')}>
      <Card style={{gap: 6}}>
        <InfoRow label="Efectivo" value={signed(cashDiff)} tone={cashDiff === 0 ? 'green' : 'orange'}/>
        <Text style={styles.small}>{diff(cashDiff)}</Text>
        <InfoRow label="Electrónico" value={signed(elecDiff)} tone={elecDiff === 0 ? 'green' : 'orange'}/>
        <Text style={styles.small}>{diff(elecDiff)}</Text>
        <Divider/>
        <InfoRow label="Diferencia total" value={signed(cashDiff + elecDiff)} strong/>
      </Card>
      <Text style={styles.small}>El servidor vuelve a sumar las ventas al cerrar. Si entró una venta nueva mientras contabas, te pedirá revisar otra vez. Si el vendedor estuvo en ruta, verifica que su celular no tenga ventas por subir.</Text>
    </Confirm>
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
    {queued > 0 && <Banner tone="yellow" title={`${queued} ${queued === 1 ? 'venta' : 'ventas'} de ruta sin subir`} text="Conéctate a internet antes de que cierren tu caja. Si la cierran antes, las ventas entran en tu próxima caja abierta."/>}
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
