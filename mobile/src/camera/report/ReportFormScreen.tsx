// Report a problem (a ticket) or a hazard or close call (a safety event) with photos (spec §5.3,
// E38-06): /report/new?kind=problem|hazard, or ?start=<id> from a tag card's action (the record is
// linked through the server's prefill). Photos are made to fit the server's limits on the phone; the
// report is saved in the outbox (E38-10), which sends it and its photos once, also after a lost
// connection or when written with no signal at all. Without a connection the form's choices (types,
// severities, sites, limits) come from the offline package.
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useSession } from '../../api/client';
import { Banner, Body, Button, Field, Row, Screen, Section, Title } from '../../ui';
import { fontSize, radius, space, useTheme } from '../../theme';
import { apiFetch } from '../../api/client';
import { lookupOptions, recordOptions, type Option } from '../../tags/calls';
import * as handoff from '../../tags/handoff';
import { attachmentLimits, fitPhoto, photoName, PhotoError } from '../photos';
import { discardPicture } from '../still';
import { packageList, packageSites, orOffline } from '../../offline';
import { saveReport } from '../reportQueue';
import { buildReport, initialAnswers, isPortal, pickDefault, PORTAL_AFFECTS, PORTAL_URGENCY } from './build';

export const TEXT = {
  problem: 'Report a problem', hazard: 'Report a hazard or close call',
  about: 'About', titleLabel: 'Title', titleHint: 'A few words: what and where.',
  problemText: 'What is wrong', hazardText: 'What happened or what could happen',
  site: 'Site', siteSearch: 'Find a site', noSite: 'No site', location: 'Where exactly (optional)',
  type: 'Type', severity: 'Severity', harm: 'How bad was it', affects: 'Who is affected', urgency: 'How urgent is it',
  photos: 'Photos', takePhoto: 'Take a photo', choosePhotos: 'Choose photos', removePhoto: 'Remove photo',
  maxPhotos: 'At most 10 photos.', send: 'Send', titleRequired: 'Type a title.',
  notAllowed: 'You cannot make this kind of report.',
  preparing: 'Preparing the photo…',
};

const MAX_PHOTOS = 10;

export default function ReportFormScreen() {
  const { colors } = useTheme();
  const session = useSession();
  const params = useLocalSearchParams<{ kind?: string; start?: string }>();
  const start = handoff.get(params.start, 'report')?.start ?? null;
  const kind: 'problem' | 'hazard' = start?.kind ?? (params.kind === 'hazard' ? 'hazard' : 'problem');
  const allowed = start ? true : kind === 'problem' ? session.areaOn('tickets') && session.can('tickets.create') : session.areaOn('safety') && session.can('safety.create');

  const portal = isPortal(start);
  const [initial] = useState(() => initialAnswers(start));
  const [title, setTitle] = useState(initial.title);
  const [text, setText] = useState(initial.description);
  const [site, setSite] = useState<{ id: string; label: string } | null>(initial.site);
  const [siteQ, setSiteQ] = useState('');
  const [sites, setSites] = useState<Option[] | null>(null);
  const [choosingSite, setChoosingSite] = useState(false);
  const [detail, setDetail] = useState(initial.locationDetail);
  const [affects, setAffects] = useState('me');
  const [howUrgent, setHowUrgent] = useState('slowed');
  const [harms, setHarms] = useState<Option[]>([]);
  const [harm, setHarm] = useState<string | null>(null);
  const [types, setTypes] = useState<Option[]>([]);
  const [severities, setSeverities] = useState<Option[]>([]);
  const [eventType, setEventType] = useState<string | null>(initial.eventType);
  const [severity, setSeverity] = useState<string | null>(initial.severity);
  const [photos, setPhotos] = useState<{ uri: string; name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'hazard') return;
    if (portal) {
      // The portal's own choices, in plain words.
      orOffline(
        () => apiFetch<{ types: { value: string; label: string }[]; harm: { value: string; label: string }[] }>('/api/portal/safety/options'),
        (p) => (p.portal ? { types: p.portal.safetyTypes, harm: p.portal.harm } : null),
      ).then((o) => {
        const t = o.types.map((x) => ({ id: x.value, label: x.label }));
        setTypes(t); setEventType((v) => v ?? pickDefault(t.map((x) => x.id), ['unsafe_condition', 'near_miss']));
        setHarms(o.harm.map((x) => ({ id: x.value, label: x.label }))); setHarm((v) => v ?? o.harm[0]?.value ?? null);
      }, () => {});
      return;
    }
    orOffline(() => lookupOptions('safety_event_type'), (p) => nonEmpty(packageList(p, 'safety_event_type'))).then((o) => { setTypes(o); setEventType((v) => v ?? pickDefault(o.map((x) => x.id), ['unsafe_condition', 'near_miss'])); }, () => {});
    orOffline(() => lookupOptions('safety_event_severity'), (p) => nonEmpty(packageList(p, 'safety_event_severity'))).then((o) => { setSeverities(o); setSeverity((v) => v ?? pickDefault(o.map((x) => x.id), ['no_harm'])); }, () => {});
  }, [kind, portal]);

  useEffect(() => {
    if (!choosingSite) return;
    let live = true;
    const t = setTimeout(() => orOffline(() => recordOptions('site', siteQ), (p) => packageSites(p, siteQ)).then((o) => { if (live) setSites(o); }, () => { if (live) setSites([]); }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [choosingSite, siteQ]);

  // Photos not sent are deleted when the form closes (the queue keeps its own copies).
  const photosRef = useRefSync(photos);
  useEffect(() => () => { for (const p of photosRef.current) discardPicture(p.uri); }, [photosRef]);

  const addPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    setBusy(TEXT.preparing); setError(null);
    try {
      const limits = await orOffline(() => attachmentLimits(), (p) => p.attachments);
      const out: { uri: string; name: string }[] = [];
      for (const a of assets.slice(0, MAX_PHOTOS - photos.length)) {
        const fitted = await fitPhoto(a.uri, { width: a.width, height: a.height }, limits);
        out.push({ uri: fitted.uri, name: photoName(new Date(), photos.length + out.length + 1) });
      }
      setPhotos((p) => [...p, ...out]);
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const takePhoto = async () => {
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (!res.canceled) { await addPhotos(res.assets); res.assets.forEach((a) => discardPicture(a.uri)); }
  };
  const choosePhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length });
    // The picker hands over copies in the app's cache: delete them once fitted (never the library's own).
    if (!res.canceled) { await addPhotos(res.assets); res.assets.forEach((a) => discardPicture(a.uri)); }
  };

  const send = async () => {
    if (!title.trim()) { setTitleError(TEXT.titleRequired); return; }
    setBusy(TEXT.send); setError(null);
    try {
      const req = buildReport(kind, { title, description: text, site, locationDetail: detail, eventType, severity, occurredAt: new Date().toISOString(), affects, howUrgent, harm }, start);
      await saveReport({ kind, path: req.path, recordType: req.recordType, body: req.body, link: req.link, title: title.trim() }, photos, Crypto.randomUUID());
      for (const p of photos) discardPicture(p.uri);
      photosRef.current = [];
      setPhotos([]);
      handoff.release(params.start);
      router.dismissTo('/report');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) return <Screen><Title>{kind === 'problem' ? TEXT.problem : TEXT.hazard}</Title><Body>{TEXT.notAllowed}</Body></Screen>;

  return (
    <Screen>
      <Title>{kind === 'problem' ? TEXT.problem : TEXT.hazard}</Title>
      {start?.record ? <Body muted>{`${TEXT.about}: ${start.record.label}`}</Body> : null}
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field label={TEXT.titleLabel} hint={TEXT.titleHint} value={title} onChangeText={(v) => { setTitle(v); setTitleError(null); }} error={titleError} maxLength={200} />
      <Field label={kind === 'problem' ? TEXT.problemText : TEXT.hazardText} value={text} onChangeText={setText} multiline style={{ minHeight: 96 }} />

      {kind === 'hazard' && types.length ? (
        <Section title={TEXT.type}>
          {types.map((t, i) => <Row key={t.id} label={t.label} selected={eventType === t.id} onPress={() => setEventType(t.id)} last={i === types.length - 1} />)}
        </Section>
      ) : null}
      {kind === 'hazard' && severities.length ? (
        <Section title={TEXT.severity}>
          {severities.map((t, i) => <Row key={t.id} label={t.label} selected={severity === t.id} onPress={() => setSeverity(t.id)} last={i === severities.length - 1} />)}
        </Section>
      ) : null}
      {kind === 'hazard' && portal && harms.length ? (
        <Section title={TEXT.harm}>
          {harms.map((t, i) => <Row key={t.id} label={t.label} selected={harm === t.id} onPress={() => setHarm(t.id)} last={i === harms.length - 1} />)}
        </Section>
      ) : null}
      {kind === 'problem' && portal ? (
        <>
          <Section title={TEXT.affects}>
            {PORTAL_AFFECTS.map((t, i) => <Row key={t.id} label={t.label} selected={affects === t.id} onPress={() => setAffects(t.id)} last={i === PORTAL_AFFECTS.length - 1} />)}
          </Section>
          <Section title={TEXT.urgency}>
            {PORTAL_URGENCY.map((t, i) => <Row key={t.id} label={t.label} selected={howUrgent === t.id} onPress={() => setHowUrgent(t.id)} last={i === PORTAL_URGENCY.length - 1} />)}
          </Section>
        </>
      ) : null}

      <Section title={TEXT.site}>
        <Row label={site?.label || TEXT.noSite} accessibilityLabel={`${site?.label || TEXT.noSite}, ${TEXT.site}`} expanded={choosingSite} onPress={() => setChoosingSite((c) => !c)} last={!choosingSite} accessibilityHint={TEXT.siteSearch} />
        {choosingSite ? (
          <View>
            <View style={{ padding: space[2] }}><Field label={TEXT.siteSearch} value={siteQ} onChangeText={setSiteQ} autoCorrect={false} /></View>
            <Row label={TEXT.noSite} onPress={() => { setSite(null); setChoosingSite(false); }} />
            {(sites ?? []).map((s, i) => <Row key={s.id} label={s.label} detail={s.ref ?? null} onPress={() => { setSite({ id: s.id, label: s.label }); setChoosingSite(false); }} last={i === (sites?.length ?? 0) - 1} />)}
          </View>
        ) : null}
      </Section>
      <Field label={TEXT.location} value={detail} onChangeText={setDetail} />

      <Section title={TEXT.photos}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], padding: space[2] }}>
          {photos.map((p) => (
            <View key={p.uri} style={{ gap: space[1] }}>
              <Image source={{ uri: p.uri }} style={{ width: 96, height: 96, borderRadius: radius.md }} accessibilityLabel={p.name} />
              <Pressable accessibilityRole="button" accessibilityLabel={`${TEXT.removePhoto} ${p.name}`} onPress={() => { discardPicture(p.uri); setPhotos((x) => x.filter((y) => y.uri !== p.uri)); }} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colors.link, fontSize: fontSize.sm }}>{TEXT.removePhoto}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </Section>
      {photos.length >= MAX_PHOTOS ? <Body muted>{TEXT.maxPhotos}</Body> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          <View style={{ flexGrow: 1 }}><Button label={TEXT.takePhoto} kind="secondary" onPress={() => void takePhoto()} disabled={Boolean(busy)} /></View>
          <View style={{ flexGrow: 1 }}><Button label={TEXT.choosePhotos} kind="secondary" onPress={() => void choosePhotos()} disabled={Boolean(busy)} /></View>
        </View>
      )}
      {busy === TEXT.preparing ? <Body muted>{TEXT.preparing}</Body> : null}
      <Button label={TEXT.send} onPress={() => void send()} busy={busy === TEXT.send} disabled={Boolean(busy)} />
    </Screen>
  );
}

/** null for an empty list, so the offline package is asked only when it has the list. */
const nonEmpty = <T,>(list: T[]): T[] | null => (list.length ? list : null);

/** A ref that always holds the latest value (for clean-up on close). */
function useRefSync<T>(value: T): { current: T } {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
