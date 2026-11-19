import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ModuleContext } from '../../core/module.ts';
import { ToolError } from './caller.ts';
import { PROMPTS } from './prompts.ts';
import type { McpSettings } from './settings.ts';
import type { ToolContext, ToolResult, ToolSpec } from './toolkit.ts';
import { RECORD_TOOLS } from './tools-records.ts';
import { offeredTools } from './tools.ts';

export const SERVER_NAME = 'sandpiper-grc';
export const SERVER_VERSION = '1.0.0';

const GUIDE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/user');

/** The user guide pages, read once: { slug, title, file }. */
let guide: { slug: string; title: string; file: string }[] | null = null;
export function guidePages() {
  if (guide) return guide;
  guide = existsSync(GUIDE_DIR)
    ? readdirSync(GUIDE_DIR).filter((f) => /^\d+-.+\.md$/.test(f)).sort().map((f) => {
      const text = readFileSync(join(GUIDE_DIR, f), 'utf8');
      return { slug: f.replace(/\.md$/, ''), title: /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? f, file: join(GUIDE_DIR, f) };
    })
    : [];
  return guide;
}

export interface CallLog { (tool: string, ok: boolean, error: string | null, ms: number): Promise<void> }

const INSTRUCTIONS = 'Sandpiper GRC: governance, risk and compliance for a transit organisation (service desk, inventory, changes, vendors and contracts, '
  + 'cybersecurity frameworks, risks, security incidents, policies, vulnerabilities, projects, safety and reports). '
  + 'Every call acts as the person who owns the access token, with no more rights than they have; records they may not see do not exist for you. '
  + 'Start with list_record_types or search; use my_work for "what should I do". Cite references (e.g. TKT-00012) and the url of each record you mention. '
  + 'Nothing can be deleted through this connection.';

function errorResult(err: unknown) {
  if (err instanceof ToolError) {
    const fields = err.fields && Object.keys(err.fields).length ? `\n${Object.entries(err.fields).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '';
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${err.message}${fields}` }],
      structuredContent: { error: { code: err.code, status: err.status, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
    };
  }
  console.error('[mcp] tool failed:', err);
  return { isError: true, content: [{ type: 'text' as const, text: 'Something went wrong on the server. The error has been logged.' }], structuredContent: { error: { code: 'server_error' } } };
}

/** One MCP server for one HTTP request (stateless): only the tools this caller is offered are registered. */
export function buildServer(ctx: ModuleContext, settings: McpSettings, t: ToolContext, req: FastifyRequest, log: CallLog): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: 'Sandpiper GRC' }, { instructions: INSTRUCTIONS });

  const run = async (tool: ToolSpec, args: unknown) => {
    const started = Date.now();
    try {
      const result: ToolResult = await tool.run(args ?? {}, t);
      await log(tool.name, true, null, Date.now() - started);
      if (tool.write && result.audit) {
        await ctx.audit(req, {
          action: 'mcp.write', recordType: result.audit.recordType, recordId: result.audit.recordId,
          summary: `${result.audit.summary} via MCP (tool ${tool.name}) with API token "${t.session.token.name}"`,
        });
      }
      return { content: [{ type: 'text' as const, text: result.text }], structuredContent: result.data };
    } catch (err) {
      await log(tool.name, false, err instanceof ToolError ? `${err.code}: ${err.message}`.slice(0, 300) : 'server_error', Date.now() - started);
      return errorResult(err);
    }
  };

  for (const tool of offeredTools(ctx, settings, t.session)) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: {
        title: tool.title,
        readOnlyHint: !tool.write,
        destructiveHint: false,
        idempotentHint: !!tool.idempotent,
        openWorldHint: false,
      },
    }, ((args: unknown) => run(tool, args)) as any);
  }

  // ---- resources: the user guide, and any record by type and id

  for (const page of guidePages()) {
    server.registerResource(page.slug, `sandpiper://guide/${page.slug}`, { title: `User guide: ${page.title}`, description: `The "${page.title}" page of the Sandpiper GRC user guide.`, mimeType: 'text/markdown' },
      async (uri) => {
        await log('read_resource', true, null, 0);
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(page.file, 'utf8') }] };
      });
  }

  const getRecord = RECORD_TOOLS.find((x) => x.name === 'get_record')!;
  server.registerResource('record', new ResourceTemplate('sandpiper://record/{type}/{id}', { list: undefined }), {
    title: 'A record', description: 'Any record you may see, by record type and id or reference, as JSON (the same as the get_record tool).', mimeType: 'application/json',
  }, async (uri, vars) => {
    const started = Date.now();
    try {
      const r = await getRecord.run({ type: decodeURIComponent(String(vars.type)), id: decodeURIComponent(String(vars.id)) }, t);
      await log('read_resource', true, null, Date.now() - started);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(r.data, null, 2) }] };
    } catch (err) {
      await log('read_resource', false, err instanceof ToolError ? `${err.code}: ${err.message}`.slice(0, 300) : 'server_error', Date.now() - started);
      // Not found and not allowed look the same: a record the person may not see does not exist for them.
      throw new Error(err instanceof ToolError ? err.message : 'The record could not be read.');
    }
  });

  // ---- prompts

  for (const p of PROMPTS) {
    const shape = Object.fromEntries(Object.entries(p.args).map(([k, d]) => [k, z.string().optional().describe(d)]));
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: shape }, ((args: Record<string, string | undefined>) => ({
      description: p.description,
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text(args ?? {}) } }],
    })) as any);
  }

  return server;
}
