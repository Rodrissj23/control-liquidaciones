# Control de Liquidaciones 1.0

Carga Altas y Ventas tal como llegan en Excel, CSV o PDF con texto seleccionable, normaliza los datos y compara sin depender del formato de entrada.

## Flujo

1. Elegir período y cargar ambos archivos.
2. Revisar cantidad de registros, cápitas conocidas, avisos y vista previa.
3. Comparar y resolver faltantes, diferencias, datos incompletos y asociaciones duplicadas.
4. Guardar y retomar un borrador, o cerrar el control y descargar el informe PDF.

El historial se guarda en el navegador (hasta 50 controles). Guarda los datos normalizados, los nombres de los archivos y las decisiones; los archivos originales no se almacenan en el historial. La carga y el análisis se hacen localmente, sin enviar documentos a un servidor.

## Arquitectura

- `core.js`: esquema canónico, normalización de encabezados y reglas de comparación independientes de las fuentes.
- `app.js`: adaptador Excel/CSV, carga, revisión, historial e informe.
- `pdf-support.js`: adaptadores de las variantes conocidas de Altas y Ventas de Prevención, con y sin región, solicitud, fecha o columnas financieras completas.
- `numeric-fix.js`: separadores de miles y decimales.
- `truncated-value-fix.js`: compatibilidad con importes truncados y trazabilidad de la reconstrucción.

Los campos canónicos son: origen (`src`), fila de origen, CUIL/DNI, nombre, plan, cápitas, valor de plan, descuento y liquidable, con período, solicitud, región y estado cuando estén presentes. Las demás columnas quedan fuera de la representación normalizada. Los datos ausentes quedan como `null`; no se completan con datos de la contraparte.

No es un lector universal: nuevos diseños de PDF necesitan un adaptador validado. PDF escaneado requiere otra etapa de OCR, aún no implementada. Los registros que no se puedan interpretar bloquean la importación. Los registros reconocidos con campos faltantes permanecen visibles y requieren revisión.

## Validación

```bash
node --test tests/core.test.cjs
```

Se verificaron además las exportaciones reales de agosto (146 Altas y 158 Ventas) y una exportación reducida de septiembre (38 Ventas). El formato de Altas de septiembre se probó con una reproducción del texto visible en la captura; falta el archivo completo para validar todos sus registros.

## Dependencias

SheetJS, PDF.js y jsPDF se cargan desde CDN. Hace falta conexión para cargar esas dependencias.

## Evolución

La siguiente etapa reemplaza la carga manual de Ventas por una fuente de planilla o CRM, que entregue el mismo esquema canónico. La comparación por períodos anteriores, consultas autenticadas y almacenamiento compartido no están conectados en esta versión.
