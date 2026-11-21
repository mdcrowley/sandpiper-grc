import { describe, expect, it } from 'vitest';
import { knownFields, knownFilters } from './fieldNames';
import type { ResourceMeta } from './meta';

// E18-48: a field the record type no longer has (an option switched off) is left out of the
// generic lists, forms and summaries, whatever the page names.
describe('fields the record type has', () => {
  const vehicle = { type: 'vehicle', fields: { fleet_number: { label: 'Fleet number', type: 'text' }, mode: { label: 'Mode', type: 'lookup' } } } as unknown as ResourceMeta;

  it('keeps its own fields and the standard columns, in the order given', () => {
    expect(knownFields(vehicle, ['mode', 'created_at', 'fleet_number'])).toEqual(['mode', 'created_at', 'fleet_number']);
  });

  it('leaves out a field the metadata does not have', () => {
    expect(knownFields(vehicle, ['fleet_number', 'funder_interest', 'funder_interest_pct'])).toEqual(['fleet_number']);
  });

  it('passes everything through while the metadata is loading', () => {
    expect(knownFields(undefined, ['funder_interest'])).toEqual(['funder_interest']);
  });
});

// E18-49: a filter read from the page address or a saved view is kept only on a field the type has.
describe('filters on fields the record type has', () => {
  const vehicle = { type: 'vehicle', fields: { mode: { label: 'Mode', type: 'lookup' }, cf_depot: { label: 'Depot', type: 'text' } } } as unknown as ResourceMeta;

  it('keeps filters on its fields, the standard columns, custom fields and tags, with their operators', () => {
    const filters = { mode: ['bus'], 'created_at.gt': ['2026-01-01'], cf_depot: ['north'], tags: ['radio'], 'tags.null': ['true'] };
    expect(knownFilters(vehicle, filters)).toEqual(filters);
  });

  it('drops filters on a field the metadata does not have, with or without an operator', () => {
    expect(knownFilters(vehicle, { mode: ['bus'], funder_interest: ['true'], 'funder_interest_pct.gt': ['5'] })).toEqual({ mode: ['bus'] });
  });

  it('keeps everything while the metadata is loading', () => {
    expect(knownFilters(null, { funder_interest: ['true'] })).toEqual({ funder_interest: ['true'] });
  });
});
