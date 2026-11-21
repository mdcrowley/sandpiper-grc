import type { ModuleContext, Row } from '../../core/module.ts';
import { meanings } from './lists.ts';
import { addMonths, wholeNumber } from './shared.ts';

/**
 * The control library (E26-02). A control's ratings, last test date and next test due date are
 * rolled up from its newest reviewed tests (E26-07): `rollUp` is called when a test is reviewed or a
 * reviewed test is deleted. The next test is due `test_every_months` after the last test; before the
 * first test an owner may set the first due date by hand.
 */
export function registerControlResource(ctx: ModuleContext) {
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  function check(merged: Row, patch: Row): Row {
    if ('test_every_months' in patch) {
      const n = wholeNumber(patch.test_every_months, 1, 120);
      if (n === undefined) invalid({ test_every_months: 'Enter a whole number of months from 1 to 120, or leave it empty.' });
      patch.test_every_months = n;
      // A new interval moves the next test date when there is a last test to count from.
      if (merged.last_tested_on && n) patch.next_test_due = addMonths(String(merged.last_tested_on).slice(0, 10), n);
    }
    return patch;
  }

  ctx.defineResource({
    type: 'control', table: 'controls', module: 'controls', label: 'Control', plural: 'Controls',
    path: '/api/controls', route: '/controls', titleField: 'title',
    ref: { field: 'ref', prefix: 'CTL-' },
    evidence: true,
    searchable: ['title', 'description', 'objective', 'notes'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Control', type: 'text', required: true },
      description: { label: 'How it works', type: 'longtext', personal: false },
      objective: { label: 'Objective', type: 'longtext', personal: false },
      control_type: { label: 'Type', type: 'lookup', list: 'control_type' },
      automation: { label: 'Automation', type: 'lookup', list: 'control_automation' },
      frequency: { label: 'How often it operates', type: 'lookup', list: 'control_frequency' },
      domain: { label: 'Domain', type: 'lookup', list: 'control_domain' },
      owner_id: { label: 'Owner', type: 'user' },
      operator_id: { label: 'Operated by', type: 'user' },
      key_control: { label: 'Key control', type: 'boolean', default: false },
      status: { label: 'Status', type: 'lookup', list: 'control_status', default: 'draft' },
      design_rating: { label: 'Design rating', type: 'lookup', list: 'control_test_result', readOnly: true },
      operating_rating: { label: 'Operating rating', type: 'lookup', list: 'control_test_result', readOnly: true },
      last_tested_on: { label: 'Last tested', type: 'date', readOnly: true },
      test_every_months: { label: 'Test every (months)', type: 'number', default: 12 },
      next_test_due: { label: 'Next test due', type: 'date' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (_req, data) => check(data, data),
      beforeUpdate: (_req, existing, patch) => check({ ...existing, ...patch }, patch),
    },
  });
}

/**
 * Works out a control's ratings and dates from its reviewed tests: the newest reviewed design test
 * gives the design rating, the newest reviewed test of any other type the operating rating; the
 * newest test date is the last test, and the next one is due `test_every_months` later. Saved as
 * system work (the fields are read-only), so the control's history shows the change.
 */
export async function rollUp(ctx: ModuleContext, controlId: string): Promise<Row | undefined> {
  const control = await ctx.resources.find('control', controlId);
  if (!control) return undefined;
  const { final } = await meanings(ctx);
  const tests = await ctx.db.query<Row>(
    `select test_type, result, coalesce(performed_on, reviewed_on)::text as tested_on
     from control_tests where control_id = $1 and deleted_at is null and status = any($2::text[]) and result is not null
     order by coalesce(performed_on, reviewed_on) desc nulls last, reviewed_on desc nulls last, created_at desc`,
    [controlId, final],
  );
  const design = tests.find((t) => t.test_type === 'design');
  const operating = tests.find((t) => t.test_type !== 'design');
  const last = tests.find((t) => t.tested_on)?.tested_on ?? null;
  const patch: Row = {
    design_rating: design?.result ?? null,
    operating_rating: operating?.result ?? null,
    last_tested_on: last,
  };
  if (last && control.test_every_months) patch.next_test_due = addMonths(last, Number(control.test_every_months));
  const changed = Object.entries(patch).some(([k, v]) => String(control[k] ?? '').slice(0, 10) !== String(v ?? '').slice(0, 10));
  return changed ? ctx.resources.update('control', controlId, patch, null) : control;
}
