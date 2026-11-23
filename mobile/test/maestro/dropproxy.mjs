// Lost connections on purpose, for checking that the outbox never does anything twice (E38-10).
// A proxy for the emulator (PORT, default 8151, to the server at UPSTREAM_PORT, default 8150): the first
// DROP_SYNC answers to POST /api/mobile/sync and the first DROP_FILE answers to the photo route are
// fully done by the server, then the connection to the phone is cut before the answer reaches it;
// the first CUT_UPLOAD photo uploads are cut half-way through the file. Connect the app to
// http://10.0.2.2:8151, report with photos, and check on the server that it arrived once
// (docs/mobile.md, "End-to-end flows"). Plain HTTP, development builds only.
//   node mobile/test/maestro/dropproxy.mjs
import http from 'node:http';
let dropSync = Number(process.env.DROP_SYNC ?? 1), dropFile = Number(process.env.DROP_FILE ?? 1), cutUpload = Number(process.env.CUT_UPLOAD ?? 1);
const UPSTREAM = Number(process.env.UPSTREAM_PORT ?? 8150);
const PORT = Number(process.env.PORT ?? 8151);
const log = (...a) => console.log(new Date().toISOString(), ...a);
http.createServer((req, res) => {
  const isSync = req.method === 'POST' && req.url.startsWith('/api/mobile/sync') && !req.url.includes('attachment');
  const isFile = req.url.startsWith('/api/mobile/sync/attachment');
  if (isFile && cutUpload > 0) {
    cutUpload--;
    let n = 0;
    const up = http.request({ host: '127.0.0.1', port: UPSTREAM, path: req.url, method: req.method, headers: req.headers });
    up.on('error', () => log('upstream aborted (expected)'));
    req.on('data', (c) => { n += c.length; if (n < 1500) up.write(c); else { log('CUT upload half-way', req.url.slice(0, 80)); up.destroy(); req.socket.destroy(); } });
    return;
  }
  const up = http.request({ host: '127.0.0.1', port: UPSTREAM, path: req.url, method: req.method, headers: req.headers }, (ur) => {
    if ((isSync && dropSync > 0) || (isFile && dropFile > 0)) {
      if (isSync) dropSync--; else dropFile--;
      const chunks = []; ur.on('data', (c) => chunks.push(c)); ur.on('end', () => { log('DROPPED answer', ur.statusCode, req.url.slice(0, 80), Buffer.concat(chunks).toString().slice(0, 200)); req.socket.destroy(); });
      return;
    }
    if (isSync || isFile) log('passed', ur.statusCode, req.url.slice(0, 80));
    res.writeHead(ur.statusCode, ur.headers); ur.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(PORT, '127.0.0.1', () => log('proxy on', PORT, 'to', UPSTREAM));
