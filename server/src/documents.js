import {id,now} from './db.js';
import {receiptPdf,closurePdf} from './pdf.js';
export async function storedPdf(db,kind,record,width){
 const column=kind==='sale'?'sale_id':'closure_id';
 const existing=db.prepare(`SELECT content FROM documents WHERE ${column}=? AND width=?`).get(record.id,width);
 if(existing)return Buffer.from(existing.content);
 const content=await(kind==='sale'?receiptPdf(record,width):closurePdf(record,width));
 db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?,?)').run(id(),kind==='sale'?record.id:null,kind==='closure'?record.id:null,width,content,now());
 return Buffer.from(db.prepare(`SELECT content FROM documents WHERE ${column}=? AND width=?`).get(record.id,width).content);
}
export async function generateDocuments(db,kind,record){
 try{for(const width of [58,80])await storedPdf(db,kind,record,width);return {pdf_status:'ready'};}
 catch(error){console.error('La operación se guardó; PDF pendiente:',error.message);return {pdf_status:'pending',pdf_message:'La operación quedó guardada. No se pudo generar el PDF; reintenta desde el historial.'};}
}
