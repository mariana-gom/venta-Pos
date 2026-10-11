import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { openDatabase, now } from './db.js';
const db=openDatabase(); mkdirSync('./backups',{recursive:true});
const path=`./backups/pos-${now().replaceAll(':','-')}.sqlite`;
try {await backup(db,path);console.log(`Copia consistente creada: ${path}`);} finally {db.close();}
