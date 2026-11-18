// Password confirmation before sensitive administrative actions.
//
// The server refuses those actions with 403 `reauth_required` unless the password was proved in this
// session within the last few minutes. `withReauth` turns that refusal into a prompt, in place: it asks
// for the password, confirms it with POST /api/auth/confirm, and runs the action again.
//
// The prompt is a native <dialog> built here rather than a component, so it can be opened from any
// event handler without a host element in every page. It is styled in admin.css from the design tokens.
import { api, ApiError, errorMessage } from '../../core';
import './admin.css';

let open: Promise<boolean> | null = null;

/** Asks for the password until it is confirmed (true) or the person cancels (false). */
function askPassword(): Promise<boolean> {
  if (open) return open; // one prompt at a time, shared by concurrent callers
  open = new Promise<boolean>((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'adm-reauth';
    dialog.setAttribute('aria-labelledby', 'adm-reauth-title');
    dialog.innerHTML = `
      <form method="dialog" class="adm-reauth-form" novalidate>
        <h2 id="adm-reauth-title">Confirm your password</h2>
        <p id="adm-reauth-text">This change affects who can do what, so we need to check it is really you. You will not be asked again for a few minutes.</p>
        <label class="adm-reauth-label" for="adm-reauth-password">Your password</label>
        <input id="adm-reauth-password" class="adm-reauth-input" type="password" autocomplete="current-password" aria-describedby="adm-reauth-text adm-reauth-error" required />
        <p id="adm-reauth-error" class="adm-reauth-error" role="alert"></p>
        <div class="adm-reauth-actions">
          <button type="button" class="adm-reauth-button" data-act="cancel">Cancel</button>
          <button type="submit" class="adm-reauth-button adm-reauth-primary">Confirm and continue</button>
        </div>
      </form>`;
    const form = dialog.querySelector('form')!;
    const input = dialog.querySelector<HTMLInputElement>('#adm-reauth-password')!;
    const error = dialog.querySelector<HTMLElement>('#adm-reauth-error')!;
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const finish = (ok: boolean) => {
      if (!open) return;
      open = null;
      dialog.close();
      dialog.remove();
      resolve(ok);
    };
    dialog.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); }); // the browser's own close request
    dialog.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keys typed here are not for a dialog underneath
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value) { error.textContent = 'Enter your password.'; input.focus(); return; }
      submit.disabled = true;
      error.textContent = '';
      api.post('/api/auth/confirm', { password: input.value }).then(
        () => finish(true),
        (err: unknown) => {
          submit.disabled = false;
          error.textContent = err instanceof ApiError && err.fields.password ? err.fields.password : errorMessage(err);
          input.select();
        },
      );
    });
    document.body.appendChild(dialog);
    dialog.showModal(); // traps focus and returns it to the button that started the action when closed
    input.focus();
  });
  return open;
}

/** Runs `action`; when the server asks for the password again, prompts in place and then continues. */
export async function withReauth<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'reauth_required') throw err;
    if (!(await askPassword())) throw new ApiError(403, 'reauth_cancelled', 'Nothing was changed: your password was not confirmed.');
    return action();
  }
}

/** The api client for administration screens: the same calls, with the password prompt when needed. */
export const adminApi = {
  post: <T = unknown>(url: string, body?: unknown) => withReauth(() => api.post<T>(url, body)),
  patch: <T = unknown>(url: string, body?: unknown) => withReauth(() => api.patch<T>(url, body)),
  del: <T = unknown>(url: string) => withReauth(() => api.del<T>(url)),
};