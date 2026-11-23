// Running an inspection on the phone, with or without signal (wave 15, E38-11; the web runner is E24-06):
// one item at a time with large Pass, Fail and Not applicable buttons, a note and photos per item, then
// completion with the signer's name and an optional drawn signature. Everything is kept on the phone as
// a draft until it is completed (or the answers are sent), then saved in the outbox and sent once. The
// rules are the server's own (shared/inspection-rules.ts): every item answered, a photo where one is
// needed unless not applicable, the result and score worked out the same way. The server checks again
// when it arrives; a canceled inspection or a lost permission goes to Needs attention with its reason.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { PackageInspection } from '../../../shared/mobile-api.ts';
import { useSession } from '../api/client';
import { drafts, outbox, sendNow, useOfflinePackage, useOutbox } from '../offline';
import { fontSize, radius, space, useTheme } from '../theme';
import { Banner, Body, Button, Field, Row, Screen, Section, SwitchRow, Title, useFocusOn, type TextRef } from '../ui';
import { takeDraftPhoto } from './common';
import {
  afterSent, currentAnswer, draftKey, emptyDraft, hasUnsent, inspectionItems, preview, RESULT_TEXT, runItems, signatureName, withAnswer,
  type Answer, type InspectionDraft,
} from './draft';
import { SignaturePad } from './SignaturePad';
import { hasInk, signaturePng, type Stroke } from './signature';

export const TEXT = {
  notInPackage: 'This inspection is not on this phone. Connect and download the offline package (Offline work), or open it on the web.',
  noChecklist: 'This inspection\'s checklist is not on this phone. Connect and download the offline package again.',
  readOnly: 'You may look at this checklist but not answer it.',
  empty: 'This checklist has no items yet.',
  progress: (n: number, of: number) => `${n} of ${of} answered`,
  item: (n: number, of: number, section: string | null) => `Item ${n} of ${of}${section ? ` · ${section}` : ''}`,
  critical: 'Critical', photoNeeded: 'Photo needed', removed: 'No longer on the checklist',
  answers: { yes: 'Pass', no: 'Fail', na: 'Not applicable' } as Record<Answer, string>,
  noteLabel: 'Note (optional)', noteFailed: 'What was found',
  takePhoto: 'Take a photo', choosePhoto: 'Choose a photo',
  photos: (n: number) => `${n} photo${n === 1 ? '' : 's'}`,
  photoNeededHint: 'A photo is needed unless not applicable.',
  previous: 'Previous', next: 'Next', nextOpen: 'Next unanswered',
  toComplete: 'Complete the inspection',
  sendSoFar: 'Send the answers so far',
  sentSoFar: 'The answers are saved on this phone and sent on their own. You can go on later.',
  completeTitle: 'Complete the inspection',
  willGive: 'From the answers, the result will be',
  score: (s: number | null) => (s === null ? '' : ` (score ${s}%)`),
  notMet: (n: number) => `${n} item${n === 1 ? '' : 's'} not met`,
  raise: 'Raise a finding for each item not met',
  notes: 'Notes on the inspection (optional)',
  signedBy: 'Signed by (your name)',
  signedByNeeded: 'Type your name to sign.',
  completeSend: 'Complete and send',
  back: 'Back to the items',
  saved: 'Completed on this phone',
  savedBody: 'It is saved on this phone and sent on its own, once, when there is a connection. The server works out the result again when it arrives.',
  waiting: 'Waiting to send.',
  arrived: 'Arrived on the server.',
  attention: 'The server did not accept it. See Offline work.',
  openOffline: 'Open Offline work',
  done: 'Back to field work',
  failed: 'Could not save: ',
};

type Mode = 'items' | 'complete' | 'saved';

export default function RunScreen({ id }: { id: string }) {
  const { colors } = useTheme();
  const session = useSession();
  const pkg = useOfflinePackage();
  const items = useOutbox();
  const ins = useMemo(() => ((pkg?.parts.inspections ?? []) as PackageInspection[]).find((i) => i.id === id) ?? null, [pkg, id]);
  const [draft, setDraft] = useState<InspectionDraft | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('items');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [raise, setRaise] = useState(true);
  const [notes, setNotes] = useState('');
  const [signer, setSigner] = useState(session.session?.user.displayName ?? '');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const pad = useRef({ width: 0, height: 0 });
  const [sentId, setSentId] = useState<string | null>(null);
  // The screen reader's focus follows the screen: to the item's question when another item is shown
  // (after an answer moves on, or Previous and Next), and to the title when completing or completed.
  const itemRef = useFocusOn<TextRef>(`${mode}:${index}`, { initial: false });
  const titleRef = useFocusOn<TextRef>(mode, { initial: false });

  // The draft kept on the phone (answers given before the app was closed).
  useEffect(() => {
    let live = true;
    void drafts().get<InspectionDraft>(draftKey(id)).then((d) => { if (live) setDraft(d ?? emptyDraft(id)); }, () => { if (live) setDraft(emptyDraft(id)); });
    return () => { live = false; };
  }, [id]);

  const save = useCallback((next: InspectionDraft) => {
    setDraft(next);
    void drafts().set(draftKey(id), next).catch((e: Error) => setError(`${TEXT.failed}${e.message}`));
  }, [id]);

  const list = useMemo(() => (ins && draft ? runItems(ins, draft) : []), [ins, draft]);
  useEffect(() => {
    if (index !== null || !ins || !draft || !list.length) return;
    const first = list.findIndex((i) => !currentAnswer(ins, draft, i.id).answer);
    setIndex(first < 0 ? 0 : first);
  }, [index, ins, draft, list]);

  if (mode === 'saved') {
    const main = items.find((i) => i.id === sentId);
    const state = main?.state === 'done' ? TEXT.arrived : main?.state === 'rejected' ? TEXT.attention : TEXT.waiting;
    return (
      <Screen key="saved">
        <Title ref={titleRef}>{TEXT.saved}</Title>
        <Body>{TEXT.savedBody}</Body>
        <Banner announce kind={main?.state === 'rejected' ? 'error' : 'info'}>{main?.result?.message ? `${state} ${main.result.message}` : main?.error && main.state === 'rejected' ? `${state} ${main.error.message}` : state}</Banner>
        {main?.state === 'rejected' ? <Button label={TEXT.openOffline} kind="secondary" onPress={() => router.push('/report/offline')} /> : null}
        <Button label={TEXT.done} onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!ins) return <Screen><Banner kind="warning">{TEXT.notInPackage}</Banner></Screen>;
  if (!ins.checklist) return <Screen><Title>{ins.title}</Title><Banner kind="warning">{TEXT.noChecklist}</Banner></Screen>;
  if (!draft || (list.length && index === null)) return <Screen><Body muted>…</Body></Screen>;
  if (!list.length) return <Screen><Title>{ins.title}</Title><Banner>{TEXT.empty}</Banner></Screen>;

  const canAnswer = ins.checklist.canAnswer;
  const answered = list.filter((i) => currentAnswer(ins, draft, i.id).answer).length;
  const pos = Math.max(0, Math.min(list.length - 1, index ?? 0));
  const item = list[pos];
  const now = currentAnswer(ins, draft, item.id);
  const mine = draft.answers[item.id];
  const nextOpen = (() => {
    for (let k = 1; k <= list.length; k++) {
      const n = (pos + k) % list.length;
      if (!currentAnswer(ins, draft, list[n].id).answer) return n;
    }
    return -1;
  })();
  const check = preview(ins, draft);

  const answer = (a: Answer) => {
    save(withAnswer(draft, item.id, { answer: a }));
    // A failed item usually needs a note or a photo: stay on it. Otherwise go on.
    const needsPhoto = item.photo_required && a !== 'na' && !now.photos;
    if (a !== 'no' && !needsPhoto && pos < list.length - 1) setIndex(pos + 1);
  };
  const addPhoto = async (from: 'camera' | 'library') => {
    setBusy(from); setError(null);
    try {
      const kept = await takeDraftPhoto(`inspection-${id}`, Object.values(draft.answers).reduce((n, a) => n + a.photos.length, 0) + 1, from);
      if (kept) save(withAnswer(draft, item.id, { answer: mine?.answer ?? now.answer, photos: [...(mine?.photos ?? []), kept] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async (complete: boolean) => {
    setBusy(complete ? 'complete' : 'answers'); setError(null);
    try {
      let file: { uri: string; name: string } | null = null;
      if (complete && hasInk(strokes)) {
        const name = signatureName(new Date());
        file = { uri: await drafts().writeFile(`inspection-${id}`, name, signaturePng(strokes, pad.current)), name };
      }
      const toSave = inspectionItems(ins, draft, {
        complete, raiseFindings: raise, notes, signature: complete ? { name: signer, file } : null, newId: () => Crypto.randomUUID(),
      });
      const saved = await outbox().add(toSave);
      // The outbox keeps its own copies of the files: the draft's folder goes.
      await drafts().dropFolder(`inspection-${id}`);
      sendNow();
      if (complete) {
        await drafts().remove(draftKey(id));
        setSentId(saved[saved.length - 1]?.id ?? null);
        setMode('saved');
      } else {
        save(afterSent(draft));
        setMessage(TEXT.sentSoFar);
      }
    } catch (e) {
      setError(`${TEXT.failed}${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (mode === 'complete') {
    // Its own key, so each part of the runner opens at its top, not where the last one was scrolled.
    return (
      <Screen key="complete">
        <Title ref={titleRef}>{TEXT.completeTitle}</Title>
        <Body muted>{[ins.ref, ins.title].filter(Boolean).join(' · ')}</Body>
        {check.problem ? <Banner kind="warning">{check.problem.message}</Banner> : (
          <Banner>{`${TEXT.willGive} ${RESULT_TEXT[check.result] ?? check.result}${TEXT.score(check.scorePct)}${check.failed.length ? `, ${TEXT.notMet(check.failed.length)}` : ''}.`}</Banner>
        )}
        <Section><SwitchRow label={TEXT.raise} value={raise} onChange={setRaise} last /></Section>
        <Field label={TEXT.notes} value={notes} onChangeText={setNotes} multiline />
        <Field label={TEXT.signedBy} value={signer} onChangeText={setSigner} autoCapitalize="words" error={signer.trim() ? null : TEXT.signedByNeeded} />
        <SignaturePad strokes={strokes} onChange={setStrokes} onSize={(s) => { pad.current = s; }} />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button label={TEXT.completeSend} busy={busy === 'complete'} disabled={Boolean(check.problem) || !signer.trim()} onPress={() => void send(true)} />
        <Button label={TEXT.back} kind="secondary" onPress={() => setMode('items')} />
      </Screen>
    );
  }

  return (
    <Screen key="items">
      <View style={{ gap: space[1] }}>
        <Body muted>{[ins.ref, ins.target?.label].filter(Boolean).join(' · ')}</Body>
        <Title>{ins.title}</Title>
        <Body muted>{TEXT.progress(answered, list.length)}</Body>
      </View>
      {!canAnswer ? <Banner kind="warning">{TEXT.readOnly}</Banner> : null}
      {message ? <Banner>{message}</Banner> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Section>
        <View style={{ padding: space[4], gap: space[3] }}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{TEXT.item(pos + 1, list.length, item.section)}</Text>
          <Text ref={itemRef} accessibilityRole="header" style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: '700' }}>{item.prompt}</Text>
          {item.critical || item.photo_required || item.removed ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
              {[item.critical ? TEXT.critical : null, item.photo_required ? TEXT.photoNeeded : null, item.removed ? TEXT.removed : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          {item.guidance ? <Body muted>{item.guidance}</Body> : null}
          <View accessibilityRole="radiogroup" accessibilityLabel={item.prompt} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {(['yes', 'no', 'na'] as const).map((a) => {
              const chosen = now.answer === a;
              const tint = a === 'yes' ? colors.chips.green : a === 'no' ? colors.chips.red : { bg: colors.surface2, fg: colors.text };
              return (
                <Pressable key={a} testID={`answer-${a}`} accessibilityRole="radio" accessibilityLabel={TEXT.answers[a]} accessibilityState={{ checked: chosen, disabled: !canAnswer }}
                  disabled={!canAnswer} onPress={() => answer(a)}
                  style={({ pressed }) => ({
                    // Each as wide as its word needs (and sharing the rest), so a long word moves to a new line
                    // instead of breaking in the middle at large text sizes.
                    flexGrow: 1, flexBasis: 'auto', minWidth: 88, minHeight: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[3],
                    borderWidth: chosen ? 3 : 1, borderColor: chosen ? colors.brand : colors.borderControl,
                    backgroundColor: chosen ? tint.bg : colors.surface, opacity: pressed ? 0.85 : 1,
                  })}>
                  <Text style={{ color: chosen ? tint.fg : colors.text, fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center' }}>{TEXT.answers[a]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Field label={now.answer === 'no' ? TEXT.noteFailed : TEXT.noteLabel} value={mine?.note ?? now.note} editable={canAnswer} multiline
            onChangeText={(note) => save(withAnswer(draft, item.id, { answer: mine?.answer ?? now.answer, note }))} />
          {canAnswer ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <View style={{ flexGrow: 1 }}><Button label={TEXT.takePhoto} kind="secondary" busy={busy === 'camera'} onPress={() => void addPhoto('camera')} /></View>
              <View style={{ flexGrow: 1 }}><Button label={TEXT.choosePhoto} kind="secondary" busy={busy === 'library'} onPress={() => void addPhoto('library')} /></View>
            </View>
          ) : null}
          {now.photos ? <Body muted>{TEXT.photos(now.photos)}</Body> : item.photo_required ? <Body muted>{TEXT.photoNeededHint}</Body> : null}
        </View>
      </Section>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <View style={{ flexGrow: 1 }}><Button label={TEXT.previous} kind="secondary" disabled={pos === 0} onPress={() => setIndex(pos - 1)} /></View>
        <View style={{ flexGrow: 1 }}><Button label={TEXT.next} kind="secondary" disabled={pos === list.length - 1} onPress={() => setIndex(pos + 1)} /></View>
      </View>
      {nextOpen >= 0 ? <Button label={TEXT.nextOpen} kind="secondary" onPress={() => setIndex(nextOpen)} /> : null}
      {canAnswer && nextOpen < 0 ? <Button label={TEXT.toComplete} onPress={() => setMode('complete')} /> : null}
      {canAnswer && hasUnsent(draft) ? (
        <Button label={TEXT.sendSoFar} kind="secondary" busy={busy === 'answers'} onPress={() => void send(false)} />
      ) : null}
      <Section>
        {list.map((i, n) => {
          const a = currentAnswer(ins, draft, i.id).answer;
          return <Row key={i.id} label={`${n + 1}. ${i.prompt}`} detail={a ? TEXT.answers[a] : null} onPress={() => setIndex(n)} last={n === list.length - 1} />;
        })}
      </Section>
    </Screen>
  );
}
