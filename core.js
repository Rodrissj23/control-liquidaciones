// One canonical record for all input adapters. The reconciliation engine does
// not depend on PDF, Excel, a spreadsheet API or CRM API.
const TOL = .024;
const digits = value => String(value ?? '').replace(/\D/g, '');
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
function money(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(String(value).replace(/[$\s]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
function pct(value) {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (value > 0 && value < 1 ? value * 100 : value) : null;
  const number = Number(String(value).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(number) ? number : null;
}
const fieldLabels = { capitas: 'Cápitas', valorPlan: 'Valor del plan', descuento: 'Descuento', liquidable: 'Liquidable' };
const aliases = {
  cuil: ['cuil', 'cuit', 'cuil solicitud'], dni: ['dni', 'documento', 'dni del titular'],
  nombre: ['nombre integrante', 'nombre y apellido', 'titular', 'nombre'], plan: ['plan'],
  capitas: ['capitas', 'integrantes', 'cantidad de capitas'], valorPlan: ['valor del plan', 'precio', 'valor plan'],
  descuento: ['% descuento', 'descuento', 'porcentaje descuento', '% off'],
  liquidable: ['valor liquidable', 'precio con desc', 'precio con descuento', 'liquidable'],
  period: ['periodo carga', 'periodo'], solicitud: ['nro solicitud', 'numero de solicitud', 'nº de solicitud'],
  region: ['un', 'region'], estado: ['estado final', 'estado']
};
function mapCols(rows) {
  const headers = Object.keys(rows[0] || {}), out = {};
  for (const [key, names] of Object.entries(aliases)) out[key] = headers.find(h => names.some(a => norm(h) === norm(a)));
  return out;
}
function normalize(rows, src, startRow = 2) {
  const map = mapCols(rows);
  if (!map.cuil && !map.dni) throw Error(`${src}: no se identificó una columna DNI o CUIL.`);
  const out = [];
  for (const [i, raw] of rows.entries()) {
    if (Object.values(raw).every(v => String(v ?? '').trim() === '')) continue;
    const cuil = digits(raw[map.cuil]), dni = digits(raw[map.dni]);
    if (!cuil && !dni) {
      if (Object.values(raw).some(v => /^(total|recuento|suma)\b/i.test(String(v).trim()))) continue;
      throw Error(`${src}: falta DNI/CUIL en la fila ${startRow + i}. Revisá la planilla; no se omitió el registro.`);
    }
    if (cuil && cuil.length !== 11) throw Error(`${src}: CUIL inválido en la fila ${startRow + i}.`);
    const record = { src, row: startRow + i, cuil: cuil.length === 11 ? cuil : '',
      dni: (dni || (cuil.length === 11 ? cuil.slice(2, -1) : '')).replace(/^0+/, ''),
      nombre: String(raw[map.nombre] || 'Sin nombre'), plan: String(raw[map.plan] || ''),
      capitas: money(raw[map.capitas]), valorPlan: money(raw[map.valorPlan]),
      descuento: pct(raw[map.descuento]), liquidable: money(raw[map.liquidable]),
      period: String(raw[map.period] || ''), solicitud: String(raw[map.solicitud] || ''),
      region: String(raw[map.region] || ''), estado: String(raw[map.estado] || '') };
    if (!/^\d{6,8}$/.test(record.dni)) throw Error(`${src}: DNI/CUIL inválido en la fila ${record.row}.`);
    out.push(record);
  }
  return out;
}
function missingFields(record) {
  return Object.keys(fieldLabels).filter(key => !Number.isFinite(record[key])
    || (key === 'capitas' && (!Number.isInteger(record[key]) || record[key] < 1))
    || ((key === 'valorPlan' || key === 'liquidable') && record[key] <= 0)
    || (key === 'descuento' && (record[key] < 0 || record[key] > 100)));
}
function change(a, b) { return Number.isFinite(a) && Number.isFinite(b) && a > 0 ? (b - a) / a : null; }
function accepted(a, b) { const ratio = change(a, b); return ratio != null && ratio >= 0 && ratio <= TOL + 1e-10; }
function compare(v, a) {
  const issues = [], info = [];
  for (const record of [v, a]) {
    for (const key of missingFields(record)) issues.push(`${fieldLabels[key].toUpperCase()} SIN DATO VÁLIDO (${record.src})`);
    if (!record.plan) issues.push(`PLAN SIN DATO (${record.src})`);
  }
  const valid = key => !missingFields(v).includes(key) && !missingFields(a).includes(key);
  if (valid('capitas') && v.capitas !== a.capitas) issues.push('CÁPITAS');
  if (valid('descuento') && Math.abs(v.descuento - a.descuento) > .01) issues.push('DESCUENTO');
  if (v.plan && a.plan && norm(v.plan) !== norm(a.plan)) issues.push('PLAN');
  if (v.cuil && a.cuil && v.cuil !== a.cuil) issues.push('CUIL DIFERENTE');
  for (const [key, label] of [['valorPlan', 'VALOR PLAN'], ['liquidable', 'LIQUIDABLE']]) {
    if (valid(key) && Math.abs(v[key] - a[key]) > 1.5) {
      if (accepted(v[key], a[key])) info.push(`VARIACIÓN ${label}`); else issues.push(label);
    }
  }
  for (const record of [v, a]) {
    if (['valorPlan', 'descuento', 'liquidable'].every(key => !missingFields(record).includes(key))) {
      if (Math.abs(record.valorPlan * (1 - record.descuento / 100) - record.liquidable) > 1.5) issues.push(record === a ? 'CÁLCULO DESCUENTO' : 'CÁLCULO DESCUENTO (VENTAS)');
    }
  }
  return { id: crypto.randomUUID(), type: 'MATCH', v, a, issues, info,
    pv: change(v.valorPlan, a.valorPlan), lv: change(v.liquidable, a.liquidable),
    needs: issues.length > 0, resolution: issues.length ? '' : info.length ? 'VARIACION_ADMITIDA' : 'CORRECTO', note: '' };
}
function sameIdentity(a, b) { return (a.cuil && a.cuil === b.cuil) || (a.dni && a.dni === b.dni); }
function duplicateRows(rows) { return new Set(rows.filter((r, i) => rows.some((x, j) => i !== j && sameIdentity(r, x)))); }
function singleCase(record, type, duplicate = false) {
  return { id: crypto.randomUUID(), type, v: record.src === 'VENTAS' ? record : null,
    a: record.src === 'ALTAS' ? record : null, info: [], needs: true, resolution: '', note: '',
    issues: duplicate ? ['DNI/CUIL REPETIDO: REVISAR ASOCIACIÓN'] : [type === 'VENTA_SIN_ALTA' ? 'NO EN ALTAS' : 'NO EN VENTAS'] };
}
function analyze(vs, as) {
  const used = new Set(), cases = [], duplicatesV = duplicateRows(vs), duplicatesA = duplicateRows(as);
  for (const v of vs) {
    const candidates = as.filter(a => sameIdentity(v, a));
    if (duplicatesV.has(v) || candidates.some(a => duplicatesA.has(a))) {
      cases.push(singleCase(v, 'DUPLICADO', true)); continue;
    }
    const exact = candidates.find(a => v.cuil && a.cuil === v.cuil);
    const a = exact || candidates[0];
    if (a && !used.has(a)) { used.add(a); cases.push(compare(v, a)); }
    else cases.push(singleCase(v, 'VENTA_SIN_ALTA'));
  }
  for (const a of as) if (!used.has(a)) {
    const ambiguous = duplicatesA.has(a) || vs.some(v => duplicatesV.has(v) && sameIdentity(v, a));
    cases.push(singleCase(a, ambiguous ? 'DUPLICADO' : 'ALTA_SIN_VENTA', ambiguous));
  }
  return cases;
}
