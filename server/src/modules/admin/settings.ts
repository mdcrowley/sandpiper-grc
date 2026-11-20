import { DEFAULT_APP_NAME } from '../../core/config.ts';
import { ORGANIZATION_SETTINGS } from '../../core/organization.ts';
import { AREA_KEYS, effectiveFeatures, FEATURE_DEFAULTS } from '../../core/features.ts';
import { checkFeatures, featureChangeProblem } from './features.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { hasActivePasskey } from '../../core/webauthn/index.ts';
import { localOffProblem } from './providers.ts';
import { adminRoute, body, idParam, invalid, sensitive } from './shared.ts';

type Check = (v: unknown) => { value: unknown } | string;

const bool: Check = (v) => (typeof v === 'boolean' ? { value: v } : 'Choose on or off.');
const int = (min: number, max: number, what: string): Check => (v) =>
  (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
    ? { value: v } : `${what} must be a whole number from ${min} to ${max}.`);

/** Feature switches an administrator may set: one per optional area (core/features.ts). */
export const FEATURE_KEYS = AREA_KEYS;

/** The settings an administrator may change here, with defaults (matching the core fallbacks) and validation. */
export const SETTINGS: Record<string, { fallback: unknown; check: Check }> = {
  'app.name': {
    fallback: DEFAULT_APP_NAME,
    check: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 60
      ? { value: v.trim() } : 'Enter a name of 1 to 60 characters.'),
  },
  // The organization's details and colors (Administration > Organization, core/organization.ts).
  ...ORGANIZATION_SETTINGS,
  pilot_mode: { fallback: true, check: bool },
  // Areas missing from the stored value take their default (on, except the portal): see core/features.ts.
  features: { fallback: FEATURE_DEFAULTS, check: checkFeatures },
  // NIST SP 800-63B: the floor never drops below 12.
  'auth.password_min_length': { fallback: 14, check: int(12, 128, 'Minimum password length') },
  'auth.password_history': { fallback: 5, check: int(0, 24, 'Password history') },
  'auth.idle_minutes': { fallback: 30, check: int(5, 480, 'Idle time-out') },
  'auth.mfa_required_for_all': { fallback: false, check: bool },
  // off: no reminder. notice: a reminder only (default, so an existing installation is not locked out
  // by an upgrade). required: a person who must enroll can reach nothing but enrollment until they do.
  'auth.mfa_enforcement': {
    fallback: 'notice',
    check: (v) => (v === 'off' || v === 'notice' || v === 'required' ? { value: v } : 'Choose off, notice or required.'),
  },
  'auth.mfa_grace_days': { fallback: 0, check: int(0, 30, 'Grace period') },
  'auth.reauth_minutes': { fallback: 10, check: int(1, 60, 'Password confirmation window') },
  // Passkeys (core/webauthn): a passkey alone may sign a person in; and whether every use must check a PIN or biometric.
  'auth.passkey_sign_in': { fallback: true, check: bool },
  'auth.passkey_user_verification': {
    fallback: 'preferred',
    check: (v) => (v === 'preferred' || v === 'required' ? { value: v } : 'Choose preferred or required.'),
  },
  // Single sign-on (core/identity). Local passwords can be switched off only when a break-glass account
  // exists and everyone else has a linked provider (checked below).
  'auth.local_signin': { fallback: true, check: bool },
  // The address people use to reach the application, for the redirect address given to providers. Empty = as requested.
  'auth.public_url': {
    fallback: '',
    check: (v) => {
      if (v === '' || v === null) return { value: '' };
      const s = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
      let url: URL | null = null;
      try { url = new URL(s); } catch { /* checked below */ }
      const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return url && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash && s.length <= 200
        ? { value: s } : 'Enter the https address people use to open the application, such as https://grc.example.org, with no path.';
    },
  },
  // Personal access tokens (core/tokens.ts): the longest life a new token may have, and requests a minute per token.
  'tokens.max_days': { fallback: 365, check: int(1, 3650, 'Longest token life in days') },
  'tokens.rate_per_minute': { fallback: 600, check: int(10, 6000, 'Token requests a minute') },
  // Outbound connections (webhooks, core/webhooks.ts). Off until switched on; then only to the hosts listed.
  'integrations.outbound_enabled': { fallback: false, check: bool },
  'integrations.allowed_hosts': {
    fallback: [],
    check: (v) => {
      if (!Array.isArray(v) || v.length > 50) return 'List up to 50 host names.';
      const hosts = [...new Set(v.map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
      const bad = hosts.find((h) => !/^(\*\.)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(h));
      return bad ? `"${bad}" is not a host name. Use "host", "host:port" or "*.domain".` : { value: hosts };
    },
  },
  // How long the audit log is kept: recorded for the retention schedule. Nothing deletes audit events.
  'retention.audit_months': { fallback: 84, check: int(12, 1200, 'Audit log retention in months') },
};

/** Security settings (sign-in, API tokens, outbound connections): changing one needs a recent password confirmation. */
export const isSecuritySetting = (key: string) => key.startsWith('auth.') || key.startsWith('integrations.') || key.startsWith('tokens.');

export function registerSettings(ctx: ModuleContext) {
  const { db } = ctx;

  const read = async () => {
    const values: Row = {};
    for (const [key, spec] of Object.entries(SETTINGS)) values[key] = await ctx.settings.get(key, spec.fallback);
    values.features = effectiveFeatures(values.features);
    return { values, featureKeys: FEATURE_KEYS };
  };

  adminRoute(ctx, 'GET', '/api/admin/settings', read);

  adminRoute(ctx, 'PATCH', '/api/admin/settings', async (req) => {
    const b = body(req);
    const fields: Record<string, string> = {};
    const clean: Row = {};
    for (const [key, raw] of Object.entries(b)) {
      const spec = SETTINGS[key];
      if (!spec) { fields[key] = 'This setting cannot be changed here.'; continue; }
      const res = spec.check(raw);
      if (typeof res === 'string') fields[key] = res;
      else clean[key] = res.value;
    }
    if (Object.keys(fields).length) invalid(fields);
    const current = (await read()).values;
    if (clean.features) {
      clean.features = { ...current.features, ...clean.features };
      const problem = featureChangeProblem(clean.features);
      if (problem) invalid({ features: problem });
    }
    const changed = Object.keys(clean).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(clean[key]));
    if (changed.some(isSecuritySetting)) await sensitive(ctx, req, `changing security settings (${changed.filter(isSecuritySetting).join(', ')})`);
    // Switching a part of the application on or off changes what everyone can reach.
    if (changed.includes('features')) await sensitive(ctx, req, 'switching parts of the application on or off');
    // Requiring a second factor must not lock out the administrator who switches it on.
    if (clean['auth.mfa_enforcement'] === 'required' && current['auth.mfa_enforcement'] !== 'required') {
      const me = await db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [req.user!.id]);
      // An authenticator app or a passkey both count as the administrator's own second factor.
      if (!me?.totp_enabled && !(await hasActivePasskey(db, req.user!.id))) {
        invalid({ 'auth.mfa_enforcement': 'Set up your own second factor first (Account security), then require it.' });
      }
    }
    // Switching local passwords off must leave everyone a way in: the break-glass account, and a provider for the rest.
    if (clean['auth.local_signin'] === false && current['auth.local_signin'] !== false) {
      const problem = await localOffProblem(ctx);
      if (problem) invalid({ 'auth.local_signin': problem });
    }
    for (const [key, value] of Object.entries(clean)) {
      // ctx.settings.set writes the audit event (setting.change) with before and after.
      if (JSON.stringify(current[key]) !== JSON.stringify(value)) await ctx.settings.set(key, value, req);
    }
    return read();
  });

  // ---------- departments ----------

  const DEPT_SELECT = `
    select d.id, d.name, d.created_at, d.updated_at,
      (select count(*)::int from users u where u.department_id = d.id and u.deleted_at is null) as members
    from departments d where d.deleted_at is null`;

  const cleanName = async (raw: unknown, exceptId = '') => {
    const name = String(raw ?? '').trim();
    if (!name || name.length > 80) invalid({ name: 'Enter a name of up to 80 characters.' });
    if (await db.one('select 1 from departments where lower(name) = lower($1) and deleted_at is null and id::text <> $2', [name, exceptId])) {
      invalid({ name: 'A department with that name already exists.' });
    }
    return name;
  };

  adminRoute(ctx, 'GET', '/api/admin/departments', async () => db.query(`${DEPT_SELECT} order by lower(d.name)`));

  adminRoute(ctx, 'POST', '/api/admin/departments', async (req, reply) => {
    const name = await cleanName(body(req).name);
    // The name column is unique, so a removed department with the same name is brought back.
    const row = await db.one<Row>(
      `insert into departments (name, created_by, updated_by) values ($1, $2, $2)
       on conflict (name) do update set deleted_at = null, updated_at = now(), updated_by = excluded.updated_by returning id`,
      [name, req.user!.id],
    );
    await ctx.audit(req, { action: 'department.create', recordType: 'department', recordId: row!.id, summary: `Department "${name}" added`, after: { name } });
    reply.code(201);
    return db.one(`${DEPT_SELECT} and d.id = $1`, [row!.id]);
  });

  adminRoute(ctx, 'PATCH', '/api/admin/departments/:id', async (req) => {
    const id = idParam(req, 'Department');
    const before = await db.one<Row>('select id, name from departments where id = $1 and deleted_at is null', [id]);
    if (!before) ctx.fail(404, 'not_found', 'Department not found.');
    const name = await cleanName(body(req).name, id);
    if (await db.one('select 1 from departments where name = $1 and id <> $2', [name, id])) {
      invalid({ name: 'A removed department has that name. Add it again instead.' });
    }
    await db.query('update departments set name = $2, updated_at = now(), updated_by = $3 where id = $1', [id, name, req.user!.id]);
    if (name !== before!.name) {
      await ctx.audit(req, {
        action: 'department.update', recordType: 'department', recordId: id,
        summary: `Department "${before!.name}" renamed to "${name}"`, before: { name: before!.name }, after: { name },
      });
    }
    return db.one(`${DEPT_SELECT} and d.id = $1`, [id]);
  });

  adminRoute(ctx, 'DELETE', '/api/admin/departments/:id', async (req) => {
    const id = idParam(req, 'Department');
    const row = await db.one<Row>(
      'update departments set deleted_at = now(), updated_by = $2 where id = $1 and deleted_at is null returning name', [id, req.user!.id],
    );
    if (!row) ctx.fail(404, 'not_found', 'Department not found.');
    const moved = await db.query('update users set department_id = null where department_id = $1 returning 1', [id]);
    await ctx.audit(req, {
      action: 'department.delete', recordType: 'department', recordId: id,
      summary: `Department "${row!.name}" removed (${moved.length} user(s) left without a department)`, before: { name: row!.name },
    });
    return { ok: true };
  });
}
