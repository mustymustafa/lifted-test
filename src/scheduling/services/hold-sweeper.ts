import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../common/config';
import { BookingService } from './booking.service';

/** Background timer that releases lapsed holds and offers freed slots to the waitlist. */
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
      const { expired, offered } = await this.bookings.settle();
      if (expired > 0 || offered > 0) {
        this.logger.log(`Released ${expired} lapsed hold(s), made ${offered} waitlist offer(s)`);
      }
    } catch (error) {
      this.logger.error('Hold sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
