import {useEffect, useRef, useState} from 'react';
import {AppState, Platform} from 'react-native';
import {api, ApiError} from './api';
import {bogotaDay} from './format';
import type {SalesAccess, Sale, User} from './types';

/** Reloj del servidor mientras hay señal; zona del negocio también disponible en modo ruta. */
export function useBusinessDay(timeZone = 'America/Bogota', authenticated = false) {
  const offset = useRef(0);
  const [clock, setClock] = useState(() => ({date: bogotaDay(0, new Date(), timeZone), revision: 0}));
  useEffect(() => {
    let stopped = false, boundary = 0, timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (stopped) return;
      const now = Date.now() + offset.current;
      const date = bogotaDay(0, new Date(now), timeZone);
      setClock(current => current.date === date ? current : {date, revision: current.revision + 1});
      clearTimeout(timer); timer = setTimeout(tick, boundary > now ? Math.min(1000, boundary - now) : 1000);
    };
    const sync = async () => {
      if (!authenticated) return;
      const started = Date.now();
      try {
        const access = await api<SalesAccess>('/sales/access');
        if (stopped) return;
        boundary = Date.parse(access.end);
        offset.current = Date.parse(access.server_now) - (started + Date.now()) / 2;
        tick();
      } catch (e) { if (!(e instanceof ApiError)) throw e; }
    };
    const resume = () => { tick(); void sync(); };
    tick(); void sync();
    const poll = setInterval(() => void sync(), 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') resume(); });
    if (Platform.OS === 'web') { window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume); }
    return () => { stopped = true; clearTimeout(timer); clearInterval(poll); subscription.remove(); if (Platform.OS === 'web') { window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); } };
  }, [timeZone, authenticated]);
  return clock;
}
export function canDisplaySale(user: User, sale: Sale, day: string, timeZone = 'America/Bogota') {
  return user.role === 'admin' || (sale.seller_id === user.id && bogotaDay(0, new Date(sale.created_at), timeZone) === day);
}
