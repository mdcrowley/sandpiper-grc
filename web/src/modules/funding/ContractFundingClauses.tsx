// The "Funder-required clauses" panel on a contract's page (E27-08). The contracts page loads it with
// import.meta.glob('../funding/ContractFundingClauses.tsx') and shows it only while the funding area
// is on and the reader may view funding records, so a build without this module shows nothing.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import { api, Card, EmptyState, ErrorState, errorMessage, Loading, TextField, useAuth, useFetch, useToast } from '../../core';
import './funding.css';

interface Checklist {
  clauses: { key: string; label: string; description: string | null }[];
  awards: { id: string; ref: string; title: string; funder_name: string | null; checklist: { clause_key: string; status: string | null; note: string | null }[] }[];
}

const STATUSES = [
  { value: 'none', label: 'Not checked' },
  { value: 'present', label: 'Present' },
  { value: 'partial', label: 'Partial' },
  { value: 'absent', label: 'Absent' },
  { value: 'not_required', label: 'Not required' },
];

function ClauseLine({ contractId, awardId, clause, value, editable, onSaved }: {
  contractId: string; awardId: string; clause: Checklist['clauses'][number]; value: { status: string | null; note: string | null };
  editable: boolean; onSaved: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState(value.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (status: string | null, nextNote: string) => {
    setBusy(true);
    try {
      await api.put(`/api/funding/contracts/${contractId}/clauses`, { award_id: awardId, clause_key: clause.key, status, note: nextNote });
      onSaved();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const current = value.status ?? 'none';
  return (
    <li className={`fd-clause fd-clause-${current}`}>
      <div className="fd-clause-name">
        <span className="fd-clause-label">{clause.label}</span>
        {clause.description && <span className="muted fd-small">{clause.description}</span>}
      </div>
      {editable ? (
        <div className="fd-clause-controls">
          <SegmentedControl size="xs" aria-label={`${clause.label}: status`} data={STATUSES} value={current} disabled={busy}
            onChange={(next) => { if (next !== current) void save(next === 'none' ? null : next, note); }} />
          <TextField label={`${clause.label}: note`} hideLabel placeholder="Where in the contract" value={note} size="xs"
            onChange={setNote} />
          {note.trim() !== (value.note ?? '') && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(value.status, note)}>Save note</button>}
        </div>
      ) : (
        <span className="fd-clause-status">{STATUSES.find((s) => s.value === current)?.label}{value.note ? ` · ${value.note}` : ''}</span>
      )}
    </li>
  );
}

export function ContractFundingClauses({ contractId }: { contractId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Checklist>(`/api/funding/contracts/${contractId}/clauses`);
  const editable = can('funding.edit');
  return (
    <Card title="Funder-required clauses">
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} />
        : data.awards.length === 0 ? (
          <EmptyState icon="link" title="No award funds this contract"
            message="Record the contract as funded by an award (on the award's Funded items tab) to check the clauses that funder requires." />
        ) : data.clauses.length === 0 ? (
          <EmptyState icon="clipboard" title="No funder clauses are listed" message="An administrator lists the clauses funders require under Administration > Lookups (the list Funding clause)." />
        ) : (
          <div className="stack">
            {data.awards.map((a) => (
              <section key={a.id} aria-labelledby={`fd-award-${a.id}`} className="fd-clause-award">
                <h3 id={`fd-award-${a.id}`} className="fd-h3">
                  <Link to={`/funding/awards/${a.id}`}><span className="ref">{a.ref}</span> {a.title}</Link>
                  {a.funder_name && <span className="muted fd-small"> · {a.funder_name}</span>}
                </h3>
                <ul className="fd-clauses">
                  {data.clauses.map((c) => (
                    <ClauseLine key={c.key} contractId={contractId} awardId={a.id} clause={c} editable={editable} onSaved={reload}
                      value={a.checklist.find((x) => x.clause_key === c.key) ?? { status: null, note: null }} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
    </Card>
  );
}
