import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock';
import { AppConfig } from '../config/config';
import { DomainError } from '../common/errors';
import { Mutex } from '../common/mutex';
import { Booking, BookingStatus } from './booking.model';
import { DEFAULT_PAGE_SIZE, VisaType } from '../config/rules';
import { BookingQuery, BookingRepository } from './booking.repository';
import { CandidateRequestPolicy } from './candidate-request.policy';
import { AvailabilityService } from '../availability/availability.service';
import { SettleResult, SettlementService } from '../waitlist/settlement.service';

export interface RequestBookingCommand {
  candidateName: string;
  visaType: VisaType;
  /** Omit to be given the earliest available slot. */
  slotStart?: Date;
  /** Omit to accept any advisor. */
  advisorId?: string;
}

/** The filters a caller can list bookings by. */
export type BookingFilter = BookingQuery;

export interface BookingPage {
  items: Booking[];
  totalCount: number;
  /** Pass as `after` to get the next page. Absent on the last page. */
  nextCursor?: string;
}

@Injectable()
export class BookingService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly availability: AvailabilityService,
    private readonly settlement: SettlementService,
    private readonly policy: CandidateRequestPolicy,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly mutex: Mutex,
  ) {}

  /**
   * Places a slot on hold for the candidate. The check ("is it free?") and the
   * save happen inside the mutex, so two requests can never hold the same slot.
   * Settling first gives any freed slot to the waitlist before this request looks.
   * A candidate who already has an active request is refused.
   */
  request(command: RequestBookingCommand): Promise<Booking> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      await this.policy.assertCanRequest(command.candidateName);
      const slots = await this.availability.findSlots({
        visaType: command.visaType,
        advisorId: command.advisorId,
      });
      const wanted = command.slotStart?.getTime();
      const slot = wanted === undefined ? slots[0] : slots.find((s) => s.start.getTime() === wanted);
      if (!slot) {
        throw wanted === undefined
          ? new DomainError('NO_SLOT_AVAILABLE', 'No slot is available for this visa type')
          : new DomainError('SLOT_UNAVAILABLE', 'That slot is not available');
      }

      const now = this.clock.now();
      const booking: Booking = {
        id: randomUUID(),
        candidateName: command.candidateName,
        visaType: command.visaType,
        advisorId: slot.advisor.id,
        start: slot.start,
        end: slot.end,
        status: BookingStatus.HELD,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.config.holdMs),
      };
      await this.bookings.save(booking);
      return booking;
    });
  }

  /** The assigned advisor confirms a held booking before the hold lapses. */
  confirm(bookingId: string, advisorId: string): Promise<Booking> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      const booking = await this.bookings.findById(bookingId);
      if (!booking) throw new DomainError('BOOKING_NOT_FOUND', `Booking ${bookingId} does not exist`);
      if (booking.advisorId !== advisorId) {
        throw new DomainError('FORBIDDEN', 'Only the assigned advisor can confirm this booking');
      }
      if (booking.status === BookingStatus.EXPIRED) {
        throw new DomainError('HOLD_EXPIRED', 'The hold on this booking has expired');
      }
      if (booking.status !== BookingStatus.HELD) {
        throw new DomainError('INVALID_STATE', `Booking is ${booking.status}, not HELD`);
      }

      const confirmed: Booking = { ...booking, status: BookingStatus.CONFIRMED, confirmedAt: this.clock.now() };
      await this.bookings.save(confirmed);
      return confirmed;
    });
  }

  /**
   * Cancels a held or confirmed booking and offers the freed time to the
   * waitlist. Also what lets the candidate make a new request: they may only
   * have one active request at a time.
   */
  cancel(bookingId: string): Promise<Booking> {
    return this.mutex.runExclusive(async () => {
      await this.settlement.settle();
      const booking = await this.bookings.findById(bookingId);
      if (!booking) throw new DomainError('BOOKING_NOT_FOUND', `Booking ${bookingId} does not exist`);
      if (booking.status !== BookingStatus.HELD && booking.status !== BookingStatus.CONFIRMED) {
        throw new DomainError('INVALID_STATE', `Booking is ${booking.status} and cannot be cancelled`);
      }

      const cancelled: Booking = { ...booking, status: BookingStatus.CANCELLED, cancelledAt: this.clock.now() };
      await this.bookings.save(cancelled);
      await this.settlement.settle([booking.advisorId]);
      return cancelled;
    });
  }

  async get(bookingId: string): Promise<Booking | undefined> {
    await this.settle();
    return this.bookings.findById(bookingId);
  }

  /** Bookings ordered by start time, with filters and cursor pagination. */
  async list(filter: BookingFilter = {}, first = DEFAULT_PAGE_SIZE, after?: string): Promise<BookingPage> {
    await this.settle();
    const matches = await this.bookings.find(filter);

    let offset = 0;
    if (after) {
      const index = matches.findIndex((b) => b.id === after);
      if (index === -1) throw new DomainError('BAD_USER_INPUT', 'Unknown cursor');
      offset = index + 1;
    }
    const items = matches.slice(offset, offset + first);
    const hasMore = offset + first < matches.length;
    return {
      items,
      totalCount: matches.length,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
    };
  }

  /**
   * Releases lapsed holds and offers, and offers freed slots to the waitlist.
   * Availability does not depend on this having run. Called by the sweeper so
   * waitlist offers still go out when no requests are coming in.
   */
  settle(): Promise<SettleResult> {
    return this.mutex.runExclusive(() => this.settlement.settle());
  }
}
