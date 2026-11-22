// Smoke: every route the application registers loads as an administrator, in the light theme at
// 1440 pixels and the dark theme at 820, with no script error, no failed request, a page
// heading, no error state and no sideways scrolling; and every navigation entry opens a page
// whose title is the entry's label, with no label cut off in the sidebar.
import { concreteRoutes, pageFacts } from '../lib/routes.mjs';

const tour = (theme, width) => ({
  name: `every route loads (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { visit, skipped } = await t.step('list the routes', () => concreteRoutes(t.page, t.api()));
    t.page.takeProblems();
    t.log(`   ${visit.length} routes; not visited (no sample record or public): ${skipped.join(' ')}`);
    for (const { path, pattern } of visit) {
      await t.page.goto(path);
      const f = await pageFacts(t.page);
      const problems = [
        ...t.page.takeProblems(),
        ...(f.h1 ? [] : ['no page heading']),
        ...(f.errors.length ? [`error shown: ${f.errors.join(' | ')}`] : []),
        ...(f.noAccess ? ['shows "No access" to an administrator'] : []),
        ...(f.wide ? ['scrolls sideways'] : []),
      ];
      if (problems.length) t.soft(false, `${pattern}: ${problems.join('; ')}`);
      else t.log(`   ok  ${pattern} [${f.h1}]`);
    }
  },
});

/** Compared without case, spacing or a trailing period: "Service catalog" and "Service Catalog" agree. */
const same = (a, b) => String(a ?? '').replace(/\s+/g, ' ').replace(/\.$/, '').trim().toLowerCase()
  === String(b ?? '').replace(/\s+/g, ' ').replace(/\.$/, '').trim().toLowerCase();

/** Entries whose page has another title on purpose, and why. */
const EXEMPT = {
  '/': 'the Overview greets the person by name',
};

// E18-24: every navigation entry's label is the title (h1) of the page it opens, so a person who
// picks "Service catalog" lands on a page called "Service catalog".
const navTitles = {
  name: 'navigation labels match page titles',
  theme: 'light', width: 1440,
  async run(t) {
    await t.page.goto('/');
    const links = await t.step('read the navigation', () => t.page.fn(() => [...document.querySelectorAll('nav[aria-label="Main"] a.nav-link[href]')]
      .map((a) => {
        const span = a.querySelector('.nav-label');
        // Every group starts open, so a label too long for the sidebar shows as cut off (an ellipsis).
        return { path: new URL(a.href).pathname + new URL(a.href).search, label: span?.innerText?.trim() ?? a.innerText.trim(), cut: Boolean(span && span.scrollWidth > span.clientWidth + 1) };
      })));
    t.page.takeProblems();
    t.soft(links.length > 20, `only ${links.length} navigation entries found`);
    for (const { label } of links.filter((l) => l.cut)) t.soft(false, `navigation label "${label}" is cut off in the sidebar`);
    for (const { path, label } of links.filter((l) => !EXEMPT[l.path])) {
      await t.page.goto(path);
      const f = await pageFacts(t.page);
      t.page.takeProblems();
      if (same(label, f.h1)) t.log(`   ok  ${path} [${label}]`);
      else t.soft(false, `${path}: navigation says "${label}", the page title is "${f.h1}"`);
    }
  },
};

export const tests = [tour('light', 1440), tour('dark', 820), navTitles];
