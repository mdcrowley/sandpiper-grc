// Section tabs of the records and privacy pages. The privacy tabs appear only for people who may see them.
import { useNavigate } from 'react-router-dom';
import { Tabs, useAuth } from '../../core';

const SECTIONS = [
  { key: 'requests', label: 'Requests', path: '/records-requests', permission: 'records.view' },
  { key: 'coverage', label: 'Privacy coverage', path: '/privacy', permission: 'privacy.view' },
  { key: 'assessments', label: 'Privacy assessments', path: '/privacy/assessments', permission: 'privacy.view' },
] as const;

export function RecordsTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const shown = SECTIONS.filter((s) => can(s.permission));
  if (shown.length < 2) return null;
  return (
    <Tabs label="Records and privacy sections" active={active} tabs={shown.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/records-requests')} />
  );
}
