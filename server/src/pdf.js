import PDFDocument from 'pdfkit';
import { cop,colombiaDate,difference } from './money.js';
const mm=72/25.4;
// Medir todas las líneas antes de crear la página evita papel vacío y recortes.
async function build(lines,widthMm,title) {
 const width=widthMm*mm;const margin=8;const usable=width-2*margin;
 const measure=new PDFDocument({autoFirstPage:false});
 const measured=lines.map(line=>{
  const spec=typeof line==='string'?{text:line}:line;
  measure.font(spec.bold?'Helvetica-Bold':'Helvetica').fontSize(spec.size||8);
  return {...spec,height:spec.rule?8:measure.heightOfString(spec.text,{width:usable,lineGap:1})+4};
 });
 const height=Math.max(120,measured.reduce((sum,line)=>sum+line.height,margin*2));measure.end();
 // Límite PDF 14400 pt; tickets extensos se dividen automáticamente en hojas del mismo ancho.
 const pageHeight=Math.min(height,14000);
 const doc=new PDFDocument({size:[width,pageHeight],margins:{top:margin,bottom:margin,left:margin,right:margin},info:{Title:title,Author:'Venta POS'}});
 const chunks=[];const done=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 let y=margin;
 for(const line of measured) {
  if(y+line.height>pageHeight-margin){doc.addPage();y=margin;}
  if(line.rule){doc.moveTo(margin,y+2).lineTo(width-margin,y+2).lineWidth(0.4).stroke();}
  else doc.font(line.bold?'Helvetica-Bold':'Helvetica').fontSize(line.size||8).text(line.text,margin,y,{width:usable,lineGap:1,align:line.align||'left'});
  y+=line.height;
 }
 doc.end();return done;
}
export async function receiptPdf(sale,width=58) {
 const s=sale.snapshot;const lines=[{text:s.business_name,bold:true,size:11,align:'center'}, {text:`VENTA #${sale.number}`,bold:true,align:'center'},colombiaDate(sale.created_at),`Caja: ${sale.session_id}`,`Cliente: ${s.customer_name}`,`Ciudad: ${s.customer_city}`,`Vendedor: ${s.seller_name}`,{rule:true}];
 for(const item of sale.items){
  const qty=new Intl.NumberFormat('es-CO',{maximumFractionDigits:3}).format(item.quantity_milli/1000);
  lines.push({text:item.name,bold:true},`${qty} ${item.unit==='kg'?'kg':'und'} × ${cop(item.price_cents)}${item.unit==='kg'?'/kg':'/und'}`,{text:cop(item.subtotal_cents),align:'right'});
 }
 lines.push({rule:true},{text:`TOTAL: ${cop(sale.total_cents)}`,bold:true,size:11});
 for(const p of sale.payments)lines.push(`Pago: ${p.method==='cash'?'Efectivo':'Electrónico'}`,...(p.platform_name?[`Plataforma: ${p.platform_name}`]:[]));
 lines.push({rule:true},{text:'Comprobante de venta. No es factura electrónica.',size:7,align:'center'},{text:'Gracias por tu compra',align:'center'});
 return build(lines,width,`Venta ${sale.number}`);
}
export async function closurePdf(closure,width=58) {
 const s=closure.snapshot;const signed=n=>`${n>0?'+':''}${cop(n)}`;
 const lines=[{text:s.business_name,bold:true,size:11,align:'center'},{text:`CIERRE #${closure.number}`,bold:true,align:'center'},`Caja: ${s.session_id}`,`Apertura: ${colombiaDate(s.opened_at)}`,`Cierre: ${colombiaDate(s.closed_at)}`,`Abrió: ${s.opener_name}`,`Administrador: ${s.admin_name}`,`Ventas: ${s.sale_count}`,{rule:true},`Saldo inicial: ${cop(s.opening_cents)}`,`Ventas efectivo: ${cop(s.cash_cents)}`,`Ventas electrónicas: ${cop(s.electronic_cents)}`,{text:`Total ventas: ${cop(s.total_cents)}`,bold:true},{rule:true},{text:'EFECTIVO',bold:true},`Esperado (incluye saldo): ${cop(s.expected_cash_cents)}`,`Declarado: ${cop(s.declared_cash_cents)}`,{text:`Diferencia: ${signed(s.cash_difference_cents)}`,bold:true},difference(s.cash_difference_cents),{rule:true},{text:'ELECTRÓNICO',bold:true},`Registrado: ${cop(s.electronic_cents)}`,`Verificado: ${cop(s.declared_electronic_cents)}`,{text:`Diferencia: ${signed(s.electronic_difference_cents)}`,bold:true},difference(s.electronic_difference_cents),{rule:true},{text:`Diferencia total: ${signed(s.total_difference_cents)}`,bold:true},difference(s.total_difference_cents)];
 if(s.platforms.length)lines.push({rule:true},{text:'POR PLATAFORMA',bold:true},...s.platforms.map(p=>`${p.platform_name}: ${cop(p.amount)}`));
 if(s.notes)lines.push({rule:true},{text:'Observaciones',bold:true},s.notes);
 lines.push({rule:true},{text:'Valores originales del cierre. Las diferencias se concilian por separado.',size:7});
 return build(lines,width,`Cierre ${closure.number}`);
}
