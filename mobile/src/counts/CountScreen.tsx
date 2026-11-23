// Counting mode (wave 15, E38-12; spec §4.5 step 2 and §5.5): the camera stays open and every tag it
// reads in view is counted, without signal if need be. Each value is worked out against the offline
// package at once (found, unexpected, not covered, or to be checked when sent), with a vibration, and
// saved in the outbox as one find that is sent once; the server's answer replaces the phone's guess as
// it arrives. Several people may count the same place: their finds merge on the server. Text that needs
// the person's confirmation is listed with "Count it"; numbers can be typed too.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useCameraPermission } from 'react-native-vision-camera';
import type { PackageCount } from '../../../shared/mobile-api.ts';
import { useSession } from '../api/client';
import { TagCamera } from '../camera/TagCamera';
import { drafts, outbox, sendNow, useOfflinePackage, useOutbox } from '../offline';
import { actsAlone, type FrameReads, type Reading } from '../tags/read';
import { TagReader } from '../tags/reader';
import { fontSize, space, useTheme } from '../theme';
import { Banner, Body, Button, Field, Row, Section, useAnnounce } from '../ui';
import { findItem, newFind, OUTCOME_TEXT, progress, sessionKey, type CountSession, type FindKind, type LocalFind } from './match';

export const TEXT = {
  notInPackage: 'This count is not on this phone. Connect and download the offline package (Offline work).',
  notAllowed: 'You cannot count. Ask your administrator if you should.',
  aim: 'Point the camera along the shelf: every tag read is counted.',
  progress: (found: number, expected: number) => `${found} of ${expected} found`,
  camera: 'Camera', pause: 'Pause the camera', resume: 'Resume the camera',
  noDevice: 'This device has no camera the app can use. Type the tag numbers instead.',
  noCamera: 'The camera is not allowed for Sandpiper GRC.', allowCamera: 'Allow the camera', openSettings: 'Open settings',
  typed: 'Tag number', count: 'Count it', confirm: 'Read as printed text. Check it against the tag, then count it.',
  counted: 'Counted on this phone', nothingYet: 'Nothing counted on this phone yet.',
  kind: {
    found: 'Found', found_before: 'Found (already found by someone)', unexpected: 'Unexpected: registered somewhere else',
    not_covered: 'Not covered by this count (not sent)', unknown: 'Not in the offline package: checked when sent',
  } as Record<FindKind, string>,
  waiting: 'waiting to send', sent: 'sent', refused: 'not accepted: see Offline work',
  truncated: 'This count is large: only part of what it expects is on this phone. Finds are still checked when sent.',
  again: (v: string) => `${v} was already counted.`,
};

export default function CountScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const session = useSession();
  const pkg = useOfflinePackage();
  const items = useOutbox();
  const permission = useCameraPermission();
  const count = useMemo(() => ((pkg?.parts.counts ?? []) as PackageCount[]).find((c) => c.id === id) ?? null, [pkg, id]);
  const reader = useRef(new TagReader());
  const sessionRef = useRef<CountSession | null>(null);
  const [state, setState] = useState<CountSession | null>(null);
  const [confirm, setConfirm] = useState<Reading[]>([]);
  const [typed, setTyped] = useState('');
  // While a number is typed the camera folds away, so the keyboard never hides the box.
  const [typing, setTyping] = useState(false);
  const [running, setRunning] = useState(true);
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { reader.current.setFormats(pkg?.tags?.formats.filter((f) => f.active) ?? []); }, [pkg]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));

  // Joining: the finds made on this phone so far (kept until the count is over or the person signs out).
  useEffect(() => {
    let live = true;
    void drafts().get<CountSession>(sessionKey(id)).then(async (s) => {
      const joined = s ?? { countId: id, joinedAt: new Date().toISOString(), finds: [] };
      if (!s) await drafts().set(sessionKey(id), joined);
      if (live) { sessionRef.current = joined; setState(joined); }
    }, () => undefined);
    return () => { live = false; };
  }, [id]);

  const add = useCallback(async (value: string, source: LocalFind['source']) => {
    const s = sessionRef.current;
    if (!s || !count) return;
    const find = newFind(s, count, pkg?.tags?.values, value, source, Crypto.randomUUID());
    if (!find) { if (source === 'typed') setMessage(TEXT.again(value)); return; }
    const next = { ...s, finds: [find, ...s.finds] };
    sessionRef.current = next;
    setState(next);
    setMessage(`${TEXT.kind[find.kind]}: ${find.label ?? find.value}`);
    void Haptics.notificationAsync(find.kind === 'found' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    await drafts().set(sessionKey(id), next);
    if (find.kind !== 'not_covered') {
      await outbox().add([findItem(id, find)]);
      sendNow();
    }
  }, [count, pkg, id]);

  const take = useCallback((reads: FrameReads) => {
    const counted = reader.current.observe(reads, Date.now());
    for (const r of counted) {
      if (actsAlone(r)) void add(r.value, r.how === 'text' ? 'text' : 'code');
      else setConfirm((c) => (c.some((x) => x.key === r.key) || sessionRef.current?.finds.some((f) => f.key === r.key) ? c : [...c, r]));
    }
  }, [add]);

  // Each find is in a live region on Android; on iPhone it is said when it changes.
  useAnnounce(message, { iosOnly: true });

  const allowed = session.areaOn('tags') && session.can('tags.count');
  if (!allowed) return <View style={[styles.fill, { padding: space[4], backgroundColor: colors.bg }]}><Banner>{TEXT.notAllowed}</Banner></View>;
  if (!count) return <View style={[styles.fill, { padding: space[4], backgroundColor: colors.bg }]}><Banner kind="warning">{TEXT.notInPackage}</Banner></View>;

  const p = progress(count, state);
  const byId = new Map(items.filter((i) => i.kind === 'count.found').map((i) => [i.id, i]));
  const statusOf = (f: LocalFind) => {
    if (f.kind === 'not_covered') return TEXT.kind.not_covered;
    const o = byId.get(f.clientId);
    if (o?.state === 'done' && o.result?.outcome) return `${OUTCOME_TEXT[o.result.outcome] ?? o.result.outcome} (${TEXT.sent})`;
    if (o?.state === 'rejected') return `${TEXT.kind[f.kind]} (${TEXT.refused})`;
    return `${TEXT.kind[f.kind]} (${o?.state === 'done' ? TEXT.sent : TEXT.waiting})`;
  };

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <View style={{ height: typing ? 0 : '38%' }}>
        {permission.hasPermission ? (
          <TagCamera style={StyleSheet.absoluteFill} active={running && focused && appActive && !typing} torch={false} onReads={take} onError={(e) => setMessage(e.message)}
            noDevice={<View style={[styles.fill, { backgroundColor: colors.bg, padding: space[4], justifyContent: 'center' }]}><Body>{TEXT.noDevice}</Body></View>} />
        ) : (
          <View style={[styles.fill, { backgroundColor: colors.bg, padding: space[4], gap: space[3], justifyContent: 'center' }]}>
            <Body>{TEXT.noCamera}</Body>
            {permission.canRequestPermission
              ? <Button label={TEXT.allowCamera} onPress={() => void permission.requestPermission()} />
              : <Button label={TEXT.openSettings} kind="secondary" onPress={() => void Linking.openSettings()} />}
          </View>
        )}
      </View>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space[3], gap: space[3] }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space[1] }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: '700' }}>{count.title}</Text>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: fontSize.lg }}>{TEXT.progress(p.found, p.expected)}</Text>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.md }} accessibilityLiveRegion="polite">{message ?? TEXT.aim}</Text>
        </View>
        {count.truncated ? <Banner kind="warning">{TEXT.truncated}</Banner> : null}
        {permission.hasPermission && !typing ? <Button label={running ? TEXT.pause : TEXT.resume} kind="secondary" onPress={() => setRunning((r) => !r)} /> : null}
        {confirm.length ? (
          <Section>
            {confirm.map((r, n) => (
              <Row key={r.key} label={r.value} detail={TEXT.confirm} last={n === confirm.length - 1} right={<Text style={{ color: colors.link }}>{TEXT.count}</Text>}
                onPress={() => { setConfirm((c) => c.filter((x) => x.key !== r.key)); void add(r.value, 'text'); }} />
            ))}
          </Section>
        ) : null}
        <View style={{ gap: space[2] }}>
          <Field label={TEXT.typed} value={typed} onChangeText={setTyped} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} autoCapitalize="characters" autoCorrect={false} returnKeyType="done"
            onSubmitEditing={() => { if (typed.trim()) { void add(typed.trim(), 'typed'); setTyped(''); } }} />
          <Button label={TEXT.count} kind="secondary" disabled={!typed.trim()} onPress={() => { void add(typed.trim(), 'typed'); setTyped(''); }} />
        </View>
        <Section title={TEXT.counted}>
          {state?.finds.length ? state.finds.map((f, n) => (
            <Row key={f.clientId} label={f.label ?? f.value} detail={`${f.value} · ${statusOf(f)}`} last={n === state.finds.length - 1} />
          )) : <Row label={TEXT.nothingYet} last />}
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
