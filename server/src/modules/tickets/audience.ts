// E03-16: knowledge articles marked "IT agents only" are hidden from people who are not agents.
//
// An agent is anyone holding one permission: the setting `knowledge.agent_permission`
// (default `tickets.edit`, the people who work tickets). The record-type registry has no
// per-row visibility rule beyond the restricted flag, so the rule is applied at the edge:
// one hook narrows the article list for non-agents and answers "not found" for anything
// that names an agent-only article; another removes such articles from search results,
// record pickers and related-record lists.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

export const AGENT_AUDIENCE = 'agents';
const TYPE = 'knowledge_article';

export function makeAudience(ctx: ModuleContext) {
  const { db } = ctx;

  const permission = () => ctx.settings.get<string>('knowledge.agent_permission', 'tickets.edit');
  async function isAgent(user: SessionUser | null | undefined): Promise<boolean> {
    return !user || ctx.can(user, await permission());
  }

  /** Which of these articles are for agents only. */
  async function agentOnly(ids: unknown[]): Promise<Set<string>> {
    const clean = [...new Set(ids.map(String).filter((i) => UUID_RE.test(i)))];
    if (!clean.length) return new Set();
    const rows = await db.query<{ id: string }>(
      'select id from knowledge_articles where id = any($1::uuid[]) and audience = $2', [clean, AGENT_AUDIENCE]);
    return new Set(rows.map((r) => r.id));
  }

  const hidden = async (id: unknown) => (await agentOnly([id])).size > 0;
  const notFound = () => ctx.fail(404, 'not_found', 'Record not found.');

  function register() {
    ctx.app.addHook('preHandler', async (req: FastifyRequest) => {
      if (!req.user || !req.url.startsWith('/api/')) return;
      const path = req.url.split('?')[0];
      const query = (req.query ?? {}) as Record<string, string>;
      const body = (req.body ?? {}) as Row;

      if (path === '/api/knowledge' || path === '/api/knowledge/stats') {
        if (req.method !== 'GET' || (await isAgent(req.user))) return;
        // Narrow whatever was asked for to the values a non-agent may see.
        const asked = query['f.audience'] ? String(query['f.audience']).split(',') : null;
        const all = (await ctx.lookups.values('kb_audience')).map((a) => a.value).filter((a) => a !== AGENT_AUDIENCE);
        const allowed = asked ? asked.filter((a) => a !== AGENT_AUDIENCE && all.includes(a)) : all;
        (req.query as Record<string, string>)['f.audience'] = allowed.length ? allowed.join(',') : '__none__';
        return;
      }
      if (path.startsWith('/api/knowledge/')) {
        const id = path.split('/')[3];
        if (UUID_RE.test(id) && !(await isAgent(req.user)) && (await hidden(id))) notFound();
        return;
      }
      // Comments, history, links and files of a record are addressed by type and id.
      const named: [unknown, unknown][] = [
        [query.record_type, query.record_id], [body.record_type, body.record_id],
        [body.from_type, body.from_id], [body.to_type, body.to_id],
      ];
      const ids = named.filter(([type]) => type === TYPE).map(([, id]) => id);
      if (ids.length && !(await isAgent(req.user)) && (await agentOnly(ids)).size) notFound();
    });

    ctx.app.addHook('preSerialization', async (req: FastifyRequest, _reply, payload: unknown) => {
      if (!req.user || req.method !== 'GET' || !Array.isArray(payload) || !payload.length) return payload;
      const path = req.url.split('?')[0];
      let idOf: ((item: Row) => unknown) | null = null;
      if (path === '/api/search') idOf = (i) => (i.type === TYPE ? i.id : null);
      else if (path === '/api/links') idOf = (i) => (i.type === TYPE ? i.recordId : null);
      else if (path === '/api/records/lookup' && (req.query as Row)?.type === TYPE) idOf = (i) => i.id;
      if (!idOf) return payload;
      const ids = (payload as Row[]).map(idOf).filter(Boolean);
      if (!ids.length || (await isAgent(req.user))) return payload;
      const hide = await agentOnly(ids);
      return hide.size ? (payload as Row[]).filter((i) => !hide.has(String(idOf!(i)))) : payload;
    });
  }

  return { isAgent, agentOnly, register, permission };
}
