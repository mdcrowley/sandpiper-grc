// Dragging a change on the calendar (E05-12). Times are moved as wall-clock times in the
// organization's time zone, so a change moved across a daylight-saving switch keeps its hour.
import type { DragEvent, KeyboardEvent } from 'react';
import { fromZonedInput, toZonedInput } from '../../core';
import type { MoveRequest } from './MoveDialog';
import type { CalendarChange } from './types';
import { addDays, dayOf } from './util';

/** What is being dragged: the change, the day it was picked up from and where on it the pointer was. */
export interface DragState { change: CalendarChange; fromDay: string; grabY: number }

export interface MoveProps {
  /** Present when the person may move changes: called with the proposed window. */
  onMove?: (request: MoveRequest) => void;
  /** Whether this change can be moved (status and permission). */
  canMove?: (c: CalendarChange) => boolean;
}

/** Moves an instant by whole calendar days, keeping its wall-clock time. */
export function shiftDays(iso: string, days: number): string {
  const local = toZonedInput(iso);
  return fromZonedInput(`${addDays(local.slice(0, 10), days)}T${local.slice(11, 16)}`);
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The window a change would have if dropped on another day of the month view. */
export function dropOnDay(drag: DragState, day: string): MoveRequest | null {
  const days = dayDiff(drag.fromDay, day);
  if (days === 0) return null;
  return { change: drag.change, start: shiftDays(drag.change.planned_start, days), end: shiftDays(drag.change.planned_end, days) };
}

/** The window a change would have if dropped at `minute` (after midnight) of `day` in the week view. */
export function dropAt(drag: DragState, day: string, minute: number): MoveRequest | null {
  const snapped = Math.min(24 * 60 - 15, Math.max(0, Math.round(minute / 15) * 15));
  const hh = String(Math.floor(snapped / 60)).padStart(2, '0');
  const mm = String(snapped % 60).padStart(2, '0');
  const start = fromZonedInput(`${day}T${hh}:${mm}`);
  if (start === drag.change.planned_start) return null;
  const length = Date.parse(drag.change.planned_end) - Date.parse(drag.change.planned_start);
  return { change: drag.change, start, end: new Date(Date.parse(start) + length).toISOString() };
}

/** Props that make one change on the calendar draggable and movable with the M key. */
export function movableProps(c: CalendarChange, day: string, move: MoveProps, setDrag: (d: DragState | null) => void) {
  if (!move.onMove || !move.canMove?.(c)) return {};
  const onMove = move.onMove;
  return {
    draggable: true,
    'aria-keyshortcuts': 'M',
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.ref);
      const rect = e.currentTarget.getBoundingClientRect();
      // In the week view the block's top is the start time, unless the change began on an earlier day.
      const startsHere = dayOf(c.planned_start) === day;
      setDrag({ change: c, fromDay: day, grabY: startsHere ? e.clientY - rect.top : 0 });
    },
    onDragEnd: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onMove({ change: c, start: c.planned_start, end: c.planned_end });
      }
    },
  };
}
