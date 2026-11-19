import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleContext } from '../../core/module.ts';
import { clientIp, isHttps } from '../../core/request.ts';
import { makeCaller } from './caller.ts';
import { buildServer } from './server.ts';
import type { McpSettings } from './settings.ts';
import { makeToolContext, type Session } from './toolkit.ts';

/**
 * The MCP endpoint: Streamable HTTP at POST /mcp (stateless; GET and DELETE answer 405 because the
 * server keeps no sessions and sends nothing unasked).
 *
 * Security, in order:
 * 1. Any Origin header that is not explicitly allowed is refused (browsers send one; MCP clients do not),
 *    which also defeats DNS rebinding.
 * 2. Only `Authorization: Bearer grc_pat_...` is accepted; the session cookie is never read, so a web
 *    page cannot drive this endpoint. The token is checked by the core, exactly as for /api, through
 *    GET /api/mcp/session (in-process), which also refuses a token without the mcp scope or while
 *    AI assistant access is off.
 * 3. A per-token request limit (setting mcp.rate_per_minute) on top of the core's token limit.
 * 4. Each tool then calls the /api routes in-process with the same token.
 */

const windows = new Map<string, { minute: number; count: number }>();

function rpcError(reply: FastifyReply, status: number, message: string, code = -32001, headers: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  // Sent as text so that no general error-envelope hook reshapes the JSON-RPC error.
  return reply.code(status).type('application/json').send(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

export async function baseUrl(ctx: ModuleContext, req: FastifyRequest): Promise<string> {
  const configured = String(await ctx.settings.get<unknown>('auth.public_url', '') ?? '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host ?? '127.0.0.1'}`;
}

export function registerEndpoint(ctx: ModuleContext, log: (session: Session, tool: string, ok: boolean, error: string | null, ms: number) => Promise<void>) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const allowed = await ctx.settings.get<unknown>('mcp.allowed_origins', []);
      if (!Array.isArray(allowed) || !allowed.includes(origin)) {
        return rpcError(reply, 403, 'Requests from web pages are not accepted here. Connect with an MCP client and a personal access token.');
      }
    }
    const authorization = req.headers.authorization;
    if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
      return rpcError(reply, 401, 'Send a personal access token: "Authorization: Bearer grc_pat_...". Make one under Account security > Connect an AI assistant.',
        -32001, { 'www-authenticate': 'Bearer realm="sandpiper-grc"' });
    }
    const ip = clientIp(req);
    const who = await ctx.app.inject({ method: 'GET', url: '/api/mcp/session', headers: { authorization }, remoteAddress: ip });
    if (who.statusCode !== 200) {
      let message = 'The token was refused.';
      try { message = who.json().error?.message ?? message; } catch { /* keep the default */ }
      return rpcError(reply, who.statusCode, message, -32001, who.statusCode === 401 ? { 'www-authenticate': 'Bearer realm="sandpiper-grc", error="invalid_token"' } : {});
    }
    const { settings, ...session } = who.json() as Session & { settings: McpSettings };

    const minute = Math.floor(Date.now() / 60_000);
    const w = windows.get(session.token.id);
    if (!w || w.minute !== minute) windows.set(session.token.id, { minute, count: 1 });
    else if (++w.count > settings.ratePerMinute) {
      return rpcError(reply, 429, `This token may make ${settings.ratePerMinute} AI assistant requests a minute. Wait a moment and try again.`, -32001, { 'retry-after': '60' });
    }
    if (windows.size > 5000) for (const [k, v] of windows) if (v.minute !== minute) windows.delete(k);

    if (req.method !== 'POST') {
      return rpcError(reply, 405, 'This server keeps no sessions and sends nothing unasked: use POST.', -32000, { allow: 'POST' });
    }

    // The request now acts as the token's owner, for the audit events the tools write.
    req.user = { ...session.user, permissions: session.permissions };
    req.apiToken = session.token;
    const api = makeCaller(ctx.app, authorization, ip);
    const t = makeToolContext(ctx, api, session, await baseUrl(ctx, req));
    const server = buildServer(ctx, settings, t, req, (tool, ok, error, ms) => log(session, tool, ok, error, ms));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.setHeader('x-content-type-options', 'nosniff');
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  };
  ctx.app.route({ method: ['GET', 'POST', 'DELETE'], url: '/mcp', handler });
}
