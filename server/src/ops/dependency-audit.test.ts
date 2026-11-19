import { describe, expect, it } from 'vitest';
import { assessAudit, formatVerdict } from './dependency-audit.ts';

// Shaped like `npm audit --json` (npm 7 and later); package names are invented.
const report = {
  vulnerabilities: {
    'tiny-parser': {
      name: 'tiny-parser', severity: 'critical' as const, isDirect: false,
      via: [{ title: 'Prototype pollution', url: 'https://example.test/advisories/1' }],
      fixAvailable: true,
    },
    'route-kit': {
      name: 'route-kit', severity: 'high' as const, isDirect: true, via: ['tiny-parser'],
      fixAvailable: { name: 'route-kit', version: '5.0.0', isSemVerMajor: true },
    },
    'old-zip': { name: 'old-zip', severity: 'high' as const, isDirect: false, via: [{ title: 'Path traversal' }], fixAvailable: false },
    'color-words': { name: 'color-words', severity: 'moderate' as const, isDirect: false, via: [{ title: 'Slow regular expression' }], fixAvailable: true },
  },
  metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 1, total: 4 } },
};

describe('dependency audit policy (E16-13)', () => {
  it('fails only on vulnerabilities at the level that someone can fix', () => {
    const v = assessAudit(report, 'high');
    expect(v.ok).toBe(false);
    expect(v.actionable.map((f) => [f.name, f.fix])).toEqual([['tiny-parser', 'fix'], ['route-kit', 'major']]);
    expect(v.waiting.map((f) => f.name)).toEqual(['old-zip']);
    expect(v.below.map((f) => f.name)).toEqual(['color-words']);
    expect(v.counts).toEqual({ critical: 1, high: 2, moderate: 1 });
    const text = formatVerdict(v, 'high', 'production packages');
    expect(text).toMatch(/FIX NEEDED \(2\)/);
    expect(text).toMatch(/Waiting for a fix upstream.*\n.*old-zip/);
    expect(text).toMatch(/FAILED/);
  });

  it('passes when what is left has no fix yet, and when nothing is known', () => {
    const onlyWaiting = { vulnerabilities: { 'old-zip': report.vulnerabilities['old-zip'] } };
    expect(assessAudit(onlyWaiting, 'high').ok).toBe(true);
    expect(assessAudit({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }).ok).toBe(true);
    expect(formatVerdict(assessAudit({ vulnerabilities: {} }), 'high', 'all packages')).toMatch(/no known vulnerabilities[\s\S]*passed/);
    // A stricter level catches the moderate one.
    expect(assessAudit(report, 'moderate').actionable.map((f) => f.name)).toContain('color-words');
  });
});
