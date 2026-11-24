import { describe, expect, it, vi } from 'vitest';
vi.mock('virtual:grc-modules', () => ({ entries: [] }));
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; }); // module.ts records its routes on window
import { rowsCsv } from './ListBulk';
import type { ResourceMeta } from './meta';
import { trainingRecordsCsv } from '../modules/training/Records';
import type { TrainingRecord } from '../modules/training/shared';

// W19: the CSV files the browser makes (selected list rows, training records) use the server's formula
// guard (shared/csv-guard.ts): leading spaces and full-width characters no longer slip past it.
const HOSTILE = [' =HYPERLINK("x")', '＝1+1', '  ＋1', '　@SUM(A1)', '=1', '-2'];

describe('browser CSV files', () => {
  it('prefix every cell a spreadsheet program could read as a formula in selected list rows', () => {
    const resource = { fields: { name: { label: 'Name', type: 'text' } } } as unknown as ResourceMeta;
    const csv = rowsCsv(resource, ['name'], HOSTILE.map((name) => ({ id: name, name })));
    const cells = csv.trim().split('\r\n').slice(1).map((l) => l.replace(/^"|"$/g, '').replace(/""/g, '"'));
    expect(cells).toEqual(HOSTILE.map((s) => `'${s}`));
    expect(rowsCsv(resource, ['name'], [{ id: '1', name: 'Depot 4 = north yard' }])).toContain('Depot 4 = north yard');
  });

  it('prefix them in the training records file', () => {
    const base = {
      id: '1', course_id: 'c', course_title: 'Safety briefing', course_ref: null, user_id: null, email: null, department: null,
      has_account: false, assigned_on: null, due_on: null, completed_on: null, score: null, result: null, source: 'manual', status: 'due',
    } as unknown as TrainingRecord;
    const csv = trainingRecordsCsv(HOSTILE.map((person) => ({ ...base, person, evidence_note: person })));
    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('Person,Email,')).toBe(true);
    for (const [i, s] of HOSTILE.entries()) {
      const quoted = /[",]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `'${s}`;
      expect(lines[i + 1].startsWith(`${quoted},`)).toBe(true);
    }
  });
});
