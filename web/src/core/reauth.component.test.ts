// @vitest-environment happy-dom
// The confirmation dialog (E02-29, E02-30): a linked directory's user name is filled in from the one
// last used, so only the password is typed; choosing another way clears what was filled in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmIdentity } from './reauth';

const methods = {
  password: true,
  directories: [{ key: 'example-directory', name: 'Example directory', username: 'dana' }, { key: 'second-directory', name: 'Second directory', username: null }],
};
const posts: { url: string; body: unknown }[] = [];

function stubServer() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost').pathname;
    if ((init.method ?? 'GET') === 'GET') return new Response(JSON.stringify(methods), { status: 200, headers: { 'content-type': 'application/json' } });
    posts.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ ok: true, minutes: 10 }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  // happy-dom's <dialog> may lack showModal; the dialog only needs it to open.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
  if (typeof proto.showModal !== 'function') proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
}
const until = async (find: () => Element | null) => {
  for (let i = 0; i < 100; i += 1) { const el = find(); if (el) return el; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('not found');
};

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; posts.length = 0; });

describe('confirmation dialog with a linked directory', () => {
  it('fills in the remembered user name, focuses the password and sends both', async () => {
    stubServer();
    const done = confirmIdentity('example-directory');
    const user = await until(() => document.querySelector<HTMLInputElement>('#adm-reauth-username')) as HTMLInputElement;
    const password = document.querySelector<HTMLInputElement>('#adm-reauth-password')!;
    expect(user.value).toBe('dana');
    expect(document.activeElement).toBe(password);
    // Another directory with nothing remembered: the filled-in name is cleared; back again: filled in.
    const way = document.querySelector<HTMLSelectElement>('#adm-reauth-way')!;
    way.value = 'second-directory'; way.dispatchEvent(new Event('change'));
    expect(user.value).toBe('');
    way.value = 'example-directory'; way.dispatchEvent(new Event('change'));
    expect(user.value).toBe('dana');
    password.value = 'route-14-depot';
    document.querySelector<HTMLFormElement>('.adm-reauth-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await done).toBe(true);
    expect(posts).toEqual([{ url: '/api/auth/sso/example-directory/confirm', body: { username: 'dana', password: 'route-14-depot' } }]);
  });

  it('keeps a user name the person typed when they change the way', async () => {
    stubServer();
    void confirmIdentity('second-directory');
    const user = await until(() => document.querySelector<HTMLInputElement>('#adm-reauth-username')) as HTMLInputElement;
    expect(user.value).toBe('');
    expect(document.activeElement).toBe(user);
    user.value = 'typed-name';
    const way = document.querySelector<HTMLSelectElement>('#adm-reauth-way')!;
    way.value = 'example-directory'; way.dispatchEvent(new Event('change'));
    expect(user.value).toBe('typed-name');
    document.querySelector<HTMLButtonElement>('[data-act="cancel"]')!.click();
  });
});
