import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {money,quantity,subtotal} from '../src/money.js';
import {receiptPdf,receiptNumber} from '../src/pdf.js';
const item=(name,unit,price,qty)=>{const price_cents=money(price),quantity_milli=quantity(qty,unit);return {id:name,name,unit,price_cents,quantity_milli,subtotal_cents:subtotal(price_cents,quantity_milli)};};
const sale=(items,extra={})=>({id:'s',number:25,session_id:'00000000-0000-4000-8000-000000000000',session_number:3,created_at:'2026-10-11T04:38:00.000Z',total_cents:items.reduce((n,i)=>n+i.subtotal_cents,0),items,payments:[{method:'cash',platform_name:null}],snapshot:{business_name:"DISTRIBUIDORA & SALSAMENTARIA DANNY'S",customer_name:'Manuel',customer_city:'El Rosal',seller_name:'Mariana',...extra}});
// Medida real del ancho de página: 58 mm = 164,41 pt; 80 mm = 226,77 pt.
const mediaWidth=pdf=>Number(/\/MediaBox \[0 0 ([\d.]+)/.exec(pdf.toString('latin1'))[1]);
test('Comprobante: kg decimales, unidades, nombres largos, muchos artículos y ambos anchos',async()=>{
 const example=[item('Pollo','kg','12000','125,5'),item('Gaseosa','unit','4000','3')];
 assert.equal(example[0].subtotal_cents,150600000);assert.equal(example[1].subtotal_cents,1200000);assert.equal(sale(example).total_cents,151800000);
 for(const [q,cents] of [['0,25',300000],['0.5',600000],['1,75',2100000],['2,3',2760000]])assert.equal(item('Pollo','kg','12000',q).subtotal_cents,cents);
 assert.equal(receiptNumber(25),'#0025');
 const long=[...example,item('Chorizo santarrosano artesanal ahumado extra picante de la casa x 500 g','unit','18500','2')];
 const many=Array.from({length:40},(_,i)=>item(`Producto de prueba ${i+1}`,i%2?'kg':'unit','9990',i%2?'0,375':'2'));
 const output=process.env.PDF_OUTPUT_DIR;if(output)mkdirSync(output,{recursive:true});
 for(const width of [58,80]){
  for(const [name,items,extra] of [['ejemplo',example,{}],['fiscal',long,{business_nit:'900.123.456-7',business_address:'Calle 10 # 5-20',business_city:'El Rosal',business_phone:'300 123 4567'}],['muchos',many,{}]]){
   const pdf=await receiptPdf(sale(items,extra),width);
   assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(Math.abs(mediaWidth(pdf)-width*72/25.4)<0.01);
   if(output)writeFileSync(join(output,`comprobante-${name}-${width}mm.pdf`),pdf);
  }
 }
});
