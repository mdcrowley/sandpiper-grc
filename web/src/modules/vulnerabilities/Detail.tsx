// One finding: host and identifiers, severity and the fix-by countdown, the status actions,
// and the Remediation and Actions tabs before the built-in Activity, Attachments, Related and History.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Countdown, EditableSummary, errorMessage, formatDate, Icon, KeyValue, Menu, RecordPage, useFetch, useLookup, useToast,
} from '../../core';
import { canMoveTo, editableLifecycle } from '../../core/lifecycleMenus';
import type { RecordContext, Row } from '../../core';
import { AcceptRiskDialog, AssignDialog, FalsePositiveDialog, FixedDialog } from './Dialogs';
import { ActionsTab, hostOf, portOf, SeverityChip, useActionsAvailable, useAvailableFields } from './shared';
import type { Policy } from './shared';

type DialogKey = 'assign' | 'fixed' | 'accept' | 'false_positive';

function Actions({ row, resource, save, canEdit }: RecordContext) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [busy, setBusy] = useState(false);
  // A status action the lifecycle rules do not allow from the current status is left out (E14-31);
  // Edit offers the statuses that are allowed.
  const rules = editableLifecycle(resource.lifecycle, 'status');
  const values = useLookup('vulnerability_status').map((v) => v.value);
  const may = (to: string) => canMoveTo(rules, row.status, to, values);
  if (!canEdit) return null;
  const closeWithout = [
    ...(may('risk_accepted') ? [{ label: 'Accept the risk…', icon: 'scale' as const, onSelect: () => setDialog('accept') }] : []),
    ...(may('false_positive') ? [{ label: 'False positive…', icon: 'x' as const, onSelect: () => setDialog('false_positive') }] : []),
  ];
  const setStatus = async (status: string, done: string) => {
    setBusy(true);
    try {
      await save({ status });
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const close = () => setDialog(null);
  return (
    <>
      <Button icon="user" onClick={() => setDialog('assign')}>{row.owner_id ? 'Reassign' : 'Assign'}</Button>
      {row.closed ? (
        may('open') && <Button variant="primary" loading={busy} onClick={() => void setStatus('open', 'Finding reopened.')}>Reopen</Button>
      ) : (
        <>
          {row.status === 'open' && may('in_remediation') && <Button loading={busy} onClick={() => void setStatus('in_remediation', 'Remediation started.')}>Start remediation</Button>}
          {may('fixed') && <Button variant="primary" icon="check" onClick={() => setDialog('fixed')}>Mark fixed</Button>}
          {closeWithout.length > 0 && <Menu label="Close without a fix" align="end" items={closeWithout} />}
        </>
      )}
      {dialog === 'assign' && <AssignDialog row={row} save={save} onClose={close} />}
      {dialog === 'fixed' && <FixedDialog row={row} save={save} onClose={close} />}
      {dialog === 'accept' && <AcceptRiskDialog row={row} save={save} onClose={close} />}
      {dialog === 'false_positive' && <FalsePositiveDialog row={row} save={save} onClose={close} />}
    </>
  );
}

/** Why the fix-by date is shorter than the severity alone would give: the criticality of the finding's system. */
function CriticalityNote({ row }: { row: Row }) {
  const { data } = useFetch<Policy>(row.due_criticality ? '/api/vulnerabilities/policy' : null);
  if (!row.due_criticality || row.closed) return null;
  const tier = data?.criticalityTiers.find((t) => t.value === row.due_criticality);
  const percent = data?.criticalityPercent[row.due_criticality];
  return (
    <div className="notice">
      <Icon name="server" size={16} />
      <span>
        <strong>Shorter fix-by date for a critical system.</strong>{' '}
        {row._display?.system_id ? <>{row._display.system_id} is </> : 'The system is '}
        graded {tier?.label ?? 'at a criticality'} in the inventory
        {percent ? `, so this finding gets ${percent}% of the usual period for its severity.` : ', which shortens the period in the severity policy.'}
      </span>
    </div>
  );
}

function Banner({ row }: { row: Row }) {
  const closedAt = row.closed ? (row.fixed_on ? `${row.fixed_on}T12:00:00` : row.updated_at) : undefined;
  const timed = row.status !== 'risk_accepted' && row.status !== 'false_positive';
  return (
    <div className="stack">
      <div className="record-banner vuln-banner">
        <KeyValue layout="columns" items={[
          {
            label: 'Severity',
            value: <span className="row"><SeverityChip value={row.severity} />{row.cvss != null && <span className="muted">CVSS {row.cvss}</span>}</span>,
          },
          {
            label: 'Fix by',
            value: row.due_on ? <strong>{formatDate(row.due_on)}</strong> : <span className="muted">No fix-by date for this severity</span>,
            hint: row.due_on && timed
              ? <Countdown deadline={`${row.due_on}T23:59:59`} start={`${row.first_seen}T00:00:00`} completedAt={closedAt} />
              : undefined,
          },
          { label: row.closed ? 'Open for' : 'Age', value: `${row.age_days} ${row.age_days === 1 ? 'day' : 'days'}`, hint: `First seen ${formatDate(row.first_seen)}` },
          { label: 'Last seen', value: formatDate(row.last_seen), hint: row.source ?? undefined },
          { label: 'Owner', icon: 'user', value: row._display?.owner_id ?? <span className="muted">Unassigned</span> },
        ]} />
      </div>
      {row.known_exploited && !row.closed && (
        <div className="notice notice-warn">
          <Icon name="alert" size={16} />
          <span><strong>Known to be exploited.</strong> Attackers are using this weakness, so the fix-by date uses the shortest period in the severity policy.</span>
        </div>
      )}
      <CriticalityNote row={row} />
      {row.due_override_on && (
        <div className="notice">
          <Icon name="info" size={16} />
          <span><strong>Fix-by date set by hand.</strong> {row.due_override_reason}</span>
        </div>
      )}
      {row.status === 'risk_accepted' && (
        <div className="notice">
          <Icon name="scale" size={16} />
          <span>
            <strong>Risk accepted.</strong>{' '}
            {row.exception_id ? <>Covered by exception {row._display?.exception_id ?? ''}. </> : null}
            {row.acceptance_justification}
            {row._display?.acceptance_approver_id ? ` Approved by ${row._display.acceptance_approver_id}.` : ''}
          </span>
        </div>
      )}
      {row.status === 'false_positive' && (
        <div className="notice">
          <Icon name="info" size={16} />
          <span><strong>False positive.</strong> {row.false_positive_reason}</span>
        </div>
      )}
    </div>
  );
}

function Summary({ row, reload }: RecordContext) {
  const finding = useAvailableFields(['title', 'description', 'severity', 'cvss', 'known_exploited', 'owner_id', 'system_id', 'asset_id', 'source']);
  return (
    <div className="grid-2 vuln-summary">
      <EditableSummary type="vulnerability" row={row} fields={finding} title="Finding" onSaved={reload} />
      <div className="stack">
        <EditableSummary type="vulnerability" row={row} title="Host and identifiers" onSaved={reload}
          fields={['host_name', 'host_ip', 'port', 'protocol', 'service', 'plugin_id', 'cves', 'first_seen', 'last_seen']} />
        <p className="muted vuln-note">
          {row.import_batch_id
            ? <>Last reported by an <Link to={`/vulnerabilities/imports/${row.import_batch_id}`}>import</Link>. </>
            : null}
          An import recognizes this finding by its host, port and finding ID, and updates it rather than adding another.
        </p>
      </div>
    </div>
  );
}

function Remediation({ row, reload }: RecordContext) {
  const closure = useAvailableFields(['fixed_on', 'exception_id', 'acceptance_justification', 'acceptance_approver_id', 'false_positive_reason']);
  return (
    <div className="stack">
      <EditableSummary type="vulnerability" row={row} title="Solution and progress" onSaved={reload} fields={['solution', 'remediation_notes']} />
      <div className="grid-2 vuln-summary">
        <EditableSummary type="vulnerability" row={row} title="Fix-by date" onSaved={reload} fields={['due_on', 'due_override_on', 'due_override_reason']} />
        <EditableSummary type="vulnerability" row={row} title="Closure" onSaved={reload} fields={closure} />
      </div>
    </div>
  );
}

export function VulnerabilityDetail() {
  const actions = useActionsAvailable();
  return (
    <RecordPage
      type="vulnerability"
      subtitle={(row) => (
        <span className="row">
          {[hostOf(row), row.host_name && row.host_ip, portOf(row), row.service].filter(Boolean).join(' · ')}
          {row.known_exploited && <Badge color="red">Known exploited</Badge>}
          {row.overdue && <Badge color="red">Overdue</Badge>}
        </span>
      )}
      actions={(rec) => <Actions {...rec} />}
      banner={({ row }) => <Banner row={row} />}
      summary={(rec) => <Summary {...rec} />}
      tabs={[
        { key: 'remediation', label: 'Remediation', content: (rec) => <Remediation {...rec} /> },
        ...(actions ? [{ key: 'actions', label: 'Actions', content: ({ row }: RecordContext) => <ActionsTab sourceId={row.id} /> }] : []),
      ]}
    />
  );
}
