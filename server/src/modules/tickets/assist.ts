// Help while logging and working tickets: likely duplicates and knowledge articles for a
// title, and the counts behind the queue presets.
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { AGENT_AUDIENCE } from './audience.ts';

const STOP = new Set(['about', 'after', 'again', 'cannot', 'does', 'doesn', 'from', 'have', 'into', 'need', 'needs', 'request', 'that', 'this',
  'when', 'will', 'with', 'working', 'work', 'issue', 'problem', 'please', 'help', 'unable', 'they', 'their', 'there', 'been', 'not', 'the', 'and', 'for']);

/** The words of a title worth matching on: at most six, three letters or more, no filler. */
export function keywords(title: unknown): string[] {
  const words = String(title ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 6);
}

export function registerAssist(ctx: ModuleContext, isAgent: (user: SessionUser | null) => Promise<boolean>) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('tickets.view') };

  /** GET /api/tickets/suggest?title=&exclude= : open or recent tickets and published articles that share words with the title. */
  app.get('/api/tickets/suggest', view, async (req) => {
    const q = req.query as Record<string, string>;
    const words = keywords(q.title);
    if (!words.length) return { words, tickets: [], articles: [] };
    const patterns = words.map((w) => `%${w.replace(/[%_\\]/g, '\\$&')}%`);
    const score = (column: string) => patterns.map((_, i) => `(case when ${column} ilike $${i + 1} then 1 else 0 end)`).join(' + ');
    const need = Math.min(2, words.length);
    const exclude = UUID_RE.test(String(q.exclude ?? '')) ? q.exclude : null;

    const tickets = await db.query<Row>(
      `select id, ref, title, status, priority, requester_name, opened_at, resolved_at, score from (
         select t.*, ${score('t.title')} as score from tickets t
         where t.deleted_at is null and ${ctx.resources.visibleWhere('ticket', req.user, 't')}
           and (t.resolved_at is null or t.resolved_at > now() - interval '7 days')
           and ($${patterns.length + 1}::uuid is null or t.id <> $${patterns.length + 1}::uuid)
       ) s where score >= ${need} order by score desc, (resolved_at is null) desc, opened_at desc limit 5`,
      [...patterns, exclude]);

    let articles: Row[] = [];
    if (ctx.can(req.user, 'knowledge.view')) {
      const agent = await isAgent(req.user);
      articles = await db.query<Row>(
        `select id, ref, title, category, audience, score from (
           select a.*, 2 * (${score('a.title')}) + (${score(`coalesce(a.body, '')`)}) as score from knowledge_articles a
           where a.deleted_at is null and a.status = 'published' and ${ctx.resources.visibleWhere('knowledge_article', req.user, 'a')}
             ${agent ? '' : `and a.audience <> '${AGENT_AUDIENCE}'`}
         ) s where score >= ${need} order by score desc, helpful_yes desc, updated_at desc limit 4`,
        patterns);
    }
    return { words, tickets, articles };
  });

  /** GET /api/tickets/queue-counts : how many tickets sit behind each queue preset, for the signed-in person. */
  app.get('/api/tickets/queue-counts', view, async (req) => db.one<Row>(
    `select count(*) filter (where resolved_at is null)::int as open,
            count(*) filter (where resolved_at is null and assignee_id = $1)::int as mine,
            count(*) filter (where resolved_at is null and assignee_id is null)::int as unassigned,
            count(*) filter (where resolved_at is null and resolve_warned and not resolve_breached)::int as at_risk,
            count(*) filter (where resolved_at is null and resolve_breached)::int as breaching,
            count(*) filter (where resolved_at is null and with_vendor)::int as with_vendor,
            count(*) filter (where resolved_at is null and approval_status = 'pending')::int as awaiting_approval,
            count(*) filter (where resolved_at is null and major_incident)::int as major
     from tickets where deleted_at is null and ${ctx.resources.visibleWhere('ticket', req.user)}`, [req.user!.id]));
}
