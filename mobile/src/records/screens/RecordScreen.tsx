// A record on the phone (E38-07, spec §5.3): summary, key fields, activity, comments and files, with the
// phone edit form where the type allows it (§5.4) and "Open on the web" for everything else. A
// restricted record blocks screenshots on Android and blanks the app-switcher image on iOS (§5.8), and
// is never kept in the recent list. Owner: APP-WORK.
import { Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusOn, type TextRef } from '../../ui/a11y';
import { useSession } from '../../api/client';
import { space, useTheme } from '../../theme';
import { fetchRecord, type LoadedRecord } from '../api';
import { displayValue, recordTitle } from '../format';
import { useLoad, useMeta } from '../hooks';
import { editableFields, isRestricted, layoutFor } from '../layouts';
import { headerOptions } from '../header';
import { RecordEditor } from '../RecordEditor';
import { ActivityPanel, CommentsPanel, FilesPanel } from '../RecordPanels';
import { rememberRecent } from '../recent';
import { useSecureScreen } from '../secure';
import { Body, Button, Card, Chip, FieldRow, Heading, Loading, Notice, Segmented } from '../ui';
import { openOnWeb } from '../web';

export const TEXT = {
  loading: 'Loading the record',
  unknownType: 'This kind of record cannot be shown in the app, or you may not see it.',
  restricted: 'Restricted record: screenshots are blocked while it is open.',
  edit: 'Edit',
  openWeb: 'Open on the web',
  openWebHint: 'Opens this record in the browser',
  saved: 'Saved.',
  tabs: 'Record sections',
  details: 'Details',
  activity: 'Activity',
  comments: 'Comments',
  files: 'Files',
  noDetails: 'Nothing more is recorded.',
};

type Tab = 'details' | 'activity' | 'comments' | 'files';

export default function RecordScreen({ type, id }: { type: string; id: string }) {
  const { colors } = useTheme();
  const { session, can } = useSession();
  const { meta: allMeta, error: metaError } = useMeta();
  const meta = allMeta?.resources[type] ?? null;
  const lookups = allMeta?.lookups ?? {};
  const record = useLoad<LoadedRecord | null>(() => (meta ? fetchRecord(meta, id) : Promise.resolve(null)), [meta, id]);
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // When the edit form closes (saved or canceled), the screen reader's focus goes back to the title.
  const [closed, setClosed] = useState(0);
  const titleRef = useFocusOn<TextRef>(closed, { initial: false });

  const row = record.data?.row ?? null;
  const restricted = Boolean(meta && row && isRestricted(meta, row));
  useSecureScreen(restricted);

  const title = meta && row ? recordTitle(row, meta.titleField, meta.refField) : '';
  const ref = meta?.refField && row ? (row[meta.refField] as string | null) ?? null : null;

  useEffect(() => {
    if (!meta || !row || restricted) return;
    void rememberRecent({ type, typeLabel: meta.label, id, label: title, ref });
  }, [meta, row, restricted, type, id, title, ref]);

  const layout = useMemo(() => (meta ? layoutFor(meta) : null), [meta]);
  const mayEdit = Boolean(meta && can(`${meta.module}.edit`) && editableFields(meta).length > 0);
  const webPath = meta ? `${meta.route}/${encodeURIComponent(id)}` : '';
  const openWeb = () => void openOnWeb(session?.server, webPath);

  const header = <Stack.Screen options={{ ...headerOptions(colors), headerShown: true, title: meta?.label ?? '' }} />;

  if (metaError || record.error) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        {header}
        <Notice>{metaError ?? record.error}</Notice>
      </ScrollView>
    );
  }
  if (allMeta && !meta) {
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        {header}
        <Notice>{TEXT.unknownType}</Notice>
      </ScrollView>
    );
  }
  if (!meta || !layout || !row || !record.data) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.bg }]}>
        {header}
        <Loading label={TEXT.loading} />
      </View>
    );
  }

  const shown = (name: string) => {
    const field = meta.fields[name];
    return field ? displayValue(name, field, row, lookups) : null;
  };
  const summary = layout.summary.map((n) => ({ n, v: shown(n), f: meta.fields[n] })).filter((x) => x.v);
  const keys = layout.key.map((n) => ({ n, v: shown(n), f: meta.fields[n] })).filter((x) => x.v);
  const colorOf = (n: string) => {
    const f = meta.fields[n];
    return f?.type === 'lookup' && f.list ? lookups[f.list]?.find((v) => v.value === row[n])?.color ?? null : null;
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {header}
      <View style={styles.head}>
        <Body muted>{[meta.label, ref].filter(Boolean).join(' · ')}</Body>
        <Heading ref={titleRef} level={1}>{title}</Heading>
        {restricted ? <Notice kind="info">{TEXT.restricted}</Notice> : null}
        <View style={styles.chips}>
          {summary.filter((s) => s.f?.type === 'lookup').map((s) => <Chip key={s.n} label={`${s.f!.label}: ${s.v}`} color={colorOf(s.n)} />)}
        </View>
        {summary.filter((s) => s.f?.type !== 'lookup').map((s) => <FieldRow key={s.n} label={s.f!.label} value={s.v!} />)}
      </View>

      {note ? <Notice kind="success">{note}</Notice> : null}

      {editing ? (
        <RecordEditor
          meta={meta}
          lookups={lookups}
          loaded={record.data}
          onCancel={() => { setEditing(false); setClosed((n) => n + 1); }}
          onOpenWeb={openWeb}
          onSaved={(next, msg) => {
            record.setData(next);
            setEditing(false);
            setClosed((n) => n + 1);
            setNote(msg ?? TEXT.saved);
          }}
        />
      ) : (
        <>
          <View style={styles.actions}>
            {mayEdit ? <Button kind="primary" label={TEXT.edit} onPress={() => { setNote(null); setEditing(true); }} /> : null}
            <Button label={TEXT.openWeb} hint={TEXT.openWebHint} onPress={openWeb} />
          </View>
          <Segmented
            label={TEXT.tabs}
            value={tab}
            onChange={setTab}
            options={[
              { key: 'details', label: TEXT.details },
              { key: 'activity', label: TEXT.activity },
              { key: 'comments', label: TEXT.comments },
              { key: 'files', label: TEXT.files },
            ]}
          />
          {tab === 'details' ? (
            <Card>
              {keys.length === 0 ? <Body muted>{TEXT.noDetails}</Body> : null}
              {keys.map((k) => <FieldRow key={k.n} label={k.f!.label} value={k.v!} />)}
            </Card>
          ) : null}
          {tab === 'activity' ? <ActivityPanel type={type} id={id} /> : null}
          {tab === 'comments' ? <CommentsPanel type={type} id={id} /> : null}
          {tab === 'files' ? <FilesPanel type={type} id={id} onOpenWeb={openWeb} /> : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space[4], gap: space[4] },
  head: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
});
