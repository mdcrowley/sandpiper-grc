// Which storage drivers are available, and which one new files go to. Every attachment row
// records its driver, so a file is always read from where it was put, whatever the current
// choice: switching to the object store leaves earlier files readable on disk until they are
// moved (housekeeping.ts moveFiles, `cli.ts move-files`).
import type { ModuleContext } from '../../core/module.ts';
import { readStorage, resolveS3 } from './config.ts';
import { s3Client, s3Storage, type S3Client, type S3Config } from './s3.ts';
import { openStorage, type FileStorage } from './storage.ts';
import { dataDirFor } from './service.ts';

export interface Stores {
  /** The local driver: disk, or memory under tests. */
  readonly local: FileStorage;
  /** The object store when it is configured and usable; null otherwise. */
  s3(): (FileStorage & { client: S3Client }) | null;
  /** Why the object store is not usable, when it is configured but not usable. */
  s3Problem(): string | null;
  /** The driver for a stored file. Throws when that store is not available. */
  forDriver(driver: string): FileStorage;
  /** Where new files go. */
  current(): FileStorage;
  /** Re-reads the settings (after an administrator changes them). */
  reload(): Promise<void>;
  /** Tests only: extra connection options for the object store (for example a host resolver). */
  testOverrides?: Partial<S3Config>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the attachments module is loaded. See server/src/modules/attachments/stores.ts. */
    attachmentStores: Stores;
  }
}

export function makeStores(ctx: ModuleContext): Stores {
  const local = openStorage(dataDirFor(ctx));
  let remote: (FileStorage & { client: S3Client }) | null = null;
  let problem: string | null = null;
  let useRemote = false;

  const stores: Stores = {
    local,
    s3: () => remote,
    s3Problem: () => problem,
    forDriver(driver) {
      if (driver === local.driver) return local;
      if (driver === 's3') {
        if (!remote) throw new Error(`Files in the object store cannot be reached: ${problem ?? 'it is not configured'}.`);
        return remote;
      }
      // Rows written under tests use the memory driver; a disk folder copied into a test reads as local.
      if (driver === 'disk' || driver === 'memory') return local;
      throw new Error(`Unknown storage driver "${driver}".`);
    },
    current() {
      if (useRemote) {
        if (!remote) throw new Error(`The object store is chosen for new files but cannot be used: ${problem ?? 'it is not configured'}.`);
        return remote;
      }
      return local;
    },
    async reload() {
      const s = await readStorage(ctx);
      useRemote = s.driver === 's3';
      remote = null;
      problem = null;
      const configured = Boolean(s.s3.endpoint && s.s3.bucket);
      if (!configured) return;
      try {
        remote = s3Storage(s3Client({ ...resolveS3(ctx, s.s3), ...stores.testOverrides }));
      } catch (err) {
        problem = (err as Error).message;
      }
    },
  };
  return stores;
}
