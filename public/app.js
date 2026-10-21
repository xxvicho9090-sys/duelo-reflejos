'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'duelo.session';
  const NAME_KEY = 'duelo.name';

  // ---------- util ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  let actx = null;
  function beep(freq = 660, dur = 0.09, type = 'sine', vol = 0.15) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch {}
  }

  // ---------- efectos: particulas, textos flotantes, confeti ----------
  const fxCanvas = $('fx'); const fctx = fxCanvas.getContext('2d');
  let parts = []; let fxRun = false; let fxW = 0; let fxH = 0; let fxLeft = 0; let fxTop = 0;
  function sizeFx() {
    const r = $('game').getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fxLeft = r.left; fxTop = r.top; fxW = r.width; fxH = r.height;
    fxCanvas.width = Math.round(fxW * dpr); fxCanvas.height = Math.round(fxH * dpr); fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', sizeFx);
  function fxLoop() {
    fctx.clearRect(0, 0, fxW, fxH);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.life += 1;
      if (p.life > p.max) { parts.splice(i, 1); continue; }
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      fctx.globalAlpha = Math.max(0, 1 - p.life / p.max); fctx.fillStyle = p.c;
      if (p.rect) { fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); fctx.restore(); }
      else { fctx.beginPath(); fctx.arc(p.x, p.y, p.s, 0, 7); fctx.fill(); }
    }
    fctx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(fxLoop); else { fxRun = false; fctx.clearRect(0, 0, fxW, fxH); }
  }
  function addParts(list) {
    if (!fxW) sizeFx();
    if (parts.length > 260) parts.splice(0, list.length);
    parts.push(...list);
    if (!fxRun) { fxRun = true; requestAnimationFrame(fxLoop); }
  }
  function burst(cx, cy, color = '#ffd166', n = 12, power = 1) {
    if (!fxW) sizeFx();
    const x = cx - fxLeft; const y = cy - fxTop; const list = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283; const v = (1.5 + Math.random() * 3.5) * power;
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, g: 0.14, s: 2 + Math.random() * 3, c: color, life: 0, max: 22 + Math.random() * 16, rot: 0, vr: 0 });
    }
    addParts(list);
  }
  function confetti(n = 80) {
    sizeFx();
    const cols = ['#ff7a3d', '#38d6c9', '#ffd166', '#f6efe3', '#7be495', '#ff5d73']; const list = [];
    for (let i = 0; i < n; i++) {
      list.push({ x: Math.random() * fxW, y: -10 - Math.random() * 120, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 3, g: 0.05, s: 3 + Math.random() * 3,
        c: cols[i % cols.length], life: 0, max: 90 + Math.random() * 50, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, rect: true });
    }
    addParts(list);
  }
  function float(cx, cy, text, color = '#fff') {
    const n = document.createElement('div'); n.className = 'floaty'; n.textContent = text; n.style.color = color;
    n.style.left = (cx - fxLeft) + 'px'; n.style.top = (cy - fxTop) + 'px';
    $('game').append(n); setTimeout(() => n.remove(), 750);
  }
  function arp(freqs, step = 0.09, type = 'triangle') { freqs.forEach((f, i) => setTimeout(() => beep(f, 0.16, type, 0.14), i * step * 1000)); }

  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.code) keepAwake(); });

  // ---------- estado ----------
  const S = {
    ws: null, code: null, token: null, you: 0, name: '',
    players: [], phase: 'home', round: 0, totalRounds: 5,
    runningRound: 0, cleanup: null, closing: false, retry: 0, pingTimer: null, scores: [0, 0],
    pending: [], history: [], games: [],
  };

  function show(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === id);
  }

  // ---------- actualizacion automatica ----------
  const BUILD = (document.querySelector('meta[name="build"]') || {}).content || '';
  let updateAvail = false;
  function busy() { return S.phase === 'playing' || S.phase === 'between' || S.phase === 'paused'; }
  function maybeUpdate() {
    if (!updateAvail || busy()) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // no interrumpir mientras escribe
    try { if (sessionStorage.getItem('duelo.reloaded') === updateAvail) return; sessionStorage.setItem('duelo.reloaded', updateAvail); } catch {}
    const t = $('toast'); t.textContent = 'Actualizando a la nueva versión…'; t.classList.remove('hidden');
    setTimeout(() => location.reload(), 900);
  }
  function newBuild(b) { if (b && BUILD && b !== BUILD) { updateAvail = b; maybeUpdate(); } }
  async function checkVersion() {
    try {
      const r = await fetch('/version', { cache: 'no-store' });
      if (r.ok) newBuild((await r.text()).trim());
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) reg.update().catch(() => {});
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
  setInterval(checkVersion, 5 * 60 * 1000);

  // ---------- red ----------
  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; }

  function connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl());
      S.ws = ws;
      const t = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('timeout')); } }, 20000);
      ws.onopen = () => {
        clearTimeout(t); settled = true; S.retry = 0;
        $('net').classList.add('hidden');
        clearInterval(S.pingTimer);
        S.pingTimer = setInterval(() => rawSend({ t: 'ping' }), 20000);
        while (S.pending.length) rawSend(S.pending.shift());
        resolve();
      };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
      ws.onclose = () => {
        clearInterval(S.pingTimer);
        if (!settled) { settled = true; clearTimeout(t); reject(new Error('closed')); }
        if (S.ws === ws) onDisconnect();
      };
      ws.onerror = () => {};
    });
  }

  function rawSend(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }
  function send(o) { if (S.solo) return localSend(o); if (S.ws && S.ws.readyState === 1) rawSend(o); else S.pending.push(o); }

  function onDisconnect() {
    if (S.closing) return;
    if (!S.code) return; // en el inicio no reintentamos solos
    $('net').classList.remove('hidden');
    const wait = Math.min(1000 * 2 ** S.retry, 8000);
    S.retry += 1;
    setTimeout(async () => {
      if (S.closing || !S.code) return;
      try {
        await connect();
        rawSend({ t: 'join', code: S.code, token: S.token, name: S.name });
      } catch { onDisconnect(); }
    }, wait);
  }

  async function ensureConnected() {
    if (S.ws && S.ws.readyState === 1) return;
    await connect();
  }

  // ---------- mensajes ----------
  function onMsg(m) {
    switch (m.t) {
      case 'joined':
        S.token = m.token; S.code = m.code; S.you = m.you;
        store.set(SESSION_KEY, JSON.stringify({ code: m.code, token: m.token, name: S.name }));
        applySnapshot(m);
        break;
      case 'hello': newBuild(m.build); break;
      case 'snapshot': applySnapshot(m); break;
      case 'players':
        S.players = m.players; S.phase = m.phase; if (m.games) S.games = m.games;
        if (m.phase === 'lobby') { S.history = []; S.scores = [0, 0]; S.round = 0; }
        renderLobby(); renderHud();
        if (S.phase === 'lobby' && $('game').classList.contains('active')) { stopRound(); show('lobby'); }
        break;
      case 'round': startRound(m); break;
      case 'ack': break;
      case 'ds': if (S.duelHandler) S.duelHandler(m); break;
      case 'oppDone': if (m.by !== S.you) setWaitText('Tu rival ya terminó…'); break;
      case 'roundEnd': showRoundEnd(m); break;
      case 'closed':
        leaveLocal();
        $('homeErr').textContent = m.reason === 'left' ? 'La sala se cerró.' : 'La sala se cerró (tu rival se desconectó).';
        break;
      case 'error':
        if (S.code && m.code === 'no_room') { leaveLocal(); }
        $('homeErr').textContent = m.message;
        setBusy(false);
        break;
      case 'pong': break;
    }
    maybeUpdate();
  }

  function applySnapshot(m) {
    S.players = m.players; S.phase = m.phase; S.games = m.games || S.games; S.round = m.round; S.totalRounds = m.totalRounds; S.you = m.you;
    S.scores = m.players.map((p) => p.score);
    if (m.round === 0) S.history = [];
    renderLobby(); renderHud();
    if (m.phase === 'lobby' || m.phase === 'over' || m.phase === 'paused' && m.round === 0) {
      stopRound(); show('lobby');
    } else if (m.phase === 'playing') {
      if (!m.submitted) startRound({ round: m.round, totalRounds: m.totalRounds, game: m.game, seed: m.seed });
      else { show('game'); overlay.dataset.kind = 'wait'; setOverlay([el('h2', '', 'Esperando al rival…')]); }
    } else {
      show('game');
    }
    setBusy(false);
  }

  // ---------- pantallas ----------
  function setBusy(b) { $('btnCreate').disabled = b; $('btnJoin').disabled = b; }

  function renderLobby() {
    $('roomCode').textContent = S.code || '----';
    const ul = $('plist');
    ul.textContent = '';
    S.players.forEach((p, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.textContent = p.name + (i === S.you ? ' (tú)' : '');
      const st = document.createElement('span');
      st.className = 'st' + (p.ready ? ' ok' : '');
      st.textContent = !p.connected ? 'desconectado' : p.ready ? '✔ listo' : 'esperando';
      li.append(n, st);
      ul.append(li);
    });
    renderPicker();
    const solo = !!S.solo;
    $('btnShare').classList.toggle('hidden', solo);
    $('diffRow').classList.toggle('hidden', !solo);
    $('lobbyEyebrow').textContent = solo ? 'Modo solo contra el Robot' : 'Código de sala';
    if (solo) {
      $('diffRow').textContent = '';
      DIFFS.forEach((d, i) => {
        const b = document.createElement('button'); b.textContent = d.n; b.className = i === S.solo.diff ? 'on' : '';
        b.onclick = () => { S.solo.diff = i; renderLobby(); }; $('diffRow').append(b);
      });
    }
    const two = S.players.length === 2;
    const me = S.players[S.you];
    $('lobbyMsg').textContent = solo ? 'Elige dificultad y juegos. Funciona sin internet.' : two ? (me && me.ready ? 'Esperando que tu rival esté listo…' : '¡Ya están los dos! Pulsa listo.') : 'Esperando al otro jugador… compárteles el código.';
    $('btnReady').disabled = !two || (me && me.ready);
    $('btnReady').textContent = S.phase === 'over' ? 'Revancha' : solo ? '¡Empezar!' : '¡Estoy listo!';
  }

  function renderPicker() {
    const box = $('gamePick');
    const META = window.DuelGames && window.DuelGames.META;
    if (!META) return;
    const host = S.you === 0;
    const ids = Object.keys(META).filter((id) => !S.solo || !META[id].duel); // los duelos en vivo necesitan a otra persona
    box.textContent = '';
    const addBtn = (id) => {
      const b = document.createElement('button');
      b.textContent = META[id].title;
      b.className = S.games.includes(id) ? 'on' : '';
      b.disabled = !host;
      b.setAttribute('aria-pressed', S.games.includes(id) ? 'true' : 'false');
      b.onclick = () => {
        const set = new Set(S.games);
        if (set.has(id)) { if (set.size === 1) return; set.delete(id); } else set.add(id);
        S.games = ids.filter((g) => set.has(g));
        send({ t: 'settings', games: S.games });
        renderPicker();
      };
      box.append(b);
    };
    ids.filter((id) => !META[id].duel).forEach(addBtn);
    if (ids.some((id) => META[id].duel)) {
      const sep = document.createElement('small'); sep.className = 'sep'; sep.textContent = 'Cara a cara en vivo'; box.append(sep);
      ids.filter((id) => META[id].duel).forEach(addBtn);
    }
    if (host && S.games.length < ids.length) {
      const all = document.createElement('button');
      all.textContent = 'Todos'; all.onclick = () => { S.games = ids.slice(); send({ t: 'settings', games: S.games }); renderPicker(); };
      box.append(all);
    }
    $('pickTitle').textContent = host ? 'Elige los juegos (toca para activar o quitar)' : 'Juegos que eligió el anfitrión';
  }

  function renderHud() {
    const a = S.players[S.you]; const b = S.players[1 - S.you];
    $('hudNameA').textContent = a ? a.name : 'Tú';
    $('hudNameB').textContent = b ? b.name : 'Rival';
    for (const [id, v] of [['hudScoreA', S.scores[S.you] ?? 0], ['hudScoreB', S.scores[1 - S.you] ?? 0]]) {
      const n = $(id);
      if (n.textContent !== String(v)) { n.textContent = v; n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
    }
    const pips = $('pips');
    pips.textContent = '';
    for (let i = 0; i < S.totalRounds; i++) {
      const p = document.createElement('i');
      if (S.history[i]) p.className = S.history[i];
      else if (i === S.round - 1) p.className = 'cur';
      pips.append(p);
    }
  }

  function leaveLocal() {
    stopRound(); stopSoloTimers(); S.solo = null;
    S.code = null; S.token = null; S.players = []; S.phase = 'home'; S.round = 0; S.scores = [0, 0];
    store.del(SESSION_KEY);
    $('net').classList.add('hidden');
    S.closing = true;
    try { S.ws && S.ws.close(); } catch {}
    S.ws = null;
    setTimeout(() => { S.closing = false; }, 50);
    show('home'); setBusy(false);
  }

  // ---------- overlay ----------
  const overlay = $('overlay');
  function setOverlay(html) { // html seguro: solo se arman nodos propios
    overlay.classList.remove('hidden');
    overlay.textContent = '';
    for (const n of html) overlay.append(n);
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  window.DU = { el, beep, buzz, sleep, burst, float, confetti, arp };
  function hideOverlay() { overlay.classList.add('hidden'); overlay.textContent = ''; }
  function setWaitText(t) {
    if (overlay.classList.contains('hidden') || overlay.dataset.kind !== 'wait') return;
    setOverlay([el('h2', '', t)]);
  }

  // ---------- rondas ----------
  const gameEl = $('game');

  function stopRound() {
    S.runningRound = 0; S.duelHandler = null;
    if (S.cleanup) { try { S.cleanup(); } catch {} S.cleanup = null; }
    $('stage').textContent = '';
    $('stage').className = 'stage';
  }

  const RING = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="46"/><circle class="fg" cx="50" cy="50" r="46"/></svg>';

  async function startRound(m) {
    if (S.runningRound === m.round) return;
    stopRound();
    S.runningRound = m.round; S.round = m.round; S.totalRounds = m.totalRounds;
    const mine = m.round;
    S.phase = 'playing';
    show('game'); sizeFx(); renderHud(); keepAwake();
    const { GAMES, META } = window.DuelGames;
    const meta = META[m.game];
    $('stage').classList.add('pat-' + meta.pat);
    gameEl.style.setProperty('--g1', meta.g[0]); gameEl.style.setProperty('--g2', meta.g[1]);
    overlay.dataset.kind = 'intro';
    const ico = el('div', 'ico'); ico.innerHTML = meta.icon;
    setOverlay([ico, el('p', 'eyebrow', `Ronda ${m.round} de ${m.totalRounds}`), el('h2', '', meta.title), el('p', 'sub', meta.how)]);
    await sleep(2600);
    for (let n = 3; n >= 1; n--) {
      if (S.runningRound !== mine) return;
      const ring = el('div', 'ring'); ring.innerHTML = RING; ring.append(el('div', 'num', String(n)));
      setOverlay([ring]);
      beep(440, 0.08);
      await sleep(750);
    }
    if (S.runningRound !== mine) return;
    hideOverlay();
    beep(880, 0.12);
    let finished = false;
    const done = (value) => {
      if (finished || S.runningRound !== mine) return;
      finished = true;
      send({ t: 'result', round: mine, value });
      overlay.dataset.kind = 'wait';
      setOverlay([el('h2', '', 'Esperando al rival…')]);
    };
    // esperamos un frame para que el escenario ya tenga su tamaño real
    await new Promise((r) => requestAnimationFrame(r));
    if (S.runningRound !== mine) return;
    let net;
    if (meta.duel) {
      const opp = S.players[1 - S.you];
      net = {
        you: S.you, names: [S.players[S.you].name, opp ? opp.name : 'Rival'],
        send: (o) => send({ t: 'din', round: mine, ...o }),
        on: (fn) => { S.duelHandler = fn; },
        ready: () => send({ t: 'dready', round: mine }),
      };
    }
    S.cleanup = GAMES[m.game]($('stage'), rng(m.seed), done, net);
  }

  function showRoundEnd(m) {
    stopRound();
    show('game');
    S.scores = m.scores; S.round = m.round;
    S.history[m.round - 1] = m.winner === -1 ? 'tie' : m.winner === S.you ? 'me' : 'opp';
    renderHud();
    const meta = window.DuelGames.META[m.game];
    const mine = m.values[S.you]; const theirs = m.values[1 - S.you];
    const iWon = m.winner === S.you; const tie = m.winner === -1;
    overlay.dataset.kind = 'end';
    const ico = el('div', 'ico'); ico.innerHTML = meta.icon;
    const verdict = el('div', 'verdict ' + (tie ? '' : iWon ? 'win' : 'lose'), tie ? 'Empate' : iWon ? '¡Punto para ti!' : 'Punto para tu rival');
    const vs = el('div', 'vs');
    const mk = (cls, name, v, win) => { const d = el('div', cls + (win ? ' win' : '')); d.append(el('small', '', name), el('b', '', meta.fmt(v))); return d; };
    const oppName = S.players[1 - S.you] ? S.players[1 - S.you].name : 'Rival';
    vs.append(mk('m', 'Tú', mine, iWon), mk('o', oppName, theirs, !tie && !iWon));
    const nodes = [ico, el('p', 'eyebrow', meta.title), verdict, vs];
    if (m.over) {
      const champ = m.scores[S.you] > m.scores[1 - S.you];
      nodes.push(el('h2', '', champ ? '¡Ganaste el duelo!' : 'Perdiste el duelo'), el('p', 'sub', `Marcador final ${m.scores[S.you]} – ${m.scores[1 - S.you]}`));
      const again = el('button', 'btn primary', 'Revancha');
      again.onclick = () => { send({ t: 'ready' }); show('lobby'); };
      const out = el('button', 'btn ghost', 'Salir');
      out.onclick = () => { send({ t: 'leave' }); leaveLocal(); };
      nodes.push(again, out);
      S.phase = 'over';
      renderLobby();
      if (champ) { arp([523, 659, 784, 1047, 1319], 0.11); buzz([60, 40, 60, 40, 120]); setTimeout(() => confetti(170), 250); } else arp([392, 330, 262, 196], 0.14, 'sawtooth');
    } else {
      nodes.push(el('p', 'sub', 'Siguiente ronda en un momento…'));
      S.phase = 'between';
      if (iWon) { arp([659, 880], 0.08); buzz(60); setTimeout(() => confetti(36), 150); } else if (!tie) { arp([262, 196], 0.12, 'sawtooth'); buzz([40, 40, 40]); }
    }
    setOverlay(nodes);
  }

  // ---------- modo solo (contra el Robot, funciona sin conexion) ----------
  const DIFFS = [{ n: 'Fácil', f: 0.7 }, { n: 'Normal', f: 0.9 }, { n: 'Difícil', f: 1.1 }];
  function botScore(game, f) {
    const r = Math.random(); const j = 0.75 + r * 0.5; // variacion de +-25%
    switch (game) {
      case 'reaction': return Math.random() < 0.05 ? 0 : Math.max(1, Math.min(999, Math.round(1000 - (330 + (1 - f) * 320 + r * 110))));
      case 'aim': return Math.round(10 * f * j);
      case 'tap': return Math.round(36 * f * j);
      case 'memory': return Math.round(5.5 * f * j) * 20 + Math.floor(r * 3);
      case 'mole': return Math.min(22, Math.round(15 * f * j));
      case 'gonogo': return Math.round(700 * f * j);
      case 'stroop': return Math.round(12 * f * j);
      case 'math': return Math.round(13 * f * j);
      case 'timing': return Math.min(490, Math.round(340 * f * j));
      case 'odd': return Math.round(11 * f * j);
      case 'order': { const ms = Math.min(44000, Math.round((24000 / f) * j)); return 10000 + Math.round((45000 - ms) / 10); }
      case 'dodge': return Math.min(2000, Math.round(1250 * f * j));
      default: return 0;
    }
  }
  function startSolo() {
    stopSoloTimers();
    S.name = currentName(); S.code = 'SOLO'; S.token = null; S.you = 0;
    S.solo = { diff: 1, timer: null, bag: [], game: null, round: 0, total: 5, scores: [0, 0], got: true, last: null };
    S.players = [{ name: S.name, score: 0, ready: false, connected: true }, { name: 'Robot', score: 0, ready: true, connected: true }];
    S.games = Object.keys(window.DuelGames.META).filter((id) => !window.DuelGames.META[id].duel); S.round = 0; S.totalRounds = 5; S.scores = [0, 0]; S.history = []; S.phase = 'lobby';
    renderLobby(); renderHud(); show('lobby');
  }
  function stopSoloTimers() { if (S.solo && S.solo.timer) clearTimeout(S.solo.timer); }
  function localPick(L) {
    if (!L.bag.length) {
      L.bag = S.games.slice();
      for (let i = L.bag.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [L.bag[i], L.bag[k]] = [L.bag[k], L.bag[i]]; }
      if (L.bag[L.bag.length - 1] === L.game && L.bag.length > 1) L.bag.unshift(L.bag.pop());
    }
    return L.bag.pop();
  }
  function localStartRound() {
    const L = S.solo; if (!L) return;
    L.round += 1; L.got = false; L.game = localPick(L);
    onMsg({ t: 'round', round: L.round, totalRounds: L.total, game: L.game, seed: 1 + Math.floor(Math.random() * 2147483646) });
  }
  function localSend(o) {
    const L = S.solo; if (!L) return;
    if (o.t === 'ready') {
      if (S.phase === 'over') { L.round = 0; L.total = 5; L.scores = [0, 0]; L.bag = []; S.scores = [0, 0]; S.history = []; S.round = 0; S.totalRounds = 5; renderHud(); }
      S.phase = 'lobby'; L.timer = setTimeout(localStartRound, 700);
    } else if (o.t === 'result') {
      if (o.round !== L.round || L.got) return;
      L.got = true;
      const mine = Math.min(Math.max(Math.round(o.value), 0), 100000); const bot = botScore(L.game, DIFFS[L.diff].f);
      const winner = mine > bot ? 0 : bot > mine ? 1 : -1;
      if (winner >= 0) L.scores[winner] += 1;
      const over = L.round >= L.total && L.scores[0] !== L.scores[1];
      if (L.round >= L.total && L.scores[0] === L.scores[1]) L.total += 1;
      L.timer = setTimeout(() => {
        onMsg({ t: 'roundEnd', round: L.round, game: L.game, values: [mine, bot], winner, scores: L.scores.slice(), over });
        if (!over) L.timer = setTimeout(localStartRound, 4500);
      }, 900);
    }
  }

  // ---------- acciones de UI ----------
  function currentName() {
    const n = $('name').value.trim().slice(0, 14) || 'Jugador';
    S.name = n; store.set(NAME_KEY, n); return n;
  }

  async function createRoom() {
    $('homeErr').textContent = ''; setBusy(true);
    const name = currentName();
    try { await ensureConnected(); send({ t: 'create', name }); }
    catch { $('homeErr').textContent = 'No se pudo conectar. Si el servidor estaba dormido, espera 30 s y reintenta.'; setBusy(false); }
  }

  async function joinRoom(code) {
    $('homeErr').textContent = ''; setBusy(true);
    const name = currentName();
    try { await ensureConnected(); send({ t: 'join', code, name }); }
    catch { $('homeErr').textContent = 'No se pudo conectar. Si el servidor estaba dormido, espera 30 s y reintenta.'; setBusy(false); }
  }

  $('btnCreate').onclick = createRoom;
  $('btnSolo').onclick = startSolo;
  $('btnJoin').onclick = () => {
    const c = $('code').value.trim().toUpperCase();
    if (c.length !== 4) { $('homeErr').textContent = 'El código tiene 4 letras.'; return; }
    joinRoom(c);
  };
  $('code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('btnReady').onclick = () => { send({ t: 'ready' }); $('btnReady').disabled = true; };
  $('btnLeave').onclick = () => { send({ t: 'leave' }); leaveLocal(); };
  $('btnShare').onclick = async () => {
    const url = `${location.origin}/?sala=${S.code}`;
    const text = `Juguemos Duelo de Reflejos. Sala ${S.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Duelo de Reflejos', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); $('lobbyMsg').textContent = 'Enlace copiado ✔'; }
    } catch {}
  };

  // instalar PWA
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btnInstall').classList.remove('hidden'); });
  $('btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('btnInstall').classList.add('hidden'); };
  window.addEventListener('appinstalled', () => $('btnInstall').classList.add('hidden'));

  // ---------- arranque ----------
  $('name').value = store.get(NAME_KEY) || '';
  const qp = new URLSearchParams(location.search).get('sala');
  if (qp) $('code').value = qp.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  (async () => {
    let sess = null;
    try { sess = JSON.parse(store.get(SESSION_KEY) || 'null'); } catch {}
    if (sess && sess.code && sess.token) {
      S.name = sess.name || ''; S.code = sess.code; S.token = sess.token;
      $('net').classList.remove('hidden');
      try { await connect(); rawSend({ t: 'join', code: sess.code, token: sess.token, name: sess.name }); }
      catch { onDisconnect(); }
    }
  })();

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) checkVersion(); });
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
