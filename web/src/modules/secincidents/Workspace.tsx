import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, ConfirmDialog, ErrorState, errorMessage, Forbidden, formatDateTime, formatDuration, HistoryPanel, Loading, LookupChip,
  Menu, Modal, NotFound, PageHeader, ResourceForm, Stepper, Tabs, useAuth, useFetch, useRecord, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { AffectedTab } from './AffectedTab';
import { ChecklistTab } from './ChecklistTab';
import { ClocksRail } from './Clocks';
import { EditableTable } from './EditableTable';
import { LogTab } from './LogTab';
import { RansomTab } from './RansomTab';
import { ReviewTab } from './ReviewTab';
import { RolesTab, TeamCard } from './Roles';
import { PilotNotice, useLifecycle, useNow } from './shared';
import type { ChecklistItem, Lifecycle } from './types';

// Files come from the attachments module. It is found at build time and loaded on first use,
// so this page still builds, and simply has no Attachments tab, when that module is absent.
const attachmentLoaders = import.meta.glob<{ AttachmentsPanel: ComponentType<{ recordType: string; recordId: string; evidence?: boolean }> }>(
  '../attachments/AttachmentsPanel.tsx',
);
const loadAttachments = Object.values(attachmentLoaders)[0];
const AttachmentsPanel = loadAttachments ? lazy(() => loadAttachments().then((m) => ({ default: m.AttachmentsPanel }))) : null;

const DETAIL_FIELDS = ['title', 'summary', 'severity', 'scenario', 'lead_id', 'discovered_at', 'declared_at', 'contained_at', 'closed_at'];

/** Status stepper, the key times and the summary: the strip across the top of the workspace. */
function CommandBar({ rec, lifecycle, onChanged }: { rec: RecordContext; lifecycle: Lifecycle | undefined; onChanged: () => void }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  const statuses = lifecycle?.statuses ?? [];
  const label = (key: string | null) => statuses.find((s) => s.value === key)?.label ?? key ?? '';
  const stageOf = (key: string | null) => statuses.find((s) => s.value === key)?.stage ?? 'reported';
  const declaring = target !== null && stageOf(target) !== 'reported' && !row.declared_at;
  const closing = target !== null && stageOf(target) === 'closed';

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      await save({ status: target });
      toast.success(declaring ? 'Incident declared. The notification clocks are running.' : `Status changed to ${label(target)}.`);
      setTarget(null);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const end = row.closed_at ? new Date(row.closed_at).getTime() : now;
  const running = formatDuration(Math.max(0, end - new Date(row.discovered_at).getTime()));
  const facts: [string, string | null, string?, string?][] = [
    ['Discovered', formatDateTime(row.discovered_at), row.closed_at ? `open for ${running}` : `${running} ago`],
    ['Declared', row.declared_at ? formatDateTime(row.declared_at) : null],
    ['Contained', row.contained_at ? formatDateTime(row.contained_at) : null],
    ['Closed', row.closed_at ? formatDateTime(row.closed_at) : null],
    ['Incident lead', row._display?.lead_id ?? null, undefined, 'Not assigned'],
    ['Scenario', row._display?.scenario ?? null, undefined, 'Not chosen'],
  ];

  return (
    <section className="si-command" aria-label="Incident status">
      <Stepper
        label="Incident status"
        current={row.status}
        steps={statuses.map((s) => ({ key: s.value, label: s.label }))}
        onStepClick={canEdit ? (key) => { if (key !== row.status) setTarget(key); } : undefined}
      />
      <dl className="si-facts">
        {facts.map(([name, value, note, empty]) => (
          <div key={name} className={value ? undefined : 'is-empty'}>
            <dt>{name}</dt>
            <dd>{value ?? empty ?? 'Not yet'}{note && <span className="si-fact-note">{note}</span>}</dd>
          </div>
        ))}
      </dl>
      {row.summary && <p className="si-summary">{row.summary}</p>}
      <ConfirmDialog
        open={target !== null}
        title={declaring ? 'Declare this incident?' : `Change status to ${label(target)}?`}
        message={declaring
          ? 'Declaring starts a clock for every notification that applies to this incident. Their deadlines are counted from the discovery time, and everyone who can see security incidents is told.'
          : closing
            ? 'The change is time-stamped and added to the incident log. Closing also sets the date the post-incident review is due.'
            : 'The change is time-stamped and added to the incident log.'}
        confirmLabel={declaring ? 'Declare incident' : 'Change status'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      />
    </section>
  );
}

/** Security incident workspace: status and clocks always in view, the log in the middle. */
export function Workspace() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const resource = useResource('security_incident');
  const { row, error, reload, save } = useRecord('security_incident', id);
  const lifecycle = useLifecycle().data;
  const [search, setSearch] = useSearchParams();
  const [editing, setEditing] = useState(false);
  // Bumped when something outside the record itself changes (a notification recorded, say),
  // so the clocks, the log and the team re-read.
  const [tick, setTick] = useState(0);
  const canEdit = can('security.edit');
  const ready = Boolean(resource && row);
  const checklist = useFetch<ChecklistItem[]>(ready ? `/api/security-incidents/${id}/checklist` : null);
  const files = useFetch<{ rows: unknown[] }>(ready && AttachmentsPanel ? `/api/attachments?record_type=security_incident&record_id=${id}` : null);
  const reloadChecklist = checklist.reload;
  const reloadFiles = files.reload;
  const tab = search.get('tab');
  useEffect(() => { reloadChecklist(); }, [tick, reloadChecklist]);
  useEffect(() => { if (tab !== null) reloadFiles(); }, [tab, reloadFiles]);

  if (error) {
    if (error instanceof ApiError && error.status === 404) return <NotFound />;
    if (error instanceof ApiError && error.status === 403) return <Forbidden />;
    return <ErrorState title="This incident could not be loaded" error={error} onRetry={reload} />;
  }
  if (!resource || !row) return <Loading lines={8} label="Loading incident" />;

  const bump = () => setTick((n) => n + 1);
  const refresh = () => { reload(); bump(); };
  const rec: RecordContext = { row, resource, reload, save: (patch) => save(patch).then((r) => { bump(); return r; }), canEdit };
  const version = `${row.updated_at}:${tick}`;
  const stage = lifecycle?.statuses.find((s) => s.value === row.status)?.stage;
  const declareAs = lifecycle?.statuses.find((s) => s.stage === 'declared')?.value;
  const goTo = (key: string) => setSearch((old) => { const next = new URLSearchParams(old); next.set('tab', key); return next; }, { replace: true });

  async function declare() {
    if (!declareAs) return;
    try {
      await rec.save({ status: declareAs });
      toast.success('Incident declared. The notification clocks are running.');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const stepsLeft = checklist.data ? checklist.data.filter((i) => !i.done).length : undefined;
  const filesMissing = files.error instanceof ApiError && files.error.status === 404;
  const tabs = [
    { key: 'log', label: 'Log', content: <LogTab incidentId={row.id} canEdit={canEdit} version={version} /> },
    {
      key: 'checklists', label: 'Checklists', count: stepsLeft || undefined,
      content: <ChecklistTab incidentId={row.id} scenario={row.scenario ?? null} canEdit={canEdit} onChanged={bump} />,
    },
    { key: 'roles', label: 'Roles', content: <RolesTab incidentId={row.id} canEdit={canEdit} onChanged={bump} /> },
    {
      key: 'evidence', label: 'Evidence',
      content: (
        <EditableTable url={`/api/security-incidents/${row.id}/evidence`} noun="Evidence item" canEdit={canEdit}
          intro={AttachmentsPanel && !filesMissing
            ? 'List each item kept as evidence, so that it can be found and relied on later. Put the files themselves on the Attachments tab.'
            : 'List each item kept as evidence, so that it can be found and relied on later.'}
          emptyIcon="clipboard" emptyTitle="No evidence registered"
          emptyMessage="For each item: what it is, where it is held, who collected it and when, and its hash or reference."
          columns={[
            { field: 'item', label: 'Item', required: true },
            { field: 'where_held', label: 'Where held' },
            { field: 'collected_by', label: 'Collected by' },
            { field: 'collected_at', label: 'Collected at', type: 'datetime' },
            { field: 'hash_ref', label: 'Hash or reference', hint: 'File hash, bag number or ticket reference' },
          ]} />
      ),
    },
    { key: 'affected', label: 'Affected', content: <AffectedTab rec={rec} onSaved={refresh} /> },
    { key: 'ransom', label: 'Ransom', content: <RansomTab rec={rec} /> },
    { key: 'lessons', label: 'Lessons', content: <ReviewTab rec={rec} lifecycle={lifecycle} onSaved={refresh} /> },
    ...(AttachmentsPanel && !filesMissing ? [{
      key: 'attachments', label: 'Attachments', count: files.data?.rows?.length || undefined,
      content: (
        <Suspense fallback={<Loading label="Loading files" lines={3} />}>
          <div className="stack">
            <p className="muted">Files added here are recorded as evidence, with the date they were collected. Describe each item in the evidence register too.</p>
            <AttachmentsPanel recordType="security_incident" recordId={row.id} evidence />
          </div>
        </Suspense>
      ),
    }] : []),
    { key: 'history', label: 'History', content: <HistoryPanel type="security_incident" id={row.id} row={row} /> },
  ];
  const active = tabs.some((t) => t.key === tab) ? (tab as string) : 'log';

  return (
    <div className="si-ws">
      <PageHeader
        title={row.title}
        reference={row.ref}
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: row.ref ?? 'Incident' }]}
        status={(
          <span className="row">
            <LookupChip list="security_incident_severity" value={row.severity} />
            <LookupChip list="security_incident_status" value={row.status} />
          </span>
        )}
        actions={(
          <>
            {canEdit && stage === 'reported' && <Button variant="primary" icon="alert" onClick={declare}>Declare incident</Button>}
            {canEdit && <Button icon="edit" onClick={() => setEditing(true)}>Edit details</Button>}
            <Link className="btn btn-secondary" to={`/security-incidents/${row.id}/report`}>Incident report</Link>
            <Menu label="More" icon="more" iconOnly align="end" items={[
              { label: 'All notifications', icon: 'clock', to: '/security-incidents/notifications' },
              { label: 'Offline incident kit', icon: 'clipboard', to: '/security-incidents/kit' },
              { label: 'Notification rules and checklists', icon: 'settings', to: '/security-incidents/rules' },
            ]} />
          </>
        )}
      />
      <PilotNotice />
      <CommandBar rec={rec} lifecycle={lifecycle} onChanged={refresh} />
      <div className="si-ws-grid">
        <aside className="si-rail" aria-label="Clocks and team">
          <ClocksRail incidentId={row.id} declared={!!row.declared_at} version={version} canEdit={canEdit} onChanged={refresh} />
          <TeamCard incidentId={row.id} version={version} onManage={() => goTo('roles')} />
        </aside>
        <div className="si-main">
          <Tabs label="Incident workspace" tabs={tabs} active={active} onChange={goTo} />
        </div>
      </div>

      <Modal open={editing} title="Edit incident details" onClose={() => setEditing(false)} size="lg">
        <ResourceForm type="security_incident" id={row.id} initial={row} fields={DETAIL_FIELDS}
          hints={{
            discovered_at: 'When the organization first became aware. Changing it moves every pending notification deadline',
            scenario: 'Brings the matching containment and recovery checklists',
          }}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); toast.success('Details saved.'); refresh(); }} />
      </Modal>
    </div>
  );
}
