// Importing control coverage from a spreadsheet (E41-12): one row per control and covered record.
// A check runs first and says, row by row, what would be added; the import then adds the links.
import { useState } from 'react';
import { api, Button, errorMessage, Modal, Notice, StatusChip, TableWrap, useToast } from '../../core';

interface ResultRow {
  line: number; outcome: 'add' | 'exists' | 'error'; message: string | null;
  control: { id: string; ref: string; title: string } | null;
  record: { type: string; typeLabel: string; id: string; name: string } | null;
}
interface ImportResult {
  dryRun: boolean; rows: number; columns: Record<string, string>; added: number; existing: number; errors: number;
  results: ResultRow[]; warnings: string[];
}

const COLUMN_LABELS: Record<string, string> = { control: 'Control', type: 'Kind of record', record: 'Record' };
const OUTCOME: Record<ResultRow['outcome'], { label: string; color: 'green' | 'gray' | 'red' }> = {
  add: { label: 'Will be added', color: 'green' }, exists: { label: 'Already there', color: 'gray' }, error: { label: 'Not imported', color: 'red' },
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

export function CoverageImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setFile(null); setCheck(null); setError(null); };
  const close = () => { reset(); onClose(); };

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const content = await readFile(file);
      const res = await api.post<ImportResult>('/api/controls/coverage/import', { fileName: file.name, content, dryRun });
      if (dryRun) setCheck(res);
      else {
        toast.success(`Coverage imported: ${res.added} added, ${res.existing} already there${res.errors ? `, ${res.errors} rows not imported` : ''}.`);
        reset();
        onDone();
        onClose();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const problems = check?.results.filter((r) => r.outcome === 'error') ?? [];
  return (
    <Modal open={open} title="Import coverage from a spreadsheet" onClose={close} size="lg" dirty={Boolean(file)}
      footer={(
        <div className="row ctl-dialog-buttons">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {check
            ? <Button variant="primary" icon="upload" loading={busy} disabled={!check.added} onClick={() => send(false)}>Add {check.added} link{check.added === 1 ? '' : 's'}</Button>
            : <Button variant="primary" loading={busy} disabled={!file} onClick={() => send(true)}>Check the file</Button>}
        </div>
      )}>
      <div className="stack">
        <p className="muted">
          One row for each control and a record it covers (CSV or Excel). Columns: <strong>Control</strong> (its reference, such as CTL-00012, or its
          exact title), <strong>Kind of record</strong> (Risk, Hazard, Framework outcome, Obligation, Policy or OT security zone; may be left out
          when the record is given by its reference) and <strong>Record</strong> (its reference or exact title). Coverage is only added: nothing
          is removed. <a href="/api/controls/coverage/import-template" download>Download a template</a>.
        </p>
        <label className="ctl-file">
          <span className="ctl-file-label">File</span>
          <input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheck(null); }} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        {check && (
          <Notice tone={check.errors ? 'warning' : 'info'} title={`${check.rows} row${check.rows === 1 ? '' : 's'} read`}>
            <p>{check.added} to add, {check.existing} already there, {check.errors} that cannot be imported.</p>
            <p>Columns used: {Object.entries(check.columns).map(([k, h]) => `${COLUMN_LABELS[k] ?? k} from "${h}"`).join('; ')}.</p>
            {check.warnings.map((w) => <p key={w}>{w}</p>)}
          </Notice>
        )}
        {check && check.results.length > 0 && (
          <TableWrap label="What each row of the file does">
            <table className="table">
              <caption className="sr-only">What each row of the file does</caption>
              <thead><tr><th scope="col">Line</th><th scope="col">Control</th><th scope="col">Covers</th><th scope="col">Outcome</th></tr></thead>
              <tbody>
                {[...problems, ...check.results.filter((r) => r.outcome !== 'error')].slice(0, 200).map((r) => (
                  <tr key={r.line}>
                    <td className="num">{r.line}</td>
                    <td className="ctl-wrap">{r.control ? <><span className="ref">{r.control.ref}</span> {r.control.title}</> : <span className="muted">—</span>}</td>
                    <td className="ctl-wrap">{r.record ? `${r.record.typeLabel}: ${r.record.name}` : <span className="muted">—</span>}</td>
                    <td className="ctl-wrap"><StatusChip color={OUTCOME[r.outcome].color} label={OUTCOME[r.outcome].label} />{r.message && <div className="muted ctl-hint">{r.message}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </Modal>
  );
}
