// Rules other modules add to the files of their records (E43-08, E43-17). The attachments module asks
// them before a file is removed and before one is served; the owning module knows what a file means
// (for example the original of an approved document version) without the attachments module knowing
// that module. A guard refuses by calling `ctx.fail`; returning normally lets the action go ahead.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Row } from './module.ts';

export interface AttachmentGuard {
  /** The record type whose files this guard looks after. */
  recordType: string;
  /** Before a file of such a record is removed. */
  beforeRemove?: (req: FastifyRequest, att: Row, record: Row) => Promise<void>;
  /** Before a file of such a record is downloaded (not previewed in place). */
  beforeDownload?: (req: FastifyRequest, att: Row, record: Row) => Promise<void>;
}

const guards = new WeakMap<FastifyInstance, AttachmentGuard[]>();

export function addAttachmentGuard(app: FastifyInstance, guard: AttachmentGuard): void {
  guards.set(app, [...(guards.get(app) ?? []), guard]);
}

export function attachmentGuards(app: FastifyInstance, recordType: string): AttachmentGuard[] {
  return (guards.get(app) ?? []).filter((g) => g.recordType === recordType);
}
