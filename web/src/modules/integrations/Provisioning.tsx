// Administration > User provisioning (E36-01): the SCIM 2.0 endpoint an identity provider uses to
// create, change and deactivate accounts. Off until switched on here; each identity provider gets its
// own token (shown once); groups give roles only through the mapping made here, never a role that can
// administer.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDateTime, Icon, Loading, Menu, Modal,
  PageHeader, relativeTime, Select, StatusChip, Switch, TextArea, TextField, useFetch, useToast,
} from '../../core';
import '../admin/admin.css';
import { CopyBox, Notice } from '../admin/common';
import { adminApi, withReauth } from '../admin/reauth';
import './integrations.css';

interface ScimSettings { enabled: boolean; linkProviderId: string | null; endpoint: string; providers: { id: string; name: string; key: string }[] }
interface ScimToken {
  id: string; name: string; prefix: string; allowed_addresses: string[] | null; created_at: string; created_by_name: string | null;
  last_used_at: string | null; last_used_ip: string | null; revoked_at: string | null; active: boolean;
}
interface ScimGroup {
  id: string; display_name: string; external_id: string | null; role_keys: string[]; members: number;
  mapped_at: string | null; mapped_by_name: string | null;
}
interface MappableRole { key: string; name: string; enabled: boolean; administers: boolean }
interface Activity { id: string; at: string; actor_name: string | null; action: string; summary: string | null; ip: string | null }

const splitAddresses = (text: string) => text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

export function ProvisioningPage() {
  const settings = useFetch<ScimSettings>('/api/admin/scim/settings');
  const tokens = useFetch<{ tokens: ScimToken[] }>('/api/admin/scim/tokens');
  const groups = useFetch<{ groups: ScimGroup[]; roles: MappableRole[] }>('/api/admin/scim/groups');
  const activity = useFetch<Activity[]>('/api/admin/scim/activity');
  const reloadAll = () => { settings.reload(); tokens.reload(); groups.reload(); activity.reload(); };

  return (
    <>
      <PageHeader
        title="User provisioning"
        subtitle="Let your identity provider create accounts, keep them up to date and switch them off when people leave, over SCIM 2.0."
      />
      <div className="stack">
        {settings.error ? <ErrorState error={settings.error} onRetry={settings.reload} />
          : !settings.data ? <Loading lines={4} label="Loading provisioning settings" />
          : <SwitchCard data={settings.data} onSaved={reloadAll} />}
        {tokens.error ? <ErrorState error={tokens.error} onRetry={tokens.reload} />
          : !tokens.data ? <Loading lines={4} label="Loading provisioning tokens" />
          : <TokensCard tokens={tokens.data.tokens} onChanged={() => { tokens.reload(); activity.reload(); }} />}
        {groups.error ? <ErrorState error={groups.error} onRetry={groups.reload} />
          : !groups.data ? <Loading lines={4} label="Loading groups" />
          : <GroupsCard groups={groups.data.groups} roles={groups.data.roles} onChanged={() => { groups.reload(); activity.reload(); }} />}
        {activity.error ? <ErrorState error={activity.error} onRetry={activity.reload} />
          : !activity.data ? <Loading lines={3} label="Loading recent activity" />
          : <ActivityCard rows={activity.data} />}
        <HowItWorks />
      </div>
    </>
  );
}

function SwitchCard({ data, onSaved }: { data: ScimSettings; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (body: Partial<{ enabled: boolean; linkProviderId: string | null }>, done: string) => {
    setBusy(true);
    try { await withReauth(() => api.put('/api/admin/scim/settings', body)); toast.success(done); onSaved(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const endpoint = `${window.location.origin}${data.endpoint}`;
  return (
    <Card title="Provisioning">
      <div className="stack">
        {!data.enabled && (
          <Notice tone="caution" icon="lock">
            <p><strong>Provisioning is switched off.</strong> Every request to the endpoint is refused, even with a valid token. Make a token below, give it and the
              address to your identity provider, then switch provisioning on.</p>
          </Notice>
        )}
        <Switch
          label="Provisioning switched on" checked={data.enabled} disabled={busy}
          hint="Switching it on or off asks for your password."
          onChange={(on) => void save({ enabled: on }, on ? 'Provisioning switched on.' : 'Provisioning switched off. Requests are refused from now on.')}
        />
        <CopyBox label="SCIM endpoint (base address)" copyLabel="Copy address" value={endpoint} testId="scim-endpoint">
          <p className="field-hint">The identity provider adds <code>/Users</code> and <code>/Groups</code>, and sends the token as <code>Authorization: Bearer</code>.</p>
        </CopyBox>
        <Select
          label="Sign-in provider for new accounts" placeholder="None: link by hand" disabled={busy}
          value={data.linkProviderId ?? ''}
          options={[{ value: '', label: 'None: link by hand' }, ...data.providers.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(v) => void save({ linkProviderId: v || null }, 'Saved.')}
          hint="Accounts provisioning creates have no password here. With a provider chosen, each may link that provider by its email address at its first sign-in (for 30 days)."
        />
      </div>
    </Card>
  );
}

function TokensCard({ tokens, onChanged }: { tokens: ScimToken[]; onChanged: () => void }) {
  const toast = useToast();
  const [making, setMaking] = useState(false);
  const [editing, setEditing] = useState<ScimToken | null>(null);
  const [revoking, setRevoking] = useState<ScimToken | null>(null);
  const [shown, setShown] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await adminApi.del(`/api/admin/scim/tokens/${revoking.id}`);
      toast.success(`Token "${revoking.name}" revoked. It stops working at once.`);
      setRevoking(null);
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card
      title="Provisioning tokens" flush
      actions={<Button variant="primary" icon="plus" size="sm" onClick={() => setMaking(true)}>Make token</Button>}
    >
      {tokens.length === 0 ? (
        <EmptyState icon="key" title="No provisioning tokens yet" message="Make one for each identity provider that provisions accounts here." />
      ) : (
        <div className="table-wrap adm-table-frame">
          <table className="table">
            <thead><tr><th scope="col">Token</th><th scope="col">Used from</th><th scope="col">Last used</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {tokens.map((tk) => (
                <tr key={tk.id}>
                  <td className="adm-wrap"><strong>{tk.name}</strong><div className="muted adm-small"><code>{tk.prefix}…</code> made {formatDateTime(tk.created_at)}{tk.created_by_name ? ` by ${tk.created_by_name}` : ''}</div></td>
                  <td className="adm-wrap adm-small">{tk.allowed_addresses?.length ? tk.allowed_addresses.join(', ') : <span className="muted">Any address</span>}</td>
                  <td className="adm-small">{tk.last_used_at ? <span title={formatDateTime(tk.last_used_at)}>{relativeTime(tk.last_used_at)}{tk.last_used_ip ? ` from ${tk.last_used_ip}` : ''}</span> : <span className="muted">Never</span>}</td>
                  <td>{tk.active ? <StatusChip color="green" label="Active" /> : <StatusChip color="gray" label={`Revoked ${relativeTime(tk.revoked_at!)}`} />}</td>
                  <td className="adm-row-actions">
                    {tk.active && (
                      <Menu
                        label={`Actions for ${tk.name}`} icon="more" iconOnly size="sm" align="end"
                        items={[
                          { label: 'Change addresses', icon: 'edit', onSelect: () => setEditing(tk) },
                          { label: 'Revoke', icon: 'trash', danger: true, separated: true, onSelect: () => setRevoking(tk) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {making && <TokenDialog onClose={() => setMaking(false)} onMade={(made) => { setMaking(false); setShown(made); onChanged(); }} />}
      {editing && <AddressesDialog token={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      <Modal open={shown !== null} title={`Token "${shown?.name ?? ''}" made`} onClose={() => setShown(null)} footer={<Button variant="primary" onClick={() => setShown(null)}>Done</Button>}>
        {shown && (
          <div className="stack">
            <Notice tone="caution" role="status">
              <strong>This token is shown once.</strong> Paste it into your identity provider's provisioning settings now. Only a fingerprint of it is kept here, so it cannot
              be shown again; if it is lost, make a new one and revoke this one.
            </Notice>
            <CopyBox prominent label="Provisioning token" copyLabel="Copy token" value={shown.token} testId="scim-token" />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={revoking !== null} danger busy={busy} title="Revoke this token?" confirmLabel="Revoke token"
        message={<p>The identity provider using <strong>{revoking?.name}</strong> can no longer create, change or deactivate accounts. Accounts it made stay as they are.</p>}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}

function TokenDialog({ onClose, onMade }: { onClose: () => void; onMade: (made: { name: string; token: string }) => void }) {
  const [name, setName] = useState('');
  const [addresses, setAddresses] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErrors({ name: 'Enter a name.' }); return; }
    setBusy(true);
    try {
      const res = await adminApi.post<{ name: string; token: string }>('/api/admin/scim/tokens', { name: name.trim(), allowedAddresses: splitAddresses(addresses) });
      onMade(res);
    } catch (err) {
      setErrors(err instanceof ApiError && Object.keys(err.fields).length ? err.fields : { name: errorMessage(err) });
    } finally { setBusy(false); }
  };
  return (
    <Modal open title="Make a provisioning token" onClose={onClose} dirty={name !== '' || addresses !== ''}>
      <form className="form" onSubmit={submit} noValidate>
        <TextField label="Name" required maxLength={80} value={name} onChange={setName} error={errors.name} hint="For example the identity provider that will use it." />
        <TextArea
          label="Allowed addresses" value={addresses} onChange={setAddresses} rows={3} error={errors.allowedAddresses}
          hint="Optional. The addresses or ranges your identity provider calls from, one a line (203.0.113.7 or 198.51.100.0/24). Empty: any address."
        />
        <p className="field-hint">Making a token asks for your password.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Make token</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddressesDialog({ token, onClose, onSaved }: { token: ScimToken; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const start = (token.allowed_addresses ?? []).join('\n');
  const [addresses, setAddresses] = useState(start);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.patch(`/api/admin/scim/tokens/${token.id}`, { allowedAddresses: splitAddresses(addresses) });
      toast.success('Addresses saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.allowedAddresses ? err.fields.allowedAddresses : errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Addresses for "${token.name}"`} onClose={onClose} dirty={addresses !== start}>
      <form className="form" onSubmit={submit} noValidate>
        <TextArea label="Allowed addresses" value={addresses} onChange={setAddresses} rows={4} error={error} hint="One address or range a line. Empty: any address." />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function GroupsCard({ groups, roles, onChanged }: { groups: ScimGroup[]; roles: MappableRole[]; onChanged: () => void }) {
  const [mapping, setMapping] = useState<ScimGroup | null>(null);
  const roleName = (key: string) => roles.find((r) => r.key === key)?.name ?? key;
  return (
    <Card title="Groups and roles" flush>
      {groups.length === 0 ? (
        <EmptyState icon="users" title="No groups yet" message="Groups appear here when your identity provider sends them. A group gives no role until you map it." />
      ) : (
        <div className="table-wrap adm-table-frame">
          <table className="table">
            <thead><tr><th scope="col">Group</th><th scope="col">Members</th><th scope="col">Roles it gives</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="adm-wrap"><strong>{g.display_name}</strong>{g.external_id && <div className="muted adm-small">{g.external_id}</div>}</td>
                  <td>{g.members}</td>
                  <td className="adm-wrap">
                    {g.role_keys.length
                      ? <span className="row adm-chips">{g.role_keys.map((k) => <StatusChip key={k} color="blue" label={roleName(k)} />)}</span>
                      : <span className="muted adm-small">None (not mapped)</span>}
                    {g.mapped_at && <div className="muted adm-small">Mapped {relativeTime(g.mapped_at)}{g.mapped_by_name ? ` by ${g.mapped_by_name}` : ''}</div>}
                  </td>
                  <td className="adm-row-actions"><Button size="sm" icon="edit" onClick={() => setMapping(g)}>Map roles</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mapping && <MapDialog group={mapping} roles={roles} onClose={() => setMapping(null)} onSaved={() => { setMapping(null); onChanged(); }} />}
    </Card>
  );
}

function MapDialog({ group, roles, onClose, onSaved }: { group: ScimGroup; roles: MappableRole[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>(group.role_keys);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => roles.filter((r) => !r.administers).map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` })), [roles]);
  const dirty = [...chosen].sort().join() !== [...group.role_keys].sort().join();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await withReauth(() => api.put(`/api/admin/scim/groups/${group.id}/roles`, { roleKeys: chosen }));
      toast.success(`Group "${group.display_name}" mapped. Its members' roles were brought in step.`);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.roleKeys ? err.fields.roleKeys : errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={`Roles for "${group.display_name}"`} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        <ChoicesField label="Roles" value={chosen} onChange={setChosen} options={options} placeholder="No roles" error={error} />
        <p className="field-hint">
          Members get these roles, and lose them when they leave the group or the mapping changes. Roles given by hand under <Link to="/admin/users">Users</Link> are
          never taken away. Roles that can administer are not offered: give those by hand. Saving asks for your password.
        </p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save mapping</Button>
        </div>
      </form>
    </Modal>
  );
}

function ActivityCard({ rows }: { rows: Activity[] }) {
  return (
    <Card title="Recent activity">
      {rows.length === 0 ? (
        <EmptyState icon="history" title="Nothing yet" message="Accounts and groups provisioning creates or changes, and refused requests, appear here." />
      ) : (
        <ul className="int-activity" aria-label="Recent provisioning activity">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="muted adm-small" title={formatDateTime(r.at)}>{relativeTime(r.at)}</span>
              <span className="adm-wrap">{r.summary ?? r.action}</span>
              {r.action === 'scim.refused' && <StatusChip color="amber" label="Refused" />}
            </li>
          ))}
        </ul>
      )}
      <p className="muted adm-small">The full record is in the <Link to="/admin/audit">audit log</Link>.</p>
    </Card>
  );
}

function HowItWorks() {
  return (
    <Card title="How provisioning works">
      <ul className="adm-facts">
        <li><Icon name="user" size={16} /> <span>New accounts have no password here and no roles: people sign in through single sign-on. Their group mappings decide their roles.</span></li>
        <li><Icon name="lock" size={16} /> <span>Deactivating an account (or removing it at the identity provider) disables it at once: its sessions end and its API tokens and AI assistant connections are revoked. Nothing is deleted.</span></li>
        <li><Icon name="refresh" size={16} /> <span>Provisioning can enable again only an account it disabled itself. An account an administrator disabled stays disabled. The last active administrator cannot be deactivated, and the break-glass account is never seen.</span></li>
        <li><Icon name="shield" size={16} /> <span>Roles that can administer are never given through a group. Every change is in the audit log as "Provisioning" with the token's name.</span></li>
      </ul>
    </Card>
  );
}
