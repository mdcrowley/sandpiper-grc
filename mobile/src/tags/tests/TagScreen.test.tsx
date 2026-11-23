// The Tag tab (E38-05): codes looked up at once and the card opened; several tags listed; text without
// a format only offered; keyboard entry; a still picture read the same way; stock offers Attach.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import TagScreen, { TEXT } from '../screens/TagScreen';
import { clearTagSettings } from '../formats';
import { camera, params, router, server, still } from './mocks';
import type { LookupResult, TagCard } from '../../../../shared/asset-tags-api.ts';
import type { FrameReads } from '../read';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('react-native-vision-camera', () => require('./mocks').visionCameraMock());
jest.mock('../../camera/TagCamera', () => require('./mocks').tagCameraMock());
jest.mock('../../camera/still', () => require('./mocks').stillMock());
jest.mock('expo-image-picker', () => require('./mocks').pickerMock());
// The offline package (wave 15): looked up when the server cannot be reached.
const mockOffline: { pkg: unknown } = { pkg: null };
jest.mock('../../offline', () => ({ offlinePackage: () => ({ current: async () => mockOffline.pkg }) }));

jest.setTimeout(20_000);

const card = (id: string, title: string): TagCard => ({
  recordType: 'asset', typeLabel: 'Asset', recordId: id, route: `/assets/${id}`, title, ref: null, tagValue: null, tagValues: [],
  status: null, photo: null, site: null, location: null, people: [], facts: [],
  activity: { openTickets: [], lastInspection: null, lastCondition: null, recentChanges: [] }, holds: [], restricted: false, lastSeen: null, version: '"1"', actions: [],
});
const registry: Record<string, TagCard> = { TA118342: card('a1', 'Ticket machine 4'), K7Q2M9: card('a2', 'Platform display 2'), '004521': card('a3', 'Pump 7') };
const stock = new Set(['008001']);

function lookupRoute({ body }: { body?: unknown }) {
  const { candidates } = body as { candidates: LookupResult['candidate'][] };
  const results: LookupResult[] = candidates.map((c) => {
    const key = c.value.replace(/[\s_-]/g, '').toUpperCase();
    const base = { candidate: c, key, replacedBy: null, matchedBy: null, formatId: null, actions: [] as LookupResult['actions'], cards: [] as TagCard[] };
    if (registry[key]) return { ...base, outcome: 'current', message: '', cards: [registry[key]] };
    if (stock.has(key)) return { ...base, outcome: 'in_stock', message: `Tag ${c.value} is not attached yet.`, actions: [{ key: 'attach', label: 'Attach', webPath: null, prefill: null, value: c.value }] };
    return { ...base, outcome: 'nothing', message: `Nothing found for ${c.value}.` };
  });
  return { results, records: 0 };
}

const frame = (over: Partial<FrameReads>): FrameReads => ({ width: 1000, height: 1000, codes: [], lines: [], ...over });
const feed = async (f: FrameReads) => { await act(async () => { camera.onReads!(f); }); };
const lookups = () => server.calls.filter((c) => c.path === '/api/asset-tags/lookup');

beforeEach(() => {
  mockOffline.pkg = null;
  server.reset();
  clearTagSettings();
  jest.clearAllMocks();
  params.current = {};
  server.routes['GET /api/mobile/settings'] = { tags: { formats: [], confirmTextWithoutFormat: true }, areas: { tags: true } };
  server.routes['POST /api/asset-tags/lookup'] = lookupRoute;
});

describe('Tag screen', () => {
  it('reads a code, looks it up and opens its card', async () => {
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ codes: [{ type: 'qr-code', content: 'TA-118342', box: { x: 10, y: 10, width: 100, height: 100 } }] }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/tag\/card\?answer=\d+$/)));
    expect(lookups()[0].body).toEqual({ candidates: [{ value: 'TA-118342', source: 'code' }] });
  });

  it('lists several tags in view instead of opening one', async () => {
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ codes: [
      { type: 'qr-code', content: 'TA-118342', box: { x: 0, y: 0, width: 50, height: 50 } },
      { type: 'data-matrix', content: 'K7Q2M9', box: { x: 600, y: 600, width: 50, height: 50 } },
    ] }));
    expect(await screen.findByText('Asset Ticket machine 4')).toBeTruthy();
    expect(screen.getByText('Asset Platform display 2')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('offers text read without a format for confirmation, and only then looks it up', async () => {
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ lines: [{ text: 'PROPERTY OF THE AUTHORITY' }, { text: '004521' }] }));
    await feed(frame({ lines: [{ text: 'PROPERTY OF THE AUTHORITY' }, { text: '004521' }] }));
    const row = await screen.findByText('004521');
    await new Promise((r) => setTimeout(r, 500));
    expect(lookups()).toHaveLength(0);
    await fireEvent.press(row);
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(lookups()[0].body).toEqual({ candidates: [{ value: '004521', source: 'text' }] });
  });

  it('finds a typed number', async () => {
    await render(<TagScreen />);
    await fireEvent.press(await screen.findByLabelText(TEXT.keyboard));
    await fireEvent.changeText(screen.getByLabelText(TEXT.typedLabel), 'ta-118 342');
    await fireEvent.press(screen.getByLabelText(TEXT.find));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(lookups()[0].body).toEqual({ candidates: [{ value: 'ta-118 342', source: 'typed' }] });
  });

  it('reads a still picture the same way', async () => {
    still.readStill.mockResolvedValue(frame({ still: true, codes: [{ type: 'code-128', content: '004521' }] }));
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await fireEvent.press(screen.getByLabelText(TEXT.shutter));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(still.readStill).toHaveBeenCalledWith('/cache/shot.jpg');
  });

  it('offers Attach for a tag in stock', async () => {
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ codes: [{ type: 'code-128', content: '008001' }] }));
    await fireEvent.press(await screen.findByText(TEXT.attach));
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/tag\/attach\?answer=/));
  });

  it('says plainly when nothing was found', async () => {
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ codes: [{ type: 'code-128', content: '009001' }] }));
    expect(await screen.findByText(/Nothing found for 009001/)).toBeTruthy();
  });

  it('without a connection, looks values up in the offline package, and says when one is not there', async () => {
    const { FakeApiError } = require('./mocks');
    server.routes['POST /api/asset-tags/lookup'] = () => { throw new FakeApiError(0, 'offline', 'No connection.'); };
    mockOffline.pkg = { tags: { formats: [], values: [{ value: 'TA-118342', valueKey: 'TA118342', recordType: 'asset', recordId: 'a1', label: 'Ticket machine 4' }] } };
    await render(<TagScreen />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await feed(frame({ codes: [{ type: 'qr-code', content: 'TA-118342' }] }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/tag\/card\?answer=/)));
    await feed(frame({ codes: [{ type: 'code-128', content: '009001' }] }));
    expect(await screen.findByText(/009001 is not available offline/)).toBeTruthy();
  });

  it('works without the camera gesture or sight: the torch says on or off, typing a number opens a box (E38-15)', async () => {
    await render(<TagScreen />);
    const torch = await screen.findByRole('togglebutton', { name: TEXT.torchOff });
    expect(torch.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(torch);
    expect(screen.getByRole('togglebutton', { name: TEXT.torchOn }).props.accessibilityState).toMatchObject({ checked: true });
    const keyboard = screen.getByRole('button', { name: TEXT.keyboard });
    expect(keyboard.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(keyboard);
    expect(screen.getByRole('button', { name: TEXT.keyboard }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByLabelText(TEXT.typedLabel)).toBeTruthy();
    // Pressed again, the box closes and the camera comes back (it folds away while a number is typed).
    await fireEvent.press(screen.getByRole('button', { name: TEXT.keyboard }));
    expect(screen.queryByLabelText(TEXT.typedLabel)).toBeNull();
    // Every control is a button of at least 48 points.
    for (const name of [TEXT.shutter, TEXT.library, TEXT.keyboard]) {
      const style = screen.getByRole('button', { name }).props.style;
      expect((Array.isArray(style) ? Object.assign({}, ...style.flat()) : style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it('shows nothing of itself while asset tags are off', async () => {
    server.areas.tags = false;
    await render(<TagScreen />);
    expect(screen.getByText(TEXT.off)).toBeTruthy();
  });
});
