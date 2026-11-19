// "Was this helpful?" on a knowledge article: shared by the knowledge base and the portal.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

/** One vote per person per article version. Voting again replaces the earlier vote. */
export async function recordArticleFeedback(ctx: ModuleContext, req: FastifyRequest, a: Row, helpful: unknown) {
  const { db } = ctx;
  if (typeof helpful !== 'boolean') ctx.fail(400, 'validation', 'Check the highlighted fields.', { helpful: 'Say whether the article helped: yes or no.' });
  const version = Number(a.version ?? 1);
  const prior = await db.one<{ helpful: boolean }>(
    'select helpful from knowledge_article_feedback where article_id = $1 and user_id = $2 and version = $3', [a.id, req.user!.id, version]);
  if (prior && prior.helpful === helpful) {
    return { helpful_yes: a.helpful_yes, helpful_no: a.helpful_no, your_vote: helpful, changed: false };
  }
  await db.query(
    `insert into knowledge_article_feedback (article_id, user_id, version, helpful) values ($1,$2,$3,$4)
     on conflict (article_id, user_id, version) do update set helpful = excluded.helpful, updated_at = now()`,
    [a.id, req.user!.id, version, helpful]);
  const yes = (helpful ? 1 : 0) - (prior?.helpful === true ? 1 : 0);
  const no = (helpful ? 0 : 1) - (prior?.helpful === false ? 1 : 0);
  const row = await db.one<Row>(
    `update knowledge_articles set helpful_yes = greatest(0, helpful_yes + $2::int), helpful_no = greatest(0, helpful_no + $3::int)
     where id = $1 returning helpful_yes, helpful_no`, [a.id, yes, no]);
  await ctx.audit(req, {
    action: 'knowledge_article.feedback', recordType: 'knowledge_article', recordId: a.id,
    summary: `${prior ? 'Changed vote to' : 'Marked'} ${helpful ? 'helpful' : 'not helpful'}: ${a.ref} ${a.title} (version ${version})`,
    before: { helpful_yes: a.helpful_yes, helpful_no: a.helpful_no }, after: { helpful_yes: row!.helpful_yes, helpful_no: row!.helpful_no },
  });
  return { ...row, your_vote: helpful, changed: true };
}

/** The reader's current vote on the article's current version, or null. */
export async function articleVote(ctx: ModuleContext, userId: string, a: Row): Promise<boolean | null> {
  const r = await ctx.db.one<{ helpful: boolean }>(
    'select helpful from knowledge_article_feedback where article_id = $1 and user_id = $2 and version = $3', [a.id, userId, Number(a.version ?? 1)]);
  return r ? r.helpful : null;
}
