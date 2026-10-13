import React, {useEffect, useState} from 'react';
import {Pressable, Switch, Text, View} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {api, API_URL} from './api';
import {Badge, Button, Card, Choice, Confirm, Divider, Field, Logo, Page, Segmented, colors, date, initials, styles} from './ui';
import type {Settings, User, Platform} from './types';
import type {Run} from '../App';
type Props = {onAdmin:(section:'accounts'|'routes'|'stock')=>void;queued: number; user: User; settings: Settings; platforms: Platform[]; run: Run; refresh: () => Promise<void>; busy: boolean; logout: () => void};
type Audit = {id: string; actor_name: string; action: string; created_at: string};
// Nombres comprensibles para la bitácora de auditoría.
const ACTIONS: Record<string, string> = {
  'sale.create': 'Registró una venta', 'cash.open': 'Abrió una caja', 'cash.close': 'Cerró una caja', 'closure.annotate': 'Agregó una aclaración a un cierre',
  'product.create': 'Creó un producto', 'product.update': 'Editó un producto', 'product.deactivate': 'Desactivó un producto',
  'customer.create': 'Creó un cliente', 'customer.update': 'Editó un cliente', 'customer.deactivate': 'Desactivó un cliente',
  'platform.create': 'Agregó un método de pago', 'platform.update': 'Cambió un método de pago', 'settings.update': 'Cambió los datos del negocio',
  'user.create': 'Creó un usuario', 'user.status': 'Activó o desactivó un usuario', 'user.password_reset': 'Restableció una contraseña',
  'auth.login': 'Inició sesión', 'auth.logout': 'Cerró sesión',
};

export function SettingsScreen({onAdmin,queued, user, settings, platforms, run, refresh, busy, logout}: Props) {
  const admin = user.role === 'admin';
  const [open, setOpen] = useState<string>(''), [confirmLogout, setConfirmLogout] = useState(false);
  const [business, setBusiness] = useState({business_name: settings.business_name, business_nit: settings.business_nit || '', business_address: settings.business_address || '', business_city: settings.business_city || '', business_phone: settings.business_phone || ''}), [width, setWidth] = useState(String(settings.paper_width));
  const [users, setUsers] = useState<User[]>([]), [username, setUsername] = useState(''), [userName, setUserName] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState('seller'), [platformName, setPlatformName] = useState(''), [resetUser, setResetUser] = useState(''), [resetPassword, setResetPassword] = useState(''), [audit, setAudit] = useState<Audit[] | null>(null);
  async function loadUsers() { setUsers(await api<User[]>('/users')); }
  useEffect(() => { if (admin) run(loadUsers); }, []);
  const set = (key: keyof typeof business) => (value: string) => setBusiness(b => ({...b, [key]: value}));
  const usernameError = username && !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) ? 'De 3 a 40 caracteres, sin espacios (letras, números, punto o guion)' : null;


  return <Page>
    <Card style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
      <View style={{width: 56, height: 56, borderRadius: 28, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center'}}><Text style={{color: 'white', fontSize: 20, fontWeight: '800'}}>{initials(user.name)}</Text></View>
      <View style={{flex: 1, gap: 3}}>
        <Text accessibilityRole="header" style={styles.h2}>{user.name}</Text>
        <Text style={styles.small}>@{user.username}</Text>
        <Badge text={admin ? 'Administrador' : 'Vendedor'} icon={admin ? 'shield' : 'user'}/>
      </View>
    </Card>

    <Card style={{alignItems: 'center', gap: 6}}>
      <Logo width={120}/>
      <Text style={[styles.h2, {textAlign: 'center'}]}>{settings.business_name}</Text>
      {[settings.business_nit && `NIT ${settings.business_nit}`, [settings.business_address, settings.business_city].filter(Boolean).join(' · '), settings.business_phone && `Tel. ${settings.business_phone}`].filter(Boolean).map((t, i) => <Text key={i} style={[styles.small, {textAlign: 'center'}]}>{t}</Text>)}
      <Text style={[styles.small, {textAlign: 'center'}]}>Comprobantes en papel de {settings.paper_width} mm · Hora de Colombia</Text>
    </Card>

    <Button title="Preparar datos para vender sin internet" icon="download" variant="outline" disabled={busy} onPress={()=>run(refresh,'Catálogo y datos guardados para trabajar sin internet')}/>
    {admin && <>
      <Button title="Créditos y cartera" icon="book-open" variant="secondary" onPress={()=>onAdmin('accounts')} testID="admin-accounts"/>
      <Button title="Rutas" icon="map" variant="secondary" onPress={()=>onAdmin('routes')} testID="admin-routes"/>
      <Button title="Carga de stock por ruta" icon="package" variant="secondary" onPress={()=>onAdmin('stock')} testID="admin-stock"/>
      <Group id="business" open={open} onToggle={setOpen} icon="briefcase" title="Datos del negocio" subtitle="Lo que se imprime en el comprobante">
        <Field label="Nombre comercial" value={business.business_name} onChange={set('business_name')} testID="settings-name"/>
        <Field label="NIT o identificación (opcional)" kind="plain" value={business.business_nit} onChange={set('business_nit')} placeholder="Ej. 900.123.456-7"/>
        <Field label="Dirección (opcional)" value={business.business_address} onChange={set('business_address')} placeholder="Ej. Calle 10 # 5-20"/>
        <Field label="Ciudad (opcional)" kind="name" value={business.business_city} onChange={set('business_city')} placeholder="Ej. El Rosal"/>
        <Field label="Teléfono (opcional)" kind="phone" value={business.business_phone} onChange={set('business_phone')} placeholder="Ej. 300 123 4567"/>
        <View style={{gap: 6}}><Text style={styles.label}>Papel de la impresora</Text><Segmented items={[{id: '58', name: '58 mm'}, {id: '80', name: '80 mm'}]} value={width} onChange={setWidth}/></View>
        <Text style={styles.hint}>Solo se imprimen los datos que completes. Los comprobantes ya emitidos conservan sus datos originales. El comprobante indica que no es factura electrónica.</Text>
        <Button title="Guardar datos del negocio" icon="check" disabled={busy || !business.business_name.trim()} onPress={() => run(async () => { await api('/settings', 'PUT', {...business, business_name: business.business_name.trim(), paper_width: Number(width)}); await refresh(); }, 'Datos del negocio guardados')} testID="settings-save"/>
      </Group>

      <Group id="platforms" open={open} onToggle={setOpen} icon="smartphone" title="Pagos electrónicos" subtitle={`${platforms.filter(p => p.active).length} métodos activos en Vender`}>
        {platforms.map(p => <View key={p.id} style={styles.row}><Text style={[styles.body, {flex: 1}]}>{p.name}</Text><Switch accessibilityLabel={`Activar ${p.name}`} value={!!p.active} disabled={busy} trackColor={{true: colors.green, false: colors.lineStrong}} thumbColor={colors.white} onValueChange={active => run(async () => { await api(`/platforms/${p.id}`, 'PUT', {name: p.name, active}); await refresh(); })}/></View>)}
        <Field label="Nuevo método de pago" value={platformName} onChange={setPlatformName} placeholder="Ej. Bancolombia QR"/>
        <Button title="Agregar método" icon="plus" variant="secondary" disabled={busy || !platformName.trim()} onPress={() => run(async () => { await api('/platforms', 'POST', {name: platformName.trim(), active: true}); setPlatformName(''); await refresh(); }, 'Método agregado')}/>
      </Group>

      <Group id="users" open={open} onToggle={setOpen} icon="users" title="Usuarios y accesos" subtitle={`${users.filter(u => u.active).length} usuarios activos`}>
        {users.map(u => <View key={u.id} style={styles.row}>
          <View style={{flex: 1}}><Text style={{color: colors.ink, fontWeight: '700', fontSize: 15}}>{u.name}{u.id === user.id ? ' (tú)' : ''}</Text><Text style={styles.small}>@{u.username} · {u.role === 'admin' ? 'Administrador' : 'Vendedor'}</Text></View>
          <Switch accessibilityLabel={`Acceso de ${u.name}`} value={!!u.active} disabled={busy || u.id === user.id} trackColor={{true: colors.green, false: colors.lineStrong}} thumbColor={colors.white} onValueChange={active => run(async () => { await api(`/users/${u.id}`, 'PATCH', {active}); await loadUsers(); }, active ? 'Usuario activado' : 'Usuario desactivado')}/>
        </View>)}
        <Divider/>
        <Text style={styles.sectionTitle}>Crear usuario</Text>
        <Field label="Nombre completo" kind="name" value={userName} onChange={setUserName}/>
        <Field label="Usuario para ingresar" kind="plain" value={username} onChange={setUsername} error={usernameError} hint="Sin espacios. Ej. mariana"/>
        <Field label="Contraseña" value={password} onChange={setPassword} secure hint="Mínimo 12 caracteres" error={password && password.length < 12 ? `Faltan ${12 - password.length} caracteres` : null}/>
        <Segmented items={[{id: 'seller', name: 'Vendedor'}, {id: 'admin', name: 'Administrador'}]} value={role} onChange={setRole}/>
        <Button title="Crear usuario" icon="user-plus" disabled={busy || !username || !!usernameError || !userName.trim() || password.length < 12} onPress={() => run(async () => { await api('/users', 'POST', {username, name: userName.trim(), password, role}); setUsername(''); setUserName(''); setPassword(''); await loadUsers(); }, 'Usuario creado')}/>
        <Divider/>
        <Text style={styles.sectionTitle}>Restablecer contraseña</Text>
        <Choice items={users.map(u => ({id: u.id, name: u.name}))} value={resetUser} onChange={setResetUser}/>
        <Field label="Nueva contraseña" value={resetPassword} onChange={setResetPassword} secure hint="Cierra las sesiones abiertas de ese usuario." error={resetPassword && resetPassword.length < 12 ? 'Mínimo 12 caracteres' : null}/>
        <Button title="Cambiar contraseña" variant="secondary" disabled={busy || !resetUser || resetPassword.length < 12} onPress={() => run(async () => { await api(`/users/${resetUser}/password`, 'POST', {password: resetPassword}); setResetPassword(''); }, 'Contraseña actualizada')}/>
      </Group>

      <Group id="audit" open={open} onToggle={setOpen} icon="activity" title="Actividad reciente" subtitle="Quién hizo qué y cuándo">
        {audit === null ? <Button title="Consultar últimos eventos" variant="secondary" disabled={busy} onPress={() => run(async () => setAudit(await api<Audit[]>('/audit')))}/>
          : audit.slice(0, 60).map(a => <View key={a.id} style={{gap: 1}}><Text style={{color: colors.ink, fontWeight: '600'}}>{ACTIONS[a.action] || a.action}</Text><Text style={styles.small}>{a.actor_name || 'Configuración inicial'} · {date(a.created_at)}</Text></View>)}
      </Group>
    </>}

    {queued > 0 && <Text style={[styles.small, {color: colors.orange, textAlign: 'center'}]}>Tienes {queued} {queued === 1 ? 'venta' : 'ventas'} sin subir. Cierra sesión solo cuando se hayan subido.</Text>}
    <Button title="Cerrar sesión" icon="log-out" variant="outline" danger disabled={queued > 0} onPress={() => setConfirmLogout(true)} testID="logout"/>
    <Text style={[styles.small, {textAlign: 'center', fontSize: 11}]}>Servidor: {API_URL}</Text>
    <Confirm visible={confirmLogout} title="¿Cerrar sesión?" message="Las ventas quedan guardadas y tu caja no se cierra al salir. Para volver, ingresa con tu usuario y contraseña." confirmText="Cerrar sesión" busy={busy} onCancel={() => setConfirmLogout(false)} onConfirm={() => { setConfirmLogout(false); logout(); }}/>
  </Page>;
}

/** Sección plegable: mantiene Perfil corto en el celular. Definida fuera del render para no perder el foco de los campos. */
function Group({id, open, onToggle, icon, title, subtitle, children}: {id: string; open: string; onToggle: (id: string) => void; icon: React.ComponentProps<typeof Feather>['name']; title: string; subtitle: string; children: React.ReactNode}) {
  const on = open === id;
  return <Card style={{padding: 0, gap: 0, overflow: 'hidden'}}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded: on}} accessibilityLabel={title} onPress={() => onToggle(on ? '' : id)} style={({pressed}) => [{flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64}, pressed && {backgroundColor: '#F7FAF7'}]}>
      <View style={{width: 38, height: 38, borderRadius: 12, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center'}}><Feather name={icon} size={18} color={colors.green}/></View>
      <View style={{flex: 1}}><Text style={[styles.h2, {fontSize: 16}]}>{title}</Text><Text style={styles.small}>{subtitle}</Text></View>
      <Feather name={on ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted}/>
    </Pressable>
    {on && <View style={{padding: 16, paddingTop: 0, gap: 14}}><Divider/>{children}</View>}
  </Card>;
}
