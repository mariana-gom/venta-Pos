# Arquitectura y plan de implementación

Inspección inicial: carpeta sin archivos de aplicación, únicamente un repositorio Git vacío. Todos los archivos se crean dentro de esta carpeta. No se modifica otra tarea ni se usan puertos ocupados sin comprobarlos.

## Decisiones

- Cliente móvil Expo/React Native dirigido a Android, según la confirmación del usuario. API Node 24 + Express. SQLite en disco con claves foráneas, WAL y transacciones BEGIN IMMEDIATE. Una instalación de API centraliza las cajas de todos los celulares; no usar el archivo SQLite en unidades de red.
- Primera versión con conexión obligatoria. No hay cola de ventas offline ni sincronización. Una petición fallida puede consultarse/reintentarse con la misma clave de idempotencia sin duplicar la venta.
- Una caja abierta por vendedor; solo su propietario vende en ella. Administradores consultan y cierran cualquier caja. El saldo inicial se suma al efectivo esperado, nunca al total vendido.
- Dinero en centavos enteros y cantidades en milésimas (máximo tres decimales para kg, enteros para unidades). Redondeo comercial por línea a centavo mediante enteros/BigInt. La API calcula precios y totales.
- Credenciales scrypt con sal, tokens opacos aleatorios almacenados como SHA-256, caducidad y revocación. Tokens móviles en SecureStore. HTTPS obligatorio al exponer el servidor fuera del desarrollo local.
- Cierres, ventas, detalles, pagos y auditoría protegidos contra modificación/borrado mediante triggers. Correcciones de cierres son anotaciones anexas con autor y fecha; los valores originales siguen intactos.
- PDF con texto real, ancho predeterminado de 80 mm y altura variable; 58 mm disponible como alternativa. Generación en servidor; descarga autenticada y compartir/imprimir por el sistema operativo. Bluetooth ESC/POS requiere adaptador nativo específico y prueba con hardware.

## Entidades

Usuarios → sesiones de autenticación. Productos (precio, unidad/kg, estado, stock opcional). Clientes. Plataformas electrónicas. Cajas → ventas → detalles y pagos. Caja → cierre único → anotaciones. Configuración del negocio. Auditoría.

Ventas conservan instantáneas de cliente, vendedor, negocio, producto, precio y plataforma. Cierres conservan instantáneas completas de conciliación, apertura, responsables y subtotales por plataforma. Las copias PDF usan esas instantáneas.

## Etapas

1. Autenticación y permisos: API y esquema, creación segura del primer administrador y usuarios administrados.
2. Productos/clientes: CRUD validado, desactivación, stock opcional y trazabilidad.
3. Caja: apertura única por vendedor, saldo inicial e historial permanente.
4. Ventas: unidades/kg, instantáneas, transacciones e idempotencia.
5. Pagos: efectivo/electrónico, plataformas configurables y totales separados.
6. Cierres: conciliación, exclusividad administrativa, cierre atómico e inmutable.
7. Historial: filtros, agrupaciones, detalle, consulta de cajas anteriores.
8. PDF: formatos térmicos, descarga, compartir e impresión del sistema.
9. Validación: pruebas funcionales, permisos, persistencia y guía de operación.

La interfaz se conecta a los módulos reales de la API. La validación en dispositivo y la impresión física se registrarán como pendientes si no hay hardware disponible.

## Documentos y control de revisión

Los PDF se generan automáticamente en ambos anchos y se almacenan como BLOB en `documents` con referencia a la venta o cierre. La respuesta informa si un PDF queda pendiente; la venta/cierre confirmado no se pierde ni se repite por un fallo documental. La descarga posterior usa la copia guardada o la genera desde la instantánea si faltaba.

El cierre admite `reviewed_sale_count`: si cambió la cantidad de ventas desde la pantalla de revisión, se rechaza antes de guardar, para que el administrador revise el nuevo total. El cierre y las ventas se serializan mediante la transacción de escritura SQLite. Los PDF se generan después del commit para no retener el bloqueo de la caja durante el renderizado.
