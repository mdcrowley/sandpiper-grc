// The Tag tab (spec §5.3 and §5.5, E38-05): one camera screen that reads every code type and printed
// text at the same time, outlines each tag it reads with how it was read, looks the values up and
// opens the tag card, or lists the tags when there are several. Torch, a shutter for a still picture,
// a picture from the library, and keyboard entry. In "pick" mode (`?pick=<id>`, from Replace tag) it
// only reads a value and hands it back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useCameraPermission } from 'react-native-vision-camera';
import { useSession } from '../../api/client';
import { Banner, Body, Button, Field, Row, Screen, Section, Title } from '../../ui';
import { fontSize, radius, space, useTheme } from '../../theme';
import { TagCamera, type TagCameraHandle } from '../../camera/TagCamera';
import { discardPicture, readStill } from '../../camera/still';
import { toView, type Size } from '../../camera/geometry';
import { actsAlone, CODE_TYPE_LABELS, type FrameReads, type Reading } from '../read';
import { TagReader, type SeenReading } from '../reader';
import { lookUp, lookUpTyped, type ReadingAnswer } from '../lookup';
import { decide } from '../decide';
import { useTagSettings } from '../formats';
import * as handoff from '../handoff';

export const TEXT = {
  title: 'Tag',
  aim: 'Point the camera at a tag. Barcodes, 2D codes and printed numbers are all read.',
  aimPick: 'Point the camera at the new tag, or type its number.',
  off: 'Asset tags are not in use.',
  noCamera: 'The camera is not allowed for Sandpiper GRC.',
  allowCamera: 'Allow the camera',
  openSettings: 'Open settings',
  noDevice: 'This device has no camera the app can use. Type the tag number instead.',
  torchOn: 'Torch on', torchOff: 'Torch off',
  shutter: 'Take a picture', library: 'Choose a picture', keyboard: 'Type a number', clear: 'Clear',
  typedLabel: 'Tag number', find: 'Find', use: 'Use this number',
  reading: 'Reading the picture…', noneInPicture: 'No tag could be read in the picture. Try again closer, with the torch, or type the number.',
  looking: 'Looking up…', confirm: 'Is this the number on the tag?', confirmButton: 'Yes, find it',
  confirmHint: 'Read as printed text. Check it against the tag before finding it.',
  inView: 'Tags read', attach: 'Attach this tag', open: 'Open',
  notFoundTitle: 'Couldn\'t find this tag', correct: 'Correct it below, or read it again.',
  how: { code: 'Code', text: 'Text', both: 'Code and text' } as const,
  formatsUnavailable: 'Tag formats could not be loaded; codes are still read exactly, and text is offered for you to confirm.',
};

const LOOKUP_DELAY_MS = 350;

function howLabel(r: Reading): string {
  if (r.how === 'text') return TEXT.how.text;
  const type = r.codeType ? CODE_TYPE_LABELS[r.codeType] : 'Code';
  return r.how === 'both' ? `${type} and text` : type;
}

export default function TagScreen() {
  const { colors } = useTheme();
  const session = useSession();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const picking = Boolean(pick);
  const { settings, error: settingsError } = useTagSettings();
  const permission = useCameraPermission();
  const camera = useRef<TagCameraHandle>(null);
  const reader = useRef(new TagReader());
  const answersRef = useRef<Record<string, ReadingAnswer>>({});
  const asked = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picture = useRef<string | null>(null);
  const opening = useRef(false);

  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  const [frame, setFrame] = useState<Size>({ width: 0, height: 0 });
  const [inView, setInView] = useState<SeenReading[]>([]);
  const [all, setAll] = useState<SeenReading[]>([]);
  const [answers, setAnswers] = useState<Record<string, ReadingAnswer>>({});
  const [torch, setTorch] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { reader.current.setFormats(settings?.formats ?? []); }, [settings]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const reset = useCallback(() => {
    reader.current.reset();
    answersRef.current = {};
    asked.current.clear();
    setAnswers({}); setInView([]); setAll([]); setMessage(null);
    discardPicture(picture.current);
    picture.current = null;
    opening.current = false;
  }, []);

  // A fresh start each time the screen is shown (after a tag card, for example).
  useFocusEffect(useCallback(() => {
    setFocused(true);
    reset();
    return () => { setFocused(false); setTorch(false); if (timer.current) clearTimeout(timer.current); };
  }, [reset]));
  useEffect(() => () => discardPicture(picture.current), []);

  const openAnswer = useCallback((answer: ReadingAnswer, card = 0) => {
    if (opening.current) return;
    opening.current = true;
    const id = handoff.put({ kind: 'answer', answer: card ? { ...answer, result: answer.choices[card - 1] ?? answer.result } : answer, picture: picture.current });
    picture.current = null; // the card deletes it unless it is attached
    router.push(`/tag/card?answer=${id}`);
  }, []);

  const finishPick = useCallback((value: string) => {
    const item = handoff.get(pick, 'pick');
    if (item && pick) handoff.update(pick, { kind: 'pick', value });
    router.back();
  }, [pick]);

  const showOutcome = useCallback(() => {
    const list = Object.values(answersRef.current);
    const outcome = decide(list, reader.current.all());
    if (outcome.open) openAnswer(outcome.open);
  }, [openAnswer]);

  const runLookups = useCallback(async () => {
    const pending = reader.current.all().filter((r) => actsAlone(r) && !asked.current.has(r.key)).slice(0, 10);
    if (!pending.length) return;
    if (picking) { finishPick(pending[0].value); return; }
    pending.forEach((r) => asked.current.add(r.key));
    try {
      const got = await lookUp(pending);
      for (const a of got) answersRef.current[a.reading.key] = a;
      setAnswers({ ...answersRef.current });
      showOutcome();
    } catch (e) {
      pending.forEach((r) => asked.current.delete(r.key));
      setMessage((e as Error).message);
    }
  }, [picking, finishPick, showOutcome]);

  const take = useCallback((reads: FrameReads) => {
    const now = Date.now();
    const counted = reader.current.observe(reads, now);
    setFrame({ width: reads.width, height: reads.height });
    setInView(reader.current.inView(now));
    setAll(reader.current.all());
    if (counted.some((r) => actsAlone(r) && !asked.current.has(r.key))) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void runLookups(), reads.still ? 0 : LOOKUP_DELAY_MS);
    }
  }, [runLookups]);

  const readPicture = useCallback(async (path: string) => {
    discardPicture(picture.current);
    picture.current = path;
    setMessage(null);
    setBusy(TEXT.reading);
    try {
      const reads = await readStill(path);
      if (__DEV__) console.info('[tag-photo-reads]', path.split('/').pop(), JSON.stringify(reads)); // for the tag photo test set
      const before = reader.current.all().length;
      take(reads);
      if (reader.current.all().length === before && !reads.codes.length) setMessage(TEXT.noneInPicture);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [take]);

  const shutter = useCallback(async () => {
    if (!camera.current) return;
    try {
      const shot = await camera.current.takePicture();
      await readPicture(shot.path);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [readPicture]);

  const library = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (res.canceled || !res.assets.length) return;
    await readPicture(res.assets[0].uri);
  }, [readPicture]);

  // Development builds: a long press on "Choose a picture" reads every picture in the app's
  // documents folder `tag-photos` (put there by test/tag-photos/import-reads.mjs push-app) and logs the
  // reads by file name, for the tag photo test set.
  const readTestFolder = useCallback(async () => {
    if (!__DEV__) return;
    const dir = new Directory(Paths.document, 'tag-photos');
    if (!dir.exists) { setMessage('No tag-photos folder in the app documents.'); return; }
    setBusy(TEXT.reading);
    for (const f of dir.list()) {
      if (!(f instanceof File) || !/\.(png|jpe?g)$/i.test(f.name)) continue;
      try {
        console.info('[tag-photo-reads]', f.name, JSON.stringify(await readStill(f.uri)));
      } catch (e) {
        console.info('[tag-photo-reads]', f.name, JSON.stringify({ error: (e as Error).message }));
      }
    }
    console.info('[tag-photo-reads-done]');
    setBusy(null);
  }, []);

  const confirm = useCallback(async (r: Reading) => {
    if (picking) { finishPick(r.value); return; }
    setBusy(TEXT.looking);
    try {
      const [a] = await lookUp([{ ...r, trust: 'exact' }]);
      answersRef.current[r.key] = { ...a, reading: r };
      setAnswers({ ...answersRef.current });
      if (a.status === 'record') openAnswer({ ...a, reading: r });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [picking, finishPick, openAnswer]);

  const findTyped = useCallback(async () => {
    const v = typed.trim();
    if (!v) return;
    if (picking) { finishPick(v); return; }
    setBusy(TEXT.looking);
    try {
      const a = await lookUpTyped(v);
      answersRef.current[a.reading.key] = a;
      setAnswers({ ...answersRef.current });
      if (a.status === 'record') openAnswer(a);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [typed, picking, finishPick, openAnswer]);

  if (session.status === 'signed-in' && !session.areaOn('tags')) {
    return <Screen><Title>{TEXT.title}</Title><Body muted>{TEXT.off}</Body></Screen>;
  }

  const prefix = settings?.formats.find((f) => f.prefix)?.prefix ?? '';
  const digitsOnly = Boolean(settings?.formats.length) && settings!.formats.every((f) => f.characters === 'digits');
  const startTyping = () => { setTyping(true); setTyped((t) => t || prefix); };
  const typedAnswers = Object.values(answers).filter((a) => !all.some((r) => r.key === a.reading.key));
  const list: Reading[] = [...all, ...typedAnswers.map((a) => a.reading)];

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <View style={styles.fill} onLayout={(e: LayoutChangeEvent) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        {permission.hasPermission ? (
          <TagCamera ref={camera} style={StyleSheet.absoluteFill} active={focused && appActive && !busy} torch={torch} onReads={take} onError={(e) => setMessage(e.message)} />
        ) : (
          <View style={[styles.fill, styles.center, { backgroundColor: colors.bg, padding: space[4], gap: space[3] }]}>
            <Body>{TEXT.noCamera}</Body>
            {permission.canRequestPermission
              ? <Button label={TEXT.allowCamera} onPress={() => void permission.requestPermission()} />
              : <Button label={TEXT.openSettings} kind="secondary" onPress={() => void Linking.openSettings()} />}
          </View>
        )}
        {/* Outlines: each tag read, with how it was read (the list below says the same for screen readers). */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {inView.filter((r) => r.box).map((r) => {
            const b = toView(r.box!, frame, view);
            const color = actsAlone(r) ? colors.brand : colors.accent;
            return (
              <View key={r.key} style={[styles.outline, { left: b.x, top: b.y, width: b.width, height: b.height, borderColor: color }]}>
                <Text numberOfLines={1} style={[styles.outlineLabel, { backgroundColor: color, color: colors.brandContrast }]}>{`${howLabel(r)}: ${r.value}`}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.text, fontSize: fontSize.md }} accessibilityLiveRegion="polite">
          {busy ?? message ?? (picking ? TEXT.aimPick : TEXT.aim)}
        </Text>
        {settingsError ? <Banner kind="warning">{TEXT.formatsUnavailable}</Banner> : null}

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space[2] }} keyboardShouldPersistTaps="handled">
        {list.length ? (
          <Section title={TEXT.inView}>
            {list.map((r, i) => {
              const a = answers[r.key];
              const last = i === list.length - 1;
              if (!a && !actsAlone(r)) {
                return <Row key={r.key} label={r.value} detail={`${howLabel(r)}. ${TEXT.confirmHint}`} onPress={() => void confirm(r)} accessibilityHint={TEXT.confirm} right={<Text style={{ color: colors.link }}>{picking ? TEXT.use : TEXT.confirmButton}</Text>} last={last} />;
              }
              if (!a) return <Row key={r.key} label={r.value} detail={`${howLabel(r)}. ${TEXT.looking}`} last={last} />;
              if (a.status === 'record') {
                const c = a.result!.cards[0];
                return <Row key={r.key} label={`${c.typeLabel ?? ''} ${c.title ?? ''}`.trim()} detail={`${r.value} · ${howLabel(r)}${a.result!.outcome === 'replaced' ? ` · ${a.message}` : ''}`} onPress={() => openAnswer(a)} last={last} />;
              }
              if (a.status === 'choose') {
                return (
                  <View key={r.key}>
                    <Row label={r.value} detail={a.message} />
                    {a.choices.map((c, j) => <Row key={`${r.key}-${j}`} label={`${c.cards[0].typeLabel} ${c.cards[0].title}`} detail={c.candidate.value} onPress={() => openAnswer(a, j + 1)} last={last && j === a.choices.length - 1} />)}
                  </View>
                );
              }
              if (a.status === 'stock') {
                const can = a.result?.actions.some((x) => x.key === 'attach');
                return <Row key={r.key} label={r.value} detail={a.message} last={last}
                  onPress={can ? () => { const id = handoff.put({ kind: 'answer', answer: a, picture: null }); router.push(`/tag/attach?answer=${id}`); } : undefined}
                  right={can ? <Text style={{ color: colors.link }}>{TEXT.attach}</Text> : undefined} />;
              }
              return <Row key={r.key} label={r.value} detail={`${a.message} ${TEXT.correct}`} last={last} onPress={() => { setTyping(true); setTyped(r.value); }} />;
            })}
          </Section>
        ) : null}

        {typing ? (
          <View style={{ gap: space[2] }}>
            <Field label={TEXT.typedLabel} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} autoFocus
              keyboardType={digitsOnly && !prefix ? 'number-pad' : 'default'} returnKeyType="search" onSubmitEditing={() => void findTyped()} />
            <Button label={picking ? TEXT.use : TEXT.find} onPress={() => void findTyped()} busy={busy === TEXT.looking} />
          </View>
        ) : null}
        </ScrollView>

        <View style={styles.controls}>
          <Control label={torch ? TEXT.torchOn : TEXT.torchOff} selected={torch} onPress={() => setTorch((t) => !t)} disabled={!permission.hasPermission} />
          <Control label={TEXT.shutter} onPress={() => void shutter()} disabled={!permission.hasPermission || Boolean(busy)} primary />
          <Control label={TEXT.library} onPress={() => void library()} onLongPress={__DEV__ ? () => void readTestFolder() : undefined} disabled={Boolean(busy)} />
          <Control label={TEXT.keyboard} selected={typing} onPress={startTyping} />
          {list.length ? <Control label={TEXT.clear} onPress={reset} /> : null}
        </View>
      </View>
    </View>
  );
}

function Control({ label, onPress, onLongPress, selected, disabled, primary }: { label: string; onPress: () => void; onLongPress?: () => void; selected?: boolean; disabled?: boolean; primary?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [styles.control, {
        backgroundColor: primary ? colors.brand : selected ? colors.brandSoft : colors.surface2,
        borderColor: selected ? colors.brand : colors.borderControl, opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      }]}>
      <Text style={{ color: primary ? colors.brandContrast : colors.text, fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  outline: { position: 'absolute', borderWidth: 3, borderRadius: radius.sm },
  outlineLabel: { position: 'absolute', top: -24, left: -3, paddingHorizontal: space[1], fontSize: fontSize.xs, fontWeight: '700', borderRadius: radius.sm, overflow: 'hidden', maxWidth: 260 },
  panel: { padding: space[3], gap: space[2], maxHeight: '55%' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  control: { minHeight: 48, minWidth: 64, flexGrow: 1, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[2] },
});
