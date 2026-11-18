import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, PageHeader, Select, Tabs, useAuth, useLookup } from '../../core';
import { EditableTable } from './EditableTable';
import type { Rule } from './types';
import { deadlineText } from './types';

/** Notification rules, checklist templates and the standing contact list. Everyone with access can read; administrators edit. */
export function RulesPage() {
  const { can } = useAuth();
  const admin = can('security.administer');
  const triggers = useLookup('notification_trigger');
  const scenarios = useLookup('security_incident_scenario');
  const [scenario, setScenario] = useState('ransomware');
  const options = (list: { value: string; label: string }[]) => list.map((x) => ({ value: x.value, label: x.label }));

  const rules = (
    <div className="stack">
      <p className="muted">
        When an incident is declared, each active rule whose trigger applies creates a notification task with a clock counted from
        the discovery time. A rule with no deadline cannot be switched on: set its deadline in hours first (0 means immediately).
        Changes apply to open incidents straight away.
      </p>
      <EditableTable url="/api/security-notification-rules" noun="Notification rule" canEdit={admin}
        emptyIcon="clock" emptyTitle="No notification rules" emptyMessage="Without rules, declaring an incident starts no clocks."
        columns={[
          { field: 'trigger_attribute', label: 'Trigger', type: 'select', options: options(triggers), required: true },
          { field: 'party', label: 'Notify', required: true },
          {
            field: 'deadline_hours', label: 'Deadline from discovery', type: 'number', hint: 'In hours: 24, 72 (3 days), 168 (7 days), 720 (30 days); 0 = immediately',
            render: (r: Rule) => deadlineText(r.deadline_hours),
          },
          {
            field: 'required', label: 'Required by law or contract', type: 'boolean', initial: true, hint: 'Untick for a recommended notification',
            render: (r: Rule) => <Badge color={r.required ? 'blue' : 'gray'}>{r.required ? 'Required' : 'Recommended'}</Badge>,
          },
          {
            field: 'active', label: 'Active', type: 'boolean', initial: true,
            render: (r: Rule) => <Badge color={r.active ? 'green' : 'amber'}>{r.active ? 'Active' : 'Switched off'}</Badge>,
          },
          { field: 'guidance', label: 'Guidance', type: 'longtext' },
        ]} />
    </div>
  );

  const checklists = (
    <div className="stack">
      <p className="muted">These steps are copied onto an incident when its scenario is set. Editing a template does not change incidents already under way.</p>
      <div className="row">
        <Select label="Scenario" value={scenario} onChange={(v) => setScenario(v || 'ransomware')} options={options(scenarios)} />
      </div>
      {(['containment', 'recovery'] as const).map((phase) => (
        <Card key={`${scenario}.${phase}`} title={phase === 'containment' ? 'Containment' : 'Recovery'}>
          <EditableTable url={`/api/security-checklist-templates?scenario=${encodeURIComponent(scenario)}`} noun="Checklist step" canEdit={admin}
            filter={(r) => r.phase === phase} createExtra={{ scenario, phase }}
            emptyIcon="check-square" emptyTitle="No steps" emptyMessage="Incidents with this scenario get no steps for this phase."
            columns={[
              { field: 'step', label: 'Step', type: 'longtext', required: true },
              { field: 'sort', label: 'Order', type: 'number', hint: 'Lower numbers come first' },
            ]} />
        </Card>
      ))}
    </div>
  );

  const contacts = (
    <div className="stack">
      <p className="muted">
        The standing incident team. It is printed in the offline incident kit and copied onto each new incident as its starting role list.
        Give phone numbers that work when email and this system are down.
      </p>
      <EditableTable url="/api/security-incident-contacts" noun="Contact" canEdit={admin}
        emptyIcon="users" emptyTitle="No contacts" emptyMessage="Add the incident lead, technical lead, communications, scribe and executive sponsor."
        columns={[
          { field: 'role', label: 'Role', required: true },
          { field: 'person_name', label: 'Person' },
          { field: 'contact', label: 'Contact' },
          { field: 'notes', label: 'What the role does', type: 'longtext' },
          { field: 'sort', label: 'Order', type: 'number', formOnly: true },
        ]} />
    </div>
  );

  return (
    <div className="stack">
      <PageHeader title="Notification rules and checklists"
        subtitle={admin ? 'Who must be told, by when, and what to do first' : 'Read-only: an administrator can change these'}
        breadcrumbs={[{ label: 'Security incidents', to: '/security-incidents' }, { label: 'Rules and checklists' }]}
        actions={<Link className="btn btn-secondary" to="/security-incidents/kit">Offline incident kit</Link>} />
      <Tabs label="Incident configuration" tabs={[
        { key: 'rules', label: 'Notification rules', content: rules },
        { key: 'checklists', label: 'Scenario checklists', content: checklists },
        { key: 'contacts', label: 'Roles and contacts', content: contacts },
      ]} />
    </div>
  );
}
