import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyRequest } from 'fastify';
import { registerApiDocs } from './core/apidocs.ts';
import { loadUser, registerAuth, requireRecentAuth, secretBox } from './core/auth.ts';
import { registerCustomFieldRoutes } from './core/customfield-routes.ts';
import { makeCustomFields } from './core/customfields.ts';
import { openDb } from './core/db.ts';
import { ApiError, fail } from './core/errors.ts';
import { addHsts, trustProxyFn } from './core/http.ts';
import { migrate } from './core/migrate.ts';
import type { ModuleContext, ModuleDef, Row } from './core/module.ts';
import { makeOpenApi } from './core/openapi.ts';
import { registerPreferences } from './core/preferences.ts';
import { makeResources } from './core/resource.ts';
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
}

export async function buildApp(opts: BuildOptions) {
  const db = await openDb(opts.dataDir);

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

  // trustProxy: req.ip, req.protocol and req.hostname follow X-Forwarded-* only from GRC_TRUST_PROXY (E01-31).
  const serverOptions = { logger: false, bodyLimit: 10 * 1024 * 1024, trustProxy: trustProxyFn() };
  // With a certificate the same server speaks HTTPS (E16-07); its type is the plain one for everything that uses it.
  const app = Fastify({ ...serverOptions, ...(opts.https ? { https: opts.https } : {}) } as typeof serverOptions);
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
    console.error(`[error] ${req.method} ${req.url}:`, err);
    return reply.code(500).send({ error: { code: 'server_error', message: 'Something went wrong. The error has been logged.' } });
  });

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
  const custom = makeCustomFields(db);
  const res = makeResources({ app, db, audit, lookups, custom });
  gate.attach(res.registry);
  const recentAuth = (req: FastifyRequest, what: string) => requireRecentAuth({ db, audit, settings }, req, what);
  const watchers = registerTagsAndWatchers({ app, db, audit, lookups, res });
  registerCoreRoutes({ app, db, audit, lookups, res, custom, notifyWatchers: watchers.notifyWatchers });
  registerVersion({ app, can, describeRoute: openapi.describe });
  registerCustomFieldRoutes({ app, db, audit, res, custom });
  registerPreferences(app, db);
  const webhooks = registerWebhooks({ app, db, audit, settings, res, box: () => secretBox(db), loadUser, requireRecentAuth: recentAuth });
  const retention = registerRetention({ app, db, audit, lookups, res, requireRecentAuth: recentAuth });
  openapi.attach({ res, custom, settings, gate });
  registerApiDocs(openapi);
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
  jobs.register('core.retention_sweep', async () => retention.sweep(), { maxAttempts: 3 });
  await jobs.schedule('core.retention_sweep', { type: 'core.retention_sweep', every: 24 * 3_600_000, firstRunInMs: 60_000 });
  for (const m of modules) await m.seedDefaults?.(ctx);
  for (const m of modules) await gate.during(m.key, () => m.register?.(ctx));

  const webDir = process.env.GRC_WEB_DIST ? resolve(process.env.GRC_WEB_DIST) : join(repoRoot, 'dist/web');
  const serveWeb = (opts.serveWeb ?? true) && existsSync(join(webDir, 'index.html'));
  if (serveWeb) await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (serveWeb && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.type('text/html').send(readFileSync(join(webDir, 'index.html')));
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
  });

  await app.ready();
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
