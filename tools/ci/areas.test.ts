import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Plain JavaScript modules (they run before npm ci); tools/ is outside the typechecked projects.
import { repoRoot } from './affected.mjs';
import { CORE_PATTERNS, affectedAreas, ownerOf } from './areas.mjs';
import { browserPlan, plan, selectTests, snapshot } from './plan.mjs';
import { CORE_ROUTES, SUITES, chooseSuites, shareOut } from '../e2e/suite-map.mjs';

// Change-based CI (wave 27): nothing may escape the selection silently. Every module is an area,
// every page and record type belongs to one, every browser suite is in the suite map, and the
// selection picks what a change needs.

const snap = snapshot(repoRoot);
const dirs = (p: string) => readdirSync(join(repoRoot, p), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);

describe('the area map', () => {
  it('has every server and web module as an area', () => {
    for (const m of [...dirs('server/src/modules'), ...dirs('web/src/modules')]) expect(snap.areas.has(m), m).toBe(true);
  });

  it('names each web module after its folder, so the browser can tell which area a page belongs to', () => {
    for (const m of dirs('web/src/modules')) {
      const index = join(repoRoot, 'web/src/modules', m, 'index.tsx');
      let text = '';
      try { text = readFileSync(index, 'utf8'); } catch { continue; }
      expect(text, m).toMatch(new RegExp(`\\bkey:\\s*'${m}'`));
    }
  });

  it('finds the pages and record types of the areas', () => {
    const withRoutes = [...snap.areas.values()].filter((a: any) => a.routes.length);
    expect(withRoutes.length).toBeGreaterThan(35);
    expect(snap.areas.get('risks').routes).toContain('/risks/:id');
    expect(snap.areas.get('risks').types).toContain('risk');
    expect(snap.areas.get('inventory').types).toEqual(expect.arrayContaining(['asset', 'system']));
    // Every record type the browser's record journeys drive belongs to an area.
    const allTypes = new Set([...snap.areas.values()].flatMap((a: any) => a.types));
    const journeys = readFileSync(join(repoRoot, 'tools/e2e/suites/03-records.mjs'), 'utf8');
    for (const m of journeys.matchAll(/^\s*\{ type: '([a-z_]+)'/gm)) expect(allTypes.has(m[1]), m[1]).toBe(true);
  });

  it('reads a record type written as a constant, and never takes a field type for one', () => {
    // `type: PAYMENT`, `type: T.plan`, `type: kind.modelType`: resolved in the file or the files it imports.
    expect(snap.areas.get('insurance').types).toEqual(expect.arrayContaining(['insurance_claim_payment', 'insurance_certificate_request']));
    expect(snap.areas.get('procurement').types).toEqual(expect.arrayContaining(['purchase_order', 'purchase_invoice', 'budget_version']));
    expect(snap.areas.get('risks').types).toContain('risk_appetite_change');
    expect(snap.areas.get('strategy').types).toContain('strategic_plan');
    expect(snap.areas.get('models').types).toEqual(expect.arrayContaining(['vehicle_model', 'asset_model']));
    expect(snap.areas.get('fleet').types).toEqual(expect.arrayContaining(['maintenance_interval', 'vehicle_reading', 'maintenance_record']));
    const fieldTypes = ['text', 'textarea', 'ref', 'lookup', 'number', 'currency', 'date', 'datetime', 'user', 'boolean', 'json'];
    for (const a of snap.areas.values() as Iterable<any>) for (const ty of a.types) expect(fieldTypes, `${a.key}: ${ty}`).not.toContain(ty);
    // Every resource defined in a module's server folder gives its area a record type.
    for (const a of snap.areas.values() as Iterable<any>) {
      const calls = a.files.filter((f: string) => /^server\/.*\.ts$/.test(f) && !/\.test\.ts$/.test(f))
        .reduce((n: number, f: string) => n + (readFileSync(join(repoRoot, f), 'utf8').split('defineResource(').length - 1), 0);
      if (calls) expect(a.types.length, a.key).toBeGreaterThan(0);
    }
  });

  it('puts every product file in an area or in core', () => {
    const loose = snap.files.filter((f: string) => /^(server\/src|web\/src)\//.test(f) && !ownerOf(f));
    expect(loose).toEqual([]);
  });
});

describe('the suite map', () => {
  it('lists every browser suite, and only those', () => {
    const files = readdirSync(join(repoRoot, 'tools/e2e/suites')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort();
    expect(Object.keys(SUITES).sort()).toEqual(files);
  });

  it('names only areas that exist, and covers every area with pages through the tours', () => {
    for (const [name, s] of Object.entries<any>(SUITES)) {
      expect(['tour', 'always', 'core', 'area']).toContain(s.kind);
      expect(s.minutes, name).toBeGreaterThan(0);
      for (const a of s.areas ?? []) expect(snap.areas.has(a), `${name}: ${a}`).toBe(true);
      if (s.kind === 'area') expect(s.areas.length, name).toBeGreaterThan(0);
    }
    expect(Object.values<any>(SUITES).some((s) => s.kind === 'tour')).toBe(true);
    expect(CORE_ROUTES).toContain('/');
  });

  it('shares work out the same way on every machine, and leaves nothing out', () => {
    const units = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, minutes: (i % 7) + 1 }));
    const parts = [1, 2, 3, 4].map((i) => shareOut(units, 4, i));
    expect(parts.flat().map((u) => u.id).sort()).toEqual(units.map((u) => u.id).sort());
    expect(shareOut(units, 4, 2)).toEqual(parts[1]);
    const load = parts.map((p) => p.reduce((m, u) => m + u.minutes, 0));
    expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(7);
  });
});

describe('what a change selects', () => {
  it('two pages of one module: that area, its tests, the filtered tours and its own suites', () => {
    const changed = ['web/src/modules/risks/RiskDetail.tsx', 'web/src/modules/risks/RiskRegister.tsx'];
    const hit = affectedAreas(repoRoot, changed, snap.files, snap.graph);
    expect(hit.everything).toBe(false);
    expect([...hit.areas.keys()]).toEqual(['risks']);
    const b = browserPlan(snap, changed);
    const run = b.suites.map((s: any) => s.suite);
    expect(run).toEqual(expect.arrayContaining(['01-smoke', '02-auth', '04-roles']));
    expect(run).not.toContain('05-keyboard'); // the shell's own suite: only when core changes
    expect(run).not.toContain('11-audits');
    expect(b.suites.find((s: any) => s.suite === '04-roles').filtered).toBe(true);
    expect(b.types).toContain('risk');
    const t = selectTests(snap, changed);
    expect(t.all).toBe(false);
    for (const f of t.tests.keys()) expect(f, t.tests.get(f)).toMatch(/^web\/src\/modules\/risks\/|^web\/src\//);
  });

  it('an area suite runs for its area only', () => {
    const b = browserPlan(snap, ['server/src/modules/audits/index.ts']);
    expect(b.suites.map((s: any) => s.suite)).toContain('11-audits');
    expect(b.suites.map((s: any) => s.suite)).not.toContain('13-continuity');
  });

  it('a change to a server module runs its tests and the checks of every module, not the whole suite', () => {
    const t = selectTests(snap, ['server/src/modules/tickets/sla.ts']);
    expect(t.all).toBe(false);
    const files = [...t.tests.keys()];
    expect(files).toContain('server/src/modules/tickets/sla.test.ts');
    expect(files).toContain('server/src/core/route-sweep.test.ts');
    expect(files.length).toBeLessThan(80);
  });

  it('core widens to everything and says why', () => {
    const hit = affectedAreas(repoRoot, ['web/src/core/ListTable.tsx'], snap.files, snap.graph);
    expect(hit.everything).toBe(true);
    expect(hit.why).toMatch(/ListTable\.tsx is the web shell/);
    expect(CORE_PATTERNS.length).toBeGreaterThan(5);
    expect(chooseSuites(hit).length).toBe(Object.keys(SUITES).length);
    expect(selectTests(snap, ['server/src/test/helpers.ts']).all).toBe(true);
  });

  it('documentation outside the user guide runs nothing but is reported', () => {
    const p = plan(snap, ['docs/roadmap/README.md']);
    expect(p.tests.all).toBe(false);
    expect(p.browser.suites).toEqual([]);
    expect(p.build.run).toBe(false);
    expect(p.jobs.mobile.run).toBe(false);
  });

  it('a changed browser suite runs in full', () => {
    const b = browserPlan(snap, ['tools/e2e/suites/15-ot.mjs']);
    expect(b.suites.find((s: any) => s.suite === '15-ot')).toMatchObject({ filtered: false, why: 'the suite changed' });
  });
});
