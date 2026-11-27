import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { image, insertion, makeDocx, makePdf, para } from '../policies/convert/fixtures.ts';
import { documentFilesStandIn } from '../policies/convert/testing.ts';
import { PROMPTS } from './prompts.ts';
import { DOCUMENT_TOOLS } from './tools-documents.ts';

// The document tools (E43-10) over the real /mcp endpoint: an assistant loads a document package with
// its whole version history and original dates in data load mode (chunked uploads, Word conversion,
// file-only PDFs), and every tool obeys the document's distribution (the token acts as its person),
// AI assistant write access, and data load mode. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let base = '';
const clients: Client[] = [];
let adminToken = '';
let agentToken = '';
let agentName = '';

async function connect(token: string): Promise<Client> {
  const c = new Client({ name: 'documents-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
}
const call = (c: Client, name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
const text = (r: any) => (r.content ?? []).map((x: any) => x.text).join('\n');
const ok = (r: any) => { expect(r.isError, text(r)).toBeFalsy(); return r.structuredContent; };
const tools = async (c: Client) => (await c.listTools()).tools.map((x) => x.name);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const confirm = () => t.db.query('update sessions set confirmed_at = now()');

/** Uploads a file through the three upload tools, in parts of at most 1 MB, as an assistant would. */
async function send(c: Client, name: string, bytes: Buffer): Promise<string> {
  const s = ok(await call(c, 'start_upload', { file_name: name, size: bytes.length, sha256: sha(bytes) }));
  for (let n = 1; n <= s.part_count; n++) {
    const part = bytes.subarray((n - 1) * s.part_size, n * s.part_size);
    ok(await call(c, 'upload_part', { upload_id: s.upload_id, part: n, data: part.toString('base64'), sha256: sha(part) }));
  }
  return ok(await call(c, 'finish_upload', { upload_id: s.upload_id })).upload_id;
}

beforeAll(async () => {
  t = await testApp({ extraModules: [documentFilesStandIn] });
  agent = await t.as('agent');
  agentName = (await t.db.one<{ username: string }>('select username from users where id = $1', [agent.userId]))!.username;
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  await confirm();
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true, writeEnabled: true })).status).toBe(200);
  adminToken = (await t.api.post('/api/mcp/tokens', { name: 'Document loader', access: 'write', expiresInDays: 7 })).body.token;
  agentToken = (await agent.post('/api/mcp/tokens', { name: 'Agent reader', access: 'read', expiresInDays: 7 })).body.token;
  expect(adminToken && agentToken).toBeTruthy();
  await t.api.post('/api/departments', { name: 'Invented IT' });
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  await t.close();
});

describe('offering the tools', () => {
  it('offers the read tools to readers, the write tools only with write access, and the loading prompt', async () => {
    const admin = await tools(await connect(adminToken));
    for (const x of DOCUMENT_TOOLS) expect(admin).toContain(x.name);
    const reader = await tools(await connect(agentToken));
    expect(reader).toEqual(expect.arrayContaining(['find_documents', 'read_document', 'document_register_summary', 'check_document']));
    for (const w of DOCUMENT_TOOLS.filter((x) => x.write)) expect(reader).not.toContain(w.name);
    const prompts = (await (await connect(adminToken)).listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toContain('load_document_package');
    const p = PROMPTS.find((x) => x.name === 'load_document_package')!.text({ folder: 'the invented IT SOPs folder' });
    expect(p).toMatch(/~\$/);
    expect(p).toMatch(/oldest first/);
    expect(p).toMatch(/check_document/);

    await t.api.put('/api/mcp/admin/settings', { writeEnabled: false });
    const off = await tools(await connect(adminToken));
    expect(off).toContain('find_documents');
    for (const w of DOCUMENT_TOOLS.filter((x) => x.write)) expect(off).not.toContain(w.name);
    await t.api.put('/api/mcp/admin/settings', { writeEnabled: true });
  });
});

let sopId = '';
let guideline = '';

describe('loading a document package in data load mode', () => {
  it('needs data load mode for original dates: outside it a version is a draft', async () => {
    const c = await connect(adminToken);
    // Setting a number by hand needs document controller rights (a token's scopes do not include them), so it is numbered.
    const d = ok(await call(c, 'save_document', { title: 'Invented password guideline', type: 'guideline', owner: 'me' }));
    guideline = d.doc_number;
    const v = await call(c, 'add_document_version', { document: guideline, body_markdown: '# Passwords\n\nUse long passphrases.', status: 'published', effective_on: '2020-01-01', version: 3 });
    expect(ok(v)).toMatchObject({ status: 'draft', version: 1 });
    expect(text(v)).toMatch(/only in data load mode/);
    expect(guideline).toMatch(/^GDL-/);
  });

  it('loads a document with its whole history, original dates and files, oldest first', async () => {
    await confirm();
    expect((await t.api.post('/api/admin/data-load', { on: true })).status).toBe(200);
    const c = await connect(adminToken);
    expect(text(await call(c, 'list_record_types', {}))).toMatch(/Data load mode is on/);

    const parent = ok(await call(c, 'save_document', { doc_number: 'POL-IT-001', title: 'Invented information security policy', type: 'policy', owner: 'me', owning_department: 'Invented IT' }));
    const sop = ok(await call(c, 'save_document', {
      doc_number: 'SOP-IT-014', title: 'Invented network change procedure', type: 'sop', owner: 'me', owning_department: 'Invented IT',
      parent_number: 'POL-IT-001', access: 'restricted', access_departments: ['Invented IT'],
    }));
    expect(sop).toMatchObject({ created: true, data_load: true, doc_number: 'SOP-IT-014' });
    sopId = sop.id;

    // Version 2 (a Word file, over 1 MB so it goes in two parts) arrives before version 1 (a PDF).
    const big = makeDocx([para('Network change procedure', 'Heading1'), para('Revision B.'), image('Invented rack diagram')], {
      image: true, footer: 'SOP-IT-014 Revision B', extra: { 'word/media/padding.bin': new Uint8Array(randomBytes(1_300_000)) },
    });
    expect(big.length).toBeGreaterThan(1024 * 1024);
    const up2 = await send(c, 'SOP-IT-014 Rev B.docx', big);
    const preview = ok(await call(c, 'convert_upload', { upload_id: up2 }));
    expect(preview.markdown).toContain('# Network change procedure');
    expect(preview.report.suggested).toMatchObject({ version_label: 'Revision B', doc_number: 'SOP-IT-014' });
    const v2 = ok(await call(c, 'add_document_version', {
      document: 'SOP-IT-014', upload_id: up2, version: 2, version_label: 'Rev. B', status: 'published', approved_on: '2023-05-20', effective_on: '2023-06-01',
      approved_by_name: 'Invented Director', change_summary: 'Rewritten for the new depot network',
    }));
    expect(v2).toMatchObject({ version: 2, status: 'published', content_kind: 'markdown', effective_on: '2023-06-01', data_load: true });

    const up1 = await send(c, 'SOP-IT-014 Rev A.pdf', await makePdf(['Revision A of the invented network change procedure, zorblaxite']));
    const v1 = ok(await call(c, 'add_document_version', {
      document: 'SOP-IT-014', upload_id: up1, version: 1, version_label: 'Rev. A', status: 'superseded', approved_on: '2021-02-15', effective_on: '2021-03-01', superseded_on: '2023-06-01',
    }));
    expect(v1).toMatchObject({ version: 1, status: 'superseded', content_kind: 'file', superseded_on: '2023-06-01' });

    const r = ok(await call(c, 'read_document', { document: 'SOP-IT-014' }));
    expect(r.document).toMatchObject({ doc_number: 'SOP-IT-014', status: expect.stringMatching(/Published|Effective/), access: 'restricted' });
    expect(r.versions.map((v: any) => [v.version, v.label, v.status, v.effective_on])).toEqual([[2, 'Rev. B', 'published', '2023-06-01'], [1, 'Rev. A', 'superseded', '2021-03-01']]);
    expect(r.version.text).toContain('Revision B.');
    expect(r.version.text).toMatch(/!\[Invented rack diagram\]\(attachment:[0-9a-f-]{36}\)/);
    expect(r.parent).toMatchObject({ doc_number: 'POL-IT-001' });
    expect(r.access_lists).toBeTruthy();

    // The PDF's text, once read, is what read_document gives for the file version.
    await t.app.jobs.enqueue('attachments.text_index', {}, { key: 'test-text' });
    await t.app.jobs.runDue({ types: ['attachments.text_index'] });
    const old = ok(await call(c, 'read_document', { document: 'SOP-IT-014', version: 1 }));
    expect(old.version.text).toContain('zorblaxite');

    // Nothing was sent, and the document is listed for undoing.
    expect((await t.db.query('select 1 from policy_acknowledgements where policy_id = $1', [sopId])).length).toBe(0);
    expect((await t.db.query(`select 1 from data_load_records where record_type = 'policy' and record_id = $1`, [sopId])).length).toBe(1);
    const audit = await t.db.query<any>(`select summary from audit_events where action = 'mcp.write' and record_id = $1`, [sopId]);
    expect(audit.some((a) => /data load/.test(a.summary))).toBe(true);
    expect(parent.id).toBeTruthy();

    // A version written by someone else, and one by a person who has left (no account): the version
    // records them, the audit log keeps the loader and adds "on behalf of".
    const v3 = ok(await call(c, 'add_document_version', {
      document: 'SOP-IT-014', body_markdown: 'Revision C.', version: 3, status: 'draft', as: agentName,
    }));
    const row3 = await t.db.one<{ created_by: string }>('select created_by from policy_versions where id = $1', [v3.version_id]);
    expect(row3!.created_by).toBe(agent.userId);
    const memo = ok(await call(c, 'save_document', { doc_number: 'GL-IT-002', title: 'Invented printer guideline', type: 'guideline', as: 'name:Invented Former Analyst' }));
    const memoAudit = await t.db.query<any>(`select summary, on_behalf_name from audit_events where record_id = $1 and on_behalf_name is not null`, [memo.id]);
    expect(memoAudit.some((a) => a.on_behalf_name === 'Invented Former Analyst')).toBe(true);
    const unknown = await call(c, 'add_document_version', { document: 'SOP-IT-014', body_markdown: 'x', as: 'nobody-invented-xyz' });
    expect(unknown.isError).toBe(true);
  });

  it('refuses tracked changes until accepted, without using up the upload', async () => {
    const c = await connect(adminToken);
    ok(await call(c, 'save_document', { doc_number: 'WI-IT-002', title: 'Invented switch replacement', type: 'work_instruction', owner: 'me' }));
    const up = await send(c, 'draft.docx', makeDocx([para('Replace the switch.'), insertion('Label both ends.')]));
    const refused = await call(c, 'add_document_version', { document: 'WI-IT-002', upload_id: up, status: 'published', effective_on: '2024-01-01' });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error.code).toBe('tracked_changes');
    const accepted = ok(await call(c, 'add_document_version', { document: 'WI-IT-002', upload_id: up, accept_as_is: true, status: 'published', effective_on: '2024-01-01' }));
    expect(accepted).toMatchObject({ status: 'published', content_kind: 'markdown' });
  });

  it('links, records past reviews and checks the loaded documents', async () => {
    const c = await connect(adminToken);
    const link = ok(await call(c, 'link_document', { document: 'SOP-IT-014', to_type: 'policy', to: guideline, relation: 'references' }));
    expect(link.relation).toBe('references');
    const review = ok(await call(c, 'record_document_review', { document: 'SOP-IT-014', result: 'no_change', reviewed_on: '2024-06-03', reviewed_by_name: 'Invented Reviewer' }));
    expect(review.result).toBe('no_change');
    const checked = ok(await call(c, 'check_document', { document: 'SOP-IT-014' }));
    expect(checked.results[0].problems).toEqual([]);
    // A gap between two versions is reported.
    ok(await call(c, 'save_document', { doc_number: 'FRM-IT-003', title: 'Invented change request form', type: 'form_template', owner: 'me' }));
    ok(await call(c, 'add_document_version', { document: 'FRM-IT-003', body_markdown: 'Form v1', version: 1, status: 'superseded', effective_on: '2019-01-01', superseded_on: '2019-06-01' }));
    ok(await call(c, 'add_document_version', { document: 'FRM-IT-003', body_markdown: 'Form v2', version: 2, status: 'published', effective_on: '2019-09-01' }));
    const gap = ok(await call(c, 'check_document', { document: 'FRM-IT-003' }));
    expect(gap.results[0].problems.join(' ')).toMatch(/a gap/);
    // In data load mode a loaded document can be deleted again (delete_record), a document made outside it cannot.
    const form = await t.db.one<{ id: string }>(`select id from policies where doc_number = 'FRM-IT-003'`);
    ok(await call(c, 'delete_record', { type: 'policy', id: form!.id }));
    const other = await t.db.one<{ id: string }>('select id from policies where doc_number = $1', [guideline]);
    const refused = await call(c, 'delete_record', { type: 'policy', id: other!.id });
    expect(refused.structuredContent.error.code).toBe('not_found');
  });
});

describe('distribution', () => {
  it('hides a restricted document from a person outside it, while the figures stay the same', async () => {
    const reader = await connect(agentToken);
    const admin = await connect(adminToken);
    const found = ok(await call(reader, 'find_documents', { q: 'network change' }));
    expect(found.rows.map((r: any) => r.doc_number)).not.toContain('SOP-IT-014');
    const hidden = await call(reader, 'read_document', { document: 'SOP-IT-014' });
    expect(hidden.isError).toBe(true);
    expect(hidden.structuredContent.error.code).toBe('not_found');
    expect(JSON.stringify(hidden)).not.toContain('network change');
    const a = ok(await call(admin, 'document_register_summary', {}));
    const b = ok(await call(reader, 'document_register_summary', {}));
    expect(b.total).toBe(a.total);
    expect(b.by_status).toEqual(a.by_status);
    expect(JSON.stringify(b)).not.toContain('Invented network change procedure');
    const all = ok(await call(reader, 'check_document', {}));
    expect(JSON.stringify(all)).not.toContain('SOP-IT-014');
  });

  it('lets the person read it once access names them', async () => {
    const admin = await connect(adminToken);
    ok(await call(admin, 'set_document_access', { document: 'SOP-IT-014', access: 'restricted', access_departments: ['Invented IT'], access_users: [agentName] }));
    const reader = await connect(agentToken);
    const r = ok(await call(reader, 'read_document', { document: 'SOP-IT-014' }));
    expect(r.document.doc_number).toBe('SOP-IT-014');
    // Readers who may not change access do not see the access lists.
    expect(r.access_lists).toBeUndefined();
    // A read-only token still cannot write.
    const w = await call(reader, 'save_document', { doc_number: 'SOP-IT-014', title: 'Changed' });
    expect(w.isError).toBe(true);
  });
});
