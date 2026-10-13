import * as Crypto from 'expo-crypto';
// Modo ruta: la app sigue vendiendo sin señal. Guarda en el celular una copia del catálogo y una cola de ventas
// que se suben solas al recuperar internet. Cada venta conserva su referencia única (request_key), así que los
// reintentos nunca la duplican en el servidor.
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {Asset} from 'expo-asset';
import {cop, quantityLabel, receiptNumber, shortDate, time} from './format';
import type {CashSession, Customer, Platform as PayPlatform, Product, Sale, Settings, User} from './types';

import {read, write} from './storage';

// ── Copia local de lo necesario para vender sin señal.
export type Cache = {user: User; products: Product[]; customers: Customer[]; platforms: PayPlatform[]; sessions: CashSession[]; settings: Settings; saved_at: string};
export const loadCache = () => read<Cache>('cache');
export const saveCache = (cache: Cache | null) => write('cache', cache);

// ── Cola de ventas pendientes por usuario (las de un vendedor nunca se suben con el usuario de otro).
export type QueuedSale = {
  key: string; provisional: string; created_at: string; body: Record<string, unknown>;
  /** Vista de la venta para el comprobante y el historial mientras no se sube. */
  sale: Sale; error?: string;
};
export type Synced = {provisional: string; number: number; id: string; at: string};
export const loadQueue = async (userId: string) => (await read<QueuedSale[]>(`queue-${userId}`)) || [];
export const saveQueue = (userId: string, queue: QueuedSale[]) => write(`queue-${userId}`, queue);
export const loadSynced = async (userId: string) => (await read<Synced[]>(`synced-${userId}`)) || [];
export const saveSynced = (userId: string, list: Synced[]) => write(`synced-${userId}`, list.slice(0, 50));

/** Número provisional por celular: R-7KQ-0001. Se imprime en el comprobante hecho sin señal. */
export async function nextProvisional() {
  let device = await read<{code: string; counter: number}>('device');
  if (!device) device = {code: Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, 'X'), counter: 0};
  device.counter += 1; await write('device', device);
  return `R-${device.code}-${String(device.counter).padStart(4, '0')}`;
}

// ── Comprobante generado en el celular: no necesita el servidor. Mismo diseño del PDF térmico (server/src/pdf.js).
let logo = '';
async function logoDataUri() {
  if (logo) return logo;
  try {
    const asset = Asset.fromModule(require('../assets/brand/dannys-logo-print.png')); await asset.downloadAsync();
    if (Platform.OS === 'web') {
      const blob = await (await fetch(asset.localUri || asset.uri)).blob();
      logo = await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(blob); });
    } else logo = 'data:image/png;base64,' + await FileSystem.readAsStringAsync(asset.localUri!, {encoding: FileSystem.EncodingType.Base64});
  } catch { logo = ''; }
  return logo;
}
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]!));
export const saleTitle = (sale: Sale) => sale.number ? receiptNumber(sale.number) : sale.snapshot.offline_ref || '';
export async function receiptHtml(sale: Sale, width: 58 | 80) {
  const s = sale.snapshot, body = width === 58 ? 48 : 72, size = width === 58 ? 11 : 12.5;
  const pair = (l: string, r: string, cls = '') => `<div class="pair ${cls}"><span>${esc(l)}</span><b>${esc(r)}</b></div>`;
  const place = [s.business_address, s.business_city].filter(Boolean).join(' · ');
  const img = await logoDataUri();
  const items = (sale.items || []).map(i => `<div class="item"><b>${esc(i.name.toUpperCase())}</b>${pair(`${quantityLabel(i.quantity_milli, i.unit)} × ${cop(i.price_cents)}${i.unit === 'kg' ? '/kg' : ''}`, cop(i.subtotal_cents))}</div>`).join('');
  const payments = (sale.payments || []).map(p => (p.method==='electronic'&&p.reference?pair('Número de referencia',p.reference):'')+pair('Método de pago', p.method === 'cash' ? 'EFECTIVO' : p.method==='credit'?'CRÉDITO': (p.platform_name || 'ELECTRÓNICO').toUpperCase())).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${width}mm auto;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#000;font-size:${size}px;line-height:1.35}
.t{width:${body}mm;margin:3mm auto 8mm}.c{text-align:center}.logo{display:block;margin:0 auto 2px;width:${width === 58 ? 26 : 32}mm}
.pair{display:flex;justify-content:space-between;gap:8px}.pair b{text-align:right}.solid{border-top:1.5px solid #000;margin:5px 0}
.dash{border-top:1px dashed #000;margin:5px 0}.double{border-top:1.5px solid #000;border-bottom:1.5px solid #000;height:4px;margin:5px 0}
.big{font-size:${size + 5}px;font-weight:700}.small{font-size:${size - 2}px}.item{margin-bottom:4px}.total{font-size:${size + 4}px;font-weight:800}
</style></head><body><div class="t">
${img ? `<img class="logo" src="${img}">` : ''}<div class="c"><b>${esc(s.business_name)}</b></div>
${s.business_nit ? `<div class="c small">NIT ${esc(s.business_nit)}</div>` : ''}${place ? `<div class="c small">${esc(place)}</div>` : ''}${s.business_phone ? `<div class="c small">Tel. ${esc(s.business_phone)}</div>` : ''}
<div class="solid"></div><div class="c small"><b>COMPROBANTE DE VENTA</b></div><div class="c big">Venta ${esc(saleTitle(sale))}</div>
${!sale.number ? '<div class="c small">Número provisional · venta hecha sin señal</div>' : s.offline_ref ? `<div class="c small">Ref. ruta ${esc(s.offline_ref)}</div>` : ''}
<div class="solid"></div>${pair('Fecha', shortDate(sale.created_at))}${pair('Hora', time(sale.created_at))}${pair('Vendedor', s.seller_name)}${sale.session_number ? pair('Caja', '#' + sale.session_number) : ''}
<div style="height:4px"></div>${pair('Cliente', s.customer_name)}${pair('Ciudad', s.customer_city)}
<div class="dash"></div>${pair('PRODUCTO', 'VALOR', 'small')}<div class="dash"></div>${items}
<div class="double"></div><div class="pair total"><span>TOTAL</span><span>${esc(cop(sale.total_cents))}</span></div><div class="double"></div>
${pair('Productos', String(sale.items?.length || 0))}${payments}<div class="dash"></div>
<div class="c"><b>¡Gracias por comprar en ${esc(/DANNY/i.test(s.business_name) ? "DANNY'S" : s.business_name)}!</b></div>
<div class="c small" style="margin-top:4px">Comprobante de venta.<br>No es factura electrónica.</div></div></body></html>`;
}
/**
 * Imprime o comparte el comprobante sin internet. En Android usa el servicio de impresión del sistema: con una app
 * de impresión Bluetooth (p. ej. RawBT) emparejada con la impresora térmica, imprime directo en ruta.
 */
export async function printLocal(sale: Sale, width: 58 | 80, action: 'print' | 'share') {
  const html = await receiptHtml(sale, width);
  if (Platform.OS === 'web') {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(frame);
    frame.srcdoc = html;
    await new Promise<void>(resolve => { frame.onload = () => resolve(); });
    frame.contentWindow?.focus(); frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000); return;
  }
  const mmToPt = (mm: number) => Math.round(mm * 72 / 25.4);
  if (action === 'print') { await Print.printAsync({html, width: mmToPt(width)}); return; }
  const {uri} = await Print.printToFileAsync({html, width: mmToPt(width)});
  try {
    if (!await Sharing.isAvailableAsync()) throw new Error('Este celular no permite compartir archivos.');
    await Sharing.shareAsync(uri, {mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Compartir comprobante'});
  } finally { await FileSystem.deleteAsync(uri, {idempotent: true}); }
}

let devicePromise:Promise<string>|undefined;
export function deviceId(){return devicePromise??=(async()=>{let value=await read<string>('installation-id');if(!value){value=Crypto.randomUUID();await write('installation-id',value);}return value;})();}
const queueLocks=new Map<string,Promise<unknown>>();
export async function withQueueLock<T>(userId:string,fn:()=>Promise<T>):Promise<T>{
 if(Platform.OS==='web'&&typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request('pos-queue-'+userId,fn);
 const previous=queueLocks.get(userId)||Promise.resolve();const result=previous.catch(()=>{}).then(fn);queueLocks.set(userId,result);try{return await result;}finally{if(queueLocks.get(userId)===result)queueLocks.delete(userId);}
}
export async function setSessionFreeze(sessionId:string,epoch:number,state:'active'|'preparing'|'closed'){const previous=await read<{epoch:number;state:string}|number>('freeze-'+sessionId);if(previous&&typeof previous==='object'&&previous.epoch>epoch)return false;await write('freeze-'+sessionId,{epoch,state});return true;}
export async function sessionFreeze(sessionId:string){const value=await read<{epoch:number;state:string}|number>('freeze-'+sessionId);return typeof value==='number'?value:value&&value.state!=='active'?value.epoch||1:null;}
export const updateQueue=(userId:string,fn:(queue:QueuedSale[])=>QueuedSale[])=>withQueueLock(userId,async()=>{const result=fn(await loadQueue(userId));await saveQueue(userId,result);return result;});
