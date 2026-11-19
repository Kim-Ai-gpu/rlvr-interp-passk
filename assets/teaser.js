/* Teaser: a scripted SVG explainer. render(t) is a pure function of time, so chapters and the progress bar can seek.
   Two layouts: landscape (1600x900) and portrait (900x1040, phones). The scene is rebuilt when the layout changes. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('stage');
  const frame = document.getElementById('frame');
  const bar = document.getElementById('bar');
  const progress = document.getElementById('progress');
  const chapterBtns = [...document.querySelectorAll('.chapters button')];
  const D = window.PAPER_DATA;
  const MQ = window.matchMedia('(max-width: 640px)');

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

  /* ---------- static data shared by both layouts ---------- */
  const N = 7, CELL = 34, GAP = 4, GW = N * CELL + (N - 1) * GAP;
  const r = rng(7);
  const W0 = [], W1 = [];
  for (let i = 0; i < N * N; i++) { const b = r(); W0.push(b); W1.push(clamp(b * 0.5 + r() * 0.5)); }
  const baseCol = (v) => mix('#e3eefc', COL.a0, v);
  const rlCol = (v) => mix('#4d82c9', COL.a100, v);
  // chapter 1 uses real samples (stage 2) of one MATH500 problem, exported by site/build_data.py
  const EXP = D.explorer.problems.find((p) => p.teaser);
  const EXCOL = ['#2E7D3A', '#C8642A', '#8e8e93', '#c9b79c', '#a7b4c2', '#d6cfc4', '#ececef'];
  const EXTOP = EXP.models.zoo.counts.reduce((b, v, j) => (j > 0 && v > b[1] ? [j, v] : b), [1, -1]);   // [category, count]
  CAPTIONS[1][2] = `On a hard MATH500 problem, RLVR answers ${EXP.cats[EXTOP[0]].label} in ${EXTOP[1]} of 128 samples; ` +
    `the base model finds the right answer, ${EXP.cats[0].label}, ${EXP.models.base.c} times.`;
  const ALPHAS = [0, 0.25, 0.5, 0.75, 1], ACOL = [COL.a0, COL.a25, COL.a50, COL.a75, COL.a100];
  const P0 = [0.59, 0.40, 0.01], P1 = [0.98, 0.01, 0.01];
  const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return v.map((x) => x / s); };
  const geo = (a) => norm(P0.map((p, i) => p ** (1 - a) * P1[i] ** a));
  const temp = (T) => norm(P1.map((p) => p ** (1 / T)));
  const M = D.passk.minerva_math;

  /* ---------- layouts ---------- */
  const LAND = {
    vb: '0 0 1600 900', f: 1,
    c1: { base: [420, 230], rl: [1180, 230], s: 0.9 },
    c2: { base: [300, 360], rl: [1300, 360], mid: [800, 360], s: 0.82, sMid: 0.82 },
    cardFont: [30, 22], cardText: true,
    arrow: { x0: 600, x1: 1000, y: 230, label: [['RLVR training', 795, 210]] },
    samp: { titleY: 506, titles: ['128 samples on one MATH500 problem', '128 samples on the same problem'], verdictY: 540, fs: 22,
      cols: 16, gap: 22, r: 8, gridY: 572 },
    formula: { x: 800, y: 112, size: 50 },
    extLabels: false,
    slider: { x0: 560, x1: 1040, y: 690, tickFont: 22, knobFont: 26 },
    tok: { BY: 700, BH: 430, BW: 58, BG: 12, GX: [470, 800, 1130], hiW: 320, axis: [300, 1300], letter: 46, descFont: 20,
      desc: ['both models like it', 'base likes it, RLVR removed it', 'neither model supports it'], valFont: 19,
      legend: { x: 300, y: 150, dx: [0, 130, 280, 520], dy: [0, 0, 0, 0], font: 21 },
      formula: { x: 1300, y: 95, size: 42, anchor: 'end' }, aRead: [1300, 150, 'end'], tRead: [1300, 182, 'end'], readFont: 22 },
    pk: { X0: 300, X1: 1280, Y0: 700, Y1: 140, tick: 20, title: 22, yTitleX: 230, endInside: false, box: [330, 150, 290, 22] },
  };
  const PORT = {
    vb: '0 0 900 1040', f: 1.3,
    c1: { base: [225, 300], rl: [675, 300], s: 0.82 },
    c2: { base: [150, 410], rl: [750, 410], mid: [450, 410], s: 0.52, sMid: 0.74 },
    cardFont: [40, 30], cardText: true,
    arrow: { x0: 372, x1: 528, y: 300, label: [['RLVR', 450, 246], ['training', 450, 280]] },
    samp: { titleY: 560, titles: ['128 samples, MATH500 #204', '128 samples, same problem'], verdictY: 600, fs: 24,
      cols: 16, gap: 25, r: 9.5, gridY: 636 },
    formula: { x: 450, y: 120, size: 42 },
    extLabels: true,
    slider: { x0: 150, x1: 750, y: 760, tickFont: 28, knobFont: 34 },
    tok: { BY: 780, BH: 440, BW: 52, BG: 10, GX: [170, 450, 730], hiW: 262, axis: [40, 860], letter: 54, descFont: 25,
      desc: ['both models', 'base only', 'neither model'], valFont: 22,
      legend: { x: 70, y: 196, dx: [0, 0, 420, 420], dy: [0, 40, 0, 40], font: 26 },
      formula: { x: 450, y: 92, size: 46, anchor: 'middle' }, aRead: [300, 146, 'middle'], tRead: [600, 146, 'middle'], readFont: 30 },
    pk: { X0: 150, X1: 830, Y0: 770, Y1: 170, tick: 25, title: 27, yTitleX: 62, endInside: true, box: [175, 200, 300, 27] },
  };

  let L, S;   // current layout, scene nodes

  function build() {
    L = MQ.matches ? PORT : LAND;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', L.vb);
    const f = L.f;
    S = {};

    /* ===== chapter 1 + 2: model cards ===== */
    function card(name, sub) {
      const g = el('g', {});
      el('rect', { x: -160, y: -160, width: 320, height: 320, rx: 22, fill: '#fff', stroke: COL.line, 'stroke-width': 2 }, g);
      const cells = [];
      for (let i = 0; i < N * N; i++) {
        const x = -GW / 2 + (i % N) * (CELL + GAP), y = -GW / 2 + Math.floor(i / N) * (CELL + GAP);
        cells.push(el('rect', { x, y, width: CELL, height: CELL, rx: 6 }, g));
      }
      const txt = el('g', {}, g);
      label(txt, 0, 160 + L.cardFont[0] * 1.5, name, { 'font-size': L.cardFont[0], fill: COL.ink, 'font-weight': 700 });
      label(txt, 0, 160 + L.cardFont[0] * 1.5 + L.cardFont[1] * 1.45, sub, { 'font-size': L.cardFont[1] });
      return { g, cells, txt };
    }
    S.cBase = card('Base model', 'Qwen2.5-7B');
    S.cRL = card('RLVR policy', 'SimpleRL-Zoo-7B');
    S.cMid = card('', '');
    S.cBase.cells.forEach((c, i) => c.setAttribute('fill', baseCol(W0[i])));
    S.cRL.cells.forEach((c, i) => c.setAttribute('fill', rlCol(W1[i])));
    if (!L.extLabels) {
      math(S.cMid.txt, 0, 210, 40, [['W', 'i'], ['(', 'r'], ['α', 'i'], [')', 'r']], { 'text-anchor': 'middle' });
      label(S.cMid.txt, 0, 244, 'one model', { 'font-size': 22 });
      S.tagBase = label(S.cBase.g, 0, -184, 'α = 0', { 'font-size': 32, class: 'serif', 'font-style': 'italic', fill: COL.ink });
      S.tagRL = label(S.cRL.g, 0, -184, 'α = 1', { 'font-size': 32, class: 'serif', 'font-style': 'italic', fill: COL.ink });
    } else {
      // portrait: labels outside the (small) cards so they keep a readable size
      const c2 = L.c2, below = c2.mid[1] + 160 * c2.sMid + 46, above = c2.mid[1] - 160 * c2.sMid - 26;
      S.ext = el('g', {});
      label(S.ext, c2.base[0], below, 'Base', { 'font-size': 32, fill: COL.ink, 'font-weight': 700 });
      label(S.ext, c2.rl[0], below, 'RLVR', { 'font-size': 32, fill: COL.ink, 'font-weight': 700 });
      math(S.ext, c2.mid[0], below + 4, 40, [['W', 'i'], ['(', 'r'], ['α', 'i'], [')', 'r']], { 'text-anchor': 'middle' });
      label(S.ext, c2.mid[0], below + 40, 'one model', { 'font-size': 26 });
      S.tagBase = label(S.ext, c2.base[0], above + 20, 'α = 0', { 'font-size': 36, class: 'serif', 'font-style': 'italic', fill: COL.ink });
      S.tagRL = label(S.ext, c2.rl[0], above + 20, 'α = 1', { 'font-size': 36, class: 'serif', 'font-style': 'italic', fill: COL.ink });
    }

    // ch1: training arrow
    const A = L.arrow;
    S.arrow = el('g', {});
    S.arrowLen = A.x1 - A.x0 - 10;
    S.arrowLine = el('path', { d: `M ${A.x0} ${A.y} L ${A.x1 - 10} ${A.y}`, stroke: COL.muted, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-dasharray': S.arrowLen, 'stroke-dashoffset': S.arrowLen }, S.arrow);
    S.arrowHead = el('path', { d: `M ${A.x1 - 25} ${A.y - 14} L ${A.x1} ${A.y} L ${A.x1 - 25} ${A.y + 14}`, stroke: COL.muted, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, S.arrow);
    S.arrowTxt = el('g', {}, S.arrow);
    A.label.forEach(([s, x, y]) => label(S.arrowTxt, x, y, s, { 'font-size': 26 * (f > 1 ? 1.15 : 1), fill: COL.ink }));

    // ch1: sampled answers
    const SP = L.samp;
    S.samples = el('g', {});
    // 128 real samples per model as a 16 x 8 grid of dots, one color per distinct final answer (green = correct)
    function dots(cx, seq) {
      const w = (SP.cols - 1) * SP.gap;
      return seq.map((cat, i) => el('circle', { cx: cx - w / 2 + (i % SP.cols) * SP.gap, cy: SP.gridY + Math.floor(i / SP.cols) * SP.gap, r: SP.r,
        fill: EXCOL[cat], stroke: cat >= 3 ? '#d4d4d8' : 'none', 'stroke-width': 1 }, S.samples));
    }
    const cxB = L.c1.base[0], cxR = L.c1.rl[0];
    const mb = EXP.models.base, mz = EXP.models.zoo;
    S.sampTitles = [label(S.samples, cxB, SP.titleY, SP.titles[0], { 'font-size': SP.fs, fill: COL.ink }), label(S.samples, cxR, SP.titleY, SP.titles[1], { 'font-size': SP.fs, fill: COL.ink })];
    S.chipsB = dots(cxB, mb.seq); S.chipsR = dots(cxR, mz.seq);
    S.verdicts = [label(S.samples, cxB, SP.verdictY, `${mb.c} correct · ${mb.distinct} different answers`, { 'font-size': SP.fs, fill: COL.good, 'font-weight': 700 }),
      label(S.samples, cxR, SP.verdictY, `0 correct · ${EXTOP[1]} of 128 say ${EXP.cats[EXTOP[0]].label}`, { 'font-size': SP.fs, fill: COL.warm, 'font-weight': 700 })];

    // ch2: formula + slider
    const F = L.formula;
    S.formula = math(svg, F.x, F.y, F.size, [['W', 'i'], ['(', 'r'], ['α', 'i'], [') = ', 'r'], ['W', 'i'], ['base', 'sub'], [' + ', 'r'], ['α', 'i'],
      [' (', 'r'], ['W', 'i'], ['RL', 'sub'], [' − ', 'r'], ['W', 'i'], ['base', 'sub'], [')', 'r']], { 'text-anchor': 'middle' });
    const SL = L.slider;
    S.slider = el('g', {});
    el('line', { x1: SL.x0, x2: SL.x1, y1: SL.y, y2: SL.y, stroke: COL.line, 'stroke-width': 8, 'stroke-linecap': 'round' }, S.slider);
    S.fill = el('line', { x1: SL.x0, x2: SL.x0, y1: SL.y, y2: SL.y, stroke: COL.a50, 'stroke-width': 8, 'stroke-linecap': 'round' }, S.slider);
    S.ticks = ALPHAS.map((a, i) => {
      const x = lerp(SL.x0, SL.x1, a);
      const dot = el('circle', { cx: x, cy: SL.y, r: 6, fill: '#fff', stroke: ACOL[i], 'stroke-width': 3 }, S.slider);
      const t = label(S.slider, x, SL.y + SL.tickFont * 2.1, String(a), { 'font-size': SL.tickFont });
      return { dot, t };
    });
    S.knob = el('circle', { cx: SL.x0, cy: SL.y, r: 17, fill: '#fff', stroke: COL.a50, 'stroke-width': 5 }, S.slider);
    S.knobTxt = label(S.slider, SL.x0, SL.y - 34, '', { 'font-size': SL.knobFont, class: 'serif', 'font-style': 'italic', fill: COL.ink });

    /* ===== chapter 3: token bars ===== */
    const T = L.tok;
    S.tok = el('g', {});
    S.hiB = el('rect', { x: T.GX[1] - T.hiW / 2, y: T.BY - T.BH - 20, width: T.hiW, height: T.BH + T.descFont * 4.8, rx: 18, fill: '#eef4fc', opacity: 0 }, S.tok);
    S.hiD = el('rect', { x: T.GX[2] - T.hiW / 2, y: T.BY - T.BH - 20, width: T.hiW, height: T.BH + T.descFont * 4.8, rx: 18, fill: '#fbeee6', opacity: 0 }, S.tok);
    el('line', { x1: T.axis[0], x2: T.axis[1], y1: T.BY, y2: T.BY, stroke: '#c7c7cc', 'stroke-width': 2 }, S.tok);
    const BCOL = [COL.a0, COL.a100, COL.a50, COL.warm];
    S.bars = ['A', 'B', 'D'].map((name, g) => {
      const gx = T.GX[g], x0 = gx - (4 * T.BW + 3 * T.BG) / 2;
      const bs = BCOL.map((c, j) => {
        const rect = el('rect', { x: x0 + j * (T.BW + T.BG), y: T.BY, width: T.BW, height: 0, rx: 5, fill: c }, S.tok);
        const t = el('text', { x: x0 + j * (T.BW + T.BG) + T.BW / 2, y: T.BY - 8, 'text-anchor': 'middle', 'font-size': T.valFont, fill: COL.ink, opacity: 0 }, S.tok);
        return { rect, t };
      });
      math(S.tok, gx, T.BY + T.letter * 1.12, T.letter, [[name, 'i']], { 'text-anchor': 'middle' });
      label(S.tok, gx, T.BY + T.letter * 1.12 + T.descFont * 1.6, T.desc[g], { 'font-size': T.descFont });
      return bs;
    });
    const LG = T.legend;
    const lg = el('g', { transform: `translate(${LG.x}, ${LG.y})` }, S.tok);
    [['Base', COL.a0], ['RLVR', COL.a100], ['Interpolated (α)', COL.a50], ['RLVR at temperature T', COL.warm]].forEach(([s, c], i) => {
      const g = el('g', { transform: `translate(${LG.dx[i]}, ${LG.dy[i]})` }, lg);
      el('rect', { x: 0, y: -LG.font * 0.76, width: LG.font * 0.95, height: LG.font * 0.95, rx: 4, fill: c }, g);
      const tt = el('text', { x: LG.font * 1.4, y: 1, 'font-size': LG.font, fill: COL.muted }, g); tt.textContent = s;
    });
    const TF = T.formula;
    S.tokFormula = math(S.tok, TF.x, TF.y, TF.size, [['π', 'i'], ['α', 'subi'], [' ∝ ', 'r'], ['π', 'i'], ['0', 'sub'], ['1−α', 'supi'], [' ', 'r'], ['π', 'i'], ['1', 'sub'], ['α', 'supi']], { 'text-anchor': TF.anchor });
    S.tokA = label(S.tok, T.aRead[0], T.aRead[1], '', { 'font-size': T.readFont, 'text-anchor': T.aRead[2], class: 'serif', 'font-style': 'italic', fill: COL.a50 });
    S.tokT = label(S.tok, T.tRead[0], T.tRead[1], '', { 'font-size': T.readFont, 'text-anchor': T.tRead[2], class: 'serif', 'font-style': 'italic', fill: COL.warm });

    /* ===== chapter 4: pass@k curves (measured, Minerva) ===== */
    const K = L.pk;
    S.pk = el('g', {});
    const YMIN = 20, YMAX = 70;
    const px = (k) => K.X0 + Math.log2(k) / 7 * (K.X1 - K.X0);
    const py = (v) => K.Y0 - (v - YMIN) / (YMAX - YMIN) * (K.Y0 - K.Y1);
    for (let v = 20; v <= 70; v += 10) {
      el('line', { x1: K.X0, x2: K.X1, y1: py(v), y2: py(v), stroke: '#efeff1', 'stroke-width': 2 }, S.pk);
      label(S.pk, K.X0 - 16, py(v) + K.tick * 0.35, String(v), { 'font-size': K.tick, 'text-anchor': 'end', fill: COL.faint });
    }
    M.k.forEach((k) => label(S.pk, px(k), K.Y0 + K.tick * 1.7, String(k), { 'font-size': K.tick, fill: COL.faint }));
    label(S.pk, (K.X0 + K.X1) / 2, K.Y0 + K.tick * 1.7 + K.title * 1.8, 'samples per problem, k', { 'font-size': K.title });
    label(S.pk, K.yTitleX, (K.Y0 + K.Y1) / 2, 'pass@k on Minerva (%)', { 'font-size': K.title, transform: `rotate(-90 ${K.yTitleX} ${(K.Y0 + K.Y1) / 2})` });
    const clip = el('clipPath', { id: 'pkclip' }, el('defs', {}, S.pk));
    S.clipR = el('rect', { x: K.X0 - 20, y: 0, width: 0, height: 1100 }, clip);
    S.pkW = K.X1 - K.X0 + 40;
    const curveG = el('g', { 'clip-path': 'url(#pkclip)' }, S.pk);
    const path = (arr) => M.k.map((k, i) => `${i ? 'L' : 'M'} ${px(k).toFixed(1)} ${py(arr[i]).toFixed(1)}`).join(' ');
    [['base', COL.a0, '10 9', 4], ['zoo', COL.a100, '10 9', 4], ['a25', COL.a25, '', 6]].forEach(([key, c, dash, w]) => {
      el('path', { d: path(M[key]), stroke: c, 'stroke-width': w, fill: 'none', 'stroke-dasharray': dash, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, curveG);
      M.k.forEach((k, i) => el('circle', { cx: px(k), cy: py(M[key][i]), r: key === 'a25' ? 7 : 5.5, fill: c, stroke: '#fff', 'stroke-width': 2 }, curveG));
    });
    const last = M.k.length - 1;
    S.endLab = el('g', { opacity: 0 }, S.pk);
    if (K.endInside) {
      label(S.endLab, K.X1, py(M.a25[last]) - 24, `α = 0.25 & base ${fmt(M.a25[last])}`, { 'font-size': K.tick, 'text-anchor': 'end', fill: COL.a25, 'font-weight': 700 });
      label(S.endLab, K.X1, py(M.zoo[last]) + 40, `RLVR ${fmt(M.zoo[last])}`, { 'font-size': K.tick, 'text-anchor': 'end', fill: COL.a100, 'font-weight': 700 });
    } else {
      label(S.endLab, K.X1 + 18, py(M.a25[last]) - 4, `α = 0.25 and base: ${fmt(M.a25[last])}`, { 'font-size': 22, 'text-anchor': 'start', fill: COL.a25, 'font-weight': 700 });
      label(S.endLab, K.X1 + 18, py(M.zoo[last]) + 8, `RLVR: ${fmt(M.zoo[last])}`, { 'font-size': 22, 'text-anchor': 'start', fill: COL.a100, 'font-weight': 700 });
    }
    const [bx, by, bw, bf] = K.box;
    S.startLab = el('g', { opacity: 0, transform: `translate(${bx}, ${by})` }, S.pk);
    el('rect', { x: -14, y: -bf * 1.4, width: bw, height: bf * 6.6, rx: 14, fill: '#fff', stroke: COL.line, 'stroke-width': 2 }, S.startLab);
    label(S.startLab, 0, 0, 'pass@1 (k = 1)', { 'font-size': bf * 0.95, 'text-anchor': 'start', fill: COL.muted });
    [['RLVR', M.zoo[0], COL.a100], ['α = 0.25', M.a25[0], COL.a25], ['Base', M.base[0], COL.a0]].forEach(([n, v, c], i) => {
      const yy = bf * 1.55 + i * bf * 1.45;
      el('circle', { cx: 8, cy: yy - bf * 0.32, r: bf * 0.32, fill: c }, S.startLab);
      label(S.startLab, bf * 1.2, yy, n, { 'font-size': bf, 'text-anchor': 'start', fill: COL.ink });
      label(S.startLab, bw - 40, yy, fmt(v), { 'font-size': bf, 'text-anchor': 'end', fill: COL.ink, 'font-weight': 700 });
    });
    // samples-to-target annotation: alpha 0.25 reaches RLVR pass@128 at k = 18 (paper Table 3)
    const tgt = M.zoo[last], K18 = D.samples.pass128.minerva_math[1];
    S.ann = el('g', { opacity: 0 }, S.pk);
    el('line', { x1: px(1), x2: px(128), y1: py(tgt), y2: py(tgt), stroke: COL.warm, 'stroke-width': 2.5, 'stroke-dasharray': '3 7', 'stroke-linecap': 'round' }, S.ann);
    el('line', { x1: px(K18), x2: px(K18), y1: py(tgt), y2: K.Y0, stroke: COL.a25, 'stroke-width': 2.5, 'stroke-dasharray': '3 7', 'stroke-linecap': 'round' }, S.ann);
    el('circle', { cx: px(K18), cy: py(tgt), r: 10, fill: '#fff', stroke: COL.a25, 'stroke-width': 4 }, S.ann);
    label(S.ann, px(K18) - 14, K.Y0 - 18, `${K18} samples`, { 'font-size': K.tick + 4, fill: COL.a25, 'font-weight': 700, 'text-anchor': 'end' });
    label(S.ann, px(128) - 14, K.Y0 - 18, '128 samples', { 'font-size': K.tick + 4, fill: COL.a100, 'font-weight': 700, 'text-anchor': 'end' });
    capNow = -1;
  }

  /* ---------- render ---------- */
  function render(t) {
    const c1 = L.c1, c2 = L.c2;
    // chapter 1 / 2 cards
    const c12 = 1 - seg(t, 15, 15.6);
    const move = seg(t, 7, 8.2);
    const sc = lerp(c1.s, c2.s, move);
    set(S.cBase.g, { transform: `translate(${lerp(c1.base[0], c2.base[0], move)}, ${lerp(c1.base[1], c2.base[1], move)}) scale(${sc})`, opacity: seg(t, 0, 0.6) * c12 });
    set(S.cRL.g, { transform: `translate(${lerp(c1.rl[0], c2.rl[0], move)}, ${lerp(c1.rl[1], c2.rl[1], move)}) scale(${sc})`, opacity: seg(t, 0.8, 1.6) * c12 });
    set(S.cMid.g, { transform: `translate(${c2.mid[0]}, ${c2.mid[1]}) scale(${lerp(c2.sMid * 0.7, c2.sMid, seg(t, 7.8, 8.6))})`, opacity: seg(t, 7.8, 8.6) * c12 });
    if (L.extLabels) {
      const out = 1 - seg(t, 7, 7.6);
      S.cBase.txt.setAttribute('opacity', out); S.cRL.txt.setAttribute('opacity', out);
      S.ext.setAttribute('opacity', seg(t, 8.2, 8.8) * c12);
    }
    const tagO = seg(t, 11.2, 11.8) * (L.extLabels ? 1 : c12); S.tagBase.setAttribute('opacity', tagO); S.tagRL.setAttribute('opacity', tagO);

    set(S.arrow, { opacity: 1 - seg(t, 6.8, 7.4) });
    S.arrowLine.setAttribute('stroke-dashoffset', S.arrowLen * (1 - seg(t, 0.8, 2.0)));
    S.arrowHead.setAttribute('opacity', seg(t, 1.8, 2.1)); S.arrowTxt.setAttribute('opacity', seg(t, 1.4, 2.2));

    set(S.samples, { opacity: 1 - seg(t, 6.8, 7.4) });
    S.sampTitles.forEach((n) => n.setAttribute('opacity', seg(t, 3.4, 3.9)));
    S.chipsB.forEach((g, i) => g.setAttribute('opacity', seg(t, 3.7 + i * 0.014, 3.9 + i * 0.014)));
    S.chipsR.forEach((g, i) => g.setAttribute('opacity', seg(t, 3.7 + i * 0.014, 3.9 + i * 0.014)));
    S.verdicts.forEach((n) => n.setAttribute('opacity', seg(t, 5.7, 6.1)));

    // alpha path for chapter 2
    let a = 0;
    if (t >= 9 && t < 11) a = seg(t, 9, 11); else if (t >= 11 && t < 11.4) a = 1; else if (t >= 11.4) a = lerp(1, 0.25, seg(t, 11.4, 12.6));
    S.cMid.cells.forEach((c, i) => c.setAttribute('fill', mix(baseCol(W0[i]), rlCol(W1[i]), a)));
    S.formula.setAttribute('opacity', win(t, 7.8, 15.4, 0.6));
    S.slider.setAttribute('opacity', win(t, 8.2, 15.4, 0.6));
    const kx = lerp(L.slider.x0, L.slider.x1, a);
    set(S.knob, { cx: kx }); set(S.fill, { x2: kx }); set(S.knobTxt, { x: kx }); S.knobTxt.textContent = `α = ${a.toFixed(2)}`;
    S.ticks.forEach(({ dot, t: tt }, i) => { const on = Math.abs(a - ALPHAS[i]) < 0.02; dot.setAttribute('r', on ? 9 : 6); tt.setAttribute('fill', on ? COL.ink : COL.muted); tt.setAttribute('font-weight', on ? 700 : 400); });

    // chapter 3
    const T = L.tok, c3 = win(t, 15.4, 24, 0.6);
    S.tok.setAttribute('opacity', c3);
    const g01 = seg(t, 15.8, 16.9), aa = 0.5 * seg(t, 17.2, 18.8), gm = seg(t, 17.0, 17.4), TT = lerp(1, 2, seg(t, 20.2, 21.8)), tm = seg(t, 20.0, 20.4);
    const vals = [P0, P1, geo(aa), temp(TT)], vis = [g01, g01, gm, tm];
    S.bars.forEach((bs, g) => bs.forEach(({ rect, t: tt }, j) => {
      const h = vals[j][g] * T.BH * vis[j];
      set(rect, { y: T.BY - h, height: h });
      set(tt, { y: T.BY - h - 10, opacity: vis[j] > 0.95 ? 1 : 0 });
      tt.textContent = vals[j][g] < 0.1 ? vals[j][g].toFixed(3).replace(/0$/, '') : vals[j][g].toFixed(2);
    }));
    S.tokFormula.setAttribute('opacity', seg(t, 17.0, 17.6));
    S.tokA.setAttribute('opacity', gm); S.tokA.textContent = `α = ${aa.toFixed(2)}`;
    S.tokT.setAttribute('opacity', tm); S.tokT.textContent = `T = ${TT.toFixed(2)}`;
    S.hiB.setAttribute('opacity', win(t, 18.6, 20.4, 0.5));
    S.hiD.setAttribute('opacity', seg(t, 21.4, 22) * c3);

    // chapter 4
    S.pk.setAttribute('opacity', win(t, 24.4, TOTAL, 0.6));
    S.clipR.setAttribute('width', S.pkW * seg(t, 24.8, 27.6));
    S.startLab.setAttribute('opacity', seg(t, 25.2, 25.8));
    S.endLab.setAttribute('opacity', seg(t, 27.4, 28));
    S.ann.setAttribute('opacity', seg(t, 28.6, 29.4));

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
  MQ.addEventListener('change', () => { build(); render(t); });
  window.teaserSeek = (s) => { t = s; render(t); setPaused(true); };   // for inspecting single frames
  build();
  if (reduce) { t = CH[1] + 7.5; setPaused(true); }
  render(t);
  requestAnimationFrame(tick);
})();
