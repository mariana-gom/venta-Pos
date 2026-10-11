import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { id, now, audit, transaction } from './db.js';
const scrypt = promisify(scryptCallback);
const options = {N:131072,r:8,p:1,maxmem:256*1024*1024};
export const digest = text => createHash('sha256').update(text).digest('hex');
export async function hashPassword(password) {
 const salt = randomBytes(16).toString('hex');
 const hash = await scrypt(password,salt,64,options);
 return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verify(password, encoded) {
 const [,salt,hash] = encoded.split(':');
 const actual = await scrypt(password,salt,64,options);
 return timingSafeEqual(actual,Buffer.from(hash,'hex'));
}
export function publicUser(user) { return {id:user.id,name:user.name,username:user.username,role:user.role,active:user.active}; }
export async function createUser(db, input, actor=null) {
 const passwordHash = await hashPassword(input.password);
 return transaction(db,()=>{
  const user = {id:id(),name:input.name,username:input.username,role:input.role,active:1};
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(user.id,user.username,user.name,passwordHash,user.role,1,now());
  audit(db,actor,'user.create',user.id,{username:user.username,role:user.role});
  return user;
 });
}
export async function login(db, username, password) {
 const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
 // Igualar el coste de cuentas inexistentes para reducir enumeración.
 const dummy = 'scrypt:00000000000000000000000000000000:'+ '00'.repeat(64);
 const ok = await verify(password,user?.password_hash || dummy);
 if (!user?.active || !ok) throw Object.assign(new Error('Usuario o contraseña incorrectos.'),{status:401});
 const token = randomBytes(32).toString('hex');
 db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now());
 db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(digest(token),user.id,new Date(Date.now()+12*60*60*1000).toISOString());
 audit(db,user.id,'auth.login',user.id);
 return {token,user:publicUser(user)};
}
export function authenticate(db) {
 return (req,res,next)=>{
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const user = token && db.prepare('SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(digest(token),now());
  if (!user) return res.status(401).json({error:'Sesión vencida. Inicia sesión nuevamente.'});
  req.user=publicUser(user); req.tokenHash=digest(token); next();
 };
}
export const admin = (req,res,next) => req.user.role==='admin'?next():res.status(403).json({error:'Esta operación requiere administrador.'});
