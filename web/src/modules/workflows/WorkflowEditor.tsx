// Administration > Approval workflows > one workflow (/admin/workflows/new, /admin/workflows/:id):
// what it is for, what starts it, its ordered steps and what it sets at the end, with the flow
// drawn beside the form as it is edited.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ConfirmDialog, DateField, EmptyState, ErrorState, errorMessage, IconButton, Loading, NumberField,
  PageHeader, Select, Switch, TextArea, TextField, UserPicker, useFetch, useToast, type Option,
} from '../../core';
import { FlowDiagram } from './FlowDiagram';
import {
  OP_LABELS, opsFor, type ApproverSpec, type Condition, type Definition, type FieldSet, type Op, type OptionField, type Options, type StepDef,
} from './data';
import { makeLabels } from './describe';
import './workflows.css';

type Errors = Record<string, string>;

const blankStep = (n: number): StepDef => ({
  name: n === 1 ? 'Manager approval' : `Step ${n}`, approvers: { kind: 'users', users: [] }, quorum: 'any', conditions: [], due_hours: null, escalate_to: null,
});
const blank = (): Definition => ({
  record_type: '', name: '', description: null, active: true, trigger: 'manual', trigger_field: null, trigger_value: null,
  conditions: [], steps: [blankStep(1)], on_approve: [], on_reject: [],
});

const CONDITION_TYPES = new Set(['text', 'longtext', 'number', 'currency', 'date', 'datetime', 'boolean', 'lookup', 'user']);
const OUTCOME_TYPES = new Set(['text', 'longtext', 'number', 'currency', 'date', 'boolean', 'lookup', 'user']);

/* ---------- small parts ---------- */

/** A list of people with a picker to add one more. */
function PeopleList({ label, ids, names, onChange, onName, error, hint }: {
  label: string; ids: string[]; names: Record<string, string>; onChange: (ids: string[]) => void; onName: (id: string, name: string) => void; error?: string; hint?: string;
}) {
  const [key, setKey] = useState(0);
  return (
    <div className="wf-people">
      {ids.length > 0 && (
        <ul className="wf-chips" aria-label={label}>
          {ids.map((id) => (
            <li key={id} className="wf-chip">
              {names[id] ?? 'Someone'}
              <IconButton icon="x" size="sm" variant="ghost" label={`Remove ${names[id] ?? 'this person'}`} onClick={() => onChange(ids.filter((x) => x !== id))} />
            </li>
          ))}
        </ul>
      )}
      <UserPicker
        key={key}
        label={ids.length ? `Add another to ${label.toLowerCase()}` : label}
        value={null}
        placeholder="Search people"
        error={error}
        hint={hint}
        onChange={(id, option) => {
          if (!id) return;
          if (option) onName(id, option.label);
          if (!ids.includes(id)) onChange([...ids, id]);
          setKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** The value box for a condition or an outcome, shaped by the field's type. */
function ValueControl({ field, value, onChange, options, names, onName, multiple, label, error, outcome }: {
  field: OptionField; value: unknown; onChange: (v: unknown) => void; options: Options; names: Record<string, string>;
  onName: (id: string, name: string) => void; multiple?: boolean; label: string; error?: string; outcome?: boolean;
}) {
  const lookup: Option[] = (options.lookups[field.list ?? ''] ?? []).map((o) => ({ value: o.value, label: o.label, color: o.color ?? undefined }));
  if (field.type === 'lookup' && multiple) {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="wf-checks">
        <legend className="wf-label">{label}</legend>
        {lookup.map((o) => (
          <label key={o.value} className="wf-check">
            <input type="checkbox" checked={chosen.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))} />
            {o.label}
          </label>
        ))}
        {error && <span className="field-error" role="alert">{error}</span>}
      </fieldset>
    );
  }
  if (field.type === 'lookup') return <Select label={label} value={String(value ?? '')} options={lookup} onChange={onChange} error={error} />;
  if (field.type === 'boolean') return <Select label={label} value={value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : ''} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} onChange={(v) => onChange(v === '' ? null : v === 'true')} error={error} />;
  if (field.type === 'number' || field.type === 'currency') {
    return <NumberField label={label} value={value === null || value === undefined || value === '' ? null : Number(value)} onChange={(v) => onChange(v)} error={error} thousands />;
  }
  if (field.type === 'date') {
    if (outcome) {
      const today = value === 'today';
      return (
        <div className="wf-pair">
          <Select label={label} value={today ? 'today' : 'date'} options={[{ value: 'today', label: 'The day it ends' }, { value: 'date', label: 'A date' }]} onChange={(v) => onChange(v === 'today' ? 'today' : null)} />
          {!today && <DateField label="Date" value={String(value ?? '')} onChange={onChange} error={error} />}
        </div>
      );
    }
    return <DateField label={label} value={String(value ?? '')} onChange={onChange} error={error} />;
  }
  if (field.type === 'user') {
    const special = value === 'approver' || value === 'requester';
    const person = !special && typeof value === 'string' && value ? value : null;
    return (
      <div className="wf-pair">
        {outcome && (
          <Select
            label={label}
            value={special ? String(value) : 'person'}
            options={[{ value: 'approver', label: 'The last approver' }, { value: 'requester', label: 'The requester' }, { value: 'person', label: 'A person' }]}
            onChange={(v) => onChange(v === 'person' ? null : v)}
          />
        )}
        {!special && (
          <UserPicker label={outcome ? 'Person' : label} value={person} display={person ? names[person] : undefined} error={error}
            onChange={(id, o) => { if (id && o) onName(id, o.label); onChange(id); }} />
        )}
      </div>
    );
  }
  return <TextField label={label} value={String(value ?? '')} onChange={onChange} error={error} />;
}

function ConditionRows({ prefix, conditions, fields, onChange, errors, options, names, onName, intro }: {
  prefix: string; conditions: Condition[]; fields: OptionField[]; onChange: (c: Condition[]) => void; errors: Errors;
  options: Options; names: Record<string, string>; onName: (id: string, name: string) => void; intro: string;
}) {
  const usable = fields.filter((f) => CONDITION_TYPES.has(f.type));
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="wf-conditions">
      {conditions.length === 0 && <p className="muted wf-small">{intro}</p>}
      {conditions.map((c, i) => {
        const f = usable.find((x) => x.name === c.field);
        const ops = f ? opsFor(f.type) : [];
        return (
          <div key={i} className="wf-condition">
            <span className="wf-condition-word" aria-hidden="true">{i === 0 ? 'Only if' : 'and'}</span>
            <Select label="Field" value={c.field} options={usable.map((x) => ({ value: x.name, label: x.label }))}
              onChange={(v) => { const nf = usable.find((x) => x.name === v); set(i, { field: v, op: nf ? opsFor(nf.type)[0] : 'eq', value: undefined }); }} />
            <Select label="Comparison" value={c.op} options={ops.map((o) => ({ value: o, label: OP_LABELS[o] }))} onChange={(v) => set(i, { op: v as Op, value: v === 'in' ? [] : undefined })} />
            {f && c.op !== 'empty' && c.op !== 'set' && (
              <ValueControl field={f} value={c.value} onChange={(v) => set(i, { value: v })} options={options} names={names} onName={onName} multiple={c.op === 'in'} label="Value" />
            )}
            <IconButton icon="trash" variant="ghost" label={`Remove condition ${i + 1}`} onClick={() => onChange(conditions.filter((_, j) => j !== i))} />
            {errors[`${prefix}.${i}`] && <p className="field-error wf-row-error" role="alert">{errors[`${prefix}.${i}`]}</p>}
          </div>
        );
      })}
      {errors[prefix] && <p className="field-error" role="alert">{errors[prefix]}</p>}
      <Button size="sm" variant="ghost" icon="plus" disabled={!usable.length} onClick={() => onChange([...conditions, { field: usable[0]?.name ?? '', op: opsFor(usable[0]?.type ?? 'text')[0] }])}>
        Add a condition
      </Button>
    </div>
  );
}

function OutcomeRows({ prefix, sets, fields, onChange, errors, options, names, onName, empty }: {
  prefix: string; sets: FieldSet[]; fields: OptionField[]; onChange: (s: FieldSet[]) => void; errors: Errors;
  options: Options; names: Record<string, string>; onName: (id: string, name: string) => void; empty: string;
}) {
  const usable = fields.filter((f) => OUTCOME_TYPES.has(f.type) && !f.readOnly);
  const set = (i: number, patch: Partial<FieldSet>) => onChange(sets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="wf-conditions">
      {sets.length === 0 && <p className="muted wf-small">{empty}</p>}
      {sets.map((s, i) => {
        const f = usable.find((x) => x.name === s.field);
        return (
          <div key={i} className="wf-condition">
            <span className="wf-condition-word" aria-hidden="true">Set</span>
            <Select label="Field" value={s.field} options={usable.filter((x) => x.name === s.field || !sets.some((o) => o.field === x.name)).map((x) => ({ value: x.name, label: x.label }))}
              onChange={(v) => set(i, { field: v, value: null })} />
            {f && <ValueControl field={f} value={s.value} onChange={(v) => set(i, { value: v })} options={options} names={names} onName={onName} label="To" outcome />}
            <IconButton icon="trash" variant="ghost" label={`Remove ${f?.label ?? 'this field'}`} onClick={() => onChange(sets.filter((_, j) => j !== i))} />
            {errors[`${prefix}.${i}`] && <p className="field-error wf-row-error" role="alert">{errors[`${prefix}.${i}`]}</p>}
          </div>
        );
      })}
      <Button size="sm" variant="ghost" icon="plus" disabled={!usable.length || sets.length >= usable.length} onClick={() => {
        const next = usable.find((x) => !sets.some((o) => o.field === x.name));
        if (next) onChange([...sets, { field: next.name, value: null }]);
      }}>
        Add a field to set
      </Button>
    </div>
  );
}

/* ---------- one step ---------- */

const KINDS: Option[] = [
  { value: 'users', label: 'Named people' },
  { value: 'role', label: 'Everyone with a role' },
  { value: 'field', label: 'A person on the record (owner, manager...)' },
  { value: 'department_head', label: 'The head of a department' },
  { value: 'people', label: 'Named people and roles together' },
  { value: 'permission', label: 'Everyone who holds a permission' },
];
const COUNTED = new Set(['users', 'role', 'people', 'permission']);

function StepEditor({ index, count, step, fields, options, errors, names, onName, onChange, onMove, onRemove, open, onToggle }: {
  index: number; count: number; step: StepDef; fields: OptionField[]; options: Options; errors: Errors; names: Record<string, string>;
  onName: (id: string, name: string) => void; onChange: (s: StepDef) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
  open: boolean; onToggle: () => void;
}) {
  const at = `steps.${index}`;
  const a = step.approvers;
  const userFields = fields.filter((f) => f.type === 'user');
  const deptFields = fields.filter((f) => ['user', 'text', 'lookup'].includes(f.type));
  const hasErrors = Object.keys(errors).some((k) => k.startsWith(`${at}.`));
  const setApprovers = (next: ApproverSpec) => onChange({ ...step, approvers: next, quorum: COUNTED.has(next.kind) ? step.quorum : 'any' });
  const dueDays = step.due_hours && step.due_hours % 24 === 0;
  const [unit, setUnit] = useState<'hours' | 'days'>(dueDays ? 'days' : 'hours');
  const shown = step.due_hours ? (unit === 'days' ? step.due_hours / 24 : step.due_hours) : null;
  const quorumOptions: Option[] = [
    { value: 'any', label: 'Any one of them' },
    { value: 'all', label: 'All of them' },
    ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of them` })),
  ];
  return (
    <section id={`wf-step-${index}`} className={`wf-step-card${hasErrors ? ' has-errors' : ''}`} aria-labelledby={`wf-step-${index}-title`}>
      <header className="wf-step-head">
        <span className="wf-flow-num" aria-hidden="true">{index + 1}</span>
        <button type="button" className="wf-step-toggle" aria-expanded={open} onClick={onToggle} id={`wf-step-${index}-title`}>
          {step.name || `Step ${index + 1}`}
          {hasErrors && <span className="wf-step-flag"> (check this step)</span>}
        </button>
        <span className="wf-step-tools">
          <IconButton icon="arrow-up" size="sm" variant="ghost" label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} />
          <IconButton icon="arrow-down" size="sm" variant="ghost" label={`Move step ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)} />
          <IconButton icon="trash" size="sm" variant="ghost" label={`Remove step ${index + 1}`} disabled={count === 1} onClick={onRemove} />
        </span>
      </header>
      {open && (
        <div className="wf-step-body">
          <div className="form-grid">
            <TextField label="Step name" required value={step.name} onChange={(v) => onChange({ ...step, name: v })} error={errors[`${at}.name`]} />
            <Select label="Who approves" required value={a.kind} options={KINDS} onChange={(v) => {
              if (v === 'users') setApprovers({ kind: 'users', users: [] });
              if (v === 'role') setApprovers({ kind: 'role', role: options.roles.find((r) => r.enabled)?.key ?? '' });
              if (v === 'field') setApprovers({ kind: 'field', field: userFields[0]?.name ?? '' });
              if (v === 'department_head') setApprovers({ kind: 'department_head', from: 'requester', field: null });
              if (v === 'people') setApprovers({ kind: 'people', users: [], roles: [] });
              if (v === 'permission') setApprovers({ kind: 'permission', permission: options.permissions?.[0] ?? '' });
            }} />
            <div className="form-cell-wide">
              {a.kind === 'users' && (
                <PeopleList label="Approvers" ids={a.users} names={names} onName={onName} onChange={(users) => setApprovers({ kind: 'users', users })}
                  error={errors[`${at}.approvers`]} hint="The person who asks is never one of the approvers, even when named here." />
              )}
              {a.kind === 'role' && (
                <Select label="Role" value={a.role} error={errors[`${at}.approvers`]} onChange={(role) => setApprovers({ kind: 'role', role })}
                  options={options.roles.map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))} />
              )}
              {a.kind === 'field' && (
                <Select label="Person field" value={a.field} error={errors[`${at}.approvers`]} onChange={(field) => setApprovers({ kind: 'field', field })}
                  options={userFields.map((f) => ({ value: f.name, label: f.label }))} hint="Whoever that field names when the step starts." />
              )}
              {a.kind === 'people' && (
                <div className="form-grid">
                  <PeopleList label="Approvers" ids={a.users} names={names} onName={onName} onChange={(users) => setApprovers({ ...a, users })}
                    error={errors[`${at}.approvers`]} hint="The person who asks is never one of the approvers, even when named here." />
                  <div>
                    {a.roles.length > 0 && (
                      <ul className="wf-chips" aria-label="Roles">
                        {a.roles.map((r) => (
                          <li key={r} className="wf-chip">
                            {options.roles.find((x) => x.key === r)?.name ?? r}
                            <IconButton icon="x" size="sm" variant="ghost" label={`Remove the role ${options.roles.find((x) => x.key === r)?.name ?? r}`} onClick={() => setApprovers({ ...a, roles: a.roles.filter((x) => x !== r) })} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <Select label={a.roles.length ? 'Add another role' : 'Add a role'} value="" onChange={(role) => role && !a.roles.includes(role) && setApprovers({ ...a, roles: [...a.roles, role] })}
                      options={[{ value: '', label: 'Choose a role' }, ...options.roles.filter((r) => !a.roles.includes(r.key)).map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))]} />
                  </div>
                </div>
              )}
              {a.kind === 'permission' && (
                <Select label="Permission" value={a.permission} error={errors[`${at}.approvers`]} onChange={(permission) => setApprovers({ kind: 'permission', permission })}
                  options={(options.permissions ?? []).map((p) => ({ value: p, label: p }))} hint="Everyone whose roles grant it (for example changes.approve)." />
              )}
              {a.kind === 'department_head' && (
                <div className="form-grid">
                  <Select label="Which department" value={a.from} onChange={(from) => setApprovers({ kind: 'department_head', from: from as 'requester' | 'field', field: from === 'field' ? deptFields[0]?.name ?? '' : null })}
                    options={[{ value: 'requester', label: "The requester's department" }, { value: 'field', label: 'The department a field names' }]}
                    hint="Department heads are set on the Department heads tab." />
                  {a.from === 'field' && (
                    <Select label="Field" value={a.field ?? ''} error={errors[`${at}.approvers`]} onChange={(field) => setApprovers({ kind: 'department_head', from: 'field', field })}
                      options={deptFields.map((f) => ({ value: f.name, label: f.label }))} hint="A department name, or a person whose department is used." />
                  )}
                </div>
              )}
            </div>
            {COUNTED.has(a.kind) && (
              <Select label="How many must approve" value={String(step.quorum)} options={quorumOptions} error={errors[`${at}.quorum`]}
                onChange={(v) => onChange({ ...step, quorum: v === 'any' || v === 'all' ? v : Number(v) })}
                hint="Any rejection rejects the whole request." />
            )}
          </div>
          <h4 className="wf-sub">When this step applies</h4>
          <ConditionRows prefix={`${at}.conditions`} conditions={step.conditions} fields={fields} errors={errors} options={options} names={names} onName={onName}
            onChange={(conditions) => onChange({ ...step, conditions })} intro="Always. Add a condition to skip this step for some records (for example, only when the cost is more than a set amount)." />
          <h4 className="wf-sub">Due time and escalation</h4>
          <div className="form-grid">
            <div className="wf-pair">
              <NumberField label="Due within" value={shown} min={1} onChange={(v) => onChange({ ...step, due_hours: v ? (unit === 'days' ? v * 24 : v) : null, escalate_to: v ? step.escalate_to : null })} error={errors[`${at}.due_hours`]} />
              <Select label="Unit" value={unit} options={[{ value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }]}
                onChange={(u) => { setUnit(u as 'hours' | 'days'); if (shown) onChange({ ...step, due_hours: u === 'days' ? shown * 24 : shown }); }} />
            </div>
            {step.due_hours ? (
              <Select label="Escalate to a role (optional)" value={step.escalate_to?.role ?? ''}
                options={[{ value: '', label: 'No role' }, ...options.roles.map((r) => ({ value: r.key, label: r.name }))]}
                onChange={(role) => onChange({ ...step, escalate_to: { users: step.escalate_to?.users ?? [], role: role || null } })} />
            ) : <p className="muted wf-small wf-due-hint">Leave empty for no due time. When a step is overdue its approvers are reminded, and the people it escalates to are told and may decide too.</p>}
            {step.due_hours ? (
              <div className="form-cell-wide">
                <PeopleList label="Escalate to these people (optional)" ids={step.escalate_to?.users ?? []} names={names} onName={onName} error={errors[`${at}.escalate_to`]}
                  onChange={(users) => onChange({ ...step, escalate_to: users.length || step.escalate_to?.role ? { users, role: step.escalate_to?.role ?? null } : null })} />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- the page ---------- */

export function WorkflowEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const options = useFetch<Options>('/api/workflows/options');
  const existing = useFetch<Definition>(isNew ? null : `/api/workflows/definitions/${id}`);
  const [def, setDef] = useState<Definition | null>(isNew ? blank() : null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number>(0);
  const [removing, setRemoving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (existing.data && !def) {
      setDef(existing.data);
      setNames(existing.data.people ?? {});
    }
  }, [existing.data, def]);

  const type = options.data?.types.find((t) => t.type === def?.record_type);
  const fields = type?.fields ?? [];
  const labels = useMemo(() => makeLabels(options.data, def?.record_type ?? '', names), [options.data, def?.record_type, names]);
  const onName = (pid: string, name: string) => setNames((n) => (n[pid] === name ? n : { ...n, [pid]: name }));

  if (options.error) return <ErrorState title="Workflow options could not be loaded" error={options.error} onRetry={options.reload} />;
  if (existing.error) {
    return existing.error instanceof ApiError && existing.error.status === 404
      ? <EmptyState icon="alert" title="Workflow not found" message="It may have been removed." action={<Button onClick={() => navigate('/admin/workflows')}>Back to approval workflows</Button>} />
      : <ErrorState title="This workflow could not be loaded" error={existing.error} onRetry={existing.reload} />;
  }
  if (!options.data || !def) return <Loading label="Loading workflow" lines={8} />;
  const opts = options.data;
  const update = (patch: Partial<Definition>) => setDef({ ...def, ...patch });
  const setStep = (i: number, s: StepDef) => update({ steps: def.steps.map((x, j) => (j === i ? s : x)) });
  const statusFields = fields.filter((f) => f.type === 'lookup');
  // Approval kinds: a module (change approval, risk acceptance...) starts the workflow itself.
  const kindsHere = (opts.kinds ?? []).filter((k) => k.record_type === def.record_type);
  const kind = (opts.kinds ?? []).find((k) => k.key === def.kind);

  async function save() {
    if (!def) return;
    setBusy(true);
    setErrors({});
    try {
      const body = { ...def };
      const saved = isNew
        ? await api.post<Definition>('/api/workflows/definitions', body)
        : await api.patch<Definition>(`/api/workflows/definitions/${id}`, body);
      toast.success(isNew ? 'Workflow created.' : 'Workflow saved. Workflows already running keep the version they started with.');
      setDef(saved);
      if (isNew) navigate(`/admin/workflows/${saved.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        const firstStep = Object.keys(err.fields).map((k) => /^steps\.(\d+)\./.exec(k)?.[1]).find((x) => x !== undefined);
        if (firstStep !== undefined) setOpen(Number(firstStep));
        setTimeout(() => errorRef.current?.focus(), 0);
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/api/workflows/definitions/${id}`);
      toast.success('Workflow removed. Any still running finish as they are.');
      navigate('/admin/workflows');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  const errorCount = Object.keys(errors).length;
  const select = (i: number) => {
    setOpen(i);
    setTimeout(() => document.getElementById(`wf-step-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return (
    <div className="wf-page">
      <PageHeader
        title={isNew ? 'New approval workflow' : def.name || 'Approval workflow'}
        subtitle={isNew ? 'Ordered approval steps for one kind of record.' : `${def.record_type_label ?? ''}${def.version ? ` · version ${def.version}` : ''}${def.running ? ` · ${def.running} running` : ''}`}
        breadcrumbs={[{ label: 'Approval workflows', to: '/admin/workflows' }, { label: isNew ? 'New' : def.name }]}
        actions={(
          <>
            {!isNew && <Button variant="ghost" icon="trash" onClick={() => setRemoving(true)}>Remove</Button>}
            <Button variant="primary" loading={busy} onClick={() => void save()}>{isNew ? 'Create workflow' : 'Save changes'}</Button>
          </>
        )}
      />
      {errorCount > 0 && (
        <div className="notice notice-warn" role="alert" tabIndex={-1} ref={errorRef}>
          Check the highlighted {errorCount === 1 ? 'field' : `${errorCount} fields`}{errors.steps ? `: ${errors.steps}` : '.'}
        </div>
      )}
      {def.available === false && <div className="notice notice-warn">This record type is switched off (Administration &gt; Features), so this workflow does nothing until it is back on.</div>}
      <div className="wf-editor">
        <div className="wf-editor-form">
          <Card title="What it is for">
            <div className="form-grid">
              <TextField label="Name" required value={def.name} onChange={(v) => update({ name: v })} error={errors.name} placeholder="For example: Purchase over budget" />
              <Select label="Record type" required value={def.record_type} error={errors.record_type} disabled={Boolean(def.kind && !isNew)}
                options={opts.types.map((t) => ({ value: t.type, label: t.plural }))}
                onChange={(v) => update({ record_type: v, conditions: [], on_approve: [], on_reject: [], trigger_field: null, trigger_value: null,
                  steps: def.steps.map((s) => ({ ...s, conditions: [], approvers: s.approvers.kind === 'field' || s.approvers.kind === 'department_head' ? { kind: 'users', users: [] } : s.approvers })) })}
                hint={isNew ? undefined : 'Changing it clears the conditions and fields that belonged to the old type.'} />
              <div className="form-cell-wide">
                <TextArea label="Description (optional)" value={def.description ?? ''} onChange={(v) => update({ description: v || null })} rows={2}
                  hint="Shown to people when they ask for this approval." />
              </div>
              <Switch label="Active" checked={def.active} onChange={(on) => update({ active: on })} hint="An inactive workflow starts nothing; running ones carry on." />
            </div>
          </Card>

          <Card title="What starts it">
            {!def.record_type ? <p className="muted">Choose a record type first.</p> : (
              <>
                {isNew && kindsHere.length > 0 && (
                  <div className="form-grid">
                    <Select label="Used for" value={def.kind ?? ''} error={errors.kind}
                      options={[{ value: '', label: 'Its own approval (asked by hand, on creation or on a field change)' }, ...kindsHere.map((k) => ({ value: k.key, label: k.label }))]}
                      onChange={(v) => update({ kind: v || null, trigger: v ? 'module' : 'manual', trigger_field: null, trigger_value: null })}
                      hint="A module's own approval (for example change approval) is started by that module. This cannot be changed later." />
                  </div>
                )}
                {def.kind ? (
                  <div className="wf-kind-note" role="note">
                    <p><strong>{kind?.label ?? def.kind_label ?? 'Module approval'}.</strong> {kind?.starts_when ?? def.kind_starts_when ?? 'Started by its module.'}</p>
                    {(kind?.outcome ?? def.kind_outcome) && <p className="muted wf-small">{kind?.outcome ?? def.kind_outcome}</p>}
                    {kind?.approver_permission && <p className="muted wf-small">Approvers must also hold {kind.approver_permission}.</p>}
                  </div>
                ) : (
                <div className="form-grid">
                  <Select label="Starts" required value={def.trigger} error={errors.trigger}
                    options={[
                      { value: 'manual', label: 'When someone asks for approval on the record' },
                      { value: 'create', label: 'When a record is created' },
                      { value: 'status', label: 'When a field changes to a value' },
                    ]}
                    onChange={(v) => update({ trigger: v as Definition['trigger'], trigger_field: v === 'status' ? def.trigger_field ?? (statusFields.find((f) => f.name === 'status')?.name ?? statusFields[0]?.name ?? null) : null, trigger_value: v === 'status' ? def.trigger_value : null })} />
                  {def.trigger === 'status' && (
                    <>
                      <Select label="Field" value={def.trigger_field ?? ''} error={errors.trigger_field} options={statusFields.map((f) => ({ value: f.name, label: f.label }))}
                        onChange={(v) => update({ trigger_field: v, trigger_value: null })} />
                      {def.trigger_field && (
                        <Select label="Changes to" value={def.trigger_value ?? ''} error={errors.trigger_value}
                          options={(opts.lookups[fields.find((f) => f.name === def.trigger_field)?.list ?? ''] ?? []).map((o) => ({ value: o.value, label: o.label, color: o.color ?? undefined }))}
                          onChange={(v) => update({ trigger_value: v })} />
                      )}
                    </>
                  )}
                </div>
                )}
                {!def.kind && <p className="muted wf-small">Anyone who may edit the record can also ask for any active workflow by hand from the record page.</p>}
                <h4 className="wf-sub">Which records</h4>
                <ConditionRows prefix="conditions" conditions={def.conditions} fields={fields} errors={errors} options={opts} names={names} onName={onName}
                  onChange={(conditions) => update({ conditions })} intro={def.kind ? 'Every record its module asks about. With conditions, the workflow of this kind whose conditions hold (the one with the most conditions) is chosen.' : 'Every record of this type. Add a condition to start it only for some (for example, priority is high).'} />
              </>
            )}
          </Card>

          <Card title="Approval steps" actions={(
            <Button size="sm" icon="plus" disabled={def.steps.length >= 10} onClick={() => { update({ steps: [...def.steps, blankStep(def.steps.length + 1)] }); setOpen(def.steps.length); }}>Add a step</Button>
          )}>
            <p className="muted wf-small">Steps run in order. Each waits for its approvals before the next starts; one rejection ends the request.</p>
            {errors.steps && <p className="field-error" role="alert">{errors.steps}</p>}
            <div className="wf-steps">
              {def.steps.map((s, i) => (
                <StepEditor key={i} index={i} count={def.steps.length} step={s} fields={fields} options={opts} errors={errors} names={names} onName={onName}
                  open={open === i} onToggle={() => setOpen(open === i ? -1 : i)}
                  onChange={(next) => setStep(i, next)}
                  onMove={(by) => {
                    const steps = [...def.steps];
                    [steps[i], steps[i + by]] = [steps[i + by], steps[i]];
                    update({ steps });
                    setOpen(i + by);
                  }}
                  onRemove={() => { update({ steps: def.steps.filter((_, j) => j !== i) }); setOpen(-1); }}
                />
              ))}
            </div>
          </Card>

          <Card title="At the end">
            {!def.record_type ? <p className="muted">Choose a record type first.</p> : (
              <div className="wf-outcomes">
                <div>
                  <h4 className="wf-sub wf-sub-approved">When approved</h4>
                  <OutcomeRows prefix="on_approve" sets={def.on_approve} fields={fields} errors={errors} options={opts} names={names} onName={onName}
                    onChange={(on_approve) => update({ on_approve })} empty="Nothing on the record changes; the approval is recorded on its history." />
                </div>
                <div>
                  <h4 className="wf-sub wf-sub-rejected">When rejected</h4>
                  <OutcomeRows prefix="on_reject" sets={def.on_reject} fields={fields} errors={errors} options={opts} names={names} onName={onName}
                    onChange={(on_reject) => update({ on_reject })} empty="Nothing on the record changes; the rejection and its reason are recorded." />
                </div>
              </div>
            )}
          </Card>
        </div>
        <aside className="wf-editor-aside" aria-label="How it runs">
          <Card title="How it runs">
            <FlowDiagram def={def} labels={labels} selected={open} onSelect={select} />
          </Card>
        </aside>
      </div>
      <ConfirmDialog
        open={removing}
        title="Remove this workflow?"
        message="It will no longer start. Workflows already running on records finish as they are, and their history is kept."
        confirmLabel="Remove workflow"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
    </div>
  );
}
