import { Injectable } from '@nestjs/common';

/**
 * In-process lock: runs async tasks one at a time, in arrival order.
 *
 * Booking writes are "check the slot is free, then save". The repositories are
 * async (so a database can sit behind them), which means two requests could
 * interleave between the check and the save. This closes that gap for a single
 * process. Across several instances the database has to do this job instead.
 */
@Injectable()
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
