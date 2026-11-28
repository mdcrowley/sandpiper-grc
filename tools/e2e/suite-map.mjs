// Which browser suites a change needs (wave 27). Every suite in tools/e2e/suites is listed here
// (tools/ci/areas.test.ts fails on one that is missing), with:
//   kind  'tour'    visits every route, record type or module; with an area filter it visits only the
//                   routes and record types of the affected areas (plus the core routes below), by
//                   every role and theme it normally covers;
//         'always'  small and about the core set (sign-in): runs in every browser run;
//         'core'    about the shell and the shared screens: runs when everything is affected;
//         'area'    about one part of the product: runs when one of its `areas` is affected;
//   minutes         about how long the whole suite takes on a GitHub runner (to share the work out);
//   split           its tests are independent, so they may run on different machines.
// A changed suite file always runs that suite in full.

export const SUITES = {
  '01-smoke': { kind: 'tour', minutes: 6 },
  '02-auth': { kind: 'always', minutes: 1 },
  '03-records': { kind: 'tour', minutes: 5, split: true },
  '04-roles': { kind: 'tour', minutes: 28, split: true },
  '05-keyboard': { kind: 'core', minutes: 3 },
  '06-lists': { kind: 'core', minutes: 1 },
  '07-dialogs': { kind: 'tour', minutes: 4, split: true },
  '08-keyboard-modules': { kind: 'tour', minutes: 4, split: true },
  '09-features-off': { kind: 'tour', minutes: 20 },
  '10-lifecycles': { kind: 'area', areas: ['lifecycles'], minutes: 1 },
  '11-audits': { kind: 'area', areas: ['audits'], minutes: 1 },
  '12-governance': { kind: 'area', areas: ['governance', 'policies'], minutes: 1 },
  '13-continuity': { kind: 'area', areas: ['continuity'], minutes: 1 },
  '14-condition': { kind: 'area', areas: ['condition', 'fleet'], minutes: 1 },
  '15-ot': { kind: 'area', areas: ['ot'], minutes: 1 },
  '16-records': { kind: 'area', areas: ['holds', 'records'], minutes: 1 },
  '17-vendor-lifecycle': { kind: 'area', areas: ['vendors'], minutes: 1 },
  '18-integrations': { kind: 'area', areas: ['integrations'], minutes: 1 },
  '19-feeds': { kind: 'area', areas: ['feeds', 'evidence'], minutes: 1 },
  '20-followups': { kind: 'area', areas: ['controls'], minutes: 1 },
  '21-tags': { kind: 'area', areas: ['tags'], minutes: 2 },
  '22-models': { kind: 'area', areas: ['models', 'fleet'], minutes: 1 },
  '23-portal': { kind: 'area', areas: ['portal'], minutes: 3 },
  '24-access-reviews': { kind: 'area', areas: ['accessreviews'], minutes: 1 },
  '25-registers': { kind: 'area', areas: ['registers'], minutes: 1 },
  '26-retention-and-files': { kind: 'area', areas: ['recordsretention', 'attachments'], minutes: 1 },
};

/** Routes visited by every filtered tour whatever changed: the overview (with the shell around it). */
export const CORE_ROUTES = ['/'];

/**
 * The suites to run. `affected` is { everything: true } or { areas: Set|Map, suites: Set(changed suite names) }.
 * Returns [{ suite, filtered, why }]: `filtered` means the tour visits only the affected areas.
 */
export function chooseSuites(affected) {
  const out = [];
  const keys = affected.everything ? null : new Set(affected.areas.keys ? affected.areas.keys() : affected.areas);
  for (const [suite, s] of Object.entries(SUITES)) {
    if (affected.everything) { out.push({ suite, filtered: false, why: 'everything is affected' }); continue; }
    if (affected.suites?.has(suite)) { out.push({ suite, filtered: false, why: 'the suite changed' }); continue; }
    if (s.kind === 'always') out.push({ suite, filtered: false, why: 'sign-in is in every run' });
    else if (s.kind === 'tour' && keys.size) out.push({ suite, filtered: true, why: `the routes of ${[...keys].join(', ')} and the overview` });
    else if (s.kind === 'area') {
      const hit = s.areas.filter((a) => keys.has(a));
      if (hit.length) out.push({ suite, filtered: false, why: `${hit.join(', ')} affected` });
    }
  }
  return out;
}

/** About how many minutes a chosen suite takes: a filtered tour in proportion to the areas it visits. */
export function estimateMinutes(choice, areaCount, totalAreas) {
  const s = SUITES[choice.suite];
  if (!choice.filtered) return s.minutes;
  return Math.max(0.5, Math.round(s.minutes * Math.min(1, (areaCount + 1) / Math.max(1, totalAreas)) * 10) / 10);
}

/**
 * Shares `units` ([{ id, minutes }]) out over `n` machines, longest first onto the least loaded one;
 * returns the units of machine `index` (1-based). The same input gives the same answer everywhere.
 */
export function shareOut(units, n, index) {
  const bins = Array.from({ length: n }, () => ({ minutes: 0, units: [] }));
  for (const u of [...units].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id))) {
    const bin = bins.reduce((best, b) => (b.minutes < best.minutes ? b : best), bins[0]);
    bin.minutes += u.minutes;
    bin.units.push(u);
  }
  return bins[index - 1]?.units ?? [];
}
