// The tag card (spec §4.3, E38-05): what the found record is, and the actions the server allows this
// person (computed on the server; the app only draws them, in order). A picture taken with the
// shutter is offered for attaching to the record and deleted otherwise when the card closes.
import { useCallback, useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Banner, Body, Button, Field, Row, Screen, Section, Title } from '../../ui';
import { space } from '../../theme';
import { recordHref } from '../../records';
import { attachmentLimits, fitPhoto, photoName, uploadPhoto } from '../../camera/photos';
import { discardPicture } from '../../camera/still';
import { addNote, countFound, openOnWeb, photoSource } from '../calls';
import * as handoff from '../handoff';
import type { TagAction, TagCard } from '../../../../shared/asset-tags-api.ts';

export const TEXT = {
  missing: 'This tag card is no longer available. Read the tag again.',
  tag: 'Tag number', status: 'Status', site: 'Site', location: 'Location', lastSeen: 'Last seen',
  held: 'This record is under a legal hold: changes are not available.',
  restricted: 'Restricted record.',
  activity: 'Recent activity', openTickets: 'Open tickets', lastInspection: 'Last inspection', lastCondition: 'Last condition assessment',
  actions: 'Actions',
  attachPicture: 'Attach the picture you took', pictureAttached: 'The picture was attached to the record.',
  photoAdded: 'The photo was attached to the record.',
  note: 'Note', saveNote: 'Add the note', noteAdded: 'The note was added.',
  counted: 'Counted.',
  onWeb: '(opens on the web)',
  working: 'Working…',
};

/** Actions the app does itself; the rest open on the web. */
const IN_APP = new Set(['open', 'edit', 'quick_update', 'add_photo', 'add_note', 'report_problem', 'report_hazard', 'count', 'replace_tag', 'attach']);

export default function TagCardScreen() {
  const { answer: answerId } = useLocalSearchParams<{ answer?: string }>();
  const item = handoff.get(answerId, 'answer');
  const card: TagCard | undefined = item?.answer.result?.cards[0];
  const [picture, setPicture] = useState<string | null>(item?.picture ?? null);
  const [photo, setPhoto] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  // Leaving the card deletes a picture that was not attached.
  useEffect(() => () => { handoff.release(answerId); }, [answerId]);
  useEffect(() => {
    if (card?.photo?.url) void photoSource(card.photo.url).then(setPhoto, () => setPhoto(null));
  }, [card?.photo?.url]);

  const run = useCallback(async (label: string, work: () => Promise<string | void>) => {
    setBusy(label); setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ kind: 'info', text: done });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, []);

  if (!item || !card) return <Screen><Body>{TEXT.missing}</Body></Screen>;
  const answer = item.answer;

  const uploadTo = async (uri: string, size: { width: number; height: number }) => {
    const fitted = await fitPhoto(uri, size, await attachmentLimits());
    try {
      await uploadPhoto(card.recordType, card.recordId, fitted.uri, photoName(new Date(), 1));
    } finally {
      discardPicture(fitted.uri);
    }
  };

  const act = (a: TagAction) => {
    switch (a.key) {
      case 'open':
      case 'edit':
        router.push(recordHref(card.recordType, card.recordId));
        return;
      case 'quick_update': {
        const id = handoff.put({ kind: 'card', card: { ...card, actions: [a] }, picture: null });
        router.push(`/tag/update?card=${id}`);
        return;
      }
      case 'replace_tag': {
        const id = handoff.put({ kind: 'card', card, picture: null });
        router.push(`/tag/replace?card=${id}`);
        return;
      }
      case 'report_problem':
      case 'report_hazard': {
        const id = handoff.put({
          kind: 'report',
          start: {
            kind: a.key === 'report_problem' ? 'problem' : 'hazard', prefill: a.prefill,
            record: { type: card.recordType, id: card.recordId, label: `${card.typeLabel} ${card.title}`, siteId: card.site?.id ?? null, siteLabel: card.site?.label ?? null },
          },
        });
        router.push(`/report/new?start=${id}`);
        return;
      }
      case 'add_note':
        setNote((n) => n ?? '');
        return;
      case 'add_photo':
        void run(TEXT.working, async () => {
          const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
          if (res.canceled || !res.assets[0]) return;
          const shot = res.assets[0];
          try { await uploadTo(shot.uri, { width: shot.width, height: shot.height }); } finally { discardPicture(shot.uri); }
          return TEXT.photoAdded;
        });
        return;
      case 'count':
        if (a.countId) void run(TEXT.working, async () => (await countFound(a.countId!, card.recordType, card.recordId)).message || TEXT.counted);
        return;
      default:
        if (a.webPath) void openOnWeb(a.webPath);
    }
  };

  const facts = card.facts.filter((f) => f.value !== null && f.value !== '');
  const canAddPhoto = card.actions.some((a) => a.key === 'add_photo');

  return (
    <Screen>
      <View style={{ gap: space[1] }}>
        <Body muted>{card.typeLabel}{card.ref ? ` · ${card.ref}` : ''}</Body>
        <Title>{card.title}</Title>
      </View>
      {answer.result?.outcome === 'replaced' || answer.result?.outcome === 'identifier' ? <Banner>{answer.message}</Banner> : null}
      {card.holds.length ? <Banner kind="warning">{`${TEXT.held} (${card.holds.map((h) => h.ref).join(', ')})`}</Banner> : null}
      {message ? <Banner kind={message.kind === 'error' ? 'error' : 'info'}>{message.text}</Banner> : null}
      {photo ? <Image source={photo} accessibilityLabel={card.photo?.description ?? card.title} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 8 }} resizeMode="cover" /> : null}

      <Section>
        <Row label={TEXT.tag} value={card.tagValues.join(', ') || card.tagValue || answer.reading.value} />
        {card.status ? <Row label={TEXT.status} value={card.status.label} /> : null}
        {card.site ? <Row label={TEXT.site} value={card.site.label} /> : null}
        {card.location ? <Row label={TEXT.location} value={card.location} /> : null}
        {card.people.map((p) => <Row key={p.field} label={p.label} value={p.name} />)}
        {facts.map((f) => <Row key={f.field} label={f.label} value={f.value} />)}
        {card.lastSeen ? <Row label={TEXT.lastSeen} value={`${localTime(card.lastSeen.at)}${card.lastSeen.byName ? `, ${card.lastSeen.byName}` : ''}`} /> : null}
        {card.restricted ? <Row label={TEXT.restricted} last /> : null}
      </Section>

      {picture && canAddPhoto ? (
        <Button label={TEXT.attachPicture} kind="secondary" busy={busy === TEXT.attachPicture} onPress={() => void run(TEXT.attachPicture, async () => {
          await uploadTo(picture, { width: 0, height: 0 });
          discardPicture(picture);
          setPicture(null);
          if (answerId) handoff.update(answerId, { ...item, picture: null });
          return TEXT.pictureAttached;
        })} />
      ) : null}

      {card.actions.length ? (
        <Section title={TEXT.actions}>
          {card.actions.map((a, i) => (
            <Row key={`${a.key}-${i}`} label={IN_APP.has(a.key) || !a.webPath ? a.label : `${a.label} ${TEXT.onWeb}`} onPress={() => act(a)} last={i === card.actions.length - 1} />
          ))}
        </Section>
      ) : null}

      {note !== null ? (
        <View style={{ gap: space[2] }}>
          <Field label={TEXT.note} value={note} onChangeText={setNote} multiline autoFocus />
          <Button label={TEXT.saveNote} disabled={!note.trim()} busy={busy === TEXT.saveNote} onPress={() => void run(TEXT.saveNote, async () => {
            await addNote(card.recordType, card.recordId, note.trim());
            setNote(null);
            return TEXT.noteAdded;
          })} />
        </View>
      ) : null}

      <Activity card={card} />
    </Screen>
  );
}

function Activity({ card }: { card: TagCard }) {
  const a = card.activity;
  const rows = [
    ...a.openTickets.map((t) => ({ key: `t-${t.id}`, label: `${t.ref ?? ''} ${t.label}`.trim(), detail: `${TEXT.openTickets}${t.status ? ` · ${t.status}` : ''}`, href: recordHref(t.type, t.id) })),
    ...(a.lastInspection ? [{ key: 'insp', label: a.lastInspection.label, detail: `${TEXT.lastInspection}${a.lastInspection.date ? ` · ${a.lastInspection.date.slice(0, 10)}` : ''}`, href: recordHref(a.lastInspection.type, a.lastInspection.id) }] : []),
    ...(a.lastCondition ? [{ key: 'cond', label: a.lastCondition.label, detail: `${TEXT.lastCondition}${a.lastCondition.date ? ` · ${a.lastCondition.date.slice(0, 10)}` : ''}`, href: recordHref(a.lastCondition.type, a.lastCondition.id) }] : []),
    ...a.recentChanges.map((c, i) => ({ key: `c-${i}`, label: c.summary, detail: `${localTime(c.at)}${c.byName ? ` · ${c.byName}` : ''}`, href: null as string | null })),
  ];
  if (!rows.length) return null;
  return (
    <Section title={TEXT.activity}>
      {rows.map((r, i) => <Row key={r.key} label={r.label} detail={r.detail} onPress={r.href ? () => router.push(r.href!) : undefined} last={i === rows.length - 1} />)}
    </Section>
  );
}

/** A server time (ISO, UTC) as the phone's local date and time, for example "Nov 22, 2026, 12:39 PM". */
export function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
