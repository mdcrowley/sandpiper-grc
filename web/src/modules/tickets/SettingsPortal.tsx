// Service desk settings, "Self-service portal" tab: the switch, the title and welcome line, the
// service status banner, the reopen window, who may raise a request for a colleague (E15-12),
// safety reports from the portal (E20-13) and which catalog items staff can ask for.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, errorMessage, ErrorState, formatDateTime, Loading, NumberField, Select, Switch, TextArea, TextField,
  useAuth, useFetch, useToast,
} from '../../core';
import type { ListResult } from '../../core';

interface PortalSettings {
  enabled: boolean; title: string; intro: string; reopen_days: number;
  on_behalf: 'nobody' | 'department' | 'anyone'; safety_reports: boolean;
  banner: { message: string; tone: string; updated_at: string | null } | null;
  can_switch: boolean; can_edit: boolean;
}

const TONES = [
  { value: 'info', label: 'Information' },
  { value: 'warning', label: 'Warning: some things may not work' },
  { value: 'outage', label: 'Service problem: something is down' },
  { value: 'resolved', label: 'Restored: back to normal' },
];

const ON_BEHALF = [
  { value: 'department', label: 'Anyone, for a colleague in their own department' },
  { value: 'anyone', label: 'Anyone, for any colleague' },
  { value: 'nobody', label: 'Nobody: each person raises their own' },
];

function CatalogChoice({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<ListResult>('/api/catalog-items?f.active=true&sort=name&pageSize=200');
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the catalog" />;
  async function flip(id: string, on: boolean) {
    setBusy(id);
    try {
      await api.patch(`/api/catalog-items/${id}`, { portal: on });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const shown = data.rows.filter((r) => r.portal).length;
  return (
    <Card title="What staff can ask for" actions={<Badge color="blue">{shown} of {data.rows.length} shown</Badge>}>
      <p className="muted">Active catalog items marked here appear as tiles in the portal, with their own questions. Everything else stays for the service desk only. Staff can always use “Report a problem”.</p>
      {data.rows.length ? (
        <ul className="sd-portal-items">
          {data.rows.map((r) => (
            <li key={r.id}>
              <Switch label={r.name} hint={r.description ?? undefined} checked={!!r.portal} disabled={!canEdit || busy === r.id}
                onChange={(on) => void flip(r.id, on)} />
              <Link to={`/catalog/${r.id}`} className="muted">Edit item</Link>
            </li>
          ))}
        </ul>
      ) : <p className="muted">The catalog has no active items. Add them under Service catalog.</p>}
    </Card>
  );
}

export function PortalSettingsTab() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<PortalSettings>('/api/portal/settings');
  const [f, setF] = useState<PortalSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF(data); }, [data]);

  if (error) {
    if (error instanceof ApiError && error.status === 404) return <p className="notice">The portal module is not loaded on this server.</p>;
    return <ErrorState error={error} onRetry={reload} />;
  }
  if (!data || !f) return <Loading lines={6} label="Loading the portal settings" />;
  const canEdit = data.can_edit;

  async function save(patch: Record<string, unknown>, done: string) {
    setBusy(true);
    setErrors({});
    try {
      await api.put('/api/portal/settings', patch);
      toast.success(done);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const banner = f.banner ?? { message: '', tone: 'info', updated_at: null };

  return (
    <div className="stack">
      <Card title="Portal">
        <p className="muted">A simple page where any member of staff reports a problem, asks for something from the catalog and follows their own requests. They see public comments only, never internal notes.</p>
        <Switch label="Self-service portal switched on" checked={f.enabled} disabled={!data.can_switch || busy}
          hint={data.can_switch ? 'Also under Administration, Settings, Feature switches.' : 'Only an administrator can switch the portal on or off.'}
          onChange={(on) => void save({ enabled: on }, on ? 'The portal is switched on.' : 'The portal is switched off.')} />
        <p className="muted">
          People use it with the <strong>Requester</strong> role, which is switched off until an administrator switches it on under Administration, Roles.
          {' '}{can('portal.view') && f.enabled && <Link to="/portal">Open the portal</Link>}
        </p>
      </Card>

      <Card title="Service status banner">
        <p className="muted">A message at the top of the portal home page, for example when a system is down. Clear it when things are back to normal.</p>
        <div className="form">
          <TextArea label="Message" rows={2} value={banner.message} disabled={!canEdit} error={errors['banner.message']}
            placeholder="Real-time bus arrival screens are down at the central station; we are working on it."
            onChange={(v) => setF({ ...f, banner: { ...banner, message: v } })} />
          <Select label="How serious" options={TONES} value={banner.tone} required disabled={!canEdit} error={errors['banner.tone']}
            onChange={(v) => setF({ ...f, banner: { ...banner, tone: v || 'info' } })} />
          {data.banner?.updated_at && <p className="muted">Shown since {formatDateTime(data.banner.updated_at)}.</p>}
          {canEdit && (
            <div className="form-actions">
              <Button variant="primary" loading={busy} onClick={() => void save({ banner: banner.message.trim() ? banner : null }, banner.message.trim() ? 'Banner saved.' : 'Banner cleared.')}>Save banner</Button>
              {data.banner && <Button variant="secondary" disabled={busy} onClick={() => void save({ banner: null }, 'Banner cleared.')}>Clear banner</Button>}
            </div>
          )}
        </div>
      </Card>

      <Card title="Wording and reopening">
        <div className="form">
          <div className="form-grid">
            <TextField label="Portal title" required value={f.title} disabled={!canEdit} error={errors.title} maxLength={80}
              onChange={(v) => setF({ ...f, title: v })} />
            <NumberField label="Days a requester may reopen a resolved request" min={0} max={90} value={f.reopen_days} disabled={!canEdit}
              error={errors.reopen_days} hint="0 means never: they raise a new request instead."
              onChange={(v) => setF({ ...f, reopen_days: v ?? 0 })} />
            <div className="form-cell-wide">
              <TextArea label="Welcome line" rows={2} value={f.intro} disabled={!canEdit} error={errors.intro}
                onChange={(v) => setF({ ...f, intro: v })} />
            </div>
          </div>
          {canEdit && (
            <div className="form-actions">
              <Button variant="primary" loading={busy} onClick={() => void save({ title: f.title, intro: f.intro, reopen_days: f.reopen_days }, 'Portal settings saved.')}>Save</Button>
            </div>
          )}
        </div>
      </Card>

      <Card title="Requests for colleagues and safety reports">
        <div className="form">
          <Select label="Who may raise a request for a colleague" required disabled={!canEdit} options={ON_BEHALF} value={f.on_behalf}
            error={errors.on_behalf} hint="The colleague is recorded as the affected person, is told, and follows the request in the portal too."
            onChange={(v) => setF({ ...f, on_behalf: (v || 'department') as PortalSettings['on_behalf'] })} />
          <Switch label="Staff can report a safety event" checked={f.safety_reports} disabled={!canEdit}
            hint="Shown when the safety module is in use. Reports arrive as safety events with the status Reported, for the safety team to triage."
            onChange={(on) => setF({ ...f, safety_reports: on })} />
          {canEdit && (
            <div className="form-actions">
              <Button variant="primary" loading={busy} onClick={() => void save({ on_behalf: f.on_behalf, safety_reports: f.safety_reports }, 'Portal settings saved.')}>Save</Button>
            </div>
          )}
        </div>
      </Card>

      <CatalogChoice canEdit={can('tickets.edit')} />
    </div>
  );
}
