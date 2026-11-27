// For tests: registers the document file routes and the import routes when the policies module has
// not registered them itself (it does once it calls registerDocumentFiles and registerDocumentImports).
import type { ModuleDef } from '../../../core/module.ts';
import { registerDocumentImports } from '../import/index.ts';
import { registerDocumentFiles } from './index.ts';

export const documentFilesStandIn: ModuleDef = {
  key: 'docfilesstandin',
  async register(ctx) {
    if (!ctx.app.hasDecorator('convertDocument')) await registerDocumentFiles(ctx);
    if (!ctx.app.hasRoute({ method: 'POST', url: '/api/documents/imports' })) await registerDocumentImports(ctx);
  },
};
