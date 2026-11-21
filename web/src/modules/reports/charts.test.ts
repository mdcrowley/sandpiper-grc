import { describe, expect, it } from 'vitest';
import { buildChart } from './charts';
import type { ReportResult } from './types';

// SP-04: a heat map's tooltip is placed as HTML by the chart library, and its row and column names
// are record text, so they are escaped. Invented data only.
const result = (rowName: string, colName: string): ReportResult => ({
  type: 'gizmo', typeLabel: 'Gizmo', plural: 'Gizmos', route: '/gizmos', mode: 'groups',
  columns: [
    { key: 'g0', label: 'Site', type: 'text', role: 'dim' },
    { key: 'g1', label: 'Kind', type: 'text', role: 'dim' },
    { key: 'a0', label: 'Count', type: 'number', role: 'agg', fn: 'count' },
  ],
  rows: [{ v: { g0: rowName, g1: colName, a0: 3 }, d: { g0: rowName, g1: colName } }],
  total: 3, truncated: false, drill: '', drillExact: true, globalsApplied: [], restricted: false, recordTypes: ['gizmo'], generatedAt: '2026-01-01T00:00:00Z',
});

describe('heat-map tooltip', () => {
  it('escapes record text rather than placing it as HTML', () => {
    const built = buildChart('heatmap', result('<meta http-equiv="refresh" content="0;url=https://example.test">', 'Depot <b>north</b> & "east"'))!;
    const tooltip = (built.option as { tooltip: { formatter: (p: unknown) => string } }).tooltip;
    const html = tooltip.formatter({ data: [0, 0, 3] });
    expect(html).not.toContain('<meta');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;meta http-equiv=&quot;refresh&quot;');
    expect(html).toContain('Depot &lt;b&gt;north&lt;/b&gt; &amp; &quot;east&quot;');
    expect(html).toContain('<strong>3</strong>');
  });
});
