import * as SecureStore from 'expo-secure-store';
import {Platform} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import type {User} from './types';
let token='';
export const API_URL=(process.env.EXPO_PUBLIC_API_URL||'http://localhost:4317').replace(/\/$/,'');
export class ApiError extends Error { constructor(message:string,public status:number){super(message);} }
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 let response:Response;
 try{response=await fetch(API_URL+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw new ApiError('No hay conexión con el servidor. No confirmes otra venta: reintenta con la misma referencia.',0);}
 const data=await response.json();if(!response.ok)throw new ApiError(data.error||'No se pudo completar la operación.',response.status);return data;
}
export async function restoreSession():Promise<User|null>{
 token=Platform.OS==='web'?(sessionStorage.getItem('pos-token')||''):(await SecureStore.getItemAsync('pos-token')||'');
 if(!token)return null;
 try{return await api<User>('/me');}catch(e){if(e instanceof ApiError&&e.status===401){await forgetSession();return null;}throw e;}
}
export async function signIn(username:string,password:string){
 const result=await api<{token:string;user:User}>('/auth/login','POST',{username,password});token=result.token;
 if(Platform.OS==='web')sessionStorage.setItem('pos-token',token);else await SecureStore.setItemAsync('pos-token',token);return result.user;
}
export async function forgetSession(){token='';if(Platform.OS==='web')sessionStorage.removeItem('pos-token');else await SecureStore.deleteItemAsync('pos-token');}
export async function signOut(){await api('/auth/logout','POST',{});await forgetSession();}
export async function documentAction(path:string,width:58|80,action:'share'|'print'|'open'){
 const url=`${API_URL}/api${path}/pdf?width=${width}`;
 if(Platform.OS==='web'){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('No se pudo descargar el PDF.');
  const blob=await response.blob(),uri=URL.createObjectURL(blob);const a=document.createElement('a');a.href=uri;a.download=`comprobante-${width}mm.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(uri),60000);return;
 }
 const result=await FileSystem.downloadAsync(url,FileSystem.cacheDirectory+`comprobante-${Date.now()}.pdf`,{headers:{Authorization:`Bearer ${token}`}});
 if(result.status!==200)throw new Error('No se pudo descargar el PDF.');
 if(action==='print')await Print.printAsync({uri:result.uri});
 else{if(!await Sharing.isAvailableAsync())throw new Error('El dispositivo no permite compartir archivos.');await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:action==='open'?'Abrir o guardar comprobante':'Compartir comprobante'});}
}
export async function readPending(userId:string):Promise<Record<string,unknown>|null>{
 const key=`pos-pending-${userId}`;const value=Platform.OS==='web'?localStorage.getItem(key):await SecureStore.getItemAsync(key);return value?JSON.parse(value):null;
}
export async function savePending(userId:string,body:Record<string,unknown>|null){
 const key=`pos-pending-${userId}`;
 if(Platform.OS==='web'){if(body)localStorage.setItem(key,JSON.stringify(body));else localStorage.removeItem(key);}
 else{if(body)await SecureStore.setItemAsync(key,JSON.stringify(body));else await SecureStore.deleteItemAsync(key);}
}
