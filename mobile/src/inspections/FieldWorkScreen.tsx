// Field work (wave 15, E38-11 and E38-12): /fieldwork. The work that can be done without signal, from the
// offline package: my inspections (with their checklists), condition assessments due, and the open
// inventory counts I may join. Each opens its own screen; what is done there is kept on the phone and
// sent once when there is a connection (Offline work shows what waits and what needs attention).
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import type { PackageCondition, PackageCount, PackageInspection } from '../../../shared/mobile-api.ts';
import { useSession } from '../api/client';
import { drafts, offlinePackage, useOfflinePackage } from '../offline';
import { Banner, Body, Button, Row, Screen, Section, Title } from '../ui';

export const TEXT = {
  title: 'Field work',
  intro: 'Inspections, condition assessments and inventory counts work without signal: they are saved on this phone and sent on their own.',
  noPackage: 'Nothing for working offline is on this phone yet. Connect, then download it.',
  inspections: 'My inspections', noInspections: 'No inspections due for you.',
  condition: 'Condition assessments due', noCondition: 'No condition assessments due.',
  counts: 'Open inventory counts', noCounts: 'No open counts you can join.',
  started: 'started on this phone', joined: 'joined on this phone',
  due: (d: string | null) => (d ? `due ${d}` : 'no due date'),
  overdue: 'overdue',
  download: 'Download now', downloadFailed: 'Could not download. Check the connection and try again.',
  offline: 'Offline work and Needs attention',
  counted: (found: number, expected: number) => `${found} of ${expected} found`,
};

export default function FieldWorkScreen() {
  const session = useSession();
  const pkg = useOfflinePackage();
  const [started, setStarted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([drafts().keys('inspection:'), drafts().keys('count:')])
      .then(([a, b]) => { if (live) setStarted(new Set([...a, ...b])); }, () => undefined);
    return () => { live = false; };
  }, [pkg]);
  // A fresh package when there is a connection (a failure keeps the one on the phone).
  useEffect(() => { void offlinePackage().refresh().catch(() => undefined); }, []);

  const download = async () => {
    setBusy(true); setError(null);
    try { await offlinePackage().refresh(); } catch { setError(TEXT.downloadFailed); } finally { setBusy(false); }
  };

  const inspections = (pkg?.parts.inspections ?? []) as PackageInspection[];
  const condition = (pkg?.parts.condition ?? null) as PackageCondition | null;
  const counts = (pkg?.parts.counts ?? []) as PackageCount[];
  const showInspections = session.areaOn('audits') && session.can('audits.view');
  const showCondition = session.areaOn('condition') && session.can('assets.create');
  const showCounts = session.areaOn('tags') && session.can('tags.count');

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      <Body muted>{TEXT.intro}</Body>
      {!pkg ? <Banner kind="warning">{TEXT.noPackage}</Banner> : null}

      {showInspections ? (
        <Section title={TEXT.inspections}>
          {inspections.length ? inspections.map((i, n) => (
            <Row key={i.id} label={[i.ref, i.title].filter(Boolean).join(' ')} last={n === inspections.length - 1}
              detail={[i.status, TEXT.due(i.dueOn), started.has(`inspection:${i.id}`) ? TEXT.started : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/fieldwork/inspection/${encodeURIComponent(i.id)}`)} />
          )) : <Row label={TEXT.noInspections} last />}
        </Section>
      ) : null}

      {showCondition ? (
        <Section title={TEXT.condition}>
          {condition?.due.length ? condition.due.map((d, n) => (
            <Row key={`${d.type}:${d.id}`} label={d.label} last={n === condition.due.length - 1}
              detail={[TEXT.due(d.dueOn), d.overdue ? TEXT.overdue : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/fieldwork/condition?${new URLSearchParams({ type: d.type, id: d.id, label: d.label }).toString()}`)} />
          )) : <Row label={TEXT.noCondition} last />}
        </Section>
      ) : null}

      {showCounts ? (
        <Section title={TEXT.counts}>
          {counts.length ? counts.map((c, n) => (
            <Row key={c.id} label={[c.ref, c.title].filter(Boolean).join(' ')} last={n === counts.length - 1}
              detail={[c.site?.label, c.area, TEXT.counted(c.totals.found, c.totals.expected), started.has(`count:${c.id}`) ? TEXT.joined : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/fieldwork/count/${encodeURIComponent(c.id)}`)} />
          )) : <Row label={TEXT.noCounts} last />}
        </Section>
      ) : null}

      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button label={TEXT.download} kind="secondary" busy={busy} onPress={() => void download()} />
      <Button label={TEXT.offline} kind="secondary" onPress={() => router.push('/report/offline')} />
    </Screen>
  );
}
