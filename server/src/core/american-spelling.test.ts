import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// American English on every screen (web and mobile app) and in the sample data (review wave 9): the British forms the
// review found, and "tick" for a check box, do not come back. Identifiers are not checked.
const root = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BRITISH = /\b(signall\w*|digitis\w*|fibre\w*|fuell\w*|towards|greyed|tick(ed|ing)? (the|a|this|each|every|what|box)|ticked|ticks off|Tick (the|a|what|this))\b/i;

function files(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, keep);
    return keep(path) ? [path] : [];
  });
}

describe('American spelling', () => {
  it('in the web app, the mobile app and the sample data', () => {
    const web = files(join(root, 'web/src'), (p) => /\.(tsx?|css)$/.test(p) && !/\.test\.ts$/.test(p));
    const app = ['mobile/src', 'mobile/app'].flatMap((d) => files(join(root, d), (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)));
    const seeds = files(join(root, 'server/src/modules'), (p) => /(seed[^.]*|defaults)\.ts$/.test(p.split(/[\\/]/).pop() ?? ''));
    const found = [...web, ...app, ...seeds].flatMap((p) => readFileSync(p, 'utf8').split('\n')
      .map((line, i) => [line, i] as const)
      .filter(([line]) => BRITISH.test(line))
      .map(([line, i]) => `${p.slice(root.length)}:${i + 1}: ${line.trim().slice(0, 120)}`));
    expect(web.length).toBeGreaterThan(100);
    expect(app.length).toBeGreaterThan(20);
    expect(seeds.length).toBeGreaterThan(5);
    expect(found).toEqual([]);
  });
});
