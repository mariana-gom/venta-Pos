import express from 'express';
import {chromium} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
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
let browser;
try{
 execFileSync('npm',['exec','-w','mobile','--','expo','export','--clear','--platform','web','--output-dir',join(directory,'web')],{cwd:root,env:{...process.env,EXPO_PUBLIC_API_URL:origin},stdio:'pipe'});
 const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password})});const {token}=await login.json();
 async function seed(path,body){const r=await fetch(origin+'/api'+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json();}
 await seed('/products',{name:'Producto unidad',price:'5000',unit:'unit'});await seed('/products',{name:'Queso campesino',price:'24000',unit:'kg'});await seed('/customers',{name:'Ana',city:'Bogotá'});
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const {expect}=await import('@playwright/test');
 await page.goto(origin);await page.getByLabel('Usuario',{exact:true}).fill('seller-test');await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar a mi negocio'}).click();
 await expect(page.getByText('Hola, Vendedora')).toBeVisible();await expect(page.getByTestId('logout-header')).toBeVisible();
 await page.getByRole('button',{name:'Abrir mi caja',exact:true}).click();await page.getByRole('button',{name:'Abrir caja',exact:true}).click();await expect(page.getByText('Mi sesión abierta')).toBeVisible();
 await page.getByRole('tab',{name:'Vender'}).click();await page.getByText('Ana',{exact:true}).click();await page.getByText('Producto unidad',{exact:true}).click();await page.getByText('Queso campesino',{exact:true}).click();
 await page.getByLabel('Cantidad en unidades enteras').fill('3');await page.getByLabel('Peso en kilogramos (ej. 0,250)').fill('1,5');
 await page.getByRole('button',{name:'Electrónico',exact:true}).click();await page.getByRole('button',{name:'Nequi',exact:true}).click();
 // Crear cliente desde la venta mantiene cantidades y carrito.
 await page.getByRole('button',{name:'+ Crear cliente'}).click();await page.getByLabel('Nombre',{exact:true}).fill('Cliente nuevo');await page.getByLabel('Ciudad',{exact:true}).fill('Medellín');await page.getByRole('button',{name:'Crear y seleccionar'}).click();await expect(page.getByLabel('Cantidad en unidades enteras')).toHaveValue('3');
 await page.getByRole('button',{name:'Revisar venta'}).click();await page.getByRole('button',{name:'Confirmar y generar comprobante'}).click();await expect(page.getByText('Venta #1',{exact:true})).toBeVisible();await expect(page.getByText('Cliente nuevo',{exact:true}).filter({visible:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Abrir o guardar PDF'}).click();await(await download).saveAs(join(directory,'sale.pdf'));
 mkdirSync(join(root,'output','screenshots'),{recursive:true});await page.screenshot({path:join(root,'output','screenshots','venta-mobile.png'),fullPage:true});
 await page.reload();await expect(page.getByText('Hola, Vendedora')).toBeVisible();await page.getByRole('tab',{name:'Caja',exact:true}).click();await expect(page.getByText('1 ventas', {exact:false})).toBeVisible();
 const previousToken=await page.evaluate(()=>sessionStorage.getItem('pos-token'));await page.getByTestId('logout-header').click();await expect(page.getByRole('button',{name:'Entrar a mi negocio'})).toBeVisible();if(await page.evaluate(()=>sessionStorage.getItem('pos-token'))!==null)throw new Error('La sesión local no se eliminó.');const revoked=await fetch(origin+'/api/me',{headers:{Authorization:`Bearer ${previousToken}`}});if(revoked.status!==401)throw new Error('El token anterior sigue activo.');await page.reload();await expect(page.getByRole('button',{name:'Entrar a mi negocio'})).toBeVisible();await page.getByLabel('Usuario',{exact:true}).fill('admin-test');await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar a mi negocio'}).click();await expect(page.getByText('Hola, Administradora')).toBeVisible();
 await page.getByRole('tab',{name:'Caja',exact:true}).click();await page.getByRole('button',{name:'Conciliar y cerrar',exact:true}).click();await page.getByLabel('Efectivo físico contado (incluye saldo inicial)').fill('0');await page.getByLabel('Pagos electrónicos verificados en cuentas (COP)').fill('51000');await page.getByRole('button',{name:'Revisar conciliación'}).click();await page.getByRole('button',{name:'Confirmar cierre definitivo'}).click();await expect(page.getByText('Cierre #1',{exact:true})).toBeVisible();
 await page.screenshot({path:join(root,'output','screenshots','cierre-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Ver ventas incluidas'}).click();await expect(page.getByText('Venta #1',{exact:true})).toBeVisible();
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('E2E móvil web: login, apertura, carrito por unidad/peso, cliente en flujo, Nequi, venta, PDF, reinicio, cambio de usuario, cierre y detalle verificados.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));db.close();rmSync(directory,{recursive:true,force:true});}
