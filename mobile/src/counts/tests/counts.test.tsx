// Counting offline (E38-12): every tag read in view is counted once, found and unexpected shown as they
// happen from the offline package, each find saved in the outbox, and the server's answer shown once it
// arrived.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PackageCount, PackageTag } from '../../../../shared/mobile-api.ts';
import { classify, newFind, progress, type CountSession } from '../match';
import { field } from '../../inspections/tests/fieldMocks';
import { camera, server } from '../../tags/tests/mocks';
import type { FrameReads } from '../../tags/read';

jest.mock('../../api/client', () => require('../../tags/tests/mocks').clientMock());
jest.mock('../../auth/session', () => require('../../tags/tests/mocks').sessionMock());
jest.mock('expo-router', () => require('../../tags/tests/mocks').routerMock());
jest.mock('react-native-vision-camera', () => require('../../tags/tests/mocks').visionCameraMock());
jest.mock('../../camera/TagCamera', () => require('../../tags/tests/mocks').tagCameraMock());
jest.mock('../../offline', () => require('../../inspections/tests/fieldMocks').offlineMock());
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Warning: 'warning' } }));
let mockId = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockId).padStart(12, '0')}` }));

jest.setTimeout(20_000);

const count: PackageCount = {
  id: 'c1', ref: 'CNT-00002', title: 'Invented depot 21', site: { id: 's1', label: 'Invented depot 21' }, area: null, recordTypes: ['asset'],
  startedAt: null, totals: { expected: 3, found: 1, unexpected: 0, pending: 2, missing: 0 }, truncated: false,
  items: [
    { recordType: 'asset', recordId: 'a1', label: 'Invented charger 1', ref: null, tagValue: 'TA-100001', expected: true, state: 'pending' },
    { recordType: 'asset', recordId: 'a2', label: 'Invented charger 2', ref: null, tagValue: 'TA-100002', expected: true, state: 'found' },
    { recordType: 'asset', recordId: 'a3', label: 'Invented charger 3', ref: null, tagValue: 'TA-100003', expected: true, state: 'pending' },
  ],
};
const tags: PackageTag[] = [
  { value: 'TA-100009', valueKey: 'TA100009', recordType: 'asset', recordId: 'a9', label: 'Invented charger 9' },
  { value: 'V-0042', valueKey: 'V0042', recordType: 'vehicle', recordId: 'v1', label: 'Invented bus 42' },
];

describe('what a tag read is', () => {
  it('found, found before, unexpected, not covered or unknown', () => {
    expect(classify(count, tags, 'ta 100001')).toMatchObject({ kind: 'found', label: 'Invented charger 1', recordKey: 'asset:a1' });
    expect(classify(count, tags, 'TA-100002').kind).toBe('found_before');
    expect(classify(count, tags, 'TA-100009')).toMatchObject({ kind: 'unexpected', label: 'Invented charger 9' });
    expect(classify(count, tags, 'V-0042').kind).toBe('not_covered');
    expect(classify(count, tags, 'TA-555555')).toMatchObject({ kind: 'unknown', label: null });
  });

  it('counts each value once, and adds up progress with what others found before', () => {
    let s: CountSession = { countId: 'c1', joinedAt: '', finds: [] };
    const f = newFind(s, count, tags, 'TA-100001', 'code', 'x1')!;
    s = { ...s, finds: [f] };
    expect(newFind(s, count, tags, 'ta-100001', 'text', 'x2')).toBeNull();
    s = { ...s, finds: [newFind(s, count, tags, 'TA-100009', 'code', 'x3')!, ...s.finds] };
    expect(progress(count, s)).toMatchObject({ expected: 3, found: 2 });
    expect(progress(count, s).unexpected.map((u) => u.value)).toEqual(['TA-100009']);
  });
});

describe('counting mode', () => {
  const frame = (codes: { content: string }[]): FrameReads => ({ width: 1000, height: 1000, codes: codes.map((c) => ({ type: 'qr-code', ...c })), lines: [] });
  beforeEach(() => {
    field.reset();
    server.reset();
    jest.clearAllMocks();
    field.pkg = { tags: { formats: [], values: tags }, parts: { counts: [count] } };
  });

  it('counts every tag in view once, shows found and unexpected at once, and saves each find in the outbox', async () => {
    const { default: CountScreen, TEXT } = require('../CountScreen');
    await render(<CountScreen id="c1" />);
    await waitFor(() => expect(camera.onReads).toBeTruthy());
    await waitFor(() => expect(field.drafts.get('count:c1')).toBeTruthy());
    expect(screen.getByText(TEXT.progress(1, 3))).toBeTruthy();
    // A shelf: three tags in one frame, then the same tags again (the camera keeps reading them).
    await act(async () => { camera.onReads!(frame([{ content: 'TA-100001' }, { content: 'TA-100009' }, { content: 'V-0042' }])); });
    await act(async () => { camera.onReads!(frame([{ content: 'TA-100001' }, { content: 'TA-100009' }])); });
    await waitFor(() => expect(screen.getByText(TEXT.progress(2, 3))).toBeTruthy());
    expect(screen.getByText(/TA-100009 · Unexpected: registered somewhere else \(waiting to send\)/)).toBeTruthy();
    expect(screen.getByText(/V-0042 · Not covered by this count/)).toBeTruthy();
    // Two finds sent (the bus is not covered), each its own outbox item with its own id.
    const sent = field.added.flat() as { kind: string; payload: Record<string, unknown> }[];
    expect(sent.map((i) => [i.kind, i.payload.value, i.payload.source])).toEqual([['count.found', 'TA-100001', 'code'], ['count.found', 'TA-100009', 'code']]);
    expect((field.drafts.get('count:c1') as CountSession).finds).toHaveLength(3);
  });

  it('shows the server\'s answer once a find arrived, and counts a typed number', async () => {
    const { default: CountScreen, TEXT } = require('../CountScreen');
    field.drafts.set('count:c1', { countId: 'c1', joinedAt: '', finds: [{ clientId: 'f1', key: 'TA555555', value: 'TA-555555', source: 'code', kind: 'unknown', label: null, recordKey: null, at: '' }] });
    field.items = [{ id: 'f1', seq: 1, kind: 'count.found', group: 'f1', label: 'TA-555555', payload: {}, file: null, dependsOn: null, state: 'done', attempts: 1, error: null, result: { outcome: 'unexpected', message: '' }, createdAt: '', updatedAt: '' }];
    await render(<CountScreen id="c1" />);
    expect(await screen.findByText(/TA-555555 · Unexpected: registered somewhere else \(sent\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(TEXT.typed), 'TA-100003');
    await fireEvent.press(screen.getByLabelText(TEXT.count));
    await waitFor(() => expect(screen.getByText(TEXT.progress(2, 3))).toBeTruthy());
    expect((field.added.flat()[0] as { payload: Record<string, unknown> }).payload).toEqual({ countId: 'c1', value: 'TA-100003', source: 'typed' });
  });

  it('needs the count in the package, and the permission to count', async () => {
    const { default: CountScreen, TEXT } = require('../CountScreen');
    await render(<CountScreen id="other" />);
    expect(screen.getByText(TEXT.notInPackage)).toBeTruthy();
    server.can = new Set(['tags.view']);
    await render(<CountScreen id="c1" />);
    expect(screen.getByText(TEXT.notAllowed)).toBeTruthy();
  });
});
