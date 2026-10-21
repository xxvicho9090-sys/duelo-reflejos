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
    pending: [],
  };

  function show(id) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === id);
  }

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
  function send(o) { if (S.ws && S.ws.readyState === 1) rawSend(o); else S.pending.push(o); }

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
      case 'snapshot': applySnapshot(m); break;
      case 'players':
        S.players = m.players; S.phase = m.phase;
        renderLobby(); renderHud();
        if (S.phase === 'lobby' && $('game').classList.contains('active')) { stopRound(); show('lobby'); }
        break;
      case 'round': startRound(m); break;
      case 'ack': break;
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
  }

  function applySnapshot(m) {
    S.players = m.players; S.phase = m.phase; S.round = m.round; S.totalRounds = m.totalRounds; S.you = m.you;
    S.scores = m.players.map((p) => p.score);
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
    const two = S.players.length === 2;
    const me = S.players[S.you];
    $('lobbyMsg').textContent = two ? (me && me.ready ? 'Esperando que tu rival esté listo…' : '¡Ya están los dos! Pulsa listo.') : 'Esperando al otro jugador… compárteles el código.';
    $('btnReady').disabled = !two || (me && me.ready);
    $('btnReady').textContent = S.phase === 'over' ? 'Revancha' : '¡Estoy listo!';
  }

  function renderHud() {
    const a = S.players[S.you]; const b = S.players[1 - S.you];
    $('hudNameA').textContent = a ? a.name : 'Tú';
    $('hudNameB').textContent = b ? b.name : 'Rival';
    $('hudScoreA').textContent = S.scores[S.you] ?? 0;
    $('hudScoreB').textContent = S.scores[1 - S.you] ?? 0;
    $('hudRound').textContent = S.round ? `Ronda ${S.round}/${S.totalRounds}` : '';
  }

  function leaveLocal() {
    stopRound();
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
  function hideOverlay() { overlay.classList.add('hidden'); overlay.textContent = ''; }
  function setWaitText(t) {
    if (overlay.classList.contains('hidden') || overlay.dataset.kind !== 'wait') return;
    setOverlay([el('h2', '', t)]);
  }

  // ---------- rondas ----------
  const GAMES = {};
  const META = {
    reaction: { title: 'Reflejo', how: 'Espera a que la pantalla se ponga VERDE y toca lo más rápido que puedas. Si tocas antes, pierdes la ronda.', fmt: (v) => (v === 0 ? 'Muy pronto' : `${1000 - v} ms`) },
    aim: { title: 'Puntería', how: 'Toca los círculos antes de que desaparezcan. Tienes 10 segundos.', fmt: (v) => `${v} aciertos` },
    tap: { title: 'Toques rápidos', how: 'Toca el botón tantas veces como puedas en 5 segundos.', fmt: (v) => `${v} toques` },
    memory: { title: 'Memoria', how: 'Mira la secuencia de colores y repítela. Cada nivel agrega un color.', fmt: (v) => `${Math.floor(v / 20)} niveles` },
  };

  function stopRound() {
    S.runningRound = 0;
    if (S.cleanup) { try { S.cleanup(); } catch {} S.cleanup = null; }
    $('stage').textContent = '';
    $('stage').className = 'stage';
  }

  async function startRound(m) {
    if (S.runningRound === m.round) return;
    stopRound();
    S.runningRound = m.round; S.round = m.round; S.totalRounds = m.totalRounds;
    const mine = m.round;
    show('game'); renderHud(); keepAwake();
    const meta = META[m.game];
    overlay.dataset.kind = 'intro';
    setOverlay([el('p', 'sub', `Ronda ${m.round} de ${m.totalRounds}`), el('h2', '', meta.title), el('p', 'sub', meta.how)]);
    await sleep(2600);
    for (let n = 3; n >= 1; n--) {
      if (S.runningRound !== mine) return;
      setOverlay([el('div', 'num', String(n))]);
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
    S.cleanup = GAMES[m.game]($('stage'), rng(m.seed), done);
  }

  function showRoundEnd(m) {
    if (S.runningRound !== m.round && S.runningRound !== 0) { /* resultado de otra ronda: igual lo mostramos */ }
    stopRound();
    show('game');
    S.scores = m.scores; S.round = m.round;
    renderHud();
    const meta = META[m.game];
    const mine = m.values[S.you]; const theirs = m.values[1 - S.you];
    const iWon = m.winner === S.you; const tie = m.winner === -1;
    overlay.dataset.kind = 'end';
    const verdict = el('div', 'verdict ' + (tie ? '' : iWon ? 'win' : 'lose'), tie ? 'Empate' : iWon ? '¡Punto para ti!' : 'Punto para tu rival');
    const vs = el('div', 'vs');
    const mk = (name, v, win) => { const d = el('div', win ? 'win' : ''); d.append(el('small', '', name), el('b', '', meta.fmt(v))); return d; };
    vs.append(mk('Tú', mine, iWon), mk(S.players[1 - S.you] ? S.players[1 - S.you].name : 'Rival', theirs, !tie && !iWon));
    const nodes = [el('p', 'sub', meta.title), verdict, vs, el('p', 'sub', `Marcador ${m.scores[S.you]} – ${m.scores[1 - S.you]}`)];
    if (m.over) {
      const champ = m.scores[S.you] > m.scores[1 - S.you];
      nodes.push(el('h2', '', champ ? '🏆 ¡Ganaste el duelo!' : 'Perdiste el duelo'));
      const again = el('button', 'btn primary', 'Revancha');
      again.onclick = () => { send({ t: 'ready' }); show('lobby'); };
      const out = el('button', 'btn ghost', 'Salir');
      out.onclick = () => { send({ t: 'leave' }); leaveLocal(); };
      nodes.push(again, out);
      S.phase = 'over';
      renderLobby();
      if (champ) beep(988, 0.3, 'triangle'); else beep(220, 0.3, 'sawtooth');
    } else {
      nodes.push(el('p', 'sub', 'Siguiente ronda en un momento…'));
      if (iWon) { beep(784, 0.15); buzz(60); } else if (!tie) { beep(196, 0.2, 'sawtooth'); buzz([40, 40, 40]); }
    }
    setOverlay(nodes);
  }

  // ---------- minijuegos ----------
  // Cada juego recibe (stage, rand, done) y devuelve una funcion de limpieza.
  // El valor enviado siempre es "mas alto = mejor".

  GAMES.reaction = (stage, rand, done) => {
    const wait = 1500 + Math.floor(rand() * 3200);
    let t0 = 0; let green = false; let over = false; let timer; let guard;
    stage.className = 'stage red';
    const msg = el('div', 'big', 'Espera…');
    stage.append(msg);
    timer = setTimeout(() => {
      requestAnimationFrame(() => {
        if (over) return;
        green = true; t0 = performance.now();
        stage.className = 'stage green';
        msg.textContent = '¡YA!';
        beep(1000, 0.1, 'square', 0.1);
        guard = setTimeout(() => finish(1), 3000);
      });
    }, wait);
    function finish(v) { if (over) return; over = true; clearTimeout(timer); clearTimeout(guard); done(v); }
    const onDown = () => {
      if (over) return;
      if (!green) { buzz(120); finish(0); return; }
      const ms = Math.min(999, Math.max(1, Math.round(performance.now() - t0)));
      finish(1000 - ms);
    };
    stage.addEventListener('pointerdown', onDown);
    return () => { over = true; clearTimeout(timer); clearTimeout(guard); stage.removeEventListener('pointerdown', onDown); };
  };

  GAMES.aim = (stage, rand, done) => {
    const DURATION = 10000; const LIFE = 1100;
    const spots = Array.from({ length: 80 }, () => [10 + rand() * 80, 12 + rand() * 76]);
    let i = 0; let hits = 0; let over = false; let tgtTimer; const t0 = performance.now();
    const bar = el('div', 'timebar'); const cnt = el('div', 'counter', '0');
    stage.append(bar, cnt);
    bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: DURATION, fill: 'forwards', easing: 'linear' });
    let cur = null;
    function next() {
      if (over) return;
      if (cur) cur.remove();
      const [x, y] = spots[i % spots.length]; i++;
      cur = el('button', 'target');
      cur.style.left = x + '%'; cur.style.top = y + '%';
      cur.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (over || e.currentTarget !== cur) return;
        hits++; cnt.textContent = String(hits); beep(600 + hits * 12, 0.05, 'triangle', 0.1); buzz(15);
        clearTimeout(tgtTimer); next();
      });
      stage.append(cur);
      tgtTimer = setTimeout(next, LIFE);
    }
    next();
    const end = setTimeout(() => { over = true; clearTimeout(tgtTimer); if (cur) cur.remove(); done(hits); }, DURATION);
    void t0;
    return () => { over = true; clearTimeout(tgtTimer); clearTimeout(end); };
  };

  GAMES.tap = (stage, rand, done) => {
    void rand;
    const DURATION = 5000; let n = 0; let started = false; let over = false; let end;
    const bar = el('div', 'timebar'); const cnt = el('div', 'counter', '0');
    const btn = el('button', 'tapbtn', 'TOCA');
    stage.append(bar, cnt, btn);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (over) return;
      if (!started) {
        started = true;
        bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: DURATION, fill: 'forwards', easing: 'linear' });
        end = setTimeout(() => { over = true; done(n); }, DURATION);
      }
      n++; cnt.textContent = String(n); buzz(8);
    });
    // si nunca toca, cerramos igual para no bloquear a su rival
    const guard = setTimeout(() => { if (!started && !over) { over = true; done(0); } }, 15000);
    return () => { over = true; clearTimeout(end); clearTimeout(guard); };
  };

  GAMES.memory = (stage, rand, done) => {
    const MAX = 12; const TOTAL_LIMIT = 32000;
    const seq = Array.from({ length: MAX }, () => Math.floor(rand() * 4));
    const FREQ = [262, 330, 392, 523];
    const grid = el('div', 'pads');
    const pads = [0, 1, 2, 3].map((i) => { const p = el('button', 'pad'); p.dataset.i = String(i); grid.append(p); return p; });
    const status = el('div', 'counter', '');
    stage.append(status, grid);
    let level = 1; let pos = 0; let accepting = false; let over = false; let completed = 0; let partial = 0;
    const flash = async (i, ms = 420) => { pads[i].classList.add('on'); beep(FREQ[i], ms / 1000, 'sine', 0.2); await sleep(ms); pads[i].classList.remove('on'); await sleep(160); };
    const finish = () => { if (over) return; over = true; clearTimeout(limit); done(completed * 20 + partial); };
    const limit = setTimeout(finish, TOTAL_LIMIT);
    async function play() {
      accepting = false; pos = 0; partial = 0;
      status.textContent = 'Mira…';
      await sleep(500);
      for (let k = 0; k < level; k++) { if (over) return; await flash(seq[k], Math.max(240, 460 - level * 20)); }
      if (over) return;
      status.textContent = 'Tu turno';
      accepting = true;
    }
    stage.addEventListener('pointerdown', onDown);
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
    play();
    return () => { over = true; clearTimeout(limit); stage.removeEventListener('pointerdown', onDown); };
  };

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
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
})();
