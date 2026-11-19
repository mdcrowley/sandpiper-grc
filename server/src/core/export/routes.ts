// The record fact sheet: one record of any type as a PDF (its fields, tags and recent history).
// Taking a record out of the application is an export: it needs `<module>.export`, it is audited,
// and a restricted record is watermarked.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CustomFields } from '../customfields.ts';
import type { Db } from '../db.ts';
import type { AuditInput, FieldDef, ResourceDef, Row, SessionUser } from '../module.ts';
import { appName, cellString, restrictedLine, slug } from './list.ts';
import { PdfBuilder, PDF_TYPE } from './pdf.ts';
import { formatStamp } from './zone.ts';

export interface ExportDeps {
  app: FastifyInstance;
  db: Db;
  audit: (req: FastifyRequest | null, ev: AuditInput) => Promise<void>;
  custom: CustomFields;
  decorate: (def: ResourceDef, rows: Row[], user: SessionUser | null) => Promise<Row[]>;
  visibleRecord: (req: FastifyRequest, type: unknown, id: unknown, action?: string) => Promise<{ def: ResourceDef; row: Row }>;
  labelOf: (def: ResourceDef, row: Row) => string;
}

/** Builds the fact sheet of one record, as the person asking may see it. */
export async function factSheet(deps: ExportDeps, user: SessionUser, def: ResourceDef, raw: Row): Promise<{ title: string; pdf: Buffer; restricted: boolean }> {
  const [row] = await deps.decorate(def, [{ ...raw }], user);
  const customDefs = await deps.custom.defs(def.type);
  const restricted = def.restricted === true || row.restricted === true;
  const now = new Date();
  const ref = def.ref ? String(row[def.ref.field] ?? '') : '';
  const title = String(row[def.titleField] ?? def.label);
  const pdf = new PdfBuilder({
    title: ref ? `${ref} ${title}` : title,
    subtitle: def.label,
    appName: await appName(deps.db),
    author: user.displayName,
    watermark: restricted ? restrictedLine(user.displayName, now) : null,
    meta: [`Generated ${formatStamp(now)} for ${user.displayName}`],
  });
  const fields: [string, FieldDef][] = Object.entries(def.fields).filter(([n]) => n !== def.titleField && n !== def.ref?.field);
  const facts = fields.map(([n, f]) => ({ label: f.label, value: cellString(row, n, f) }));
  facts.push(
    { label: 'Created', value: `${formatStamp(row.created_at)}${row._display?.created_by ? ` by ${row._display.created_by}` : ''}` },
    { label: 'Last updated', value: `${formatStamp(row.updated_at)}${row._display?.updated_by ? ` by ${row._display.updated_by}` : ''}` },
  );
  pdf.heading('Details');
  pdf.keyValues(facts);
  const custom = Object.entries(customDefs);
  if (custom.length) {
    pdf.heading('More details');
    pdf.keyValues(custom.map(([n, f]) => ({ label: f.label, value: cellString(row, n, f) })));
  }
  const tags = (row._tags as string[] | undefined) ?? [];
  if (tags.length) {
    pdf.heading('Tags');
    pdf.paragraph(tags.join(', '));
  }
  const history = await deps.db.query<{ at: Date; actor_name: string | null; summary: string | null }>(
    `select at, actor_name, summary from audit_events where record_type = $1 and record_id = $2
       and action not like '%.export' order by at desc, id desc limit 15`, [def.type, row.id]);
  if (history.length) {
    pdf.heading('Recent history');
    pdf.table(
      [{ header: 'When', weight: 18 }, { header: 'Who', weight: 18 }, { header: 'What', weight: 64 }],
      history.map((h) => [formatStamp(h.at), h.actor_name ?? 'System', h.summary ?? '']),
    );
  }
  return { title: ref || title, pdf: await pdf.finish(), restricted };
}

export function registerExportRoutes(deps: ExportDeps) {
  const { app } = deps;
  app.get('/api/records/:type/:id/pdf', async (req, reply) => {
    const { type, id } = req.params as { type: string; id: string };
    const { def, row } = await deps.visibleRecord(req, type, id, 'export');
    const sheet = await factSheet(deps, req.user!, def, row);
    await deps.audit(req, {
      action: `${def.type}.export`, recordType: def.type, recordId: row.id,
      summary: `Fact sheet of ${def.label.toLowerCase()} ${deps.labelOf(def, row)} exported to PDF${sheet.restricted ? ' (restricted record)' : ''}`,
      after: { format: 'pdf', restricted: sheet.restricted },
    });
    reply.header('content-type', PDF_TYPE);
    reply.header('content-disposition', `attachment; filename="${slug(`${def.label}-${sheet.title}`)}.pdf"`);
    reply.header('cache-control', 'no-store');
    return sheet.pdf;
  });
}
