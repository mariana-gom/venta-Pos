import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { openDatabase, now } from './db.js';
// En hosting con disco montado, BACKUP_DIR debe apuntar al volumen persistente (p. ej. /data/backups).
const dir=process.env.BACKUP_DIR||'./backups';
const db=openDatabase(); mkdirSync(dir,{recursive:true});
const path=`${dir}/pos-${now().replaceAll(':','-')}.sqlite`;
try {await backup(db,path);console.log(`Copia consistente creada: ${path}`);} finally {db.close();}
