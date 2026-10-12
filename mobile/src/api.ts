import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import type {User} from './types';
import {loadCache} from './offline';
let token='';
const documentUrls=new Set<string>();
export async function clearDocumentCache(){
 if(Platform.OS==='web'){for(const url of documentUrls)URL.revokeObjectURL(url);documentUrls.clear();return;}
 const dir=FileSystem.cacheDirectory;if(!dir)return;
 const names=await FileSystem.readDirectoryAsync(dir);
 await Promise.all(names.filter(name=>/^comprobante-[a-z0-9-]+-(58|80)mm\.pdf$/.test(name)).map(name=>FileSystem.deleteAsync(dir+name,{idempotent:true})));
}
// Estado de conexión observado en cada llamada: el modo ruta lo usa para guardar ventas y subirlas después.
const listeners=new Set<(online:boolean)=>void>();let online=true;
function setOnline(value:boolean){if(value!==online){online=value;listeners.forEach(l=>l(value));}}
export function onConnectivity(listener:(online:boolean)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export const isOnline=()=>online;
export const API_URL=(process.env.EXPO_PUBLIC_API_URL||'http://localhost:4317').replace(/\/$/,'');
/** Error con mensaje para el usuario y detalle técnico para diagnóstico (código, ruta). */
export class ApiError extends Error { constructor(message:string,public status:number,public detail=''){super(message);} }
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(API_URL+'/api'+path,{method,cache:'no-store',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});setOnline(true);}
 catch(e){setOnline(false);throw new ApiError('No hay conexión con el servidor. Revisa el internet o el Wi-Fi e inténtalo nuevamente.',0,`${method} ${path} · ${e instanceof Error?e.message:String(e)} · ${API_URL}`);}
 // Un proxy o servidor caído puede responder HTML: nunca mostrar un error de lectura JSON al usuario.
 let data:any=null;try{data=await response.json();}catch{}
 if(!response.ok){
  const fallback=response.status>=500?'El servidor no pudo completar la operación. Inténtalo nuevamente en unos segundos.':'No se pudo completar la operación.';
  const fields=Array.isArray(data?.fields)?' · '+data.fields.map((f:{field:string;message:string})=>`${f.field}: ${f.message}`).join('; '):'';
  throw new ApiError(data?.error||fallback,response.status,`HTTP ${response.status} · ${method} ${path}${fields}`);
 }
 if(data===null)throw new ApiError('La respuesta del servidor no es válida.',response.status,`${method} ${path} · respuesta sin JSON`);
 return data;
}
export async function restoreSession():Promise<User|null>{
 token=Platform.OS==='web'?(sessionStorage.getItem('pos-token')||''):(await SecureStore.getItemAsync('pos-token')||'');
 if(!token)return null;
 try{return await api<User>('/me');}catch(e){
  if(e instanceof ApiError&&e.status===401){await forgetSession();return null;}
  // Sin señal: se continúa con el último usuario guardado en este celular (la sesión se valida al reconectar).
  if(e instanceof ApiError&&e.status===0){const cache=await loadCache();if(cache)return cache.user;}
  throw e;
 }
}
export async function signIn(username:string,password:string){
 const result=await api<{token:string;user:User}>('/auth/login','POST',{username,password});token=result.token;
 if(Platform.OS==='web')sessionStorage.setItem('pos-token',token);else await SecureStore.setItemAsync('pos-token',token);return result.user;
}
export async function forgetSession(){token='';if(Platform.OS==='web')sessionStorage.removeItem('pos-token');else await SecureStore.deleteItemAsync('pos-token');}
export async function signOut(){await api('/auth/logout','POST',{});await forgetSession();}
/** Descarga el PDF guardado de la venta/cierre (nunca se recalcula) y lo abre, comparte o imprime. */
export async function documentAction(path:string,width:58|80,action:'share'|'print'|'open'){
 const url=`${API_URL}/api${path}/pdf?width=${width}`;const name=`comprobante-${path.split('/').pop()?.slice(0,8)}-${width}mm.pdf`;
 if(Platform.OS==='web'){
  const response=await fetch(url,{cache:'no-store',headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new ApiError('No se pudo descargar el comprobante. Inténtalo nuevamente.',response.status,`HTTP ${response.status} · GET ${path}/pdf`);
  const blob=await response.blob();
  if(action==='share'){const file=new File([blob],name,{type:'application/pdf'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Comprobante'});}catch(e){if((e as Error).name!=='AbortError')throw e;}return;}}
  const uri=URL.createObjectURL(blob);documentUrls.add(uri);
  // Imprimir abre el visor PDF del navegador (botón imprimir al 100 %); abrir/compartir sin soporte descarga el archivo.
  // Si el navegador bloquea la ventana emergente, se descarga el archivo para imprimirlo desde el visor.
  if(action!=='print'||!window.open(uri,'_blank')){const a=document.createElement('a');a.href=uri;a.download=name;a.click();}
  setTimeout(()=>{URL.revokeObjectURL(uri);documentUrls.delete(uri);},60000);return;
 }
 const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+name,{headers:{Authorization:`Bearer ${token}`}});
 try{
 if(result.status!==200)throw new ApiError('No se pudo descargar el comprobante. Revisa la conexión e inténtalo nuevamente.',result.status,`HTTP ${result.status} · GET ${path}/pdf`);
 if(action==='print')await Print.printAsync({uri:result.uri});
 else{if(!await Sharing.isAvailableAsync())throw new Error('Este celular no permite compartir archivos.');await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:action==='open'?'Abrir o guardar comprobante':'Compartir comprobante'});}
 }finally{await FileSystem.deleteAsync(result.uri,{idempotent:true});}
}
export async function readPending(userId:string):Promise<Record<string,unknown>|null>{
 const key=`pos-pending-${userId}`;const value=Platform.OS==='web'?localStorage.getItem(key):await SecureStore.getItemAsync(key);return value?JSON.parse(value):null;
}
export async function savePending(userId:string,body:Record<string,unknown>|null){
 const key=`pos-pending-${userId}`;
 if(Platform.OS==='web'){if(body)localStorage.setItem(key,JSON.stringify(body));else localStorage.removeItem(key);}
 else{if(body)await SecureStore.setItemAsync(key,JSON.stringify(body));else await SecureStore.deleteItemAsync(key);}
}
export async function uploadExcel(uri:string):Promise<import('./types').ImportPreview>{
 let bytes:ArrayBuffer;
 if(Platform.OS==='web')bytes=await(await fetch(uri)).arrayBuffer();
 else {const encoded=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});const raw=atob(encoded),view=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)view[i]=raw.charCodeAt(i);bytes=view.buffer;}
 const response=await fetch(API_URL+'/api/products/import/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:bytes});
 const result=await response.json();if(!response.ok)throw new ApiError(result.error||'No se pudo leer el Excel.',response.status);return result;
}
export async function downloadFile(path:string,name:string,mime='application/pdf'){
 const url=API_URL+'/api'+path;
 if(Platform.OS==='web'){const response=await fetch(url,{cache:'no-store',headers:{Authorization:'Bearer '+token}});if(!response.ok)throw new ApiError('No se pudo descargar el archivo.',response.status);const uri=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=uri;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(uri),1000);}
 else {const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+name,{headers:{Authorization:'Bearer '+token}});try{if(result.status!==200)throw new ApiError('No se pudo descargar el archivo.',result.status);await Sharing.shareAsync(result.uri,{mimeType:mime});}finally{await FileSystem.deleteAsync(result.uri,{idempotent:true});}}
}
