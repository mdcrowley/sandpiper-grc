// The audit universe: the areas that need auditing, how often, and when each is next due.
import { PageHeader, RecordPage, ResourceList } from '../../core';
import { AuditTabs } from './shared';

export function AreaList() {
  return (
    <div className="stack">
      <PageHeader title="Audit universe" subtitle="Everything that needs auditing, how often, when each was last audited and when the next audit is due." />
      <AuditTabs active="areas" />
      <ResourceList
        type="audit_area"
        urlState
        columns={['name', 'category', 'risk_level', 'cycle_months', 'last_audited_on', 'next_due_on', 'owner_id', { field: 'active', hidden: true }]}
        filters={['category', 'risk_level', 'owner_id', 'active', 'next_due_on']}
        createFields={['name', 'category', 'description', 'cycle_months', 'next_due_on', 'risk_level', 'owner_id']}
      />
    </div>
  );
}

export function AreaDetail() {
  return (
    <RecordPage
      type="audit_area"
      summaryFields={['name', 'category', 'description', 'risk_level', 'cycle_months', 'last_audited_on', 'next_due_on', 'owner_id', 'active']}
      tabs={[{
        key: 'audits', label: 'Audits',
        content: ({ row }) => (
          <ResourceList type="audit_engagement" baseFilter={{ area_id: row.id }} urlState={false}
            columns={['ref', 'title', 'audit_type', 'plan_year', 'status', 'planned_start', 'lead_auditor_id']}
            createFields={['title', 'audit_type', 'plan_year', 'planned_start', 'planned_end', 'lead_auditor_id']}
            createInitial={{ area_id: row.id }} />
        ),
      }]}
    />
  );
}
