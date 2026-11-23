// A policy to acknowledge (E38-08): the exact version the person was asked about, readable in the app
// (native text that follows the phone's text size), then "I have read and understood it". Owner: APP-WORK.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fontSize, radius, space, useTheme } from '../../theme';
import { acknowledge, errorText, fetchAcknowledgment } from '../api';
import { formatDate, formatDateTime } from '../format';
import { useLoad } from '../hooks';
import { htmlToBlocks, type TextBlock } from '../html';
import type { AckDetail } from '../types';
import { Body, Button, Card, FieldRow, Heading, Loading, Notice } from '../ui';

export const TEXT = {
  loading: 'Loading the policy',
  version: 'Version',
  effective: 'In effect from',
  due: 'Acknowledge by',
  overdue: 'Overdue',
  changes: 'What changed',
  text: 'Policy text',
  confirm: 'I have read and understood this policy',
  acknowledge: 'Acknowledge',
  done: (when: string) => `Acknowledged ${when}.`,
  superseded: 'This version has been replaced or the policy retired. There is nothing to acknowledge.',
  back: 'Back',
};

function Block({ block }: { block: TextBlock }) {
  const { colors } = useTheme();
  if (block.kind === 'heading') {
    const size = block.level === 1 ? fontSize.xl : block.level === 2 ? fontSize.lg + 2 : fontSize.lg;
    return <Text accessibilityRole="header" style={{ color: colors.text, fontSize: size, fontWeight: '600', marginTop: space[2] }}>{block.text}</Text>;
  }
  if (block.kind === 'item') {
    return (
      <View style={[styles.item, { paddingLeft: (block.depth ?? 0) * space[4] }]}>
        <Text importantForAccessibility="no" accessibilityElementsHidden style={{ color: colors.text, fontSize: fontSize.md }}>{block.marker}</Text>
        <Text style={{ color: colors.text, fontSize: fontSize.md, lineHeight: fontSize.md * 1.5, flex: 1 }}>{block.text}</Text>
      </View>
    );
  }
  if (block.kind === 'quote') {
    return <Text style={{ color: colors.textMuted, fontSize: fontSize.md, lineHeight: fontSize.md * 1.5, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: space[3] }}>{block.text}</Text>;
  }
  if (block.kind === 'code') {
    return <Text style={{ color: colors.text, fontSize: fontSize.sm, fontFamily: 'monospace', backgroundColor: colors.surface2, padding: space[2], borderRadius: radius.sm }}>{block.text}</Text>;
  }
  return <Text selectable style={{ color: colors.text, fontSize: fontSize.md, lineHeight: fontSize.md * 1.5 }}>{block.text}</Text>;
}

export default function AcknowledgmentScreen({ ackId }: { ackId: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const ack = useLoad(() => fetchAcknowledgment(ackId), [ackId]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const blocks = useMemo(() => (ack.data ? htmlToBlocks(ack.data.body_html ?? '') : []), [ack.data]);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await acknowledge(ackId);
      ack.setData({ ...(ack.data as AckDetail), ...next });
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const a = ack.data;
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      {ack.loading && !a ? <Loading label={TEXT.loading} /> : null}
      {ack.error ? <Notice>{ack.error}</Notice> : null}
      {a ? (
        <>
          {a.policy_ref ? <Body muted>{a.policy_ref}</Body> : null}
          <Heading level={1}>{a.policy_title}</Heading>
          <Card>
            <FieldRow label={TEXT.version} value={String(a.version)} />
            {a.effective_on ? <FieldRow label={TEXT.effective} value={formatDate(a.effective_on)} /> : null}
            {!a.acknowledged_at ? <FieldRow label={TEXT.due} value={`${formatDate(a.due_on)}${a.state === 'overdue' ? ` (${TEXT.overdue})` : ''}`} /> : null}
          </Card>
          {a.policy_summary ? <Body>{a.policy_summary}</Body> : null}
          {a.change_summary ? (
            <Card>
              <Heading level={2}>{TEXT.changes}</Heading>
              <Body>{a.change_summary}</Body>
            </Card>
          ) : null}
          <View style={styles.text}>
            <Heading level={2}>{TEXT.text}</Heading>
            {blocks.map((b, i) => <Block key={i} block={b} />)}
          </View>
          {a.acknowledged_at ? <Notice kind="success">{TEXT.done(formatDateTime(a.acknowledged_at))}</Notice> : null}
          {!a.acknowledged_at && a.state === 'superseded' ? <Notice kind="info">{TEXT.superseded}</Notice> : null}
          {problem ? <Notice>{problem}</Notice> : null}
          {!a.acknowledged_at && a.state !== 'superseded' ? (
            <Card>
              <Body>{TEXT.confirm}</Body>
              <Button kind="primary" label={TEXT.acknowledge} hint={TEXT.confirm} onPress={() => void send()} busy={busy} />
            </Card>
          ) : (
            <Button label={TEXT.back} onPress={() => router.back()} />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[4] },
  text: { gap: space[3] },
  item: { flexDirection: 'row', gap: space[2] },
});
