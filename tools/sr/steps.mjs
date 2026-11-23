// The journeys, step by step, by keyboard only. Each `run(ctx, person)` drives the browser through
// ctx.s (lib.mjs Session); a step's `check` names what a screen reader user must hear or where the
// focus must be, and returns a problem text when it is not so. Journeys run in order for each role,
// in one browser session: the first (sign-in) signs the role in for the rest.
import { PASSWORD } from '../e2e/lib/instance.mjs';

const said = (re, what) => ({ joined }) => (re.test(joined) || re.test(joined.replace(/ /g, '')) ? null : `NVDA did not say ${what}`);
const focusIs = (re, what) => ({ focus }) => (re.test(focus?.text ?? '') ? null : `focus is not on ${what} (now ${focus?.text})`);
const both = (...checks) => async (info) => {
  const out = [];
  for (const c of checks) { const p = await c(info); if (p) out.push(p); }
  return out.length ? out.join('; ') : null;
};
/** After a move to another page: NVDA must say the new page's name. */
const pageAnnounced = (re, what) => said(re, `the new page (${what})`);

/** Waits for the start of a fresh 30-second code window, so a code is never reused. */
async function freshWindow(sleep) {
  for (;;) {
    const left = 30000 - (Date.now() % 30000);
    if (left > 8000) return;
    await sleep(left + 300);
  }
}

const mainHas = (text) => new Function(`return (document.querySelector('main')?.innerText ?? '').includes(${JSON.stringify(text)});`);

/** Goes to a page through the main navigation: Tab to its link, Enter. */
async function viaNavigation(ctx, label, h1, { name } = {}) {
  const { s, page } = ctx;
  return s.step(`Go to ${label} through the navigation`, async () => {
    // Each journey starts on a freshly loaded Overview (journeys.mjs): Tab starts at the skip link.
    await s.tabTo({ role: 'link', name: name ?? new RegExp(`^${label}$`) }, { max: 140 });
    await s.press('Enter');
    await page.waitFor(() => !!document.querySelector('h1'), { timeout: 10000 });
    await page.settled();
  }, { check: pageAnnounced(new RegExp(h1, 'i'), h1) });
}

/**
 * Fills a form the way the run's person would after sending it empty: the focus is on the first
 * field that needs something; fill it, then send again, until nothing is refused.
 */
async function fillRefusedFields(ctx, submitName, { rounds = 8, text = 'Invented by the screen reader run' } = {}) {
  const { s, page, sleep } = ctx;
  for (let i = 0; i < rounds; i++) {
    const invalid = await page.eval(`!!document.querySelector('[role=dialog] [aria-invalid="true"], main [aria-invalid="true"]')`);
    if (!invalid) return;
    const f = await s.focusAx();
    const role = f?.node?.role?.value ?? '';
    const name = f?.node?.name?.value ?? '';
    await s.step(`Fill "${name || role}", which was refused, and send again`, async () => {
      if (role === 'combobox') {
        await s.press('ArrowDown');
        await sleep(400);
        await s.press('ArrowDown');
        await s.press('Enter');
      } else if (role === 'radio') {
        await s.press('Space');
      } else if (/date|when/i.test(name)) {
        await s.type('15 Jan 2027');
        await s.press('Tab');
      } else if (role === 'spinbutton') {
        await s.type('1');
      } else {
        await s.type(text);
      }
      await s.tabTo({ role: 'button', name: submitName }, { max: 40 });
      await s.press('Enter');
      await sleep(600);
    });
  }
}

/** Signs in through the form, by keyboard, with the second factor. */
export async function signInByKeyboard(ctx, person) {
  const { s, page, totp, sleep } = ctx;
  await page.clearSession();
  await s.step('Open the sign-in page', () => s.goto('/'), { pageLoad: true, quiet: 2500, check: both(said(/Username/i, 'the Username field'), focusIs(/textbox "Username"/i, 'the Username field')) });
  await s.step('Type the username, Tab, type the password', async () => {
    await s.type(person.username);
    await s.press('Tab');
    await s.type(person.password);
  }, { check: focusIs(/textbox "Password"/i, 'the Password field') });
  await s.step('Enter: the second-factor code is asked for', async () => {
    await s.press('Enter');
    await page.waitFor({ label: '6-digit code' }, { timeout: 10000 });
  }, { check: both(said(/6-digit code/i, 'the code field'), focusIs(/6-digit code/i, 'the code field')) });
  await s.step('A wrong code is refused', async () => {
    page.allow({ status: 401, url: /\/api\/auth\/login/ });
    await s.type('000000');
    await s.press('Enter');
    await page.waitFor(() => !!document.querySelector('[aria-invalid="true"], .form-error'), { timeout: 10000 });
  }, { check: said(/fail|code|incorrect|check/i, 'why the code was refused') });
  await freshWindow(sleep);
  await s.step('Type the right code and press Enter: signed in to the Overview', async () => {
    await s.press('a', ['Control']);
    await s.type(totp(person.secret));
    await s.press('Enter');
    await page.waitFor('nav[aria-label="Main"]', { timeout: 15000 });
    page.clearAllowed();
  }, { check: both(pageAnnounced(/Overview|Good (morning|afternoon|evening)/i, 'the Overview'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
}

export const JOURNEYS = [
  {
    key: 'signin',
    title: 'Sign in with a password and a second factor',
    roles: ['administrator', 'agent'],
    run: (ctx, person) => signInByKeyboard(ctx, person),
  },

  {
    key: 'portal',
    title: 'Raise a ticket from the self-service portal',
    roles: ['administrator'], // the agent role does not include the portal
    async run(ctx) {
      const { s, page, sleep } = ctx;
      // A page load: the browser starts at the top of the new document, which NVDA reads.
      await s.step('Open the portal', () => s.goto('/portal'), { pageLoad: true, quiet: 2500 });
      await s.step('Tab to "Report a problem" and press Enter', async () => {
        await s.tabTo({ role: 'link', name: /^Report a problem/ }, { max: 40 });
        await s.press('Enter');
        await page.waitFor(() => /Report a problem/.test(document.querySelector('h1')?.textContent ?? ''), { timeout: 10000 });
      }, { check: pageAnnounced(/Report a problem/i, 'Report a problem') });
      await s.step('Send the form empty: what is missing is said and the focus goes to it', async () => {
        await s.tabTo({ role: 'button', name: /^Send$/ }, { max: 30 });
        await s.press('Enter');
        await sleep(500);
      }, { check: both(said(/required|enter|choose|tell|what is wrong|invalid/i, 'what is missing'), focusIs(/What is wrong/i, 'the first refused field')) });
      await s.step('Type what is wrong and more detail', async () => {
        await s.press('a', ['Control']);
        await s.type('Platform display shows a blank screen (invented, screen reader run)');
        await s.press('Tab');
        await s.type('Since this morning; invented for the screen reader run.');
      }, { check: focusIs(/More detail/i, 'More detail') });
      await s.step('Tab to "Who is affected?" and choose with Space', async () => {
        await s.tabTo({ role: 'radio' }, { max: 6 });
        await s.press('Space');
      }, { check: both(said(/Who is affected/i, 'the question of the radio group'), said(/checked/i, 'that the choice is checked')) });
      await s.step('Tab to "How urgent is it?" and choose with Space', async () => {
        await s.press('Tab');
        await s.press('Space');
      }, { check: said(/How urgent/i, 'the question of the radio group') });
      await s.step('Tab to Send and press Enter: the request is sent', async () => {
        await s.tabTo({ role: 'button', name: /^Send$/ }, { max: 12 });
        await s.press('Enter');
        await page.waitFor(() => /\/portal\/requests\//.test(location.pathname), { timeout: 15000 });
      }, { check: both(said(/Sent|reference/i, 'that the request was sent and its reference'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
    },
  },

  {
    key: 'ticket',
    title: 'Work a ticket: find it, change its status, add a comment',
    roles: ['administrator', 'agent'],
    async run(ctx, person) {
      const { s, page, sleep } = ctx;
      const want = person.roles.includes('agent') ? 'Laptop will not start' : 'Ticket machine at';
      await viaNavigation(ctx, 'Tickets', 'Tickets');
      await s.step(`Search the tickets for "${want}"`, async () => {
        await s.tabTo({ role: 'searchbox', name: /Search tickets/ }, { max: 30 });
        await s.type(want);
        await sleep(1200);
      }, { check: said(/result|ticket|showing|found|\d/i, 'how many tickets were found') });
      await s.step('Tab to the ticket and press Enter: its page opens', async () => {
        await s.tabTo({ role: 'link', name: new RegExp(want) }, { max: 40 });
        await s.press('Enter');
        await page.waitFor(() => /^\/tickets\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 10000 });
        await page.settled();
      }, { check: pageAnnounced(new RegExp(want, 'i'), 'the ticket') });
      await s.step('Change the status: Tab to "Start work" and press Enter', async () => {
        await s.tabTo({ role: 'button', name: /^(Start work|Resume work|Assign to me)$/ }, { max: 20 });
        await s.press('Enter');
        await sleep(800);
      }, { check: both(said(/progress|started|saved|assigned|status/i, 'that the status changed'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
      await s.step('Tab to "Add a comment" and type a comment', async () => {
        await s.tabTo({ role: 'textbox', name: /Add a comment/ }, { max: 50 });
        await s.type('Checked with the person by phone (invented, screen reader run).');
      }, { check: said(/Add a comment/i, 'the comment box') });
      await s.step('Tab to the button that sends the comment and press Enter', async () => {
        await s.tabTo({ role: 'button', name: /^(Add comment|Comment|Post|Add note|Add internal note|Send|Save)/ }, { max: 8 });
        await s.press('Enter');
        await sleep(800);
      }, { check: both(said(/added|posted|saved|comment/i, 'that the comment was added'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
    },
  },

  {
    key: 'risk',
    title: 'Create a risk and score it',
    roles: ['administrator'], // the agent role does not include risks
    async run(ctx) {
      const { s, page, sleep } = ctx;
      await viaNavigation(ctx, 'Risk register', 'Risk register');
      await s.step('Tab to "New risk" and press Enter: the dialog opens', async () => {
        await s.tabTo({ role: 'button', name: /^New risk$/ }, { max: 90 });
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000 });
      }, { check: both(said(/dialog/i, 'that a dialog opened'), focusIs(/Title/i, 'the Title field')) });
      await s.step('Type the title, Tab to "Create risk", press Enter', async () => {
        await s.type('Platform display network outage (invented, screen reader run)');
        await s.tabTo({ role: 'button', name: /^Create risk$/ }, { max: 30 });
        await s.press('Enter');
        await sleep(800);
      }, { check: both(said(/created|saved|RSK-/i, 'that the risk was created'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
      await fillRefusedFields(ctx, /^Create risk$/);
      await page.waitFor(() => /^\/risks\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 10000 }).catch(() => {});
      await s.step('Tab to "Change scores" and press Enter', async () => {
        await s.tabTo({ role: 'button', name: /^Change scores$/ }, { max: 40 });
        await s.press('Enter');
        await sleep(400);
      }, { check: ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null) });
      for (const which of ['Likelihood', 'Impact']) {
        await s.step(`${which}: open the list with the arrow keys and choose`, async () => {
          if (!new RegExp(`combobox "${which}"`).test((await s.focusAx())?.text ?? '')) await s.tabTo({ role: 'combobox', name: new RegExp(`^${which}`) }, { max: 10 });
          await s.press('ArrowDown');
          await sleep(300);
          await s.press('ArrowDown');
          await s.press('ArrowDown');
          await s.press('Enter');
        }, { check: said(/of 5|selected/i, 'the choices') });
      }
      await s.step('Tab to "Save scores" and press Enter', async () => {
        await s.tabTo({ role: 'button', name: /^Save scores$/ }, { max: 20 });
        await s.press('Enter');
        await sleep(800);
      }, { check: both(said(/Scores saved/i, '"Scores saved."'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
    },
  },

  {
    key: 'safety',
    title: 'Record a safety report',
    roles: ['administrator'], // the agent role does not include safety
    async run(ctx) {
      const { s, page, sleep } = ctx;
      await viaNavigation(ctx, 'Safety events', 'Safety events');
      await s.step('Tab to "New safety event" and press Enter: the dialog opens', async () => {
        await s.tabTo({ role: 'button', name: /^New safety event$/ }, { max: 30 });
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000 });
      }, { check: both(said(/dialog/i, 'that a dialog opened'), focusIs(/Title/i, 'the first field')) });
      await s.step('Type the title, Tab to "Create safety event", press Enter', async () => {
        await s.type('Passenger slipped at the platform edge (invented, screen reader run)');
        await s.tabTo({ role: 'button', name: /^Create safety event$/ }, { max: 60 });
        await s.press('Enter');
        await sleep(800);
      }, { check: said(/required|created|enter|choose|check/i, 'what is missing or that it was created') });
      await fillRefusedFields(ctx, /^Create safety event$/);
    },
  },

  {
    key: 'tag',
    title: 'Find an asset by its tag number and open the tag card',
    roles: ['administrator', 'agent'],
    async run(ctx, person) {
      const { s, page, app, sleep } = ctx;
      const api = app.api();
      const tag = `TA-8${String(Date.now() % 100000).padStart(5, '0')}`;
      await api.must('POST', '/api/assets', { name: `Screen reader run tablet ${person.roles[0]}`, tag, serial: `SN-${tag}`, location: 'Dispatch desk 2' });
      await viaNavigation(ctx, 'Assets', 'Assets');
      await s.step('Tab to "Find by tag number", type the tag, press Enter', async () => {
        await s.tabTo({ name: /Find by tag number/ }, { max: 40 });
        await s.type(tag);
        await s.press('Enter');
        await page.waitFor({ css: '.tag-card' }, { timeout: 10000 });
        await sleep(500);
      }, { check: both(pageAnnounced(/Screen reader run tablet/i, 'the tag card'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
      await s.step('Tab through the tag card\'s actions', async () => {
        await s.tabTo({ role: 'button' }, { max: 15 });
        await s.press('Tab');
        await s.press('Tab');
      }, { check: said(/[A-Za-z]/, 'the actions') });
    },
  },

  {
    key: 'count',
    title: 'Run an inventory count with a typed tag',
    roles: ['agent', 'administrator'],
    async run(ctx, person) {
      const { s, page, app, sleep } = ctx;
      const api = app.api();
      const stamp = `${person.roles[0].slice(0, 3)}${Date.now().toString(36).slice(-4)}`.toUpperCase();
      const site = await api.must('POST', '/api/sites', { name: `Screen reader count site ${stamp}` });
      const tag = `TA-7${String(Date.now() % 100000).padStart(5, '0')}`;
      const asset = await api.must('POST', '/api/assets', { name: `Counted radio ${stamp}`, tag, site_id: site.id, status: 'in_use' });
      await viaNavigation(ctx, 'Inventory counts', 'Inventory counts');
      await s.step('Tab to "Start a count" and press Enter: the dialog opens', async () => {
        await s.tabTo({ role: 'button', name: /^Start a count$/ }, { max: 30 });
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000 });
      }, { check: both(said(/dialog/i, 'that a dialog opened'), focusIs(/Site/i, 'the Site field')) });
      await s.step('Type the site name and choose it with the arrow keys', async () => {
        await s.type(`count site ${stamp}`);
        await sleep(1200);
        await s.press('ArrowDown');
        await s.press('Enter');
      }, { check: said(new RegExp(`countsite${stamp}`, 'i'), 'the chosen site') });
      await s.step('Tab to "Start the count" and press Enter: the count page opens', async () => {
        await s.tabTo({ role: 'button', name: /^Start the count$/ }, { max: 40 });
        await s.press('Enter');
        await page.waitFor({ label: 'Tag number' }, { timeout: 15000 });
      }, { check: both(pageAnnounced(new RegExp(`count site ${stamp}|Tag number`, 'i'), 'the count'), focusIs(/Tag number/i, 'the Tag number box')) });
      await s.step('Type the tag number and press Enter: the find is said and the box keeps the focus', async () => {
        if (!/Tag number/.test((await s.focusAx())?.text ?? '')) await s.tabTo({ name: /Tag number/ }, { max: 30 });
        await s.type(tag.toLowerCase());
        await s.press('Enter');
        await page.waitFor(mainHas(`${asset.name} found.`), { timeout: 10000 });
      }, { check: both(said(new RegExp(`${asset.name.replace(/ /g, '')}found`, 'i'), `"${asset.name} found."`), focusIs(/Tag number/i, 'the Tag number box')) });
      await s.step('The same tag again: "already found" is said', async () => {
        await s.type(tag);
        await s.press('Enter');
        await page.waitFor(mainHas('was already found'), { timeout: 10000 });
      }, { check: said(/already found/i, '"already found"') });
      await s.step('Tab to Finish, press Enter, confirm', async () => {
        await s.tabTo({ role: 'button', name: /^Finish$/ }, { max: 40, back: true });
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000 });
        await s.tabTo({ role: 'button', name: /^Finish the count$/ }, { max: 10 });
        await s.press('Enter');
        await page.waitFor(mainHas('Follow up the differences'), { timeout: 10000 });
      }, { check: both(said(/finished|Count/i, 'that the count was finished'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
    },
  },

  {
    key: 'approve',
    title: 'Approve a workflow step',
    roles: ['administrator'],
    async run(ctx) {
      const { s, page, app, sleep } = ctx;
      // A step waiting for the administrators: a problem record sent for sign-off by another
      // administrator (the run's own account may not approve what it asked for).
      const api = app.api();
      const stamp = Date.now().toString(36);
      const wf = await api.must('POST', '/api/workflows/definitions', {
        record_type: 'problem', name: `Screen reader run sign-off ${stamp}`, trigger: 'manual',
        steps: [{ name: 'Sign-off', approvers: { kind: 'role', role: 'administrator' } }],
      });
      const problem = await api.must('POST', '/api/problems', { title: `Platform displays restart overnight (invented, ${stamp})` });
      await api.must('POST', `/api/workflows/records/problem/${problem.id}/start`, { workflow_id: wf.id });
      await page.reload();
      await viaNavigation(ctx, 'Approvals', 'Approvals');
      let what = '';
      await s.step('Tab to the first "Approve" button and press Enter: the dialog opens', async () => {
        await s.tabTo({ role: 'button', name: /^Approve / }, { max: 30 });
        what = (await s.focusAx())?.node?.name?.value ?? '';
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000 });
      }, { check: both(said(/dialog/i, 'that a dialog opened'), said(/Approve/i, 'what is approved')) });
      await s.step('Tab to the Approve button in the dialog and press Enter', async () => {
        await s.tabTo({ role: 'button', name: /^Approve$/ }, { max: 10 });
        await s.press('Enter');
        await page.waitFor('[role=dialog]', { timeout: 8000, gone: true });
        await sleep(800);
      }, { check: both(said(/Approved|decision|recorded/i, `that ${what || 'it'} was approved`), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
    },
  },

  {
    key: 'dashboard',
    title: 'Read a dashboard',
    roles: ['administrator', 'agent'],
    async run(ctx, person) {
      const { s, sr, sleep } = ctx;
      const agent = person.roles.includes('agent');
      if (agent) await viaNavigation(ctx, 'Service desk dashboard', 'Service desk');
      else {
        // The journey starts on the Overview: "Skip to content" takes the keyboard to it.
        await s.step('On the Overview, Tab to "Skip to content" and press Enter', async () => {
          await s.tabTo({ role: 'link', name: /^Skip to content$/ }, { max: 3 });
          await s.press('Enter');
        }, { check: said(/main landmark|Good (morning|afternoon|evening)|Overview/i, 'the start of the content') });
      }
      await s.step('Read the headings with NVDA\'s H key (browse mode)', async () => {
        await s.press('Escape');
        for (let i = 0; i < 8; i++) { s.keysLog.push('NVDA: H'); await sr.key('H'); await sleep(350); }
      }, { check: said(/heading/i, 'the headings') });
      await s.step('Tab through the first widgets', async () => {
        for (let i = 0; i < 6; i++) await s.press('Tab');
      }, { check: said(/[A-Za-z]/, 'the widgets') });
      await s.step('Find a chart and read its text alternative (NVDA G key, graphics)', async () => {
        for (let i = 0; i < 2; i++) { s.keysLog.push('NVDA: G'); await sr.key('G'); await sleep(400); }
      }, { check: said(/graphic|chart|image/i, 'a chart and its summary') });
    },
  },

  {
    key: 'setting',
    title: 'Change a setting under Administration',
    roles: ['administrator'],
    async run(ctx) {
      const { s, page, app, sleep } = ctx;
      await viaNavigation(ctx, 'Settings', 'Settings');
      await s.step('Tab to "Idle time-out in minutes" and type 45', async () => {
        await s.tabTo({ name: /^Idle time-out in minutes/ }, { max: 50 });
        await s.press('a', ['Control']);
        await s.type('45');
      }, { check: said(/Idle time-out/i, 'the field') });
      await s.step('Tab to "Save settings" and press Enter: the password is asked for', async () => {
        // "Save settings" is at the top of the page, beside the heading: back up to it.
        await s.tabTo({ role: 'button', name: /^Save settings$/ }, { max: 60, back: true });
        await s.press('Enter');
        await sleep(800);
      }, { check: said(/password|dialog|saved/i, 'the password question (or that it was saved)') });
      if (await page.exists('[role=dialog]')) {
        await s.step('Type the password and press Enter: the setting is saved', async () => {
          if (!/Password/i.test((await s.focusAx())?.text ?? '')) await s.tabTo({ name: /Password/ }, { max: 10 });
          await s.type(PASSWORD);
          await s.press('Enter');
          await page.waitFor('[role=dialog]', { timeout: 8000, gone: true });
          await sleep(800);
        }, { check: both(said(/saved/i, 'that the setting was saved'), ({ focus }) => (focus?.lost ? 'focus was left on the page body' : null)) });
      }
      // Put it back for the next run.
      const api = app.api();
      await api.must('POST', '/api/auth/confirm', { password: PASSWORD }).catch(() => {});
      await api.call('PATCH', '/api/admin/settings', { 'auth.idle_minutes': 30 });
    },
  },
];

export { said, focusIs, both, PASSWORD };
