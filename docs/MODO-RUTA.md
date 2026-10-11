# Modo ruta (ventas sin señal)

Para las rutas de pollo, donde no hay señal. Railway sigue siendo el sistema central; cada celular vende sin internet y sincroniza al recuperar la conexión.

## Cómo funciona

1. **Antes de salir, con señal:** el vendedor inicia sesión y abre su caja. La app guarda en el celular (SQLite) productos, precios, clientes, plataformas de pago y datos del negocio.
2. **En ruta, sin señal:** cada venta se guarda primero en el celular con un **número provisional** (`R-7KQ-0001`), su fecha y hora reales y el precio de ese momento. El comprobante se imprime desde el celular. Se pueden crear clientes nuevos; viajan con la venta. El stock local se descuenta para no vender de más en el mismo celular.
3. **Al recuperar señal:** las ventas se suben solas (al reconectar y cada 20 s), en orden. El servidor asigna el **consecutivo oficial** (`#0025`), conserva la hora original y guarda la referencia provisional para cruzar el comprobante impreso. Cada venta lleva una referencia única: reintentar nunca la duplica.

El encabezado muestra una nube con el número de ventas por subir; tocándola se fuerza la subida. Historial muestra la sección **Por subir**. No se puede cerrar sesión mientras haya ventas pendientes.

## Reglas al subir ventas atrasadas (más de 2 minutos)

| Situación | Qué pasa |
|---|---|
| El precio cambió mientras estaba en ruta | Se respeta el precio con que se vendió. Aviso al administrador. |
| No alcanza el stock | Se acepta; el producto queda en 0. Aviso con la cantidad faltante. |
| Cliente creado sin señal | Se crea con la venta; si ya existía con el mismo nombre y ciudad, se reutiliza. |
| La caja se cerró antes de subir | La venta entra en la caja abierta actual del vendedor. Si no tiene una abierta, espera a que la abra. Aviso al administrador. |

Las ventas hechas con señal siguen las reglas estrictas de siempre (precio vigente, stock suficiente, caja abierta). Los avisos aparecen en Inicio del administrador (últimos 7 días).

## Impresión en ruta

Sin señal, el comprobante se genera en el celular y se envía al servicio de impresión de Android. Para la impresora Bluetooth MTP-3 compartida en la ruta: emparejarla en Ajustes de Android con el celular que imprime e instalar una app de servicio de impresión ESC/POS (por ejemplo **RawBT**). Con señal, Historial sigue usando el PDF oficial guardado en el servidor. La impresión Bluetooth directa (módulo nativo) queda como mejora futura.

## Límites conocidos

- Abrir caja e iniciar sesión por primera vez requieren señal.
- La sesión dura 12 horas; si vence en ruta, la app sigue funcionando sin señal y al reconectar pide ingresar de nuevo antes de subir (las ventas no se pierden).
- Los números provisionales pueden saltar (también se reservan para ventas hechas con señal); el consecutivo oficial siempre es continuo.
- En la versión web las ventas pendientes se guardan en el navegador; en el celular, en SQLite.
- Pendiente: prueba en celulares Android reales y con la impresora física.
