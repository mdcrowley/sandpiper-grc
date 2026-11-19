// Service catalogue: tiles that start a request, a list for managing the items, and the item
// page with its form designer.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge, Button, EditableSummary, EmptyState, ErrorState, Icon, Loading, lookupLabel, PageHeader, RecordPage, ResourceList, Tabs, TextField,
  useAuth, useFetch,
} from '../../core';
import type { IconName, ListResult, Row } from '../../core';
import { CatalogueDesigner } from './CatalogueDesigner';

const FIELDS = ['name', 'description', 'category', 'active', 'requires_approval'];
const ICONS: Record<string, IconName> = { people: 'users', access: 'key', equipment: 'box', software: 'file-text', vendors: 'building' };

function Tiles() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, error, reload } = useFetch<ListResult>('/api/catalog-items?f.active=true&sort=name&pageSize=200');
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase();
    const out = new Map<string, Row[]>();
    for (const item of data?.rows ?? []) {
      if (words && !`${item.name} ${item.description ?? ''}`.toLowerCase().includes(words)) continue;
      const key = item.category ? lookupLabel('catalog_category', item.category) : 'Other';
      out.set(key, [...(out.get(key) ?? []), item]);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, q]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the catalogue" />;
  if (!data.rows.length) {
    return <EmptyState title="The catalogue is empty" message="Add items under Manage items, or switch an existing item back to active." icon="folder" />;
  }
  return (
    <div className="stack">
      <TextField className="sd-catalogue-search" label="Find a request" hideLabel type="search" placeholder="Find a request" value={q} onChange={setQ}
        leftSection={<Icon name="search" size={16} />} />
      {groups.length === 0 && <EmptyState icon="search" title="Nothing in the catalogue matches" message="Try a different word, or log an ordinary ticket." />}
      {groups.map(([group, items]) => (
        <section key={group} aria-label={group}>
          <h2 className="sd-group-title">{group}</h2>
          <ul className="sd-tiles">
            {items.map((item) => {
              const questions = (item.questions ?? []).length;
              const tasks = (item.tasks ?? []).length;
              return (
                <li key={item.id} className="sd-tile">
                  <span className="sd-tile-icon" aria-hidden="true"><Icon name={ICONS[item.category] ?? 'folder'} size={20} /></span>
                  <div className="sd-tile-body">
                    <h3><Link to={`/catalogue/${item.id}`}>{item.name}</Link></h3>
                    <p className="muted">{item.description || 'No description.'}</p>
                    <div className="row sd-tile-meta">
                      {item.requires_approval && <Badge color="amber">Needs approval</Badge>}
                      {questions > 0 && <Badge color="gray">{questions} question{questions === 1 ? '' : 's'}</Badge>}
                      {tasks > 0 && <Badge color="gray">{tasks} task{tasks === 1 ? '' : 's'}</Badge>}
                    </div>
                  </div>
                  {can('tickets.create') && (
                    <Button variant="primary" size="sm" icon="plus" onClick={() => navigate(`/tickets?catalog=${item.id}`)}>
                      Create {item.defaults?.type === 'incident' ? 'incident' : 'request'}
                    </Button>
                  )}
                </li>
              );
            })}
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
        { field: 'requires_approval', label: 'Approval', sortable: true, render: (row) => (row.requires_approval ? <Badge color="amber">Needed</Badge> : '—') },
        { field: 'questions', label: 'Questions', render: (row) => (row.questions ?? []).length || '—' },
        { field: 'tasks', label: 'Tasks', render: (row) => (row.tasks ?? []).length || '—' },
        'updated_at']}
      filters={['category', 'active', 'requires_approval']}
      bulkFields={['category', 'active', 'requires_approval']}
      createFields={FIELDS}
    />
  );
  return (
    <>
      <PageHeader title="Service catalogue" subtitle="Standard requests. Choosing one starts a ticket with its details filled in, its questions asked and its tasks added." />
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
      breadcrumbs={undefined}
      status={(row) => (
        <span className="row">
          {row.active ? <Badge color="green">Active</Badge> : <Badge color="gray">Hidden</Badge>}
          {row.requires_approval && <Badge color="amber">Needs approval</Badge>}
        </span>
      )}
      actions={({ row }) => row.active && (
        <Button variant="primary" icon="plus" onClick={() => navigate(`/tickets?catalog=${row.id}`)}>Create a ticket from this</Button>
      )}
      summary={({ row, reload }) => (
        <EditableSummary type="catalog_item" row={row} fields={FIELDS} onSaved={reload}
          sections={[{ fields: ['name', 'description', 'category'] }, { title: 'Behaviour', fields: ['active', 'requires_approval'] }]} />
      )}
      tabs={[
        { key: 'form', label: 'Form and tasks', content: (rec) => <CatalogueDesigner rec={rec} /> },
        {
          key: 'tickets', label: 'Tickets created',
          content: ({ row }) => (
            <ResourceList type="ticket" baseFilter={{ catalog_item_id: row.id }} pageSize={10} urlState={false}
              columns={['ref', 'title', 'status', 'priority', 'requester_name', 'opened_at']} />
          ),
        },
      ]}
    />
  );
}
