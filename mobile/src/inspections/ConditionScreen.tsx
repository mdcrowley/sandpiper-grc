// A condition assessment from the phone, with or without signal (wave 15, E38-11; the record type is
// E32-02): the condition on the organization's scale, how it was assessed, a note and photos, for an
// asset, vehicle or site (opened from field work's "due" list or from a tag card). It is dated the day it
// was made (in the organization's time zone), saved in the outbox with its photos and sent once; the
// server's rules apply when it arrives (for example: you may see the record, the date is not in the future).
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSession } from '../api/client';
import { discardPicture } from '../camera/still';
import { orOffline, outbox, packageList, sendNow, useOfflinePackage } from '../offline';
import type { NewOutboxItem } from '../offline/outbox';
import { lookupOptions, type Option } from '../tags/calls';
import { fontSize, radius, space, useTheme } from '../theme';
import { Banner, Body, Button, Field, Screen, Section, Title } from '../ui';
import { takeDraftPhoto, todayIn } from './common';

export const TEXT = {
  title: 'Condition assessment',
  noTarget: 'Choose what to assess from Field work, or read its tag.',
  notAllowed: 'You cannot record condition assessments. Ask your administrator if you should.',
  rating: 'Condition', method: 'How it was assessed', notes: 'Notes (optional)',
  noRatings: 'The condition scale is not on this phone. Connect and download the offline package (Offline work).',
  takePhoto: 'Take a photo', choosePhoto: 'Choose a photo', removePhoto: 'Remove photo',
  save: 'Save and send',
  pickRating: 'Choose the condition.',
  saved: 'Saved on this phone. It is sent on its own, once, when there is a connection.',
  failed: 'Could not save: ',
  dated: (d: string) => `Dated ${d}`,
};

export const conditionItems = (target: { type: string; id: string; label: string }, a: { assessedOn: string; rating: string; method: string | null; notes: string },
  photos: { uri: string; name: string }[], id?: string): NewOutboxItem[] => [
  {
    id, kind: 'condition.assess', label: target.label,
    payload: { targetType: target.type, targetId: target.id, assessedOn: a.assessedOn, rating: a.rating, method: a.method, notes: a.notes.trim() || null },
  },
  ...photos.map((p, n): NewOutboxItem => ({ kind: 'attachment', label: `Photo ${n + 1}`, dependsOn: 0, file: p, payload: { name: p.name } })),
];

export default function ConditionScreen() {
  const { colors } = useTheme();
  const session = useSession();
  const pkg = useOfflinePackage();
  const params = useLocalSearchParams<{ type?: string; id?: string; label?: string }>();
  const target = params.type && params.id ? { type: String(params.type), id: String(params.id), label: String(params.label ?? '') } : null;
  const [ratings, setRatings] = useState<Option[] | null>(null);
  const [methods, setMethods] = useState<Option[]>([]);
  const [rating, setRating] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folder = `condition-${target?.id ?? 'none'}`;

  useEffect(() => {
    let live = true;
    void orOffline(() => lookupOptions('condition_rating'), (p) => { const l = packageList(p, 'condition_rating'); return l.length ? l : null; })
      .then((o) => { if (live) setRatings(o); }, () => { if (live) setRatings([]); });
    void orOffline(() => lookupOptions('condition_method'), (p) => packageList(p, 'condition_method'))
      .then((o) => { if (live) setMethods(o); }, () => undefined);
    return () => { live = false; };
  }, []);

  const allowed = session.areaOn('condition') && session.can('assets.create');
  if (!allowed) return <Screen><Banner>{TEXT.notAllowed}</Banner></Screen>;
  if (!target) return <Screen><Title>{TEXT.title}</Title><Body>{TEXT.noTarget}</Body></Screen>;
  const assessedOn = todayIn(pkg?.timeZone);

  const addPhoto = async (from: 'camera' | 'library') => {
    setBusy(from); setError(null);
    try {
      const kept = await takeDraftPhoto(folder, photos.length + 1, from);
      if (kept) setPhotos((p) => [...p, kept]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!rating) { setError(TEXT.pickRating); return; }
    setBusy('save'); setError(null);
    try {
      await outbox().add(conditionItems(target, { assessedOn, rating, method, notes }, photos, Crypto.randomUUID()));
      for (const p of photos) discardPicture(p.uri);
      sendNow();
      router.back();
    } catch (e) { setError(`${TEXT.failed}${(e as Error).message}`); } finally { setBusy(null); }
  };

  const choice = (o: Option, selected: boolean, onPress: () => void) => (
    <Pressable key={o.id} accessibilityRole="radio" accessibilityLabel={o.label} accessibilityState={{ checked: selected }} onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: radius.md,
        borderWidth: selected ? 3 : 1, borderColor: selected ? colors.brand : colors.borderControl,
        backgroundColor: selected ? colors.brandSoft : colors.surface, opacity: pressed ? 0.85 : 1,
      })}>
      <Text style={{ color: colors.text, fontSize: fontSize.lg, fontWeight: selected ? '700' : '400' }}>{o.label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <View style={{ gap: space[1] }}>
        <Body muted>{TEXT.title}</Body>
        <Title>{target.label}</Title>
        <Body muted>{TEXT.dated(assessedOn)}</Body>
      </View>
      <Section title={TEXT.rating}>
        <View accessibilityRole="radiogroup" accessibilityLabel={TEXT.rating} style={{ padding: space[3], gap: space[2] }}>
          {ratings === null ? <Body muted>…</Body> : ratings.length ? ratings.map((o) => choice(o, rating === o.id, () => setRating(o.id))) : <Body>{TEXT.noRatings}</Body>}
        </View>
      </Section>
      {methods.length ? (
        <Section title={TEXT.method}>
          <View accessibilityRole="radiogroup" accessibilityLabel={TEXT.method} style={{ padding: space[3], gap: space[2] }}>
            {methods.map((o) => choice(o, method === o.id, () => setMethod(method === o.id ? null : o.id)))}
          </View>
        </Section>
      ) : null}
      <Field label={TEXT.notes} value={notes} onChangeText={setNotes} multiline />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        <View style={{ flexGrow: 1 }}><Button label={TEXT.takePhoto} kind="secondary" busy={busy === 'camera'} onPress={() => void addPhoto('camera')} /></View>
        <View style={{ flexGrow: 1 }}><Button label={TEXT.choosePhoto} kind="secondary" busy={busy === 'library'} onPress={() => void addPhoto('library')} /></View>
      </View>
      {photos.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {photos.map((p) => (
            <View key={p.uri} style={{ gap: space[1] }}>
              <Image source={{ uri: p.uri }} accessibilityLabel={p.name} style={{ width: 96, height: 72, borderRadius: radius.sm }} />
              <Pressable accessibilityRole="button" accessibilityLabel={`${TEXT.removePhoto} ${p.name}`} style={{ minHeight: 44, justifyContent: 'center' }}
                onPress={() => { discardPicture(p.uri); setPhotos((x) => x.filter((y) => y.uri !== p.uri)); }}>
                <Text style={{ color: colors.link }}>{TEXT.removePhoto}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Button label={TEXT.save} busy={busy === 'save'} disabled={!rating} onPress={() => void save()} />
      <Body muted>{TEXT.saved}</Body>
    </Screen>
  );
}
