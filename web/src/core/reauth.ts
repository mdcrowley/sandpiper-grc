// Confirming who you are before sensitive actions.
//
// The server refuses those actions with 403 `reauth_required` unless the password was proved in this
// session within the last few minutes. `withReauth` turns that refusal into a prompt, in place: it asks
// for the password, confirms it with POST /api/auth/confirm, and runs the action again. A person with
// a second factor is then asked for it too (E01-29): a code from the authenticator app, a recovery
// code, or their passkey or security key. A person who signs in with a directory (LDAP) can confirm
// with their directory user name and password instead (E02-29): the dialog asks
// GET /api/auth/sso/confirm-methods and offers the linked directories.
//
// The prompt is a native <dialog> built here rather than a component, so it can be opened from any
// event handler without a host element in every page. It is styled in reauth.css from the design tokens.
import { api, ApiError, errorMessage } from './api';
import { browserKeyError, getAssertion, passkeysSupported } from './webauthn';
import './reauth.css';

let open: Promise<boolean> | null = null;

interface ConfirmMethods { password: boolean; directories: { key: string; name: string }[] }

/** How this person can confirm: their password here, and linked directories. Without single sign-on, the password. */
const confirmMethods = (): Promise<ConfirmMethods> =>
  api.get<ConfirmMethods>('/api/auth/sso/confirm-methods').then(
    (m) => ({ password: m?.password !== false, directories: Array.isArray(m?.directories) ? m.directories : [] }),
    () => ({ password: true, directories: [] }),
  );

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Asks for the password (and the second factor when the person has one) until confirmed (true) or
 * canceled (false). `prefer` picks a linked directory to start on.
 */
function askPassword(prefer?: string): Promise<boolean> {
  if (open) return open; // one prompt at a time, shared by concurrent callers
  open = confirmMethods().then((methods) => new Promise<boolean>((resolve) => {
    const ways = [
      ...(methods.password || !methods.directories.length ? [{ value: '', label: 'Your password for this application' }] : []),
      ...methods.directories.map((d) => ({ value: d.key, label: d.name })),
    ];
    let way = ways.find((w) => w.value === prefer)?.value ?? ways[0].value;
    const dialog = document.createElement('dialog');
    dialog.className = 'adm-reauth';
    dialog.setAttribute('aria-labelledby', 'adm-reauth-title');
    dialog.innerHTML = `
      <form method="dialog" class="adm-reauth-form" novalidate>
        <h2 id="adm-reauth-title">Confirm it is you</h2>
        <p id="adm-reauth-text">This change affects who can do what, so we need to check it is really you. You will not be asked again for a few minutes.</p>
        <div class="adm-reauth-factor adm-reauth-way" hidden>
          <label class="adm-reauth-label" for="adm-reauth-way">Confirm with</label>
          <select id="adm-reauth-way" class="adm-reauth-input">${ways.map((w) => `<option value="${escapeHtml(w.value)}">${escapeHtml(w.label)}</option>`).join('')}</select>
        </div>
        <div class="adm-reauth-factor adm-reauth-user" hidden>
          <label class="adm-reauth-label" for="adm-reauth-username">User name</label>
          <input id="adm-reauth-username" class="adm-reauth-input" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" aria-describedby="adm-reauth-error" />
        </div>
        <label class="adm-reauth-label" for="adm-reauth-password">Your password</label>
        <input id="adm-reauth-password" class="adm-reauth-input" type="password" autocomplete="current-password" aria-describedby="adm-reauth-text adm-reauth-error" required />
        <div class="adm-reauth-factor adm-reauth-second" hidden>
          <label class="adm-reauth-label" for="adm-reauth-code">6-digit code or recovery code</label>
          <input id="adm-reauth-code" class="adm-reauth-input" type="text" autocomplete="one-time-code" spellcheck="false" aria-describedby="adm-reauth-code-hint adm-reauth-error" />
          <p id="adm-reauth-code-hint" class="adm-reauth-hint"></p>
          <button type="button" class="adm-reauth-button adm-reauth-key" data-act="key" hidden>Use your passkey or security key</button>
        </div>
        <p id="adm-reauth-error" class="adm-reauth-error" role="alert"></p>
        <div class="adm-reauth-actions">
          <button type="button" class="adm-reauth-button" data-act="cancel">Cancel</button>
          <button type="submit" class="adm-reauth-button adm-reauth-primary">Confirm and continue</button>
        </div>
      </form>`;
    const form = dialog.querySelector('form')!;
    const input = dialog.querySelector<HTMLInputElement>('#adm-reauth-password')!;
    const wayBox = dialog.querySelector<HTMLElement>('.adm-reauth-way')!;
    const wayPicker = dialog.querySelector<HTMLSelectElement>('#adm-reauth-way')!;
    const userBox = dialog.querySelector<HTMLElement>('.adm-reauth-user')!;
    const username = dialog.querySelector<HTMLInputElement>('#adm-reauth-username')!;
    const passwordLabel = dialog.querySelector<HTMLLabelElement>('label[for="adm-reauth-password"]')!;
    const factor = dialog.querySelector<HTMLElement>('.adm-reauth-second')!;
    const code = dialog.querySelector<HTMLInputElement>('#adm-reauth-code')!;
    const codeLabel = dialog.querySelector<HTMLLabelElement>('label[for="adm-reauth-code"]')!;
    const codeHint = dialog.querySelector<HTMLElement>('#adm-reauth-code-hint')!;
    const keyButton = dialog.querySelector<HTMLButtonElement>('[data-act="key"]')!;
    const error = dialog.querySelector<HTMLElement>('#adm-reauth-error')!;
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    let asking = false; // the second-factor step is showing
    /** Shows the fields of the chosen way: a directory needs its user name too. */
    const showWay = () => {
      const directory = methods.directories.find((d) => d.key === way);
      wayBox.hidden = ways.length < 2;
      wayPicker.value = way;
      userBox.hidden = !directory;
      username.required = Boolean(directory);
      dialog.querySelector('label[for="adm-reauth-username"]')!.textContent = directory ? `User name at ${directory.name}` : 'User name';
      passwordLabel.textContent = directory ? `Password at ${directory.name}` : 'Your password';
      input.autocomplete = directory ? 'off' : 'current-password';
    };
    wayPicker.addEventListener('change', () => { way = wayPicker.value; error.textContent = ''; showWay(); });
    const finish = (ok: boolean) => {
      if (!open) return;
      open = null;
      dialog.close();
      dialog.remove();
      resolve(ok);
    };

    /** The password was right; the server wants the second factor too. */
    const askSecondFactor = (fields: Record<string, string>) => {
      asking = true;
      factor.hidden = false;
      const app = fields.totp === 'available';
      codeLabel.textContent = app ? '6-digit code or recovery code' : 'Recovery code';
      codeHint.textContent = app
        ? 'From your authenticator app. A recovery code also works.'
        : 'Use your passkey or security key, or enter one of your recovery codes.';
      keyButton.hidden = !(fields.passkey === 'available' && passkeysSupported());
      input.readOnly = true;
      username.readOnly = true;
      wayPicker.disabled = true;
      error.textContent = '';
      (keyButton.hidden ? code : keyButton).focus();
    };

    const confirm = (extra: Record<string, unknown>) => {
      submit.disabled = true;
      keyButton.disabled = true;
      error.textContent = '';
      const url = way ? `/api/auth/sso/${encodeURIComponent(way)}/confirm` : '/api/auth/confirm';
      return api.post(url, { ...(way ? { username: username.value.trim() } : {}), password: input.value, ...extra }).then(
        () => finish(true),
        (err: unknown) => {
          submit.disabled = false;
          keyButton.disabled = false;
          if (err instanceof ApiError && err.code === 'second_factor_required') { askSecondFactor(err.fields); return; }
          if (err instanceof ApiError && err.fields.password) {
            error.textContent = err.fields.password;
            input.readOnly = false;
            username.readOnly = false;
            wayPicker.disabled = false;
            input.select();
            return;
          }
          error.textContent = err instanceof ApiError && err.fields.code ? err.fields.code : errorMessage(err);
          if (asking) code.select();
        },
      );
    };

    dialog.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); }); // the browser's own close request
    dialog.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keys typed here are not for a dialog underneath
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    keyButton.addEventListener('click', () => {
      keyButton.disabled = true;
      error.textContent = '';
      api.post('/api/auth/webauthn/confirm/options')
        .then((options) => getAssertion(options))
        .then((webauthn) => confirm({ webauthn }))
        .catch((err: unknown) => {
          keyButton.disabled = false;
          error.textContent = browserKeyError(err) ?? errorMessage(err);
        });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (way && !username.value.trim()) { error.textContent = 'Enter your user name.'; username.focus(); return; }
      if (!input.value) { error.textContent = 'Enter your password.'; input.focus(); return; }
      if (asking && !code.value.trim()) { error.textContent = 'Enter a code, or use your passkey or security key.'; code.focus(); return; }
      void confirm(asking ? { code: code.value.trim() } : {});
    });
    showWay();
    document.body.appendChild(dialog);
    dialog.showModal(); // traps focus and returns it to the button that started the action when closed
    (way ? username : input).focus();
  }));
  return open;
}

/**
 * Opens the confirmation dialog by itself (no action waiting), for a "Confirm with …" button.
 * `directory` starts it on that linked directory. Resolves true once confirmed.
 */
export const confirmIdentity = (directory?: string): Promise<boolean> => askPassword(directory);

/** Runs `action`; when the server asks for the password again, prompts in place and then continues. */
export async function withReauth<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'reauth_required') throw err;
    if (!(await askPassword())) throw new ApiError(403, 'reauth_cancelled', 'Nothing was changed: your identity was not confirmed.');
    return action();
  }
}

/** The api client for administration screens: the same calls, with the confirmation prompt when needed. */
export const adminApi = {
  post: <T = unknown>(url: string, body?: unknown) => withReauth(() => api.post<T>(url, body)),
  patch: <T = unknown>(url: string, body?: unknown) => withReauth(() => api.patch<T>(url, body)),
  del: <T = unknown>(url: string) => withReauth(() => api.del<T>(url)),
};
