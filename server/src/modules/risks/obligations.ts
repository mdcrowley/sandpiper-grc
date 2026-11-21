import type { ModuleContext } from '../../core/module.ts';

// The obligations register: the `obligation` record type. Moved out of index.ts unchanged
// (wave 10 step 0). Due-date reminders are in obligation-reminders.ts.

/** Defines the `obligation` record type. */
export function registerObligations(ctx: ModuleContext): void {
  ctx.defineResource({
    type: 'obligation', table: 'obligations', module: 'obligations', label: 'Obligation', plural: 'Obligations',
    path: '/api/obligations', route: '/obligations', titleField: 'title', ref: { field: 'ref', prefix: 'OBL-' },
    searchable: ['title', 'source', 'requirement', 'how_met', 'evidence'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Obligation', type: 'text', required: true },
      source: { label: 'Source', type: 'text' },
      requirement: { label: 'Requirement', type: 'longtext' },
      owner_id: { label: 'Owner', type: 'user' },
      how_met: { label: 'How it is met', type: 'longtext' },
      evidence: { label: 'Evidence', type: 'longtext' },
      next_due_on: { label: 'Next due', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'obligation_status', default: 'not_assessed' },
    },
  });

  // Obligations are organization data: none are created here. They come from the
  // organization profile at seed time (see seed.ts) or are entered by hand.
}
