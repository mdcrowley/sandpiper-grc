// E11-25: project gate decisions on the shared approval workflows. A gate template may name a
// workflow of the kind `project_gate`; once the gate's checklist and required documents are complete,
// someone who may edit the project asks for approval, and the workflow's outcome is recorded as a
// gate decision (an approval passes the gate and moves the project on, as a recorded decision does).
// Decisions recorded by hand stay possible; recording one stops a workflow running for that gate.
import { defineApprovalKind, type ApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext } from '../../core/module.ts';
import { GATE_KIND, type ProjectService } from './service.ts';

export const DEFAULT_GATE_WORKFLOW = 'Gate decision';

export function gateApprovalKind(svc: ProjectService): ApprovalKind {
  return {
    key: GATE_KIND,
    recordType: 'project',
    label: 'Project gate decision',
    startsWhen: "Someone asks for approval at a gate whose template names this workflow, once the gate's checklist and required documents are complete",
    outcome: 'Approved: the gate passes and the project moves to the next stage, recorded as a gate decision; rejected: a rejected decision is recorded with the reason and the gate stays open',
    approverPermission: 'projects.approve',
    async install(h) {
      // Gates were decided by hand only, with nothing waiting in between: there is nothing to adopt,
      // and no template is pointed at the new workflow (an administrator chooses that per gate).
      if (await h.hasDefinitions()) return;
      await h.define({
        name: DEFAULT_GATE_WORKFLOW,
        description: 'One approval from someone who may approve projects. Name it on a gate template (Project settings > Gates) to ask for gate decisions through it.',
        steps: [{ key: 'approve', name: 'Gate approval', approvers: { kind: 'permission', permission: 'projects.approve' }, quorum: 'any', due_hours: 120 }],
      });
    },
    async onFinish(e) {
      await svc.finishGateApproval(e);
    },
  };
}

export function registerGateApproval(ctx: ModuleContext, svc: ProjectService): void {
  defineApprovalKind(ctx.app, gateApprovalKind(svc));
}
