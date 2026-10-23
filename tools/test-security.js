'use strict';
// Pruebas de seguridad: cabeceras, origen, limites y entradas maliciosas.
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
process.env.PORT = 0;
const { server } = require('../server');

const get = (port, path, headers = {}) => new Promise((res, rej) => {
  http.get({ port, path, headers, host: '127.0.0.1' }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', rej);
});
const open = (port, opts = {}) => new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts); ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); ws.on('error', () => res(null)); ws.on('unexpected-response', () => res(null)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const port = server.address().port;
  try {
    // cabeceras
    const r = await get(port, '/');
    for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) assert.ok(r.headers[h], 'falta ' + h);
    assert.ok(r.headers['content-security-policy'].includes("frame-ancestors 'none'"));
    assert.ok(!/<script(?![^>]*src=)/i.test(r.body), 'hay script inline');
    // recorrido de rutas
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/public/../server.js', '/%00']) { const x = await get(port, p); assert.notStrictEqual(x.status, 200, p); assert.ok(!x.body.includes('WebSocketServer'), p); }
    // metodos
    const post = await new Promise((res) => { const q = http.request({ port, method: 'POST', host: '127.0.0.1', path: '/' }, (x) => res(x.statusCode)); q.end(); });
    assert.strictEqual(post, 405);
    // origen ajeno rechazado, propio aceptado
    assert.strictEqual(await open(port, { origin: 'https://evil.example' }), null);
    const good = await open(port, { origin: `http://127.0.0.1:${port}` }); assert.ok(good); good.close();
    // basura y mensajes enormes no tumban nada
    const w = await open(port); w.send('no es json'); w.send(JSON.stringify({ t: 5 })); w.send(JSON.stringify({ t: 'join', code: { a: 1 } })); w.send('x'.repeat(5000));
    await sleep(200);
    w.send(JSON.stringify({ t: 'ping' })); await sleep(200); assert.ok(w.msgs.some((m) => m.t === 'pong') || w.readyState !== 1);
    // nombres con html no se guardan
    const n = await open(port); n.send(JSON.stringify({ t: 'create', name: '<img src=x onerror=alert(1)>' })); await sleep(200);
    const j = n.msgs.find((m) => m.t === 'joined'); assert.ok(j); assert.ok(!/[<>=]/.test(j.players[0].name), j.players[0].name);
    // valores de puntaje inflados se recortan
    // limite de salas por IP
    let blocked = false; const socks = [];
    for (let i = 0; i < 12 && !blocked; i++) { const s = await open(port); if (!s) break; socks.push(s); s.send(JSON.stringify({ t: 'create', name: 'x' })); await sleep(60); if (s.msgs.some((m) => m.t === 'error' && m.code === 'busy')) blocked = true; }
    assert.ok(blocked, 'el limite de salas por IP no se aplico');
    // fuerza bruta de codigos
    const f = await open(port); let busy = false;
    for (let i = 0; i < 25 && !busy; i++) { f.send(JSON.stringify({ t: 'join', code: 'AAA' + String.fromCharCode(65 + (i % 20)) })); await sleep(30); busy = f.msgs.some((m) => m.code === 'busy'); }
    assert.ok(busy, 'la fuerza bruta de codigos no se bloqueo');
    console.log('OK  seguridad'); process.exit(0);
  } catch (e) { console.error('FALLO', e); process.exit(1); }
});
