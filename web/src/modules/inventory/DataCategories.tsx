// Data categories: list and record, with the systems that hold each category.
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, Loading, LookupChip, RecordPage, ResourceList, useAuth, useFetch } from '../../core';

export function DataCategoryList() {
  return (
    <ResourceList
      type="data_category"
      title="Data categories"
      columns={['name', 'sensitivity_level', 'custodian', 'retention_period', 'governing_rule']}
      filters={['sensitivity_level']}
      createFields={['name', 'contains', 'where_held', 'custodian', 'shared_with', 'governing_rule', 'retention_period', 'sensitivity_level']}
    />
  );
}

interface Holder { id: string; ref: string | null; name: string; system_group: string | null; vendor_name: string | null; mfa_status: string | null; hosting_type: string | null }

function Holders({ categoryId }: { categoryId: string }) {
  const { data, error, reload } = useFetch<Holder[]>(`/api/data-categories/${categoryId}/systems`);
  return (
    <Card title="Systems holding this data" flush={!!data?.length}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.length === 0 ? (
          <EmptyState icon="database" title="No systems linked" message="Link this category from a system's Data held tab and the system will appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Reference</th><th scope="col">System</th><th scope="col">Group</th><th scope="col">Hosting</th><th scope="col">Multi-factor</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td className="ref">{s.ref}</td>
                    <td className="row-title"><Link to={`/systems/${s.id}`}>{s.name}</Link></td>
                    <td>{s.system_group ?? '—'}</td>
                    <td>{s.hosting_type ? <LookupChip list="hosting_type" value={s.hosting_type} /> : '—'}</td>
                    <td>{s.mfa_status ? <LookupChip list="mfa_status" value={s.mfa_status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export function DataCategoryDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="data_category"
      status={(row) => (row.sensitivity_level ? <LookupChip list="sensitivity_level" value={row.sensitivity_level} /> : <span className="chip chip-gray">Not classified</span>)}
      summaryFields={['name', 'sensitivity_level', 'contains', 'where_held', 'custodian', 'shared_with', 'governing_rule', 'retention_period', 'gaps', 'notes']}
      tabs={[
        {
          key: 'systems', label: 'Systems',
          content: ({ row }) => (can('systems.view')
            ? <Holders categoryId={row.id} />
            : <EmptyState icon="lock" title="No access" message="You do not have permission to see systems." />),
        },
      ]}
    />
  );
}
