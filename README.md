# Venta POS móvil

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

Esta versión requiere conexión a la API para guardar y consultar. No se implementa venta offline. El celular conserva la referencia de una venta cuya confirmación quedó pendiente y permite reintentar sin duplicar. Los datos definitivos están en el servidor.

## Flujo de operación

1. Administrador configura negocio, plataformas y usuarios en Perfil, productos/clientes en Catálogo.
2. Vendedor inicia sesión y abre su caja con saldo inicial.
3. En Vender selecciona o crea cliente, añade productos, ingresa unidades enteras o kg con hasta tres decimales, escoge pago y confirma.
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

El catálogo admite stock opcional: vacío desactiva control; un valor activa existencias y descuenta cada venta. Ajustes administrativos quedan en auditoría. No se implementan compras, impuestos, facturación electrónica, pagos mixtos ni anulaciones. Los recibos son comprobantes comerciales.

## Documentación

- [Modelo y etapas](docs/ARQUITECTURA.md)
- [Impresión y compatibilidad](docs/IMPRESION.md)
- [Validación y estado por etapa](docs/VALIDACION.md)

Pendiente de aceptación: instalación y pruebas en celulares Android reales, prueba física de la impresora genérica MTP-3 de 80 mm e integración Bluetooth ESC/POS según la variante real. PDF y impresión directa Bluetooth son funciones distintas.

## Instalador móvil

`mobile/eas.json` incluye un perfil `preview` para APK Android y un perfil de producción. Con una cuenta Expo configurada, desde `mobile/`, se puede ejecutar `npx eas-cli build --platform android --profile preview`. Configura una API HTTPS accesible por el celular antes de construir. No se ejecutó una compilación remota ni se publicó la app en tiendas. El código JavaScript nativo puede verificarse localmente con `npm exec -w mobile -- expo export --platform android`.
