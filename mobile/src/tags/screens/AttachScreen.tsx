// Attach a tag in stock (or matching a format but not registered) to a record (spec §4.2 rules 3 and
// 4, E37-07): choose the kind of record, find it, attach. The server checks the permission (tags.manage
// and edit on the record), holds and uniqueness, and answers in plain words when it refuses.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../api/client';
import { Banner, Body, Button, Field, Row, Screen, Section, Title } from '../../ui';
import { space } from '../../theme';
import { attachTag, recordOptions, type Option } from '../calls';
import { sourceOf } from '../lookup';
import { lookUpTyped } from '../lookup';
import * as handoff from '../handoff';

export const TEXT = {
  title: 'Attach tag', missing: 'Read the tag again.', kind: 'Kind of record', find: 'Find the record', search: 'Name or reference',
  none: 'No matching records.', attach: 'Attach', attached: 'Attached.', value: 'Tag number',
};

/** Taggable record types and the area each needs (spec §3.1). */
export const TAGGABLE: { type: string; label: string; area: string | null }[] = [
  { type: 'asset', label: 'Asset', area: null },
  { type: 'vehicle', label: 'Vehicle', area: 'fleet' },
  { type: 'site', label: 'Site', area: null },
  { type: 'system', label: 'System', area: null },
];

export default function AttachScreen() {
  const { answer: answerId } = useLocalSearchParams<{ answer?: string }>();
  const session = useSession();
  const item = handoff.get(answerId, 'answer');
  const types = TAGGABLE.filter((t) => !t.area || session.areaOn(t.area));
  const [type, setType] = useState(types[0]?.type ?? 'asset');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Option[] | null>(null);
  const [chosen, setChosen] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      recordOptions(type, q).then((o) => { if (live) setOptions(o); }, (e: Error) => { if (live) setError(e.message); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [type, q]);

  if (!item) return <Screen><Body>{TEXT.missing}</Body></Screen>;
  const value = item.answer.reading.value;

  const attach = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      await attachTag(type, chosen.id, value, sourceOf(item.answer.reading));
      // Show the record's card, now found by its new tag.
      const a = await lookUpTyped(value);
      const id = handoff.put({ kind: 'answer', answer: a, picture: null });
      router.replace(`/tag/card?answer=${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      <Body>{`${TEXT.value}: ${value}`}</Body>
      {item.answer.message ? <Body muted>{item.answer.message}</Body> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Section title={TEXT.kind}>
        {types.map((t, i) => (
          <Row key={t.type} label={t.label} selected={t.type === type} onPress={() => { setType(t.type); setChosen(null); }} last={i === types.length - 1} />
        ))}
      </Section>
      <Field label={TEXT.search} value={q} onChangeText={setQ} autoCorrect={false} />
      <Section title={TEXT.find}>
        {options && !options.length ? <Row label={TEXT.none} last /> : null}
        {(options ?? []).map((o, i) => (
          <Row key={o.id} label={o.label} detail={o.ref ?? null} selected={chosen?.id === o.id} onPress={() => setChosen(o)} last={i === (options?.length ?? 0) - 1} />
        ))}
      </Section>
      <View style={{ gap: space[2] }}>
        <Button label={chosen ? `${TEXT.attach}: ${chosen.label}` : TEXT.attach} disabled={!chosen} busy={busy} onPress={() => void attach()} />
      </View>
    </Screen>
  );
}
