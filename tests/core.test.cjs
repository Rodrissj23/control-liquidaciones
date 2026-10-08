const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const c = vm.createContext({ crypto: require('node:crypto').webcrypto, window: {}, console });
for (const file of ['core.js', 'numeric-fix.js', 'pdf-support.js', 'truncated-value-fix.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), c);
const run = code => vm.runInContext(code, c);
const record = { src: 'VENTAS', row: 1, nombre: 'Prueba', dni: '30123456', cuil: '20301234569', plan: 'A2', capitas: 2, valorPlan: 100000, descuento: 30, liquidable: 70000 };
c.v = record;
c.a = { ...record, src: 'ALTAS' };
test('amount separators, missing values and zero discount', () => {
 for (const [raw, value] of [['254,962', 254962], ['254.962', 254962], ['254.962,30', 254962.3], ['254,962.30', 254962.3], ['', null], ['#REF!', null]]) { c.raw = raw; assert.equal(run('money(raw)'), value); }
 assert.equal(run("pct('')"), null); assert.equal(run("pct('0%')"), 0);
});
test('screenshot Altas: period + CUIL, region and absent capitas', () => {
 const rows = c.window.LCPdf.parsePdfRows(['Periodo Carga Solicitud CUIL Nombre Integrante Origen Segmento Plan UN Precio % Descuento Precio con Desc', '202608 20301234569 APELLIDO, NOMBRE OBLIGATORIO Individual A4 SANTA FE 222,768 30.00 % 155,937', '202608 27321234568 OTRO, NOMBRE OBLIGATORIO Individual A2 SANTA FE 837,764 40.00 % 502,658'], 'ALTAS');
 assert.equal(rows.length, 2); assert.equal(rows[0].plan, 'A4'); assert.equal(rows[0].region, 'SANTA FE'); assert.equal(rows[0].capitas, null); assert.equal(rows[0].valorPlan, 222768);
});
test('old Altas format and wrapped records across repeated headers', () => {
 const rows = c.window.LCPdf.parsePdfRows(['564595 202608 20301234569 APELLIDO,', 'NOMBRE OBLIGATORIO Individual A2 100,000 30.00 % 70,000 2', 'Nro Solicitud Periodo Carga', '564596 202608 27321234568 OTRO, NOMBRE VOLUNTARIO Individual IÓN 100,000 30.00 % 70,000 1'], 'ALTAS');
 assert.equal(rows.length, 2); assert.equal(rows[0].capitas, 2); assert.equal(rows[0].nombre, 'APELLIDO, NOMBRE');
});
test('legacy Altas CUIL-only', () => {
 assert.equal(c.window.LCPdf.parsePdfRows(['20301234569 PERSONA OBLIGATORIO A2 100,000 30% 70,000 2'], 'ALTAS')[0].capitas, 2);
});
test('Ventas recognizes complete and reduced rows, keeping liquidable missing', () => {
 const rows = c.window.LCPdf.parsePdfRows(['01-08-26 BROKER 2 A2 NO CBU OBLIGATORIO RS 30% PERSONA 30123456 20301234569 APROBADA $100.000,00 $30.000,00 $70.000,00', 'BROKER SIN FECHA 1 ION TC VOLUNTARIO 30% OTRA PERSONA 32123456 APROBADA $100.000,00'], 'VENTAS');
 assert.equal(rows.length, 2); assert.equal(rows[0].liquidable, 70000); assert.equal(rows[1].liquidable, null);
});
test('partial failures prevent import rather than silently omitting records', () => {
 assert.throws(() => c.window.LCPdf.parsePdfRows(['202608 20301234569 PERSONA OBLIGATORIO A2 100,000 30% 70,000 2', '202608 27321234568 FILA SIN IMPORTES'], 'ALTAS'), /1 de 2/);
});
test('only positive increases up to 2.40% admitted', () => {
 for (const [factor, needs] of [[1,false],[1.024,false],[1.02401,true],[.99,true]]) {
  c.changed = { ...c.a, valorPlan: c.a.valorPlan * factor, liquidable: c.a.liquidable * factor };
  assert.equal(run('compare(v, changed)').needs, needs);
 }
});
test('missing and invalid numerical values can never produce Correcto', () => {
 for (const [field,value] of [['capitas',null], ['valorPlan',null], ['descuento',null], ['liquidable',null], ['capitas',0], ['valorPlan',0], ['descuento',101]]) {
  c.changed = {...c.a, [field]:value}; assert.equal(run('compare(v, changed)').needs,true);
 }
});
test('plan mismatches and inconsistent amounts in Ventas flagged', () => {
 c.changed = {...c.a,plan:'A4'}; assert.ok(run('compare(v, changed)').issues.includes('PLAN'));
 c.bad = {...c.v,liquidable:60000}; assert.ok(run('compare(bad, a)').issues.includes('CÁLCULO DESCUENTO (VENTAS)'));
});
test('duplicate identities on either side never automatically matched', () => {
 c.vs = [c.v,{...c.v,row:2}]; c.as = [c.a];
 let cases=run('analyze(vs, as)'); assert.equal(cases.length,3); assert.ok(cases.every(c=>c.type==='DUPLICADO'));
 c.vs = [c.v]; c.as = [c.a,{...c.a,row:2}];
 cases=run('analyze(vs, as)'); assert.equal(cases.length,3); assert.ok(cases.every(c=>c.type==='DUPLICADO'));
});
test('single missing sale and missing alta stay reviewable', () => {
 c.as = [{...c.a,dni:'32123456',cuil:'27321234568'}]; c.vs = [c.v];
 const cases=run('analyze(vs, as)'); assert.equal(cases.length,2); assert.equal(cases[0].type,'VENTA_SIN_ALTA'); assert.equal(cases[1].type,'ALTA_SIN_VENTA');
});
test('Excel normalization ignores unused columns, keeps provenance and missing data', () => {
 c.rows=[{'DNI DEL TITULAR':'30123456','NOMBRE Y APELLIDO':'PERSONA','VALOR DEL PLAN':'254,962','PLAN':'A2','OBSERVACIONES':'Texto no necesario'}];
 const rows=run("normalize(rows,'VENTAS')"); assert.equal(rows[0].valorPlan,254962); assert.equal(rows[0].row,2); assert.equal(rows[0].capitas,null); assert.equal(rows[0].OBSERVACIONES,undefined);
 c.rows.push({'NOMBRE Y APELLIDO':'PERSONA SIN DNI'}); assert.throws(()=>run("normalize(rows,'VENTAS')"),/fila 3/);
});
test('reconstructed amounts retain original value and marker', () => {
 c.changed={...c.a,valorPlan:100,liquidable:70};
 const r=run('compare(v, changed)'); assert.equal(r.recoveredTruncated,true); assert.equal(r.recoveredFields.valorPlan.original,100); assert.equal(r.a.valorPlan,100000);
});
