import ExcelJS from 'exceljs';
import {id,now,audit} from './db.js';
import {digest} from './auth.js';
import {money} from './money.js';
import {once,requireAdmin} from './operations.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const HEADERS=['Descripción','Precio de venta mayoristas'];
const OPTIONAL=['ID producto','Código','Cómo se vende','Modalidad de venta','Unidad de venta','Unidad de medida','Unidad','Modalidad'];
const UNIT_HEADERS=OPTIONAL.slice(2);
const unitValue=v=>['unit','unidad','unidades','por unidad','und','un'].includes(normalize(v))?'unit':['kg','kilogramo','kilogramos','por kilogramo','kilo','kilos'].includes(normalize(v))?'kg':null;
const productState=p=>digest(JSON.stringify([p.id,p.name,p.unit,p.price_cents,p.active,p.code,p.wholesale_price_cents]));
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
  let duplicate=null;const candidate={};sheet.getRow(r).eachCell((cell,col)=>{const name=normalize(textCell(cell));if([...HEADERS,...OPTIONAL].some(h=>normalize(h)===name)){if(candidate[name])duplicate=name;candidate[name]=col;}});
  if(HEADERS.every(h=>candidate[normalize(h)])){if(duplicate)fail(400,'Encabezado duplicado: '+duplicate);headerRow=r;columns=candidate;break;}
 }
 if(!headerRow)fail(400,'No se encontraron todos los encabezados requeridos.');
 const rows=[],codes=new Map(),ids=new Map();
 const unitHeader=UNIT_HEADERS.find(h=>columns[normalize(h)]);
 for(let r=headerRow+1;r<=sheet.rowCount;r++){
  const row=sheet.getRow(r),cell=h=>columns[normalize(h)]?row.getCell(columns[normalize(h)]):{value:null},code=textCell(cell('Código')),name=textCell(cell('Descripción'));
  if(!code&&!name&&cell('Precio de venta mayoristas').value===null)continue;
  const entry={row:r,code,name,source_id:textCell(cell('ID producto')),errors:[],warnings:[]};
  if(code.length>120)entry.errors.push('Código demasiado largo');
  if(!name||name.length>120)entry.errors.push('Descripción obligatoria, máximo 120 caracteres');
  const price=priceCell(cell('Precio de venta mayoristas'));if(price.error)entry.errors.push(price.error);else{entry.new_price_cents=price.cents;if(!price.cents)entry.errors.push('Precio cero: corrige el precio antes de importar');}
  const byCode=code&&db.prepare('SELECT * FROM products WHERE code=?').get(code),byId=entry.source_id&&db.prepare('SELECT * FROM products WHERE id=?').get(entry.source_id);
  const p=byCode||(!code?byId:null);
  if(byCode&&byId&&byCode.id!==byId.id)entry.errors.push('Código e ID corresponden a productos diferentes');
  if(!byCode&&byId&&code)entry.errors.push('El ID existe, pero su código no coincide');
  const explicit=unitHeader?unitValue(textCell(cell(unitHeader))):null;
  entry.unit=explicit||p?.unit||null;entry.needs_unit=!entry.unit;
  if(unitHeader&&!explicit&&textCell(cell(unitHeader)))entry.warnings.push('Modalidad no reconocida: completa unidad o kilogramo en la vista previa');
  if(p){entry.action='update';entry.product_id=p.id;entry.previous_price_cents=p.price_cents;entry.previous_wholesale_cents=p.wholesale_price_cents;entry.previous_unit=p.unit;entry.state_hash=productState(p);entry.unit_locked=!!p.unit&&!!(db.prepare('SELECT id FROM sale_items WHERE product_id=?').get(p.id)||db.prepare('SELECT id FROM inventory_movements WHERE product_id=?').get(p.id));if(entry.unit_locked&&entry.unit!==p.unit)entry.errors.push('La modalidad histórica no se puede cambiar');}
  else{entry.action='create';if(!code)entry.warnings.push('Sin código: se creará con ID interno. Futuras importaciones deben usar ese ID para actualizarlo');}
  if(entry.needs_unit)entry.warnings.push('Selecciona cómo se vende: unidad o kilogramo');
  if(code){if(!codes.has(code))codes.set(code,[]);codes.get(code).push(entry);}
  if(entry.product_id){if(!ids.has(entry.product_id))ids.set(entry.product_id,[]);ids.get(entry.product_id).push(entry);}rows.push(entry);
 }
 for(const entries of [...codes.values(),...ids.values()])if(entries.length>1)for(const entry of entries)if(!entry.errors.includes('Producto o código duplicado en el archivo'))entry.errors.push('Producto o código duplicado en el archivo');
 const preview={format_version:3,header_row:headerRow,unit_column:unitHeader||null,rows,summary:{new:rows.filter(r=>r.action==='create'&&!r.errors.length).length,updates:rows.filter(r=>r.action==='update'&&!r.errors.length).length,omitted:rows.filter(r=>r.errors.length).length}};
 const previewId=id();db.prepare('INSERT INTO import_previews VALUES(?,?,?,?,?,?)').run(previewId,user.id,now(),digest(buffer),JSON.stringify(preview),new Date(Date.now()+3600000).toISOString());return {id:previewId,...preview};
}
export function applyImport(db,user,input){
 return once(db,user,'import',input.request_key,input,()=>{
  const stored=db.prepare('SELECT * FROM import_previews WHERE id=? AND actor_id=?').get(input.preview_id,user.id);if(!stored||stored.expires_at<now())fail(409,'Vista previa vencida o ajena. Vuelve a cargar el archivo.');if(db.prepare('SELECT id FROM import_runs WHERE preview_id=?').get(input.preview_id))fail(409,'Esta vista previa ya se aplicó.');
  const preview=JSON.parse(stored.preview),results=[];if(preview.format_version!==3)fail(409,'La vista previa usa el formato anterior. Vuelve a cargar el Excel.');
  const choices=new Map();for(const choice of input.units||[]){if(choices.has(choice.row)||!preview.rows.some(r=>r.row===choice.row))fail(400,'Modalidades de la vista previa inválidas');choices.set(choice.row,choice.unit);}
  for(const row of preview.rows){
   if(row.errors.length){results.push({...row,status:'omitted'});continue;}
   const unit=choices.get(row.row)||row.unit;if(!['unit','kg'].includes(unit))fail(400,`Completa la modalidad de venta de la fila ${row.row}.`);
   if(row.unit_locked&&unit!==row.previous_unit)fail(409,'No se puede cambiar la modalidad de productos con historial.');
   if(row.action==='update'){
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(row.product_id);if(!product||productState(product)!==row.state_hash)fail(409,`El producto de la fila ${row.row} cambió después de la vista previa. Vuelve a revisarlo.`);
    if(product.unit!==unit&&product.unit&&(db.prepare('SELECT id FROM sale_items WHERE product_id=?').get(product.id)||db.prepare('SELECT id FROM inventory_movements WHERE product_id=?').get(product.id)))fail(409,'La modalidad tiene movimientos nuevos. Revisa la vista previa.');
    db.prepare('UPDATE products SET name=?,price_cents=?,unit=?,updated_at=? WHERE id=?').run(row.name,row.new_price_cents,unit,now(),product.id);
    db.prepare('UPDATE product_price_reviews SET reviewed_at=?,actor_id=?,chosen_price_cents=? WHERE product_id=? AND reviewed_at IS NULL').run(now(),user.id,row.new_price_cents,product.id);
   }else{
    if(row.code&&db.prepare('SELECT id FROM products WHERE code=?').get(row.code))fail(409,`El código ${row.code} ya existe. Vuelve a cargar el archivo.`);
    db.prepare('INSERT INTO products(id,name,price_cents,unit,active,stock_milli,created_at,updated_at,code) VALUES(?,?,?,?,1,0,?,?,?)').run(id(),row.name,row.new_price_cents,unit,now(),now(),row.code||null);
   }
   results.push({...row,unit,status:row.action==='update'?'updated':'created'});
  }
  const runId=id(),result={id:runId,rows:results,summary:{created:results.filter(r=>r.status==='created').length,updated:results.filter(r=>r.status==='updated').length,omitted:results.filter(r=>r.status==='omitted').length}};
  db.prepare('INSERT INTO import_runs VALUES(?,?,?,?,?,?,?)').run(runId,input.preview_id,user.id,now(),input.request_key,digest(JSON.stringify(input)),JSON.stringify(result));audit(db,user.id,'products.import',runId,result.summary);return result;
 });
}
export function importCsv(result){
 const cell=v=>`"${String(v??'').replaceAll('"','""')}"`; // Todos los textos se neutralizan para no ejecutar fórmulas al abrir Excel.
 const safe=v=>typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?'\''+v:v;
 return '\uFEFF'+[['Fila','Código','Descripción','Estado','Precio anterior COP','Precio único COP','Errores'],...result.rows.map(r=>[r.row,r.code,r.name,r.status,r.previous_price_cents==null?'':r.previous_price_cents/100,r.new_price_cents==null?'':r.new_price_cents/100,r.errors.join('; ')])].map(row=>row.map(v=>cell(safe(v))).join(',')).join('\r\n');
}
