// Soporte PDF para Control de Liquidaciones v0.7
// Lee PDFs exportados desde planillas usando PDF.js. No usa OCR.
// Parser por bloques para los formatos reales de Altas y Ventas de Prevención.

(() => {
  const originalRead = window.read;

  function cleanLine(v = '') {
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

  const ALTAS_START = /^\d{5,7}\s+\d{6}\s+\d{11}\b/;
  const VENTAS_START = /^\d{2}-\d{2}-\d{2}\b/;

  function buildBlocks(lines, src) {
    const startRx = src === 'ALTAS' ? ALTAS_START : VENTAS_START;
    const blocks = [];
    let current = '';

    for (const raw of lines) {
      const line = cleanLine(raw);
      if (!line) continue;

      if (startRx.test(line)) {
        if (current) blocks.push(current);
        current = line;
      } else if (current) {
        current = cleanLine(`${current} ${line}`);
      }
    }

    if (current) blocks.push(current);
    return blocks;
  }

  function parseAltasBlock(block, row) {
    const line = cleanLine(block).replace(/\$\s*/g, '');
    const head = line.match(/^(\d{5,7})\s+(\d{6})\s+(\d{11})\s+(.+)$/);
    if (!head) return null;

    const cuil = digits(head[3]);
    const rest = head[4];

    // Cola real:
    // PLAN PRECIO %DESCUENTO PRECIO_CON_DESC CÁPITAS
    const tailRx = /(\S+)\s+([\d.,]+)\s+([\d.,]+)\s*%\s+([\d.,]+)\s+(\d+)\s*$/i;
    const tail = tailRx.exec(rest);
    if (!tail) return null;

    // El PDF puede mezclar el texto de celdas adyacentes por saltos de línea.
    // Quitamos los valores conocidos de Origen/Segmento y conservamos el nombre.
    let nombre = cleanLine(rest.slice(0, tail.index))
      .replace(/OBLIGATORIO/gi, ' ')
      .replace(/VOLUNTARIO/gi, ' ')
      .replace(/INDIVIDUAL/gi, ' ');
    nombre = cleanLine(nombre) || `CUIL ${cuil}`;

    return {
      src: 'ALTAS',
      row,
      cuil,
      dni: cuil.length === 11 ? cuil.slice(2, -1).replace(/^0+/, '') : '',
      nombre,
      plan: cleanLine(tail[1]),
      capitas: Number(tail[5]),
      valorPlan: asMoney(tail[2]),
      descuento: pct(tail[3]),
      liquidable: asMoney(tail[4])
    };
  }

  function lastMoneyTrio(line) {
    // Ventas termina cada registro con:
    // $VALOR_PLAN $DESCUENTO_APLICADO $VALOR_LIQUIDABLE
    // Puede haber observaciones visualmente después de esos importes, por eso
    // buscamos el último trío en cualquier parte del bloque y no solo al final.
    const rx = /\$\s*([\d.]+(?:,\d{1,2})?)\s+\$\s*([\d.]+(?:,\d{1,2})?)\s+\$\s*([\d.]+(?:,\d{1,2})?)/g;
    let last = null;
    let m;
    while ((m = rx.exec(line)) !== null) {
      last = {
        index: m.index,
        raw: m[0],
        plan: asMoney(m[1]),
        discountAmount: asMoney(m[2]),
        liquidable: asMoney(m[3])
      };
    }
    return last;
  }

  function parseVentasBlock(block, row) {
    const line = cleanLine(block);
    const tail = lastMoneyTrio(line);
    if (!tail) return null;

    const prefix = cleanLine(line.slice(0, tail.index));

    // Ubicamos Cápitas + Plan. El export puede mostrar ION/IÓN cuando una celda
    // queda recortada. No dependemos de Broker/Team/Junior porque son variables.
    let capPlan = /\s(\d{1,2})\s+(A\d+|I[ÓO]N)\s+(?:(?:SI|NO)\s+)?(?:CBU|TC)\b/i.exec(prefix);
    if (!capPlan) {
      capPlan = /\s(\d{1,2})\s+(A\d+|I[ÓO]N)\b/i.exec(prefix);
    }
    if (!capPlan) return null;

    const capitas = Number(capPlan[1]);
    const plan = cleanLine(capPlan[2]);
    const afterPlan = prefix.slice(capPlan.index + capPlan[0].length);

    // El primer número de 7/8 dígitos posterior al plan es el DNI del titular.
    // Nº de solicitud tiene 6 dígitos y las fechas llevan separadores.
    const dniMatch = /\b(\d{7,8})\b/.exec(afterPlan);
    if (!dniMatch) return null;

    const dni = digits(dniMatch[1]).replace(/^0+/, '');
    const beforeDni = cleanLine(afterPlan.slice(0, dniMatch.index));
    const afterDni = afterPlan.slice(dniMatch.index + dniMatch[0].length);

    // El último porcentaje anterior al DNI es el % OFF comercial.
    const percentRx = /(\d+(?:[.,]\d+)?)\s*%/g;
    let percentMatch = null;
    let pm;
    while ((pm = percentRx.exec(beforeDni)) !== null) percentMatch = pm;

    let descuento = null;
    let nombre = '';
    if (percentMatch) {
      descuento = pct(percentMatch[1]);
      nombre = cleanLine(beforeDni.slice(percentMatch.index + percentMatch[0].length));
    } else {
      // Si el PDF omite visualmente el porcentaje, lo derivamos del monto
      // de descuento. El control seguirá comparando contra Altas.
      if (tail.plan) descuento = (tail.discountAmount / tail.plan) * 100;
      nombre = `DNI ${dni}`;
    }

    // CUIL puede venir 20361427832, 20-36142783-2 o 20 36142783 2.
    const cuilMatch = /\b(\d{2}(?:-|\s)?\d{8}(?:-|\s)?\d)\b/.exec(afterDni);
    const cuilDigits = digits(cuilMatch?.[1] || '');
    const cuil = cuilDigits.length === 11 ? cuilDigits : '';

    return {
      src: 'VENTAS',
      row,
      cuil,
      dni,
      nombre: nombre || `DNI ${dni}`,
      plan,
      capitas,
      valorPlan: tail.plan,
      descuento,
      liquidable: tail.liquidable
    };
  }

  // Compatibilidad con PDFs viejos que ya soportaba el módulo.
  function parseAltasLegacyLine(line, row) {
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

  function parseVentasLegacyLine(line, row) {
    line = cleanLine(line);
    const tail = lastMoneyTrio(line);
    if (!tail) return null;

    const prefix = cleanLine(line.slice(0, tail.index)).replace(/^\d{2}-\d{2}-\d{2}\s+/, '');
    const start = prefix.match(/^(?:.+?\s+)?(\d+)\s+(\S+)\s+(?:SI|NO)\s+(.+)$/i);
    if (!start) return null;

    const capitas = Number(start[1]);
    const plan = cleanLine(start[2]);
    const body = cleanLine(start[3]);
    const idMatch = body.match(/^(.*)\s+(\d{7,8})(?:\s+([\d\-\s]{10,18}))?$/);
    if (!idMatch) return null;

    const dni = digits(idMatch[2]).replace(/^0+/, '');
    const cuilDigits = digits(idMatch[3] || '');
    const cuil = cuilDigits.length === 11 ? cuilDigits : '';
    const beforeDni = cleanLine(idMatch[1]);

    const percentMatch = beforeDni.match(/^(.*?)(\d+(?:[.,]\d+)?)\s*%\s+(.+)$/);
    const descuento = percentMatch ? pct(percentMatch[2]) : (tail.plan ? (tail.discountAmount / tail.plan) * 100 : null);
    const nombre = percentMatch ? cleanLine(percentMatch[3]) : `DNI ${dni}`;

    return {
      src: 'VENTAS', row,
      cuil, dni, nombre, plan, capitas,
      valorPlan: tail.plan,
      descuento,
      liquidable: tail.liquidable
    };
  }

  function parseLegacyLines(lines, src) {
    const parser = src === 'ALTAS' ? parseAltasLegacyLine : parseVentasLegacyLine;
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      let parsed = parser(lines[i], i + 1);
      if (!parsed && i + 1 < lines.length) {
        parsed = parser(`${lines[i]} ${lines[i + 1]}`, i + 1);
        if (parsed) i++;
      }
      if (parsed) out.push(parsed);
    }

    return out;
  }

  function parsePdfRows(lines, src) {
    const blocks = buildBlocks(lines, src);
    const parser = src === 'ALTAS' ? parseAltasBlock : parseVentasBlock;
    const parsed = [];
    const failed = [];

    blocks.forEach((block, i) => {
      const row = parser(block, i + 1);
      if (row) parsed.push(row);
      else failed.push(block);
    });

    if (parsed.length) {
      // En un control de liquidación es preferible frenar antes que omitir
      // silenciosamente fichas que el parser no pudo interpretar.
      if (failed.length) {
        console.error(`[LC PDF] ${src}: bloques no reconocidos`, failed);
        throw new Error(
          `${src}: reconocí ${parsed.length} de ${blocks.length} filas. ` +
          `${failed.length} fila(s) no pudieron interpretarse; no continué para evitar omisiones.`
        );
      }

      console.info(`[LC PDF] ${src}: ${parsed.length} filas reconocidas de ${blocks.length}.`);
      return parsed;
    }

    const legacy = parseLegacyLines(lines, src);
    if (legacy.length) {
      console.info(`[LC PDF] ${src}: ${legacy.length} filas reconocidas con parser compatible.`);
      return legacy;
    }

    const examples = (blocks.length ? blocks : lines)
      .filter(x => cleanLine(x).length > 10)
      .slice(0, 3)
      .join('\n');

    const debugMsg = examples ? `\n\nEjemplos de líneas no reconocidas:\n${examples}` : '';
    throw new Error(
      `${src}: pude abrir el PDF, pero no reconocí filas. ` +
      `Verificá que sea un PDF exportado con texto seleccionable y no una imagen escaneada.${debugMsg}`
    );
  }

  window.read = async function(file, src) {
    const isPdf = file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
    if (!isPdf) return originalRead(file, src);

    const lines = await pdfLines(file);
    console.info(`[LC PDF] ${src}: extraje ${lines.length} líneas del PDF.`);

    const rows = parsePdfRows(lines, src);
    return rows;
  };
})();
