/** Half-open time range [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export interface SlotQuery {
  /** Advisor availability windows. */
  windows: Interval[];
  /** Time already taken: each existing booking plus the break after it. */
  blocked: Interval[];
  durationMs: number;
  /** Break the advisor needs after the new appointment. */
  breakMs: number;
}

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

/** The parts of `window` not covered by any blocked range. */
export function subtractBlocked(window: Interval, blocked: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  const relevant = blocked.filter((b) => overlaps(b, window)).sort((a, b) => a.start - b.start);
  for (const b of relevant) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

/**
 * Bookable slots for one advisor and one appointment length.
 *
 * Pure function: no clock, no storage. Rules:
 *  1. Take each window and remove the blocked ranges.
 *  2. Slice each free stretch into back-to-back slots, starting at its start.
 *  3. Drop a slot if the break after it would run into an existing booking.
 *     The break may run past the end of the window; only the call must fit.
 *
 * Windows are never merged, so a slot cannot span a gap between two windows.
 */
export function computeSlots({ windows, blocked, durationMs, breakMs }: SlotQuery): Interval[] {
  if (durationMs <= 0) throw new Error('durationMs must be positive');
  const slots: Interval[] = [];
  for (const window of windows) {
    for (const free of subtractBlocked(window, blocked)) {
      for (let start = free.start; start + durationMs <= free.end; start += durationMs) {
        const end = start + durationMs;
        const withBreak = { start, end: end + breakMs };
        if (!blocked.some((b) => overlaps(b, withBreak))) slots.push({ start, end });
      }
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}
