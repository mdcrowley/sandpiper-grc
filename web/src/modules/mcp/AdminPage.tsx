// Administration > AI assistant access: switch MCP on and off, allow writes, choose the tools, and see
// the per-token call log. Changes ask for the password again (the server requires a recent confirmation).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, NumberField, PageHeader,
  relativeTime, StatusChip, Switch, TextArea, useFetch, useToast,
} from '../../core';
import { Notice } from '../admin/common';
import { withReauth } from '../admin/reauth';
import './mcp.css';

interface Settings { enabled: boolean; writeEnabled: boolean; allowedTools: string[] | null; ratePerMinute: number; allowedOrigins: string[] }
interface Tool { name: string; title: string; group: string; write: boolean; description: string; allowed: boolean; offered: boolean }
interface Usage { token_id: string; token_name: string; user_name: string | null; calls: number; errors: number; last_at: string; active: boolean | null; tools: Record<string, number> }
interface Call { id: number; at: string; token_name: string; user_name: string | null; tool: string; ok: boolean; error: string | null; duration_ms: number }
interface AdminData { settings: Settings; days: number; activeTokens: number; tools: Tool[]; usage: Usage[]; recent: Call[] }

export function AdminAssistantsPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<AdminData>('/api/mcp/admin');
  const [busy, setBusy] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [rate, setRate] = useState<number | null>(null);
  const [origins, setOrigins] = useState('');

  useEffect(() => {
    if (!data) return;
    setAllowed(new Set(data.tools.filter((t) => t.allowed).map((t) => t.name)));
    setRate(data.settings.ratePerMinute);
    setOrigins(data.settings.allowedOrigins.join('\n'));
  }, [data]);

  const save = async (what: string, body: Partial<Settings>, done: string) => {
    setBusy(what);
    try {
      await withReauth(() => api.put('/api/mcp/admin/settings', body));
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const out = new Map<string, Tool[]>();
    for (const t of data?.tools ?? []) out.set(t.group, [...(out.get(t.group) ?? []), t]);
    return [...out.entries()];
  }, [data]);
  const toolsChanged = data ? data.tools.some((t) => t.allowed !== allowed.has(t.name)) : false;

  return (
    <div className="mcp-page">
      <PageHeader
        title="AI assistant access"
        subtitle="Let people use Sandpiper GRC from AI assistants such as Claude Desktop, Claude Code and other MCP clients, as themselves and within their own permissions."
        actions={<Link className="btn btn-secondary" to="/account/ai-assistant">Connect my assistant</Link>}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={10} label="Loading AI assistant access" /> : (
        <div className="stack">
          <Card title="Access" actions={<StatusChip color={data.settings.enabled ? 'green' : 'gray'} label={data.settings.enabled ? 'On' : 'Off'} />}>
            <div className="stack">
              <Switch
                label="AI assistant access (MCP)" checked={data.settings.enabled} disabled={busy !== null}
                onChange={(on) => void save('enabled', { enabled: on }, on ? 'AI assistant access switched on.' : 'AI assistant access switched off.')}
                hint="When on, people can make a token for an assistant (Account security > Connect an AI assistant) and the assistant can use the /mcp endpoint. When off, every assistant is refused at once."
              />
              <Switch
                label="Write access for AI assistants" checked={data.settings.writeEnabled} disabled={busy !== null || !data.settings.enabled}
                onChange={(on) => void save('write', { writeEnabled: on }, on ? 'Assistants with a read-and-write token may now create and change records.' : 'Assistants can now only read.')}
                hint="When on, assistants whose token allows it may create and update records, comment and link. Deleting is never possible through an assistant."
              />
              <div className="mcp-row">
                <NumberField label="Requests a minute per token" min={1} max={6000} step={1} value={rate} onChange={setRate}
                  hint="On top of the general limit for API tokens." />
                <Button disabled={rate === null || rate === data.settings.ratePerMinute} loading={busy === 'rate'}
                  onClick={() => void save('rate', { ratePerMinute: Number(rate) }, 'Request limit saved.')}>Save limit</Button>
              </div>
              <p className="muted">
                Endpoint: <code>{window.location.origin}/mcp</code>. {data.activeTokens} active assistant {data.activeTokens === 1 ? 'token' : 'tokens'}; see them all under{' '}
                <Link to="/admin/tokens">API tokens</Link> (their permissions include <code>mcp.use</code>).
              </p>
            </div>
          </Card>

          <Card
            title="Tools" flush
            actions={(
              <span className="row">
                <Button size="sm" variant="ghost" onClick={() => setAllowed(new Set(data.tools.map((t) => t.name)))}>Allow all</Button>
                <Button size="sm" variant="primary" disabled={!toolsChanged} loading={busy === 'tools'}
                  onClick={() => void save('tools', { allowedTools: allowed.size === data.tools.length ? null : [...allowed] }, 'Allowed tools saved.')}>Save tools</Button>
              </span>
            )}
          >
            <div className="card-body">
              <p className="muted">
                Only allowed tools are offered to assistants. Each tool also needs the person&apos;s own permissions; tools that change records also need write access above.
              </p>
            </div>
            <div className="table-wrap">
              <table className="table mcp-tools">
                <thead><tr><th scope="col">Allowed</th><th scope="col">Tool</th><th scope="col">Kind</th><th scope="col">What it does</th></tr></thead>
                {groups.map(([group, tools]) => (
                  <tbody key={group}>
                    <tr className="mcp-group"><th scope="rowgroup" colSpan={4}>{group}</th></tr>
                    {tools.map((t) => (
                      <tr key={t.name}>
                        <td>
                          <input
                            type="checkbox" className="mcp-check" aria-label={`Allow ${t.title}`} checked={allowed.has(t.name)}
                            onChange={(e) => { const on = e.currentTarget.checked; setAllowed((s) => { const n = new Set(s); if (on) n.add(t.name); else n.delete(t.name); return n; }); }}
                          />
                        </td>
                        <td className="mcp-tool-name"><strong>{t.title}</strong><div><code>{t.name}</code></div></td>
                        <td>{t.write ? <Badge color="amber">Changes records</Badge> : <Badge color="blue">Read only</Badge>}</td>
                        <td className="mcp-desc" title={t.description}>{t.description.split(/(?<=\.) (?=[A-Z])/)[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Card>

          <Card title={`Call log, last ${data.days} days`} flush>
            {data.usage.length === 0 ? (
              <EmptyState icon="history" title="No calls yet" message="Calls made by assistants appear here, per token." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Token</th><th scope="col">Owner</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Errors</th><th scope="col">Last call</th><th scope="col">Most used tools</th></tr></thead>
                  <tbody>
                    {data.usage.map((u) => (
                      <tr key={u.token_id}>
                        <td><strong>{u.token_name}</strong>{u.active === false && <> <StatusChip color="gray" label="Revoked or expired" /></>}</td>
                        <td>{u.user_name ?? 'Unknown'}</td>
                        <td className="num">{u.calls}</td>
                        <td className="num">{u.errors}</td>
                        <td title={formatDateTime(u.last_at)}>{relativeTime(u.last_at)}</td>
                        <td className="mcp-desc">{Object.entries(u.tools).slice(0, 4).map(([k, n]) => `${k} (${n})`).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.recent.length > 0 && (
              <details className="mcp-fold card-body">
                <summary>Latest {data.recent.length} calls</summary>
                <ul className="mcp-calls">
                  {data.recent.map((c) => (
                    <li key={c.id}>
                      <StatusChip color={c.ok ? 'green' : 'red'} label={c.ok ? 'OK' : 'Failed'} />
                      <code>{c.tool}</code>
                      <span>{c.token_name} ({c.user_name ?? 'Unknown'})</span>
                      <span className="muted" title={formatDateTime(c.at)}>{relativeTime(c.at)}, {c.duration_ms} ms</span>
                      {c.error && <span className="muted mcp-error">{c.error}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>

          <Card title="Browser origins">
            <div className="stack">
              <Notice>
                Requests that carry a browser <code>Origin</code> header are refused, so a web page cannot use someone&apos;s token. List an origin here only for a
                browser-based MCP client you trust.
              </Notice>
              <TextArea label="Allowed origins" rows={2} value={origins} onChange={setOrigins} placeholder="https://tools.example.org" hint="One per line: scheme, host and port only. Usually empty." />
              <div>
                <Button loading={busy === 'origins'} disabled={origins.split('\n').map((s) => s.trim()).filter(Boolean).join('\n') === data.settings.allowedOrigins.join('\n')}
                  onClick={() => void save('origins', { allowedOrigins: origins.split('\n').map((s) => s.trim()).filter(Boolean) }, 'Allowed origins saved.')}>Save origins</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
