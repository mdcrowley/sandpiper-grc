// Overlays on Mantine: Modal, Drawer, ConfirmDialog, Menu and toasts.
import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { Button as MButton, ActionIcon, Drawer as MDrawer, Menu as MMenu, Modal as MModal, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { Button, BUTTON_LOOK, cx, type ButtonVariant } from './ui';

/* ---------- Modal and Drawer ---------- */

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons at the bottom. Forms usually render their own buttons instead. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

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
export function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  const bodyRef = useSheet(open, onClose);
  return (
    <MModal
      opened={open}
      onClose={onClose}
      title={title}
      size={MODAL_WIDTH[size]}
      closeOnEscape={false}
      closeButtonProps={{ 'aria-label': 'Close' }}
      classNames={{ content: `ui-sheet ui-modal ui-modal-${size}`, header: 'ui-sheet-head', title: 'ui-sheet-title', body: 'ui-sheet-wrap' }}
    >
      <SheetContent bodyRef={bodyRef} footer={footer}>{children}</SheetContent>
    </MModal>
  );
}

/** Same as Modal under the name used for short prompts. */
export const Dialog = Modal;

/** A panel that slides in from the edge of the window. */
export function Drawer({ open, title, onClose, children, footer, size = 'md', side = 'right' }: ModalProps & { side?: 'left' | 'right' }) {
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
      <SheetContent bodyRef={bodyRef} footer={footer}>{children}</SheetContent>
    </MDrawer>
  );
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
          <Button onClick={onCancel} data-autofocus={danger || undefined}>Cancel</Button>
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

/** A button that opens a dropdown menu (arrow keys, Home/End, Escape; items with `to` are real links). */
export function Menu({ label, icon, iconOnly, variant = 'secondary', size, items, align = 'start' }: MenuProps) {
  const small = size === 'sm';
  return (
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
              {item.to && !item.disabled
                ? <MMenu.Item {...shared} component={Link} to={item.to}>{item.label}</MMenu.Item>
                : <MMenu.Item {...shared}>{item.label}</MMenu.Item>}
            </Fragment>
          );
        })}
      </MMenu.Dropdown>
    </MMenu>
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
