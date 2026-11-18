// One finding: host and identifiers, severity and the fix-by countdown, and the status actions.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Countdown, EditableSummary, errorMessage, formatDate, Icon, Menu, RecordPage, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { AcceptRiskDialog, AssignDialog, FalsePositiveDialog, FixedDialog } from './Dialogs';
import { hostOf, SeverityChip, useAvailableFields } from './shared';

type DialogKey = 'assign' | 'fixed' | 'accept' | 'false_positive';

function Actions({ row, save, canEdit }: RecordContext) {
  const toast = useToast();
  const [dialog, setDialog] = useState<DialogKey | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canEdit) return null;
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
        <Button variant="primary" loading={busy} onClick={() => void setStatus('open', 'Finding reopened.')}>Reopen</Button>
      ) : (
        <>
          {row.status === 'open' && <Button loading={busy} onClick={() => void setStatus('in_remediation', 'Remediation started.')}>Start remediation</Button>}
          <Button variant="primary" icon="check" onClick={() => setDialog('fixed')}>Mark fixed</Button>
          <Menu label="Close without a fix" align="end" items={[
            { label: 'Accept the risk…', icon: 'scale', onSelect: () => setDialog('accept') },
            { label: 'False positive…', icon: 'x', onSelect: () => setDialog('false_positive') },
          ]} />
        </>
      )}
      {dialog === 'assign' && <AssignDialog row={row} save={save} onClose={close} />}
      {dialog === 'fixed' && <FixedDialog row={row} save={save} onClose={close} />}
      {dialog === 'accept' && <AcceptRiskDialog row={row} save={save} onClose={close} />}
      {dialog === 'false_positive' && <FalsePositiveDialog row={row} save={save} onClose={close} />}
    </>
  );
}

function Banner({ row }: { row: Row }) {
  const closedAt = row.closed ? (row.fixed_on ? `${row.fixed_on}T12:00:00` : row.updated_at) : undefined;
  return (
    <div className="stack">
      <div className="record-banner vuln-banner">
        <div className="vuln-fact">
          <span className="vuln-fact-label">Severity</span>
          <span className="row"><SeverityChip value={row.severity} />{row.cvss != null && <span className="muted">CVSS {row.cvss}</span>}</span>
        </div>
        <div className="vuln-fact">
          <span className="vuln-fact-label">Fix by</span>
          {row.due_on ? (
            <span className="row">
              <strong>{formatDate(row.due_on)}</strong>
              {row.status !== 'risk_accepted' && row.status !== 'false_positive' && (
                <Countdown deadline={`${row.due_on}T23:59:59`} start={`${row.first_seen}T00:00:00`} completedAt={closedAt} />
              )}
            </span>
          ) : <span className="muted">No fix-by date for this severity</span>}
        </div>
        <div className="vuln-fact">
          <span className="vuln-fact-label">{row.closed ? 'Open for' : 'Age'}</span>
          <span>{row.age_days} {row.age_days === 1 ? 'day' : 'days'}</span>
        </div>
        <div className="vuln-fact">
          <span className="vuln-fact-label">First seen</span>
          <span>{formatDate(row.first_seen)}</span>
        </div>
        <div className="vuln-fact">
          <span className="vuln-fact-label">Last seen</span>
          <span>{formatDate(row.last_seen)}</span>
        </div>
        <div className="vuln-fact">
          <span className="vuln-fact-label">Owner</span>
          <span>{row._display?.owner_id ?? <span className="muted">Unassigned</span>}</span>
        </div>
      </div>
      {row.known_exploited && !row.closed && (
        <div className="notice notice-warn">
          <Icon name="alert" size={16} />
          <span><strong>Known to be exploited.</strong> Attackers are using this weakness, so the fix-by date uses the shortest period in the severity policy.</span>
        </div>
      )}
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
          fields={['host_name', 'host_ip', 'port', 'service', 'plugin_id', 'cves', 'first_seen', 'last_seen']} />
        {row.import_batch_id && (
          <p className="muted vuln-import-note">
            Last reported by an <Link to={`/vulnerabilities/imports/${row.import_batch_id}`}>import</Link>. A later import of the same source updates this finding rather than adding another.
          </p>
        )}
      </div>
    </div>
  );
}

function Remediation({ row, reload }: RecordContext) {
  const closure = useAvailableFields(['fixed_on', 'exception_id', 'acceptance_justification', 'acceptance_approver_id', 'false_positive_reason']);
  return (
    <div className="stack">
      <EditableSummary type="vulnerability" row={row} title="Solution and progress" onSaved={reload} fields={['solution', 'remediation_notes']} />
      <EditableSummary type="vulnerability" row={row} title="Fix-by date" onSaved={reload} fields={['due_on', 'due_override_on', 'due_override_reason']} />
      <EditableSummary type="vulnerability" row={row} title="Closure" onSaved={reload} fields={closure} />
    </div>
  );
}

export function VulnerabilityDetail() {
  return (
    <RecordPage
      type="vulnerability"
      subtitle={(row) => (
        <span className="row">
          {[hostOf(row), row.host_name && row.host_ip, row.port, row.service].filter(Boolean).join(' · ')}
          {row.known_exploited && <Badge color="red">Known exploited</Badge>}
          {row.overdue && <Badge color="red">Overdue</Badge>}
        </span>
      )}
      actions={(rec) => <Actions {...rec} />}
      banner={({ row }) => <Banner row={row} />}
      summary={(rec) => <Summary {...rec} />}
      tabs={[{ key: 'remediation', label: 'Remediation', content: (rec) => <Remediation {...rec} /> }]}
    />
  );
}
