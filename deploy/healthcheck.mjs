// Container health check: asks the server on this machine for GET /api/health and exits 0
// when it answers { ok: true }, 1 otherwise. Follows GRC_PORT and, when GRC_TLS_CERT is set,
// speaks HTTPS (the certificate is not checked: this only asks whether the process is up).
import http from 'node:http';
import https from 'node:https';

const tls = !!process.env.GRC_TLS_CERT;
const client = tls ? https : http;
const req = client.request(
  { host: '127.0.0.1', port: Number(process.env.GRC_PORT || 8080), path: '/api/health', method: 'GET', timeout: 4000, rejectUnauthorized: false },
  (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
      let ok = false;
      try { ok = res.statusCode === 200 && JSON.parse(body).ok === true; } catch { ok = false; }
      process.exit(ok ? 0 : 1);
    });
  },
);
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', () => process.exit(1));
req.end();
