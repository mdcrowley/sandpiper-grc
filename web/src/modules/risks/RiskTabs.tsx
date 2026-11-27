// The risk register's sections as a tab strip, like the other modules' sub-pages (E18-64): the
// register, reviews, key risk indicators and report for everyone who may see risks, the scales and appetite for those who
// administer them.
import { useNavigate } from 'react-router-dom';
import { Tabs, useAuth } from '../../core';

const SECTIONS = [
  { key: 'register', label: 'Register', path: '/risks' },
  { key: 'reviews', label: 'Reviews', path: '/risks/reviews' },
  { key: 'indicators', label: 'Indicators', path: '/kris' },
  { key: 'report', label: 'Report', path: '/risks/report' },
  { key: 'scales', label: 'Scales', path: '/risks/scales', admin: true },
  { key: 'appetite', label: 'Appetite', path: '/risks/appetite', admin: true },
] as const;

export type RiskSection = (typeof SECTIONS)[number]['key'];

export function RiskTabs({ active }: { active: RiskSection }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const shown = SECTIONS.filter((s) => !('admin' in s) || can('risks.administer'));
  return (
    <Tabs label="Risk register sections" active={active} tabs={shown.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/risks')} />
  );
}
