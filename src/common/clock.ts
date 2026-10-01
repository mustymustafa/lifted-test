import { Injectable } from '@nestjs/common';

/**
 * The only source of "now" in the app. Injected as a singleton so tests can
 * swap in a fake clock and move time forward without waiting.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
