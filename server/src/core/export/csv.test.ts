import { describe, expect, it } from 'vitest';
import { csvCell, guardFormula } from './csv.ts';

// W17-5: the formula guard looks past leading white space and catches the full-width forms.
describe('CSV formula guard', () => {
  it('prefixes a cell a spreadsheet program could read as a formula', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', ' =HYPERLINK("x")', '\t=1', '\r=1', '\n=1', ' =1', '　+1', '﻿@x',
      '＝HYPERLINK("x")', '  ＋1', '－1', '＠x', '\tplain', '\rplain']) {
      expect(guardFormula(s)).toBe(`'${s}`);
    }
  });
  it('leaves ordinary text alone', () => {
    for (const s of ['plain', 'a=b', ' spaced text', '1-2', 'name@example.test', '', '  ']) expect(guardFormula(s)).toBe(s);
  });
  it('quotes and converts as before', () => {
    expect(csvCell(' =1,2')).toBe(`"' =1,2"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(new Date('2026-11-23T00:00:00Z'))).toBe('2026-11-23T00:00:00.000Z');
  });
});
