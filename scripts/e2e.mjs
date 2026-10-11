import express from 'express';
import {chromium} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {openDatabase} from '../server/src/db.js';
import {createApp} from '../server/src/app.js';
import {createUser} from '../server/src/auth.js';
const root=fileURLToPath(new URL('../',import.meta.url));mkdirSync(join(root,'tmp'),{recursive:true});
const directory=mkdtempSync(join(root,'tmp','e2e-'));const db=openDatabase(join(directory,'test.sqlite'));
const password=randomBytes(24).toString('hex');
const admin=await createUser(db,{name:'Administradora prueba',username:'admin-test',password,role:'admin'});
await createUser(db,{name:'Vendedora prueba',username:'seller-test',password,role:'seller'});
const app=express();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${server.address().port}`;process.env.CORS_ORIGINS=origin;
app.use(express.static(join(directory,'web')));app.use(createApp(db));
const shots=join(root,'output','screenshots');mkdirSync(shots,{recursive:true});
const WIDTHS=[320,360,390,430,768,1280];
let browser,page;
try{
 execFileSync('npm',['exec','-w','mobile','--','expo','export','--clear','--platform','web','--output-dir',join(directory,'web')],{cwd:root,env:{...process.env,EXPO_PUBLIC_API_URL:origin},stdio:'pipe'});
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password})});const {token}=await login.json();
 async function call(path,body){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json();}
 // Ejemplo del negocio: pollo por kg y gaseosa por unidad con stock controlado.
 await call('/products',{name:'Pollo',price:'12000',unit:'kg'});await call('/products',{name:'Gaseosa',price:'4000',unit:'unit',stock:'10'});
 await call('/products',{name:'Queso campesino',price:'24000',unit:'kg'});await call('/products',{name:'Chorizo santarrosano artesanal ahumado extra picante de la casa x 500 g',price:'18500',unit:'unit'});
 await call('/customers',{name:'Ana',city:'Bogotá'});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,acceptDownloads:true});page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const {expect}=await import('@playwright/test');
 const id=t=>page.getByTestId(t);
 const total=async()=>(await id('sale-total').innerText()).replace(/\s/g,' ');
 // Captura en todos los anchos y falla si aparece desplazamiento horizontal.
 async function capture(name){
  for(const width of WIDTHS){
   await page.setViewportSize({width,height:width>=768?900:780});await page.waitForTimeout(150);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
   if(overflow>1)throw new Error(`${name} @${width}px desborda ${overflow}px en horizontal`);
   await page.screenshot({path:join(shots,`${name}-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:844});
 }
 async function signIn(user){await page.getByLabel('Usuario',{exact:true}).fill(user);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar'}).click();}

 await page.goto(origin);await expect(page.getByRole('button',{name:'Entrar'})).toBeVisible();await capture('login');
 await page.getByLabel('Usuario',{exact:true}).fill('seller-test');await page.getByLabel('Contraseña',{exact:true}).fill('incorrecta');await page.getByRole('button',{name:'Entrar'}).click();await expect(page.getByText('Usuario o contraseña incorrectos.')).toBeVisible();
 await signIn('seller-test');
 await expect(page.getByText('Hola, Vendedora')).toBeVisible();await expect(id('cash-closed-card')).toBeVisible();await capture('inicio-sin-caja');
 // Apertura de caja con monto inicial colombiano.
 await id('open-cash-home').click();await id('opening-amount').fill('50.000');await id('open-cash').click();await expect(id('own-session')).toBeVisible();await expect(id('own-session')).toContainText('$ 50.000');await capture('caja-abierta');
 // Venta: cliente, kg decimales y unidades.
 await id('tab-sale').click();await capture('vender-catalogo');
 await id('customer-picker').click();await page.getByRole('button',{name:'Ana, Bogotá'}).click();await expect(id('customer-picker')).toContainText('Ana');
 await id('product-search').fill('pol');await id('add-Pollo').click();await id('quantity-input').fill('125,5');await expect(id('quantity-save')).toContainText('1.506.000');await id('quantity-save').click();
 await page.getByRole('button',{name:'Borrar búsqueda'}).click();for(let i=0;i<3;i++)await id('add-Gaseosa').click();
 if(!(await total()).includes('1.518.000'))throw new Error('Total esperado $ 1.518.000, obtenido '+await total());
 // Decimales con punto, coma y valores sin error de punto flotante (1,1 kg).
 await id('add-Queso campesino').click();for(const [q,v] of [['0,25','6.000'],['0.5','12.000'],['1,1','26.400'],['2,3','55.200']]){await id('quantity-input').fill(q);await expect(id('quantity-save')).toContainText(v);}await id('quantity-save').click();
 await id('add-Chorizo santarrosano artesanal ahumado extra picante de la casa x 500 g').click();
 // Modificación del carrito: sumar, restar, editar y quitar.
 await id('sale-tabs').getByRole('tab',{name:/En la venta/}).click();await capture('vender-carrito');
 await page.getByRole('button',{name:'Sumar Unidades de Gaseosa'}).click();await expect(id('qty-Gaseosa')).toHaveValue('4');await page.getByRole('button',{name:'Restar Unidades de Gaseosa'}).click();await expect(id('qty-Gaseosa')).toHaveValue('3');
 await page.getByRole('button',{name:'Quitar Queso campesino'}).click();await page.getByRole('button',{name:'Quitar Chorizo santarrosano artesanal ahumado extra picante de la casa x 500 g'}).click();
 await expect(id('qty-Pollo')).toHaveValue('125,5');if(!(await total()).includes('1.518.000'))throw new Error('Total tras editar: '+await total());
 // Crear cliente sin abandonar la venta conserva el carrito.
 await id('customer-picker').click();await id('customer-new').click();await page.getByLabel('Nombre del cliente').fill('Manuel');await page.getByLabel('Ciudad o municipio').fill('El Rosal');await id('customer-create').click();
 await expect(id('customer-picker')).toContainText('Manuel');await expect(id('qty-Gaseosa')).toHaveValue('3');
 // Pago electrónico y confirmación con doble clic: debe existir una sola venta.
 await id('checkout').click();await page.getByRole('radio',{name:'Nequi'}).click();await capture('vender-pago');
 await id('confirm-sale').dblclick();await expect(id('sale-done')).toBeVisible();await expect(id('done-total')).toContainText('1.518.000');await capture('venta-registrada');
 const sales=await call('/sales');if(sales.count!==1)throw new Error(`Se esperaban 1 venta, hay ${sales.count}`);
 const gaseosa=(await call('/products')).find(p=>p.name==='Gaseosa');if(gaseosa.stock_milli!==7000)throw new Error('Stock de gaseosa no actualizado: '+gaseosa.stock_milli);
 // Comprobante: vista previa con datos guardados y descarga del PDF.
 await id('sale-view-receipt').click();await expect(id('receipt-preview')).toBeVisible();await expect(id('receipt-preview')).toContainText('Venta #0001');await expect(id('receipt-preview')).toContainText('125,5 kg');await expect(id('receipt-preview')).toContainText('No es factura electrónica.');await capture('comprobante');
 const download=page.waitForEvent('download');await id('receipt-pdf').click();await(await download).saveAs(join(directory,'sale.pdf'));
 // Segunda venta en efectivo con cálculo de cambio.
 await id('tab-sale').click();await id('customer-picker').click();await page.getByRole('button',{name:'Ana, Bogotá'}).click();await id('add-Gaseosa').click();await id('checkout').click();await page.getByRole('radio',{name:'Efectivo'}).click();
 await id('cash-received').fill('10.000');await expect(id('cash-change')).toContainText('6.000');await id('confirm-sale').click();await expect(id('sale-done')).toContainText('Cambio para el cliente');
 // Historial con filtros y persistencia tras recarga.
 await id('tab-history').click();await expect(id('sale-row-1')).toBeVisible();await expect(id('history-total')).toContainText('1.522.000');await capture('historial');
 await page.getByRole('button',{name:'Efectivo',exact:true}).click();await expect(id('history-total')).toContainText('4.000');await expect(id('sale-row-1')).toHaveCount(0);
 await page.reload();await expect(page.getByText('Hola, Vendedora')).toBeVisible();await expect(id('stat-total')).toContainText('1.522.000');await capture('inicio');
 await id('tab-catalog').click();await capture('catalogo');
 // Modo ruta: sin señal se sigue vendiendo; las ventas quedan en el celular y se suben al reconectar.
 await context.setOffline(true);
 await id('tab-sale').click();await id('customer-picker').click();await page.getByRole('button',{name:'Ana, Bogotá'}).click();
 await id('add-Pollo').click();await id('quantity-input').fill('1');await id('quantity-save').click();await id('checkout').click();await page.getByRole('radio',{name:'Efectivo'}).click();await id('confirm-sale').click();
 await expect(id('sale-done')).toContainText('¡Venta guardada!');await expect(id('sale-done')).toContainText('R-');await expect(id('sync-status')).toContainText('1');await capture('ruta-venta-sin-senal');
 // Cliente nuevo creado sin señal: viaja con la venta.
 await id('sale-new').click();await id('customer-picker').click();await id('customer-new').click();await page.getByLabel('Nombre del cliente').fill('Tienda La Ruta');await page.getByLabel('Ciudad o municipio').fill('Madrid');await id('customer-create').click();
 await expect(id('customer-picker')).toContainText('Tienda La Ruta');await id('add-Pollo').click();await id('quantity-input').fill('1');await id('quantity-save').click();await id('checkout').click();await page.getByRole('radio',{name:'Efectivo'}).click();await id('confirm-sale').click();
 await expect(id('sync-status')).toContainText('2');
 await id('tab-history').click();await expect(page.getByText('Por subir (2)')).toBeVisible();await capture('ruta-por-subir');
 if((await call('/sales')).count!==2)throw new Error('Una venta sin señal llegó al servidor antes de tiempo.');
 await context.setOffline(false);await id('sync-status').click();await expect(id('sync-status')).toHaveCount(0,{timeout:20000});
 const afterSync=await call('/sales');if(afterSync.count!==4)throw new Error(`Se esperaban 4 ventas tras sincronizar, hay ${afterSync.count}`);
 if(!(await call('/customers')).some(c=>c.name==='Tienda La Ruta'))throw new Error('El cliente creado sin señal no llegó al servidor.');
 // Cerrar sesión desde Perfil revoca el token.
 const previousToken=await page.evaluate(()=>sessionStorage.getItem('pos-token'));await id('profile-button').click();await capture('perfil-vendedor');await id('logout').click();await page.getByRole('button',{name:'Cerrar sesión'}).last().click();
 await expect(page.getByRole('button',{name:'Entrar'})).toBeVisible();if(await page.evaluate(()=>sessionStorage.getItem('pos-token'))!==null)throw new Error('La sesión local no se eliminó.');
 const revoked=await fetch(origin+'/api/me',{headers:{Authorization:`Bearer ${previousToken}`}});if(revoked.status!==401)throw new Error('El token anterior sigue activo.');
 // Administrador: datos del comprobante, cierre de caja con diferencias y detalle.
 await signIn('admin-test');await expect(page.getByText('Hola, Administradora')).toBeVisible();
 await id('profile-button').click();await page.getByRole('button',{name:'Datos del negocio'}).click();await page.getByLabel('NIT o identificación (opcional)').fill('900.123.456-7');await page.getByLabel('Ciudad (opcional)').fill('El Rosal');await id('settings-save').click();await expect(page.getByText('NIT 900.123.456-7')).toBeVisible();await capture('perfil-admin');
 await id('tab-cash').click();await capture('caja-admin');await page.getByRole('button',{name:'Cerrar caja'}).click();
 await id('close-cash').fill('78.000');await page.getByRole('button',{name:/Coincide con lo registrado/}).click();await expect(page.getByText('Cuadra exacto').first()).toBeVisible();await capture('caja-cierre');
 await id('review-close').click();await page.getByRole('button',{name:'Confirmar cierre definitivo'}).click();await expect(id('closure-detail')).toBeVisible();await expect(page.getByText('Cierre #0001')).toBeVisible();await capture('cierre');
 await page.getByRole('button',{name:'Ver ventas incluidas'}).click();await expect(id('sale-row-1')).toBeVisible();
 await id('tab-catalog').click();await id('catalog-Gaseosa').click();await expect(id('catalog-stock')).toHaveValue('6');await capture('catalogo-editar');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(`E2E móvil web: login, apertura, venta kg/unidades/decimales, carrito, cliente en flujo, doble clic sin duplicar, stock, comprobante y PDF, cambio en efectivo, filtros, recarga, logout, datos fiscales y cierre, y modo ruta sin señal (venta, cliente nuevo, sincronización) verificados. Capturas en ${WIDTHS.join(', ')} px.`);
}catch(error){if(page)await page.screenshot({path:join(shots,'fallo.png'),fullPage:true}).catch(()=>{});throw error;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));db.close();rmSync(directory,{recursive:true,force:true});}
