// Moving a change's planned window from the calendar (E05-12). Dragging a change proposes a new
// window; the keyboard alternative (focus a change and press M) opens the same dialog with the
// current window. Either way the conflicts are checked again and nothing is saved until confirmed.
import { useEffect, useMemo, useState } from 'react';
import { api, Button, DateTimeField, errorMessage, formatDateTime, Loading, Modal, useDebounced, useToast } from '../../core';
import { Banner, ConflictList } from './bits';
import type { CalendarChange, Conflict } from './types';
import { plural } from './util';

/** Statuses whose planned window may still be moved from the calendar. */
export const MOVABLE = ['draft', 'submitted', 'approved', 'scheduled'];

export interface MoveRequest { change: CalendarChange; start: string; end: string }

const shift = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const HOUR = 3_600_000;

export function MoveDialog({ request, onClose, onMoved }: { request: MoveRequest | null; onClose: () => void; onMoved: () => void }) {
  const toast = useToast();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const change = request?.change ?? null;

  useEffect(() => {
    if (!request) return;
    setStart(request.start);
    setEnd(request.end);
    setProblem('');
    setBusy(false);
  }, [request]);

  const windowKey = useDebounced(`${start}|${end}`, 250);
  const valid = Boolean(start && end && new Date(end) > new Date(start));
  useEffect(() => {
    if (!change) return;
    const [s, e] = windowKey.split('|');
    if (!s || !e || new Date(e) <= new Date(s)) { setConflicts([]); return; }
    let live = true;
    setConflicts(null);
    api.post<{ conflicts: Conflict[] }>('/api/changes/conflicts/check', {
      planned_start: s, planned_end: e, system_ids: change.systems.map((x) => x.id), exclude_id: change.id,
    }).then((r) => { if (live) setConflicts(r.conflicts); }, () => { if (live) setConflicts([]); });
    return () => { live = false; };
  }, [windowKey, change]);

  const moved = useMemo(() => Boolean(change) && (start !== change!.planned_start || end !== change!.planned_end), [change, start, end]);
  const nudge = (ms: number) => { setStart(shift(start, ms)); setEnd(shift(end, ms)); };

  async function save() {
    if (!change) return;
    if (!valid) { setProblem('The planned end must be after the planned start.'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/changes/${change.id}`, { planned_start: start, planned_end: end });
      toast.success(`${change.ref} moved to ${formatDateTime(start)}.`);
      onMoved();
    } catch (err) {
      setProblem(errorMessage(err));
      setBusy(false);
    }
  }

  const open = conflicts?.filter((c) => !c.acknowledged) ?? [];
  return (
    <Modal open={request !== null} title={change ? `Move ${change.ref}` : 'Move change'} size="md" onClose={onClose}
      dirty={request !== null && (start !== request.start || end !== request.end)}>
      {change && (
        <div className="form">
          <p className="chg-move-title"><strong>{change.title}</strong></p>
          <p className="muted chg-move-from">Planned now: {formatDateTime(change.planned_start)} to {formatDateTime(change.planned_end)}</p>
          <div className="grid-2">
            <DateTimeField label="New planned start" required value={start}
              onChange={(v) => {
                // Moving the start keeps the length of the window.
                if (v && start && end) setEnd(shift(end, new Date(v).getTime() - new Date(start).getTime()));
                setStart(v);
              }} />
            <DateTimeField label="New planned end" required value={end} onChange={setEnd} error={valid || !start || !end ? undefined : 'The planned end must be after the planned start.'} />
          </div>
          <div className="row chg-move-nudge" role="group" aria-label="Move by">
            <Button size="sm" onClick={() => nudge(-24 * HOUR)}>1 day earlier</Button>
            <Button size="sm" onClick={() => nudge(-HOUR)}>1 hour earlier</Button>
            <Button size="sm" onClick={() => nudge(HOUR)}>1 hour later</Button>
            <Button size="sm" onClick={() => nudge(24 * HOUR)}>1 day later</Button>
          </div>
          <div aria-live="polite">
            {!valid ? null : conflicts === null ? <Loading lines={1} label="Checking for conflicts" />
              : open.length === 0 ? <Banner tone="success">No blackout period or other change to the same systems clashes with the new window.</Banner>
              : (
                <>
                  <Banner tone="warn">{plural(open.length, 'conflict')} with the new window. You can still move it; the conflict then shows on the change until it is resolved or acknowledged.</Banner>
                  <ConflictList conflicts={open} currentChangeId={change.id} />
                </>
              )}
          </div>
          {['approved', 'scheduled'].includes(change.status) && (
            <Banner>This change is already approved. Moving it keeps the approvals; tell the approvers if the new time matters to them.</Banner>
          )}
          {problem && <p className="field-error" role="alert">{problem}</p>}
          <div className="form-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!moved || !valid} onClick={save}>Move change</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
