/** The service desk's idea of "now". Tests pin it to walk SLA clocks across evenings and weekends. */
let fixed: number | null = null;

export const clock = {
  now(): Date {
    return new Date(fixed ?? Date.now());
  },
  /** Pin the clock (tests only). Pass null to return to real time. */
  set(at: Date | string | null): void {
    fixed = at === null ? null : new Date(at).getTime();
  },
};
