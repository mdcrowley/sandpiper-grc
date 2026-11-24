import { describe, expect, it } from 'vitest';
import { computeLayout } from './mapLayout';
import type { GraphEdge, GraphNode } from './mapLayout';
import { PALETTE_COLORS, pictureName, renderMapSvg, xml } from './mapExport';
import type { Palette } from './mapExport';

const palette: Palette = {
  bg: '#ffffff', grid: false, surface: '#ffffff', border: '#dddddd', borderControl: '#bbbbbb', text: '#111111', textMuted: '#555555',
  font: 'system-ui, "Segoe UI", sans-serif',
  colors: Object.fromEntries(PALETTE_COLORS.map((c, i) => [c, { bg: `#e0000${i}`, fg: `#20000${i}`, solid: `#90000${i}` }])) as Palette['colors'],
};

const nodes: GraphNode[] = [
  { id: 's1', type: 'system', label: 'Dispatch <CAD> & "AVL"', group: 'Operations', route: '/systems/s1', ref: 'SYS-1', attrs: { criticality: 'tier_1' } },
  { id: 's2', type: 'system', label: 'Passenger information', group: 'Operations', route: '/systems/s2' },
  { id: 'v1', type: 'vendor', label: 'Invented Vendor', group: 'Vendors', route: null },
  { id: 'r1', type: 'service', label: 'Route 12 Crosstown', group: 'Services', route: '/services/r1', ref: '12' },
];
const edges: GraphEdge[] = [
  { from: 's1', to: 's2', kind: 'integration', label: 'API', direction: 'one_way' },
  { from: 's1', to: 'v1', kind: 'vendor', label: 'supplied by' },
  { from: 's2', to: 'r1', kind: 'service', label: 'needed for passenger information' },
];
const layout = computeLayout(nodes, edges, 'group', (k) => ({ label: k, order: 0 }));

describe('saving the map as a picture', () => {
  it('escapes text for XML', () => {
    expect(xml(`a<b> & "c" 'd'`)).toBe('a&lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;');
  });

  it('draws a stand-alone SVG with a heading, every record and a legend', () => {
    const { svg, width, height } = renderMapSvg(layout, { palette, title: 'Relationship map', subtitle: 'Invented estate' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(width).toBeGreaterThanOrEqual(layout.width);
    expect(height).toBeGreaterThan(layout.height);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(svg).toContain('>Relationship map</text>');
    expect(svg).toContain('Invented estate');
    // Names are escaped, never raw markup.
    expect(svg).toContain('Dispatch &lt;CAD&gt; &amp;');
    expect(svg).not.toContain('<CAD>');
    // One group per record, and the legend names the record types present.
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(nodes.length + 1);
    for (const word of ['Systems', 'Vendors', 'Services', 'Integration (arrow: the way data flows)', 'Other relationship']) expect(svg).toContain(word);
    expect(svg).not.toContain('>Sites<');
    // No stylesheet and no theme variables: every color is written out.
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('url(#grid)');
  });

  it('draws the dotted background only in the screen colors', () => {
    expect(renderMapSvg(layout, { palette: { ...palette, grid: true }, title: 'Map' }).svg).toContain('url(#grid)');
  });

  it('outlines what is affected when asked, and says so in the legend', () => {
    const plain = renderMapSvg(layout, { palette, title: 'Map' }).svg;
    const hot = renderMapSvg(layout, { palette, title: 'Map', selectedId: 's1', impacted: new Set(['s2', 'r1']) }).svg;
    expect(plain).not.toContain('Affected if the selected system fails');
    expect(hot).toContain('Affected if the selected system fails');
    expect(hot).toContain(`stroke="${palette.colors.red.solid}"`);
    expect(hot).toContain('url(#arrow-hot)');
  });

  it('shows criticality dots and their legend when systems carry them', () => {
    const { svg } = renderMapSvg(layout, {
      palette, title: 'Map', tiers: [{ label: 'Tier 1', color: '#ff0000' }, { label: 'Tier 2', color: '#00ff00' }],
      criticalityColor: (n) => (n.attrs?.criticality === 'tier_1' ? '#ff0000' : null),
    });
    expect(svg).toContain('Criticality: Tier 1');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('names the file after the map and the day', () => {
    expect(pictureName('Relationship map', '2026-11-19', 'png')).toBe('relationship-map-2026-11-19.png');
    expect(pictureName('Connections of CAD/AVL (main)', '2026-11-19', 'svg')).toBe('connections-of-cad-avl-main-2026-11-19.svg');
    expect(pictureName('***', '2026-11-19', 'svg')).toBe('map-2026-11-19.svg');
  });

  it('draws the lines behind the group headings, on a band that hides them (E18-65)', () => {
    const { svg } = renderMapSvg(layout, { palette, title: 'Relationship map' });
    const lastLine = Math.max(...layout.edges.map((e) => svg.indexOf(`d="${e.path}"`)));
    const firstBand = svg.indexOf('class="group-band"');
    expect(lastLine).toBeGreaterThan(0);
    expect(firstBand).toBeGreaterThan(lastLine);
    // Every group heading comes after the last line, and every node after the headings.
    for (const g of layout.groups) expect(svg.indexOf(`>${xml(g.label)}<tspan`)).toBeGreaterThan(lastLine);
    expect(svg.indexOf('<g transform="translate(', firstBand)).toBeGreaterThan(firstBand);
    expect(svg.lastIndexOf('class="group-band"')).toBeLessThan(svg.indexOf('<g transform="translate(', firstBand));
  });
});
