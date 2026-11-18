import { useState } from 'react';
import { api, errorMessage, LookupChip, LookupSelect, useAuth, useToast } from '../../core';
import type { Row } from '../../core';

/** Status of one action, changeable in place by people who may edit actions. */
export function ActionStatus({ row, onChanged }: { row: Row; onChanged?: (saved: Row) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<string>(row.status ?? '');
  const [busy, setBusy] = useState(false);

  if (!can('actions.edit')) return <LookupChip list="action_status" value={status} />;

  const change = async (next: string) => {
    if (!next || next === status) return;
    const previous = status;
    setStatus(next);
    setBusy(true);
    try {
      const saved = await api.patch<Row>(`/api/actions/${row.id}`, { status: next });
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
      <LookupSelect hideLabel label={`Status of ${row.ref ?? row.title}`} list="action_status" value={status} disabled={busy} onChange={change} />
    </span>
  );
}

/** True when an action is past its due date and not finished. */
export function isOverdue(row: Row, today: string, openStatuses?: string[]): boolean {
  if (!row.due_on || row.due_on >= today) return false;
  return openStatuses ? openStatuses.includes(row.status) : !row.completed_on;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
