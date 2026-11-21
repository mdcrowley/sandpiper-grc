import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { OpsError } from './errors.ts';
import { PRIVATE_DIR, PRIVATE_FILE } from './files.ts';

// Single-file archives of a backup or an export, optionally encrypted.
//
// The content is always a POSIX "ustar" tar stream, so an unencrypted archive (`.tar`) opens
// with any tar tool. An encrypted archive (`.tar.sgrc`) is that same tar stream sealed with
// AES-256-GCM in chunks, in the documented format below; `cli.ts decrypt` turns it back into
// the plain `.tar`.
//
//   bytes 0-7    "SGRCENC1"                        magic and format version
//   bytes 8-11   header length H, unsigned 32-bit big-endian
//   next H bytes header, UTF-8 JSON:
//                  kdf        "scrypt" (a passphrase) or "key" (a 32-byte key file)
//                  salt       16 random bytes, base64
//                  N, r, p    scrypt cost (kdf "scrypt" only)
//                  nonce      7 random bytes, base64: the first 7 bytes of every chunk's nonce
//                  chunkSize  plaintext bytes per chunk (65536)
//                  info       what the archive holds (name, kind, created, size): readable
//                             without the key so archives can be listed, and authenticated
//   then chunks  each: ciphertext length L (32-bit big-endian), L bytes, 16-byte GCM tag
//
// Key: scrypt(passphrase, salt, 32 bytes) for a passphrase; HKDF-SHA256(key file, salt,
// "sandpiper-grc archive v1") for a key file. Chunk i (from 0) is sealed with the nonce
// <7-byte prefix><i as 32-bit big-endian><1 if it is the last chunk, else 0> and with the
// magic, length and header bytes as additional authenticated data. Every chunk is checked
// before its plaintext is used; a missing last chunk (a cut-off file), reordered or altered
// chunks, a changed header and a wrong key are all refused.

export const ENC_MAGIC = Buffer.from('SGRCENC1', 'latin1');
const CHUNK = 64 * 1024;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 };
const HKDF_INFO = 'sandpiper-grc archive v1';
export const ARCHIVE_EXT = '.tar';
export const ENCRYPTED_EXT = '.tar.sgrc';

export type ArchiveKey = { kind: 'passphrase'; passphrase: string } | { kind: 'key'; key: Buffer };

/** What an archive says about itself, readable without the key. */
export interface ArchiveInfo {
  kind: 'backup' | 'export' | 'online-backup' | 'code';
  name: string;
  createdAt: string;
  appVersion: string;
  [extra: string]: unknown;
}

export const isArchivePath = (p: string) => p.endsWith(ARCHIVE_EXT) || p.endsWith(ENCRYPTED_EXT);

// ---------------------------------------------------------------- keys

/**
 * The key for encrypted backups and exports, from (in order) an explicit key file or
 * passphrase file, then GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE, GRC_BACKUP_PASSPHRASE.
 * Null when none is given. A key file inside the data folder is refused: it would travel with
 * the data it protects.
 */
export function loadArchiveKey(opts: { keyFile?: string | null; passphraseFile?: string | null; dataDir?: string; env?: NodeJS.ProcessEnv } = {}): ArchiveKey | null {
  const env = opts.env ?? process.env;
  const keyFile = opts.keyFile || (!opts.passphraseFile && env.GRC_BACKUP_KEY_FILE) || null;
  const passFile = opts.passphraseFile || (!opts.keyFile && env.GRC_BACKUP_PASSPHRASE_FILE) || null;
  const inside = (file: string) => {
    if (!opts.dataDir || opts.dataDir === 'memory') return false;
    const rel = relative(resolve(opts.dataDir), resolve(file));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  const read = (file: string, what: string) => {
    if (!existsSync(file)) throw new OpsError(`The ${what} ${file} does not exist.`);
    if (inside(file)) throw new OpsError(`The ${what} must be kept outside the data folder (${file} is inside it), or it would be copied with the data it protects.`);
    return readFileSync(file, 'utf8');
  };
  if (keyFile) {
    const text = read(keyFile, 'key file').trim();
    const key = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
    if (key.length !== 32) throw new OpsError(`The key file ${keyFile} must hold 32 bytes as 64 hex characters or base64 (make one with: cli.ts new-key <file>).`);
    return { kind: 'key', key };
  }
  const passphrase = passFile ? read(passFile, 'passphrase file').replace(/\r?\n$/, '') : env.GRC_BACKUP_PASSPHRASE ?? '';
  if (passFile || env.GRC_BACKUP_PASSPHRASE !== undefined) {
    if (passphrase.length < 12) throw new OpsError('The backup passphrase must be at least 12 characters long.');
    return { kind: 'passphrase', passphrase };
  }
  return null;
}

/** Where the key came from, for messages and the administration page. Never the key itself. */
export function describeKeySource(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.GRC_BACKUP_KEY_FILE) return `key file (GRC_BACKUP_KEY_FILE)`;
  if (env.GRC_BACKUP_PASSPHRASE_FILE) return `passphrase file (GRC_BACKUP_PASSPHRASE_FILE)`;
  if (env.GRC_BACKUP_PASSPHRASE !== undefined) return `passphrase (GRC_BACKUP_PASSPHRASE)`;
  return null;
}

/** A new random key, as written by `cli.ts new-key`. */
export function newKeyText(): string {
  return `${randomBytes(32).toString('hex')}\n`;
}

function deriveKey(key: ArchiveKey, header: { kdf: string; salt: string; N?: number; r?: number; p?: number }): Buffer {
  const salt = Buffer.from(header.salt, 'base64');
  if (header.kdf === 'scrypt') {
    if (key.kind !== 'passphrase') throw new OpsError('This archive was encrypted with a passphrase; give the passphrase, not a key file.');
    const N = header.N ?? SCRYPT.N;
    const r = header.r ?? SCRYPT.r;
    if (N > 1 << 20 || r > 32) throw new OpsError('The archive asks for an unreasonable key-derivation cost; it was not opened.');
    return scryptSync(key.passphrase.normalize('NFC'), salt, 32, { N, r, p: header.p ?? SCRYPT.p, maxmem: 256 * N * r + 1024 * 1024 });
  }
  if (header.kdf === 'key') {
    if (key.kind !== 'key') throw new OpsError('This archive was encrypted with a key file; give the key file, not a passphrase.');
    return Buffer.from(hkdfSync('sha256', key.key, salt, HKDF_INFO, 32));
  }
  throw new OpsError(`Unknown key derivation "${header.kdf}".`);
}

// ---------------------------------------------------------------- tar

const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** One ustar header block. Names longer than 100 bytes are split into prefix and name at a slash. */
export function tarHeader(path: string, size: number, type: 'file' | 'dir', mtime = Date.now()): Buffer {
  let name = type === 'dir' && !path.endsWith('/') ? `${path}/` : path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    // The leftmost slash that leaves at most 100 bytes after it keeps the prefix shortest.
    let at = -1;
    for (let i = 1; i < name.length - 1; i += 1) {
      if (name[i] === '/' && Buffer.byteLength(name.slice(i + 1)) <= 100) { at = i; break; }
    }
    if (at <= 0 || Buffer.byteLength(name.slice(0, at)) > 155) throw new OpsError(`A path is too long for the archive: ${path}`);
    prefix = name.slice(0, at);
    name = name.slice(at + 1);
  }
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(type === 'dir' ? 0o755 : 0o644, 8), 100, 'latin1');
  h.write(octal(0, 8), 108, 'latin1');
  h.write(octal(0, 8), 116, 'latin1');
  h.write(octal(type === 'dir' ? 0 : size, 12), 124, 'latin1');
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write(type === 'dir' ? '5' : '0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

export interface TarSource {
  /** Path inside the archive, forward slashes. */
  path: string;
  type: 'file' | 'dir';
  /** A file on disk, or the bytes themselves. */
  file?: string;
  data?: Buffer;
}

/** The tar stream of the given entries, read from disk one file at a time. */
export function tarStream(entries: TarSource[]): Readable {
  async function* generate() {
    for (const e of entries) {
      if (e.type === 'dir') {
        yield tarHeader(e.path, 0, 'dir');
        continue;
      }
      const size = e.data ? e.data.length : statSync(e.file!).size;
      yield tarHeader(e.path, size, 'file');
      let sent = 0;
      if (e.data) {
        yield e.data;
        sent = e.data.length;
      } else {
        for await (const chunk of createReadStream(e.file!)) {
          sent += (chunk as Buffer).length;
          yield chunk as Buffer;
        }
      }
      if (sent !== size) throw new OpsError(`${e.path} changed while it was being archived.`);
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) yield Buffer.alloc(pad, 0);
    }
    yield Buffer.alloc(BLOCK * 2, 0);
  }
  return Readable.from(generate(), { objectMode: false });
}

/** Reads exact byte counts from a stream of chunks. */
class ByteReader {
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  private readonly it: AsyncIterator<Buffer>;
  constructor(source: AsyncIterable<Buffer | Uint8Array>) {
    this.it = (async function* () {
      for await (const c of source) yield Buffer.isBuffer(c) ? c : Buffer.from(c);
    })();
  }
  private async fill(n: number): Promise<void> {
    while (this.buf.length < n && !this.done) {
      const next = await this.it.next();
      if (next.done) this.done = true;
      else this.buf = this.buf.length ? Buffer.concat([this.buf, next.value]) : next.value;
    }
  }
  /** Up to n bytes; fewer only at the end of the stream. */
  async read(n: number): Promise<Buffer> {
    await this.fill(n);
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(out.length);
    return out;
  }
  async atEnd(): Promise<boolean> {
    await this.fill(1);
    return this.buf.length === 0;
  }
  /** Exactly n bytes as a series of chunks; throws if the stream ends first. */
  async *take(n: number): AsyncGenerator<Buffer> {
    let left = n;
    while (left > 0) {
      if (!this.buf.length) await this.fill(1);
      if (!this.buf.length) throw new OpsError('The archive ends part-way through a file: it is incomplete.');
      const part = this.buf.subarray(0, Math.min(left, this.buf.length));
      this.buf = this.buf.subarray(part.length);
      left -= part.length;
      yield part;
    }
  }
}

export interface TarEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  /** The file's bytes. Read it (or not) before asking for the next entry. */
  body: AsyncIterable<Buffer>;
}

function parseHeader(h: Buffer): { path: string; type: string; size: number } {
  const str = (start: number, len: number) => {
    const raw = h.subarray(start, start + len);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? len : end).toString('utf8');
  };
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (parseInt(str(148, 8).trim() || '0', 8) !== sum) throw new OpsError('The archive is damaged: a header checksum does not match.');
  const prefix = str(345, 155);
  const name = str(0, 100);
  return { path: prefix ? `${prefix}/${name}` : name, type: str(156, 1) || '0', size: parseInt(str(124, 12).trim() || '0', 8) };
}

/** The entries of a tar stream, in order. Paths that could leave the destination folder are refused. */
export async function* readTar(source: AsyncIterable<Buffer | Uint8Array>): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  for (;;) {
    const h = await reader.read(BLOCK);
    if (h.length < BLOCK) throw new OpsError('The archive is incomplete: it ends without the end-of-archive marker.');
    if (h.every((b) => b === 0)) return;
    const { path: raw, type, size } = parseHeader(h);
    const path = raw.replace(/\/+$/, '');
    if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some((p) => p === '..' || p === '') || path.includes('\\')) {
      throw new OpsError(`The archive holds an unsafe path and was not opened: ${raw}`);
    }
    if (type !== '0' && type !== '5') throw new OpsError(`The archive holds an entry of a kind this application does not write (${path}).`);
    const isDir = type === '5';
    let consumed = false;
    const body = (async function* () {
      consumed = true;
      yield* reader.take(isDir ? 0 : size);
    })();
    yield { path, type: isDir ? 'dir' : 'file', size: isDir ? 0 : size, body };
    if (!consumed) for await (const _ of reader.take(isDir ? 0 : size)) { /* skipped */ }
    else for await (const _ of body) { /* the rest of a partly read body */ }
    const pad = isDir ? 0 : (BLOCK - (size % BLOCK)) % BLOCK;
    if (pad) await reader.read(pad);
  }
}

// ---------------------------------------------------------------- encryption

function nonceFor(prefix: Buffer, index: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0, 0, 7);
  n.writeUInt32BE(index, 7);
  n[11] = last ? 1 : 0;
  return n;
}

/** Seals a byte stream into the encrypted format. `info` is stored readable and authenticated. */
export function encryptStream(key: ArchiveKey, info: ArchiveInfo): Transform {
  const salt = randomBytes(16);
  const prefix = randomBytes(7);
  const header = Buffer.from(JSON.stringify({
    kdf: key.kind === 'passphrase' ? 'scrypt' : 'key',
    salt: salt.toString('base64'),
    ...(key.kind === 'passphrase' ? SCRYPT : {}),
    nonce: prefix.toString('base64'),
    chunkSize: CHUNK,
    info,
  }), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  const aad = Buffer.concat([ENC_MAGIC, len, header]);
  const k = deriveKey(key, JSON.parse(header.toString('utf8')));
  let index = 0;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let started = false;

  const seal = (plain: Buffer, last: boolean): Buffer => {
    const cipher = createCipheriv('aes-256-gcm', k, nonceFor(prefix, index, last));
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    index += 1;
    const l = Buffer.alloc(4);
    l.writeUInt32BE(body.length);
    return Buffer.concat([l, body, cipher.getAuthTag()]);
  };

  return new Transform({
    transform(chunk: Buffer, _enc, done: TransformCallback) {
      if (!started) { this.push(aad); started = true; }
      pending.push(chunk);
      pendingBytes += chunk.length;
      // Keep at least one byte back, so the last chunk is never sealed as "not last".
      while (pendingBytes > CHUNK) {
        const all = Buffer.concat(pending);
        this.push(seal(all.subarray(0, CHUNK), false));
        pending = [all.subarray(CHUNK)];
        pendingBytes = pending[0].length;
      }
      done();
    },
    flush(done: TransformCallback) {
      if (!started) this.push(aad);
      this.push(seal(Buffer.concat(pending), true));
      done();
    },
  });
}

interface EncHeader { kdf: string; salt: string; N?: number; r?: number; p?: number; nonce: string; chunkSize: number; info: ArchiveInfo }

async function readEncHeader(reader: ByteReader): Promise<{ header: EncHeader; aad: Buffer } | null> {
  const magic = await reader.read(8);
  if (!magic.equals(ENC_MAGIC)) return null;
  const len = await reader.read(4);
  if (len.length < 4) throw new OpsError('The encrypted archive is cut short.');
  const n = len.readUInt32BE(0);
  if (n > 1024 * 1024) throw new OpsError('The encrypted archive header is not valid.');
  const raw = await reader.read(n);
  try {
    return { header: JSON.parse(raw.toString('utf8')), aad: Buffer.concat([magic, len, raw]) };
  } catch {
    throw new OpsError('The encrypted archive header is not valid.');
  }
}

/** Plaintext of an encrypted stream, chunk by chunk, each checked before it is released. */
async function* decryptChunks(reader: ByteReader, header: EncHeader, aad: Buffer, key: ArchiveKey): AsyncGenerator<Buffer> {
  const k = deriveKey(key, header);
  const prefix = Buffer.from(header.nonce, 'base64');
  let index = 0;
  for (;;) {
    const l = await reader.read(4);
    if (l.length === 0) throw new OpsError('The encrypted archive is incomplete: its last part is missing.');
    if (l.length < 4) throw new OpsError('The encrypted archive is cut short.');
    const size = l.readUInt32BE(0);
    if (size > header.chunkSize + 16) throw new OpsError('The encrypted archive is damaged.');
    const body = await reader.read(size);
    const tag = await reader.read(16);
    if (body.length < size || tag.length < 16) throw new OpsError('The encrypted archive is cut short.');
    const last = await reader.atEnd();
    try {
      const d = createDecipheriv('aes-256-gcm', k, nonceFor(prefix, index, last));
      d.setAAD(aad);
      d.setAuthTag(tag);
      const plain = Buffer.concat([d.update(body), d.final()]);
      index += 1;
      yield plain;
    } catch {
      throw new OpsError(index === 0
        ? 'The archive could not be decrypted: the passphrase or key is wrong, or the file has been altered.'
        : 'The archive failed its integrity check part-way through: it has been altered or damaged.');
    }
    if (last) return;
  }
}

/** The public information of an archive without opening it: null for a plain tar. */
export async function readArchiveInfo(file: string): Promise<{ encrypted: boolean; info: ArchiveInfo | null }> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, 0);
    if (!head.subarray(0, 8).equals(ENC_MAGIC)) return { encrypted: false, info: null };
    const n = head.readUInt32BE(8);
    if (n > 1024 * 1024) return { encrypted: true, info: null };
    const raw = Buffer.alloc(n);
    await handle.read(raw, 0, n, 12);
    return { encrypted: true, info: (JSON.parse(raw.toString('utf8')) as EncHeader).info ?? null };
  } catch {
    return { encrypted: true, info: null };
  } finally {
    await handle.close();
  }
}

const NEED_KEY = 'This archive is encrypted. Give the key file or passphrase it was made with (GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE, or --key-file / --passphrase-file).';

/** Opens an archive file (plain or encrypted) and yields its entries. `key` is needed only when it is encrypted. */
export function openArchiveFile(file: string, key: ArchiveKey | null): AsyncGenerator<TarEntry> {
  return openArchiveStream(createReadStream(file), key);
}

/** Opens an archive from any byte stream (a file, an object-store download), plain or encrypted. */
export async function* openArchiveStream(source: AsyncIterable<Buffer | Uint8Array>, key: ArchiveKey | null): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source);
  const first = await reader.read(8);
  // Everything from the first byte again: the 8 bytes looked at, then the rest.
  const replay = async function* () {
    yield first;
    for (;;) {
      const more = await reader.read(CHUNK);
      if (!more.length) return;
      yield more;
    }
  };
  if (!first.equals(ENC_MAGIC)) {
    yield* readTar(replay());
    return;
  }
  if (!key) throw new OpsError(NEED_KEY);
  const again = new ByteReader(replay());
  const head = (await readEncHeader(again))!;
  yield* readTar(decryptChunks(again, head.header, head.aad, key));
}

// ---------------------------------------------------------------- whole-archive helpers

/** Writes entries to `dest` (encrypted when a key is given), via a temporary name. Returns the size. */
export async function writeArchive(dest: string, entries: TarSource[], key: ArchiveKey | null, info: ArchiveInfo): Promise<number> {
  await mkdir(dirname(dest), { recursive: true, mode: PRIVATE_DIR });
  const partial = `${dest}.partial`;
  await rm(partial, { force: true });
  try {
    const stages: NodeJS.ReadWriteStream[] = key ? [encryptStream(key, info)] : [];
    await pipeline(tarStream(entries), ...(stages as [Transform]), createWriteStream(partial, { flags: 'wx', mode: PRIVATE_FILE }));
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
  return statSync(dest).size;
}

/** The entries for a folder: every sub-folder and file, under `prefix` in the archive. */
export function folderEntries(dir: string, folders: string[], files: string[], prefix = ''): TarSource[] {
  const p = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
  return [
    ...folders.map((f): TarSource => ({ path: `${p}${f}`, type: 'dir' })),
    ...files.map((f): TarSource => ({ path: `${p}${f}`, type: 'file', file: join(dir, ...f.split('/')) })),
  ];
}

/** Hashes every file in an archive without writing anything: path -> { size, sha256 }, plus folders. */
export async function hashArchive(entries: AsyncIterable<TarEntry>): Promise<{ files: Map<string, { size: number; sha256: string; data?: Buffer }>; folders: Set<string> }> {
  const files = new Map<string, { size: number; sha256: string; data?: Buffer }>();
  const folders = new Set<string>();
  for await (const e of entries) {
    if (e.type === 'dir') { folders.add(e.path); continue; }
    const hash = createHash('sha256');
    const keep = e.path.endsWith('manifest.json') && e.size < 64 * 1024 * 1024;
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of e.body) {
      hash.update(chunk);
      size += chunk.length;
      if (keep) parts.push(Buffer.from(chunk));
    }
    files.set(e.path, { size, sha256: hash.digest('hex'), ...(keep ? { data: Buffer.concat(parts) } : {}) });
  }
  return { files, folders };
}

/** Writes an archive's entries into a folder (which must be empty or missing). */
export async function extractEntries(entries: AsyncIterable<TarEntry>, outDir: string): Promise<number> {
  const base = resolve(outDir);
  await mkdir(base, { recursive: true, mode: PRIVATE_DIR });
  let count = 0;
  for await (const e of entries) {
    const target = resolve(base, ...e.path.split('/'));
    if (!target.startsWith(base + sep)) throw new OpsError(`The archive holds an unsafe path: ${e.path}`);
    if (e.type === 'dir') { await mkdir(target, { recursive: true, mode: PRIVATE_DIR }); continue; }
    await mkdir(dirname(target), { recursive: true, mode: PRIVATE_DIR });
    // SP-07: what is unpacked (data, the secret key) is readable by its owner only.
    await pipeline(Readable.from(e.body), createWriteStream(target, { flags: 'wx', mode: PRIVATE_FILE }));
    count += 1;
  }
  return count;
}

/** Turns an encrypted archive back into the plain tar it holds. */
export async function decryptToTar(file: string, out: string, key: ArchiveKey): Promise<void> {
  const reader = new ByteReader(createReadStream(file));
  const head = await readEncHeader(reader);
  if (!head) throw new OpsError(`${file} is not an encrypted archive.`);
  await mkdir(dirname(resolve(out)), { recursive: true, mode: PRIVATE_DIR });
  const partial = `${out}.partial`;
  try {
    await pipeline(Readable.from(decryptChunks(reader, head.header, head.aad, key)), createWriteStream(partial, { flags: 'wx', mode: PRIVATE_FILE }));
    await rename(partial, out);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
}
