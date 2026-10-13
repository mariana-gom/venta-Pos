# Crédito, cartera, anulaciones, rutas e importación

## Migración y puesta en marcha

Al iniciar la API se aplica `schema_migrations.version=4` en una transacción (después de las versiones 2 y 3 si hace falta). Conserva IDs, facturas, precios vendidos, documentos, cierres, cartera y movimientos. Agrega cargas diarias y sus detalles, fecha efectiva de movimientos, indicador de inventario central y revisión de precios antiguos. Documentos de clientes, marca, categoría y precio adicional antiguos se conservan como datos históricos en la base, sin campos de captura ni segundo precio operativo.

Productos solicita nombre, modalidad unidad/kg y un único precio positivo. El ID es automático. Crear productos no registra cantidades ni movimientos: el saldo inicial técnico es cero, sin saldo central. El producto se vende cuando se le entrega stock a su ruta. Los productos históricos sin control siguen funcionando igual; una carga explícita habilita su control. Editar un producto conserva el stock y su código interno del Excel.

Los productos con precio adicional anterior aparecen en Productos → Revisar precio único. La vista previa muestra ambos valores históricos y el precio único propuesto (mayorista válido, o precio actual); no cambia ningún precio hasta confirmar. También editar/importar muestra los valores anteriores antes de confirmar el único precio. Se conserva la trazabilidad de la elección y el precio de todas las facturas anteriores.

Perfil → Rutas permite crear, editar, desactivar y asignar vendedores. Perfil → Carga de stock por ruta permite seleccionar ruta/fecha y buscar productos por nombre. Tocar un producto abre su cantidad en unidad/kg; Productos por asignar permite editar o quitar y reemplaza cantidades del mismo producto sin duplicar filas. Confirmar asignación consulta stock actual y muestra el resumen; Confirmar entrega a ruta escribe en una transacción. Hasta ese último paso no se descuenta ni asigna inventario. No genera ventas, ingresos, deudas ni caja. Cada producto con saldo central (el antiguo saldo sin asignar, incluso si está agotado) descuenta de ese saldo. Un producto sin central recibe entrada directa a la ruta. No se inventa un saldo central. Entrada central es una operación administrativa explícita para mercancía nueva. Un cambio de saldo entre revisión y confirmación bloquea la carga. La fecha identifica la entrega; la cantidad queda disponible al confirmar, sin programación diferida.

El sobrante se acumula entre días. Conteo / ajuste registra existencia final. Devolver sobrante retira la cantidad de la ruta y la devuelve al central, si existe, en la misma transacción; sin central registra la salida sin inventar uno. Se conserva motivo, administrador, fecha, productos y cantidades. Reintentos con la misma clave de operación no duplican cargas.

Mientras un producto controlado no tenga existencias en la ruta del vendedor, no puede venderse. Los productos sin control de inventario siguen vendiéndose normalmente. La anulación devuelve el stock descontado a la ubicación original, aunque cambie la ruta del usuario. Las ventas anteriores a la migración que manejaban stock regresan al saldo sin asignar.

Antes del despliegue se realiza respaldo consistente y se ensaya la migración sobre una copia. No debe ejecutarse el binario antiguo sobre la base migrada: sus inserciones posicionales no admiten las columnas nuevas. Una reversión necesita un procedimiento compatible y conciliación de las operaciones realizadas después del respaldo; restaurarlo sin esa conciliación perdería esas operaciones.

## Ventas, referencias y caja

Los vendedores consultan únicamente sus ventas del día definido por `BUSINESS_TIME_ZONE`, o America/Bogota. El servidor valida sesión, rol, propietario y límites `[00:00, 00:00 siguiente)` en listados, búsquedas, grupos, detalle y PDF. Los cierres, cartera, abonos, anulaciones, rutas, ajustes e importaciones requieren administrador. La pantalla se actualiza en medianoche y al volver al primer plano, y descarta respuestas antiguas y la caché consultable anterior.

Los medios electrónicos requieren referencia de texto (máximo 120 caracteres). Se preservan letras y ceros. Cambiar de medio limpia la referencia; efectivo y crédito no la guardan ni imprimen. Los registros históricos sin referencia siguen siendo válidos.

Una venta a crédito exige seleccionar un cliente registrado y crea una deuda por el total original. No exige documento. Nombre y ciudad se mantienen; los documentos históricos se conservan. Personas con el mismo nombre tienen IDs y cuentas separadas, incluso al sincronizar clientes creados sin señal. El único precio del producto se utiliza para calcular la venta.

`total_cents` representa ventas vigentes, incluyendo crédito. `sales_cash_cents`, `sales_electronic_cents` y `credit_cents` separan esas ventas. `collection_cash_cents` y `collection_electronic_cents` representan cobros posteriores de cartera. `cash_cents` y `electronic_cents` representan el flujo recibido neto de devoluciones reales, incluyendo cobros de cartera, sin sumar créditos. Una venta anulada se excluye de ventas; el dinero recibido permanece hasta registrar su salida real.

Al cerrar, efectivo esperado = base + flujo neto de efectivo. Se concilia electrónico aparte. El administrador registra crédito reportado; la diferencia contra crédito registrado no cambia ninguna deuda. La revisión incluye una huella de ventas, abonos, devoluciones y anulaciones; un movimiento posterior exige revisar de nuevo. Los cierres originales permanecen congelados.

## Créditos y cartera

En Perfil → Créditos y cartera se busca por nombre. Se ven facturas, saldo pendiente, abonos, receptor, caja, observaciones y movimientos cronológicos. Los abonos solo admiten efectivo o electrónico, monto positivo hasta el saldo y fecha/hora válidas en la zona del negocio. No se aceptan fechas futuras ni anteriores a las facturas pagadas.

Por defecto se paga la factura más antigua. También puede seleccionarse una factura; se muestra la distribución antes de confirmar. La API admite distribuciones explícitas entre varias facturas. Un abono no cambia el total de la venta y se aplica una sola vez mediante su referencia de operación.

Se elige expresamente una caja abierta o recepción administrativa fuera de caja con motivo. No se asigna automáticamente una caja. El receptor autenticado queda registrado, aun cuando la caja pertenezca al vendedor. Fuera de caja el cobro reduce cartera y aparece en el extracto, pero no entra en un cierre de caja.

El extracto PDF A4 incluye identificación del negocio y del cliente, periodo, saldo inicial, facturas, abonos, anulaciones/reasignaciones/devoluciones y saldo final. Sin rango incluye todo el historial: desde la primera factura a crédito hasta el último movimiento de cartera, incluyendo una factura posterior al último abono. La generación se muestra por separado. Sin movimientos muestra un mensaje y no inventa fechas. Con rango incluye saldo anterior, movimientos del periodo y saldo final. Los límites y las fechas usan la zona del negocio.

## Anulaciones

Solo el administrador puede anular, con motivo y confirmación. La factura y el PDF muestran Anulada, responsable, fecha y motivo; los registros originales no se borran ni modifican. Una segunda anulación diferente se rechaza; repetir la misma operación devuelve su resultado.

La devolución debe registrarse como realmente realizada, con medio, referencia electrónica cuando aplique y origen del dinero. Solo se permite la caja original abierta o devolución administrativa fuera de caja con motivo. Una caja cerrada conserva su cierre y recibe un ajuste vinculado; no se usa otra caja abierta.

El crédito anulado deja de tener deuda. Cada abono aplicado exige resolución explícita: devolverlo o reasignarlo a otra factura del mismo cliente con saldo suficiente. Se conserva el historial de todas las reasignaciones, incluso si se anula después la factura destino. Cuando hay devolución de abonos, el importe real debe coincidir con la suma a devolver.

## Importar Excel

En Productos → Importar Excel se selecciona `.xlsx`, máximo 5 MB y 10.000 filas, con hoja Productos. Detecta encabezados por nombre en cualquier fila. Descripción será el nombre y Precio de venta mayoristas será el único `price_cents` que usa el POS. Ignora completamente Precio de venta (COP), categoría y marca.

Se reconoce una columna explícita de modalidad: Cómo se vende, Modalidad de venta, Unidad de venta, Unidad de medida, Unidad o Modalidad. Unidad/und/un y kilogramo/kg se reconocen; jamás se infiere desde el nombre. Si falta, se conserva la modalidad del producto existente y para los nuevos se completa en la vista previa, por fila o seleccionando varias y aplicando unidad/kg. No se confirma mientras una fila válida tenga modalidad pendiente. Productos con movimientos conservan su modalidad histórica.

El código del Excel se guarda internamente como texto, respetando ceros iniciales y máscaras numéricas `0000`. No se exige en el formulario. Se identifica por código exacto o ID interno exacto cuando no hay código; nunca por similitud de nombre. Conflictos ID/código y duplicados se marcan. Sin código ni ID se crea un producto nuevo con ID automático y se avisa que futuras actualizaciones necesitan ese ID.

La vista previa muestra creaciones, precio actual/adicional anterior y precio único resultante, modalidades y errores. Nuevos válidos se crean activos con nombre, modalidad y precio, sin cantidades ni movimientos de inventario. Los existentes conservan actividad, inventario y código, y actualizan nombre, modalidad permitida y precio único. Vacíos, no numéricos, negativos, errores, fórmulas sin resultado numérico y precios cero se omiten sin sobrescribir precios.

La vista previa dura una hora y pertenece a su administrador. Confirmar verifica que el producto no haya cambiado y revierte toda la operación ante conflictos. Las filas inválidas se omiten y se entrega CSV descargable. Reintentos no duplican la importación. Vistas previas del formato anterior deben volver a cargarse tras la actualización.

## Cerrar dinero e inventario juntos

Cerrar caja inicia una preparación de cierre. El POS del vendedor pausa nuevas ventas, conserva y sube su cola, y confirma el fin de sincronización desde cada equipo registrado. Un equipo desconectado, con errores o con pendientes impide el cierre definitivo. No existe un botón administrativo para omitir esta comprobación. Las jornadas abiertas y ventas de equipos anteriores generan una marca de compatibilidad: el responsable debe actualizar y sincronizar todos esos equipos y confirmar explícitamente desde Caja. Se registra esa confirmación; un equipo actualizado no elimina la marca por registrarse.

La conciliación muestra apertura/sobrante previo, cargas y cargas adicionales, vendido neto de anulaciones de la misma jornada, otros ajustes, esperado, recibido y diferencia. Todas las devoluciones se prellenan con el esperado. Editar devolución cambia únicamente ese producto y exige observación si hay diferencia. Se muestran dinero e inventario antes de la única confirmación definitiva.

Servidor exige una versión de preparación vigente, confirmación de todos los equipos y revisiones vigentes de dinero/inventario. Una sola transacción guarda el cierre, ajustes por diferencias, movimientos de devolución de cantidades físicamente recibidas al inventario general, evidencia y cierre de jornada. Faltantes reducen el total como ajuste auditado; sobrantes reales lo aumentan como ajuste auditado. La ruta queda en cero. Se conserva responsable, observación y vínculo al cierre en movimientos, historial y PDF. La misma clave de cierre retorna el resultado original sin volver a devolver stock, aunque se perdiera la respuesta.

Cancelar preparación permite continuar vendiendo y vuelve a exigir confirmaciones en el siguiente intento. No se permite cargar o ajustar la ruta durante preparación. Nueva jornada requiere una única caja abierta por ruta. Para cajas compartidas existentes, se cierran y sincronizan individualmente, y solo la última concilia/devuelve el inventario compartido. La migración reconstruye cargas y ventas de cajas ya abiertas y conserva sobrantes anteriores como apertura; no modifica movimientos históricos.

Una venta que llega después de un cierre definitivo permanece en la cola para conciliación administrativa; jamás se traslada automáticamente a otra caja. Los reintentos de ventas ya registradas siguen respondiendo su resultado original. No se elimina la cola al cerrar ni al cambiar el día. Un equipo que nunca se registró y permanezca en una versión anterior no puede ser detectado remotamente: por ello su responsable confirma explícitamente su sincronización antes del primer cierre actualizado.

## Buscar y vender con catálogos grandes

Vender conserva buscador, total y continuar al pago visibles; usa modal de cantidad para unidad/kg, carrito editable con subtotales y paneles lado a lado desde 1000 px. En celular alterna Productos y Productos de la venta sin perder el carrito.

Con internet la búsqueda se filtra en servidor y trae 30 productos por página (máximo 50), tras 250 ms sin escribir. Una respuesta anterior se descarta si cambió búsqueda/página/ruta. Se muestran carga, error/reintentar y sin resultados. Sin internet filtra el catálogo local y muestra 30 por vez con Ver más. Perfil → Preparar datos para vender sin internet descarga el catálogo completo en bloques de 500, junto con clientes, medios, caja y negocio; se conserva ese catálogo separado de los resultados renderizados.

Las cantidades reservadas por ventas pendientes se descuentan también de los resultados de búsqueda y de las actualizaciones del catálogo local. La cola usa escrituras serializadas y, en web, bloqueos del navegador entre pestañas; subir una venta no sobrescribe otra guardada simultáneamente. El bloqueo local de cierre conserva su versión para que una respuesta vieja no reactive ventas durante el cierre.

## Modo sin señal y dispositivos

Las ventas nuevas guardan su referencia electrónica antes de quedar pendientes. La sincronización conserva la misma clave de venta; el servidor exige ruta actual y saldo suficiente incluso para ventas atrasadas. Una caja conserva su ruta original. No se permite cambiar la ruta de un vendedor con jornada abierta; debe terminar esa jornada antes de iniciar otra ruta. Los pedidos pendientes no se borran por el cambio de día, aunque no aparecen en el historial de un vendedor si pertenecen a otro día.

Antes de actualizar un dispositivo antiguo, conviene sincronizar sus ventas pendientes. Una venta electrónica aún no registrada y sin referencia no puede confirmarse con las reglas nuevas. Los PDF descargados o impresos previamente son copias externas y no se pueden retirar al cambiar el día o anular una factura.

La web y API se despliegan en Vercel y Railway. Android requiere compilar e instalar un APK actualizado; la exportación JavaScript no instala una nueva aplicación en el teléfono.

## Verificación

- `npm test`: permisos, medianoche, precisión monetaria, referencias, cartera, abonos dentro/fuera de caja, distribución, cierres, anulaciones y sus ajustes/devoluciones/reasignaciones, concurrencia de stock, migración y errores de Excel.
- `npm run check`: TypeScript.
- `npm run test:e2e`: flujo existente y permisos de historial a seis anchos, con cambio de día sin señal.
- `npm run test:e2e:operations`: asignación con edición, búsqueda online/offline paginada, respuesta atrasada, cierre conjunto con devolución prellenada/diferencia, confirmación de equipos antiguos, doble clic, PDF e importación.
- `npm run export:web -w mobile` y `npm exec -w mobile -- expo export --platform android`: compilaciones.
- `npm exec -w mobile -- expo install --check`: compatibilidad de Expo.

La auditoría de dependencias sigue informando las vulnerabilidades sin versión corregida de `braces` y `node-forge`, usadas por las herramientas de Expo. UUID se actualiza a 11.1.1 también en la instalación aislada del servidor. No se aplican las degradaciones de Expo/ExcelJS que sugiere `npm audit fix --force`.
