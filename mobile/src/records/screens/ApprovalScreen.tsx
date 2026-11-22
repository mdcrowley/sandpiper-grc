// One approval waiting for the person (E38-08): what is being approved, then approve or reject with a
// reason. The server applies the workflow engine's rules unchanged (distinct approvers, the approver
// permission checked again, the person who asked never deciding); a step that wants a recent sign-in
// (403 `reauth_required`) is confirmed through the browser sign-in and sent once more. Owner: APP-WORK.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { space, useTheme } from '../../theme';
import { decide, errorText, fetchApprovals, fetchRecord, loadMeta } from '../api';
import { displayValue, formatDue } from '../format';
import { useLoad } from '../hooks';
import { isRestricted, layoutFor } from '../layouts';
import { recordHref } from '../navigate';
import { ReauthCanceled, withReauth } from '../reauth';
import { useSecureScreen } from '../secure';
import type { ApprovalItem } from '../types';
import { Body, Button, Card, FieldRow, Heading, Loading, Notice, TextField } from '../ui';

export const TEXT = {
  loading: 'Loading the approval',
  gone: 'This approval is no longer waiting for you. Someone may have decided it, or you may no longer be able to decide it.',
  workflow: 'Workflow',
  step: 'Step',
  stepOf: (step: string, position: number, total: number) => `${step} (${position + 1} of ${total})`,
  requestedBy: 'Asked by',
  onBehalfOf: 'You stand in for',
  due: 'Due',
  overdue: 'Overdue',
  progress: 'Approvals so far',
  progressValue: (got: number, need: number | null) => (need ? `${got} of ${need}` : String(got)),
  record: 'What is being approved',
  openRecord: 'Open the record',
  reason: 'Reason',
  reasonHint: 'Needed to reject; shown to the person who asked',
  reasonNeeded: 'Give a reason for rejecting.',
  approve: 'Approve',
  reject: 'Reject',
  approved: 'Approved.',
  rejected: 'Rejected.',
  waitingOthers: (got: number, need: number) => `Your approval is recorded. ${got} of ${need} so far.`,
  back: 'Back to approvals',
  reauth: 'Sign in again to decide this approval. Nothing was recorded.',
};

interface Loaded { item: ApprovalItem | null; summary: { label: string; value: string }[]; restricted: boolean; viewable: boolean }

async function loadApproval(stepId: string): Promise<Loaded> {
  const item = (await fetchApprovals()).find((a) => a.step_id === stepId) ?? null;
  if (!item) return { item, summary: [], restricted: false, viewable: false };
  try {
    const meta = await loadMeta();
    const def = meta.resources[item.record_type];
    if (!def) return { item, summary: [], restricted: false, viewable: false };
    const { row } = await fetchRecord(def, item.record_id);
    const layout = layoutFor(def);
    const summary = [...layout.summary, ...layout.key].slice(0, 8)
      .map((n) => ({ label: def.fields[n]?.label ?? n, value: def.fields[n] ? displayValue(n, def.fields[n], row, meta.lookups) : null }))
      .filter((x): x is { label: string; value: string } => Boolean(x.value));
    return { item, summary, restricted: isRestricted(def, row), viewable: true };
  } catch {
    return { item, summary: [], restricted: false, viewable: false };
  }
}

export default function ApprovalScreen({ stepId }: { stepId: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const loaded = useLoad(() => loadApproval(stepId), [stepId]);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useSecureScreen(Boolean(loaded.data?.restricted));

  const send = async (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !reason.trim()) { setReasonError(TEXT.reasonNeeded); return; }
    setReasonError(null);
    setProblem(null);
    setBusy(decision);
    try {
      const result = await withReauth(() => decide(stepId, decision, reason));
      if (decision === 'rejected') setDone(TEXT.rejected);
      else if (result.stepOutcome === 'pending' && result.approvalsRequired) setDone(TEXT.waitingOthers(result.approvalsReceived ?? 0, result.approvalsRequired));
      else setDone(TEXT.approved);
    } catch (err) {
      setProblem(err instanceof ReauthCanceled ? TEXT.reauth : errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const data = loaded.data;
  const item = data?.item ?? null;
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loaded.loading && !data ? <Loading label={TEXT.loading} /> : null}
      {loaded.error ? <Notice>{loaded.error}</Notice> : null}
      {data && !item && !done ? <Notice kind="info">{TEXT.gone}</Notice> : null}
      {item ? (
        <>
          <Body muted>{[item.record_type_label, item.record_ref].filter(Boolean).join(' · ')}</Body>
          <Heading level={1}>{item.record_title || item.record_ref || item.record_type_label}</Heading>
          <Card>
            <FieldRow label={TEXT.workflow} value={item.kind_label ?? item.workflow} />
            <FieldRow label={TEXT.step} value={TEXT.stepOf(item.step, item.position, item.steps_total)} />
            {item.requested_by_name ? <FieldRow label={TEXT.requestedBy} value={item.requested_by_name} /> : null}
            {item.on_behalf_of_name ? <FieldRow label={TEXT.onBehalfOf} value={item.on_behalf_of_name} /> : null}
            {item.due_at ? <FieldRow label={TEXT.due} value={`${formatDue(item.due_at)}${item.overdue ? ` (${TEXT.overdue})` : ''}`} /> : null}
            <FieldRow label={TEXT.progress} value={TEXT.progressValue(item.approvals, item.required)} />
          </Card>
          {data!.summary.length || data!.viewable ? (
            <Card>
              <Heading level={2}>{TEXT.record}</Heading>
              {data!.summary.map((s) => <FieldRow key={s.label} label={s.label} value={s.value} />)}
              {data!.viewable ? <Button kind="link" label={TEXT.openRecord} onPress={() => router.push(recordHref(item.record_type, item.record_id) as never)} /> : null}
            </Card>
          ) : null}
          {done ? null : (
            <View style={styles.decide}>
              <TextField label={TEXT.reason} hint={TEXT.reasonHint} value={reason} onChangeText={setReason} multiline error={reasonError} />
              {problem ? <Notice>{problem}</Notice> : null}
              <View style={styles.buttons}>
                <Button kind="primary" label={TEXT.approve} onPress={() => void send('approved')} busy={busy === 'approved'} disabled={busy !== null} />
                <Button kind="danger" label={TEXT.reject} onPress={() => void send('rejected')} busy={busy === 'rejected'} disabled={busy !== null} />
              </View>
            </View>
          )}
        </>
      ) : null}
      {done ? <Notice kind="success">{done}</Notice> : null}
      {done || (data && !item) ? <Button label={TEXT.back} onPress={() => router.back()} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[4] },
  decide: { gap: space[3] },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
});
