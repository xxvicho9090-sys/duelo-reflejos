'use strict';
/* Duelos en tiempo real (cara a cara). El servidor simula y reparte el estado;
   aqui solo se dibuja y se mandan las acciones. Cada juego recibe (stage, rand, done, net):
   net.you = mi indice, net.names, net.send(obj), net.on(fn), net.ready().
   El resultado de la ronda lo decide el servidor, asi que done() no se usa. */
(() => {
  const { el, beep, buzz, burst, float, confetti } = window.DU;
  const { GAMES, META } = window.DuelGames;
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ME = '#ff7a3d'; const OPP = '#38d6c9';

  Object.assign(META, {
    tug: { duel: true, title: 'Tira y afloja', g: ['#7a2a3a', '#240d14'], pat: 'stripes', icon: svg('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>'),
      how: 'Toca lo más rápido que puedas para jalar la cuerda hacia tu lado. Se juega en vivo contra tu rival.', fmt: (v) => `${v} toques` },
    rps: { duel: true, title: 'Piedra, papel o tijera', g: ['#2b4a7a', '#0e1a2c'], pat: 'dots', icon: svg('<path d="M7 11V6a1.5 1.5 0 0 1 3 0v5M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6H9a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0"/>'),
      how: 'Elige en secreto y se revela a la vez. Gana quien llegue primero a 2 victorias.', fmt: (v) => `${v} ganadas` },
    connect4: { duel: true, title: 'Cuatro en línea', g: ['#1d3f8f', '#0a1230'], pat: 'grid', icon: svg('<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/><circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/>'),
      how: 'Por turnos, deja caer fichas. Junta 4 en línea (horizontal, vertical o diagonal). Tienes 14 segundos por turno.', fmt: (v) => (v ? '4 en línea' : '—') },
    pong: { duel: true, title: 'Hockey de aire', g: ['#17606b', '#08242a'], pat: 'rings', icon: svg('<rect x="8" y="3" width="8" height="2" rx="1"/><rect x="8" y="19" width="8" height="2" rx="1"/><circle cx="14" cy="12" r="2"/>'),
      how: 'Arrastra el dedo para mover tu paleta abajo y mete la pelota en el arco rival. Gana quien llegue a 5 goles.', fmt: (v) => `${v} goles` },
    tanks: { duel: true, title: 'Tanques', g: ['#4a5a1f', '#171d0a'], pat: 'checker', icon: svg('<rect x="5" y="11" width="14" height="8" rx="2"/><path d="M12 11V5h4"/>'),
      how: 'Arrastra para mover tu tanque y mantén el botón DISPARAR. Cada impacto quita una vida de tres.', fmt: (v) => `${v} vidas` },
  });

  const RPS_ICONS = [
    svg('<path d="M5 14c0-5 3-9 7-9s7 4 7 9c0 4-3 6-7 6s-7-2-7-6z"/><path d="M9 11v3M13 10v4M16 12v2"/>'),
    svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>'),
    svg('<circle cx="7" cy="18" r="3"/><circle cx="17" cy="18" r="3"/><path d="M9 15.5 17 3M15 15.5 7 3"/>'),
  ];
  const RPS_NAMES = ['Piedra', 'Papel', 'Tijera'];

  function box(parent, cls, text) { const n = el('div', cls, text); parent.append(n); return n; }
  function animBar(bar, ms) {
    bar.getAnimations().forEach((a) => a.cancel());
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: Math.max(1, ms), fill: 'forwards', easing: 'linear' });
  }
  function fieldCanvas(stage, Wd, Hd) {
    const cv = el('canvas', 'cv'); stage.append(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = stage.clientWidth; const h = stage.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const sc = Math.min((w * 0.94) / Wd, (h * 0.96) / Hd);
    return { cv, ctx, w, h, sc, ox: (w - Wd * sc) / 2, oy: (h - Hd * sc) / 2 };
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function raf(fn) { let id; let run = true; const f = (t) => { if (!run) return; fn(t); id = requestAnimationFrame(f); }; id = requestAnimationFrame(f); return () => { run = false; cancelAnimationFrame(id); }; }

  // ---------- Tira y afloja ----------
  GAMES.tug = (stage, rand, done, net) => {
    const bar = el('div', 'timebar'); stage.append(bar);
    const top = box(stage, 'tug-side top', ''); const bot = box(stage, 'tug-side bot', '');
    const oppLbl = el('span', '', net.names[1]); const oppN = el('b', '', '0'); top.append(oppLbl, oppN);
    const meLbl = el('span', '', net.names[0]); const meN = el('b', '', '0'); bot.append(meLbl, meN);
    const track = box(stage, 'tug-track'); const knot = box(track, 'tug-knot'); const fin1 = box(track, 'tug-end t'); const fin2 = box(track, 'tug-end b');
    const msg = box(stage, 'big tug-msg', 'Preparando…');
    const btn = el('div', 'tug-btn', 'TIRA'); stage.append(btn);
    let started = false; let target = 0; let disp = 0; let last = 0; let over = false;
    net.on((m) => {
      if (m.k === 'start') { started = true; msg.textContent = '¡YA!'; setTimeout(() => { msg.style.display = 'none'; }, 600); beep(880, 0.12); if (m.limit) animBar(bar, m.tl ?? m.limit); }
      if (m.k === 's') {
        target = net.you === 0 ? m.p : -m.p;
        meN.textContent = m.taps[net.you]; oppN.textContent = m.taps[1 - net.you];
      }
    });
    const onDown = (e) => {
      if (!started || over) return;
      const n = performance.now(); if (n - last < 30) return; last = n;
      net.send({ k: 'tap' }); buzz(6);
      btn.classList.remove('hit'); void btn.offsetWidth; btn.classList.add('hit');
      burst(e.clientX, e.clientY, ME, 4, 0.6);
    };
    stage.addEventListener('pointerdown', onDown);
    const stopLoop = raf(() => { disp += (target - disp) * 0.25; knot.style.transform = `translate(-50%, ${(disp * 42).toFixed(2)}vh) translateY(-50%)`; knot.style.setProperty('--lean', disp); });
    net.ready();
    return () => { over = true; stopLoop(); stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Piedra, papel o tijera ----------
  GAMES.rps = (stage, rand, done, net) => {
    const bar = el('div', 'timebar'); stage.append(bar);
    const col = box(stage, 'col rps');
    const oppRow = box(col, 'rps-opp'); const oppName = el('span', '', net.names[1]); const oppState = el('b', '', 'Esperando…'); const oppPips = el('i', 'rps-pips'); oppRow.append(oppName, oppState, oppPips);
    const arena = box(col, 'rps-arena'); const oppHand = box(arena, 'rps-hand opp'); const verdict = box(arena, 'rps-verdict', ''); const meHand = box(arena, 'rps-hand me');
    const mePips = el('i', 'rps-pips');
    const btns = box(col, 'rps-btns');
    const bs = RPS_ICONS.map((ic, i) => { const b = el('button', 'rps-btn'); b.innerHTML = ic + `<span>${RPS_NAMES[i]}</span>`; b.dataset.i = String(i); btns.append(b); return b; });
    const meRow = box(col, 'rps-opp me'); meRow.append(el('span', '', net.names[0]), mePips);
    let canPick = false; let n = 0; let over = false;
    const pips = (node, w) => { node.textContent = ''; for (let i = 0; i < 2; i++) node.append(el('u', i < w ? 'on' : '')); };
    pips(oppPips, 0); pips(mePips, 0);
    const clear = () => { oppHand.innerHTML = ''; meHand.innerHTML = ''; oppHand.className = 'rps-hand opp'; meHand.className = 'rps-hand me'; verdict.textContent = ''; bs.forEach((b) => b.classList.remove('sel')); };
    clear();
    net.on((m) => {
      if (m.k === 'prompt') {
        n = m.n; canPick = true; clear(); oppState.textContent = 'Pensando…'; bs.forEach((b) => { b.disabled = false; });
        animBar(bar, m.dl); pips(oppPips, m.wins[1 - net.you]); pips(mePips, m.wins[net.you]);
      } else if (m.k === 'picked') { canPick = false; bs.forEach((b) => { b.disabled = true; b.classList.toggle('sel', Number(b.dataset.i) === m.v); }); meHand.innerHTML = RPS_ICONS[m.v]; meHand.classList.add('hidden-pick'); }
      else if (m.k === 'oppPicked') { oppState.textContent = '¡Ya eligió!'; }
      else if (m.k === 'reveal') {
        canPick = false; bs.forEach((b) => { b.disabled = true; });
        if (m.res === -2) return;
        const mine = m.picks[net.you]; const theirs = m.picks[1 - net.you];
        meHand.className = 'rps-hand me show'; oppHand.className = 'rps-hand opp show'; meHand.innerHTML = RPS_ICONS[mine]; oppHand.innerHTML = RPS_ICONS[theirs];
        oppState.textContent = RPS_NAMES[theirs];
        const win = m.res === net.you; const tie = m.res === -1;
        verdict.textContent = tie ? 'Empate' : win ? '¡Ganas!' : 'Pierdes'; verdict.className = 'rps-verdict ' + (tie ? '' : win ? 'win' : 'lose');
        if (win) { meHand.classList.add('won'); buzz(60); beep(784, 0.12, 'triangle'); const r = meHand.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, '#ffd166', 24, 1.2); }
        else if (!tie) { oppHand.classList.add('won'); buzz([40, 40, 40]); beep(220, 0.2, 'sawtooth'); } else beep(440, 0.1);
        pips(oppPips, m.wins[1 - net.you]); pips(mePips, m.wins[net.you]);
        bar.getAnimations().forEach((a) => a.cancel()); bar.style.transform = 'scaleX(0)';
      }
    });
    const onDown = (e) => {
      const b = e.target.closest && e.target.closest('.rps-btn');
      if (!b || !canPick || over) return;
      net.send({ k: 'pick', v: Number(b.dataset.i) }); buzz(15); beep(520, 0.05, 'triangle', 0.1);
    };
    stage.addEventListener('pointerdown', onDown);
    net.ready();
    return () => { over = true; stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Cuatro en linea ----------
  GAMES.connect4 = (stage, rand, done, net) => {
    const R = 6; const C = 7;
    const bar = el('div', 'timebar'); stage.append(bar);
    const col = box(stage, 'col c4wrap');
    const turnLbl = box(col, 'c4-turn', 'Preparando…');
    const frame = box(col, 'c4'); const cells = []; const hits = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const d = el('div', 'c4-cell'); frame.append(d); cells.push(d); }
    const cover = box(frame, 'c4-cols');
    for (let c = 0; c < C; c++) { const b = el('button', 'c4-col'); b.dataset.c = String(c); b.setAttribute('aria-label', `Columna ${c + 1}`); cover.append(b); hits.push(b); }
    let myTurn = false; let over = false; let board = null;
    function paint(m) {
      board = m.board;
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const d = cells[r * C + c]; const v = board[r][c]; const had = d.dataset.v;
        d.dataset.v = String(v);
        if (v === -1) { d.className = 'c4-cell'; d.textContent = ''; continue; }
        if (had !== String(v)) {
          d.className = 'c4-cell'; d.textContent = '';
          const p = el('i', 'c4-piece ' + (v === net.you ? 'me' : 'opp')); d.append(p);
          if (m.last && m.last[0] === r && m.last[1] === c) { p.style.setProperty('--fall', String(r + 1)); p.classList.add('fall'); beep(v === net.you ? 440 : 330, 0.08, 'triangle', 0.12); }
        }
      }
      if (m.win) {
        m.win.forEach(([r, c]) => cells[r * C + c].classList.add('win'));
        bar.getAnimations().forEach((a) => a.cancel()); bar.style.transform = 'scaleX(0)';
        const mine = board[m.win[0][0]][m.win[0][1]] === net.you; turnLbl.textContent = mine ? '¡Cuatro en línea!' : 'Te hicieron cuatro en línea';
        if (mine) { buzz([40, 30, 80]); confetti(50); }
        myTurn = false; return;
      }
      if (m.turn === -1) { turnLbl.textContent = 'Tablero lleno'; myTurn = false; return; }
      myTurn = m.turn === net.you;
      turnLbl.textContent = myTurn ? 'Tu turno' : `Turno de ${net.names[1]}`;
      turnLbl.className = 'c4-turn ' + (myTurn ? 'me' : 'opp');
      hits.forEach((b, c) => { b.disabled = !myTurn || board[0][c] !== -1; });
      animBar(bar, m.tl || 14000);
    }
    net.on((m) => { if (m.k === 'start' || m.k === 'move') paint(m); });
    const onDown = (e) => {
      const b = e.target.closest && e.target.closest('.c4-col');
      if (!b || !myTurn || over || b.disabled) return;
      net.send({ k: 'drop', c: Number(b.dataset.c) }); myTurn = false; hits.forEach((x) => { x.disabled = true; }); buzz(12);
    };
    stage.addEventListener('pointerdown', onDown);
    net.ready();
    return () => { over = true; stage.removeEventListener('pointerdown', onDown); };
  };

  // ---------- Hockey de aire ----------
  GAMES.pong = (stage, rand, done, net) => {
    const W = 1; const H = 1.6; const HW = 0.13; const TH = 0.035; const BR = 0.028;
    const { cv, ctx, w, sc, ox, oy } = fieldCanvas(stage, W, H);
    const flip = net.you === 1;
    const vx = (x) => ox + (flip ? 1 - x : x) * sc; const vy = (y) => oy + (flip ? H - y : y) * sc;
    let ball = { x: 0.5, y: H / 2, vx: 0, vy: 0, t: performance.now() }; let srvP = [0.5, 0.5]; let score = [0, 0]; let fz = 1; let tl = 60000; let started = false; let over = false;
    let myView = 0.5; let sentAt = 0; let sentX = -1; let flash = 0; let flashWho = -1; const trail = [];
    net.on((m) => {
      if (m.k === 'start' || m.k === 's') { ball = { x: m.b[0], y: m.b[1], vx: m.b[2], vy: m.b[3], t: performance.now() }; srvP = m.p; score = m.s; fz = m.fz; tl = m.tl; started = true; }
      else if (m.k === 'goal') { score = m.s; flash = 40; flashWho = m.who; const mine = m.who === net.you; buzz(mine ? [30, 30, 60] : 120); beep(mine ? 880 : 220, 0.25, mine ? 'triangle' : 'sawtooth'); if (mine) confetti(30); }
    });
    const setX = (e) => { const r = stage.getBoundingClientRect(); myView = Math.min(1 - HW, Math.max(HW, (e.clientX - r.left - ox) / sc)); };
    stage.addEventListener('pointerdown', setX); stage.addEventListener('pointermove', setX);
    const ink = (a) => `rgba(246,239,227,${a})`;
    const stopLoop = raf((now) => {
      ctx.clearRect(0, 0, w, stage.clientHeight);
      // cancha
      ctx.lineWidth = 3; ctx.strokeStyle = ink(0.25); rrect(ctx, ox, oy, W * sc, H * sc, 18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + (H / 2) * sc); ctx.lineTo(ox + W * sc, oy + (H / 2) * sc); ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(ox + (W / 2) * sc, oy + (H / 2) * sc, 0.16 * sc, 0, 7); ctx.stroke();
      // marcador y reloj
      ctx.font = `800 ${Math.round(sc * 0.2)}px Unbounded, system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(56,214,201,0.22)'; ctx.fillText(String(score[1 - net.you]), ox + 14, oy + (H / 2) * sc - sc * 0.17);
      ctx.fillStyle = 'rgba(255,122,61,0.28)'; ctx.fillText(String(score[net.you]), ox + 14, oy + (H / 2) * sc + sc * 0.17);
      ctx.font = `700 ${Math.round(sc * 0.05)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.fillStyle = ink(0.6);
      ctx.fillText(started ? `${Math.ceil(Math.max(0, tl - (performance.now() - ball.t)) / 1000)} s` : '', ox + W * sc - 12, oy + 22);
      // paletas
      const my = Math.min(1 - HW, Math.max(HW, myView));
      const oppX = flip ? 1 - srvP[1 - net.you] : srvP[1 - net.you];
      ctx.fillStyle = OPP; rrect(ctx, ox + (oppX - HW) * sc, oy + (0.08 - TH / 2) * sc, HW * 2 * sc, TH * sc, 8); ctx.fill();
      ctx.fillStyle = ME; rrect(ctx, ox + (my - HW) * sc, oy + (H - 0.08 - TH / 2) * sc, HW * 2 * sc, TH * sc, 8); ctx.fill();
      // pelota (se extrapola con su velocidad entre mensajes)
      const dt = fz ? 0 : Math.min(0.12, (performance.now() - ball.t) / 1000);
      let bx = ball.x + ball.vx * dt; const by = ball.y + ball.vy * dt;
      if (bx < BR) bx = 2 * BR - bx; if (bx > W - BR) bx = 2 * (W - BR) - bx;
      const px = vx(bx); const py = vy(by);
      trail.push([px, py]); if (trail.length > 8) trail.shift();
      trail.forEach(([tx, ty], i) => { ctx.fillStyle = `rgba(255,209,102,${(i / trail.length) * 0.35})`; ctx.beginPath(); ctx.arc(tx, ty, BR * sc * (0.4 + i / trail.length * 0.6), 0, 7); ctx.fill(); });
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(px, py, BR * sc, 0, 7); ctx.fill();
      if (flash > 0) { flash--; ctx.fillStyle = (flashWho === net.you ? 'rgba(123,228,149,' : 'rgba(255,93,115,') + (flash / 120) + ')'; ctx.fillRect(0, 0, w, stage.clientHeight); }
      if (started && now - sentAt > 33 && Math.abs(my - sentX) > 0.002) { sentAt = now; sentX = my; net.send({ k: 'p', x: flip ? 1 - my : my }); }
    });
    void cv;
    net.ready();
    return () => { over = true; stopLoop(); stage.removeEventListener('pointerdown', setX); stage.removeEventListener('pointermove', setX); void over; };
  };

  // ---------- Tanques ----------
  GAMES.tanks = (stage, rand, done, net) => {
    const W = 1; const H = 1.6; const TR = 0.045;
    const { ctx, w, sc, ox, oy } = fieldCanvas(stage, W, H);
    const flip = net.you === 1;
    const vX = (x) => ox + (flip ? 1 - x : x) * sc; const vY = (y) => oy + (flip ? H - y : y) * sc;
    let obs = []; let tk = [[0.5, 1.4, 3], [0.5, 0.2, 3]]; let bl = []; const disp = [[0.5, 1.4], [0.5, 0.2]]; let tl = 45000; let tlAt = performance.now(); let started = false; let marker = null; let shakeT = 0;
    net.on((m) => {
      if (m.k === 'start' || m.k === 's') { if (m.obs) obs = m.obs; tk = m.tk; bl = m.b; tl = m.tl; tlAt = performance.now(); if (m.k === 'start') { started = true; disp[0] = [tk[0][0], tk[0][1]]; disp[1] = [tk[1][0], tk[1][1]]; } }
      else if (m.k === 'hit') {
        const r = stage.getBoundingClientRect(); burst(r.left + vX(m.x), r.top + vY(m.y), m.who === net.you ? ME : OPP, 26, 1.4);
        if (m.who === net.you) { buzz(150); shakeT = 12; beep(180, 0.2, 'sawtooth'); } else { beep(660, 0.1, 'triangle'); float(r.left + vX(m.x), r.top + vY(m.y) - 20, '¡Impacto!', '#ffd166'); }
      }
    });
    const fire = el('button', 'firebtn', 'DISPARAR'); stage.append(fire);
    let sentAt = 0; let pending = null;
    const setT = (e) => {
      if (e.target.closest && e.target.closest('.firebtn')) return;
      const r = stage.getBoundingClientRect(); const x = (e.clientX - r.left - ox) / sc; const y = (e.clientY - r.top - oy) / sc;
      marker = [Math.min(1, Math.max(0, x)), Math.min(H, Math.max(0, y))];
      pending = { k: 'm', x: flip ? 1 - marker[0] : marker[0], y: flip ? H - marker[1] : marker[1] };
    };
    stage.addEventListener('pointerdown', setT); stage.addEventListener('pointermove', setT);
    const fon = (e) => { e.preventDefault(); try { fire.setPointerCapture(e.pointerId); } catch {} fire.classList.add('on'); net.send({ k: 'f', on: true }); buzz(10); };
    const foff = () => { if (!fire.classList.contains('on')) return; fire.classList.remove('on'); net.send({ k: 'f', on: false }); };
    fire.addEventListener('pointerdown', fon); fire.addEventListener('pointerup', foff); fire.addEventListener('pointercancel', foff); fire.addEventListener('lostpointercapture', foff);
    const heart = (x, y, on) => { ctx.fillStyle = on ? '#ff5d73' : 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); };
    const stopLoop = raf((now) => {
      ctx.save(); if (shakeT > 0) { shakeT--; ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8); }
      ctx.clearRect(-10, -10, w + 20, stage.clientHeight + 20);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(246,239,227,0.22)'; rrect(ctx, ox, oy, W * sc, H * sc, 18); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      obs.forEach(([a, b, c, d]) => { const x1 = flip ? 1 - c : a; const y1 = flip ? H - d : b; rrect(ctx, ox + x1 * sc, oy + y1 * sc, (c - a) * sc, (d - b) * sc, 8); ctx.fill(); ctx.stroke(); });
      if (marker) { ctx.strokeStyle = 'rgba(255,122,61,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ox + marker[0] * sc, oy + marker[1] * sc, 10, 0, 7); ctx.stroke(); }
      // tanques con suavizado
      for (let i = 0; i < 2; i++) { disp[i][0] += (tk[i][0] - disp[i][0]) * 0.4; disp[i][1] += (tk[i][1] - disp[i][1]) * 0.4; }
      const mine = disp[net.you]; const opp = disp[1 - net.you];
      const drawTank = (p, col, aim, hp) => {
        const x = vX(p[0]); const y = vY(p[1]);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, TR * sc, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(20,16,29,0.75)'; ctx.lineWidth = TR * sc * 0.55; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(aim) * TR * sc * 1.6, y + Math.sin(aim) * TR * sc * 1.6); ctx.stroke();
        ctx.fillStyle = 'rgba(20,16,29,0.55)'; ctx.beginPath(); ctx.arc(x, y, TR * sc * 0.45, 0, 7); ctx.fill();
        for (let k = 0; k < 3; k++) heart(x + (k - 1) * 16, y - TR * sc - 14, k < hp);
      };
      const aimMe = Math.atan2(vY(opp[1]) - vY(mine[1]), vX(opp[0]) - vX(mine[0]));
      drawTank(opp, OPP, aimMe + Math.PI, tk[1 - net.you][2]); drawTank(mine, ME, aimMe, tk[net.you][2]);
      bl.forEach(([bx, by, o]) => { ctx.fillStyle = o === net.you ? '#ffb27a' : '#8ff0e8'; ctx.beginPath(); ctx.arc(vX(bx), vY(by), 6, 0, 7); ctx.fill(); });
      ctx.fillStyle = 'rgba(246,239,227,0.7)'; ctx.font = `700 ${Math.round(sc * 0.045)}px Manrope, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(started ? `${Math.ceil(Math.max(0, tl - (performance.now() - tlAt)) / 1000)} s` : '', ox + (W * sc) / 2, oy + 20);
      ctx.restore();
      if (pending && now - sentAt > 40) { sentAt = now; net.send(pending); pending = null; }
    });
    net.ready();
    return () => { stopLoop(); foff(); stage.removeEventListener('pointerdown', setT); stage.removeEventListener('pointermove', setT); };
  };
})();
