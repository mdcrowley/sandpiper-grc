import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Checkbox, errorMessage, Icon, IconButton, MultiSelect, NumberField, Select, TextField, UserPicker,
  useAuth, useLookup, useToast,
} from '../../core';
import { ANY, type ApprovalRule, type ChangeSettings } from './types';

type Line = Omit<ApprovalRule, 'approver_roles' | 'approver_user_ids'> & { roles: string; users: { id: string; label: string }[] };

/** Who decides under one rule: named people and roles. With neither, anyone with the approve permission may. */
function WhoApproves({ line, roles, onChange, errors }: {
  line: Line; roles: { key: string; name: string }[]; onChange: (patch: Partial<Line>) => void; errors: { users?: string; roles?: string };
}) {
  return (
    <div className="chg-rule-who">
      <div className="stack">
        <UserPicker label="Named approvers" value={null} placeholder="Add a person" error={errors.users}
          onChange={(id, option) => { if (id && !line.users.some((u) => u.id === id)) onChange({ users: [...line.users, { id, label: option?.label ?? 'User' }] }); }} />
        {line.users.length > 0 && (
          <span className="row">
            {line.users.map((u) => (
              <span key={u.id} className="chip chip-blue chg-chip">
                {u.label}
                <button type="button" className="chg-chip-x" aria-label={`Remove ${u.label}`} onClick={() => onChange({ users: line.users.filter((x) => x.id !== u.id) })}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="stack">
        <MultiSelect label={line.approver_role_keys?.length ? `Approving roles (${line.approver_role_keys.length})` : 'Approving roles'}
          value={line.approver_role_keys ?? []} options={roles.map((r) => ({ value: r.key, label: r.name }))}
          onChange={(keys) => onChange({ approver_role_keys: keys })} />
        {errors.roles && <p className="field-error">{errors.roles}</p>}
        <p className="muted chg-rule-hint">
          {line.users.length || line.approver_role_keys?.length
            ? `Only ${[...line.users.map((u) => u.label), ...(line.approver_role_keys ?? []).map((k) => `members of ${roles.find((r) => r.key === k)?.name ?? k}`)].join(', ')} can approve; each is asked and records their own decision.`
            : 'Nobody named: anyone with the Approve permission on Changes can approve.'}
        </p>
      </div>
    </div>
  );
}

/** Approval rules: how many approvals each type and risk of change needs, and from whom. */
export function RulesAdmin({ settings, onSaved }: { settings: ChangeSettings; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const types = useLookup('change_type');
  const risks = useLookup('change_risk');
  const [lines, setLines] = useState<Line[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLines(settings.approval_rules.map(({ approver_roles, approver_user_ids, ...r }) => ({
      ...r, roles: approver_roles.join(', '),
      users: (approver_user_ids ?? []).map((id) => ({ id, label: settings.user_names?.[id] ?? 'Unknown user' })),
    })));
  }, [settings]);

  const set = (i: number, patch: Partial<Line>) => setLines((list) => list.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function save() {
    setBusy(true);
    setFields({});
    try {
      const res = await api.patch<ChangeSettings>('/api/changes/settings', {
        approval_rules: lines.map(({ roles, users, ...l }) => ({
          ...l, approver_roles: roles.split(',').map((r) => r.trim()).filter(Boolean), approver_user_ids: users.map((u) => u.id),
        })),
      });
      toast.success(res.recalculated ? `Saved. ${res.recalculated} draft ${res.recalculated === 1 ? 'change was' : 'changes were'} updated.` : 'Saved.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const f = (i: number, name: string) => fields[`approval_rules.${i}.${name}`];
  return (
    <Card title="Approval rules">
      <div className="form">
        <p className="muted">
          The rule for a change's type and risk level says how many different people must approve it before it can be scheduled or started.
          A rule for a named risk level wins over a rule for any risk. A standard change raised from a template never needs approval, and
          an emergency change proceeds with one approver and always needs a post-implementation review.
          Saving applies the rules to drafts at once; changes already submitted keep the approvals they were given.
        </p>
        <p className="muted">
          Each rule that asks for approval runs an approval workflow: the approvals and approvers here are its first step. Add further steps,
          due times and escalation to it under Administration &gt; Approval workflows. Approvers decide on the Approvals page.
        </p>
        {lines.map((l, i) => (
          <div key={i} className="chg-rule">
            <Select label="Change type" value={l.change_type} onChange={(change_type) => set(i, { change_type })} options={[...types, { value: ANY, label: 'Any type' }]} error={f(i, 'change_type')} />
            <Select label="Risk" value={l.risk_level} onChange={(risk_level) => set(i, { risk_level: risk_level || ANY })} options={[{ value: ANY, label: 'Any risk' }, ...risks]} error={f(i, 'risk_level')} />
            <NumberField label="Approvals" min={0} max={5} step={1} value={l.approvals} onChange={(n) => set(i, { approvals: n ?? 0 })} error={f(i, 'approvals')} />
            <TextField className="chg-rule-roles" label="Approver titles" value={l.roles} onChange={(roles) => set(i, { roles })} placeholder="For example Change manager, Service owner"
              hint="Shown to people; does not limit who approves." />
            <WhoApproves line={l} roles={settings.roles ?? []} onChange={(patch) => set(i, patch)}
              errors={{ users: f(i, 'approver_user_ids'), roles: f(i, 'approver_role_keys') }} />
            <div className="chg-rule-flags">
              <Checkbox label="Review required" hint="A post-implementation review before closure." checked={l.pir_required || l.change_type === 'emergency'} disabled={l.change_type === 'emergency'} onChange={(pir_required) => set(i, { pir_required })} />
              <Checkbox label="Approval may follow the work" hint="Work may start unapproved; the approval is flagged." checked={l.retrospective} onChange={(retrospective) => set(i, { retrospective })} />
            </div>
            {l.approvals > 0 && l.workflow_id && (
              <p className="muted chg-rule-hint">
                Workflow: {can('admin.administer') ? <Link to={`/admin/workflows/${l.workflow_id}`}>{l.workflow_name ?? 'open'}</Link> : l.workflow_name}
              </p>
            )}
            <IconButton icon="trash" variant="ghost" label="Remove this rule" onClick={() => setLines((list) => list.filter((_, n) => n !== i))} />
          </div>
        ))}
        {fields.approval_rules && <p className="form-error" role="alert">{fields.approval_rules}</p>}
        <div className="form-actions">
          <Button icon="plus" onClick={() => setLines((list) => [...list, { change_type: 'normal', risk_level: ANY, approvals: 1, roles: '', users: [], pir_required: false, retrospective: false }])}>Add rule</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>Save rules</Button>
        </div>
      </div>
    </Card>
  );
}
