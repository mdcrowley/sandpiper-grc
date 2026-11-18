// The security terms checklist for one contract: one row per clause, editable in place.
import { useEffect, useState } from 'react';
import {
  api, Button, EmptyState, ErrorState, errorMessage, Loading, Select, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { ClauseChip, CLAUSE_STATUS } from './shared';
import type { ChecklistRow, ClauseStatus } from './shared';

const STATUS_OPTIONS = (['present', 'partial', 'absent'] as ClauseStatus[]).map((s) => ({ value: s, label: CLAUSE_STATUS[s].label }));

interface Draft { status: string; clause_text: string; note: string }
const draftOf = (r: ChecklistRow): Draft => ({ status: r.status ?? '', clause_text: r.clause_text ?? '', note: r.note ?? '' });

function ClauseRow({ contractId, row, editable, onSaved }: {
  contractId: string; row: ChecklistRow; editable: boolean; onSaved: (row: ChecklistRow) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(draftOf(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setDraft(draftOf(row)); }, [row]);

  const saved = draftOf(row);
  const dirty = draft.status !== saved.status || draft.clause_text !== saved.clause_text || draft.note !== saved.note;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const next = await api.patch<ChecklistRow>(`/api/contracts/${contractId}/clauses/${row.clause_key}`, {
        status: draft.status || null, clause_text: draft.clause_text, note: draft.note,
      });
      onSaved(next);
      toast.success(`${row.label} saved.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <tr>
        <th scope="row" className="vnd-clause-name">
          {row.label}
          {row.description && <span className="vnd-clause-hint">{row.description}</span>}
        </th>
        <td><ClauseChip status={row.status} /></td>
        <td className="vnd-wrap">{row.clause_text || <span className="muted">—</span>}</td>
        <td className="vnd-wrap">{row.note || <span className="muted">—</span>}</td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row" className="vnd-clause-name">
        {row.label}
        {row.description && <span className="vnd-clause-hint">{row.description}</span>}
        <span className="vnd-clause-chip"><ClauseChip status={row.status} /></span>
      </th>
      <td className="vnd-clause-status">
        <Select
          label={`Status of ${row.label}`} hideLabel placeholder="Not assessed" options={STATUS_OPTIONS}
          value={draft.status} onChange={(status) => setDraft({ ...draft, status })}
        />
      </td>
      <td className="vnd-clause-text">
        <TextArea
          label={`Clause text for ${row.label}`} hideLabel rows={2} placeholder="What the contract says"
          value={draft.clause_text} onChange={(clause_text) => setDraft({ ...draft, clause_text })}
        />
      </td>
      <td className="vnd-clause-note">
        <TextField
          label={`Note on ${row.label}`} hideLabel placeholder="Note" error={error}
          value={draft.note} onChange={(note) => setDraft({ ...draft, note })}
        />
      </td>
      <td>
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving} onClick={save}>Save</Button>
      </td>
    </tr>
  );
}

export function Checklist({ contractId, onChanged }: { contractId: string; onChanged?: () => void }) {
  const { can } = useAuth();
  const editable = can('contracts.edit');
  const { data, error, reload } = useFetch<ChecklistRow[]>(`/api/contracts/${contractId}/clauses`);
  const [rows, setRows] = useState<ChecklistRow[] | null>(null);
  useEffect(() => { if (data) setRows(data); }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!rows) return <Loading lines={6} label="Loading security terms" />;
  if (!rows.length) {
    return <EmptyState icon="shield" title="No clauses are set up" message="An administrator can add clauses to the contract clause list." />;
  }
  return (
    <div className="table-wrap">
      <table className="table vnd-checklist">
        <caption className="sr-only">Security terms checklist</caption>
        <thead>
          <tr>
            <th scope="col">Clause</th>
            <th scope="col">Status</th>
            <th scope="col">Clause text</th>
            <th scope="col">Note</th>
            {editable && <th scope="col"><span className="sr-only">Save</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <ClauseRow
              key={r.clause_key} contractId={contractId} row={r} editable={editable}
              onSaved={(next) => { setRows(rows.map((x) => (x.clause_key === next.clause_key ? next : x))); onChanged?.(); }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
