// Funding and grant compliance: dashboard, awards, yearly certifications, compliance reviews,
// deficiencies, the review areas loaded from a file, and sub-recipients with their monitoring.
import type { ModuleDef } from '../../core';
import { AwardDetail, AwardList } from './Awards';
import { CertificationDetail, CertificationList } from './Certifications';
import { FundingDashboard } from './Dashboard';
import { DeficiencyDetail, DeficiencyList } from './Deficiencies';
import { ReviewAreas } from './ReviewAreas';
import { ReviewDetail, ReviewList } from './Reviews';
import './funding.css';
import { SubrecipientDetail, SubrecipientList } from './Subrecipients';

const view = 'funding.view';

const mod: ModuleDef = {
  key: 'funding',
  nav: [
    { group: 'Governance', label: 'Funding and grants', path: '/funding', icon: 'chart', permission: view, order: 40 },
  ],
  routes: [
    { path: '/funding', element: <FundingDashboard />, permission: view },
    { path: '/funding/awards', element: <AwardList />, permission: view },
    { path: '/funding/awards/:id', element: <AwardDetail />, permission: view },
    { path: '/funding/certifications', element: <CertificationList />, permission: view },
    { path: '/funding/certifications/:id', element: <CertificationDetail />, permission: view },
    { path: '/funding/reviews', element: <ReviewList />, permission: view },
    { path: '/funding/reviews/:id', element: <ReviewDetail />, permission: view },
    { path: '/funding/deficiencies', element: <DeficiencyList />, permission: view },
    { path: '/funding/deficiencies/:id', element: <DeficiencyDetail />, permission: view },
    { path: '/funding/review-areas', element: <ReviewAreas />, permission: view },
    { path: '/funding/subrecipients', element: <SubrecipientList />, permission: view },
    { path: '/funding/subrecipients/:id', element: <SubrecipientDetail />, permission: view },
  ],
  create: [
    { label: 'Funding award', path: '/funding/awards?new=1', permission: 'funding.create', icon: 'chart' },
    { label: 'Compliance review', path: '/funding/reviews?new=1', permission: 'funding.create', icon: 'check' },
    { label: 'Sub-recipient', path: '/funding/subrecipients?new=1', permission: 'funding.create', icon: 'users' },
  ],
};
export default mod;
