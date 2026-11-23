// A screen reader session for the journey run (tools/sr/journeys.mjs): the portable NVDA that
// Guidepup (@guidepup/guidepup, MIT) downloads, started with its own throw-away configuration,
// and a listener on NVDA's built-in Remote Access relay that records everything NVDA says, with
// the time it said it. Nothing is installed system-wide and the registry is not written: Guidepup
// copies the portable NVDA's settings into a session folder and deletes it again when it stops.
//
//   const sr = await startNvda();
//   sr.mark();                        // start of a step
//   ...drive the browser...
//   const said = await sr.since({ quiet: 900 });   // phrases spoken since the mark
//   await sr.key('H');                // an NVDA browse-mode key, injected through Remote Access
//   await sr.stop();
//
// NVDA_PATH (default: .tools/nvda under the repository) is where `npm run nvda` put NVDA.
import { createRequire } from 'node:module';
import { connect } from 'node:tls';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, '../..');
process.env.GUIDEPUP_SCREEN_READERS_PATH ??= process.env.NVDA_PATH ?? join(repoRoot, '.tools', 'nvda');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * NVDA settings for the run. Speech goes to the silent synthesizer (the relay still receives every
 * phrase), and typed characters and words are not echoed, so keys pressed elsewhere on the machine
 * during a run are neither spoken nor recorded.
 */
const SETTINGS = {
  speech: { synth: 'silence' },
  keyboard: { speakTypedCharacters: 0, speakTypedWords: 0 },
  presentation: { reportHelpBalloons: false },
};

export async function startNvda({ log = () => {} } = {}) {
  const { nvda, WindowsKeyCodes: KeyCodes } = require('@guidepup/guidepup');
  const exe = require('@guidepup/guidepup/lib/windows/NVDA/getGuidepupNVDAInstallationPath.js').getGuidepupNVDAInstallationPath();
  if (!exe) throw new Error(`NVDA is not installed under ${process.env.GUIDEPUP_SCREEN_READERS_PATH}: run "npm run nvda" in tools/sr first`);
  await nvda.start({ settings: SETTINGS, capture: false });
  log(`NVDA started (${exe})`);

  // A second member of the relay channel Guidepup's client joined: it hears every "speak" message.
  const pem = [join(dirname(exe), 'userConfig', 'remoteAccess', 'localRelay', 'NvdaRemoteRelay.pem'),
    join(dirname(exe), 'userConfig', 'addons', 'remote', 'globalPlugins', 'remoteClient', 'server.pem')].find(existsSync);
  const phrases = []; // { at, text }
  let buffer = '';
  const socket = await new Promise((res, rej) => {
    const s = connect(6837, '127.0.0.1', { ca: [readFileSync(pem)], checkServerIdentity: () => undefined }, () => {
      s.write(`${JSON.stringify({ type: 'protocol_version', version: 2 })}\n`);
      s.write(`${JSON.stringify({ type: 'join', connection_type: 'master', channel: 'guidepup' })}\n`);
    });
    s.setEncoding('utf8');
    s.on('error', rej);
    s.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'channel_joined') res(s);
        if (msg.type === 'speak') {
          const text = (msg.sequence ?? []).filter((p) => typeof p === 'string').map((p) => p.trim().replace(/\s\s+/g, ' ')).filter(Boolean).join(', ');
          if (text) phrases.push({ at: Date.now(), text });
        }
      }
    });
  });

  let markAt = Date.now();
  const send = (obj) => new Promise((res, rej) => socket.write(`${JSON.stringify(obj)}\n`, (e) => (e ? rej(e) : res())));
  return {
    phrases,
    /** Starts a new step: `since()` returns what is spoken from here on. */
    mark(at = Date.now()) { markAt = at; },
    /** Phrases spoken since the mark, once NVDA has been quiet for `quiet` ms (at most `max` ms). */
    async since({ quiet = 900, max = 8000 } = {}) {
      const start = Date.now();
      for (;;) {
        const last = phrases.length ? phrases[phrases.length - 1].at : 0;
        const calm = Date.now() - Math.max(last, start) >= quiet;
        if (calm || Date.now() - start >= max) break;
        await sleep(100);
      }
      return phrases.filter((p) => p.at >= markAt).map((p) => p.text);
    },
    /** Presses an NVDA key (a name of Guidepup's WindowsKeyCodes, with modifier names) through Remote Access. */
    async key(name, modifiers = []) {
      const keys = [...modifiers, name].map((k) => KeyCodes[k]);
      if (keys.some((k) => !k)) throw new Error(`unknown key ${[...modifiers, name].join('+')}`);
      for (const k of keys) await send(k.toJSON(true));
      for (const k of [...keys].reverse()) await send(k.toJSON(false));
      await sleep(60);
    },
    async stop() {
      socket.destroy();
      await nvda.stop();
      log('NVDA stopped');
    },
  };
}
