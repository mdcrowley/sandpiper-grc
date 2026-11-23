// Reporting a problem or a hazard (E38-06): what is sent (from scratch and from a tag card), the form
// (title required, photos fitted, the report queued), and the Report tab's view of the queue.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buildReport, initialAnswers, pickDefault, type ReportAnswers } from './build';
import ReportFormScreen, { TEXT as FORM } from './ReportFormScreen';
import ReportHomeScreen, { TEXT as HOME } from './ReportHomeScreen';
import * as handoff from '../../tags/handoff';
import { params, picker, router, server } from '../../tags/tests/mocks';

jest.mock('../../api/client', () => require('../../tags/tests/mocks').clientMock());
jest.mock('../../auth/session', () => require('../../tags/tests/mocks').sessionMock());
jest.mock('expo-router', () => require('../../tags/tests/mocks').routerMock());
jest.mock('../still', () => require('../../tags/tests/mocks').stillMock());
jest.mock('expo-image-picker', () => require('../../tags/tests/mocks').pickerMock());
jest.mock('expo-crypto', () => ({ randomUUID: () => 'c0ffee00-0000-4000-8000-000000000001' }));
jest.mock('../photos', () => ({
  attachmentLimits: jest.fn(async () => ({ maxBytes: 5_000_000, allowedExtensions: ['jpg'] })),
  fitPhoto: jest.fn(async (uri: string) => ({ uri: `${uri}.fitted.jpg`, bytes: 1000 })),
  photoName: (_d: Date, n: number) => `photo-${n}.jpg`,
  PhotoError: class extends Error {},
}));
jest.mock('../reportQueue', () => ({ saveReport: jest.fn(async () => {}), useReports: jest.fn(() => []), migrateLegacyQueue: jest.fn(async () => 0) }));
// The offline package stands in when the server cannot be reached (E38-10).
const mockOfflinePkg: { current: Record<string, unknown> | null } = { current: null };
jest.mock('../../offline', () => {
  const real = jest.requireActual('../../offline/package');
  return {
    packageList: real.packageList, packageSites: real.packageSites, sendNow: jest.fn(), outbox: () => ({ prune: jest.fn() }),
    orOffline: async (fromServer: () => Promise<unknown>, fromPackage: (p: unknown) => unknown) => {
      try { return await fromServer(); } catch (e) { const v = mockOfflinePkg.current ? fromPackage(mockOfflinePkg.current) : null; if (v) return v; throw e; }
    },
  };
});

jest.setTimeout(20_000);

const answers = (over: Partial<ReportAnswers> = {}): ReportAnswers => ({
  title: 'Leaking pump', description: 'Water on the floor', site: { id: 's1', label: 'North depot' }, locationDetail: 'Bay 3',
  eventType: 'unsafe_condition', severity: 'no_harm', occurredAt: '2026-11-22T10:00:00.000Z', ...over,
});

describe('what a report sends', () => {
  it('a problem from scratch is a ticket with the place in its text (tickets have no site)', () => {
    expect(buildReport('problem', answers(), null)).toEqual({
      path: '/api/tickets', recordType: 'ticket',
      body: { title: 'Leaking pump', description: 'Water on the floor\n\nLocation: North depot, Bay 3' }, link: null,
    });
  });

  it('a hazard from scratch is a safety event at the chosen site', () => {
    expect(buildReport('hazard', answers(), null)).toEqual({
      path: '/api/safety-events', recordType: 'safety_event', link: null,
      body: { title: 'Leaking pump', description: 'Water on the floor', occurred_at: '2026-11-22T10:00:00.000Z', event_type: 'unsafe_condition', severity: 'no_harm', site_id: 's1', location_detail: 'Bay 3' },
    });
  });

  it('from a tag card, the server\'s prefill decides where it goes and links the record', () => {
    const start = { kind: 'problem' as const, prefill: { type: 'ticket', path: '/api/tickets', values: { asset_id: 'a1', type: 'incident' } }, record: { type: 'asset', id: 'a1', label: 'Asset Pump 7', siteId: null, siteLabel: null } };
    const req = buildReport('problem', answers({ site: null, locationDetail: '', description: 'Reported from the tag of Asset Pump 7.' }), start);
    expect(req.body).toEqual({ asset_id: 'a1', type: 'incident', title: 'Leaking pump', description: 'Reported from the tag of Asset Pump 7.' });
    // A record the new one has no field for is linked afterward (prefill.link).
    const prefill = { type: 'safety_event', path: '/api/safety-events', values: { site_id: 's9' }, link: { type: 'asset', id: 'a1' } };
    const linked = buildReport('hazard', answers(), { kind: 'hazard', prefill, record: null });
    expect(linked.link).toEqual({ type: 'asset', id: 'a1' });
    expect(linked.body.site_id).toBe('s1');
    const hazard = buildReport('hazard', answers({ site: null }), { kind: 'hazard', prefill: null, record: { type: 'vehicle', id: 'v1', label: 'Vehicle 1203', siteId: null, siteLabel: null } });
    expect(hazard.body).toMatchObject({ vehicle_id: 'v1' });
  });

  it('uses the portal\'s own forms for people who report through the portal', () => {
    const problem = buildReport('problem', answers({ affects: 'team', howUrgent: 'stopped' }), { kind: 'problem', prefill: { type: 'ticket', path: '/api/portal/requests', values: { title: 'Problem with Pump 7', where: 'Asset Pump 7' } }, record: null });
    expect(problem).toEqual({ path: '/api/portal/requests', recordType: 'ticket', link: null, body: { title: 'Leaking pump', details: 'Water on the floor', where: 'North depot, Bay 3', affects: 'team', how_urgent: 'stopped' } });
    const hazard = buildReport('hazard', answers({ site: null, locationDetail: '', harm: 'minor' }), { kind: 'hazard', prefill: { type: 'safety_event', path: '/api/portal/safety-reports', values: { where: 'Asset Pump 7' } }, record: null });
    expect(hazard.body).toEqual({ title: 'Leaking pump', description: 'Water on the floor', event_type: 'unsafe_condition', harm: 'minor', occurred_at: '2026-11-22T10:00:00.000Z', where: 'Asset Pump 7' });
  });

  it('starts the form from the prefill', () => {
    const start = { kind: 'hazard' as const, prefill: { type: 'safety_event', path: '/api/safety-events', values: { title: 'Hazard at Pump 7', location_detail: 'Asset Pump 7', site_id: 's1', event_type: 'unsafe_condition' } }, record: { type: 'asset', id: 'a1', label: 'Asset Pump 7', siteId: 's1', siteLabel: 'North depot' } };
    expect(initialAnswers(start)).toEqual({ title: 'Hazard at Pump 7', description: '', locationDetail: 'Asset Pump 7', eventType: 'unsafe_condition', severity: null, site: { id: 's1', label: 'North depot' } });
  });

  it('picks sensible defaults from configurable lists', () => {
    expect(pickDefault(['collision', 'near_miss'], ['unsafe_condition', 'near_miss'])).toBe('near_miss');
    expect(pickDefault(['x'], ['y'])).toBe('x');
    expect(pickDefault([], ['y'])).toBeNull();
  });
});

describe('report form', () => {
  beforeEach(() => {
    server.reset(); jest.clearAllMocks(); params.current = { kind: 'problem' };
    server.routes['GET /api/lookups/safety_event_type'] = [{ value: 'near_miss', label: 'Near miss' }, { value: 'unsafe_condition', label: 'Unsafe condition' }];
    server.routes['GET /api/lookups/safety_event_severity'] = [{ value: 'no_harm', label: 'No injury or damage' }];
  });

  it('asks for a title, then queues the report with its fitted photos', async () => {
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/p1.jpg', width: 4000, height: 3000 }] });
    await render(<ReportFormScreen />);
    await fireEvent.press(screen.getByLabelText(FORM.send));
    expect(screen.getByText(FORM.titleRequired)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(FORM.titleLabel), 'Leaking pump');
    await fireEvent.press(screen.getByLabelText(FORM.takePhoto));
    await waitFor(() => expect(screen.getByLabelText(`${FORM.removePhoto} photo-1.jpg`)).toBeTruthy());
    await fireEvent.press(screen.getByLabelText(FORM.send));
    await waitFor(() => expect(router.dismissTo).toHaveBeenCalledWith('/report'));
    const { saveReport } = jest.requireMock('../reportQueue') as { saveReport: jest.Mock };
    expect(saveReport).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'problem', path: '/api/tickets', recordType: 'ticket', body: expect.objectContaining({ title: 'Leaking pump' }), title: 'Leaking pump' }),
      [{ uri: 'file:///cache/p1.jpg.fitted.jpg', name: 'photo-1.jpg' }],
      'c0ffee00-0000-4000-8000-000000000001',
    );
  });

  it('a hazard offers the configured types and severities', async () => {
    params.current = { kind: 'hazard' };
    await render(<ReportFormScreen />);
    expect(await screen.findByText('Near miss')).toBeTruthy();
    expect(screen.getByText('No injury or damage')).toBeTruthy();
  });

  it('without a connection, offers the choices from the offline package', async () => {
    params.current = { kind: 'hazard' };
    server.routes = {};
    mockOfflinePkg.current = {
      lookups: { safety_event_type: [{ value: 'near_miss', label: 'Near miss (offline)' }], safety_event_severity: [{ value: 'no_harm', label: 'No harm (offline)' }] },
      sites: [{ value: 's1', label: 'North depot', ref: 'SITE-1' }],
    };
    await render(<ReportFormScreen />);
    expect(await screen.findByText('Near miss (offline)')).toBeTruthy();
    expect(screen.getByText('No harm (offline)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `${FORM.noSite}, ${FORM.site}` }));
    expect(await screen.findByText('North depot')).toBeTruthy();
    mockOfflinePkg.current = null;
  });

  it('is not offered without the permission or the area', async () => {
    server.can = new Set(['safety.create']);
    await render(<ReportFormScreen />);
    expect(screen.getByText(FORM.notAllowed)).toBeTruthy();
  });

  it('from a tag card, says which record it is about', async () => {
    params.current = { start: handoff.put({ kind: 'report', start: { kind: 'hazard', prefill: null, record: { type: 'asset', id: 'a1', label: 'Asset Pump 7', siteId: 's1', siteLabel: 'North depot' } } }) };
    await render(<ReportFormScreen />);
    expect(screen.getByText(`${FORM.about}: Asset Pump 7`)).toBeTruthy();
    expect(screen.getByText('North depot')).toBeTruthy();
  });
});

describe('Report tab', () => {
  beforeEach(() => { server.reset(); jest.clearAllMocks(); });

  it('offers only the reports the person may make', async () => {
    server.can = new Set(['tickets.create']);
    await render(<ReportHomeScreen />);
    expect(screen.getByLabelText(HOME.problem)).toBeTruthy();
    expect(screen.queryByLabelText(HOME.hazard)).toBeNull();
    await fireEvent.press(screen.getByLabelText(HOME.problem));
    expect(router.push).toHaveBeenCalledWith('/report/new?kind=problem');
  });

  it('switched-off areas leave their report out', async () => {
    server.areas.safety = false;
    server.areas.tickets = false;
    await render(<ReportHomeScreen />);
    expect(screen.getByText(HOME.none)).toBeTruthy();
  });

  it('shows each report saved on the phone: waiting, arrived, or needing attention with the server reason', async () => {
    const { useReports } = jest.requireMock('../reportQueue') as { useReports: jest.Mock };
    const base = { kind: 'problem', photos: 2, photosSent: 0, warning: null, savedAt: '2026-11-22T10:00:00Z', ref: null, error: null };
    useReports.mockReturnValue([
      { ...base, group: 'g1', title: 'Leaking pump', state: 'waiting' },
      { ...base, group: 'g2', title: 'Broken door', state: 'done', ref: 'TKT-00042', photosSent: 2 },
      { ...base, group: 'g3', title: 'Loose rail', state: 'attention', error: { code: 'forbidden', message: 'You do not have permission to do that.' } },
    ]);
    await render(<ReportHomeScreen />);
    expect(screen.getByText(/Saved on this phone. It is sent on its own/)).toBeTruthy();
    expect(screen.getByText(/Arrived: TKT-00042. 2 of 2 photos sent/)).toBeTruthy();
    expect(screen.getByText(/Needs attention: You do not have permission/)).toBeTruthy();
    expect(screen.getByText(HOME.attention(1))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(HOME.open));
    expect(router.push).toHaveBeenCalledWith('/report/offline');
    useReports.mockReturnValue([]);
  });
});
