# Estado de implementación y validación

Fecha: 10 de octubre de 2026. Trabajo realizado únicamente en la carpeta seleccionada, que inicialmente no contenía aplicación. No se detuvieron procesos ajenos, no se usó otra base ni se desplegó a servicios externos.

## Etapas

1. **Autenticación y permisos implementados.** `server/src/auth.js`, `schema.sql`, `db.js`, `setup-admin.js`, `app.js`, `mobile/src/api.ts`, `mobile/App.tsx`. Contraseñas scrypt con sal, tokens opacos de 12 horas guardados como hash, revocación al salir/desactivar/restablecer contraseña, rate limit de login. Permisos en rutas y servicio de cierre, además de trigger administrativo en SQLite. Primer administrador por asistente; vendedores creados por administrador. Probado hash, login inválido, logout y denegación administrativa.
2. **Productos y clientes implementados.** `validation.js`, `app.js`, `CatalogScreen.tsx`, `SaleScreen.tsx`. CRUD validado, unidades/kg, precio positivo, desactivación, stock opcional, cliente nombre/ciudad, deduplicación por nombre/ciudad, creación en venta sin perder carrito. Probadas operaciones reales y precio histórico; E2E prueba cliente creado desde carrito.
3. **Sesiones de caja implementadas.** `schema.sql`, `service.js`, `CashScreen.tsx`. Caja abierta única por vendedor, saldo inicial independiente, estado y fechas, historia permanente. Probado reinicio de API y reapertura del archivo SQLite, apertura repetida rechazada y sesión nueva con cero ventas.
4. **Ventas implementadas.** `money.js`, `service.js`, `SaleScreen.tsx`. Centavos enteros, cantidades en milésimas, unidades enteras, instantáneas, transacción e idempotencia. Verificación de precio revisado, producto activo y existencias. Carrito se conserva al navegar en sesión; referencia pendiente guardada en el celular para reintento tras reinicio. Probadas unidades, kg, cantidades inválidas, carrito vacío, stock insuficiente y rechazo de precio cambiado.
5. **Pagos implementados.** `schema.sql`, `service.js`, `SettingsScreen.tsx`. Un método por venta, plataforma electrónica obligatoria, plataformas configurables y desactivables, tabla de pagos separada preparada para futura ampliación. Probado Nequi y subtotal por plataforma.
6. **Cierre implementado.** `service.js`, `CashScreen.tsx`, triggers de esquema. Exclusivo del administrador, conciliación por método, base incluida en efectivo esperado, cierre atómico/único/inmutable. Anotaciones anexas auditadas. Si cambia el número de ventas desde revisión, se rechaza para revisar de nuevo. Probados valores del ejemplo, rechazo al vendedor, cierre duplicado y ventas después del cierre; carrera de venta/dos cierres.
7. **Historial implementado.** `app.js`, `HistoryScreen.tsx`. Historial de cajas, ventas paginadas, filtros por usuario/fecha Colombia/cliente/pago y agrupaciones por usuario/fecha/cliente/pago/plataforma. Cierres con datos completos, ventas incluidas y anotaciones. Probada conservación de ventas tras cierre y nueva apertura; E2E abre ventas del cierre.
8. **Documentos implementados.** `pdf.js`, `documents.js`, `schema.sql`, `mobile/src/api.ts`, `HistoryScreen.tsx`. PDFs de texto real en ambos anchos, generación automática y almacenamiento BLOB inmutable. Estado explícito si falla generación después de guardar la operación. Descarga autenticada, compartir/abrir/guardar e impresión del sistema. PDF de venta/cierre en 58/80 mm renderizados con Poppler y revisados sin recortes. Probada copia binaria idéntica tras cambiar configuración. **Impresión física/Bluetooth pendiente de hardware.**
9. **Validaciones y pruebas automatizadas realizadas.** `server/test/core.test.js`, `server/test/api.test.js`, `scripts/e2e.mjs`. Cinco pruebas Node (incluyen flujo integral y concurrencia) y un E2E con interfaz a 390×844. Verificación TypeScript, compatibilidad de dependencias Expo y exportación de JavaScript/Hermes Android/iOS. Respaldo consistente SQLite probado y reabierto con ventas y documentos. **Aceptación nativa, impresión física y avisos de herramientas pendientes.**

## Casos obligatorios

1. $5.000 × 3 unidades = **$15.000**, automatizado y E2E.
2. $24.000 × 1,5 kg = **$36.000**; 0,250 kg = **$6.000**, automatizado. E2E verifica 1,5 kg.
3. $50.000 por Nequi, **$50.000 electrónico y Nequi**, automatizado.
4. Ventas efectivo $2.000.000/electrónico $500.000; declarado $2.300.000/$200.000 → **+$300.000, −$300.000 y $0**, automatizado y PDF revisado.
5. Datos de caja y ventas tras cerrar/reabrir API y SQLite, automatizado; recarga de interfaz E2E conserva resumen.
6. Vendedor intenta cierre → **403**, automatizado.
7. Caja nueva sin ventas y caja anterior con cinco ventas, automatizado.
8. Consulta de cierre y ventas originales, automatizado y E2E.
9. Cambio de precio/nombre conserva originales de detalle, automatizado.
10. Venta/cierre en ambos anchos, PDF válidos con texto y medidas correctas; descarga desde UI probada. **No se ha probado impresión real.**

## Comandos ejecutados

- `npm test`: cinco pruebas aprobadas, incluidas transacciones, permisos, historial, respaldos, documentos e idempotencia.
- `npm run test:e2e`: flujo de usuario y administrador aprobado usando una base temporal; genera capturas en `output/screenshots`.
- `npm run check`: TypeScript aprobado.
- `npm exec -w mobile -- expo install --check`: dependencias compatibles.
- `npm run export:web -w mobile`: exportación web aprobada; E2E exporta con su servidor temporal propio.
- `npm exec -w mobile -- expo export --clear --platform android --platform ios`: bundles Hermes generados. Esto **no equivale** a compilar un APK/IPA ni ejecutarlo en hardware.
- `npm audit -w server --omit=dev`: cero vulnerabilidades notificadas para dependencias del servidor.

## Auditoría de dependencias móviles

La auditoría del workspace completo mantiene **30 avisos altos**, propagados desde dos dependencias de las herramientas Expo/Metro: `braces@3.0.3` y `node-forge@1.4.0`. No hay versión corregida publicada en el registro consultado. La sugerencia automática de npm baja Expo a una versión antigua e incompatible, por lo que no se aplicó `audit fix --force`. El aviso de `uuid` se resolvió con un override a 11.1.1 compatible con el uso v4 de xcode.

Avisos concretos: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm y https://github.com/advisories/GHSA-86w9-cpqp-85rv. Antes de distribución de producción, revisar los parches publicados por Expo/Metro y las dependencias afectadas. No exponer el servidor de desarrollo Metro a internet. La API no utiliza esos paquetes.

## Límites pendientes de aceptación

- El usuario confirmó Android e impresora genérica MTP-3 de 80 mm. Falta comprobar su variante, protocolo y hardware real. Ejecutar el protocolo de `IMPRESION.md` en el hardware antes de dar la impresión por terminada.
- No hay instalador APK/IPA generado, firma de distribución, publicación ni despliegue de API. Se incluye configuración EAS para construir un APK cuando se configure la cuenta Expo y la URL HTTPS.
- Conexión a servidor obligatoria; no hay sincronización offline. La persistencia del servidor está implementada, pero su instalación y política de respaldos deben configurarse para uso diario.
- No se implementan impuestos, facturación electrónica, anulaciones, compras/proveedores ni pagos mixtos. El stock opcional y sus ajustes administrativos sí están implementados.

Los módulos de negocio están implementados y probados; no se declara terminada la validación física de impresión ni una entrega de producción firmada.

## Configuración confirmada por el usuario

Plataforma principal: Android. Papel: 80 mm. El esquema inicial y el cliente usan 80 mm por defecto; se mantiene 58 mm como opción. La configuración Expo declara Android y web para validación. Modelo indicado: MTP-3 genérico. El manual de la familia orienta a Bluetooth/ESC/POS; su compatibilidad exacta y transporte requieren prueba con la unidad real. Los ajustes de instalaciones existentes y los comprobantes históricos no se sobrescriben automáticamente.

## Ajuste del inicio local

Se mejoró el asistente para validar cada campo y volver a solicitar datos inválidos sin imprimir contraseñas ni una traza técnica. Se probó en terminal: usuario corto rechazado, corrección, contraseña corta rechazada y creación correcta en una base temporal.

Se añadió `npm run dev` para iniciar API y web, con verificación TCP de puertos y cierre únicamente de los procesos de la propia ejecución. Se verificaron arranque de ambos componentes y rechazo de un puerto ocupado sin detener su proceso. Las cinco pruebas del backend y TypeScript continúan aprobados. La base del usuario no recibió credenciales ni registros de prueba.

## Rediseño DANNY'S (11 de octubre de 2026, rama `feat-rediseño`)

Interfaz rehecha en todas las pantallas (inicio de sesión, Inicio, Vender, Caja, Catálogo, Historial, detalle de venta, vista previa del comprobante, cierre, Perfil y hojas de formulario) sin cambiar reglas de negocio, pagos ni cálculos de caja. Cambios de servidor acotados: columnas opcionales `business_nit`, `business_address`, `business_phone` y `business_city` en `settings` (migración automática con `ALTER TABLE ADD COLUMN`; el nombre genérico “Mi negocio” pasa a “DISTRIBUIDORA & SALSAMENTARIA DANNY'S” y un nombre personalizado se respeta), copia de esos datos en la instantánea de cada venta nueva, número corto de caja calculado por orden de apertura y nuevo diseño PDF.

Errores corregidos: la validación del carrito usaba aritmética de punto flotante (`1,1 kg` daba 1100,0000000000002 milésimas y bloqueaba la venta); un doble toque rápido en Confirmar podía enviar dos ventas con referencias distintas antes de que el botón se deshabilitara (ahora hay bloqueo síncrono); los campos de dinero rechazaban separadores de miles colombianos (`50.000`); una respuesta no JSON del servidor mostraba un error técnico.

Comprobado:

- `npm test`: 10 pruebas aprobadas, incluidas migración, datos fiscales congelados, número de caja, comprobante 58/80 mm (pollo 125,5 kg × $12.000 = $1.506.000, nombres largos, 40 artículos) y lectura de cantidades/dinero de la app.
- `npm run check`: TypeScript aprobado.
- `npm run test:e2e`: flujo completo en navegador (vendedor y administrador), incluido doble clic sin venta duplicada, stock descontado, cambio en efectivo, filtros, cierre con conciliación y descarga del PDF; sin desplazamiento horizontal en 320, 360, 390, 430, 768 y 1280 px. Capturas en `output/screenshots/`.
- `expo export --platform android`: bundle Hermes generado. No equivale a probar en un celular real.
- PDF de muestra renderizados y revisados visualmente (Quick Look de macOS).

Pendiente: prueba en celulares Android/iPhone reales (teclados, áreas seguras, botón atrás) e impresión física en la MTP-3 de 58/80 mm, incluida la legibilidad del logo monocromático.
