import { useEffect } from 'react';
import { ErrorState, Icon, IconButton, Loading, useFetch, useToast } from '../../core';
import { EditableTable } from './EditableTable';

interface Role { id: string; role: string; person_name: string | null; contact: string | null }

/** A contact detail as something to act on: a phone number dials, an email address opens a message; either can be copied. */
export function ContactLink({ contact }: { contact: string | null | undefined }) {
  const toast = useToast();
  const value = (contact ?? '').trim();
  if (!value) return <span className="muted">No contact given</span>;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const phone = !email && /^[+()\d][\d\s().-]{4,}$/.test(value);
  const href = email ? `mailto:${value}` : phone ? `tel:${value.replace(/[^\d+]/g, '')}` : null;
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => toast.success('Copied.'), () => toast.error('Could not copy. Select the text and copy it by hand.'));
  };
  return (
    <span className="si-contact">
      {href ? <a href={href}><Icon name={email ? 'message' : 'external'} size={14} />{value}</a> : <span>{value}</span>}
      <IconButton icon="clipboard" label={`Copy ${value}`} size="sm" onClick={copy} />
    </span>
  );
}

/** The incident team at a glance, in the rail: every contact one click away. */
export function TeamCard({ incidentId, version, onManage }: { incidentId: string; version: string; onManage: () => void }) {
  const { data, error, reload } = useFetch<Role[]>(`/api/security-incidents/${incidentId}/roles`);
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);
  return (
    <section className="si-rail-section si-team-card" aria-label="Incident team">
      <header className="si-rail-head">
        <h2>Team</h2>
        <button type="button" className="si-link" onClick={onManage}>Manage roles</button>
      </header>
      {error ? <ErrorState title="The team could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading team" />
        : !data.length ? <p className="muted">No roles assigned yet.</p>
        : (
          <ul className="si-team">
            {data.map((r) => (
              <li key={r.id}>
                <span className="si-team-role">{r.role}</span>
                <span className="si-team-person">{r.person_name || <span className="muted">Not assigned</span>}</span>
                {r.contact && <ContactLink contact={r.contact} />}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** Who is doing what on this incident; starts as a copy of the standing contact list. */
export function RolesTab({ incidentId, canEdit, onChanged }: { incidentId: string; canEdit: boolean; onChanged: () => void }) {
  return (
    <EditableTable url={`/api/security-incidents/${incidentId}/roles`} noun="Role" canEdit={canEdit} onChanged={onChanged}
      intro="Who is doing what on this incident. It starts as a copy of the standing contact list; changes here affect this incident only."
      emptyIcon="users" emptyTitle="No roles assigned" emptyMessage="Assign an incident lead, technical lead, communications, scribe and executive sponsor."
      columns={[
        { field: 'role', label: 'Role', required: true, render: (r: Role) => <strong>{r.role}</strong> },
        { field: 'person_name', label: 'Person' },
        { field: 'contact', label: 'Contact', hint: 'A phone number that works if email is down', render: (r: Role) => (r.contact ? <ContactLink contact={r.contact} /> : <span className="muted">—</span>) },
      ]} />
  );
}
