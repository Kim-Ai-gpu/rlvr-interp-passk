/* Teaser: a scripted SVG explainer. render(t) is a pure function of time, so chapters and the progress bar can seek. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('stage');
  const frame = document.getElementById('frame');
  const bar = document.getElementById('bar');
  const progress = document.getElementById('progress');
  const chapterBtns = [...document.querySelectorAll('.chapters button')];
  const D = window.PAPER_DATA;

  const COL = { a0: '#86B6EF', a25: '#3987E5', a50: '#256ABF', a75: '#184F95', a100: '#0D366B', warm: '#C8642A',
    ink: '#1d1d1f', muted: '#6e6e73', faint: '#a1a1a6', line: '#e3e3e6', soft: '#f5f5f7', good: '#2E7D3A' };
  const CH = [0, 7, 15, 24];          // chapter start times (s)
  const TOTAL = 33.5;

  /* ---------- helpers ---------- */
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); set(e, attrs); (parent || svg).appendChild(e); return e; };
  const set = (e, attrs) => { for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const smooth = (x) => x * x * (3 - 2 * x);
  const seg = (t, a, b) => smooth(clamp((t - a) / (b - a)));            // eased 0..1 over [a, b]
  const win = (t, a, b, f = 0.4) => Math.min(seg(t, a, a + f), 1 - seg(t, b - f, b));   // fade in at a, out at b
  const lerp = (a, b, x) => a + (b - a) * x;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (c1, c2, x) => { const a = hex(c1), b = hex(c2); return '#' + a.map((v, i) => Math.round(lerp(v, b[i], x)).toString(16).padStart(2, '0')).join(''); };
  const fmt = (x, d = 1) => (Math.round(x * 10 ** d + 1e-6) / 10 ** d).toFixed(d);
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // math text: parts = [[text, 'i'|'r'|'sub'|'sup'|'subi'|'supi'], ...]
  function math(parent, x, y, size, parts, attrs = {}) {
    const t = el('text', Object.assign({ x, y, 'font-size': size, class: 'serif', fill: COL.ink }, attrs), parent);
    let shifted = 0;
    parts.forEach(([s, k]) => {
      const sp = el('tspan', {}, t);
      sp.textContent = s;
      if (k.startsWith('sub') || k.startsWith('sup')) {
        const dy = k.startsWith('sub') ? size * 0.28 : -size * 0.42;
        set(sp, { 'font-size': size * 0.62, dy: dy - shifted });
        shifted = dy;
      } else if (shifted) { set(sp, { dy: -shifted }); shifted = 0; }
      if (k === 'i' || k === 'subi' || k === 'supi') sp.setAttribute('font-style', 'italic');
    });
    return t;
  }
  function label(parent, x, y, s, attrs = {}) {
    const t = el('text', Object.assign({ x, y, 'font-size': 22, fill: COL.muted, 'text-anchor': 'middle' }, attrs), parent);
    t.textContent = s; return t;
  }

  /* ---------- caption (HTML, so it stays readable on phones) ---------- */
  const cap = document.createElement('div');
  cap.className = 'caption';
  frame.appendChild(cap);
  const CAPTIONS = [
    [0.4, 3.6, 'RLVR fine-tunes a base model into a policy that is better on its first try.'],
    [3.6, 7, 'But on hard problems its samples collapse onto one answer, while the base model still explores.'],
    [7, 11.2, 'Interpolate the weights with a single number <i>α</i>. No training.'],
    [11.2, 15, '<i>α</i> = 0 is the base model, <i>α</i> = 1 is the RLVR policy, and every <i>α</i> in between is one model to serve.'],
    [15, 17, 'Inside one next-token distribution: three tokens, two models.'],
    [17, 19.8, 'Mixing weights roughly multiplies the distributions, so token <i>B</i>, which RLVR nearly removed, comes back.'],
    [19.8, 24, 'Heating the RLVR policy instead also lifts token <i>D</i>, which neither model supports.'],
    [24, 28.4, 'Measured on Minerva: <i>α</i> = 0.25 keeps most of RLVR’s first-try gain and the base model’s coverage.'],
    [28.4, TOTAL, 'With a verifier, it matches RLVR’s pass@128 with 18 samples instead of 128.'],
  ];
  let capNow = -1;

  /* =============== chapter 1 + 2: model cards =============== */
  const N = 7, CELL = 34, GAP = 4, GW = N * CELL + (N - 1) * GAP;
  const r = rng(7);
  const W0 = [], W1 = [];
  for (let i = 0; i < N * N; i++) { const b = r(); W0.push(b); W1.push(clamp(b * 0.5 + r() * 0.5)); }
  const baseCol = (v) => mix('#e3eefc', COL.a0, v);
  const rlCol = (v) => mix('#4d82c9', COL.a100, v);

  function card(name, sub) {
    const g = el('g', {});
    el('rect', { x: -160, y: -160, width: 320, height: 320, rx: 22, fill: '#fff', stroke: COL.line, 'stroke-width': 2 }, g);
    const cells = [];
    for (let i = 0; i < N * N; i++) {
      const x = -GW / 2 + (i % N) * (CELL + GAP), y = -GW / 2 + Math.floor(i / N) * (CELL + GAP);
      cells.push(el('rect', { x, y, width: CELL, height: CELL, rx: 6 }, g));
    }
    const t1 = label(g, 0, 205, name, { 'font-size': 30, fill: COL.ink, 'font-weight': 700 });
    const t2 = label(g, 0, 240, sub, { 'font-size': 22 });
    return { g, cells, t1, t2 };
  }
  const cBase = card('Base model', 'Qwen2.5-7B');
  const cRL = card('RLVR policy', 'SimpleRL-Zoo-7B');
  const cMid = card('', '');
  cBase.cells.forEach((c, i) => c.setAttribute('fill', baseCol(W0[i])));
  cRL.cells.forEach((c, i) => c.setAttribute('fill', rlCol(W1[i])));
  const midName = math(cMid.g, 0, 210, 40, [['W', 'i'], ['(', 'r'], ['α', 'i'], [')', 'r']], { 'text-anchor': 'middle' });
  const midSub = label(cMid.g, 0, 244, 'one model', { 'font-size': 22 });
  const tagBase = label(cBase.g, 0, -184, 'α = 0', { 'font-size': 32, class: 'serif', 'font-style': 'italic', fill: COL.ink });
  const tagRL = label(cRL.g, 0, -184, 'α = 1', { 'font-size': 32, class: 'serif', 'font-style': 'italic', fill: COL.ink });

  // ch1: training arrow
  const arrow = el('g', {});
  const arrowLine = el('path', { d: 'M 600 330 L 990 330', stroke: COL.muted, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-dasharray': 400, 'stroke-dashoffset': 400 }, arrow);
  const arrowHead = el('path', { d: 'M 975 316 L 1000 330 L 975 344', stroke: COL.muted, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, arrow);
  const arrowTxt = label(arrow, 795, 310, 'RLVR training', { 'font-size': 26, fill: COL.ink });

  // ch1: sampled answers
  const ANS = { base: ['12', '7', '√2', '12', '3/4', '9', '5', '12'], rl: ['12', '12', '12', '12', '12', '12', '9', '12'] };
  const CORRECT = '5';
  const samples = el('g', {});
  function chips(cx, list) {
    const out = [];
    const w = 52, gap = 8, total = list.length * w + (list.length - 1) * gap;
    list.forEach((a, i) => {
      const g = el('g', { transform: `translate(${cx - total / 2 + i * (w + gap) + w / 2}, 668)` }, samples);
      const ok = a === CORRECT;
      el('rect', { x: -w / 2, y: -22, width: w, height: 44, rx: 10, fill: ok ? '#eef8f0' : COL.soft, stroke: ok ? COL.good : COL.line, 'stroke-width': ok ? 3 : 1.5 }, g);
      const t = el('text', { x: 0, y: 8, 'text-anchor': 'middle', 'font-size': 22, fill: ok ? COL.good : COL.ink, 'font-weight': ok ? 700 : 400 }, g);
      t.textContent = a;
      out.push(g);
    });
    return out;
  }
  const sampTitleB = label(samples, 420, 624, '8 samples on one hard problem', { 'font-size': 22, fill: COL.ink });
  const sampTitleR = label(samples, 1180, 624, '8 samples on the same problem', { 'font-size': 22, fill: COL.ink });
  const chipsB = chips(420, ANS.base), chipsR = chips(1180, ANS.rl);
  const verdictB = label(samples, 420, 738, '✓ solved: one sample is correct', { 'font-size': 23, fill: COL.good, 'font-weight': 700 });
  const verdictR = label(samples, 1180, 738, '✗ not solved: the same wrong answer', { 'font-size': 23, fill: COL.warm, 'font-weight': 700 });

  // ch2: formula + slider
  const formula = math(svg, 800, 112, 50, [['W', 'i'], ['(', 'r'], ['α', 'i'], [') = ', 'r'], ['W', 'i'], ['base', 'sub'], [' + ', 'r'], ['α', 'i'],
    [' (', 'r'], ['W', 'i'], ['RL', 'sub'], [' − ', 'r'], ['W', 'i'], ['base', 'sub'], [')', 'r']], { 'text-anchor': 'middle' });
  const slider = el('g', {});
  const SX0 = 560, SX1 = 1040, SY = 690;
  el('line', { x1: SX0, x2: SX1, y1: SY, y2: SY, stroke: COL.line, 'stroke-width': 8, 'stroke-linecap': 'round' }, slider);
  const fill = el('line', { x1: SX0, x2: SX0, y1: SY, y2: SY, stroke: COL.a50, 'stroke-width': 8, 'stroke-linecap': 'round' }, slider);
  const ALPHAS = [0, 0.25, 0.5, 0.75, 1], ACOL = [COL.a0, COL.a25, COL.a50, COL.a75, COL.a100];
  const ticks = ALPHAS.map((a, i) => {
    const x = lerp(SX0, SX1, a);
    const dot = el('circle', { cx: x, cy: SY, r: 6, fill: '#fff', stroke: ACOL[i], 'stroke-width': 3 }, slider);
    const t = label(slider, x, SY + 46, String(a), { 'font-size': 22 });
    return { dot, t };
  });
  const knob = el('circle', { cx: SX0, cy: SY, r: 17, fill: '#fff', stroke: COL.a50, 'stroke-width': 5 }, slider);
  const knobTxt = label(slider, SX0, SY - 34, '', { 'font-size': 26, class: 'serif', 'font-style': 'italic', fill: COL.ink });

  /* =============== chapter 3: token bars =============== */
  const tok = el('g', {});
  const P0 = [0.59, 0.40, 0.01], P1 = [0.98, 0.01, 0.01];
  const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return v.map((x) => x / s); };
  const geo = (a) => norm(P0.map((p, i) => p ** (1 - a) * P1[i] ** a));
  const temp = (T) => norm(P1.map((p) => p ** (1 / T)));
  const BY = 700, BH = 430, BW = 58, BG = 12, GXS = [470, 800, 1130];
  const TOKS = [['A', 'both models like it'], ['B', 'base likes it, RLVR removed it'], ['D', 'neither model supports it']];
  const hiB = el('rect', { x: GXS[1] - 160, y: BY - BH - 20, width: 320, height: BH + 120, rx: 18, fill: '#eef4fc', opacity: 0 }, tok);
  const hiD = el('rect', { x: GXS[2] - 160, y: BY - BH - 20, width: 320, height: BH + 120, rx: 18, fill: '#fbeee6', opacity: 0 }, tok);
  el('line', { x1: 300, x2: 1300, y1: BY, y2: BY, stroke: '#c7c7cc', 'stroke-width': 2 }, tok);
  const BCOL = [COL.a0, COL.a100, COL.a50, COL.warm];
  const bars = TOKS.map(([name, desc], g) => {
    const gx = GXS[g], x0 = gx - (4 * BW + 3 * BG) / 2;
    const bs = BCOL.map((c, j) => {
      const rect = el('rect', { x: x0 + j * (BW + BG), y: BY, width: BW, height: 0, rx: 5, fill: c }, tok);
      const t = el('text', { x: x0 + j * (BW + BG) + BW / 2, y: BY - 8, 'text-anchor': 'middle', 'font-size': 19, fill: COL.ink, opacity: 0 }, tok);
      return { rect, t };
    });
    math(tok, gx, BY + 52, 46, [[name, 'i']], { 'text-anchor': 'middle' });
    label(tok, gx, BY + 86, desc, { 'font-size': 20 });
    return bs;
  });
  const tokLegend = el('g', { transform: 'translate(300, 150)' }, tok);
  [['Base', COL.a0], ['RLVR', COL.a100], ['Interpolated (α)', COL.a50], ['RLVR at temperature T', COL.warm]].forEach(([s, c], i) => {
    const g = el('g', { transform: `translate(${[0, 130, 280, 520][i]}, 0)` }, tokLegend);
    el('rect', { x: 0, y: -16, width: 20, height: 20, rx: 4, fill: c }, g);
    const t = el('text', { x: 30, y: 1, 'font-size': 21, fill: COL.muted }, g); t.textContent = s;
  });
  const tokFormula = math(tok, 1300, 95, 42, [['π', 'i'], ['α', 'subi'], [' ∝ ', 'r'], ['π', 'i'], ['0', 'sub'], ['1−α', 'supi'], [' ', 'r'], ['π', 'i'], ['1', 'sub'], ['α', 'supi']], { 'text-anchor': 'end' });
  const tokA = label(tok, 1300, 150, '', { 'font-size': 22, 'text-anchor': 'end', class: 'serif', 'font-style': 'italic', fill: COL.a50 });
  const tokT = label(tok, 1300, 182, '', { 'font-size': 22, 'text-anchor': 'end', class: 'serif', 'font-style': 'italic', fill: COL.warm });

  /* =============== chapter 4: pass@k curves (measured, Minerva) =============== */
  const pk = el('g', {});
  const M = D.passk.minerva_math;
  const PX0 = 300, PX1 = 1280, PY0 = 700, PY1 = 140, YMIN = 20, YMAX = 70;
  const px = (k) => PX0 + Math.log2(k) / 7 * (PX1 - PX0);
  const py = (v) => PY0 - (v - YMIN) / (YMAX - YMIN) * (PY0 - PY1);
  for (let v = 20; v <= 70; v += 10) {
    el('line', { x1: PX0, x2: PX1, y1: py(v), y2: py(v), stroke: '#efeff1', 'stroke-width': 2 }, pk);
    label(pk, PX0 - 16, py(v) + 7, String(v), { 'font-size': 20, 'text-anchor': 'end', fill: COL.faint });
  }
  M.k.forEach((k) => label(pk, px(k), PY0 + 34, String(k), { 'font-size': 20, fill: COL.faint }));
  label(pk, (PX0 + PX1) / 2, PY0 + 74, 'samples per problem, k', { 'font-size': 22 });
  label(pk, PX0 - 70, (PY0 + PY1) / 2, 'pass@k on Minerva (%)', { 'font-size': 22, transform: `rotate(-90 ${PX0 - 70} ${(PY0 + PY1) / 2})` });
  const clip = el('clipPath', { id: 'pkclip' }, el('defs', {}, pk));
  const clipR = el('rect', { x: PX0 - 20, y: 0, width: 0, height: 900 }, clip);
  const curveG = el('g', { 'clip-path': 'url(#pkclip)' }, pk);
  const path = (arr) => M.k.map((k, i) => `${i ? 'L' : 'M'} ${px(k).toFixed(1)} ${py(arr[i]).toFixed(1)}`).join(' ');
  const SER = [['base', COL.a0, '10 9', 4, 'Base'], ['zoo', COL.a100, '10 9', 4, 'RLVR'], ['a25', COL.a25, '', 6, 'α = 0.25']];
  SER.forEach(([key, c, dash, w]) => {
    el('path', { d: path(M[key]), stroke: c, 'stroke-width': w, fill: 'none', 'stroke-dasharray': dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, curveG);
    M.k.forEach((k, i) => el('circle', { cx: px(k), cy: py(M[key][i]), r: key === 'a25' ? 7 : 5.5, fill: c, stroke: '#fff', 'stroke-width': 2 }, curveG));
  });
  const last = M.k.length - 1;
  const endLab = el('g', { opacity: 0 }, pk);
  label(endLab, PX1 + 18, py(M.a25[last]) - 4, `α = 0.25 and base: ${fmt(M.a25[last])}`, { 'font-size': 22, 'text-anchor': 'start', fill: COL.a25, 'font-weight': 700 });
  label(endLab, PX1 + 18, py(M.zoo[last]) + 8, `RLVR: ${fmt(M.zoo[last])}`, { 'font-size': 22, 'text-anchor': 'start', fill: COL.a100, 'font-weight': 700 });
  const startLab = el('g', { opacity: 0, transform: `translate(${PX0 + 30}, ${PY1 + 10})` }, pk);
  el('rect', { x: -14, y: -30, width: 290, height: 150, rx: 14, fill: '#fff', stroke: COL.line, 'stroke-width': 2 }, startLab);
  label(startLab, 0, 0, 'pass@1 (k = 1)', { 'font-size': 21, 'text-anchor': 'start', fill: COL.muted });
  [['RLVR', M.zoo[0], COL.a100], ['α = 0.25', M.a25[0], COL.a25], ['Base', M.base[0], COL.a0]].forEach(([n, v, c], i) => {
    el('circle', { cx: 8, cy: 34 + i * 32 - 7, r: 7, fill: c }, startLab);
    label(startLab, 26, 34 + i * 32, n, { 'font-size': 22, 'text-anchor': 'start', fill: COL.ink });
    label(startLab, 250, 34 + i * 32, fmt(v), { 'font-size': 22, 'text-anchor': 'end', fill: COL.ink, 'font-weight': 700 });
  });
  // samples-to-target annotation: alpha 0.25 reaches RLVR pass@128 at k = 18 (paper Table 3)
  const tgt = M.zoo[last], K18 = D.samples.pass128.minerva_math[1];
  const ann = el('g', { opacity: 0 }, pk);
  el('line', { x1: px(1), x2: px(128), y1: py(tgt), y2: py(tgt), stroke: COL.warm, 'stroke-width': 2.5, 'stroke-dasharray': '3 7', 'stroke-linecap': 'round' }, ann);
  el('line', { x1: px(K18), x2: px(K18), y1: py(tgt), y2: PY0, stroke: COL.a25, 'stroke-width': 2.5, 'stroke-dasharray': '3 7', 'stroke-linecap': 'round' }, ann);
  el('circle', { cx: px(K18), cy: py(tgt), r: 10, fill: '#fff', stroke: COL.a25, 'stroke-width': 4 }, ann);
  const annTxt = label(ann, px(K18) - 14, PY0 - 18, `${K18} samples`, { 'font-size': 24, fill: COL.a25, 'font-weight': 700, 'text-anchor': 'end' });
  label(ann, px(128) - 14, PY0 - 18, '128 samples', { 'font-size': 24, fill: COL.a100, 'font-weight': 700, 'text-anchor': 'end' });

  /* ---------- render ---------- */
  function render(t) {
    // chapter 1 / 2 cards
    const c12 = 1 - seg(t, 15, 15.6);
    const move = seg(t, 7, 8.2);
    const sc = lerp(1, 0.82, move);
    set(cBase.g, { transform: `translate(${lerp(420, 300, move)}, ${lerp(330, 360, move)}) scale(${sc})`, opacity: seg(t, 0, 0.6) * c12 });
    set(cRL.g, { transform: `translate(${lerp(1180, 1300, move)}, ${lerp(330, 360, move)}) scale(${sc})`, opacity: seg(t, 0.8, 1.6) * c12 });
    set(cMid.g, { transform: `translate(800, 360) scale(${lerp(0.6, 0.82, seg(t, 7.8, 8.6))})`, opacity: seg(t, 7.8, 8.6) * c12 });
    const tagO = seg(t, 11.2, 11.8) * c12; tagBase.setAttribute('opacity', tagO); tagRL.setAttribute('opacity', tagO);

    set(arrow, { opacity: 1 - seg(t, 6.8, 7.4) });
    arrowLine.setAttribute('stroke-dashoffset', 400 * (1 - seg(t, 0.8, 2.0)));
    arrowHead.setAttribute('opacity', seg(t, 1.8, 2.1)); arrowTxt.setAttribute('opacity', seg(t, 1.4, 2.2));

    set(samples, { opacity: 1 - seg(t, 6.8, 7.4) });
    sampTitleB.setAttribute('opacity', seg(t, 3.4, 3.9)); sampTitleR.setAttribute('opacity', seg(t, 3.4, 3.9));
    chipsB.forEach((g, i) => g.setAttribute('opacity', seg(t, 3.8 + i * 0.22, 4.0 + i * 0.22)));
    chipsR.forEach((g, i) => g.setAttribute('opacity', seg(t, 3.8 + i * 0.22, 4.0 + i * 0.22)));
    verdictB.setAttribute('opacity', seg(t, 5.8, 6.2)); verdictR.setAttribute('opacity', seg(t, 5.8, 6.2));

    // alpha path for chapter 2
    let a = 0;
    if (t >= 9 && t < 11) a = seg(t, 9, 11); else if (t >= 11 && t < 11.4) a = 1; else if (t >= 11.4) a = lerp(1, 0.25, seg(t, 11.4, 12.6));
    cMid.cells.forEach((c, i) => c.setAttribute('fill', mix(baseCol(W0[i]), rlCol(W1[i]), a)));
    formula.setAttribute('opacity', win(t, 7.8, 15.4, 0.6));
    slider.setAttribute('opacity', win(t, 8.2, 15.4, 0.6));
    const kx = lerp(SX0, SX1, a);
    set(knob, { cx: kx }); set(fill, { x2: kx }); set(knobTxt, { x: kx }); knobTxt.textContent = `α = ${a.toFixed(2)}`;
    ticks.forEach(({ dot, t: tt }, i) => { const on = Math.abs(a - ALPHAS[i]) < 0.02; dot.setAttribute('r', on ? 9 : 6); tt.setAttribute('fill', on ? COL.ink : COL.muted); tt.setAttribute('font-weight', on ? 700 : 400); });

    // chapter 3
    const c3 = win(t, 15.4, 24, 0.6);
    tok.setAttribute('opacity', c3);
    const g01 = seg(t, 15.8, 16.9), aa = 0.5 * seg(t, 17.2, 18.8), gm = seg(t, 17.0, 17.4), TT = lerp(1, 2, seg(t, 20.2, 21.8)), tm = seg(t, 20.0, 20.4);
    const vals = [P0, P1, geo(aa), temp(TT)];
    const vis = [g01, g01, gm, tm];
    bars.forEach((bs, g) => bs.forEach(({ rect, t: tt }, j) => {
      const h = vals[j][g] * BH * vis[j];
      set(rect, { y: BY - h, height: h });
      set(tt, { y: BY - h - 10, opacity: vis[j] > 0.95 ? 1 : 0 });
      tt.textContent = vals[j][g] < 0.1 ? vals[j][g].toFixed(3).replace(/0$/, '') : vals[j][g].toFixed(2);
    }));
    tokFormula.setAttribute('opacity', seg(t, 17.0, 17.6));
    tokA.setAttribute('opacity', gm); tokA.textContent = `α = ${aa.toFixed(2)}`;
    tokT.setAttribute('opacity', tm); tokT.textContent = `T = ${TT.toFixed(2)}`;
    hiB.setAttribute('opacity', win(t, 18.6, 20.4, 0.5));
    hiD.setAttribute('opacity', seg(t, 21.4, 22) * c3);

    // chapter 4
    pk.setAttribute('opacity', win(t, 24.4, TOTAL, 0.6));
    clipR.setAttribute('width', (PX1 - PX0 + 40) * seg(t, 24.8, 27.6));
    startLab.setAttribute('opacity', seg(t, 25.2, 25.8));
    endLab.setAttribute('opacity', seg(t, 27.4, 28));
    ann.setAttribute('opacity', seg(t, 28.6, 29.4));

    // caption
    const ci = CAPTIONS.findIndex(([a0, b0]) => t >= a0 && t < b0);
    if (ci !== capNow) { capNow = ci; cap.innerHTML = ci >= 0 ? CAPTIONS[ci][2] : ''; }
    cap.style.opacity = ci >= 0 ? win(t, CAPTIONS[ci][0], CAPTIONS[ci][1], 0.3) : 0;

    // chrome
    bar.style.width = (t / TOTAL * 100) + '%';
    const ch = CH.reduce((acc, s, i) => (t >= s ? i : acc), 0);
    chapterBtns.forEach((b, i) => b.setAttribute('aria-selected', i === ch));
  }

  /* ---------- clock ---------- */
  let t = 0, prev = null, paused = false, visible = true;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tick(now) {
    if (prev != null && !paused && visible) { t += Math.min(0.1, (now - prev) / 1000); if (t >= TOTAL) t = 0; render(t); }
    prev = now;
    requestAnimationFrame(tick);
  }
  function setPaused(p) { paused = p; frame.classList.toggle('is-paused', p); }
  frame.addEventListener('click', () => setPaused(!paused));
  chapterBtns.forEach((b, i) => b.addEventListener('click', () => { t = CH[i] + 0.01; render(t); setPaused(false); }));
  progress.addEventListener('click', (e) => { const r0 = progress.getBoundingClientRect(); t = clamp((e.clientX - r0.left) / r0.width) * TOTAL; render(t); });
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.15 }).observe(frame);
  window.teaserSeek = (s) => { t = s; render(t); setPaused(true); };   // for inspecting single frames
  if (reduce) { t = CH[1] + 7.5; setPaused(true); }
  render(t);
  requestAnimationFrame(tick);
})();
