// Recuperación automática de importes truncados en la liquidación.
// Ejemplos reales: 140.23 -> 140230..140239 / 254.96 -> 254960..254969.
// Solo actúa cuando Altas tiene una magnitud claramente truncada frente a Ventas.
(() => {
  const originalCompare = compare;

  function recoverTruncated(value, reference) {
    if (!Number.isFinite(value) || !Number.isFinite(reference)) {
      return { value, recovered: false };
    }

    // Patrón observado: Altas trae 140.23 donde el importe real ronda 140.230.
    // Exigimos una diferencia de escala muy marcada para no tocar importes normales.
    if (!(value > 10 && value < 1000 && reference >= 10000)) {
      return { value, recovered: false };
    }

    const base = Math.round(value * 1000);

    // El último dígito perdido puede ser 0..9. Si el valor de Ventas está en ese
    // rango, elegimos el dígito más cercano. Si hubo actualización de tarifa y
    // Ventas queda lejos, usamos el 0: el error máximo sigue siendo < $10.
    let best = base;
    let bestDiff = Math.abs(base - reference);
    for (let digit = 0; digit <= 9; digit++) {
      const candidate = base + digit;
      const diff = Math.abs(candidate - reference);
      if (diff < bestDiff) {
        best = candidate;
        bestDiff = diff;
      }
    }

    // Solo usamos el dígito elegido por cercanía si realmente estamos dentro de
    // la banda de $10. En otro caso conservamos el último dígito como 0 para no
    // forzar una coincidencia contra Ventas cuando existe una variación tarifaria.
    const recovered = bestDiff < 10 ? best : base;
    return { value: recovered, recovered: true, original: value };
  }

  compare = function(v, a) {
    const fixed = { ...a };
    const plan = recoverTruncated(a.valorPlan, v.valorPlan);
    const liquidable = recoverTruncated(a.liquidable, v.liquidable);

    if (plan.recovered) fixed.valorPlan = plan.value;
    if (liquidable.recovered) fixed.liquidable = liquidable.value;

    let result = originalCompare(v, fixed);

    if (plan.recovered || liquidable.recovered) {
      result.recoveredTruncated = true;
      result.recoveredFields = {
        valorPlan: plan.recovered ? { original: plan.original, interpreted: plan.value } : null,
        liquidable: liquidable.recovered ? { original: liquidable.original, interpreted: liquidable.value } : null
      };
      result.info = result.info || [];
      if (!result.info.includes('VALOR_TRUNCADO_RECONSTRUIDO')) {
        result.info.push('VALOR_TRUNCADO_RECONSTRUIDO');
      }

      // El dígito faltante genera como máximo $9 de diferencia. Para la coherencia
      // interna plan/descuento/liquidable usamos una tolerancia de $10 únicamente
      // cuando hubo reconstrucción de un valor truncado.
      if (fixed.valorPlan != null && fixed.descuento != null && fixed.liquidable != null) {
        const expected = fixed.valorPlan * (1 - fixed.descuento / 100);
        if (Math.abs(expected - fixed.liquidable) < 10) {
          result.issues = result.issues.filter(x => x !== 'CÁLCULO DESCUENTO');
        }
      }

      result.needs = result.issues.length > 0;
      if (!result.needs) {
        result.resolution = result.info.length ? 'VARIACION_ADMITIDA' : 'CORRECTO';
      }
    }

    return result;
  };
})();
