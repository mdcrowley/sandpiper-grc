import { describe, expect, it } from 'vitest';
import { archiveStem, byAge, nextArchiveName } from './online-backup.ts';

// Backups taken within the same second get _2, _3 ... suffixes. Pruning keeps the newest, so the
// order must follow time and sequence, whatever the extension (.tar or the encrypted .tar.sgrc).
describe('ordering of backup archives', () => {
  it('orders by time, then by same-second sequence, ignoring the extension', () => {
    const names = [
      'sandpiper-backup-20261119-061701_3.tar.sgrc',
      'sandpiper-backup-20261119-061701.tar',
      'sandpiper-backup-20261118-235959.tar.sgrc',
      'sandpiper-backup-20261119-061701_2.tar',
      'sandpiper-backup-20261119-061702.tar',
    ];
    expect([...names].sort(byAge)).toEqual([
      'sandpiper-backup-20261118-235959.tar.sgrc',
      'sandpiper-backup-20261119-061701.tar',
      'sandpiper-backup-20261119-061701_2.tar',
      'sandpiper-backup-20261119-061701_3.tar.sgrc',
      'sandpiper-backup-20261119-061702.tar',
    ]);
  });

  it('numbers a new archive after the highest used that second, never into a pruned gap', () => {
    const base = 'sandpiper-backup-20261119-062113';
    expect(nextArchiveName([], base, '.tar')).toBe(`${base}.tar`);
    expect(nextArchiveName([`${base}.tar`], base, '.tar.sgrc')).toBe(`${base}_2.tar.sgrc`);
    // The unsuffixed one was pruned, leaving _2 and _3: the next is _4, not the freed name.
    expect(nextArchiveName([`${base}_2.tar`, `${base}_3.tar`], base, '.tar.sgrc')).toBe(`${base}_4.tar.sgrc`);
    expect(nextArchiveName(['sandpiper-backup-20261119-062112_5.tar'], base, '.tar')).toBe(`${base}.tar`);
  });

  it('gives plain and encrypted archives one numbering', () => {
    expect(archiveStem('sandpiper-backup-20261119-061701_2.tar')).toBe('sandpiper-backup-20261119-061701_2');
    expect(archiveStem('sandpiper-backup-20261119-061701_2.tar.sgrc')).toBe('sandpiper-backup-20261119-061701_2');
  });
});
