// Soporte PDF para Control de Liquidaciones v0.3
// Lee PDFs exportados desde planillas usando PDF.js. No usa OCR.

(() => {
  const originalRead = window.read;

  function cleanLine(v='') {
    return String(v).replace(/\s+/g, ' ').trim();
  }

  function asMoney(v) {
    return money(String(v ?? '').replace(/^\$/, ''));
  }

  async function pdfLines(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const lines = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const tc = await page.getTextContent();
      const rows = [];

      for (const item of tc.items) {
        const text = cleanLine(item.str);
        if (!text) continue;
        const x = item.transform?.[4] ?? 0;
        const y = item.transform?.[5] ?? 0;
        let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
        if (!row) {
          row = { y, parts: [] };
          rows.push(row);
        }
        row.parts.push({ x, text });
      }

      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.parts.sort((a, b) => a.x - b.x);
        const line = cleanLine(row.parts.map(p => p.text).join(' '));
        if (line) lines.push(line);
      }
    }
    return lines;
  }

  function parseAltasLine(line, row) {
    line = cleanLine(line).replace(/\$\s*/g, '');
    const m = line.match(/^(\d{11})\s+(.+?)\s+(OBLIGATORIO|VOLUNTARIO)\s+(\S+)\s+([\d.,]+)\s+([\d.,]+)\s*%\s+([\d.,]+)\s+(\d+)$/i);
    if (!m) return null;

    const cuil = digits(m[1]);
    return {
      src: 'ALTAS', row,
      cuil,
      dni: cuil.length === 11 ? cuil.slice(2, -1).replace(/^0+/, '') : '',
      nombre: cleanLine(m[2]),
      plan: cleanLine(m[4]),
      capitas: Number(m[8]),
      valorPlan: asMoney(m[5]),
      descuento: pct(m[6]),
      liquidable: asMoney(m[7])
    };
  }

  function trailingMoney(line) {
    const rx = /^(.*?)\s+\$?([\d.]+(?:,\d{1,2})?|\d+(?:\.\d+)?)\s+\$?([\d.]+(?:,\d{1,2})?|\d+(?:\.\d+)?)\s+\$?([\d.]+(?:,\d{1,2})?|\d+(?:\.\d+)?)$/;
    const m = cleanLine(line).match(rx);
    return m ? { prefix: cleanLine(m[1]), plan: asMoney(m[2]), discountAmount: asMoney(m[3]), liquidable: asMoney(m[4]) } : null;
  }

  function parseVentasLine(line, row) {
    line = cleanLine(line);
    const tail = trailingMoney(line);
    if (!tail) return null;

    const start = tail.prefix.match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!start) return null;
    const capitas = Number(start[1]);
    const plan = cleanLine(start[2]);
    let body = cleanLine(start[3]);

    // El DNI está al final del bloque descriptivo; después puede venir CUIL.
    const idMatch = body.match(/^(.*)\s+(\d{7,8})(?:\s+([\d\-\s]{10,18}))?$/);
    if (!idMatch) return null;

    let beforeDni = cleanLine(idMatch[1]);
    const dni = digits(idMatch[2]).replace(/^0+/, '');
    const cuilDigits = digits(idMatch[3] || '');
    const cuil = cuilDigits.length === 11 ? cuilDigits : '';

    let descuento = null;
    let nombre = '';
    const percentMatch = beforeDni.match(/^(.*?)(\d+(?:[.,]\d+)?)\s*%\s+(.+)$/);
    if (percentMatch) {
      descuento = pct(percentMatch[2]);
      nombre = cleanLine(percentMatch[3]);
    } else {
      // En algunas filas el % no aparece impreso. Se deriva del monto descontado.
      if (tail.plan) descuento = (tail.discountAmount / tail.plan) * 100;
      nombre = `DNI ${dni}`;
    }

    return {
      src: 'VENTAS', row,
      cuil,
      dni,
      nombre,
      plan,
      capitas,
      valorPlan: tail.plan,
      descuento,
      liquidable: tail.liquidable
    };
  }

  function parsePdfRows(lines, src) {
    const parser = src === 'ALTAS' ? parseAltasLine : parseVentasLine;
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      let parsed = parser(lines[i], i + 1);
      if (!parsed && i + 1 < lines.length) {
        parsed = parser(`${lines[i]} ${lines[i + 1]}`, i + 1);
        if (parsed) i++;
      }
      if (parsed) out.push(parsed);
    }

    if (!out.length) {
      throw new Error(`${src}: pude abrir el PDF, pero no reconocí filas. Verificá que sea un PDF exportado con texto seleccionable y no una imagen escaneada.`);
    }
    return out;
  }

  window.read = async function(file, src) {
    const isPdf = file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
    if (!isPdf) return originalRead(file, src);

    const lines = await pdfLines(file);
    const rows = parsePdfRows(lines, src);
    console.info(`[LC PDF] ${src}: ${rows.length} filas reconocidas`);
    return rows;
  };
})();
