# Evolución del control de liquidaciones

## Implementado: entrada normalizada y control manual

- Adaptadores PDF y Excel/CSV hacia un esquema común.
- Vista previa con registros, datos incompletos y duplicados.
- Comparación explicada y revisión humana de excepciones.
- Historial local retomable e informe de cierre.

## Próxima etapa: cargar solo Altas

1. Elegir una fuente autorizada de ventas: planilla o CRM, con identificación de la tabla y los campos.
2. Implementar el adaptador de lectura de esa fuente hacia el esquema común.
3. Definir el conjunto de comparación: marca, vigencia y estados elegibles; distinguir fecha de origen, vigencia y período liquidado.
4. Validar candidatos por DNI/CUIL y solicitud; dejar explícitos los conflictos de identidad.
5. Mostrar qué fuente y versión se consultó, cuándo y qué datos faltan.

La primera prueba debe ser de lectura y comparación; las decisiones de liquidación siguen siendo del usuario.

## Después: control entre períodos

- Registrar por venta y período lo liquidado, diferencias, reclamos y resoluciones.
- Detectar ventas ya liquidadas, pendientes anteriores y posibles duplicaciones entre liquidaciones.
- Consultar automáticamente controles anteriores con referencias verificables.
- Persistencia compartida, permisos y auditoría de revisiones.
- Alimentar el Centro de Atención de WORK AGENT con excepciones concretas.

Los adaptadores futuros no deben completar una fuente incompleta usando los datos de la contraparte: hacerlo convertiría el cruce en una coincidencia artificial.
