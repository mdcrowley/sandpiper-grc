import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, LookupChip, LookupSelect, todayInZone, useAuth, useLookup, useResource, useToast } from '../../core';
import { allowedStatuses } from '../../core/lifecycle';
import { editableLifecycle } from '../../core/lifecycleMenus';
import type { Row } from '../../core';

/** Where an action is saved: its own route, or the shared route for a restricted action shared with the caller. */
export const actionPath = (row: Row) => (row.shared ? `/api/actions/shared/${row.id}` : `/api/actions/${row.id}`);

/** Status of one action, changeable in place by people who may edit actions. */
export function ActionStatus({ row, onChanged }: { row: Row; onChanged?: (saved: Row) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<string>(row.status ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setStatus(row.status ?? ''), [row.status]);
  // Only the statuses the lifecycle allows from the current one (E14-31).
  const lifecycle = editableLifecycle(useResource('action')?.lifecycle, 'status');
  const values = useLookup('action_status');
  const only = useMemo(() => (lifecycle ? allowedStatuses(lifecycle, status, values.map((v) => v.value)) : undefined), [lifecycle, status, values]);

  if (!can('actions.edit')) return <LookupChip list="action_status" value={status} />;

  const change = async (next: string) => {
    if (!next || next === status) return;
    const previous = status;
    setStatus(next);
    setBusy(true);
    try {
      const saved = await api.patch<Row>(actionPath(row), { status: next });
      toast.success(`${row.ref ?? 'Action'} is now ${saved._display?.status ?? next}.`);
      onChanged?.(saved);
    } catch (err) {
      setStatus(previous);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    // Rows are clickable: keep clicks and key presses on the control from opening the record.
    <span className="inline-status" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <LookupSelect hideLabel required size="xs" label={`Status of ${row.ref ?? row.title}`} list="action_status" only={only} value={status} disabled={busy} onChange={change} />
    </span>
  );
}

/** True when an action is past its due date and not finished. */
export function isOverdue(row: Row, today: string, openStatuses?: string[]): boolean {
  if (!row.due_on || row.due_on >= today) return false;
  return openStatuses ? openStatuses.includes(row.status) : !row.completed_on && row.status !== 'cancelled';
}

/** Today in the organization's time zone, as the server counts it. */
export function localToday(): string {
  return todayInZone();
}
