// Formato y lectura de valores en convenciones colombianas. Sin aritmética de punto flotante:
// cantidades en milésimas y dinero en centavos, igual que la API (server/src/money.js).
const TZ = 'America/Bogota';
export const cop = (cents: number) => new Intl.NumberFormat('es-CO', {style: 'currency', currency: 'COP', maximumFractionDigits: 2}).format(cents / 100);
export const date = (value: string) => new Intl.DateTimeFormat('es-CO', {dateStyle: 'medium', timeStyle: 'short', timeZone: TZ}).format(new Date(value));
export const time = (value: string) => new Intl.DateTimeFormat('es-CO', {hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ}).format(new Date(value));
export const shortDate = (value: string) => new Intl.DateTimeFormat('es-CO', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ}).format(new Date(value));
export const longToday = () => new Intl.DateTimeFormat('es-CO', {dateStyle: 'full', timeZone: TZ}).format(new Date());
export const signed = (value: number) => `${value > 0 ? '+' : ''}${cop(value)}`;
export const diff = (value: number) => value === 0 ? 'Sin diferencia' : `${value > 0 ? 'Sobrante' : 'Faltante'} de ${cop(Math.abs(value))}`;
export const receiptNumber = (n: number) => `#${String(n).padStart(4, '0')}`;
export const unitLabel = (unit: string) => unit === 'kg' ? 'kg' : 'und';

/** Fecha calendario de Colombia (AAAA-MM-DD), desplazada en días. */
export function bogotaDay(offsetDays = 0, from = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ}).format(from);
  const d = new Date(`${parts}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
/** "Hoy", "Ayer" o "sábado, 10 de octubre" para agrupar el historial. */
export function dayLabel(value: string) {
  const day = bogotaDay(0, new Date(value));
  if (day === bogotaDay(0)) return 'Hoy';
  if (day === bogotaDay(-1)) return 'Ayer';
  return new Intl.DateTimeFormat('es-CO', {weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ}).format(new Date(value));
}
export const isIsoDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T12:00:00Z`).getTime());

/**
 * Cantidad escrita por el usuario → milésimas. Acepta coma o punto decimal ("0,25", "1.5", "125,5").
 * Unidades deben ser enteras. Devuelve null si no es válida.
 */
export function parseQuantity(text: string, unit: 'unit' | 'kg'): number | null {
  const value = text.trim().replace(/\s/g, '');
  const match = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const milli = Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0'));
  if (milli <= 0) return null;
  if (unit === 'unit' && milli % 1000 !== 0) return null;
  return milli;
}
/** Milésimas → texto para la API ("125.5"); la API acepta punto o coma. */
export function quantityForApi(milli: number) {
  const whole = Math.floor(milli / 1000), fraction = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
/** Milésimas → texto para mostrar o editar ("125,5"). */
export function quantityText(milli: number) {
  return quantityForApi(milli).replace('.', ',');
}
export const quantityLabel = (milli: number, unit: string) => `${new Intl.NumberFormat('es-CO', {maximumFractionDigits: 3}).format(milli / 1000)} ${unitLabel(unit)}`;

/**
 * Dinero escrito por el usuario → texto normalizado para la API ("12000.5"), o null.
 * Acepta separadores de miles colombianos: "12.000", "1.500.000", "12.000,50", "$ 4.000".
 */
export function normalizeMoney(text: string): string | null {
  const value = text.trim().replace(/[\s$]/g, '');
  const match = /^(\d{1,3}(?:[.,]\d{3})+|\d{1,12})(?:[.,](\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const whole = match[1].replace(/[.,]/g, '');
  if (whole.length > 10) return null;
  return match[2] ? `${whole}.${match[2]}` : whole;
}
export function moneyToCents(text: string): number | null {
  const normalized = normalizeMoney(text);
  if (normalized === null) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
/** Centavos → texto editable sin separadores ("12000" o "12000,5"). */
export const moneyInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(/0$/, '')).replace('.', ',');

/** Subtotal con el mismo redondeo de la API: (precio × milésimas + 500) / 1000, en enteros. */
export function lineSubtotal(priceCents: number, milli: number) {
  return Number((BigInt(priceCents) * BigInt(milli) + 500n) / 1000n);
}
/** Búsqueda sin tildes ni mayúsculas: "jamon" encuentra "Jamón". */
export const normalizeSearch = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Tamaño de fuente que hace caber montos largos en espacios angostos (320 px) sin cortarlos. */
export const fitSize = (text: string, base: number, room = 10) => Math.max(14, Math.round(base - Math.max(0, text.length - room) * base * 0.075));
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
