import test from 'node:test';
import assert from 'node:assert/strict';
import { money, quantity, subtotal } from '../src/money.js';
import { openDatabase } from '../src/db.js';
import { createUser, login, digest } from '../src/auth.js';
test('Caso 1: 5000 × 3 = 15000',()=>assert.equal(subtotal(money('5000'),quantity('3','unit')),1500000));
test('Caso 2: 24000 × 1,5 = 36000; 0,250 = 6000',()=>{
 assert.equal(subtotal(money('24000'),quantity('1,5','kg')),3600000);
 assert.equal(subtotal(money('24000'),quantity('0,250','kg')),600000);
 assert.throws(()=>quantity('1.5','unit'));assert.throws(()=>money('-1'));assert.throws(()=>money('1e5'));
});
test('Contraseña protegida, acceso y token almacenado como hash',async()=>{
 const db=openDatabase(':memory:');
 try {
  const u=await createUser(db,{username:'admin',name:'Admin',password:'clave-segura-123',role:'admin'});
  assert.ok(!db.prepare('SELECT password_hash FROM users').get().password_hash.includes('clave-segura'));
  await assert.rejects(login(db,'admin','incorrecta'),{status:401});
  const session=await login(db,'admin','clave-segura-123');assert.equal(session.user.id,u.id);
  assert.equal(db.prepare('SELECT token_hash FROM auth_sessions').get().token_hash,digest(session.token));
 }finally {db.close();}
});
