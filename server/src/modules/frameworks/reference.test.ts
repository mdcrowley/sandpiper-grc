import { describe, expect, it } from 'vitest';
import { flattenReference, loadCsf2 } from './reference.ts';
import { parseMapping, parseMappings } from './seed.ts';

describe('NIST CSF 2.0 reference data', () => {
  const ref = loadCsf2();
  const outcomes = flattenReference(ref);

  it('has 6 functions, 22 categories and 106 subcategories', () => {
    expect(ref.functions.map((f) => f.code)).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
    expect(ref.functions.flatMap((f) => f.categories).length).toBe(22);
    expect(outcomes.length).toBe(106);
  });

  it('has unique, well-formed codes that sit under their category and function', () => {
    expect(new Set(outcomes.map((o) => o.code)).size).toBe(106);
    const categories = ref.functions.flatMap((f) => f.categories.map((c) => c.code));
    expect(new Set(categories).size).toBe(22);
    for (const f of ref.functions) {
      expect(f.name).toBeTruthy();
      for (const c of f.categories) {
        expect(c.code).toMatch(/^[A-Z]{2}\.[A-Z]{2}$/);
        expect(c.code.startsWith(`${f.code}.`)).toBe(true);
        expect(c.name).toBeTruthy();
        expect(c.outcomes.length).toBeGreaterThan(0);
        for (const o of c.outcomes) {
          expect(o.code).toMatch(/^[A-Z]{2}\.[A-Z]{2}-\d{2}$/);
          expect(o.code.startsWith(`${c.code}-`)).toBe(true);
          expect(o.text.trim().length).toBeGreaterThan(15);
        }
      }
    }
  });

  it('has the published number of subcategories in each function', () => {
    const count = (code: string) => outcomes.filter((o) => o.function_code === code).length;
    expect(['GV', 'ID', 'PR', 'DE', 'RS', 'RC'].map(count)).toEqual([31, 21, 22, 11, 13, 8]);
  });
});

describe('also-satisfies parsing', () => {
  it('splits a framework name from its reference', () => {
    expect(parseMapping('PCI DSS 12.10.1')).toEqual({ framework_name: 'PCI DSS', reference: '12.10.1' });
    // A name that is not in the list of well-known frameworks is split at its first number.
    expect(parseMapping('Northshire Charter 9.64')).toEqual({ framework_name: 'Northshire Charter', reference: '9.64' });
    expect(parseMapping('Northshire Charter 9.64 (staff training)')).toEqual({ framework_name: 'Northshire Charter', reference: '9.64 (staff training)' });
    // Well-known names that contain a number are kept whole.
    expect(parseMapping('ISO/IEC 27001 A.5.1')).toEqual({ framework_name: 'ISO/IEC 27001', reference: 'A.5.1' });
    expect(parseMapping('SOC 2')).toEqual({ framework_name: 'SOC 2', reference: '' });
    expect(parseMapping('Harbor Privacy Rule 164.308(a)(1)')).toEqual({ framework_name: 'Harbor Privacy Rule', reference: '164.308(a)(1)' });
    expect(parseMapping('Example Guild XY-RP-001, XY-RP-002')).toEqual({ framework_name: 'Example Guild', reference: 'XY-RP-001, XY-RP-002' });
    expect(parseMapping('Insurer conditions')).toEqual({ framework_name: 'Insurer conditions', reference: '' });
    expect(parseMapping('Regional advisory (June 2031)')).toEqual({ framework_name: 'Regional advisory', reference: 'June 2031' });
    expect(parseMapping('   ')).toBeNull();
  });

  it('splits a cell on semicolons and drops repeats', () => {
    expect(parseMappings('PCI DSS 8.2; Insurer conditions ; pci dss 8.2;')).toEqual([
      { framework_name: 'PCI DSS', reference: '8.2' },
      { framework_name: 'Insurer conditions', reference: '' },
    ]);
    expect(parseMappings('')).toEqual([]);
  });
});
