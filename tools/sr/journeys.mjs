// The main journeys with a real screen reader (E16-15): NVDA listens while a visible browser is
// driven by keyboard only, as an administrator and as a service desk agent, on a throw-away
// instance with invented sample data. For each step it records the keys pressed, what NVDA said,
// where the focus is (from the browser's accessibility tree) and any problem, and writes
// tools/sr/out/transcript.md and transcript.json. Windows only. See docs/accessibility.md.
//
//   cd tools/sr; npm install; npm run nvda      (once: Guidepup's portable NVDA into .tools/nvda)
//   node journeys.mjs [--only signin,ticket,...] [--keep-going]
//
// Environment: E2E_BASE (an instance started by tools/e2e/serve.mjs, same accounts), or
// E2E_PORT and E2E_WEB_DIST as for the browser tests; SR_SCRATCH (the scratch folder, default
// <temp>/sandpiper-sr), SR_DEBUG_PORT (default 9454), SR_IDLE_MS (how long nobody may have used the
// keyboard or mouse before the browser is brought to the front, default 20000).
// While it runs, the browser window must stay in front: NVDA reads the foreground window.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser, sleep, totp } from '../e2e/lib/browser.mjs';
import { startInstance, Api, PASSWORD, signIn } from '../e2e/lib/instance.mjs';
import { startNvda } from './nvda.mjs';
import { Session } from './lib.mjs';
import { JOURNEYS } from './steps.mjs';

if (process.platform !== 'win32') {
  console.error('The screen reader run needs Windows (NVDA).');
  process.exit(2);
}
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const outDir = join(import.meta.dirname, 'out');
mkdirSync(outDir, { recursive: true });
const scratch = process.env.SR_SCRATCH ?? join(tmpdir(), 'sandpiper-sr');

const log = (m) => console.log(m);
const app = await startInstance({ dir: scratch, log, roles: false });
let browser = null;
let sr = null;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* gone */ }
  try { await sr?.stop(); } catch { /* gone */ }
  try { await app.stop(); } catch { /* gone */ }
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

/** A person for the run, with an authenticator app set up through the API: { username, secret }. */
async function personWithSecondFactor(username, roles) {
  const u = await app.newUser(username, roles);
  const api = new Api(app.base, u.token);
  await api.must('POST', '/api/auth/confirm', { password: PASSWORD });
  const { secret } = await api.must('POST', '/api/auth/totp/begin', {});
  await api.must('POST', '/api/auth/totp/confirm', { code: totp(secret) });
  return { ...u, secret, roles };
}

/** Waits for a fresh 30-second window, so an authenticator code is not used twice. */
async function freshCode() {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    if (left > 8000) return;
    await sleep(left + 300);
  }
}

try {
  // The portal is off by default; the portal journey needs it.
  const adminApi = app.api();
  await adminApi.must('POST', '/api/auth/confirm', { password: PASSWORD });
  await adminApi.must('PATCH', '/api/admin/features', { features: { portal: true } });
  const stamp = Date.now().toString(36).slice(-4);
  const people = {
    administrator: await personWithSecondFactor(`sr.admin-${stamp}`, ['administrator']),
    agent: await personWithSecondFactor(`sr.agent-${stamp}`, ['agent']),
  };
  sr = await startNvda({ log });
  browser = await launchBrowser({
    profileDir: join(scratch, 'profile'), debugPort: Number(process.env.SR_DEBUG_PORT) || 9454, headless: false,
    extraArgs: ['--force-renderer-accessibility', '--window-position=0,0', '--window-size=1440,1000'],
  });
  const page = await browser.newPage({ base: app.base, width: 1440, height: 900, theme: 'light' });
  await page.send('Accessibility.enable');
  await page.send('Page.bringToFront');
  const s = new Session({ page, sr, browserPid: browser.pid, log });
  const ctx = { s, sr, page, app, people, totp, sleep };
  // One role after the other; each starts with the sign-in journey, which leaves it signed in.
  for (const role of ['administrator', 'agent']) {
    const person = people[role];
    if (only && !only.includes('signin')) {
      await freshCode();
      await page.setSession(await signIn(app.base, person.username, PASSWORD, person.secret));
    }
    for (const j of JOURNEYS) {
      if ((only && !only.includes(j.key)) || !j.roles.includes(role)) continue;
      s.journey(j.title, role);
      try {
        // Every journey after the sign-in starts on a freshly loaded Overview, as a person would
        // start a task; the screen reader takes up the new document.
        if (j.key !== 'signin') { await s.activate(); await page.goto('/'); await sleep(2500); }
        await j.run(ctx, person);
      } catch (e) {
        s.current.problems.push(`journey stopped: ${e.message.split('\n')[0]}`);
        log(`  !! journey stopped: ${e.message}`);
      }
      page.clearAllowed();
    }
  }
  writeFileSync(join(outDir, 'transcript.json'), JSON.stringify(s.journeys, null, 2));
  writeFileSync(join(outDir, 'transcript.md'), markdown(s.journeys));
  log(`\nWrote ${join(outDir, 'transcript.md')}`);
} finally {
  await cleanup();
}

function markdown(journeys) {
  const lines = ['# Screen reader journeys: transcript', '', `NVDA (portable, Guidepup build) and ${browser?.exe ?? 'a Chromium browser'}, ${new Date().toISOString().slice(0, 10)}. Keys are sent to the browser; "said" is NVDA's speech; "focus" is the browser's accessibility tree.`, ''];
  for (const j of journeys) {
    lines.push(`## ${j.title} (${j.role})`, '');
    for (const p of j.problems) lines.push(`**${p}**`, '');
    for (const st of j.steps) {
      lines.push(`### ${st.name}`, '', `- Keys: ${st.keys.join(', ') || '(none)'}`, `- NVDA said: ${st.spoken.map((x) => `"${x}"`).join(' / ') || '(nothing)'}`, `- Focus: ${st.focus}`);
      for (const p of st.problems) lines.push(`- **Problem:** ${p}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
