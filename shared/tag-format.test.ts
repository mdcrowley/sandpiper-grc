import { describe, expect, it } from 'vitest';
import {
  checkCharacter, cleanValue, compileSafePattern, extractFromCode, firstMatchingFormat, formatsFor, lookAlikeVariants,
  MATCH_STEP_BUDGET, matchFormat, plainTextCandidate, safeMatch, sequenceValue, type TagFormat, validCheckCharacter, valueKey,
} from './tag-format.ts';

// Asset tag values and formats (wave 13, E37-02, E38-05). Invented tag values only.

const fmt = (over: Partial<TagFormat> = {}): TagFormat => ({
  id: 'f1', name: 'Equipment tags', characters: 'digits', pattern: null, prefix: '', lengthMin: null, lengthMax: null,
  checkCharacter: 'none', carrier: 'any', extractPattern: null, recordTypes: [], active: true, ...over,
});

describe('valueKey: one comparison form for every source', () => {
  it('trims, uppercases and drops spaces, dashes, underscores and control characters', () => {
    expect(valueKey('  ta-118 342 ')).toBe('TA118342');
    expect(valueKey('TA_118342')).toBe('TA118342');
    expect(valueKey('ta–118 342')).toBe('TA118342');
    expect(valueKey('K7Q2\u001dM9')).toBe('K7Q2M9');
    expect(valueKey('ＴＡ１１８')).toBe('TA118'); // full-width characters
    expect(valueKey(null)).toBe('');
    expect(valueKey(undefined)).toBe('');
  });
  it('keeps leading zeros and every other character', () => {
    expect(valueKey('004521')).toBe('004521');
    expect(valueKey('004521')).not.toBe(valueKey('4521'));
    expect(valueKey('A/B.12')).toBe('A/B.12');
  });
  it('cleanValue keeps the value as read, tidied', () => {
    expect(cleanValue('  TA-118  342\n')).toBe('TA-118 342');
    expect(cleanValue(undefined)).toBe('');
  });
});

describe('check characters', () => {
  it('mod 10 is the Luhn algorithm', () => {
    expect(checkCharacter('7992739871', 'mod10')).toBe('3');
    expect(validCheckCharacter('79927398713', 'mod10')).toBe(true);
    expect(validCheckCharacter('79927398710', 'mod10')).toBe(false);
    expect(checkCharacter('12A', 'mod10')).toBeNull();
  });
  it('mod 11 uses weights 2 to 7 from the right, with X for ten', () => {
    expect(checkCharacter('12345', 'mod11')).toBe('5');
    expect(validCheckCharacter('123455', 'mod11')).toBe(true);
    const tenBody = Array.from({ length: 1000 }, (_, i) => String(i).padStart(4, '0')).find((b) => checkCharacter(b, 'mod11') === 'X');
    expect(tenBody).toBeDefined();
    expect(validCheckCharacter(`${tenBody}X`, 'mod11')).toBe(true);
  });
  it('mod 36 (ISO/IEC 7064 MOD 37,36) checks letters and digits', () => {
    const c = checkCharacter('K7Q2M', 'mod36')!;
    expect(c).toMatch(/^[0-9A-Z]$/);
    expect(validCheckCharacter(`K7Q2M${c}`, 'mod36')).toBe(true);
    expect(checkCharacter('k7', 'mod36')).toBeNull();
  });
  it('each scheme catches every single-character change of a sample', () => {
    for (const [scheme, body, alphabet] of [['mod10', '0104528', '0123456789'], ['mod11', '0104528', '0123456789'], ['mod36', 'TA1183', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ']] as const) {
      const full = body + checkCharacter(body, scheme);
      for (let i = 0; i < body.length; i++) {
        for (const ch of alphabet) {
          if (ch === body[i]) continue;
          expect(validCheckCharacter(full.slice(0, i) + ch + full.slice(i + 1), scheme), `${scheme} ${i} ${ch}`).toBe(false);
        }
      }
    }
  });
  it('none accepts anything; a value too short fails', () => {
    expect(checkCharacter('ABC', 'none')).toBe('');
    expect(validCheckCharacter('1', 'none')).toBe(true);
    expect(validCheckCharacter('1', 'mod10')).toBe(false);
  });
  it('sequence values are zero-padded with their check character', () => {
    expect(sequenceValue(42, { prefix: 'TA-', digits: 6 })).toBe('TA-000042');
    expect(sequenceValue(42, { digits: 6, checkCharacter: 'mod10' })).toBe(`000042${checkCharacter('000042', 'mod10')}`);
  });
});

describe('safe patterns', () => {
  it('compiles the allowed subset', () => {
    for (const p of ['^TA\\d{6}$', '[A-Z]{2}[0-9]+', 'ID:(\\d{4,10})', '.*SN=([A-Z0-9]+)', '\\.\\[x\\]', '[^;]+', 'A?B*C+D{2,}']) {
      expect(compileSafePattern(p).ok, p).toBe(true);
    }
  });
  it('refuses what could be slow or is not in the subset', () => {
    const bad: [string, RegExp][] = [
      ['(a+)+', /repeated/], ['(a)(b)', /one group/], ['((a))', /nested/], ['a|b', /Alternatives/],
      ['(?=a)', /Lookaround/], ['\\1', /not allowed/], ['a**', /one repeat/], ['a{500}', /at most 200/],
      ['a{3,1}', /less than/], ['[abc', /not closed/], ['(abc', /not closed/], ['abc)', /no "\("/], ['a$b', /end/],
      ['a^', /start/], ['*a', /must follow/], ['', /Type/], ['x'.repeat(121), /at most 120/], ['a*b*c*d*e*', /open-ended/],
      ['[z-a]', /backwards/],
    ];
    for (const [p, why] of bad) {
      const r = compileSafePattern(p);
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.error, p).toMatch(why);
    }
  });
  it('matches whole values and searches with a group', () => {
    const p = compileSafePattern('TA\\d{6}');
    if (!p.ok) throw new Error(p.error);
    expect(safeMatch(p.pattern, 'TA118342', { whole: true }).matched).toBe(true);
    expect(safeMatch(p.pattern, 'TA1183420', { whole: true }).matched).toBe(false);
    expect(safeMatch(p.pattern, 'xxTA118342yy').whole).toBe('TA118342');
    const g = compileSafePattern('SN=([A-Z0-9]+);');
    if (!g.ok) throw new Error(g.error);
    expect(safeMatch(g.pattern, 'MFR=QUILL;SN=K7Q2M9;LOT=4').group).toBe('K7Q2M9');
  });
  it('gives up on a pathological input within its step budget, quickly', () => {
    const p = compileSafePattern('.*.*.*.*X');
    if (!p.ok) throw new Error(p.error);
    const started = Date.now();
    const r = safeMatch(p.pattern, 'a'.repeat(2000));
    expect(r.matched).toBe(false);
    expect(r.budgetExceeded).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(MATCH_STEP_BUDGET).toBeLessThanOrEqual(100_000);
  });
});

describe('matchFormat', () => {
  const ta = fmt({ prefix: 'TA-', lengthMin: 7, lengthMax: 7, checkCharacter: 'mod10' });
  const good = sequenceValue(118342, { prefix: 'TA-', digits: 6, checkCharacter: 'mod10' });
  it('accepts a value of the format however it is written', () => {
    expect(matchFormat(good, ta, 'text')).toMatchObject({ ok: true, prefix: 'TA', numberPart: good.slice(3), checked: true });
    expect(matchFormat(good.toLowerCase().replace('-', ' '), ta, 'typed').ok).toBe(true);
  });
  it('says why a value does not fit', () => {
    const wrongCheck = good.slice(0, -1) + String((Number(good.slice(-1)) + 1) % 10);
    expect(matchFormat(wrongCheck, ta, 'text')).toEqual({ ok: false, reason: 'check' });
    expect(matchFormat('TB-1183424', ta, 'text')).toEqual({ ok: false, reason: 'prefix' });
    expect(matchFormat('TA-11834', ta, 'text')).toEqual({ ok: false, reason: 'length' });
    expect(matchFormat('TA-1183A24', ta, 'text')).toEqual({ ok: false, reason: 'characters' });
    expect(matchFormat('   ', ta, 'text')).toEqual({ ok: false, reason: 'empty' });
    expect(matchFormat('9'.repeat(201), fmt(), 'text')).toEqual({ ok: false, reason: 'too_long' });
  });
  it('applies the carrier to the camera only', () => {
    const codeOnly = fmt({ carrier: 'code' });
    expect(matchFormat('004521', codeOnly, 'text')).toEqual({ ok: false, reason: 'carrier' });
    expect(matchFormat('004521', codeOnly, 'code').ok).toBe(true);
    expect(matchFormat('004521', codeOnly, 'typed').ok).toBe(true);
    expect(matchFormat('004521', codeOnly, 'handheld').ok).toBe(true);
    expect(matchFormat('004521', fmt({ carrier: 'text' }), 'code')).toEqual({ ok: false, reason: 'carrier' });
  });
  it('lets mod 11 digits formats end with X', () => {
    const f = fmt({ checkCharacter: 'mod11' });
    const body = Array.from({ length: 1000 }, (_, i) => String(i).padStart(4, '0')).find((b) => checkCharacter(b, 'mod11') === 'X')!;
    expect(matchFormat(`${body}X`, f, 'text').ok).toBe(true);
    expect(matchFormat('12X4', f, 'text')).toEqual({ ok: false, reason: 'characters' });
  });
  it('checks letters-and-digits and pattern formats', () => {
    expect(matchFormat('k7q2m9', fmt({ characters: 'alphanumeric', lengthMin: 6, lengthMax: 6 }), 'text').ok).toBe(true);
    const pat = fmt({ characters: 'pattern', pattern: '[A-Z]{2}\\d{4}' });
    expect(matchFormat('rq-4410', pat, 'text').ok).toBe(true);
    expect(matchFormat('RQ441', pat, 'text')).toEqual({ ok: false, reason: 'pattern' });
    expect(matchFormat('RQ4410', fmt({ characters: 'pattern', pattern: '(a+)+' }), 'text')).toEqual({ ok: false, reason: 'bad_pattern' });
  });
  it('finds the first active format and filters by record type', () => {
    const a = fmt({ id: 'a', recordTypes: ['site'], prefix: 'S' });
    const b = fmt({ id: 'b' });
    const off = fmt({ id: 'c', active: false });
    expect(formatsFor([a, b, off], 'asset').map((f) => f.id)).toEqual(['b']);
    expect(formatsFor([a, b, off], 'site').map((f) => f.id)).toEqual(['a', 'b']);
    expect(firstMatchingFormat('S100', [a, b], 'text')?.format.id).toBe('a');
    expect(firstMatchingFormat('100', [a, b], 'text')?.format.id).toBe('b');
    expect(firstMatchingFormat('X', [off], 'text')).toBeNull();
  });
});

describe('extractFromCode', () => {
  it('takes the marked part when the pattern is found, else the whole content', () => {
    const f = { extractPattern: 'SN=([A-Z0-9]+)' };
    expect(extractFromCode('MFR=QUILL;SN=K7Q2M9;LOT=4', f)).toEqual({ value: 'K7Q2M9', extracted: true });
    expect(extractFromCode('  K7Q2M9 ', f)).toEqual({ value: 'K7Q2M9', extracted: false });
    expect(extractFromCode('https://example.invalid/a/004521', { extractPattern: '/(\\d+)$' })).toEqual({ value: '004521', extracted: true });
    expect(extractFromCode('004521', null)).toEqual({ value: '004521', extracted: false });
    expect(extractFromCode('004521', { extractPattern: '(a+)+' })).toEqual({ value: '004521', extracted: false });
  });
  it('does not search very long content', () => {
    expect(extractFromCode(`SN=1;${'x'.repeat(3000)}`, { extractPattern: 'SN=(\\d)' }).extracted).toBe(false);
  });
});

describe('look-alike characters', () => {
  it('corrects the digit part of digits-only formats, keeping the prefix', () => {
    const f = fmt({ prefix: 'SB-', lengthMin: 6, lengthMax: 6 });
    expect(lookAlikeVariants('SB-OO45I2', f)).toEqual(['SB004512']);
    expect(lookAlikeVariants('SB-0O4SlB', f)).toEqual(['SB004518']);
    expect(lookAlikeVariants('XX-004512', f)).toEqual([]);
  });
  it('returns only corrections that pass the check character', () => {
    const f = fmt({ lengthMin: 7, lengthMax: 7, checkCharacter: 'mod10' });
    const good = sequenceValue(10452, { digits: 6, checkCharacter: 'mod10' });
    expect(lookAlikeVariants(good.replace(/0/g, 'O'), f)).toEqual([good]);
    const wrong = good.slice(0, -1) + String((Number(good.slice(-1)) + 1) % 10);
    expect(lookAlikeVariants(wrong, f)).toEqual([]);
  });
  it('offers swapped variants of letters-and-digits values, fewest swaps first, within the limit', () => {
    const f = fmt({ characters: 'alphanumeric', lengthMin: 6, lengthMax: 6 });
    const v = lookAlikeVariants('K0Q1M8', f, 5);
    expect(v[0]).toBe('K0Q1M8');
    expect(v).toHaveLength(5);
    expect(v.slice(1, 4).sort()).toEqual(['K0Q1MB', 'K0QIM8', 'KOQ1M8'].sort());
    const withCheck = fmt({ characters: 'alphanumeric', checkCharacter: 'mod36' });
    const body = 'K0Q1M';
    const real = body + checkCharacter(body, 'mod36');
    expect(lookAlikeVariants(real.replace('0', 'O'), withCheck)).toContain(real);
    expect(lookAlikeVariants(real.replace('0', 'O'), withCheck).every((x) => matchFormat(x, withCheck, 'text').ok)).toBe(true);
  });
  it('without a format, gives the text as it is', () => {
    expect(lookAlikeVariants(' ab-12 ', null)).toEqual(['AB12']);
    expect(lookAlikeVariants('', null)).toEqual([]);
  });
});

describe('plain text without a format', () => {
  it('offers 3 to 40 letters, digits and dashes for confirmation', () => {
    expect(plainTextCandidate('TA-118342')).toBe('TA-118342');
    expect(plainTextCandidate('ab')).toBeNull();
    expect(plainTextCandidate('PROPERTY OF')).toBe('PROPERTY OF');
    expect(plainTextCandidate('x'.repeat(41))).toBeNull();
    expect(plainTextCandidate('a/b/c')).toBeNull();
  });
});
