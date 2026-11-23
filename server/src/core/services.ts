import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.ts';
import { fail } from './errors.ts';
import { invalidateFeatures } from './features.ts';
import { notePermission } from './permission-use.ts';
import type { AuditInput, LookupListOptions, LookupValue, SessionUser } from './module.ts';
import { clientIp } from './request.ts';

// ---------- permissions ----------

/**
 * Grants may be exact ("tickets.view"), module wildcards ("tickets.*") or "*". A permission of a
 * switched-off area (user.off, core/features.ts) is held by nobody.
 */
export function can(user: SessionUser | null, perm: string): boolean {
  if (!user) return false;
  const mod = perm.split('.')[0];
  if (user.off?.includes(mod)) return false;
  return user.permissions.some((g) => g === '*' || g === perm || g === `${mod}.*`);
}

export function requirePerm(perm: string) {
  notePermission(perm); // the role editor greys out what nothing checks (E18-44)
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) fail(401, 'unauthenticated', 'Sign in to continue.');
    if (!can(req.user, perm)) fail(403, 'forbidden', 'You do not have permission to do that.');
  };
}

/** Joins words as running text: "a, b and c" (empty parts left out). */
function words(parts: (string | false)[]): string {
  const p = parts.filter((x): x is string => Boolean(x));
  return p.length <= 1 ? (p[0] ?? '') : `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}
const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;

/** Whether an optional area (core/features.ts) is on. */
export type AreaOn = (area: string) => boolean;

/**
 * Default roles. Roles marked enabled:false ship switched off until an administrator enables them.
 * A role that belongs to one optional area is declared in that area's `owns.role` (core/features.ts)
 * and is not shown while the area is off. `describe` words the description for the areas that are
 * on (E18-64): a switched-off area is named nowhere, and `description` is its text with every area on.
 */
export const DEFAULT_ROLES: {
  key: string; name: string; description: string; enabled: boolean; requiresMfa: boolean; grants: string[];
  describe?: (on: AreaOn) => string;
}[] = [
  {
    key: 'administrator', name: 'Administrator', enabled: true, requiresMfa: true,
    description: 'Configuration, users, roles and integrations.',
    grants: ['*'],
  },
  {
    key: 'agent', name: 'Agent', enabled: true, requiresMfa: false,
    description: 'Service desk and inventory work: tickets, assets and changes.',
    describe: (on) => `${on('tickets') ? 'Service desk and inventory work' : 'Inventory work'}: ${words([on('tickets') && 'tickets', 'assets', on('changes') && 'changes'])}.`,
    grants: [
      'tickets.*', 'knowledge.*', 'assets.*', 'systems.*', 'sites.*', 'data.*', 'changes.*', 'actions.*',
      'vendors.view', 'contracts.view', 'frameworks.view', 'policies.view', 'obligations.view',
      'training.view', 'projects.view', 'dashboards.view', 'reports.view', 'fleet.*',
      // Wave 13: find tags, see their history and count inventory (spec §7).
      'tags.view', 'tags.count',
    ],
  },
  {
    key: 'security_lead', name: 'Security lead', enabled: true, requiresMfa: true,
    description: 'Security work: risks, controls, security incidents, vendors and policies.',
    describe: (on) => {
      const w = words([on('risks') && 'risks', on('controls') && 'controls', on('secincidents') && 'security incidents', on('vendors') && 'vendors', on('policies') && 'policies']);
      return w ? `Security work: ${w}.` : 'Security work: systems, assets and data.';
    },
    grants: [
      'security.*', 'risks.*', 'frameworks.*', 'vulnerabilities.*', 'policies.*', 'training.*', 'exceptions.*',
      'obligations.*', 'exercises.*', 'vendors.*', 'contracts.*', 'actions.*',
      'tickets.*', 'knowledge.*', 'assets.*', 'systems.*', 'sites.*', 'data.*', 'changes.*',
      'projects.view', 'dashboards.*', 'reports.*', 'audit.view', 'fleet.view', 'safety.view',
      'controls.*', 'audits.view', 'governance.view', 'people.view',
      'continuity.view', 'privacy.view',
    ],
  },
  {
    key: 'project_manager', name: 'Project manager', enabled: true, requiresMfa: false,
    description: 'Projects, gates and status reports.',
    grants: [
      'projects.*', 'actions.*', 'systems.view', 'vendors.view', 'contracts.view', 'changes.view',
      'tickets.view', 'dashboards.view', 'reports.view',
    ],
  },
  {
    key: 'safety_manager', name: 'Safety manager', enabled: true, requiresMfa: false,
    description: 'Safety team: hazard log, safety events, investigations and safety performance indicators.',
    grants: [
      'safety.*', 'fleet.view', 'systems.view', 'sites.view', 'actions.*', 'dashboards.view', 'reports.view', 'policies.view', 'training.view',
      'audits.*', 'governance.view', 'people.view', 'continuity.view',
    ],
  },
  // Wave 10: compliance, audit and training roles (switched on, like the other working roles).
  {
    key: 'compliance_officer', name: 'Compliance officer', enabled: true, requiresMfa: false,
    description: 'Compliance obligations, funding and grant compliance, controls and committees.',
    describe: (on) => {
      const w = words([on('risks') && 'compliance obligations', on('funding') && 'funding and grant compliance', on('controls') && 'controls', on('governance') && 'committees']);
      return w ? sentence(w) : 'Compliance work and corrective actions.';
    },
    grants: [
      'obligations.*', 'funding.*', 'controls.*', 'governance.*', 'audits.view', 'policies.view', 'vendors.view',
      'contracts.view', 'projects.view', 'assets.view', 'fleet.view', 'people.view', 'actions.*', 'reports.view', 'dashboards.view',
      'continuity.view', 'records.view', 'privacy.view', 'legal.view',
    ],
  },
  {
    key: 'audit_lead', name: 'Audit lead', enabled: true, requiresMfa: false,
    description: 'Internal audits and inspections, control testing and corrective actions.',
    describe: (on) => sentence(words([on('audits') && 'internal audits and inspections', on('controls') && 'control testing', 'corrective actions'])),
    grants: ['audits.*', 'controls.*', 'actions.*', 'governance.view', 'obligations.view', 'policies.view', 'frameworks.view'],
  },
  {
    key: 'training_coordinator', name: 'Training coordinator', enabled: true, requiresMfa: false,
    description: 'Training, the roster of people and their qualifications.',
    describe: (on) => (on('training') ? 'Training, the roster of people and their qualifications.' : 'The roster of people and their qualifications.'),
    grants: ['training.*', 'people.*', 'policies.view'],
  },
  // Wave 11: continuity, records and privacy, and asset roles (switched on, like the other working roles).
  {
    key: 'continuity_manager', name: 'Continuity manager', enabled: true, requiresMfa: false,
    description: 'Business continuity and emergency management: processes, impact analyses, plans and activations.',
    grants: [
      'continuity.*', 'systems.view', 'sites.view', 'assets.view', 'fleet.view', 'vendors.view', 'people.view',
      'exercises.view', 'actions.*', 'reports.view', 'dashboards.view',
    ],
  },
  {
    key: 'records_privacy_officer', name: 'Records and privacy officer', enabled: true, requiresMfa: false,
    description: 'Legal holds, requests for records and personal data, and privacy impact assessments.',
    describe: (on) => (on('records') ? 'Legal holds, requests for records and personal data, and privacy impact assessments.' : 'Legal holds.'),
    grants: ['legal.*', 'records.*', 'privacy.*', 'data.view', 'systems.view', 'actions.*', 'reports.view'],
  },
  {
    key: 'asset_manager', name: 'Asset manager', enabled: true, requiresMfa: false,
    description: 'Assets, sites and vehicles, their tags, inventory counts, condition and replacement.',
    describe: (on) => {
      const their = words([on('tags') && 'tags', on('tags') && 'inventory counts', on('condition') && 'condition', on('condition') && 'replacement']);
      return `${sentence(words(['assets', 'sites', on('fleet') && 'vehicles'])).slice(0, -1)}${their ? `, their ${their}` : ''}.`;
    },
    grants: ['assets.*', 'sites.*', 'fleet.*', 'projects.view', 'funding.view', 'actions.*', 'reports.view', 'dashboards.view', 'tags.*'],
  },
  {
    key: 'approver', name: 'Approver', enabled: false, requiresMfa: false,
    // Risk acceptance is deliberately absent: risks are restricted records, and seeing them needs
    // security.view, which would also open every security incident. An acceptance is recorded by
    // someone who can see the risk, naming the approver (see the risks module).
    description: 'Approves changes, service requests, asset decisions and project gates.',
    describe: (on) => `Approves ${words([on('changes') && 'changes', on('tickets') && 'service requests', 'asset decisions', on('projects') && 'project gates'])}.`,
    grants: [
      'changes.view', 'changes.approve', 'projects.view', 'projects.approve', 'tickets.view', 'tickets.approve',
      'assets.view', 'assets.approve', 'dashboards.view',
    ],
  },
  {
    key: 'executive_viewer', name: 'Executive viewer', enabled: false, requiresMfa: false,
    description: 'Read-only dashboards and report packs.',
    describe: (on) => (on('reports') ? 'Read-only dashboards and report packs.' : 'Read-only access to the Overview and its figures.'),
    grants: ['dashboards.view', 'reports.view', 'projects.view', 'frameworks.view', 'governance.view', 'continuity.view'],
  },
  {
    key: 'auditor', name: 'Auditor', enabled: false, requiresMfa: false,
    description: 'Time-limited read-only access to chosen modules with evidence export.',
    grants: [
      'frameworks.view', 'frameworks.export', 'policies.view', 'obligations.view', 'vendors.view',
      'contracts.view', 'systems.view', 'assets.view', 'audit.view', 'fleet.view',
      'audits.view', 'audits.export', 'controls.view', 'controls.export', 'governance.view', 'funding.view',
      'continuity.view', 'privacy.view', 'legal.view',
    ],
  },
  {
    key: 'requester', name: 'Requester', enabled: false, requiresMfa: false,
    description: 'Anyone in the organization: submit and track own requests through the portal.',
    grants: ['portal.view', 'portal.create'],
  },
];

/**
 * Descriptions that shipped in earlier versions. "Sync default grants" replaces a description only
 * while it still reads exactly like one of these, so an administrator's wording is never lost.
 */
export const EARLIER_ROLE_DESCRIPTIONS: Record<string, string[]> = {
  agent: ['IT staff: tickets, assets and changes.'],
  asset_manager: ['Assets, sites and vehicles, their condition and replacement.'],
  security_lead: ['Security staff: risks, controls, security incidents, vendors, policies.', 'Security work: risks, controls, security incidents, vendors, policies.'],
  approver: ['Managers and executives: approve changes, access requests, project gates and risk acceptance.'],
  requester: ['Any employee: submit and track own requests through the portal.'],
};

/**
 * The description shown for a role (E18-64): a default role whose description has not been edited is
 * worded for the areas that are on, so a switched-off area is named nowhere; an edited one is the
 * administrator's own text and is shown as written.
 */
export function roleDescription(key: string, stored: string | null | undefined, on: AreaOn): string | null {
  const def = DEFAULT_ROLES.find((r) => r.key === key);
  if (!def?.describe || stored == null) return stored ?? null;
  const unedited = stored === def.description || (EARLIER_ROLE_DESCRIPTIONS[key] ?? []).includes(stored);
  return unedited ? def.describe(on) : stored;
}

/**
 * Creates the default roles that do not exist yet. An existing role is never changed here: an
 * administrator may have edited it. Changes to the defaults reach existing databases only through
 * `syncDefaultGrants` (an explicit, audited step in Administration > Roles).
 */
export async function ensureDefaultRoles(db: Db): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    const existing = await db.one<{ id: string }>('select id from roles where key = $1', [r.key]);
    if (existing) continue; // administrators may have edited it
    const row = await db.one<{ id: string }>(
      'insert into roles (key, name, description, enabled, requires_mfa) values ($1,$2,$3,$4,$5) returning id',
      [r.key, r.name, r.description, r.enabled, r.requiresMfa],
    );
    for (const g of r.grants) {
      await db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [row!.id, g]);
      await db.query('insert into role_default_grants (role_key, permission) values ($1,$2) on conflict do nothing', [r.key, g]);
    }
  }
}

export interface DefaultGrantDifference {
  key: string;
  name: string;
  /** Default grants the role does not hold and that have not been offered before. */
  missing: string[];
  /** The current default description, when the role still carries an earlier default. */
  description: string | null;
}

/**
 * What "sync default grants" would add to each default role. A default grant is offered once:
 * after a sync it is remembered (role_default_grants), so a grant an administrator later removes
 * is not put back by the next sync. Nothing is ever removed from a role.
 */
export async function defaultGrantDifferences(db: Queryable): Promise<DefaultGrantDifference[]> {
  const out: DefaultGrantDifference[] = [];
  for (const r of DEFAULT_ROLES) {
    const role = await db.one<{ id: string; name: string; description: string | null }>('select id, name, description from roles where key = $1', [r.key]);
    if (!role) continue;
    const held = new Set((await db.query<{ permission: string }>('select permission from role_permissions where role_id = $1', [role.id])).map((x) => x.permission));
    const offered = new Set((await db.query<{ permission: string }>('select permission from role_default_grants where role_key = $1', [r.key])).map((x) => x.permission));
    const covered = (g: string) => held.has(g) || held.has('*') || held.has(`${g.split('.')[0]}.*`);
    out.push({
      key: r.key, name: role.name,
      missing: r.grants.filter((g) => !covered(g) && !offered.has(g)),
      description: (EARLIER_ROLE_DESCRIPTIONS[r.key] ?? []).includes(role.description ?? '') ? r.description : null,
    });
  }
  return out;
}

/** Applies `defaultGrantDifferences`: adds the missing default grants, one audit event per role changed. */
export async function syncDefaultGrants(
  db: Db, audit: ReturnType<typeof makeAudit>, req: FastifyRequest | null,
): Promise<DefaultGrantDifference[]> {
  const changed: DefaultGrantDifference[] = [];
  for (const d of await defaultGrantDifferences(db)) {
    const def = DEFAULT_ROLES.find((r) => r.key === d.key)!;
    const role = (await db.one<{ id: string; description: string | null }>('select id, description from roles where key = $1', [d.key]))!;
    await db.tx(async (tx) => {
      for (const g of d.missing) await tx.query('insert into role_permissions (role_id, permission) values ($1,$2) on conflict do nothing', [role.id, g]);
      // Remember every current default as offered, including those the role already held.
      for (const g of def.grants) await tx.query('insert into role_default_grants (role_key, permission) values ($1,$2) on conflict do nothing', [d.key, g]);
      if (d.description !== null) await tx.query('update roles set description = $2, updated_at = now() where id = $1', [role.id, d.description]);
    });
    if (!d.missing.length && d.description === null) continue;
    changed.push(d);
    await audit(req, {
      action: 'role.sync_defaults', recordType: 'role', recordId: role.id,
      summary: `Default grants synchronized for role "${d.name}": ${d.missing.length} permission(s) added`
        + (d.description !== null ? '; description updated' : ''),
      before: d.description !== null ? { description: role.description } : undefined,
      after: { added: d.missing, ...(d.description !== null ? { description: d.description } : {}) },
    });
  }
  return changed;
}

// ---------- audit ----------

export function makeAudit(db: Db) {
  return async (req: FastifyRequest | null, ev: AuditInput, q: Queryable = db): Promise<void> => {
    await q.query(
      `insert into audit_events (actor_id, actor_name, ip, action, record_type, record_id, summary, before, after, token_id, token_name, request_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
      [
        req?.user?.id ?? null,
        // No request = the system itself (seeding, timers, start-up). A request with nobody signed in
        // (a failed sign-in, a refused link) has no actor name but does have a source address.
        req?.user?.displayName ?? (req ? null : 'System'),
        req ? clientIp(req) : null,
        ev.action,
        ev.recordType ?? null,
        ev.recordId ?? null,
        ev.summary ?? null,
        ev.before === undefined ? null : JSON.stringify(ev.before),
        ev.after === undefined ? null : JSON.stringify(ev.after),
        // Changes made with a personal access token name the token (core/tokens.ts).
        req?.apiToken?.id ?? null,
        req?.apiToken?.name ?? null,
        // The X-Request-Id sent back to the caller, so an integration can find its own changes.
        (req as { requestId?: string } | null)?.requestId || null,
      ],
    );
  };
}

// ---------- lookups ----------

export function makeLookups(db: Db) {
  return {
    async ensure(list: string, values: LookupValue[], opts: LookupListOptions = {}): Promise<void> {
      if (opts.module !== undefined || opts.public !== undefined) {
        await db.query(
          `insert into lookup_lists (list_key, module, public) values ($1, $2::text, coalesce($3::boolean, false))
           on conflict (list_key) do update set module = coalesce(excluded.module, lookup_lists.module),
             public = coalesce($3::boolean, lookup_lists.public)`,
          [list, opts.module ?? null, opts.public ?? null],
        );
      }
      for (const [i, v] of values.entries()) {
        await db.query(
          `insert into lookups (list_key, value, label, color, sort, meta) values ($1,$2,$3,$4,$5,$6::jsonb)
           on conflict (list_key, value) do nothing`,
          [list, v.value, v.label, v.color ?? 'gray', v.sort ?? (i + 1) * 10, JSON.stringify(v.meta ?? {})],
        );
      }
    },
    async values(list: string): Promise<LookupValue[]> {
      return db.query(
        'select value, label, color, sort, meta from lookups where list_key = $1 and active order by sort, label',
        [list],
      );
    },
    async all(): Promise<Record<string, LookupValue[]>> {
      const rows = await db.query<LookupValue & { list_key: string }>(
        'select list_key, value, label, color, sort, meta from lookups where active order by list_key, sort, label',
      );
      const out: Record<string, LookupValue[]> = {};
      for (const { list_key, ...v } of rows) (out[list_key] ??= []).push(v);
      return out;
    },
  };
}

// ---------- settings ----------

export function makeSettings(db: Db, audit: ReturnType<typeof makeAudit>) {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const row = await db.one<{ value: T }>('select value from settings where key = $1', [key]);
      return row ? row.value : fallback;
    },
    async set(key: string, value: unknown, req: FastifyRequest | null = null): Promise<void> {
      const before = await db.one<{ value: unknown }>('select value from settings where key = $1', [key]);
      await db.query(
        `insert into settings (key, value, updated_by) values ($1, $2::jsonb, $3)
         on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [key, JSON.stringify(value), req?.user?.id ?? null],
      );
      // Feature switches apply at once, without a restart (core/features.ts).
      if (key === 'features' || key === 'feature_options') invalidateFeatures(db);
      await audit(req, {
        action: 'setting.change', recordType: 'setting', recordId: key,
        summary: `Setting ${key} changed`, before: before?.value, after: value,
      });
    },
  };
}
