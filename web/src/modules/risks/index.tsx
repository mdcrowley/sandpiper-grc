import { Link } from 'react-router-dom';
import { RecordPage, ResourceList, useMeta } from '../../core';
import type { ModuleDef, Row } from '../../core';
import { ActionStatus } from './ActionStatus';
import { ActionTracker } from './ActionTracker';
import { RiskDetail } from './RiskDetail';
import { RiskRegister } from './RiskRegister';
import './risks.css';

export { ActionsPanel } from './ActionsPanel';

function ActionDetail() {
  const { resources } = useMeta();
  const source = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    if (!target || !row.source_id) return row.external_ref ? <span className="muted">External reference {row.external_ref}</span> : null;
    return <span>Arose from <Link to={`${target.route}/${row.source_id}`}>{target.label.toLowerCase()} record</Link></span>;
  };
  return (
    <RecordPage
      type="action"
      subtitle={source}
      status={(row) => <ActionStatus key={`${row.id}-${row.status}`} row={row} />}
      summaryFields={['title', 'description', 'status', 'priority', 'owner_id', 'due_on', 'completed_on', 'source', 'department', 'external_ref', 'notes']}
    />
  );
}

function ObligationList() {
  return (
    <ResourceList
      type="obligation"
      title="Obligations"
      columns={['ref', 'title', 'source', 'status', 'owner_id', 'next_due_on']}
      filters={['status', 'owner_id', 'next_due_on']}
      createFields={['title', 'source', 'requirement', 'owner_id', 'how_met', 'evidence', 'next_due_on', 'status']}
    />
  );
}

function ObligationDetail() {
  return (
    <RecordPage
      type="obligation"
      subtitle={(row) => row.source}
      summaryFields={['title', 'source', 'requirement', 'status', 'owner_id', 'how_met', 'evidence', 'next_due_on']}
    />
  );
}

const mod: ModuleDef = {
  key: 'risks',
  nav: [
    { group: 'Cybersecurity', label: 'Risk register', path: '/risks', icon: 'alert', permission: 'risks.view', order: 20 },
    { group: 'Cybersecurity', label: 'Action tracker', path: '/actions', icon: 'check-square', permission: 'actions.view', order: 60 },
    { group: 'Cybersecurity', label: 'Obligations', path: '/obligations', icon: 'scale', permission: 'obligations.view', order: 70 },
  ],
  routes: [
    { path: '/risks', element: <RiskRegister />, permission: 'risks.view' },
    { path: '/risks/:id', element: <RiskDetail />, permission: 'risks.view' },
    { path: '/actions', element: <ActionTracker />, permission: 'actions.view' },
    { path: '/actions/:id', element: <ActionDetail />, permission: 'actions.view' },
    { path: '/obligations', element: <ObligationList />, permission: 'obligations.view' },
    { path: '/obligations/:id', element: <ObligationDetail />, permission: 'obligations.view' },
  ],
  create: [
    { label: 'Risk', path: '/risks?new=1', permission: 'risks.create' },
    { label: 'Action', path: '/actions?new=1', permission: 'actions.create' },
    { label: 'Obligation', path: '/obligations?new=1', permission: 'obligations.create' },
  ],
};

export default mod;
