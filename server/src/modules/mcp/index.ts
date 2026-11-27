// AI assistant access through the Model Context Protocol (E21). See docs/mcp.md.
//
// - /mcp: the MCP endpoint (http.ts), for personal access tokens carrying the `mcp.use` scope, and
//   for OAuth access tokens of remote connectors (oauth.ts, off by default).
// - /.well-known/oauth-*, /oauth/token, /oauth/register, /oauth/revoke: OAuth 2.1 (oauth.ts).
// - /api/mcp/session: who a token is, for the endpoint (tokens only).
// - /api/mcp/status, /api/mcp/tokens, /api/mcp/oauth/...: the "Connect an AI assistant" page and the
//   consent screen (signed-in people).
// - /api/mcp/admin...: settings, tools, connectors and the per-token call log (administrators, signed in).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import { featureState, ownedOff } from '../../core/features.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { checkSources, issueToken, scopeCovered, tokenScopes } from '../../core/tokens.ts';
import { dataLoadFor, readDataLoad } from '../../core/dataload.ts';
import { reviewerSql } from '../../core/reviewers.ts';
import { registerEndpoint } from './http.ts';
import { oauthBase, registerOAuth, secureBase } from './oauth.ts';
import { chosenTools, hasMcpScope, KEYS, MCP_SCOPE, mayConnect, readSettings, type McpSettings } from './settings.ts';
import type { Session } from './toolkit.ts';
import { ALL_TOOLS, installedTools, toolState } from './tools.ts';

const ADMIN = 'admin.administer';
const TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

/** A signed-in person (never a token) for the routes that make tokens or change settings. */
function sessionOnly(ctx: ModuleContext, req: FastifyRequest) {
  if (req.apiToken) ctx.fail(403, 'token_not_allowed', 'This cannot be done with an API token. Sign in to do it.');
}

/** A list of tool names from a request body: null for "every tool", or an error in words. */
function toolList(value: unknown): { tools: string[] | null } | { error: string } {
  if (value === undefined || value === null) return { tools: null };
  if (!Array.isArray(value)) return { error: 'Give a list of tool names, or null for every tool.' };
  const names = [...new Set(value.map(String))];
  const unknown = names.filter((n) => !TOOL_NAMES.has(n));
  if (unknown.length) return { error: `Unknown tools: ${unknown.join(', ')}.` };
  if (!names.length) return { error: 'Choose at least one tool.' };
  return { tools: names.length === TOOL_NAMES.size ? null : names.sort() };
}

const mod: ModuleDef = {
  key: 'mcp',

  async register(ctx) {
    const { app, db } = ctx;
    const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, what);

    /** The scopes for an assistant token: what the person holds, read only or read and write (never delete). */
    const scopesFor = (perms: string[], access: 'read' | 'write') => {
      const modules = new Set<string>([...ctx.resources.all().map((d) => d.module), 'security', 'reports', 'dashboards']);
      const actions = access === 'write' ? ['view', 'create', 'edit'] : ['view'];
      const out = [...modules].sort().flatMap((m) => actions.map((a) => `${m}.${a}`)).filter((s) => scopeCovered(s, perms));
      // Reading the audit log (search_audit_log) for people who may; never more than viewing.
      if (scopeCovered('audit.view', perms)) out.push('audit.view');
      return [...out, MCP_SCOPE];
    };

    // Who may put mcp.use in any token (also on the API tokens card): E21-17.
    app.registerScopeGate(MCP_SCOPE, async (user) => mayConnect(await readSettings(ctx), user));

    const oauth = registerOAuth(ctx, { scopesFor });

    // ---------- the endpoint and its call log ----------

    let writes = 0;
    registerEndpoint(ctx, oauth, async (s: Session, tool, ok, error, ms, requestId) => {
      await db.query(
        'insert into mcp_calls (token_id, token_name, user_id, tool, ok, error, duration_ms, request_id) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [s.token.id, s.token.name, s.user.id, tool, ok, error, Math.round(ms), requestId || null],
      ).catch((err) => console.error('[mcp] could not log a call:', err));
      if (++writes % 200 === 0) await db.query(`delete from mcp_calls where at < now() - interval '90 days'`).catch(() => undefined);
    });

    const tokenTools = async (tokenId: string): Promise<string[] | null> => {
      const row = await db.one<{ tools: string[] }>('select tools from mcp_token_tools where token_id = $1', [tokenId]);
      return row ? row.tools : null;
    };

    app.get('/api/mcp/session', async (req) => {
      if (!req.apiToken) ctx.fail(403, 'token_required', 'Only a personal access token can be used here.');
      const settings = await readSettings(ctx);
      if (!settings.enabled) ctx.fail(403, 'mcp_disabled', 'AI assistant access is switched off. An administrator can switch it on under Administration > AI assistant access.');
      const scopes = tokenScopes(req) ?? [];
      if (!hasMcpScope(scopes)) {
        ctx.fail(403, 'mcp_scope_missing', `This token was not made for AI assistants (it lacks the "${MCP_SCOPE}" scope). Make one under Account security > Connect an AI assistant.`);
      }
      const u = req.user!;
      if (!mayConnect(settings, u)) ctx.fail(403, 'mcp_not_allowed', 'Your role may not connect AI assistants here. Ask an administrator.');
      const kind = /^Bearer\s+grc_oat_/i.test(String(req.headers.authorization ?? '')) ? 'oauth' : 'token';
      return {
        user: { id: u.id, username: u.username, displayName: u.displayName, email: u.email, roles: u.roles },
        permissions: u.permissions, token: req.apiToken, scopes, kind,
        tools: chosenTools(settings, u.roles, await tokenTools(req.apiToken!.id)),
        // Data load mode (E18-70): on, and whether this token's saves are loads.
        dataLoad: await (async () => {
          const s = await readDataLoad(db, ctx.audit);
          return { on: s.on, until: s.until, allowed: s.on && await dataLoadFor(db, req, ctx.audit) };
        })(),
        settings,
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/session', summary: 'Who an MCP token acts as, and whether it is accepted at /mcp (tokens only)', tag: 'AI assistants' });

    // People by an exact username, email or display name, for the record tools' person fields (E45-46,
    // wave 25). Only exact matches, so it tells no more than the user picker does; active staff
    // accounts only, except in a data load, which may name disabled accounts and outside reviewers.
    app.get('/api/mcp/people', async (req) => {
      if (!req.apiToken) ctx.fail(403, 'token_required', 'Only a personal access token can be used here.');
      const q = String((req.query as Row).q ?? '').trim().slice(0, 250);
      if (!q) return [];
      const load = await dataLoadFor(db, req, ctx.audit);
      const rows = await db.query<Row>(
        `select id, display_name, lower(username) = lower($1) as by_username, lower(coalesce(email, '')) = lower($1) as by_email
         from users u
         where deleted_at is null and (lower(username) = lower($1) or lower(coalesce(email, '')) = lower($1) or lower(display_name) = lower($1))
           ${load ? '' : `and status <> 'disabled' and not ${await reviewerSql(db, 'u.id')}`}
         order by display_name limit 10`, [q]);
      return rows.map((r) => ({ id: r.id, name: r.display_name, by: r.by_username ? 'username' : r.by_email ? 'email' : 'name' }));
    });
    ctx.describeRoute({
      method: 'GET', path: '/api/mcp/people', tag: 'AI assistants', summary: 'Accounts with exactly this username, email or display name (tokens only)',
      query: { q: 'A username, email address or display name (exact, any case).' },
      response: '[{ id, name, by: "username" | "email" | "name" }]',
      description: 'For the assistant tools that fill person fields. Active staff accounts only, except while the token\'s saves are data loads, when disabled accounts count too.',
    });

    // ---------- connecting an assistant (each person) ----------

    const maxDays = async () => Math.max(1, Number(await ctx.settings.get('tokens.max_days', 365)) || 365);

    app.get('/api/mcp/status', async (req) => {
      const settings = await readSettings(ctx);
      const me = req.user!;
      const tokens = await db.query<Row>(
        `select t.id, t.name, t.prefix, t.scopes, t.expires_at, t.last_used_at, t.created_at, coalesce(t.allowed_sources, '[]'::jsonb) as allowed_sources,
                (select count(*)::int from mcp_calls c where c.token_id = t.id and c.at > now() - interval '30 days') as calls_30d,
                (select tools from mcp_token_tools x where x.token_id = t.id) as tools
         from api_tokens t where t.user_id = $1 and t.revoked_at is null and t.expires_at > now()
           and (t.scopes ? 'mcp.use' or t.scopes ? 'mcp.*') order by t.created_at desc`, [me.id]);
      const connections = settings.oauthEnabled ? await oauth.myGrants(me.id) : [];
      return {
        enabled: settings.enabled, writeEnabled: settings.writeEnabled, endpoint: '/mcp', maxDays: await maxDays(),
        canWrite: me.permissions.some((p) => p === '*' || /\.(\*|create|edit)$/.test(p)),
        allowed: mayConnect(settings, me),
        oauthEnabled: settings.enabled && settings.oauthEnabled,
        tools: installedTools(ctx).filter((t) => toolState(t, settings, null, null).offered || t.write).map((t) => ({ name: t.name, title: t.title, write: !!t.write })),
        tokens, connections,
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/status', summary: 'Whether AI assistant access is on and allowed for you, your assistant tokens and connector sign-ins', tag: 'AI assistants' });

    app.post('/api/mcp/tokens', async (req, reply) => {
      sessionOnly(ctx, req);
      const settings = await readSettings(ctx);
      if (!settings.enabled) ctx.fail(409, 'mcp_disabled', 'AI assistant access is switched off. Ask an administrator to switch it on.');
      const me = req.user!;
      if (!mayConnect(settings, me)) ctx.fail(403, 'mcp_not_allowed', 'Your role may not connect AI assistants here. Ask an administrator.');
      const b = (req.body ?? {}) as Row;
      const fields: Record<string, string> = {};
      const name = String(b.name ?? '').trim();
      if (!name || name.length > 80) fields.name = 'Give the connection a name of up to 80 characters, for example the assistant and computer it runs on.';
      else if (await db.one('select 1 from api_tokens where user_id = $1 and lower(name) = lower($2) and revoked_at is null and expires_at > now()', [me.id, name])) {
        fields.name = 'You already have an active token with that name.';
      }
      const access = b.access === 'write' ? 'write' : 'read';
      const limit = await maxDays();
      const days = Number(b.expiresInDays);
      if (!Number.isFinite(days) || days <= 0) fields.expiresInDays = 'Choose when the token expires.';
      else if (days > limit) fields.expiresInDays = `A token may last at most ${limit} days.`;
      const scopes = scopesFor(me.permissions, access);
      if (scopes.length === 1) fields.access = 'You have no permissions an assistant could use.';
      const sources = checkSources(b.allowedSources);
      if ('error' in sources) fields.allowedSources = sources.error;
      const tools = toolList(b.tools);
      if ('error' in tools) fields.tools = tools.error;
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      await recentAuth(req, 'connecting an AI assistant');

      // The same format and storage as every personal access token (core/tokens.ts): shown once, stored as SHA-256.
      const expires = new Date(Date.now() + days * 86_400_000);
      const allowedSources = 'list' in sources ? sources.list : [];
      const { row, token } = await issueToken(db, { userId: me.id, name, scopes, expires, allowedSources });
      const chosen = 'tools' in tools ? tools.tools : null;
      if (chosen) await db.query('insert into mcp_token_tools (token_id, tools) values ($1, $2::jsonb)', [row.id, JSON.stringify(chosen)]);
      await ctx.audit(req, {
        action: 'token.create', recordType: 'api_token', recordId: row.id,
        summary: `API token "${name}" created for an AI assistant (MCP, ${access === 'write' ? 'read and write' : 'read only'}), expiring ${expires.toISOString().slice(0, 10)}`
          + `${chosen ? `, limited to ${chosen.length} tools` : ''}${allowedSources.length ? `, usable from ${allowedSources.join(', ')} only` : ''}`,
        after: { name, scopes, expires_at: expires.toISOString(), ...(chosen ? { tools: chosen } : {}), ...(allowedSources.length ? { allowed_sources: allowedSources } : {}) },
      });
      reply.code(201);
      return { ...row, allowed_sources: allowedSources, tools: chosen, access, token };
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/mcp/tokens', summary: 'Make a personal access token for an AI assistant (signed-in session only; shown once)', tag: 'AI assistants',
      body: '{ name, access: "read" | "write", expiresInDays, tools?: string[] | null, allowedSources?: string[] }',
    });

    app.put('/api/mcp/tokens/:id/tools', async (req) => {
      sessionOnly(ctx, req);
      const id = String((req.params as Row).id ?? '');
      const owned = UUID_RE.test(id) && (
        await db.one(`select 1 from api_tokens where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`, [id, req.user!.id])
        ?? await db.one(`select 1 from mcp_oauth_grants where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`, [id, req.user!.id]));
      if (!owned) ctx.fail(404, 'not_found', 'Connection not found.');
      const tools = toolList(((req.body ?? {}) as Row).tools);
      if ('error' in tools) ctx.fail(400, 'validation', 'Check the highlighted fields.', { tools: tools.error });
      const chosen = (tools as { tools: string[] | null }).tools;
      if (chosen) {
        await db.query(`insert into mcp_token_tools (token_id, tools) values ($1, $2::jsonb)
                        on conflict (token_id) do update set tools = excluded.tools, updated_at = now()`, [id, JSON.stringify(chosen)]);
      } else await db.query('delete from mcp_token_tools where token_id = $1', [id]);
      await ctx.audit(req, { action: 'mcp.tools', recordType: 'api_token', recordId: id, summary: chosen ? `Assistant connection limited to ${chosen.length} tools` : 'Assistant connection may use every allowed tool', after: { tools: chosen } });
      return { tools: chosen };
    });
    ctx.describeRoute({
      method: 'PUT', path: '/api/mcp/tokens/:id/tools', tag: 'AI assistants',
      summary: 'Choose the tools one of your assistant tokens or connector sign-ins may use (null = every allowed tool)', body: '{ tools: string[] | null }',
    });

    // The stdio bridge, for downloading from the "Connect an AI assistant" page.
    app.get('/api/mcp/bridge', async (_req, reply) => {
      const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tools/mcp-stdio.mjs');
      if (!existsSync(file)) ctx.fail(404, 'not_found', 'The bridge script is not part of this installation.');
      reply.header('content-disposition', 'attachment; filename="sandpiper-mcp-stdio.mjs"').type('text/javascript; charset=utf-8');
      return readFileSync(file, 'utf8');
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/bridge', summary: 'Download the stdio bridge script (tools/mcp-stdio.mjs)', tag: 'AI assistants' });

    // ---------- administration ----------

    const adminPre = { preHandler: ctx.requirePerm(ADMIN) };

    /**
     * Roles of switched-off areas (`owns.role`, core/features.ts) are not shown (E18-64): left out of
     * the roles offered and of the settings as read. They stay stored, and saving keeps them.
     */
    const roleOff = async () => { const s = await featureState(db); return (key: string) => ownedOff(s, 'role', key); };
    const shownSettings = async (settings: McpSettings): Promise<McpSettings> => {
      const off = await roleOff();
      return {
        ...settings,
        allowedRoles: settings.allowedRoles ? settings.allowedRoles.filter((k) => !off(k)) : settings.allowedRoles,
        roleTools: Object.fromEntries(Object.entries(settings.roleTools ?? {}).filter(([k]) => !off(k))),
      };
    };

    app.get('/api/mcp/admin', adminPre, async (req) => {
      sessionOnly(ctx, req);
      const settings = await shownSettings(await readSettings(ctx));
      const days = Math.min(90, Math.max(1, Number((req.query as Row).days) || 30));
      const usage = await db.query<Row>(
        `select c.token_id, max(c.token_name) as token_name, c.user_id, max(u.display_name) as user_name,
                count(*)::int as calls, count(*) filter (where not c.ok)::int as errors, max(c.at) as last_at,
                coalesce(bool_or(t.revoked_at is null and t.expires_at > now()), bool_or(g.revoked_at is null and g.expires_at > now())) as active
         from mcp_calls c left join users u on u.id = c.user_id left join api_tokens t on t.id = c.token_id left join mcp_oauth_grants g on g.id = c.token_id
         where c.at > now() - make_interval(days => $1::int)
         group by c.token_id, c.user_id order by max(c.at) desc limit 500`, [days]);
      const perTool = await db.query<Row>(
        `select token_id, tool, count(*)::int as n from mcp_calls where at > now() - make_interval(days => $1::int) group by 1, 2`, [days]);
      const recent = await db.query<Row>(
        `select c.id, c.at, c.token_name, u.display_name as user_name, c.tool, c.ok, c.error, c.duration_ms, c.request_id
         from mcp_calls c left join users u on u.id = c.user_id order by c.at desc, c.id desc limit 50`);
      const tokens = (await db.query<{ n: number }>(
        `select count(*)::int as n from api_tokens where revoked_at is null and expires_at > now() and (scopes ? 'mcp.use' or scopes ? 'mcp.*')`))[0]?.n ?? 0;
      const off = await roleOff();
      const roles = (await db.query<Row>('select key, name, enabled from roles order by name')).filter((r) => !off(r.key));
      return {
        settings, days, activeTokens: tokens, roles,
        tools: installedTools(ctx).map((t) => ({
          name: t.name, title: t.title, group: t.group, write: !!t.write, description: t.description,
          allowed: !settings.allowedTools || settings.allowedTools.includes(t.name),
          offered: toolState(t, settings, null, null).offered,
        })),
        usage: usage.map((u) => ({ ...u, tools: Object.fromEntries(perTool.filter((p) => p.token_id === u.token_id).sort((a, b) => b.n - a.n).map((p) => [p.tool, p.n])) })),
        recent,
        // secure: this installation was reached over HTTPS or on this computer, as OAuth requires.
        // outboundEnabled: connectors known by a metadata document (E21-21) also need outbound connections on.
        oauth: {
          ...(await oauth.adminView()), secure: secureBase(await oauthBase(ctx, req)), base: await oauthBase(ctx, req),
          outboundEnabled: (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true,
        },
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/admin', summary: 'AI assistant access: settings, tools, roles, connectors and the per-token call log', permission: ADMIN, tag: 'AI assistants', query: { days: 'Days of the call log to count (1 to 90, default 30)' } });

    app.put('/api/mcp/admin/settings', adminPre, async (req) => {
      sessionOnly(ctx, req);
      const b = (req.body ?? {}) as Row;
      const current = await readSettings(ctx);
      const fields: Record<string, string> = {};
      const next: Partial<Record<keyof typeof KEYS, unknown>> = {};
      const flag = (key: 'enabled' | 'writeEnabled' | 'oauthEnabled' | 'oauthRegistration' | 'clientMetadata' | 'clientMetadataApproval') => {
        if (b[key] === undefined) return;
        if (typeof b[key] !== 'boolean') fields[key] = 'On or off.';
        else next[key] = b[key];
      };
      flag('enabled'); flag('writeEnabled'); flag('oauthEnabled'); flag('oauthRegistration'); flag('clientMetadata'); flag('clientMetadataApproval');
      if (b.clientMetadataHosts !== undefined) {
        const list = Array.isArray(b.clientMetadataHosts)
          ? [...new Set(b.clientMetadataHosts.map((s: unknown) => String(s).trim().toLowerCase()).filter(Boolean))] as string[] : null;
        const bad = list?.find((h) => !/^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/.test(h) && !/^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(h));
        if (!list || list.length > 50) fields.clientMetadataHosts = 'List up to 50 hosts.';
        else if (bad) fields.clientMetadataHosts = `"${bad}" is not a host. Write a host name (assistant.example.org), a host and port, or *.example.org.`;
        else next.clientMetadataHosts = list;
      }
      if (b.allowedTools !== undefined) {
        const r = toolList(b.allowedTools);
        if ('error' in r) fields.allowedTools = r.error;
        else next.allowedTools = r.tools;
      }
      if (b.ratePerMinute !== undefined) {
        const n = Number(b.ratePerMinute);
        if (!Number.isInteger(n) || n < 1 || n > 6000) fields.ratePerMinute = 'A whole number from 1 to 6000.';
        else next.ratePerMinute = n;
      }
      if (b.allowedOrigins !== undefined) {
        const list = Array.isArray(b.allowedOrigins) ? [...new Set(b.allowedOrigins.map((s: unknown) => String(s).trim()).filter(Boolean))] as string[] : null;
        const bad = list?.find((o) => { try { const u = new URL(o); return u.origin !== o; } catch { return true; } });
        if (!list || list.length > 20) fields.allowedOrigins = 'List up to 20 origins.';
        else if (bad) fields.allowedOrigins = `"${bad}" is not an origin. Write it as scheme, host and port only, e.g. https://tools.example.org.`;
        else next.allowedOrigins = list;
      }
      const off = await roleOff();
      const roleKeys = new Set((await db.query<{ key: string }>('select key from roles')).map((r) => r.key).filter((k) => !off(k)));
      if (b.allowedRoles !== undefined) {
        if (b.allowedRoles === null) next.allowedRoles = null;
        else if (!Array.isArray(b.allowedRoles)) fields.allowedRoles = 'Give a list of roles, or null for everyone.';
        else {
          const keys = [...new Set(b.allowedRoles.map(String))].sort() as string[];
          const unknown = keys.filter((k) => !roleKeys.has(k));
          if (unknown.length) fields.allowedRoles = `Unknown roles: ${unknown.join(', ')}.`;
          else if (!keys.length) fields.allowedRoles = 'Choose at least one role, or allow everyone.';
          else next.allowedRoles = [...new Set([...keys, ...(current.allowedRoles ?? []).filter(off)])].sort();
        }
      }
      if (b.roleTools !== undefined) {
        if (!b.roleTools || typeof b.roleTools !== 'object' || Array.isArray(b.roleTools)) fields.roleTools = 'Give tools per role, for example { "agent": ["search"] }.';
        else {
          const out: Record<string, string[]> = {};
          for (const [role, list] of Object.entries(b.roleTools as Record<string, unknown>)) {
            if (!roleKeys.has(role)) { fields.roleTools = `Unknown role: ${role}.`; break; }
            if (list === null) continue;
            const r = toolList(list);
            if ('error' in r) { fields.roleTools = `${role}: ${r.error}`; break; }
            if (r.tools) out[role] = r.tools;
          }
          for (const [role, list] of Object.entries(current.roleTools ?? {})) if (off(role)) out[role] = list;
          if (!fields.roleTools) next.roleTools = out;
        }
      }
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const changed = (Object.keys(next) as (keyof typeof KEYS)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k as keyof McpSettings]));
      if (changed.length) {
        await recentAuth(req, 'changing AI assistant access');
        for (const k of changed) await ctx.settings.set(KEYS[k], next[k], req);
      }
      return shownSettings(await readSettings(ctx));
    });
    ctx.describeRoute({
      method: 'PUT', path: '/api/mcp/admin/settings', summary: 'Change AI assistant access (needs a recent password confirmation)', permission: ADMIN, tag: 'AI assistants',
      body: '{ enabled?, writeEnabled?, allowedTools?: string[] | null, ratePerMinute?, allowedOrigins?: string[], allowedRoles?: string[] | null, roleTools?: { [role]: string[] | null }, oauthEnabled?, oauthRegistration?, clientMetadata?, clientMetadataHosts?: string[], clientMetadataApproval? }',
    });
  },
};
export default mod;
