# DANNY'S POS — Distribuidora & Salsamentaria Danny's

Aplicación Expo/React Native dirigida a Android con API Node 24 y SQLite persistente. Implementa acceso por roles, productos por unidad/kg, clientes, stock opcional, pagos, caja por vendedor, cierres administrativos auditables, historial y PDF térmicos de 80 mm por defecto (58 mm también disponible).

## Inicio rápido en navegador

Desde la raíz del proyecto:

```sh
npm run setup-admin  # Primera vez: usuario sin espacios, nombre y contraseña de 12–128 caracteres
npm run dev
```

`npm run dev` inicia la API y la interfaz web en una sola terminal. Abre `http://localhost:8097`; Ctrl+C detiene únicamente los procesos de esa ejecución. Si un puerto está ocupado, el comando informa y no detiene procesos ajenos. Los comandos independientes de abajo siguen disponibles para Android y otros flujos.

El asistente vuelve a pedir los datos inválidos y mantiene la contraseña oculta. Si ya existe un administrador, conserva la cuenta y muestra cómo iniciar. El aviso de Node sobre `.env` ausente no impide usar los valores locales predeterminados.

## Inicio local

Desde esta carpeta, con Node 24:

```sh
npm install
cp server/.env.example server/.env
npm run setup-admin
npm run server
```

El asistente pide usuario, nombre y contraseña (mínimo 12 caracteres). No existen contraseñas predeterminadas. Inicia sesión con ese administrador para crear vendedores, productos y clientes. La base se guarda en `server/data/pos.sqlite`; no se borra al reiniciar ni al cerrar sesión.

En otra terminal:

```sh
cp mobile/.env.example mobile/.env
npm run mobile
```

En `mobile/.env`, configura `EXPO_PUBLIC_API_URL` con la IP del servidor visible desde el celular. Para una prueba en la misma red, cambia `HOST=0.0.0.0` en `server/.env` y usa el mismo Wi-Fi. Reinicia ambos procesos tras cambiar configuración. Para web local usa `http://localhost:4317` y `npm run web -w mobile`.

API: puerto **4317**. Expo: puerto **8097**. No se detienen otros procesos. Si un puerto está ocupado, cambia `PORT` y la URL del cliente, o pasa otro puerto a Expo y actualiza `CORS_ORIGINS`. Los scripts no despliegan ni modifican proyectos externos.

Con señal, la app trabaja directamente con la API. Sin señal (rutas), vende en modo ruta y sincroniza después: ver docs/MODO-RUTA.md. El celular conserva la referencia de una venta cuya confirmación quedó pendiente y permite reintentar sin duplicar. Los datos definitivos están en el servidor.

## Diseño y navegación

Interfaz mobile first con la identidad de DANNY'S: logo oficial (`mobile/assets/brand/dannys-logo.png`, sin redibujar ni deformar), verde corporativo, superficies blancas y acentos amarillo/naranja con moderación. Componentes compartidos en `mobile/src/ui.tsx` (botones, campos, tarjetas, hojas inferiores, confirmaciones, avisos, estados vacíos y de carga) y formato/lectura de valores colombianos en `mobile/src/format.ts`.

Navegación inferior de cinco pestañas: Inicio, Caja, **Vender** (al centro), Catálogo e Historial. Perfil, configuración y cierre de sesión se abren desde el avatar del encabezado. El botón atrás de Android cierra primero hojas y subpantallas y luego vuelve a Inicio.

- **Vender:** cliente en una fila tocable (buscar o crear sin salir de la venta), búsqueda sin tildes, unidades con un toque y kilos con hoja de peso (atajos 0,25 · 0,5 · 1 · 1,5 · 2 · 3 kg, coma o punto decimal). Carrito con − / + y edición directa. El total y el botón Cobrar quedan fijos sobre la navegación. Pago en un toque (Efectivo o cada plataforma activa) con cálculo de cambio. La confirmación tiene bloqueo contra doble toque y, al terminar, ofrece imprimir, compartir, ver comprobante o iniciar otra venta.
- **Historial:** los vendedores solo consultan sus ventas del día actual; el administrador conserva los filtros Hoy, Ayer, 7 días, Todo y Rango; método de pago; cliente y vendedor. Detalle de venta y vista previa del comprobante antes de imprimir o compartir.

## Flujo de operación

1. Administrador configura negocio (nombre, NIT, dirección, ciudad, teléfono y papel), plataformas y usuarios en Perfil, y productos/clientes en Catálogo.
2. Vendedor inicia sesión y abre su caja con saldo inicial.
3. En Vender selecciona o crea cliente, añade productos, ingresa unidades enteras o kg con hasta tres decimales, escoge efectivo, electrónico con número de referencia o crédito para un cliente registrado y confirma.
4. La API calcula el total, conserva precios históricos, actualiza stock si está activado y registra venta/detalles/pago en una transacción.
5. En el comprobante, abre/guarda, comparte o imprime el PDF. Una falla de impresión no revierte ni duplica la venta.
6. Administrador entra en Caja, cuenta efectivo (incluido el saldo inicial), verifica pagos electrónicos, revisa diferencias y confirma el cierre definitivo.
7. En Historial de cierres consulta originales, sus ventas y PDF; puede anexar una aclaración auditada sin cambiar el cierre.

**Regla de caja:** una abierta por vendedor. Solo su propietario vende en ella. Administrador consulta/cierra cualquier caja. Dinero inicial separado de ventas: efectivo esperado = saldo inicial + ventas efectivo. Diferencia = declarado − esperado. Electrónico se concilia independientemente.

## Verificación

```sh
npm test
npm run check
npm exec -w mobile -- expo install --check
npm run export:web -w mobile
npm run test:e2e
```

E2E necesita Chromium de Playwright (`npx playwright install chromium` si falta). Usa base temporal y servidor con puerto libre automático; no altera la base del negocio ni genera usuarios en ella. Comprueba la interfaz a 390 px de ancho y genera capturas en `output/screenshots/`.

Para generar PDF de muestra con datos exclusivamente de prueba:

```sh
PDF_OUTPUT_DIR=../output/pdf npm test -w server
```

## Copias y operación

`npm run backup` crea una copia consistente en `server/backups/`, aun con WAL activo. Guarda copias fuera del equipo según tu política. Restauración: detener API, conservar una copia del estado actual, restaurar el archivo de respaldo como `server/data/pos.sqlite` y retirar los antiguos archivos WAL/SHM del estado detenido antes de reiniciar. No copiar una base activa con `cp`.

Usa HTTPS y un proxy de confianza para acceso fuera del desarrollo local, limita permisos del directorio de datos y no publiques `.env`, bases ni respaldos. Ejecuta la API como un servicio persistente para uso diario; el celular no es el servidor. SQLite es apropiado para esta instalación centralizada de pequeño negocio; mayor escala requerirá migrar el repositorio de datos a PostgreSQL.

El catálogo solicita nombre, unidad/kg y un único precio. No captura stock inicial. Las cargas diarias se registran en Perfil → Carga de stock por ruta; conservan sobrantes y descuentan saldo central cuando existe. Los productos históricos sin inventario conservan su comportamiento. Ajustes y devoluciones explícitos quedan auditados. Se implementan crédito, cartera, anulaciones auditadas, inventario por ruta e importación del precio mayorista del Excel como único precio del POS. No se implementan compras, impuestos, facturación electrónica ni pagos mixtos. Los recibos son comprobantes comerciales.

## Documentación

- [Modelo y etapas](docs/ARQUITECTURA.md)
- [Impresión y compatibilidad](docs/IMPRESION.md)
- [Validación y estado por etapa](docs/VALIDACION.md)
- [Despliegue en Railway + Vercel](docs/DESPLIEGUE.md)
- [Crédito, cartera, rutas e importación](docs/OPERACIONES.md)
- [Modo ruta: ventas sin señal y sincronización](docs/MODO-RUTA.md)

Pendiente de aceptación: instalación y pruebas en celulares Android reales, prueba física de la impresora genérica MTP-3 de 80 mm e integración Bluetooth ESC/POS según la variante real. PDF y impresión directa Bluetooth son funciones distintas.

## Instalador móvil

`mobile/eas.json` incluye un perfil `preview` para APK Android y un perfil de producción. Con una cuenta Expo configurada, desde `mobile/`, se puede ejecutar `npx eas-cli build --platform android --profile preview`. Configura una API HTTPS accesible por el celular antes de construir. No se ejecutó una compilación remota ni se publicó la app en tiendas. El código JavaScript nativo puede verificarse localmente con `npm exec -w mobile -- expo export --platform android`.
