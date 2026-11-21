import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlib, gzip } from 'node:zlib';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// The built web application (OP-11). The bundles under /assets carry a content hash in their
// names, so a browser may keep them for a year without asking again ("immutable"); a new build
// has new names. index.html and the other top-level files are asked about on every load
// ("no-cache", answered with 304 Not Modified when unchanged), so a new version reaches everyone at
// once. Text assets go out compressed (Brotli, else gzip) when the browser accepts it: compressed
// once, on first request, and kept in memory with the file (the whole build is a few megabytes).
// JSON from the API is not compressed here: answers that mix secrets with text a caller controls
// are what BREACH-style attacks need; a reverse proxy may compress them where that risk is judged.

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.svg', '.txt', '.wasm', '.webmanifest', '.ico', '.ttf', '.otf']);
/** Smaller than this, compression saves less than the header costs. */
const MIN_COMPRESS = 1024;
/** Files larger than this are sent from disk as they are, not kept in memory. */
const MAX_CACHED = 8 * 1024 * 1024;
/** A Vite asset name: name-<hash of 8 or more characters>.ext */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

export type Encoding = 'br' | 'gzip' | null;

/** The encoding to send, from Accept-Encoding: Brotli first, then gzip; one refused with q=0 is never chosen. */
export function chooseEncoding(header: string | undefined): Encoding {
  if (!header) return null;
  const accepted = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name.trim(), q ? Number(q.slice(2)) || 0 : 1);
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

/** The cache-control for a file served from the web build, by its path relative to the build folder. */
export function cacheControlFor(relPath: string): string {
  const p = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return p.startsWith('assets/') && HASHED.test(p) ? IMMUTABLE : REVALIDATE;
}

interface Cached {
  mtimeMs: number;
  size: number;
  type: string;
  raw: Buffer;
  etag: string;
  encoded: Partial<Record<'br' | 'gzip', Promise<Buffer>>>;
}

export async function registerWebAssets(app: FastifyInstance, webDir: string): Promise<void> {
  const root = resolve(webDir);
  const assetsDir = join(root, 'assets');
  const cache = new Map<string, Cached>();

  /** The file under assets/ for a requested name, or null for a name that could reach outside it. */
  function fileOf(name: string): string | null {
    if (!SAFE_NAME.test(name) || name.split('/').some((s) => s === '..' || s === '.')) return null;
    const file = join(assetsDir, name);
    return file.startsWith(assetsDir + sep) ? file : null;
  }
  const statOf = (file: string | null) => {
    try {
      return file ? statSync(file) : null;
    } catch {
      return null;
    }
  };
  const large = (name: string) => {
    const st = statOf(fileOf(name));
    return !!st && st.isFile() && st.size > MAX_CACHED;
  };

  function load(name: string): Cached | null {
    const file = fileOf(name);
    const st = statOf(file);
    if (!file || !st || !st.isFile() || st.size > MAX_CACHED) return null;
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const raw = readFileSync(file);
    const entry: Cached = {
      mtimeMs: st.mtimeMs, size: st.size, raw, encoded: {},
      type: TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
      etag: `"${createHash('sha256').update(raw).digest('base64url').slice(0, 27)}"`,
    };
    cache.set(name, entry);
    return entry;
  }

  function encoded(entry: Cached, encoding: 'br' | 'gzip'): Promise<Buffer> {
    let p = entry.encoded[encoding];
    if (!p) {
      p = encoding === 'br'
        ? brotli(entry.raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: entry.raw.length } })
        : gz(entry.raw, { level: 9 });
      entry.encoded[encoding] = p;
      p.catch(() => { delete entry.encoded[encoding]; });
    }
    return p;
  }

  // The hashed bundles: from memory, compressed, cached for a year.
  app.get('/assets/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const name = String((req.params as Record<string, string>)['*'] ?? '');
    const entry = load(name);
    if (!entry) {
      // Too large to keep in memory: sent from disk as it is. Not there: a plain 404, never the
      // application's page (a script tag given HTML fails in a confusing way).
      if (large(name)) {
        reply.header('cache-control', cacheControlFor(`assets/${name}`));
        return reply.sendFile(join('assets', name), root, { cacheControl: false });
      }
      // No file extension: an address of the application itself (an asset record, /assets/:id),
      // loaded or reloaded directly. Answer the application's page, as for any other screen.
      if (!/\.[A-Za-z0-9]+$/.test(name)) {
        reply.header('cache-control', 'no-cache');
        return reply.type('text/html; charset=utf-8').sendFile('index.html', root, { cacheControl: false });
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    const compressible = COMPRESSIBLE.has(extname(name).toLowerCase()) && entry.size >= MIN_COMPRESS;
    const encoding = compressible ? chooseEncoding(req.headers['accept-encoding'] as string | undefined) : null;
    const etag = encoding ? `${entry.etag.slice(0, -1)}-${encoding}"` : entry.etag;
    reply.header('cache-control', cacheControlFor(`assets/${name}`));
    reply.header('content-type', entry.type);
    reply.header('etag', etag);
    reply.header('last-modified', new Date(entry.mtimeMs).toUTCString());
    if (compressible) reply.header('vary', 'Accept-Encoding');
    const match = req.headers['if-none-match'];
    if (match && String(match).split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) return reply.code(304).send();
    if (!encoding) return reply.send(entry.raw);
    reply.header('content-encoding', encoding);
    return reply.send(await encoded(entry, encoding));
  });

  // Once the server listens, compress the bundles in the background, so the first visitor does not wait.
  app.addHook('onListen', async () => {
    let names: string[] = [];
    try {
      names = readdirSync(assetsDir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile()).map((d) => relative(assetsDir, join(d.parentPath, d.name)).split(sep).join('/'));
    } catch { return; }
    void (async () => {
      for (const name of names) {
        if (!COMPRESSIBLE.has(extname(name).toLowerCase())) continue;
        const entry = load(name);
        if (!entry || entry.size < MIN_COMPRESS) continue;
        await encoded(entry, 'br').catch(() => undefined);
        await encoded(entry, 'gzip').catch(() => undefined);
      }
    })();
  });

  // Everything else in the build (index.html, the icon): asked about again on every load.
  await app.register(fastifyStatic, {
    root,
    cacheControl: false,
    setHeaders(res: unknown) {
      const r = res as { header?: (k: string, v: string) => void; setHeader?: (k: string, v: string) => void };
      if (r.header) r.header('cache-control', REVALIDATE);
      else r.setHeader?.('cache-control', REVALIDATE);
    },
  });
}

/** index.html for the application's own routes (the not-found handler), never kept by a cache unasked. */
export function sendIndex(reply: FastifyReply, webDir: string) {
  return reply.type('text/html').header('cache-control', REVALIDATE).send(readFileSync(join(webDir, 'index.html')));
}
