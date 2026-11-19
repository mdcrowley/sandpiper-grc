// Every default role in the browser (E18-07). The switched-off roles are switched on in the scratch
// instance. Signed in as each role, every route is visited and the role x page matrix is written to
// tools/e2e/out/role-matrix.md. A role must:
//   - reach every navigation entry it is shown, with no error and no failed request;
//   - see "No access" (never an error or a crash) on a page it may not use, and not reach the list
//     or records of a record type it may not view;
//   - not see New, Export, bulk selection or Edit where its permissions do not allow them, and see
//     New where they do;
//   - never see a restricted record (risks, security incidents, vulnerabilities) without security.view.
import { ROLES } from '../lib/instance.mjs';
import { concreteRoutes, pageFacts } from '../lib/routes.mjs';

/** Faults already raised as issues: reported as KNOWN, they do not fail the run. Remove each when fixed. */
const KNOWN = [
  { route: '/reports/:id', problem: /^HTTP 403 request: \/api\/reports\/[^/]+\/run/, issue: 'E18-38' },
];

const shared = { routes: null, resources: null, baseline: new Map(), titles: new Map(), matrix: new Map(), failures: [] };

/** True when `perms` (from /api/auth/state) grants `perm`, wildcards included. */
function can(perms, perm) {
  if (!perm) return true;
  const [mod] = perm.split('.');
  return perms.includes('*') || perms.includes(perm) || perms.includes(`${mod}.*`);
}

/** What a list or record page offers: New, Export, row selection, Edit buttons. */
const offers = (page) => page.fn(() => {
  const vis = (e) => e.getClientRects().length > 0;
  const buttons = [...document.querySelectorAll('main button, main a')].filter(vis).map((b) => (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim());
  return {
    // The page's own New button (in its header or list toolbar), not a record that happens to be
    // called "New ...". "New project request" is open to everyone by design (a setting, E11-16).
    newButton: [...document.querySelectorAll('main .page-header button, main .page-header a, main .rc-toolbar button')].filter(vis)
      .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).some((b) => /^New\b/.test(b) && !/request$/i.test(b)),
    exportButton: buttons.some((b) => /^Export( CSV)?$/.test(b)),
    select: [...document.querySelectorAll('main table input[type=checkbox]')].some(vis),
    edit: buttons.some((b) => /^Edit\b/.test(b) && !/selected/.test(b)),
    text: document.querySelector('main')?.innerText ?? '',
  };
});

async function setup(t) {
  if (shared.routes) return;
  const { visit, resources } = await concreteRoutes(t.page, t.api());
  shared.routes = visit;
  shared.resources = resources;
  const api = t.api();
  for (const v of visit) {
    if (v.record && resources[v.type]) {
      const id = v.path.split('/').pop();
      const row = await api.get(`${resources[v.type].path}/${id}`);
      // Restricted records: the whole type, or (for flagged types) this row.
      const restricted = resources[v.type].restricted === true || (resources[v.type].restricted === 'flag' && row.body?.restricted === true);
      if (row.status === 200 && restricted) shared.titles.set(v.path, String(row.body[resources[v.type].titleField] ?? ''));
    }
  }
}

function tour(role) {
  return {
    name: `${role}: every page`,
    as: role,
    async run(t) {
      await setup(t);
      const state = await t.api(role).must('GET', '/api/auth/state');
      const perms = state.permissions ?? [];
      const restrictedOk = can(perms, 'security.view');
      t.log(`   permissions: ${perms.join(' ')}`);

      // Navigation entries this role is shown.
      await t.page.goto('/');
      const nav = await t.page.fn(() => [...document.querySelectorAll('nav[aria-label="Main"] a[href]')].map((a) => new URL(a.href).pathname));
      t.log(`   navigation: ${nav.join(' ')}`);
      t.page.takeProblems();

      const cells = new Map();
      shared.matrix.set(role, cells);
      for (const v of shared.routes) {
        const res = v.type ? shared.resources[v.type] : null;
        const isList = res && !v.record && res.route === v.pattern;
        const viewPerm = res ? `${res.module}.view` : null;
        const hidden = res && (!can(perms, viewPerm) || (res.restricted === true && !restrictedOk));
        // A record or list the role may not read answers 403/404: expected, not a fault.
        if (hidden) t.page.allow({ status: 403 }, { status: 404 });
        // A record the role may not see (not shared with it, or restricted) answers 404: shown as "not found".
        if (v.record && res) t.page.allow({ status: 404, url: new RegExp(`^${res.path}/${v.path.split('/').pop()}(\\?|$)`) }, { status: 403, url: new RegExp(`^${res.path}/${v.path.split('/').pop()}(\\?|$)`) });
        await t.page.goto(v.path);
        const f = await pageFacts(t.page);
        const o = await offers(t.page);
        const problems = t.page.takeProblems();
        t.page.clearAllowed();
        const fail = [];
        let cell;
        if (f.noAccess) cell = 'no access';
        else if (v.record && /not found/i.test(`${f.h1 ?? ''} ${o.text.slice(0, 300)}`)) cell = 'hidden';
        else cell = 'ok';
        if (problems.length) fail.push(...problems);
        if (f.errors.length) fail.push(`error shown: ${f.errors.join(' | ')}`);
        if (!f.h1 && cell !== 'hidden') fail.push('no page heading');
        if (nav.includes(v.path) && cell !== 'ok') fail.push(`navigation offers it but it shows ${cell}`);
        if (hidden && cell === 'ok' && (isList || v.record)) fail.push(`reachable without ${res.restricted === true && can(perms, viewPerm) ? 'security.view' : viewPerm}`);
        if (v.record && !restrictedOk && shared.titles.get(v.path) && o.text.includes(shared.titles.get(v.path))) {
          fail.push('shows a restricted record\'s title without security.view');
        }
        if (cell === 'ok' && res) {
          const base = shared.baseline.get(v.path);
          if (role === 'administrator') shared.baseline.set(v.path, o);
          else if (base) {
            if (isList) {
              if (base.newButton && o.newButton && !can(perms, `${res.module}.create`)) fail.push(`shows New without ${res.module}.create`);
              if (base.newButton && !o.newButton && can(perms, `${res.module}.create`)) fail.push(`hides New although the role has ${res.module}.create`);
              if (o.exportButton && !can(perms, `${res.module}.export`)) fail.push(`shows Export without ${res.module}.export`);
              if (o.select && !can(perms, `${res.module}.edit`)) fail.push(`offers row selection (bulk edit) without ${res.module}.edit`);
            }
            if (v.record && o.edit && !can(perms, `${res.module}.edit`)) fail.push(`shows Edit without ${res.module}.edit`);
          }
        }
        for (let i = fail.length - 1; i >= 0; i--) {
          const k = KNOWN.find((x) => x.route === v.pattern && x.problem.test(fail[i]));
          if (k) { t.log(`      KNOWN DEFECT ${k.issue}: ${role} ${v.pattern}: ${fail[i]}`); fail.splice(i, 1); cell = `${cell} (${k.issue})`; }
        }
        if (fail.length) {
          cell = `FAIL (${cell})`;
          t.soft(false, `${role} ${v.pattern}: ${fail.join('; ')}`);
          shared.failures.push({ role, route: v.pattern, fail });
        }
        cells.set(v.pattern, cell);
      }
      const counts = [...cells.values()].reduce((m, c) => { m[c.split(' (')[0]] = (m[c.split(' (')[0]] ?? 0) + 1; return m; }, {});
      t.log(`   ${role}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    },
  };
}

const matrix = {
  name: 'write the role x page matrix',
  async run(t) {
    if (!shared.routes) return;
    const roles = ROLES.filter((r) => shared.matrix.has(r));
    const short = { ok: 'ok', 'no access': 'no access', hidden: 'hidden' };
    const lines = [
      '# Role x page matrix',
      '',
      `${new Date().toISOString()}. "ok": the page loads with no error; "no access": the "No access" page; "hidden": the record is`,
      'not shown ("not found"); "FAIL": see the list below. Record pages use the first sample record of each type.',
      '',
      `| Page | ${roles.join(' | ')} |`,
      `|---|${roles.map(() => '---').join('|')}|`,
      ...shared.routes.map((v) => `| \`${v.pattern}\` | ${roles.map((r) => short[shared.matrix.get(r).get(v.pattern)] ?? `**${shared.matrix.get(r).get(v.pattern)}**`).join(' | ')} |`),
      '',
      shared.failures.length ? '## Failures' : 'No failures.',
      '',
      ...shared.failures.map((f) => `- ${f.role} \`${f.route}\`: ${f.fail.join('; ')}`),
      '',
    ];
    t.reports.roleMatrix = lines.join('\n');
    t.log(`   matrix: ${shared.routes.length} pages x ${roles.length} roles, ${shared.failures.length} failing cells`);
  },
};

export const tests = [...ROLES.map(tour), matrix];
