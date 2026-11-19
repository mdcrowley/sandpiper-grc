// Smoke: every route the application registers loads as an administrator, in the light theme at
// 1440 pixels and the dark theme at 820, with no script error, no failed request, a page
// heading, no error state and no sideways scrolling.
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

export const tests = [tour('light', 1440), tour('dark', 820)];
