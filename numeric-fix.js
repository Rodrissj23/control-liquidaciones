// Corrección de interpretación numérica para importes de CSV/PDF.
// Distingue miles de decimales según cantidad de dígitos posteriores.
(() => {
  money = function(v) {
    if (typeof v === 'number') {
      // Algunos CSV pueden llegar ya parseados como 254.962 cuando en realidad son 254962.
      // Si el valor es positivo, tiene tres decimales exactos y es demasiado pequeño para un plan,
      // no se corrige a ciegas: el caso principal se resuelve en strings antes del parseo.
      return Number.isFinite(v) ? v : null;
    }

    let s = String(v ?? '').trim();
    if (!s) return null;
    s = s.replace(/[$\s]/g, '');

    const commaCount = (s.match(/,/g) || []).length;
    const dotCount = (s.match(/\./g) || []).length;

    // Tiene ambos separadores: el último se toma como decimal.
    if (commaCount && dotCount) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    }
    // Solo coma.
    else if (commaCount) {
      const parts = s.split(',');
      const last = parts[parts.length - 1];

      if (commaCount > 1) {
        // 1,234,567 => miles.
        if (parts.slice(1).every(p => p.length === 3)) s = parts.join('');
        else s = parts.slice(0, -1).join('') + '.' + last;
      } else {
        // 254,962 => miles. 140,23 => centavos.
        if (last.length === 3) s = parts.join('');
        else if (last.length <= 2) s = parts[0] + '.' + last;
        else s = parts.join('');
      }
    }
    // Solo punto.
    else if (dotCount) {
      const parts = s.split('.');
      const last = parts[parts.length - 1];

      if (dotCount > 1) {
        // 1.234.567 => miles.
        if (parts.slice(1).every(p => p.length === 3)) s = parts.join('');
        else s = parts.slice(0, -1).join('') + '.' + last;
      } else {
        // En Argentina, 254.962 suele ser miles; 140.23 son centavos.
        if (last.length === 3) s = parts.join('');
      }
    }

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
})();
