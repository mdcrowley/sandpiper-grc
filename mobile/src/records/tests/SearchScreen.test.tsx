// Search (E38-07): results from GET /api/search (what the person may see), opening in the app or on
// the web, recent items.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { resetMeta } from '../api';
import { clearRecent, rememberRecent } from '../recent';
import SearchScreen, { TEXT } from '../screens/SearchScreen';
import { browser, router, sampleMeta, server, wipeHooks } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('expo-web-browser', () => require('./mocks').browserMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());

jest.setTimeout(30_000);

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(async () => {
  server.reset();
  resetMeta();
  await clearRecent();
  jest.clearAllMocks();
  server.routes['GET /api/meta'] = sampleMeta();
  server.routes['GET /api/search'] = [
    { type: 'ticket', typeLabel: 'Ticket', id: 't1', label: 'Platform display shows no departures', ref: 'TKT-00042', route: '/tickets/t1', matched: 'record' },
    { type: 'vendor', typeLabel: 'Vendor', id: 'v1', label: 'Example Displays Ltd', ref: null, route: '/vendors/v1', matched: 'comment', snippet: 'display contract' },
  ];
});

describe('search', () => {
  it('searches after two characters and opens results in the app or on the web', async () => {
    await render(<SearchScreen />);
    await fireEvent.changeText(screen.getByLabelText(TEXT.box), 'd');
    expect(screen.getByText(TEXT.tooShort)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(TEXT.box), 'display');
    await wait(400);
    expect(await screen.findByText(TEXT.results(2))).toBeTruthy();
    expect(server.calls.some((c) => c.path === '/api/search?q=display')).toBe(true);
    expect(screen.getByText(TEXT.inComment)).toBeTruthy();
    await fireEvent.press(screen.getByText('Platform display shows no departures'));
    expect(router.push).toHaveBeenCalledWith('/record/ticket/t1');
    await fireEvent.press(screen.getByText('Example Displays Ltd'));
    await waitFor(() => expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://grc.example.org/vendors/v1'));
  });

  it('says when nothing is found', async () => {
    server.routes['GET /api/search'] = [];
    await render(<SearchScreen />);
    await fireEvent.changeText(screen.getByLabelText(TEXT.box), 'zz-nothing');
    await fireEvent.press(screen.getByRole('button', { name: TEXT.searchButton }));
    expect(await screen.findByText(TEXT.noResults('zz-nothing'))).toBeTruthy();
  });

  it('lists recent records while the box is empty, and clears them', async () => {
    await rememberRecent({ type: 'ticket', typeLabel: 'Ticket', id: 't1', label: 'Platform display shows no departures', ref: 'TKT-00042' });
    await render(<SearchScreen />);
    expect(await screen.findByText('Platform display shows no departures')).toBeTruthy();
    await fireEvent.press(screen.getByText('Platform display shows no departures'));
    expect(router.push).toHaveBeenCalledWith('/record/ticket/t1');
    await fireEvent.press(screen.getByRole('link', { name: TEXT.clearRecent }));
    expect(await screen.findByText(TEXT.noRecent)).toBeTruthy();
  });

  it('forgets recent records when the session is wiped', async () => {
    await rememberRecent({ type: 'ticket', typeLabel: 'Ticket', id: 't1', label: 'Old', ref: null });
    for (const h of wipeHooks) await h();
    await render(<SearchScreen />);
    expect(await screen.findByText(TEXT.noRecent)).toBeTruthy();
  });
});
