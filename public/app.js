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
    const two = S.players.length === 2;
    const me = S.players[S.you];
    $('lobbyMsg').textContent = two ? (me && me.ready ? 'Esperando que tu rival esté listo…' : '¡Ya están los dos! Pulsa listo.') : 'Esperando al otro jugador… compárteles el código.';
    $('btnReady').disabled = !two || (me && me.ready);
    $('btnReady').textContent = S.phase === 'over' ? 'Revancha' : '¡Estoy listo!';
  }

  function renderPicker() {
    const box = $('gamePick');
    const META = window.DuelGames && window.DuelGames.META;
    if (!META) return;
    const host = S.you === 0;
    box.textContent = '';
    for (const id of Object.keys(META)) {
      const b = document.createElement('button');
      b.textContent = META[id].title;
      b.className = S.games.includes(id) ? 'on' : '';
      b.disabled = !host;
      b.setAttribute('aria-pressed', S.games.includes(id) ? 'true' : 'false');
      b.onclick = () => {
        const set = new Set(S.games);
        if (set.has(id)) { if (set.size === 1) return; set.delete(id); } else set.add(id);
        S.games = Object.keys(META).filter((g) => set.has(g));
        send({ t: 'settings', games: S.games });
        renderPicker();
      };
      box.append(b);
    }
    const all = document.createElement('button');
    if (host && S.games.length < Object.keys(META).length) {
      all.textContent = 'Todos'; all.onclick = () => { S.games = Object.keys(META); send({ t: 'settings', games: S.games }); renderPicker(); };
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
  window.DU = { el, beep, buzz, sleep };
  function hideOverlay() { overlay.classList.add('hidden'); overlay.textContent = ''; }
  function setWaitText(t) {
    if (overlay.classList.contains('hidden') || overlay.dataset.kind !== 'wait') return;
    setOverlay([el('h2', '', t)]);
  }

  // ---------- rondas ----------
  const gameEl = $('game');

  function stopRound() {
    S.runningRound = 0;
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
    show('game'); renderHud(); keepAwake();
    const { GAMES, META } = window.DuelGames;
    const meta = META[m.game];
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
    S.cleanup = GAMES[m.game]($('stage'), rng(m.seed), done);
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
      if (champ) { beep(988, 0.3, 'triangle'); buzz([60, 40, 60, 40, 120]); } else beep(220, 0.3, 'sawtooth');
    } else {
      nodes.push(el('p', 'sub', 'Siguiente ronda en un momento…'));
      if (iWon) { beep(784, 0.15); buzz(60); } else if (!tie) { beep(196, 0.2, 'sawtooth'); buzz([40, 40, 40]); }
    }
    setOverlay(nodes);
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
