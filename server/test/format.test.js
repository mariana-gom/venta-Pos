import test from 'node:test';
import assert from 'node:assert/strict';
import {subtotal} from '../src/money.js';
// Lectura de cantidades y dinero de la app móvil: debe coincidir con la API.
import {parseQuantity,quantityForApi,quantityText,normalizeMoney,moneyToCents,lineSubtotal} from '../../mobile/src/format.ts';
test('App: cantidades decimales colombianas sin errores de punto flotante',()=>{
 for(const [text,milli] of [['0,25',250],['0.5',500],['1,75',1750],['2,3',2300],['1,1',1100],['125,5',125500],[' 3 ',3000],['1.005',1005]])assert.equal(parseQuantity(text,'kg'),milli,text);
 for(const text of ['','0','0,0','-1','1,2345','abc','1,5,5','1.500,5'])assert.equal(parseQuantity(text,'kg'),null,text);
 assert.equal(parseQuantity('3','unit'),3000);assert.equal(parseQuantity('1,5','unit'),null);
 assert.equal(quantityForApi(125500),'125.5');assert.equal(quantityForApi(3000),'3');assert.equal(quantityText(250),'0,25');
});
test('App: montos con separadores de miles y subtotal igual al de la API',()=>{
 for(const [text,api] of [['12.000','12000'],['$ 1.500.000','1500000'],['12.000,50','12000.50'],['4000','4000'],['1,5','1.5'],['12,000','12000']])assert.equal(normalizeMoney(text),api,text);
 for(const text of ['','abc','1.2.3','12.00.000'])assert.equal(normalizeMoney(text),null,text);
 assert.equal(moneyToCents('50.000'),5000000);
 for(const [price,milli] of [[1200000,125500],[2400000,250],[999,375],[1,1],[10_000_000_000,9_999_999_999]])assert.equal(lineSubtotal(price,milli),Number((BigInt(price)*BigInt(milli)+500n)/1000n));
 assert.equal(lineSubtotal(1200000,125500),subtotal(1200000,125500));
});
