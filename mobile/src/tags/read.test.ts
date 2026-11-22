import { actsAlone, linePieces, readCode, readFrame, readTextWithoutFormats, type FrameReads } from './read';
import { TagReader } from './reader';
import { checkCharacter, sequenceValue, type TagFormat } from '../../../shared/tag-format.ts';

const fmt = (over: Partial<TagFormat>): TagFormat => ({
  id: 'f1', name: 'Bought tags', characters: 'digits', pattern: null, prefix: '', lengthMin: null, lengthMax: null,
  checkCharacter: 'none', carrier: 'any', extractPattern: null, recordTypes: [], active: true, ...over,
});
const digits6Luhn = fmt({ id: 'luhn', characters: 'digits', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod10' });
const prefixed = fmt({ id: 'ta', characters: 'digits', prefix: 'TA-', lengthMin: 6, lengthMax: 6 });
const alnum36 = fmt({ id: 'k', characters: 'alphanumeric', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod36' });
const frame = (over: Partial<FrameReads>): FrameReads => ({ width: 1000, height: 1000, codes: [], lines: [], ...over });

// A valid Luhn value: 00452 + check digit.
const LUHN = sequenceValue(452, { digits: 5, checkCharacter: 'mod10' });

describe('codes', () => {
  it('takes the whole content without formats, exactly', () => {
    const r = readCode({ type: 'code-128', content: ' TA_118342 ' }, []);
    expect(r).toMatchObject({ key: 'TA118342', value: 'TA_118342', how: 'code', trust: 'exact', formatId: null });
    expect(actsAlone(r!)).toBe(true);
  });

  it('uses a format\'s extraction pattern for codes holding more', () => {
    const f = fmt({ id: 'x', characters: 'alphanumeric', extractPattern: 'id=([A-Z0-9]+)' });
    const r = readCode({ type: 'qr-code', content: 'https://labels.example.org/t?id=K7Q2M9&v=2' }, [f]);
    expect(r).toMatchObject({ value: 'K7Q2M9', formatId: 'x', trust: 'exact' });
  });

  it('keeps a code no format accepts (it may be a serial number), but drops over-long content', () => {
    expect(readCode({ type: 'code-39', content: 'SN-99812' }, [digits6Luhn])).toMatchObject({ key: 'SN99812', formatId: null });
    expect(readCode({ type: 'qr-code', content: 'x'.repeat(300) }, [])).toBeNull();
  });

  it('honors the carrier: a text-only format does not claim codes', () => {
    const textOnly = fmt({ ...digits6Luhn, carrier: 'text' });
    expect(readCode({ type: 'ean-8', content: LUHN }, [textOnly])?.formatId).toBeNull();
  });
});

describe('text', () => {
  it('splits a line into neighboring words', () => {
    expect(linePieces('Tag: TA-118 342.')).toEqual(expect.arrayContaining(['TA-118 342', 'TA-118', '342']));
  });

  it('accepts digits with a check digit, correcting look-alike letters', () => {
    const misread = LUHN.replace(/0/g, 'O');
    const { texts } = readFrame(frame({ lines: [{ text: `Asset ${misread}` }] }), [digits6Luhn]);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ key: LUHN, value: LUHN, trust: 'checked', formatId: 'luhn' });
  });

  it('refuses digits whose check digit is wrong', () => {
    const wrong = LUHN.slice(0, 5) + String((Number(LUHN[5]) + 1) % 10);
    expect(readFrame(frame({ lines: [{ text: wrong }] }), [digits6Luhn]).texts).toEqual([]);
  });

  it('asks for confirmation when the format has no check character', () => {
    const { texts } = readFrame(frame({ lines: [{ text: 'TA-118 342' }] }), [prefixed]);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ key: 'TA118342', trust: 'format' });
    expect(actsAlone(texts[0])).toBe(false);
  });

  it('keeps the longest value from a line, not its parts', () => {
    const wide = fmt({ id: 'w', characters: 'digits', prefix: 'TA-', lengthMin: 3, lengthMax: 6 });
    const { texts } = readFrame(frame({ lines: [{ text: 'TA-118 342' }] }), [wide]);
    expect(texts.map((t) => t.key)).toEqual(['TA118342']);
  });

  it('sends look-alike variants for letters-and-digits formats, filtered by the check character', () => {
    // A 6-character value with its mod 36 check character, misread with 0 for O.
    const five = 'K7Q2O';
    const truth = `${five}${checkCharacter(five, 'mod36')}`;
    const misread = truth.replace('O', '0');
    const { texts } = readFrame(frame({ lines: [{ text: misread }] }), [alnum36]);
    expect(texts).toHaveLength(1);
    expect(texts[0].variants.map((v) => v.toUpperCase())).toContain(truth);
    expect(texts[0].trust).toBe('checked');
  });

  it('offers text without any format only for confirmation, and only tag-like words', () => {
    const r = readTextWithoutFormats({ text: 'PROPERTY OF THE AUTHORITY TA 118342' });
    expect(r.map((x) => [x.key, x.trust])).toEqual([['TA118342', 'confirm']]);
    expect(readTextWithoutFormats({ text: 'Do not remove' })).toEqual([]);
    expect(readFrame(frame({ lines: [{ text: '004521' }] }), []).texts[0]).toMatchObject({ trust: 'confirm' });
  });

  it('ignores text that no format accepts when formats exist', () => {
    expect(readFrame(frame({ lines: [{ text: 'Serial 77-1234' }] }), [digits6Luhn]).texts).toEqual([]);
  });
});

describe('codes and text together', () => {
  const box = (x: number, y: number) => ({ x, y, width: 200, height: 60 });

  it('agreeing code and text confirm each other', () => {
    const { codes, texts } = readFrame(frame({
      codes: [{ type: 'code-128', content: '004521', box: box(100, 100) }],
      lines: [{ text: '004521', box: box(100, 170) }],
    }), []);
    expect(codes[0].how).toBe('both');
    expect(texts).toEqual([]);
  });

  it('the code wins when they disagree', () => {
    const { codes, texts } = readFrame(frame({
      codes: [{ type: 'code-128', content: '004521', box: box(100, 100) }],
      lines: [{ text: '004527', box: box(100, 170) }],
    }), []);
    expect(codes.map((c) => [c.key, c.how])).toEqual([['004521', 'code']]);
    expect(texts).toEqual([]);
  });

  it('text far from a code is another tag', () => {
    const { codes, texts } = readFrame(frame({
      codes: [{ type: 'qr-code', content: 'TA-118342', box: box(50, 50) }],
      lines: [{ text: 'TA-200117', box: box(700, 800) }],
    }), []);
    expect(codes).toHaveLength(1);
    expect(texts.map((t) => t.key)).toEqual(['TA200117']);
  });
});

describe('two-frame agreement', () => {
  it('counts text only when two consecutive frames agree; codes at once', () => {
    const reader = new TagReader([digits6Luhn]);
    const f = frame({ codes: [{ type: 'qr-code', content: 'K7Q2M9' }], lines: [{ text: LUHN, box: { x: 0, y: 900, width: 10, height: 10 } }] });
    // No box on the code and one code in view: same tag → disagreeing text is dropped. Give the code a far box.
    f.codes[0].box = { x: 900, y: 0, width: 50, height: 50 };
    expect(reader.observe(f, 0).map((r) => r.key)).toEqual(['K7Q2M9']);
    expect(reader.observe(f, 100).map((r) => r.key)).toEqual(['K7Q2M9', LUHN]);
  });

  it('does not count text that changed between frames', () => {
    const reader = new TagReader([]);
    reader.observe(frame({ lines: [{ text: '004521' }] }), 0);
    expect(reader.observe(frame({ lines: [{ text: '004527' }] }), 100)).toEqual([]);
    expect(reader.observe(frame({ lines: [{ text: '004527' }] }), 200).map((r) => r.key)).toEqual(['004527']);
  });

  it('codes without a check character need two frames, or confirmation from a still picture', () => {
    const reader = new TagReader([]);
    const f = frame({ codes: [{ type: 'code-39', content: 'TA-118350' }] });
    expect(reader.observe(f, 0)).toEqual([]);
    expect(reader.observe(f, 100)).toMatchObject([{ key: 'TA118350', trust: 'exact' }]);
    const still = new TagReader([]).observe(frame({ still: true, codes: [{ type: 'codabar', content: 'A004523A' }] }), 0);
    expect(still).toMatchObject([{ key: '004523', trust: 'confirm' }]);
    // Printed text on the same tag that agrees confirms it at once.
    const both = new TagReader([]).observe(frame({ still: true, codes: [{ type: 'itf', content: '00452200' }], lines: [{ text: '00452200' }] }), 0);
    expect(both).toMatchObject([{ key: '00452200', how: 'both', trust: 'exact' }]);
    // A check-protected code counts at once.
    expect(new TagReader([]).observe(frame({ codes: [{ type: 'code-128', content: '004521' }] }), 0)).toHaveLength(1);
  });

  it('a still picture counts at once', () => {
    const reader = new TagReader([]);
    expect(reader.observe(frame({ still: true, lines: [{ text: '004521' }] }), 0).map((r) => r.key)).toEqual(['004521']);
  });

  it('lists several tags in view and forgets those out of view', () => {
    const reader = new TagReader([]);
    reader.observe(frame({ codes: [{ type: 'ean-8', content: '12345670', box: { x: 0, y: 0, width: 50, height: 50 } }, { type: 'qr-code', content: 'TA-1', box: { x: 600, y: 600, width: 50, height: 50 } }] }), 0);
    expect(reader.inView(500)).toHaveLength(2);
    expect(reader.inView(5000)).toHaveLength(0);
    expect(reader.all()).toHaveLength(2);
  });
});
