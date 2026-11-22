// The tag card (E38-05): what the record is, the server's actions in its order, what each does in the
// app, and the still picture attached only when asked (and deleted otherwise).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import TagCardScreen, { TEXT } from '../screens/TagCardScreen';
import * as handoff from '../handoff';
import { params, router, server, still } from './mocks';
import type { TagAction, TagCard } from '../../../../shared/asset-tags-api.ts';
import type { ReadingAnswer } from '../lookup';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('../../camera/still', () => require('./mocks').stillMock());
jest.mock('expo-image-picker', () => require('./mocks').pickerMock());
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('../../camera/photos', () => ({
  attachmentLimits: jest.fn(async () => ({ maxBytes: 10_000_000, allowedExtensions: ['jpg'] })),
  fitPhoto: jest.fn(async () => ({ uri: 'file:///cache/fitted.jpg', bytes: 1000 })),
  photoName: () => 'photo-1.jpg',
  uploadPhoto: jest.fn(async () => ({ id: 'att1' })),
}));

const action = (key: TagAction['key'], label: string, extra: Partial<TagAction> = {}): TagAction => ({ key, label, webPath: null, prefill: null, ...extra });

const sampleCard = (): TagCard => ({
  recordType: 'asset', typeLabel: 'Asset', recordId: 'a1', route: '/assets/a1', title: 'Ticket machine 4', ref: 'AST-00012',
  tagValue: 'TA-118342', tagValues: ['TA-118342'], status: { value: 'in_service', label: 'In service', color: 'green' }, photo: null,
  site: { type: 'site', id: 's1', label: 'North depot', ref: null, route: '/sites/s1' }, location: 'Bay 3',
  people: [{ field: 'owner_id', label: 'Owner', userId: 'u2', name: 'Sam Sample' }],
  facts: [{ field: 'make', label: 'Make', value: 'Example Works' }, { field: 'condition_rating', label: 'Condition', value: null }],
  activity: { openTickets: [{ type: 'ticket', id: 't1', label: 'Screen blank', ref: 'TKT-00042', route: '/tickets/t1', status: 'New', date: null }], lastInspection: null, lastCondition: null, recentChanges: [] },
  holds: [], restricted: false, lastSeen: null, version: '"3"',
  actions: [
    action('report_problem', 'Report a problem', { prefill: { type: 'ticket', path: '/api/tickets', values: { asset_id: 'a1' } } }),
    action('add_photo', 'Add photo'), action('add_note', 'Add note'),
    action('start_inspection', 'Start inspection', { webPath: '/audits/inspections?asset=a1' }),
    action('open', 'Open full record'),
  ],
});

function openCard(picture: string | null = null) {
  const answer = {
    reading: { key: 'TA118342', value: 'TA-118342', how: 'code', trust: 'exact', formatId: null, variants: ['TA-118342'] },
    status: 'record', choices: [], message: '',
    result: { candidate: { value: 'TA-118342', source: 'code' }, key: 'TA118342', outcome: 'current', message: '', cards: [sampleCard()], replacedBy: null, matchedBy: null, formatId: null, actions: [] },
  } as ReadingAnswer;
  params.current = { answer: handoff.put({ kind: 'answer', answer, picture }) };
}

beforeEach(() => { server.reset(); jest.clearAllMocks(); });

describe('tag card', () => {
  it('shows the record and the server\'s actions in order, skipping empty facts', async () => {
    openCard();
    await render(<TagCardScreen />);
    expect(screen.getByText('Ticket machine 4')).toBeTruthy();
    expect(screen.getByText('Asset · AST-00012')).toBeTruthy();
    expect(screen.getByText('North depot')).toBeTruthy();
    expect(screen.getByText('Example Works')).toBeTruthy();
    expect(screen.queryByText('Condition')).toBeNull();
    const labels = ['Report a problem', 'Add photo', 'Add note', `Start inspection ${TEXT.onWeb}`, 'Open full record'];
    labels.forEach((l) => expect(screen.getByLabelText(l)).toBeTruthy());
  });

  it('starts a report with the server\'s prefill, and opens the record view', async () => {
    openCard();
    await render(<TagCardScreen />);
    await fireEvent.press(screen.getByLabelText('Report a problem'));
    const href = router.push.mock.calls[0][0] as string;
    expect(href).toMatch(/^\/report\/new\?start=\d+$/);
    const start = handoff.get(href.split('=')[1], 'report')!.start;
    expect(start).toMatchObject({ kind: 'problem', prefill: { path: '/api/tickets', values: { asset_id: 'a1' } }, record: { id: 'a1', siteId: 's1' } });
    await fireEvent.press(screen.getByLabelText('Open full record'));
    expect(router.push).toHaveBeenLastCalledWith('/record/asset/a1');
  });

  it('adds a note', async () => {
    server.routes['POST /api/comments'] = { id: 'c1' };
    openCard();
    await render(<TagCardScreen />);
    await fireEvent.press(screen.getByLabelText('Add note'));
    await fireEvent.changeText(screen.getByLabelText(TEXT.note), 'Cover loose');
    await fireEvent.press(screen.getByLabelText(TEXT.saveNote));
    expect(await screen.findByText(TEXT.noteAdded)).toBeTruthy();
    expect(server.calls.find((c) => c.path === '/api/comments')?.body).toEqual({ record_type: 'asset', record_id: 'a1', body: 'Cover loose' });
  });

  it('attaches the still picture only when asked, and deletes it when the card closes otherwise', async () => {
    openCard('/cache/shot.jpg');
    const view = await render(<TagCardScreen />);
    expect(screen.getByLabelText(TEXT.attachPicture)).toBeTruthy();
    await view.unmount();
    expect(still.discardPicture).toHaveBeenCalledWith('/cache/shot.jpg');

    jest.clearAllMocks();
    openCard('/cache/shot2.jpg');
    await render(<TagCardScreen />);
    await fireEvent.press(screen.getByLabelText(TEXT.attachPicture));
    await waitFor(() => expect(screen.getByText(TEXT.pictureAttached)).toBeTruthy());
    const { uploadPhoto } = jest.requireMock('../../camera/photos') as { uploadPhoto: jest.Mock };
    expect(uploadPhoto).toHaveBeenCalledWith('asset', 'a1', 'file:///cache/fitted.jpg', 'photo-1.jpg');
  });
});
