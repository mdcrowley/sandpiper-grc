// Where dropdowns and calendars of the form controls are rendered.
// - Inside a native <dialog> they must live in the dialog (everything outside it is inert).
// - Inside another popover they stay inline, so a click in them does not count as "outside".
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const InlineContext = createContext(false);

/** Makes the form controls inside render their dropdowns in place (use inside a Popover). */
export function InlinePopups({ children }: { children: ReactNode }) {
  return <InlineContext.Provider value>{children}</InlineContext.Provider>;
}

export interface PopupHost {
  /** Give this to the control's input so its surroundings can be inspected. */
  ref: (el: HTMLElement | null) => void;
  /** Spread into Mantine `comboboxProps` / `popoverProps`. */
  popup: { withinPortal: boolean; portalProps?: { target: HTMLElement } };
}

export function usePopupHost(): PopupHost {
  const inline = useContext(InlineContext);
  const [dialog, setDialog] = useState<HTMLElement | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    if (el) setDialog(el.closest('dialog'));
  }, []);
  if (inline) return { ref, popup: { withinPortal: false } };
  return { ref, popup: dialog ? { withinPortal: true, portalProps: { target: dialog } } : { withinPortal: true } };
}
