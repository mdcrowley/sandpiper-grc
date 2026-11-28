import type { ModuleContext, SessionUser } from '../../core/module.ts';
import type { McpSettings } from './settings.ts';
import { hasWriteScope } from './settings.ts';
import type { Availability, Session, ToolSpec } from './toolkit.ts';
import { ACCOUNT_TOOLS } from './tools-accounts.ts';
import { APPROVAL_TOOLS } from './tools-approvals.ts';
import { DOCUMENT_TOOLS } from './tools-documents.ts';
import { FILE_TOOLS } from './tools-files.ts';
import { PROGRAM_TOOLS } from './tools-programs.ts';
import { RECORD_TOOLS } from './tools-records.ts';
import { MODEL_TOOLS } from './tools-models.ts';
import { WORK_TOOLS } from './tools-work.ts';

/**
 * Every tool the server knows, in the order they are listed. The one delete tool, delete_record, is
 * offered only while data load mode is on, for records a load created (E18-70).
 */
export const ALL_TOOLS: ToolSpec[] = [...RECORD_TOOLS, ...FILE_TOOLS, ...MODEL_TOOLS, ...WORK_TOOLS, ...APPROVAL_TOOLS, ...PROGRAM_TOOLS, ...DOCUMENT_TOOLS, ...ACCOUNT_TOOLS];

export function availability(ctx: ModuleContext, permissions: string[]): Availability {
  const user = { permissions } as SessionUser;
  const can = (perm: string) => ctx.can(user, perm);
  return {
    can,
    sees(type) {
      const def = ctx.resources.get(type);
      return !!def && can(`${def.module}.view`) && (def.restricted !== true || can('security.view'));
    },
  };
}

/** Why a tool is or is not offered to a caller (also used by the administrators' screen with no caller). */
export function toolState(tool: ToolSpec, settings: McpSettings, a: Availability | null, session: Session | null): { offered: boolean; reason: string | null } {
  if (settings.allowedTools && !settings.allowedTools.includes(tool.name)) return { offered: false, reason: 'Not in the allowed tool list.' };
  if (session?.tools && !session.tools.includes(tool.name)) return { offered: false, reason: 'Not chosen for this token or for the roles of its owner.' };
  if (tool.write && !settings.writeEnabled) return { offered: false, reason: 'Write access for AI assistants is off.' };
  if (session && tool.write && !hasWriteScope(session.permissions)) return { offered: false, reason: 'The token has no create or edit permissions.' };
  if (a && tool.available && !tool.available(a)) return { offered: false, reason: 'Needs a part of the application or a permission this caller does not have.' };
  if (tool.dataLoadOnly && !session?.dataLoad?.allowed) return { offered: false, reason: 'Only while data load mode is on, for administrators (Administration > Settings).' };
  return { offered: true, reason: null };
}

/**
 * The tools this installation has now: a tool whose part of the application is switched off
 * (Administration > Features) is left out of every list, administrators' included (E14-34).
 */
export function installedTools(ctx: ModuleContext): ToolSpec[] {
  const a = availability(ctx, ['*']);
  return ALL_TOOLS.filter((t) => !t.available || t.available(a));
}

/** The tools one caller is offered. */
export function offeredTools(ctx: ModuleContext, settings: McpSettings, session: Session): ToolSpec[] {
  const a = availability(ctx, session.permissions);
  return ALL_TOOLS.filter((t) => toolState(t, settings, a, session).offered);
}
