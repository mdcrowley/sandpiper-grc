// Sites: list and record, with the systems that serve the site and the assets held there.
import { Link } from 'react-router-dom';
import { Card, EditableSummary, EmptyState, ErrorState, Loading, LookupChip, RecordPage, ResourceList, useAuth, useFetch } from '../../core';

export function SiteList() {
  return (
    <ResourceList
      type="site"
      title="Sites"
      columns={['name', 'address', 'function', 'third_parties', { field: 'network_links', hidden: true }, { field: 'power_protection', hidden: true }, { field: 'physical_security', hidden: true }, { field: 'updated_at', hidden: true }]}
      filters={[]}
      createFields={['name', 'address', 'function', 'power_protection', 'physical_security', 'third_parties', 'network_links']}
    />
  );
}

interface SystemRow { id: string; ref: string | null; name: string; system_group: string | null; vendor_name: string | null; criticality_tier: string | null }

function SiteSystems({ siteId }: { siteId: string }) {
  const { data, error, reload } = useFetch<SystemRow[]>(`/api/sites/${siteId}/systems`);
  return (
    <Card title="Systems serving this site" flush={!!data?.length}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} />
        : data.length === 0 ? (
          <EmptyState icon="server" title="No systems linked" message="Link a site from a system's Overview tab (Sites served) and it will appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Reference</th><th scope="col">System</th><th scope="col">Group</th><th scope="col">Vendor</th><th scope="col">Criticality</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id}>
                    <td className="ref">{s.ref}</td>
                    <td className="row-title"><Link to={`/systems/${s.id}`}>{s.name}</Link></td>
                    <td>{s.system_group ?? '—'}</td>
                    <td>{s.vendor_name ?? '—'}</td>
                    <td>{s.criticality_tier ? <LookupChip list="criticality_tier" value={s.criticality_tier} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export function SiteDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="site"
      subtitle={(row) => row.address || undefined}
      summary={({ row, reload }) => (
        <EditableSummary
          type="site" row={row} onSaved={reload}
          fields={['name', 'address', 'function', 'technology', 'power_protection', 'physical_security', 'protection_notes', 'third_parties', 'network_links', 'to_confirm', 'notes']}
          sections={[
            { title: 'The site', fields: ['name', 'address', 'function', 'technology'] },
            { title: 'Protection', description: 'What keeps the site running and secure.', fields: ['power_protection', 'physical_security', 'protection_notes'] },
            { title: 'Connections and other parties', fields: ['network_links', 'third_parties'] },
            { title: 'Notes', fields: ['to_confirm', 'notes'] },
          ]}
        />
      )}
      tabs={[
        {
          key: 'systems', label: 'Systems',
          content: ({ row }) => (can('systems.view')
            ? <SiteSystems siteId={row.id} />
            : <EmptyState icon="lock" title="No access" message="You do not have permission to see systems." />),
        },
        {
          key: 'assets', label: 'Assets',
          content: ({ row }) => (can('assets.view') ? (
            <ResourceList
              type="asset"
              baseFilter={{ site_id: row.id }}
              columns={['tag', 'name', 'asset_type', 'status', 'location', 'support_end']}
              filters={['status', 'asset_type']}
              createFields={['name', 'asset_type', 'status', 'make', 'model', 'serial', 'location']}
              createInitial={{ site_id: row.id }}
            />
          ) : <EmptyState icon="lock" title="No access" message="You do not have permission to see assets." />),
        },
      ]}
    />
  );
}
