import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerBudgets } from './budgets.ts';
import { registerEvaluation } from './evaluation.ts';
import { ensureProcurementLists } from './lists.ts';
import { registerOrders } from './orders.ts';
import { seedProcurement } from './seed.ts';
import { registerSettings } from './settings.ts';
import { registerSolicitations } from './solicitations.ts';
import { registerWork } from './work.ts';

/**
 * Procurement and budgets (E46, wave 26). Solicitations (PRC-) with their method, estimate, funding
 * source, schedule, addenda, required clauses, evaluation committee with conflict-of-interest
 * declarations, criteria and scores, the ranked result, the award, protests and the resulting contract;
 * offers received (OFR-), which with the scores stay with procurement staff and the committee until the
 * award; purchase orders (PO-) with lines charged to budget lines, approval, issue and receiving; and
 * budgets (BUD-) with operating and capital lines (BL-) showing budget against committed and spent.
 * Permission module `procurement`; feature area `procurement` (vendors and contracts stay independent).
 */
const mod: ModuleDef = {
  key: 'procurement',
  async seedDefaults(ctx: ModuleContext) {
    await ensureProcurementLists(ctx);
  },
  async register(ctx: ModuleContext) {
    registerSolicitations(ctx);
    registerEvaluation(ctx);
    registerOrders(ctx);
    registerBudgets(ctx);
    registerSettings(ctx);
    registerWork(ctx);
  },
  seed: seedProcurement,
};
export default mod;
