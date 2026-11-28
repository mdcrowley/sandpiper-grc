import { z } from 'zod';
import { qs } from './caller.ts';
import { resolveValues } from './resolve.ts';
import { fail, type ToolContext, type ToolSpec } from './toolkit.ts';

// Accounts used only to name people in a data load (E18-95): employees and vendor contacts who must
// appear as requesters, comment authors, assignees, owners or "as" in loaded history, but who are not
// to sign in. The account is made disabled through POST /api/data-load/accounts (admin/users.ts), with
// no password, set-up link, invitation or email; everyone else stays a roster person (create_record
// with type "person").

type Json = Record<string, any>;
const loading = (t: ToolContext) => t.session.dataLoad?.allowed === true;
const PERSON_FIELD = { label: 'Roster person', type: 'ref', to: 'person' };

/**
 * The roster person to link the account to (people module): the one named (as create_record matches a
 * person: id, reference, exact name, email or employee number), or, when none is named, the one roster
 * person with the account's real email address. Undefined when there is none or the roster is not here.
 */
async function rosterPerson(t: ToolContext, named: string | undefined, email: string | null): Promise<Json | undefined> {
  const people = (await t.meta()).resources.person;
  if (!people) {
    if (named) fail('The people roster is not available to you, so no roster person can be linked.', 'validation', { person: 'Not available.' });
    return undefined;
  }
  if (named) {
    const r = await resolveValues(t, { person: named }, () => PERSON_FIELD);
    if (r.errors.person) fail(r.errors.person, 'validation', { person: r.errors.person });
    return t.api.get(`${people.path}/${r.out.person}`);
  }
  if (!email) return undefined;
  const found = await t.api.tryGet<{ rows: Json[] }>(`${people.path}${qs({ 'f.email': [...new Set([email, email.toLowerCase()])].join(','), pageSize: 3 })}`);
  const same = (found?.rows ?? []).filter((p) => String(p.email ?? '').toLowerCase() === email.toLowerCase());
  return same.length === 1 ? same[0] : undefined;
}

const createAccount: ToolSpec = {
  name: 'create_account', title: 'Create an account for attribution', group: 'Changes', write: true, idempotent: true, dataLoadOnly: true,
  description: 'Only while data load mode is on: creates an account used only to name a person in loaded history (requester, comment author, assignee, owner, "as"), '
    + 'for employees and vendor contacts on the contact lists. The account is disabled: it has no password and cannot sign in, and no set-up link, invitation, notification or email is ever sent to it. '
    + 'An account that already has the email address or username is returned as it is (existing: true) and is not changed, so calling again is safe. '
    + 'Afterwards name it in person fields and "as" by its username or email. Anyone who needs no account (other staff, outside people) goes on the people roster instead (create_record with type "person"); '
    + 'their job title and phone belong there too, as accounts have no such fields.',
  input: {
    name: z.string().min(1).max(120).describe('The person\'s display name, e.g. "Invented Person".'),
    email: z.string().max(254).optional().describe('Their email address (optional; nothing is ever sent to it). Without one the account gets a placeholder address that can never receive mail.'),
    username: z.string().max(64).optional().describe('A username (3 to 64 letters, numbers, dots, dashes or underscores). Default: made from the email address, or else the name, and made unique.'),
    department: z.string().max(200).optional().describe('Their department: its exact name or id.'),
    roles: z.array(z.string()).optional().describe('Role keys to give the account (default none). Roles give no access while the account is disabled.'),
    person: z.string().max(250).optional().describe('A roster person to link the account to: id, reference (PER-00012), exact name, email or employee number. '
      + 'Without it, the one roster person with the same email address and no account is linked.'),
  },
  async run(args, t) {
    if (!loading(t)) fail('create_account is only for data load mode.');
    const r = await t.api.post<Json>('/api/data-load/accounts', {
      displayName: args.name, email: args.email || undefined, username: args.username || undefined,
      department: args.department || undefined, roles: args.roles ?? [],
    });
    const u = r.user as Json;
    const realEmail = /@no-email\.invalid$/i.test(String(u.email ?? '')) ? null : String(u.email ?? '') || null;
    const notes: string[] = [...(r.warnings ?? [])];
    if (r.existing && (args.roles?.length || args.department)) notes.push('The account already existed, so its roles and department were left as they are.');
    if (r.existing && u.status !== 'disabled') notes.push(`The account already existed and is ${u.status}: it was left as it is.`);

    let linked: { id: string; ref: string | null; name: string } | null = null;
    const person = await rosterPerson(t, args.person, realEmail ?? (args.email || null));
    if (person) {
      const people = (await t.meta()).resources.person;
      if (!person.user_id) {
        await t.api.patch(`${people.path}/${person.id}`, { user_id: u.id });
        linked = { id: person.id, ref: person.ref ?? null, name: person.full_name };
      } else if (person.user_id === u.id) linked = { id: person.id, ref: person.ref ?? null, name: person.full_name };
      else notes.push(`${person.ref ?? person.full_name} on the roster already belongs to another account, so it was not linked.`);
    }

    const who = `${u.display_name} (${u.username})`;
    return {
      text: `${r.existing ? `Account ${who} already exists: left as it is.` : `Created account ${who} for attribution only: disabled, no sign-in, nothing sent (data load mode).`}`
        + `${linked ? ` Linked to roster person ${linked.ref ?? linked.name}.` : ''}`
        + ` Name it as "${u.username}"${realEmail ? ` or "${realEmail}"` : ''} in person fields and "as".${notes.length ? ` ${notes.join(' ')}` : ''}`,
      data: {
        user_id: u.id, username: u.username, email: realEmail, display_name: u.display_name, status: u.status,
        department: u.department ?? null, roles: (u.roles ?? []).map((x: Json) => x.key), existing: r.existing === true,
        linked_person: linked, warnings: notes,
      },
      audit: { recordType: 'user', recordId: u.id, summary: r.existing ? `Account ${u.username} already existed` : `Account ${u.username} created for attribution only (data load mode)` },
    };
  },
};

export const ACCOUNT_TOOLS: ToolSpec[] = [createAccount];
