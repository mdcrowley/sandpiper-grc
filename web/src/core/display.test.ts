// Component tests for the read-only display components, rendered to HTML on the server (no browser
// needed): what they show, their empty states and the names assistive technology reads.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The core UI reads the page title when it loads.
vi.hoisted(() => { (globalThis as { document?: unknown }).document ??= { title: 'Sandpiper GRC' }; });
import { AgendaList, KeyValue, Timeline } from './display';
import { setLocaleSettings } from './format';

const html = (el: ReturnType<typeof h>) => renderToStaticMarkup(h(MemoryRouter, null, el));

describe('Timeline', () => {
  it('lists events in the order given, as a named list with a time element', () => {
    const out = html(h(Timeline, {
      label: 'Ticket history',
      items: [
        { key: 'a', title: 'Created', time: '2026-11-18T10:00:00Z', meta: 'Sample Agent' },
        { key: 'b', title: 'Resolved', timeText: 'Planned for 3 Dec', color: 'green' },
      ],
    }));
    expect(out).toMatch(/^<ol class="ui-timeline" aria-label="Ticket history">/);
    expect(out.indexOf('Created')).toBeLessThan(out.indexOf('Resolved'));
    expect(out).toContain('<time dateTime="2026-11-18T10:00:00.000Z"');
    expect(out).toContain('Sample Agent · ');
    expect(out).toContain('Planned for 3 Dec');
    expect(out).toContain('ui-timeline-green');
    // The marker is decoration.
    expect(out).toContain('class="ui-timeline-marker ui-timeline-dot" aria-hidden="true"');
  });

  it('shows the empty message, or nothing, when there are no events', () => {
    expect(html(h(Timeline, { items: [], empty: 'Nothing has happened yet.' }))).toBe('<p class="muted">Nothing has happened yet.</p>');
    expect(html(h(Timeline, { items: [] }))).toBe('');
  });
});

describe('KeyValue', () => {
  it('renders label and value pairs as a description list, with a dash for empty values', () => {
    const out = html(h(KeyValue, {
      title: 'Details',
      items: [
        { label: 'Owner', value: 'Sample Owner' },
        { label: 'Site', value: null },
        { label: 'Notes', value: '', wide: true, hint: 'Free text' },
        { label: 'Count', value: 0 },
      ],
    }));
    expect(out).toContain('<h3 class="facts-title">Details</h3>');
    expect(out).toContain('<dl class="facts facts-rows">');
    expect(out).toContain('<dt>Owner</dt><dd>Sample Owner</dd>');
    expect(out).toContain('<dt>Site</dt><dd><span class="muted">—</span></dd>');
    expect(out).toContain('facts-item facts-wide');
    expect(out).toContain('<span class="facts-hint">Free text</span>');
    // Zero is a value, not an empty one.
    expect(out).toContain('<dt>Count</dt><dd>0</dd>');
  });
});

describe('AgendaList', () => {
  it('groups dated items by day and says so when there are none', () => {
    setLocaleSettings({ timeZone: 'UTC' });
    const empty = html(h(AgendaList, { items: [], empty: 'Nothing due.' }));
    expect(empty).toContain('Nothing due.');
    const out = html(h(AgendaList, {
      label: 'Due soon',
      items: [
        { key: '1', date: '2026-11-20', title: 'Renew contract' },
        { key: '2', date: '2026-11-20', title: 'Review risk' },
        { key: '3', date: '2026-11-25', title: 'Exercise' },
      ],
    } as Parameters<typeof AgendaList>[0]));
    expect(out).toContain('Due soon');
    for (const t of ['Renew contract', 'Review risk', 'Exercise']) expect(out).toContain(t);
    expect(out.indexOf('Renew contract')).toBeLessThan(out.indexOf('Exercise'));
    expect(out.match(/role="listitem"/g)).toHaveLength(2);
    expect(out).toContain('<h3 class="agenda-date">Nov 20, 2026</h3>');
    expect(out).toContain('<h3 class="agenda-date">Nov 25, 2026</h3>');
  });

  it('shows at most `limit` items, then a link to the rest', () => {
    const items = ['a', 'b', 'c', 'd'].map((k, i) => ({ key: k, date: `2026-11-2${i}`, title: `Item ${k}`, to: `/x/${k}` }));
    const out = html(h(AgendaList, { items, limit: 2, moreTo: '/actions' }));
    expect(out).toContain('href="/x/a"');
    expect(out).not.toContain('Item c');
    expect(out).toMatch(/<a href="\/actions"[^>]*>and 2 more<\/a>/);
  });
});
