import { describe, expect, it } from 'vitest';
import { MAX_SCORE, scoreProject } from './project-scoring.ts';

// The portfolio scoring rule shared by the server and the web preview (E40-12).

const criteria = [
  { key: 'a', label: 'A', weight: 3 },
  { key: 'b', label: 'B', weight: 1 },
  { key: 'off', label: 'Not weighted', weight: 0 },
];

describe('project scoring', () => {
  it('weights scores out of 100 with one decimal', () => {
    expect(scoreProject({ a: 5, b: 0 }, criteria).result).toBe(75);
    expect(scoreProject({ a: 4, b: 3 }, criteria).result).toBe(75);
    expect(scoreProject({ a: 1, b: 1 }, [{ key: 'a', weight: 1 }, { key: 'b', weight: 2 }]).result).toBe(20);
    expect(scoreProject({ a: 2 }, [{ key: 'a', weight: 1 }, { key: 'b', weight: 2 }]).result).toBe(13.3);
  });

  it('treats a missing, null or empty score as not scored, and nothing scored as no result', () => {
    expect(scoreProject(null, criteria).result).toBeNull();
    expect(scoreProject({}, criteria).result).toBeNull();
    expect(scoreProject({ a: '', b: null }, criteria).result).toBeNull();
    const { lines, result } = scoreProject({ a: '', b: 5 }, criteria);
    expect(result).toBe(25);
    expect(lines[0]).toMatchObject({ score: null, share: 75, points: 0 });
    expect(lines[1]).toMatchObject({ score: 5, share: 25, points: 25 });
  });

  it('clamps scores to 0..max and ignores unknown keys and unweighted criteria', () => {
    expect(scoreProject({ a: 9, b: -2 }, criteria).result).toBe(75);
    expect(scoreProject({ a: 'x', b: 5 }, criteria).result).toBe(25); // not a number counts as 0, but scored
    expect(scoreProject({ gone: 5, off: 5 }, criteria).result).toBeNull();
    expect(scoreProject({ a: 3 }, criteria, 3).result).toBe(75);
    expect(MAX_SCORE).toBe(5);
  });
});
