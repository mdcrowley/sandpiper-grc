// Global search as a command palette: records (grouped by type), "Go to" pages, Create actions
// and recent searches in one keyboard-driven list. Opened from the top bar, "/" or Ctrl+K.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Modal } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { qs } from './api';
import { useDebounced, useFetch } from './hooks';
import { Icon, type IconName } from './Icon';
import { useAuth } from './auth';
import { recordHref } from './meta';
import { cx } from './ui';

export interface PaletteLink {
  label: string;
  path: string;
  icon?: IconName;
  /** Navigation group, shown beside the label. */
  group?: string;
}

interface SearchHit {
  type: string;
  typeLabel: string;
  id: string;
  label: string;
  ref: string | null;
  route: string;
  /** Where the words were found (newer servers): the record itself, a comment or an attached file's name. */
  matched?: 'record' | 'comment' | 'attachment';
  /** A short passage around the match, in pieces with the matching words marked. */
  snippetParts?: { text: string; match: boolean }[];
  snippet?: string;
}

interface Entry {
  key: string;
  section: string;
  icon: IconName;
  label: string;
  reference?: string | null;
  hint?: string;
  /** A passage under the label with the matched words highlighted. */
  snippet?: { text: string; match: boolean }[];
  run: () => void;
}

/**
 * Entries an optional module offers for what is typed (wave 13): a module ships
 * `web/src/modules/<module>/PaletteProvider.ts` exporting `paletteProvider`. Its entries come first, in their
 * own section, and are left out while its area is off or without its permission. `entries` must be quick
 * and must not fetch: it runs on every key press (the asset tags provider offers "Find tag number <text>").
 */
export interface PaletteEntry { key: string; label: string; path: string; icon?: IconName; hint?: string; section?: string }
export interface PaletteProvider {
  key: string;
  area?: string;
  permission?: string;
  entries: (text: string) => PaletteEntry[];
}
const PROVIDERS: PaletteProvider[] = Object.values(import.meta.glob<{ paletteProvider?: PaletteProvider }>('../modules/*/PaletteProvider.ts', { eager: true }))
  .map((m) => m.paletteProvider).filter((p): p is PaletteProvider => Boolean(p));

const MAX_RECENT = 6;

function readRecent(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export interface CommandPaletteProps {
  opened: boolean;
  onClose: () => void;
  pages: PaletteLink[];
  create: PaletteLink[];
  /** Keeps each user's recent searches apart. */
  userId: string;
}

export function CommandPalette({ opened, onClose, pages, create, userId }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { areaOn, can } = useAuth();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const recentKey = `grc.search.recent.${userId}`;
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const typed = text.trim();
  const q = useDebounced(typed, 220);
  const searching = opened && q.length >= 2;
  const { data, loading, error } = useFetch<SearchHit[]>(searching ? `/api/search${qs({ q })}` : null);

  useEffect(() => {
    if (!opened) return;
    setText('');
    setActive(0);
    setRecent(readRecent(recentKey));
  }, [opened, recentKey]);

  const entries = useMemo<Entry[]>(() => {
    const go = (path: string, remember = false) => () => {
      if (remember && typed.length >= 2) {
        const next = [typed, ...readRecent(recentKey).filter((r) => r.toLowerCase() !== typed.toLowerCase())].slice(0, MAX_RECENT);
        try {
          localStorage.setItem(recentKey, JSON.stringify(next));
        } catch {
          // Storage unavailable: recent searches are simply not kept.
        }
      }
      onClose();
      navigate(path);
    };
    const needle = typed.toLowerCase();
    const out: Entry[] = [];

    if (!needle) {
      recent.forEach((r) => out.push({ key: `recent-${r}`, section: 'Recent searches', icon: 'history', label: r, run: () => setText(r) }));
      create.slice(0, 8).forEach((c) => out.push({ key: `create-${c.path}`, section: 'Create', icon: c.icon ?? 'plus', label: `New ${c.label.toLowerCase()}`, run: go(c.path) }));
      return out;
    }

    PROVIDERS.filter((p) => (!p.area || areaOn(p.area)) && (!p.permission || can(p.permission)))
      .flatMap((p) => p.entries(typed).slice(0, 3).map((e) => ({ ...e, key: `${p.key}-${e.key}` })))
      .forEach((e) => out.push({ key: `provider-${e.key}`, section: e.section ?? 'Find', icon: e.icon ?? 'search', label: e.label, hint: e.hint, run: go(e.path, true) }));

    pages
      .filter((p) => p.label.toLowerCase().includes(needle) || (p.group ?? '').toLowerCase().includes(needle))
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(needle)) - Number(a.label.toLowerCase().startsWith(needle)))
      .slice(0, 6)
      .forEach((p) => out.push({ key: `page-${p.path}`, section: 'Go to', icon: p.icon ?? 'arrow-right', label: p.label, hint: p.group, run: go(p.path) }));

    const wantsNew = ['new', 'create', 'add'].some((w) => w.startsWith(needle) || needle.startsWith(w));
    create
      .filter((c) => wantsNew || c.label.toLowerCase().includes(needle.replace(/^(new|create|add)\s+/, '')))
      .slice(0, 5)
      .forEach((c) => out.push({ key: `create-${c.path}`, section: 'Create', icon: c.icon ?? 'plus', label: `New ${c.label.toLowerCase()}`, run: go(c.path) }));

    // Records, grouped by type in the order the server returned them.
    const hits = q === typed ? data ?? [] : [];
    const types = [...new Set(hits.map((h) => h.typeLabel))];
    types.forEach((typeLabel) => hits.filter((h) => h.typeLabel === typeLabel).forEach((h) => out.push({
      key: `hit-${h.type}-${h.id}`, section: typeLabel, icon: h.matched === 'comment' ? 'message' : h.matched === 'attachment' ? 'paperclip' : 'file-text',
      label: h.label, reference: h.ref,
      hint: h.matched === 'comment' ? 'In a comment' : h.matched === 'attachment' ? 'In a file name' : undefined,
      snippet: h.snippetParts?.length ? h.snippetParts : h.snippet ? [{ text: h.snippet, match: false }] : undefined,
      run: go(recordHref(h.route, h.id), true),
    })));
    return out;
  }, [typed, q, data, recent, pages, create, recentKey, navigate, onClose, areaOn, can]);

  useEffect(() => setActive(0), [typed, data]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    const move: Record<string, number | undefined> = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + 6, PageUp: active - 6 };
    if (e.key in move && entries.length > 0) {
      e.preventDefault();
      const next = move[e.key] as number;
      setActive(e.key.startsWith('Page') ? Math.min(entries.length - 1, Math.max(0, next)) : (next + entries.length) % entries.length);
    } else if (e.key === 'Enter' && entries[active]) {
      e.preventDefault();
      entries[active].run();
    }
  };

  const waiting = typed.length >= 2 && (q !== typed || (loading && !data));
  let status = '';
  if (!typed && entries.length === 0) status = 'Type to search every record you can see, or the name of a page.';
  else if (typed.length === 1 && entries.length === 0) status = 'Keep typing: two letters or more.';
  else if (typed.length >= 2 && error) status = 'Record search is unavailable right now.';
  else if (waiting) status = 'Searching…';
  else if (typed.length >= 2 && entries.length === 0) status = `Nothing matches “${typed}”. Try a reference, a name or fewer words.`;

  const sections = [...new Set(entries.map((e) => e.section))];

  return (
    <Modal.Root opened={opened} onClose={onClose} size={640} centered={false} yOffset="9vh" padding={0} trapFocus returnFocus>
      <Modal.Overlay />
      <Modal.Content aria-label="Search and go to" className="palette" radius="lg">
        <Modal.Body className="palette-body">
          <div className="palette-input-row">
            <Icon name="search" size={20} />
            <input
              className="palette-input"
              type="text"
              role="combobox"
              aria-label="Search records, pages and actions"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={entries[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              placeholder="Search records, or type a page name…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd className="kbd">Esc</kbd>
          </div>
          <div className="palette-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
            {sections.map((section) => (
              <div key={section} role="group" aria-label={section} className="palette-group">
                <p className="palette-heading" aria-hidden="true">{section}</p>
                {entries.map((entry, i) => entry.section !== section ? null : (
                  <div
                    key={entry.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cx('palette-option', i === active && 'palette-option-active')}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={entry.run}
                  >
                    <Icon name={entry.icon} size={17} />
                    <span className="palette-label">
                      <span className="palette-title">
                        {entry.reference && <span className="ref">{entry.reference}</span>}
                        {entry.label}
                      </span>
                      {entry.snippet && (
                        <span className="palette-snippet">
                          {entry.snippet.map((p, j) => (p.match ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
                        </span>
                      )}
                    </span>
                    {entry.hint && <span className="palette-hint">{entry.hint}</span>}
                    <Icon name="enter" size={14} className="palette-enter" />
                  </div>
                ))}
              </div>
            ))}
            {status && <p className="palette-status" role="status">{status}</p>}
          </div>
          <div className="palette-foot" aria-hidden="true">
            <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> to move</span>
            <span><kbd className="kbd">Enter</kbd> to open</span>
            <span><kbd className="kbd">/</kbd> or <kbd className="kbd">Ctrl K</kbd> to search from anywhere</span>
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
