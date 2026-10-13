import {useEffect,useRef,useState} from 'react';
import {api,ApiError,isOnline,onConnectivity} from './api';
import {normalizeSearch} from './format';
import type {Product} from './types';
type Page={products:Product[];has_more:boolean;total:number;page:number};
const EMPTY:Record<string,number>={};
export function useProductSearch(catalog:Product[],query:string,purpose:'sale'|'assignment',routeId?:string,enabled=true,reserved:Record<string,number>=EMPTY){
 const [online,setOnline]=useState(isOnline()),[rows,setRows]=useState<Product[]>([]),[page,setPage]=useState(1),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const generation=useRef(0),cursor=useRef({query,routeId,online,purpose});
 useEffect(()=>onConnectivity(setOnline),[]);
 useEffect(()=>{cursor.current={query,routeId,online,purpose};setPage(1);setRows([]);},[query,routeId,online,purpose]);
 useEffect(()=>{
  const stamp=++generation.current;if(!enabled){setLoading(false);return;}
  const reset=page===1;setLoading(true);setError('');
  const timer=setTimeout(async()=>{
   try{
    let result:Page;
    if(online)result=await api<Page>('/products/search?'+new URLSearchParams({search:query,page:String(page),limit:'30',purpose,...routeId?{route_id:routeId}:{}}));
    else{const filtered=catalog.filter(p=>p.active&&p.unit&&p.price_cents!==null&&normalizeSearch(p.name).includes(normalizeSearch(query)));result={products:filtered.slice((page-1)*30,page*30),total:filtered.length,has_more:page*30<filtered.length,page};}
    if(stamp!==generation.current)return;
    const adjusted=online&&purpose==='sale'?result.products.map(p=>({...p,stock_milli:p.stock_milli===null?null:Math.max(0,p.stock_milli-(reserved[p.id]||0))})):result.products;
    setRows(prev=>reset?adjusted:[...prev,...adjusted.filter(p=>!prev.some(x=>x.id===p.id))]);setMore(result.has_more);
   }catch(e){if(stamp!==generation.current)return;if(e instanceof ApiError&&e.status===0)setOnline(false);else setError(e instanceof Error?e.message:'No se pudieron buscar los productos.');}
   finally{if(stamp===generation.current)setLoading(false);}
  },page===1?250:0);
  return()=>{clearTimeout(timer);generation.current++;};
 },[query,routeId,online,purpose,page,retry,enabled,catalog,reserved]);
 return {rows,loading,error,offline:!online,hasMore:more,next:()=>{if(!loading&&more)setPage(p=>p+1);},reload:()=>{setPage(1);setRetry(n=>n+1);}};
}
