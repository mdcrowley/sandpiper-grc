// Field work screens (E38-11): the inspection runner (Pass, Fail, Not applicable, notes, photos, the
// server's rules before completing, the signature, everything saved in the outbox once), the condition
// assessment form, and the Field work list.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { MobilePackage, PackageInspection } from '../../../../shared/mobile-api.ts';
import { field } from './fieldMocks';
import { params, picker, router, server } from '../../tags/tests/mocks';

jest.mock('../../api/client', () => require('../../tags/tests/mocks').clientMock());
jest.mock('../../auth/session', () => require('../../tags/tests/mocks').sessionMock());
jest.mock('expo-router', () => require('../../tags/tests/mocks').routerMock());
jest.mock('../../camera/still', () => require('../../tags/tests/mocks').stillMock());
jest.mock('expo-image-picker', () => require('../../tags/tests/mocks').pickerMock());
jest.mock('../../camera/photos', () => require('./fieldMocks').photosMock());
jest.mock('../../offline', () => require('./fieldMocks').offlineMock());
let mockId = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockId).padStart(12, '0')}` }));

jest.setTimeout(20_000);

const inspection: PackageInspection = {
  id: 'ins-1', ref: 'INS-00007', title: 'Invented platform check', status: 'Scheduled', statusValue: 'scheduled', dueOn: '2026-11-23', target: null,
  checklist: {
    template: { id: 't1', name: 'Invented platform check' },
    items: [
      { id: 'a', section: null, prompt: 'Invented exits clear', guidance: null, critical: true, photo_required: false, removed: false },
      { id: 'b', section: null, prompt: 'Invented extinguisher tagged', guidance: null, critical: false, photo_required: true, removed: false },
    ],
    responses: {}, canAnswer: true,
  },
};
const pkg = (over: Partial<MobilePackage> = {}) => ({
  id: 'p1', generatedAt: '2026-11-22T08:00:00Z', expiresAt: '2026-11-29T08:00:00Z', user: { id: 'u1', displayName: 'Pat Example' }, timeZone: 'UTC',
  work: { sections: [], unreadNotifications: 0, generatedAt: '' }, lookups: { condition_rating: [{ value: '5', label: '5 Excellent' }, { value: '2', label: '2 Marginal' }] },
  sites: [], portal: null, attachments: null, tags: null,
  parts: { inspections: [inspection], condition: { due: [{ type: 'asset', id: 'as1', label: 'Invented lift 2', dueOn: '2026-11-20', overdue: true }] }, counts: [] },
  ...over,
});

beforeEach(() => {
  field.reset();
  server.reset();
  jest.clearAllMocks();
  params.current = {};
  field.pkg = pkg();
});

describe('inspection runner', () => {
  it('marks the chosen answer, moves the screen reader to the next question, and signs without the drawing (E38-15)', async () => {
    const { AccessibilityInfo } = require('react-native');
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    const { default: RunScreen, TEXT } = require('../RunScreen');
    const { PAD_TEXT } = require('../SignaturePad');
    await render(<RunScreen id="ins-1" />);
    expect(await screen.findByRole('header', { name: 'Invented exits clear' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: TEXT.answers.yes }).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByRole('radio', { name: TEXT.answers.yes }));
    expect(await screen.findByRole('header', { name: 'Invented extinguisher tagged' })).toBeTruthy();
    await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'), { timeout: 2000 });
    await fireEvent.press(screen.getByRole('radio', { name: TEXT.answers.na }));
    expect(screen.getByRole('radio', { name: TEXT.answers.na }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(await screen.findByRole('button', { name: TEXT.toComplete }));
    // The finger signature is optional: the typed name signs, and the pad says so.
    expect(screen.getByLabelText(PAD_TEXT.label).props.accessibilityHint).toBe(PAD_TEXT.hint);
    expect(screen.getByRole('switch', { name: TEXT.raise })).toBeTruthy();
    expect(screen.getByRole('button', { name: TEXT.completeSend }).props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: TEXT.completeSend }));
    await waitFor(() => expect(field.added).toHaveLength(1));
    expect((field.added[0] as { kind: string }[]).map((i) => i.kind)).toEqual(['inspection.complete']);
    focus.mockRestore();
  });
  it('answers item by item, applies the server\'s rules, and saves photos, answers and signature in the outbox', async () => {
    const { default: RunScreen, TEXT } = require('../RunScreen');
    await render(<RunScreen id="ins-1" />);
    expect(await screen.findByText('Invented exits clear')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(TEXT.answers.yes));
    // Passed: on to the next item, which needs a photo.
    expect(await screen.findByText('Invented extinguisher tagged')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(TEXT.answers.no));
    await fireEvent.changeText(screen.getByLabelText(TEXT.noteFailed), 'Invented: tag missing.');
    // Every item answered: completing shows the server's rule about the missing photo, and waits.
    await fireEvent.press(await screen.findByLabelText(TEXT.toComplete));
    expect(await screen.findByText(/Add a photo to every item that needs one: Invented extinguisher tagged/)).toBeTruthy();
    expect(screen.getByLabelText(TEXT.completeSend).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText(TEXT.back));

    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/pic.jpg', width: 4000, height: 3000 }] });
    await fireEvent.press(await screen.findByLabelText(TEXT.choosePhoto));
    expect(await screen.findByText(TEXT.photos(1))).toBeTruthy();
    expect(field.drafts.get('inspection:ins-1')).toMatchObject({ answers: { a: { answer: 'yes' }, b: { answer: 'no', note: 'Invented: tag missing.', photos: [{ name: 'photo-1.jpg' }] } } });

    await fireEvent.press(await screen.findByLabelText(TEXT.toComplete));
    expect(await screen.findByText(/the result will be Pass with findings \(score 50%\), 1 item not met/)).toBeTruthy();
    expect(screen.getByLabelText(TEXT.signedBy).props.value).toBe('Pat Example');
    await fireEvent.press(screen.getByLabelText(TEXT.completeSend));
    await waitFor(() => expect(field.added).toHaveLength(1));
    const saved = field.added[0] as { kind: string; id: string; payload: Record<string, unknown> }[];
    expect(saved.map((i) => i.kind)).toEqual(['attachment', 'inspection.complete']);
    expect(saved[1].payload).toMatchObject({
      inspectionId: 'ins-1', raiseFindings: true, signature: { name: 'Pat Example', photo: null },
      answers: [{ itemId: 'a', answer: 'yes' }, { itemId: 'b', answer: 'no', note: 'Invented: tag missing.', photos: [saved[0].id] }],
    });
    expect(field.removed).toContain('inspection:ins-1');
    expect(field.sent).toBe(1);
    expect(await screen.findByText(TEXT.saved)).toBeTruthy();
  });

  it('keeps the person from answering what they may only read, and says when the inspection is not on the phone', async () => {
    const { default: RunScreen, TEXT } = require('../RunScreen');
    field.pkg = pkg({ parts: { inspections: [{ ...inspection, checklist: { ...inspection.checklist!, canAnswer: false } }] } });
    await render(<RunScreen id="ins-1" />);
    expect(await screen.findByText(TEXT.readOnly)).toBeTruthy();
    expect(screen.getByLabelText(TEXT.answers.yes).props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByLabelText(TEXT.choosePhoto)).toBeNull();
    await render(<RunScreen id="ins-404" />);
    expect(await screen.findByText(TEXT.notInPackage)).toBeTruthy();
  });
});

describe('condition assessment', () => {
  it('saves the rating dated today with its photo, the photo waiting for the assessment', async () => {
    const { default: ConditionScreen, TEXT } = require('../ConditionScreen');
    params.current = { type: 'asset', id: 'as1', label: 'Invented lift 2' };
    server.areas.condition = true;
    // No connection: the scale comes from the offline package.
    await render(<ConditionScreen />);
    await fireEvent.press(await screen.findByLabelText('2 Marginal'));
    await fireEvent.changeText(screen.getByLabelText(TEXT.notes), 'Invented: worn steps.');
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/shot.jpg', width: 4000, height: 3000 }] });
    await fireEvent.press(screen.getByLabelText(TEXT.takePhoto));
    await waitFor(() => expect(screen.getByLabelText(`${TEXT.removePhoto} photo-1.jpg`)).toBeTruthy());
    await fireEvent.press(screen.getByLabelText(TEXT.save));
    await waitFor(() => expect(field.added).toHaveLength(1));
    const [a, photo] = field.added[0] as { kind: string; dependsOn?: number; payload: Record<string, unknown> }[];
    expect(a).toMatchObject({ kind: 'condition.assess', payload: { targetType: 'asset', targetId: 'as1', rating: '2', notes: 'Invented: worn steps.', method: null } });
    expect(a.payload.assessedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(photo).toMatchObject({ kind: 'attachment', dependsOn: 0, payload: { name: 'photo-1.jpg' } });
    expect(router.back).toHaveBeenCalled();
  });

  it('is not offered without permission', async () => {
    const { default: ConditionScreen, TEXT } = require('../ConditionScreen');
    server.can = new Set(['tags.view']);
    server.areas.condition = true;
    params.current = { type: 'asset', id: 'as1', label: 'Invented lift 2' };
    await render(<ConditionScreen />);
    expect(screen.getByText(TEXT.notAllowed)).toBeTruthy();
  });
});

describe('field work list', () => {
  it('lists my inspections, condition due and open counts from the package, and opens them', async () => {
    const { default: FieldWorkScreen, TEXT } = require('../FieldWorkScreen');
    server.areas = { ...server.areas, audits: true, condition: true, tags: true };
    field.pkg = pkg({ parts: { ...pkg().parts, counts: [{ id: 'c1', ref: 'CNT-00002', title: 'Invented depot 21', site: { id: 's1', label: 'Invented depot 21' }, area: null, recordTypes: [], startedAt: null, totals: { expected: 3, found: 1, unexpected: 0, pending: 2, missing: 0 }, items: [], truncated: false }] } });
    field.drafts.set('inspection:ins-1', { inspectionId: 'ins-1', answers: {}, updatedAt: '' });
    await render(<FieldWorkScreen />);
    expect(await screen.findByText(/started on this phone/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^INS-00007 Invented platform check, / }));
    expect(router.push).toHaveBeenCalledWith('/fieldwork/inspection/ins-1');
    await fireEvent.press(screen.getByRole('button', { name: /^Invented lift 2, / }));
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/fieldwork\/condition\?type=asset&id=as1&label=Invented/));
    expect(screen.getByText(/1 of 3 found/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^CNT-00002 Invented depot 21, / }));
    expect(router.push).toHaveBeenCalledWith('/fieldwork/count/c1');
    expect(screen.queryByText(TEXT.noPackage)).toBeNull();
  });
});
