/* Result cards: hand-written SVG charts over window.PAPER_DATA (generated from the paper's figure data). */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const D = window.PAPER_DATA;
  const C = { base: '#86B6EF', a25: '#3987E5', a50: '#256ABF', a75: '#184F95', zoo: '#0D366B', warm: '#C8642A', grid: '#efeff1', axis: '#a1a1a6', ink: '#1d1d1f', muted: '#6e6e73' };
  const ARMS = ['base', 'a25', 'a50', 'a75', 'zoo'];
  const ANAME = { base: 'Base (α = 0)', a25: 'α = 0.25', a50: 'α = 0.5', a75: 'α = 0.75', zoo: 'RLVR (α = 1)' };
  const ALPHA = [0, 0.25, 0.5, 0.75, 1];
  const BNAME = Object.fromEntries(D.benches.map((b) => [b.key, b.name]));
  const fmt = (x, d = 1) => (Math.round(x * 10 ** d + 1e-6) / 10 ** d).toFixed(d);
  const sgn = (x, d = 1) => (x >= 0 ? '+' : '−') + fmt(Math.abs(x), d);

  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const txt = (parent, x, y, s, attrs = {}) => { const t = el('text', Object.assign({ x, y, 'font-size': 15, fill: C.axis }, attrs), parent); t.textContent = s; return t; };
  const tip = document.getElementById('tip');
  const moveTip = (ev) => { const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; };
  const hover = (node, html, onIn, onOut) => {
    node.addEventListener('mouseenter', (e) => { tip.innerHTML = html(); tip.style.opacity = 1; moveTip(e); if (onIn) onIn(); });
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', () => { tip.style.opacity = 0; if (onOut) onOut(); });
  };
  function segmented(id, items, initial, onChange) {
    const box = document.getElementById(id);
    if (items) items.forEach(([k, n]) => { const b = document.createElement('button'); b.dataset.v = k; b.textContent = n; box.appendChild(b); });
    const btns = [...box.querySelectorAll('button')];
    const sync = (v) => btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
    btns.forEach((b) => b.addEventListener('click', () => { sync(b.dataset.v); onChange(b.dataset.v); }));
    sync(initial);
  }
  const niceTicks = (lo, hi, n = 5) => {
    const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
    const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6)); return out;
  };
  function drawIn(path) {
    const L = path.getTotalLength ? path.getTotalLength() : 0;
    if (!L) return;
    path.style.transition = 'none'; path.style.strokeDasharray = L; path.style.strokeDashoffset = L;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset .9s ease'; path.style.strokeDashoffset = 0;
    setTimeout(() => { path.style.strokeDasharray = path.dataset.dash || ''; path.style.transition = ''; }, 950);
  }

  /* ======================= 1. pass@k curves ======================= */
  const PK_BENCHES = ['minerva_math', 'olympiadbench', 'math500', 'gsm8k'];
  const pk = { bench: 'minerva_math', view: 'abs', focus: null };
  segmented('pk-bench', PK_BENCHES.map((b) => [b, BNAME[b]]), pk.bench, (v) => { pk.bench = v; drawPK(true); });
  segmented('pk-view', null, pk.view, (v) => { pk.view = v; drawPK(true); });
  const pkLegend = document.getElementById('pk-legend');
  ARMS.forEach((a) => {
    const s = document.createElement('span'); s.dataset.arm = a;
    s.innerHTML = `<i class="${a === 'base' || a === 'zoo' ? 'dash' : ''}" style="border-color:${C[a]}"></i>${ANAME[a].replace('α', '<span class="m">α</span>')}`;
    s.addEventListener('mouseenter', () => { pk.focus = a; focusPK(); });
    s.addEventListener('mouseleave', () => { pk.focus = null; focusPK(); });
    pkLegend.appendChild(s);
  });
  let pkLines = {};
  function focusPK() { for (const a in pkLines) pkLines[a].forEach((n) => n.classList.toggle('muted', pk.focus && pk.focus !== a)); }
  function drawPK(animate) {
    const svg = document.getElementById('pk-svg'); svg.innerHTML = ''; pkLines = {};
    const d = D.passk[pk.bench], ks = d.k;
    const val = (a, i) => (pk.view === 'abs' ? d[a][i] : d[a][i] - d.zoo[i]);
    let lo = Infinity, hi = -Infinity;
    ARMS.forEach((a) => ks.forEach((_, i) => { lo = Math.min(lo, val(a, i)); hi = Math.max(hi, val(a, i)); }));
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const X0 = 70, X1 = 930, Y0 = 395, Y1 = 20;
    const sx = (k) => X0 + Math.log2(k) / Math.log2(ks[ks.length - 1]) * (X1 - X0);
    const sy = (v) => Y0 - (v - lo) / (hi - lo) * (Y0 - Y1);
    niceTicks(lo, hi, 6).forEach((v) => { el('line', { x1: X0, x2: X1, y1: sy(v), y2: sy(v), stroke: C.grid }, svg); txt(svg, X0 - 10, sy(v) + 4, (pk.view === 'diff' && v > 0 ? '+' : '') + v, { 'text-anchor': 'end' }); });
    ks.forEach((k) => { el('line', { x1: sx(k), x2: sx(k), y1: Y1, y2: Y0, stroke: C.grid }, svg); txt(svg, sx(k), Y0 + 20, k, { 'text-anchor': 'middle' }); });
    el('line', { x1: sx(32), x2: sx(32), y1: Y1, y2: Y0, stroke: '#b9b9be', 'stroke-dasharray': '2 4' }, svg);
    txt(svg, (X0 + X1) / 2, Y0 + 42, 'samples per problem, k', { 'text-anchor': 'middle', fill: C.muted });
    txt(svg, 18, (Y0 + Y1) / 2, pk.view === 'abs' ? 'pass@k (%)' : 'pass@k − RLVR (points)', { 'text-anchor': 'middle', fill: C.muted, transform: `rotate(-90 18 ${(Y0 + Y1) / 2})` });
    if (pk.view === 'diff') el('line', { x1: X0, x2: X1, y1: sy(0), y2: sy(0), stroke: '#c7c7cc' }, svg);
    [...ARMS].reverse().forEach((a) => {
      if (pk.view === 'diff' && a === 'zoo') { pkLines[a] = []; }
      const dash = a === 'base' || a === 'zoo' ? '7 6' : '';
      const p = el('path', { class: 'ln', d: ks.map((k, i) => `${i ? 'L' : 'M'}${sx(k).toFixed(1)},${sy(val(a, i)).toFixed(1)}`).join(''), fill: 'none', stroke: C[a],
        'stroke-width': a === 'a25' ? 3.2 : 2.4, 'stroke-dasharray': dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg);
      p.dataset.dash = dash;
      if (animate) drawIn(p);
      const nodes = [p];
      ks.forEach((k, i) => {
        const c = el('circle', { class: 'dot', cx: sx(k), cy: sy(val(a, i)), r: 4.5, fill: C[a], stroke: '#fff', 'stroke-width': 1.5 }, svg);
        nodes.push(c);
        hover(c, () => `<b>${ANAME[a]}</b> · ${BNAME[pk.bench]}<br><span class="k">pass@${k}</span> <b>${fmt(d[a][i])}%</b>` +
          (a !== 'zoo' ? ` <span class="k">(${sgn(d[a][i] - d.zoo[i])} vs. RLVR)</span>` : ''),
          () => { pk.focus = a; focusPK(); c.setAttribute('r', 7); }, () => { pk.focus = null; focusPK(); c.setAttribute('r', 4.5); });
      });
      pkLines[a] = nodes;
    });
    focusPK();
  }
  drawPK(false);

  /* ======================= 2. trade-off stepper ======================= */
  const TR_BENCHES = ['olympiadbench', 'minerva_math', 'math500', 'gsm8k'];
  const tr = { bench: 'olympiadbench', step: 4, timer: null };
  segmented('tr-bench', TR_BENCHES.map((b) => [b, BNAME[b]]), tr.bench, (v) => { tr.bench = v; stopPlay(); drawTR(); });
  const pips = document.getElementById('tr-pips');
  ALPHA.forEach((a, i) => { const s = document.createElement('span'); s.title = `α = ${a}`; s.addEventListener('click', () => { stopPlay(); tr.step = i; drawTR(); }); pips.appendChild(s); });
  const back = document.getElementById('tr-back'), next = document.getElementById('tr-next'), play = document.getElementById('tr-play');
  back.addEventListener('click', () => { stopPlay(); tr.step = Math.max(0, tr.step - 1); drawTR(); });
  next.addEventListener('click', () => { stopPlay(); tr.step = Math.min(4, tr.step + 1); drawTR(); });
  play.addEventListener('click', () => {
    if (tr.timer) { stopPlay(); return; }
    tr.step = 0; drawTR(); play.textContent = '❙❙ Pause';
    tr.timer = setInterval(() => { if (tr.step >= 4) { stopPlay(); return; } tr.step++; drawTR(); }, 1500);
  });
  function stopPlay() { if (tr.timer) clearInterval(tr.timer); tr.timer = null; play.textContent = '▶ Play'; }
  function readTR() {
    const t = D.tradeoff[tr.bench], i = tr.step, n = BNAME[tr.bench];
    const p1 = t.p1, pK = t.pK;
    if (i === 0) return `<b>Base model</b> on ${n}: pass@1 <b>${fmt(p1[0])}</b>, pass@128 <b>${fmt(pK[0])}</b>. Broad coverage, weak first tries.`;
    if (i === 4) return `<b>RLVR policy</b>: pass@1 <b>${fmt(p1[4])}</b> (${sgn(p1[4] - p1[0])} over base), but pass@128 <b>${fmt(pK[4])}</b> ` +
      `(<span class="warm">${sgn(pK[4] - pK[0])}</span> vs. base).`;
    const kept = (p1[i] - p1[0]) / (p1[4] - p1[0]) * 100;
    const dK = pK[i] - pK[4];
    return `<b><span class="m">α</span> = ${ALPHA[i]}</b>: pass@1 <b>${fmt(p1[i])}</b>, keeping <span class="good">${Math.round(kept)}%</span> of RLVR's pass@1 gain; ` +
      `pass@128 <b>${fmt(pK[i])}</b>, <span class="${dK >= 0 ? 'good' : 'warm'}">${sgn(dK)}</span> vs. RLVR.`;
  }
  function drawTR() {
    const svg = document.getElementById('tr-svg'); svg.innerHTML = '';
    const t = D.tradeoff[tr.bench], m = D.mixture[tr.bench], yue = D.yue[tr.bench].rlhighT;
    const xs = t.p1.concat(m.p1), ys = t.pK.concat(m.pK, [yue]);
    let xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
    const xp = (xhi - xlo) * 0.08, yp = (yhi - ylo) * 0.14; xlo -= xp; xhi += xp * 1.6; ylo -= yp; yhi += yp;
    const X0 = 70, X1 = 960, Y0 = 410, Y1 = 16;
    const sx = (v) => X0 + (v - xlo) / (xhi - xlo) * (X1 - X0), sy = (v) => Y0 - (v - ylo) / (yhi - ylo) * (Y0 - Y1);
    niceTicks(ylo, yhi, 5).forEach((v) => { el('line', { x1: X0, x2: X1, y1: sy(v), y2: sy(v), stroke: C.grid }, svg); txt(svg, X0 - 10, sy(v) + 4, v, { 'text-anchor': 'end' }); });
    niceTicks(xlo, xhi, 6).forEach((v) => { el('line', { x1: sx(v), x2: sx(v), y1: Y1, y2: Y0, stroke: C.grid }, svg); txt(svg, sx(v), Y0 + 20, v, { 'text-anchor': 'middle' }); });
    txt(svg, (X0 + X1) / 2, Y0 + 44, 'pass@1 (%)  →  better first tries', { 'text-anchor': 'middle', fill: C.muted });
    txt(svg, 18, (Y0 + Y1) / 2, 'pass@128 (%)  →  more coverage', { 'text-anchor': 'middle', fill: C.muted, transform: `rotate(-90 18 ${(Y0 + Y1) / 2})` });
    // Yue high-T reference
    el('line', { x1: X0, x2: X1, y1: sy(yue), y2: sy(yue), stroke: C.warm, 'stroke-width': 2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, svg);
    txt(svg, X0 + 8, sy(yue) - 8, `RLVR at higher T: ${fmt(yue)}`, { 'text-anchor': 'start', fill: C.warm, 'font-size': 14 });
    // mixture curve
    el('path', { d: m.p1.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(m.pK[i]).toFixed(1)}`).join(''), fill: 'none', stroke: '#8e8e93', 'stroke-width': 1.8, 'stroke-dasharray': '6 5' }, svg);
    // path up to the current step
    const pts = t.p1.map((x, i) => [sx(x), sy(t.pK[i])]);
    if (tr.step > 0) el('path', { d: pts.slice(0, tr.step + 1).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(''), fill: 'none', stroke: '#9a9aa0', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, svg);
    pts.forEach((p, i) => {
      const a = ARMS[i], on = i === tr.step, shown = i <= tr.step;
      const c = el('circle', { class: 'dot', cx: p[0], cy: p[1], r: on ? 11 : 7.5, fill: C[a], stroke: '#fff', 'stroke-width': 2.2, opacity: shown ? 1 : 0.18 }, svg);
      if (on) el('circle', { cx: p[0], cy: p[1], r: 17, fill: 'none', stroke: C[a], 'stroke-width': 1.5, opacity: 0.5 }, svg);
      const lab = i === 0 ? 'Base' : i === 4 ? 'RLVR' : `α = ${ALPHA[i]}`;
      if (shown) txt(svg, p[0] + 14, p[1] - 12, lab, { fill: on ? C.ink : C.muted, 'font-size': 14, 'font-weight': on ? 700 : 400 });
      hover(c, () => `<b>${ANAME[a]}</b> · ${BNAME[tr.bench]}<br><span class="k">pass@1</span> <b>${fmt(t.p1[i])}</b> &nbsp; <span class="k">pass@128</span> <b>${fmt(t.pK[i])}</b>`);
    });
    [...pips.children].forEach((s, i) => { s.classList.toggle('on', i === tr.step); s.style.background = i <= tr.step ? C[ARMS[i]] : '#d9d9de'; });
    back.disabled = tr.step === 0; next.disabled = tr.step === 4;
    document.getElementById('tr-readout').innerHTML = readTR();
  }
  drawTR();

  /* ======================= 3. samples to target ======================= */
  const sm = { target: 'pass128' };
  segmented('sm-target', null, sm.target, (v) => { sm.target = v; drawSM(); });
  const smLegend = document.getElementById('sm-legend');
  ARMS.forEach((a) => { const s = document.createElement('span'); s.innerHTML = `<i class="sq" style="background:${C[a]}"></i>${ANAME[a].replace('α', '<span class="m">α</span>')}`; smLegend.appendChild(s); });
  function drawSM() {
    const svg = document.getElementById('sm-svg');
    const T = D.samples[sm.target], order = D.samples.order, full = sm.target === 'pass128' ? 128 : 32;
    const X0 = 70, X1 = 960, Y0 = 330, Y1 = 30, vmax = 128;
    const sy = (v) => Y0 - v / vmax * (Y0 - Y1);
    const gw = (X1 - X0) / order.length, bw = 30, bg = 8;
    if (!svg.dataset.init) {
      svg.dataset.init = 1;
      [0, 32, 64, 96, 128].forEach((v) => { el('line', { x1: X0, x2: X1, y1: sy(v), y2: sy(v), stroke: C.grid }, svg); txt(svg, X0 - 10, sy(v) + 4, v, { 'text-anchor': 'end' }); });
      txt(svg, 18, (Y0 + Y1) / 2, 'samples per problem', { 'text-anchor': 'middle', fill: C.muted, transform: `rotate(-90 18 ${(Y0 + Y1) / 2})` });
      order.forEach((b, g) => {
        const cx = X0 + gw * (g + 0.5);
        txt(svg, cx, Y0 + 24, BNAME[b], { 'text-anchor': 'middle', fill: C.ink, 'font-size': 14 });
        el('text', { id: `sm-t-${b}`, x: cx, y: Y0 + 44, 'text-anchor': 'middle', 'font-size': 12.5, fill: C.axis }, svg);
        ARMS.forEach((a, j) => {
          const x = cx - (5 * bw + 4 * bg) / 2 + j * (bw + bg);
          const r = el('rect', { class: 'bar', id: `sm-${b}-${j}`, x, y: Y0, width: bw, height: 0, rx: 4, fill: C[a] }, svg);
          el('text', { id: `sm-v-${b}-${j}`, x: x + bw / 2, y: Y0 - 6, 'text-anchor': 'middle', 'font-size': 12.5, fill: C.ink, style: 'transition: y .5s ease' }, svg);
          hover(r, () => {
            const v = D.samples[sm.target][b][j], f = full / v;
            return `<b>${ANAME[a]}</b> · ${BNAME[b]}<br>reaches RLVR's ${sm.target.replace('pass', 'pass@')} (${D.samples[sm.target].target[b]}%) with <b>${v}</b> samples` +
              (a !== 'zoo' ? `<br><span class="k">${f >= 1 ? fmt(f) + '× fewer than RLVR' : fmt(1 / f) + '× more than RLVR'}</span>` : '');
          });
        });
      });
    }
    order.forEach((b) => {
      document.getElementById(`sm-t-${b}`).textContent = `target ${T.target[b]}%`;
      T[b].forEach((v, j) => {
        const r = document.getElementById(`sm-${b}-${j}`), t = document.getElementById(`sm-v-${b}-${j}`);
        r.setAttribute('y', sy(v)); r.setAttribute('height', Y0 - sy(v));
        t.setAttribute('y', sy(v) - 6); t.textContent = v;
      });
    });
    const s = T, main = ['olympiadbench', 'minerva_math', 'math500'];
    const r0 = main.map((b) => full / s[b][1]);
    document.getElementById('sm-readout').innerHTML = sm.target === 'pass128'
      ? `<span class="m">α</span> = 0.25 reaches RLVR's pass@128 with <b>${s.olympiadbench[1]}</b> samples on OlympiadBench, <b>${s.minerva_math[1]}</b> on Minerva, and <b>${s.math500[1]}</b> on MATH500: ` +
        `<span class="good">${fmt(Math.min(...r0))} to ${fmt(Math.max(...r0))}× fewer</span> than the 128 RLVR needs.`
      : `At RLVR's pass@32 the gap is smaller: <span class="m">α</span> = 0.25 needs <b>${s.olympiadbench[1]}</b> (OlympiadBench), <b>${s.minerva_math[1]}</b> (Minerva), and <b>${s.math500[1]}</b> (MATH500) samples instead of 32.`;
  }
  drawSM();

  /* ======================= 4. token-level demo ======================= */
  const P0 = [0.59, 0.40, 0.01], P1 = [0.98, 0.01, 0.01];
  const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return v.map((x) => x / s); };
  const geo = (a) => norm(P0.map((p, i) => p ** (1 - a) * P1[i] ** a));
  const heat = (T) => norm(P1.map((p) => p ** (1 / T)));
  const sa = document.getElementById('tk-a'), st = document.getElementById('tk-t');
  const tkSvg = document.getElementById('tk-svg');
  const TX0 = 70, TX1 = 960, TY0 = 270, TY1 = 20, TOK = ['A', 'B', 'D'], TDESC = ['both models like it', 'base likes it, RLVR removed it', 'neither model supports it'];
  const tsy = (v) => TY0 - v * (TY0 - TY1);
  const tgw = (TX1 - TX0) / 3, tbw = 48, tbg = 10, SCOL = [C.base, C.zoo, C.a50, C.warm], SNAME = ['Base', 'RLVR', 'Interpolated', 'RLVR at temperature'];
  [0, 0.25, 0.5, 0.75, 1].forEach((v) => { el('line', { x1: TX0, x2: TX1, y1: tsy(v), y2: tsy(v), stroke: C.grid }, tkSvg); txt(tkSvg, TX0 - 10, tsy(v) + 4, v, { 'text-anchor': 'end' }); });
  txt(tkSvg, 18, (TY0 + TY1) / 2, 'probability', { 'text-anchor': 'middle', fill: C.muted, transform: `rotate(-90 18 ${(TY0 + TY1) / 2})` });
  const tkBars = TOK.map((name, g) => {
    const cx = TX0 + tgw * (g + 0.5);
    const t = el('text', { x: cx, y: TY0 + 30, 'text-anchor': 'middle', 'font-size': 22, fill: C.ink, 'font-style': 'italic', style: 'font-family: var(--serif)' }, tkSvg); t.textContent = name;
    txt(tkSvg, cx, TY0 + 52, TDESC[g], { 'text-anchor': 'middle', 'font-size': 13 });
    return SCOL.map((c, j) => {
      const x = cx - (4 * tbw + 3 * tbg) / 2 + j * (tbw + tbg);
      const r = el('rect', { class: 'bar', x, y: TY0, width: tbw, height: 0, rx: 4, fill: c }, tkSvg);
      const v = el('text', { x: x + tbw / 2, y: TY0 - 6, 'text-anchor': 'middle', 'font-size': 12.5, fill: C.ink, style: 'transition: y .5s ease' }, tkSvg);
      return { r, v, j };
    });
  });
  const p3 = (x) => (x < 0.1 ? x.toFixed(3) : x.toFixed(2));
  function drawTK() {
    const a = +sa.value, T = +st.value;
    document.getElementById('tk-a-v').textContent = a.toFixed(2);
    document.getElementById('tk-t-v').textContent = T.toFixed(2);
    const S = [P0, P1, geo(a), heat(T)];
    tkBars.forEach((bs, g) => bs.forEach(({ r, v, j }) => {
      const p = S[j][g]; r.setAttribute('y', tsy(p)); r.setAttribute('height', TY0 - tsy(p)); v.setAttribute('y', tsy(p) - 6); v.textContent = p3(p);
    }));
    const G = S[2], H = S[3];
    document.getElementById('tk-readout').innerHTML =
      `Token <i class="m">B</i>: interpolation gives <b>${p3(G[1])}</b> (<span class="good">${fmt(G[1] / P1[1])}×</span> RLVR's 0.010), temperature gives <b>${p3(H[1])}</b>. ` +
      `Token <i class="m">D</i>: interpolation <b>${p3(G[2])}</b>, temperature <span class="${H[2] > 0.02 ? 'warm' : ''}">${p3(H[2])}</span>.`;
  }
  sa.addEventListener('input', drawTK); st.addEventListener('input', drawTK);
  drawTK();

  /* ======================= main table + misc ======================= */
  const tbl = document.getElementById('main-table');
  let html = '<tr><th>Benchmark</th>' + ARMS.map((a) => `<th>${ANAME[a]}</th>`).join('') + '</tr>';
  const sums = ARMS.map(() => [0, 0]);
  D.benches.forEach(({ key, name }) => {
    const t = D.tradeoff[key];
    html += `<tr><td>${name}</td>` + ARMS.map((a, i) => `<td>${fmt(t.p1[i])} / ${t.pK[i] >= 99.95 ? '100' : fmt(t.pK[i])}</td>`).join('') + '</tr>';
    if (key !== 'aime24') ARMS.forEach((a, i) => { sums[i][0] += t.p1[i]; sums[i][1] += t.pK[i]; });
  });
  html += '<tr class="mean"><td>Mean, w/o AIME24</td>' + sums.map(([a, b]) => `<td>${fmt(a / 5)} / ${fmt(b / 5)}</td>`).join('') + '</tr>';
  tbl.innerHTML = html;

  document.getElementById('copy-bib').addEventListener('click', (e) => {
    const b = e.currentTarget;
    navigator.clipboard.writeText(document.getElementById('bibtex').textContent).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); }, () => {});
  });
})();
