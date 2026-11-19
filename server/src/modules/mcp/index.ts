// AI assistant access through the Model Context Protocol (E21). See docs/mcp.md.
//
// - /mcp: the MCP endpoint (http.ts), for personal access tokens carrying the `mcp.use` scope.
// - /api/mcp/session: who a token is, for the endpoint (tokens only).
// - /api/mcp/status, /api/mcp/tokens: the "Connect an AI assistant" page (signed-in people).
// - /api/mcp/admin...: settings, tools and the per-token call log (administrators, signed in).
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth } from '../../core/auth.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { scopeCovered, TOKEN_PREFIX } from '../../core/tokens.ts';
import { registerEndpoint } from './http.ts';
import { hasMcpScope, KEYS, MCP_SCOPE, readSettings } from './settings.ts';
import type { Session } from './toolkit.ts';
import { ALL_TOOLS, toolState } from './tools.ts';

const ADMIN = 'admin.administer';

/** A signed-in person (never a token) for the routes that make tokens or change settings. */
function sessionOnly(ctx: ModuleContext, req: FastifyRequest) {
  if (req.apiToken) ctx.fail(403, 'token_not_allowed', 'This cannot be done with an API token. Sign in to do it.');
}

const mod: ModuleDef = {
  key: 'mcp',

  async register(ctx) {
    const { app, db } = ctx;

    // ---------- the endpoint and its call log ----------

    let writes = 0;
    registerEndpoint(ctx, async (s: Session, tool, ok, error, ms) => {
      await db.query(
        'insert into mcp_calls (token_id, token_name, user_id, tool, ok, error, duration_ms) values ($1,$2,$3,$4,$5,$6,$7)',
        [s.token.id, s.token.name, s.user.id, tool, ok, error, Math.round(ms)],
      ).catch((err) => console.error('[mcp] could not log a call:', err));
      if (++writes % 200 === 0) await db.query(`delete from mcp_calls where at < now() - interval '90 days'`).catch(() => undefined);
    });

    app.get('/api/mcp/session', async (req) => {
      if (!req.apiToken) ctx.fail(403, 'token_required', 'Only a personal access token can be used here.');
      const settings = await readSettings(ctx);
      if (!settings.enabled) ctx.fail(403, 'mcp_disabled', 'AI assistant access is switched off. An administrator can switch it on under Administration > AI assistant access.');
      const row = await db.one<{ scopes: string[] }>('select scopes from api_tokens where id = $1', [req.apiToken!.id]);
      const scopes = (row?.scopes ?? []) as string[];
      if (!hasMcpScope(scopes)) {
        ctx.fail(403, 'mcp_scope_missing', `This token was not made for AI assistants (it lacks the "${MCP_SCOPE}" scope). Make one under Account security > Connect an AI assistant.`);
      }
      const u = req.user!;
      return {
        user: { id: u.id, username: u.username, displayName: u.displayName, email: u.email, roles: u.roles },
        permissions: u.permissions, token: req.apiToken, scopes, settings,
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/session', summary: 'Who an MCP token acts as, and whether it is accepted at /mcp (tokens only)', tag: 'AI assistants' });

    // ---------- connecting an assistant (each person) ----------

    const maxDays = async () => Math.max(1, Number(await ctx.settings.get('tokens.max_days', 365)) || 365);

    app.get('/api/mcp/status', async (req) => {
      const settings = await readSettings(ctx);
      const tokens = await db.query<Row>(
        `select t.id, t.name, t.prefix, t.scopes, t.expires_at, t.last_used_at, t.created_at,
                (select count(*)::int from mcp_calls c where c.token_id = t.id and c.at > now() - interval '30 days') as calls_30d
         from api_tokens t where t.user_id = $1 and t.revoked_at is null and t.expires_at > now()
           and (t.scopes ? 'mcp.use' or t.scopes ? 'mcp.*') order by t.created_at desc`, [req.user!.id]);
      return {
        enabled: settings.enabled, writeEnabled: settings.writeEnabled, endpoint: '/mcp', maxDays: await maxDays(),
        canWrite: req.user!.permissions.some((p) => p === '*' || /\.(\*|create|edit)$/.test(p)),
        tokens,
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/status', summary: 'Whether AI assistant access is on, and your own assistant tokens', tag: 'AI assistants' });

    /** The scopes for an assistant token: what the person holds, read only or read and write (never delete). */
    const scopesFor = (perms: string[], access: 'read' | 'write') => {
      const modules = new Set<string>([...ctx.resources.all().map((d) => d.module), 'security', 'reports', 'dashboards']);
      const actions = access === 'write' ? ['view', 'create', 'edit'] : ['view'];
      const out = [...modules].sort().flatMap((m) => actions.map((a) => `${m}.${a}`)).filter((s) => scopeCovered(s, perms));
      return [...out, MCP_SCOPE];
    };

    app.post('/api/mcp/tokens', async (req, reply) => {
      sessionOnly(ctx, req);
      const settings = await readSettings(ctx);
      if (!settings.enabled) ctx.fail(409, 'mcp_disabled', 'AI assistant access is switched off. Ask an administrator to switch it on.');
      const b = (req.body ?? {}) as Row;
      const me = req.user!;
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
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'connecting an AI assistant');

      // The same format and storage as core personal access tokens (core/tokens.ts): shown once, stored as SHA-256.
      const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + days * 86_400_000);
      const row = await db.one<Row>(
        `insert into api_tokens (user_id, name, token_hash, prefix, scopes, expires_at) values ($1,$2,$3,$4,$5::jsonb,$6)
         returning id, name, prefix, scopes, expires_at, created_at`,
        [me.id, name, createHash('sha256').update(token).digest('hex'), token.slice(0, TOKEN_PREFIX.length + 6), JSON.stringify(scopes), expires.toISOString()],
      );
      await ctx.audit(req, {
        action: 'token.create', recordType: 'api_token', recordId: row!.id,
        summary: `API token "${name}" created for an AI assistant (MCP, ${access === 'write' ? 'read and write' : 'read only'}), expiring ${expires.toISOString().slice(0, 10)}`,
        after: { name, scopes, expires_at: expires.toISOString() },
      });
      reply.code(201);
      return { ...row, access, token };
    });
    ctx.describeRoute({
      method: 'POST', path: '/api/mcp/tokens', summary: 'Make a personal access token for an AI assistant (signed-in session only; shown once)', tag: 'AI assistants',
      body: '{ name, access: "read" | "write", expiresInDays }',
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

    app.get('/api/mcp/admin', adminPre, async (req) => {
      sessionOnly(ctx, req);
      const settings = await readSettings(ctx);
      const days = Math.min(90, Math.max(1, Number((req.query as Row).days) || 30));
      const usage = await db.query<Row>(
        `select c.token_id, max(c.token_name) as token_name, c.user_id, max(u.display_name) as user_name,
                count(*)::int as calls, count(*) filter (where not c.ok)::int as errors, max(c.at) as last_at,
                bool_or(t.revoked_at is null and t.expires_at > now()) as active
         from mcp_calls c left join users u on u.id = c.user_id left join api_tokens t on t.id = c.token_id
         where c.at > now() - make_interval(days => $1::int)
         group by c.token_id, c.user_id order by max(c.at) desc limit 500`, [days]);
      const perTool = await db.query<Row>(
        `select token_id, tool, count(*)::int as n from mcp_calls where at > now() - make_interval(days => $1::int) group by 1, 2`, [days]);
      const recent = await db.query<Row>(
        `select c.id, c.at, c.token_name, u.display_name as user_name, c.tool, c.ok, c.error, c.duration_ms
         from mcp_calls c left join users u on u.id = c.user_id order by c.at desc, c.id desc limit 50`);
      const tokens = (await db.query<{ n: number }>(
        `select count(*)::int as n from api_tokens where revoked_at is null and expires_at > now() and (scopes ? 'mcp.use' or scopes ? 'mcp.*')`))[0]?.n ?? 0;
      return {
        settings, days, activeTokens: tokens,
        tools: ALL_TOOLS.map((t) => ({
          name: t.name, title: t.title, group: t.group, write: !!t.write, description: t.description,
          allowed: !settings.allowedTools || settings.allowedTools.includes(t.name),
          offered: toolState(t, settings, null, null).offered,
        })),
        usage: usage.map((u) => ({ ...u, tools: Object.fromEntries(perTool.filter((p) => p.token_id === u.token_id).sort((a, b) => b.n - a.n).map((p) => [p.tool, p.n])) })),
        recent,
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/mcp/admin', summary: 'AI assistant access: settings, tools and the per-token call log', permission: ADMIN, tag: 'AI assistants', query: { days: 'Days of the call log to count (1 to 90, default 30)' } });

    app.put('/api/mcp/admin/settings', adminPre, async (req) => {
      sessionOnly(ctx, req);
      const b = (req.body ?? {}) as Row;
      const current = await readSettings(ctx);
      const fields: Record<string, string> = {};
      const next: Partial<Record<keyof typeof KEYS, unknown>> = {};
      if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') fields.enabled = 'On or off.'; else next.enabled = b.enabled; }
      if (b.writeEnabled !== undefined) { if (typeof b.writeEnabled !== 'boolean') fields.writeEnabled = 'On or off.'; else next.writeEnabled = b.writeEnabled; }
      if (b.allowedTools !== undefined) {
        if (b.allowedTools === null) next.allowedTools = null;
        else if (!Array.isArray(b.allowedTools)) fields.allowedTools = 'Give a list of tool names, or null for every tool.';
        else {
          const names = [...new Set(b.allowedTools.map(String))] as string[];
          const unknown = names.filter((n) => !ALL_TOOLS.some((t) => t.name === n));
          if (unknown.length) fields.allowedTools = `Unknown tools: ${unknown.join(', ')}.`;
          else next.allowedTools = names.length === ALL_TOOLS.length ? null : names;
        }
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
      if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
      const changed = (Object.keys(next) as (keyof typeof KEYS)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
      if (changed.length) {
        await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'changing AI assistant access');
        for (const k of changed) await ctx.settings.set(KEYS[k], next[k], req);
      }
      return readSettings(ctx);
    });
    ctx.describeRoute({
      method: 'PUT', path: '/api/mcp/admin/settings', summary: 'Change AI assistant access (needs a recent password confirmation)', permission: ADMIN, tag: 'AI assistants',
      body: '{ enabled?, writeEnabled?, allowedTools?: string[] | null, ratePerMinute?, allowedOrigins?: string[] }',
    });
  },
};
export default mod;
