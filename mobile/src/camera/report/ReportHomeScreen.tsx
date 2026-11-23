// The Report tab (spec §5.3, E38-06): report a problem or a hazard or close call, and the reports
// saved on this phone: waiting for a connection, being sent, arrived (with the new record's
// reference), or needing attention (the server's reason; Send again or Discard on the Offline work
// screen). Reports go through the outbox (E38-10), so each arrives once.
import { useEffect } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../../api/client';
import { outbox, sendNow } from '../../offline';
import { Banner, Body, Button, Row, Screen, Section, Title } from '../../ui';
import { space } from '../../theme';
import { migrateLegacyQueue, useReports } from '../reportQueue';
import { REPORT_TEXT, type ReportView } from '../reports';

export const TEXT = {
  title: 'Report',
  problem: 'Report a problem', problemHint: 'A fault or something not working: a ticket for the service desk.',
  hazard: 'Report a hazard or close call', hazardHint: 'Something unsafe, or something that nearly went wrong: a safety report.',
  none: 'You cannot make reports from the app. Ask your administrator if you should.',
  offlineHint: 'You can report without signal: the report is saved on this phone and sent on its own once there is a connection.',
  onPhone: 'Saved on this phone',
  attention: (n: number) => `${n} ${n === 1 ? 'report needs' : 'reports need'} your attention`,
  open: 'Open offline work',
  offlineWork: 'Offline work and Needs attention',
  sendNow: 'Send now',
  dismiss: 'Dismiss',
};

export function stateText(r: ReportView): string {
  const photos = r.photos ? ` ${REPORT_TEXT.photos(r.photosSent, r.photos)}.` : '';
  switch (r.state) {
    case 'sending': return `${REPORT_TEXT.sending}${photos}`;
    case 'attention': return `${REPORT_TEXT.attention}: ${[r.error?.message, ...Object.values(r.error?.fields ?? {})].filter(Boolean).join(' ')}`;
    case 'done': return `${REPORT_TEXT.sent}${r.ref ? `: ${r.ref}` : ''}.${photos}${r.warning ? ` ${r.warning}` : ''}`;
    default: return `${r.ref ? `${REPORT_TEXT.sent}: ${r.ref}.${photos} ` : ''}${r.error?.message ?? REPORT_TEXT.waiting}`;
  }
}

export default function ReportHomeScreen() {
  const session = useSession();
  const reports = useReports();
  const canProblem = session.areaOn('tickets') && session.can('tickets.create');
  const canHazard = session.areaOn('safety') && session.can('safety.create');
  const attention = reports.filter((r) => r.state === 'attention').length;

  useEffect(() => { void migrateLegacyQueue().then((n) => { if (n) sendNow(); }, () => undefined); }, []);

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      {attention ? (
        <View style={{ gap: space[2] }}>
          <Banner kind="warning">{TEXT.attention(attention)}</Banner>
          <Button label={TEXT.open} kind="secondary" onPress={() => router.push('/report/offline')} />
        </View>
      ) : null}
      {canProblem ? (
        <View style={{ gap: space[1] }}>
          <Button label={TEXT.problem} onPress={() => router.push('/report/new?kind=problem')} />
          <Body muted>{TEXT.problemHint}</Body>
        </View>
      ) : null}
      {canHazard ? (
        <View style={{ gap: space[1] }}>
          <Button label={TEXT.hazard} kind="secondary" onPress={() => router.push('/report/new?kind=hazard')} />
          <Body muted>{TEXT.hazardHint}</Body>
        </View>
      ) : null}
      {!canProblem && !canHazard ? <Banner>{TEXT.none}</Banner> : <Body muted>{TEXT.offlineHint}</Body>}

      {reports.length ? (
        <Section title={TEXT.onPhone}>
          {reports.map((r, i) => (
            <View key={r.group}>
              <Row
                label={r.title}
                detail={stateText(r)}
                last={i === reports.length - 1 && r.state !== 'done'}
                onPress={r.state === 'attention' ? () => router.push('/report/offline') : undefined}
              />
              {r.state === 'done' ? (
                <View style={{ padding: space[2] }}>
                  <Button label={`${TEXT.dismiss} ${r.title}`} kind="secondary" onPress={() => void outbox().prune(r.group)} />
                </View>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}
      {reports.some((r) => r.state === 'waiting') ? <Button label={TEXT.sendNow} kind="secondary" onPress={sendNow} /> : null}
      <Button label={TEXT.offlineWork} kind="secondary" onPress={() => router.push('/report/offline')} />
    </Screen>
  );
}
