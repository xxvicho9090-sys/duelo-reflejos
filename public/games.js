'use strict';
/* Minijuegos. Cada juego recibe (stage, rand, done) y devuelve una funcion de limpieza.
   El valor que se entrega a done() siempre es entero y "mas alto = mejor".
   rand es un generador con semilla: ambos jugadores reciben exactamente la misma partida. */
(() => {
  const { el, beep, buzz, sleep } = window.DU;
  const GAMES = {};

  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const META = {
    reaction: { title: 'Reflejo', g: ['#8a1f45', '#2a0b17'], how: 'Espera a que la pantalla se ponga VERDE y toca al instante. Si tocas antes, pierdes la ronda.',
      icon: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'), fmt: (v) => (v === 0 ? 'Muy pronto' : `${1000 - v} ms`) },
    aim: { title: 'Puntería', g: ['#43308f', '#140f2d'], how: 'Toca cada blanco antes de que desaparezca. Tienes 10 segundos.',
      icon: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>'), fmt: (v) => `${v} aciertos` },
    tap: { title: 'Toques rápidos', g: ['#85520f', '#24150a'], how: 'Toca el botón tantas veces como puedas durante 5 segundos. Cuenta desde tu primer toque.',
      icon: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>'), fmt: (v) => `${v} toques` },
    memory: { title: 'Memoria', g: ['#17456e', '#0a1a2c'], how: 'Mira la secuencia de colores y repítela. Cada nivel agrega un color más.',
      icon: svg('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>'), fmt: (v) => `${Math.floor(v / 20)} niveles` },
    mole: { title: 'Topos', g: ['#376b30', '#122412'], how: 'Los topos asoman un instante. Tócalos antes de que se escondan. 12 segundos.',
      icon: svg('<path d="M3 20h18"/><path d="M6 20c0-6 2-10 6-10s6 4 6 10"/><path d="M10 14h.01M14 14h.01"/>'), fmt: (v) => `${v} topos` },
    gonogo: { title: 'Semáforo', g: ['#1f4a5e', '#0e1a22'], how: 'Toca cuando la luz sea VERDE. Si es ROJA, aguanta sin tocar. Tocar de más resta puntos.',
      icon: svg('<rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 7h.01M12 12h.01M12 17h.01"/>'), fmt: (v) => `${v} pts` },
    stroop: { title: 'Colores', g: ['#56307d', '#1c1030'], how: 'Toca el botón que dice el COLOR DE LA TINTA, no lo que dice la palabra. 15 segundos.',
      icon: svg('<path d="m4 20 8-16 8 16M7 14h10"/>'), fmt: (v) => `${v} aciertos` },
    math: { title: 'Cálculo', g: ['#14614b', '#0a211a'], how: 'Resuelve las cuentas lo más rápido posible. Un error resta un punto. 20 segundos.',
      icon: svg('<path d="M12 4v8M8 8h8M7 18h10"/>'), fmt: (v) => `${v} correctas` },
    timing: { title: 'Precisión', g: ['#6a3062', '#220e20'], how: 'Toca justo cuando el marcador pase por la zona verde. 5 intentos, cada vez más rápido.',
      icon: svg('<circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 2h6"/>'), fmt: (v) => `${v} pts` },
    odd: { title: 'El diferente', g: ['#40477d', '#15162b'], how: 'Encuentra el cuadro con el tono distinto. Cada acierto lo hace más difícil. 20 segundos.',
      icon: svg('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><circle cx="17.5" cy="17.5" r="3.5"/>'), fmt: (v) => `${v} aciertos` },
    order: { title: 'Números', g: ['#7a431b', '#241209'], how: 'Toca del 1 al 16 en orden, lo más rápido que puedas.',
      icon: svg('<path d="M5 7l3-2v14M13 8a3 3 0 1 1 5 2l-5 8h6"/>'),
      fmt: (v) => (v >= 10000 ? `${((45000 - (v - 10000) * 10) / 1000).toFixed(2)} s` : `${v / 10} de 16`) },
    dodge: { title: 'Esquiva', g: ['#123268', '#080f24'], how: 'Arrastra el dedo para mover tu bolita y esquiva los bloques. Sobrevive 20 segundos.',
      icon: svg('<circle cx="12" cy="18" r="3"/><rect x="5" y="2" width="5" height="5" rx="1"/><rect x="14" y="4" width="5" height="5" rx="1"/>'),
      fmt: (v) => `${(v / 100).toFixed(1)} s` },
  };

  const loop = (fn) => {
    let id; let run = true;
    const f = (t) => { if (!run) return; fn(t); id = requestAnimationFrame(f); };
    id = requestAnimationFrame(f);
    return () => { run = false; cancelAnimationFrame(id); };
  };
  const timebar = (stage, ms) => {
    const bar = el('div', 'timebar');
    stage.append(bar);
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, fill: 'forwards', easing: 'linear' });
    return bar;
  };
  const shake = (node) => { node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); };
  const shuffle = (arr, rand) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  // ---------- Reflejo ----------
  GAMES.reaction = (stage, rand, done) => {
    const wait = 1500 + Math.floor(rand() * 3200);
    let t0 = 0; let green = false; let over = false; let guard;
    stage.classList.add('red');
    const msg = el('div', 'big', 'Espera…');
    stage.append(msg);
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        if (over) return;
        green = true; t0 = performance.now();
        stage.classList.remove('red'); stage.classList.add('green');
        msg.textContent = '¡YA!';
        beep(1000, 0.1, 'square', 0.1);
        guard = setTimeout(() => finish(1), 3000);
      });
    }, wait);
    function finish(v) { if (over) return; over = true; clearTimeout(timer); clearTimeout(guard); done(v); }
    const onDown = () => {
      if (over) return;
      if (!green) { buzz(120); finish(0); return; }
      finish(1000 - Math.min(999, Math.max(1, Math.round(performance.now() - t0))));
    };
    stage.addEventListener('pointerdown', onDown);
    return () => { over = true; clearTimeout(timer); clearTimeout(guard); stage.removeEventListener('pointerdown', onDown); stage.classList.remove('red', 'green'); };
  };

  // ---------- Puntería ----------
  GAMES.aim = (stage, rand, done) => {
    const DURATION = 10000; const LIFE = 1100;
    const spots = Array.from({ length: 80 }, () => [0.1 + rand() * 0.8, 0.14 + rand() * 0.72]);
    let i = 0; let hits = 0; let over = false; let tgtTimer; let cur = null;
    const cnt = el('div', 'counter', '0');
    stage.append(cnt); timebar(stage, DURATION);
    const W = stage.clientWidth; const H = stage.clientHeight;
    function next() {
      if (over) return;
      if (cur) cur.remove();
      const [x, y] = spots[i % spots.length]; i++;
      const t = el('button', 'target in');
      t.style.transform = `translate(${Math.round(x * W)}px, ${Math.round(y * H)}px)`;
      t.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (over || t !== cur) return;
        hits++; cnt.textContent = String(hits); beep(600 + hits * 12, 0.05, 'triangle', 0.1); buzz(15);
        clearTimeout(tgtTimer); next();
      });
      cur = t; stage.append(t);
      tgtTimer = setTimeout(next, LIFE);
    }
    next();
    const end = setTimeout(() => { over = true; clearTimeout(tgtTimer); if (cur) cur.remove(); done(hits); }, DURATION);
    return () => { over = true; clearTimeout(tgtTimer); clearTimeout(end); };
  };

  // ---------- Toques rápidos ----------
  GAMES.tap = (stage, rand, done) => {
    const DURATION = 5000; let n = 0; let started = false; let over = false; let end;
    const cnt = el('div', 'counter', '0');
    const btn = el('button', 'tapbtn', 'TOCA');
    stage.append(cnt, btn);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (over) return;
      btn.classList.add('down');
      if (!started) { started = true; timebar(stage, DURATION); end = setTimeout(() => { over = true; done(n); }, DURATION); }
      n++; cnt.textContent = String(n); buzz(8);
    });
    const up = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
    const guard = setTimeout(() => { if (!started && !over) { over = true; done(0); } }, 15000);
    void rand;
    return () => { over = true; clearTimeout(end); clearTimeout(guard); };
  };

  // ---------- Memoria ----------
  GAMES.memory = (stage, rand, done) => {
    const MAX = 12; const TOTAL_LIMIT = 32000;
    const seq = Array.from({ length: MAX }, () => Math.floor(rand() * 4));
    const FREQ = [262, 330, 392, 523];
    const grid = el('div', 'pads');
    const pads = [0, 1, 2, 3].map((i) => { const p = el('button', 'pad'); p.dataset.i = String(i); grid.append(p); return p; });
    const status = el('div', 'counter', '');
    stage.append(status, grid);
    let level = 1; let pos = 0; let accepting = false; let over = false; let completed = 0; let partial = 0;
    const flash = async (i, ms) => { pads[i].classList.add('on'); beep(FREQ[i], ms / 1000, 'sine', 0.2); await sleep(ms); pads[i].classList.remove('on'); await sleep(160); };
    const limit = setTimeout(() => finish(), TOTAL_LIMIT);
    function finish() { if (over) return; over = true; clearTimeout(limit); done(completed * 20 + partial); }
    async function play() {
      accepting = false; pos = 0; partial = 0;
      status.textContent = 'Mira…';
      await sleep(500);
      for (let k = 0; k < level; k++) { if (over) return; await flash(seq[k], Math.max(240, 460 - level * 20)); }
      if (over) return;
      status.textContent = 'Tu turno';
      accepting = true;
    }
    function onDown(e) {
      const pad = e.target.closest && e.target.closest('.pad');
      if (!pad || !accepting || over) return;
      const i = Number(pad.dataset.i);
      pad.classList.add('on'); beep(FREQ[i], 0.18, 'sine', 0.2);
      setTimeout(() => pad.classList.remove('on'), 140);
      if (i !== seq[pos]) { buzz(150); accepting = false; finish(); return; }
      pos++; partial = Math.min(19, pos);
      if (pos === level) {
        completed = level; partial = 0; accepting = false;
        if (level >= MAX) { finish(); return; }
        level++; play();
      }
    }
    stage.addEventListener('pointerdown', onDown);
    play();
    return () => { over = true; clearTimeout(limit); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Topos ----------
  GAMES.mole = (stage, rand, done) => {
    const DUR = 12000;
    const sched = []; let t = 700;
    while (t < DUR - 600) { sched.push({ t, h: Math.floor(rand() * 9), life: 650 + Math.floor(rand() * 450) }); t += 420 + Math.floor(rand() * 260); }
    const wrap = el('div', 'holes');
    const holes = Array.from({ length: 9 }, () => { const h = el('div', 'hole'); h.append(el('div', 'mole')); wrap.append(h); return { node: h, up: false, exp: 0 }; });
    const cnt = el('div', 'counter', '0');
    stage.append(cnt, wrap); timebar(stage, DUR);
    let hits = 0; let k = 0; let over = false;
    const start = performance.now();
    const stopLoop = loop(() => {
      const now = performance.now() - start;
      while (k < sched.length && sched[k].t <= now) { const s = sched[k++]; const h = holes[s.h]; if (!h.up) { h.up = true; h.exp = now + s.life; h.node.classList.add('up'); } }
      for (const h of holes) if (h.up && now > h.exp) { h.up = false; h.node.classList.remove('up'); }
    });
    const onDown = (e) => {
      const node = e.target.closest && e.target.closest('.hole');
      if (!node || over) return;
      const h = holes.find((x) => x.node === node);
      if (!h || !h.up) return;
      h.up = false; hits++; cnt.textContent = String(hits); buzz(15); beep(500 + hits * 20, 0.05, 'triangle', 0.12);
      node.classList.add('hit'); setTimeout(() => { node.classList.remove('up', 'hit'); }, 90);
    };
    stage.addEventListener('pointerdown', onDown);
    const end = setTimeout(() => { over = true; stopLoop(); done(hits); }, DUR);
    return () => { over = true; stopLoop(); clearTimeout(end); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Semáforo ----------
  GAMES.gonogo = (stage, rand, done) => {
    const N = 14; const WINDOW = 800;
    const seq = Array.from({ length: N }, () => ({ go: rand() < 0.68, gap: 350 + Math.floor(rand() * 450) }));
    const lamp = el('div', 'lamp');
    const cnt = el('div', 'counter', '0');
    stage.append(cnt, lamp, el('div', 'hint', 'Toca en VERDE · no toques en ROJO'));
    let i = 0; let pts = 0; let cur = null; let over = false; let t1; let t2;
    const show = () => { cnt.textContent = String(Math.max(0, pts)); };
    function next() {
      if (over) return;
      if (i >= N) { over = true; done(Math.max(0, pts)); return; }
      const s = seq[i++];
      t1 = setTimeout(() => {
        requestAnimationFrame(() => {
          if (over) return;
          cur = { go: s.go, t0: performance.now(), tapped: false };
          lamp.className = 'lamp ' + (s.go ? 'go' : 'no');
          t2 = setTimeout(() => {
            if (cur && !cur.go && !cur.tapped) { pts += 20; show(); }
            cur = null; lamp.className = 'lamp'; next();
          }, WINDOW);
        });
      }, s.gap);
    }
    const onDown = () => {
      if (over) return;
      if (!cur) { pts -= 30; show(); buzz(60); stage.classList.remove('flash-bad'); void stage.offsetWidth; stage.classList.add('flash-bad'); return; }
      if (cur.tapped) return;
      cur.tapped = true;
      if (cur.go) { pts += Math.max(30, 100 - Math.floor((performance.now() - cur.t0) / 10)); beep(740, 0.05, 'triangle', 0.1); buzz(10); }
      else { pts -= 80; buzz(120); stage.classList.remove('flash-bad'); void stage.offsetWidth; stage.classList.add('flash-bad'); }
      show(); lamp.className = 'lamp';
    };
    stage.addEventListener('pointerdown', onDown);
    next();
    return () => { over = true; clearTimeout(t1); clearTimeout(t2); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Colores (Stroop) ----------
  GAMES.stroop = (stage, rand, done) => {
    const DUR = 15000;
    const names = ['ROJO', 'AZUL', 'VERDE', 'AMARILLO'];
    const inks = ['#ff5d73', '#5aa9ff', '#7be495', '#ffd166'];
    const qs = Array.from({ length: 80 }, () => { const w = Math.floor(rand() * 4); let c = w; if (rand() < 0.75) c = (w + 1 + Math.floor(rand() * 3)) % 4; return { w, c }; });
    const col = el('div', 'col');
    const word = el('div', 'word'); const opts = el('div', 'opts');
    names.forEach((n, i) => { const b = el('button', 'opt', n); b.dataset.i = String(i); opts.append(b); });
    col.append(word, opts);
    const cnt = el('div', 'counter', '0');
    stage.append(cnt, col); timebar(stage, DUR);
    let i = 0; let score = 0; let over = false;
    const render = () => { const q = qs[i % qs.length]; word.textContent = names[q.w]; word.style.color = inks[q.c]; };
    render();
    const onDown = (e) => {
      const b = e.target.closest && e.target.closest('.opt');
      if (!b || over) return;
      const q = qs[i % qs.length];
      if (Number(b.dataset.i) === q.c) { score++; buzz(8); beep(660, 0.04, 'triangle', 0.1); }
      else { score = Math.max(0, score - 1); buzz(80); shake(word); }
      cnt.textContent = String(score); i++; render();
    };
    stage.addEventListener('pointerdown', onDown);
    const end = setTimeout(() => { over = true; done(score); }, DUR);
    return () => { over = true; clearTimeout(end); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Cálculo ----------
  GAMES.math = (stage, rand, done) => {
    const DUR = 20000;
    const qs = Array.from({ length: 70 }, () => {
      const op = ['+', '−', '×'][Math.floor(rand() * 3)]; let a; let b; let ans;
      if (op === '+') { a = 3 + Math.floor(rand() * 40); b = 3 + Math.floor(rand() * 40); ans = a + b; }
      else if (op === '−') { a = 10 + Math.floor(rand() * 50); b = 2 + Math.floor(rand() * (a - 3)); ans = a - b; }
      else { a = 2 + Math.floor(rand() * 8); b = 2 + Math.floor(rand() * 8); ans = a * b; }
      const set = new Set([ans]);
      while (set.size < 4) { const d = 1 + Math.floor(rand() * 5); const v = ans + (rand() < 0.5 ? -d : d); if (v >= 0) set.add(v); }
      return { text: `${a} ${op} ${b}`, ans, opts: shuffle([...set], rand) };
    });
    const col = el('div', 'col'); const word = el('div', 'word'); const opts = el('div', 'opts');
    const btns = [0, 1, 2, 3].map(() => { const b = el('button', 'opt'); opts.append(b); return b; });
    col.append(word, opts);
    const cnt = el('div', 'counter', '0');
    stage.append(cnt, col); timebar(stage, DUR);
    let i = 0; let score = 0; let over = false;
    const render = () => { const q = qs[i % qs.length]; word.textContent = q.text; btns.forEach((b, k) => { b.textContent = String(q.opts[k]); b.dataset.v = String(q.opts[k]); }); };
    render();
    const onDown = (e) => {
      const b = e.target.closest && e.target.closest('.opt');
      if (!b || over) return;
      const q = qs[i % qs.length];
      if (Number(b.dataset.v) === q.ans) { score++; buzz(8); beep(660, 0.04, 'triangle', 0.1); }
      else { score = Math.max(0, score - 1); buzz(80); shake(word); }
      cnt.textContent = String(score); i++; render();
    };
    stage.addEventListener('pointerdown', onDown);
    const end = setTimeout(() => { over = true; done(score); }, DUR);
    return () => { over = true; clearTimeout(end); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Precisión ----------
  GAMES.timing = (stage, rand, done) => {
    const periods = [1700, 1500, 1350, 1200, 1050];
    const zoneW = 0.14;
    const centers = periods.map(() => 0.22 + rand() * 0.56);
    const track = el('div', 'track'); const zone = el('div', 'zone'); const marker = el('div', 'marker');
    track.append(zone, marker);
    const shots = el('div', 'shots');
    const cnt = el('div', 'counter', '0');
    const tapzone = el('div', 'tapzone');
    const col = el('div', 'col'); col.append(track, shots);
    stage.append(cnt, col, tapzone, el('div', 'hint', 'Toca cuando el marcador esté en la zona verde'));
    let a = 0; let total = 0; let over = false; let t0 = 0; let waiting = false; let guard;
    let tw = 0;
    const place = () => {
      zone.style.left = ((centers[a] - zoneW / 2) * 100) + '%'; zone.style.width = (zoneW * 100) + '%';
      marker.style.transform = 'translateX(0px)'; tw = track.clientWidth;
    };
    const pos = (now) => { const f = ((now - t0) / periods[a]) % 1; return 1 - Math.abs(2 * f - 1); };
    const begin = () => { place(); t0 = performance.now(); waiting = false; clearTimeout(guard); guard = setTimeout(() => commit(0), 8000); };
    function commit(pts) {
      if (over || waiting) return;
      waiting = true; clearTimeout(guard);
      total += pts; cnt.textContent = String(total);
      const chip = el('span', '', String(pts)); shots.append(chip);
      a++;
      if (a >= periods.length) { over = true; setTimeout(() => done(total), 500); return; }
      setTimeout(begin, 650);
    }
    const stopLoop = loop((now) => { if (over || waiting) return; marker.style.transform = `translateX(${(pos(performance.now()) * tw).toFixed(1)}px)`; void now; });
    const onDown = () => {
      if (over || waiting) return;
      const d = Math.abs(pos(performance.now()) - centers[a]); const half = zoneW / 2;
      const pts = d <= half ? 60 + Math.round(40 * (1 - d / half)) : Math.max(0, Math.round(60 * (1 - (d - half) / 0.25)));
      if (pts >= 60) { beep(880, 0.08, 'triangle', 0.12); buzz(20); } else buzz(40);
      commit(pts);
    };
    stage.addEventListener('pointerdown', onDown);
    requestAnimationFrame(begin);
    return () => { over = true; stopLoop(); clearTimeout(guard); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- El diferente ----------
  GAMES.odd = (stage, rand, done) => {
    const DUR = 20000; const sizes = [3, 3, 4, 4, 5, 5, 6, 6];
    const levels = Array.from({ length: 80 }, (_, L) => {
      const n = sizes[Math.min(L, sizes.length - 1)]; const hue = Math.floor(rand() * 360);
      const d = Math.max(4, 20 - L * 1.4); const light = 52 + (rand() < 0.5 ? -d : d);
      return { n, hue, light, at: Math.floor(rand() * n * n) };
    });
    const grid = el('div', 'odd'); const cnt = el('div', 'counter', '0');
    stage.append(cnt, grid); timebar(stage, DUR);
    let L = 0; let score = 0; let over = false; let lock = false;
    function build() {
      const q = levels[L]; grid.textContent = ''; grid.style.gridTemplateColumns = `repeat(${q.n}, 1fr)`;
      for (let k = 0; k < q.n * q.n; k++) {
        const t = el('button', 'tile'); t.dataset.k = String(k);
        t.style.background = `hsl(${q.hue} 62% ${k === q.at ? q.light : 52}%)`;
        grid.append(t);
      }
    }
    build();
    const onDown = (e) => {
      const t = e.target.closest && e.target.closest('.tile');
      if (!t || over || lock) return;
      if (Number(t.dataset.k) === levels[L].at) { score++; L++; cnt.textContent = String(score); buzz(10); beep(500 + score * 25, 0.05, 'triangle', 0.1); build(); }
      else { buzz(80); shake(grid); lock = true; setTimeout(() => { lock = false; }, 450); }
    };
    stage.addEventListener('pointerdown', onDown);
    const end = setTimeout(() => { over = true; done(score); }, DUR);
    return () => { over = true; clearTimeout(end); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Números ----------
  GAMES.order = (stage, rand, done) => {
    const LIMIT = 35000;
    const nums = shuffle(Array.from({ length: 16 }, (_, i) => i + 1), rand);
    const grid = el('div', 'nums'); const nextEl = el('div', 'nextnum', 'Busca el 1'); const cnt = el('div', 'counter', '0.0 s');
    nums.forEach((n) => { const b = el('button', 'num-t', String(n)); b.dataset.n = String(n); grid.append(b); });
    stage.append(nextEl, cnt, grid);
    let next = 1; let over = false; const t0 = performance.now();
    const stopLoop = loop(() => { cnt.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; });
    function finish(v) { if (over) return; over = true; stopLoop(); clearTimeout(end); done(v); }
    const onDown = (e) => {
      const b = e.target.closest && e.target.closest('.num-t');
      if (!b || over) return;
      if (Number(b.dataset.n) === next) {
        b.classList.add('ok'); next++; buzz(8); beep(400 + next * 30, 0.04, 'triangle', 0.1);
        if (next > 16) { const ms = Math.min(44999, Math.round(performance.now() - t0)); finish(10000 + Math.round((45000 - ms) / 10)); return; }
        nextEl.textContent = `Busca el ${next}`;
      } else { buzz(60); shake(b); }
    };
    stage.addEventListener('pointerdown', onDown);
    const end = setTimeout(() => finish((next - 1) * 10), LIMIT);
    return () => { over = true; stopLoop(); clearTimeout(end); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Esquiva ----------
  GAMES.dodge = (stage, rand, done) => {
    const DUR = 20000; const BH = 0.045;
    const spawns = []; let t = 500;
    while (t < DUR - 500) {
      spawns.push({ t, x: 0.08 + rand() * 0.84, w: 0.14 + rand() * 0.16, v: 0.42 + rand() * 0.28 + (t / DUR) * 0.22 });
      if (rand() < 0.3) spawns.push({ t, x: 0.08 + rand() * 0.84, w: 0.12 + rand() * 0.12, v: 0.5 + rand() * 0.3 });
      t += 520 - Math.min(230, t / 85);
    }
    const cv = el('canvas', 'cv'); const cnt = el('div', 'counter', '0.0 s');
    stage.append(cv, cnt, el('div', 'hint', 'Arrastra el dedo para moverte'));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = stage.clientWidth; const H = stage.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const R = Math.max(12, W * 0.03); const PY = H * 0.86;
    let px = W / 2; let tx = W / 2; let over = false; let last = 0; let first = 0; let lastTxt = 0;
    const setX = (e) => { const r = stage.getBoundingClientRect(); tx = Math.min(W - R, Math.max(R, e.clientX - r.left)); };
    stage.addEventListener('pointerdown', setX); stage.addEventListener('pointermove', setX);
    function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fill(); }
    function finish(v) { if (over) return; over = true; stopLoop(); done(v); }
    const stopLoop = loop((ts) => {
      if (over) return;
      if (!first) { first = ts; last = ts; }
      const now = ts - first; const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
      px += (tx - px) * Math.min(1, dt * 20);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ff7a3d';
      for (const s of spawns) {
        if (s.t > now) break;
        const y = ((now - s.t) / 1000) * s.v * H - BH * H;
        if (y > H) continue;
        const bw = s.w * W; const bx = s.x * W - bw / 2; const bh = BH * H;
        rr(bx, y, bw, bh, 8);
        const nx = Math.max(bx, Math.min(px, bx + bw)); const ny = Math.max(y, Math.min(PY, y + bh));
        if ((nx - px) ** 2 + (ny - PY) ** 2 < (R * 0.82) ** 2) { buzz(200); finish(Math.round(now / 10)); return; }
      }
      ctx.fillStyle = '#38d6c933'; ctx.beginPath(); ctx.arc(px, PY, R * 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = '#38d6c9'; ctx.beginPath(); ctx.arc(px, PY, R, 0, 7); ctx.fill();
      if (now - lastTxt > 100) { cnt.textContent = (now / 1000).toFixed(1) + ' s'; lastTxt = now; }
      if (now >= DUR) finish(Math.round(DUR / 10));
    });
    return () => { over = true; stopLoop(); stage.removeEventListener('pointerdown', setX); stage.removeEventListener('pointermove', setX); };
  };

  window.DuelGames = { GAMES, META };
})();
