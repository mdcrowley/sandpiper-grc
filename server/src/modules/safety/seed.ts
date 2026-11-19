import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { monthsBack } from './indicators.ts';

/**
 * Dev profile only, all invented: a hazard log scored on the hazard matrix, a year of safety
 * events across the sample fleet and services (some with corrective actions, a few overdue),
 * a year of exposure figures and five indicators. Loaded once: a second run changes nothing.
 */

const SAMPLE_NOTE = 'Invented sample record.';

const HAZARDS: Row[] = [
  { title: 'Pedestrians stepping out between parked buses at the interchange', source: 'staff_report', mode: 'bus', likelihood: 4, severity: 3, residual_likelihood: 3, residual_severity: 3, status: 'mitigating', consequence: 'Pedestrian struck by a moving bus.', existing_controls: 'Painted walkways, speed limit in the bus station.' },
  { title: 'Right turns across cycle lanes on the radial routes', source: 'safety_event', mode: 'bus', likelihood: 3, severity: 3, status: 'identified', consequence: 'Collision with a cyclist.', existing_controls: 'Mirror checks in driver training.' },
  { title: 'Passengers falling when the bus pulls away', source: 'safety_event', mode: 'bus', likelihood: 5, severity: 2, residual_likelihood: 4, residual_severity: 2, status: 'mitigating', consequence: 'Passenger injury on board.', existing_controls: 'Announcements; drivers wait for passengers to be seated where possible.' },
  { title: 'Verbal and physical abuse of operators on late-evening journeys', source: 'staff_report', mode: 'bus', likelihood: 4, severity: 3, residual_likelihood: 3, residual_severity: 3, status: 'mitigating', consequence: 'Injury and distress to the operator.', existing_controls: 'Assault screens on newer buses, cameras, radio alarm.' },
  { title: 'Light-rail vehicles at road crossings with poor sight lines', source: 'inspection', mode: 'light_rail', likelihood: 2, severity: 4, residual_likelihood: 1, residual_severity: 4, status: 'controlled', consequence: 'Collision between a tram and a road vehicle.', existing_controls: 'Crossing signals, warning bells, reduced speed.' },
  { title: 'Track defects in the rail yard switches', source: 'inspection', mode: 'light_rail', likelihood: 2, severity: 3, status: 'identified', consequence: 'Low-speed derailment in the yard.', existing_controls: 'Weekly switch inspection.' },
  { title: 'Battery fire while charging electric buses overnight', source: 'risk_assessment', mode: 'bus', likelihood: 1, severity: 4, status: 'controlled', consequence: 'Fire spreading through the depot.', existing_controls: 'Thermal monitoring, spacing between chargers, fire plan.' },
  { title: 'Wet floors at depot entrances in winter', source: 'audit', likelihood: 3, severity: 2, status: 'controlled', consequence: 'Staff slips and falls.', existing_controls: 'Matting, warning signs, gritting.' },
  { title: 'Wheelchair ramp failures on older buses', source: 'safety_event', mode: 'bus', likelihood: 3, severity: 2, status: 'identified', consequence: 'Passenger unable to board, or injured on a ramp.', existing_controls: 'Daily ramp check.' },
  { title: 'Doors closing on passengers at busy stops', source: 'safety_event', mode: 'light_rail', likelihood: 3, severity: 2, residual_likelihood: 2, residual_severity: 2, status: 'mitigating', consequence: 'Passenger trapped or dragged.', existing_controls: 'Door sensors, operator mirrors.' },
  { title: 'Reversing in the depot yard without a banksman', source: 'audit', likelihood: 2, severity: 3, status: 'identified', consequence: 'Staff struck by a reversing bus.', existing_controls: 'Reversing alarms.' },
  { title: 'Fatigue on split duties', source: 'staff_report', likelihood: 3, severity: 3, status: 'identified', consequence: 'Slower reactions leading to a collision.', existing_controls: 'Rostering rules on rest time.' },
];

/** [type, severity, weight] */
const MIX: [string, string, number][] = [
  ['collision', 'minor', 6], ['collision', 'moderate', 3], ['collision', 'serious', 1],
  ['passenger_injury', 'minor', 6], ['passenger_injury', 'moderate', 2], ['passenger_injury', 'serious', 1],
  ['near_miss', 'no_harm', 9], ['operator_assault', 'minor', 3], ['operator_assault', 'moderate', 1],
  ['unsafe_condition', 'no_harm', 5], ['slip_trip_fall', 'minor', 3], ['fire', 'moderate', 0.3], ['derailment', 'minor', 0.2],
];
const TITLES: Record<string, string[]> = {
  collision: ['Bus mirror struck by a passing van', 'Low-speed contact with a parked car', 'Rear-end collision at traffic lights', 'Contact with a cyclist at a junction'],
  passenger_injury: ['Passenger fell when the bus braked', 'Passenger hurt boarding', 'Passenger trapped by closing doors', 'Passenger fell on the stairs'],
  near_miss: ['Pedestrian stepped out in front of the bus', 'Car ran a red light at a tram crossing', 'Cyclist undertook at a stop', 'Child ran onto the platform edge'],
  operator_assault: ['Operator threatened over a fare', 'Operator spat at', 'Operator pushed by a passenger'],
  unsafe_condition: ['Loose handrail reported', 'Damaged kerb at a stop', 'Faulty interior light', 'Trip hazard in the depot yard'],
  slip_trip_fall: ['Staff member slipped in the depot', 'Driver tripped leaving the cab'],
  fire: ['Smoke from an engine bay'],
  derailment: ['Wheel set left the rails at a yard switch'],
};
const CAUSES: [string, string][] = [
  ['human_factors', 'Driver did not check the nearside mirror before moving off.'],
  ['equipment', 'Worn component that had not been reported.'],
  ['procedure', 'The procedure did not cover this situation.'],
  ['third_party', 'Another road user acted unexpectedly.'],
  ['environment', 'Wet road surface and low sun.'],
  ['infrastructure', 'Stop layout leaves too little room.'],
];

/** Small deterministic generator so every dev database looks the same. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

export async function seedSafety(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample safety data is dev profile only)';
  if (await ctx.db.one('select 1 from safety_events where notes = $1 limit 1', [SAMPLE_NOTE])) return 'sample safety data already loaded';
  const rand = rng(20261118);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const today = dayInZone();

  const hazardIds: string[] = [];
  for (const [i, h] of HAZARDS.entries()) {
    const row = await ctx.resources.create('hazard', { ...h, review_date: dayInZone(i % 4 === 0 ? -20 : 30 + i * 15), notes: SAMPLE_NOTE });
    hazardIds.push(row.id);
  }

  const vehicles = ctx.resources.get('vehicle')
    ? await ctx.db.query<Row>(`select id, mode, depot_id from vehicles where deleted_at is null and coalesce(status, '') <> 'retired'`)
    : [];
  const services = ctx.resources.get('service') ? await ctx.db.query<Row>('select id, mode, depot_id from services where deleted_at is null') : [];
  const sites = ctx.resources.get('site') ? await ctx.db.query<Row>('select id, name from sites where deleted_at is null') : [];
  const hasActions = !!ctx.resources.get('action');

  const total = MIX.reduce((n, m) => n + m[2], 0);
  let events = 0;
  let actions = 0;
  for (let day = 360; day >= 1; day--) {
    // About ten events a month.
    if (rand() > 0.33) continue;
    let r = rand() * total;
    const [type, severity] = MIX.find((m) => (r -= m[2]) < 0) ?? MIX[0];
    const rail = type === 'derailment' || rand() < 0.15;
    const vehicle = pick(vehicles.filter((v) => (rail ? v.mode === 'light_rail' : v.mode === 'bus')).concat(vehicles.length ? [] : [{ id: null }]));
    const service = pick(services.filter((s) => (rail ? s.mode === 'light_rail' : s.mode !== 'light_rail')).concat(services.length ? [] : [{ id: null }]));
    const site = type === 'slip_trip_fall' || type === 'unsafe_condition' ? pick(sites.concat(sites.length ? [] : [{ id: null }])) : null;
    const date = dayInZone(-day);
    const hour = 6 + Math.floor(rand() * 17);
    const occurred = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00Z`).toISOString();
    const old = day > 45;
    const [category, cause] = pick(CAUSES);
    const status = old ? 'closed' : day > 20 ? pick(['investigating', 'actions_open']) : 'reported';
    const row = await ctx.resources.create('safety_event', {
      title: pick(TITLES[type]), occurred_at: occurred, event_type: type, severity, status,
      vehicle_id: site ? null : vehicle?.id ?? null, service_id: site ? null : service?.id ?? null, site_id: site?.id ?? null,
      location_detail: site ? 'Depot' : pick(['At a stop', 'Between stops', 'At a junction', 'At the interchange', 'On the platform']),
      description: 'Invented sample account of what happened.',
      immediate_actions: pick(['Vehicle stopped and control informed.', 'First aid given; service continued.', 'Area made safe and reported to the depot.']),
      injuries: ['passenger_injury', 'operator_assault', 'slip_trip_fall'].includes(type) ? 1 : 0,
      investigation_due: dayInZone(-day + 28),
      root_cause: status === 'closed' || status === 'actions_open' ? cause : null,
      root_cause_category: status === 'closed' || status === 'actions_open' ? category : null,
      findings: status === 'closed' ? 'Invented sample findings.' : null,
      notes: SAMPLE_NOTE,
    });
    events++;
    if (['collision', 'passenger_injury', 'near_miss'].includes(type) && rand() < 0.5) {
      const hazard = type === 'passenger_injury' ? hazardIds[2] : type === 'collision' ? hazardIds[1] : hazardIds[0];
      await ctx.db.query('insert into safety_event_hazards (event_id, hazard_id) values ($1,$2) on conflict do nothing', [row.id, hazard]);
    }
    if (hasActions && (severity !== 'no_harm' && severity !== 'minor' || status === 'actions_open')) {
      const due = dayInZone(-day + 45);
      const done = status === 'closed';
      await ctx.resources.create('action', {
        title: pick(['Refresher training for the driver', 'Repair and inspect the equipment', 'Review the stop layout', 'Update the operating procedure', 'Brief all depots on the lesson learned']),
        source: 'safety', source_type: 'safety_event', source_id: row.id, priority: severity === 'serious' ? 'high' : 'medium',
        status: done ? 'done' : due < today ? 'open' : 'in_progress', due_on: due, ...(done ? { completed_on: dayInZone(-day + 30) } : {}),
        notes: SAMPLE_NOTE,
      });
      actions++;
    }
  }

  // A year of exposure: bus and light rail separately.
  for (const [i, period] of monthsBack(12).entries()) {
    const season = 1 + 0.08 * Math.sin((i / 12) * Math.PI * 2);
    for (const [mode, miles, hours, boardings] of [['bus', 182000, 13500, 610000], ['light_rail', 26000, 2100, 240000]] as const) {
      await ctx.db.query(
        `insert into safety_exposure (period, mode, vehicle_miles, vehicle_hours, boardings) values ($1::date,$2,$3,$4,$5) on conflict do nothing`,
        [`${period}-01`, mode, Math.round(miles * season), Math.round(hours * season), Math.round(boardings * season)]);
    }
  }

  const indicators: Row[] = [
    { name: 'Collisions per 100,000 vehicle-miles', event_types: ['collision'], measure: 'rate', exposure: 'vehicle_miles', per_units: 100000, target: 2, target_direction: 'at_most', sort: 10 },
    { name: 'Passenger injuries per million boardings', event_types: ['passenger_injury'], measure: 'rate', exposure: 'boardings', per_units: 1000000, target: 4, target_direction: 'at_most', sort: 20 },
    { name: 'Serious and major events', severities: ['serious', 'major'], measure: 'count', target: 0, target_direction: 'at_most', sort: 30 },
    { name: 'Assaults on operators', event_types: ['operator_assault'], measure: 'count', target: 1, target_direction: 'at_most', sort: 40 },
    { name: 'Near misses reported', description: 'More reports is better: it shows people are reporting.', event_types: ['near_miss'], measure: 'count', target: 2, target_direction: 'at_least', sort: 50 },
  ];
  for (const ind of indicators) {
    if (!(await ctx.db.one('select 1 from safety_indicators where lower(name) = lower($1) and deleted_at is null', [ind.name]))) {
      await ctx.resources.create('safety_indicator', ind);
    }
  }
  return `hazards ${HAZARDS.length}, safety events ${events}, corrective actions ${actions}, indicators ${indicators.length}, exposure 12 months`;
}
