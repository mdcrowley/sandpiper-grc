// Service catalogue: tiles that start a request, plus a list for managing the items.
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, EmptyState, ErrorState, Loading, lookupLabel, PageHeader, RecordPage, ResourceList, Tabs, useAuth, useFetch,
} from '../../core';
import type { ListResult, Row } from '../../core';

const FIELDS = ['name', 'description', 'category', 'active', 'defaults'];

function Tiles() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<ListResult>('/api/catalog-items?f.active=true&sort=name&pageSize=200');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the catalogue" />;
  if (!data.rows.length) {
    return <EmptyState title="The catalogue is empty" message="Add items under Manage items, or switch an existing item back to active." icon="folder" />;
  }
  const groups = new Map<string, Row[]>();
  for (const item of data.rows) {
    const key = item.category ? lookupLabel('catalog_category', item.category) : 'Other';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="stack">
      {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group, items]) => (
        <section key={group} aria-label={group}>
          <h2 className="sd-group-title">{group}</h2>
          <ul className="sd-tiles">
            {items.map((item) => (
              <li key={item.id} className="sd-tile">
                <h3>{item.name}</h3>
                <p className="muted">{item.description || 'No description.'}</p>
                <div className="row">
                  {can('tickets.create') && (
                    <Button variant="primary" size="sm" icon="plus" onClick={() => navigate(`/tickets?catalog=${item.id}`)}>
                      Create {item.defaults?.type === 'incident' ? 'incident' : 'request'}
                    </Button>
                  )}
                  <Link className="sd-link" to={`/catalogue/${item.id}`}>Details</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CatalogueList() {
  const { can } = useAuth();
  const manage = (
    <ResourceList
      type="catalog_item"
      columns={['name', 'category',
        { field: 'active', sortable: true, render: (row) => (row.active ? <Badge color="green">Active</Badge> : <Badge color="gray">Hidden</Badge>) },
        { field: 'description', render: (row) => <span className="truncate">{row.description ?? '—'}</span> },
        'updated_at']}
      filters={['category', 'active']}
      createFields={FIELDS}
    />
  );
  return (
    <>
      <PageHeader title="Service catalogue" subtitle="Standard requests. Choosing one opens a new ticket with the details already filled in." />
      {can('tickets.edit')
        ? <Tabs label="Catalogue views" tabs={[{ key: 'tiles', label: 'Catalogue', content: <Tiles /> }, { key: 'manage', label: 'Manage items', content: manage }]} />
        : <Tiles />}
    </>
  );
}

export function CatalogueDetail() {
  const navigate = useNavigate();
  return (
    <RecordPage
      type="catalog_item"
      status={(row) => (row.active ? <Badge color="green">Active</Badge> : <Badge color="gray">Hidden</Badge>)}
      actions={({ row }) => row.active && (
        <Button variant="primary" icon="plus" onClick={() => navigate(`/tickets?catalog=${row.id}`)}>Create a ticket from this</Button>
      )}
      summaryFields={FIELDS}
      tabs={[{
        key: 'tickets', label: 'Tickets created',
        content: ({ row }) => (
          <ResourceList type="ticket" baseFilter={{ catalog_item_id: row.id }} pageSize={10}
            columns={['ref', 'title', 'status', 'priority', 'requester_name', 'opened_at']} />
        ),
      }]}
    />
  );
}
