import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../common/config';
import { BookingService } from './booking.service';

/** Background timer that marks lapsed holds as EXPIRED. */
@Injectable()
export class HoldSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly bookings: BookingService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.sweepIntervalMs <= 0) return;
    this.timer = setInterval(() => void this.sweep(), this.config.sweepIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const expired = await this.bookings.expireStaleHolds();
      if (expired > 0) this.logger.log(`Released ${expired} expired hold(s)`);
    } catch (error) {
      this.logger.error('Hold sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
