import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ModuleContext } from '../../core/module.ts';
import { ToolError } from './caller.ts';
import { guidePages, guideText } from './guide.ts';
import { PROMPTS } from './prompts.ts';
import type { McpSettings } from './settings.ts';
import type { ToolContext, ToolResult, ToolSpec } from './toolkit.ts';
import { RECORD_TOOLS } from './tools-records.ts';
import { localImportOn, offeredTools } from './tools.ts';

export { guidePages } from './guide.ts';

export const SERVER_NAME = 'sandpiper-grc';
export const SERVER_VERSION = '1.0.0';

/** What the SDK passes a tool handler besides its arguments (the parts used here). */
interface ToolExtra {
  _meta?: { progressToken?: string | number };
  sendNotification?: (n: { method: 'notifications/progress'; params: Record<string, unknown> }) => Promise<void>;
}

export interface CallLog { (tool: string, ok: boolean, error: string | null, ms: number): Promise<void> }

/**
 * How to build records completely when creating them from sources (E45-50, wave 25): the product owner
 * found assistants putting structured facts into descriptions and leaving files and links out.
 */
export const COMPLETENESS = 'When you create or update records from sources (files, spreadsheets, emails, another system), build each record as completely as the source allows: '
  + 'call list_record_types for the type first, then fill every field the source supports (people, dates, categories, statuses, linked records, custom fields) instead of writing those facts into the description or notes; '
  + 'set reference and person fields directly (a linked record by its reference or exact title, a person by username, email or name; the answer says what each was matched to); '
  + 'create the child records list_record_types names as related types (contacts, line items, tasks and so on) and link related records with link_records; '
  + 'attach the source files (start_upload, upload_part, finish_upload, then attach_file; or attach_local_file when the server may read them from its own folders) or links (attach_link); '
  + 'add the record\'s history as comments (add_comment), one per entry; '
  + 'read "unfilled" and "related_empty" in each create_record and update_record answer, and finish by reporting what you could not place and why. The prompt load_records_from_sources walks through this.';

const INSTRUCTIONS = 'Sandpiper GRC: governance, risk and compliance for a transit organization (service desk, inventory, changes, vendors and contracts, '
  + 'cybersecurity frameworks, risks, security incidents, policies, vulnerabilities, projects, safety and reports). '
  + 'Every call acts as the person who owns the access token, with no more rights than they have; records they may not see do not exist for you. '
  + 'Start with list_record_types or search; use my_work for "what should I do". Cite references (e.g. TKT-00012) and the url of each record you mention. '
  + `${COMPLETENESS} `
  + 'A client that cannot read MCP prompts or resources can use the tools read_guide (the user guide pages, the same text as the sandpiper://guide/<page> resources) '
  + 'and get_prompt (the text of each ready-made prompt, such as load_records_from_sources and load_document_package, with its arguments filled in). '
  + 'Nothing can be deleted through this connection.';

/** What the assistant is told while its saves are data loads (E18-70). */
export const DATA_LOAD_INSTRUCTIONS = 'Data load mode is on for you: create_record and update_record may also set read-only fields (opened, resolved and closed times, due times, breach flags and so on), '
  + 'any status without the usual step rules, created_at, created_by, updated_at and the reference (unique; numbering moves past it). Nothing is sent (no notifications, email, webhooks or approvals). '
  + 'To write in the name of the real people (history must show who wrote or did each thing), give "as" on create_record, update_record, add_comment, link_records, attach_file, attach_link, link_evidence and decide_approval: '
  + 'a user id, username or email (disabled accounts too), a roster person ("person:<id, reference or email>"), or "name:<their name>" for someone with neither. '
  + 'An unknown person is an error, never you. The audit log still records you and your token, adding "on behalf of" the person. '
  + 'When I ask for people from contact lists (employees, vendor contacts) to have accounts for attribution, create each with create_account (a disabled account: no sign-in, nothing sent; an existing one is returned as it is) before loading the records that name them; '
  + 'everyone else goes on the people roster (create_record with type "person"), or is named with "name:" when they need neither. '
  + 'Load each record whole: its original dates and statuses, its people (disabled accounts may be named in person fields), its child and linked records, its files, '
  + 'and its history as comments in order, each with created_at (when it was written) and "as" (who wrote it). '
  + 'delete_record deletes a record created in data load mode. Other records cannot be deleted.';

/** Added while this caller may also have the server read files from the folders an administrator allowed (E18-96). */
export const LOCAL_FILES_INSTRUCTIONS = 'Local file import is on: the server itself reads source files from the folders an administrator allowed, so nothing has to be sent in parts. '
  + 'Use list_local_files to see a folder\'s files (sizes and modified times) and attach_local_file to attach one to a record; give "path" to convert_upload and add_document_version '
  + 'to make a document version from a file on disk. Use start_upload, upload_part and finish_upload only for files outside those folders.';

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
  const loading = t.session.dataLoad?.allowed === true;
  // Local file import (E18-96): only in a load, by a caller who may write, with folders set.
  const localFiles = loading && localImportOn(settings, t.session);
  const instructions = loading
    ? INSTRUCTIONS.replace('Nothing can be deleted through this connection.',
      `${DATA_LOAD_INSTRUCTIONS} It ends ${t.session.dataLoad!.until}.${localFiles ? ` ${LOCAL_FILES_INSTRUCTIONS}` : ''}`)
    : INSTRUCTIONS;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: 'Sandpiper GRC' }, { instructions });

  const run = async (tool: ToolSpec, args: unknown, extra?: ToolExtra) => {
    const started = Date.now();
    try {
      // Progress notifications (E21-20), only when the client asked with a progressToken. They travel
      // on this request's own event stream (http.ts answers with text/event-stream for such calls).
      const progressToken = extra?._meta?.progressToken;
      let last = -1;
      const progress = progressToken === undefined || !extra?.sendNotification ? t.progress : async (done: number, total?: number, message?: string) => {
        if (done <= last) return; // progress must increase
        last = done;
        await extra.sendNotification!({
          method: 'notifications/progress',
          params: { progressToken, progress: done, ...(total !== undefined ? { total } : {}), ...(message ? { message } : {}) },
        }).catch(() => undefined);
      };
      const result: ToolResult = await tool.run(args ?? {}, { ...t, progress });
      await log(tool.name, true, null, Date.now() - started);
      if (tool.write && result.audit) {
        await ctx.audit(req, {
          action: 'mcp.write', recordType: result.audit.recordType, recordId: result.audit.recordId,
          summary: `${result.audit.summary}${result.audit.onBehalf ? ` on behalf of ${result.audit.onBehalf}` : ''} via MCP (tool ${tool.name}) with API token "${t.session.token.name}"`,
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
      description: loading && tool.dataLoadNote ? `${tool.description} ${tool.dataLoadNote}` : tool.description,
      // Arguments for loads (E18-71) are offered only while this caller's saves are loads.
      // and a local file path (E18-96) only while local file import is on for this caller.
      inputSchema: { ...tool.input, ...(loading && tool.dataLoadInput ? tool.dataLoadInput : {}), ...(localFiles && tool.localFileInput ? tool.localFileInput : {}) },
      annotations: {
        title: tool.title,
        readOnlyHint: !tool.write,
        destructiveHint: tool.name === 'delete_record',
        idempotentHint: !!tool.idempotent,
        openWorldHint: false,
      },
    }, ((args: unknown, extra: ToolExtra) => run(tool, args, extra)) as any);
  }

  // ---- resources: the user guide, and any record by type and id

  for (const page of guidePages()) {
    server.registerResource(page.slug, `sandpiper://guide/${page.slug}`, { title: `User guide: ${page.title}`, description: `The "${page.title}" page of the Sandpiper GRC user guide.`, mimeType: 'text/markdown' },
      async (uri) => {
        await log('read_resource', true, null, 0);
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideText(page) }] };
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
