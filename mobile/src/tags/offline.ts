// Looking tags up without signal (wave 15; spec §5.5 step 7 and §5.6): when the server cannot be reached,
// the values read are looked up in the offline package's table of tag values (the records the package
// covers: my inspections' targets, condition assessments due, the open counts' records). A record found
// there opens a small card with what the phone may do offline (report a problem or hazard about it,
// record its condition); a value outside the package is "not available offline". Nothing is decided
// that the server would decide differently: the card holds only what the package says. Pure.
import { valueKey } from '../../../shared/tag-format.ts';
import type { LookupResult, TagAction, TagCard } from '../../../shared/asset-tags-api.ts';
import type { MobilePackage, PackageTag } from '../../../shared/mobile-api.ts';
import type { ReadingAnswer } from './lookup';
import type { Reading } from './read';

/** `matchedBy` of a result found in the offline package (the card says so). */
export const OFFLINE_MATCH = 'offline';

export const OFFLINE_TEXT = {
  found: 'Found in the offline package on this phone. More about it once there is a connection.',
  notAvailable: (v: string) => `${v} is not available offline: it is not in the offline package on this phone. Look it up again once there is a connection.`,
  several: (n: number, v: string) => `${n} records in the offline package match ${v}. Choose the right one.`,
  reportProblem: 'Report a problem', reportHazard: 'Report a hazard', recordCondition: 'Record condition',
};

const TYPE_LABELS: Record<string, string> = { asset: 'Asset', vehicle: 'Vehicle', site: 'Site', system: 'System' };

export interface OfflineAbilities { can(permission: string): boolean; areaOn(area: string): boolean }

/** What the phone may do with a record offline: work saved in the outbox, which the server checks on arrival. */
export function offlineActions(type: string, s: OfflineAbilities): TagAction[] {
  const a: TagAction[] = [];
  if (s.areaOn('tickets') && s.can('tickets.create')) a.push({ key: 'report_problem', label: OFFLINE_TEXT.reportProblem, webPath: null, prefill: null });
  if (s.areaOn('safety') && s.can('safety.create')) a.push({ key: 'report_hazard', label: OFFLINE_TEXT.reportHazard, webPath: null, prefill: null });
  if (['asset', 'vehicle', 'site'].includes(type) && s.areaOn('condition') && s.can('assets.create')) {
    a.push({ key: 'record_condition', label: OFFLINE_TEXT.recordCondition, webPath: null, prefill: null });
  }
  return a;
}

export function offlineCard(tag: PackageTag, values: PackageTag[], s: OfflineAbilities): TagCard {
  const all = values.filter((v) => v.recordType === tag.recordType && v.recordId === tag.recordId).map((v) => v.value);
  return {
    recordType: tag.recordType, typeLabel: TYPE_LABELS[tag.recordType] ?? tag.recordType, recordId: tag.recordId, route: '',
    title: tag.label, ref: null, tagValue: tag.value, tagValues: all.length ? all : [tag.value],
    status: null, photo: null, site: null, location: null, people: [], facts: [],
    activity: { openTickets: [], lastInspection: null, lastCondition: null, recentChanges: [] },
    holds: [], restricted: false, lastSeen: null, version: '', actions: offlineActions(tag.recordType, s),
  };
}

/** Answers readings from the package, as `interpret` would from the server: one record, a choice, or nothing. */
export function offlineAnswers(readings: Reading[], pkg: MobilePackage | null, s: OfflineAbilities): ReadingAnswer[] {
  const values = pkg?.tags?.values ?? [];
  return readings.map((reading) => {
    const keys = [reading.key, ...reading.variants.map((v) => valueKey(v))].filter(Boolean);
    const hits = new Map<string, PackageTag>();
    for (const k of keys) for (const t of values) if (t.valueKey === k && !hits.has(`${t.recordType}:${t.recordId}`)) hits.set(`${t.recordType}:${t.recordId}`, t);
    const base = { candidate: { value: reading.value, source: reading.how === 'text' ? 'text' as const : 'code' as const }, key: reading.key, replacedBy: null, matchedBy: OFFLINE_MATCH, formatId: null, actions: [] };
    const found = [...hits.values()];
    if (found.length === 1) {
      const result: LookupResult = { ...base, outcome: 'current', message: OFFLINE_TEXT.found, cards: [offlineCard(found[0], values, s)] };
      return { reading, status: 'record', result, choices: [], message: result.message };
    }
    if (found.length > 1) {
      const choices = found.map((t): LookupResult => ({ ...base, outcome: 'current', message: OFFLINE_TEXT.found, cards: [offlineCard(t, values, s)] }));
      return { reading, status: 'choose', result: null, choices, message: OFFLINE_TEXT.several(found.length, reading.value) };
    }
    const result: LookupResult = { ...base, outcome: 'nothing', message: OFFLINE_TEXT.notAvailable(reading.value), cards: [] };
    return { reading, status: 'nothing', result, choices: [], message: result.message };
  });
}
