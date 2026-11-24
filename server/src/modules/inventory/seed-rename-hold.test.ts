import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '../../core/module.ts';
import { renameSamples } from './seed-rename.ts';

// W19: when a record's own rules refuse the rename, the dev seed renames the sample directly and says
// so in the audit log; a record under an active legal hold is never renamed that way.
const ID = '11111111-2222-4333-8444-555555555555';

function standIn(held: boolean) {
  const writes: string[] = [];
  const audits: { summary: string }[] = [];
  const db = {
    one: async (sql: string) => (sql.includes('information_schema') ? { x: 1 } : undefined),
    query: async (sql: string) => {
      if (sql.startsWith('update')) { writes.push(sql); return []; }
      if (sql.includes('legal_hold_records')) return held ? [{ holdId: 'h', ref: 'LH-0001', matter: 'x' }] : [];
      return [{ id: ID }];
    },
  };
  const ctx = {
    db,
    resources: {
      get: () => ({ table: 'gizmos' }),
      update: vi.fn(async () => { throw new Error('This gizmo is closed and cannot be changed.'); }),
    },
    audit: async (_req: unknown, ev: { summary: string }) => { audits.push(ev); },
  } as unknown as ModuleContext;
  return { ctx, writes, audits };
}

describe('sample rename fallback (W19)', () => {
  it('renames a record its rules refuse directly, and the audit event says so', async () => {
    const { ctx, writes, audits } = standIn(false);
    expect(await renameSamples(ctx, [{ type: 'gizmo', names: ['[Sample] Old radio'] }])).toBe(1);
    expect(writes).toHaveLength(1);
    expect(audits[0].summary).toMatch(/renamed directly by the dev seed, past the record's own rules \(This gizmo is closed/);
  });

  it('never renames a record under an active legal hold that way', async () => {
    const { ctx, writes, audits } = standIn(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await renameSamples(ctx, [{ type: 'gizmo', names: ['[Sample] Old radio'] }])).toBe(0);
    } finally {
      warn.mockRestore();
    }
    expect(writes).toEqual([]);
    expect(audits).toEqual([]);
  });
});
