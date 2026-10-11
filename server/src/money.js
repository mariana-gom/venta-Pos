export function scaled(value, decimals, label='Valor') {
 if (typeof value !== 'string' || !new RegExp(`^\\d{1,10}([.,]\\d{1,${decimals}})?$`).test(value)) throw Object.assign(new Error(`${label}: ingresa un número positivo con máximo ${decimals} decimales, sin separadores de miles.`), {status:400});
 const [whole, fraction=''] = value.replace(',', '.').split('.');
 const result = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals,'0'));
 if (!Number.isSafeInteger(result) || result > 100_000_000_000) throw Object.assign(new Error(`${label} excede el límite permitido.`),{status:400});
 return result;
}
export const money = value => scaled(value,2,'Dinero');
export function quantity(value, unit) {
 const n = scaled(value,3,unit==='kg'?'Kilogramos':'Unidades');
 if (n <= 0 || (unit==='unit' && n % 1000 !== 0)) throw Object.assign(new Error(unit==='unit'?'Las unidades deben ser enteras y mayores a cero.':'El peso debe ser mayor a cero.'),{status:400});
 return n;
}
export function subtotal(price, qty) {
 const result = Number((BigInt(price)*BigInt(qty)+500n)/1000n);
 if (!Number.isSafeInteger(result) || result <= 0 || result > 100_000_000_000) throw Object.assign(new Error('Subtotal fuera del rango permitido.'),{status:400});
 return result;
}
export const cop = cents => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2}).format(cents/100);
export const colombiaDate = date => new Intl.DateTimeFormat('es-CO',{dateStyle:'short',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(date));
export const difference = cents => cents===0?'Sin diferencia':`${cents>0?'Sobrante':'Faltante'} de ${cop(Math.abs(cents))}`;
