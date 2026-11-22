// Approvals and acknowledgments (E38-08, spec §5.3): the approval steps waiting for the person and the
// policy acknowledgments they owe, each opening its own screen. Owner: APP-WORK.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { space, useTheme } from '../../theme';
import { fetchAcknowledgments, fetchApprovals } from '../api';
import { formatDate, formatDue } from '../format';
import { useLoad, useOnForeground } from '../hooks';
import { acknowledgmentHref, approvalHref } from '../navigate';
import { Body, Button, Chip, ListRow, Loading, Notice, Segmented } from '../ui';

export const TEXT = {
  title: 'Approvals',
  tabs: 'Show',
  approvals: 'Approvals',
  acknowledgments: 'Acknowledgments',
  refresh: 'Refresh',
  loadingApprovals: 'Loading approvals',
  loadingAcks: 'Loading acknowledgments',
  noApprovals: 'No approvals are waiting for you.',
  noAcks: 'No policies are waiting for your acknowledgment.',
  step: (step: string, position: number, total: number) => `Step ${position + 1} of ${total}: ${step}`,
  requestedBy: (name: string) => `Asked by ${name}`,
  onBehalfOf: (name: string) => `Standing in for ${name}`,
  due: (when: string) => `Due ${when}`,
  overdue: 'Overdue',
  version: (n: number) => `Version ${n}`,
  ackDue: (when: string) => `Acknowledge by ${when}`,
};

type Show = 'approvals' | 'acknowledgments';

export default function ApprovalsScreen({ show: initial }: { show?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const [show, setShow] = useState<Show>(initial === 'acknowledgments' ? 'acknowledgments' : 'approvals');
  const approvals = useLoad(fetchApprovals, [], { auto: false });
  const acks = useLoad(fetchAcknowledgments, [], { auto: false });

  const refresh = useCallback(() => {
    void approvals.reload(true);
    void acks.reload(true);
  }, [approvals.reload, acks.reload]);
  useFocusEffect(refresh);
  useOnForeground(refresh);

  const current = show === 'approvals' ? approvals : acks;
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={current.refreshing} onRefresh={refresh} tintColor={colors.brand} />}
    >
      <Segmented
        label={TEXT.tabs}
        value={show}
        onChange={setShow}
        options={[
          { key: 'approvals', label: approvals.data ? `${TEXT.approvals} (${approvals.data.length})` : TEXT.approvals },
          { key: 'acknowledgments', label: acks.data ? `${TEXT.acknowledgments} (${acks.data.length})` : TEXT.acknowledgments },
        ]}
      />
      <Button label={TEXT.refresh} onPress={refresh} busy={current.refreshing} />
      {current.error ? <Notice>{current.error}</Notice> : null}

      {show === 'approvals' ? (
        <>
          {!approvals.data && (approvals.loading || approvals.refreshing) ? <Loading label={TEXT.loadingApprovals} /> : null}
          {approvals.data?.length === 0 ? <Body muted>{TEXT.noApprovals}</Body> : null}
          {(approvals.data ?? []).map((a) => (
            <ListRow
              key={a.step_id}
              title={[a.record_ref, a.record_title].filter(Boolean).join(' ')}
              details={[
                `${a.kind_label ?? a.workflow} · ${a.record_type_label}`,
                TEXT.step(a.step, a.position, a.steps_total),
                a.requested_by_name ? TEXT.requestedBy(a.requested_by_name) : null,
                a.on_behalf_of_name ? TEXT.onBehalfOf(a.on_behalf_of_name) : null,
                a.overdue ? TEXT.overdue : a.due_at ? TEXT.due(formatDue(a.due_at)) : null,
              ]}
              right={a.overdue ? <Chip label={TEXT.overdue} color="red" /> : null}
              onPress={() => router.push(approvalHref(a.step_id) as never)}
            />
          ))}
        </>
      ) : (
        <>
          {!acks.data && (acks.loading || acks.refreshing) ? <Loading label={TEXT.loadingAcks} /> : null}
          {acks.data?.length === 0 ? <Body muted>{TEXT.noAcks}</Body> : null}
          {(acks.data ?? []).map((a) => (
            <ListRow
              key={a.id}
              title={[a.policy_ref, a.policy_title].filter(Boolean).join(' ')}
              details={[TEXT.version(a.version), a.state === 'overdue' ? TEXT.overdue : TEXT.ackDue(formatDate(a.due_on))]}
              right={a.state === 'overdue' ? <Chip label={TEXT.overdue} color="red" /> : null}
              onPress={() => router.push(acknowledgmentHref(a.id) as never)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[3] },
});
