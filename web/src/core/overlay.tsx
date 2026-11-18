// Overlays: Modal, Drawer, ConfirmDialog, Menu and toasts.
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useDismiss } from './hooks';
import { Icon, type IconName } from './Icon';
import { Button, IconButton, cx, type ButtonVariant } from './ui';

/* ---------- Modal and Drawer (native <dialog>: focus trap, Esc and inert background come built in) ---------- */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons at the bottom. Forms usually render their own buttons instead. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

interface SheetProps extends ModalProps {
  kind: string;
}

function Sheet({ title, onClose, children, footer, kind }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    // Start in the first form control when there is one, rather than on the Close button.
    dialog.querySelector<HTMLElement>('.sheet-body :is(input, select, textarea):not(:disabled)')?.focus();
    return () => {
      dialog.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={kind}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // press on the backdrop
      }}
    >
      <div className="sheet">
        <header className="sheet-head">
          <h2 id={titleId} className="sheet-title">{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** A centred dialog. Rendered only while `open`. */
export function Modal(props: ModalProps) {
  return props.open ? <Sheet {...props} kind={`modal modal-${props.size ?? 'md'}`} /> : null;
}

/** Same as Modal under the name used for short prompts. */
export const Dialog = Modal;

/** A panel that slides in from the edge of the window. */
export function Drawer({ side = 'right', ...props }: ModalProps & { side?: 'left' | 'right' }) {
  return props.open ? <Sheet {...props} kind={`drawer drawer-${side} drawer-${props.size ?? 'md'}`} /> : null;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

/* ---------- Menu ---------- */

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  /** Navigate to this path instead of (or as well as) calling `onSelect`. */
  to?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  separated?: boolean;
}

export interface MenuProps {
  /** Button text, and the accessible name when `iconOnly`. */
  label: string;
  icon?: IconName;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  items: MenuItem[];
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
}

export function Menu({ label, icon, iconOnly, variant = 'secondary', size, items, align = 'start' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);
  const ref = useDismiss<HTMLDivElement>(open, () => close(false));

  const focusItem = (pick: (all: HTMLElement[], at: number) => number) => {
    const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (all.length === 0) return;
    const next = pick(all, all.indexOf(document.activeElement as HTMLElement));
    all[(next + all.length) % all.length].focus();
  };

  useEffect(() => {
    if (open) focusItem(() => 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const moves: Record<string, (all: HTMLElement[], at: number) => number> = {
      ArrowDown: (_, at) => at + 1,
      ArrowUp: (_, at) => at - 1,
      Home: () => 0,
      End: (all) => all.length - 1,
    };
    if (moves[e.key]) {
      e.preventDefault();
      focusItem(moves[e.key]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const select = (item: MenuItem) => {
    close();
    item.onSelect?.();
    if (item.to) navigate(item.to);
  };

  return (
    <div className="menu" ref={ref} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <Icon name={icon} size={16} />}
        {!iconOnly && label}
        {!iconOnly && <Icon name="chevron-down" size={14} />}
      </button>
      {open && (
        <div id={menuId} className={`menu-list menu-${align}`} role="menu" aria-label={label}>
          {items.length === 0 && <p className="menu-empty">Nothing here yet</p>}
          {items.map((item, i) => (
            <button
              key={`${i}-${item.label}`}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              className={cx('menu-item', item.danger && 'menu-item-danger', item.separated && 'menu-item-separated')}
              onClick={() => select(item)}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Toasts ---------- */

type ToastKind = 'success' | 'error' | 'info';

interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside ToastProvider');
  return toast;
}

const TOAST_ICON: Record<ToastKind, IconName> = { success: 'check', error: 'alert', info: 'info' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const regionRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toastApi = useMemo<ToastApi>(() => {
    const push = (kind: ToastKind) => (message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000);
    };
    return { success: push('success'), error: push('error'), info: push('info') };
  }, [dismiss]);

  // Re-open the popover on every change so toasts sit above any open dialog (both live in the top layer).
  useEffect(() => {
    const region = regionRef.current;
    if (!region?.showPopover) return;
    if (region.matches(':popover-open')) region.hidePopover();
    if (toasts.length > 0) region.showPopover();
  }, [toasts]);

  return (
    <ToastContext.Provider value={toastApi}>
      {children}
      <div ref={regionRef} className="toasts" popover="manual" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <Icon name={TOAST_ICON[t.kind]} size={18} />
            <span className="toast-message">{t.message}</span>
            <IconButton icon="x" label="Dismiss" size="sm" onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
