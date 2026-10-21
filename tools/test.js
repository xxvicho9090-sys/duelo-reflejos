'use strict';
// Partida completa con dos clientes simulados, incluida una reconexion.
const assert = require('assert');
const WebSocket = require('ws');
process.env.PORT = 0;
const { server, wss } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const q = []; const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d); const i = waiters.findIndex((w) => w.t === m.t); if (i >= 0) waiters.splice(i, 1)[0].res(m); else q.push(m); });
  return {
    ws, open: new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    next(t) { const i = q.findIndex((m) => m.t === t); if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]); return new Promise((res, rej) => { waiters.push({ t, res }); setTimeout(() => rej(new Error('timeout esperando ' + t + ' q=' + JSON.stringify(q))), 8000); }); },
  };
}

server.listen(0, async () => {
  const port = server.address().port;
  try {
    const a = client(port), b = client(port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'create', name: 'Ana' });
    const ja = await a.next('joined');
    assert.strictEqual(ja.code.length, 4);
    b.send({ t: 'join', code: ja.code.toLowerCase(), name: 'Beto' });
    const jb = await b.next('joined');
    assert.strictEqual(jb.you, 1);

    const c = client(port); await c.open; c.send({ t: 'join', code: ja.code, name: 'X' });
    assert.strictEqual((await c.next('error')).code, 'full'); c.ws.close();

    a.send({ t: 'ready' }); b.send({ t: 'ready' });
    let reconnected = false; let lastEnd;
    for (let r = 1; r <= 5; r++) {
      const ra = await a.next('round'); const rb = await b.next('round');
      assert.strictEqual(ra.seed, rb.seed); assert.strictEqual(ra.round, r);
      a.send({ t: 'result', round: r, value: 500 + r });
      a.send({ t: 'result', round: r, value: 99999 }); // duplicado: debe ignorarse
      if (r === 3) { // Beto se cae y vuelve con su token antes de responder
        b.ws.close(); await new Promise((s) => setTimeout(s, 200));
        const b2 = client(port); await b2.open;
        b2.send({ t: 'join', code: ja.code, token: jb.token });
        const snap = await b2.next('joined');
        assert.strictEqual(snap.phase, 'playing'); assert.strictEqual(snap.submitted, false);
        Object.assign(b, b2); reconnected = true;
      }
      b.send({ t: 'result', round: r, value: r % 2 ? 100 : 900 });
      lastEnd = await a.next('roundEnd'); await b.next('roundEnd');
      assert.strictEqual(lastEnd.values[0], 500 + r);
      if (lastEnd.over) break;
    }
    assert.ok(reconnected);
    assert.ok(lastEnd.over, 'la partida debia terminar');
    console.log('OK  marcador final', lastEnd.scores);
    a.send({ t: 'leave' });
    await b.next('closed');
    console.log('OK  todo');
    process.exit(0);
  } catch (e) { console.error('FALLO', e); process.exit(1); }
});
