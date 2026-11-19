import { useState, type FormEvent, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { Checkbox as MCheckbox, Popover, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import {
  api, Button, DateField, errorMessage, formatDate, Icon, InlinePopups, LookupChip, useAuth, useLookup, useMeta, UserPicker, useToast,
} from '../../core';
import type { Row } from '../../core';
import { actionPath, ActionStatus, isOverdue } from './ActionStatus';
import { daysUntil } from './scales';

const DONE = 'done';

/** Round tick that completes an action (or reopens a finished one) in one click. */
function CompleteToggle({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const toast = useToast();
  const statuses = useLookup('action_status');
  const [busy, setBusy] = useState(false);
  const done = row.status === DONE;
  if (!statuses.some((s) => s.value === DONE)) return null;
  const label = done ? `Reopen ${row.ref ?? 'action'}` : `Mark ${row.ref ?? 'action'} done`;
  const toggle = async () => {
    setBusy(true);
    try {
      await api.patch(actionPath(row), { status: done ? 'open' : DONE });
      toast.success(done ? `${row.ref ?? 'Action'} reopened.` : `${row.ref ?? 'Action'} done.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip label={done ? 'Reopen' : 'Mark done'}>
      <UnstyledButton className={`rk-tick${done ? ' is-done' : ''}`} aria-label={label} aria-pressed={done} disabled={busy} onClick={toggle}>
        <Icon name="check" size={14} />
      </UnstyledButton>
    </Tooltip>
  );
}

/** The owner's name as a button that opens a picker, so an action can be reassigned from its row. */
function OwnerCell({ row, editable, onChanged }: { row: Row; editable: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const name = row._display?.owner_id;
  if (!editable) return name ? <span>{name}</span> : <span className="muted">Unassigned</span>;
  const assign = async (id: string | null) => {
    setOpen(false);
    if ((id ?? null) === (row.owner_id ?? null)) return;
    try {
      const saved = await api.patch<Row>(actionPath(row), { owner_id: id });
      toast.success(id ? `${row.ref ?? 'Action'} assigned to ${saved._display?.owner_id ?? 'the new owner'}.` : `${row.ref ?? 'Action'} is now unassigned.`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" shadow="md" width={280} trapFocus withinPortal>
      <Popover.Target>
        <UnstyledButton className={`rk-owner${name ? '' : ' is-empty'}`} aria-label={`Owner of ${row.ref ?? row.title}: ${name ?? 'unassigned'}. Change`} onClick={() => setOpen((v) => !v)}>
          <Icon name="user" size={14} />
          <span className="truncate">{name ?? 'Unassigned'}</span>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <InlinePopups>
          <UserPicker label="Owner" value={row.owner_id ?? null} display={name} placeholder="Search people" onChange={(id) => void assign(id)} />
        </InlinePopups>
      </Popover.Dropdown>
    </Popover>
  );
}

export interface ActionRowsProps {
  rows: Row[];
  /** Today as `YYYY-MM-DD` in the organization's time zone. */
  today: string;
  openStatuses?: string[];
  /** Called after any row changes, to reload. */
  onChanged: () => void;
  /** Accessible name of the table. */
  caption: string;
  /** Columns beyond tick, action, owner, due and status. */
  show?: { priority?: boolean; source?: boolean; owner?: boolean };
  /** With both, each row has a checkbox for bulk changes. */
  selected?: Set<string>;
  onSelect?: (next: Set<string>) => void;
}

/**
 * Actions as compact rows: tick to complete, title, owner (reassign in place), due date with
 * overdue emphasis, and status. Used by the tracker's groups, "My actions" and `ActionsPanel`.
 */
export function ActionRows({ rows, today, openStatuses, onChanged, caption, show = {}, selected, onSelect }: ActionRowsProps) {
  const { can } = useAuth();
  const { resources } = useMeta();
  const canEdit = can('actions.edit');
  const selectable = Boolean(selected && onSelect && canEdit);
  const showOwner = show.owner !== false;
  const allPicked = selectable && rows.length > 0 && rows.every((r) => selected!.has(r.id));
  const somePicked = selectable && rows.some((r) => selected!.has(r.id));
  const pick = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onSelect!(next);
  };

  return (
    <div className="table-wrap rk-actions-wrap">
      <table className="table rk-actions">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="rk-col-pick">
                <MCheckbox size="xs" aria-label={`Select all in ${caption}`} checked={allPicked} indeterminate={!allPicked && somePicked} onChange={(e) => pick(rows.map((r) => r.id), e.currentTarget.checked)} />
              </th>
            )}
            <th scope="col" className="rk-col-tick" aria-label="Done" />
            <th scope="col">Action</th>
            {showOwner && <th scope="col" className="rk-col-owner">Owner</th>}
            <th scope="col" className="rk-col-due">Due</th>
            {show.priority && <th scope="col" className="rk-col-extra">Priority</th>}
            {show.source && <th scope="col" className="rk-col-extra">Source</th>}
            <th scope="col" className="rk-col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const overdue = isOverdue(row, today, openStatuses);
            const days = daysUntil(row.due_on);
            const closed = openStatuses ? !openStatuses.includes(row.status) : Boolean(row.completed_on) || row.status === 'cancelled';
            const target = row.source_type ? resources[row.source_type] : undefined;
            const href = row.shared ? undefined : `/actions/${row.id}`;
            return (
              <tr key={row.id} className={`${overdue ? 'is-overdue-row' : ''}${closed ? ' is-closed-row' : ''}`}>
                {selectable && (
                  <td className="rk-col-pick">
                    <MCheckbox size="xs" aria-label={`Select ${row.ref ?? row.title}`} checked={selected!.has(row.id)} onChange={(e) => pick([row.id], e.currentTarget.checked)} />
                  </td>
                )}
                <td className="rk-col-tick">{canEdit && <CompleteToggle row={row} onChanged={onChanged} />}</td>
                <td className="rk-col-title">
                  {href ? <Link to={href} className="rk-action-title">{row.title}</Link> : <span className="rk-action-title">{row.title}</span>}
                  <span className="rk-action-sub">
                    <span className="ref">{row.ref}</span>
                    {row.shared && <span className="chip chip-purple"><Icon name="lock" size={12} /> Shared with you</span>}
                    {!row.shared && row.restricted && <Tooltip label="Restricted: visible only to people with access to security records"><span className="rk-lock"><Icon name="lock" size={12} label="Restricted" /></span></Tooltip>}
                    {row.department && <span className="muted">{row.department}</span>}
                    {!show.priority && row.priority === 'high' && <LookupChip list="action_priority" value={row.priority} />}
                  </span>
                </td>
                {showOwner && <td className="rk-col-owner"><OwnerCell row={row} editable={canEdit && !row.shared} onChanged={onChanged} /></td>}
                <td className="rk-col-due">
                  {row.due_on ? (
                    <>
                      <span className={overdue ? 'is-overdue' : undefined}>{formatDate(row.due_on)}</span>
                      {overdue && days !== null && <span className="rk-due-note is-overdue">{-days} {days === -1 ? 'day' : 'days'} overdue</span>}
                      {!overdue && !closed && days !== null && days <= 7 && <span className="rk-due-note">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>}
                    </>
                  ) : <span className="muted">No date</span>}
                </td>
                {show.priority && <td className="rk-col-extra"><LookupChip list="action_priority" value={row.priority} /></td>}
                {show.source && (
                  <td className="rk-col-extra">
                    <LookupChip list="action_source" value={row.source} />
                    {target && row.source_id && <Link className="rk-arose" to={`${target.route}/${row.source_id}`}>Open {target.label.toLowerCase()}</Link>}
                  </td>
                )}
                <td className="rk-col-status"><ActionStatus row={row} onChanged={onChanged} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One line to add an action: type a title, optionally a due date, press Enter. */
export function QuickAdd({ initial, onAdded, placeholder = 'Add an action and press Enter', inputRef, withDue = true }: {
  /** Hidden values for the new action, e.g. its source record or owner. */
  initial?: Record<string, unknown>;
  onAdded: (row: Row) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  withDue?: boolean;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const row = await api.post<Row>('/api/actions', { ...initial, title: title.trim(), ...(due ? { due_on: due } : {}) });
      toast.success(`${row.ref ?? 'Action'} added.`);
      setTitle('');
      setDue('');
      onAdded(row);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="rk-quick" onSubmit={submit}>
      <TextInput
        ref={inputRef} className="rk-quick-title" size="sm" aria-label="New action" placeholder={placeholder} value={title} maxLength={300}
        leftSection={<Icon name="plus" size={16} />} onChange={(e) => setTitle(e.currentTarget.value)}
      />
      {withDue && <DateField hideLabel label="Due date of the new action" placeholder="Due date" className="rk-quick-due" value={due} onChange={setDue} />}
      <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>Add</Button>
    </form>
  );
}
