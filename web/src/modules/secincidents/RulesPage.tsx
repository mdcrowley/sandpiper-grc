import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, Icon, PageHeader, Select, StatusChip, Tabs, toColorName, useAuth, useFetch, useLookup, useMeta } from '../../core';
import { EditableTable } from './EditableTable';
import { useLifecycle } from './shared';
import type { Questions, Rule } from './types';
import { deadlineText } from './types';

const COLOURS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'].map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));
const options = (list: { value: string; label: string }[]) => list.map((x) => ({ value: x.value, label: x.label }));
const muted = (r: { active: boolean }) => (r.active ? undefined : 'si-row-off');

function RulesTab({ admin }: { admin: boolean }) {
  const [version, setVersion] = useState(0);
  const triggers = useFetch<Questions>('/api/security-incidents/questions').data?.triggers ?? [];
  const rules = useFetch<Rule[]>(`/api/security-notification-rules?v=${version}`, { keepPrevious: true }).data;
  const off = rules?.filter((r) => !r.active).length ?? 0;
  const waiting = rules?.filter((r) => !r.active && r.deadline_hours === null).length ?? 0;
  return (
    <div className="stack">
      {rules && off > 0 && (
        <div className="si-callout" role="note">
          <Icon name="info" size={20} />
          <div>
            <strong>
              {off === rules.length ? 'No rule is active yet, so declaring an incident starts no clocks.' : `${off} of ${rules.length} rules are switched off and start no clock.`}
            </strong>
            <p>
              A rule stays inactive until you set a deadline{waiting ? ` (${waiting} ${waiting === 1 ? 'has' : 'have'} none)` : ''}. This is deliberate: who must be told, and how quickly, depends on
              the law where you operate, your contracts and your insurance, and a wrong deadline is worse than none.{' '}
              {admin
                ? 'With legal advice, edit each rule that applies to you, enter its deadline in hours from discovery and tick Active.'
                : 'An administrator sets the deadlines, with legal advice.'}
            </p>
          </div>
        </div>
      )}
      <EditableTable url="/api/security-notification-rules" noun="Notification rule" canEdit={admin} onChanged={() => setVersion((n) => n + 1)}
        intro="When an incident is declared, each active rule whose trigger applies starts a clock counted from the discovery time. Changes apply to open incidents straight away."
        emptyIcon="clock" emptyTitle="No notification rules" emptyMessage="Without rules, declaring an incident starts no clocks."
        rowClass={muted}
        columns={[
          {
            field: 'party', label: 'Notify', required: true,
            render: (r: Rule) => (
              <span className="si-cell-stack">
                <strong>{r.party}</strong>
                <Badge color={r.required ? 'blue' : 'gray'}>{r.required ? 'Required' : 'Recommended'}</Badge>
              </span>
            ),
          },
          {
            field: 'trigger_attribute', label: 'Trigger', type: 'select', options: options(triggers), required: true,
            render: (r: Rule) => triggers.find((x) => x.value === r.trigger_attribute)?.label ?? r.trigger_attribute,
          },
          {
            field: 'deadline_hours', label: 'Deadline from discovery', header: 'Deadline', type: 'number', hint: 'In hours: 24, 72 (3 days), 168 (7 days), 720 (30 days); 0 = immediately',
            render: (r: Rule) => (r.deadline_hours === null ? <span className="si-unset">Not set</span> : deadlineText(r.deadline_hours)),
          },
          {
            field: 'required', label: 'Required by law or contract', type: 'boolean', initial: true, hint: 'Untick for a recommended notification', formOnly: true,
          },
          {
            field: 'active', label: 'Active', header: 'State', type: 'boolean', initial: true, hint: 'A rule cannot be active without a deadline',
            render: (r: Rule) => <StatusChip color={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : r.deadline_hours === null ? 'Off: no deadline' : 'Switched off'} />,
          },
          { field: 'guidance', label: 'Guidance', type: 'longtext', formOnly: true, hint: 'How to report, what to have ready and where the requirement comes from' },
        ]} />
    </div>
  );
}

function KindsTab({ admin }: { admin: boolean }) {
  const meta = useMeta();
  return (
    <EditableTable url="/api/security-incidents/lists/kinds" noun="Kind of data" canEdit={admin} onChanged={meta.reload}
      intro="Each kind of data your organisation holds becomes a yes/no question when an incident is declared, and can trigger notification rules. Personal information is built in."
      emptyIcon="database" emptyTitle="No kinds of data" emptyMessage="Add the kinds of data whose loss would mean telling someone."
      removeLabel="Retire" removeMessage="It is no longer asked about on new incidents. Incidents that already carry it keep it."
      canRemoveRow={(r) => r.active} rowClass={muted}
      columns={[
        { field: 'label', label: 'Name', required: true, hint: 'For example: Research records', render: (r) => <strong>{r.label}</strong> },
        { field: 'question', label: 'Question asked', render: (r) => `Could ${String(r.label).charAt(0).toLowerCase()}${String(r.label).slice(1)} be involved?`, tableOnly: true },
        { field: 'hint', label: 'Explanation', type: 'longtext', hint: 'Shown under the question, to help people answer it' },
        { field: 'sort', label: 'Order', type: 'number', formOnly: true, hint: 'Lower numbers come first' },
        {
          field: 'active', label: 'In use', type: 'boolean', initial: true, editOnly: true,
          render: (r) => <StatusChip color={r.active ? 'green' : 'gray'} label={r.active ? 'In use' : 'Retired'} />,
        },
      ]} />
  );
}

function StatusesTab({ admin }: { admin: boolean }) {
  const meta = useMeta();
  const life = useLifecycle();
  const stages = life.data?.stages ?? [];
  return (
    <EditableTable url="/api/security-incidents/lists/statuses" noun="Status" canEdit={admin} onChanged={() => { meta.reload(); life.reload(); }}
      intro="The steps an incident moves through, in order. What each status means decides what the application does when an incident reaches it: start the clocks, stamp containment, or close."
      emptyIcon="refresh" emptyTitle="No statuses"
      removeLabel="Retire" removeMessage="It is no longer offered. A status that an incident still holds cannot be retired."
      canRemoveRow={(r) => r.active} rowClass={muted}
      columns={[
        { field: 'label', label: 'Status', required: true, render: (r) => <StatusChip color={toColorName(r.color)} label={r.label} /> },
        {
          field: 'stage', label: 'What it means', type: 'select', required: true, options: options(stages),
          render: (r) => stages.find((s) => s.value === r.stage)?.label ?? <span className="si-unset">Not set: takes the meaning of the status before it</span>,
        },
        { field: 'color', label: 'Colour', type: 'select', options: COLOURS, initial: 'gray', formOnly: true },
        { field: 'sort', label: 'Order', type: 'number', hint: 'Lower numbers come first' },
        {
          field: 'active', label: 'In use', type: 'boolean', initial: true, editOnly: true,
          render: (r) => <StatusChip color={r.active ? 'green' : 'gray'} label={r.active ? 'In use' : 'Retired'} />,
        },
      ]} />
  );
}

function ChecklistsTab({ admin }: { admin: boolean }) {
  const scenarios = useLookup('security_incident_scenario');
  const phases = useLookup('incident_checklist_phase');
  const [scenario, setScenario] = useState('');
  const current = scenario || scenarios[0]?.value || '';
  return (
    <div className="stack">
      <div className="si-table-bar">
        <p className="si-table-intro">These steps are copied onto an incident when its scenario is set. Editing a template does not change incidents already under way.</p>
        <Select label="Scenario" required value={current} onChange={setScenario} options={options(scenarios)} />
      </div>
      <div className="si-phases">
        {phases.map((phase) => (
          <Card key={`${current}.${phase.value}`} title={phase.label}>
            <EditableTable url={`/api/security-checklist-templates?scenario=${encodeURIComponent(current)}`} noun="Checklist step" canEdit={admin}
              filter={(r) => r.phase === phase.value} createExtra={{ scenario: current, phase: phase.value }}
              emptyIcon="check-square" emptyTitle="No steps" emptyMessage="Incidents with this scenario get no steps for this phase."
              columns={[
                { field: 'step', label: 'Step', type: 'longtext', required: true },
                { field: 'sort', label: 'Order', type: 'number', hint: 'Lower numbers come first', formOnly: true },
              ]} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Notification rules, kinds of data, checklist templates, the standing contact list and the lifecycle. Everyone with access can read; administrators edit. */
export function RulesPage() {
  const { can } = useAuth();
  const admin = can('security.administer');
  const [search, setSearch] = useSearchParams();

  const contacts = (
    <EditableTable url="/api/security-incident-contacts" noun="Contact" canEdit={admin}
      intro="The standing incident team. It is printed in the offline incident kit and copied onto each new incident as its starting role list. Give phone numbers that work when email and this system are down."
      emptyIcon="users" emptyTitle="No contacts" emptyMessage="Add the incident lead, technical lead, communications, scribe and executive sponsor."
      columns={[
        { field: 'role', label: 'Role', required: true, render: (r) => <strong>{r.role}</strong> },
        { field: 'person_name', label: 'Person', render: (r) => r.person_name || <span className="si-unset">Not filled in</span> },
        { field: 'contact', label: 'Contact', render: (r) => r.contact || <span className="si-unset">Not filled in</span> },
        { field: 'notes', label: 'What the role does', type: 'longtext' },
        { field: 'sort', label: 'Order', type: 'number', formOnly: true },
      ]} />
  );

  const tabs = [
    { key: 'rules', label: 'Notification rules', content: <RulesTab admin={admin} /> },
    { key: 'kinds', label: 'Kinds of data', content: <KindsTab admin={admin} /> },
    { key: 'checklists', label: 'Scenario checklists', content: <ChecklistsTab admin={admin} /> },
    { key: 'contacts', label: 'Roles and contacts', content: contacts },
    { key: 'statuses', label: 'Incident statuses', content: <StatusesTab admin={admin} /> },
  ];
  const wanted = search.get('tab');
  const active = tabs.some((t) => t.key === wanted) ? (wanted as string) : 'rules';

  return (
    <div className="stack">
      <PageHeader title="Notification rules and checklists"
        subtitle={admin ? 'Who must be told, by when, and what to do first' : 'Read-only: an administrator can change these'}
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Rules and checklists' }]}
        actions={<Link className="btn btn-secondary" to="/security-incidents/kit">Offline incident kit</Link>} />
      <Tabs label="Incident configuration" tabs={tabs} active={active}
        onChange={(key) => setSearch((old) => { const next = new URLSearchParams(old); next.set('tab', key); return next; }, { replace: true })} />
    </div>
  );
}
