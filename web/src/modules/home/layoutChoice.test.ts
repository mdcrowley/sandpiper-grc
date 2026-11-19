import { describe, expect, it } from 'vitest';
import { areasFor } from './layoutChoice';

describe('the Overview for people who only look (E12-07)', () => {
  it('lists the areas a person may open, without Home or Help', () => {
    const nav = [
      { group: 'Home', label: 'Overview', path: '/' },
      { group: 'Cybersecurity', label: 'Frameworks', path: '/frameworks', permission: 'frameworks.view' },
      { group: 'Vendors', label: 'Contracts', path: '/contracts', permission: 'contracts.view' },
      { group: 'Reports', label: 'Dashboards', path: '/dashboards', permission: 'dashboards.view' },
      { group: 'Reports', label: 'Dashboards', path: '/dashboards', permission: 'dashboards.view' },
      { group: 'Projects', label: 'New project request', path: '/projects/new', permission: 'dashboards.view' },
      { group: 'Change', label: 'New change', path: '/changes?new=1', permission: 'dashboards.view' },
      { group: 'Administration', label: 'Audit log', path: '/admin/audit', permission: 'audit.view' },
      { group: 'Help', label: 'User guide', path: '/help' },
    ];
    const can = (p?: string) => !p || ['frameworks.view', 'audit.view', 'dashboards.view'].includes(p);
    expect(areasFor(nav, can)).toEqual([
      { label: 'Frameworks', path: '/frameworks', group: 'Cybersecurity' },
      { label: 'Dashboards', path: '/dashboards', group: 'Reports' },
      { label: 'Audit log', path: '/admin/audit', group: 'Administration' },
    ]);
  });
});
