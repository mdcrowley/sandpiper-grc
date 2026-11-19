// The security-terms checklist for one contract. The status of each clause is a toggle that
// saves at once; the wording and a note open underneath and save when you leave them.
import { useEffect, useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import {
  api, Button, ConfirmDialog, cx, EmptyState, ErrorState, errorMessage, Icon, Loading, TextArea, TextField, useAuth,
  useFetch, useToast,
} from '../../core';
import { CLAUSE_ORDER, CLAUSE_STATUS, ClauseChip, CoverageMeter } from './shared';
import type { ChecklistRow, ClauseKey, TermCounts } from './shared';

const OPTIONS = CLAUSE_ORDER.map((s) => ({ value: s, label: CLAUSE_STATUS[s].label }));

export function countTerms(rows: ChecklistRow[]): TermCounts {
  const t: TermCounts = { present: 0, partial: 0, absent: 0, not_assessed: 0 };
  for (const r of rows) t[r.status ?? 'not_assessed'] += 1;
  return t;
}

function ClauseRow({ contractId, row, editable, onSaved }: {
  contractId: string; row: ChecklistRow; editable: boolean; onSaved: (row: ChecklistRow) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(row.clause_text ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [open, setOpen] = useState(Boolean(row.clause_text || row.note));
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => { setText(row.clause_text ?? ''); setNote(row.note ?? ''); }, [row.clause_text, row.note]);

  const key: ClauseKey = row.status ?? 'none';
  const dirty = text.trim() !== (row.clause_text ?? '') || note.trim() !== (row.note ?? '');

  async function send(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      onSaved(await api.patch<ChecklistRow>(`/api/contracts/${contractId}/clauses/${row.clause_key}`, patch));
      setSavedAt(Date.now());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={cx('vnd-clause', `vnd-clause-${key}`)}>
      <div className="vnd-clause-head">
        <div className="vnd-clause-name">
          <span className="vnd-clause-label">{row.label}</span>
          {row.description && <span className="vnd-clause-hint">{row.description}</span>}
        </div>
        {editable ? (
          <div className="vnd-clause-controls">
            <SegmentedControl
              size="xs" aria-label={`Status of ${row.label}`} data={OPTIONS} value={key} disabled={busy}
              color={key === 'none' ? undefined : CLAUSE_STATUS[key].color}
              onChange={(next) => { if (next !== key) void send({ status: next === 'none' ? null : next }); }}
            />
            <Button
              size="sm" variant="ghost" icon={open ? 'chevron-up' : 'edit'} aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide wording' : row.clause_text || row.note ? 'Wording' : 'Add wording'}
            </Button>
          </div>
        ) : <ClauseChip status={row.status} />}
      </div>
      {editable && open && (
        <div
          className="vnd-clause-edit"
          onBlur={(e) => {
            // Save when focus leaves the pair of boxes, not when it moves between them.
            if (dirty && !e.currentTarget.contains(e.relatedTarget as Node | null)) void send({ clause_text: text, note });
          }}
        >
          <TextArea
            label={`What the contract says about ${row.label}`} hideLabel rows={2}
            placeholder="What the contract says, ideally in its own words" value={text} onChange={setText}
          />
          <TextField label={`Note on ${row.label}`} hideLabel placeholder="Note, for example the clause number" value={note} onChange={setNote} />
          <span className="vnd-clause-saved muted" aria-live="polite">
            {busy ? 'Saving…' : dirty ? 'Saves when you move on' : savedAt ? <><Icon name="check" size={14} /> Saved</> : ''}
          </span>
        </div>
      )}
      {!(editable && open) && (row.clause_text || row.note) && (
        <p className="vnd-clause-quote">
          {row.clause_text}
          {row.note && <span className="muted">{row.clause_text ? ' · ' : ''}{row.note}</span>}
        </p>
      )}
    </li>
  );
}

export function Checklist({ contractId, onChanged }: { contractId: string; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('contracts.edit');
  const { data, error, reload } = useFetch<ChecklistRow[]>(`/api/contracts/${contractId}/clauses`);
  const [rows, setRows] = useState<ChecklistRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setRows(data); }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!rows) return <Loading lines={6} label="Loading security terms" />;
  if (!rows.length) {
    return <EmptyState icon="shield" title="No clauses are set up" message="An administrator can add clauses to the contract clause list." />;
  }
  const terms = countTerms(rows);

  async function markRest() {
    setBusy(true);
    try {
      const res = await api.post<{ changed: number; clauses: ChecklistRow[] }>(`/api/contracts/${contractId}/clauses/bulk`, { status: 'absent' });
      setRows(res.clauses);
      toast.success(`${res.changed} clause${res.changed === 1 ? '' : 's'} marked absent.`);
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="vnd-checklist">
      <div className="vnd-checklist-bar">
        <div className="vnd-checklist-meter">
          <span className="vnd-eyebrow">{rows.length - terms.not_assessed} of {rows.length} clauses assessed</span>
          <CoverageMeter terms={terms} />
        </div>
        {editable && terms.not_assessed > 0 && (
          <Button size="sm" onClick={() => setConfirming(true)}>Mark the rest absent</Button>
        )}
      </div>
      <ul className="vnd-clauses" aria-label="Security terms checklist">
        {rows.map((r) => (
          <ClauseRow
            key={r.clause_key} contractId={contractId} row={r} editable={editable}
            onSaved={(next) => { setRows((all) => (all ?? []).map((x) => (x.clause_key === next.clause_key ? next : x))); onChanged?.(); }}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={confirming} busy={busy} title="Mark the rest absent"
        message={`Mark the ${terms.not_assessed} clause${terms.not_assessed === 1 ? '' : 's'} not yet assessed as absent? Clauses you have already assessed are left as they are. Each change is recorded in the contract's history.`}
        confirmLabel="Mark absent" onConfirm={() => void markRest()} onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
