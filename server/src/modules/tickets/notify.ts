// Who to tell about a ticket, and the guarded call to the notification service.
// The notifications module may not be loaded: every send goes through `send`, which then does nothing.
import type { ModuleContext, Row } from '../../core/module.ts';

export interface TicketNotice {
  userIds?: (string | null | undefined)[];
  permission?: string;
  kind: string;
  title: string;
  body?: string | null;
  recordType?: string;
  recordId?: string;
  route?: string;
  oncePerDay?: boolean;
}

type Notify = (input: TicketNotice) => Promise<{ sent: number; skipped: number }>;

/** Members of each assignment group, as user ids: the setting `tickets.group_members`. */
export type GroupMembers = Record<string, string[]>;

export function makeTicketNotify(ctx: ModuleContext) {
  async function send(input: TicketNotice): Promise<number> {
    if (!ctx.app.hasDecorator('notify')) return 0;
    const result = await (ctx.app as unknown as { notify: Notify }).notify(input);
    return result.sent;
  }

  const groups = () => ctx.settings.get<GroupMembers>('tickets.group_members', {});

  /** Members of a group, or everyone who works tickets when the group has no members recorded. */
  async function groupRecipients(group: unknown): Promise<Pick<TicketNotice, 'userIds' | 'permission'>> {
    const members = typeof group === 'string' && group ? (await groups())[group] ?? [] : [];
    return members.length ? { userIds: members } : { permission: 'tickets.edit' };
  }

  /** The assignee, or the assignment group when nobody is assigned. */
  async function owners(ticket: Row): Promise<Pick<TicketNotice, 'userIds' | 'permission'>> {
    if (ticket.assignee_id) return { userIds: [ticket.assignee_id] };
    return groupRecipients(ticket.assignment_group);
  }

  const about = (ticket: Row) => ({ recordType: 'ticket', recordId: String(ticket.id) });
  const name = (ticket: Row) => [ticket.ref, ticket.title].filter(Boolean).join(' ');

  return { send, groups, groupRecipients, owners, about, name };
}

export type TicketNotify = ReturnType<typeof makeTicketNotify>;
