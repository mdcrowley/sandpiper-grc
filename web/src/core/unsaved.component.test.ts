// @vitest-environment happy-dom
import { createElement as h, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from './componentMeta';
import { byLabel, byText, click, render, reply, textOf, typeInto, waitFor, type Harness } from './componentHarness';
import { Modal } from './overlay';
import { formDraftKey, ResourceForm } from './ResourceForm';
import { clearSessionEnded, markSessionEnded, sessionEndedNotice } from './session';
import { useUnsavedChanges } from './unsaved';

// BW-01, BW-02, BW-03: one guard for unsaved changes in forms, pages and dialogs, and keeping the
// edit when the session ends in the middle of it. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
beforeEach(() => sessionStorage.clear());
beforeAll(() => {
  // happy-dom's <dialog> may lack showModal; the session prompt only needs it to open.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
  if (typeof proto.showModal !== 'function') proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
});

const ROW = { id: 'g1', name: 'Fare gate 7', _display: {} };
const page = () => document.body;
const prompt = () => byText(page(), '.ui-sheet', 'Discard your unsaved changes?') ?? byText(page(), '.ui-sheet', 'Discard this draft?');

/** A record page with an edit form and a link elsewhere, as RecordPage and the sidebar give. */
function EditPage({ onSaved = () => undefined }: { onSaved?: () => void }) {
  return h('div', null,
    h(Link, { to: '/elsewhere' }, 'Somewhere else'),
    h(ResourceForm, { type: 'gizmo', id: 'g1', fields: ['name'], customFields: false, initial: ROW, onSaved, onCancel: () => undefined }));
}

describe('unsaved changes guard', () => {
  it('asks before a link leaves a page with an unsaved edit, and stays when asked to (BW-01)', async () => {
    ui = await render(h(EditPage), { meta, route: '/gizmos/g1' });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Fare gate 8');
    await click(byText(ui.container, 'a', 'Somewhere else'));
    await waitFor(() => expect(prompt()).not.toBeNull());
    expect(ui.location()).toBe('/gizmos/g1');
    await click(byText(page(), 'button', 'Keep editing'));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(ui.location()).toBe('/gizmos/g1');
    expect((byLabel(ui.container, 'Name') as HTMLInputElement).value).toBe('Fare gate 8');

    await click(byText(ui.container, 'a', 'Somewhere else'));
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Discard changes'));
    await waitFor(() => expect(ui!.location()).toBe('/elsewhere'));
  });

  it('leaves at once when nothing was changed', async () => {
    ui = await render(h(EditPage), { meta, route: '/gizmos/g1' });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await click(byText(ui.container, 'a', 'Somewhere else'));
    await waitFor(() => expect(ui!.location()).toBe('/elsewhere'));
    expect(prompt()).toBeNull();
  });

  it('does not stop the move to the record just saved', async () => {
    function NewPage() {
      const navigate = useNavigate();
      return h(ResourceForm, { type: 'gizmo', fields: ['name'], customFields: false, onSaved: (row) => navigate(`/gizmos/${row.id}`) });
    }
    ui = await render(h(NewPage), { meta, route: '/gizmos/new', handlers: { 'POST /api/gizmos': (c) => ({ id: 'g9', ...(c.body as object) }) } });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Platform display 3');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(ui!.location()).toBe('/gizmos/g9'));
    expect(prompt()).toBeNull();
  });

  it('asks before a dialog with unsaved changes closes on Escape or Cancel (BW-03)', async () => {
    const closed = vi.fn();
    function Dialog() {
      const [title, setTitle] = useState('');
      const unsaved = useUnsavedChanges(title !== '');
      return h(Modal, {
        open: true, title: 'New gizmo', dirty: title !== '', onClose: closed,
        children: [
          h('label', { key: 'l' }, 'Title', h('input', { value: title, onChange: (e: { target: { value: string } }) => setTitle(e.target.value) })),
          h('button', { key: 'b', type: 'button', onClick: unsaved.guard(closed) }, 'Cancel draft'),
        ],
      });
    }
    ui = await render(h(Dialog), { meta });
    await waitFor(() => expect(byLabel(page(), 'Title')).not.toBeNull());
    await typeInto(byLabel(page(), 'Title'), 'Spare ticket printer');
    await click(byText(page(), 'button', 'Cancel draft'));
    await waitFor(() => expect(prompt()).not.toBeNull());
    await click(byText(page(), 'button', 'Keep editing'));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(closed).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(prompt()).not.toBeNull());
    expect(textOf(prompt())).toContain('Discard this draft?');
    await click(byText(page(), 'button', 'Discard'));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });

  it('a form inside a dialog makes the dialog ask before closing, with nothing passed by hand (BW-03)', async () => {
    const closed = vi.fn();
    ui = await render(h(Modal, {
      open: true, title: 'New gizmo', onClose: closed,
      children: h(ResourceForm, { type: 'gizmo', fields: ['name'], customFields: false, onSaved: () => undefined }),
    }), { meta });
    await waitFor(() => expect(byLabel(page(), 'Name')).not.toBeNull());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1)); // nothing typed: closes at once
    await typeInto(byLabel(page(), 'Name'), 'Ticket vending machine 2');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(prompt()).not.toBeNull());
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps the page when the session ends mid-edit, and sends the change again after signing in (BW-02)', async () => {
    const saved = vi.fn();
    let first = true;
    ui = await render(h(EditPage, { onSaved: saved }), {
      meta, route: '/gizmos/g1',
      handlers: {
        'PATCH /api/gizmos/g1': (c) => {
          if (first) { first = false; return reply(401, { error: { code: 'unauthenticated', message: 'Sign in first.' } }); }
          return { ...ROW, ...(c.body as object) };
        },
      },
    });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Fare gate 8');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(textOf(page().querySelector('dialog'))).toContain('Your session has ended'));
    expect((byLabel(ui.container, 'Name') as HTMLInputElement).value).toBe('Fare gate 8');
    await click(byText(page(), 'dialog button', 'Continue'));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const patches = ui.calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[1].body).toEqual({ name: 'Fare gate 8' });
    expect(page().querySelector('dialog')).toBeNull();
  });

  it('keeps the draft in the tab when the person signs in on the sign-in page instead (BW-02)', async () => {
    ui = await render(h(EditPage), {
      meta, route: '/gizmos/g1',
      handlers: { 'PATCH /api/gizmos/g1': () => reply(401, { error: { code: 'unauthenticated', message: 'Sign in first.' } }) },
    });
    await waitFor(() => expect(byLabel(ui!.container, 'Name')).not.toBeNull());
    await typeInto(byLabel(ui.container, 'Name'), 'Fare gate 8');
    await click(byText(ui.container, 'button[type="submit"]', ''));
    await waitFor(() => expect(page().querySelector('dialog')).not.toBeNull());
    await click(byText(page(), 'dialog button', 'Sign in on this page instead'));
    await waitFor(() => expect(sessionStorage.getItem(`grc:draft:${formDraftKey('gizmo', 'g1', ['name'])}`)).toContain('Fare gate 8'));
    ui.unmount();

    // Signed in again: the form comes back with the draft in it, once.
    ui = await render(h(EditPage), { meta, route: '/gizmos/g1' });
    await waitFor(() => expect((byLabel(ui!.container, 'Name') as HTMLInputElement | null)?.value).toBe('Fare gate 8'));
    expect(textOf(ui.container)).toContain('Your session ended before these changes were saved');
    expect(sessionStorage.getItem(`grc:draft:${formDraftKey('gizmo', 'g1', ['name'])}`)).toBeNull();
  });

  it('tells the sign-in page why it is showing after the session ended', () => {
    expect(sessionEndedNotice()).toBeNull();
    markSessionEnded();
    expect(sessionEndedNotice()).toBe('Your session ended. Sign in again to continue.');
    markSessionEnded(true);
    markSessionEnded(); // a later 401 does not hide that drafts were kept
    expect(sessionEndedNotice()).toContain('what you were editing has been kept');
    clearSessionEnded();
    expect(sessionEndedNotice()).toBeNull();
  });
});
