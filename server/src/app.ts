import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { registerApiDocs } from './core/apidocs.ts';
import { loadUser, registerAuth, requireRecentAuth, secretBox } from './core/auth.ts';
import { registerCustomFieldRoutes } from './core/customfield-routes.ts';
import { makeCustomFields } from './core/customfields.ts';
import { DatabaseBusyError, openDb } from './core/db.ts';
import { registerRequestMetrics } from './core/monitoring.ts';
import { registerReadiness } from './core/health.ts';
import { registerWebAssets, sendIndex } from './core/webassets.ts';
import { registerPermissionUse } from './core/permission-use.ts';
import { ApiError, fail } from './core/errors.ts';
import { addHsts, trustProxyFn } from './core/http.ts';
import { registerMetrics } from './core/metrics.ts';
import { migrate } from './core/migrate.ts';
import { testTemplate } from './core/db-template.ts';
import { migrationSources } from './ops/migrations.ts';
import { registerBranding } from './core/organization.ts';
import type { ModuleContext, ModuleDef, Row } from './core/module.ts';
import { makeOpenApi } from './core/openapi.ts';
import { canonicalRequestUrl } from './core/api/versioning.ts';
import { registerPreferences } from './core/preferences.ts';
import { makeResources } from './core/resource.ts';
import { quietSenders, readDataLoad } from './core/dataload.ts';
import { registerRetention } from './core/retention.ts';
import { registerCoreRoutes } from './core/routes.ts';
import { registerTagsAndWatchers } from './core/tags.ts';
import { registerWebhooks } from './core/webhooks.ts';
import { registerVersion } from './ops/version.ts';
import { ensureJobs } from './core/jobs/index.ts';
import { ensureMail } from './core/mail/index.ts';
import { makeFeatureGate } from './core/features.ts';
import { can, ensureDefaultRoles, makeAudit, makeLookups, makeSettings, requirePerm } from './core/services.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');

export interface BuildOptions {
  /** Folder for the database and files, or 'memory' for a throwaway in-memory database. */
  dataDir: string;
  /** Serve the built web app from dist/web (default true when it exists). */
  serveWeb?: boolean;
  /** Extra modules registered after the discovered ones (used by tests). */
  extraModules?: ModuleDef[];
  /** Serve HTTPS with this certificate and key (PEM). See `planListen` in core/http.ts. */
  https?: { cert: Buffer | string; key: Buffer | string };
  /**
   * Tests: start an in-memory database empty and run every migration, even when the test run
   * made a migrated template (core/db-template.ts). Used by the test that proves migrations
   * from empty still work.
   */
  freshDatabase?: boolean;
}

/**
 * How long one start-up step may take before the start is abandoned (E16-39):
 * `GRC_STARTUP_TIMEOUT_SECONDS`, default 600 (ten minutes; Fastify's own default is 10 seconds).
 */
export function startupTimeoutMs(): number {
  const n = Number(process.env.GRC_STARTUP_TIMEOUT_SECONDS ?? 600);
  return Number.isFinite(n) && n >= 10 ? Math.round(n * 1000) : 600_000;
}

/**
 * Times every start-up step (`onReady` hook, E16-39), named by where it was added. A step that
 * takes more than `GRC_STARTUP_WARN_MS` (default 2,000) is logged, and so is the whole when it
 * took longer, so a slow start can be traced to its step. `phases` are the parts of the start
 * before them (opening the database, migrations, modules and routes), reported with them.
 */
export function timeStartupSteps(app: FastifyInstance, phases: { name: string; ms: number }[] = []) {
  const steps: { where: string; ms: number }[] = [];
  const warnRaw = Number(process.env.GRC_STARTUP_WARN_MS ?? 2000);
  const warnMs = Number.isFinite(warnRaw) && warnRaw >= 0 ? warnRaw : 2000;
  const add = app.addHook.bind(app) as (name: string, fn: (...a: unknown[]) => unknown) => FastifyInstance;
  (app as unknown as { addHook: typeof add }).addHook = (name, fn) => {
    if (name !== 'onReady' || fn.length > 0) return add(name, fn); // a step with a callback is left as it is
    // The caller's file and line: the first stack frame outside this file.
    const frame = (new Error().stack ?? '').split('\n').slice(2).find((l) => !l.includes('app.ts')) ?? '';
    const where = (/\(?((?:[A-Za-z]:)?[^():]+):(\d+):\d+\)?\s*$/.exec(frame.trim()) ?? [])
      .slice(1, 3).join(':').replace(/\\/g, '/').replace(/^.*\/server\/src\//, '') || 'unknown';
    const step = async function (this: unknown) {
      const started = performance.now();
      try {
        return await fn.apply(this, []);
      } finally {
        steps.push({ where, ms: Math.round(performance.now() - started) });
      }
    };
    // Named after where it was added, so Fastify's time-out message says which step it was.
    Object.defineProperty(step, 'name', { value: where });
    return add(name, step);
  };
  return {
    steps,
    /** Logs the start when it, or one step or phase, took `GRC_STARTUP_WARN_MS` or more; returns the line (null when quiet). */
    report(): string | null {
      const total = steps.reduce((n, s) => n + s.ms, 0);
      const whole = phases.reduce((n, p) => n + p.ms, total);
      if (!steps.some((s) => s.ms >= warnMs) && !phases.some((p) => p.ms >= warnMs) && whole < warnMs) return null;
      const longest = [...steps].sort((a, b) => b.ms - a.ms).slice(0, 5).map((s) => `${s.where} ${s.ms} ms`).join(', ');
      const line = `[start] start-up took ${whole} ms: ${[...phases.map((p) => `${p.name} ${p.ms} ms`), `start-up steps ${total} ms`].join(', ')}`
        + (longest ? `; the longest steps: ${longest}` : '');
      if (!process.env.VITEST) console.warn(line);
      return line;
    },
  };
}

export async function buildApp(opts: BuildOptions) {
  // The parts of the start before its steps, timed for the start-up report (E16-39).
  const phases: { name: string; ms: number }[] = [];
  let lap = performance.now();
  const phase = (name: string) => {
    const now = performance.now();
    phases.push({ name, ms: Math.round(now - lap) });
    lap = now;
  };
  // Tests: an in-memory database starts from the run's migrated template when there is one.
  const template = opts.dataDir === 'memory' && !opts.freshDatabase ? testTemplate(migrationSources()) : undefined;
  const db = await openDb(opts.dataDir, { template });
  phase('opening the database');

  const modulesDir = join(here, 'modules');
  const moduleKeys = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(modulesDir, d.name, 'index.ts')))
        .map((d) => d.name)
        // GRC_MODULES=a,b loads only those modules (lets one module be tested while others are mid-change).
        .filter((k) => !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes(k))
        .sort()
    : [];

  await migrate(db, [
    { scope: 'core', dir: join(here, 'core/migrations') },
    ...moduleKeys.map((k) => ({ scope: k, dir: join(modulesDir, k, 'migrations') })),
  ]);
  await ensureDefaultRoles(db);
  phase('migrations');

  // trustProxy: req.ip, req.protocol and req.hostname follow X-Forwarded-* only from GRC_TRUST_PROXY (E01-31).
  // pluginTimeout: how long one start-up step may take (E16-39). Fastify's default of 10 seconds is too
  // short for work that grows with the data: after an upgrade that changes how a type is searched,
  // its search index is rebuilt at start (about 19 s for 40,000 tickets on the embedded database).
  // rewriteUrl: one canonical path before routing - /api/v1 routed as /api, and paths the router would
  // read differently from how they are written refused (core/api/versioning.ts, wave 9 SA-1).
  const serverOptions = { rewriteUrl: canonicalRequestUrl, logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: trustProxyFn(), pluginTimeout: startupTimeoutMs() };
  // With a certificate the same server speaks HTTPS (E16-07); its type is the plain one for everything that uses it.
  const app = Fastify({ ...serverOptions, ...(opts.https ? { https: opts.https } : {}) } as typeof serverOptions);
  const startup = timeStartupSteps(app, phases);
  await app.register(cookie);
  // Sees every route as it is registered, for GET /api/openapi.json: keep it ahead of all routes.
  const openapi = makeOpenApi(app);
  // Feature switches (E14-28): marks each route with its module and answers 404 for switched-off parts.
  const gate = makeFeatureGate(app, db);

  // Accept an empty JSON body (for example a POST with no payload).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new ApiError(400, 'bad_json', 'The request body is not valid JSON.'));
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: err.message } });
    }
    // No database connection came free in time (E40-12): "busy, try again shortly", not a failure.
    if (err instanceof DatabaseBusyError || (err?.databaseBusy === true)) {
      console.warn(`[db] ${req.method} ${req.url}: ${err.message} Answered 503; see "Database connections" in docs/operations.md.`);
      reply.header('retry-after', String(err.retryAfterSeconds ?? 5));
      return reply.code(503).send({ error: { code: 'busy', message: 'The server is busy. Try again in a few seconds.' } });
    }
    console.error(`[error] ${req.method} ${req.url}:`, err);
    return reply.code(500).send({ error: { code: 'server_error', message: 'Something went wrong. The error has been logged.' } });
  });

  // Counts answers for the operational metrics endpoint (E40-04; core/monitoring.ts): ahead of every route.
  registerRequestMetrics(app);

  app.addHook('onSend', async (req, reply) => {
    addHsts(req, reply); // only on responses that went out over HTTPS
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });

  const audit = makeAudit(db);
  const lookups = makeLookups(db);
  const settings = makeSettings(db, audit);
  registerAuth(app, { db, audit, settings });
  registerReadiness(app, db); // GET /api/ready: asks the database (OP-13); /api/health stays liveness only
  registerBranding(app, db); // the public look before sign-in (Administration > Organization)
  const custom = makeCustomFields(db);
  if (!app.hasRequestDecorator('dataLoad')) app.decorateRequest('dataLoad', false); // E18-70, core/dataload.ts
  const res = makeResources({ app, db, audit, lookups, custom });
  gate.attach(res.registry);
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit, settings }, req, what);
  const watchers = registerTagsAndWatchers({ app, db, audit, lookups, res });
  registerCoreRoutes({ app, db, audit, lookups, res, custom, gate, notifyWatchers: watchers.notifyWatchers });
  registerVersion({ app, can, describeRoute: openapi.describe }, db);
  registerCustomFieldRoutes({ app, db, audit, res, custom });
  registerPreferences(app, db);
  const webhooks = registerWebhooks({ app, db, audit, settings, res, box: () => secretBox(db), loadUser, requireRecentAuth: recentAuth });
  const retention = registerRetention({ app, db, audit, lookups, res, requireRecentAuth: recentAuth });
  openapi.attach({ res, custom, settings, gate });
  registerApiDocs(openapi);
  registerPermissionUse({ app, registry: res.registry, describeRoute: openapi.describe, requirePerm });
  openapi.modulesFromHere();

  const ctx: ModuleContext = {
    app,
    db,
    dataDir: opts.dataDir,
    requirePerm,
    // Feature-aware for people built by hand (recipients, tool lists), not only for loaded users.
    can: (user, perm) => can(user && !user.off ? { ...user, off: [...gate.known().offPermissions] } : user, perm),
    audit: (req, ev) => audit(req, ev),
    lookups,
    settings,
    resources: res.registry,
    defineResource: res.defineResource,
    readSeed(seedOpts, file, delimiter) {
      const text = readFileSync(join(seedOpts.seedDir, file), 'utf8').replace(/^﻿/, '');
      const [header, ...lines] = text.split(/\r?\n/).filter((l) => l.trim() !== '');
      const names = header.split(delimiter).map((h) => h.trim());
      return lines.map((line) => {
        const cells = line.split(delimiter);
        return Object.fromEntries(names.map((n, i) => [n, (cells[i] ?? '').trim()])) as Row;
      });
    },
    fail,
    describeRoute: openapi.describe,
  };

  // The metric registry's route (wave 10, C3); modules add their metrics with defineMetric in register.
  registerMetrics(ctx);

  const modules: ModuleDef[] = [];
  for (const key of moduleKeys) {
    const loaded = await import(pathToFileURL(join(modulesDir, key, 'index.ts')).href);
    const mod: ModuleDef = loaded.default;
    if (!mod?.key) throw new Error(`Module ${key} has no default export with a key`);
    modules.push(mod);
  }
  modules.push(...(opts.extraModules ?? []));
  // Core services every module may use (E14-23), and core's own recurring work on the queue (E14-22).
  const jobs = await ensureJobs(ctx);
  await ensureMail(ctx);
  jobs.register('core.webhook_deliveries', async () => ({ attempted: await webhooks.processDue() }), { maxAttempts: 2 });
  await jobs.schedule('core.webhook_deliveries', { type: 'core.webhook_deliveries', every: 60_000, firstRunInMs: 30_000 });
  jobs.register('core.retention_sweep', async () => ({ ...(await retention.sweep()), logs: await retention.housekeeping() }), { maxAttempts: 3 });
  await jobs.schedule('core.retention_sweep', { type: 'core.retention_sweep', every: 24 * 3_600_000, firstRunInMs: 60_000 });
  for (const m of modules) await m.seedDefaults?.(ctx);
  for (const m of modules) await gate.during(m.key, () => m.register?.(ctx));
  // Data load mode (E18-70): the senders stay quiet during a load, and the mode ends at its end time.
  quietSenders(app);
  jobs.register('core.data_load_expiry', async () => ({ on: (await readDataLoad(db, audit)).on }), { maxAttempts: 2 });
  await jobs.schedule('core.data_load_expiry', { type: 'core.data_load_expiry', every: 60_000, firstRunInMs: 60_000 });

  const webDir = process.env.GRC_WEB_DIST ? resolve(process.env.GRC_WEB_DIST) : join(repoRoot, 'dist/web');
  const serveWeb = (opts.serveWeb ?? true) && existsSync(join(webDir, 'index.html'));
  // Hashed bundles compressed and cached for a year; index.html asked about on every load (OP-11).
  if (serveWeb) await registerWebAssets(app, webDir);
  app.setNotFoundHandler((req, reply) => {
    if (serveWeb && req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/assets/')) {
      return sendIndex(reply, webDir);
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });

  phase('modules and routes');
  await app.ready();
  startup.report();
  // Background upkeep of the embedded database (analyze) waits until start-up is done (E16-39).
  db.started?.();
  gate.activate();
  return {
    app, db, ctx, modules,
    /** Core services that tests and commands drive directly (the timers call the same functions). */
    core: { openapi, webhooks, retention, custom, resources: res, features: gate },
    async close() {
      await app.close();
      await db.close();
    },
  };
}
