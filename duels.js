'use strict';
/* Duelos en tiempo real. El servidor es la autoridad: simula la partida y reparte el estado.
   Cada duelo recibe ctx = { round, bcast(obj), sendTo(idx, obj), end(winner, values) }
   y devuelve { start(), input(idx, msg), sync(idx), dispose() }.
   winner: 0 o 1 (indice del jugador) o -1 para empate. */
const crypto = require('crypto');

const rnd = () => crypto.randomInt(1e9) / 1e9;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = (v) => Math.round(v * 10000) / 10000;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---------- Tira y afloja ----------
function tug(ctx) {
  const LIMIT = 20000; const STEP = 0.018;
  let p = 0; const taps = [0, 0]; const last = [0, 0];
  let over = false; let t0 = 0; let iv = null;
  const tl = () => Math.max(0, LIMIT - (Date.now() - t0));
  const state = () => ({ k: 's', p: r4(p), tl: tl(), taps });
  function finish() {
    if (over) return; over = true; clearInterval(iv);
    ctx.bcast(state());
    ctx.end(Math.abs(p) < 0.01 ? -1 : p > 0 ? 0 : 1, [taps[0], taps[1]]);
  }
  return {
    start() { t0 = Date.now(); ctx.bcast({ k: 'start', limit: LIMIT }); iv = setInterval(() => { if (over) return; ctx.bcast(state()); if (tl() <= 0) finish(); }, 66); },
    input(i, m) {
      if (over || !t0 || m.k !== 'tap') return;
      const n = Date.now(); if (n - last[i] < 35) return; last[i] = n;
      taps[i]++; p += (i === 0 ? 1 : -1) * STEP;
      if (p >= 1 || p <= -1) { p = clamp(p, -1, 1); finish(); }
    },
    sync(i) { ctx.sendTo(i, { ...state(), k: 'start', limit: LIMIT }); },
    dispose() { over = true; clearInterval(iv); },
  };
}

// ---------- Piedra, papel o tijera (al mejor de 3) ----------
function rps(ctx) {
  const NEED = 2; const MAXSUB = 9; const DEADLINE = 6000;
  const wins = [0, 0]; let picks = [null, null]; let n = 0; let timer = null; let over = false; let locked = false; let dl = 0;
  function prompt() {
    if (over) return;
    n++; picks = [null, null]; locked = false; dl = Date.now() + DEADLINE;
    ctx.bcast({ k: 'prompt', n, wins, dl: DEADLINE });
    timer = setTimeout(resolve, DEADLINE + 300);
  }
  function resolve() {
    if (over || locked) return;
    locked = true; clearTimeout(timer);
    for (let i = 0; i < 2; i++) if (picks[i] === null) picks[i] = Math.floor(rnd() * 3);
    const r = (picks[0] - picks[1] + 3) % 3; const res = r === 0 ? -1 : r === 1 ? 0 : 1;
    if (res >= 0) wins[res]++;
    ctx.bcast({ k: 'reveal', picks, res, wins });
    timer = setTimeout(() => { if (wins[0] >= NEED || wins[1] >= NEED || n >= MAXSUB) finish(); else prompt(); }, 2400);
  }
  function finish() {
    if (over) return; over = true; clearTimeout(timer);
    ctx.end(wins[0] > wins[1] ? 0 : wins[1] > wins[0] ? 1 : -1, [wins[0], wins[1]]);
  }
  return {
    start() { ctx.bcast({ k: 'start' }); prompt(); },
    input(i, m) {
      if (m.k !== 'pick' || locked || over || picks[i] !== null) return;
      const v = Math.floor(num(m.v, -1)); if (v < 0 || v > 2) return;
      picks[i] = v; ctx.sendTo(i, { k: 'picked', v }); ctx.sendTo(1 - i, { k: 'oppPicked' });
      if (picks[0] !== null && picks[1] !== null) resolve();
    },
    sync(i) { if (!locked) ctx.sendTo(i, { k: 'prompt', n, wins, dl: Math.max(500, dl - Date.now()) }); else ctx.sendTo(i, { k: 'reveal', picks, res: -2, wins }); },
    dispose() { over = true; clearTimeout(timer); },
  };
}

// ---------- Cuatro en linea ----------
function connect4(ctx) {
  const R = 6; const C = 7; const TL = 14000;
  const board = Array.from({ length: R }, () => Array(C).fill(-1));
  let turn = (ctx.round - 1) % 2; let timer = null; let over = false; let dl = 0; let endTimer = null;
  const cols = () => { const a = []; for (let c = 0; c < C; c++) if (board[0][c] === -1) a.push(c); return a; };
  function arm() {
    clearTimeout(timer); dl = Date.now() + TL;
    timer = setTimeout(() => { const a = cols(); if (a.length) drop(turn, a[Math.floor(rnd() * a.length)]); }, TL + 200);
  }
  function line(r, c, who) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [[r, c]];
      for (const s of [1, -1]) {
        let rr = r + dr * s; let cc = c + dc * s;
        while (rr >= 0 && rr < R && cc >= 0 && cc < C && board[rr][cc] === who) { cells.push([rr, cc]); rr += dr * s; cc += dc * s; }
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }
  function drop(i, c) {
    let r = R - 1; while (r >= 0 && board[r][c] !== -1) r--;
    if (r < 0) return;
    board[r][c] = i; clearTimeout(timer);
    const win = line(r, c, i);
    if (win) { ctx.bcast({ k: 'move', board, last: [r, c], turn: -1, win }); over = true; endTimer = setTimeout(() => ctx.end(i, i === 0 ? [1, 0] : [0, 1]), 2200); return; }
    if (!cols().length) { ctx.bcast({ k: 'move', board, last: [r, c], turn: -1, win: null }); over = true; endTimer = setTimeout(() => ctx.end(-1, [0, 0]), 1800); return; }
    turn = 1 - i; ctx.bcast({ k: 'move', board, last: [r, c], turn, tl: TL }); arm();
  }
  return {
    start() { ctx.bcast({ k: 'start', board, turn, tl: TL }); arm(); },
    input(i, m) {
      if (over || m.k !== 'drop' || i !== turn) return;
      const c = Math.floor(num(m.c, -1)); if (c < 0 || c >= C || board[0][c] !== -1) return;
      drop(i, c);
    },
    sync(i) { ctx.sendTo(i, { k: 'start', board, turn: over ? -1 : turn, tl: Math.max(0, dl - Date.now()) }); },
    dispose() { over = true; clearTimeout(timer); clearTimeout(endTimer); },
  };
}

// ---------- fisica compartida (tick fijo de 1/60 s) ----------
function loop(step, every, emit) {
  let last = Date.now(); let acc = 0; let n = 0;
  const iv = setInterval(() => {
    const now = Date.now(); acc += Math.min(0.1, (now - last) / 1000); last = now;
    while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; if (++n % every === 0) emit(); }
  }, 1000 / 60);
  return () => clearInterval(iv);
}

// ---------- Hockey de aire (Pong) ----------
function pong(ctx) {
  const W = 1; const H = 1.6; const HW = 0.13; const TH = 0.035; const BR = 0.028; const PY = [H - 0.08, 0.08];
  const GOALS = 5; const LIMIT = 60000; const EXTRA = 20000;
  const px = [0.5, 0.5]; const tx = [0.5, 0.5]; const score = [0, 0];
  const ball = { x: 0.5, y: H / 2, vx: 0, vy: 0 };
  let speed = 0.62; let freeze = 0; let over = false; let t0 = 0; let stop = null;
  function serve(toward) {
    ball.x = 0.5; ball.y = H / 2; speed = 0.62;
    const ang = rnd() * 0.8 - 0.4;
    ball.vx = Math.sin(ang) * speed; ball.vy = (toward === 0 ? 1 : -1) * Math.cos(ang) * speed; freeze = 75;
  }
  const tl = () => Math.max(0, LIMIT - (Date.now() - t0));
  function snap() { return { k: 's', b: [r4(ball.x), r4(ball.y), r4(ball.vx), r4(ball.vy)], p: [r4(px[0]), r4(px[1])], s: score, tl: tl(), fz: freeze > 0 ? 1 : 0 }; }
  function finish() {
    if (over) return; over = true; if (stop) stop();
    ctx.bcast(snap());
    ctx.end(score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1, [score[0], score[1]]);
  }
  function step(dt) {
    if (over) return;
    for (let i = 0; i < 2; i++) { px[i] = clamp(px[i] + clamp(tx[i] - px[i], -2.4 * dt, 2.4 * dt), HW, W - HW); }
    if (freeze > 0) { freeze--; return; }
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    if (ball.x < BR) { ball.x = BR; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - BR) { ball.x = W - BR; ball.vx = -Math.abs(ball.vx); }
    for (let i = 0; i < 2; i++) {
      const toward = i === 0 ? ball.vy > 0 : ball.vy < 0;
      if (toward && Math.abs(ball.y - PY[i]) <= TH / 2 + BR && Math.abs(ball.x - px[i]) <= HW + BR) {
        speed = Math.min(1.5, speed * 1.05 + 0.02);
        const ang = ((ball.x - px[i]) / (HW + BR)) * 0.9;
        ball.vx = Math.sin(ang) * speed; ball.vy = (i === 0 ? -1 : 1) * Math.cos(ang) * speed;
        ball.y = i === 0 ? PY[i] - TH / 2 - BR : PY[i] + TH / 2 + BR;
      }
    }
    let scorer = -1;
    if (ball.y > H + BR) scorer = 1; else if (ball.y < -BR) scorer = 0;
    if (scorer >= 0) {
      score[scorer]++; ctx.bcast({ k: 'goal', who: scorer, s: score });
      const timeUp = Date.now() - t0 >= LIMIT;
      if (score[scorer] >= GOALS || (timeUp && score[0] !== score[1])) { finish(); return; }
      serve(1 - scorer); return;
    }
    const el = Date.now() - t0;
    if (el >= LIMIT && score[0] !== score[1]) finish();
    else if (el >= LIMIT + EXTRA) finish();
  }
  return {
    start() { t0 = Date.now(); serve(ctx.round % 2); ctx.bcast({ ...snap(), k: 'start' }); stop = loop(step, 2, () => { if (!over) ctx.bcast(snap()); }); },
    input(i, m) { if (m.k === 'p') tx[i] = clamp(num(m.x, 0.5), 0, 1); },
    sync(i) { ctx.sendTo(i, { ...snap(), k: 'start' }); },
    dispose() { over = true; if (stop) stop(); },
  };
}

// ---------- Tanques (arena 1 contra 1) ----------
function tanks(ctx) {
  const W = 1; const H = 1.6; const TR = 0.045; const SPEED = 0.5; const BSPEED = 1.15; const BR = 0.012; const LIMIT = 45000;
  const OBS = [[0.15, 0.62, 0.4, 0.7], [0.6, 0.9, 0.85, 0.98], [0.42, 0.76, 0.58, 0.84]];
  const T = [{ x: 0.5, y: H - 0.2, hp: 3, tx: 0.5, ty: H - 0.2, fire: false, cd: 0 }, { x: 0.5, y: 0.2, hp: 3, tx: 0.5, ty: 0.2, fire: false, cd: 0 }];
  let bullets = []; let over = false; let t0 = 0; let stop = null;
  const hitsRect = (x, y, r) => OBS.some(([a, b, c, d]) => { const nx = clamp(x, a, c); const ny = clamp(y, b, d); return (nx - x) ** 2 + (ny - y) ** 2 < r * r; });
  const tl = () => Math.max(0, LIMIT - (Date.now() - t0));
  const snap = () => ({ k: 's', tk: T.map((t) => [r4(t.x), r4(t.y), t.hp]), b: bullets.map((b) => [r4(b.x), r4(b.y), b.o]), tl: tl() });
  function finish() {
    if (over) return; over = true; if (stop) stop();
    ctx.bcast(snap());
    ctx.end(T[0].hp > T[1].hp ? 0 : T[1].hp > T[0].hp ? 1 : -1, [T[0].hp, T[1].hp]);
  }
  function step(dt) {
    if (over) return;
    for (let i = 0; i < 2; i++) {
      const t = T[i]; const o = T[1 - i];
      const dx = t.tx - t.x; const dy = t.ty - t.y; const d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const mv = Math.min(d, SPEED * dt); const nx = t.x + (dx / d) * mv; const ny = t.y + (dy / d) * mv;
        if (!hitsRect(nx, t.y, TR) && Math.hypot(nx - o.x, t.y - o.y) > TR * 2) t.x = clamp(nx, TR, W - TR);
        if (!hitsRect(t.x, ny, TR) && Math.hypot(t.x - o.x, ny - o.y) > TR * 2) t.y = clamp(ny, TR, H - TR);
      }
      t.cd -= dt;
      if (t.fire && t.cd <= 0 && bullets.filter((b) => b.o === i).length < 3) {
        const a = Math.atan2(o.y - t.y, o.x - t.x);
        bullets.push({ x: t.x + Math.cos(a) * (TR + 0.02), y: t.y + Math.sin(a) * (TR + 0.02), vx: Math.cos(a) * BSPEED, vy: Math.sin(a) * BSPEED, o: i });
        t.cd = 0.5;
      }
    }
    const keep = [];
    for (const b of bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 0 || b.x > W || b.y < 0 || b.y > H || hitsRect(b.x, b.y, BR)) continue;
      const e = T[1 - b.o];
      if (Math.hypot(b.x - e.x, b.y - e.y) < TR + BR) {
        e.hp--; ctx.bcast({ k: 'hit', who: 1 - b.o, x: r4(e.x), y: r4(e.y), hp: e.hp });
        if (e.hp <= 0) { finish(); return; }
        continue;
      }
      keep.push(b);
    }
    bullets = keep;
    if (Date.now() - t0 >= LIMIT) finish();
  }
  return {
    start() { t0 = Date.now(); ctx.bcast({ ...snap(), k: 'start', obs: OBS }); stop = loop(step, 2, () => { if (!over) ctx.bcast(snap()); }); },
    input(i, m) {
      if (over) return;
      if (m.k === 'm') { T[i].tx = clamp(num(m.x, T[i].x), TR, W - TR); T[i].ty = clamp(num(m.y, T[i].y), TR, H - TR); }
      else if (m.k === 'f') T[i].fire = !!m.on;
    },
    sync(i) { ctx.sendTo(i, { ...snap(), k: 'start', obs: OBS }); },
    dispose() { over = true; if (stop) stop(); },
  };
}

const DUELS = { tug, rps, connect4, pong, tanks };
module.exports = { DUELS };
