// E15-14: records raised from the portal are created as the person (audited under their name,
// with the record type's checks and notifications), but the portal never asks an administrator's
// custom fields, so a custom field marked "required" must not refuse them. The core resource
// registry takes `{ skipCustomRequired: true }` for this: required built-in fields and every
// other check still apply.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

type CreateWithOptions = (type: string, data: Row, req?: FastifyRequest | null, opts?: { skipCustomRequired?: boolean }) => Promise<Row>;

export function createFromPortal(ctx: ModuleContext, type: string, data: Row, req: FastifyRequest): Promise<Row> {
  return (ctx.resources.create as CreateWithOptions)(type, data, req, { skipCustomRequired: true });
}
