import type { ModuleContext } from '../../core/module.ts';
import { makeAdmin } from './admin.ts';
import { makeBase } from './base.ts';
import { makeConflicts } from './conflicts.ts';
import { makeWorkflow } from './workflow.ts';

/** The change service, assembled from its parts. */
export function makeService(ctx: ModuleContext) {
  const base = makeBase(ctx);
  const conflicts = makeConflicts(ctx, base);
  const workflow = makeWorkflow(ctx, base, conflicts);
  const admin = makeAdmin(ctx, base);
  return { base, needChange: base.needChange, ...conflicts, ...workflow, ...admin };
}

export type ChangeService = ReturnType<typeof makeService>;
