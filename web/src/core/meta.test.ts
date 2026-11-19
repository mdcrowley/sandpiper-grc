import { describe, expect, it, vi } from 'vitest';

// meta.tsx draws chips with the core UI, which reads the page title when it loads.
vi.hoisted(() => { (globalThis as { document?: unknown }).document ??= { title: 'Sandpiper GRC' }; });
import { customFieldNames, lookupColor, lookupLabel, recordHref, toColorName, type FieldMeta } from './meta';
import { fieldShell } from './fieldShell';

describe('custom fields', () => {
  it('lists only custom fields, in the administrator order, then by name', () => {
    const fields: Record<string, FieldMeta> = {
      title: { label: 'Title', type: 'text' },
      cf_zone: { label: 'Zone', type: 'text', custom: true, position: 2 },
      cf_depot: { label: 'Depot', type: 'text', custom: true, position: 1 },
      cf_b: { label: 'B', type: 'text', custom: true },
      cf_a: { label: 'A', type: 'text', custom: true },
    };
    expect(customFieldNames({ fields })).toEqual(['cf_a', 'cf_b', 'cf_depot', 'cf_zone']);
    expect(customFieldNames(undefined)).toEqual([]);
    expect(customFieldNames({ fields: { title: fields.title } })).toEqual([]);
  });
});

describe('record addresses', () => {
  it('joins a route and an id once', () => {
    expect(recordHref('/tickets', 'abc')).toBe('/tickets/abc');
    expect(recordHref('/tickets/', 'abc')).toBe('/tickets/abc');
    expect(recordHref('/tickets/abc', 'abc')).toBe('/tickets/abc');
  });
});

describe('lookup values before the lists have loaded', () => {
  it('falls back to the raw value and gray', () => {
    expect(lookupLabel('ticket_status', 'open')).toBe('open');
    expect(lookupLabel('ticket_status', null)).toBe('');
    expect(lookupLabel('ticket_status', '')).toBe('');
    expect(lookupColor('ticket_status', 'open')).toBe('gray');
  });

  it('accepts only known color names', () => {
    expect(toColorName('red')).toBe('red');
    expect(toColorName('#ff0000')).toBe('gray');
    expect(toColorName(null)).toBe('gray');
    expect(toColorName(undefined)).toBe('gray');
  });
});

describe('form field shell', () => {
  it('shows the label, required marker, hint and error', () => {
    const p = fieldShell({ label: 'Title', required: true, hint: 'Short', error: 'Required' });
    expect(p).toMatchObject({ label: 'Title', 'aria-label': undefined, required: true, withAsterisk: true, error: 'Required', description: 'Short', size: 'sm' });
    expect(p.className).toBe('rc-field');
    expect(p.inputWrapperOrder).toEqual(['label', 'input', 'description', 'error']);
  });

  it('keeps a hidden label for assistive technology and drops empty values', () => {
    const p = fieldShell({ label: 'Search', hideLabel: true, required: true, error: '', hint: '', className: 'x', size: 'xs' });
    expect(p).toMatchObject({ label: undefined, 'aria-label': 'Search', required: true, withAsterisk: false, error: undefined, description: undefined, className: 'rc-field x', size: 'xs' });
    expect(fieldShell({ label: 'A' }).required).toBeUndefined();
  });
});
