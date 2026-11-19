// A minimal receiver for outbound webhooks, for trying them out on one machine.
//
//   $env:WEBHOOK_SECRET = '<the secret shown when the webhook was added>'
//   node examples/webhook-receiver.mjs 8190
//
// Then, in Administration > Webhooks: add a webhook to http://127.0.0.1:8190/hook, put
// "127.0.0.1:8190" on the allowed hosts, switch on outbound connections, and press "Send test".
//
// Each delivery is a JSON POST with these headers:
//   X-GRC-Event      for example "ticket.create", "risk.update" or "webhook.test"
//   X-GRC-Delivery   the delivery id (the same on every retry: use it to ignore repeats)
//   X-GRC-Timestamp  seconds since 1970 when this attempt was signed
//   X-GRC-Signature  "sha256=" + hex HMAC-SHA256(secret, timestamp + "." + raw body)
// Answer with any 2xx status. Anything else, or no answer within 10 seconds, is retried later.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8190);
const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('Set WEBHOOK_SECRET to the webhook secret first.');
const MAX_AGE_SECONDS = 300;

function verify(headers, body) {
  const timestamp = String(headers['x-grc-timestamp'] ?? '');
  const given = Buffer.from(String(headers['x-grc-signature'] ?? ''));
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`);
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= MAX_AGE_SECONDS;
  return fresh && given.length === expected.length && timingSafeEqual(given, expected);
}

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!verify(req.headers, body)) {
      res.writeHead(401).end('bad signature');
      return;
    }
    const event = JSON.parse(body);
    console.log(new Date().toISOString(), event.event, event.record?.ref ?? event.record?.id ?? '', event.record?.label ?? event.message ?? '');
    res.writeHead(204).end();
  });
}).listen(port, '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${port}/hook`));
