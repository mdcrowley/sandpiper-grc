import { describe, expect, it } from 'vitest';
import type { NavItem } from './module';
import { groupLabel, LEGACY_NAV_GROUPS, NAV_GROUPS, navGroupOf } from './navGroups';
import { allowedNav, currentMenuPath, hubCardAt, hubCards, menuGroups, sectionTabs } from './navModel';
import { cleanPins, MAX_PINS, togglePin } from './navMemory';

// E44-01 (wave 24): the menu, tab strips and Administration page come from the modules' nav entries.
const items: NavItem[] = [
  { group: 'Home', label: 'Overview', path: '/', icon: 'home', order: 0 },
  { group: 'Home', label: 'My work', path: '/my-work', icon: 'check-circle', order: 10, tabs: 'Summary' },
  { group: 'Home', label: 'My actions', path: '/actions/mine', icon: 'check-circle', order: 31, menu: false, parent: '/my-work', tab: 'Actions' },
  { group: 'IT services', label: 'Tickets', path: '/tickets', icon: 'ticket', permission: 'tickets.view', order: 10, tabs: 'Tickets' },
  { group: 'IT services', label: 'Service desk settings', path: '/tickets/settings', icon: 'clock', permission: 'tickets.administer', order: 12, menu: false, parent: '/tickets', tab: 'Settings', hub: 'Area settings' },
  { group: 'IT services', label: 'Service desk dashboard', path: '/tickets/dashboard', icon: 'chart', permission: 'tickets.view', order: 11, menu: false, parent: '/tickets', tab: 'Dashboard' },
  { group: 'Risk and compliance', label: 'Action tracker', path: '/actions', icon: 'check-square', order: 60 },
  { group: 'Risk and compliance', label: 'Risk register', path: '/risks', icon: 'alert', order: 10 },
  { group: 'Risk and compliance', label: 'Key risk indicators', path: '/kris', icon: 'target', order: 12, menu: false, parent: '/risks' },
  { group: 'Governance and records', label: 'Legal holds', path: '/admin/legal-holds', icon: 'lock', order: 40 },
  { group: 'Administration', label: 'Administration', path: '/admin', icon: 'settings', order: 10, hubHome: true },
  { group: 'Administration', label: 'Users', path: '/admin/users', icon: 'users', permission: 'admin.administer', order: 20, menu: false, hub: 'People and access' },
  { group: 'Administration', label: 'Audit log', path: '/admin/audit', icon: 'history', permission: 'audit.view', order: 62, menu: false, hub: 'Data and operations' },
];
const everything = () => true;
const only = (...held: string[]) => (p: string | undefined) => !p || held.includes(p);

describe('menu groups (E44-01)', () => {
  it('orders the groups as the redesign does and has no Help group', () => {
    expect(NAV_GROUPS).toEqual(['Home', 'IT services', 'Assets', 'Vendors', 'Projects and funding', 'Security', 'Risk and compliance',
      'Safety and emergency management', 'Governance and records', 'Documents', 'People and training', 'Reports', 'Administration']);
  });

  it('maps the old group names to the new ones', () => {
    expect(navGroupOf('Service desk')).toBe('IT services');
    expect(navGroupOf('Change')).toBe('IT services');
    expect(navGroupOf('Inventory')).toBe('Assets');
    expect(navGroupOf('Cybersecurity')).toBe('Security');
    expect(navGroupOf('Governance')).toBe('Governance and records');
    expect(navGroupOf('Help')).toBe('Home');
    expect(navGroupOf('Reports')).toBe('Reports');
    expect(navGroupOf('Nowhere')).toBe('Home');
    expect(navGroupOf(null)).toBe('Home');
    for (const to of Object.values(LEGACY_NAV_GROUPS)) expect(NAV_GROUPS).toContain(to);
  });
});

describe('the side menu', () => {
  it('lists only menu entries, sorted, and leaves out pages that are tabs or cards', () => {
    const groups = menuGroups(allowedNav(items, everything));
    expect(groups.map((g) => [g.group, g.items.map((i) => i.label)])).toEqual([
      ['Home', ['Overview', 'My work']],
      ['IT services', ['Tickets']],
      ['Risk and compliance', ['Risk register', 'Action tracker']],
      ['Governance and records', ['Legal holds']],
      ['Administration', ['Administration']],
    ]);
  });

  it('shows Administration only to someone who may open one of its cards', () => {
    expect(allowedNav(items, only('tickets.view')).some((i) => i.hubHome)).toBe(false);
    // An auditor sees it, for the audit log alone.
    const auditor = allowedNav(items, only('audit.view'));
    expect(auditor.some((i) => i.hubHome)).toBe(true);
    expect(hubCards(auditor)).toEqual([{ section: 'Data and operations', cards: [expect.objectContaining({ label: 'Audit log' })] }]);
  });

  it('highlights the parent of a page that is not in the menu', () => {
    const all = allowedNav(items, everything);
    expect(currentMenuPath('/kris', all)).toBe('/risks');
    expect(currentMenuPath('/kris/123', all)).toBe('/risks');
    expect(currentMenuPath('/actions/mine', all)).toBe('/my-work');
    expect(currentMenuPath('/actions/12', all)).toBe('/actions');
    expect(currentMenuPath('/tickets/settings', all)).toBe('/tickets');
    expect(currentMenuPath('/admin/users/5', all)).toBe('/admin');
    expect(currentMenuPath('/admin/legal-holds/5', all)).toBe('/admin/legal-holds');
    expect(currentMenuPath('/nowhere', all)).toBeNull();
  });
});

describe('tab strips the shell draws', () => {
  const all = allowedNav(items, everything);

  it('puts the entry first, the others by order and Settings last, on each of its pages', () => {
    const tabs = sectionTabs('/tickets/dashboard', all);
    expect(tabs?.label).toBe('Tickets sections');
    expect(tabs?.tabs.map((t) => t.label)).toEqual(['Tickets', 'Dashboard', 'Settings']);
    expect(tabs?.active).toBe('/tickets/dashboard');
    expect(sectionTabs('/tickets', all)?.active).toBe('/tickets');
  });

  it('has no strip on a record, on a page with its own strip, or without a second tab', () => {
    expect(sectionTabs('/tickets/42', all)).toBeNull();
    expect(sectionTabs('/kris', all)).toBeNull();
    expect(sectionTabs('/risks', all)).toBeNull();
    // An agent who may not administer the desk has no Settings tab.
    expect(sectionTabs('/tickets', allowedNav(items, only('tickets.view')))?.tabs.map((t) => t.label)).toEqual(['Tickets', 'Dashboard']);
    expect(sectionTabs('/my-work', allowedNav(items.filter((i) => i.path !== '/actions/mine'), everything))).toBeNull();
  });

  it('names the Administration card of a page for the breadcrumb', () => {
    expect(hubCardAt('/admin/users', all)?.label).toBe('Users');
    expect(hubCardAt('/admin/users/1', all)).toBeUndefined();
  });
});

describe('pinned pages', () => {
  it('keeps at most ten, without repeats or addresses outside the application', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ path: `/p${i}`, label: `Page ${i}` }));
    expect(cleanPins(many)).toHaveLength(MAX_PINS);
    expect(cleanPins([{ path: '//evil.example', label: 'x' }, { path: 'https://x', label: 'y' }, { path: '/a', label: '' }, { path: '/a', label: 'A' }, { path: '/a', label: 'A again' }, 'junk']))
      .toEqual([{ path: '/a', label: 'A' }]);
    expect(cleanPins(null)).toEqual([]);
  });

  it('pins and unpins, and does not pin past the limit', () => {
    const one = togglePin([], { path: '/a', label: 'A' });
    expect(one).toEqual([{ path: '/a', label: 'A' }]);
    expect(togglePin(one, { path: '/a', label: 'A' })).toEqual([]);
    const full = Array.from({ length: MAX_PINS }, (_, i) => ({ path: `/p${i}`, label: `P${i}` }));
    expect(togglePin(full, { path: '/b', label: 'B' })).toBe(full);
  });
});

describe('group names while an area is off', () => {
  it('drops the name of a switched-off area from a joined group, and leaves other groups alone', () => {
    const on = (off: string[]) => (area: string) => !off.includes(area);
    expect(groupLabel('Risk and compliance', on([]))).toBe('Risk and compliance');
    expect(groupLabel('Risk and compliance', on(['risks']))).toBe('Compliance');
    expect(groupLabel('Safety and emergency management', on(['safety']))).toBe('Emergency management');
    expect(groupLabel('Projects and funding', on(['funding']))).toBe('Projects');
    expect(groupLabel('People and training', on(['training']))).toBe('People');
    expect(groupLabel('Governance and records', on(['records']))).toBe('Governance');
    expect(groupLabel('Security', on(['risks', 'safety']))).toBe('Security');
  });
});
