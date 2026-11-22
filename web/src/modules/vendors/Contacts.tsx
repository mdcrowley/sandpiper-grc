// A vendor's contacts, including who to call in an incident.
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading,
  Modal, TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';

interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_incident_contact: boolean;
}

const BLANK = { name: '', role: '', email: '', phone: '', is_incident_contact: false };

function ContactForm({ vendorId, contact, onDone, onCancel }: {
  vendorId: string; contact: Contact | null; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const [v, setV] = useState(contact
    ? { name: contact.name, role: contact.role ?? '', email: contact.email ?? '', phone: contact.phone ?? '', is_incident_contact: contact.is_incident_contact }
    : BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initial = contact
    ? { name: contact.name, role: contact.role ?? '', email: contact.email ?? '', phone: contact.phone ?? '', is_incident_contact: contact.is_incident_contact }
    : BLANK;
  const unsaved = useUnsavedChanges(JSON.stringify(v) !== JSON.stringify(initial)); // E22-14: closing asks before discarding

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Same rules as the server.
    const found: Record<string, string> = {};
    if (!v.name.trim()) found.name = 'Name is required.';
    if (v.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) found.email = 'Enter a full email address.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (contact) await api.patch(`/api/vendors/${vendorId}/contacts/${contact.id}`, v);
      else await api.post(`/api/vendors/${vendorId}/contacts`, v);
      unsaved.release();
      toast.success(contact ? 'Contact saved.' : 'Contact added.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {message && <div className="form-error" role="alert">{message}</div>}
      <div className="form-grid">
        <TextField label="Name" required autoFocus value={v.name} error={errors.name} onChange={(name) => setV({ ...v, name })} />
        <TextField label="Role" value={v.role} error={errors.role} onChange={(role) => setV({ ...v, role })} />
        <TextField label="Email" type="email" value={v.email} error={errors.email} onChange={(email) => setV({ ...v, email })} />
        <TextField label="Phone" type="tel" value={v.phone} error={errors.phone} onChange={(phone) => setV({ ...v, phone })} />
        <div className="form-cell-wide">
          <Checkbox
            label="Incident contact" hint="The person to reach when there is a security incident involving this vendor."
            checked={v.is_incident_contact} error={errors.is_incident_contact}
            onChange={(is_incident_contact) => setV({ ...v, is_incident_contact })}
          />
        </div>
      </div>
      <div className="form-actions">
        <Button onClick={unsaved.guard(onCancel)}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{contact ? 'Save changes' : 'Add contact'}</Button>
      </div>
    </form>
  );
}

export function Contacts({ vendorId, onChanged }: { vendorId: string; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('vendors.edit');
  const { data, error, reload } = useFetch<Contact[]>(`/api/vendors/${vendorId}/contacts`);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/vendors/${vendorId}/contacts/${removing.id}`);
      toast.success('Contact removed.');
      setRemoving(null);
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = editable ? <Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add contact</Button> : undefined;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={3} label="Loading contacts" />;
  else if (!data.length) {
    body = (
      <EmptyState
        icon="users" title="No contacts yet"
        message="Add the people you deal with, and mark the one to call in an incident." action={add}
      />
    );
  } else {
    body = (
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Vendor contacts</caption>
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Role</th><th scope="col">Email</th><th scope="col">Phone</th>
              {editable && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <th scope="row">
                  <span className="row">
                    <span className="row-title">{c.name}</span>
                    {c.is_incident_contact && <Badge color="red">Incident contact</Badge>}
                  </span>
                </th>
                <td>{c.role || <span className="muted">—</span>}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}</td>
                <td>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span className="muted">—</span>}</td>
                {editable && (
                  <td className="num">
                    <IconButton icon="edit" label={`Edit ${c.name}`} variant="ghost" size="sm" onClick={() => setEditing(c)} />
                    <IconButton icon="trash" label={`Remove ${c.name}`} variant="ghost" size="sm" onClick={() => setRemoving(c)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title="Contacts" actions={data?.length ? add : undefined} flush={!!data?.length}>
      {body}
      <Modal open={editing !== null} title={editing === 'new' ? 'Add contact' : 'Edit contact'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <ContactForm
            vendorId={vendorId} contact={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); onChanged?.(); }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove contact"
        message={`Remove ${removing?.name ?? 'this contact'} from this vendor? The change is kept in the vendor's history.`}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}
