// E03-16: knowledge articles marked "IT agents only" are hidden from people who are not agents.
//
// An agent is anyone holding one permission: the setting `knowledge.agent_permission`
// (default `tickets.edit`, the people who work tickets). The rule is the knowledge article
// type's row rule (ResourceDef.rowRule), part of the visibility rule core applies everywhere:
// lists, reads, search, record pickers and labels, comments, history, links, tags, watchers,
// files, fact sheets, exports, the report builder, dashboard widgets and the MCP tools. It is not
// tied to any URL, so no spelling of a path gets around it.
//
// Figures (GET /api/knowledge/stats) are the same for everyone (docs/security.md, "Figures"):
// agent-only articles count, but are never matched, grouped or labeled by their words or people,
// for agents and non-agents alike.
import type { ModuleContext, RowRule, SessionUser } from '../../core/module.ts';

export const AGENT_AUDIENCE = 'agents';
const SETTING = 'knowledge.agent_permission';
const DEFAULT_PERMISSION = 'tickets.edit';

const literal = (value: string) => `'${String(value).replace(/'/g, "''")}'`;
const textArray = (values: readonly string[]) => `array[${values.map(literal).join(', ')}]::text[]`;

/**
 * SQL: whether `user` holds the agent permission, read from the setting inside the statement so the
 * rule never goes stale. Mirrors `can()` (core/services.ts): the exact permission, `<module>.*` or
 * `*`, unless the permission's module is switched off.
 */
export function agentSql(user: SessionUser): string {
  const perm = `coalesce((select s_.value #>> '{}' from settings s_ where s_.key = ${literal(SETTING)}), ${literal(DEFAULT_PERMISSION)})`;
  const mod = `split_part(${perm}, '.', 1)`;
  const grants = textArray(user.permissions ?? []);
  return `(${mod} <> all(${textArray(user.off ?? [])}) and (${perm} = any(${grants}) or ${mod} || '.*' = any(${grants}) or '*' = any(${grants})))`;
}

/** The knowledge article type's row rule. */
export const audienceRule: RowRule = {
  where: (user, col) => `(${col('audience')} is distinct from ${literal(AGENT_AUDIENCE)} or ${agentSql(user)})`,
  figures: 'mask',
  hidden: (col) => `${col('audience')} = ${literal(AGENT_AUDIENCE)}`,
};

export function makeAudience(ctx: ModuleContext) {
  const permission = () => ctx.settings.get<string>(SETTING, DEFAULT_PERMISSION);
  async function isAgent(user: SessionUser | null | undefined): Promise<boolean> {
    return !user || ctx.can(user, await permission());
  }
  return { isAgent, permission };
}
