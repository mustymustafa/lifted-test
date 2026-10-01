import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock';
import { AppConfig } from '../config/config';
import { BookingStatus, isHoldExpired } from '../bookings/booking.model';
import { WaitlistStatus } from './waitlist.model';
import { BookingRepository } from '../bookings/booking.repository';
import { WaitlistRepository } from './waitlist.repository';
import { AvailabilityService } from '../availability/availability.service';

export interface SettleResult {
  /** Holds and offers that lapsed. */
  expired: number;
  /** Freed slots offered to waitlisted candidates. */
  offered: number;
}

/**
 * Brings stored state up to date: releases lapsed holds and offers, then gives
 * any freed time to the waitlist.
 *
 * Every write runs this first, inside the mutex, before doing its own work.
 * That is what stops a new request from taking a freed slot ahead of someone
 * who was already waiting. The caller must hold the mutex.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly waitlist: WaitlistRepository,
    private readonly availability: AvailabilityService,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  /** @param freedAdvisorIds advisors with time just freed by the caller (a cancellation). */
  async settle(freedAdvisorIds: string[] = []): Promise<SettleResult> {
    const now = this.clock.now();
    const freed = new Set(freedAdvisorIds);
    let expired = 0;

    for (const booking of await this.bookings.findAll()) {
      if (!isHoldExpired(booking, now)) continue;
      await this.bookings.save({ ...booking, status: BookingStatus.EXPIRED });
      if (booking.status === BookingStatus.OFFERED) await this.closeMissedOffer(booking.id);
      freed.add(booking.advisorId);
      expired++;
    }

    const offered = freed.size > 0 ? await this.offerFreedSlots(freed, now) : 0;
    return { expired, offered };
  }

  /** A candidate who lets an offer lapse has had their turn and leaves the queue. */
  private async closeMissedOffer(bookingId: string): Promise<void> {
    const entry = (await this.waitlist.findAll()).find((e) => e.bookingId === bookingId);
    if (entry) await this.waitlist.save({ ...entry, status: WaitlistStatus.EXPIRED });
  }

  /**
   * Only looks at candidates who could use a freed advisor, oldest first. A
   * candidate whose visa type does not fit is skipped, not blocking the queue.
   */
  private async offerFreedSlots(freed: Set<string>, now: Date): Promise<number> {
    const waiting = (await this.waitlist.findAll())
      .filter((e) => e.status === WaitlistStatus.WAITING && (!e.advisorId || freed.has(e.advisorId)))
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());

    let offered = 0;
    for (const entry of waiting) {
      const [slot] = await this.availability.findSlots({ visaType: entry.visaType, advisorId: entry.advisorId });
      if (!slot) continue;
      const bookingId = randomUUID();
      await this.bookings.save({
        id: bookingId,
        candidateName: entry.candidateName,
        visaType: entry.visaType,
        advisorId: slot.advisor.id,
        start: slot.start,
        end: slot.end,
        status: BookingStatus.OFFERED,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.config.holdMs),
      });
      await this.waitlist.save({ ...entry, status: WaitlistStatus.OFFERED, bookingId });
      offered++;
    }
    return offered;
  }
}
