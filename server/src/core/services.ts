import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.ts';
import { fail } from './errors.ts';
import type { AuditInput, LookupValue, SessionUser } from './module.ts';

// ---------- permissions ----------

/** Grants may be exact ("tickets.view"), module wildcards ("tickets.*") or "*". */
export function can(user: SessionUser | null, perm: string): boolean {
  if (!user) return false;
  const mod = perm.split('.')[0];
  return user.permissions.some((g) => g === '*' || g === perm || g === `${mod}.*`);
}

export function requirePerm(perm: string) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.user) fail(401, 'unauthenticated', 'Sign in to continue.');
    if (!can(req.user, perm)) fail(403, 'forbidden', 'You do not have permission to do that.');
  };
}

/** Default roles. Roles marked enabled:false ship switched off until an administrator enables them. */
export const DEFAULT_ROLES: {
  key: string; name: string; description: string; enabled: boolean; requiresMfa: boolean; grants: string[];
}[] = [
  {
    key: 'administrator', name: 'Administrator', enabled: true, requiresMfa: true,
    description: 'Configuration, users, roles and integrations.',
    grants: ['*'],
  },
  {
    key: 'agent', name: 'Agent', enabled: true, requiresMfa: false,
    description: 'IT staff: tickets, assets and changes.',
    grants: [
      'tickets.*', 'knowledge.*', 'assets.*', 'systems.*', 'sites.*', 'data.*', 'changes.*', 'actions.*',
      'vendors.view', 'contracts.view', 'frameworks.view', 'policies.view', 'obligations.view',
      'training.view', 'projects.view', 'dashboards.view', 'reports.view',
    ],
  },
  {
    key: 'security_lead', name: 'Security lead', enabled: true, requiresMfa: true,
    description: 'Cybersecurity Coordinator and alternate: risks, controls, security incidents, vendors, policies.',
    grants: [
      'security.*', 'risks.*', 'frameworks.*', 'vulnerabilities.*', 'policies.*', 'training.*', 'exceptions.*',
      'obligations.*', 'exercises.*', 'vendors.*', 'contracts.*', 'actions.*',
      'tickets.*', 'knowledge.*', 'assets.*', 'systems.*', 'sites.*', 'data.*', 'changes.*',
      'projects.view', 'dashboards.*', 'reports.*', 'audit.view',
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
    key: 'approver', name: 'Approver', enabled: false, requiresMfa: false,
    description: 'Department heads, CFO, CEO: approve changes, access requests, project gates and risk acceptance.',
    grants: [
      'changes.view', 'changes.approve', 'projects.view', 'projects.approve', 'tickets.view', 'tickets.approve',
      'assets.view', 'assets.approve', 'dashboards.view',
    ],
  },
  {
    key: 'executive_viewer', name: 'Executive viewer', enabled: false, requiresMfa: false,
    description: 'Read-only dashboards and report packs.',
    grants: ['dashboards.view', 'reports.view', 'projects.view', 'frameworks.view'],
  },
  {
    key: 'auditor', name: 'Auditor', enabled: false, requiresMfa: false,
    description: 'Time-limited read-only access to chosen modules with evidence export.',
    grants: [
      'frameworks.view', 'frameworks.export', 'policies.view', 'obligations.view', 'vendors.view',
      'contracts.view', 'systems.view', 'assets.view', 'audit.view',
    ],
  },
  {
    key: 'requester', name: 'Requester', enabled: false, requiresMfa: false,
    description: 'Any employee: submit and track own requests through the portal.',
    grants: ['portal.view', 'portal.create'],
  },
];

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
    }
  }
}

// ---------- audit ----------

export function makeAudit(db: Db) {
  return async (req: FastifyRequest | null, ev: AuditInput, q: Queryable = db): Promise<void> => {
    await q.query(
      `insert into audit_events (actor_id, actor_name, ip, action, record_type, record_id, summary, before, after)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [
        req?.user?.id ?? null,
        req?.user?.displayName ?? (req ? null : 'System'),
        req?.ip ?? null,
        ev.action,
        ev.recordType ?? null,
        ev.recordId ?? null,
        ev.summary ?? null,
        ev.before === undefined ? null : JSON.stringify(ev.before),
        ev.after === undefined ? null : JSON.stringify(ev.after),
      ],
    );
  };
}

// ---------- lookups ----------

export function makeLookups(db: Db) {
  return {
    async ensure(list: string, values: LookupValue[]): Promise<void> {
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
      await audit(req, {
        action: 'setting.change', recordType: 'setting', recordId: key,
        summary: `Setting ${key} changed`, before: before?.value, after: value,
      });
    },
  };
}
