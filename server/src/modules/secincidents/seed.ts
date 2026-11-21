import type { ModuleContext, Row } from '../../core/module.ts';
import type { IncidentService } from './index.ts';

const HOUR = 3_600_000;

/**
 * One clearly invented, already-declared incident so the workspace and the clocks have
 * something to show. Same in both profiles; nothing here comes from the seed folder.
 */
export async function seedSample(ctx: ModuleContext, svc: IncidentService): Promise<string> {
  const existing = await ctx.db.one(
    `select 1 from security_incidents where title like '[Sample]%' and deleted_at is null limit 1`,
  );
  if (existing) return 'sample incident already present';

  const discovered = new Date(Date.now() - 20 * HOUR);
  const at = (hoursAfterDiscovery: number) => new Date(discovered.getTime() + hoursAfterDiscovery * HOUR);

  const incident: Row = await ctx.resources.create('security_incident', {
    title: '[Sample] Tabletop exercise: ransomware on the scheduling server',
    summary: 'Invented exercise data, not a real event. Scheduling staff found files renamed and a ransom note on the '
      + 'scheduling server. Booking records that include personal information are stored on that server.',
    severity: 'high',
    status: 'declared',
    scenario: 'ransomware',
    discovered_at: discovered.toISOString(),
    declared_at: at(1).toISOString(),
    affected_systems: 'Scheduling server (exercise stand-in); two shared workstations',
    affected_data: 'Booking records that include personal information (exercise assumption)',
    is_cyber_incident: true,
    personal_info_involved: true,
    ransom_payment_status: 'under_consideration',
  });

  const entries: [number, string, string][] = [
    [0, 'note', 'Exercise inject 1: staff report that schedule files will not open and a text file demanding payment is on the shared drive.'],
    [0.5, 'action', 'Scheduling server and two shared workstations disconnected from the network. Machines left powered on.'],
    [1, 'decision', 'Incident lead declares a security incident. Severity set to high because personal information is on the server.'],
    [2, 'communication', 'Bookings moved to the paper procedure. Operations supervisor informed by phone.'],
    [6, 'action', 'Backups for the scheduling server confirmed intact and isolated. Most recent verified copy is from the night before discovery.'],
  ];
  for (const [h, kind, text] of entries) await svc.addLog(incident.id, null, text, kind, at(h));

  // Check off the first three containment steps, as the exercise team would have by now.
  const steps = await ctx.db.query<{ id: string }>(
    `select id from incident_checklist_items where incident_id = $1 and phase = 'containment' and deleted_at is null order by sort limit 3`,
    [incident.id],
  );
  for (const [i, s] of steps.entries()) {
    await ctx.db.query(
      `update incident_checklist_items set done = true, done_by_name = 'Exercise team', done_at = $2, updated_at = now() where id = $1`,
      [s.id, at(0.5 + i).toISOString()],
    );
  }
  await ctx.audit(null, {
    action: 'security_incident.sample_seeded', recordType: 'security_incident', recordId: incident.id,
    summary: `Sample incident seeded with ${entries.length} log entries and ${steps.length} checklist steps checked off`,
  });
  return `sample incident ${incident.ref} created`;
}
