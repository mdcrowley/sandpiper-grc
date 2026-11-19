// The hand-written dialogs: the ones a record page opens for one action (resolve a ticket, check
// out an asset, record a gate decision, accept a risk...), which the generic create and edit
// journeys (03-records) do not reach. Each is opened from its record page the way a person would,
// submitted empty where it asks for something (the refusal must show beside the field), filled
// in, submitted, and the change is checked through the API. Covers E18-08.
//
// A case: { name, find(api) -> record path, steps: [opener...], title, submit, empty?, fill?,
// pick?, verify(after, before) }. Openers: { button } (a text, or several to try), { menu, item }, { tab }.
import { sleep } from '../lib/browser.mjs';
import { controls, fillRequired, invalidControls } from '../lib/forms.mjs';

const SCOPE = '[data-e2e-dialog="1"]';

/** Marks the visible dialog whose heading matches `title` (waits up to 8 s for it). */
async function markDialog(page, title) {
  for (let i = 0; i < 50; i++) {
    const ok = await page.fn((t) => {
      document.querySelectorAll('[data-e2e-dialog]').forEach((e) => e.removeAttribute('data-e2e-dialog'));
      const re = new RegExp(t, 'i');
      const d = [...document.querySelectorAll('[role=dialog]')].filter((x) => x.getClientRects().length)
        .find((x) => re.test(x.querySelector('h1, h2, h3, .mantine-Modal-title, .mantine-Drawer-title')?.innerText ?? x.getAttribute('aria-label') ?? ''));
      if (!d) return false;
      d.setAttribute('data-e2e-dialog', '1');
      return true;
    }, title);
    if (ok) { await sleep(250); return; } // the opening transition
    await sleep(160);
  }
  throw new Error(`no dialog titled /${title}/ opened`);
}

/** Whether a visible dialog titled `title` is still open. */
const dialogOpen = (page, title) => page.fn((t) => {
  const re = new RegExp(t, 'i');
  return [...document.querySelectorAll('[role=dialog]')].filter((x) => x.getClientRects().length)
    .some((x) => re.test(x.querySelector('h1, h2, h3, .mantine-Modal-title, .mantine-Drawer-title')?.innerText ?? x.getAttribute('aria-label') ?? ''));
}, title);

async function opener(page, o) {
  if (o.tab) {
    await page.click({ text: o.tab, tag: '[role=tab]' });
    await page.settled();
  } else if (o.menu) {
    await page.click({ role: 'button', name: o.menu });
    await page.waitFor({ text: o.item, tag: '[role=menuitem]' });
    await page.click({ text: o.item, tag: '[role=menuitem]' });
  } else if (o.button) {
    // One of several texts: the button may read differently with the record's state ("Renew ...").
    const texts = [o.button].flat();
    let text = texts[0];
    for (const x of texts) if (await page.exists({ text: x, within: 'main', tag: 'button, a' })) { text = x; break; }
    await page.click({ text, within: 'main', tag: 'button, a' });
  }
  await sleep(200);
}

async function pressInDialog(page, text) {
  const id = await page.fn((want) => {
    const d = document.querySelector('[data-e2e-dialog="1"]');
    const b = [...(d?.querySelectorAll('button') ?? [])].filter((x) => x.getClientRects().length)
      .reverse().find((x) => x.innerText.replace(/\s+/g, ' ').trim() === want);
    if (!b) return null;
    b.id ||= `e2e-dlg-${Math.random().toString(36).slice(2)}`;
    return b.id;
  }, text);
  if (!id) throw new Error(`no "${text}" button in the dialog`);
  await page.click(`#${id}`);
  await page.idle({ quiet: 300 });
}

/** Makes a ticket through the API, so the ticket dialogs start from a known state. */
async function freshTicket(api, stamp) {
  const meta = (await api.must('GET', '/api/meta')).resources.ticket;
  const body = { [meta.titleField]: `E2E dialog ticket ${stamp}`, description: 'Invented ticket for the dialog tests.' };
  const made = await api.must('POST', '/api/tickets', body);
  return made;
}

const CASES = [
  {
    name: 'ticket: Resolve asks for a resolution code, then resolves',
    async find(api, stamp) { return `/tickets/${(await freshTicket(api, stamp)).id}`; },
    steps: [{ button: 'Resolve' }],
    title: '^Resolve ticket',
    submit: 'Resolve',
    empty: 'Resolution code',
    verify: (row) => row.resolution_code && row.status !== 'new',
  },
  {
    name: 'ticket: Close ticket after resolving',
    async find(api, stamp) {
      const t = await freshTicket(api, stamp);
      const codes = (await api.must('GET', '/api/meta')).lookups?.resolution_code ?? [];
      await api.must('PATCH', `/api/tickets/${t.id}`, { status: 'resolved', resolution_code: codes[0]?.value ?? 'fixed' });
      return `/tickets/${t.id}`;
    },
    steps: [{ button: 'Close ticket' }],
    title: '^Close ticket',
    submit: 'Close ticket',
    verify: (row) => row.status === 'closed',
  },
  {
    name: 'ticket: Mark as with vendor',
    async find(api, stamp) { return `/tickets/${(await freshTicket(api, stamp)).id}`; },
    steps: [{ menu: 'More actions', item: 'Mark as with vendor' }],
    title: '^With vendor',
    submit: 'Save',
    fill: { 'Vendor reference': 'VND-CASE-1' },
    verify: (row) => row.with_vendor === true && row.vendor_ref === 'VND-CASE-1',
  },
  {
    name: 'asset: Check out, then Check in',
    async find(api) {
      const rows = (await api.must('GET', '/api/assets?pageSize=50&f.status=in_stock')).rows.filter((r) => !r.user_id && !r.assigned_to_name);
      if (!rows.length) throw new Error('no unassigned asset in stock in the sample data');
      return `/assets/${rows[0].id}`;
    },
    steps: [{ button: 'Check out' }],
    title: '^Check out',
    submit: 'Check out',
    verify: (row) => Boolean(row.user_id || row.assigned_to_name),
    then: { steps: [{ button: 'Check in' }], title: '^Check in', submit: 'Check in', verify: (row) => !row.user_id && !row.assigned_to_name },
  },
  {
    name: 'asset: Dispose asks for a reason, then requests or records the disposal',
    async find(api) {
      const rows = (await api.must('GET', '/api/assets?pageSize=100')).rows.filter((r) => r.status !== 'disposed' && !r.disposal_request_status && !r.funder_interest);
      if (!rows.length) throw new Error('no asset that can be disposed of in the sample data');
      return `/assets/${rows[rows.length - 1].id}`;
    },
    steps: [{ button: 'Dispose' }],
    title: '^Dispose of',
    submit: ['Request approval', 'Mark as disposed'],
    empty: true,
    verify: (row) => row.status === 'disposed' || Boolean(row.disposal_request_status),
  },
  {
    name: 'risk: Complete review',
    async find(api) { return `/risks/${(await api.must('GET', '/api/risks?pageSize=1&sort=ref')).rows[0].id}`; },
    steps: [{ button: 'Complete review' }],
    title: '^Complete review',
    submit: 'Complete review',
    verify: (row, before) => Boolean(row.last_reviewed_on) && String(row.last_reviewed_on) >= String(before.last_reviewed_on ?? ''),
  },
  {
    name: 'risk: Record acceptance',
    async find(api) {
      const rows = (await api.must('GET', '/api/risks?pageSize=50&sort=ref')).rows.filter((r) => r.residual_rating && r.status !== 'closed');
      return `/risks/${rows[rows.length - 1].id}`;
    },
    steps: [{ button: ['Record acceptance', 'Renew acceptance'] }],
    title: 'acceptance',
    submit: 'Record acceptance',
    empty: true,
    fill: { 'Expires on': '15 Jan 2027' },
  },
  {
    name: 'risk: Add action from the risk page',
    async find(api) { return `/risks/${(await api.must('GET', '/api/risks?pageSize=1&sort=ref')).rows[0].id}`; },
    steps: [{ button: 'Add action' }],
    title: 'action',
    submit: ['Add action', 'Create action', 'Create', 'Add', 'Save'],
    empty: true,
  },
  {
    name: 'project: Record a gate decision (deferred)',
    async find(api) {
      // Gate decisions are recorded only while a project is active (not on hold, finished or canceled).
      const rows = (await api.must('GET', '/api/projects?pageSize=100')).rows.filter((r) => r.status === 'active');
      if (!rows.length) throw new Error('no open project in the sample data');
      return `/projects/${rows[0].id}`;
    },
    steps: [{ tab: 'Gate' }, { button: 'Record decision' }],
    title: '^Record decision',
    submit: 'Record decision',
    pick: 'Deferred: decide later',
    fill: { 'Approver name': 'Sample Approver' },
  },
  {
    name: 'change: Approve a change awaiting approval',
    async find(api) {
      const rows = (await api.must('GET', '/api/changes?pageSize=20&f.status=submitted')).rows;
      if (!rows.length) throw new Error('no change awaiting approval in the sample data');
      return `/changes/${rows[0].id}`;
    },
    steps: [{ button: 'Approve' }],
    title: 'pprov',
    submit: ['Approve', 'Record approval', 'Record'],
  },
  {
    name: 'vulnerability: Assign finding',
    async find(api) { return `/vulnerabilities/${(await api.must('GET', '/api/vulnerabilities?pageSize=1&f.status=open')).rows[0].id}`; },
    steps: [{ button: ['Assign', 'Reassign'] }],
    title: '^Assign finding',
    submit: 'Assign',
    fill: { Owner: undefined },
    verify: (row) => Boolean(row.owner_id),
  },
  {
    name: 'vulnerability: Mark fixed',
    async find(api) { return `/vulnerabilities/${(await api.must('GET', '/api/vulnerabilities?pageSize=5&f.status=open&sort=ref')).rows[1].id}`; },
    steps: [{ button: 'Mark fixed' }],
    title: '^Mark as fixed',
    submit: 'Mark fixed',
    verify: (row) => row.status === 'fixed',
  },
  {
    name: 'vulnerability: Close without a fix, accepting the risk',
    async find(api) { return `/vulnerabilities/${(await api.must('GET', '/api/vulnerabilities?pageSize=5&f.status=open&sort=ref')).rows[2].id}`; },
    steps: [{ menu: 'Close without a fix', item: 'Accept the risk…' }],
    title: '^Accept the risk',
    submit: 'Accept risk',
    verify: (row, before) => row.status !== before.status,
  },
  {
    name: 'change: Complete a change in progress',
    async find(api) {
      const rows = (await api.must('GET', '/api/changes?pageSize=20&f.status=in_progress')).rows;
      if (!rows.length) throw new Error('no change in progress in the sample data');
      return `/changes/${rows[0].id}`;
    },
    steps: [{ button: 'Complete' }],
    title: '^Complete this change',
    submit: 'Complete change',
    fill: { Outcome: 'Success' },
    verify: (row) => row.status === 'completed' || row.status === 'reviewed' || row.status === 'closed',
  },
  {
    name: 'course: Record training for someone without an account',
    async find(api) { return `/training/courses/${(await api.must('GET', '/api/courses?pageSize=1&sort=title')).rows[0].id}`; },
    steps: [{ tab: 'People' }, { button: 'Record training' }],
    title: '^Record training',
    submit: ['Record completion', 'Record attempt', 'Assign'],
    fill: { 'People without an account': 'Sample Trainee One' },
  },
  {
    name: 'exercise: Add a finding',
    async find(api) { return `/exercises/${(await api.must('GET', '/api/exercises?pageSize=1&sort=title')).rows[0].id}`; },
    steps: [{ tab: 'Findings' }, { button: 'Add finding' }],
    title: 'finding',
    submit: 'Add finding',
    empty: 'Finding',
  },
];

function dialogTest(c) {
  return {
    name: c.name,
    async run(t) {
      const { page } = t;
      const api = t.api();
      const stamp = Date.now().toString(36);
      const path = await t.step('find or make the record', () => c.find(api, stamp));
      // The record's API address, from the record type whose web route the page is under.
      const resources = Object.values((await api.must('GET', '/api/meta')).resources);
      const res = resources.filter((r) => path.startsWith(`${r.route}/`)).sort((a, b) => b.route.length - a.route.length)[0];
      if (!res) throw new Error(`no record type is shown at ${path}`);
      const apiPath = `${res.path}/${path.slice(res.route.length + 1)}`;
      const read = async () => (await api.must('GET', apiPath));
      const drive = async (spec, label) => {
        const before = await read();
        await t.step(`${label}: open the dialog`, async () => {
          await page.goto(path);
          for (const o of spec.steps) await opener(page, o);
          await markDialog(page, spec.title);
        });
        const submits = [spec.submit].flat();
        const submitText = async () => {
          for (const s of submits) {
            const there = await page.fn((want) => [...(document.querySelector('[data-e2e-dialog="1"]')?.querySelectorAll('button') ?? [])]
              .some((b) => b.getClientRects().length && b.innerText.replace(/\s+/g, ' ').trim() === want), s);
            if (there) return s;
          }
          throw new Error(`none of ${submits.map((s) => `"${s}"`).join(', ')} in the dialog`);
        };
        if (spec.empty) {
          await t.step(`${label}: submitted empty, it is refused with a message beside the field`, async () => {
            page.allow({ status: 400 }, { status: 422 });
            const text = await submitText();
            const disabled = await page.fn((want) => [...document.querySelector('[data-e2e-dialog="1"]').querySelectorAll('button')]
              .find((b) => b.getClientRects().length && b.innerText.replace(/\s+/g, ' ').trim() === want)?.disabled, text);
            if (disabled) { t.log('      (the button stays disabled until the required fields are filled)'); page.clearAllowed(); return; }
            await pressInDialog(page, text);
            await sleep(400);
            if (!(await dialogOpen(page, spec.title))) throw new Error('the empty dialog was accepted and closed');
            const bad = await invalidControls(page, SCOPE);
            const alert = await page.eval(`[...document.querySelectorAll('${SCOPE} [role=alert], ${SCOPE} .form-error')].map((e) => e.innerText).join(' ')`);
            if (typeof spec.empty === 'string' && !bad.find((b) => b.label === spec.empty && b.message)) {
              throw new Error(`"${spec.empty}" is not marked with a message (invalid: ${bad.map((b) => `${b.label}: ${b.message}`).join('; ') || 'none'}; alert: "${alert}")`);
            }
            if (!bad.length && !alert) throw new Error('nothing was marked invalid');
            t.log(`      refused: ${bad.map((b) => `${b.label}: "${b.message}"`).join('; ') || alert}`);
            page.clearAllowed();
          });
        }
        await t.step(`${label}: fill in and submit`, async () => {
          if (spec.pick) await page.click({ text: spec.pick, within: SCOPE, tag: 'label, [role=radio], button' });
          await fillRequired(page, SCOPE, stamp, spec.fill ?? {});
          await pressInDialog(page, await submitText());
          for (let i = 0; i < 40 && (await dialogOpen(page, spec.title)); i++) await sleep(150);
          if (await dialogOpen(page, spec.title)) {
            const bad = await invalidControls(page, SCOPE);
            const alert = await page.eval(`[...document.querySelectorAll('${SCOPE} [role=alert], ${SCOPE} .form-error')].map((e) => e.innerText).join(' ')`);
            const all = (await controls(page, SCOPE)).map((x) => `${x.label}${x.required ? '*' : ''}=${x.value}`).join(', ');
            throw new Error(`the dialog is still open; invalid: ${bad.map((b) => `${b.label} (${b.message})`).join(', ') || 'none'}; alert: "${alert}"; fields: ${all}`);
          }
          await page.settled();
        });
        if (spec.verify) {
          await t.step(`${label}: the change is saved`, async () => {
            const after = await read();
            if (!spec.verify(after, before)) throw new Error(`not saved as expected: ${JSON.stringify(after).slice(0, 400)}`);
          });
        }
      };
      await drive(c, 'dialog');
      if (c.then) await drive(c.then, 'then');
      t.clean(c.name);
    },
  };
}

export const tests = CASES.map(dialogTest);
