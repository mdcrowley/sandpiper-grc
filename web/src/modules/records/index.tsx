// Records requests and privacy (feature area `records`): requests for records and personal data with
// their deadlines, responsive records and exemptions, and privacy impact assessments. Legal holds are
// a module of their own (holds), always on.
import type { ModuleDef } from '../../core';
import { AssessmentDetail, AssessmentList, CoveragePage } from './Privacy';
import { RequestDetail, RequestList } from './Requests';

const records = 'records.view';
const privacy = 'privacy.view';

const mod: ModuleDef = {
  key: 'records',
  nav: [
    { group: 'Governance and records', label: 'Records requests', path: '/records-requests', icon: 'file-text', permission: records, order: 20 },
    { group: 'Governance and records', label: 'Privacy', path: '/privacy', icon: 'lock', permission: privacy, order: 21 },
  ],
  routes: [
    { path: '/records-requests', element: <RequestList />, permission: records },
    { path: '/records-requests/:id', element: <RequestDetail />, permission: records },
    { path: '/privacy', element: <CoveragePage />, permission: privacy },
    { path: '/privacy/assessments', element: <AssessmentList />, permission: privacy },
    { path: '/privacy/assessments/:id', element: <AssessmentDetail />, permission: privacy },
  ],
  create: [
    { label: 'Records request', path: '/records-requests?new=1', permission: 'records.create', icon: 'file-text' },
    { label: 'Privacy impact assessment', path: '/privacy/assessments?new=1', permission: 'privacy.create', icon: 'lock' },
  ],
};
export default mod;
