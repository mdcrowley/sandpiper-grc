// "Connect an AI assistant": make a token with the mcp scope (shown once) and copy the configuration
// for Claude Desktop, Claude Code or any other MCP client; or, when sign-in for remote connectors is
// on, give the connector the address and approve it on the consent screen. Embeddable on Account security.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, ChoicesField, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Icon, Loading, Modal,
  relativeTime, Select, StatusChip, Tabs, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { sourcesFrom, sourcesText } from '../admin/ApiTokens';
import { CopyBox, copyText, Notice } from '../admin/common';
import { adminApi } from '../admin/reauth';
import {
  claudeCodeHttp, claudeCodeOAuth, claudeCodeStdio, claudeDesktop, connectorUrl, DEFAULT_BRIDGE_PATH, genericHttp, genericOAuth, genericStdio,
  TOKEN_PLACEHOLDER, type ConfigInput,
} from './configs';
import './mcp.css';

interface AssistantToken {
  id: string; name: string; prefix: string; scopes: string[]; expires_at: string; last_used_at: string | null; created_at: string; calls_30d: number;
  allowed_sources?: string[]; tools?: string[] | null;
}
interface Connection { id: string; name: string; client_name: string; scope: string; created_at: string; expires_at: string; last_used_at: string | null }
interface ToolChoice { name: string; title: string; write: boolean }
export interface McpStatus {
  enabled: boolean; writeEnabled: boolean; endpoint: string; maxDays: number; canWrite: boolean; tokens: AssistantToken[];
  allowed?: boolean; oauthEnabled?: boolean; connections?: Connection[]; tools?: ToolChoice[];
}
interface Created { id: string; name: string; expires_at: string; token: string; access: 'read' | 'write' }

const DAYS = [7, 30, 90, 180, 365];
const writes = (t: AssistantToken) => t.scopes.some((s) => /\.(create|edit)$/.test(s));

/** A block of configuration with a Copy button. */
function Snippet({ label, text, hint }: { label: string; text: string; hint?: string }) {
  const toast = useToast();
  return (
    <div className="mcp-snippet">
      <div className="mcp-snippet-head">
        <span className="field-label">{label}</span>
        <Button size="sm" icon="clipboard" onClick={() => void copyText(text).then((ok) => (ok ? toast.success('Copied.') : toast.error('Copying was blocked. Select the text and copy it by hand.')))}>Copy</Button>
      </div>
      <pre className="mcp-code" tabIndex={0} aria-label={label}><code>{text}</code></pre>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/** Tabs of ready-to-copy configuration for the common clients. */
export function ClientConfigs({ token }: { token?: string }) {
  const [bridgePath, setBridgePath] = useState(DEFAULT_BRIDGE_PATH);
  const c: ConfigInput = { base: window.location.origin, token: token ?? TOKEN_PLACEHOLDER, bridgePath: bridgePath.trim() || DEFAULT_BRIDGE_PATH };
  const bridge = (
    <div className="mcp-bridge">
      <p>
        Clients that start a local program use the <strong>bridge</strong>, a small script that passes messages to this installation.{' '}
        <a href="/api/mcp/bridge" download="sandpiper-mcp-stdio.mjs">Download the bridge</a>, save it, and enter where you saved it. It needs Node.js 18 or later.
      </p>
      <TextField label="Where you saved the bridge" value={bridgePath} onChange={setBridgePath} hint="The full path to sandpiper-mcp-stdio.mjs on the computer that runs the assistant." />
    </div>
  );
  return (
    <Tabs
      label="Configuration for your assistant"
      tabs={[
        {
          key: 'desktop', label: 'Claude Desktop',
          content: (
            <div className="stack">
              {bridge}
              <Snippet label="claude_desktop_config.json" text={claudeDesktop(c)}
                hint="In Claude Desktop open Settings > Developer > Edit Config, add this server to the file (merge it into any existing mcpServers), save, then restart Claude Desktop." />
              <p className="muted">
                Claude&apos;s custom connectors sign in instead of using a token; they work only when this installation is reachable over HTTPS and an administrator
                has switched on sign-in for remote connectors. See <Link to="/help/ai-assistants-and-mcp">AI assistants and MCP</Link>.
              </p>
            </div>
          ),
        },
        {
          key: 'code', label: 'Claude Code',
          content: (
            <div className="stack">
              <Snippet label="Over HTTP (recommended)" text={claudeCodeHttp(c)} hint="Run this in a terminal. Add --scope user to use the server in every project." />
              {bridge}
              <Snippet label="Through the bridge" text={claudeCodeStdio(c)} />
            </div>
          ),
        },
        {
          key: 'other', label: 'Other MCP clients',
          content: (
            <div className="stack">
              <Snippet label="Over HTTP (Streamable HTTP)" text={genericHttp(c)}
                hint="The mcpServers shape used by many editors and agent frameworks. Some name the fields differently (for example a type of &quot;http&quot;, or serverUrl): see the client's documentation." />
              {bridge}
              <Snippet label="As a local command (stdio)" text={genericStdio(c)} />
              <p className="muted">
                Endpoint <code>{c.base}/mcp</code>, header <code>Authorization: Bearer &lt;token&gt;</code>. Requests that carry a browser Origin header are refused.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

/** Configuration for connectors that sign in (OAuth): the address only. */
function ConnectorConfigs() {
  const base = window.location.origin;
  const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  return (
    <div className="stack">
      {!secure && (
        <Notice tone="caution" icon="lock">Sign-in for connectors needs this installation to be opened over HTTPS. Ask an administrator.</Notice>
      )}
      <Snippet label="Address of the server" text={connectorUrl(base)}
        hint="In Claude (claude.ai or Claude Desktop) open Settings > Connectors > Add custom connector, give it a name and this address, then select Connect. You are sent here to sign in and approve it." />
      <Snippet label="Claude Code (signs in when you first use it)" text={claudeCodeOAuth({ base })} hint="Then run /mcp in Claude Code and choose the server to sign in." />
      <Snippet label="Other MCP clients that support OAuth" text={genericOAuth({ base })} />
    </div>
  );
}

/** Tools chosen for one connection: empty means every tool the administrator allows. */
function ToolsField({ tools, value, onChange, error }: { tools: ToolChoice[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  return (
    <ChoicesField
      label="Tools it may use" value={value} onChange={onChange} error={error} placeholder="Every tool allowed here"
      options={tools.map((t) => ({ value: t.name, label: `${t.title}${t.write ? ' (changes records)' : ''}` }))}
      hint="Optional. Leave empty for every tool your administrator allows; choose some to limit this connection to them."
    />
  );
}

function NewConnectionDialog({ open, status, onClose, onCreated }: { open: boolean; status: McpStatus; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [access, setAccess] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState(String(Math.min(90, status.maxDays)));
  const [tools, setTools] = useState<string[]>([]);
  const [sources, setSources] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Created | null>(null);
  const dayOptions = useMemo(() => [...new Set([...DAYS.filter((d) => d <= status.maxDays), status.maxDays])].sort((a, b) => a - b)
    .map((d) => ({ value: String(d), label: `${d} days` })), [status.maxDays]);

  const close = () => { setMade(null); setName(''); setAccess('read'); setTools([]); setSources(''); setErrors({}); setFormError(''); onClose(); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErrors({ name: 'Name the connection, for example "Claude Desktop on my laptop".' }); return; }
    setBusy(true); setErrors({}); setFormError('');
    try {
      const res = await adminApi.post<Created>('/api/mcp/tokens', {
        name: name.trim(), access, expiresInDays: Number(days), tools: tools.length ? tools : null, allowedSources: sourcesFrom(sources),
      });
      setMade(res);
      toast.success('Assistant connection made.');
      onCreated();
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
      <Modal open={open} size="lg" title={`"${made.name}" is ready`} onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
        <div className="stack">
          <Notice tone="caution" role="status">
            <strong>The token is shown once.</strong> Copy the configuration for your assistant now; when you close this window the token cannot be shown again.
          </Notice>
          <CopyBox prominent label="Your assistant's token" copyLabel="Copy token" value={made.token} testId="mcp-token">
            <p className="field-hint">
              {made.access === 'write' ? 'Read and write' : 'Read only'}. Expires {formatDate(made.expires_at)}. Anyone holding it can act as you within these limits: keep it in the assistant&apos;s configuration only.
            </p>
          </CopyBox>
          <ClientConfigs token={made.token} />
        </div>
      </Modal>
    );
  }
  return (
    <Modal open={open} title="Connect an AI assistant" onClose={close}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Name" required maxLength={80} value={name} onChange={(v) => { setName(v); setErrors({}); }} error={errors.name}
          hint="Which assistant and computer, for example “Claude Desktop on my laptop”." />
        <Select
          label="What it may do" required value={access} onChange={(v) => setAccess(v === 'write' ? 'write' : 'read')} error={errors.access}
          options={[
            { value: 'read', label: 'Read only: look things up and summarize' },
            ...(status.canWrite ? [{ value: 'write', label: 'Read and write: also create, update, comment and link' }] : []),
          ]}
          hint={access === 'write' && !status.writeEnabled
            ? 'Write access for AI assistants is switched off by your administrator, so the assistant can only read until it is switched on.'
            : 'Never more than you can do yourself. Nothing can be deleted through an assistant.'}
        />
        <Select label="Expires after" required value={days} onChange={setDays} options={dayOptions} error={errors.expiresInDays} />
        {status.tools && status.tools.length > 0 && <ToolsField tools={status.tools} value={tools} onChange={setTools} error={errors.tools} />}
        <TextArea
          label="Allowed source addresses" rows={2} value={sources} onChange={setSources} error={errors.allowedSources} placeholder="203.0.113.7 or 10.20.0.0/16"
          hint="Optional. The token works only from these addresses or ranges, one per line. For an assistant on this computer use 127.0.0.1 and ::1."
        />
        <Notice icon="lock">This asks for your password if you have not given it in the last few minutes.</Notice>
        <div className="form-actions">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Make token</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Choose the tools of one existing token or connector sign-in. */
function ToolsDialog({ target, tools, onClose, onSaved }: { target: { id: string; name: string; tools: string[] | null } | null; tools: ToolChoice[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = value ?? target?.tools ?? [];
  const close = () => { setValue(null); setError(''); onClose(); };
  const save = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.put(`/api/mcp/tokens/${target.id}/tools`, { tools: current.length ? current : null });
      toast.success(current.length ? `"${target.name}" may use ${current.length} ${current.length === 1 ? 'tool' : 'tools'}.` : `"${target.name}" may use every allowed tool.`);
      close();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.tools ? err.fields.tools : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={target !== null} title={`Tools for "${target?.name ?? ''}"`} onClose={close}
      footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save tools</Button></>}
    >
      <ToolsField tools={tools} value={current} onChange={setValue} error={error} />
    </Modal>
  );
}

export function ConnectAssistantCard() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, error, reload } = useFetch<McpStatus>('/api/mcp/status');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string; kind: 'token' | 'oauth' } | null>(null);
  const [choosing, setChoosing] = useState<{ id: string; name: string; tools: string[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = data?.allowed !== false;

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await adminApi.del(revoking.kind === 'token' ? `/api/me/tokens/${revoking.id}` : `/api/mcp/oauth/grants/${revoking.id}`);
      toast.success(`"${revoking.name}" disconnected. It stops working at once.`);
      setRevoking(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toolsLabel = (tools: string[] | null | undefined) => (tools?.length ? `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}` : 'All allowed tools');
  const connections = data?.connections ?? [];
  const nothing = data ? data.tokens.length === 0 && connections.length === 0 : false;

  return (
    <Card
      title="Connect an AI assistant" flush className="mcp-connect"
      actions={data?.enabled && allowed ? <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>Connect an assistant</Button> : undefined}
    >
      <div className="card-body stack">
        <p className="muted">
          Let an AI assistant such as Claude Desktop, Claude Code or another MCP client look things up and summarize them for you, as you.
          It sees only what you can see. See <Link to="/help/ai-assistants-and-mcp">AI assistants and MCP</Link>.
        </p>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={3} label="Loading your assistant connections" />
          : !data.enabled ? (
            <Notice tone="caution" icon="lock">
              AI assistant access is switched off for this installation.{' '}
              {can('admin.administer') ? <>Switch it on under <Link to="/admin/ai-assistants">AI assistant access</Link>.</> : 'Ask an administrator to switch it on.'}
            </Notice>
          ) : !allowed ? (
            <Notice tone="caution" icon="lock">Your role may not connect AI assistants here. Ask an administrator if you need to.</Notice>
          ) : nothing ? (
            <EmptyState icon="link" title="No assistant connected" message="Connect one to get a token and ready-made configuration." />
          ) : (
            <ul className="mcp-tokens" aria-label="Connected assistants">
              {data.tokens.map((tk) => (
                <li key={tk.id} className="mcp-token">
                  <div className="mcp-token-main">
                    <span className="mcp-token-name">{tk.name} <StatusChip color={writes(tk) ? 'amber' : 'blue'} label={writes(tk) ? 'Read and write' : 'Read only'} /></span>
                    <span className="muted mcp-token-facts">
                      <span><code>{tk.prefix}…</code></span>
                      <span>Expires {formatDate(tk.expires_at)}</span>
                      <span title={tk.last_used_at ? formatDateTime(tk.last_used_at) : undefined}>{tk.last_used_at ? `Last used ${relativeTime(tk.last_used_at)}` : 'Never used'}</span>
                      <span>{tk.calls_30d} {tk.calls_30d === 1 ? 'call' : 'calls'} in 30 days</span>
                      <span>{toolsLabel(tk.tools)}</span>
                      {sourcesText(tk.allowed_sources) && <span title={tk.allowed_sources!.join('\n')}>{sourcesText(tk.allowed_sources)}</span>}
                    </span>
                  </div>
                  <span className="mcp-token-actions">
                    {data.tools && <Button size="sm" variant="ghost" aria-label={`Choose the tools of ${tk.name}`} onClick={() => setChoosing({ id: tk.id, name: tk.name, tools: tk.tools ?? null })}>Tools</Button>}
                    <Button size="sm" aria-label={`Disconnect ${tk.name}`} onClick={() => setRevoking({ id: tk.id, name: tk.name, kind: 'token' })}>Disconnect</Button>
                  </span>
                </li>
              ))}
              {connections.map((c) => (
                <li key={c.id} className="mcp-token">
                  <div className="mcp-token-main">
                    <span className="mcp-token-name">
                      {c.client_name} <StatusChip color="gray" label="Signed in" />
                      <StatusChip color={c.scope.includes('mcp:write') ? 'amber' : 'blue'} label={c.scope.includes('mcp:write') ? 'Read and write' : 'Read only'} />
                    </span>
                    <span className="muted mcp-token-facts">
                      <span>Approved {formatDate(c.created_at)}</span>
                      <span>Until {formatDate(c.expires_at)}</span>
                      <span title={c.last_used_at ? formatDateTime(c.last_used_at) : undefined}>{c.last_used_at ? `Last used ${relativeTime(c.last_used_at)}` : 'Never used'}</span>
                    </span>
                  </div>
                  <span className="mcp-token-actions">
                    <Button size="sm" aria-label={`Disconnect ${c.client_name}`} onClick={() => setRevoking({ id: c.id, name: c.client_name, kind: 'oauth' })}>Disconnect</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        {data?.enabled && allowed && (
          <details className="mcp-fold">
            <summary><Icon name="info" size={16} /> Configuration for an assistant (with a placeholder for the token)</summary>
            <ClientConfigs />
          </details>
        )}
        {data?.enabled && allowed && data.oauthEnabled && (
          <details className="mcp-fold">
            <summary><Icon name="link" size={16} /> Connect a remote connector by signing in (no token needed)</summary>
            <ConnectorConfigs />
          </details>
        )}
      </div>
      {data && <NewConnectionDialog open={creating} status={data} onClose={() => setCreating(false)} onCreated={reload} />}
      {data?.tools && <ToolsDialog target={choosing} tools={data.tools} onClose={() => setChoosing(null)} onSaved={reload} />}
      <ConfirmDialog
        open={revoking !== null} danger busy={busy} title="Disconnect this assistant?" confirmLabel="Disconnect"
        message={<p><strong>{revoking?.name}</strong> stops working at once. The assistant will need a new {revoking?.kind === 'oauth' ? 'sign-in' : 'token'} to connect again.</p>}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}
