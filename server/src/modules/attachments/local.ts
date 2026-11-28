// Local file import (E18-96): in a data load, an administrator's assistant (or the administrator's
// own session or API token) may have the SERVER read source files from folders on its own disk, so a
// package of thousands of files does not have to travel as base64 parts (uploads.ts).
//
// Off unless an administrator lists folders in the setting `mcp.local_import_roots` (Administration >
// AI assistant access, saved with a recent password confirmation). The server process then reads
// files in those folders with its own operating-system account.
//
// Guards, all of them on every request (tested in local.test.ts):
// - who: the person (or the token's owner) holds admin.administer, data load mode is on and this
//   request's saves are loads (an assistant token also needs AI assistant write access and a token that
//   can write; another API token needs admin.administer in its own scopes);
// - the path: text only (no NUL or control characters), no UNC, device or `\\?\` paths, no `..`
//   segment, no colon except a drive letter's (alternate data streams), no reserved device names;
//   lexically inside an allowed folder, then resolved with realpath (symbolic links and junctions
//   followed) and inside the resolved folder again (case-insensitive on Windows), so a link that leads
//   out is refused; a regular file only, opened without following links where the system allows,
//   and the opened file must be the one checked;
// - the server's own files are always refused, even inside an allowed folder: the data folder, the
//   secret key file (and its retired keys), the backup folders, every file named by a GRC_*_FILE
//   setting, the TLS files, and the application's own folder;
// - every file read is audited (attachment.import_local, marked "(data load)", with the path), and so
//   is every refusal (attachment.import_local_refused).
// The file then goes through the same intake as any upload (allowed types, size limit, content
// against the name, malware scanner) and is attached under the record's own rules.
import { constants, type Stats } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32, posix } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { dataLoadFor, mayLoad } from '../../core/dataload.ts';
import { defaultKeyFile, previousKeyFile } from '../../core/secretkey.ts';
import { tokenScopes } from '../../core/tokens.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { repoRoot } from '../../ops/files.ts';
import { readBackupSettings } from './backups.ts';
import { fileLoad } from './loaded.ts';
import { dataDirFor, formatBytes, present, readSettings as fileSettings, validateDescriptive } from './service.ts';
import { claimUpload, dropUnusedUpload, uploadFromStream } from './uploads.ts';

/** The setting: a list of absolute folder paths. Empty = off. */
export const LOCAL_ROOTS_KEY = 'mcp.local_import_roots';
export const LOCAL_ROOTS_MAX = 20;
const PATH_MAX = 4096;
/** Files looked at by one recursive listing, at most. */
export const LIST_SCAN_MAX = 50_000;
const DEPTH_MAX = 32;
const PAGE_MAX = 1000;

const isWin = process.platform === 'win32';

/** A refusal of a path, in words (never an operating-system message). */
export class LocalPathError extends Error {
  constructor(message: string, public code = 'path_refused', public status = 400) { super(message); }
}
const refuse = (message: string, code = 'path_refused', status = 400): never => { throw new LocalPathError(message, code, status); };

// ---------- paths ----------

const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
/** Names never listed (Office lock files, thumbnail caches, recycle bins). */
export const isJunkName = (name: string) => /^~\$/.test(name) || /^(thumbs\.db|desktop\.ini|\.ds_store|ehthumbs\.db)$/i.test(name)
  || /^(\$recycle\.bin|system volume information|recycler)$/i.test(name);
/** Key files are refused wherever they are. */
const isKeyName = (name: string) => /(^|\.)secret\.key(\.previous)?$/i.test(name);

/** The checks on the text of a path before the disk is touched. Null when it may be looked up. */
export function pathTextProblem(text: string): string | null {
  if (!text) return 'Give a path.';
  if (text.length > PATH_MAX) return `A path has at most ${PATH_MAX} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(text)) return 'The path has a control character in it.';
  if (/^[\\/]{2}/.test(text)) return 'Network (UNC) and device paths (\\\\server\\share, \\\\?\\, \\\\.\\) are not read. Copy the files to an allowed folder on this server.';
  const segments = text.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return 'A path may not contain "..".';
  const rest = /^[A-Za-z]:/.test(text) ? text.slice(2) : text;
  if (rest.includes(':')) return 'A path may not contain a colon except after the drive letter (alternate data streams are not read).';
  if (segments.some((s) => RESERVED.test(s.replace(/[. ]+$/, '')))) return 'A path may not name a device (CON, NUL, COM1 and so on).';
  return null;
}

/** Case-insensitive on Windows: the path made comparable. */
const key = (p: string) => (isWin ? resolve(p).toLowerCase() : resolve(p));

/** True when `file` is `dir` or inside it (exact segments; case-insensitive on Windows). */
export function within(dir: string, file: string): boolean {
  const pathApi = isWin ? win32 : posix;
  const rel = pathApi.relative(key(dir), key(file));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel));
}

const realOrNull = async (p: string) => { try { return await realpath(p); } catch { return null; } };

/**
 * The server's own files and folders, refused even inside an allowed folder: the data folder, the
 * secret key file and its retired keys, the backup folder, the files named by GRC_*_FILE settings and
 * the TLS files, and the application's own folder (its code, settings file and default data and
 * backup folders). `env` and `dataDir` are parameters for the tests.
 */
export function serverPaths(dataDir: string, env: NodeJS.ProcessEnv = process.env, appDir: string = repoRoot): string[] {
  const out: string[] = [appDir];
  if (dataDir && dataDir !== 'memory') {
    out.push(resolve(dataDir));
    if (!env.GRC_SECRET_KEY_FILE) out.push(defaultKeyFile(dataDir), previousKeyFile(defaultKeyFile(dataDir)));
  }
  if (env.GRC_SECRET_KEY_FILE) out.push(resolve(env.GRC_SECRET_KEY_FILE), previousKeyFile(resolve(env.GRC_SECRET_KEY_FILE)));
  if (env.GRC_BACKUP_DIR) out.push(resolve(env.GRC_BACKUP_DIR));
  for (const [k, v] of Object.entries(env)) {
    if (!v || !/^GRC_/.test(k)) continue;
    if (/_FILE$/.test(k) || /^GRC_TLS_/.test(k) || k === 'GRC_DATABASE_SSL_CA') {
      if (isAbsolute(v) || /[\\/]/.test(v)) out.push(resolve(v));
    }
  }
  return [...new Set(out)];
}

/** The same with the scheduled backup folder (Administration > Backups), for this installation. */
export async function protectedPaths(ctx: ModuleContext): Promise<string[]> {
  const out = serverPaths(dataDirFor(ctx));
  try {
    const b = await readBackupSettings(ctx);
    if (b.folder && isAbsolute(b.folder)) out.push(resolve(b.folder));
  } catch { /* no backup settings yet */ }
  return [...new Set(out)];
}

export interface Guard {
  /** The allowed folders as set, and as resolved on disk (null when missing). */
  roots: { given: string; real: string | null }[];
  /** The server's own paths, as given and resolved. */
  protect: string[];
}

export async function makeGuard(rootsSetting: string[], protect: string[]): Promise<Guard> {
  const roots = await Promise.all(rootsSetting.map(async (given) => ({ given: resolve(given), real: await realOrNull(given) })));
  const resolved = (await Promise.all(protect.map(realOrNull))).filter((p): p is string => !!p);
  return { roots, protect: [...new Set([...protect.map((p) => resolve(p)), ...resolved])] };
}

/** Inside one of the server's own paths (a folder that only contains one is fine: its entries are refused). */
const isProtected = (g: Guard, p: string) => g.protect.some((x) => within(x, p));

/** The allowed folder a path lies in (lexically or resolved), or undefined. */
const rootOf = (g: Guard, p: string) => g.roots.find((r) => within(r.given, p) || (r.real && within(r.real, p)));

/**
 * Works out a path given by the caller: refuses anything outside the allowed folders or among the
 * server's own files, follows links and checks again, and answers the resolved path, its folder and
 * what is there. A path outside every folder is refused before the disk is looked at.
 */
export async function resolveLocal(g: Guard, raw: unknown, want: 'file' | 'folder'): Promise<{ real: string; root: string; stats: Stats }> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const problem = pathTextProblem(text);
  if (problem) refuse(problem);
  let abs: string;
  if (isAbsolute(text) && (!isWin || /^[A-Za-z]:[\\/]/.test(text))) abs = resolve(text);
  else if (isAbsolute(text)) return refuse('Give the full path with its drive letter, e.g. C:\\Imports\\file.pdf.');
  else if (g.roots.length === 1) abs = resolve(g.roots[0].given, text);
  else return refuse('Give the full path: more than one folder is allowed.');
  const lexical = rootOf(g, abs);
  if (!lexical) refuse('That path is not inside a folder allowed for local file import.', 'outside_allowed_folders', 403);
  if (isProtected(g, abs)) refuse('That path is one of the server\'s own files or folders (data, secret key, backups or the application), which are never read.', 'server_files', 403);
  if (want === 'file' && isKeyName(basename(abs))) refuse('Key files are never read.', 'server_files', 403);
  const real = await realOrNull(abs);
  if (!real) return refuse(want === 'file' ? 'There is no such file in the allowed folders.' : 'There is no such folder in the allowed folders.', 'not_found', 404);
  // After links and junctions: still inside an allowed folder as it is on disk, and not the server's own.
  const root = g.roots.find((r) => r.real && within(r.real, real));
  if (!root) refuse('That path leads outside the allowed folders (through a link or junction), so it is not read.', 'outside_allowed_folders', 403);
  if (isProtected(g, real) || (want === 'file' && isKeyName(basename(real)))) {
    refuse('That path is one of the server\'s own files or folders (data, secret key, backups or the application), which are never read.', 'server_files', 403);
  }
  const stats = await stat(real);
  if (want === 'file' && !stats.isFile()) refuse(stats.isDirectory() ? 'That is a folder: give a file (list_local_files lists a folder).' : 'That is not a regular file.', 'not_a_file');
  if (want === 'folder' && !stats.isDirectory()) refuse('That is not a folder.', 'not_a_folder');
  return { real, root: root!.real!, stats };
}

/**
 * Opens a checked file for reading: without following a link where the system allows (O_NOFOLLOW),
 * and only when the opened file is the regular file that was checked (same device and inode).
 */
export async function openChecked(real: string, checked: Stats) {
  const flags = constants.O_RDONLY | (!isWin && constants.O_NOFOLLOW ? constants.O_NOFOLLOW : 0);
  let fh;
  try {
    fh = await open(real, flags);
  } catch {
    return refuse('The file could not be opened (it may be in use or not readable by the server).', 'unreadable', 409);
  }
  const st = await fh.stat();
  if (!st.isFile() || st.ino !== checked.ino || st.dev !== checked.dev) {
    await fh.close();
    refuse('The file changed while it was being checked. Try again.', 'changed', 409);
  }
  return { fh, size: st.size };
}

// ---------- listing ----------

/** A pattern with * and ? as a test on a file name (any case). */
export function nameMatcher(pattern: string | undefined): (name: string) => boolean {
  const p = (pattern ?? '').trim();
  if (!p || p === '*' || p === '*.*') return () => true;
  const re = new RegExp(`^${p.split('').map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 'i');
  return (name) => re.test(name);
}

export interface LocalEntry { name: string; relative_path: string; path: string; size_bytes: number; modified_at: string; extension: string; allowed_type: boolean }

export async function listFolder(
  g: Guard, folder: string, opts: { pattern?: string; recursive?: boolean; allowedExtensions: string[] },
): Promise<{ files: LocalEntry[]; folders: { name: string; path: string }[]; skipped: { junk: number; links: number; protected: number }; truncated: boolean }> {
  const match = nameMatcher(opts.pattern);
  const files: LocalEntry[] = [];
  const folders: { name: string; path: string }[] = [];
  const skipped = { junk: 0, links: 0, protected: 0 };
  let scanned = 0;
  let truncated = false;
  const queue: { dir: string; depth: number }[] = [{ dir: folder, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (isJunkName(e.name)) { skipped.junk++; continue; }
      const full = join(dir, e.name);
      // Links and junctions are not followed while listing (attach_local_file checks one given by path).
      if (e.isSymbolicLink()) { skipped.links++; continue; }
      if (isProtected(g, full) || isKeyName(e.name)) { skipped.protected++; continue; }
      if (e.isDirectory()) {
        if (opts.recursive) { if (depth < DEPTH_MAX) queue.push({ dir: full, depth: depth + 1 }); }
        else folders.push({ name: e.name, path: full });
        continue;
      }
      if (!e.isFile() || !match(e.name)) continue;
      if (++scanned > LIST_SCAN_MAX) { truncated = true; break; }
      let st: Stats;
      try { st = await stat(full); } catch { continue; }
      const ext = (/\.([^.]+)$/.exec(e.name)?.[1] ?? '').toLowerCase();
      files.push({
        name: e.name, relative_path: relative(folder, full).split(sep).join('/'), path: full, size_bytes: st.size,
        modified_at: st.mtime.toISOString(), extension: ext, allowed_type: opts.allowedExtensions.includes(ext),
      });
    }
    if (truncated) break;
  }
  const order = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
  files.sort((a, b) => order(a.relative_path, b.relative_path));
  folders.sort((a, b) => order(a.name, b.name));
  return { files, folders, skipped, truncated };
}

// ---------- the setting ----------

/**
 * Checks the folders an administrator lists: absolute local paths of existing folders, none of them
 * inside the server's own files. Answers the list to store, or an error in words.
 */
export async function checkRoots(value: unknown, protect: string[]): Promise<{ roots: string[] } | { error: string }> {
  if (!Array.isArray(value)) return { error: 'Give a list of folders (empty to switch local file import off).' };
  const list = [...new Set(value.map((s) => String(s ?? '').trim()).filter(Boolean))];
  if (list.length > LOCAL_ROOTS_MAX) return { error: `List up to ${LOCAL_ROOTS_MAX} folders.` };
  const out: string[] = [];
  for (const p of list) {
    const problem = pathTextProblem(p);
    if (problem) return { error: `"${p}": ${problem}` };
    if (!isAbsolute(p) || (isWin && !/^[A-Za-z]:[\\/]/.test(p))) return { error: `"${p}" is not a full path. Write it from the drive or the top, e.g. ${isWin ? 'D:\\Imports\\Records' : '/srv/imports/records'}.` };
    const abs = resolve(p);
    const real = await realOrNull(abs);
    let st: Stats | null = null;
    try { st = real ? await stat(real) : null; } catch { st = null; }
    if (!st?.isDirectory()) return { error: `"${p}" is not a folder on the server (it must exist and the server must be able to read it).` };
    const protectReal = [...protect, ...(await Promise.all(protect.map(realOrNull))).filter((x): x is string => !!x)];
    if (protectReal.some((x) => within(x, abs) || within(x, real!))) {
      return { error: `"${p}" is inside the server's own files (data, secret key, backups or the application folder), which are never read.` };
    }
    out.push(abs);
  }
  return { roots: out };
}

// ---------- routes ----------

interface Parent { def: ResourceDef; row: Row; restricted: boolean; label: string }
interface Helpers { needParent(req: FastifyRequest, type: unknown, id: unknown, action: 'view' | 'edit'): Promise<Parent> }

const writes = (perms: string[]) => perms.some((p) => !p.startsWith('mcp.') && (p === '*' || /\.(\*|create|edit)$/.test(p)));

export function registerLocalImport(ctx: ModuleContext, h: Helpers) {
  const { app, db } = ctx;
  const T = 'Data loads';

  /** Who may have the server read its folders, and the folders: every route checks this first. */
  async function guard(req: FastifyRequest): Promise<Guard> {
    if (!mayLoad(req)) ctx.fail(403, 'forbidden', 'Only an administrator can have the server read files from its folders, in a data load.');
    if (req.apiToken) {
      const scopes = tokenScopes(req) ?? [];
      const assistant = scopes.includes('mcp.use') || scopes.includes('mcp.*');
      const ok = assistant ? writes(req.user!.permissions) : ctx.can(req.user, 'admin.administer');
      if (!ok) ctx.fail(403, 'forbidden', assistant ? 'This assistant token cannot write, so it cannot read files from the server\'s folders.' : 'This token needs the admin.administer scope to read files from the server\'s folders.');
    }
    if (!(await dataLoadFor(db, req, ctx.audit))) {
      ctx.fail(409, 'data_load_off', 'Data load mode is off (or AI assistant write access is off), so files cannot be read from the server\'s folders.');
    }
    const roots = await ctx.settings.get<unknown>(LOCAL_ROOTS_KEY, []);
    const list = Array.isArray(roots) ? roots.map(String).filter(Boolean) : [];
    if (!list.length) ctx.fail(409, 'local_import_off', 'Local file import is off: no folders are set (Administration > AI assistant access).');
    req.dataLoad = true; // audit events carry "(data load)"
    return makeGuard(list, await protectedPaths(ctx));
  }

  /** Runs a path check, auditing and answering a refusal in the API's usual shape. */
  async function checked<T>(req: FastifyRequest, given: unknown, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LocalPathError)) throw err;
      await ctx.audit(req, {
        action: 'attachment.import_local_refused', recordType: 'local_file', recordId: String(given ?? '').slice(0, 200),
        summary: `Local file import refused: ${String(given ?? '').slice(0, 500)} (${err.message})`,
      });
      return ctx.fail(err.status, err.code, err.message, err.status === 400 ? { path: err.message } : undefined);
    }
  }

  /** Reads one checked file into a finished upload of the caller's, audited with its path. */
  async function readIntoUpload(req: FastifyRequest, g: Guard, path: unknown): Promise<{ upload: Row; real: string }> {
    const { real, stats } = await checked(req, path, () => resolveLocal(g, path, 'file'));
    const { fh, size } = await checked(req, path, () => openChecked(real, stats));
    let upload: Row;
    try {
      upload = await uploadFromStream(ctx, req, basename(real), fh.createReadStream({ autoClose: true }), size);
    } catch (err) {
      await fh.close().catch(() => undefined);
      await ctx.audit(req, {
        action: 'attachment.import_local_refused', recordType: 'local_file', recordId: real.slice(0, 200),
        summary: `Local file refused by the file intake: ${real} (${(err as Error).message})`, after: { path: real },
      });
      throw err;
    }
    await ctx.audit(req, {
      action: 'attachment.import_local', recordType: 'upload', recordId: upload.id,
      summary: `File read from the server's folder for a data load: ${real} (${formatBytes(Number(upload.size))})`,
      after: { path: real, file_name: upload.file_name, size_bytes: Number(upload.size), sha256: upload.sha256, scan_status: upload.scan_status, upload_id: upload.id },
    });
    return { upload, real };
  }

  app.get('/api/data-load/local-files', async (req) => {
    const g = await guard(req);
    const q = (req.query ?? {}) as Row;
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(q.page_size ?? q.pageSize) || 200));
    const folderGiven = typeof q.folder === 'string' ? q.folder.trim() : '';
    if (!folderGiven && g.roots.length > 1) {
      return { folder: null, roots: g.roots.map((r) => ({ path: r.given, exists: !!r.real })), files: [], folders: g.roots.map((r) => ({ name: r.given, path: r.given })), total: 0, page, page_size: pageSize };
    }
    const { real, root } = await checked(req, folderGiven || g.roots[0].given, () => resolveLocal(g, folderGiven || g.roots[0].given, 'folder'));
    const settings = await fileSettings(ctx);
    const listed = await listFolder(g, real, { pattern: typeof q.pattern === 'string' ? q.pattern : undefined, recursive: q.recursive === true || q.recursive === 'true', allowedExtensions: settings.allowedExtensions });
    const start = (page - 1) * pageSize;
    return {
      folder: real, root, roots: g.roots.map((r) => ({ path: r.given, exists: !!r.real })),
      total: listed.files.length, total_bytes: listed.files.reduce((n, f) => n + f.size_bytes, 0), page, page_size: pageSize,
      files: listed.files.slice(start, start + pageSize), folders: listed.folders, skipped: listed.skipped, truncated: listed.truncated,
      max_bytes: settings.maxBytes,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/data-load/local-files', tag: T, permission: 'admin.administer',
    summary: 'List files in a folder the server may read for a data load (local file import)',
    query: { folder: 'A folder inside an allowed folder (default: the only allowed folder)', pattern: 'File names to list, with * and ?, e.g. *.docx', recursive: 'true: include subfolders', page: 'From 1', page_size: `1 to ${PAGE_MAX} (default 200)` },
    response: '{ folder, root, roots: [{ path, exists }], total, total_bytes, page, page_size, files: [{ name, relative_path, path, size_bytes, modified_at, extension, allowed_type }], folders: [{ name, path }], skipped: { junk, links, protected }, truncated, max_bytes }',
    description: 'Only while the caller\'s saves are data loads (409 `data_load_off`), for administrators and their API and AI assistant tokens (an assistant token must be able to write; another token needs the admin.administer scope), and only when folders are set in `mcp.local_import_roots` (409 `local_import_off`). '
      + 'Office lock files (~$...), Thumbs.db, desktop.ini, .DS_Store and recycle bins are left out; links and junctions are not followed; the server\'s own files are never listed. A path outside the allowed folders answers 403 `outside_allowed_folders`; every refusal is audited.',
  });

  app.post('/api/data-load/local-files/upload', async (req, reply) => {
    const g = await guard(req);
    const b = (req.body ?? {}) as Row;
    const { upload, real } = await readIntoUpload(req, g, b.path);
    reply.code(201);
    return { ...upload, path: real };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/data-load/local-files/upload', tag: T, permission: 'admin.administer',
    summary: 'Read a file from an allowed folder into a finished upload (local file import)', body: '{ path }',
    response: 'The finished upload, as GET /api/attachments/uploads/:id answers it, with `path`.',
    description: 'The same guards as listing. The server reads the file itself and puts it through the usual intake (allowed types 415, size limit 413, content against the name, malware scanner 422); the upload is then used once, like a chunked upload (attach it, or give it to a document version). Audited as `attachment.import_local` with the path.',
  });

  app.post('/api/data-load/local-files/attach', async (req, reply) => {
    const g = await guard(req);
    const b = (req.body ?? {}) as Row;
    const parent = await h.needParent(req, b.record_type, b.record_id, 'edit');
    const meta = validateDescriptive(ctx, b);
    await fileLoad(ctx, req, b.created_at); // a wrong date is refused before the file is read
    const { upload, real } = await readIntoUpload(req, g, b.path);
    // The same file already on the record (same content): left as it is, so a load can be run again.
    const same = await db.one<Row>(
      `select * from attachments where record_type = $1 and record_id = $2 and sha256 = $3 and deleted_at is null order by created_at limit 1`,
      [parent.def.type, parent.row.id, upload.sha256]);
    if (same) {
      await dropUnusedUpload(ctx, upload.id);
      return { ...present(same), duplicate: true, path: real };
    }
    const row = await claimUpload(ctx, req, upload.id, {
      recordType: parent.def.type, recordId: parent.row.id, kind: meta.kind, description: meta.description,
      collectedOn: meta.collected_on, expiresOn: meta.expires_on, createdAt: b.created_at, audit: false,
    });
    await ctx.audit(req, {
      action: 'attachment.upload', recordType: parent.def.type, recordId: parent.row.id,
      summary: `File attached: ${row.file_name} (${formatBytes(Number(row.size_bytes))}, read from the server's folder ${dirname(real)})`,
      after: { attachment_id: row.id, file_name: row.file_name, size_bytes: Number(row.size_bytes), sha256: row.sha256, kind: row.kind, scan_status: row.scan_status, path: real },
    });
    reply.code(201);
    return { ...present(row), duplicate: false, path: real };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/data-load/local-files/attach', tag: T, permission: 'admin.administer',
    summary: 'Attach a file from an allowed folder to a record (local file import)',
    body: '{ path, record_type, record_id, kind?, description?, collected_on?, expires_on?, created_at?, on_behalf_of? }',
    response: 'The attachment, as GET /api/attachments lists it, with `duplicate` and `path`.',
    description: 'The same guards as listing, and edit permission on the record (404 for a record you cannot see). The file goes through the usual intake and is listed with the load, so undoing the load removes it. '
      + 'A file whose content is already on the record is not attached again: the existing one is answered with `duplicate: true`.',
  });
}
