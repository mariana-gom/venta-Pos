import {openDatabase} from './db.js';
import {createApp} from './app.js';
const db=openDatabase();const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||4317);
const server=createApp(db).listen(port,host,()=>console.log(`API POS: http://${host}:${port}. Base persistente preparada.`));
server.on('error',error=>{console.error(`No se inició el servidor: ${error.code}. No se detuvo ningún otro proceso.`);db.close();process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
