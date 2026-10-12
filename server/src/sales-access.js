// La zona se configura en el servidor, nunca a partir de una petición del navegador.
export function businessTimeZone() {
 const zone=process.env.BUSINESS_TIME_ZONE?.trim()||'America/Bogota';
 new Intl.DateTimeFormat('en',{timeZone:zone}); // Una configuración inválida falla, no cambia silenciosamente el día.
 return zone;
}
export function calendarDay(value,zone=businessTimeZone()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const part=type=>parts.find(p=>p.type===type).value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function nextDay(day) {
 const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);
}
// Primer instante de la fecha local. También contempla días de 23/25 horas y cambios de offset en medianoche.
export function dayStart(day,zone=businessTimeZone()) {
 const center=Date.parse(`${day}T00:00:00Z`);let low=center-48*3600000,high=center+48*3600000;
 while(low<high){const mid=Math.floor((low+high)/2);if(calendarDay(mid,zone)<day)low=mid+1;else high=mid;}
 return new Date(low).toISOString();
}
export function salesDay(at=new Date()) {
 const time_zone=businessTimeZone(),date=calendarDay(at,time_zone);
 return {date,time_zone,start:dayStart(date,time_zone),end:dayStart(nextDay(date),time_zone),server_now:new Date(at).toISOString()};
}
export function canReadSale(user,sale,day=salesDay()) {
 return user.role==='admin'||(sale.seller_id===user.id&&sale.created_at>=day.start&&sale.created_at<day.end);
}
export function saleAcknowledgement(sale) {
 return {id:sale.id,number:sale.number,history_restricted:true,message:'Solo puedes consultar las ventas del día actual'};
}
