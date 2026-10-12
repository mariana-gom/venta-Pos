# Crédito, cartera, anulaciones, rutas e importación

## Migración y puesta en marcha

Al iniciar la API se aplica `schema_migrations.version=2` en una transacción. Se conservan IDs, facturas, pagos, clientes, precios normales, documentos y cierres. Se amplían los pagos para crédito y referencia, los clientes para identificación y el catálogo para código, categoría, marca y precio mayorista. Los productos importados pueden quedar inactivos sin precio normal ni unidad.

El stock global existente se identifica como saldo **sin asignar**. No se copia a todas las rutas. En Perfil → Rutas e inventario, el administrador crea las rutas, asigna una a cada vendedor y distribuye ese saldo. Distribuir resta del saldo sin asignar y agrega a una ruta; no aumenta el total. Entrada agrega existencias; conteo establece la existencia final y registra la diferencia. Ambos requieren motivo y dejan movimiento auditado.

Mientras un producto controlado no tenga existencias en la ruta del vendedor, no puede venderse. Los productos sin control de inventario siguen vendiéndose normalmente. La anulación devuelve el stock descontado a la ubicación original, aunque cambie la ruta del usuario. Las ventas anteriores a la migración que manejaban stock regresan al saldo sin asignar.

Antes del despliegue se realiza respaldo consistente y se ensaya la migración sobre una copia. No debe ejecutarse el binario antiguo sobre la base migrada: sus inserciones posicionales no admiten las columnas nuevas. Una reversión necesita un procedimiento compatible y conciliación de las operaciones realizadas después del respaldo; restaurarlo sin esa conciliación perdería esas operaciones.

## Ventas, referencias y caja

Los vendedores consultan únicamente sus ventas del día definido por `BUSINESS_TIME_ZONE`, o America/Bogota. El servidor valida sesión, rol, propietario y límites `[00:00, 00:00 siguiente)` en listados, búsquedas, grupos, detalle y PDF. Los cierres, cartera, abonos, anulaciones, rutas, ajustes e importaciones requieren administrador. La pantalla se actualiza en medianoche y al volver al primer plano, y descarta respuestas antiguas y la caché consultable anterior.

Los medios electrónicos requieren referencia de texto (máximo 120 caracteres). Se preservan letras y ceros. Cambiar de medio limpia la referencia; efectivo y crédito no la guardan ni imprimen. Los registros históricos sin referencia siguen siendo válidos.

Una venta a crédito exige cliente identificado y crea una deuda por el total original. El precio normal sigue siendo el precio de venta del POS: importar mayoristas no cambia automáticamente el precio de la venta ni clasifica al cliente como mayorista.

`total_cents` representa ventas vigentes, incluyendo crédito. `sales_cash_cents`, `sales_electronic_cents` y `credit_cents` separan esas ventas. `collection_cash_cents` y `collection_electronic_cents` representan cobros posteriores de cartera. `cash_cents` y `electronic_cents` representan el flujo recibido neto de devoluciones reales, incluyendo cobros de cartera, sin sumar créditos. Una venta anulada se excluye de ventas; el dinero recibido permanece hasta registrar su salida real.

Al cerrar, efectivo esperado = base + flujo neto de efectivo. Se concilia electrónico aparte. El administrador registra crédito reportado; la diferencia contra crédito registrado no cambia ninguna deuda. La revisión incluye una huella de ventas, abonos, devoluciones y anulaciones; un movimiento posterior exige revisar de nuevo. Los cierres originales permanecen congelados.

## Créditos y cartera

En Perfil → Créditos y cartera se busca por nombre o identificación. Se ven facturas, saldo pendiente, abonos, receptor, caja, observaciones y movimientos cronológicos. Los abonos solo admiten efectivo o electrónico, monto positivo hasta el saldo y fecha/hora válidas en la zona del negocio. No se aceptan fechas futuras ni anteriores a las facturas pagadas.

Por defecto se paga la factura más antigua. También puede seleccionarse una factura; se muestra la distribución antes de confirmar. La API admite distribuciones explícitas entre varias facturas. Un abono no cambia el total de la venta y se aplica una sola vez mediante su referencia de operación.

Se elige expresamente una caja abierta o recepción administrativa fuera de caja con motivo. No se asigna automáticamente una caja. El receptor autenticado queda registrado, aun cuando la caja pertenezca al vendedor. Fuera de caja el cobro reduce cartera y aparece en el extracto, pero no entra en un cierre de caja.

El extracto PDF A4 incluye identificación del negocio y del cliente, periodo, saldo inicial, facturas, abonos, anulaciones/reasignaciones/devoluciones y saldo final. Los límites del periodo usan la zona del negocio.

## Anulaciones

Solo el administrador puede anular, con motivo y confirmación. La factura y el PDF muestran Anulada, responsable, fecha y motivo; los registros originales no se borran ni modifican. Una segunda anulación diferente se rechaza; repetir la misma operación devuelve su resultado.

La devolución debe registrarse como realmente realizada, con medio, referencia electrónica cuando aplique y origen del dinero. Solo se permite la caja original abierta o devolución administrativa fuera de caja con motivo. Una caja cerrada conserva su cierre y recibe un ajuste vinculado; no se usa otra caja abierta.

El crédito anulado deja de tener deuda. Cada abono aplicado exige resolución explícita: devolverlo o reasignarlo a otra factura del mismo cliente con saldo suficiente. Se conserva el historial de todas las reasignaciones, incluso si se anula después la factura destino. Cuando hay devolución de abonos, el importe real debe coincidir con la suma a devolver.

## Importar Excel

En Productos → Importar Excel se selecciona `.xlsx`, máximo 5 MB y 10.000 filas, con hoja Productos. Los encabezados se detectan por nombre en cualquier fila de la hoja; el archivo de referencia indica fila 5. No se lee ni aplica el precio normal, aunque contenga fórmulas o errores.

Código se conserva como texto, incluyendo ceros; si Excel almacena un número con máscara `0000`, se respeta su representación. No se pueden recuperar ceros que Excel ya descartó. Se identifica únicamente por código. Si un ID del archivo coincide con el sistema pero el código no coincide, se marca conflicto para corregir en el catálogo; no se relaciona por nombre.

Para existentes se actualiza únicamente `wholesale_price_cents`. Nuevos requieren descripción, código, categoría, marca y mayorista válido; quedan borradores inactivos sin precio normal ni unidad hasta completarlos. Vacíos, texto no numérico, negativos, errores y fórmulas sin resultado numérico disponible se omiten. El precio cero requiere revisión explícita. Los códigos duplicados se marcan en todas sus filas.

La vista previa se conserva en servidor por una hora y pertenece al administrador que la generó. Confirmar comprueba que el código y precio anterior no hayan cambiado. Si cambiaron, revierte toda la aplicación y exige otra vista previa. Las filas inválidas se omiten y se informa el resultado descargable CSV. No se crean movimientos ni se cambian existencias. Confirmaciones repetidas no duplican productos ni importaciones.

## Modo sin señal y dispositivos

Las ventas nuevas guardan su referencia electrónica antes de quedar pendientes. La sincronización conserva la misma clave de venta; el servidor exige ruta actual y saldo suficiente incluso para ventas atrasadas. Cambiar de ruta con ventas pendientes de la original bloquea su sincronización, en lugar de descontar otra ruta: el administrador debe conciliar y restablecer la ruta original antes de subirlas. Los pedidos pendientes no se borran por el cambio de día, aunque no aparecen en el historial de un vendedor si pertenecen a otro día.

Antes de actualizar un dispositivo antiguo, conviene sincronizar sus ventas pendientes. Una venta electrónica aún no registrada y sin referencia no puede confirmarse con las reglas nuevas. Los PDF descargados o impresos previamente son copias externas y no se pueden retirar al cambiar el día o anular una factura.

La web y API se despliegan en Vercel y Railway. Android requiere compilar e instalar un APK actualizado; la exportación JavaScript no instala una nueva aplicación en el teléfono.

## Verificación

- `npm test`: permisos, medianoche, precisión monetaria, referencias, cartera, abonos dentro/fuera de caja, distribución, cierres, anulaciones y sus ajustes/devoluciones/reasignaciones, concurrencia de stock, migración y errores de Excel.
- `npm run check`: TypeScript.
- `npm run test:e2e`: flujo existente y permisos de historial a seis anchos, con cambio de día sin señal.
- `npm run test:e2e:operations`: pantallas nuevas, doble clic, PDF, importación y activación de borradores.
- `npm run export:web -w mobile` y `npm exec -w mobile -- expo export --platform android`: compilaciones.
- `npm exec -w mobile -- expo install --check`: compatibilidad de Expo.

La auditoría de dependencias sigue informando las vulnerabilidades sin versión corregida de `braces` y `node-forge`, usadas por las herramientas de Expo. UUID se actualiza a 11.1.1 también en la instalación aislada del servidor. No se aplican las degradaciones de Expo/ExcelJS que sugiere `npm audit fix --force`.
