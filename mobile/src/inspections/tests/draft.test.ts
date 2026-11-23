// An inspection run on the phone (E38-11): the draft merged with the server's answers, the server's own
// rules (shared/inspection-rules.ts), and the outbox items it becomes: photos and the signature first,
// then the answers and completion naming them.
import type { PackageInspection } from '../../../../shared/mobile-api.ts';
import { afterSent, currentAnswer, emptyDraft, hasUnsent, inspectionItems, preview, runItems, withAnswer } from '../draft';
import { __test, encodeGrayPng, hasInk, rasterize, signaturePng, SIGNATURE_SIZE } from '../signature';

const item = (id: string, over: Partial<NonNullable<PackageInspection['checklist']>['items'][number]> = {}) => ({
  id, section: null, prompt: `Invented item ${id}`, guidance: null, critical: false, photo_required: false, removed: false, ...over,
});

const ins = (over: Partial<PackageInspection> = {}): PackageInspection => ({
  id: 'ins-1', ref: 'INS-00007', title: 'Invented platform check', status: 'Scheduled', dueOn: '2026-11-23', target: null,
  checklist: {
    template: { id: 't1', name: 'Invented platform check' },
    items: [item('a', { critical: true }), item('b', { photo_required: true }), item('c'), item('d', { removed: true })],
    responses: { c: { answer: 'na', note: 'Invented: closed for works.', photos: 0 } },
    canAnswer: true,
  },
  ...over,
});

// Node's own inflate checks the PNG's image data (Jest runs on Node).
const { inflateSync } = jest.requireActual<{ inflateSync(b: Uint8Array): Uint8Array }>('zlib');

let n = 0;
const newId = () => `id-${++n}`;
beforeEach(() => { n = 0; });

describe('the draft', () => {
  it('merges the phone\'s answers with the server\'s, and leaves out removed items never answered', () => {
    let d = emptyDraft('ins-1', new Date('2026-11-22T10:00:00Z'));
    expect(currentAnswer(ins(), d, 'c')).toMatchObject({ answer: 'na', note: 'Invented: closed for works.' });
    d = withAnswer(d, 'c', { answer: 'yes' });
    expect(currentAnswer(ins(), d, 'c').answer).toBe('yes');
    expect(runItems(ins(), d).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('applies the server\'s rules: everything answered, photos where needed, the same result and score', () => {
    let d = emptyDraft('ins-1');
    expect(preview(ins(), d).problem).toMatchObject({ code: 'incomplete', message: 'Answer every item first: 2 still open.' });
    d = withAnswer(withAnswer(d, 'a', { answer: 'yes' }), 'b', { answer: 'no' });
    expect(preview(ins(), d).problem).toMatchObject({ code: 'photo_required' });
    d = withAnswer(d, 'b', { photos: [{ uri: 'file:///p1.jpg', name: 'photo-1.jpg' }] });
    const p = preview(ins(), d);
    expect(p.problem).toBeNull();
    expect([p.result, p.scorePct, p.failed.map((i) => i.id)]).toEqual(['pass_with_findings', 50, ['b']]);
    d = withAnswer(d, 'a', { answer: 'no' });
    expect(preview(ins(), d).result).toBe('fail');
  });

  it('becomes outbox items: photos and the signature first, then the completion naming them', () => {
    let d = emptyDraft('ins-1');
    d = withAnswer(d, 'a', { answer: 'yes' });
    d = withAnswer(d, 'b', { answer: 'no', note: 'Invented: cracked tile.', photos: [{ uri: 'file:///p1.jpg', name: 'photo-1.jpg' }] });
    const items = inspectionItems(ins(), d, {
      complete: true, raiseFindings: false, notes: ' Invented: windy. ', newId,
      signature: { name: 'Pat Example', file: { uri: 'file:///sig.png', name: 'signature.png' } },
    });
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['attachment', 'Photo 1'], ['attachment', 'Signature'], ['inspection.complete', 'INS-00007 Invented platform check'],
    ]);
    expect(items[0]).toMatchObject({ id: 'id-1', file: { uri: 'file:///p1.jpg' }, payload: { recordType: 'inspection', recordId: 'ins-1', description: 'Photo: Invented item b' } });
    expect(items[1].payload).toMatchObject({ recordType: 'inspection', recordId: 'ins-1', description: 'Signature of completion: Pat Example' });
    expect(items[2].payload).toEqual({
      inspectionId: 'ins-1', raiseFindings: false, notes: 'Invented: windy.',
      answers: [{ itemId: 'a', answer: 'yes' }, { itemId: 'b', answer: 'no', note: 'Invented: cracked tile.', photos: ['id-1'] }],
      signature: { name: 'Pat Example', photo: 'id-2' },
    });
  });

  it('sends the answers so far without completing, and keeps them on the phone without their photos', () => {
    let d = withAnswer(emptyDraft('ins-1'), 'b', { answer: 'yes', photos: [{ uri: 'file:///p1.jpg', name: 'photo-1.jpg' }] });
    expect(hasUnsent(d)).toBe(true);
    const items = inspectionItems(ins(), d, { complete: false, newId });
    expect(items.map((i) => i.kind)).toEqual(['attachment', 'inspection.answers']);
    expect(items[1].payload).toEqual({ inspectionId: 'ins-1', answers: [{ itemId: 'b', answer: 'yes', photos: ['id-1'] }] });
    d = afterSent(d);
    expect(hasUnsent(d)).toBe(false);
    expect(d.answers.b).toMatchObject({ answer: 'yes', photos: [], sentPhotos: 1 });
    expect(currentAnswer(ins(), d, 'b').photos).toBe(1);
  });
});

describe('the drawn signature', () => {
  it('is a valid grayscale PNG with the strokes drawn in black', () => {
    const strokes = [[{ x: 10, y: 10 }, { x: 200, y: 80 }], [{ x: 50, y: 70 }]];
    expect(hasInk(strokes)).toBe(true);
    expect(hasInk([])).toBe(false);
    const png = signaturePng(strokes, { width: 240, height: 80 });
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([SIGNATURE_SIZE.width, SIGNATURE_SIZE.height]);
    // Every chunk's CRC is right, and the image data inflates to the rows of pixels.
    let o = 8;
    let idat: Uint8Array | null = null;
    while (o < png.length) {
      const len = view.getUint32(o);
      const type = String.fromCharCode(...png.slice(o + 4, o + 8));
      expect(view.getUint32(o + 8 + len)).toBe(__test.crc32(png, o + 4, o + 8 + len));
      if (type === 'IDAT') idat = png.slice(o + 8, o + 8 + len);
      o += 12 + len;
    }
    const raw = inflateSync((idat!));
    expect(raw.length).toBe((SIGNATURE_SIZE.width + 1) * SIGNATURE_SIZE.height);
    const px = rasterize(strokes, { width: 240, height: 80 });
    // The line from (20, 20) to (400, 160) in picture pixels passes through (210, 90).
    expect(px[90 * SIGNATURE_SIZE.width + 210]).toBe(0);
    expect(px[5 * SIGNATURE_SIZE.width + 470]).toBe(255);
    expect(raw[90 * (SIGNATURE_SIZE.width + 1) + 1 + 210]).toBe(0);
  });

  it('splits large pictures into several stored blocks', () => {
    const png = encodeGrayPng(new Uint8Array(400 * 400).fill(255), 400, 400);
    let o = 8;
    const view = new DataView(png.buffer, png.byteOffset);
    while (String.fromCharCode(...png.slice(o + 4, o + 8)) !== 'IDAT') o += 12 + view.getUint32(o);
    const data = inflateSync((png.slice(o + 8, o + 8 + view.getUint32(o))));
    expect(data.length).toBe(401 * 400);
    expect(__test.adler32(new Uint8Array([97, 98, 99]))).toBe(0x024d0127);
  });
});
