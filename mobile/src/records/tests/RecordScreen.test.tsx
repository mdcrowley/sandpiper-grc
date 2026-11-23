// Record views (E38-07): summary and key fields, activity, comments and files, editing with If-Match,
// the conflict screen, "finish on the web", and restricted records protected from screenshots.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { resetMeta } from '../api';
import { EDIT_TEXT } from '../RecordEditor';
import { PANEL_TEXT } from '../RecordPanels';
import { clearRecent, loadRecent } from '../recent';
import RecordScreen, { TEXT } from '../screens/RecordScreen';
import { browser, capture, FakeApiError, sampleMeta, sampleTicket, server } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('expo-web-browser', () => require('./mocks').browserMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('expo-screen-capture', () => require('./mocks').captureMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());

jest.setTimeout(30_000);

beforeEach(async () => {
  server.reset();
  resetMeta();
  await clearRecent();
  jest.clearAllMocks();
  server.routes['GET /api/meta'] = sampleMeta();
  server.routes['GET /api/tickets/t1'] = sampleTicket();
  server.etags['/api/tickets/t1'] = '"v1"';
});

async function openTicket() {
  await render(<RecordScreen type="ticket" id="t1" />);
  await screen.findByText('Platform display shows no departures');
}

describe('record view', () => {
  it('shows the summary and key fields, remembers the record, and opens it on the web', async () => {
    await openTicket();
    expect(screen.getByText('Ticket · TKT-00042')).toBeTruthy();
    expect(screen.getByText('Status: New')).toBeTruthy();
    expect(screen.getByText('Sam Sample')).toBeTruthy();
    expect(screen.getByText('The display at platform 2 is blank.')).toBeTruthy();
    await waitFor(async () => expect((await loadRecent())[0]).toMatchObject({ type: 'ticket', id: 't1', ref: 'TKT-00042' }));
    await fireEvent.press(screen.getByRole('button', { name: TEXT.openWeb }));
    expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://grc.example.org/tickets/t1');
    expect(capture.preventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it('shows activity, comments and files, and adds a comment', async () => {
    server.routes['GET /api/history'] = [{ id: 'h1', at: '2026-11-20T10:00:00Z', actor_name: 'Sam Sample', action: 'ticket.update', summary: 'Status changed to New' }];
    server.routes['GET /api/comments'] = [{ id: 'c1', body: 'Checked the cable.', internal: true, author_name: 'Sam Sample', created_at: '2026-11-20T11:00:00Z' }];
    server.routes['POST /api/comments'] = ({ body }: { body?: any }) => ({ id: 'c2', body: body.body, internal: true, author_name: 'Pat Example', created_at: '2026-11-22T09:00:00Z' });
    server.routes['GET /api/attachments'] = { rows: [{ id: 'f1', file_name: 'display.jpg', size_bytes: 204800, kind: 'file', description: null, uploaded_by_name: 'Sam Sample', uploaded_at: '2026-11-20T11:00:00Z' }] };
    await openTicket();

    await fireEvent.press(screen.getByRole('tab', { name: TEXT.activity }));
    expect(await screen.findByText('Status changed to New')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: TEXT.comments }));
    expect(await screen.findByText('Checked the cable.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(PANEL_TEXT.newComment), 'Replaced the power supply.');
    await fireEvent.press(screen.getByRole('button', { name: PANEL_TEXT.addComment }));
    expect(await screen.findByText('Replaced the power supply.')).toBeTruthy();
    expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({ record_type: 'ticket', record_id: 't1', body: 'Replaced the power supply.' });

    await fireEvent.press(screen.getByRole('tab', { name: TEXT.files }));
    expect(await screen.findByText('display.jpg')).toBeTruthy();
  });

  it('protects a restricted record from screenshots and never remembers it', async () => {
    server.routes['GET /api/safety/events/e1'] = { id: 'e1', ref: 'SAF-00007', title: 'Slip on platform stairs', status: 'reported', restricted: true, _display: {} };
    const view = await render(<RecordScreen type="safety_event" id="e1" />);
    await screen.findByText('Slip on platform stairs');
    expect(screen.getByText(TEXT.restricted)).toBeTruthy();
    expect(capture.preventScreenCaptureAsync).toHaveBeenCalled();
    expect(await loadRecent()).toEqual([]);
    await view.unmount();
    expect(capture.allowScreenCaptureAsync).toHaveBeenCalled();
  });

  it('says so when the type cannot be shown or the record is not visible', async () => {
    await render(<RecordScreen type="vault" id="x" />);
    expect(await screen.findByText(TEXT.unknownType)).toBeTruthy();
  });

  it('hides Edit without edit permission', async () => {
    server.can = new Set(['tickets.view']);
    await openTicket();
    expect(screen.queryByRole('button', { name: TEXT.edit })).toBeNull();
  });
});

describe('editing', () => {
  it('saves changed fields with If-Match', async () => {
    server.routes['PATCH /api/tickets/t1'] = ({ body }: { body?: any }) => ({ ...sampleTicket(), ...body, _display: { status: 'In progress', assignee_id: 'Sam Sample' } });
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    // Status moves the lifecycle forbids are not offered.
    expect(screen.queryByRole('radio', { name: 'Closed' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Canceled' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'In progress' }));
    await fireEvent.changeText(screen.getByLabelText('Resolution notes'), 'Power supply replaced.');
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText(TEXT.saved)).toBeTruthy();
    const patch = server.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.ifMatch).toBe('"v1"');
    expect(patch.body).toEqual({ status: 'in_progress', resolution_notes: 'Power supply replaced.' });
    expect(screen.getByText('Status: In progress')).toBeTruthy();
  });

  it('says nothing changed instead of saving', async () => {
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText(EDIT_TEXT.nothing)).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('sends a move that needs more than the phone form to the web', async () => {
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Resolved' }));
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText(EDIT_TEXT.needsWeb(['Resolution code']))).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.finishOnWeb }));
    expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://grc.example.org/tickets/t1');
  });

  it('shows the server field messages, and sends fields the phone does not show to the web', async () => {
    server.routes['PATCH /api/tickets/t1'] = () => {
      throw new FakeApiError(400, 'validation', 'Check the highlighted fields.', { resolution_notes: 'Too short.', breach_reason: 'Say why the target was missed.' });
    };
    server.routes['GET /api/meta'] = (() => { const m = sampleMeta(); (m.resources.ticket.fields as any).breach_reason = { label: 'Breach reason', type: 'longtext' }; return m; })();
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.changeText(screen.getByLabelText('Resolution notes'), 'x');
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText('Too short.')).toBeTruthy();
    expect(screen.getByText(EDIT_TEXT.serverNeedsWeb(['Breach reason']))).toBeTruthy();
  });

  it('shows both values on a conflict and saves the person’s choice on top of the new version', async () => {
    let patches = 0;
    server.routes['PATCH /api/tickets/t1'] = ({ ifMatch, body }: { ifMatch?: string; body?: any }) => {
      patches += 1;
      if (ifMatch === '"v1"') throw new FakeApiError(409, 'version_conflict', 'This ticket has changed since you read it.');
      return { ...sampleTicket({ status: 'resolved', resolution_code: 'fixed' }), ...body, _display: { status: 'In progress' } };
    };
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.press(screen.getByRole('radio', { name: 'In progress' }));
    // Meanwhile someone else resolved it.
    server.routes['GET /api/tickets/t1'] = sampleTicket({ status: 'resolved', resolution_code: 'fixed', updated_at: '2026-11-22T08:00:00.000Z', _display: { status: 'Resolved' } });
    server.etags['/api/tickets/t1'] = '"v2"';
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText(EDIT_TEXT.conflictTitle)).toBeTruthy();
    expect(screen.getByText(`${EDIT_TEXT.yours}: In progress`)).toBeTruthy();
    expect(screen.getByText(`${EDIT_TEXT.saved}: Resolved`)).toBeTruthy();
    expect(screen.getByRole('radio', { name: `${EDIT_TEXT.keepMine}, Status` }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.saveChoices }));
    expect(await screen.findByText(TEXT.saved)).toBeTruthy();
    const last = server.calls.filter((c) => c.method === 'PATCH').pop()!;
    expect(last.ifMatch).toBe('"v2"');
    expect(last.body).toEqual({ status: 'in_progress' });
    expect(patches).toBe(2);
  });

  it('keeps the saved value when the person chooses it', async () => {
    server.routes['PATCH /api/tickets/t1'] = () => { throw new FakeApiError(409, 'version_conflict', 'Changed.'); };
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.press(screen.getByRole('radio', { name: 'In progress' }));
    server.routes['GET /api/tickets/t1'] = sampleTicket({ status: 'resolved', _display: { status: 'Resolved' } });
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    await screen.findByText(EDIT_TEXT.conflictTitle);
    await fireEvent.press(screen.getByRole('radio', { name: `${EDIT_TEXT.useSaved}, Status` }));
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.saveChoices }));
    expect(await screen.findByText('Status: Resolved')).toBeTruthy();
    expect(server.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('asks to sign in again when the server wants a recent sign-in, then saves', async () => {
    let first = true;
    server.routes['PATCH /api/tickets/t1'] = ({ body }: { body?: any }) => {
      if (first) { first = false; throw new FakeApiError(403, 'reauth_required', 'Confirm your password to continue.'); }
      return { ...sampleTicket(), ...body };
    };
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.changeText(screen.getByLabelText('Vendor reference'), 'VR-77');
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    expect(await screen.findByText(TEXT.saved)).toBeTruthy();
    expect(server.confirm).toHaveBeenCalledTimes(1);
  });

  it('chooses a person from a search', async () => {
    server.routes['GET /api/users/options'] = [{ id: 'u3', label: 'Lee Placeholder' }];
    server.routes['PATCH /api/tickets/t1'] = ({ body }: { body?: any }) => ({ ...sampleTicket(), ...body, _display: { assignee_id: 'Lee Placeholder' } });
    await openTicket();
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    await fireEvent.press(screen.getByRole('button', { name: 'Change: Assignee' }));
    await fireEvent.changeText(screen.getByLabelText('Search for assignee'), 'Lee');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await fireEvent.press(await screen.findByRole('button', { name: 'Lee Placeholder' }));
    await fireEvent.press(screen.getByRole('button', { name: EDIT_TEXT.save }));
    await screen.findByText(TEXT.saved);
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ assignee_id: 'u3' });
  });
});

describe('choices that must keep a value', () => {
  it('never offers "None" for a status (default or required), but does for an optional list', async () => {
    server.routes['GET /api/safety/hazards/h1'] = { id: 'h1', ref: 'HAZ-00004', title: 'Worn stair nosing at the east entrance', status: 'identified', source: null, _display: {} };
    await render(<RecordScreen type="hazard" id="h1" />);
    await screen.findByText('Worn stair nosing at the east entrance');
    await fireEvent.press(screen.getByRole('button', { name: TEXT.edit }));
    const status = screen.getByLabelText('Status');
    const source = screen.getByLabelText('Source');
    const { within } = require('@testing-library/react-native');
    expect(within(status).queryByRole('radio', { name: 'None' })).toBeNull();
    expect(within(status).getByRole('radio', { name: 'Identified' }).props.accessibilityState.checked).toBe(true);
    expect(within(source).getByRole('radio', { name: 'None' })).toBeTruthy();
  });
});
