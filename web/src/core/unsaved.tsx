// Unsaved changes (BW-01, BW-02, BW-03): one guard for every form, page and dialog.
//
// A form says it has unsaved changes with `useUnsavedChanges(dirty)`. Core then:
// - asks "Discard your unsaved changes?" before the application moves to another page (a link, the
//   sidebar, the Create menu, search, Back), and lets the browser ask before the tab is closed or reloaded;
// - keeps the page when the session ends mid-edit (core/session.ts): the person signs in again and the
//   request that failed is sent again, or the form's draft is kept in this tab and comes back after
//   signing in on the sign-in page (`keep`, `takeDraft`).
// A form inside a Modal or Drawer (ResourceForm, or anything calling the hook) also tells that dialog, so
// Escape, × and a click outside ask first; a dialog can pass `dirty` itself instead. A dialog's own Cancel
// is wrapped in `guard(onClose)`. After a successful save, call `release()` before moving on.
//
// `UnsavedChangesHost` is mounted once, under the router (App.tsx, and the component test harness).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from './overlay';

interface Entry { dirty: boolean; released: boolean; keep?: () => void }

const entries = new Set<Entry>();

const unsavedIn = (set: Iterable<Entry>) => { for (const e of set) if (e.dirty && !e.released) return true; return false; };

/** The forms inside one dialog (Modal, Drawer), so closing it asks first when one of them has changes. */
const SheetForms = createContext<Set<Entry> | null>(null);

/** Whether any form on the page has changes that are not saved. */
export function hasUnsavedChanges(): boolean {
  return unsavedIn(entries);
}

/** Asks every form with unsaved changes to keep its draft in this tab (the session ended). */
export function keepDrafts(): void {
  for (const e of entries) if (e.dirty && !e.released) e.keep?.();
}

/* ---------- The confirm prompt ---------- */

export interface DiscardPrompt {
  title?: string;
  message?: string;
  confirmLabel?: string;
}

const DEFAULT_PROMPT: Required<DiscardPrompt> = {
  title: 'Discard your unsaved changes?',
  message: 'What you have entered is not saved yet. If you go on, it is lost.',
  confirmLabel: 'Discard changes',
};

type Ask = (prompt: DiscardPrompt) => Promise<boolean>;
let ask: Ask | null = null;

/**
 * Asks "Discard your unsaved changes?". Resolves true when the person chooses to discard.
 * Without a host (a test that renders a component alone) the browser's own confirm asks.
 */
export function confirmDiscard(prompt: DiscardPrompt = {}): Promise<boolean> {
  if (ask) return ask(prompt);
  return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(prompt.title ?? DEFAULT_PROMPT.title)
    : true);
}

/* ---------- The hook ---------- */

export interface UnsavedChanges {
  /** After a successful save: the changes no longer count, so moving to the saved record is not stopped. */
  release: () => void;
  /** Wraps a close or cancel handler: with unsaved changes it asks first. */
  guard: (onLeave: () => void, prompt?: DiscardPrompt) => () => void;
  /** Resolves true when there is nothing to lose or the person chose to discard it. */
  confirm: (prompt?: DiscardPrompt) => Promise<boolean>;
}

export interface UnsavedChangesOptions {
  /** Keeps the draft (for example in sessionStorage with `keepDraft`) when the session ends mid-edit. */
  keep?: () => void;
}

/** Registers a form's unsaved changes with the shared guard (see the top of this file). */
export function useUnsavedChanges(dirty: boolean, options: UnsavedChangesOptions = {}): UnsavedChanges {
  const entry = useRef<Entry>(null as unknown as Entry);
  if (!entry.current) entry.current = { dirty: false, released: false };
  const keep = useRef(options.keep);
  keep.current = options.keep;
  useLayoutEffect(() => {
    const e = entry.current;
    if (!dirty) e.released = false; // a later edit counts again
    e.dirty = dirty;
    e.keep = () => keep.current?.();
  }, [dirty]);
  const sheet = useContext(SheetForms);
  useEffect(() => {
    const e = entry.current;
    entries.add(e);
    sheet?.add(e);
    return () => { entries.delete(e); sheet?.delete(e); };
  }, [sheet]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const confirm = useCallback(
    (prompt?: DiscardPrompt) => (dirtyRef.current && !entry.current.released ? confirmDiscard(prompt) : Promise.resolve(true)),
    [],
  );
  return useMemo<UnsavedChanges>(() => ({
    release: () => { entry.current.released = true; },
    guard: (onLeave, prompt) => () => { void confirm(prompt).then((ok) => { if (ok) onLeave(); }); },
    confirm,
  }), [confirm]);
}

/* ---------- Dialogs ---------- */

const DIALOG_PROMPT: DiscardPrompt = {
  title: 'Discard this draft?',
  message: 'What you have entered here has not been saved. Closing now loses it.',
  confirmLabel: 'Discard',
};

/**
 * For Modal and Drawer: their close (Escape, ×, a click outside) asks first when `dirty` or a form inside
 * has unsaved changes. Wrap the sheet's content in `<SheetGuard forms={forms}>`.
 */
export function useSheetGuard(onClose: () => void, dirty?: boolean, prompt?: DiscardPrompt) {
  const forms = useRef<Set<Entry>>(null as unknown as Set<Entry>);
  if (!forms.current) forms.current = new Set();
  const close = () => {
    if (dirty || unsavedIn(forms.current)) void confirmDiscard({ ...DIALOG_PROMPT, ...prompt }).then((ok) => { if (ok) onClose(); });
    else onClose();
  };
  return { close, forms: forms.current };
}

export function SheetGuard({ forms, children }: { forms: Set<Entry>; children: ReactNode }) {
  return <SheetForms.Provider value={forms}>{children}</SheetForms.Provider>;
}

/* ---------- Drafts kept in this tab when the session ends ---------- */

const DRAFT_PREFIX = 'grc:draft:';

/** Keeps a form's draft in this browser tab, for the same person (`userId`). */
export function keepDraft(key: string, userId: string | undefined, value: unknown): void {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ userId: userId ?? null, value }));
  } catch {
    // Storage blocked or full: the draft cannot be kept.
  }
}

/** Whether a draft is waiting under `key` for this person (it stays until `takeDraft`). */
export function hasDraft(key: string, userId: string | undefined): boolean {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
    return Boolean(raw) && (JSON.parse(raw!) as { userId: string | null }).userId === (userId ?? null);
  } catch {
    return false;
  }
}

/** Takes (and removes) a kept draft; undefined when there is none for this person. */
export function takeDraft<T = unknown>(key: string, userId: string | undefined): T | undefined {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return undefined;
    const { userId: owner, value } = JSON.parse(raw) as { userId: string | null; value: T };
    if (owner !== (userId ?? null)) return undefined;
    sessionStorage.removeItem(DRAFT_PREFIX + key);
    return value;
  } catch {
    return undefined;
  }
}

/** Forgets every kept draft (on sign-out). */
export function clearDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/* ---------- The host ---------- */

/** Mounted once under the router: the shared prompt, the navigation guard and the tab-close guard. */
export function UnsavedChangesHost() {
  const [prompt, setPrompt] = useState<(Required<DiscardPrompt> & { resolve: (ok: boolean) => void }) | null>(null);

  useEffect(() => {
    const mine: Ask = (p) => new Promise<boolean>((resolve) => {
      setPrompt((old) => {
        old?.resolve(false);
        return { ...DEFAULT_PROMPT, ...p, resolve };
      });
    });
    ask = mine;
    return () => { if (ask === mine) ask = null; };
  }, []);

  // Moving to another page of the application. A change of the query or hash only (a tab, a filter)
  // stays on the page, so it is not stopped.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname && hasUnsavedChanges());
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirmDiscard().then((ok) => {
      if (ok) {
        for (const e of entries) e.released = true;
        blocker.proceed?.();
      } else blocker.reset?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // Closing or reloading the tab: the browser asks with its own wording.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const answer = (ok: boolean) => {
    prompt?.resolve(ok);
    setPrompt(null);
  };
  return (
    <ConfirmDialog
      open={prompt !== null}
      title={prompt?.title ?? DEFAULT_PROMPT.title}
      message={prompt?.message ?? DEFAULT_PROMPT.message}
      confirmLabel={prompt?.confirmLabel ?? DEFAULT_PROMPT.confirmLabel}
      cancelLabel="Keep editing"
      danger
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
      layer="top"
    />
  );
}
