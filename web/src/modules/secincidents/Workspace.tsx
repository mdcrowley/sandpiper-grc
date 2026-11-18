import { useState } from 'react';
import {
  Button, ConfirmDialog, EditableSummary, errorMessage, Icon, LinksPanel, LookupChip, RecordPage, Stepper, useLookup, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { ChecklistTab } from './ChecklistTab';
import { ClocksStrip } from './Clocks';
import { EditableTable } from './EditableTable';
import { LogTab } from './LogTab';
import { RansomTab } from './RansomTab';

export function PilotNotice() {
  return (
    <div className="si-pilot" role="note">
      <Icon name="alert" />
      <span>Pilot mode: do not record live incident details here yet. Use exercise or invented data only.</span>
    </div>
  );
}

function Banner({ rec, version, onChanged }: { rec: RecordContext; version: string; onChanged: () => void }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const statuses = useLookup('security_incident_status');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (key: string | null) => statuses.find((s) => s.value === key)?.label ?? key ?? '';
  const declaring = target !== null && target !== 'reported' && !row.declared_at;

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

  return (
    <div className="si-banner">
      <PilotNotice />
      <Stepper
        label="Incident status"
        current={row.status}
        steps={statuses.map((s) => ({ key: s.value, label: s.label }))}
        onStepClick={canEdit ? (key) => { if (key !== row.status) setTarget(key); } : undefined}
      />
      <ClocksStrip incidentId={row.id} declared={!!row.declared_at} version={version} canEdit={canEdit} onChanged={onChanged} />
      <ConfirmDialog
        open={target !== null}
        title={declaring ? 'Declare this incident?' : `Change status to ${label(target)}?`}
        message={declaring
          ? 'Declaring creates the notification tasks that apply to this incident. Their deadlines are counted from the discovery time.'
          : 'The change is time-stamped and added to the incident log.'}
        confirmLabel={declaring ? 'Declare incident' : 'Change status'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}

/** Security incident workspace (spec section 11, screen 7). */
export function Workspace() {
  // Bumped when something outside the record itself changes (a notification recorded, say),
  // so the clocks and the log re-read.
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const versionOf = (rec: RecordContext) => `${rec.row.updated_at}:${tick}`;
  const refresh = (rec: RecordContext) => () => { rec.reload(); bump(); };

  return (
    <RecordPage
      type="security_incident"
      status={(row) => (
        <span className="row">
          <LookupChip list="security_incident_severity" value={row.severity} />
          <LookupChip list="security_incident_status" value={row.status} />
        </span>
      )}
      actions={(rec) => rec.canEdit && rec.row.status === 'reported' && (
        <Button variant="primary" icon="alert" onClick={() => rec.save({ status: 'declared' }).then(bump).catch(() => undefined)}>
          Declare incident
        </Button>
      )}
      banner={(rec) => <Banner rec={rec} version={versionOf(rec)} onChanged={refresh(rec)} />}
      summary={(rec) => (
        <EditableSummary type="security_incident" row={rec.row} onSaved={refresh(rec)}
          fields={['title', 'summary', 'severity', 'scenario', 'lead_id', 'discovered_at', 'declared_at', 'contained_at', 'closed_at']} />
      )}
      tabs={[
        { key: 'log', label: 'Log', content: (rec) => <LogTab incidentId={rec.row.id} canEdit={rec.canEdit} version={versionOf(rec)} /> },
        { key: 'checklists', label: 'Checklists', content: (rec) => <ChecklistTab incidentId={rec.row.id} scenario={rec.row.scenario ?? null} canEdit={rec.canEdit} /> },
        {
          key: 'roles', label: 'Roles',
          content: (rec) => (
            <EditableTable url={`/api/security-incidents/${rec.row.id}/roles`} noun="Role" canEdit={rec.canEdit}
              emptyIcon="users" emptyTitle="No roles assigned" emptyMessage="Assign an incident lead, technical lead, communications, scribe and executive sponsor."
              columns={[
                { field: 'role', label: 'Role', required: true },
                { field: 'person_name', label: 'Person' },
                { field: 'contact', label: 'Contact', hint: 'Phone number that works if email is down' },
              ]} />
          ),
        },
        {
          key: 'evidence', label: 'Evidence register',
          content: (rec) => (
            <EditableTable url={`/api/security-incidents/${rec.row.id}/evidence`} noun="Evidence item" canEdit={rec.canEdit}
              emptyIcon="clipboard" emptyTitle="No evidence registered"
              emptyMessage="List each item kept as evidence: what it is, where it is held, who collected it and when, and its hash or reference."
              columns={[
                { field: 'item', label: 'Item', required: true },
                { field: 'where_held', label: 'Where held' },
                { field: 'collected_by', label: 'Collected by' },
                { field: 'collected_at', label: 'Collected at', type: 'datetime' },
                { field: 'hash_ref', label: 'Hash or reference', hint: 'File hash, bag number or ticket reference' },
              ]} />
          ),
        },
        {
          key: 'affected', label: 'Affected',
          content: (rec) => (
            <div className="stack">
              <EditableSummary type="security_incident" row={rec.row} onSaved={refresh(rec)} title="What is involved"
                fields={['is_cyber_incident', 'health_data_involved', 'card_data_involved', 'personal_info_involved', 'affected_systems', 'affected_data']} />
              <p className="muted">
                The four yes/no answers decide which notifications are required. Changing one after the incident is declared adds or
                stands down the matching clocks; completed notifications are never removed.
              </p>
              <h2 className="si-section-title">Linked systems, data categories and other records</h2>
              <LinksPanel type="security_incident" id={rec.row.id} />
            </div>
          ),
        },
        { key: 'ransom', label: 'Ransom payment', content: (rec) => <RansomTab rec={{ ...rec, save: (p) => rec.save(p).then((r) => { bump(); return r; }) }} /> },
        {
          key: 'lessons', label: 'Lessons learned',
          content: (rec) => (
            <EditableSummary type="security_incident" row={rec.row} onSaved={refresh(rec)} title="Lessons learned"
              fields={['what_happened', 'went_well', 'to_improve']} />
          ),
        },
      ]}
      defaultTabs={['links', 'history']}
    />
  );
}
