import { computeSlots, Interval, subtractBlocked } from '../../src/scheduling/domain/slot-calculator';

const MIN = 60_000;
/** Minutes after 09:00 on an arbitrary day, to keep the cases readable. */
const at = (minutes: number): number => Date.UTC(2025, 2, 10, 9, 0) + minutes * MIN;
const range = (from: number, to: number): Interval => ({ start: at(from), end: at(to) });
const A = { durationMs: 30 * MIN, breakMs: 5 * MIN };
const B = { durationMs: 60 * MIN, breakMs: 10 * MIN };

describe('subtractBlocked', () => {
  it('returns the whole window when nothing is blocked', () => {
    expect(subtractBlocked(range(0, 60), [])).toEqual([range(0, 60)]);
  });

  it('cuts a hole out of the middle', () => {
    expect(subtractBlocked(range(0, 120), [range(30, 60)])).toEqual([range(0, 30), range(60, 120)]);
  });

  it('handles blocked ranges that overhang either edge', () => {
    expect(subtractBlocked(range(0, 120), [range(-10, 20), range(100, 150)])).toEqual([range(20, 100)]);
  });

  it('handles overlapping and unsorted blocked ranges', () => {
    expect(subtractBlocked(range(0, 120), [range(50, 80), range(30, 60)])).toEqual([
      range(0, 30),
      range(80, 120),
    ]);
  });

  it('returns nothing when the window is fully blocked', () => {
    expect(subtractBlocked(range(0, 60), [range(-5, 65)])).toEqual([]);
  });

  it('ignores blocked ranges that only touch the window edge', () => {
    expect(subtractBlocked(range(0, 60), [range(60, 90), range(-30, 0)])).toEqual([range(0, 60)]);
  });
});

describe('computeSlots', () => {
  describe('with no bookings', () => {
    it.each([
      // [window minutes, duration rule, expected slot start minutes]
      { name: '60 min window, type A', window: 60, rule: A, starts: [0, 30] },
      { name: '60 min window, type B', window: 60, rule: B, starts: [0] },
      { name: '110 min window, type A drops the 20 min remainder', window: 110, rule: A, starts: [0, 30, 60] },
      { name: '110 min window, type B fits once', window: 110, rule: B, starts: [0] },
      { name: '20 min window is too short for A', window: 20, rule: A, starts: [] },
      { name: '25 min window is too short for A', window: 25, rule: A, starts: [] },
      { name: '30 min window fits exactly one A', window: 30, rule: A, starts: [0] },
      { name: '30 min window is too short for B', window: 30, rule: B, starts: [] },
    ])('$name', ({ window, rule, starts }) => {
      const slots = computeSlots({ windows: [range(0, window)], blocked: [], ...rule });
      expect(slots).toEqual(starts.map((s) => ({ start: at(s), end: at(s) + rule.durationMs })));
    });

    it('lets the break after the last slot run past the end of the window', () => {
      // The call ends exactly at the window end; the break does not need to fit inside it.
      expect(computeSlots({ windows: [range(0, 30)], blocked: [], ...A })).toHaveLength(1);
    });
  });

  describe('windows are never merged', () => {
    // Rajan, 10 March: 09:00-09:30 and 09:33-11:30.
    const windows = [range(0, 30), range(33, 150)];

    it('starts the second window on its own off-grid start time', () => {
      const starts = computeSlots({ windows, blocked: [], ...A }).map((s) => s.start);
      expect(starts).toEqual([at(0), at(33), at(63), at(93)]);
    });

    it('does not let a 60 min slot span the 3 minute gap', () => {
      const starts = computeSlots({ windows, blocked: [], ...B }).map((s) => s.start);
      expect(starts).toEqual([at(33)]);
    });
  });

  describe('with existing bookings', () => {
    it('removes the booked time and the break after it', () => {
      // Type B booked 09:00-10:00, blocked until 10:10. Window ends 10:50.
      const slots = computeSlots({ windows: [range(0, 110)], blocked: [range(0, 70)], ...A });
      expect(slots).toEqual([range(70, 100)]);
    });

    it('leaves no type B slot when the remaining time is too short', () => {
      expect(computeSlots({ windows: [range(0, 110)], blocked: [range(0, 70)], ...B })).toEqual([]);
    });

    it('drops a slot whose break would run into the next booking', () => {
      // Type A booked 09:30-10:00, blocked until 10:05, in a 09:00-11:00 window.
      const slots = computeSlots({ windows: [range(0, 120)], blocked: [range(30, 65)], ...A });
      // 09:00-09:30 would need a break until 09:35, which runs into the 09:30 booking.
      expect(slots).toEqual([range(65, 95)]);
    });

    it('offers a slot before a booking only if its own break also fits', () => {
      // Booking at 09:35. A slot at 09:00-09:30 plus a 5 min break ends exactly at 09:35.
      const slots = computeSlots({ windows: [range(0, 120)], blocked: [range(35, 70)], ...A });
      expect(slots.map((s) => s.start)).toEqual([at(0), at(70)]);
    });

    it('carries a break across a gap into the next window', () => {
      // Rajan: type A booked 09:00-09:30, break until 09:35, second window opens at 09:33.
      const slots = computeSlots({
        windows: [range(0, 30), range(33, 150)],
        blocked: [range(0, 35)],
        ...A,
      });
      expect(slots.map((s) => s.start)).toEqual([at(35), at(65), at(95)]);
    });

    it('protects the break before a booking in the next window', () => {
      // Booking at 09:33 in the second window. A 09:00-09:30 slot would leave a 3 min break.
      const slots = computeSlots({
        windows: [range(0, 30), range(33, 150)],
        blocked: [range(33, 68)],
        ...A,
      });
      expect(slots.map((s) => s.start)).toEqual([at(68), at(98)]);
    });

    it('returns nothing when the window is fully booked', () => {
      expect(computeSlots({ windows: [range(0, 60)], blocked: [range(0, 70)], ...A })).toEqual([]);
    });
  });

  it('returns slots sorted by start even if windows are not', () => {
    const slots = computeSlots({ windows: [range(200, 230), range(0, 30)], blocked: [], ...A });
    expect(slots.map((s) => s.start)).toEqual([at(0), at(200)]);
  });

  it('never returns a slot that overlaps a blocked range', () => {
    const blocked = [range(10, 45), range(100, 170), range(300, 335)];
    const windows = [range(0, 240), range(250, 400)];
    for (const rule of [A, B]) {
      for (const slot of computeSlots({ windows, blocked, ...rule })) {
        const withBreak = { start: slot.start, end: slot.end + rule.breakMs };
        expect(blocked.some((b) => b.start < withBreak.end && withBreak.start < b.end)).toBe(false);
        expect(windows.some((w) => w.start <= slot.start && slot.end <= w.end)).toBe(true);
      }
    }
  });

  it('rejects a non-positive duration rather than looping forever', () => {
    expect(() => computeSlots({ windows: [range(0, 60)], blocked: [], durationMs: 0, breakMs: 0 })).toThrow();
  });
});
