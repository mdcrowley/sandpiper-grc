// Funders (E45-09): the organizations behind awards, certifications and compliance reviews, and one funder
// with everything filed under it.
import { PageHeader, RecordPage, ResourceList, useFetch } from '../../core';
import type { Row } from '../../core';
import { FundingTabs } from './shared';

export function FunderList() {
  return (
    <div className="stack">
      <PageHeader title="Funders" subtitle="The organizations that fund awards, ask for yearly certifications and review how awards are managed." />
      <FundingTabs active="funders" />
      <ResourceList
        type="funder"
        urlState
        columns={['ref', 'name', 'contact_name', 'website', { field: 'vendor_id', hidden: true }, { field: 'contact_email', hidden: true }]}
        filters={['vendor_id']}
        createFields={['name', 'contact_name', 'contact_email', 'website', 'vendor_id', 'notes']}
      />
    </div>
  );
}

function Counted({ row }: { row: Row }) {
  const { data } = useFetch<{ awards: number; certifications: number; reviews: number }>(`/api/funders/${row.id}/summary`);
  if (!data) return null;
  return <span>{data.awards} award{data.awards === 1 ? '' : 's'} · {data.certifications} certification{data.certifications === 1 ? '' : 's'} · {data.reviews} review{data.reviews === 1 ? '' : 's'}</span>;
}

export function FunderDetail() {
  return (
    <RecordPage
      type="funder"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Funders', to: '/funding/funders' }]}
      subtitle={(row) => <Counted row={row} />}
      summaryFields={['name', 'contact_name', 'contact_email', 'website', 'vendor_id', 'notes']}
      tabs={[
        {
          key: 'awards', label: 'Awards',
          content: ({ row }) => (
            <ResourceList type="funding_award" baseFilter={{ funder_id: String(row.id) }}
              columns={['ref', 'title', 'program_name', 'status', 'amount', 'period_end']} filters={['status']}
              createFields={['title', 'program_name', 'award_number', 'status', 'period_start', 'period_end', 'amount', 'local_share', 'manager_id']}
              createInitial={{ funder_id: row.id }} />
          ),
        },
        {
          key: 'certifications', label: 'Certifications',
          content: ({ row }) => (
            <ResourceList type="funding_certification" baseFilter={{ funder_id: String(row.id) }}
              columns={['ref', 'year', 'title', 'status', 'due_on', 'signer_id']} filters={['status', 'year']} />
          ),
        },
        {
          key: 'reviews', label: 'Compliance reviews',
          content: ({ row }) => (
            <ResourceList type="compliance_review" baseFilter={{ funder_id: String(row.id) }}
              columns={['ref', 'title', 'period', 'site_visit_on', 'status']} filters={['status']}
              createFields={['title', 'period', 'site_visit_on', 'lead_id']} createInitial={{ funder_id: row.id }} />
          ),
        },
      ]}
    />
  );
}
