// Offline work and Needs attention (E38-10): the server's reason is shown with each refused item and
// only the person sends it again or discards it; signing out wipes the offline storage.
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { OutboxItem } from './types';

const at = '2026-11-22T10:00:00Z';
const item = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'r1', seq: 1, kind: 'record.create', group: 'r1', label: 'Leaking pump', payload: {}, file: null, dependsOn: null,
  state: 'pending', attempts: 0, error: null, result: null, createdAt: at, updatedAt: at, ...over,
});

const mockBox = { retry: jest.fn(async () => {}), discard: jest.fn(async () => {}), process: jest.fn(async () => 'idle') };
const mockState = { items: [] as OutboxItem[], pkg: null as unknown };
jest.mock('./index', () => ({
  outbox: () => mockBox,
  offlinePackage: () => ({ refresh: jest.fn(async () => {}) }),
  sendNow: jest.fn(),
  useOutbox: () => mockState.items,
  useOfflinePackage: () => mockState.pkg,
}));

jest.setTimeout(20_000);

describe('Offline work screen', () => {
  beforeEach(() => { jest.clearAllMocks(); mockState.items = []; mockState.pkg = null; });

  it('shows what the server refused, with its reason, and sends again on the person\'s choice', async () => {
    const { default: OfflineScreen, TEXT } = require('./OfflineScreen');
    mockState.items = [
      item({ state: 'rejected', error: { code: 'validation', message: 'Check the highlighted fields.', fields: { title: 'Say in a few words what is wrong.' } } }),
      item({ id: 'p1', seq: 2, kind: 'attachment', label: 'Photo 1', dependsOn: 'r1' }),
    ];
    await render(<OfflineScreen />);
    expect(screen.getByText(/Check the highlighted fields\. title: Say in a few words/)).toBeTruthy();
    expect(screen.getByText('Photo 1 of Leaking pump')).toBeTruthy();
    expect(screen.getByText(TEXT.waitingFor)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${TEXT.sendAgain}: `) }));
    expect(mockBox.retry).toHaveBeenCalledWith('r1', { asNew: false });
  });

  it('offers "Send as new" when the server could not be sure, and asks before discarding', async () => {
    const { default: OfflineScreen, TEXT } = require('./OfflineScreen');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => { buttons?.find((b) => b.style === 'destructive')?.onPress?.(); });
    mockState.items = [item({ state: 'rejected', error: { code: 'uncertain', message: 'The server stopped while doing this.' } })];
    await render(<OfflineScreen />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${TEXT.sendAsNew}: `) }));
    expect(mockBox.retry).toHaveBeenCalledWith('r1', { asNew: true });
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${TEXT.discard}: `) }));
    expect(alert).toHaveBeenCalled();
    expect(mockBox.discard).toHaveBeenCalledWith('r1');
  });

  it('says when nothing waits and when there is no package', async () => {
    const { default: OfflineScreen, TEXT } = require('./OfflineScreen');
    await render(<OfflineScreen />);
    expect(screen.getByText(TEXT.nothing)).toBeTruthy();
    expect(screen.getByText(TEXT.noPackage)).toBeTruthy();
  });
});

describe('wiping', () => {
  it('registers the wipe and the unsent count at start, and the wipe deletes the offline storage', async () => {
    jest.resetModules();
    jest.unmock('./index');
    const session = { onWipe: jest.fn(), registerUnsentWork: jest.fn(), authStore: { get: () => ({ status: 'signed-out' }), subscribe: jest.fn() } };
    jest.doMock('../auth/session', () => session);
    const storage = { wipeOfflineStorage: jest.fn(async () => {}), sqliteOutbox: {}, sqlitePackage: { clear: jest.fn(async () => {}) } };
    jest.doMock('./sqlite', () => storage);
    jest.doMock('./transport', () => ({ serverTransport: {}, fetchPackage: jest.fn() }));
    jest.doMock('expo-network', () => ({ getNetworkStateAsync: jest.fn(), addNetworkStateListener: jest.fn(() => ({ remove() {} })) }));
    jest.doMock('expo-crypto', () => ({ randomUUID: () => 'x' }));
    jest.doMock('../api/client', () => ({ ApiError: class extends Error {} }));
    const offline = require('./index');
    offline.bootOffline();
    offline.bootOffline(); // once only
    expect(session.onWipe).toHaveBeenCalledTimes(1);
    expect(session.registerUnsentWork).toHaveBeenCalledTimes(1);
    const hook = (session.onWipe.mock.calls[0] as unknown as [() => Promise<void>])[0];
    await hook();
    expect(storage.wipeOfflineStorage).toHaveBeenCalled();
  });
});
