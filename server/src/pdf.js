import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { cop,difference } from './money.js';
import {dayStart,nextDay,businessTimeZone,calendarDay} from './sales-access.js';
const mm=72/25.4;
// Versión en escala de grises del logo oficial, preparada para impresoras térmicas monocromáticas
// (scripts/logo-print.mjs). Proporción original 469×400.
const LOGO=fileURLToPath(new URL('../assets/dannys-logo-print.png',import.meta.url));const LOGO_RATIO=400/469;
// Papel físico → área imprimible habitual (58 → 48 mm, 80 → 72 mm). El contenido nunca sale de esa franja.
const LAYOUT={58:{side:5*mm,body:8,small:7,title:10,total:13,logo:26*mm},80:{side:4*mm,body:9,small:7.5,title:11,total:15,logo:32*mm}};
const TOP=4*mm,BOTTOM=8*mm,GAP=6;
// Las fuentes estándar de PDF usan WinAnsi: los espacios finos de Intl se convierten en espacios normales.
const clean=text=>String(text??'').replace(/[   ]/g,' ');
const font=bold=>bold?'Helvetica-Bold':'Helvetica';
export const receiptNumber=n=>`#${String(n).padStart(4,'0')}`;
const dateOf=value=>new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Bogota'}).format(new Date(value));
const timeOf=value=>new Intl.DateTimeFormat('es-CO',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'America/Bogota'}).format(new Date(value));
const stamp=value=>`${dateOf(value)} ${timeOf(value)}`;
const qty=milli=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(milli/1000);
const shortBrand=name=>/DANNY/i.test(name)?"DANNY'S":name;
// Tipos de línea: {text}, {pair:[izq,der]}, {rule:'dash'|'solid'|'double'}, {space}, {logo}.
// Se mide todo antes de crear la página para que el ticket tenga la altura justa, sin papel vacío ni recortes.
async function build(lines,widthMm,title) {
 const L=LAYOUT[widthMm]||LAYOUT[80];const width=widthMm*mm;const usable=width-2*L.side;
 const measure=new PDFDocument({autoFirstPage:false});
 const textHeight=(text,bold,size,w)=>{measure.font(font(bold)).fontSize(size);return measure.heightOfString(clean(text),{width:w,lineGap:1});};
 const measured=lines.map(line=>{
  const size=line.size||L.body;
  if(line.space!==undefined)return {...line,height:line.space};
  if(line.rule)return {...line,height:line.rule==='double'?9:7};
  if(line.logo)return {...line,height:L.logo*LOGO_RATIO+4};
  if(line.pair){
   const [left,right]=line.pair.map(clean);
   measure.font(font(line.boldRight??line.bold)).fontSize(size);const rightWidth=measure.widthOfString(right);
   measure.font(font(line.bold)).fontSize(size);const leftWidth=measure.widthOfString(left);
   // Si no caben en una línea, el valor baja a la siguiente alineado a la derecha.
   if(leftWidth+GAP+rightWidth<=usable)return {...line,size,stacked:false,height:textHeight(left,line.bold,size,usable)+2};
   return {...line,size,stacked:true,leftHeight:textHeight(left,line.bold,size,usable),height:textHeight(left,line.bold,size,usable)+textHeight(right,line.boldRight??line.bold,size,usable)+2};
  }
  return {...line,size,height:textHeight(line.text,line.bold,size,usable)+2};
 });
 const height=Math.max(120,measured.reduce((sum,line)=>sum+line.height,TOP+BOTTOM));measure.end();
 // Límite PDF 14400 pt; tickets extensos se dividen automáticamente en hojas del mismo ancho.
 const pageHeight=Math.min(height,14000);
 const doc=new PDFDocument({size:[width,pageHeight],margins:{top:TOP,bottom:0,left:L.side,right:L.side},info:{Title:title,Author:'DANNY\'S POS'}});
 const chunks=[];const done=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 let y=TOP;const x=L.side;
 for(const line of measured) {
  if(y+line.height>pageHeight-TOP){doc.addPage();y=TOP;}
  if(line.rule){
   doc.lineWidth(line.rule==='dash'?0.5:0.9);if(line.rule==='dash')doc.dash(1.5,{space:1.5});
   doc.moveTo(x,y+3).lineTo(x+usable,y+3).stroke();if(line.rule==='double')doc.moveTo(x,y+6).lineTo(x+usable,y+6).stroke();doc.undash();
  } else if(line.logo){
   doc.image(LOGO,x+(usable-L.logo)/2,y,{width:L.logo});
  } else if(line.pair){
   const [left,right]=line.pair.map(clean);
   doc.font(font(line.bold)).fontSize(line.size).text(left,x,y,{width:usable,lineGap:1});
   doc.font(font(line.boldRight??line.bold)).fontSize(line.size).text(right,x,line.stacked?y+line.leftHeight:y,{width:usable,lineGap:1,align:'right'});
  } else if(line.text!==undefined){
   doc.font(font(line.bold)).fontSize(line.size).text(clean(line.text),x,y,{width:usable,lineGap:1,align:line.align||'left'});
  }
  y+=line.height;
 }
 doc.end();return done;
}
// Encabezado común: logo, nombre y solo los datos del negocio que estén configurados (nunca se inventan).
function businessHeader(s,L) {
 const lines=[{logo:true},{space:2},{text:s.business_name,bold:true,size:L.title,align:'center'}];
 if(s.business_nit)lines.push({text:`NIT ${s.business_nit}`,align:'center',size:L.small});
 const place=[s.business_address,s.business_city].filter(Boolean).join(' · ');
 if(place)lines.push({text:place,align:'center',size:L.small});
 if(s.business_phone)lines.push({text:`Tel. ${s.business_phone}`,align:'center',size:L.small});
 return lines;
}
export async function receiptPdf(sale,width=58) {
 const L=LAYOUT[width]||LAYOUT[80];const s=sale.snapshot;
 const lines=[...businessHeader(s,L),{space:4},{rule:'solid'},
  {text:'COMPROBANTE DE VENTA',bold:true,align:'center',size:L.small+0.5},{text:`Venta ${receiptNumber(sale.number)}`,bold:true,size:L.total,align:'center'},{rule:'solid'},
  {pair:['Fecha',dateOf(sale.created_at)],boldRight:true},{pair:['Hora',timeOf(sale.created_at)],boldRight:true},{pair:['Vendedor',s.seller_name],boldRight:true}];
 if(sale.session_number)lines.push({pair:['Caja',`#${sale.session_number}`],boldRight:true});
 if(sale.cancellation)lines.push({text:'ANULADA',bold:true,align:'center',size:L.total},{text:`${sale.cancellation.actor_name} · ${stamp(sale.cancellation.created_at)}`},{text:'Motivo: '+sale.cancellation.reason});
 if(s.customer_identification)lines.push({pair:['Identificación',s.customer_identification]});
 lines.push({space:3},{pair:['Cliente',s.customer_name],boldRight:true},{pair:['Ciudad',s.customer_city],boldRight:true},{rule:'dash'},{pair:['PRODUCTO','VALOR'],bold:true,size:L.small},{rule:'dash'});
 for(const item of sale.items){
  const unit=item.unit==='kg'?'kg':'und';
  lines.push({text:item.name.toUpperCase(),bold:true},{pair:[`${qty(item.quantity_milli)} ${unit} × ${cop(item.price_cents)}${item.unit==='kg'?'/kg':''}`,cop(item.subtotal_cents)],boldRight:true},{space:3});
 }
 const count=sale.items.length;
 lines.push({rule:'double'},{pair:['TOTAL',cop(sale.total_cents)],bold:true,size:L.total},{rule:'double'},
  {pair:['Productos',String(count)]});
 for(const p of sale.payments){
  lines.push({pair:['Método de pago',p.method==='cash'?'EFECTIVO':p.method==='credit'?'CRÉDITO':(p.platform_name||'ELECTRÓNICO').toUpperCase()],boldRight:true});
  if(p.method==='electronic'&&p.reference)lines.push({pair:['Número de referencia',p.reference],boldRight:true});
  if(p.method==='credit')lines.push({text:'Valor pendiente de pago. No recibido en caja.',size:L.small});
 }
 lines.push({rule:'dash'},{space:2},{text:`¡Gracias por comprar en ${shortBrand(s.business_name)}!`,bold:true,align:'center'},{space:3},
  {text:'Comprobante de venta.',align:'center',size:L.small},{text:'No es factura electrónica.',align:'center',size:L.small});
 return build(lines,width,`Venta ${receiptNumber(sale.number)}`);
}
export async function closurePdf(closure,width=58) {
 const L=LAYOUT[width]||LAYOUT[80];const s=closure.snapshot;const signed=n=>`${n>0?'+':''}${cop(n)}`;
 const lines=[...businessHeader(s,L),{space:4},{rule:'solid'},{text:'CIERRE DE CAJA',bold:true,align:'center',size:L.small+0.5},{text:`Cierre ${receiptNumber(closure.number)}`,bold:true,size:L.total,align:'center'},{rule:'solid'}];
 if(closure.session_number)lines.push({pair:['Caja',`#${closure.session_number}`],boldRight:true});
 lines.push({pair:['Apertura',stamp(s.opened_at)],boldRight:true},{pair:['Cierre',stamp(s.closed_at)],boldRight:true},{pair:['Abrió',s.opener_name],boldRight:true},{pair:['Cerró',s.admin_name],boldRight:true},{pair:['Ventas',String(s.sale_count)],boldRight:true},
  {rule:'dash'},{pair:['Saldo inicial',cop(s.opening_cents)]},{pair:['Ventas efectivo',cop(s.sales_cash_cents??s.cash_cents)]},{pair:['Ventas electrónicas',cop(s.sales_electronic_cents??s.electronic_cents)]},
  {rule:'double'},{pair:['TOTAL VENTAS',cop(s.total_cents)],bold:true,size:L.title},{rule:'double'},
  {text:'EFECTIVO',bold:true},{pair:['Esperado (con saldo)',cop(s.expected_cash_cents)]},{pair:['Contado',cop(s.declared_cash_cents)]},{pair:['Diferencia',signed(s.cash_difference_cents)],bold:true},{text:difference(s.cash_difference_cents),size:L.small},
  {rule:'dash'},{text:'ELECTRÓNICO',bold:true},{pair:['Registrado',cop(s.electronic_cents)]},{pair:['Verificado',cop(s.declared_electronic_cents)]},{pair:['Diferencia',signed(s.electronic_difference_cents)],bold:true},{text:difference(s.electronic_difference_cents),size:L.small},
  {rule:'dash'},{pair:['DIFERENCIA TOTAL',signed(s.total_difference_cents)],bold:true},{text:difference(s.total_difference_cents),size:L.small});
 if(s.platforms.length)lines.push({rule:'dash'},{text:'POR PLATAFORMA',bold:true},...s.platforms.map(p=>({pair:[p.platform_name,cop(p.amount)]})));
 if(s.credit_cents!==undefined)lines.push({rule:'dash'},{text:'CRÉDITO Y COBROS DE CARTERA',bold:true},{pair:['Crédito registrado',cop(s.credit_cents)]},{pair:['Crédito reportado',cop(s.declared_credit_cents||0)]},{pair:['Diferencia crédito',signed(s.credit_difference_cents||0)]},{pair:['Cobros cartera efectivo',cop(s.collection_cash_cents||0)]},{pair:['Cobros cartera electrónico',cop(s.collection_electronic_cents||0)]},{pair:['Devoluciones efectivo',cop(s.refund_cash_cents||0)]},{pair:['Devoluciones electrónico',cop(s.refund_electronic_cents||0)]});
 if(s.inventory?.route_name){
  const qty=(n,u)=>new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(n/1000)+' '+(u==='kg'?'kg':'und');
  lines.push({rule:'dash'},{text:'CIERRE DE INVENTARIO',bold:true},{text:s.inventory.route_name,bold:true});
  if(s.inventory.shared)lines.push({text:s.inventory.message,size:L.small});
  for(const p of s.inventory.items||[])lines.push({text:p.name,bold:true},{pair:['Cargado + apertura',qty(p.opening_milli+p.loaded_milli,p.unit)]},{pair:['Vendido',qty(p.sold_milli,p.unit)]},{pair:['Esperado',qty(p.expected_milli,p.unit)]},{pair:['Recibido / devuelto',qty(p.received_milli,p.unit)],bold:true},{pair:['Diferencia',qty(p.difference_milli,p.unit)]},...(p.observation?[{text:p.observation,size:L.small}]:[]));
 }
 if(s.notes)lines.push({rule:'dash'},{text:'Observaciones',bold:true},{text:s.notes});
 lines.push({rule:'dash'},{text:'Valores originales del cierre. Las diferencias se concilian por separado.',size:L.small,align:'center'});
 return build(lines,width,`Cierre ${receiptNumber(closure.number)}`);
}

export async function statementPdf(account,settings,period={}) {
 const zone=businessTimeZone(),range=statementPeriod(account,period,zone);
 const {initial,events,final}=range;
 const doc=new PDFDocument({size:'A4',margin:42,info:{Title:'Extracto de cartera',Author:settings.business_name}}),chunks=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const header=()=>{doc.font('Helvetica-Bold').fontSize(15).text(clean(settings.business_name));doc.font('Helvetica').fontSize(10).text(clean([settings.business_nit&&'NIT '+settings.business_nit,settings.business_address,settings.business_city,settings.business_phone].filter(Boolean).join(' · '))).moveDown();};
 header();doc.font('Helvetica-Bold').fontSize(18).text('Créditos y cartera').moveDown(.5);doc.font('Helvetica').fontSize(11).text(clean(`Cliente: ${account.customer.name}`)).text(clean(account.customer.identification?`Identificación: ${account.customer.identification}`:`Cuenta: ${account.customer.id.slice(0,8)} · ${account.customer.city}`)).text(range.from&&range.to?`Periodo: ${range.from} - ${range.to}`:'Sin movimientos de cartera para este cliente.').text(`Generado: ${new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:zone}).format(new Date())}`).text(clean(`Saldo inicial: ${cop(initial)}`)).moveDown();
 if(!account.events.length&&range.from&&range.to)doc.text('Sin movimientos de cartera para este cliente.').moveDown();
 if(!events.length&&account.events.length)doc.text('Sin movimientos en el periodo seleccionado.').moveDown();
 const columns=[42,160,207,288,374],widths=[110,42,75,80,179];
 const row=(values,bold=false)=>{const start=doc.y;doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(9);const height=Math.max(...values.map((v,i)=>doc.heightOfString(clean(v),{width:widths[i]})))+8;if(start+height>doc.page.height-55){doc.addPage();header();return row(values,bold);}values.forEach((v,i)=>doc.text(clean(v),columns[i],start,{width:widths[i],align:i>=2?'right':'left'}));doc.y=start+height;};
 row(['Fecha / movimiento','Factura','Cargo','Abono','Saldo'],true);
 let balance=initial;
 for(const event of events){balance+=event.charge_cents-event.payment_cents;const date=new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:zone}).format(new Date(event.at));row([`${date}\n${event.description}`,receiptNumber(event.invoice),cop(event.charge_cents),cop(event.payment_cents),cop(balance)]);}
 doc.moveDown();doc.x=42;doc.font('Helvetica-Bold').fontSize(12).text(clean(`Saldo final: ${cop(final)}`));doc.font('Helvetica').fontSize(9).moveDown().text('Los abonos conservan el valor original de cada factura. Extracto informativo; no es factura electrónica.');doc.end();return result;
}

export function statementPeriod(account,period={},zone=businessTimeZone()){
 const start=period.from?dayStart(period.from,zone):null,end=period.to?dayStart(nextDay(period.to),zone):null;
 const initial=account.events.filter(e=>start&&e.at<start).reduce((n,e)=>n+e.charge_cents-e.payment_cents,0);
 const events=account.events.filter(e=>(!start||e.at>=start)&&(!end||e.at<end));
 const firstInvoice=account.events.find(e=>e.type==='credit'),last=account.events.at(-1);
 return {from:period.from||(firstInvoice?calendarDay(firstInvoice.at,zone):null),to:period.to||(last?calendarDay(last.at,zone):null),initial,events,final:initial+events.reduce((n,e)=>n+e.charge_cents-e.payment_cents,0)};
}
