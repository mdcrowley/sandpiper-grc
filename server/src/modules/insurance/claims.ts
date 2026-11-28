// Insurance claims (ICL-): made under the organization's policies or against it, with the safety event,
// security incident, asset, vehicle or site they arose from, the claimant, reserves, payments and
// recoveries. Claims are restricted one by one: kinds that usually hold personal or security details
// (bodily injury, workers' compensation, cyber) start restricted, as does a claim about a restricted
// event or a security incident; only someone with access to restricted records may set or lift the flag.
import type { FastifyRequest } from 'fastify';
import { isDataLoad } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { valuesWith } from './lists.ts';
import { POLICY } from './policies.ts';

export const CLAIM = 'insurance_claim';

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

export function registerClaims(ctx: ModuleContext) {
  const { db } = ctx;

  /** Whether the linked safety event or security incident makes the claim restricted. */
  async function sourceRestricted(merged: Row): Promise<boolean> {
    if (merged.security_incident_id) return true;
    if (merged.safety_event_id && ctx.resources.get('safety_event')) {
      return Boolean((await db.one<Row>('select restricted from safety_events where id = $1', [merged.safety_event_id]))?.restricted);
    }
    return false;
  }

  async function rules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    for (const f of ['reserve', 'paid', 'recovered']) {
      const n = num(merged[f]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) errors[f] = 'Enter an amount of zero or more.';
    }
    const incident = day(merged.incident_on);
    const reported = day(merged.reported_on);
    const closed = day(merged.closed_on);
    if (incident && reported && reported < incident) errors.reported_on = 'A claim cannot be reported before the incident.';
    if (incident && closed && closed < incident) errors.closed_on = 'A claim cannot close before the incident.';

    // The restriction: from the kind and the source, never lifted by someone who cannot see restricted records.
    const sees = !req?.user || ctx.can(req.user, 'security.view');
    const forced = await sourceRestricted(merged);
    if (!existing) {
      const byKind = (await valuesWith(ctx, 'insurance_claim_kind', 'restrict')).includes(merged.claim_kind);
      const wanted = patch.restricted === undefined || patch.restricted === null ? byKind : Boolean(patch.restricted);
      if (!sees && !wanted && byKind) errors.restricted = 'Claims of this kind are restricted records. Ask someone with access to restricted records to lift it.';
      patch.restricted = wanted || forced;
    } else {
      if (patch.restricted !== undefined && patch.restricted !== null && Boolean(patch.restricted) !== Boolean(existing.restricted) && !sees) {
        errors.restricted = 'Only people with access to restricted records can change this.';
      }
      if (patch.restricted !== undefined) patch.restricted = Boolean(patch.restricted);
      if (forced && !(patch.restricted ?? existing.restricted)) patch.restricted = true;
    }
    if (merged.security_incident_id && 'security_incident_id' in patch && !sees) errors.security_incident_id = 'Only people with access to restricted records can link a security incident.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    // A claim that closes gets its closing date (in a data load only the date given counts).
    if (!isDataLoad(req)) {
      const closedStatuses = await valuesWith(ctx, 'insurance_claim_status', 'closed');
      const nowClosed = closedStatuses.includes(merged.status);
      if (nowClosed && !closed) patch.closed_on = todayInZone();
      if (!nowClosed && existing && closedStatuses.includes(existing.status) && 'status' in patch && !('closed_on' in patch)) patch.closed_on = null;
      if (!existing && !merged.reported_on) patch.reported_on = todayInZone();
    }
    return patch;
  }

  ctx.defineResource({
    type: CLAIM, table: 'insurance_claims', module: 'insurance', label: 'Insurance claim', plural: 'Insurance claims',
    path: '/api/insurance/claims', route: '/insurance/claims', titleField: 'title',
    ref: { field: 'ref', prefix: 'ICL-' },
    restricted: 'flag',
    searchable: ['title', 'description', 'carrier_claim_number', 'notes'],
    defaultSort: { field: 'incident_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Claim', type: 'text', required: true, help: 'A short description, for example "Bus collision at a depot gate".' },
      policy_id: { label: 'Policy', type: 'ref', to: POLICY, help: 'The policy the claim is made under.' },
      claim_kind: { label: 'Kind', type: 'lookup', list: 'insurance_claim_kind', required: true },
      direction: { label: 'Made', type: 'lookup', list: 'insurance_claim_direction', default: 'against' },
      status: { label: 'Status', type: 'lookup', list: 'insurance_claim_status', default: 'open' },
      incident_on: { label: 'Incident date', type: 'date', required: true },
      reported_on: { label: 'Reported to the insurer', type: 'date' },
      claimant_name: { label: 'Claimant', type: 'text', help: 'Who makes the claim: a person, business or the organization itself.' },
      carrier_claim_number: { label: 'Insurer\'s claim number', type: 'text' },
      adjuster_name: { label: 'Adjuster', type: 'text' },
      description: { label: 'What happened', type: 'longtext' },
      safety_event_id: { label: 'Safety event', type: 'ref', to: 'safety_event' },
      security_incident_id: { label: 'Security incident', type: 'ref', to: 'security_incident' },
      asset_id: { label: 'Asset', type: 'ref', to: 'asset' },
      vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      reserve: { label: 'Reserve', type: 'currency', help: 'What the insurer or the organization has set aside for the claim.' },
      paid: { label: 'Paid to date', type: 'currency' },
      recovered: { label: 'Recovered', type: 'currency', help: 'Recovered from the insurer or another party (subrogation, salvage).' },
      closed_on: { label: 'Closed', type: 'date' },
      owner_id: { label: 'Handled by', type: 'user' },
      restricted: { label: 'Restricted (holds personal or security details)', type: 'boolean' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => rules(req, null, data),
      beforeUpdate: (req, existing, patch) => rules(req, existing, patch),
    },
  });
}
