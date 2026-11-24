// Импорт сводного сметного расчёта (ССР) из xlsx/xls и сравнение версий.
// Разбор эвристический: ищет строки «Глава N …», «Итого по главе N», «Всего по сводному…», НДС.
window.SMEst = (() => {
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  let loading = null;
  function loadLib() {
    if (window.XLSX) return Promise.resolve();
    return loading || (loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = XLSX_URL; s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error('Не загрузилась библиотека чтения Excel — проверьте интернет')); };
      document.head.appendChild(s);
    }));
  }

  const num = v => {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v == null) return null;
    const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  function parseRows(rows) {
    let tc = -1;
    for (let i = 0; i < Math.min(rows.length, 30) && tc < 0; i++)
      (rows[i] || []).forEach((c, j) => { if (tc < 0 && typeof c === 'string' && /общая\s+сметная\s+стоимость|всего\s+сметная\s+стоимость/i.test(c)) tc = j; });
    const text = r => (r || []).filter(c => typeof c === 'string' && c.trim()).join(' ').replace(/\s+/g, ' ').trim();
    const lastNum = r => { for (let j = (r || []).length - 1; j > 0; j--) { const v = num(r[j]); if (v != null) return v; } return null; };
    const val = r => { if (tc >= 0) { const v = num((r || [])[tc]); if (v != null) return v; } return lastNum(r); };

    const chapters = [], subtotals = [];
    let cur = null, grand = null, vat = null;
    for (const r of rows) {
      const t = text(r);
      if (!t) continue;
      const head = (r || []).find(c => typeof c === 'string' && /^\s*глава\s*\d+/i.test(c));
      if (head) {
        const m = head.match(/^\s*глава\s*(\d+)[.\s:–—-]*(.*)$/i);
        cur = { n: +m[1], name: (m[2] || '').trim() || head.trim(), total: null, items: [] };
        chapters.push(cur);
        continue;
      }
      const v = val(r);
      let m;
      if ((m = t.match(/итого\s+по\s+главе\s*(\d+)/i))) {
        const ch = chapters.find(c => c.n === +m[1]) || cur;
        if (ch && v != null) ch.total = v;
        continue;
      }
      if (/всего\s+по\s+(сводному|ссрсс|ссср|сср)|всего\s+с\s+(учетом|учётом)\s+ндс|итого\s+по\s+сводному/i.test(t)) { if (v != null) grand = v; continue; }
      if (/^\s*(ндс|налог\s+на\s+добавленную)/i.test(t) || /\bндс\b.*\d+\s*%/i.test(t)) { if (v != null) vat = v; continue; }
      if (/^\s*(итого|всего)/i.test(t)) { if (v != null) subtotals.push({ label: t.slice(0, 160), total: v }); continue; }
      if (cur && v != null) cur.items.push({ name: t.slice(0, 200), total: v });
    }
    for (const c of chapters) if (c.total == null) c.total = c.items.reduce((s, i) => s + i.total, 0);
    // одна и та же глава могла встретиться дважды (разрыв листа) — объединяем
    const merged = [];
    for (const c of chapters) {
      const o = merged.find(x => x.n === c.n);
      if (o) { o.items.push(...c.items); o.total = Math.max(o.total || 0, c.total || 0); } else merged.push(c);
    }
    merged.sort((a, b) => a.n - b.n);
    return { chapters: merged, subtotals, grand, vat, totalCol: tc };
  }

  async function parseFile(file) {
    await loadLib();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    let best = null;
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false });
      const r = parseRows(rows);
      if (r.chapters.length && (!best || r.chapters.length > best.chapters.length)) best = Object.assign(r, { sheet: sn });
    }
    if (!best) throw new Error('В файле не найдены главы ССР (строки вида «Глава 1 …»)');
    best.file = file.name;
    best.imported = Date.now();
    if (best.grand == null) {
      const last = best.subtotals[best.subtotals.length - 1];
      best.grand = last ? last.total : best.chapters.reduce((s, c) => s + (c.total || 0), 0);
    }
    return best;
  }

  // Сравнение двух ССР: a — старая версия, b — новая.
  function compare(a, b) {
    const ns = [...new Set([...a.chapters.map(c => c.n), ...b.chapters.map(c => c.n)])].sort((x, y) => x - y);
    const rows = ns.map(n => {
      const ca = a.chapters.find(c => c.n === n), cb = b.chapters.find(c => c.n === n);
      const va = ca ? ca.total || 0 : 0, vb = cb ? cb.total || 0 : 0;
      const items = [];
      const ia = new Map((ca ? ca.items : []).map(i => [norm(i.name), i]));
      const ib = new Map((cb ? cb.items : []).map(i => [norm(i.name), i]));
      for (const k of new Set([...ia.keys(), ...ib.keys()])) {
        const x = ia.get(k), y = ib.get(k), d = (y ? y.total : 0) - (x ? x.total : 0);
        if (Math.abs(d) > 0.005) items.push({ name: (y || x).name, a: x ? x.total : null, b: y ? y.total : null, d });
      }
      items.sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
      return { n, name: (cb || ca).name, a: ca ? va : null, b: cb ? vb : null, d: vb - va, items };
    });
    const ga = a.grand || 0, gb = b.grand || 0;
    return { rows, grand: { a: ga, b: gb, d: gb - ga } };
  }

  return { parseFile, parseRows, compare, num };
})();
