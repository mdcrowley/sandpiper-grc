// The Report tab (spec §5.3, E38-06): report a problem or a hazard or close call, and what is still
// being sent from this phone (with Send again or Discard when the app cannot finish on its own).
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../../api/client';
import { Banner, Body, Button, Row, Screen, Section, Title } from '../../ui';
import { space } from '../../theme';
import { useReportQueue, reportQueue } from '../reportQueue';
import { REPORT_TEXT, type QueuedReport } from '../reports';

export const TEXT = {
  title: 'Report',
  problem: 'Report a problem', problemHint: 'A fault or something not working: a ticket for the service desk.',
  hazard: 'Report a hazard or close call', hazardHint: 'Something unsafe, or something that nearly went wrong: a safety report.',
  none: 'You cannot make reports from the app. Ask your administrator if you should.',
  sending: 'Sending from this phone', sent: 'Sent', sendingNow: 'Sending…', refused: 'Not accepted', uncertain: 'Not sure it arrived',
  photosLeft: (n: number) => `${n} photo${n === 1 ? '' : 's'} still to send`,
  photosRefused: (n: number) => `${n} photo${n === 1 ? ' was' : 's were'} not accepted`,
  sendAgain: 'Send again', discard: 'Discard', dismiss: 'Dismiss',
};

function stateText(r: QueuedReport): string {
  const left = r.photos.filter((p) => p.state === 'pending').length;
  const refused = r.photos.filter((p) => p.state === 'refused').length;
  const ref = r.created?.ref ? `${r.created.ref}. ` : '';
  switch (r.state) {
    case 'sending': return TEXT.sendingNow;
    case 'uncertain': return `${TEXT.uncertain}. ${REPORT_TEXT.uncertain}`;
    case 'refused': return `${TEXT.refused}: ${[r.error, ...Object.values(r.fields)].filter(Boolean).join(' ')}`;
    case 'done': return `${TEXT.sent}. ${ref}${refused ? TEXT.photosRefused(refused) : ''}`;
    default: return r.created ? `${ref}${TEXT.photosLeft(left)}. ${REPORT_TEXT.photoRetry}` : r.error ?? REPORT_TEXT.waiting;
  }
}

export default function ReportHomeScreen() {
  const session = useSession();
  const reports = useReportQueue();
  const canProblem = session.areaOn('tickets') && session.can('tickets.create');
  const canHazard = session.areaOn('safety') && session.can('safety.create');
  const q = reportQueue();

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
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
      {!canProblem && !canHazard ? <Banner>{TEXT.none}</Banner> : null}

      {reports.length ? (
        <Section title={TEXT.sending}>
          {reports.map((r, i) => (
            <View key={r.id}>
              <Row label={r.title} detail={stateText(r)} last={i === reports.length - 1 && r.state !== 'uncertain' && r.state !== 'refused' && r.state !== 'done'} />
              {r.state === 'uncertain' ? (
                <View style={{ flexDirection: 'row', gap: space[2], padding: space[2] }}>
                  <View style={{ flex: 1 }}><Button label={TEXT.sendAgain} onPress={() => void q.sendAgain(r.id)} /></View>
                  <View style={{ flex: 1 }}><Button label={TEXT.discard} kind="secondary" onPress={() => void q.forget(r.id)} /></View>
                </View>
              ) : null}
              {r.state === 'refused' || r.state === 'done' ? (
                <View style={{ padding: space[2] }}>
                  <Button label={r.state === 'done' ? TEXT.dismiss : TEXT.discard} kind="secondary" onPress={() => void q.forget(r.id)} />
                </View>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
