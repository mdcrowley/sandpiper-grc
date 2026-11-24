// The registers an administrator defines (E41-06): the list of registers, one register's records, and
// one record. Each register is an ordinary record type (`reg_<key>` in /api/meta), so the generic list,
// form and record page do the work: custom fields, filters, saved views, exports, imports, history,
// comments, links, attachments, tags, lifecycles and the PDF fact sheet.
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError, Button, Card, customFieldNames, EmptyState, ErrorState, Icon, Loading, NotFound, PageHeader, RecordPage,
  ResourceList, SwitchedOff, useAuth, useFetch, useMeta, type ColumnDef, type IconName,
} from '../../core';
import { useRegisters } from './NavExtras';

const BUILT_IN = ['title', 'status', 'owner_id', 'department_id', 'site_id', 'description'];

export function RegisterHome() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useRegisters();
  const admin = can('admin.administer');
  return (
    <div className="stack">
      <PageHeader
        title="Registers"
        subtitle="Records your organization keeps that have no part of their own in the application, each defined by an administrator."
        actions={admin ? <Button icon="settings" onClick={() => navigate('/admin/registers')}>Define registers</Button> : undefined}
      />
      {error ? <Card><ErrorState error={error} onRetry={reload} /></Card>
        : !data ? <Card><Loading lines={3} label="Loading the registers" /></Card>
        : data.length === 0 ? (
          <Card>
            <EmptyState
              icon="folder" title="No registers to show"
              message={admin ? 'Define one under Administration > Registers.' : 'There are no registers you may open. An administrator defines registers and who may use them.'}
            />
          </Card>
        ) : (
          <ul className="reg-cards" aria-label="Registers">
            {data.map((r) => (
              <li key={r.key}>
                <Link to={r.route} className="reg-card">
                  <Icon name={r.icon as IconName} />
                  <span>
                    <strong>{r.plural}</strong>
                    {r.description && <span className="muted">{r.description}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

/**
 * The register's record type, or the page to show instead: a register just defined in another tab
 * reloads the metadata once; a switched-off one says so; an unknown one is not found.
 */
function useRegisterType(key: string): { type: string; page: 'ok' | 'loading' | 'off' | 'missing' } {
  const meta = useMeta();
  const type = `reg_${key}`;
  const known = Boolean(meta.resources[type]);
  const probe = useFetch<unknown>(known ? null : `/api/registers/${encodeURIComponent(key)}?pageSize=1`);
  const reloaded = useRef(false);
  const { reload } = meta;
  useEffect(() => {
    if (!known && probe.data && !reloaded.current) {
      reloaded.current = true;
      reload();
    }
  }, [known, probe.data, reload]);
  if (known) return { type, page: 'ok' };
  if (probe.error instanceof ApiError) return { type, page: probe.error.code === 'switched_off' ? 'off' : 'missing' };
  return { type, page: probe.data && reloaded.current ? 'missing' : 'loading' };
}

export function RegisterList() {
  const { key = '' } = useParams();
  const { type, page } = useRegisterType(key);
  const resource = useMeta().resources[type];
  const described = useRegisters().data?.find((r) => r.key === key)?.description;
  if (page === 'off') return <SwitchedOff />;
  if (page === 'missing') return <NotFound />;
  if (!resource) return <Loading lines={6} label="Loading the register" />;
  const custom = customFieldNames(resource);
  const columns: ColumnDef[] = [
    'ref', 'title', 'status',
    ...custom.slice(0, 4).map((field) => ({ field, priority: 2 as const })),
    { field: 'owner_id', priority: 3 }, { field: 'department_id', priority: 3 },
  ];
  return (
    <div className="stack">
      <ResourceList
        key={type}
        type={type}
        title={resource.plural}
        columns={columns}
        filters={['status', 'owner_id', 'department_id', 'site_id', ...custom.filter((f) => ['lookup', 'user', 'ref', 'boolean', 'date'].includes(resource.fields[f]?.type))]}
        createFields={BUILT_IN}
      />
      {described && <p className="muted">{described}</p>}
    </div>
  );
}

export function RegisterRecord() {
  const { key = '' } = useParams();
  const { type, page } = useRegisterType(key);
  if (page === 'off') return <SwitchedOff />;
  if (page === 'missing') return <NotFound />;
  if (page === 'loading') return <Loading lines={6} label="Loading the record" />;
  return <RecordPage key={type} type={type} summaryFields={BUILT_IN} />;
}
