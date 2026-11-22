// Administration > Lifecycles (/admin/lifecycles, E14-31): per record type, which moves between
// statuses are allowed, which fields must be filled in before a status, and who may set it. The
// server keeps the rules (core/lifecycle.ts) and checks every save; a module's own rules still apply
// and are listed as "Set by the application".
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDateTime, Icon, Loading, PageHeader,
  Select, StatusChip, TableWrap, toColorName, useFetch, useMeta, useToast,
} from '../../core';
import { describeMoves, NEW, unreachable, type Detail, type Rules, type TypeSummary } from './data';
import './lifecycles.css';

export function LifecyclesPage() {
  const list = useFetch<{ types: TypeSummary[] }>('/api/admin/lifecycles');
  const [params, setParams] = useSearchParams();
  const types = list.data?.types ?? [];
  const wanted = params.get('type') ?? '';
  const selected = types.some((x) => x.type === wanted) ? wanted : types[0]?.type ?? '';

  return (
    <>
      <PageHeader
        title="Lifecycles"
        subtitle="For each kind of record with a status: which status changes are allowed, which fields must be filled in first, and who may make them. Every save is checked, from forms, the API, imports and AI assistants. The statuses themselves are edited in Lists."
      />
      {list.error ? <ErrorState title="Lifecycles could not be loaded" error={list.error} onRetry={list.reload} />
        : !list.data ? <Loading label="Loading lifecycles" lines={8} />
        : types.length === 0 ? <EmptyState icon="refresh" title="No record types with a status" message="Record types with a status field appear here." />
        : (
          <div className="lc-layout">
            <Card title={`Record types (${types.length})`} flush>
              <nav className="lc-nav" aria-label="Record types">
                {types.map((x) => (
                  <button key={x.type} type="button" aria-current={x.type === selected ? 'true' : undefined} onClick={() => setParams({ type: x.type })}>
                    <span className="lc-nav-text">
                      <span>{x.plural}</span>
                      <span className="lc-nav-hint">{x.managed ? 'Set by the application' : x.customized ? summaryText(x) : 'Every change allowed'}</span>
                    </span>
                    {x.newStatuses > 0 && <StatusChip color="amber" size="sm" label={`${x.newStatuses} new`} title="Statuses added to the list since the rules were saved" />}
                    {x.customized && !x.newStatuses && <StatusChip color="blue" size="sm" label="Changed" />}
                  </button>
                ))}
              </nav>
            </Card>
            {selected && <TypeLifecycle key={selected} type={selected} onChanged={list.reload} />}
          </div>
        )}
    </>
  );
}

function summaryText(x: TypeSummary): string {
  const parts = [
    x.blocked ? `${x.blocked} not allowed` : '',
    x.required ? `${x.required} required` : '',
    x.limited ? `${x.limited} limited` : '',
    x.approvals ? `${x.approvals} need approval` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Changed';
}

const emptyRules = (): Rules => ({ blocked: [], required: {}, who: {}, approvals: [] });

function TypeLifecycle({ type, onChanged }: { type: string; onChanged: () => void }) {
  const { data, error, reload } = useFetch<Detail>(`/api/admin/lifecycles/${encodeURIComponent(type)}`);
  const meta = useMeta();
  const toast = useToast();
  const [rules, setRules] = useState<Rules>(emptyRules);
  const [saving, setSaving] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => { if (data) setRules({ ...data.rules, approvals: data.rules.approvals ?? [] }); }, [data]);

  const dirty = useMemo(() => Boolean(data) && JSON.stringify(normalize(rules)) !== JSON.stringify(normalize(data!.rules)), [rules, data]);
  if (error) return <ErrorState title="This lifecycle could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading the lifecycle" lines={8} />;

  const statuses = data.statuses;
  const label = (v: string) => (v === NEW ? 'New record' : statuses.find((s) => s.value === v)?.label ?? v);
  const isBlocked = (from: string, to: string) => rules.blocked.some(([a, b]) => a === from && b === to);
  const toggle = (from: string, to: string) => setRules((r) => ({
    ...r,
    blocked: isBlocked(from, to) ? r.blocked.filter(([a, b]) => !(a === from && b === to)) : [...r.blocked, [from, to]],
    // A move no longer allowed waits for nothing (E14-37).
    approvals: isBlocked(from, to) ? r.approvals : r.approvals.filter(([a, b]) => !(a === from && b === to)),
  }));
  const editable = !data.managed;
  const fieldLabel = (name: string) => data.fields.find((f) => f.name === name)?.label ?? name;
  const roleLabel = (key: string) => data.roles.find((r) => r.key === key)?.name ?? key;
  const stuck = unreachable(statuses.map((s) => s.value), rules.blocked);

  const save = async () => {
    setSaving(true);
    setProblem('');
    try {
      await api.put(`/api/admin/lifecycles/${encodeURIComponent(type)}`, normalize(rules));
      toast.success(`Lifecycle of ${data.plural.toLowerCase()} saved.`);
      reload(); onChanged(); meta.reload();
    } catch (err) {
      setProblem(err instanceof ApiError && err.fields ? Object.values(err.fields).join(' ') || errorMessage(err) : errorMessage(err));
    } finally { setSaving(false); }
  };
  const restore = async () => {
    setSaving(true);
    try {
      await api.del(`/api/admin/lifecycles/${encodeURIComponent(type)}`);
      toast.success(`Lifecycle of ${data.plural.toLowerCase()} restored to the defaults.`);
      setConfirmRestore(false);
      reload(); onChanged(); meta.reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  };

  return (
    <div className="lc-detail">
      <Card
        title={`${data.plural}: ${data.fieldLabel.toLowerCase()}`}
        actions={<Link to={`/admin/lists?list=${encodeURIComponent(data.list)}`} className="lc-link"><Icon name="clipboard" size={14} /> Edit the statuses in Lists</Link>}
      >
        <p className="lc-state">
          {data.managed ? <StatusChip color="gray" label="Set by the application" />
            : data.customized ? <StatusChip color="blue" label="Changed from the defaults" />
            : <StatusChip color="green" label="Defaults: every change allowed, nothing required" />}
          {data.customized && data.updatedAt && <span className="muted"> Last changed {formatDateTime(data.updatedAt)}{data.updatedBy ? ` by ${data.updatedBy}` : ''}.</span>}
        </p>
        {data.notes.length > 0 && (
          <div className="lc-app">
            <div className="lc-app-title"><Icon name="lock" size={14} /> Set by the application</div>
            <ul>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            {editable && <p className="muted lc-small">The rules on this page add to these; they can never allow what the application refuses.</p>}
          </div>
        )}
        {data.managed && (
          <p className="lc-small">Only the application changes the {data.fieldLabel.toLowerCase()} of {data.plural.toLowerCase()}, through its own steps, so its changes cannot be edited here.</p>
        )}
        {data.newStatuses.length > 0 && (
          <div className="lc-warn" role="status">
            <Icon name="alert" size={16} />
            <span>Added to the list since these rules were saved: {data.newStatuses.map(label).join(', ')}. Every change to and from {data.newStatuses.length === 1 ? 'it' : 'them'} is allowed until you change the table below and save.</span>
          </div>
        )}
      </Card>

      {editable && (
        <>
          <Card title="Moves between statuses">
            <MoveDiagram statuses={statuses} blocked={rules.blocked} label={label} required={rules.required} who={rules.who} fieldLabel={fieldLabel} roleLabel={roleLabel}
              approvals={rules.approvals} workflowLabel={(id) => data.workflows?.find((w) => w.id === id)?.name ?? 'a workflow no longer available'} />
          </Card>

          <Card title="Allowed changes">
            <p className="muted lc-small">Check a box to allow a record in the row's status to change to the column's status. The first row is a new record: the statuses it may start with.</p>
            {stuck.length > 0 && (
              <div className="lc-warn" role="status">
                <Icon name="alert" size={16} />
                <span>A new record can never reach {stuck.map((s) => `"${label(s)}"`).join(', ')} through the allowed changes. Records that already have {stuck.length === 1 ? 'it' : 'them'} keep {stuck.length === 1 ? 'it' : 'them'}.</span>
              </div>
            )}
            <TableWrap label={`Allowed changes of ${data.fieldLabel.toLowerCase()} for ${data.plural.toLowerCase()}: rows are the current status, columns the new one`} className="lc-matrix-wrap">
              <table className="table lc-matrix">
                <caption className="sr-only">Allowed changes of {data.fieldLabel.toLowerCase()} for {data.plural.toLowerCase()}: rows are the current status, columns the new one</caption>
                <thead>
                  <tr>
                    <th scope="col">From \ to</th>
                    {statuses.map((s) => <th key={s.value} scope="col">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[NEW, ...statuses.map((s) => s.value)].map((from) => (
                    <tr key={from || 'new'}>
                      <th scope="row">{from === NEW ? <em>New record</em> : <StatusChip color={toColorName(statuses.find((s) => s.value === from)?.color)} label={label(from)} size="sm" />}</th>
                      {statuses.map((s) => (
                        <td key={s.value} className="lc-cell">
                          {from === s.value ? <span className="muted" aria-label="Same status">–</span> : (
                            <input
                              type="checkbox"
                              checked={!isBlocked(from, s.value)}
                              onChange={() => toggle(from, s.value)}
                              aria-label={from === NEW ? `A new record may start as ${s.label}` : `Allow ${label(from)} to ${s.label}`}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {data.workflows && (
            <ApprovalMoves
              statuses={statuses} label={label} rules={rules} workflows={data.workflows} plural={data.plural} fieldLabel={data.fieldLabel}
              onChange={(approvals) => setRules((r) => ({ ...r, approvals }))}
            />
          )}

          <Card title="Required fields and who may set each status">
            <p className="muted lc-small">Fields that must be filled in before a record may have the status (also when it is created with it), and who may change a record to it. Leave "who" empty for anyone who may edit the record.</p>
            <div className="lc-status-rules">
              {statuses.map((s) => {
                const w = rules.who[s.value] ?? { permission: null, roles: [] };
                const setWho = (next: { permission: string | null; roles: string[] }) => setRules((r) => ({ ...r, who: { ...r.who, [s.value]: next } }));
                return (
                  <fieldset key={s.value} className="lc-status-rule">
                    <legend><StatusChip color={toColorName(s.color)} label={s.label} size="sm" /></legend>
                    <ChoicesField
                      label="Fields required"
                      options={data.fields.map((f) => ({ value: f.name, label: f.custom ? `${f.label} (custom)` : f.label }))}
                      value={rules.required[s.value] ?? []}
                      onChange={(v) => setRules((r) => ({ ...r, required: { ...r.required, [s.value]: v } }))}
                      placeholder="None"
                    />
                    <Select
                      label="Permission needed"
                      options={[{ value: '', label: 'No permission beyond editing' }, ...data.permissions]}
                      value={w.permission ?? ''}
                      onChange={(v) => setWho({ ...w, permission: v || null })}
                    />
                    <ChoicesField
                      label="Or one of these roles"
                      options={data.roles.map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))}
                      value={w.roles ?? []}
                      onChange={(v) => setWho({ ...w, roles: v })}
                      placeholder="Any role"
                    />
                  </fieldset>
                );
              })}
            </div>
          </Card>

          {problem && <div className="lc-error" role="alert"><Icon name="alert" size={16} /> {problem}</div>}
          <div className="lc-actions">
            {data.customized && <Button variant="secondary" icon="refresh" onClick={() => setConfirmRestore(true)} disabled={saving}>Restore defaults</Button>}
            <span className="lc-spacer" />
            <Button variant="secondary" onClick={() => setRules({ ...data.rules, approvals: data.rules.approvals ?? [] })} disabled={!dirty || saving}>Discard changes</Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>Save lifecycle</Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmRestore}
        title="Restore the defaults?"
        message={`Every change of ${data.fieldLabel.toLowerCase()} will be allowed again for ${data.plural.toLowerCase()}, and no field will be required. The application's own rules still apply.`}
        confirmLabel="Restore defaults"
        busy={saving}
        onConfirm={restore}
        onCancel={() => setConfirmRestore(false)}
      />
    </div>
  );
}


/**
 * Moves that wait for an approval workflow (E14-37): when someone makes one, the record keeps its
 * status, shows the pending move, and the workflow starts; approval makes the move.
 */
function ApprovalMoves({ statuses, label, rules, workflows, plural, fieldLabel, onChange }: {
  statuses: Detail['statuses']; label: (v: string) => string; rules: Rules; workflows: NonNullable<Detail['workflows']>;
  plural: string; fieldLabel: string; onChange: (approvals: Rules['approvals']) => void;
}) {
  const allowed = statuses.flatMap((a) => statuses.filter((b) => b.value !== a.value && !rules.blocked.some(([x, y]) => x === a.value && y === b.value)).map((b) => [a.value, b.value] as [string, string]));
  const free = allowed.filter(([a, b]) => !rules.approvals.some(([x, y]) => x === a && y === b));
  const active = workflows.filter((w) => w.active);
  const set = (i: number, next: [string, string, string]) => onChange(rules.approvals.map((p, j) => (j === i ? next : p)));
  return (
    <Card title="Changes that wait for approval">
      <p className="muted lc-small">
        When someone makes one of these changes, the record keeps its {fieldLabel.toLowerCase()} and shows &ldquo;Waiting for approval&rdquo;, and the
        approval workflow starts. Approval makes the change; rejection or canceling leaves the record as it was. Other fields can still be
        edited meanwhile. A workflow whose own conditions do not hold for the record lets the change through at once.
      </p>
      {workflows.length === 0 ? (
        <p className="muted">No approval workflow exists for {plural.toLowerCase()} yet. <Link to="/admin/workflows/new">Create one</Link> (it can start &ldquo;when someone asks for approval&rdquo;), then choose it here.</p>
      ) : (
        <>
          {rules.approvals.length === 0 && <p className="muted">No change waits for approval.</p>}
          {rules.approvals.length > 0 && (
            <ul className="lc-approvals" aria-label="Changes that wait for approval">
              {rules.approvals.map(([from, to, wf], i) => {
                const w = workflows.find((x) => x.id === wf);
                return (
                  <li key={`${from}>${to}`} className="lc-approval">
                    <Select label="From" value={from} options={statuses.map((s) => ({ value: s.value, label: s.label }))}
                      onChange={(v) => set(i, [v, to === v ? '' : to, wf])} />
                    <Select label="To" value={to} options={[{ value: '', label: 'Choose a status' }, ...allowed.filter(([a]) => a === from).map(([, b]) => ({ value: b, label: label(b) }))]}
                      onChange={(v) => set(i, [from, v, wf])} />
                    <Select label="Waits for" value={wf} options={[{ value: '', label: 'Choose a workflow' }, ...workflows.filter((x) => x.active || x.id === wf).map((x) => ({ value: x.id, label: x.active ? x.name : `${x.name} (inactive)` }))]}
                      onChange={(v) => set(i, [from, to, v])} />
                    <Button variant="ghost" icon="trash" onClick={() => onChange(rules.approvals.filter((_, j) => j !== i))}>
                      Remove<span className="sr-only"> the approval for {label(from)} to {label(to)}</span>
                    </Button>
                    {w && !w.active && <p className="lc-small lc-approval-warn" role="note">&ldquo;{w.name}&rdquo; is not active, so this change is refused until it is switched on or another workflow is chosen.</p>}
                    {!w && wf && <p className="lc-small lc-approval-warn" role="note">The workflow chosen here no longer exists; choose another.</p>}
                  </li>
                );
              })}
            </ul>
          )}
          <Button size="sm" variant="ghost" icon="plus" disabled={!free.length || !active.length}
            onClick={() => onChange([...rules.approvals, [free[0][0], free[0][1], active[0]?.id ?? '']])}>
            Add a change that waits for approval
          </Button>
        </>
      )}
    </Card>
  );
}
/** The rules as sent: no empty entries, so "nothing set" compares equal however it was reached. */
function normalize(r: Rules): Rules {
  return {
    blocked: [...r.blocked].sort((a, b) => a.join('>').localeCompare(b.join('>'))),
    required: Object.fromEntries(Object.entries(r.required).filter(([, l]) => l.length).sort(([a], [b]) => a.localeCompare(b))),
    who: Object.fromEntries(Object.entries(r.who).filter(([, w]) => w.permission || w.roles?.length).sort(([a], [b]) => a.localeCompare(b))),
    approvals: [...(r.approvals ?? [])].filter(([a, b, w]) => a && b && w).sort((a, b) => a.join('>').localeCompare(b.join('>'))),
  };
}

/** The picture: each status in list order with where it may go, what it needs and who may set it (as the workflow diagram draws steps). */
function MoveDiagram({ statuses, blocked, label, required, who, fieldLabel, roleLabel, approvals, workflowLabel }: {
  statuses: Detail['statuses']; blocked: [string, string][]; label: (v: string) => string;
  required: Rules['required']; who: Rules['who']; fieldLabel: (n: string) => string; roleLabel: (k: string) => string;
  approvals: Rules['approvals']; workflowLabel: (id: string) => string;
}) {
  const moves = describeMoves(statuses.map((s) => s.value), blocked);
  return (
    <ol className="lc-flow" aria-label="Where each status may go">
      <li className="lc-flow-node lc-flow-start">
        <span className="lc-flow-icon" aria-hidden="true"><Icon name="plus" size={14} /></span>
        <div>
          <div className="lc-flow-title">New record</div>
          <div className="lc-flow-line">{moves.get(NEW)!.length ? `Starts as ${moves.get(NEW)!.map(label).join(', ')}` : 'Cannot be created: no starting status is allowed'}</div>
        </div>
      </li>
      {statuses.map((s, i) => {
        const to = moves.get(s.value)!;
        const needs = required[s.value] ?? [];
        const w = who[s.value];
        return (
          <li key={s.value} className="lc-flow-node">
            <div className="lc-flow-box">
              <span className="lc-flow-num" aria-hidden="true">{i + 1}</span>
              <div className="lc-flow-body">
                <div className="lc-flow-title"><StatusChip color={toColorName(s.color)} label={s.label} size="sm" /></div>
                <div className="lc-flow-line"><Icon name="arrow-right" size={14} /> {to.length ? `May change to ${to.map(label).join(', ')}` : 'Final: no change allowed'}</div>
                {approvals.filter(([a]) => a === s.value).map(([, b, w]) => (
                  <div key={b} className="lc-flow-line lc-flow-approval"><Icon name="check-square" size={14} /> To {label(b)} waits for approval: {workflowLabel(w)}</div>
                ))}
                {needs.length > 0 && <div className="lc-flow-line"><Icon name="edit" size={14} /> Needs {needs.map(fieldLabel).join(', ')}</div>}
                {w && (w.permission || w.roles?.length) ? (
                  <div className="lc-flow-line lc-flow-who"><Icon name="users" size={14} /> Only {[w.permission ? `people with ${w.permission}` : '', ...(w.roles ?? []).map(roleLabel)].filter(Boolean).join(' or ')}</div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
