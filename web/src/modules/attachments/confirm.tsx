// Password confirmation for sensitive settings on the File settings and Backups pages.
// The server refuses those changes with 403 `reauth_required` unless the password was proved
// in this session a few minutes ago. The shared prompt (`withReauth`) asks for the password and,
// for people who have one, the second factor, then runs the action again.
import type { ReactNode } from 'react';
import { withReauth } from '../admin/reauth';

export function usePasswordConfirm(): { run: <T>(action: () => Promise<T>) => Promise<T>; dialog: ReactNode } {
  return { run: withReauth, dialog: null };
}
