import {createInterface} from 'node:readline/promises';
import {emitKeypressEvents} from 'node:readline';
import {openDatabase} from './db.js';
import {createUser} from './auth.js';

function readPassword() {
 process.stdout.write('Contraseña (12–128 caracteres, entrada oculta): ');
 emitKeypressEvents(process.stdin);
 return new Promise((resolve,reject)=>{
  let value='';const wasRaw=!!process.stdin.isRaw;
  function cleanup(){process.stdin.off('keypress',onKey);process.stdin.setRawMode(wasRaw);process.stdin.pause();process.stdout.write('\n');}
  function onKey(text,key={}){
   if(key.ctrl&&key.name==='c'){cleanup();reject(Object.assign(new Error('Configuración cancelada.'),{exitCode:130}));return;}
   if(key.name==='return'||key.name==='enter'){cleanup();resolve(value);return;}
   if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
   if(text&&!key.ctrl&&!key.meta&&!text.includes('\u001b'))value+=text;
  }
  process.stdin.on('keypress',onKey);process.stdin.setRawMode(true);process.stdin.resume();
 });
}
async function inputValue(envKey,label,check){
 if(process.env[envKey]!==undefined){const value=process.env[envKey].trim();const error=check(value);if(error)throw new Error(error);return value;}
 if(!process.stdin.isTTY)throw new Error(`Falta ${envKey}. Ejecuta el asistente en una terminal interactiva.`);
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{for(;;){const value=(await rl.question(label)).trim();const error=check(value);if(!error)return value;console.error(error);}}
 finally{rl.close();}
}
async function main(){
 const db=openDatabase();
 try{
  if(db.prepare("SELECT id FROM users WHERE role='admin'").get()){
   console.log('Ya existe un administrador. Puedes iniciar la aplicación con npm run dev.');return;
  }
  const username=await inputValue('ADMIN_USERNAME','Usuario administrador (ej. admin): ',value=>/^[a-zA-Z0-9_.-]{3,40}$/.test(value)?null:'El usuario debe tener 3–40 caracteres: letras, números, punto, guion o guion bajo, sin espacios.');
  const name=await inputValue('ADMIN_NAME','Nombre: ',value=>value.length>=1&&value.length<=120?null:'El nombre debe tener entre 1 y 120 caracteres.');
  let password=process.env.ADMIN_PASSWORD;
  if(password!==undefined&&(password.length<12||password.length>128))throw new Error('ADMIN_PASSWORD debe tener entre 12 y 128 caracteres.');
  if(password===undefined){
   if(!process.stdin.isTTY)throw new Error('Falta ADMIN_PASSWORD. Ejecuta el asistente en una terminal interactiva.');
   for(;;){password=await readPassword();if(password.length>=12&&password.length<=128)break;console.error('La contraseña debe tener entre 12 y 128 caracteres. Inténtalo nuevamente.');}
  }
  await createUser(db,{username,name,password,role:'admin'});
  console.log('Administrador creado. Guarda tus credenciales y ejecuta npm run dev desde la carpeta del proyecto.');
 }finally{db.close();}
}
main().catch(error=>{
 const message=error.code?.startsWith('ERR_SQLITE')?'No se pudo guardar el administrador. Comprueba que el usuario no exista y que la base permita escritura.':error.message;
 console.error(`No se creó el administrador: ${message}`);process.exitCode=error.exitCode||1;
});
