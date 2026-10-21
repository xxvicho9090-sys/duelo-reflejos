'use strict';
// Duelos en tiempo real con dos clientes simulados.
const assert = require('assert');
const WebSocket = require('ws');
process.env.PORT = 0;
const { server } = require('../server');

function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const handlers = [];
  ws.on('message', (d) => { const m = JSON.parse(d); handlers.slice().forEach((h) => h(m)); });
  return {
    ws, open: new Promise((r) => ws.on('open', r)),
    send: (o) => ws.send(JSON.stringify(o)),
    on: (h) => handlers.push(h),
    wait(pred, ms = 20000) { return new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout ' + pred.toString().slice(0, 70))), ms); const h = (m) => { if (pred(m)) { clearTimeout(to); handlers.splice(handlers.indexOf(h), 1); res(m); } }; handlers.push(h); }); },
  };
}

async function setup(port, game) {
  const a = client(port), b = client(port); await Promise.all([a.open, b.open]);
  const ja = a.wait((m) => m.t === 'joined'); a.send({ t: 'create', name: 'A' }); const j = await ja;
  const jb = b.wait((m) => m.t === 'joined'); b.send({ t: 'join', code: j.code, name: 'B' }); await jb;
  a.send({ t: 'settings', games: [game] });
  const ra = a.wait((m) => m.t === 'round'); const rb = b.wait((m) => m.t === 'round');
  a.send({ t: 'ready' }); b.send({ t: 'ready' });
  const [r1] = await Promise.all([ra, rb]);
  assert.strictEqual(r1.game, game);
  const sa = a.wait((m) => m.t === 'ds' && m.k === 'start'); const sb = b.wait((m) => m.t === 'ds' && m.k === 'start');
  a.send({ t: 'dready', round: r1.round }); b.send({ t: 'dready', round: r1.round });
  const [s1] = await Promise.all([sa, sb]);
  const end = a.wait((m) => m.t === 'roundEnd'); end.catch(() => {});
  return { a, b, round: r1.round, start: s1, end };
}
const din = (c, round, o) => c.send({ t: 'din', round, ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

server.listen(0, async () => {
  const port = server.address().port;
  try {
    // tira y afloja: A tira sin parar
    { const g = await setup(port, 'tug'); for (let i = 0; i < 70; i++) { din(g.a, g.round, { k: 'tap' }); await sleep(40); }
      const e = await g.end; assert.strictEqual(e.winner, 0); console.log('OK  tug', e.values); }
    // piedra papel tijera: A siempre piedra, B siempre tijera
    { const g = await setup(port, 'rps'); const pick = (c, v) => c.on((m) => { if (m.t === 'ds' && m.k === 'prompt') din(c, g.round, { k: 'pick', v }); });
      pick(g.a, 0); pick(g.b, 2); din(g.a, g.round, { k: 'pick', v: 0 }); din(g.b, g.round, { k: 'pick', v: 2 });
      const e = await g.end; assert.strictEqual(e.winner, 0); assert.deepStrictEqual(e.values, [2, 0]); console.log('OK  rps', e.values); }
    // cuatro en linea: A apila en la columna 0, B en la 1
    { const g = await setup(port, 'connect4'); let my = 0;
      const play = (c, col) => c.on((m) => { if (m.t === 'ds' && (m.k === 'move' || m.k === 'start') && m.turn === (c === g.a ? 0 : 1)) din(c, g.round, { k: 'drop', c: col }); });
      play(g.a, 0); play(g.b, 1); void my; din(g.a, g.round, { k: 'drop', c: 0 });
      const e = await g.end; assert.strictEqual(e.winner, 0); console.log('OK  connect4'); }
    // pong: llegan estados y la pelota se mueve
    { const g = await setup(port, 'pong'); const m1 = await g.a.wait((m) => m.t === 'ds' && m.k === 's' && m.fz === 0); await sleep(300);
      const m2 = await g.a.wait((m) => m.t === 'ds' && m.k === 's'); assert.ok(m1.b[1] !== m2.b[1] || m1.b[0] !== m2.b[0]); din(g.a, g.round, { k: 'p', x: 0.8 }); console.log('OK  pong'); a_leave(g); }
    // tanques: A se mueve a un lado con linea libre y dispara
    { const g = await setup(port, 'tanks'); let lastS; g.a.on((m) => { if (m.t === 'ds' && m.k === 's') lastS = m; }); g.end.catch(() => console.log('DBG', JSON.stringify(lastS))); din(g.a, g.round, { k: 'm', x: 0.05, y: 1.4 }); await sleep(1200); din(g.a, g.round, { k: 'm', x: 0.05, y: 0.2 }); await sleep(2800); din(g.a, g.round, { k: 'f', on: true });
      const e = await g.end; assert.strictEqual(e.winner, 0); console.log('OK  tanks', e.values); }
    console.log('OK  todos los duelos'); process.exit(0);
  } catch (e) { console.error('FALLO', e); process.exit(1); }
});
function a_leave(g) { g.a.send({ t: 'leave' }); }
