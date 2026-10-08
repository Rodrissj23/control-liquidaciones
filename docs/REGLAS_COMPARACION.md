# Reglas de comparación — 1.0

- Cruce por identidad: CUIL y DNI como respaldo. Antes del cruce, bloquear la asociación automática si la identidad está repetida en cualquiera de las fuentes.
- Cada registro se conserva en el resultado, también cuando faltan valores o no hay contraparte.
- Controlar plan, cápitas, valor del plan, descuento y liquidable. Un CUIL diferente para el mismo DNI también requiere revisión.
- Solo aceptar variación positiva de hasta +2,40%, con margen de redondeo monetario de $1,50.
- Un valor ausente, inválido o un importe/cápitas no positivo nunca puede calificarse como correcto. Descuento cero sí es válido.
- Verificar coherencia de plan/descuento/liquidable en ambas fuentes.
- Mantener el mecanismo histórico de reconstrucción de importes truncados; mostrar el valor original y reconstruido. Su tolerancia de cálculo menor a $10 se limita a esos casos.
- Venta sin Alta: resolver como liquidada en período anterior, posible no liquidada o pendiente. El historial no se consulta automáticamente todavía.
- Alta sin Venta: resolver como próximo período, equipo externo o pendiente.
- Las excepciones requieren decisión humana antes del cierre. No hay aprobación automática de faltantes o duplicados.
- Al cerrar se genera un PDF con período, archivos, motivos, valores y resoluciones.
- El período del control lo elige el usuario. No se deduce la fecha de alta a partir de la fecha de origen de una venta.
