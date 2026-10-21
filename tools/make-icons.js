'use strict';
// Genera iconos PNG (rayo sobre fondo oscuro) sin dependencias.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function make(size, maskable) {
  const bolt = [[0.58, 0.12], [0.30, 0.54], [0.47, 0.54], [0.40, 0.88], [0.72, 0.43], [0.54, 0.43], [0.64, 0.12]];
  const scale = maskable ? 0.8 : 1; // zona segura para maskable
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const bu = (u - 0.5) / scale + 0.5, bv = (v - 0.5) / scale + 0.5;
      let r = 15, g = 18, b = 38, a = 255;
      const dx = u - 0.5, dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (!maskable) { // esquinas redondeadas
        const rx = Math.max(Math.abs(dx) - 0.38, 0), ry = Math.max(Math.abs(dy) - 0.38, 0);
        if (Math.sqrt(rx * rx + ry * ry) > 0.12) a = 0;
      }
      const glow = Math.max(0, 1 - d / 0.5) * 40;
      r += glow * 0.5; g += glow * 0.4; b += glow * 0.9;
      if (inPoly(bu, bv, bolt)) { r = 255; g = 210; b = 63; }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.min(255, r); raw[o + 1] = Math.min(255, g); raw[o + 2] = Math.min(255, b); raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), make(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), make(512, false));
fs.writeFileSync(path.join(out, 'maskable-512.png'), make(512, true));
console.log('iconos listos');
