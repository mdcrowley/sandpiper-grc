import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, Checkbox, errorMessage, IconButton, NumberField, Select, TextField, useLookup, useToast,
} from '../../core';
import { ANY, type ApprovalRule, type ChangeSettings } from './types';

type Line = Omit<ApprovalRule, 'approver_roles'> & { roles: string };

/** Approval rules: how many approvals each type and risk of change needs, and from whom. */
export function RulesAdmin({ settings, onSaved }: { settings: ChangeSettings; onSaved: () => void }) {
  const toast = useToast();
  const types = useLookup('change_type');
  const risks = useLookup('change_risk');
  const [lines, setLines] = useState<Line[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLines(settings.approval_rules.map(({ approver_roles, ...r }) => ({ ...r, roles: approver_roles.join(', ') })));
  }, [settings]);

  const set = (i: number, patch: Partial<Line>) => setLines((list) => list.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function save() {
    setBusy(true);
    setFields({});
    try {
      const res = await api.patch<ChangeSettings>('/api/changes/settings', {
        approval_rules: lines.map(({ roles, ...l }) => ({ ...l, approver_roles: roles.split(',').map((r) => r.trim()).filter(Boolean) })),
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
        {lines.map((l, i) => (
          <div key={i} className="chg-rule">
            <Select label="Change type" value={l.change_type} onChange={(change_type) => set(i, { change_type })} options={[...types, { value: ANY, label: 'Any type' }]} error={f(i, 'change_type')} />
            <Select label="Risk" value={l.risk_level} onChange={(risk_level) => set(i, { risk_level: risk_level || ANY })} options={[{ value: ANY, label: 'Any risk' }, ...risks]} error={f(i, 'risk_level')} />
            <NumberField label="Approvals" min={0} max={5} step={1} value={l.approvals} onChange={(n) => set(i, { approvals: n ?? 0 })} error={f(i, 'approvals')} />
            <TextField className="chg-rule-roles" label="Approver roles" value={l.roles} onChange={(roles) => set(i, { roles })} placeholder="For example Change manager, Service owner" />
            <div className="chg-rule-flags">
              <Checkbox label="Review required" hint="A post-implementation review before closure." checked={l.pir_required || l.change_type === 'emergency'} disabled={l.change_type === 'emergency'} onChange={(pir_required) => set(i, { pir_required })} />
              <Checkbox label="Approval may follow the work" hint="Work may start unapproved; the approval is flagged." checked={l.retrospective} onChange={(retrospective) => set(i, { retrospective })} />
            </div>
            <IconButton icon="trash" variant="ghost" label="Remove this rule" onClick={() => setLines((list) => list.filter((_, n) => n !== i))} />
          </div>
        ))}
        {fields.approval_rules && <p className="form-error" role="alert">{fields.approval_rules}</p>}
        <div className="form-actions">
          <Button icon="plus" onClick={() => setLines((list) => [...list, { change_type: 'normal', risk_level: ANY, approvals: 1, roles: '', pir_required: false, retrospective: false }])}>Add rule</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>Save rules</Button>
        </div>
      </div>
    </Card>
  );
}
