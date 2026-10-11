import {spawn} from 'node:child_process';
import {createServer,createConnection} from 'node:net';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
const root=fileURLToPath(new URL('../',import.meta.url));
const envPath=join(root,'server','.env');const configured=existsSync(envPath)?parseEnv(readFileSync(envPath,'utf8')):{};
const apiPort=Number(configured.PORT||process.env.PORT||4317);const webPort=8097;
async function assertFree(port){
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error(`Puerto inválido: ${port}`);
 for(const host of ['127.0.0.1','::1'])await new Promise((resolve,reject)=>{
  const socket=createConnection({port,host});
  socket.setTimeout(1000);
  socket.once('connect',()=>{socket.destroy();reject(new Error(`El puerto ${port} está ocupado. No se detuvo ningún otro proceso.`));});
  socket.once('error',error=>{socket.destroy();if(['ECONNREFUSED','EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code))resolve();else reject(error);});
  socket.once('timeout',()=>{socket.destroy();reject(new Error(`No se pudo comprobar el puerto ${port}.`));});
 });
 for(const host of ['0.0.0.0','::'])await new Promise((resolve,reject)=>{
  const probe=createServer();probe.once('error',error=>{
   if(host==='::'&&['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code)){resolve();return;}
   reject(new Error(error.code==='EADDRINUSE'?`El puerto ${port} está ocupado. Cierra tu instancia anterior de este proyecto o usa las terminales que ya están abiertas; no se detuvo ningún proceso.`:`No se pudo comprobar el puerto ${port}: ${error.message}`));
  });
  probe.listen({port,host,ipv6Only:host==='::'},()=>probe.close(resolve));
 });
}
const children=[];let stopping=false;
function stop(code){
 if(stopping)return;stopping=true;process.exitCode=code;
 for(const child of children){if(child.exitCode!==null)continue;try{if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')console.error('No se pudo detener un proceso de esta ejecución:',error.message);}}
}
try{
 // No iniciar ninguno de los componentes si sus puertos ya están en uso.
 await assertFree(apiPort);await assertFree(webPort);
 console.log(`Iniciando API en ${apiPort} e interfaz en http://localhost:${webPort}. Ctrl+C detiene solo esta ejecución.`);
 for(const args of [['run','server'],['run','web','-w','mobile']]){
  const child=spawn(process.platform==='win32'?'npm.cmd':'npm',args,{cwd:root,stdio:'inherit',detached:process.platform!=='win32'});children.push(child);
  child.once('error',error=>{console.error(error.message);stop(1);});child.once('exit',(code,signal)=>{if(!stopping)stop(code|| (signal?1:0));});
 }
 process.once('SIGINT',()=>stop(130));process.once('SIGTERM',()=>stop(143));
}catch(error){console.error(error.message);process.exitCode=1;}
