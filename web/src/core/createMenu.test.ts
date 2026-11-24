import { describe, expect, it } from 'vitest';
import { createEntries, createHome, filterEntries } from './createMenu';
import type { NavItem } from './module';

// E18-63: the Create menu is grouped like the navigation and every entry has an icon.
const nav = (group: NavItem['group'], path: string, icon: NavItem['icon']): NavItem => ({ group, label: path, path, icon });
const GROUPS = ['Home', 'Service desk', 'Inventory', 'Change', 'Governance'] as const;

describe('Create menu entries', () => {
  const tickets = nav('Service desk', '/tickets', 'ticket');
  const catalog = nav('Service desk', '/tickets/catalog', 'book');
  const assets = nav('Inventory', '/assets', 'box');
  const changes = nav('Change', '/changes', 'refresh');

  it('finds the navigation entry an address belongs under, longest path first', () => {
    expect(createHome('/tickets?new=1', [tickets, catalog], [])?.path).toBe('/tickets');
    expect(createHome('/tickets/catalog?new=1', [tickets, catalog], [])?.path).toBe('/tickets/catalog');
    expect(createHome('/assets/new', [], [assets])?.path).toBe('/assets');
    expect(createHome('/elsewhere', [changes], [assets])?.path).toBe('/changes');
    expect(createHome('/elsewhere', [], [assets])).toBeUndefined();
  });

  it('groups by navigation group in order, A to Z within a group, with an icon on every entry', () => {
    const entries = createEntries([
      { nav: [changes], create: [{ label: 'Change', path: '/changes?new=1' }] },
      { nav: [tickets, catalog], create: [{ label: 'Ticket', path: '/tickets?new=1', icon: 'ticket' }, { label: 'Catalog item', path: '/tickets/catalog?new=1' }] },
      { nav: [assets], create: [{ label: 'Asset', path: '/assets?new=1' }] },
      { create: [{ label: 'Plan activation', path: '/nowhere' }] },
    ], [tickets, catalog, assets, changes], GROUPS);
    expect(entries.map((e) => `${e.group}: ${e.label} (${e.icon})`)).toEqual([
      'Home: Plan activation (plus)',
      'Service desk: Catalog item (book)',
      'Service desk: Ticket (ticket)',
      'Inventory: Asset (box)',
      'Change: Change (refresh)',
    ]);
  });
});

describe('the Create menu filter (E18-65)', () => {
  const items = [
    { label: 'Ticket', group: 'Service desk' },
    { label: 'Knowledge article', group: 'Service desk' },
    { label: 'Safety event', group: 'Safety' },
    { label: 'Hazard', group: 'Safety' },
    { label: 'Emergency activation', group: 'Governance' },
  ];

  it('lists everything while the box is empty', () => {
    expect(filterEntries(items, '')).toEqual(items);
    expect(filterEntries(items, '   ')).toEqual(items);
  });

  it('matches the label or the group, ignoring case, every word', () => {
    expect(filterEntries(items, 'TICK').map((i) => i.label)).toEqual(['Ticket']);
    expect(filterEntries(items, 'safety').map((i) => i.label)).toEqual(['Safety event', 'Hazard']);
    expect(filterEntries(items, 'article desk').map((i) => i.label)).toEqual(['Knowledge article']);
    expect(filterEntries(items, 'activation').map((i) => i.label)).toEqual(['Emergency activation']);
  });

  it('finds nothing for words that match no entry', () => {
    expect(filterEntries(items, 'zebra')).toEqual([]);
    expect(filterEntries(items, 'ticket safety')).toEqual([]);
  });
});
