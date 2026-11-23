// The plan panel on a policy page (E28-08, E28-09): for a policy whose document type is a plan, the
// element map (where the plan covers each element and who owns it), the review history and "Start
// annual review". Shows nothing for other policies. Owned by the governance work (wave 10).
import { useState } from 'react';
import {
  api, Button, Card, ConfirmDialog, EmptyState, errorMessage, formatDate, IconButton, Modal, Select, TableWrap, TextField, useAuth, useFetch,
  useLookup, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';
import './PlanPanel.css';

interface Element { id?: string; element_key: string; title: string | null; section_ref: string | null; owner_id: string | null; owner_name?: string | null; notes?: string | null }
interface Review { id: string; review_year: number; outcome: string; started_on: string; approved_on: string | null; note: string | null; version: number | null }
interface Plan { is_plan: boolean; review_months: number; review_date: string | null; elements: Element[]; reviews: Review[]; review_available: boolean; review_running: boolean }

const OUTCOMES: Record<string, string> = { in_review: 'In review', approved: 'Approved', rejected: 'Rejected', canceled: 'Canceled' };

function MapEditor({ policyId, elements, onClose, onSaved }: { policyId: string; elements: Element[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const options = useLookup('plan_element').map((v) => ({ value: v.value, label: v.label }));
  const [rows, setRows] = useState<Element[]>(elements.map((e) => ({ ...e })));
  const [start] = useState(() => JSON.stringify(rows));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<Element>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await api.put(`/api/policies/${policyId}/plan-elements`, { elements: rows.map((r) => ({ element_key: r.element_key, title: r.title, section_ref: r.section_ref, owner_id: r.owner_id, notes: r.notes })) });
      toast.success('Element map saved.');
      onSaved();
    } catch (err) { setErrors((err as { fields?: Record<string, string> }).fields ?? {}); toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title="Edit the element map" size="lg" onClose={onClose} dirty={JSON.stringify(rows) !== start}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="pl-rows">
        {rows.length === 0 && <p className="muted">No entries yet. Add one for each place the plan covers an element.</p>}
        {rows.map((r, i) => (
          <div key={i} className="pl-row">
            <Select label="Element" required value={r.element_key} options={options} error={errors[`elements.${i}.element_key`]} onChange={(v) => set(i, { element_key: v })} />
            <TextField label="What covers it" value={r.title ?? ''} onChange={(v) => set(i, { title: v })} />
            <TextField label="Where in the plan" placeholder="Section 2.1" value={r.section_ref ?? ''} onChange={(v) => set(i, { section_ref: v })} />
            <UserPicker label="Owner" value={r.owner_id} display={r.owner_name ?? undefined} error={errors[`elements.${i}.owner_id`]} onChange={(id) => set(i, { owner_id: id })} />
            <IconButton icon="trash" label={`Remove entry ${i + 1}`} variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="form-actions">
        <Button icon="plus" onClick={() => setRows((x) => [...x, { element_key: options[0]?.value ?? '', title: '', section_ref: '', owner_id: null }])}>Add an entry</Button>
      </div>
    </Modal>
  );
}

export function PlanPanel({ policy, onChanged }: { policy: Row; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch<Plan>(`/api/policies/${policy.id}/plan`);
  const elements = useLookup('plan_element');
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data?.is_plan) return null;
  const canEdit = can('policies.edit');
  const start = async () => {
    setBusy(true);
    try { await api.post(`/api/policies/${policy.id}/plan-review`); toast.success('Annual review started: each party approves in turn.'); setStarting(false); reload(); onChanged?.(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const keys = [...elements.map((e) => e.value), ...data.elements.map((e) => e.element_key).filter((k) => !elements.some((e) => e.value === k))];
  return (
    <div className="stack">
      <Card title="Plan elements" actions={canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit map</Button>}>
        {keys.length === 0 ? <EmptyState icon="clipboard" title="No elements defined" message="An administrator lists the plan's elements under Administration > Lists (the list Plan element)." /> : (
          <div className="pl-map">
            {keys.map((k) => {
              const rows = data.elements.filter((e) => e.element_key === k);
              const label = elements.find((e) => e.value === k)?.label ?? k;
              return (
                <section key={k} className={`pl-element${rows.length ? '' : ' pl-gap'}`} aria-label={label}>
                  <h3>{label}</h3>
                  {rows.length ? (
                    <ul>
                      {rows.map((e) => (
                        <li key={e.id}>
                          {e.title || 'Covered'}{e.section_ref && <span className="muted"> · {e.section_ref}</span>}
                          {e.owner_name && <div className="muted">Owner: {e.owner_name}</div>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">Not covered in the plan yet.</p>}
                </section>
              );
            })}
          </div>
        )}
      </Card>
      <Card title="Annual review" actions={canEdit && data.review_available && !data.review_running && <Button size="sm" variant="primary" onClick={() => setStarting(true)}>Start annual review</Button>}>
        <p className="muted">
          Reviewed every {data.review_months} months.{data.review_date ? ` Next review by ${formatDate(data.review_date)}.` : ''}
          {data.review_running ? ' A review is waiting for approval: see the approval panel above.' : ''}
          {!data.review_available ? ' No Annual plan review workflow is active; an administrator can set one up under Administration > Approval workflows.' : ''}
        </p>
        {data.reviews.length === 0 ? <p className="muted">No reviews recorded yet.</p> : (
          <TableWrap label="Plan reviews">
            <table className="table">
              <caption className="sr-only">Plan reviews</caption>
              <thead><tr><th scope="col">Year</th><th scope="col">Outcome</th><th scope="col">Started</th><th scope="col">Approved</th><th scope="col">Version</th></tr></thead>
              <tbody>
                {data.reviews.map((r) => (
                  <tr key={r.id}>
                    <td>{r.review_year}</td>
                    <td>{OUTCOMES[r.outcome] ?? r.outcome}{r.note && <div className="muted">{r.note}</div>}</td>
                    <td>{formatDate(r.started_on)}</td>
                    <td>{r.approved_on ? formatDate(r.approved_on) : <span className="muted">Not yet</span>}</td>
                    <td>{r.version ?? <span className="muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {editing && <MapEditor policyId={String(policy.id)} elements={data.elements} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      <ConfirmDialog open={starting} title="Start the annual review?" confirmLabel="Start review" busy={busy} onConfirm={start} onCancel={() => setStarting(false)}
        message="The plan goes to each party in turn for approval. When the last one approves, the next review date is set." />
    </div>
  );
}

