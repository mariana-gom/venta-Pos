# Impresión y prueba real

Configuración confirmada por el usuario: celular Android e impresora con papel de 80 mm. Este es el ancho predeterminado para nuevas instalaciones. Impresora indicada por el usuario: genérica, modelo MTP-3. La variante de hardware, firmware y transporte Bluetooth aún requieren prueba.

## Diseño del comprobante

El comprobante incluye el logo oficial en versión de impresión (`server/assets/dannys-logo-print.png`, escala de grises sobre blanco generada desde el original con `scripts/logo-print.mjs`), nombre comercial, solo los datos fiscales configurados (NIT, dirección, ciudad, teléfono), número corto de venta (`#0025`), fecha y hora separadas, vendedor, caja corta (`#3`, en vez del UUID), cliente y ciudad. Cada producto muestra su nombre en mayúsculas y, debajo, `cantidad × precio` a la izquierda y el subtotal a la derecha; si no caben en una línea, el subtotal baja alineado a la derecha. Total resaltado entre líneas dobles, método de pago y el aviso “Comprobante de venta. No es factura electrónica.” Sin fondos oscuros.

Márgenes laterales calculados para el área imprimible habitual: 5 mm en papel de 58 mm (48 mm útiles) y 4 mm en papel de 80 mm (72 mm útiles). La app muestra una vista previa con los datos guardados de la venta antes de imprimir. Los datos del negocio se congelan en la venta: editarlos después no cambia los comprobantes ya emitidos, y los PDF guardados de ventas anteriores conservan su diseño original.

La API genera PDF con texto seleccionable mediante PDFKit. El ancho físico es exactamente 58 o 80 mm (164,409 o 226,772 puntos); la altura depende del contenido. Los tickets extensos se dividen si superan el límite de página PDF. No se crean hojas carta. Las copias de cierre usan el snapshot original, sin recalcular ni incorporar modificaciones posteriores del negocio.

En Android/iOS se descarga el archivo con autenticación y se entrega a expo-sharing o expo-print. Abrir/guardar muestra el selector del sistema para elegir visor, Archivos o una aplicación compatible. En web se descarga el archivo, que se abre con el visor PDF del navegador.

La generación de PDF no establece comunicación Bluetooth con una impresora. expo-print usa servicios de impresión del sistema: AirPrint en iOS y el servicio de impresión instalado en Android. Una impresora Bluetooth SPP/ESC/POS puede necesitar la app del fabricante o un módulo nativo.

## Integración propuesta para la MTP-3 genérica

El manual original de la familia MTP-3 describe comandos ESC/POS y conexión Bluetooth para Android. Esto orienta la integración, pero no demuestra que todas las variantes genéricas tengan el mismo firmware, ancho imprimible o transporte. No se identifica esta unidad como GOOJPRT sin comprobar la etiqueta.

La ruta propuesta es Bluetooth Classic SPP/RFCOMM con comandos ESC/POS, condicionada a que la unidad real exponga ese servicio. Si solo ofrece BLE, se necesitará el servicio y la característica GATT documentados por su proveedor; no enviar comandos a una característica arbitraria.

Para el proyecto Expo, usar un módulo nativo Android que liste dispositivos ya emparejados, permita seleccionar la impresora explícitamente y mantenga una cola de impresión. La biblioteca Android DantSu/ESCPOS-ThermalPrinter-Android es una candidata para ese módulo; su integración debe compilarse y probarse con la versión actual de Expo. Se requiere un APK propio o development build para incluirlo; la función actual de expo-print no es un transporte ESC/POS.

En Android 12+ solicitar BLUETOOTH_CONNECT al acceder a dispositivos emparejados. Emparejar desde Ajustes de Android permite evitar descubrimiento dentro de la aplicación y sus permisos adicionales. Si se implementa búsqueda interna, declarar y solicitar BLUETOOTH_SCAN según la documentación Android.

La impresión directa leerá el detalle de una venta/cierre ya confirmado por la API y enviará su contenido histórico a la impresora. Un fallo o reintento de impresión nunca creará una venta nueva. No se debe presentar un envío Bluetooth como impresión física confirmada cuando la impresora no devuelve ese estado.

Configurar el ancho imprimible y la tabla de caracteres desde el autotest real: papel de 80 mm no implica 80 mm imprimibles. Probar acentos, ñ, valores, productos por kg, alimentación y observaciones. No activar corte automático sin comprobar que la impresora tiene cortador.

Estado: modelo documentado e integración definida; módulo Bluetooth, APK y prueba en esta unidad física pendientes. La aplicación conserva la generación PDF y la impresión mediante servicios Android que ya estaban implementadas.

## Prueba con la unidad física

1. Identificar modelo, firmware, ancho, resolución (por ejemplo 203 dpi), protocolo, Bluetooth Classic SPP o BLE, y soporte Android/iOS.
2. Si el fabricante acepta PDF, compartir a su app e imprimir al 100 %, sin ajustar a carta.
3. Para ESC/POS directo, integrar un adaptador nativo y crear un development build de Expo. Expo Go no incorpora módulos Bluetooth arbitrarios. Android 12+ requiere permisos Bluetooth correspondientes. iOS no admite cualquier dispositivo SPP; comprobar BLE/MFi y SDK del fabricante.
4. El adaptador debe convertir el recibo a comandos compatibles, controlar caracteres españoles, ancho de columnas, alimentación y corte según soporte del modelo. Nunca debe registrar otra venta al reintentar una impresión.

## Protocolo de aceptación

- Descargar una venta y un cierre en ambos anchos.
- Abrir cada PDF y verificar texto, acentos, total, cliente y diferencias con los registros de la API.
- Imprimir con escala 100 % en la impresora real; comprobar márgenes, tamaño de fuente, recorte, longitud y orientación.
- Probar compartir/guardar, impresora desconectada y reimpresión de una venta/cierre histórico.
- Registrar marca/modelo, sistema del celular, servicio de impresión, ancho y resultado.

Estado actual: PDF generados y revisados visualmente en 58/80 mm. Prueba de impresión física y Bluetooth no realizada: se indicó el modelo MTP-3 genérico, pero no hay acceso a la unidad física.

Referencias: https://docs.expo.dev/versions/v57.0.0/sdk/print/ y https://docs.expo.dev/versions/latest/sdk/sharing/.

## Fuentes para la integración

- [Manual original de la familia MTP-3](https://ae01.alicdn.com/kf/S55918724c77144889e36e53322da7f7c1.pdf). La aplicabilidad exacta a la unidad genérica del usuario está pendiente de comprobar.
- [Permisos Bluetooth de Android](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).
- [Biblioteca Android ESC/POS de DantSu](https://github.com/DantSu/ESCPOS-ThermalPrinter-Android).
- [Development builds de Expo](https://docs.expo.dev/develop/development-builds/introduction/).
