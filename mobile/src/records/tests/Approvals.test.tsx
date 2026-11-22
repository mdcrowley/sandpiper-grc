// Approvals and acknowledgments (E38-08): the lists, deciding with a reason, the server's engine rules
// (distinct approvers, lost permission) shown as they come, signing in again when a step asks for it,
// and reading and acknowledging a policy.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { resetMeta } from '../api';
import AcknowledgmentScreen, { TEXT as ACK } from '../screens/AcknowledgmentScreen';
import ApprovalScreen, { TEXT as ONE } from '../screens/ApprovalScreen';
import ApprovalsScreen, { TEXT as LIST } from '../screens/ApprovalsScreen';
import { capture, FakeApiError, router, sampleMeta, sampleTicket, server } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('expo-web-browser', () => require('./mocks').browserMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('expo-screen-capture', () => require('./mocks').captureMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());

jest.setTimeout(30_000);

const step = (over: Record<string, unknown> = {}) => ({
  step_id: 's1', instance_id: 'i1', workflow: 'Ticket approval', step: 'Manager', position: 0, steps_total: 2,
  record_type: 'ticket', record_type_label: 'Ticket', record_id: 't1', record_ref: 'TKT-00042', record_title: 'New tablet for depot dispatch',
  route: '/tickets/t1', requested_by_name: 'Sam Sample', due_at: '2026-11-25', overdue: false, approvals: 0, required: 1,
  kind_label: 'Catalog request', on_behalf_of_name: null, ...over,
});

const ack = (over: Record<string, unknown> = {}) => ({
  id: 'a1', policy_id: 'p1', policy_ref: 'POL-00003', policy_title: 'Remote access policy', policy_summary: 'How staff connect from outside.',
  version: 3, effective_on: '2026-11-01', requested_at: '2026-11-01T00:00:00Z', due_on: '2026-11-30', acknowledged_at: null, state: 'outstanding', days_left: 8, ...over,
});

beforeEach(() => {
  server.reset();
  resetMeta();
  jest.clearAllMocks();
  server.routes['GET /api/meta'] = sampleMeta();
  server.routes['GET /api/tickets/t1'] = sampleTicket({ title: 'New tablet for depot dispatch' });
  server.routes['GET /api/workflows/approvals'] = { rows: [step(), step({ step_id: 's2', record_ref: 'TKT-00050', record_title: 'Radio for yard', overdue: true, on_behalf_of_name: 'Robin Sample' })] };
  server.routes['GET /api/policies/acknowledgments/mine'] = { today: '2026-11-22', awaiting: [ack(), ack({ id: 'a2', policy_ref: 'POL-00009', policy_title: 'Clear desk policy', state: 'overdue' })], acknowledged: [] };
});

describe('approvals list', () => {
  it('lists waiting approvals with what is approved, and acknowledgments on the other tab', async () => {
    await render(<ApprovalsScreen />);
    expect(await screen.findByText('TKT-00042 New tablet for depot dispatch')).toBeTruthy();
    expect(screen.getAllByText(LIST.step('Manager', 0, 2))).toHaveLength(2);
    expect(screen.getByText(LIST.onBehalfOf('Robin Sample'))).toBeTruthy();
    await fireEvent.press(screen.getByText('TKT-00050 Radio for yard'));
    expect(router.push).toHaveBeenCalledWith('/approvals/step/s2');
    await fireEvent.press(screen.getByRole('tab', { name: `${LIST.acknowledgments} (2)` }));
    expect(await screen.findByText('POL-00003 Remote access policy')).toBeTruthy();
    await fireEvent.press(screen.getByText('POL-00009 Clear desk policy'));
    expect(router.push).toHaveBeenCalledWith('/approvals/acknowledgment/a2');
  });

  it('opens on acknowledgments when asked, and says when nothing is waiting', async () => {
    server.routes['GET /api/policies/acknowledgments/mine'] = { today: '2026-11-22', awaiting: [], acknowledged: [] };
    await render(<ApprovalsScreen show="acknowledgments" />);
    expect(await screen.findByText(LIST.noAcks)).toBeTruthy();
  });
});

describe('deciding an approval', () => {
  it('shows what is being approved and approves', async () => {
    server.routes['POST /api/workflows/steps/s1/decision'] = { stepOutcome: 'approved', approvalsReceived: 1, approvalsRequired: 1 };
    await render(<ApprovalScreen stepId="s1" />);
    expect(await screen.findByText('New tablet for depot dispatch')).toBeTruthy();
    expect(screen.getByText('Catalog request')).toBeTruthy();
    expect((await screen.findAllByText('Sam Sample')).length).toBe(2); // asked by, and the record's assignee
    await fireEvent.press(screen.getByRole('button', { name: ONE.approve }));
    expect(await screen.findByText(ONE.approved)).toBeTruthy();
    expect(server.calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'approved', comment: undefined });
    expect(screen.queryByRole('button', { name: ONE.approve })).toBeNull();
  });

  it('needs a reason to reject, then sends it', async () => {
    server.routes['POST /api/workflows/steps/s1/decision'] = { stepOutcome: 'rejected' };
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('New tablet for depot dispatch');
    await fireEvent.press(screen.getByRole('button', { name: ONE.reject }));
    expect(await screen.findByText(ONE.reasonNeeded)).toBeTruthy();
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText(ONE.reason), 'Budget not approved this year.');
    await fireEvent.press(screen.getByRole('button', { name: ONE.reject }));
    expect(await screen.findByText(ONE.rejected)).toBeTruthy();
    expect(server.calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'rejected', comment: 'Budget not approved this year.' });
  });

  it('says when more approvals are needed', async () => {
    server.routes['POST /api/workflows/steps/s1/decision'] = { stepOutcome: 'pending', approvalsReceived: 1, approvalsRequired: 2 };
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('New tablet for depot dispatch');
    await fireEvent.press(screen.getByRole('button', { name: ONE.approve }));
    expect(await screen.findByText(ONE.waitingOthers(1, 2))).toBeTruthy();
  });

  it('shows the engine’s refusal unchanged (distinct approvers, lost permission) and keeps the choice open', async () => {
    server.routes['POST /api/workflows/steps/s1/decision'] = () => {
      throw new FakeApiError(403, 'forbidden', 'You decided an earlier step of this request, so someone else must decide this one.');
    };
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('New tablet for depot dispatch');
    await fireEvent.press(screen.getByRole('button', { name: ONE.approve }));
    expect(await screen.findByText('You decided an earlier step of this request, so someone else must decide this one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: ONE.approve })).toBeTruthy();
  });

  it('asks to sign in again when the step requires it, then records the decision', async () => {
    let first = true;
    server.routes['POST /api/workflows/steps/s1/decision'] = () => {
      if (first) { first = false; throw new FakeApiError(403, 'reauth_required', 'Confirm your password to continue.'); }
      return { stepOutcome: 'approved' };
    };
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('New tablet for depot dispatch');
    await fireEvent.press(screen.getByRole('button', { name: ONE.approve }));
    expect(await screen.findByText(ONE.approved)).toBeTruthy();
    expect(server.confirm).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the person cancels signing in again', async () => {
    server.routes['POST /api/workflows/steps/s1/decision'] = () => { throw new FakeApiError(403, 'reauth_required', 'Confirm your password to continue.'); };
    server.confirm = jest.fn(async () => false);
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('New tablet for depot dispatch');
    await fireEvent.press(screen.getByRole('button', { name: ONE.approve }));
    expect(await screen.findByText(ONE.reauth)).toBeTruthy();
  });

  it('says so when the approval is no longer waiting', async () => {
    await render(<ApprovalScreen stepId="gone" />);
    expect(await screen.findByText(ONE.gone)).toBeTruthy();
  });

  it('protects a restricted record being approved from screenshots', async () => {
    server.routes['GET /api/workflows/approvals'] = { rows: [step({ record_type: 'safety_event', record_type_label: 'Safety event', record_id: 'e1', record_ref: 'SAF-00007', record_title: 'Slip on stairs' })] };
    server.routes['GET /api/safety/events/e1'] = { id: 'e1', ref: 'SAF-00007', title: 'Slip on stairs', status: 'reported', restricted: true, _display: {} };
    await render(<ApprovalScreen stepId="s1" />);
    await screen.findByText('Slip on stairs');
    await waitFor(() => expect(capture.preventScreenCaptureAsync).toHaveBeenCalled());
  });
});

describe('acknowledging a policy', () => {
  beforeEach(() => {
    server.routes['GET /api/policies/acknowledgments/a1'] = {
      ...ack(), change_summary: 'Adds rules for personal phones.',
      body_html: '<h2>Purpose</h2><p>Keep remote connections safe.</p><ul><li>Use the company VPN</li></ul>',
    };
  });

  it('shows the policy text readable in the app and acknowledges it', async () => {
    server.routes['POST /api/policies/acknowledgments/a1/acknowledge'] = { ...ack(), acknowledged_at: '2026-11-22T09:00:00Z', state: 'acknowledged' };
    await render(<AcknowledgmentScreen ackId="a1" />);
    expect(await screen.findByText('Remote access policy')).toBeTruthy();
    expect(screen.getByText('Purpose')).toBeTruthy();
    expect(screen.getByText('Use the company VPN')).toBeTruthy();
    expect(screen.getByText('Adds rules for personal phones.')).toBeTruthy();
    expect(screen.queryByText(/<p>/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: ACK.acknowledge }));
    await waitFor(() => expect(screen.getByText(/^Acknowledged /)).toBeTruthy());
    expect(screen.queryByRole('button', { name: ACK.acknowledge })).toBeNull();
  });

  it('shows the server’s answer when the version was replaced meanwhile', async () => {
    server.routes['POST /api/policies/acknowledgments/a1/acknowledge'] = () => {
      throw new FakeApiError(409, 'superseded', 'This version has been replaced or the policy retired. There is nothing to acknowledge.');
    };
    await render(<AcknowledgmentScreen ackId="a1" />);
    await screen.findByText('Remote access policy');
    await fireEvent.press(screen.getByRole('button', { name: ACK.acknowledge }));
    expect(await screen.findByText(ACK.superseded)).toBeTruthy();
  });
});

describe('approval and acknowledgment screens with data, light and dark', () => {
  const RN = require('react-native');
  const { dark, light } = require('../../theme');

  beforeEach(() => {
    server.routes['GET /api/policies/acknowledgments/a2'] = {
      ...ack({ id: 'a2', policy_ref: 'POL-00009', policy_title: 'Clear desk policy', state: 'overdue', due_on: '2026-11-10' }),
      change_summary: null, body_html: '<h1>Clear desk</h1><p>Lock papers away at the end of each shift.</p><ol><li>Desks</li><li>Dispatch consoles</li></ol>',
    };
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`renders a waiting approval and an overdue policy in ${scheme}`, async () => {
      const spy = jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
      const colors = scheme === 'dark' ? dark : light;

      const one = await render(<ApprovalScreen stepId="s2" />);
      expect(await screen.findByText('Radio for yard')).toBeTruthy();
      expect(screen.getByText('Robin Sample')).toBeTruthy(); // standing in for
      expect(screen.getByText(/\(Overdue\)$/)).toBeTruthy();
      expect(screen.getByRole('button', { name: ONE.approve })).toBeTruthy();
      expect(screen.getByRole('button', { name: ONE.reject })).toBeTruthy();
      expect(RN.StyleSheet.flatten(screen.getByRole('button', { name: ONE.approve }).props.style).backgroundColor).toBe(colors.brand);
      await one.unmount();

      await render(<AcknowledgmentScreen ackId="a2" />);
      expect(await screen.findByText('Clear desk policy')).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Clear desk' })).toBeTruthy();
      expect(screen.getByText('Lock papers away at the end of each shift.')).toBeTruthy();
      expect(screen.getByText('Dispatch consoles')).toBeTruthy();
      expect(screen.getByText(/\(Overdue\)$/)).toBeTruthy();
      expect(screen.getByRole('button', { name: ACK.acknowledge })).toBeTruthy();
      spy.mockReturnValue('light');
    });
  }
});
