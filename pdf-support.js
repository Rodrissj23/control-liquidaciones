// PDF exports are text tables. Missing columns stay missing; never infer cápitas.
(() => {
  const originalRead = window.read;
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const altasStart = /^(?:\d{5,7}\s+)?\d{6}\s+\d{11}\b|^\d{11}\s/;
  const ventasStart = /^\d{2}[-/]\d{2}[-/]\d{2,4}\b|^(?=.*(?:^|\s)\d{1,2}\s+(?:A\d+|I[ÓO]N)\b)(?=.*\b(?:\d{7,8}|\d{1,2}\.\d{3}\.\d{3})\b)/i;
  const metadata = /^(?:Nro\b|Periodo\b|FECHA\b|ESTADO FINAL:|Recuento:|Suma:|Total\b|Página\b|Page\b|\d+\s*\/\s*\d+$)/i;

  function blocksFromLines(lines, src) {
    const start = src === 'ALTAS' ? altasStart : ventasStart;
    const blocks = [];
    let block = null;
    lines.forEach((raw, i) => {
      const line = clean(raw);
      if (!line || metadata.test(line)) return;
      if (start.test(line)) {
        block = { text: line, row: i + 1, financial: lines.layout?.[i]?.financial };
        blocks.push(block);
      } else if (block) {
        block.text += ` ${line}`;
        if (lines.layout?.[i]?.financial) block.financial = lines.layout[i].financial;
      }
      else if (/\b\d{11}\b/.test(line) || /^\d{2}[-/]\d{2}[-/]/.test(line)) {
        // A malformed record must prevent a silently incomplete import.
        blocks.push({ text: line, row: i + 1 });
        block = blocks.at(-1);
      }
    });
    return blocks;
  }

  function parseAltasBlock(block, row) {
    const line = clean(block).replace(/\$\s*/g, '');
    const head = /^(?:(\d{5,7})\s+)?(\d{6})\s+(\d{11})\s+(.+)$/.exec(line)
      || /^(\d{11})\s+(.+)$/.exec(line);
    if (!head) return null;
    const legacy = head.length === 3;
    const cuil = legacy ? head[1] : head[3];
    const rest = legacy ? head[2] : head[4];
    const periodFirst = !legacy && /^20\d{2}(?:0[1-9]|1[012])$/.test(head[1] || '') && !/^20\d{2}(?:0[1-9]|1[012])$/.test(head[2]);
    // Optional UN/region between Plan and Precio; optional cápitas at the end.
    const tail = /\b(A\d+|I[ÓO]N)\s+(.*?)\s*([\d.,]+)\s+([\d.,]+)\s*(%)?\s+([\d.,]+)(?:\s+(\d+))?\s*$/i.exec(rest);
    if (!tail) return null;
    const origin = /OBLIGATORIO|VOLUNTARIO/i.exec(rest.slice(0, tail.index));
    const nombre = clean(origin ? rest.slice(0, origin.index) : rest.slice(0, tail.index));
    return { src: 'ALTAS', row, cuil, dni: cuil.slice(2, -1).replace(/^0+/, ''),
      nombre: nombre || `CUIL ${cuil}`, plan: tail[1], region: clean(tail[2]),
      period: legacy ? '' : periodFirst ? head[1] : head[2], solicitud: legacy ? '' : periodFirst ? head[2] : head[1] || '',
      capitas: tail[7] ? Number(tail[7]) : null, valorPlan: money(tail[3]),
      descuento: tail[5] ? pct(tail[4]) : pct(Number(tail[4])), liquidable: money(tail[6]),
      importWarnings: tail[5] ? [] : [`Descuento original ${tail[4]} sin símbolo %: interpretado como ${pct(Number(tail[4]))}%; requiere revisión`],
      rawDiscount: tail[4] };
  }

  function parseVentasBlock(block, row, financial) {
    const line = clean(block);
    const capPlan = /(?:^|\s)(\d{1,2})\s+(A\d+|I[ÓO]N)\b/i.exec(line);
    if (!capPlan) return null;
    const rest = line.slice(capPlan.index + capPlan[0].length);
    const dniMatch = /\b(\d{7,8}|\d{1,2}\.\d{3}\.\d{3})\b/.exec(rest);
    if (!dniMatch) return null;
    const beforeDni = rest.slice(0, dniMatch.index);
    const percents = [...beforeDni.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)];
    const percent = percents.at(-1);
    const afterDni = rest.slice(dniMatch.index + dniMatch[0].length);
    const cuilMatch = /\b(\d{2}[- ]?\d{8}[- ]?\d)\b/.exec(afterDni);
    const amounts = [...afterDni.matchAll(/\$\s*([\d.,]+)/g)];
    // A reduced export may contain only Valor del plan. Keep liquidable null.
    const trio = amounts.length === 3;
    if (amounts.length > 3) return null;
    const ambiguous = !financial && amounts.length === 2;
    const valorPlan = financial ? financial.valorPlan : ambiguous ? null : amounts.length ? money(amounts[0][1]) : null;
    const descuento = percent ? pct(percent[1]) : trio && valorPlan > 0 ? (financial ? financial.discountAmount : money(amounts[1][1])) / valorPlan * 100 : null;
    const nombre = percent ? clean(beforeDni.slice(percent.index + percent[0].length)) : `DNI ${dniMatch[1]}`;
    return { src: 'VENTAS', row, cuil: digits(cuilMatch?.[1] || ''),
      dni: digits(dniMatch[1]).replace(/^0+/, ''), nombre, plan: capPlan[2], capitas: Number(capPlan[1]),
      valorPlan, descuento, liquidable: financial ? financial.liquidable : trio ? money(amounts[2][1]) : null,
      importWarnings: ambiguous ? ['Columnas de importes incompletas: no se asignaron por posición textual'] : [],
      estado: /APROBADA|FIRMA PENDIENTE|BAJA|RECHAZADA|AUDITOR[IÍ]A/i.exec(afterDni)?.[0] || '' };
  }

  function parsePdfRows(lines, src) {
    const blocks = blocksFromLines(lines, src);
    const parser = src === 'ALTAS' ? parseAltasBlock : parseVentasBlock;
    const rows = [], failed = [];
    for (const block of blocks) {
      const record = parser(block.text, block.row, block.financial);
      if (record) rows.push(record); else failed.push(block.row);
    }
    if (failed.length) throw Error(`${src}: se leyeron ${rows.length} de ${blocks.length} registros. Revisá las líneas ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''} o cargá el Excel original. El análisis se detuvo para evitar omisiones.`);
    if (!rows.length) throw Error(`${src}: no se reconocieron registros. Cargá la planilla original o un PDF con texto seleccionable y las columnas de la tabla completas.`);
    return rows;
  }

  async function pdfLines(file) {
    if (!window.pdfjsLib) throw Error('No se pudo cargar el lector PDF. Revisá la conexión y recargá la página.');
    const task = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    const lines = [];
    lines.layout = [];
    try {
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const rows = [];
        const header = pattern => content.items.find(item => pattern.test(norm(item.str)));
        const headerPlan = header(/^valor (?:del )?plan$/), headerDiscount = header(/^descuento(?: aplicado)?$/), headerLiquidable = header(/^valor liquidable$/);
        const centers = headerPlan && headerDiscount && headerLiquidable ? [headerPlan, headerDiscount, headerLiquidable].map(item => item.transform[4] + (item.width || 0) / 2) : null;
        for (const item of content.items) {
          if (!clean(item.str)) continue;
          const x = item.transform[4], y = item.transform[5];
          let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
          if (!row) rows.push(row = { y, parts: [] });
          row.parts.push({ x, width: item.width || 0, text: item.str });
        }
        rows.sort((a, b) => b.y - a.y);
        for (const row of rows) {
          row.parts.sort((a, b) => a.x - b.x);
          lines.push(clean(row.parts.map(p => p.text).join(' ')));
          let financial = null;
          if (centers && row.parts.some(p => p.text.includes('$'))) {
            const cells = ['', '', ''];
            for (const part of row.parts) {
              const midpoint = part.x + part.width / 2;
              if (midpoint < centers[0] - (centers[1] - centers[0]) / 2) continue;
              const index = midpoint < (centers[0] + centers[1]) / 2 ? 0 : midpoint < (centers[1] + centers[2]) / 2 ? 1 : 2;
              cells[index] += part.text;
            }
            if (cells.some(cell => cell.includes('$'))) financial = { valorPlan: money(cells[0]), discountAmount: money(cells[1]), liquidable: money(cells[2]) };
          }
          lines.layout.push({ financial, page: pageNo });
        }
      }
    } finally { await pdf.destroy(); }
    if (!lines.length) throw Error('El PDF no contiene texto seleccionable. Cargá el Excel/CSV original o exportá nuevamente la tabla como PDF.');
    return lines;
  }

  window.LCPdf = { parsePdfRows, pdfLines };
  window.read = async function(file, src) {
    if (!file?.name?.toLowerCase().endsWith('.pdf') && file?.type !== 'application/pdf') return originalRead(file, src);
    return parsePdfRows(await pdfLines(file), src);
  };
})();
