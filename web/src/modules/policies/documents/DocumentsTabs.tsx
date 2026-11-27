// The sections of the Documents area as tabs under one menu entry (review-nav section 3): the
// library for everyone, and the register, reviews, groups, import, kiosk and settings only for the
// people whose role uses them. A person who can only read sees no tab strip at all.
import { useNavigate } from 'react-router-dom';
import { Tabs, useAuth } from '../../../core';

export type DocSection = 'library' | 'register' | 'approvals' | 'reviews' | 'external' | 'groups' | 'import' | 'kiosk' | 'settings';

const SECTIONS: { key: DocSection; label: string; path: string; permission?: string }[] = [
  { key: 'library', label: 'Library', path: '/documents' },
  { key: 'register', label: 'Register', path: '/documents/register', permission: 'policies.view' },
  { key: 'approvals', label: 'Waiting for approval', path: '/documents/approvals', permission: 'policies.approve' },
  { key: 'reviews', label: 'Reviews due', path: '/documents/reviews', permission: 'policies.edit' },
  { key: 'external', label: 'External documents', path: '/documents/external', permission: 'policies.view' },
  { key: 'groups', label: 'Distribution groups', path: '/documents/groups', permission: 'policies.administer' },
  { key: 'import', label: 'Import', path: '/documents/import', permission: 'policies.administer' },
  { key: 'kiosk', label: 'Acknowledgment kiosk', path: '/documents/kiosk', permission: 'policies.edit' },
  { key: 'settings', label: 'Settings', path: '/documents/settings', permission: 'policies.administer' },
];

/** The sections this person may open, in menu order. */
export function useDocSections() {
  const { can } = useAuth();
  return SECTIONS.filter((s) => !s.permission || can(s.permission));
}

export function DocumentsTabs({ active }: { active: DocSection }) {
  const navigate = useNavigate();
  const shown = useDocSections();
  if (shown.length < 2) return null;
  return (
    <Tabs
      label="Document sections" active={active} tabs={shown.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/documents')}
    />
  );
}
