// Signing in and out through the sign-in page, a refused password shown on the form, and setting up
// a second factor (authenticator app) and then signing in with a code.
import { sleep, totp } from '../lib/browser.mjs';

/** Waits until the start of a fresh 30-second window, so a code is never reused or about to expire. */
async function freshWindow(after = 0) {
  for (;;) {
    const now = Date.now();
    const window = Math.floor(now / 30000);
    const left = 30000 - (now % 30000);
    if (window > after && left > 6000) return window;
    await sleep(left + 300);
  }
}

async function signInThroughForm(t, username, password) {
  await t.page.waitFor({ label: 'Username' });
  await t.page.fill({ label: 'Username' }, username);
  await t.page.fill({ label: 'Password' }, password);
  await t.page.click({ text: 'Sign in', tag: 'button' });
}

async function signOutThroughMenu(t) {
  await t.page.click('button[aria-label^="Account:"]');
  await t.page.click({ text: 'Sign out', tag: '[role=menuitem]' });
  await t.page.waitFor({ text: 'Sign in', tag: 'h1' });
}

export const tests = [
  {
    name: 'sign in, refused password, sign out',
    async run(t) {
      const user = await t.step('make a new agent account', () => t.app.newUser(`e2e.signin-${Date.now() % 100000}`, ['agent']));
      await t.page.clearSession();
      await t.step('the sign-in page shows', async () => {
        await t.page.goto('/');
        await t.page.waitFor({ text: 'Sign in', tag: 'h1' });
      });
      await t.step('a wrong password is refused on the form', async () => {
        t.page.allow({ status: 401, url: /\/api\/auth\/login/ });
        await signInThroughForm(t, user.username, 'not-the-password-at-all');
        await t.page.waitFor(() => /incorrect|not correct|wrong|did not match|Check/i.test(document.querySelector('form')?.innerText ?? ''));
        t.page.clearAllowed();
      });
      await t.step('the right password signs in to the overview', async () => {
        await t.page.fill({ label: 'Password' }, user.password);
        await t.page.click({ text: 'Sign in', tag: 'button' });
        await t.page.waitFor('nav[aria-label="Main"]');
        await t.page.settled();
      });
      await t.step('sign out from the account menu', () => signOutThroughMenu(t));
      await t.step('signed out: a protected page shows the sign-in form', async () => {
        await t.page.goto('/tickets');
        await t.page.waitFor({ label: 'Username' });
      });
    },
  },
  {
    name: 'second-factor enrolment and sign-in with a code',
    async run(t) {
      const user = await t.step('make a new agent account', () => t.app.newUser(`e2e.mfa-${Date.now() % 100000}`, ['agent']));
      await t.page.setSession(user.token);
      await t.step('open Account security', async () => {
        await t.page.goto('/account/security');
        await t.page.waitFor({ text: 'Set up an authenticator app', tag: 'button' });
      });
      const key = await t.step('start set-up: the key is shown', async () => {
        await t.page.click({ text: 'Set up an authenticator app', tag: 'button' });
        await t.page.waitFor('[data-testid="totp-key"]');
        return t.page.eval(`document.querySelector('[data-testid="totp-key"]').dataset.value`);
      });
      await t.step('a wrong code is refused beside the field', async () => {
        t.page.allow({ status: 400, url: /totp\/confirm/ });
        await t.page.fill({ label: '6-digit code' }, '000000');
        await t.page.click({ text: 'Confirm and turn on', tag: 'button' });
        await t.page.waitFor(() => !!document.querySelector('[aria-invalid="true"]'));
        t.page.clearAllowed();
      });
      const used = await t.step('the right code turns the second factor on and shows recovery codes', async () => {
        const w = await freshWindow();
        await t.page.fill({ label: '6-digit code' }, totp(key));
        await t.page.click({ text: 'Confirm and turn on', tag: 'button' });
        await t.page.waitFor({ text: 'Your recovery codes', tag: 'h2, h3, .card-title, [class*=title]' });
        return w;
      });
      await t.step('the recovery codes must be acknowledged', async () => {
        // Leave the page through the menu: the codes were shown once.
        await t.page.goto('/');
      });
      await t.step('sign out and sign in again: a code is asked for', async () => {
        await signOutThroughMenu(t);
        // The first answer to a password without a code is 401 "code needed": expected.
        t.page.allow({ status: 401, url: /\/api\/auth\/login/ });
        await signInThroughForm(t, user.username, user.password);
        await t.page.waitFor({ label: '6-digit code' });
      });
      await t.step('the next code signs in', async () => {
        await freshWindow(used);
        await t.page.fill({ label: '6-digit code' }, totp(key));
        await t.page.click({ text: 'Verify and sign in', tag: 'button' });
        await t.page.waitFor('nav[aria-label="Main"]');
      });
    },
  },
];
