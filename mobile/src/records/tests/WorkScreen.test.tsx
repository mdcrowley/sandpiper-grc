// My work (E38-04): sections and counts from GET /api/mobile/home, refresh on opening, pull to refresh
// and the Refresh button, the tab badge, where items open, switched-off areas absent.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { resetMeta } from '../api';
import WorkScreen, { TEXT, totalWaiting } from '../screens/WorkScreen';
import { browser, router, sampleMeta, server, tabOptions } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('expo-web-browser', () => require('./mocks').browserMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());

const item = (over: Record<string, unknown>) => ({ type: 'ticket', id: 't1', label: 'Platform display blank', ref: 'TKT-00042', route: '/tickets/t1', status: 'New', due: null, overdue: false, ...over });

function home(sections: any[], unread = 0): any {
  return { sections, unreadNotifications: unread, generatedAt: '2026-11-22T09:30:00.000Z' };
}

const SECTIONS = [
  { key: 'tickets', label: 'Tickets assigned to me', count: 7, items: [item({}), item({ id: 't2', label: 'Ticket machine jammed', overdue: true, due: '2026-11-01' })], webRoute: '/tickets?assignee=me' },
  { key: 'approvals', label: 'Approvals waiting for me', count: 1, items: [item({ type: 'workflow_step', id: 's1', label: 'Change CHG-00010', ref: null, route: '/changes/c1', status: null })], webRoute: '/approvals' },
  { key: 'acknowledgments', label: 'Policies to acknowledge', count: 1, items: [item({ type: 'policy_acknowledgment', id: 'a1', label: 'Remote access policy', ref: 'POL-00003', route: '/policies/p1', status: null })], webRoute: '/my-acknowledgments' },
  { key: 'training', label: 'Training due', count: 1, items: [item({ type: 'training_assignment', id: 'tr1', label: 'Fire safety refresher', ref: null, route: '/training/my', status: null })], webRoute: '/training/my' },
];

jest.setTimeout(30_000);

beforeEach(() => {
  server.reset();
  resetMeta();
  jest.clearAllMocks();
  server.routes['GET /api/meta'] = sampleMeta();
});

describe('My work', () => {
  it('shows each section with its count and first items, and the badge from the last refresh', async () => {
    server.routes['GET /api/mobile/home'] = home(SECTIONS, 3);
    await render(<WorkScreen />);
    expect(await screen.findByText('Tickets assigned to me')).toBeTruthy();
    expect(screen.getByText(TEXT.waiting(7))).toBeTruthy();
    expect(screen.getByText('Platform display blank')).toBeTruthy();
    expect(screen.getAllByText(TEXT.overdue).length).toBeGreaterThan(0);
    expect(screen.getByText(TEXT.notifications(3))).toBeTruthy();
    // 7 tickets but 2 shown: the rest is on the web.
    expect(screen.getByText(TEXT.showAllWeb(7))).toBeTruthy();
    await waitFor(() => expect(tabOptions).toHaveBeenCalledWith({ tabBarBadge: 10, tabBarAccessibilityLabel: `${TEXT.title}, ${TEXT.waiting(10)}` }));
    expect(totalWaiting(home(SECTIONS))).toBe(10);
  });

  it('leaves out what the server leaves out (switched-off areas)', async () => {
    server.routes['GET /api/mobile/home'] = home(SECTIONS.filter((s) => s.key !== 'training'));
    await render(<WorkScreen />);
    await screen.findByText('Tickets assigned to me');
    expect(screen.queryByText('Training due')).toBeNull();
  });

  it('says when nothing is waiting, and clears the badge', async () => {
    server.routes['GET /api/mobile/home'] = home([{ key: 'tickets', label: 'Tickets assigned to me', count: 0, items: [], webRoute: '/tickets' }]);
    await render(<WorkScreen />);
    expect(await screen.findByText(TEXT.allClear)).toBeTruthy();
    expect(screen.getByText(TEXT.nothing)).toBeTruthy();
    await waitFor(() => expect(tabOptions).toHaveBeenCalledWith({ tabBarBadge: undefined, tabBarAccessibilityLabel: TEXT.title }));
  });

  it('opens records in the app, approvals and acknowledgments on their screens, and the rest on the web', async () => {
    server.routes['GET /api/mobile/home'] = home(SECTIONS);
    await render(<WorkScreen />);
    await screen.findByText('Platform display blank');
    await waitFor(() => expect(server.calls.some((c) => c.path === '/api/meta')).toBe(true));
    await act(async () => { await Promise.resolve(); });
    await fireEvent.press(screen.getByText('Platform display blank'));
    expect(router.push).toHaveBeenLastCalledWith('/record/ticket/t1');
    await fireEvent.press(screen.getByText('Change CHG-00010'));
    expect(router.push).toHaveBeenLastCalledWith('/approvals/step/s1');
    await fireEvent.press(screen.getByText('Remote access policy'));
    expect(router.push).toHaveBeenLastCalledWith('/approvals/acknowledgment/a1');
    await fireEvent.press(screen.getByText('Fire safety refresher'));
    await waitFor(() => expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://grc.example.org/training/my'));
  });

  it('refreshes with the button (no gesture needed) and when the app returns to the foreground', async () => {
    let n = 0;
    server.routes['GET /api/mobile/home'] = () => { n += 1; return home([{ ...SECTIONS[0], count: n }]); };
    let listener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce(((_: string, l: (s: string) => void) => { listener = l; return { remove: () => {} }; }) as never);
    await render(<WorkScreen />);

    expect(await screen.findByText(TEXT.waiting(1))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.refresh }));
    expect(await screen.findByText(TEXT.waiting(2))).toBeTruthy();
    await act(async () => { listener!('background'); });
    await act(async () => { listener!('active'); });
    expect(await screen.findByText(TEXT.waiting(3))).toBeTruthy();
  });

  it('keeps the last figures and shows the problem when a refresh fails', async () => {
    let fail = false;
    server.routes['GET /api/mobile/home'] = () => {
      if (fail) throw new (require('./mocks').FakeApiError)(0, 'offline', 'The server cannot be reached.');
      return home(SECTIONS);
    };
    await render(<WorkScreen />);
    await screen.findByText('Tickets assigned to me');
    fail = true;
    await fireEvent.press(screen.getByRole('button', { name: TEXT.refresh }));
    expect(await screen.findByText('Could not reach the server. Check the connection and try again.')).toBeTruthy();
    expect(screen.getByText('Tickets assigned to me')).toBeTruthy();
  });
});

describe('themes', () => {
  it('follows the phone’s dark setting', async () => {
    const RN = require('react-native');
    const spy = jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const { dark } = require('../../theme');
    server.routes['GET /api/mobile/home'] = home(SECTIONS);
    await render(<WorkScreen />);
    await screen.findByText('Tickets assigned to me');
    const scroll = screen.getByTestId('work-screen');
    expect(RN.StyleSheet.flatten(scroll.props.style).backgroundColor).toBe(dark.bg);
    spy.mockReturnValue('light');
  });
});
