#!/usr/bin/env node
// Sandpiper GRC: stdio bridge for MCP clients that can only launch a local command.
//
// It reads JSON-RPC messages (one per line) on standard input, sends each to the application's
// MCP endpoint (POST <GRC_URL>/mcp) with your personal access token, and writes the answers (one
// per line) to standard output. It has no dependencies: any Node.js 18 or later runs it, including
// the portable one in .tools/node.
//
//   GRC_URL    the application's address, e.g. http://127.0.0.1:8080 (".../mcp" also accepted)
//   GRC_TOKEN  a personal access token made under Account security > Connect an AI assistant
//
// Both come from the environment only, never from arguments, so they do not show in process
// lists. Messages about the bridge itself go to standard error. See docs/mcp.md.

import { createInterface } from 'node:readline';

const rawUrl = (process.env.GRC_URL ?? '').trim().replace(/\/+$/, '');
const token = (process.env.GRC_TOKEN ?? '').trim();
const say = (msg) => process.stderr.write(`[sandpiper-mcp] ${msg}\n`);

if (!rawUrl || !token) {
  say('Set GRC_URL (the application address) and GRC_TOKEN (a personal access token) in the environment.');
  process.exit(2);
}
let endpoint;
try {
  const u = new URL(rawUrl.endsWith('/mcp') ? rawUrl : `${rawUrl}/mcp`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
  if (u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    say(`Warning: ${u.origin} is plain http to another computer; your token would cross the network unencrypted. Use https.`);
  }
  endpoint = u.href;
} catch {
  say(`GRC_URL "${rawUrl}" is not an http or https address.`);
  process.exit(2);
}

let protocolVersion = null;
let sent = 0;
const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const errorFor = (id, message, code = -32000) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Messages from a text/event-stream body (the server normally answers with plain JSON). */
function fromSse(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (data) { try { out.push(JSON.parse(data)); } catch { /* ignore keep-alive and partial events */ } }
  }
  return out;
}

async function relay(message) {
  const ids = (Array.isArray(message) ? message : [message]).filter((m) => m && m.id !== undefined && m.method).map((m) => m.id);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-request-id': `bridge-${process.pid}-${++sent}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
      },
      body: JSON.stringify(message),
    });
  } catch (err) {
    say(`Could not reach ${endpoint}: ${err?.cause?.code ?? err?.message ?? err}`);
    for (const id of ids) write(errorFor(id, `Could not reach Sandpiper GRC at ${endpoint}.`));
    return;
  }
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && type.includes('text/event-stream') && res.body) {
    // A tool call that asked for progress: pass each event on as soon as it arrives, so the client
    // sees the progress notifications while the tool runs, then the result.
    const decoder = new TextDecoder();
    let buffer = '';
    let notified = false;
    const pass = async (r) => {
      // Clients handle a notification a moment after an answer that arrives with it: let the
      // progress go first, or it would be dropped as belonging to a finished request.
      if (notified && r?.id !== undefined && !r.method) await new Promise((done) => setTimeout(done, 25));
      if (r?.method) notified = true;
      write(r);
    };
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const r of fromSse(blocks.join('\n\n'))) await pass(r);
    }
    for (const r of fromSse(buffer)) await pass(r);
    return;
  }
  const text = await res.text();
  if (res.status === 202 || !text) return; // a notification or response: nothing comes back
  let replies = [];
  if (type.includes('text/event-stream')) replies = fromSse(text);
  else {
    try { const parsed = JSON.parse(text); replies = Array.isArray(parsed) ? parsed : [parsed]; } catch { replies = []; }
  }
  if (!res.ok) {
    const reason = replies[0]?.error?.message ?? `HTTP ${res.status}`;
    say(`Refused (${res.status}): ${reason}`);
    for (const id of ids) write(errorFor(id, reason, replies[0]?.error?.code ?? -32001));
    return;
  }
  for (const r of replies) {
    if (r?.result?.protocolVersion && !protocolVersion) protocolVersion = r.result.protocolVersion;
    write(r);
  }
}

// One request at a time, in order: answers come back in the order they were asked.
let queue = Promise.resolve();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try { message = JSON.parse(trimmed); } catch {
    write(errorFor(null, 'Parse error', -32700));
    return;
  }
  queue = queue.then(() => relay(message)).catch((err) => say(`Unexpected error: ${err?.message ?? err}`));
});
rl.on('close', () => { void queue.then(() => process.exit(0)); });
