import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../common/clock';
import { AppConfig } from '../../common/config';
import { DomainError } from '../../common/errors';
import { Mutex } from '../../common/mutex';
import { Booking, BookingStatus, isHoldExpired } from '../domain/booking';
import { VisaType } from '../domain/visa-type';
import { BookingRepository } from '../repositories/booking.repository';
import { AvailabilityService } from './availability.service';

export interface RequestBookingCommand {
  candidateName: string;
  visaType: VisaType;
  /** Omit to be given the earliest available slot. */
  slotStart?: Date;
  /** Omit to accept any advisor. */
  advisorId?: string;
}

export interface BookingFilter {
  status?: BookingStatus;
  advisorId?: string;
  visaType?: VisaType;
  /** Only bookings that start at or after this time. */
  from?: Date;
  /** Only bookings that end at or before this time. */
  to?: Date;
}

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
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly mutex: Mutex,
  ) {}

  /**
   * Places a slot on hold for the candidate. The check ("is it free?") and the
   * save happen inside the mutex, so two requests can never hold the same slot.
   */
  request(command: RequestBookingCommand): Promise<Booking> {
    return this.mutex.runExclusive(async () => {
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
      const booking = await this.bookings.findById(bookingId);
      if (!booking) throw new DomainError('BOOKING_NOT_FOUND', `Booking ${bookingId} does not exist`);
      if (booking.advisorId !== advisorId) {
        throw new DomainError('FORBIDDEN', 'Only the assigned advisor can confirm this booking');
      }

      const now = this.clock.now();
      if (isHoldExpired(booking, now)) {
        await this.bookings.save({ ...booking, status: BookingStatus.EXPIRED });
        throw new DomainError('HOLD_EXPIRED', 'The hold on this booking has expired');
      }
      if (booking.status !== BookingStatus.HELD) {
        throw new DomainError('INVALID_STATE', `Booking is ${booking.status}, not HELD`);
      }

      const confirmed: Booking = { ...booking, status: BookingStatus.CONFIRMED, confirmedAt: now };
      await this.bookings.save(confirmed);
      return confirmed;
    });
  }

  /** Bookings ordered by start time, with filters and cursor pagination. */
  async list(filter: BookingFilter = {}, first = 50, after?: string): Promise<BookingPage> {
    await this.expireStaleHolds();
    const matches = (await this.bookings.findAll())
      .filter(
        (b) =>
          (!filter.status || b.status === filter.status) &&
          (!filter.advisorId || b.advisorId === filter.advisorId) &&
          (!filter.visaType || b.visaType === filter.visaType) &&
          (!filter.from || b.start >= filter.from) &&
          (!filter.to || b.end <= filter.to),
      )
      .sort(
        (a, b) =>
          a.start.getTime() - b.start.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );

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
   * Marks lapsed holds as EXPIRED so stored status matches reality. Availability
   * does not depend on this having run; it is bookkeeping. Returns how many changed.
   */
  expireStaleHolds(): Promise<number> {
    return this.mutex.runExclusive(async () => {
      const now = this.clock.now();
      const stale = (await this.bookings.findAll()).filter((b) => isHoldExpired(b, now));
      for (const booking of stale) {
        await this.bookings.save({ ...booking, status: BookingStatus.EXPIRED });
      }
      return stale.length;
    });
  }
}
