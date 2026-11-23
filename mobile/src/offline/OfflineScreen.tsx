// Offline work and Needs attention (wave 14, E38-10): /report/offline. What this phone keeps for
// working without signal (the offline package: when it was downloaded, until when it is kept), what
// is waiting to be sent, and what the server refused, with its reason and the person's choices: send
// again (after fixing what was wrong on the web, or once permission is back), send as new (when the
// server could not be sure whether it arrived), or discard. Nothing is ever dropped without that choice.
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Banner, Body, Button, Row, Screen, Section, Title } from '../ui';
import { space } from '../theme';
import { offlinePackage, outbox, sendNow, useOfflinePackage, useOutbox } from './index';
import { outboxKind } from './kinds';
import type { OutboxItem } from './types';

export const TEXT = {
  title: 'Offline work',
  intro: 'Work you save is kept on this phone and sent on its own, once, when there is a connection.',
  package: 'Offline package',
  noPackage: 'No offline package on this phone yet. It is downloaded on its own when there is a connection.',
  downloaded: 'Downloaded',
  keptUntil: 'Deleted from this phone',
  holds: 'Holds',
  holdsText: (sites: number, inspections: number, counts: number) =>
    `${sites} site${sites === 1 ? '' : 's'}, ${inspections} inspection${inspections === 1 ? '' : 's'}, ${counts} open inventory count${counts === 1 ? '' : 's'}, your work list`,
  download: 'Download now',
  downloadFailed: 'The offline package could not be downloaded. Check the connection and try again.',
  attention: 'Needs attention',
  attentionIntro: 'The server did not accept these. Its reason is shown with each. Fix what it says (on the web if needed), then send again, or discard.',
  waiting: 'Waiting to send',
  waitingFor: 'Waits for the item it belongs to.',
  noConnection: 'Waiting for a connection.',
  nothing: 'Nothing is waiting. Everything saved on this phone has been sent.',
  sendNow: 'Send now',
  sendAgain: 'Send again',
  sendAsNew: 'Send as new',
  discard: 'Discard',
  discardTitle: (label: string) => `Discard ${label}?`,
  discardBody: 'It is removed from this phone, with its photos, and never sent.',
  cancel: 'Cancel',
};

const when = (iso: string) => new Date(iso).toLocaleString();

/** The server cannot be sure about these: sending them again needs a new id (the person checked first). */
const needsNewId = (i: OutboxItem) => i.error?.code === 'uncertain' || i.error?.code === 'idempotency_key_reused';

export function reasonOf(i: OutboxItem): string {
  return [i.error?.message, ...Object.entries(i.error?.fields ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' ');
}

export default function OfflineScreen() {
  const items = useOutbox();
  const pkg = useOfflinePackage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOf = (i: OutboxItem) => {
    // A photo belongs to the report, inspection or assessment of its group.
    const first = items.find((x) => x.group === i.group && x.kind !== 'attachment');
    const noun = outboxKind(i.kind)?.noun ?? i.kind;
    return first && first !== i ? `${i.label} of ${first.label}` : `${noun}: ${i.label}`;
  };
  const rejected = items.filter((i) => i.state === 'rejected');
  const waiting = items.filter((i) => i.state === 'pending' || i.state === 'sending');
  const done = new Set(items.filter((i) => i.state === 'done').map((i) => i.id));

  const download = async () => {
    setBusy(true); setError(null);
    try { await offlinePackage().refresh(); } catch { setError(TEXT.downloadFailed); } finally { setBusy(false); }
  };
  const discard = (i: OutboxItem) => Alert.alert(TEXT.discardTitle(titleOf(i)), TEXT.discardBody, [
    { text: TEXT.cancel, style: 'cancel' },
    { text: TEXT.discard, style: 'destructive', onPress: () => void outbox().discard(i.group) },
  ]);
  const again = async (i: OutboxItem) => { await outbox().retry(i.id, { asNew: needsNewId(i) }); sendNow(); };

  const inspections = Array.isArray(pkg?.parts.inspections) ? (pkg!.parts.inspections as unknown[]).length : 0;
  const counts = Array.isArray(pkg?.parts.counts) ? (pkg!.parts.counts as unknown[]).length : 0;

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      <Body muted>{TEXT.intro}</Body>

      {rejected.length ? (
        <Section title={TEXT.attention}>
          <View style={{ padding: space[2] }}><Body muted>{TEXT.attentionIntro}</Body></View>
          {rejected.map((i) => (
            <View key={i.id}>
              <Row label={titleOf(i)} detail={reasonOf(i)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], padding: space[2] }}>
                <View style={{ flexGrow: 1 }}><Button label={needsNewId(i) ? TEXT.sendAsNew : TEXT.sendAgain} accessibilityLabel={`${needsNewId(i) ? TEXT.sendAsNew : TEXT.sendAgain}: ${titleOf(i)}`} onPress={() => void again(i)} /></View>
                <View style={{ flexGrow: 1 }}><Button label={TEXT.discard} accessibilityLabel={`${TEXT.discard}: ${titleOf(i)}`} kind="secondary" onPress={() => discard(i)} /></View>
              </View>
            </View>
          ))}
        </Section>
      ) : null}

      {waiting.length ? (
        <Section title={TEXT.waiting}>
          {waiting.map((i, n) => (
            <Row key={i.id} label={titleOf(i)} last={n === waiting.length - 1}
              detail={i.dependsOn && !done.has(i.dependsOn) ? TEXT.waitingFor : i.error?.message ?? TEXT.noConnection} />
          ))}
        </Section>
      ) : null}
      {waiting.length ? <Button label={TEXT.sendNow} kind="secondary" onPress={sendNow} /> : null}
      {!rejected.length && !waiting.length ? <Banner>{TEXT.nothing}</Banner> : null}

      <Section title={TEXT.package}>
        {pkg ? (
          <>
            <Row label={TEXT.downloaded} value={when(pkg.generatedAt)} />
            <Row label={TEXT.keptUntil} value={when(pkg.expiresAt)} />
            <Row label={TEXT.holds} detail={TEXT.holdsText(pkg.sites.length, inspections, counts)} last />
          </>
        ) : <Row label={TEXT.noPackage} last />}
      </Section>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button label={TEXT.download} kind="secondary" busy={busy} onPress={() => void download()} />
    </Screen>
  );
}
