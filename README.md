# Control de Liquidaciones v0.2

Primer motor funcional del módulo independiente de auditoría Altas vs Ventas.

## Qué hace

- Carga XLSX / XLS / CSV.
- Detecta columnas aunque cambien levemente los títulos.
- Cruza por CUIL y usa DNI como respaldo.
- Controla:
  - cápitas;
  - valor del plan;
  - descuento;
  - valor liquidable / precio con descuento.
- Admite variación positiva de hasta +2,40%.
- Genera fichas para casos que requieren decisión.
- Guarda borradores e historial local en el navegador.
- Impide cerrar mientras haya pendientes.
- Genera un informe PDF simple al cerrar.

## Dependencias

Se cargan por CDN:
- SheetJS (`xlsx`) para leer Excel/CSV.
- jsPDF para generar el informe.

Por eso, la página necesita conexión a Internet para cargar esas dos librerías.

## Importante sobre los PDFs de ejemplo

Los dos archivos usados para definir las reglas fueron exportaciones PDF. La v0.2 procesa los archivos fuente XLSX/XLS/CSV, no PDFs. Para operar normalmente, cargá las planillas originales.

## Próximo paso

Validar el motor con los XLSX originales de un período real. Después:
- mejorar detección de duplicados;
- consultar historial de período anterior automáticamente;
- migrar historial a backend;
- exponer resumen al Work Hub / Work Assistant.
