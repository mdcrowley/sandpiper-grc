// The dry-run result and the final summary of an import (the same numbers, before and after).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Checkbox, EmptyState, Icon, Stat, StatusChip } from '../../core';
import type { ColorName } from '../../core';
import { SeverityChip } from './shared';

type Action = 'create' | 'update' | 'unchanged' | 'reopen' | 'duplicate' | 'error';
export interface ImportRow {
  line: number; action: Action; id: string | null; ref: string | null; host: string | null; title: string | null;
  severity: string | null; finding: string | null; errors: Record<string, string>; changes: string[]; duplicateOf: number | null;
}
export interface ImportResult {
  dryRun: boolean; source: string; closeMissing: boolean; total: number; created: number; updated: number; unchanged: number;
  reopened: number; duplicates: number; errors: number; missing: number; closed: number; unmatchedHosts: string[];
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

export function ImportResultView({ result, done, busy, closeMissing, onCloseMissing, onBack, onImport, onRestart }: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const problem = (r: ImportRow) => r.action === 'error' || r.action === 'duplicate';
  const shown = result.rows.filter((r) => !onlyProblems || problem(r));
  const willWrite = result.created + result.updated + result.reopened + result.closed;
  const will = (after: string, before: string) => (done ? after : before);

  return (
    <>
      {done && (
        <div className="notice notice-success">
          <Icon name="check" size={16} />
          <span>
            The import from <strong>{result.source}</strong> is finished and recorded.{' '}
            {result.batchId && <Link to={`/vulnerabilities/imports/${result.batchId}`}>Open this import</Link>}
          </span>
        </div>
      )}
      <div className="grid-stats">
        <Stat label={will('New findings', 'Will be added')} value={result.created} color="green" />
        <Stat label={will('Updated', 'Will be updated')} value={result.updated} color="blue" hint={`${result.unchanged} with no change`} />
        <Stat label={will('Reopened', 'Will be reopened')} value={result.reopened} color={result.reopened ? 'amber' : undefined} hint="Fixed, but seen again" />
        <Stat label={will('Closed as fixed', result.closeMissing ? 'Will be closed' : 'Missing from file')} value={result.closeMissing ? result.closed : result.missing}
          color={result.closeMissing && result.closed ? 'purple' : undefined} hint={result.closeMissing ? 'No longer reported' : done ? 'Close missing was off' : 'Left open'} />
        <Stat label="Rows with errors" value={result.errors} color={result.errors ? 'red' : undefined} hint={`Of ${result.total} rows; ${result.duplicates} repeated`} />
      </div>

      {!done && (
        <Card title="Findings this file no longer reports">
          <div className="stack">
            {result.missing === 0 ? (
              <p className="muted">Every open finding from earlier imports of <strong>{result.source}</strong> is in this file.</p>
            ) : (
              <>
                <p>
                  {result.missing} open {result.missing === 1 ? 'finding' : 'findings'} from earlier imports of <strong>{result.source}</strong>{' '}
                  {result.missing === 1 ? 'is' : 'are'} not in this file.
                  {result.closeMissing ? ' They will be marked fixed, dated today.' : ' They will be left as they are.'}
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
            <Checkbox label="Close missing findings" checked={closeMissing} disabled={busy} onChange={onCloseMissing}
              hint="Only tick this when the file is a complete scan of the same scope as before." />
          </div>
        </Card>
      )}

      {result.unmatchedHosts.length > 0 && (
        <Card title="Hosts not found in the asset register">
          <p className="muted">These hosts match no asset by name, tag, serial number or IP address. Their findings are imported without an asset; link them afterwards or add the assets.</p>
          <p className="vuln-hosts">{result.unmatchedHosts.join(', ')}</p>
        </Card>
      )}

      <Card title={done ? 'Rows' : '3. Dry run (nothing has been written yet)'} flush
        actions={<Checkbox label="Only show problems" checked={onlyProblems} onChange={setOnlyProblems} />}>
        {!done && result.errors > 0 && (
          <p className="vuln-pad muted">Rows with errors are never imported. Fix them in the file and start again, or import the rest now.</p>
        )}
        {shown.length === 0 ? <EmptyState icon="check" title="No problems found" message="Every row can be imported." /> : (
          <div className="table-wrap vuln-wrap">
            <table className="table">
              <caption className="sr-only">Import result, one row per line of the file, problems first</caption>
              <thead>
                <tr><th scope="col" className="num">Line</th><th scope="col">Result</th><th scope="col">Host</th><th scope="col">Finding</th><th scope="col">Severity</th><th scope="col">Details</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line} className={r.action === 'error' ? 'vuln-row-error' : undefined}>
                    <td className="num">{r.line}</td>
                    <td><StatusChip color={ACTION[r.action].color} label={ACTION[r.action].label} /></td>
                    <td>{r.host ?? '—'}</td>
                    <td>
                      {r.id ? <Link to={`/vulnerabilities/${r.id}`}>{r.title ?? r.ref}</Link> : r.title ?? '—'}
                      {r.finding && <div className="muted vuln-sub">{r.finding}</div>}
                    </td>
                    <td><SeverityChip value={r.severity} /></td>
                    <td>
                      {Object.values(r.errors).map((m) => <div key={m} className="vuln-cell-error">{m}</div>)}
                      {r.duplicateOf && <div>Same host and finding as line {r.duplicateOf}; only the first is used.</div>}
                      {r.changes.length > 0 && <div>{r.changes.join(', ')}</div>}
                      {Object.keys(r.errors).length === 0 && !r.duplicateOf && r.changes.length === 0 && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.total > result.rowsShown && <p className="vuln-pad muted">Showing {result.rowsShown} of {result.total} rows, problems first.</p>}
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
              {willWrite + result.unchanged === 0 ? 'Nothing to import' : willWrite === 0 ? 'Record this import (no changes)' :`Import: ${result.created} new, ${result.updated + result.reopened} updated${result.closed ? `, ${result.closed} closed` : ''}`}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
