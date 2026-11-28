// Dev profile only (E46-71): invented planned maintenance for the sample fleet. Called by the models
// seed, which runs after fleet and condition, once the sample vehicle models and odometers exist.
// Intervals per sample vehicle model, a year of odometer (and, for diesel buses, engine-hour)
// readings per vehicle ending at its odometer, and one earlier service per vehicle and interval,
// spread so that some are overdue, some due soon and most in date. Safe to run again: intervals are
// matched by name, and a vehicle that already has readings or a service of an interval is left alone.
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';

interface IntervalSeed { name: string; model: string; every_miles?: number; every_hours?: number; every_days?: number; description: string }

const INTERVALS: IntervalSeed[] = [
  { name: '[Sample] A inspection, diesel buses', model: '[Sample] Citystrider 12 diesel bus', every_miles: 6000, every_days: 45, description: '[Sample] Safety inspection: brakes, tires, lights, doors, wheelchair ramp and fluid levels.' },
  { name: '[Sample] Engine oil and filters, diesel buses', model: '[Sample] Citystrider 12 diesel bus', every_miles: 12000, every_hours: 500, description: '[Sample] Engine oil, oil and fuel filters, and a look at the belts.' },
  { name: '[Sample] A inspection, electric buses', model: '[Sample] Citystrider 12E electric bus', every_miles: 6000, every_days: 45, description: '[Sample] Safety inspection: brakes, tires, lights, doors, wheelchair ramp and the high-voltage warning labels.' },
  { name: '[Sample] Battery and HVAC check, electric buses', model: '[Sample] Citystrider 12E electric bus', every_days: 365, description: '[Sample] Traction battery health, cooling loop and the heating and air conditioning.' },
  { name: '[Sample] A inspection, night-route buses', model: '[Sample] Citystrider 12E, two cameras', every_miles: 6000, every_days: 45, description: '[Sample] Safety inspection, as on the other electric buses.' },
  { name: '[Sample] Truck and brake inspection, light rail', model: '[Sample] LRV-30 light-rail vehicle', every_miles: 15000, every_days: 90, description: '[Sample] Trucks, wheels, friction and track brakes, couplers and the pantograph.' },
];

const MILES_PER_DAY = (mode: string) => (mode === 'light_rail' ? 160 : 115);

export async function seedMaintenance(ctx: ModuleContext): Promise<string> {
  if (!ctx.resources.get('maintenance_interval') || !ctx.resources.get('vehicle_model')) return '';
  const today = dayInZone();
  const owner = (await ctx.db.one<{ id: string }>(`select id from users where deleted_at is null and status = 'active' order by created_at limit 1`))?.id ?? null;
  let intervals = 0;
  let readings = 0;
  let services = 0;
  for (const s of INTERVALS) {
    const model = await ctx.db.one<{ id: string }>('select id from vehicle_models where lower(name) = lower($1) and deleted_at is null', [s.model]);
    if (!model) continue;
    let interval = await ctx.db.one<Row>('select * from maintenance_intervals where lower(name) = lower($1) and deleted_at is null', [s.name]);
    if (!interval) {
      interval = await ctx.resources.create('maintenance_interval', {
        name: s.name, description: s.description, model_id: model.id, every_miles: s.every_miles ?? null, every_hours: s.every_hours ?? null,
        every_days: s.every_days ?? null, owner_id: owner, active: true,
      });
      intervals++;
    }
  }
  const vehicles = await ctx.db.query<Row>(
    `select v.id, v.fleet_number, v.mode, v.odometer_miles, v.model_id, m.name as model from vehicles v join vehicle_models m on m.id = v.model_id
     where v.deleted_at is null and v.status <> 'retired' order by v.fleet_number`);
  for (const [k, v] of vehicles.entries()) {
    const rate = MILES_PER_DAY(v.mode) + (k % 5) * 6;
    const diesel = String(v.model).includes('diesel');
    const current = Number(v.odometer_miles) > 0 ? Number(v.odometer_miles) : (v.mode === 'light_rail' ? 600000 : 140000) + k * 3100;
    // A year of readings, every two months, ending on the vehicle's odometer.
    if (!(await ctx.db.one('select 1 from vehicle_readings where vehicle_id = $1', [v.id]))) {
      for (let back = 360; back >= 0; back -= 60) {
        const miles = Math.round(current - rate * back);
        await ctx.resources.create('vehicle_reading', {
          vehicle_id: v.id, read_on: addDays(today, -back - (k % 4)), odometer_miles: miles, engine_hours: diesel ? Math.round(miles / 13) : null,
          source: back === 0 ? 'telematics' : 'fueling', notes: '[Sample] Invented reading.',
        });
        readings++;
      }
    }
    // One earlier service per interval of its model: most in date, some due soon, a few overdue.
    for (const s of INTERVALS.filter((x) => x.model === v.model)) {
      const interval = await ctx.db.one<Row>('select id from maintenance_intervals where lower(name) = lower($1) and deleted_at is null', [s.name]);
      if (!interval || await ctx.db.one('select 1 from maintenance_records where vehicle_id = $1 and interval_id = $2', [v.id, interval.id])) continue;
      const share = [0.35, 0.6, 0.92, 1.12, 0.2, 0.75, 0.5][k % 7];
      // Days the interval lasts: its days, or the miles at this vehicle's rate, whichever comes first.
      const span = Math.min(s.every_miles ? s.every_miles / rate : Infinity, s.every_days ?? Infinity);
      const daysAgo = Math.max(1, Math.round(span * share));
      // On the same straight line as the readings above (offset by the same few days).
      const miles = Math.round(current - rate * (daysAgo - (k % 4)));
      await ctx.resources.create('maintenance_record', {
        vehicle_id: v.id, interval_id: interval.id, done_on: addDays(today, -daysAgo), odometer_miles: s.every_miles ? miles : null,
        engine_hours: s.every_hours ? Math.round(miles / 13) : null, work_order: `SAMPLE-WO-${v.fleet_number}-${k % 9}${String(daysAgo).padStart(3, '0')}`,
        notes: '[Sample] Invented service record.',
      });
      services++;
    }
  }
  return `maintenance intervals ${INTERVALS.length} (${intervals} new), ${readings} readings and ${services} services new`;
}
