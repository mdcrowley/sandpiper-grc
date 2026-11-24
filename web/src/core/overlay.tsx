// Overlays on Mantine: Modal, Drawer, ConfirmDialog, Menu and toasts.
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Button as MButton, ActionIcon, Drawer as MDrawer, Menu as MMenu, Modal as MModal, Popover, TextInput, Tooltip } from '@mantine/core';
import { filterEntries } from './createMenu';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Button, BUTTON_LOOK, cx, HeaderSlot, type ButtonVariant } from './ui';
import { SheetGuard, useSheetGuard, type DiscardPrompt } from './unsaved';

/* ---------- Modal and Drawer ---------- */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons at the bottom. Forms usually render their own buttons instead. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /**
   * The dialog holds unsaved changes: Escape, × and a click outside ask "Discard your unsaved
   * changes?" before closing. Wrap the dialog's own Cancel with `useUnsavedChanges(...).guard`.
   */
  dirty?: boolean;
  /** The question asked before unsaved changes are thrown away (default "Discard this draft?"). */
  discardPrompt?: DiscardPrompt;
  /** Above every other dialog (the shared discard prompt). */
  layer?: 'top';
}

const TOP_LAYER = 400;

// Open sheets, oldest first. Escape closes only the top one, and never while a dropdown inside it is open.
const openSheets: { id: string; close: () => void }[] = [];

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || openSheets.length === 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.('[aria-expanded="true"], [role="menu"], [role="listbox"]')) return;
  e.preventDefault();
  openSheets[openSheets.length - 1].close();
}

/** Shared behavior: Escape handling, and starting in the first form control rather than on Close. */
function useSheet(open: boolean, onClose: () => void) {
  const id = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const entry = { id, close: () => close.current() };
    openSheets.push(entry);
    if (openSheets.length === 1) window.addEventListener('keydown', onEscape);
    const timer = setTimeout(() => {
      const body = bodyRef.current;
      const first = body?.querySelector<HTMLElement>(':is(input, select, textarea):not(:disabled):not([type="hidden"])');
      // A date control opens its calendar on focus, which would cover the dialog and eat the next
      // click: start on the dialog body instead, one Tab away from the field.
      if (first && !first.matches('[data-dates-input], [aria-haspopup="dialog"]')) first.focus();
      else if (body) {
        if (!body.hasAttribute('tabindex')) body.setAttribute('tabindex', '-1');
        body.focus({ preventScroll: true });
      }
    }, 80);
    return () => {
      clearTimeout(timer);
      openSheets.splice(openSheets.indexOf(entry), 1);
      if (openSheets.length === 0) window.removeEventListener('keydown', onEscape);
    };
  }, [open, id]);

  return bodyRef;
}

const MODAL_WIDTH = { sm: 440, md: 620, lg: 860 } as const;
const DRAWER_WIDTH = { sm: 320, md: 500, lg: 740 } as const;

function SheetContent({ bodyRef, children, footer }: { bodyRef: React.RefObject<HTMLDivElement | null>; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <div className="sheet-body" ref={bodyRef}>{children}</div>
      {footer && <footer className="sheet-foot">{footer}</footer>}
    </>
  );
}

/** A centered dialog: focus is trapped, Escape and a press on the backdrop close it. */
export function Modal({ open, title, onClose: close, children, footer, size = 'md', dirty, discardPrompt, layer }: ModalProps) {
  const { close: onClose, forms } = useSheetGuard(close, dirty, discardPrompt);
  const bodyRef = useSheet(open, onClose);
  return (
    <MModal
      opened={open}
      onClose={onClose}
      zIndex={layer === 'top' ? TOP_LAYER : undefined}
      title={title}
      size={MODAL_WIDTH[size]}
      closeOnEscape={false}
      closeButtonProps={{ 'aria-label': 'Close' }}
      classNames={{ content: `ui-sheet ui-modal ui-modal-${size}`, header: 'ui-sheet-head', title: 'ui-sheet-title', body: 'ui-sheet-wrap' }}
    >
      <SheetGuard forms={forms}><SheetContent bodyRef={bodyRef} footer={footer}>{children}</SheetContent></SheetGuard>
    </MModal>
  );
}

/** Same as Modal under the name used for short prompts. */
export const Dialog = Modal;

/** A panel that slides in from the edge of the window. */
export function Drawer({ open, title, onClose: close, children, footer, size = 'md', side = 'right', dirty, discardPrompt }: ModalProps & { side?: 'left' | 'right' }) {
  const { close: onClose, forms } = useSheetGuard(close, dirty, discardPrompt);
  const bodyRef = useSheet(open, onClose);
  return (
    <MDrawer
      opened={open}
      onClose={onClose}
      title={title}
      position={side}
      size={DRAWER_WIDTH[size]}
      closeOnEscape={false}
      closeButtonProps={{ 'aria-label': 'Close' }}
      classNames={{ content: `ui-sheet ui-drawer ui-drawer-${side}`, header: 'ui-sheet-head', title: 'ui-sheet-title', body: 'ui-sheet-wrap' }}
    >
      <SheetGuard forms={forms}><SheetContent bodyRef={bodyRef} footer={footer}>{children}</SheetContent></SheetGuard>
    </MDrawer>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** The label of the button that closes without doing anything. Default "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Above every other dialog. */
  layer?: 'top';
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel, layer }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={onCancel}
      layer={layer}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus={danger || undefined}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} data-autofocus={!danger || undefined}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
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
  /** A heading drawn above this item when it differs from the previous item's (the Create menu's groups). */
  group?: string;
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

/**
 * A button that opens a dropdown menu (arrow keys, Home/End, Escape; items with `to` are real links).
 * An icon-only "⋯" (More actions) menu in a page header is always drawn last among its buttons.
 */
export function Menu({ label, icon, iconOnly, variant = 'secondary', size, items, align = 'start' }: MenuProps) {
  const small = size === 'sm';
  // The page's overflow menu: an icon-only "⋯" menu, or one labeled "More" or "More actions".
  const overflow = (Boolean(iconOnly) && (icon ?? 'more') === 'more') || /^more( actions)?$/i.test(label);
  return (
    <HeaderSlot place={overflow ? 'last' : undefined}>
    <MMenu position={align === 'end' ? 'bottom-end' : 'bottom-start'} offset={6} aria-label={label}>
      <MMenu.Target>
        {iconOnly ? (
          <Tooltip label={label}>
            <ActionIcon {...BUTTON_LOOK[variant]} size={small ? 28 : 36} aria-label={label} className={cx('ui-btn', 'ui-icon-btn', `ui-btn-${variant}`)}>
              <Icon name={icon ?? 'more'} size={small ? 16 : 18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <MButton
            {...BUTTON_LOOK[variant]}
            size={small ? 'xs' : 'sm'}
            className={cx('ui-btn', `ui-btn-${variant}`)}
            leftSection={icon ? <Icon name={icon} size={16} /> : undefined}
            rightSection={<Icon name="chevron-down" size={14} />}
          >
            {label}
          </MButton>
        )}
      </MMenu.Target>
      <MMenu.Dropdown className="ui-menu">
        {items.length === 0 && <MMenu.Label>Nothing here yet</MMenu.Label>}
        {items.map((item, i) => {
          const shared = {
            className: 'ui-menu-item',
            disabled: item.disabled,
            color: item.danger ? 'red' : undefined,
            leftSection: item.icon ? <Icon name={item.icon} size={16} /> : undefined,
            onClick: item.onSelect,
          };
          return (
            <Fragment key={`${i}-${item.label}`}>
              {item.separated && i > 0 && <MMenu.Divider />}
              {item.group && item.group !== items[i - 1]?.group && <MMenu.Label className="ui-menu-group">{item.group}</MMenu.Label>}
              {item.to && !item.disabled
                ? <MMenu.Item {...shared} component={Link} to={item.to}>{item.label}</MMenu.Item>
                : <MMenu.Item {...shared}>{item.label}</MMenu.Item>}
            </Fragment>
          );
        })}
      </MMenu.Dropdown>
    </MMenu>
    </HeaderSlot>
  );
}

/* ---------- Menu with a filter box (the Create menu) ---------- */

export interface FilterMenuProps extends Omit<MenuProps, 'size'> {
  /** The filter box's accessible name. */
  filterLabel?: string;
}

/**
 * A button that opens a long menu with a filter box above it (E18-65): focus starts in the box;
 * typing narrows the entries (label or group, see `filterEntries`); ArrowDown and ArrowUp move into
 * the entries, which then move with the arrow keys, Home and End as in any menu (ArrowUp on the first
 * goes back to the box, typing a letter goes back to the box with it); Enter in the box opens the first
 * entry; Escape closes and focus returns to the button. Entries are grouped under their `group`.
 */
export function FilterMenu({ label, icon, iconOnly, variant = 'secondary', items, align = 'start', filterLabel = `Filter ${label.toLowerCase()} choices` }: FilterMenuProps) {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const shown = filterEntries(items, query);
  const close = () => { setOpened(false); setQuery(''); };
  const entries = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
  const focusAt = (at: number) => {
    const all = entries();
    if (all.length > 0) all[(at + all.length) % all.length].focus();
  };
  const onBoxKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(-1); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const first = entries()[0];
      if (first) { e.preventDefault(); first.click(); }
    }
  };
  const onEntryKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const at = entries().indexOf(e.currentTarget);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(at + 1); break;
      case 'ArrowUp': e.preventDefault(); if (at <= 0) inputRef.current?.focus(); else focusAt(at - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(-1); break;
      case ' ': e.preventDefault(); e.currentTarget.click(); break;
      default:
        // A letter typed on an entry goes to the filter box (focus moves before the character lands).
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) inputRef.current?.focus();
    }
  };
  const groups: { group: string; items: MenuItem[] }[] = [];
  for (const item of shown) {
    const group = item.group ?? '';
    if (groups.length === 0 || groups[groups.length - 1].group !== group) groups.push({ group, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  const entry = (item: MenuItem) => {
    const shared = {
      role: 'menuitem', tabIndex: -1, className: cx('ui-fmenu-item', item.danger && 'ui-fmenu-danger'), onKeyDown: onEntryKey,
      onClick: () => { item.onSelect?.(); close(); },
    } as const;
    const inner = <>{item.icon && <Icon name={item.icon} size={16} />}<span>{item.label}</span></>;
    return item.to
      ? <Link key={`${item.group ?? ''}-${item.label}`} {...shared} to={item.to}>{inner}</Link>
      : <button key={`${item.group ?? ''}-${item.label}`} type="button" {...shared}>{inner}</button>;
  };
  return (
    <Popover opened={opened} onChange={(o) => (o ? setOpened(true) : close())} position={align === 'end' ? 'bottom-end' : 'bottom-start'}
      offset={6} shadow="md" trapFocus returnFocus>
      <Popover.Target>
        {iconOnly ? (
          <Tooltip label={label} disabled={opened}>
            <ActionIcon {...BUTTON_LOOK[variant]} size={36} aria-label={label} className={cx('ui-btn', 'ui-icon-btn', `ui-btn-${variant}`)}
              onClick={() => (opened ? close() : setOpened(true))}>
              <Icon name={icon ?? 'more'} size={18} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <MButton {...BUTTON_LOOK[variant]} size="sm" className={cx('ui-btn', `ui-btn-${variant}`)}
            leftSection={icon ? <Icon name={icon} size={16} /> : undefined} rightSection={<Icon name="chevron-down" size={14} />}
            onClick={() => (opened ? close() : setOpened(true))}>
            {label}
          </MButton>
        )}
      </Popover.Target>
      <Popover.Dropdown className="ui-menu ui-fmenu" aria-label={label} p={4}>
        <TextInput ref={inputRef} data-autofocus aria-label={filterLabel} placeholder="Filter…" size="sm" type="search" autoComplete="off"
          aria-controls={`${id}-list`} value={query} onChange={(e) => setQuery(e.currentTarget.value)} onKeyDown={onBoxKey}
          leftSection={<Icon name="search" size={14} />} className="ui-fmenu-box" />
        <div role="status" className="sr-only">{query && (shown.length === 0 ? 'No match' : `${shown.length} ${shown.length === 1 ? 'choice' : 'choices'}`)}</div>
        {shown.length === 0 ? (
          <p className="ui-fmenu-empty">{items.length === 0 ? 'Nothing here yet' : `No match for “${query.trim()}”`}</p>
        ) : (
          <div role="menu" id={`${id}-list`} aria-label={label} ref={listRef}>
            {groups.map((g, gi) => (g.group ? (
              <div role="group" key={g.group} aria-labelledby={`${id}-g${gi}`}>
                <div id={`${id}-g${gi}`} className="ui-menu-group ui-fmenu-group">{g.group}</div>
                {g.items.map(entry)}
              </div>
            ) : <Fragment key={`none-${gi}`}>{g.items.map(entry)}</Fragment>))}
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

/* ---------- Toasts (Mantine notifications) ---------- */

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const toastApi: ToastApi = {
  success: (message) => notifications.show({ message, color: 'green', icon: <Icon name="check" size={16} />, autoClose: 5000 }),
  error: (message) => notifications.show({ message, color: 'red', icon: <Icon name="alert" size={16} />, autoClose: 9000 }),
  info: (message) => notifications.show({ message, color: 'blue', icon: <Icon name="info" size={16} />, autoClose: 5000 }),
};

/** Short messages at the bottom right: `toast.success('Saved.')`, `toast.error(errorMessage(err))`. */
export function useToast(): ToastApi {
  return toastApi;
}

/** Kept for compatibility: toasts are drawn by the Notifications host in UiProvider. */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
