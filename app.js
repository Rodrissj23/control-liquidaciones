const KEY = 'lc_controls_v02';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let current = null;
const uploads = { altas: { token: 0 }, ventas: { token: 0 } };
function fmt(number) { return Number.isFinite(number) ? number.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }) : 'Sin dato'; }
function fp(ratio) { return ratio == null ? '—' : `${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(2)}%`; }
function title(c) { return c.v?.nombre || c.a?.nombre || 'Sin nombre'; }

async function read(file, src) {
  if (!window.XLSX) throw Error('No se pudo cargar el lector Excel. Revisá la conexión y recargá la página.');
  // CSV remains text so thousands separators are not converted prematurely.
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: true, cellNF: true });
  let best = null, error = '';
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    for (let i = 0; i < Math.min(matrix.length, 20); i++) {
      const headers = matrix[i].map(String);
      if (!headers.some(h => [...aliases.cuil, ...aliases.dni].some(a => norm(h) === norm(a)))) continue;
      try {
        const raw = matrix.slice(i + 1).map((row, offset) => Object.fromEntries(headers.map((h, j) => {
          const cell = wb.Sheets[name][XLSX.utils.encode_cell({ r: i + 1 + offset, c: j })];
          const value = typeof cell?.v === 'number' && /%/.test(cell.z || '') ? `${cell.v * 100}%` : row[j] ?? '';
          return [h || `Columna ${j + 1}`, value];
        })));
        const rows = normalize(raw, src, i + 2);
        rows.forEach(r => r.sheet = name);
        if (rows.length && (!best || rows.length > best.length)) best = rows;
      } catch (e) { error = e.message; }
      break;
    }
  }
  if (!best) throw Error(error || `${src}: no se encontró una tabla con DNI o CUIL. Revisá los encabezados.`);
  return best;
}
function fieldValue(r, key) {
  if (key === 'valorPlan' || key === 'liquidable') return fmt(r[key]);
  if (key === 'descuento') return Number.isFinite(r[key]) ? `${r[key]}%` : 'Sin dato';
  return r[key] ?? 'Sin dato';
}
function showUpload(id) {
  const state = uploads[id], zone = $(`#${id}-zone`);
  zone.classList.toggle('loaded', !!state.file);
  zone.classList.toggle('drop-error', !!state.error);
  $(`#${id}-name`).textContent = state.file?.name || 'Arrastrá el archivo acá';
  $(`#${id}-status`).textContent = state.error ? 'Revisar archivo' : state.reading ? 'Leyendo…' : state.rows ? 'Archivo leído' : 'Sin archivo';
  $(`#${id}-status`).className = `badge ${state.error ? 'warn' : state.rows ? 'ok' : ''}`;
  $(`#${id}-remove`).hidden = !state.file;
  const summary = $(`#${id}-summary`);
  summary.hidden = !state.file;
  if (state.error) { summary.innerHTML = `<p class="upload-error">${esc(state.error)}</p>`; return; }
  if (!state.rows) { summary.textContent = 'Interpretando columnas y registros…'; return; }
  const rows = state.rows, missing = rows.filter(r => missingFields(r).length), duplicate = duplicateRows(rows);
  const capitasKnown = rows.filter(r => !missingFields(r).includes('capitas'));
  const fields = Object.keys(fieldLabels).filter(key => rows.some(r => missingFields(r).includes(key)));
  const warnings = [];
  if (fields.length) warnings.push(`Datos ausentes o inválidos: ${fields.map(k => fieldLabels[k]).join(', ')}. Esas fichas requerirán revisión.`);
  const sheets = [...new Set(rows.map(r => r.sheet).filter(Boolean))];
  if (sheets.length) warnings.push(`Hoja interpretada: ${sheets.join(', ')}.`);
  const periods = [...new Set(rows.map(r => r.period).filter(Boolean))];
  if (periods.length) warnings.push(`Períodos informados en el archivo: ${periods.join(', ')}. Verificá el período del control.`);
  if (duplicate.size) warnings.push(`${duplicate.size} registros con DNI/CUIL repetido. La asociación se revisará manualmente.`);
  if (rows.some(r => r.estado && !/APROBADA/i.test(r.estado))) warnings.push('El archivo incluye estados distintos de Aprobada. Se conservan todos los registros para revisión.');
  summary.innerHTML = `<div class="file-summary"><b>${rows.length} registros</b><span>${capitasKnown.reduce((sum, r) => sum + r.capitas, 0)} cápitas${capitasKnown.length < rows.length ? ' conocidas · total incompleto' : ''}</span><span>${missing.length} con datos incompletos</span></div>${warnings.map(w => `<p class="upload-warning">${esc(w)}</p>`).join('')}<details class="preview"><summary>Ver datos interpretados · primeras ${Math.min(rows.length, 5)} filas</summary><div class="table-scroll"><table><thead><tr><th>Titular / DNI</th><th>Plan</th><th>Cápitas</th><th>Valor plan</th><th>Descuento</th><th>Liquidable</th></tr></thead><tbody>${rows.slice(0, 5).map(r => `<tr><td>${esc(r.nombre)}<small>DNI ${esc(r.dni)} · fila ${r.row}</small></td><td>${esc(r.plan || 'Sin dato')}</td>${Object.keys(fieldLabels).map(key => `<td class="${missingFields(r).includes(key) ? 'missing' : ''}">${esc(fieldValue(r, key))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function validate() {
  const reading = Object.values(uploads).some(u => u.reading);
  const ready = uploads.altas.rows?.length && uploads.ventas.rows?.length;
  $('#analyze').disabled = reading || !ready || !$('#period').value;
  $('#helper').textContent = reading ? 'Leyendo archivos. Podés revisar cada uno cuando termine.' : ready ? 'Revisá la vista previa y analizá el cruce. Los datos faltantes quedan señalados.' : 'Cargá Altas y Ventas. Verificaremos cada archivo antes del cruce.';
}
async function selectFile(id) {
  const token = uploads[id].token + 1, file = $(`#${id}`).files[0];
  uploads[id] = { token, file, reading: !!file };
  $('#result-panel').hidden = true;
  current = null;
  showUpload(id); validate();
  if (!file) return;
  try {
    if (!/\.(pdf|xlsx|xls|csv)$/i.test(file.name)) throw Error('Formato no compatible. Cargá PDF, Excel o CSV.');
    if (!file.size) throw Error('El archivo está vacío.');
    const rows = await read(file, id.toUpperCase());
    if (uploads[id].token !== token) return;
    uploads[id].rows = rows;
  } catch (e) {
    if (uploads[id].token !== token) return;
    uploads[id].error = e.name === 'PasswordException' ? 'El PDF está protegido. Cargá una copia sin contraseña o el Excel original.' : e.message;
  } finally {
    if (uploads[id].token === token) { uploads[id].reading = false; showUpload(id); validate(); }
  }
}
for (const id of ['altas', 'ventas']) {
  $(`#${id}`).onchange = () => selectFile(id);
  $(`#${id}-remove`).onclick = () => { $(`#${id}`).value = ''; selectFile(id); };
}
$('#period').onchange = () => {
  if (current) { current = null; $('#result-panel').hidden = true; }
  validate();
};
$('#analyze').onclick = () => {
  if ($('#analyze').disabled) return;
  current = { id: `LC-${crypto.randomUUID()}`, schemaVersion: 1, period: $('#period').value,
    createdAt: new Date().toISOString(), closed: false,
    files: { altas: uploads.altas.file.name, ventas: uploads.ventas.file.name },
    cases: analyze(uploads.ventas.rows, uploads.altas.rows) };
  render();
  $('#helper').textContent = 'Cruce terminado. Revisá las excepciones antes de cerrar.';
  $('#result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
function stats(cs) {
  const matched = cs.filter(c => c.type === 'MATCH');
  return { ventas: cs.filter(c => c.v).length, altas: cs.filter(c => c.a).length,
    ok: matched.filter(c => !c.needs && !c.info?.length).length,
    vari: matched.filter(c => !c.needs && c.info?.length).length,
    diff: matched.filter(c => c.needs).length, duplicates: cs.filter(c => c.type === 'DUPLICADO').length,
    vsa: cs.filter(c => c.type === 'VENTA_SIN_ALTA').length, asv: cs.filter(c => c.type === 'ALTA_SIN_VENTA').length };
}
function unresolved() { return current.cases.filter(c => c.needs && (!c.resolution || c.resolution === 'PENDIENTE')); }
const resolutions = { LIQUIDADA_PERIODO_ANTERIOR: 'Liquidada en período anterior', POSIBLE_NO_LIQUIDADA: 'Posible no liquidada / reclamar', PROXIMO_PERIODO: 'Pasada a próximo período', EQUIPO_EXTERNO: 'Equipo externo', ACEPTADA_MANUALMENTE: 'Aceptada tras revisión manual', RECLAMAR: 'Reclamar diferencia', PENDIENTE: 'Mantener pendiente', CORRECTO: 'Correcto', VARIACION_ADMITIDA: 'Variación admitida' };
function opts(c) {
  if (!c.needs) return '';
  const options = c.type === 'VENTA_SIN_ALTA' ? ['LIQUIDADA_PERIODO_ANTERIOR', 'POSIBLE_NO_LIQUIDADA', 'PENDIENTE'] : c.type === 'ALTA_SIN_VENTA' ? ['PROXIMO_PERIODO', 'EQUIPO_EXTERNO', 'PENDIENTE'] : ['ACEPTADA_MANUALMENTE', 'RECLAMAR', 'PENDIENTE'];
  return `<div class="decision"><label>Resolución<select data-r="${c.id}" ${current.closed ? 'disabled' : ''}><option value="">Seleccionar…</option>${options.map(o => `<option value="${o}" ${c.resolution === o ? 'selected' : ''}>${resolutions[o]}</option>`).join('')}</select></label><label>Nota de revisión<textarea data-n="${c.id}" rows="2" ${current.closed ? 'disabled' : ''}>${esc(c.note)}</textarea></label></div>`;
}
function card(c) {
  const badge = c.type === 'DUPLICADO' ? 'Asociación duplicada: revisar' : c.type === 'VENTA_SIN_ALTA' ? 'Venta no encontrada en Altas' : c.type === 'ALTA_SIN_VENTA' ? 'Alta sin venta asociada' : c.needs ? 'Revisar diferencias' : c.info?.length ? 'Variación admitida' : 'Correcto';
  const r = c.v || c.a;
  const fields = [['plan', 'Plan'], ...Object.entries(fieldLabels)];
  const table = c.type === 'MATCH' ? `<div class="compare"><div class="compare-row"><span>Campo</span><b>Ventas</b><b>Altas</b></div>${fields.map(([key, label]) => `<div class="compare-row ${c.issues.some(i => i.startsWith(label.toUpperCase())) ? 'bad' : ''}"><span>${label}</span><b>${esc(fieldValue(c.v, key))}</b><b>${esc(fieldValue(c.a, key))}${key === 'valorPlan' || key === 'liquidable' ? ` <small>${fp(key === 'valorPlan' ? c.pv : c.lv)}</small>` : ''}</b></div>`).join('')}</div>` : `<p class="single-values">${r.src} · plan ${esc(r.plan || 'Sin dato')} · ${fieldValue(r, 'capitas')} cápitas · ${fmt(r.liquidable)}</p>`;
  const recovered = c.recoveredTruncated ? `<p class="upload-warning">Importe truncado reconstruido para comparar. ${Object.entries(c.recoveredFields).filter(([, v]) => v).map(([k, v]) => `${fieldLabels[k]}: ${fmt(v.original)} → ${fmt(v.interpreted)}`).join(' · ')}</p>` : '';
  return `<article class="case-card"><span class="badge ${c.needs ? 'warn' : c.info?.length ? 'info' : 'ok'}">${badge}</span><h3>${esc(title(c))}</h3><small class="source-ref">DNI ${esc(r.dni)}${r.cuil ? ` · CUIL ${esc(r.cuil)}` : ''} · ${c.v ? `Ventas fila ${c.v.row}` : ''}${c.v && c.a ? ' / ' : ''}${c.a ? `Altas fila ${c.a.row}` : ''}${r.estado ? ` · ${esc(r.estado)}` : ''}</small>${table}${c.issues.length ? `<div class="issue-list">${c.issues.map(i => `<span>${esc(i)}</span>`).join('')}</div>` : ''}${recovered}${opts(c)}</article>`;
}
function renderLists() {
  const term = norm($('#search').value), filter = $('#case-filter').value;
  const matches = c => (!term || norm(`${title(c)} ${c.v?.dni || c.a?.dni} ${c.v?.cuil || c.a?.cuil}`).includes(term)) && (!filter || (filter === 'PENDIENTE' ? c.needs && (!c.resolution || c.resolution === 'PENDIENTE') : c.type === filter));
  const review = current.cases.filter(c => c.needs && matches(c)), all = current.cases.filter(matches);
  $('#review-list').innerHTML = review.length ? review.map(card).join('') : '<div class="empty-state">No hay fichas para revisar con estos filtros.</div>';
  $('#all-list').innerHTML = all.length ? all.map(card).join('') : '<div class="empty-state">No hay resultados con estos filtros.</div>';
  document.querySelectorAll('[data-r]').forEach(el => el.onchange = () => {
    current.cases.find(c => c.id === el.dataset.r).resolution = el.value;
    document.querySelectorAll(`[data-r="${el.dataset.r}"]`).forEach(other => other.value = el.value);
    closeState();
  });
  document.querySelectorAll('[data-n]').forEach(el => el.oninput = () => {
    current.cases.find(c => c.id === el.dataset.n).note = el.value;
    document.querySelectorAll(`[data-n="${el.dataset.n}"]`).forEach(other => other.value = el.value);
  });
}
function render() {
  const s = stats(current.cases);
  $('#metrics').innerHTML = [['Ventas', s.ventas], ['Correctas', s.ok], ['Variación admitida', s.vari], ['Diferencias', s.diff], ['Ventas sin Alta', s.vsa], ['Altas sin Venta', s.asv]].map(([label, count]) => `<div class="metric"><span>${label}</span><strong>${count}</strong></div>`).join('');
  $('#result-context').textContent = `${current.period} · ${s.ventas} ventas / ${s.altas} altas · ${s.duplicates} registros con asociación duplicada`;
  $('#review-count').textContent = `(${current.cases.filter(c => c.needs).length})`;
  $('#result-state').textContent = current.closed ? 'CERRADO' : 'ANALIZADO';
  $('#result-panel').hidden = false;
  renderLists(); closeState();
}
function closeState() {
  const pending = unresolved();
  $('#close-control').disabled = pending.length > 0 || current.closed;
  $('#save-control').disabled = current.closed;
  $('#download-report').disabled = !current.closed;
  $('#close-helper').textContent = current.closed ? 'Control cerrado. Podés descargar el informe.' : pending.length ? `${pending.length} fichas pendientes de decisión.` : 'Todas las excepciones tienen resolución. Podés cerrar.';
}
function storage() { try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function save() {
  const list = storage(), i = list.findIndex(x => x.id === current.id);
  if (i >= 0) list[i] = current; else list.unshift(current);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); historyRender(); $('#helper').textContent = 'Control guardado en este navegador.'; return true; }
  catch { $('#helper').textContent = 'No se pudo guardar. El almacenamiento del navegador está lleno o bloqueado.'; return false; }
}
function historyRender() {
  const list = storage();
  $('#history-count').textContent = `${list.length} controles`;
  $('#history-list').innerHTML = list.length ? list.map(c => `<article class="history-item"><div><strong>${esc(c.period || 'Sin período')}</strong><small>${new Date(c.createdAt).toLocaleString('es-AR')}</small></div><span class="badge ${c.closed ? 'ok' : 'warn'}">${c.closed ? 'CERRADO' : 'BORRADOR'}</span><button class="secondary" data-open="${esc(c.id)}">${c.closed ? 'Ver control' : 'Retomar'}</button></article>`).join('') : '<div class="empty-state">Todavía no hay controles guardados. Los borradores se guardan en este navegador.</div>';
  document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => {
    current = storage().find(c => c.id === button.dataset.open);
    if (!current) return;
    $('#search').value = ''; $('#case-filter').value = ''; render();
    $('#result-panel').scrollIntoView({ behavior: 'smooth' });
  });
}
$('#search').oninput = () => current && renderLists();
$('#case-filter').onchange = () => current && renderLists();
document.querySelectorAll('.tab').forEach(button => button.onclick = () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === button));
  $('#review-list').hidden = button.dataset.tab !== 'review'; $('#all-list').hidden = button.dataset.tab === 'review';
});
$('#save-control').onclick = save;
$('#close-control').onclick = () => {
  if (unresolved().length || current.closed) return;
  current.closed = true; current.closedAt = new Date().toISOString();
  if (!save()) { current.closed = false; delete current.closedAt; }
  render();
};
$('#download-report').onclick = () => {
  if (!current?.closed) return;
  if (!window.jspdf) { $('#helper').textContent = 'No se pudo cargar el generador PDF. Revisá la conexión y recargá.'; return; }
  const d = new window.jspdf.jsPDF(), s = stats(current.cases); let y = 18;
  function text(value, size = 10) {
    d.setFontSize(size);
    const lines = d.splitTextToSize(String(value), 180);
    for (const line of lines) { if (y > 280) { d.addPage(); y = 18; } d.text(line, 14, y); y += 6; }
  }
  text('CONTROL DE LIQUIDACION', 17);
  text(`Periodo: ${current.period} | Tolerancia positiva: +2,40%`);
  text(`Altas: ${current.files.altas}`); text(`Ventas: ${current.files.ventas}`);
  text(`Ventas: ${s.ventas} | Altas: ${s.altas} | Correctas: ${s.ok} | Variaciones: ${s.vari}`);
  text(`Diferencias: ${s.diff} | Ventas sin alta: ${s.vsa} | Altas sin venta: ${s.asv} | Duplicados: ${s.duplicates}`);
  text('Observaciones y resoluciones', 12);
  for (const c of current.cases.filter(c => c.needs || c.info?.length)) {
    const r = c.v || c.a;
    text(`${title(c)} | DNI ${r.dni} | ${resolutions[c.resolution] || c.resolution}`, 9);
    text(`Motivos: ${[...c.issues, ...(c.info || [])].join(', ')}`, 9);
    for (const source of [c.v, c.a].filter(Boolean)) text(`${source.src} fila ${source.row}: plan ${source.plan || 'sin dato'}; capitas ${source.capitas ?? 'sin dato'}; valor ${fmt(source.valorPlan)}; descuento ${fieldValue(source, 'descuento')}; liquidable ${fmt(source.liquidable)}`, 9);
    if (c.note) text(`Nota: ${c.note}`, 9);
    y += 3;
  }
  d.save(`control-liquidacion-${current.period}.pdf`);
};
const now = new Date();
$('#period').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
setInterval(() => $('#clock').textContent = new Date().toLocaleTimeString('es-AR', { hour12: false }), 1000);
historyRender(); validate();
