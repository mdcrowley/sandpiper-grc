// Acknowledgment routes: a person's own list and acknowledgment, and the tracking view per policy.
import type { FastifyRequest } from 'fastify';
import { guardFormula } from '../../core/export/csv.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { ackState, ackTracking } from './acknowledgments.ts';
import { daysBetween, localDate } from './dates.ts';
import { renderPolicyMarkdown } from './markdown.ts';
import { languageRead, readingOf, translatedLanguages, translateTitles } from './translations.ts';
import { BASE_LANGUAGE, englishName } from '../../../../shared/i18n.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  s = guardFormula(s); // stop spreadsheet formula injection (core/export/csv.ts, W17-5)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATE_LABEL: Record<string, string> = {
  acknowledged: 'Acknowledged', overdue: 'Overdue', outstanding: 'Outstanding', superseded: 'Closed',
};

export function registerAckRoutes(ctx: ModuleContext) {
  const { db } = ctx;

  const MINE = `
    select a.id, a.policy_id, a.version_id, a.requested_at, a.due_on, a.acknowledged_at, a.superseded_at, a.language as acknowledged_language,
           p.ref as policy_ref, p.title as policy_title, p.summary as policy_summary, v.version, v.effective_on
    from policy_acknowledgements a
    join policies p on p.id = a.policy_id and p.deleted_at is null
    join policy_versions v on v.id = a.version_id
    where a.user_id = $1`;

  const mineView = (a: Row, today: string) => {
    const state = ackState(a, today);
    return {
      id: a.id, policy_id: a.policy_id, policy_ref: a.policy_ref, policy_title: a.policy_title, policy_summary: a.policy_summary,
      version: Number(a.version), effective_on: a.effective_on, requested_at: a.requested_at, due_on: a.due_on,
      acknowledged_at: a.acknowledged_at, acknowledged_language: a.acknowledged_language ?? null, state, days_left: daysBetween(today, a.due_on),
    };
  };

  // A person's own requests. Needs only a session: the people asked to acknowledge a policy
  // are often not people who can open the policy library.
  // `lang` (E41-07): titles of versions translated into that language are given in it.
  ctx.app.get('/api/policies/acknowledgments/mine', async (req) => {
    const today = localDate();
    const rows = await db.query<Row>(
      `${MINE} and (a.acknowledged_at is not null or a.superseded_at is null)
       order by (a.acknowledged_at is not null), a.due_on, p.title`,
      [req.user!.id],
    );
    const list = (await translateTitles(db, rows, (req.query as Row).lang)).map((a) => ({ ...mineView(a, today), language: a.language }));
    return {
      today,
      awaiting: list.filter((r) => r.state !== 'acknowledged'),
      acknowledged: list.filter((r) => r.state === 'acknowledged').sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at))),
    };
  });

  async function needOwn(req: FastifyRequest): Promise<Row> {
    const id = (req.params as Row).ackId;
    const row = typeof id === 'string' && UUID.test(id) ? await db.one<Row>(`${MINE} and a.id = $2`, [req.user!.id, id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Acknowledgment request not found.');
  }

  /**
   * The text a person is asked to acknowledge: exactly the version named in their request, in the
   * language asked for (`lang`) when the version has a translation in it, else the original (E41-07).
   */
  ctx.app.get('/api/policies/acknowledgments/:ackId', async (req) => {
    const a = await needOwn(req);
    const v = (await db.one<Row>('select id, body, change_summary from policy_versions where id = $1', [a.version_id]))!;
    const reading = await readingOf(db, a, v, (req.query as Row).lang);
    const languages = (await translatedLanguages(db, [String(a.version_id)])).get(String(a.version_id)) ?? [];
    return {
      ...mineView(a, localDate()), policy_title: reading.title, policy_summary: reading.summary,
      change_summary: reading.change_summary, body_html: renderPolicyMarkdown(reading.body),
      language: reading.language, original_language: BASE_LANGUAGE, translations: languages,
    };
  });

  // Body (optional): { language } - the language the person read (E41-07). It is recorded when the
  // version has a translation in it; otherwise the original's language is recorded.
  ctx.app.post('/api/policies/acknowledgments/:ackId/acknowledge', async (req) => {
    const a = await needOwn(req);
    const today = localDate();
    if (a.acknowledged_at) return mineView(a, today);
    if (a.superseded_at) ctx.fail(409, 'superseded', 'This version has been replaced or the policy retired. There is nothing to acknowledge.');
    const language = await languageRead(db, String(a.version_id), ((req.body ?? {}) as Row).language);
    const stamped = await db.one<Row>(
      'update policy_acknowledgements set acknowledged_at = now(), language = $2 where id = $1 and acknowledged_at is null returning acknowledged_at', [a.id, language],
    );
    const at = stamped?.acknowledged_at ?? new Date();
    await ctx.audit(req, {
      action: 'policy.acknowledge', recordType: 'policy', recordId: a.policy_id,
      summary: `${req.user!.displayName} acknowledged version ${a.version} of ${[a.policy_ref, a.policy_title].filter(Boolean).join(' ')}${language === BASE_LANGUAGE ? '' : ` (read in ${englishName(language)})`}`,
      after: { version: Number(a.version), user_id: req.user!.id, acknowledged_at: at, late: a.due_on < today, language },
    });
    return mineView({ ...a, acknowledged_at: at, acknowledged_language: language }, today);
  });

  // ---------- tracking ----------

  ctx.app.get('/api/policies/:id/acknowledgments', { preHandler: ctx.requirePerm('policies.view') }, async (req, reply) => {
    const policy = (await ctx.resources.find('policy', (req.params as Row).id, req.user)) ?? ctx.fail(404, 'not_found', 'Policy not found.');
    const query = req.query as Record<string, string>;
    const wanted = Number(query.version);
    // Default: the version readers see now (the last one published, even after the policy is retired).
    const version = await db.one<Row>(
      Number.isInteger(wanted) && wanted > 0
        ? `select * from policy_versions where policy_id = $1 and version = $2 and status in ('published', 'superseded')`
        : `select * from policy_versions where policy_id = $1 and status = 'published' and $2::int is null`,
      [policy.id, Number.isInteger(wanted) && wanted > 0 ? wanted : null],
    );
    const data = await ackTracking(ctx, policy, version);
    if (query.format !== 'csv') return data;

    if (!ctx.can(req.user, 'policies.export')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    const head = ['Policy', 'Version', 'Person', 'Email', 'Department', 'Status', 'Requested', 'Due', 'Acknowledged', 'Language read', 'Days overdue', 'Last reminded'];
    const lines = [head.join(',')];
    for (const r of data.rows) {
      lines.push([
        [policy.ref, policy.title].filter(Boolean).join(' '), data.version?.version, r.user_name, r.email, r.department,
        STATE_LABEL[r.state], r.requested_at, r.due_on, r.acknowledged_at, r.language ? englishName(String(r.language)) : '', r.days_overdue || '', r.reminded_at,
      ].map(csvCell).join(','));
    }
    await ctx.audit(req, {
      action: 'policy.ack_export', recordType: 'policy', recordId: policy.id,
      summary: `Exported ${data.rows.length} acknowledgment record${data.rows.length === 1 ? '' : 's'} for ${[policy.ref, policy.title].filter(Boolean).join(' ')} to CSV`,
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="policy-acknowledgments.csv"`);
    return '﻿' + lines.join('\r\n');
  });
}
