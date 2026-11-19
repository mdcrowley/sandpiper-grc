// Where the bytes of an attachment live. The database never holds file content.
//
// Drivers: `disk` (under <data folder>/files), `memory` (tests) and `s3` (an S3-compatible
// object store, s3.ts). stores.ts decides which one new files go to; each attachment row
// records its driver, so files stay readable wherever they were put.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

export interface FileStorage {
  /** Short name stored with each attachment, so a later migration knows where a file was put. */
  readonly driver: string;
  /** Stores the stream under `key`. Must leave nothing behind when the stream fails. */
  put(key: string, source: Readable): Promise<void>;
  /** A stream of the stored bytes. Rejects when the key does not exist. */
  get(key: string): Promise<Readable>;
  /** Removes the stored bytes. Succeeds when they are already gone. */
  delete(key: string): Promise<void>;
  /** Size in bytes, or null when the key does not exist. */
  stat(key: string): Promise<{ size: number } | null>;
  /** Every stored key (for the integrity check). */
  list(): Promise<{ key: string; size: number }[]>;
}

/** Keys are made here and nowhere else: two fan-out folders and 32 random hex characters. */
const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/;

/** A new storage key. It has no relation to the file's name, type or owner. */
export function newStorageKey(): string {
  const hex = randomUUID().replace(/-/g, '');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

export function checkStorageKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
}
const checkKey = checkStorageKey;

/** Files on the local disk, each written to a temporary name and renamed when complete. */
export function diskStorage(root: string): FileStorage {
  const base = resolve(root);
  const pathFor = (key: string) => {
    checkKey(key);
    const full = resolve(base, ...key.split('/'));
    // Belt and braces: the pattern above already rules out anything that could leave the folder.
    if (!full.startsWith(base + sep)) throw new Error('Invalid storage key');
    return full;
  };
  return {
    driver: 'disk',
    async put(key, source) {
      const target = pathFor(key);
      const partial = `${target}.part`;
      await mkdir(dirname(target), { recursive: true });
      try {
        await pipeline(source, createWriteStream(partial, { flags: 'wx' }));
        await rename(partial, target);
      } catch (err) {
        await rm(partial, { force: true });
        throw err;
      }
    },
    async get(key) {
      const target = pathFor(key);
      await stat(target); // rejects with ENOENT rather than failing later inside the stream
      return createReadStream(target);
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    async stat(key) {
      try {
        const s = await stat(pathFor(key));
        return s.isFile() ? { size: s.size } : null;
      } catch {
        return null;
      }
    },
    async list() {
      const out: { key: string; size: number }[] = [];
      const walk = async (dir: string, rel: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(join(dir, e.name), r);
          else if (e.isFile()) out.push({ key: r, size: (await stat(join(dir, e.name))).size });
        }
      };
      await walk(base, '');
      return out;
    },
  };
}

/** Files held in process memory. For tests and for GRC_DATA_DIR=memory only. */
export function memoryStorage(): FileStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    driver: 'memory',
    files,
    async put(key, source) {
      checkKey(key);
      const chunks: Buffer[] = [];
      for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      files.set(key, Buffer.concat(chunks));
    },
    async get(key) {
      checkKey(key);
      const data = files.get(key);
      if (!data) throw new Error('No such file');
      return Readable.from([data]);
    },
    async delete(key) {
      checkKey(key);
      files.delete(key);
    },
    async stat(key) {
      checkKey(key);
      const data = files.get(key);
      return data ? { size: data.length } : null;
    },
    async list() {
      return [...files].map(([key, data]) => ({ key, size: data.length }));
    },
  };
}

/** The driver for a data folder: memory for 'memory', otherwise <dataDir>/files on disk. */
export function openStorage(dataDir: string): FileStorage {
  return dataDir === 'memory' ? memoryStorage() : diskStorage(join(dataDir, 'files'));
}
