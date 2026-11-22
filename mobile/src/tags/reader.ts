// The camera's memory between frames (spec §5.5, E38-05): two-frame agreement for text, what is in
// view now (for the outlines on screen), and every reading seen while the camera is open (for the
// list when several tags are in view). Pure: no React, no camera; time is passed in.
import { readFrame, sortReadings, type FrameReads, type Reading } from './read';
import type { TagFormat } from '../../../shared/tag-format.ts';

export interface SeenReading extends Reading {
  /** When it was first and last read (milliseconds, as passed to `observe`). */
  firstSeen: number;
  lastSeen: number;
  /** Frames it was read in. */
  frames: number;
}

/** How long a reading stays outlined after it was last read. */
export const IN_VIEW_MS = 1200;

export class TagReader {
  private formats: TagFormat[];
  /** Text keys of the previous frame (two-frame agreement). */
  private previousText = new Set<string>();
  private seen = new Map<string, SeenReading>();

  constructor(formats: TagFormat[] = []) {
    this.formats = formats;
  }

  setFormats(formats: TagFormat[]): void {
    this.formats = formats;
    this.previousText.clear();
  }

  /**
   * Takes one frame's reads; returns the readings that count from it: every code, and text read the
   * same way in this frame and the one before (or text from a still picture).
   */
  observe(frame: FrameReads, now: number): Reading[] {
    const { codes, texts } = readFrame(frame, this.formats);
    // Text, and codes without a check character, count when the frame before read them the same way.
    const unsure = [...texts, ...codes.filter((c) => c.weak)];
    const sure = codes.filter((c) => !c.weak);
    const keys = new Set(unsure.map((t) => t.key));
    const agreed = frame.still
      // Read once: text counts (formats and check characters still apply); an unchecked code is confirmed by the person.
      ? unsure.map((r) => (r.weak ? { ...r, trust: 'confirm' as const } : r))
      : unsure.filter((t) => this.previousText.has(t.key)).map((r) => (r.weak ? { ...r, weak: undefined } : r));
    this.previousText = frame.still ? new Set() : keys;
    const counted = [...sure, ...agreed];
    for (const r of counted) {
      const prev = this.seen.get(r.key);
      if (prev) {
        // A code on the same value upgrades a text reading (code wins; both agree → "both").
        const better = r.how !== 'text' || prev.how === 'text' ? { ...prev, ...r } : { ...prev, box: r.box };
        if (prev.how === 'code' && r.how === 'text') better.how = 'both';
        if (prev.how === 'both') better.how = 'both';
        this.seen.set(r.key, { ...better, firstSeen: prev.firstSeen, lastSeen: now, frames: prev.frames + 1 });
      } else {
        this.seen.set(r.key, { ...r, firstSeen: now, lastSeen: now, frames: 1 });
      }
    }
    return counted;
  }

  /** Readings read within the last IN_VIEW_MS (outlined on screen). */
  inView(now: number): SeenReading[] {
    return sortReadings([...this.seen.values()].filter((r) => now - r.lastSeen <= IN_VIEW_MS)) as SeenReading[];
  }

  /** Every reading since the camera opened (or since `reset`), best first. */
  all(): SeenReading[] {
    return sortReadings([...this.seen.values()]) as SeenReading[];
  }

  /** Forgets a reading (the person dismissed it). */
  forget(key: string): void {
    this.seen.delete(key);
  }

  reset(): void {
    this.seen.clear();
    this.previousText.clear();
  }
}
