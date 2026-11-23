// The "Find by tag number" box (E37-05): typed, or a keyboard-mode handheld scanner's value and Enter;
// opens /asset-tags/find?value=. Owner: TAGS-LOOKUP. Shown on inventory lists through ListActions.tsx,
// and at the top of the tag card page.
//
// A handheld scanner in keyboard mode "types" the value it decoded, much faster than a person, and then
// presses Enter. The box tells the two apart by the time between key presses, so the lookup log can say
// how the value arrived (`source=handheld`); either way Enter opens the tag card.
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, cx } from '../../core';
import type { ListActionProps } from '../inventory/Extensions';
import './lookup.css';

/** Average milliseconds between key presses under which typing is taken to be a scanner. */
const SCANNER_MS = 35;
/** Fewest characters for that judgment (a short value typed fast is still typing). */
const SCANNER_MIN = 4;

export type FindSource = 'typed' | 'handheld';

/** Watches key presses in one input and says whether its value came from a handheld scanner. */
export function useScannerTiming() {
  const times = useRef<number[]>([]);
  return {
    onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.currentTarget.value) times.current = [];
        times.current.push(e.timeStamp || performance.now());
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        times.current = [];
      }
    },
    source(): FindSource {
      const t = times.current;
      if (t.length < SCANNER_MIN) return 'typed';
      return (t[t.length - 1] - t[0]) / (t.length - 1) < SCANNER_MS ? 'handheld' : 'typed';
    },
    reset() { times.current = []; },
  };
}

/** The address of the tag card page for a value. */
export function findPath(value: string, source: FindSource = 'typed'): string {
  const p = new URLSearchParams({ value: value.trim() });
  if (source === 'handheld') p.set('source', 'handheld');
  return `/asset-tags/find?${p.toString()}`;
}

/**
 * A labeled box with a Find button. `onFind` gets the value and how it was entered; without it the
 * box opens the tag card page.
 */
export function TagFindForm({ initial = '', autoFocus, compact, onFind, label = 'Find by tag number' }: {
  initial?: string; autoFocus?: boolean; compact?: boolean; label?: string; onFind?: (value: string, source: FindSource) => void;
}) {
  const navigate = useNavigate();
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const timing = useScannerTiming();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) { setError('Type or scan a tag number.'); return; }
    setError('');
    const source = timing.source();
    timing.reset();
    if (onFind) onFind(v, source); else navigate(findPath(v, source));
    if (compact) setValue('');
  };
  return (
    <form className={cx('tag-find', compact && 'tag-find-compact')} role="search" aria-label={label} onSubmit={submit} noValidate>
      {/* The page's heading already says "Find by tag number": the box itself is the tag number (E18-64). */}
      <label htmlFor={id} className={compact ? 'sr-only' : 'field-label'}>{compact ? label : 'Tag number'}</label>
      <div className="tag-find-row">
        <input
          id={id} className="input tag-find-input" value={value} autoFocus={autoFocus} autoComplete="off" spellCheck={false}
          autoCapitalize="characters" enterKeyHint="search" maxLength={2000}
          placeholder={compact ? 'Tag number' : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
          onKeyDown={timing.onKeyDown}
          onChange={(e) => { setValue(e.currentTarget.value); if (error) setError(''); }}
        />
        <Button type="submit" variant={compact ? 'secondary' : 'primary'} icon="search">{compact ? 'Find tag' : 'Find'}</Button>
      </div>
      {error && <p id={`${id}-err`} className="field-error" role="alert">{error}</p>}
    </form>
  );
}

/** The list action: a compact box beside the buttons of the asset, site, system and vehicle lists. */
export function FindByTagBox(_props: ListActionProps) {
  return <TagFindForm compact />;
}

/** A small tag icon with the value, used on cards and lists. */
export function TagValue({ value }: { value: string }) {
  return <span className="tag-value"><Icon name="tag" size={14} />{value}</span>;
}
