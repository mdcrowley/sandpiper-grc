// The Customize panel: which widgets show and in what order. No dragging: every row has a
// switch and Move up / Move down buttons, so it works the same with a keyboard.
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, IconButton, Switch } from '../../core';
import { GROUP_LABELS } from './registry';
import type { WidgetDef, WidgetGroup } from './types';

const GROUPS: WidgetGroup[] = ['mywork', 'dashboard'];

export interface CustomizeResult {
  /** The ids of the widgets offered, in the order chosen. */
  order: string[];
  /** Those of them switched off. */
  hidden: string[];
}

export function CustomizeDialog({ open, widgets, order, hidden, onSave, onClose }: {
  open: boolean;
  /** The widgets this person can have, in default order. */
  widgets: WidgetDef[];
  /** Their ids in the order now on screen. */
  order: string[];
  hidden: string[];
  onSave: (result: CustomizeResult) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(order);
  const [off, setOff] = useState<string[]>(hidden);
  const [said, setSaid] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  // Start from what is on screen each time the panel opens.
  useEffect(() => {
    if (!open) return;
    setDraft(order);
    setOff(hidden);
    setSaid('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A moved row keeps the keyboard focus; at the end of the list focus goes to the other button.
  useEffect(() => {
    const want = refocus.current;
    refocus.current = null;
    if (!want || !listRef.current) return;
    const row = listRef.current.querySelector(`[data-widget="${want.id}"]`);
    const button = (dir: string) => row?.querySelector<HTMLButtonElement>(`[data-move="${dir}"]`);
    const first = button(want.dir);
    (first && !first.disabled ? first : button(want.dir === 'up' ? 'down' : 'up'))?.focus();
  }, [draft]);

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const inGroup = (group: WidgetGroup) => draft.filter((id) => byId.get(id)?.group === group);

  function move(id: string, dir: 'up' | 'down') {
    const widget = byId.get(id);
    if (!widget) return;
    const peers = inGroup(widget.group);
    const at = peers.indexOf(id);
    const other = peers[at + (dir === 'up' ? -1 : 1)];
    if (!other) return;
    const next = [...draft];
    const a = next.indexOf(id);
    const b = next.indexOf(other);
    [next[a], next[b]] = [next[b], next[a]];
    refocus.current = { id, dir };
    setDraft(next);
    setSaid(`${widget.title} moved ${dir}, now ${at + (dir === 'up' ? 0 : 2)} of ${peers.length}.`);
  }

  function reset() {
    setDraft(widgets.map((w) => w.id));
    setOff([]);
    setSaid('Default layout restored. Select Save to keep it.');
  }

  const changed = draft.join('|') !== order.join('|') || [...off].sort().join('|') !== [...hidden].sort().join('|');
  const isDefault = off.length === 0 && draft.join('|') === widgets.map((w) => w.id).join('|');

  return (
    <Drawer
      open={open}
      title="Customize the overview"
      onClose={onClose}
      dirty={open && changed}
      footer={(
        <div className="home-cz-foot">
          <Button variant="ghost" icon="refresh" onClick={reset} disabled={isDefault}>Reset to default</Button>
          <span className="home-cz-foot-end">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave({ order: draft, hidden: off })} disabled={!changed}>Save</Button>
          </span>
        </div>
      )}
    >
      <div className="home-cz" ref={listRef}>
        <p className="muted">
          Choose what the overview shows and in what order. The layout is yours alone and is remembered in this browser.
        </p>
        {GROUPS.map((group) => {
          const ids = inGroup(group);
          if (ids.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`home-cz-${group}`}>
              <h3 className="home-cz-group" id={`home-cz-${group}`}>{GROUP_LABELS[group]}</h3>
              <ol className="home-cz-list">
                {ids.map((id, index) => {
                  const widget = byId.get(id)!;
                  return (
                    <li key={id} className="home-cz-row" data-widget={id}>
                      <Switch
                        className="home-cz-switch"
                        label={widget.title}
                        hint={widget.description}
                        checked={!off.includes(id)}
                        onChange={(on) => setOff((prev) => (on ? prev.filter((x) => x !== id) : [...prev.filter((x) => x !== id), id]))}
                      />
                      <span className="home-cz-moves">
                        <IconButton icon="arrow-up" size="sm" label={`Move up: ${widget.title}`} data-move="up"
                          disabled={index === 0} onClick={() => move(id, 'up')} />
                        <IconButton icon="arrow-down" size="sm" label={`Move down: ${widget.title}`} data-move="down"
                          disabled={index === ids.length - 1} onClick={() => move(id, 'down')} />
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
        <p className="sr-only" role="status" aria-live="polite">{said}</p>
      </div>
    </Drawer>
  );
}
