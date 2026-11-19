import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Group, Pill, Progress, Stack, Stepper as Steps, Text } from '@mantine/core';
import {
  api, ApiError, Button, Card, Checkbox, DateField, EmptyState, errorMessage, ErrorState, formatCurrency, formatDate, Icon, Loading,
  NumberField, PageHeader, RecordPicker, Select, StatusChip, TextArea, TextField, toColorName, useFetch, useToast,
} from '../../core';
import { currencySymbol } from './bits';
import type { Intake, MyRequest } from './types';

const BLANK = {
  name: '', description: '', expected_benefits: '', sponsor: '', department: '', funding_source: '', target_on: '',
  touches_payment: false, touches_personal_data: false, touches_operational_systems: false,
};

/** The tier the rules would give, so the requester knows what to expect before submitting. */
function likelyTier(budget: number | null, touches: boolean, t: Intake['tiers']): { label: string; why: string } {
  if (touches) return { label: 'Tier 1', why: 'it touches payment, personal data or operational systems' };
  const b = budget ?? 0;
  if (b > t.tier1Above) return { label: 'Tier 1', why: `the budget is over ${formatCurrency(t.tier1Above)}` };
  if (b >= t.tier3Below) return { label: 'Tier 2', why: `the budget is between ${formatCurrency(t.tier3Below)} and ${formatCurrency(t.tier1Above)}` };
  return { label: 'Tier 3', why: `the budget is under ${formatCurrency(t.tier3Below)}` };
}

function Requests({ rows, canOpen }: { rows: MyRequest[]; canOpen: boolean }) {
  if (!rows.length) return <Text size="sm" c="dimmed">Requests you submit appear here, with how far each has got.</Text>;
  return (
    <ul className="prj-requests">
      {rows.map((r) => (
        <li key={r.id}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" fw={600} truncate>
              {canOpen ? <Link to={`/projects/${r.id}`}>{r.name}</Link> : r.name}
            </Text>
            <StatusChip color={toColorName(r.status_color)} label={r.status_label} />
          </Group>
          <Text size="xs" c="dimmed"><span className="ref">{r.ref}</span> · submitted {formatDate(r.created_at)}</Text>
          <Progress value={((r.stage_index + 1) / Math.max(1, r.stage_count)) * 100} size="xs" radius="xl" mt={6} aria-label={`Stage ${r.stage_index + 1} of ${r.stage_count}: ${r.stage_label}`} />
          <Text size="xs" c="dimmed" mt={4}>
            Stage {r.stage_index + 1} of {r.stage_count}: <strong>{r.stage_label}</strong>
            {r.gate_name ? ` · waiting at ${r.gate_name} (${r.gate_checked ?? 0} of ${r.gate_total ?? 0} checks done)` : ''}
          </Text>
        </li>
      ))}
    </ul>
  );
}

/** The one-page project request. A new request joins the portfolio at the Idea stage. */
export function IntakeForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useFetch<Intake>('/api/projects/intake');
  const [form, setForm] = useState(BLANK);
  const [budget, setBudget] = useState<number | null>(null);
  const [systems, setSystems] = useState<{ id: string; label: string }[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ ref: string; name: string } | null>(null);
  const set = <K extends keyof typeof BLANK>(key: K) => (value: (typeof BLANK)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const header = (
    <PageHeader
      title="New project request"
      subtitle="One page is enough to start. Say what is needed and why; the detail comes later."
      breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: 'New request' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;

  const touches = form.touches_payment || form.touches_personal_data || form.touches_operational_systems;
  const tier = likelyTier(budget, touches, data.tiers);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setFields({ name: 'Give the request a name.' }); setFormError(''); return; }
    setFields({});
    setFormError('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...form, budget, systems_affected: systems.map((s) => s.id) };
      for (const k of Object.keys(body)) if (body[k] === '' || body[k] === null) delete body[k];
      if (!systems.length) delete body.systems_affected;
      const row = await api.post<{ id: string; ref: string; name: string; can_open: boolean }>('/api/projects/requests', body);
      toast.success(`Request ${row.ref} submitted.`);
      if (row.can_open) { navigate(`/projects/${row.id}`); return; }
      setSent({ ref: row.ref, name: row.name });
      setForm(BLANK); setBudget(null); setSystems([]);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {header}
      <div className="prj-intake">
        <Card>
          {!data.allowed ? (
            <EmptyState
              icon="lock"
              title="You cannot submit project requests"
              message="Project requests are open to a limited group here. Ask a project manager or an administrator to submit it for you, or to open requests to more people in Project settings."
            />
          ) : (
            <form className="form" onSubmit={submit} noValidate>
              {sent && (
                <Alert color="green" variant="light" icon={<Icon name="check-circle" />} title={`Request ${sent.ref} submitted`} withCloseButton onClose={() => setSent(null)}>
                  "{sent.name}" has joined the portfolio as an idea. Follow it under Your requests.
                </Alert>
              )}
              <TextField label="Name" required value={form.name} onChange={set('name')} error={fields.name} placeholder="A short name people will recognise" autoFocus />
              <TextArea label="What is needed and why" rows={3} value={form.description} onChange={set('description')} error={fields.description} hint="The problem, who has it and what happens if nothing is done" />
              <TextArea label="Expected benefits" rows={2} value={form.expected_benefits} onChange={set('expected_benefits')} error={fields.expected_benefits} hint="What will be better afterwards" />
              <div className="form-grid">
                <TextField label="Sponsor" value={form.sponsor} onChange={set('sponsor')} error={fields.sponsor} hint="Who is asking for it" />
                <TextField label="Department" value={form.department} onChange={set('department')} error={fields.department} />
                <NumberField label="Budget" prefix={currencySymbol()} thousands min={0} step={1000} value={budget} onChange={setBudget} error={fields.budget} hint="A rough estimate is fine" />
                <Select label="Funding source" value={form.funding_source} onChange={set('funding_source')} options={data.funding_sources} error={fields.funding_source} placeholder="Not known yet" />
                <DateField label="Target date" value={form.target_on} onChange={set('target_on')} error={fields.target_on} hint="When it is needed by" />
              </div>

              <fieldset className="prj-fieldset">
                <legend>Does it touch any of these?</legend>
                <Stack gap={8}>
                  <Checkbox label="Touches payment" hint="Takes, moves or records payments" checked={form.touches_payment} onChange={set('touches_payment')} />
                  <Checkbox label="Touches personal data" hint="Holds or uses information about people" checked={form.touches_personal_data} onChange={set('touches_personal_data')} />
                  <Checkbox label="Touches operational systems" hint="Changes a system the daily service depends on" checked={form.touches_operational_systems} onChange={set('touches_operational_systems')} />
                </Stack>
              </fieldset>

              {data.systems_available && (
                <div>
                  <RecordPicker
                    label="Systems affected"
                    type="system"
                    value={null}
                    placeholder="Search the system inventory"
                    error={fields.systems_affected}
                    hint="Optional: existing systems this would change, replace or depend on"
                    onChange={(id, option) => { if (id && !systems.some((s) => s.id === id)) setSystems((list) => [...list, { id, label: option?.label ?? 'System' }]); }}
                  />
                  {systems.length > 0 && (
                    <Pill.Group mt={8}>
                      {systems.map((s) => (
                        <Pill key={s.id} withRemoveButton onRemove={() => setSystems((list) => list.filter((x) => x.id !== s.id))}>{s.label}</Pill>
                      ))}
                    </Pill.Group>
                  )}
                </div>
              )}

              <Alert color="blue" variant="light" icon={<Icon name="info" />} title={`This looks like ${tier.label}`}>
                Because {tier.why}. The tier decides who approves each gate; it is worked out again whenever the project is saved.
              </Alert>

              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="form-actions">
                <Button onClick={() => navigate(data.can_open ? '/projects' : '/')}>Cancel</Button>
                <Button type="submit" variant="primary" loading={busy}>Submit request</Button>
              </div>
            </form>
          )}
        </Card>

        <Stack gap="md">
          <Card title="What happens next">
            <Steps active={0} orientation="vertical" size="sm" iconSize={28} allowNextStepsSelect={false}>
              <Steps.Step label="You submit the request" description="It gets a reference and joins the portfolio as an idea." />
              <Steps.Step label="Intake approval" description="The project team checks it against a short list and an approver decides." />
              <Steps.Step label="It becomes a project" description="A manager is assigned and it moves through the stages, gate by gate." />
            </Steps>
          </Card>
          <Card title="How the tier is set">
            <ul className="prj-plainlist">
              <li><strong>Tier 3:</strong> budget under {formatCurrency(data.tiers.tier3Below)}.</li>
              <li><strong>Tier 2:</strong> budget from {formatCurrency(data.tiers.tier3Below)} to {formatCurrency(data.tiers.tier1Above)}.</li>
              <li><strong>Tier 1:</strong> budget over {formatCurrency(data.tiers.tier1Above)}, or anything that touches payment, personal data or operational systems.</li>
            </ul>
          </Card>
          <Card title="Your requests">
            <Requests rows={data.requests} canOpen={data.can_open} />
          </Card>
        </Stack>
      </div>
    </div>
  );
}
