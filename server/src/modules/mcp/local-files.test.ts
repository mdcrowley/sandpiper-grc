import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { makeDocx, para } from '../policies/convert/fixtures.ts';
import { documentFilesStandIn } from '../policies/convert/testing.ts';
import { guidePages } from './guide.ts';
import { PROMPTS } from './prompts.ts';

// Local file import (E18-96) and the guide and prompt tools (E18-97) over the real /mcp endpoint and
// the REST routes: the setting, who is offered the tools, what the server reads, what it refuses
// (outside the folders, its own files, other people, outside a load), the audit of every file read,
// and documents made from a Word file on disk in one call. A temporary folder of invented files.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
let root = '';
let outside = '';
let url = '';
const clients: Client[] = [];
let adminToken = '';
let agentToken = '';

async function connect(token: string): Promise<Client> {
  const c = new Client({ name: 'local-files-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const ok = (r: any) => { expect(r.isError, text(r)).toBeFalsy(); return r.structuredContent; };
const tools = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const loadMode = async (on: boolean) => {
  await confirm();
  expect((await t.api.post('/api/admin/data-load', on ? { on: true, days: 1 } : { on: false })).status).toBe(200);
};
const setRoots = async (roots: string[]) => {
  await confirm();
  return t.api.put('/api/mcp/admin/settings', { localImportRoots: roots });
};
const bearer = (token: string, method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown) => t.app.inject({
  method, url: path, headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
  ...(payload ? { payload: JSON.stringify(payload) } : {}),
});

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'grc-local-mcp-'));
  root = join(base, 'Invented Imports');
  outside = join(base, 'Elsewhere');
  mkdirSync(join(root, 'Contracts'), { recursive: true });
  mkdirSync(join(root, 'SOPs'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'Contracts', 'Invented maintenance agreement.txt'), 'An invented maintenance agreement for depot routers.\n');
  writeFileSync(join(root, 'Contracts', '~$Invented maintenance agreement.docx'), 'lock');
  writeFileSync(join(root, 'Contracts', 'Thumbs.db'), 'cache');
  writeFileSync(join(root, 'Contracts', 'tool.exe'), 'MZ invented');
  writeFileSync(join(root, 'SOPs', 'SOP-IT-021 Rev A.docx'), makeDocx([para('Invented backup procedure', 'Heading1'), para('Copy the depot server nightly.')]));
  writeFileSync(join(outside, 'Payroll.txt'), 'never read');

  t = await testApp({ extraModules: [documentFilesStandIn] });
  agent = await t.as('agent');
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'Records loader', access: 'write', expiresInDays: 7 })).body.token;
  agentToken = (await agent.post('/api/mcp/tokens', { name: 'Agent writer', access: 'write', expiresInDays: 7 })).body.token;
  expect(adminToken && agentToken).toBeTruthy();
}, 60_000);
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
  rmSync(base, { recursive: true, force: true });
});

describe('the setting', () => {
  it('is empty by default, takes full paths of existing folders, needs a password confirmation and a signed-in session', async () => {
    expect((await t.api.get('/api/mcp/admin')).body.settings.localImportRoots).toEqual([]);
    expect((await t.api.get('/api/mcp/admin')).body.localImport.protected.length).toBeGreaterThan(0);
    expect((await setRoots(['Invented Imports'])).body.error.fields.localImportRoots).toMatch(/not a full path/);
    expect((await setRoots([join(base, 'Missing')])).body.error.fields.localImportRoots).toMatch(/not a folder/);
    expect((await setRoots(['\\\\fileserver\\share'])).status).toBe(400);
    // Without a recent password confirmation the change is refused.
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day'`);
    const stale = await t.api.put('/api/mcp/admin/settings', { localImportRoots: [root] });
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('reauth_required');
    // A token never changes it.
    expect((await bearer(adminToken, 'PUT', '/api/mcp/admin/settings', { localImportRoots: [root] })).statusCode).toBe(403);
    expect((await t.api.get('/api/mcp/admin')).body.settings.localImportRoots).toEqual([]);
  });
});

describe('who may have the server read its folders', () => {
  it('offers nothing and refuses the routes while no folders are set or outside a load', async () => {
    expect((await setRoots([root])).status).toBe(200);
    const c = await connect(adminToken);
    expect(await tools(c)).not.toContain('list_local_files');
    expect(c.getInstructions()).not.toMatch(/Local file import is on/);
    const off = await t.api.get('/api/data-load/local-files');
    expect([off.status, off.body.error.code]).toEqual([409, 'data_load_off']);

    await loadMode(true);
    try {
      expect((await setRoots([])).status).toBe(200);
      expect(await tools(await connect(adminToken))).not.toContain('attach_local_file');
      const none = await t.api.get('/api/data-load/local-files');
      expect([none.status, none.body.error.code]).toEqual([409, 'local_import_off']);
      expect((await setRoots([root])).status).toBe(200);

      // Not an administrator: neither tool nor route, and the folders are not told to the token.
      const ag = await connect(agentToken);
      expect(await tools(ag)).not.toContain('list_local_files');
      expect((await agent.get('/api/data-load/local-files')).status).toBe(403);
      expect((await bearer(agentToken, 'GET', '/api/data-load/local-files')).statusCode).toBe(403);
      expect((await bearer(agentToken, 'GET', '/api/mcp/session')).json().settings.localImportRoots).toEqual([]);

      // An administrator's ordinary API token needs admin.administer in its own scopes.
      await confirm();
      const narrow = (await t.api.post('/api/me/tokens', { name: 'Narrow reader', scopes: ['assets.view'], expiresInDays: 1 })).body.token;
      expect((await bearer(narrow, 'GET', '/api/data-load/local-files')).statusCode).toBe(403);

      // AI assistant write access off: not a load for an assistant, so nothing is offered or read.
      await confirm();
      await t.api.put('/api/mcp/admin/settings', { writeEnabled: false });
      expect((await bearer(adminToken, 'GET', '/api/data-load/local-files')).statusCode).toBe(409);
      await confirm();
      await t.api.put('/api/mcp/admin/settings', { writeEnabled: true });

      const admin = await connect(adminToken);
      expect(await tools(admin)).toEqual(expect.arrayContaining(['list_local_files', 'attach_local_file']));
      expect(admin.getInstructions()).toMatch(/Local file import is on/);
      const schema = (await admin.listTools()).tools.find((x) => x.name === 'add_document_version')!.inputSchema as any;
      expect(Object.keys(schema.properties)).toContain('path');
    } finally {
      await loadMode(false);
    }
  });
});

describe('listing and attaching files from a folder', () => {
  it('lists the files without lock and system files, attaches one exactly as an upload, once, and audits the read', async () => {
    await loadMode(true);
    try {
      const c = await connect(adminToken);
      const top = ok(await call(c, 'list_local_files', {}));
      expect(top.folders.map((f: Row) => f.name)).toEqual(['Contracts', 'SOPs']);
      const all = ok(await call(c, 'list_local_files', { recursive: true }));
      expect(all.files.map((f: Row) => f.relative_path)).toEqual(['Contracts/Invented maintenance agreement.txt', 'Contracts/tool.exe', 'SOPs/SOP-IT-021 Rev A.docx']);
      expect(all.files.find((f: Row) => f.name === 'tool.exe').allowed_type).toBe(false);
      expect(all.skipped.junk).toBe(2);
      const paged = ok(await call(c, 'list_local_files', { recursive: true, page_size: 1, page: 2 }));
      expect([paged.files.length, paged.pages, paged.files[0].name]).toEqual([1, 3, 'tool.exe']);
      expect(ok(await call(c, 'list_local_files', { folder: 'SOPs', pattern: '*.DOCX' })).files).toHaveLength(1);

      const asset = (await t.api.post('/api/assets', { name: 'Invented Depot Router 7' })).body;
      const file = all.files[0];
      const f = ok(await call(c, 'attach_local_file', {
        path: file.path, type: 'asset', id: asset.id, description: 'Signed agreement', created_at: '2021-03-04', as: 'name:Invented Clerk',
      }));
      expect(f).toMatchObject({ file_name: 'Invented maintenance agreement.txt', duplicate: false, data_load: true, kind: 'file' });
      const att = (await t.db.one<Row>('select * from attachments where id = $1', [f.attachment_id]))!;
      expect(att).toMatchObject({ record_type: 'asset', record_id: asset.id, uploaded_by_name: 'Invented Clerk', description: 'Signed agreement' });
      expect(String(new Date(att.created_at).toISOString())).toMatch(/^2021-03-04/);
      expect((await t.db.query(`select 1 from data_load_records where record_id = $1`, [f.attachment_id])).length).toBe(1);
      const read = (await t.db.one<Row>(`select summary, after from audit_events where action = 'attachment.import_local' order by at desc limit 1`))!;
      // Marked as a load ("on behalf of" takes the place of "(data load)" when a person is named).
      expect(read.summary).toMatch(/^File read from the server's folder for a data load: .*Invented maintenance agreement\.txt .*\((data load|on behalf of Invented Clerk)\)$/);
      expect(read.after.path).toMatch(/Invented maintenance agreement\.txt$/);
      expect((await t.db.one<Row>(`select summary from audit_events where action = 'mcp.write' and record_id = $1 order by at desc limit 1`, [asset.id]))!.summary)
        .toMatch(/via MCP \(tool attach_local_file\)/);

      // Again: the same content is already there, so nothing new is attached and no upload is left behind.
      const again = ok(await call(c, 'attach_local_file', { path: file.path, type: 'asset', id: asset.id }));
      expect(again).toMatchObject({ duplicate: true, attachment_id: f.attachment_id });
      expect((await t.db.query(`select 1 from attachments where record_id = $1 and deleted_at is null`, [asset.id])).length).toBe(1);
      expect((await t.db.query(`select 1 from uploads_pending where status = 'ready'`)).length).toBe(0);

      // The file intake still decides: a program is refused.
      const exe = await call(c, 'attach_local_file', { path: join(root, 'Contracts', 'tool.exe'), type: 'asset', id: asset.id });
      expect(exe.isError).toBe(true);
    } finally {
      await loadMode(false);
    }
  });

  it("refuses paths outside the folders, the server's own files and stream names, and audits each refusal", async () => {
    await loadMode(true);
    const backups = join(root, 'Invented backups');
    mkdirSync(backups, { recursive: true });
    writeFileSync(join(backups, 'backup-1.txt'), 'invented backup');
    writeFileSync(join(root, 'grc.secret.key'), '00');
    const before = process.env.GRC_BACKUP_DIR;
    process.env.GRC_BACKUP_DIR = backups;
    try {
      const c = await connect(adminToken);
      const asset = (await t.api.post('/api/assets', { name: 'Invented Depot Router 8' })).body;
      const refused = async (path: string, code: RegExp) => {
        const r = await call(c, 'attach_local_file', { path, type: 'asset', id: asset.id });
        expect(r.isError, path).toBe(true);
        expect(r.structuredContent.error.code, path).toMatch(code);
      };
      await refused(join(outside, 'Payroll.txt'), /outside_allowed_folders/);
      await refused(`${join(root, 'Contracts')}${process.platform === 'win32' ? '\\..\\..' : '/../..'}/Elsewhere/Payroll.txt`, /path_refused/);
      await refused(`${join(root, 'Contracts', 'Invented maintenance agreement.txt')}:hidden`, /path_refused/);
      await refused('\\\\fileserver\\share\\Payroll.txt', /path_refused/);
      await refused(join(backups, 'backup-1.txt'), /server_files/);
      await refused(join(root, 'grc.secret.key'), /server_files/);
      await refused(join(root, 'Contracts'), /not_a_file/);
      expect(ok(await call(c, 'list_local_files', {})).folders.map((f: Row) => f.name)).not.toContain('Invented backups');
      const audits = await t.db.query<Row>(`select summary from audit_events where action = 'attachment.import_local_refused'`);
      expect(audits.length).toBeGreaterThanOrEqual(7);
      expect(audits.some((a) => /Payroll\.txt/.test(a.summary))).toBe(true);
      expect((await t.db.query(`select 1 from attachments where record_id = $1`, [asset.id])).length).toBe(0);
    } finally {
      if (before === undefined) delete process.env.GRC_BACKUP_DIR; else process.env.GRC_BACKUP_DIR = before;
      await loadMode(false);
    }
  });
});

describe('documents from a Word file on disk', () => {
  it('previews the conversion and adds the version with its original kept, each in one call', async () => {
    await loadMode(true);
    try {
      const c = await connect(adminToken);
      ok(await call(c, 'save_document', { doc_number: 'SOP-IT-021', title: 'Invented backup procedure', type: 'sop', owner: 'me' }));
      const path = join(root, 'SOPs', 'SOP-IT-021 Rev A.docx');
      const preview = ok(await call(c, 'convert_upload', { path }));
      expect(preview.markdown).toContain('# Invented backup procedure');
      expect(preview.upload_id).toBeTruthy();
      const v = ok(await call(c, 'add_document_version', { document: 'SOP-IT-021', path, version: 1, version_label: 'Rev. A', status: 'published', effective_on: '2022-01-10' }));
      expect(v).toMatchObject({ version: 1, status: 'published', content_kind: 'markdown', effective_on: '2022-01-10', data_load: true });
      expect(v.source_attachment_id).toBeTruthy();
      const original = (await t.db.one<Row>('select file_name, extension from attachments where id = $1', [v.source_attachment_id]))!;
      expect(original).toMatchObject({ file_name: 'SOP-IT-021 Rev A.docx', extension: 'docx' });
      const both = await call(c, 'add_document_version', { document: 'SOP-IT-021', path, upload_id: preview.upload_id });
      expect(both.isError).toBe(true);
    } finally {
      await loadMode(false);
    }
  });
});

describe('the guide and prompt tools', () => {
  it('give clients without prompts or resources the same text, to read-only tokens too', async () => {
    const readOnly = (await agent.post('/api/mcp/tokens', { name: 'Agent reader', access: 'read', expiresInDays: 7 })).body.token;
    const c = await connect(readOnly);
    expect(await tools(c)).toEqual(expect.arrayContaining(['read_guide', 'get_prompt']));
    expect(c.getInstructions()).toMatch(/read_guide[\s\S]*get_prompt/);

    const list = ok(await call(c, 'read_guide', {}));
    expect(list.pages.length).toBe(guidePages().length);
    const page = guidePages().find((p) => p.slug.startsWith('21-'))!;
    const byNumber = await call(c, 'read_guide', { page: '21' });
    const resource = await c.readResource({ uri: `sandpiper://guide/${page.slug}` });
    expect(text(byNumber)).toBe((resource.contents[0] as { text: string }).text);
    expect(ok(await call(c, 'read_guide', { page: page.slug.replace(/^\d+-/, '') })).page).toBe(page.slug);
    expect((await call(c, 'read_guide', { page: 'no-such-page' })).isError).toBe(true);

    const prompts = ok(await call(c, 'get_prompt', {}));
    expect(prompts.prompts.map((p: Row) => p.name)).toEqual(PROMPTS.map((p) => p.name));
    const p = ok(await call(c, 'get_prompt', { name: 'load_records_from_sources', args: { record_type: 'vendor', sources: 'the invented vendor list' } }));
    expect(p.text).toBe(PROMPTS.find((x) => x.name === 'load_records_from_sources')!.text({ record_type: 'vendor', sources: 'the invented vendor list' }));
    const viaMcp = await c.getPrompt({ name: 'load_records_from_sources', arguments: { record_type: 'vendor', sources: 'the invented vendor list' } });
    expect((viaMcp.messages[0].content as { text: string }).text).toBe(p.text);
    expect((await call(c, 'get_prompt', { name: 'load_document_package', args: { nonsense: 'x' } })).isError).toBe(true);
    expect((await call(c, 'get_prompt', { name: 'no_such_prompt' })).isError).toBe(true);
  });
});
