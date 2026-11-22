// Replace a record's tag (spec §4.3 "Replace tag", E37-07): read the new tag with the camera or type
// it, with an optional reason; the old number is marked replaced and points at the new one.
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Banner, Body, Button, Field, Screen, Title } from '../../ui';
import { lookUpTyped } from '../lookup';
import { recordTags, replaceTag } from '../calls';
import * as handoff from '../handoff';
import type { TagAssignmentView } from '../../../../shared/asset-tags-api.ts';
import type { TagSource } from '../../../../shared/tag-format.ts';

export const TEXT = {
  title: 'Replace tag', missing: 'Open the tag card again.', current: 'Current tag', none: 'This record has no tag to replace.',
  newValue: 'New tag number', read: 'Read the new tag with the camera', reason: 'Reason (optional)', reasonHint: 'For example: damaged, unreadable.',
  replace: 'Replace',
};

export default function ReplaceScreen() {
  const { card: cardId } = useLocalSearchParams<{ card?: string }>();
  const item = handoff.get(cardId, 'card');
  const [current, setCurrent] = useState<TagAssignmentView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [value, setValue] = useState('');
  const [source, setSource] = useState<TagSource>('typed');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickId = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    recordTags(item.card.recordType, item.card.recordId).then(
      (t) => { setCurrent(t.current.find((a) => a.primary) ?? t.current[0] ?? null); setLoaded(true); },
      (e: Error) => { setError(e.message); setLoaded(true); },
    );
  }, [item?.card.recordType, item?.card.recordId]);

  // Back from the camera in pick mode: take what it read.
  useFocusEffect(useCallback(() => {
    const picked = pickId.current ? handoff.get(pickId.current, 'pick') : null;
    if (picked?.value) { setValue(picked.value); setSource('code'); }
    if (pickId.current) { handoff.release(pickId.current); pickId.current = null; }
  }, []));

  if (!item) return <Screen><Body>{TEXT.missing}</Body></Screen>;

  const replace = async () => {
    if (!current || !value.trim()) return;
    setBusy(true); setError(null);
    try {
      await replaceTag(current.id, value.trim(), source, reason.trim());
      const a = await lookUpTyped(value.trim());
      const id = handoff.put({ kind: 'answer', answer: a, picture: null });
      router.dismissTo(`/tag/card?answer=${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      <Body>{`${item.card.typeLabel} ${item.card.title}`}</Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {loaded && !current ? <Banner kind="warning">{TEXT.none}</Banner> : null}
      {current ? <Body muted>{`${TEXT.current}: ${current.value}`}</Body> : null}
      <Button label={TEXT.read} kind="secondary" onPress={() => { pickId.current = handoff.put({ kind: 'pick', value: null }); router.push(`/tag?pick=${pickId.current}`); }} />
      <Field label={TEXT.newValue} value={value} onChangeText={(v) => { setValue(v); setSource('typed'); }} autoCapitalize="characters" autoCorrect={false} />
      <Field label={TEXT.reason} hint={TEXT.reasonHint} value={reason} onChangeText={setReason} />
      <Button label={TEXT.replace} disabled={!current || !value.trim()} busy={busy} onPress={() => void replace()} />
    </Screen>
  );
}
