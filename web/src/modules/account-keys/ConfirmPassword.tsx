// Confirms who you are when the server answers 403 `reauth_required` (adding or removing a key needs
// a recent confirmation), then lets the caller try once more. It uses the shared prompt
// (`withReauth`, web/src/modules/admin/reauth.ts), which asks for the password and, for a person with
// a second factor, for an authenticator code, a recovery code or a passkey too.
import type { ReactNode } from 'react';
import { withReauth } from '../admin/reauth';

export function useConfirmPassword(): { dialog: ReactNode; withConfirm: <T>(action: () => Promise<T>) => Promise<T> } {
  // The shared prompt is a native dialog it adds itself, so there is nothing to render here.
  return { dialog: null, withConfirm: withReauth };
}
