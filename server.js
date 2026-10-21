'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

const ROUNDS = 5;
const GAMES = ['reaction', 'aim', 'tap', 'memory', 'mole', 'gonogo', 'stroop', 'math', 'timing', 'odd', 'order', 'dodge'];
const RESULT_TIMEOUT_MS = 60000; // tope por ronda si alguien no responde
const BETWEEN_ROUNDS_MS = 4500;
const RECONNECT_GRACE_MS = 90000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_MSGS_PER_SEC = 30;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- HTTP estatico ----------
const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    // revalidar siempre: el navegador pregunta con ETag y recibe 304 si no cambio
    const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + '"';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

// ---------- Salas ----------
const rooms = new Map();

function makeCode() {
  for (let i = 0; i < 100; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('sin codigos libres');
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
  return s || 'Jugador';
}

function publicPlayers(room) {
  return room.players.map((p) => ({ name: p.name, score: p.score, ready: p.ready, connected: p.connected }));
}

function broadcast(room, obj) {
  for (const p of room.players) send(p.ws, obj);
}

function snapshot(room, idx) {
  const me = room.players[idx];
  return {
    t: 'snapshot',
    code: room.code,
    you: idx,
    phase: room.phase,
    players: publicPlayers(room),
    round: room.round,
    totalRounds: room.totalRounds,
    game: room.game,
    seed: room.seed,
    submitted: !!me && me.result !== null,
  };
}

function pushState(room) {
  broadcast(room, { t: 'players', players: publicPlayers(room), phase: room.phase });
}

// bolsa barajada: no se repite ningun juego hasta haber salido todos
function pickGame(room) {
  if (!room.bag || room.bag.length === 0) {
    room.bag = GAMES.slice();
    for (let i = room.bag.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [room.bag[i], room.bag[j]] = [room.bag[j], room.bag[i]];
    }
    if (room.bag[room.bag.length - 1] === room.game) room.bag.unshift(room.bag.pop());
  }
  return room.bag.pop();
}

function clearTimers(room) {
  clearTimeout(room.roundTimer);
  clearTimeout(room.nextTimer);
}

function startRound(room) {
  clearTimers(room);
  room.round += 1;
  room.game = pickGame(room);
  room.seed = crypto.randomInt(1, 2 ** 31);
  room.phase = 'playing';
  for (const p of room.players) p.result = null;
  broadcast(room, {
    t: 'round',
    round: room.round,
    totalRounds: room.totalRounds,
    game: room.game,
    seed: room.seed,
  });
  room.roundTimer = setTimeout(() => endRound(room), RESULT_TIMEOUT_MS);
}

function endRound(room) {
  if (room.phase !== 'playing') return;
  clearTimeout(room.roundTimer);
  room.phase = 'between';
  const [a, b] = room.players;
  const ra = a.result ?? 0;
  const rb = b.result ?? 0;
  let winner = -1;
  if (ra > rb) winner = 0;
  else if (rb > ra) winner = 1;
  if (winner >= 0) room.players[winner].score += 1;

  const [sa, sb] = [a.score, b.score];
  const over = room.round >= room.totalRounds && sa !== sb;
  if (room.round >= room.totalRounds && sa === sb) room.totalRounds += 1; // muerte subita
  broadcast(room, {
    t: 'roundEnd',
    round: room.round,
    game: room.game,
    values: [ra, rb],
    winner,
    scores: [sa, sb],
    over,
  });
  if (over) {
    room.phase = 'over';
    room.players.forEach((p) => (p.ready = false));
  } else {
    room.nextTimer = setTimeout(() => {
      if (room.players.length === 2 && room.players.every((p) => p.connected)) startRound(room);
      else room.phase = 'paused';
    }, BETWEEN_ROUNDS_MS);
  }
}

function resetMatch(room) {
  clearTimers(room);
  room.round = 0;
  room.totalRounds = ROUNDS;
  room.game = null;
  room.phase = 'lobby';
  for (const p of room.players) {
    p.score = 0;
    p.ready = false;
    p.result = null;
  }
}

function destroyRoom(room, reason) {
  clearTimers(room);
  clearTimeout(room.graceTimer);
  broadcast(room, { t: 'closed', reason });
  rooms.delete(room.code);
}

function newPlayer(ws, name) {
  return {
    ws,
    token: crypto.randomBytes(12).toString('hex'),
    name: cleanName(name),
    score: 0,
    ready: false,
    connected: true,
    result: null,
  };
}

// ---------- Mensajes ----------
function handle(ws, msg) {
  switch (msg.t) {
    case 'ping':
      return send(ws, { t: 'pong' });

    case 'create': {
      if (ws.room) return;
      const code = makeCode();
      const room = {
        code, players: [], phase: 'lobby', round: 0, totalRounds: ROUNDS,
        game: null, seed: 0, roundTimer: null, nextTimer: null, graceTimer: null, lastActive: Date.now(),
      };
      const p = newPlayer(ws, msg.name);
      room.players.push(p);
      rooms.set(code, room);
      ws.room = room;
      ws.player = p;
      send(ws, { ...snapshot(room, 0), t: 'joined', token: p.token });
      return;
    }

    case 'join': {
      if (ws.room) return;
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', code: 'no_room', message: 'Esa sala no existe o ya cerró.' });

      // reconexion con token
      const idx = room.players.findIndex((p) => msg.token && p.token === msg.token);
      if (idx >= 0) {
        const p = room.players[idx];
        if (p.ws && p.ws !== ws) { p.ws.room = null; try { p.ws.close(); } catch {} }
        p.ws = ws;
        p.connected = true;
        ws.room = room;
        ws.player = p;
        clearTimeout(room.graceTimer);
        send(ws, { ...snapshot(room, idx), t: 'joined', token: p.token });
        pushState(room);
        if (room.phase === 'paused' && room.players.length === 2 && room.players.every((q) => q.connected)) {
          room.nextTimer = setTimeout(() => startRound(room), 1500);
        }
        return;
      }

      if (room.players.length >= 2) return send(ws, { t: 'error', code: 'full', message: 'La sala ya está llena.' });
      const p = newPlayer(ws, msg.name);
      room.players.push(p);
      ws.room = room;
      ws.player = p;
      send(ws, { ...snapshot(room, 1), t: 'joined', token: p.token });
      pushState(room);
      return;
    }

    case 'ready': {
      const room = ws.room;
      if (!room || (room.phase !== 'lobby' && room.phase !== 'over')) return;
      if (room.phase === 'over') resetMatch(room);
      ws.player.ready = true;
      pushState(room);
      if (room.players.length === 2 && room.players.every((p) => p.ready && p.connected)) {
        room.nextTimer = setTimeout(() => startRound(room), 800);
      }
      return;
    }

    case 'result': {
      const room = ws.room;
      if (!room || room.phase !== 'playing') return;
      if (msg.round !== room.round) return;
      const p = ws.player;
      if (p.result !== null) return;
      const v = Number(msg.value);
      if (!Number.isFinite(v)) return;
      p.result = Math.min(Math.max(Math.round(v), 0), 100000);
      send(ws, { t: 'ack', round: room.round });
      broadcast(room, { t: 'oppDone', round: room.round, by: room.players.indexOf(p) });
      if (room.players.every((q) => q.result !== null)) endRound(room);
      return;
    }

    case 'leave': {
      const room = ws.room;
      if (!room) return;
      ws.room = null;
      destroyRoom(room, 'left');
      return;
    }
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.player = null;
  ws.msgCount = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    if (++ws.msgCount > MAX_MSGS_PER_SEC) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(ws, msg);
      if (ws.room) ws.room.lastActive = Date.now();
    } catch (e) {
      console.error('handler error', e);
    }
  });
  ws.on('close', () => {
    const room = ws.room;
    const p = ws.player;
    if (!room || !p || p.ws !== ws) return;
    p.connected = false;
    p.ready = room.phase === 'lobby' ? false : p.ready;
    pushState(room);
    if (room.players.every((q) => !q.connected)) {
      room.graceTimer = setTimeout(() => destroyRoom(room, 'timeout'), RECONNECT_GRACE_MS);
    } else {
      clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => destroyRoom(room, 'opponent_gone'), RECONNECT_GRACE_MS);
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.msgCount = 0;
    try { ws.ping(); } catch {}
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.lastActive > EMPTY_ROOM_TTL_MS && room.phase !== 'playing') destroyRoom(room, 'idle');
  }
}, 1000 * 10).unref();

// el contador de mensajes se reinicia cada segundo
setInterval(() => { for (const ws of wss.clients) ws.msgCount = 0; }, 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Duelo de reflejos escuchando en :${PORT}`));
}
module.exports = { server, wss, rooms };
