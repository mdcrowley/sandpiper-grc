// The self-service portal end to end (E40-08), on a phone (390 px) and a desktop (1440 px): the
// portal is switched on and the Requester role enabled through the API, then a fresh person who
// holds only the Requester role, in the browser:
//   - finds a help article and asks for something from the catalog;
//   - reports a problem (started from the search box);
//   - follows a request: an agent asks a question through the API (plus an internal note that must
//     stay hidden), the person sees "Waiting for you" and the question, and replies;
//   - acknowledges a policy published for the Requester role (checked through the API);
//   - cannot open agent pages (they send the person back to the portal) and sees only their own
//     requests (another requester's request answers "Request not found").
// At 390 px no portal page may scroll sideways. Every name and value is invented.
// Run alone with: npm run test:e2e -- --only portal (or --grep portal).
import { PASSWORD } from '../lib/instance.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A wait condition: the main column's text contains `text`. */
const mainHas = (text) => new Function(`return (document.querySelector('main')?.innerText ?? '').includes(${JSON.stringify(text)});`);
/** No sideways scrolling of the page. */
const noSideScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1;

/** Switches the portal area on and makes sure the Requester role is enabled (idempotent). */
async function portalOn(t) {
  const api = t.api();
  await api.must('POST', '/api/auth/confirm', { password: PASSWORD });
  const areas = (await api.must('GET', '/api/admin/features')).areas;
  const want = Object.fromEntries(areas.filter((a) => ['tickets', 'portal', 'policies'].includes(a.key)).map((a) => [a.key, true]));
  if (areas.some((a) => want[a.key] && !a.on)) {
    await api.must('PATCH', '/api/admin/features', { features: want });
    await sleep(300);
  }
  const roles = await api.must('GET', '/api/admin/roles');
  const list = Array.isArray(roles) ? roles : roles.rows ?? roles.roles ?? [];
  const requester = list.find((r) => r.key === 'requester');
  if (!requester) throw new Error('no Requester role is listed once the portal is on');
  if (!requester.enabled) await api.must('POST', `/api/admin/roles/${requester.id}/enable`, {});
  const config = await t.app.api(t.users.requester.token).must('GET', '/api/portal/config');
  if (!config.enabled || !config.allowed) throw new Error(`the portal is not open to a requester: ${JSON.stringify(config)}`);
}

/** Published for everyone holding the Requester role: written by the security lead, approved and published by the administrator. */
async function publishPolicy(t, title) {
  const author = t.api('security_lead');
  const admin = t.api();
  const p = await author.must('POST', '/api/policies', { title, audience_roles: ['requester'], ack_days: 14 });
  const v = await author.must('POST', `/api/policies/${p.id}/versions`, {
    body: '## Purpose\n\nInvented text: lock the cab tablet whenever you leave the driver seat, and never share your staff sign-in.',
  });
  await admin.must('POST', `/api/policies/${p.id}/versions/${v.id}/approve`, {});
  const published = await admin.must('POST', `/api/policies/${p.id}/versions/${v.id}/publish`, {});
  if (!published.requested) throw new Error(`publishing asked nobody to acknowledge ${title}`);
  return p;
}

/** A catalog item offered in the portal and a help article for all staff, made fresh so the test does not depend on sample data. */
async function offerings(t, stamp) {
  const api = t.api();
  const item = await api.must('POST', '/api/catalog-items', {
    name: `E2E cab tablet not working ${stamp}`,
    description: 'The tablet in a driver\'s cab will not start, freezes, or will not log in.',
    defaults: { type: 'incident', title: 'Cab tablet fault: ' },
    questions: [
      { key: 'vehicle', label: 'Vehicle or fleet number', type: 'text', required: true },
      { key: 'symptom', label: 'What happens', type: 'choice', required: true, options: ['Will not switch on', 'Frozen or very slow', 'Something else'] },
    ],
    active: true, portal: true,
  });
  const article = await api.must('POST', '/api/knowledge', {
    title: `E2E restart a cab tablet ${stamp}`, body: 'Hold the power button for ten seconds, wait, then switch the tablet on again.',
    audience: 'staff', status: 'published',
  });
  return { item, article };
}

const portalTest = (theme, width) => ({
  name: `portal: a requester asks, reports, follows and replies, acknowledges a policy, and stays in the portal (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const phone = width < 600;
    const admin = t.api();
    const stamp = `${width}-${Date.now().toString(36)}`;
    /** At 390 px a page must not scroll sideways. */
    const narrow = async (where) => { if (phone) t.soft(await page.fn(noSideScroll), `${where} scrolls sideways at ${width} px`); };

    await t.step('switch the portal on and enable the Requester role', () => portalOn(t));
    const person = await t.step('make a person who holds only the Requester role', () => t.app.newUser(`e2e.rider-desk-${stamp}`, ['requester']));
    const personApi = t.app.api(person.token);
    // Another requester's request, which this person must never see.
    const theirs = await t.step('another requester raises a request', () => t.app.api(t.users.requester.token).must('POST', '/api/portal/requests', {
      title: `E2E someone else's printer jam ${stamp}`, affects: 'me', how_urgent: 'can_wait',
    }));
    const policy = await t.step('publish a policy that needs acknowledgment', () => publishPolicy(t, `E2E cab tablet use ${stamp}`));
    const { item, article } = await t.step('offer a catalog item and a help article in the portal', () => offerings(t, stamp));
    await page.setSession(person.token);

    await t.step('signing in lands on the portal home', async () => {
      await page.goto('/');
      await page.waitFor(() => location.pathname === '/portal', { timeout: 10000 });
      await page.waitFor({ css: '.pt-home h1' }, { timeout: 10000 });
      t.soft((await page.text('main h1')).startsWith('Hello'), `the home page heading is "${await page.text('main h1')}"`);
      t.soft(!(await page.exists({ css: 'nav[aria-label="Main"]' })), 'the agent sidebar is shown');
      await narrow('the portal home');
      t.clean('portal home');
    });

    await t.step('the search box finds a help article', async () => {
      await page.click({ label: 'What do you need help with?' });
      await page.type(`restart cab tablet ${stamp}`);
      await page.waitFor({ css: `.pt-search-results a[href="/portal/knowledge/${article.id}"]` }, { timeout: 10000 });
      await narrow('the home page with search results');
    });

    const asked = await t.step('ask for something from the catalog', async () => {
      await page.goto('/portal');
      await page.click({ css: 'a.pt-action[href="/portal/catalog"]' });
      await page.waitFor(() => location.pathname === '/portal/catalog', { timeout: 10000 });
      await page.waitFor({ css: `a[href="/portal/new/${item.id}"]` }, { timeout: 10000 });
      await narrow('the catalog');
      await page.click({ css: `a[href="/portal/new/${item.id}"]` });
      await page.waitFor({ label: 'Vehicle or fleet number' }, { timeout: 10000 });
      await narrow('the catalog request form');
      await page.fill({ label: 'Vehicle or fleet number' }, '4127');
      await page.click({ text: 'Frozen or very slow', tag: 'label' });
      await page.fill({ label: 'Anything else we should know?' }, `E2E: the screen froze at the second stop (${stamp}).`);
      await page.fill({ label: 'Where are you?' }, 'North depot, bay 3');
      await page.click({ text: 'Send request', tag: 'button' });
      await page.waitFor(() => /^\/portal\/requests\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
      const id = (await page.path).split('/')[3];
      await page.waitFor({ css: '.pt-detail h1' }, { timeout: 10000 });
      t.soft((await page.text('main')).includes('4127'), 'the answer is not shown under What you told us');
      await narrow('the new request');
      const ticket = await admin.must('GET', `/api/tickets/${id}`);
      t.soft(ticket.requester_id === person.id, 'the request does not name the person as the requester');
      t.soft(ticket.catalog_item_id === item.id, 'the request is not tied to its catalog item');
      t.soft(ticket.channel === 'portal', `the request came in through "${ticket.channel}"`);
      t.clean('catalog request');
      return ticket;
    });

    const reported = await t.step('report a problem, started from the search box', async () => {
      await page.goto('/portal');
      await page.click({ label: 'What do you need help with?' });
      const what = `E2E validator beeps twice ${stamp}`;
      await page.type(what);
      await page.waitFor({ css: 'a.pt-search-report' }, { timeout: 10000 });
      await page.click({ css: 'a.pt-search-report' });
      await page.waitFor(() => location.pathname === '/portal/report', { timeout: 10000 });
      const prefilled = await page.fn(() => document.querySelector('main input')?.value ?? '');
      if (!t.soft(prefilled === what, `What is wrong? was filled with "${prefilled}"`)) await page.fill({ label: 'What is wrong?' }, what);
      await page.fill({ label: 'More detail' }, 'E2E: the card validator by the rear door beeps twice and shows no fare.');
      await page.fill({ label: 'Where?' }, 'Bus 3310');
      await page.click({ text: 'My team, depot or station', tag: 'label' });
      await page.click({ text: 'I can work, but it slows me down', tag: 'label' });
      await narrow('the problem report form');
      await page.click({ text: 'Send', tag: 'button' });
      await page.waitFor(() => /^\/portal\/requests\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
      const id = (await page.path).split('/')[3];
      await page.waitFor(mainHas(what), { timeout: 10000 });
      const ticket = await admin.must('GET', `/api/tickets/${id}`);
      t.soft(ticket.type === 'incident', `the problem was raised as "${ticket.type}"`);
      t.soft(ticket.impact === 'department' && ticket.urgency === 'medium', `impact ${ticket.impact}, urgency ${ticket.urgency}`);
      t.clean('problem report');
      return ticket;
    });

    await t.step('an agent asks a question (and writes an internal note) through the API', async () => {
      const agent = t.api('agent');
      // (An instance attached with E2E_BASE does not know the accounts' ids: ask.)
      const agentId = t.users.agent.id ?? (await agent.must('GET', '/api/auth/state')).user.id;
      await agent.must('PATCH', `/api/tickets/${reported.id}`, { status: 'waiting_requester', assignee_id: agentId });
      await agent.must('POST', '/api/comments', { record_type: 'ticket', record_id: reported.id, body: `E2E internal: probably the reader firmware (${stamp}).`, internal: true });
      await agent.must('POST', '/api/comments', { record_type: 'ticket', record_id: reported.id, body: `E2E: which route was the bus on? (${stamp})`, internal: false });
    });

    await t.step('My requests lists both, the problem waiting for the person, and nobody else\'s', async () => {
      await page.goto('/portal/requests');
      await page.waitFor(mainHas(reported.title), { timeout: 10000 });
      const text = await page.text('main');
      t.soft(text.includes(asked.title), 'the catalog request is not listed');
      t.soft(!text.includes(theirs.title), 'another requester\'s request is listed');
      const waiting = await page.fn((title) => [...document.querySelectorAll('a.pt-req')].find((a) => a.innerText.includes(title))?.innerText ?? '', reported.title);
      t.soft(/Waiting for you/.test(waiting), `the problem shows "${waiting.replace(/\s+/g, ' ')}"`);
      await narrow('My requests');
      const mine = await personApi.must('GET', '/api/portal/requests');
      t.soft(mine.rows.every((r) => r.id !== theirs.id), 'the API lists another requester\'s request');
      t.clean('my requests');
    });

    await t.step('the request shows the agent\'s question, not the internal note, and the person replies', async () => {
      await page.click({ text: reported.title, tag: 'a' });
      await page.waitFor(mainHas('which route was the bus on?'), { timeout: 10000 });
      const text = await page.text('main');
      t.soft(text.includes('Waiting for you'), 'the status does not say Waiting for you');
      t.soft(!text.includes('E2E internal'), 'the internal note is shown to the requester');
      await narrow('the request page');
      await page.fill({ label: 'Your reply' }, `E2E: route 12, northbound (${stamp}).`);
      await page.click({ text: 'Send', tag: 'button', within: 'form.pt-reply' });
      await page.waitFor(() => [...document.querySelectorAll('.pt-msg-mine')].some((m) => m.innerText.includes('route 12, northbound')), { timeout: 10000 });
      const ticket = await admin.must('GET', `/api/tickets/${reported.id}`);
      t.soft(ticket.status === 'in_progress', `after the reply the request is "${ticket.status}"`);
      const comments = await admin.must('GET', `/api/comments?record_type=ticket&record_id=${reported.id}`);
      t.soft(comments.some((c) => c.body.includes('route 12, northbound') && c.author_id === person.id && !c.internal), 'the reply is not a public comment by the person');
      t.clean('reply');
    });

    await t.step('acknowledge the policy', async () => {
      await page.goto('/portal');
      await page.waitFor({ text: policy.title, tag: 'a' }, { timeout: 10000 });
      await page.click({ text: policy.title, tag: 'a' });
      await page.waitFor(() => /^\/portal\/policies\//.test(location.pathname), { timeout: 10000 });
      await page.waitFor(mainHas('lock the cab tablet'), { timeout: 10000 });
      await narrow('the policy page');
      await page.click({ text: 'I have read and understood it', tag: 'button' });
      await page.waitFor(() => location.pathname === '/portal', { timeout: 10000 });
      await page.waitFor({ css: '#pt-policies-h' }, { timeout: 10000 });
      const gone = await page.waitFor({ text: policy.title, tag: 'a' }, { gone: true, timeout: 5000 }).catch(() => false);
      t.soft(gone, 'the policy is still listed to acknowledge');
      const mine = await personApi.must('GET', '/api/policies/acknowledgments/mine');
      t.soft(mine.acknowledged.some((a) => a.policy_id === policy.id), 'the person\'s own list does not show it acknowledged');
      const tracking = await admin.must('GET', `/api/policies/${policy.id}/acknowledgments`);
      const row = (tracking.rows ?? []).find((r) => r.user_id === person.id);
      t.soft(row?.state === 'acknowledged' && Boolean(row?.acknowledged_at), `the policy's tracking shows ${row ? row.state : 'no row'} for the person`);
      t.clean('policy acknowledgment');
    });

    await t.step('agent pages send the person back to the portal', async () => {
      for (const path of ['/tickets', `/tickets/${reported.id}`, '/admin/users', '/policies']) {
        await page.goto(path);
        await page.waitFor(() => location.pathname === '/portal', { timeout: 10000 }).catch(() => null);
        const at = await page.path;
        t.soft(at === '/portal', `${path} stayed at ${at}`);
        t.soft(!(await page.exists({ css: 'nav[aria-label="Main"]' })), `${path} shows the agent sidebar`);
      }
      t.clean('agent pages');
      const list = await personApi.call('GET', '/api/tickets');
      t.soft(list.status === 403, `GET /api/tickets answered ${list.status} to a requester`);
      const one = await personApi.call('GET', `/api/tickets/${reported.id}`);
      t.soft([403, 404].includes(one.status), `GET /api/tickets/:id answered ${one.status} to a requester`);
    });

    await t.step('another requester\'s request answers "Request not found"', async () => {
      page.allow({ status: 404, url: new RegExp(`/api/portal/requests/${theirs.id}$`) });
      await page.goto(`/portal/requests/${theirs.id}`);
      await page.waitFor({ text: 'Request not found', tag: 'h1' }, { timeout: 10000 });
      t.soft(!(await page.text('main')).includes(theirs.title), 'the other request\'s title is shown');
      const api = await personApi.call('GET', `/api/portal/requests/${theirs.id}`);
      t.soft(api.status === 404, `the API answered ${api.status}`);
      await narrow('Request not found');
      t.clean('someone else\'s request');
      page.clearAllowed();
    });
  },
});

export const tests = [portalTest('light', 390), portalTest('dark', 1440)];
