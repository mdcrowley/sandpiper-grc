// The dry-run preview and the final result of an import: the same numbers, before and after,
// with the rows sorted into what is new, what changes, what is left alone and what is wrong.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Checkbox, EmptyState, Icon, Stat, StatusChip, TableWrap, Tabs } from '../../core';
import type { ColorName } from '../../core';
import { SeverityChip } from './shared';

type Action = 'create' | 'update' | 'unchanged' | 'reopen' | 'duplicate' | 'error';
export interface ImportRow {
  line: number; action: Action; id: string | null; ref: string | null; host: string | null; port: string | null; title: string | null;
  severity: string | null; finding: string | null; errors: Record<string, string>; changes: string[]; duplicateOf: number | null;
}
export interface ImportResult {
  dryRun: boolean; source: string; closeMissing: boolean; total: number; created: number; updated: number; unchanged: number;
  reopened: number; duplicates: number; errors: number; missing: number; closed: number; unmatchedHosts: string[]; assigned: number;
  batchId: string | null; rows: ImportRow[]; rowsShown: number;
  missingFindings: { id: string; ref: string; title: string; host: string | null; severity: string }[];
}

const ACTION: Record<Action, { label: string; color: ColorName }> = {
  create: { label: 'New', color: 'green' },
  update: { label: 'Update', color: 'blue' },
  unchanged: { label: 'No change', color: 'gray' },
  reopen: { label: 'Reopen', color: 'amber' },
  duplicate: { label: 'Repeated in file', color: 'amber' },
  error: { label: 'Error', color: 'red' },
};

interface Props {
  result: ImportResult; done: boolean; busy: boolean; closeMissing: boolean;
  onCloseMissing: (v: boolean) => void; onBack: () => void; onImport: () => void; onRestart: () => void;
}

function Rows({ rows, total, empty }: { rows: ImportRow[]; total: number; empty: string }) {
  if (rows.length === 0) return <EmptyState icon="check-circle" title={total > 0 ? 'Not in the rows shown' : empty} message={total > 0 ? 'A long file shows its first rows only, problems first.' : undefined} />;
  return (
    <>
      <TableWrap label="Rows of the file with what the import does with each" className="vuln-tw vuln-wrap">
        <table className="table">
          <caption className="sr-only">Rows of the file with what the import does with each</caption>
          <thead>
            <tr><th scope="col" className="num">Line</th><th scope="col">Result</th><th scope="col">Host</th><th scope="col">Finding</th><th scope="col">Severity</th><th scope="col">Details</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className={r.action === 'error' ? 'vuln-row-error' : undefined}>
                <td className="num">{r.line}</td>
                <td><StatusChip color={ACTION[r.action].color} label={ACTION[r.action].label} /></td>
                <td className="vuln-host-cell">
                  {r.host ?? '—'}
                  {r.port && <div className="muted vuln-sub">Port {r.port}</div>}
                </td>
                <td>
                  {r.id ? <Link to={`/vulnerabilities/${r.id}`}>{r.title ?? r.ref}</Link> : r.title ?? '—'}
                  {r.finding && <div className="muted vuln-sub">{r.ref ? `${r.ref} · ` : ''}{r.finding}</div>}
                </td>
                <td><SeverityChip value={r.severity} /></td>
                <td>
                  {Object.values(r.errors).map((m) => <div key={m} className="vuln-cell-error">{m}</div>)}
                  {r.duplicateOf && <div>Same host, port and finding as line {r.duplicateOf}; only the first is used.</div>}
                  {r.changes.length > 0 && <div>{r.changes.join(', ')}</div>}
                  {Object.keys(r.errors).length === 0 && !r.duplicateOf && r.changes.length === 0 && <span className="muted">{r.action === 'create' ? 'Added as a new finding' : 'Seen again, nothing to change'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {total > rows.length && <p className="vuln-pad muted vuln-note">Showing {rows.length} of {total}.</p>}
    </>
  );
}

export function ImportResultView({ result, done, busy, closeMissing, onCloseMissing, onBack, onImport, onRestart }: Props) {
  const of = (...actions: Action[]) => result.rows.filter((r) => actions.includes(r.action));
  const problems = result.errors + result.duplicates;
  const changed = result.updated + result.reopened;
  const willWrite = result.created + changed + result.closed;
  const will = (after: string, before: string) => (done ? after : before);
  const first = problems ? 'problems' : result.created ? 'new' : changed ? 'updated' : result.missing ? 'missing' : 'unchanged';
  const [tab, setTab] = useState(first);

  const missingPanel = (
    <div className="stack vuln-pad">
      {result.missing === 0 ? (
        <p className="muted">Every open finding from earlier imports of <strong>{result.source}</strong> is in this file.</p>
      ) : (
        <>
          <p>
            {result.missing} open {result.missing === 1 ? 'finding' : 'findings'} from earlier imports of <strong>{result.source}</strong>{' '}
            {result.missing === 1 ? 'is' : 'are'} not in this file.{' '}
            {done
              ? (result.closeMissing ? `${result.closed} ${result.closed === 1 ? 'was' : 'were'} marked fixed, dated today.` : 'They were left as they are.')
              : (result.closeMissing ? 'They will be marked fixed, dated today.' : 'They will be left as they are.')}
          </p>
          <ul className="vuln-missing">
            {result.missingFindings.map((f) => (
              <li key={f.id}>
                <Link className="ref" to={`/vulnerabilities/${f.id}`}>{f.ref}</Link> <SeverityChip value={f.severity} /> {f.title} <span className="muted">on {f.host ?? 'no host'}</span>
              </li>
            ))}
          </ul>
          {result.missing > result.missingFindings.length && <p className="muted">And {result.missing - result.missingFindings.length} more.</p>}
        </>
      )}
      {!done && (
        <Checkbox label="Close missing findings" checked={closeMissing} disabled={busy} onChange={onCloseMissing}
          hint="Only check this when the file is a complete scan of the same scope as before. The dry run then runs again." />
      )}
    </div>
  );

  const tabs = [
    { key: 'problems', label: 'Problems', count: problems, content: (
      <>
        {!done && result.errors > 0 && <p className="vuln-pad muted vuln-note">Rows with errors are never imported. Fix them in the file and start again, or import the rest now.</p>}
        <Rows rows={of('error', 'duplicate')} total={problems} empty="No problems found: every row can be imported" />
      </>
    ) },
    { key: 'new', label: will('New', 'New'), count: result.created, content: <Rows rows={of('create')} total={result.created} empty="Nothing new: every finding in this file is already recorded" /> },
    { key: 'updated', label: 'Updated', count: changed, content: <Rows rows={of('reopen', 'update')} total={changed} empty="No recorded finding changes" /> },
    { key: 'unchanged', label: 'No change', count: result.unchanged, content: <Rows rows={of('unchanged')} total={result.unchanged} empty="No finding was seen again without a change" /> },
    { key: 'missing', label: will(result.closeMissing ? 'Closed' : 'Missing from file', result.closeMissing ? 'To close' : 'Missing from file'), count: result.missing, content: missingPanel },
    ...(result.unmatchedHosts.length > 0 ? [{
      key: 'hosts', label: 'Unmatched hosts', count: result.unmatchedHosts.length, content: (
        <div className="stack vuln-pad">
          <p className="muted">These hosts match no asset by name, tag, serial number or IP address. Their findings are imported without an asset; link them afterwards or add the assets.</p>
          <ul className="vuln-hosts">{result.unmatchedHosts.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      ),
    }] : []),
  ];

  return (
    <>
      {done ? (
        <div className="notice notice-success" role="status">
          <Icon name="check-circle" size={16} />
          <span>
            <strong>The import from {result.source} is finished and recorded.</strong>{' '}
            {result.assigned > 0 && <>{result.assigned} new {result.assigned === 1 ? 'finding was' : 'findings were'} assigned to the chosen owner. </>}
            {result.batchId && <Link to={`/vulnerabilities/imports/${result.batchId}`}>Open this import</Link>}
          </span>
        </div>
      ) : (
        <div className="notice" role="status">
          <Icon name="info" size={16} />
          <span><strong>This is a dry run: nothing has been written yet.</strong> Check the numbers and the rows, then import at the bottom of the page.</span>
        </div>
      )}
      <div className="grid-stats">
        <Stat label={will('New findings', 'Will be added')} value={result.created} color={result.created ? 'green' : undefined} icon="plus" hint="Not seen before" />
        <Stat label={will('Updated', 'Will be updated')} value={result.updated} color={result.updated ? 'blue' : undefined} icon="refresh" hint={`${result.unchanged} seen again with no change`} />
        <Stat label={will('Reopened', 'Will be reopened')} value={result.reopened} color={result.reopened ? 'amber' : undefined} icon="history" hint="Fixed, but seen again" />
        <Stat label={will(result.closeMissing ? 'Closed as fixed' : 'Missing from file', result.closeMissing ? 'Will be closed' : 'Missing from file')}
          value={result.closeMissing ? result.closed : result.missing} icon="check"
          color={result.closeMissing && result.closed ? 'purple' : undefined} hint={result.closeMissing ? 'No longer reported' : 'Left open'} />
        <Stat label="Rows with errors" value={result.errors} color={result.errors ? 'red' : undefined} icon="alert-circle"
          hint={`Of ${result.total} rows; ${result.duplicates} repeated`} />
      </div>

      <Card title={done ? 'What the import did' : 'Step 3: check what the import will do'} flush>
        <div className="vuln-tabs">
          <Tabs label="Rows by result" active={tab} onChange={setTab} tabs={tabs} />
        </div>
      </Card>

      <div className="form-actions">
        {done ? (
          <>
            <Button onClick={onRestart}>Import another file</Button>
            {result.batchId && <Link className="btn btn-secondary" to={`/vulnerabilities/imports/${result.batchId}`}>Open this import</Link>}
            <Link className="btn btn-primary" to="/vulnerabilities">Go to findings</Link>
          </>
        ) : (
          <>
            <Button onClick={onBack}>Back</Button>
            <Button variant="primary" loading={busy} disabled={willWrite + result.unchanged === 0} onClick={onImport}>
              {willWrite + result.unchanged === 0 ? 'Nothing to import'
                : willWrite === 0 ? 'Record this import (no changes)'
                : `Import: ${result.created} new, ${changed} updated${result.closed ? `, ${result.closed} closed` : ''}`}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
