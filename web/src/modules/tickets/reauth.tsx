// Password confirmation for sensitive changes (the email-to-ticket settings and relay key). The
// server refuses them with 403 `reauth_required` unless the password was proved in this session in
// the last few minutes. The shared prompt (`withReauth`, admin module) asks for the password and,
// for people who have one, the second factor, then runs the action again.
import { withReauth } from '../admin/reauth';

export function useReauth() {
  return { run: withReauth, dialog: null };
}
