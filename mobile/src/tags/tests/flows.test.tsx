// What a tag card leads to (E38-05, E37-07): attaching a tag in stock, replacing a tag (typed or read
// with the camera), and quick updates saved with the version the person saw.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AttachScreen, { TEXT as ATTACH } from '../screens/AttachScreen';
import ReplaceScreen, { TEXT as REPLACE } from '../screens/ReplaceScreen';
import QuickUpdateScreen, { TEXT as QUICK } from '../screens/QuickUpdateScreen';
import * as handoff from '../handoff';
import { FakeApiError, params, router, server } from './mocks';
import type { TagCard } from '../../../../shared/asset-tags-api.ts';
import type { ReadingAnswer } from '../lookup';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('../../camera/still', () => require('./mocks').stillMock());
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

jest.setTimeout(20_000);

const card = { recordType: 'asset', recordId: 'a1', typeLabel: 'Asset', title: 'Pump 7', version: '"7"', actions: [] } as unknown as TagCard;
const found = { results: [{ candidate: { value: '004521', source: 'typed' }, key: '004521', outcome: 'current', message: '', cards: [card], replacedBy: null, matchedBy: null, formatId: null, actions: [] }], records: 1 };

beforeEach(() => { server.reset(); jest.clearAllMocks(); });

it('attaches a tag in stock to the chosen record, then shows its card', async () => {
  const answer = { reading: { key: '008001', value: '008001', how: 'code', trust: 'exact', formatId: null, variants: ['008001'] }, status: 'stock', result: null, choices: [], message: 'Tag 008001 is not attached yet.' } as unknown as ReadingAnswer;
  params.current = { answer: handoff.put({ kind: 'answer', answer, picture: null }) };
  server.routes['GET /api/records/lookup'] = [{ id: 'a1', label: 'Pump 7', ref: 'AST-00007' }];
  server.routes['POST /api/asset-tags/attach'] = { id: 'as1' };
  server.routes['POST /api/asset-tags/lookup'] = found;
  await render(<AttachScreen />);
  await fireEvent.press(await screen.findByText('Pump 7'));
  await fireEvent.press(screen.getByLabelText(`${ATTACH.attach}: Pump 7`));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/tag\/card\?answer=/)));
  expect(server.calls.find((c) => c.path === '/api/asset-tags/attach')?.body).toEqual({ recordType: 'asset', recordId: 'a1', value: '008001', source: 'code' });
});

it('shows the server\'s refusal when attaching is not allowed', async () => {
  const answer = { reading: { key: '008001', value: '008001', how: 'code', trust: 'exact', formatId: null, variants: ['008001'] }, status: 'stock', result: null, choices: [], message: '' } as unknown as ReadingAnswer;
  params.current = { answer: handoff.put({ kind: 'answer', answer, picture: null }) };
  server.routes['GET /api/records/lookup'] = [{ id: 'a1', label: 'Pump 7' }];
  server.routes['POST /api/asset-tags/attach'] = () => { throw new FakeApiError(409, 'on_hold', 'This record is under a legal hold.'); };
  await render(<AttachScreen />);
  await fireEvent.press(await screen.findByText('Pump 7'));
  await fireEvent.press(screen.getByLabelText(`${ATTACH.attach}: Pump 7`));
  expect(await screen.findByText('This record is under a legal hold.')).toBeTruthy();
});

it('replaces the current tag with a typed number and a reason', async () => {
  params.current = { card: handoff.put({ kind: 'card', card, picture: null }) };
  server.routes['GET /api/asset-tags/record'] = { current: [{ id: 'as9', value: 'TA-118342', primary: true }], earlier: [], lastSeen: null, lastVerified: null, canManage: true, held: false };
  server.routes['POST /api/asset-tags/replace'] = { id: 'as10' };
  server.routes['POST /api/asset-tags/lookup'] = found;
  await render(<ReplaceScreen />);
  expect(await screen.findByText(`${REPLACE.current}: TA-118342`)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText(REPLACE.newValue), '004521');
  await fireEvent.changeText(screen.getByLabelText(REPLACE.reason), 'Damaged');
  await fireEvent.press(screen.getByLabelText(REPLACE.replace));
  await waitFor(() => expect(router.dismissTo).toHaveBeenCalled());
  expect(server.calls.find((c) => c.path === '/api/asset-tags/replace')?.body).toEqual({ assignmentId: 'as9', value: '004521', source: 'typed', reason: 'Damaged' });
});

it('reads the new tag with the camera in pick mode', async () => {
  params.current = { card: handoff.put({ kind: 'card', card, picture: null }) };
  server.routes['GET /api/asset-tags/record'] = { current: [{ id: 'as9', value: 'TA-118342', primary: true }], earlier: [] };
  await render(<ReplaceScreen />);
  await fireEvent.press(screen.getByLabelText(REPLACE.read));
  expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/tag\?pick=\d+$/));
});

it('quick updates send only what changed, with If-Match, and explain a conflict', async () => {
  const withFields = { ...card, actions: [{ key: 'quick_update', label: 'Quick update', webPath: null, prefill: null, fields: [
    { field: 'location', label: 'Location', type: 'text', value: 'Bay 3', display: 'Bay 3' },
    { field: 'status', label: 'Status', type: 'lookup', list: 'asset_status', value: 'in_service', display: 'In service' },
  ] }] } as unknown as TagCard;
  params.current = { card: handoff.put({ kind: 'card', card: withFields, picture: null }) };
  server.routes['GET /api/meta'] = { resources: { asset: { path: '/api/assets' } } };
  let conflict = true;
  server.routes['PATCH /api/assets/a1'] = () => { if (conflict) { conflict = false; throw new FakeApiError(409, 'version_conflict', 'Changed.'); } return {}; };
  await render(<QuickUpdateScreen />);
  await fireEvent.changeText(screen.getByLabelText('Location'), 'Bay 4');
  await fireEvent.press(screen.getByLabelText(QUICK.save));
  expect(await screen.findByText(QUICK.conflict)).toBeTruthy();
  const patch = server.calls.find((c) => c.method === 'PATCH');
  expect(patch).toMatchObject({ body: { location: 'Bay 4' }, ifMatch: '"7"' });
});
