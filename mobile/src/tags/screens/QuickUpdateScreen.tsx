// Quick updates from a tag card (spec §4.3): change status, location, assignee or custodian in one
// step. The fields and their current values come from the server's quick_update action; the change is
// saved with the version the person saw (If-Match), so a record changed meanwhile is not overwritten.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ApiError } from '../../api/client';
import { Banner, Body, Button, Field, Row, Screen, Section, Title } from '../../ui';
import { space } from '../../theme';
import { lookupOptions, quickUpdate, recordOptions, userOptions, type Option } from '../calls';
import * as handoff from '../handoff';
import type { QuickField } from '../../../../shared/asset-tags-api.ts';

export const TEXT = {
  title: 'Quick update', missing: 'Open the tag card again.', save: 'Save', search: 'Search', clear: 'None',
  conflict: 'Someone changed this record since you opened it. Read the tag again to see the current values.',
  saved: 'Saved.', nothing: 'Nothing changed.',
};

export default function QuickUpdateScreen() {
  const { card: cardId } = useLocalSearchParams<{ card?: string }>();
  const item = handoff.get(cardId, 'card');
  const fields = item?.card.actions.find((a) => a.key === 'quick_update')?.fields ?? [];
  const [values, setValues] = useState<Record<string, { value: unknown; display: string | null }>>(
    Object.fromEntries(fields.map((f) => [f.field, { value: f.value, display: f.display }])),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item) return <Screen><Body>{TEXT.missing}</Body></Screen>;
  const card = item.card;

  const save = async () => {
    const patch: Record<string, unknown> = {};
    for (const f of fields) if (values[f.field].value !== f.value) patch[f.field] = values[f.field].value;
    if (!Object.keys(patch).length) { router.back(); return; }
    setBusy(true); setError(null);
    try {
      await quickUpdate(card.recordType, card.recordId, card.version, patch);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? TEXT.conflict : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{TEXT.title}</Title>
      <Body>{`${card.typeLabel} ${card.title}`}</Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {fields.map((f) => (
        <View key={f.field} style={{ gap: space[2] }}>
          {f.type === 'text' ? (
            <Field label={f.label} value={String(values[f.field].value ?? '')} onChangeText={(v) => setValues((s) => ({ ...s, [f.field]: { value: v, display: v } }))} />
          ) : (
            <Section title={f.label}>
              <Row label={values[f.field].display ?? TEXT.clear} onPress={() => setOpen(open === f.field ? null : f.field)} last={open !== f.field} />
              {open === f.field ? (
                <Choices field={f} onChoose={(o) => { setValues((s) => ({ ...s, [f.field]: o ? { value: o.id, display: o.label } : { value: null, display: null } })); setOpen(null); }} />
              ) : null}
            </Section>
          )}
        </View>
      ))}
      <Button label={TEXT.save} busy={busy} onPress={() => void save()} />
    </Screen>
  );
}

function Choices({ field, onChoose }: { field: QuickField; onChoose: (o: Option | null) => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const load = field.type === 'lookup' ? lookupOptions(field.list ?? '') : field.type === 'user' ? userOptions(q) : recordOptions(field.to ?? '', q);
      load.then((o) => { if (live) setOptions(field.type === 'lookup' && q ? o.filter((x) => x.label.toLowerCase().includes(q.toLowerCase())) : o); }, () => { if (live) setOptions([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [field, q]);
  return (
    <View>
      <View style={{ padding: space[2] }}><Field label={TEXT.search} value={q} onChangeText={setQ} autoCorrect={false} /></View>
      <Row label={TEXT.clear} onPress={() => onChoose(null)} />
      {options.slice(0, 25).map((o, i) => <Row key={o.id} label={o.label} detail={o.ref ?? null} onPress={() => onChoose(o)} last={i === Math.min(options.length, 25) - 1} />)}
    </View>
  );
}
