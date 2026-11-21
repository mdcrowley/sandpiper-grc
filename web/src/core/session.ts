// When the session ends in the middle of an edit (BW-02).
//
// A request answered 401 normally re-checks the session, and the sign-in page replaces the application.
// With unsaved changes on the page (core/unsaved.tsx) that would lose them, so instead this dialog opens
// in place: the person signs in again in a new tab (any way they sign in: password, second factor,
// passkey, single sign-on), comes back and selects Continue, and the request that failed is sent again.
// Or they choose to sign in on this page: each form keeps its draft in this tab, and it comes back once
// they are signed in again. The sign-in page then says why it is showing (`sessionEndedNotice`).
//
// Like the reauth prompt, a native <dialog> built here, styled by reauth.css from the design tokens.
import { api } from './api';
import { hasUnsavedChanges, keepDrafts } from './unsaved';
import './reauth.css';

const FLAG = 'grc:session-ended';

/** Remembers, for the sign-in page, that the session ended (and whether drafts were kept). */
export function markSessionEnded(kept = false): void {
  try {
    if (kept || sessionStorage.getItem(FLAG) !== 'kept') sessionStorage.setItem(FLAG, kept ? 'kept' : 'ended');
  } catch {
    // Storage blocked: the sign-in page just shows no reason.
  }
}

/** Signed in again: the sign-in page no longer explains anything. */
export function clearSessionEnded(): void {
  try { sessionStorage.removeItem(FLAG); } catch { /* storage blocked */ }
}

/** What the sign-in page says about a session that ended, or null. */
export function sessionEndedNotice(): string | null {
  let flag: string | null = null;
  try { flag = sessionStorage.getItem(FLAG); } catch { /* storage blocked */ }
  if (flag === 'kept') return 'Your session ended. Sign in again to continue: what you were editing has been kept and comes back when you open it again.';
  if (flag === 'ended') return 'Your session ended. Sign in again to continue.';
  return null;
}

let open: Promise<boolean> | null = null;

/**
 * Asks the person to sign in again without leaving the page. Resolves true once they are signed in
 * again as the same person (`userId`), false when they chose the sign-in page instead.
 */
export function askToSignInAgain(userId: string): Promise<boolean> {
  if (open) return open;
  open = new Promise<boolean>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'adm-reauth';
    dialog.setAttribute('aria-labelledby', 'grc-session-title');
    dialog.setAttribute('aria-describedby', 'grc-session-text');
    dialog.innerHTML = `
      <form method="dialog" class="adm-reauth-form" novalidate>
        <h2 id="grc-session-title">Your session has ended</h2>
        <p id="grc-session-text">You were signed out, for example after a while without activity. What you entered is still here and has not been saved yet.</p>
        <p>Sign in again in a new tab, then come back and select <strong>Continue</strong>: your change is then sent again.</p>
        <p><a class="adm-reauth-button" href="/" target="_blank" rel="noopener" data-act="open">Sign in in a new tab</a></p>
        <p id="grc-session-error" class="adm-reauth-error" role="alert"></p>
        <div class="adm-reauth-actions">
          <button type="button" class="adm-reauth-button" data-act="here">Sign in on this page instead</button>
          <button type="submit" class="adm-reauth-button adm-reauth-primary">Continue</button>
        </div>
      </form>`;
    const error = dialog.querySelector<HTMLElement>('#grc-session-error')!;
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const finish = (ok: boolean) => {
      if (!open) return;
      open = null;
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    const signInHere = () => {
      keepDrafts();
      markSessionEnded(true);
      finish(false);
    };
    dialog.querySelector('[data-act="here"]')!.addEventListener('click', signInHere);
    // Escape or the browser's own close request: the same as signing in here, so nothing is lost.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); signInHere(); });
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    dialog.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      api.get<{ user: { id: string } | null }>('/api/auth/state').then(
        (state) => {
          submit.disabled = false;
          if (state?.user?.id === userId) finish(true);
          else if (state?.user) error.textContent = 'You signed in as someone else. Sign in as yourself in the other tab, then select Continue.';
          else error.textContent = 'You are not signed in yet. Sign in in the other tab, then select Continue.';
        },
        () => {
          submit.disabled = false;
          error.textContent = 'The server could not be reached. Check your connection and try again.';
        },
      );
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-act="open"]')!.focus();
  });
  return open;
}

/** The 401 handler for api.ts: in place when there is something to lose, else the sign-in page. */
export function resumeSession(userId: string | undefined): Promise<boolean> {
  if (!userId || !hasUnsavedChanges() || typeof document === 'undefined') return Promise.resolve(false);
  return askToSignInAgain(userId);
}
