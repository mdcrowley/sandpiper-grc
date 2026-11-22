import { framePlain, toView, uprightSize } from './geometry';
import { fitPhoto, photoName, PhotoError, type PhotoDevice } from './photos';
import { ReportQueue, REPORT_TEXT, type QueuedReport, type ReportStore, type ReportTransport } from './reports';
import { ApiError } from '../api/client';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('../api/client', () => {
  class ApiError extends Error {
    status: number; code: string; fields: Record<string, string>;
    constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) { super(message); this.status = status; this.code = code; this.fields = fields; }
  }
  return { ApiError, CLIENT_ERRORS: { notConnected: 'not_connected', offline: 'offline', badResponse: 'bad_response' }, apiFetch: jest.fn(), apiUpload: jest.fn() };
});

describe('geometry', () => {
  it('turns frames on their side upright', () => {
    expect(uprightSize(1920, 1080, 'right')).toEqual({ width: 1080, height: 1920 });
    expect(uprightSize(1920, 1080, 'up')).toEqual({ width: 1920, height: 1080 });
  });

  it('maps boxes to a preview that covers the screen', () => {
    // A 1000x2000 picture on a 500x500 view: scaled by 0.5, the top and bottom cropped by 250.
    expect(toView({ x: 100, y: 1000, width: 200, height: 100 }, { width: 1000, height: 2000 }, { width: 500, height: 500 }))
      .toEqual({ x: 50, y: 250, width: 100, height: 50 });
  });

  it('builds text boxes from the center and size the recognizer gives (its x and y are not the corner)', () => {
    const reads = framePlain({ width: 800, height: 400 }, [], { blocks: [{ lines: [{ lineText: '700054', lineFrame: { x: 300, y: 272, width: 162, height: 28, boundingCenterX: 600, boundingCenterY: 200 } }] }] });
    expect(reads.lines[0].box).toEqual({ x: 519, y: 186, width: 162, height: 28 });
  });

  it('turns the readers\' answers into plain reads', () => {
    const reads = framePlain({ width: 100, height: 200 },
      [{ format: 'qr-code', rawValue: 'TA-118342', boundingBox: { left: 1, right: 11, top: 2, bottom: 12 } }, { format: 'maxicode', displayValue: 'X1', boundingBox: { left: 0, right: 1, top: 0, bottom: 1 } }, { format: 'ean-8', boundingBox: { left: 0, right: 1, top: 0, bottom: 1 } }],
      { blocks: [{ lines: [{ lineText: '004521', lineFrame: { x: 5, y: 6, width: 7, height: 8 } }, { lineText: '', lineFrame: { x: 0, y: 0, width: 0, height: 0 } }] }] });
    expect(reads).toEqual({
      width: 100, height: 200, still: false,
      codes: [{ type: 'qr-code', content: 'TA-118342', box: { x: 1, y: 2, width: 10, height: 10 } }, { type: 'unknown', content: 'X1', box: { x: 0, y: 0, width: 1, height: 1 } }],
      lines: [{ text: '004521', box: { x: 5, y: 6, width: 7, height: 8 } }],
    });
  });
});

describe('photos fitted to the server limits', () => {
  const fake = (sizes: number[]): PhotoDevice & { removed: string[]; calls: number[] } => {
    let i = 0;
    const d = {
      removed: [] as string[], calls: [] as number[],
      async resize(_u: string, _s: { width: number; height: number }, edge: number) { d.calls.push(edge); return `file:///out-${i}.jpg`; },
      bytes() { return sizes[i++]; },
      remove(u: string) { d.removed.push(u); },
    };
    return d;
  };

  it('keeps the first size that fits, deleting the others', async () => {
    const d = fake([9_000_000, 4_000_000]);
    const out = await fitPhoto('file:///p.jpg', { width: 4000, height: 3000 }, { maxBytes: 5_000_000, allowedExtensions: ['jpg'] }, d);
    expect(out).toEqual({ uri: 'file:///out-1.jpg', bytes: 4_000_000 });
    expect(d.calls).toEqual([2048, 1600]);
    expect(d.removed).toEqual(['file:///out-0.jpg']);
  });

  it('refuses when nothing fits or photos are not accepted', async () => {
    await expect(fitPhoto('u', { width: 1, height: 1 }, { maxBytes: 10, allowedExtensions: ['jpg'] }, fake([99, 99, 99, 99]))).rejects.toBeInstanceOf(PhotoError);
    await expect(fitPhoto('u', { width: 1, height: 1 }, { maxBytes: 10, allowedExtensions: ['pdf'] }, fake([1]))).rejects.toMatchObject({ code: 'type_not_allowed' });
  });

  it('names photos by time', () => {
    expect(photoName(new Date(2026, 10, 22, 14, 5, 1), 2)).toBe('photo-20261122-140501-2.jpg');
  });
});

describe('report queue', () => {
  const memoryStore = (): ReportStore & { saved: QueuedReport[]; dropped: string[] } => {
    const s = {
      saved: [] as QueuedReport[], dropped: [] as string[],
      async load() { return s.saved; },
      async save(r: QueuedReport[]) { s.saved = JSON.parse(JSON.stringify(r)); },
      async keep(id: string, _uri: string, name: string) { return `file:///q/${id}/${name}`; },
      async drop(id: string) { s.dropped.push(id); },
      async wipe() { s.saved = []; },
    };
    return s;
  };
  const transport = (over: Partial<ReportTransport> = {}): ReportTransport & { creates: number; uploads: string[]; links: string[] } => {
    const t = {
      creates: 0, uploads: [] as string[], links: [] as string[],
      reachable: async () => true,
      create: async () => { t.creates++; return { id: 'tkt-1', ref: 'TKT-00042' }; },
      upload: async (_t: string, _id: string, _f: string, name: string) => { t.uploads.push(name); },
      link: async (ft: string, fid: string, to: { type: string; id: string }) => { t.links.push(`${ft}:${fid}->${to.type}:${to.id}`); },
      ...over,
    };
    return t;
  };

  it('links the new record to the tag\'s record once it is made', async () => {
    const t = transport();
    const q = new ReportQueue(memoryStore(), t);
    await q.add({ ...report, link: { type: 'vehicle', id: 'v1' } }, []);
    await q.process();
    expect(t.links).toEqual(['ticket:tkt-1->vehicle:v1']);
    expect(await q.list()).toEqual([]);
  });
  const report = { id: 'r1', kind: 'problem' as const, path: '/api/tickets', recordType: 'ticket', body: { title: 'Leaking pump' }, title: 'Leaking pump' };
  const photos = [{ uri: 'file:///a.jpg', name: 'a.jpg' }, { uri: 'file:///b.jpg', name: 'b.jpg' }];

  it('creates the record once, uploads every photo, then forgets the report', async () => {
    const store = memoryStore(); const t = transport();
    const q = new ReportQueue(store, t);
    await q.add(report, photos);
    await q.process();
    expect(t.creates).toBe(1);
    expect(t.uploads).toEqual(['a.jpg', 'b.jpg']);
    expect(await q.list()).toEqual([]);
    expect(store.dropped).toEqual(['r1']);
  });

  it('waits without a connection and sends later on its own', async () => {
    let online = false;
    const t = transport({ reachable: async () => online });
    const q = new ReportQueue(memoryStore(), t);
    await q.add(report, photos);
    await q.process();
    expect((await q.list())[0]).toMatchObject({ state: 'waiting', error: REPORT_TEXT.waiting });
    online = true;
    await q.process();
    expect(t.creates).toBe(1);
  });

  it('re-sends a failed photo to the same record, never re-creating it', async () => {
    let fail = true;
    const t = transport({ upload: async (_x: string, id: string, _f: string, name: string) => { if (fail && name === 'b.jpg') throw new ApiError(0, 'offline', 'offline'); t.uploads.push(`${id}/${name}`); } });
    const store = memoryStore();
    const q = new ReportQueue(store, t);
    await q.add(report, photos);
    await q.process();
    expect(store.saved[0]).toMatchObject({ created: { id: 'tkt-1' }, photos: [{ state: 'sent' }, { state: 'pending', attempts: 1 }] });
    // The app is closed and opened again: a new queue reads what was kept.
    fail = false;
    const again = new ReportQueue(store, t);
    await again.process();
    expect(t.creates).toBe(1);
    expect(t.uploads).toEqual(['tkt-1/a.jpg', 'tkt-1/b.jpg']);
  });

  it('a connection lost during the create waits for the person; only Send again creates again', async () => {
    let calls = 0;
    const t = transport({ create: async () => { calls++; if (calls === 1) throw new ApiError(0, 'offline', 'lost'); return { id: 'tkt-2' }; } });
    const q = new ReportQueue(memoryStore(), t);
    await q.add(report, []);
    await q.process();
    await q.process();
    expect(calls).toBe(1);
    expect((await q.list())[0]).toMatchObject({ state: 'uncertain', error: REPORT_TEXT.uncertain });
    await q.sendAgain('r1');
    expect(calls).toBe(2);
  });

  it('keeps a refused report with the server\'s reasons for correction', async () => {
    const t = transport({ create: async () => { throw new ApiError(400, 'validation', 'Check the highlighted fields.', { title: 'Title is required.' }); } });
    const q = new ReportQueue(memoryStore(), t);
    await q.add(report, []);
    await q.process();
    expect((await q.list())[0]).toMatchObject({ state: 'refused', fields: { title: 'Title is required.' } });
    expect(await q.unsent()).toBe(1);
  });

  it('wipes everything on sign-out', async () => {
    const store = memoryStore();
    const q = new ReportQueue(store, transport({ reachable: async () => false }));
    await q.add(report, photos);
    await q.wipe();
    expect(await q.list()).toEqual([]);
    expect(store.saved).toEqual([]);
  });
});
