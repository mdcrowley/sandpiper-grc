// The roster: people and positions. Training, certifications and acknowledgments come from the
// training and policies modules, loaded only when they are part of the build.
import { lazy, Suspense, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Button, Card, EditableSummary, errorMessage, Loading, LookupChip, PageHeader, RecordPage, ResourceList, Select, Stat, useAuth, useFetch, useToast,
  type RecordContext,
} from '../../core';

type Dept = { id: string; name: string };

function useDepartments() {
  const { data } = useFetch<Dept[]>('/api/people/departments');
  const name = (id: unknown) => (id ? data?.find((d) => d.id === id)?.name ?? (data ? 'Department removed' : '…') : '');
  return { list: data ?? [], loaded: !!data, name };
}

// Optional panels from other modules (import.meta.glob: a file not in the build is simply not shown).
const trainingLoaders = import.meta.glob<{
  PersonTraining: ComponentType<{ personId: string }>; PersonQualifiedBadge: ComponentType<{ personId: string }>;
}>('../training/PersonTraining.tsx');
const loadTraining = Object.values(trainingLoaders)[0];
const LazyPersonTraining = loadTraining ? lazy(() => loadTraining().then((m) => ({ default: m.PersonTraining }))) : null;
const LazyQualifiedBadge = loadTraining ? lazy(() => loadTraining().then((m) => ({ default: m.PersonQualifiedBadge }))) : null;
const reqLoaders = import.meta.glob<{ RequirementsPanel: ComponentType<{ positionId: string }> }>('../training/RequirementsPanel.tsx');
const loadReqs = Object.values(reqLoaders)[0];
const LazyRequirements = loadReqs ? lazy(() => loadReqs().then((m) => ({ default: m.RequirementsPanel }))) : null;
const ackLoaders = import.meta.glob<{ PersonAcks: ComponentType<{ personId: string }> }>('../policies/PersonAcks.tsx');
const loadAcks = Object.values(ackLoaders)[0];
const LazyPersonAcks = loadAcks ? lazy(() => loadAcks().then((m) => ({ default: m.PersonAcks }))) : null;

interface Summary { byStatus: { status: string; n: number }[]; byPosition: { position_id: string | null; name: string | null; n: number }[]; withAccount: number }

export function PeopleList() {
  const depts = useDepartments();
  const summary = useFetch<Summary>('/api/people/summary');
  const n = (s: string) => summary.data?.byStatus.find((x) => x.status === s)?.n ?? 0;
  return (
    <div className="stack">
      {/* Title and New first, then the figures, as on every other page (E18-64); the list puts New in this header. */}
      <PageHeader title="People" />
      {summary.data && (
        <div className="grid-stats">
          <Stat label="Active" icon="users" color="green" value={n('active')} to="/people?f.status=active" />
          <Stat label="On leave" icon="clock" value={n('on_leave')} to="/people?f.status=on_leave" />
          <Stat label="With an account" icon="key" value={summary.data.withAccount} hint="Can sign in and acknowledge for themselves" />
          <Stat label="Positions" icon="clipboard" value={summary.data.byPosition.filter((p) => p.position_id).length} to="/people/positions" />
        </div>
      )}
      <ResourceList
        type="person"
        columns={[
          'ref', 'full_name', 'employee_number', 'position_id',
          { field: 'department_id', label: 'Department', render: (row) => depts.name(row.department_id) || <span className="muted">None</span> },
          'status',
          { field: 'user_id', hidden: true }, { field: 'supervisor_person_id', hidden: true }, { field: 'work_site_id', hidden: true },
          { field: 'hire_date', hidden: true }, { field: 'source', hidden: true },
        ]}
        filters={['status', 'position_id', 'work_site_id', 'supervisor_person_id', 'source', 'hire_date']}
        bulkFields={['status', 'position_id', 'supervisor_person_id', 'work_site_id']}
        createFields={['full_name', 'preferred_name', 'employee_number', 'email', 'phone', 'position_id', 'work_site_id', 'supervisor_person_id', 'user_id', 'hire_date', 'status', 'notes']}
      />
      <p className="muted">
        Import a roster from your HR system with Import (CSV or Excel): match on the employee number to update people already here. A
        Department column may give the department's name.
      </p>
    </div>
  );
}

/** The department of a person or position, chosen from the organization's list. */
function DepartmentCard({ rec }: { rec: RecordContext }) {
  const depts = useDepartments();
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = String(rec.row.department_id ?? '');
  const chosen = value ?? current;
  const save = async () => {
    setBusy(true);
    try { await rec.save({ department_id: chosen || null }); toast.success('Department saved.'); setValue(null); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  if (!rec.canEdit) return <Card title="Department"><p>{depts.name(current) || <span className="muted">None</span>}</p></Card>;
  return (
    <Card title="Department">
      <div className="ppl-dept">
        <Select label="Department" value={chosen} onChange={(v) => setValue(v ?? '')}
          options={[{ value: '', label: 'None' }, ...depts.list.map((d) => ({ value: d.id, label: d.name }))]}
          hint={!depts.loaded || depts.list.length ? undefined : 'No departments are set up. An administrator adds them under Administration > Departments.'} />
        <Button onClick={() => void save()} loading={busy} disabled={chosen === current}>Save</Button>
      </div>
    </Card>
  );
}

const PERSON_FIELDS = ['full_name', 'preferred_name', 'employee_number', 'email', 'phone', 'position_id', 'work_site_id', 'supervisor_person_id', 'user_id', 'hire_date', 'status', 'source', 'notes'];

export function PersonDetail() {
  // A switched-off area takes away the permission too, so its tabs go with it.
  const { can } = useAuth();
  return (
    <RecordPage
      type="person"
      status={(row) => (
        <span className="row">
          {LazyQualifiedBadge && can('training.view') && <Suspense fallback={null}><LazyQualifiedBadge personId={row.id} /></Suspense>}
          <LookupChip list="person_status" value={row.status} />
        </span>
      )}
      subtitle={(row) => [row.employee_number && `Employee ${row.employee_number}`, row._display?.position_id].filter(Boolean).join(' · ')}
      summary={(rec) => (
        <div className="ppl-layout">
          <EditableSummary type="person" row={rec.row} onSaved={rec.reload} fields={PERSON_FIELDS} />
          <DepartmentCard rec={rec} />
        </div>
      )}
      tabs={[
        ...(LazyPersonTraining && can('training.view') ? [{ key: 'training', label: 'Training and certifications', content: ({ row }: RecordContext) => <Suspense fallback={<Loading />}><LazyPersonTraining personId={row.id} /></Suspense> }] : []),
        ...(LazyPersonAcks && can('policies.view') ? [{ key: 'acknowledgments', label: 'Acknowledgments', content: ({ row }: RecordContext) => <Suspense fallback={<Loading />}><LazyPersonAcks personId={row.id} /></Suspense> }] : []),
      ]}
    />
  );
}

/** Position fields; "Safety-sensitive" belongs to the safety area and goes while it is switched off. */
function usePositionFields() {
  const { areaOn } = useAuth();
  return (fields: string[]) => (areaOn('safety') ? fields : fields.filter((f) => f !== 'safety_sensitive'));
}

export function PositionList() {
  const depts = useDepartments();
  const pick = usePositionFields();
  return (
    <ResourceList
      type="position"
      title="Positions"
      columns={['ref', 'name', 'code', { field: 'department_id', label: 'Department', render: (row) => depts.name(row.department_id) || <span className="muted">None</span> }, ...pick(['safety_sensitive', 'active'])]}
      filters={pick(['safety_sensitive', 'active'])}
      createFields={pick(['name', 'code', 'description', 'safety_sensitive', 'active'])}
    />
  );
}

export function PositionDetail() {
  const { can } = useAuth();
  const pick = usePositionFields();
  return (
    <RecordPage
      type="position"
      summary={(rec) => (
        <div className="ppl-layout">
          <EditableSummary type="position" row={rec.row} onSaved={rec.reload} fields={pick(['name', 'code', 'description', 'safety_sensitive', 'active'])} />
          <DepartmentCard rec={rec} />
        </div>
      )}
      tabs={[
        ...(LazyRequirements && can('training.view') ? [{ key: 'requirements', label: 'Requirements', content: ({ row }: RecordContext) => <Suspense fallback={<Loading />}><LazyRequirements positionId={row.id} /></Suspense> }] : []),
        {
          key: 'people', label: 'People',
          content: ({ row }: RecordContext) => (
            <ResourceList type="person" baseFilter={{ position_id: row.id }} columns={['ref', 'full_name', 'employee_number', 'status']}
              createFields={['full_name', 'employee_number', 'email', 'status']} createInitial={{ position_id: row.id }} onCreated={() => undefined} />
          ),
        },
      ]}
    />
  );
}
