// The Notifications screen with a screen reader and large text (E38-15): every notification named by
// its title as shown, the filter buttons 48 points high with their state, the full text shown (never
// cut off), and buttons for what pulling and scrolling do (Try again, Load more).
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import NotificationsScreen from '../app/notifications';
import { notificationsText as T } from '../src/text/notifications';

const mockPages: { fail: boolean; total: number } = { fail: false, total: 2 };
const mockPage = jest.fn();
jest.mock('../src/api/client', () => ({
  ApiError: class extends Error {},
  CLIENT_ERRORS: { offline: 'offline' },
  apiFetch: jest.fn(async () => ({ unread: 0 })),
}));
jest.mock('../src/api/notifications', () => ({ notificationsPage: (...a: unknown[]) => mockPage(...a) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const row = (id: string, title: string, read: boolean) => ({
  id, title, body: 'An invented change waits for your approval, with a long explanation that goes on and on.', created_at: '2026-11-22T10:00:00Z',
  read_at: read ? '2026-11-22T11:00:00Z' : null, record_type: 'ticket', record_id: 't1', unavailable: false,
});

beforeEach(() => {
  mockPages.fail = false;
  mockPage.mockReset();
  mockPage.mockImplementation(async (page: number) => {
    if (mockPages.fail) throw new Error('down');
    return { rows: page === 1 ? [row('n1', 'Change waiting for approval', false)] : [row('n2', 'Ticket assigned to you', true)], total: mockPages.total, unread: 1 };
  });
});

describe('Notifications screen', () => {
  it('names each notification by its title first, then unread, and shows all of its text', async () => {
    await render(<NotificationsScreen />);
    const item = await screen.findByRole('button', { name: /^Change waiting for approval, Unread, An invented change/ });
    expect(item).toBeTruthy();
    expect(screen.getByText(/goes on and on\./).props.numberOfLines).toBeUndefined();
    const all = screen.getByRole('button', { name: T.showAll });
    expect(all.props.accessibilityState).toEqual({ selected: true });
    expect(StyleSheet.flatten(all.props.style).minHeight).toBeGreaterThanOrEqual(48);
    // In the list, not the top bar, where at 200% text it cut the title short.
    expect(screen.getByRole('button', { name: T.markAllRead })).toBeTruthy();
  });

  it('has a Load more button for the next page, without scrolling to the end', async () => {
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: T.loadMore }));
    expect(mockPage).toHaveBeenLastCalledWith(2, false);
    expect(await screen.findByRole('button', { name: /^Ticket assigned to you, / })).toBeTruthy();
  });

  it('offers Try again when the list could not be loaded, as well as pulling down', async () => {
    mockPages.fail = true;
    await render(<NotificationsScreen />);
    expect(await screen.findByText(T.loadFailed)).toBeTruthy();
    mockPages.fail = false;
    await fireEvent.press(screen.getByRole('button', { name: T.tryAgain }));
    expect(await screen.findByRole('button', { name: /^Change waiting for approval, / })).toBeTruthy();
  });
});
