// Test doubles for the tag and report screens: the api client (a route table instead of a server),
// the session, expo-router, the camera (frames are fed by the test) and the device modules. Each test
// file declares `jest.mock(<module>, () => require('./mocks').<x>())` and drives `server` and `camera`.

type Handler = (init: { method: string; body?: unknown; path: string }) => unknown;

export const server = {
  routes: {} as Record<string, Handler | unknown>,
  calls: [] as { method: string; path: string; body?: unknown; ifMatch?: string; idempotencyKey?: string }[],
  can: new Set<string>(['*']),
  areas: { tags: true, tickets: true, safety: true, fleet: true } as Record<string, boolean>,
  reset() {
    this.routes = {};
    this.calls = [];
    this.can = new Set(['*']);
    this.areas = { tags: true, tickets: true, safety: true, fleet: true };
  },
};

export class FakeApiError extends Error {
  status: number; code: string; fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message); this.status = status; this.code = code; this.fields = fields; this.name = 'ApiError';
  }
}

export function clientMock() {
  const call = async (path: string, init: { method?: string; body?: unknown; ifMatch?: string; idempotencyKey?: string } = {}) => {
    const method = init.method ?? 'GET';
    server.calls.push({ method, path, body: init.body, ifMatch: init.ifMatch, idempotencyKey: init.idempotencyKey });
    const bare = path.split('?')[0];
    const key = [`${method} ${path}`, `${method} ${bare}`].find((k) => k in server.routes);
    if (!key) throw new FakeApiError(404, 'not_found', `No route ${method} ${path}`);
    const h = server.routes[key];
    const answer = typeof h === 'function' ? await (h as Handler)({ method, body: init.body, path }) : h;
    return JSON.parse(JSON.stringify(answer ?? null));
  };
  return {
    ApiError: FakeApiError,
    CLIENT_ERRORS: { notConnected: 'not_connected', offline: 'offline', badResponse: 'bad_response' },
    apiFetch: jest.fn(call),
    apiUpload: jest.fn(async (path: string) => call(path, { method: 'PUT' })),
    useSession: () => ({
      status: 'signed-in',
      session: { server: 'https://grc.example.org', user: { id: 'u1', displayName: 'Pat Example', username: 'pat' }, deviceId: 'd1', permissions: ['*'], areas: server.areas },
      can: (p: string) => server.can.has('*') || server.can.has(p),
      areaOn: (a: string) => server.areas[a] === true,
      signOut: async () => {},
    }),
  };
}

export function sessionMock() {
  return {
    onWipe: jest.fn(() => () => {}),
    registerUnsentWork: jest.fn(() => () => {}),
    accessToken: jest.fn(async () => 'grc_mat_test'),
    authStore: { get: () => ({ server: 'https://grc.example.org' }), subscribe: () => () => {} },
  };
}

export const params: { current: Record<string, string | undefined> } = { current: {} };
export const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() };

export function routerMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router,
    useLocalSearchParams: () => params.current,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []),
  };
}

/** The camera stand-in: the test feeds frames through `camera.feed`. */
export const camera = { onReads: null as null | ((r: unknown) => void), takePicture: jest.fn(async () => ({ path: '/cache/shot.jpg', width: 4000, height: 3000 })) };

export function tagCameraMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    TagCamera: React.forwardRef((props: { onReads: (r: unknown) => void }, ref: unknown) => {
      camera.onReads = props.onReads;
      React.useImperativeHandle(ref, () => ({ takePicture: camera.takePicture }));
      return null;
    }),
    READ_CODE_TYPES: [],
  };
}

export const still = { readStill: jest.fn(), discardPicture: jest.fn() };
export const stillMock = () => still;

export function visionCameraMock() {
  return { useCameraPermission: () => ({ hasPermission: true, canRequestPermission: true, status: 'authorized', requestPermission: async () => true }) };
}

export const picker = { launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() };
export const pickerMock = () => picker;
