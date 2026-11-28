// Records a data load lists one by one that are not record types of their own (E43-18: document
// versions; E43-14: paper copies). Administration > Data loads (admin/dataload.ts) lists each and
// undoes it alone through the shared `loadedParts` decorator; the module that owns the rows lists
// their names and undoes them.
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface LoadedPart {
  label: string;
  list(ids: string[]): Promise<{ id: string; label: string; route: string | null; gone: boolean }[]>;
  undo(req: FastifyRequest, id: string): Promise<'deleted' | 'missing' | 'held'>;
}

export function loadedParts(app: FastifyInstance): Map<string, LoadedPart> {
  if (!app.hasDecorator('loadedParts')) app.decorate('loadedParts', new Map<string, LoadedPart>());
  return (app as unknown as { loadedParts: Map<string, LoadedPart> }).loadedParts;
}
