// Administration > AI assistant access: who may connect (E21-17), tools by role (E21-19), and sign-in
// for remote connectors with OAuth (E21-16). Each save asks for the password again if needed.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ChoicesField, ConfirmDialog, EmptyState, errorMessage, formatDate, Modal, relativeTime, Select, Switch,
  TextArea, TextField, useToast,
} from '../../core';
import { CopyBox, Notice } from '../admin/common';
import { adminApi, withReauth } from '../admin/reauth';

export interface Role { key: string; name: string; enabled: boolean }
export interface ToolRow { name: string; title: string; write: boolean }
interface AccessSettings { allowedRoles: string[] | null; roleTools: Record<string, string[]>; oauthEnabled: boolean; oauthRegistration: boolean; enabled: boolean }
export interface OAuthClient {
  id: string; client_id: string; name: string; redirect_uris: string[]; auth_method: string; client_uri: string | null;
  registered_by: 'dynamic' | 'administrator'; created_at: string; last_used_at: string | null; connections: number;
}
export interface OAuthGrant { id: string; name: string; scope: string; created_at: string; expires_at: string; last_used_at: string | null; user_name: string | null; client_name: string }
export interface OAuthView { clients: OAuthClient[]; grants: OAuthGrant[]; secure: boolean; base: string }

type Save = (what: string, body: Record<string, unknown>, done: string) => Promise<void>;

/** Who may connect an assistant: everyone holding a permission, or only some roles. */
export function WhoMayConnectCard({ settings, roles, busy, save }: { settings: AccessSettings; roles: Role[]; busy: string | null; save: Save }) {
  const [mode, setMode] = useState(settings.allowedRoles ? 'roles' : 'everyone');
  const [chosen, setChosen] = useState<string[]>(settings.allowedRoles ?? []);
  useEffect(() => { setMode(settings.allowedRoles ? 'roles' : 'everyone'); setChosen(settings.allowedRoles ?? []); }, [settings.allowedRoles]);
  const next = mode === 'everyone' ? null : [...chosen].sort();
  const changed = JSON.stringify(next) !== JSON.stringify(settings.allowedRoles ? [...settings.allowedRoles].sort() : null);
  return (
    <Card title="Who may connect an assistant">
      <div className="stack">
        <Select
          label="People who may connect" value={mode} onChange={setMode}
          options={[{ value: 'everyone', label: 'Everyone who holds a permission' }, { value: 'roles', label: 'Only people in chosen roles' }]}
          hint="Applies at once: assistants of people outside these roles are refused on their next request, and their tokens stay refused until the role is allowed again."
        />
        {mode === 'roles' && (
          <ChoicesField
            label="Roles" value={chosen} onChange={setChosen} placeholder="Choose roles"
            options={roles.map((r) => ({ value: r.key, label: r.enabled ? r.name : `${r.name} (switched off)` }))}
          />
        )}
        <div>
          <Button variant="primary" disabled={!changed || (mode === 'roles' && chosen.length === 0)} loading={busy === 'roles'}
            onClick={() => void save('roles', { allowedRoles: next }, next ? 'Only the chosen roles may connect assistants now.' : 'Everyone with a permission may connect an assistant.')}>
            Save who may connect
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** The tools each role's assistants may use (empty = every allowed tool). */
export function ToolsByRoleCard({ settings, roles, tools, busy, save }: { settings: AccessSettings; roles: Role[]; tools: ToolRow[]; busy: string | null; save: Save }) {
  const [lists, setLists] = useState<Record<string, string[]>>(settings.roleTools);
  useEffect(() => { setLists(settings.roleTools); }, [settings.roleTools]);
  const clean = Object.fromEntries(Object.entries(lists).filter(([, v]) => v.length > 0).map(([k, v]) => [k, [...v].sort()]));
  const same = JSON.stringify(Object.entries(clean).sort()) === JSON.stringify(Object.entries(settings.roleTools).map(([k, v]) => [k, [...v].sort()]).sort());
  const shown = roles.filter((r) => r.enabled || settings.roleTools[r.key]);
  return (
    <Card title="Tools by role">
      <div className="stack">
        <p className="muted">
          Narrow the tools offered to the assistants of people in a role. Someone in several roles gets the tools of all of them; a role left empty does not narrow,
          so anyone who also holds it gets every allowed tool. People can narrow their own connections further.
        </p>
        <div className="mcp-roles">
          {shown.map((r) => (
            <div key={r.key} className="mcp-role-row">
              <span className="mcp-role-name">{r.name}</span>
              <ChoicesField
                label={`Tools for ${r.name}`} hideLabel value={lists[r.key] ?? []} placeholder="Every allowed tool"
                onChange={(v) => setLists((s) => ({ ...s, [r.key]: v }))}
                options={tools.map((t) => ({ value: t.name, label: `${t.title}${t.write ? ' (changes records)' : ''}` }))}
              />
            </div>
          ))}
        </div>
        <div>
          <Button variant="primary" disabled={same} loading={busy === 'roleTools'} onClick={() => void save('roleTools', { roleTools: clean }, 'Tools by role saved.')}>Save tools by role</Button>
        </div>
      </div>
    </Card>
  );
}

function AddConnectorDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [uris, setUris] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ clientId: string; clientSecret?: string; name: string } | null>(null);
  const close = () => { setName(''); setUris(''); setConfidential(false); setErrors({}); setFormError(''); setMade(null); onClose(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setFormError('');
    try {
      const res = await adminApi.post<{ clientId: string; clientSecret?: string; name: string }>('/api/mcp/admin/oauth/clients', {
        name: name.trim(), redirectUris: uris.split(/\s+/).map((s) => s.trim()).filter(Boolean), confidential,
      });
      setMade(res);
      onAdded();
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (made) {
    return (
      <Modal open={open} title={`"${made.name}" added`} onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
        <div className="stack">
          <CopyBox label="Client id" copyLabel="Copy client id" value={made.clientId} testId="mcp-client-id" />
          {made.clientSecret && (
            <>
              <Notice tone="caution" role="status"><strong>The client secret is shown once.</strong> Give it to the connector now; it cannot be shown again.</Notice>
              <CopyBox prominent label="Client secret" copyLabel="Copy client secret" value={made.clientSecret} testId="mcp-client-secret" />
            </>
          )}
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={open} title="Add a connector" onClose={close}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Name" required maxLength={100} value={name} onChange={setName} error={errors.name} hint="Shown to people on the consent screen, for example “Team assistant”." />
        <TextArea label="Redirect addresses" required rows={3} value={uris} onChange={setUris} error={errors.redirectUris}
          placeholder="https://assistant.example.org/oauth/callback" hint="Where the connector receives the sign-in result, one per line, exactly as the connector documents it (https, or http on this computer only)." />
        <Checkbox label="The connector keeps a client secret" checked={confidential} onChange={setConfidential}
          hint="Only for connectors that run on a server and can keep a secret. Desktop and command-line clients usually cannot." />
        <div className="form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Add connector</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Sign-in for remote connectors: switches, connectors and the connections people approved. */
export function OAuthCard({ settings, oauth, busy, save, reload }: { settings: AccessSettings; oauth: OAuthView; busy: string | null; save: Save; reload: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OAuthClient | null>(null);
  const [ending, setEnding] = useState<OAuthGrant | null>(null);
  const [working, setWorking] = useState(false);
  const remove = async () => {
    if (!removing) return;
    setWorking(true);
    try {
      const res = await adminApi.del<{ connectionsEnded: number }>(`/api/mcp/admin/oauth/clients/${removing.id}`);
      toast.success(`"${removing.name}" removed; ${res.connectionsEnded} ${res.connectionsEnded === 1 ? 'connection' : 'connections'} ended.`);
      setRemoving(null);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setWorking(false); }
  };
  const end = async () => {
    if (!ending) return;
    setWorking(true);
    try {
      await withReauth(() => api.del(`/api/mcp/oauth/grants/${ending.id}`));
      toast.success(`The connection of ${ending.user_name ?? 'that person'} to "${ending.client_name}" ended.`);
      setEnding(null);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setWorking(false); }
  };
  const hosts = (c: OAuthClient) => c.redirect_uris.map((u) => { try { return new URL(u).host || u; } catch { return u; } }).join(', ');

  return (
    <Card title="Sign-in for remote connectors (OAuth)" flush actions={settings.oauthEnabled ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add a connector</Button> : undefined}>
      <div className="card-body stack">
        <p className="muted">
          Connectors such as Claude&apos;s custom connectors sign in instead of using a token: the person is sent here, signs in, and approves the connector. Access tokens last an hour and are renewed
          while the connection lasts; the person can disconnect it at any time.
        </p>
        {!oauth.secure && (
          <Notice tone="caution" icon="lock">
            This page was opened at {oauth.base}, which is neither HTTPS nor this computer. Connectors can sign in only over HTTPS: set the public address under
            Settings and serve the application over HTTPS first.
          </Notice>
        )}
        <Switch
          label="Let connectors sign in (OAuth 2.1)" checked={settings.oauthEnabled} disabled={busy !== null || !settings.enabled}
          onChange={(on) => void save('oauth', { oauthEnabled: on }, on ? 'Connectors may now sign in.' : 'Sign-in for connectors switched off; every connection stops at once.')}
          hint="Off: the sign-in addresses answer as if absent and every connector connection is refused."
        />
        <Switch
          label="Let connectors register themselves" checked={settings.oauthRegistration} disabled={busy !== null || !settings.oauthEnabled}
          onChange={(on) => void save('registration', { oauthRegistration: on }, on ? 'Connectors may register themselves.' : 'Only connectors added here may sign in.')}
          hint="Most connectors register themselves the first time (dynamic client registration). When off, add each connector here by hand. Either way each person still approves it."
        />
      </div>
      {settings.oauthEnabled && (
        oauth.clients.length === 0 ? <EmptyState icon="link" title="No connectors yet" message="Connectors appear here when they register or when you add one." /> : (
          <div className="table-wrap">
            <table className="table mcp-clients">
              <caption className="sr-only">Connectors</caption>
              <thead><tr><th scope="col">Connector</th><th scope="col">Returns to</th><th scope="col">Added</th><th scope="col" className="num">Connections</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {oauth.clients.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong><div><code>{c.client_id.slice(0, 16)}…</code></div></td>
                    <td className="mcp-break">{hosts(c)}</td>
                    <td>{c.registered_by === 'administrator' ? <Badge color="blue">By an administrator</Badge> : <Badge color="gray">Registered itself</Badge>}<div className="muted">{formatDate(c.created_at)}</div></td>
                    <td className="num">{c.connections}</td>
                    <td><Button size="sm" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {settings.oauthEnabled && oauth.grants.length > 0 && (
        <details className="mcp-fold card-body">
          <summary>Connections people approved ({oauth.grants.length})</summary>
          <ul className="mcp-calls">
            {oauth.grants.map((g) => (
              <li key={g.id}>
                <strong>{g.client_name}</strong>
                <span>{g.user_name ?? 'Unknown'}</span>
                <span className="muted">{g.scope.includes('mcp:write') ? 'read and write' : 'read only'}, until {formatDate(g.expires_at)}{g.last_used_at ? `, used ${relativeTime(g.last_used_at)}` : ''}</span>
                <Button size="sm" variant="ghost" aria-label={`End the connection of ${g.user_name ?? 'this person'} to ${g.client_name}`} onClick={() => setEnding(g)}>End</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AddConnectorDialog open={adding} onClose={() => setAdding(false)} onAdded={reload} />
      <ConfirmDialog
        open={removing !== null} danger busy={working} title="Remove this connector?" confirmLabel="Remove connector"
        message={<p><strong>{removing?.name}</strong> can no longer sign in, and its {removing?.connections ?? 0} {removing?.connections === 1 ? 'connection ends' : 'connections end'} at once.</p>}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={ending !== null} danger busy={working} title="End this connection?" confirmLabel="End connection"
        message={<p>The connection of <strong>{ending?.user_name}</strong> to <strong>{ending?.client_name}</strong> stops working at once.</p>}
        onConfirm={() => void end()} onCancel={() => setEnding(null)}
      />
    </Card>
  );
}
