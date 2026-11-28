// The board book and the minutes as PDFs (wave 25).
//
// The board book is one PDF made with the core PdfBuilder (tagged for PDF/UA): a cover, the agenda,
// then each item with its details and papers. A controlled document or a Markdown, text or Word paper
// is printed in the book (Word files are converted in the document sandbox, never in the server
// process); a record is summarized; a PDF paper is appended at the end, after an "Appendices" list
// giving its pages. Appended pages keep their drawing as it is, marked as an artifact: the book's own
// pages carry the structure, and the text-only version of the book prints the text read from each PDF
// paper instead, for screen readers. Closed-session items are left out of the public version (a line
// says how many), and so are restricted records and documents not open to the whole organization.
//
// The minutes PDF has the attendance and quorum, the general minutes, and each item's discussion and
// motions (mover, seconder, vote, result, resolution number). Before approval it says "Draft".
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PDF_TYPE, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, displayDate, TIME_ZONE, todayInZone } from '../../core/timezone.ts';
import { agendaFor } from './agenda.ts';
import { BOOK_MAX_APPENDED_BYTES, appendPdfs, inspectPdfs } from './book-sandbox.ts';
import { membersOn, quorumOf, seesClosed } from './committees.ts';
import { votesOf } from './decisions.ts';
import { declarationsFor } from './declarations.ts';
import { meetingFor } from './meetings.ts';
import { currentVersion, DOCUMENT_TYPE, documentLabel, hasTable, seeRecord } from './papers.ts';

export type BookVersion = 'public' | 'members';
/** Text files and Word files printed in the book, at most this large each. */
const PRINT_MAX_BYTES = 20 * 1024 * 1024;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const appendixName = (i: number) => (i < 26 ? LETTERS[i] : `${LETTERS[Math.floor(i / 26) - 1]}${LETTERS[i % 26]}`);

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
export const when = (at: unknown) => {
  const d = new Date(String(at));
  return Number.isNaN(d.getTime()) ? '' : `${displayDate(todayInZone(d))}, ${timeFmt.format(d)}`;
};

/** Markdown as the PDF builder prints it: tables as lines, images and links as their words. */
export function printableMarkdown(md: string): string {
  return String(md ?? '').split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (/^\|?\s*:?-{3,}/.test(t) && /^[|:\-\s]+$/.test(t)) return ''; // a table's heading rule
    if (t.startsWith('|') && t.endsWith('|')) return t.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')).filter(Boolean).join(' · ');
    return line;
  }).join('\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() ? `[Image: ${alt.trim()}]` : ''))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

interface Attachment { id: string; file_name: string; extension: string; size_bytes: number; storage_driver: string; storage_key: string; link_url: string | null; text: string | null; text_status: string | null }

async function attachmentsById(ctx: ModuleContext, ids: string[]): Promise<Map<string, Attachment>> {
  if (!ids.length || !(await hasTable(ctx, 'attachments'))) return new Map();
  const texts = await hasTable(ctx, 'attachment_texts');
  const rows = await ctx.db.query<Attachment>(
    `select a.id::text as id, a.file_name, a.extension, a.size_bytes::float8 as size_bytes, a.storage_driver, a.storage_key, a.link_url,
            ${texts ? 'x.content as text, x.status as text_status' : 'null as text, null as text_status'}
     from attachments a ${texts ? 'left join attachment_texts x on x.attachment_id = a.id' : ''}
     where a.id::text = any($1::text[]) and a.deleted_at is null`, [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function bytesOf(ctx: ModuleContext, att: Attachment): Promise<Buffer | null> {
  const stores = (ctx.app as unknown as { attachmentStores?: { forDriver(d: string): { get(key: string): Promise<AsyncIterable<Buffer>> } } }).attachmentStores;
  if (!stores || att.storage_driver === 'link') return null;
  const chunks: Buffer[] = [];
  for await (const c of await stores.forDriver(att.storage_driver).get(att.storage_key)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** A Word file's text as Markdown, converted in the document sandbox; null when it cannot be. */
async function wordText(bytes: Buffer, fileName: string): Promise<string | null> {
  try {
    const { convertDocx } = await import('../policies/convert/docx.ts');
    const r = await convertDocx(bytes, fileName);
    return r.ok ? r.markdown : null;
  } catch {
    return null;
  }
}

/** One thing a paper puts in the book. */
type Part =
  | { kind: 'text'; heading: string; meta: { label: string; value: string }[]; markdown: string | null; note?: string }
  | { kind: 'pdf'; heading: string; meta: { label: string; value: string }[]; att: Attachment; item: number };

async function lookupLabel(ctx: ModuleContext, list: string, value: unknown): Promise<string> {
  if (value === null || value === undefined || value === '') return '';
  return (await ctx.lookups.values(list)).find((v) => v.value === value)?.label ?? String(value);
}

interface BookOpts { version: BookVersion; textOnly: boolean; producedBy: string }

/** What the papers of the visible items put in the book, as `user` may see them. */
async function partsOf(ctx: ModuleContext, user: SessionUser | null, items: Row[], opts: BookOpts): Promise<Map<string, Part[]>> {
  const isPublic = opts.version === 'public';
  const fileIds = new Set<string>();
  const docs = new Map<string, { policy: Row; version: Row | null }>();
  for (const item of items) {
    for (const p of item.papers ?? []) {
      if (p.kind === 'file' && p.attachment_id && !p.missing) fileIds.add(String(p.attachment_id));
      if (p.kind === 'document' && p.record && !docs.has(p.record.id)) {
        const policy = await seeRecord(ctx, user, DOCUMENT_TYPE, p.record.id);
        if (!policy) continue;
        const version = await currentVersion(ctx, policy.id);
        docs.set(policy.id, { policy, version });
        const fileId = version?.content_kind === 'file' ? version.rendition_attachment_id ?? version.source_attachment_id : null;
        if (fileId) fileIds.add(String(fileId));
      }
    }
  }
  const files = await attachmentsById(ctx, [...fileIds]);
  const out = new Map<string, Part[]>();
  for (const [n, item] of items.entries()) {
    const parts: Part[] = [];
    for (const p of item.papers ?? []) {
      if (p.hidden) { parts.push({ kind: 'text', heading: 'A paper you cannot see', meta: [], markdown: null, note: 'This paper is not included: it is a record you may not see.' }); continue; }
      if (p.kind === 'file') {
        const att = p.attachment_id ? files.get(String(p.attachment_id)) : undefined;
        if (!att) { parts.push({ kind: 'text', heading: 'A removed file', meta: [], markdown: null, note: 'A file on this item has since been removed from the meeting.' }); continue; }
        parts.push(await filePart(ctx, `Paper: ${att.file_name}`, [], att, n + 1, opts));
        continue;
      }
      const record = p.record as Row;
      if (p.kind === 'document') {
        const d = docs.get(record.id);
        if (!d) continue;
        if (isPublic && d.policy.access && d.policy.access !== 'organization') {
          parts.push({ kind: 'text', heading: `Document: ${documentLabel(d.policy)}`, meta: [], markdown: null, note: 'This document has restricted distribution, so it is not included in the public version.' });
          continue;
        }
        const heading = `Document: ${documentLabel(d.policy)}`;
        if (!d.version) { parts.push({ kind: 'text', heading, meta: [], markdown: null, note: 'No version of this document is in force yet.' }); continue; }
        const meta = [
          { label: 'Version', value: String(d.version.version_label ?? `Version ${d.version.version}`) },
          ...(d.version.effective_on ? [{ label: 'Effective', value: displayDate(String(d.version.effective_on)) }] : []),
        ];
        if (d.version.content_kind === 'file') {
          const att = files.get(String(d.version.rendition_attachment_id ?? d.version.source_attachment_id ?? ''));
          parts.push(att ? await filePart(ctx, heading, meta, att, n + 1, opts) : { kind: 'text', heading, meta, markdown: null, note: 'The file of this version could not be found.' });
        } else parts.push({ kind: 'text', heading, meta, markdown: String(d.version.body ?? '') });
        continue;
      }
      // Another record: a short summary, as the reader may see it.
      const def = ctx.resources.get(record.type);
      const row = def ? await seeRecord(ctx, user, def.type, record.id) : undefined;
      if (!def || !row) continue;
      if (isPublic && row.restricted === true) {
        parts.push({ kind: 'text', heading: `${def.label}: a restricted record`, meta: [], markdown: null, note: 'Restricted records are not included in the public version.' });
        continue;
      }
      const meta = [{ label: 'Type', value: def.label }];
      if (def.ref && row[def.ref.field]) meta.push({ label: 'Reference', value: String(row[def.ref.field]) });
      const status = def.fields.status;
      if (status?.type === 'lookup' && status.list && row.status) meta.push({ label: 'Status', value: await lookupLabel(ctx, status.list, row.status) });
      parts.push({ kind: 'text', heading: `${def.label}: ${record.label}`, meta, markdown: null, note: 'Open the record in the application for its details.' });
    }
    out.set(item.id, parts);
  }
  return out;
}

/** A file in the book: printed (Markdown, text, Word), appended (PDF), or named only. */
async function filePart(ctx: ModuleContext, heading: string, meta: { label: string; value: string }[], att: Attachment, item: number, opts: BookOpts): Promise<Part> {
  const ext = String(att.extension ?? '').toLowerCase();
  if (att.storage_driver === 'link') return { kind: 'text', heading, meta, markdown: null, note: 'This paper is a link to a document kept elsewhere. Open it from the meeting in the application.' };
  if (ext === 'pdf') {
    if (opts.textOnly) {
      return att.text_status === 'indexed' && att.text
        ? { kind: 'text', heading, meta, markdown: att.text }
        : { kind: 'text', heading, meta, markdown: null, note: 'No text could be read from this PDF (it may be scanned). The full book appends its pages.' };
    }
    return { kind: 'pdf', heading, meta, att, item };
  }
  if (Number(att.size_bytes) > PRINT_MAX_BYTES) return { kind: 'text', heading, meta, markdown: null, note: 'This file is too large to print in the book. Open it in the application.' };
  if (['md', 'markdown', 'txt'].includes(ext)) {
    const bytes = await bytesOf(ctx, att);
    return { kind: 'text', heading, meta, markdown: bytes ? bytes.toString('utf8') : null, note: bytes ? undefined : 'The file could not be read.' };
  }
  if (ext === 'docx') {
    const bytes = await bytesOf(ctx, att);
    const md = bytes ? await wordText(bytes, att.file_name) : null;
    return { kind: 'text', heading, meta, markdown: md, note: md === null ? 'This Word file could not be converted. Open it in the application.' : undefined };
  }
  return { kind: 'text', heading, meta, markdown: null, note: `A .${ext || 'file'} file cannot be printed in the book. Open it in the application.` };
}

async function names(ctx: ModuleContext) {
  const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
  return { appName, branding: await printBranding(ctx.db) };
}

/**
 * The board book of a meeting as `user` may read it. `version`: 'members' includes closed-session
 * items (the caller has checked `seesClosed`); 'public' leaves them out, with restricted records and
 * documents not open to the whole organization.
 */
export async function makeBook(ctx: ModuleContext, user: SessionUser | null, meeting: Row, opts: BookOpts): Promise<{ pdf: Buffer; appended: number; skipped: string[] }> {
  const committee = (await ctx.db.one<Row>('select name from committees where id = $1', [meeting.committee_id])) ?? { name: 'Committee' };
  const all = await agendaFor(ctx, user, meeting, opts.version === 'members');
  const items = all.filter((i) => !i.hidden);
  const closedLeftOut = all.length - items.length;
  const parts = await partsOf(ctx, user, items, opts);

  // PDF papers to append: read once in the sandbox for their page counts; one that cannot be read is named, not appended.
  const pdfParts: { part: Extract<Part, { kind: 'pdf' }>; bytes: Buffer; pages: number; letter: string; start: number }[] = [];
  const skipped: string[] = [];
  let total = 0;
  const candidates: { part: Extract<Part, { kind: 'pdf' }>; bytes: Buffer }[] = [];
  for (const list of parts.values()) {
    for (const part of list) {
      if (part.kind !== 'pdf') continue;
      const bytes = await bytesOf(ctx, part.att);
      if (!bytes) { skipped.push(part.att.file_name); continue; }
      if (total + bytes.length > BOOK_MAX_APPENDED_BYTES) { skipped.push(part.att.file_name); continue; }
      total += bytes.length;
      candidates.push({ part, bytes });
    }
  }
  const inspected = await inspectPdfs(candidates.map((c) => c.bytes));
  for (const [i, c] of candidates.entries()) {
    const r = inspected[i];
    if (r?.ok) pdfParts.push({ ...c, pages: r.pages, letter: appendixName(pdfParts.length), start: 0 });
    else skipped.push(c.part.att.file_name);
  }
  const appendixOf = new Map(pdfParts.map((p) => [p.part, p]));

  const { appName, branding } = await names(ctx);
  const scheduled = when(meeting.scheduled_at);
  const hasClosed = opts.version === 'members' && items.some((i) => i.session === 'closed');
  const build = async (): Promise<{ pdf: Buffer; pages: number }> => {
    const b = new PdfBuilder({
      title: `${meeting.title}: board book`,
      subtitle: `${committee.name} · ${scheduled}${meeting.location ? ` · ${meeting.location}` : ''}`,
      meta: [
        `Meeting ${meeting.ref}`,
        opts.version === 'members' ? 'Members\' version: includes closed-session items' : 'Public version: closed-session items are left out',
        `Produced ${displayDate(dayInZone())} by ${opts.producedBy}`,
      ],
      cover: true, appName, author: appName, branding,
      watermark: hasClosed ? 'Contains closed-session items: for committee members only' : null,
    });
    b.heading('Agenda', 1);
    if (!all.length) b.note('The agenda has no items yet.');
    else {
      b.table(
        [{ header: 'No.', weight: 0.6 }, { header: 'Item', weight: 5 }, { header: 'Presenter', weight: 2.2 }, { header: 'Time', weight: 1, align: 'right' }, { header: 'Session', weight: 1.6 }],
        items.map((i) => [String(all.indexOf(i) + 1), String(i.title), String(i.presenter_label ?? ''), i.minutes_allotted ? `${i.minutes_allotted} min` : '',
          i.consent ? 'Consent agenda' : i.session === 'closed' ? 'Closed' : 'Open']));
    }
    if (closedLeftOut) b.note(`${closedLeftOut} closed-session ${closedLeftOut === 1 ? 'item is' : 'items are'} not included in this version.`);
    const consent = items.filter((i) => i.consent);
    if (consent.length) b.paragraph(`Consent agenda: items ${consent.map((i) => all.indexOf(i) + 1).join(', ')} are adopted together by one motion, unless a member asks for an item to be discussed.`, { muted: true });
    for (const item of items) {
      const n = all.indexOf(item) + 1;
      b.heading(`${n}. ${item.title}`, 1);
      const facts = [
        ...(item.presenter_label ? [{ label: 'Presenter', value: String(item.presenter_label) }] : []),
        ...(item.minutes_allotted ? [{ label: 'Time allotted', value: `${item.minutes_allotted} minutes` }] : []),
        { label: 'Session', value: item.session === 'closed' ? 'Closed session' : 'Open session' },
        ...(item.consent ? [{ label: 'Consent agenda', value: 'Yes' }] : []),
        ...(item.record && !item.record.hidden ? [{ label: 'About', value: `${item.record.typeLabel}: ${item.record.ref ? `${item.record.ref} ` : ''}${item.record.label}` }] : []),
      ];
      b.keyValues(facts);
      if (item.notes) b.markdown(printableMarkdown(String(item.notes)));
      const list = parts.get(item.id) ?? [];
      if (!list.length) b.paragraph('No papers.', { muted: true });
      for (const part of list) {
        b.heading(part.heading, 2);
        if (part.meta.length) b.keyValues(part.meta);
        if (part.kind === 'pdf') {
          const a = appendixOf.get(part);
          b.note(a ? `Appended as appendix ${a.letter}: ${a.pages} ${a.pages === 1 ? 'page' : 'pages'}, from page ${a.start} of this file.`
            : 'This PDF could not be appended (it may be protected by a password, damaged or too large). Open it in the application.');
          continue;
        }
        if (part.note) b.note(part.note);
        if (part.markdown) b.markdown(printableMarkdown(part.markdown));
      }
    }
    if (pdfParts.length) {
      b.newPage();
      b.heading('Appendices', 1);
      b.paragraph('The PDF papers follow this page as they were supplied. Their pages are not described for screen readers; the text-only version of this book prints the text read from them instead.', { muted: true });
      b.table([{ header: 'Appendix', weight: 1 }, { header: 'Paper', weight: 5 }, { header: 'Item', weight: 0.8 }, { header: 'Pages', weight: 1.6, align: 'right' }],
        pdfParts.map((p) => [p.letter, p.part.heading, String(p.part.item), `${p.start} to ${p.start + p.pages - 1}`]));
    }
    const pages = b.doc.bufferedPageRange().count;
    return { pdf: await b.finish(), pages };
  };
  // Appendix pages are numbered from the end of the book's own pages: built once, and again if the guess was wrong.
  const place = (tagged: number) => { let at = tagged + 1; for (const p of pdfParts) { p.start = at; at += p.pages; } };
  let guess = 1;
  place(guess);
  let made = await build();
  for (let tries = 0; pdfParts.length && made.pages !== guess && tries < 2; tries++) { guess = made.pages; place(guess); made = await build(); }
  const pdf = pdfParts.length ? await appendPdfs(made.pdf, pdfParts.map((p) => p.bytes)) : made.pdf;
  return { pdf, appended: pdfParts.length, skipped };
}

/** The minutes of a meeting as `user` may read them ('members' with closed-session items, 'public' without). */
export async function makeMinutes(ctx: ModuleContext, user: SessionUser | null, meeting: Row, opts: { version: BookVersion; producedBy: string }): Promise<Buffer> {
  const committee = (await ctx.db.one<Row>('select name from committees where id = $1', [meeting.committee_id])) ?? { name: 'Committee' };
  const all = await agendaFor(ctx, user, meeting, opts.version === 'members');
  const items = all.filter((i) => !i.hidden);
  const isPublic = opts.version === 'public';
  const decisions = (await ctx.db.query<Row>(
    `select * from meeting_decisions where meeting_id = $1 and deleted_at is null and ${ctx.resources.visibleWhere('meeting_decision', user)} order by created_at`,
    [meeting.id])).filter((d) => !isPublic || (!d.closed_session && !d.restricted));
  const votes = await votesOf(ctx, decisions.map((d) => String(d.id)));
  const outcomes = await ctx.lookups.values('decision_outcome');
  const outcome = (v: unknown) => outcomes.find((o) => o.value === v)?.label ?? String(v ?? '');
  const approvedAt = meeting.minutes_approved_meeting_id
    ? await ctx.db.one<Row>('select ref from meetings where id = $1', [meeting.minutes_approved_meeting_id]) : undefined;
  const approvingDecision = meeting.minutes_approved_decision_id
    ? await ctx.db.one<Row>('select ref, resolution_number from meeting_decisions where id::text = $1', [String(meeting.minutes_approved_decision_id)]) : undefined;
  const state = meeting.status === 'minutes_approved'
    ? `Approved${meeting.minutes_approved_on ? ` on ${displayDate(String(meeting.minutes_approved_on).slice(0, 10))}` : ''}${approvedAt ? ` at meeting ${approvedAt.ref}` : ''}${approvingDecision ? ` (decision ${approvingDecision.ref}${approvingDecision.resolution_number ? `, resolution ${approvingDecision.resolution_number}` : ''})` : ''}`
    : 'Draft: not yet approved';
  const { appName, branding } = await names(ctx);
  const b = new PdfBuilder({
    title: `Minutes: ${meeting.title}`,
    subtitle: `${committee.name} · ${when(meeting.scheduled_at)}${meeting.location ? ` · ${meeting.location}` : ''}`,
    meta: [
      `Meeting ${meeting.ref} · ${state}${meeting.minutes_published_at ? ` · Published ${displayDate(todayInZone(new Date(meeting.minutes_published_at)))}` : ''}`,
      isPublic ? 'Public version: closed-session items are left out' : 'Members\' version: includes closed-session items',
      `Produced ${displayDate(dayInZone())} by ${opts.producedBy}`,
    ],
    appName, author: appName, branding,
    watermark: !isPublic && items.some((i) => i.session === 'closed') ? 'Contains closed-session items: for committee members only' : null,
  });

  // Attendance and quorum, from the committee's membership on the day.
  b.heading('Attendance', 1);
  const day = todayInZone(new Date(meeting.scheduled_at));
  const members = await membersOn(ctx, meeting.committee_id, day);
  const marks = new Map((await ctx.db.query<Row>('select member_id, present, apology from meeting_attendance where meeting_id = $1', [meeting.id])).map((r) => [String(r.member_id), r]));
  if (!members.length) b.note('The committee had no members in office on the day of the meeting.');
  else {
    b.table([{ header: 'Member', weight: 4 }, { header: 'Role', weight: 1.5 }, { header: 'Votes', weight: 1 }, { header: 'Attendance', weight: 2 }],
      await Promise.all(members.map(async (m) => {
        const a = marks.get(String(m.id));
        return [String(m.name), await lookupLabel(ctx, 'committee_role', m.role), m.voting ? 'Yes' : 'No', a?.present ? 'Present' : a?.apology ? 'Apologies' : 'Absent'];
      })));
  }
  const q = await quorumOf(ctx, meeting);
  b.paragraph(q.met === null ? `Quorum: ${q.needed} of ${q.voting} voting members needed. No attendance was recorded.`
    : `${q.present} of ${q.voting} voting members present; ${q.needed} needed. Quorum ${q.met ? 'met' : 'not met'}.`);

  // Declarations of interest (E45-60): those about items left out of this version are not listed.
  const declarations = (await declarationsFor(ctx, user, meeting, !isPublic)).filter((d) => !d.hidden);
  if (declarations.length) {
    b.heading('Declarations of interest', 1);
    b.table([{ header: 'Member', weight: 3 }, { header: 'Item', weight: 3 }, { header: 'Interest', weight: 4 }, { header: 'Action', weight: 2.5 }],
      declarations.map((d) => [String(d.name), d.item_title ? String(d.item_title) : 'The whole meeting', String(d.interest ?? ''), String(d.action_label)]));
  }

  if (String(meeting.minutes ?? '').trim()) {
    b.heading('General minutes', 1);
    b.markdown(printableMarkdown(String(meeting.minutes)));
  }

  const motion = (d: Row) => {
    b.heading(`${d.ref}${d.resolution_number ? ` · Resolution ${d.resolution_number}` : ''}: ${d.title}`, 2);
    if (d.motion_text) b.paragraph(`Motion: ${d.motion_text}`);
    b.keyValues([
      ...(d.mover_name ? [{ label: 'Moved by', value: String(d.mover_name) }] : []),
      ...(d.seconder_name ? [{ label: 'Seconded by', value: String(d.seconder_name) }] : []),
      ...(d.vote_summary ? [{ label: 'Vote', value: String(d.vote_summary) }] : []),
      { label: 'Result', value: outcome(d.outcome) },
      ...(d.resolution_number ? [{ label: 'Resolution number', value: String(d.resolution_number) }] : []),
    ]);
    const list = votes.get(String(d.id)) ?? [];
    if (list.length) {
      b.table([{ header: 'Member', weight: 4 }, { header: 'Vote', weight: 2 }],
        list.map((v) => [String(v.name), v.vote === 'abstain' ? 'Abstained' : v.vote === 'for' ? 'For' : v.vote === 'against' ? 'Against' : v.vote === 'recused' ? 'Recused (declared an interest)' : 'Absent']));
    }
    if (d.notes) b.markdown(printableMarkdown(String(d.notes)));
  };

  const consentMotions = decisions.filter((d) => d.consent_agenda);
  const consent = items.filter((i) => i.consent);
  if (consent.length || consentMotions.length) {
    b.heading('Consent agenda', 1);
    if (consent.length) b.paragraph(`Items on the consent agenda: ${consent.map((i) => `${all.indexOf(i) + 1}. ${i.title}`).join('; ')}.`);
    for (const d of consentMotions) motion(d);
  }
  for (const item of items) {
    const n = all.indexOf(item) + 1;
    b.heading(`${n}. ${item.title}${item.session === 'closed' ? ' (closed session)' : ''}`, 1);
    if (item.discussion) b.markdown(printableMarkdown(String(item.discussion)));
    else if (!item.consent) b.paragraph('No discussion recorded.', { muted: true });
    for (const d of decisions.filter((x) => String(x.agenda_item_id ?? '') === String(item.id) && !x.consent_agenda)) motion(d);
  }
  const closedLeftOut = all.length - items.length;
  if (closedLeftOut) b.note(`${closedLeftOut} closed-session ${closedLeftOut === 1 ? 'item is' : 'items are'} not included in this version.`);
  const others = decisions.filter((d) => !d.consent_agenda && (!d.agenda_item_id || !items.some((i) => String(i.id) === String(d.agenda_item_id))));
  if (others.length) {
    b.heading('Other decisions', 1);
    for (const d of others) motion(d);
  }
  return b.finish();
}

export function sendPdf(reply: FastifyReply, pdf: Buffer, name: string) {
  reply.header('content-type', PDF_TYPE);
  reply.header('content-disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
  reply.header('cache-control', 'no-store');
  return reply.send(pdf);
}

export const versionOf = (req: FastifyRequest): BookVersion => ((req.query as Row)?.version === 'members' ? 'members' : 'public');

export function registerBook(ctx: ModuleContext) {
  const { app } = ctx;

  async function wanted(req: FastifyRequest, meeting: Row): Promise<BookVersion> {
    const version = versionOf(req);
    if (version === 'members' && !(await seesClosed(ctx, req.user, meeting.committee_id))) {
      ctx.fail(403, 'forbidden', 'Only the committee\'s members and the people who prepare its meetings may have the members\' version.');
    }
    return version;
  }

  app.get('/api/meetings/:id/book', { preHandler: ctx.requirePerm('governance.view') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    const version = await wanted(req, meeting);
    const textOnly = (req.query as Row)?.text === '1';
    const made = await makeBook(ctx, req.user, meeting, { version, textOnly, producedBy: req.user!.displayName });
    await ctx.audit(req, {
      action: 'meeting.book', recordType: 'meeting', recordId: meeting.id,
      summary: `Board book of ${meeting.ref} produced (${version === 'members' ? 'members\' version' : 'public version'}${textOnly ? ', text only' : ''})`,
      after: { version, text_only: textOnly, appended: made.appended, not_appended: made.skipped },
    });
    return sendPdf(reply, made.pdf, `${meeting.ref}-board-book${version === 'public' ? '-public' : ''}`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/book', tag: 'Governance', permission: 'governance.view',
    summary: 'The board book as one PDF: cover, agenda, each item with its papers (documents and Word or text papers printed, PDF papers appended). The members\' version includes closed-session items and needs a member or governance.edit',
    query: { version: 'public (default) or members', text: '1: print the text of PDF papers instead of appending them (for screen readers)' },
    response: 'application/pdf',
  });

  app.get('/api/meetings/:id/minutes/pdf', { preHandler: ctx.requirePerm('governance.view') }, async (req, reply) => {
    const meeting = await meetingFor(ctx, req);
    const version = await wanted(req, meeting);
    const pdf = await makeMinutes(ctx, req.user, meeting, { version, producedBy: req.user!.displayName });
    await ctx.audit(req, { action: 'meeting.minutes_pdf', recordType: 'meeting', recordId: meeting.id, summary: `Minutes of ${meeting.ref} produced as a PDF (${version === 'members' ? 'members\' version' : 'public version'})`, after: { version } });
    return sendPdf(reply, pdf, `${meeting.ref}-minutes${version === 'public' ? '-public' : ''}`);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/meetings/:id/minutes/pdf', tag: 'Governance', permission: 'governance.view',
    summary: 'The minutes as a PDF: attendance and quorum, each item\'s discussion and motions with mover, seconder, vote and resolution number; "Draft" until approved',
    query: { version: 'public (default) or members' }, response: 'application/pdf',
  });
}
