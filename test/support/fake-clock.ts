import { Clock } from '../../src/common/clock';

export { MINUTE } from '../../src/config/rules';

/** A clock that only moves when the test tells it to. */
export class FakeClock extends Clock {
  private current: number;

  constructor(start: string | Date = '2025-03-01T08:00:00Z') {
    super();
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
