import ExcelJS from 'exceljs';
import {id,now,audit} from './db.js';
import {digest} from './auth.js';
import {money} from './money.js';
import {once,requireAdmin} from './operations.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const HEADERS=['ID producto','Código','Descripción','Categoría','Marca','Precio de venta mayoristas'];
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function textCell(cell){
 const v=cell.value;if(v===null||v===undefined)return '';
 if(typeof v==='string')return v.trim();
 if(typeof v==='number'){
  // Un número que Excel muestra con máscara 0000 conserva ese código, sin añadir ceros por nuestra cuenta.
  if(/^0+$/.test(cell.numFmt||''))return String(v).padStart(cell.numFmt.length,'0');
  return Number.isSafeInteger(v)?String(v):'';
 }
 if(v.richText)return v.richText.map(t=>t.text).join('').trim();return '';
}
function priceCell(cell){
 let value=cell.value;
 if(value&&typeof value==='object'){
  if(value.error)return {error:'Error de Excel en precio mayorista'};
  if(value.formula||value.sharedFormula){if(typeof value.result!=='number'||!Number.isFinite(value.result))return {error:'Fórmula mayorista sin resultado numérico válido'};value=value.result;}
  else return {error:'Precio mayorista no numérico'};
 }
 if(value===null||value===undefined||value==='')return {error:'Precio mayorista vacío'};
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return {error:'Precio mayorista no numérico o negativo'};
 const decimal=value.toFixed(2);if(Math.abs(Number(decimal)-value)>0.000001)return {error:'Precio mayorista con más de dos decimales'};
 try{return {cents:money(decimal),review:value===0};}catch{return {error:'Precio mayorista fuera de rango'};}
}
export async function previewImport(db,user,buffer){
 requireAdmin(user);if(buffer.length>5*1024*1024)fail(400,'Máximo 5 MB.');
 let wb=new ExcelJS.Workbook();try{await wb.xlsx.load(buffer);}catch{fail(400,'El archivo debe ser un Excel .xlsx válido.');}
 const sheet=wb.getWorksheet('Productos');if(!sheet)fail(400,'Falta la hoja Productos.');if(sheet.rowCount>10001)fail(400,'Máximo 10.000 filas de productos.');
 let headerRow=0,columns={};
 for(let r=1;r<=sheet.rowCount;r++){
  let duplicate=null;const candidate={};sheet.getRow(r).eachCell((cell,col)=>{const name=normalize(textCell(cell));if(HEADERS.some(h=>normalize(h)===name)){if(candidate[name])duplicate=name;candidate[name]=col;}});
  if(HEADERS.every(h=>candidate[normalize(h)])){if(duplicate)fail(400,'Encabezado duplicado: '+duplicate);headerRow=r;columns=candidate;break;}
 }
 if(!headerRow)fail(400,'No se encontraron todos los encabezados requeridos.');
 const rows=[],codes=new Map();
 for(let r=headerRow+1;r<=sheet.rowCount;r++){
  const row=sheet.getRow(r),cell=h=>row.getCell(columns[normalize(h)]),code=textCell(cell('Código')),name=textCell(cell('Descripción'));
  if(!code&&!name&&cell('Precio de venta mayoristas').value===null)continue;
  const entry={row:r,code,name,category:textCell(cell('Categoría')),brand:textCell(cell('Marca')),source_id:textCell(cell('ID producto')),errors:[],warnings:[]};
  if(!code)entry.errors.push('Código obligatorio');if(code.length>120)entry.errors.push('Código demasiado largo');
  const price=priceCell(cell('Precio de venta mayoristas'));if(price.error)entry.errors.push(price.error);else{entry.new_price_cents=price.cents;if(price.review)entry.warnings.push('Precio cero: requiere revisión explícita');}
  const byCode=code&&db.prepare('SELECT * FROM products WHERE code=?').get(code),byId=entry.source_id&&db.prepare('SELECT * FROM products WHERE id=?').get(entry.source_id);
  if(byCode){entry.product_id=byCode.id;entry.previous_price_cents=byCode.wholesale_price_cents;entry.action='update';if(byId&&byId.id!==byCode.id)entry.errors.push('Código e ID corresponden a productos diferentes');}
  else if(byId){entry.errors.push('El ID existe, pero su código no coincide; corrige el código en el catálogo antes de importar');entry.action='skip';}
  else{entry.action='create';if(!name)entry.errors.push('Descripción obligatoria');if(!entry.category)entry.errors.push('Categoría obligatoria');if(!entry.brand)entry.errors.push('Marca obligatoria');for(const [label,value] of [['Descripción',name],['Categoría',entry.category],['Marca',entry.brand]])if(value.length>120)entry.errors.push(label+': máximo 120 caracteres');entry.warnings.push('Borrador inactivo: precio normal y unidad pendientes');}
  if(code){if(!codes.has(code))codes.set(code,[]);codes.get(code).push(entry);}rows.push(entry);
 }
 for(const entries of codes.values())if(entries.length>1)for(const entry of entries)entry.errors.push('Código duplicado en el archivo');
 const preview={header_row:headerRow,rows,summary:{new:rows.filter(r=>r.action==='create'&&!r.errors.length).length,updates:rows.filter(r=>r.action==='update'&&!r.errors.length).length,omitted:rows.filter(r=>r.errors.length).length}};
 const previewId=id();db.prepare('INSERT INTO import_previews VALUES(?,?,?,?,?,?)').run(previewId,user.id,now(),digest(buffer),JSON.stringify(preview),new Date(Date.now()+3600000).toISOString());return {id:previewId,...preview};
}
export function applyImport(db,user,input){
 return once(db,user,'import',input.request_key,input,()=>{
  const stored=db.prepare('SELECT * FROM import_previews WHERE id=? AND actor_id=?').get(input.preview_id,user.id);if(!stored||stored.expires_at<now())fail(409,'Vista previa vencida o ajena. Vuelve a cargar el archivo.');if(db.prepare('SELECT id FROM import_runs WHERE preview_id=?').get(input.preview_id))fail(409,'Esta vista previa ya se aplicó.');
  const preview=JSON.parse(stored.preview),results=[];
  for(const row of preview.rows){
   if(row.errors.length||row.new_price_cents===0&&!input.reviewed_zero_rows.includes(row.row)){results.push({...row,status:'omitted'});continue;}
   if(row.action==='update'){
    const product=db.prepare('SELECT * FROM products WHERE id=? AND code=?').get(row.product_id,row.code);if(!product||product.wholesale_price_cents!==row.previous_price_cents)fail(409,`El producto ${row.code} cambió después de la vista previa. Vuelve a revisarlo.`);
    db.prepare('UPDATE products SET wholesale_price_cents=? WHERE id=?').run(row.new_price_cents,product.id);
   }else{
    if(db.prepare('SELECT id FROM products WHERE code=?').get(row.code))fail(409,`El código ${row.code} ya existe. Vuelve a cargar el archivo.`);
    db.prepare('INSERT INTO products(id,name,price_cents,unit,active,stock_milli,created_at,updated_at,code,category,brand,wholesale_price_cents) VALUES(?,?,NULL,NULL,0,NULL,?,?,?,?,?,?)').run(id(),row.name,now(),now(),row.code,row.category,row.brand,row.new_price_cents);
   }
   results.push({...row,status:row.action==='update'?'updated':'created'});
  }
  const runId=id(),result={id:runId,rows:results,summary:{created:results.filter(r=>r.status==='created').length,updated:results.filter(r=>r.status==='updated').length,omitted:results.filter(r=>r.status==='omitted').length}};
  db.prepare('INSERT INTO import_runs VALUES(?,?,?,?,?,?,?)').run(runId,input.preview_id,user.id,now(),input.request_key,digest(JSON.stringify(input)),JSON.stringify(result));audit(db,user.id,'products.import',runId,result.summary);return result;
 });
}
export function importCsv(result){
 const cell=v=>`"${String(v??'').replaceAll('"','""')}"`; // Todos los textos se neutralizan para no ejecutar fórmulas al abrir Excel.
 const safe=v=>typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?'\''+v:v;
 return '\uFEFF'+[['Fila','Código','Descripción','Estado','Mayorista anterior COP','Mayorista nuevo COP','Errores'],...result.rows.map(r=>[r.row,r.code,r.name,r.status,r.previous_price_cents==null?'':r.previous_price_cents/100,r.new_price_cents==null?'':r.new_price_cents/100,r.errors.join('; ')])].map(row=>row.map(v=>cell(safe(v))).join(',')).join('\r\n');
}
