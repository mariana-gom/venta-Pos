import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Animated, BackHandler, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {fitSize} from './format';
export * from './format';

// Identidad DANNY'S: verde corporativo del logo, superficies blancas y acentos amarillo/naranja con moderación.
export const colors = {
  bg: '#F3F6F2', surface: '#FFFFFF', ink: '#14271B', text: '#3D4D42', muted: '#66756B', line: '#E1E7E2', lineStrong: '#CBD5CD',
  green: '#1E7A3C', greenDark: '#145A2B', greenSoft: '#E6F2E8', greenLine: '#C9E2CF',
  yellow: '#F5BE2E', yellowSoft: '#FFF5D6', orange: '#C2600F', orangeSoft: '#FDEEDD', red: '#B9342B', redSoft: '#FBE9E7',
  white: '#FFFFFF', mint: '#E6F2E8',
};
export const radius = {sm: 10, md: 14, lg: 18, pill: 999};
type Icon = React.ComponentProps<typeof Feather>['name'];
export type Tone = 'green' | 'orange' | 'red' | 'gray' | 'yellow';
const toneColors: Record<Tone, {bg: string; fg: string}> = {
  green: {bg: colors.greenSoft, fg: colors.greenDark}, orange: {bg: colors.orangeSoft, fg: colors.orange}, red: {bg: colors.redSoft, fg: colors.red},
  gray: {bg: '#EEF1EE', fg: colors.text}, yellow: {bg: colors.yellowSoft, fg: '#7A5600'},
};

const LOGO = require('../assets/brand/dannys-logo.png');
/** Logo oficial, siempre con su proporción original (469×400). */
export function Logo({width = 44}: {width?: number}) {
  return <Image source={LOGO} accessibilityLabel="Logo Distribuidora & Salsamentaria Danny's" resizeMode="contain" style={{width, height: Math.round(width * 400 / 469)}}/>;
}

// ── Pila de "atrás": hojas y subpantallas registran su cierre para el botón físico de Android.
const backStack: (() => void)[] = [];
export function useBack(active: boolean, handler: () => void) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const fn = () => ref.current();
    backStack.push(fn);
    return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
  }, [active]);
}
export function handleBack() { const top = backStack[backStack.length - 1]; if (!top) return false; top(); return true; }
export function useHardwareBack(fallback: () => boolean) {
  const ref = useRef(fallback); ref.current = fallback;
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBack() || ref.current()); return () => sub.remove(); }, []);
}

type ButtonProps = {title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; icon?: Icon; disabled?: boolean; loading?: boolean; testID?: string; style?: StyleProp<ViewStyle>; secondary?: boolean; danger?: boolean};
export function Button({title, onPress, variant, size = 'md', icon, disabled = false, loading = false, testID, style, secondary, danger}: ButtonProps) {
  const kind = variant || (danger ? 'danger' : secondary ? 'secondary' : 'primary');
  const fg = kind === 'primary' || kind === 'danger' ? colors.white : kind === 'outline' && danger ? colors.red : kind === 'ghost' ? colors.green : colors.greenDark;
  const off = disabled || loading;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{disabled: off, busy: loading}} disabled={off} onPress={onPress}
    style={({pressed}) => [styles.button, size === 'lg' && styles.buttonLg, size === 'sm' && styles.buttonSm, buttonKinds[kind], pressed && !off && {opacity: 0.85, transform: [{scale: 0.985}]}, off && {opacity: 0.45}, style]}>
    {loading ? <ActivityIndicator size="small" color={fg}/> : icon && <Feather name={icon} size={size === 'lg' ? 20 : 17} color={fg}/>}
    <Text selectable={false} numberOfLines={1} style={[styles.buttonText, size === 'lg' && {fontSize: 17}, size === 'sm' && {fontSize: 13}, {color: fg}]}>{title}</Text>
  </Pressable>;
}
const buttonKinds = StyleSheet.create({
  primary: {backgroundColor: colors.green}, secondary: {backgroundColor: colors.greenSoft}, danger: {backgroundColor: colors.red},
  outline: {backgroundColor: colors.white, borderWidth: 1, borderColor: colors.lineStrong}, ghost: {backgroundColor: 'transparent', minHeight: 40, paddingHorizontal: 8},
});
export function IconButton({icon, label, onPress, tone = 'gray', size = 44, disabled, testID}: {icon: Icon; label: string; onPress: () => void; tone?: Tone | 'solid'; size?: number; disabled?: boolean; testID?: string}) {
  const c = tone === 'solid' ? {bg: colors.green, fg: colors.white} : toneColors[tone];
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6}
    style={({pressed}) => [{width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center'}, (pressed || disabled) && {opacity: disabled ? 0.4 : 0.75}]}>
    <Feather name={icon} size={Math.round(size * 0.45)} color={c.fg}/>
  </Pressable>;
}

type FieldProps = {label: string; value: string; onChange: (text: string) => void; placeholder?: string; secure?: boolean; kind?: 'text' | 'plain' | 'name' | 'decimal' | 'number' | 'phone' | 'date'; numeric?: boolean; hint?: string; error?: string | null; autoFocus?: boolean; onSubmit?: () => void; multiline?: boolean; prefix?: string; right?: React.ReactNode; testID?: string; large?: boolean};
export function Field({label, value, onChange, placeholder, secure = false, kind, numeric, hint, error, autoFocus, onSubmit, multiline, prefix, right, testID, large}: FieldProps) {
  const type = kind || (numeric ? 'decimal' : 'text');
  const [focused, setFocused] = useState(false);
  const keyboard = type === 'decimal' ? 'decimal-pad' : type === 'number' ? 'number-pad' : type === 'phone' ? 'phone-pad' : type === 'date' ? 'numbers-and-punctuation' : 'default';
  return <View style={{gap: 6}}>
    <Text style={styles.label}>{label}</Text>
    <View style={[styles.inputBox, large && {minHeight: 60}, focused && {borderColor: colors.green, borderWidth: 2}, !!error && {borderColor: colors.red}, multiline && {alignItems: 'flex-start'}]}>
      {prefix && <Text style={[styles.prefix, large && {fontSize: 22}]}>{prefix}</Text>}
      <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#98A39C" secureTextEntry={secure}
        keyboardType={keyboard} inputMode={type === 'decimal' ? 'decimal' : type === 'number' ? 'numeric' : type === 'phone' ? 'tel' : 'text'} autoCapitalize={type === 'name' ? 'words' : type === 'text' && !secure ? 'sentences' : 'none'}
        autoCorrect={false} autoFocus={autoFocus} onSubmitEditing={onSubmit} returnKeyType={onSubmit ? 'done' : 'default'} multiline={multiline} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={[styles.input, large && {fontSize: 24, fontWeight: '700'}, multiline && {minHeight: 84, textAlignVertical: 'top', paddingTop: 12}, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
      {right}
    </View>
    {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
  </View>;
}
export function SearchBar({value, onChange, placeholder, autoFocus, testID}: {value: string; onChange: (t: string) => void; placeholder: string; autoFocus?: boolean; testID?: string}) {
  return <View style={styles.search}>
    <Feather name="search" size={18} color={colors.muted}/>
    <TextInput testID={testID} accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#98A39C" autoFocus={autoFocus} autoCorrect={false} returnKeyType="search"
      style={[styles.searchInput, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={10} onPress={() => onChange('')}><Feather name="x-circle" size={18} color={colors.muted}/></Pressable>}
  </View>;
}
export function Card({children, style, onPress, testID, tone}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string; tone?: Tone}) {
  const tint = tone && {backgroundColor: toneColors[tone].bg, borderColor: 'transparent'};
  if (!onPress) return <View testID={testID} style={[styles.card, tint, style]}>{children}</View>;
  return <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({pressed}) => [styles.card, tint, pressed && {backgroundColor: '#F7FAF7'}, style]}>{children}</Pressable>;
}
export function Badge({text, tone, good = true, icon}: {text: string; tone?: Tone; good?: boolean; icon?: Icon}) {
  const c = toneColors[tone || (good ? 'green' : 'orange')];
  return <View style={[styles.badge, {backgroundColor: c.bg}]}>{icon && <Feather name={icon} size={11} color={c.fg}/>}<Text numberOfLines={1} style={[styles.badgeText, {color: c.fg}]}>{text}</Text></View>;
}
export function Header({eyebrow, title, subtitle, right}: {eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode}) {
  return <View style={[styles.row, {alignItems: 'flex-start'}]}>
    <View style={{flex: 1, gap: 3}}>{eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}<Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.muted}>{subtitle}</Text>}</View>
    {right}
  </View>;
}
export function Section({title, action, onAction, children}: {title: string; action?: string; onAction?: () => void; children?: React.ReactNode}) {
  return <View style={{gap: 10}}>
    <View style={styles.row}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{action && onAction && <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable>}</View>
    {children}
  </View>;
}
export function Stat({label, value, icon, tone = 'gray', testID}: {label: string; value: string; icon?: Icon; tone?: Tone; testID?: string}) {
  const c = toneColors[tone];
  return <View testID={testID} style={styles.stat}>
    <View style={[styles.row, {justifyContent: 'flex-start', gap: 8}]}>{icon && <View style={[styles.statIcon, {backgroundColor: c.bg}]}><Feather name={icon} size={14} color={c.fg}/></View>}<Text numberOfLines={2} style={[styles.small, {flex: 1}]}>{label}</Text></View>
    <Text numberOfLines={1} style={[styles.statValue, {fontSize: fitSize(value, 20, 9)}]}>{value}</Text>
  </View>;
}
export function Metric({label, value, accent = false}: {label: string; value: string; accent?: boolean}) {
  return <View style={{flex: 1, minWidth: 120, gap: 4}}><Text style={styles.small}>{label}</Text><Text numberOfLines={1} style={[styles.metric, {fontSize: fitSize(value, 22)}, accent && {color: colors.green}]}>{value}</Text></View>;
}
/** Fila etiqueta → valor, alineada a la derecha. */
export function InfoRow({label, value, strong, tone}: {label: string; value: string; strong?: boolean; tone?: Tone}) {
  return <View style={[styles.row, {paddingVertical: 3, alignItems: 'flex-start'}]}>
    <Text style={[styles.body, {color: colors.muted, flexShrink: 0}]}>{label}</Text>
    <Text style={[styles.body, {flex: 1, textAlign: 'right'}, strong && {fontWeight: '700', color: colors.ink}, tone && {color: toneColors[tone].fg, fontWeight: '700'}]}>{value}</Text>
  </View>;
}
export function Empty({title, text, icon = 'inbox', action, onAction}: {title: string; text: string; icon?: Icon; action?: string; onAction?: () => void}) {
  return <View style={styles.empty}>
    <View style={styles.emptyIcon}><Feather name={icon} size={26} color={colors.green}/></View>
    <Text style={[styles.h2, {textAlign: 'center'}]}>{title}</Text>
    <Text style={[styles.muted, {textAlign: 'center', maxWidth: 320}]}>{text}</Text>
    {action && onAction && <Button title={action} onPress={onAction} variant="secondary" size="sm" style={{marginTop: 4, alignSelf: 'center', paddingHorizontal: 18}}/>}
  </View>;
}
export function Loading({text = 'Cargando…'}: {text?: string}) {
  return <View style={[styles.empty, {borderWidth: 0, backgroundColor: 'transparent'}]}><ActivityIndicator color={colors.green}/><Text style={styles.muted}>{text}</Text></View>;
}
export function Busy() { return <ActivityIndicator color={colors.green}/>; }
/** Aviso persistente: error con detalle técnico opcional, advertencia o éxito. */
export function Banner({tone = 'red', title, text, detail, onClose, action, onAction}: {tone?: Tone; title?: string; text: string; detail?: string; onClose?: () => void; action?: string; onAction?: () => void}) {
  const [open, setOpen] = useState(false); const c = toneColors[tone];
  const icon: Icon = tone === 'green' ? 'check-circle' : tone === 'red' ? 'alert-circle' : tone === 'gray' ? 'info' : 'alert-triangle';
  return <View accessibilityRole="alert" style={[styles.banner, {backgroundColor: c.bg}]}>
    <Feather name={icon} size={18} color={c.fg} style={{marginTop: 1}}/>
    <View style={{flex: 1, gap: 4}}>
      {title && <Text style={{color: c.fg, fontWeight: '700', fontSize: 14}}>{title}</Text>}
      <Text style={{color: c.fg, fontSize: 14, lineHeight: 20}}>{text}</Text>
      {detail && <Pressable hitSlop={6} onPress={() => setOpen(!open)}><Text style={{color: c.fg, fontSize: 12, textDecorationLine: 'underline'}}>{open ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</Text></Pressable>}
      {open && detail && <Text selectable style={{color: c.fg, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}}>{detail}</Text>}
      {action && onAction && <Button title={action} onPress={onAction} size="sm" variant={tone === 'red' ? 'danger' : 'primary'} style={{alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 16}}/>}
    </View>
    {onClose && <Pressable accessibilityRole="button" accessibilityLabel="Cerrar aviso" hitSlop={10} onPress={onClose}><Feather name="x" size={18} color={c.fg}/></Pressable>}
  </View>;
}
export function Page({children, footer, onRefresh, refreshing = false, testID}: {children: React.ReactNode; footer?: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; testID?: string}) {
  return <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView testID={testID} style={{flex: 1}} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.green]} tintColor={colors.green}/> : undefined}>{children}</ScrollView>
    {footer}
  </KeyboardAvoidingView>;
}
/** Barra fija sobre la navegación inferior: nunca tapa el contenido porque ocupa su propio espacio. */
export function FooterBar({children}: {children: React.ReactNode}) {
  return <View style={styles.footerBar}><View style={styles.footerInner}>{children}</View></View>;
}
export function Segmented({items, value, onChange, testID}: {items: {id: string; name: string}[]; value: string; onChange: (id: string) => void; testID?: string}) {
  return <View testID={testID} accessibilityRole="tablist" style={styles.segmented}>{items.map(item => {
    const on = value === item.id;
    return <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.name} accessibilityState={{selected: on}} onPress={() => onChange(item.id)} style={[styles.segment, on && styles.segmentOn]}>
      <Text numberOfLines={1} style={[styles.segmentText, on && {color: colors.greenDark}]}>{item.name}</Text>
    </Pressable>;
  })}</View>;
}
export function Choice({items, value, onChange}: {items: {id: string; name: string}[]; value: string; onChange: (id: string) => void}) {
  return <View style={styles.wrap}>{items.map(item => {
    const on = value === item.id;
    return <Pressable accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{selected: on}} key={item.id} onPress={() => onChange(item.id)} style={[styles.chip, on && styles.chipOn]}>
      {on && <Feather name="check" size={14} color={colors.white}/>}<Text style={[styles.chipText, on && {color: colors.white}]}>{item.name}</Text>
    </Pressable>;
  })}</View>;
}
export function Divider() { return <View style={styles.divider}/>; }
/** Hoja inferior para formularios y selecciones rápidas. Botón atrás de Android la cierra. */
export function Sheet({visible, onClose, title, subtitle, children, footer}: {visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode}) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable accessibilityLabel="Cerrar" style={styles.scrim} onPress={onClose}/>
      <View style={[styles.sheet, {paddingBottom: Math.max(insets.bottom, 12)}]}>
        <View style={styles.grabber}/>
        <View style={[styles.row, {paddingHorizontal: 20, paddingBottom: 10}]}>
          <View style={{flex: 1, gap: 2}}><Text accessibilityRole="header" style={styles.h2}>{title}</Text>{subtitle && <Text style={styles.small}>{subtitle}</Text>}</View>
          <IconButton icon="x" label="Cerrar" onPress={onClose} size={38}/>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 12, gap: 14}}>{children}</ScrollView>
        {footer && <View style={{paddingHorizontal: 20, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.line}}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
/** Confirmación explícita para acciones definitivas. */
export function Confirm({visible, title, message, confirmText, onConfirm, onCancel, danger, busy, children}: {visible: boolean; title: string; message: string; confirmText: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; busy?: boolean; children?: React.ReactNode}) {
  return <Sheet visible={visible} onClose={onCancel} title={title} footer={<>
    <Button title={confirmText} variant={danger ? 'danger' : 'primary'} size="lg" loading={busy} onPress={onConfirm}/>
    <Button title="Cancelar" variant="outline" onPress={onCancel} disabled={busy}/>
  </>}><Text style={styles.body}>{message}</Text>{children}</Sheet>;
}
/** Selector de cantidad: −  [valor editable]  + */
export function Stepper({value, onChange, onStep, unit, testID, label}: {value: string; onChange: (t: string) => void; onStep: (direction: 1 | -1) => void; unit: string; testID?: string; label: string}) {
  return <View style={styles.stepper}>
    <IconButton icon="minus" label={`Restar ${label}`} onPress={() => onStep(-1)} size={36}/>
    <TextInput testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType="decimal-pad" inputMode="decimal" selectTextOnFocus
      style={[styles.stepperInput, Platform.OS === 'web' && ({outlineStyle: 'none'} as object)]}/>
    <Text style={styles.small}>{unit}</Text>
    <IconButton icon="plus" label={`Sumar ${label}`} onPress={() => onStep(1)} size={36} tone="green"/>
  </View>;
}
/** Barra de progreso indeterminada y discreta: no desplaza el contenido. */
export function ProgressBar({active}: {active: boolean}) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(x, {toValue: 1, duration: 1100, useNativeDriver: Platform.OS !== 'web'}));
    loop.start(); return () => { loop.stop(); x.setValue(0); };
  }, [active, x]);
  if (!active) return null;
  return <View accessibilityLabel="Procesando" style={styles.progress}><Animated.View style={[styles.progressBar, {transform: [{translateX: x.interpolate({inputRange: [0, 1], outputRange: [-160, 520]})}]}]}/></View>;
}

export const styles = StyleSheet.create({
  page: {padding: 16, gap: 16, paddingBottom: 28, width: '100%', maxWidth: 760, alignSelf: 'center'},
  title: {fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: colors.ink},
  eyebrow: {fontSize: 11, fontWeight: '800', letterSpacing: 1.6, color: colors.green},
  h2: {fontSize: 17, fontWeight: '700', color: colors.ink},
  sectionTitle: {fontSize: 15, fontWeight: '800', color: colors.ink, letterSpacing: -0.2},
  body: {fontSize: 15, color: colors.text, lineHeight: 21},
  muted: {fontSize: 14, color: colors.muted, lineHeight: 20},
  small: {fontSize: 13, color: colors.muted},
  label: {fontSize: 13, fontWeight: '700', color: colors.ink},
  hint: {fontSize: 12, color: colors.muted, lineHeight: 17},
  fieldError: {fontSize: 12, color: colors.red, fontWeight: '600'},
  inputBox: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm + 2, backgroundColor: colors.white, minHeight: 50, paddingHorizontal: 14, gap: 8},
  input: {flex: 1, minHeight: 48, color: colors.ink, fontSize: 16, paddingVertical: 0},
  prefix: {fontSize: 16, color: colors.muted, fontWeight: '700'},
  search: {flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 50},
  searchInput: {flex: 1, fontSize: 16, color: colors.ink, minHeight: 48},
  card: {backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12},
  button: {flexDirection: 'row', gap: 8, minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  buttonLg: {minHeight: 58, borderRadius: radius.lg},
  buttonSm: {minHeight: 40, paddingHorizontal: 12, borderRadius: radius.sm},
  buttonText: {fontSize: 15, fontWeight: '700', flexShrink: 1},
  secondary: {backgroundColor: colors.greenSoft},
  badge: {alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4, maxWidth: '100%'},
  badgeText: {fontSize: 12, fontWeight: '700'},
  row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.white},
  chipOn: {backgroundColor: colors.green, borderColor: colors.green},
  chipText: {fontSize: 14, fontWeight: '600', color: colors.ink},
  segmented: {flexDirection: 'row', backgroundColor: '#E7ECE7', borderRadius: radius.md, padding: 4, gap: 4},
  segment: {flex: 1, minHeight: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8},
  segmentOn: {backgroundColor: colors.white, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: {width: 0, height: 1}, elevation: 1},
  segmentText: {fontSize: 14, fontWeight: '700', color: colors.muted},
  metric: {fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.6, fontVariant: ['tabular-nums']},
  stat: {flexGrow: 1, flexBasis: '45%', minWidth: 130, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 6},
  statIcon: {width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  statValue: {fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums']},
  money: {fontVariant: ['tabular-nums'], fontWeight: '700', color: colors.ink},
  divider: {height: 1, backgroundColor: colors.line},
  link: {fontSize: 14, color: colors.green, fontWeight: '700'},
  error: {backgroundColor: colors.redSoft, padding: 14, borderRadius: radius.md, color: colors.red, fontSize: 14, lineHeight: 20},
  empty: {alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed'},
  emptyIcon: {width: 56, height: 56, borderRadius: 28, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4},
  banner: {flexDirection: 'row', gap: 10, padding: 14, borderRadius: radius.md, alignItems: 'flex-start'},
  footerBar: {backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: {width: 0, height: -2}, elevation: 8},
  footerInner: {width: '100%', maxWidth: 760, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12},
  scrim: {flex: 1, backgroundColor: 'rgba(12,28,18,0.45)'},
  sheet: {backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', paddingTop: 8, width: '100%', maxWidth: 640, alignSelf: 'center'},
  grabber: {width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, alignSelf: 'center', marginBottom: 10},
  stepper: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F1F4F1', borderRadius: radius.pill, padding: 4},
  stepperInput: {minWidth: 56, maxWidth: 84, height: 36, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink, backgroundColor: colors.white, borderRadius: radius.sm, paddingHorizontal: 4},
  progress: {position: 'absolute', top: 0, left: 0, right: 0, height: 3, overflow: 'hidden', backgroundColor: colors.greenSoft, zIndex: 20},
  progressBar: {width: 160, height: 3, backgroundColor: colors.green, borderRadius: 2},
  nav: {flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line},
  navItem: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 3, minHeight: 58},
  navText: {fontSize: 11, fontWeight: '700', color: colors.muted},
});
