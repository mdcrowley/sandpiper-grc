// Test doubles for the record screens: the api client (a route table instead of a server), expo-router,
// the browser sheet, the secure store, screen capture and the session's wipe hook. Each test file
// declares `jest.mock(<module>, () => require('./mocks').<x>())` and drives `server` below.

type Handler = (init: { method: string; body?: unknown; ifMatch?: string; path: string }) => unknown;

export interface Call { method: string; path: string; body?: unknown; ifMatch?: string }

/** The fake server: `routes['GET /api/x']` answers; a thrown error is the answer's error. */
export const server = {
  routes: {} as Record<string, Handler | unknown>,
  calls: [] as Call[],
  etags: {} as Record<string, string>,
  can: new Set<string>(['*']),
  confirm: jest.fn(async () => true),
  reset() {
    this.routes = {};
    this.calls = [];
    this.etags = {};
    this.can = new Set(['*']);
    this.confirm = jest.fn(async () => true);
  },
};

export class FakeApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export function clientMock() {
  return {
    ApiError: FakeApiError,
    CLIENT_ERRORS: { notConnected: 'not_connected', offline: 'offline', badResponse: 'bad_response' },
    apiFetch: jest.fn(async (path: string, init: { method?: string; body?: unknown; ifMatch?: string; onResponse?: (i: { status: number; etag: string | null }) => void } = {}) => {
      const method = init.method ?? 'GET';
      server.calls.push({ method, path, body: init.body, ifMatch: init.ifMatch });
      const bare = path.split('?')[0];
      const key = [`${method} ${path}`, `${method} ${bare}`].find((k) => k in server.routes);
      if (!key) throw new FakeApiError(404, 'not_found', `No route ${method} ${path}`);
      const h = server.routes[key];
      const answer = typeof h === 'function' ? await (h as Handler)({ method, body: init.body, ifMatch: init.ifMatch, path }) : h;
      init.onResponse?.({ status: 200, etag: server.etags[bare] ?? null });
      return JSON.parse(JSON.stringify(answer ?? null));
    }),
    confirmIdentity: () => server.confirm(),
    useSession: () => ({
      status: 'signed-in',
      session: { server: 'https://grc.example.org', user: { id: 'u1', displayName: 'Pat Example', username: 'pat' }, deviceId: 'd1', permissions: ['*'], areas: {} },
      can: (p: string) => server.can.has('*') || server.can.has(p),
      areaOn: () => true,
      signOut: async () => {},
    }),
  };
}

export const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
export const tabOptions = jest.fn();

export function routerMock() {
  const React = require('react');
  return {
    useRouter: () => router,
    useNavigation: () => ({ getParent: () => ({ setOptions: tabOptions }) }),
    useFocusEffect: (cb: () => void) => React.useEffect(() => { cb(); }, [cb]),
    useLocalSearchParams: () => ({}),
    Stack: { Screen: () => null },
  };
}

export const browser = { openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) };
export function browserMock() { return browser; }

const store = new Map<string, string>();
export function secureStoreMock() {
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k: string) => { store.delete(k); }),
  };
}

export const capture = {
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
  enableAppSwitcherProtectionAsync: jest.fn(async () => {}),
  disableAppSwitcherProtectionAsync: jest.fn(async () => {}),
};
export function captureMock() { return capture; }

export const wipeHooks: (() => unknown)[] = [];
export function sessionMock() {
  return { onWipe: (h: () => unknown) => { wipeHooks.push(h); return () => {}; } };
}

/** A small /api/meta with the record types the tests use. */
export function sampleMeta() {
  return {
    resources: {
      ticket: {
        type: 'ticket', label: 'Ticket', plural: 'Tickets', module: 'tickets', path: '/api/tickets', route: '/tickets', titleField: 'title', refField: 'ref',
        restricted: false,
        fields: {
          ref: { label: 'Reference', type: 'text', readOnly: true },
          title: { label: 'Title', type: 'text', required: true },
          status: { label: 'Status', type: 'lookup', list: 'ticket_status', required: true },
          priority: { label: 'Priority', type: 'lookup', list: 'ticket_priority' },
          assignee_id: { label: 'Assignee', type: 'user' },
          description: { label: 'Description', type: 'longtext' },
          resolution_notes: { label: 'Resolution notes', type: 'longtext' },
          resolution_code: { label: 'Resolution code', type: 'lookup', list: 'resolution_code' },
          vendor_ref: { label: 'Vendor reference', type: 'text', mobileEditable: true },
        },
        lifecycle: { field: 'status', managed: false, blocked: [['new', 'closed']], required: { resolved: ['resolution_code'] }, denied: ['canceled'] },
      },
      hazard: {
        type: 'hazard', label: 'Hazard', plural: 'Hazards', module: 'safety', path: '/api/safety/hazards', route: '/safety/hazards',
        titleField: 'title', refField: 'ref', restricted: false,
        fields: {
          ref: { label: 'Reference', type: 'text', readOnly: true },
          title: { label: 'Hazard', type: 'text', required: true },
          status: { label: 'Status', type: 'lookup', list: 'hazard_status', default: 'identified' },
          source: { label: 'Source', type: 'lookup', list: 'hazard_source', mobileEditable: true },
          notes: { label: 'Notes', type: 'longtext' },
        },
      },
      safety_event: {
        type: 'safety_event', label: 'Safety event', plural: 'Safety events', module: 'safety', path: '/api/safety/events', route: '/safety/events',
        titleField: 'title', refField: 'ref', restricted: 'flag',
        fields: {
          ref: { label: 'Reference', type: 'text', readOnly: true },
          title: { label: 'Title', type: 'text', required: true },
          status: { label: 'Status', type: 'lookup', list: 'safety_event_status' },
          restricted: { label: 'Restricted', type: 'boolean' },
          notes: { label: 'Notes', type: 'longtext' },
        },
      },
    },
    lookups: {
      ticket_status: [
        { value: 'new', label: 'New', color: 'blue' }, { value: 'in_progress', label: 'In progress', color: 'amber' },
        { value: 'resolved', label: 'Resolved', color: 'green' }, { value: 'closed', label: 'Closed', color: 'gray' }, { value: 'canceled', label: 'Canceled' },
      ],
      ticket_priority: [{ value: 'high', label: 'High', color: 'red' }],
      resolution_code: [{ value: 'fixed', label: 'Fixed' }],
      safety_event_status: [{ value: 'reported', label: 'Reported' }],
      hazard_status: [{ value: 'identified', label: 'Identified' }, { value: 'mitigated', label: 'Mitigated' }],
      hazard_source: [{ value: 'inspection', label: 'Inspection' }],
    },
  };
}

export function sampleTicket(over: Record<string, unknown> = {}) {
  return {
    id: 't1', ref: 'TKT-00042', title: 'Platform display shows no departures', status: 'new', priority: 'high', assignee_id: 'u2',
    description: 'The display at platform 2 is blank.', resolution_notes: null, resolution_code: null, vendor_ref: null,
    updated_at: '2026-11-20T10:00:00.000Z', _display: { status: 'New', priority: 'High', assignee_id: 'Sam Sample' }, ...over,
  };
}
